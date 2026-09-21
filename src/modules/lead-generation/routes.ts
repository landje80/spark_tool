import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import { SETTING_LEADGEN_ENABLED, getSetting, setSetting } from '../../shared/settings.js';
import { parseInput } from '../../shared/validation/parse.js';
import { audit } from '../audit/audit.js';
import { requirePermission } from '../auth/middleware.js';
import { isLeadGenConfigured } from '../jobs/handlers.js';
import { enqueue } from '../jobs/queue.js';
import type { Actor } from '../prospects/service.js';
import { listPendingCandidates, resolveCandidate } from './review.js';
import { spentToday } from './service.js';

const idParam = z.string().min(1).max(40);
const resolveSchema = z.object({ action: z.enum(['accept', 'attach', 'reject']) }).strict();
const toggleSchema = z.object({ enabled: z.boolean() }).strict();
const actorOf = (req: Request): Actor => ({ id: req.user!.id, ip: req.ip });

/** Leadgeneratie-API: runs bekijken/starten, reviewqueue en beheerstatus. Nooit tokens in antwoorden. */
export function leadRouter(env: Env, db: PrismaClient): Router {
  const r = Router();

  r.get('/leads/runs', requirePermission('prospect.read'), async (_req, res) => {
    const runs = await db.leadGenerationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
    res.json({
      runs: runs.map((x) => ({
        id: x.id,
        startedAt: x.startedAt,
        finishedAt: x.finishedAt,
        status: x.status,
        model: x.model,
        candidatesCount: x.candidatesCount,
        acceptedCount: x.acceptedCount,
        duplicateCount: x.duplicateCount,
        reviewCount: x.reviewCount,
        inputTokens: x.inputTokens,
        outputTokens: x.outputTokens,
        webSearchRequests: x.webSearchRequests,
        estimatedCostUsd: Number(x.estimatedCostUsd ?? 0),
        errorMessage: x.errorMessage,
      })),
    });
  });

  r.post('/leads/runs', requirePermission('lead.run'), async (req, res) => {
    if (!isLeadGenConfigured(env)) {
      throw new AppError('CONFLICT', 'Leadgeneratie is niet geconfigureerd', {
        reason: 'not_configured',
      });
    }
    // Eén openstaande leadrun tegelijk: voorkomt spammen van (betaalde) runs en parallel draaiende runs.
    const open = await db.job.findFirst({
      where: { type: 'lead-generation', status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true },
    });
    if (open) {
      throw new AppError('CONFLICT', 'Er staat al een leadrun klaar of actief', {
        reason: 'already_queued',
      });
    }
    const { job } = await enqueue(db, {
      type: 'lead-generation',
      dedupeKey: `manual-${req.user!.id}-${Math.floor(Date.now() / 60_000)}`, // dubbelklik in dezelfde minuut = één job
      payload: { trigger: 'manual', actorId: req.user!.id },
      maxAttempts: 1, // geen automatische herhaling: elke poging kost geld; de gebruiker kan opnieuw starten
    });
    await audit(db, {
      actorId: req.user!.id,
      action: 'lead.run.request',
      entityType: 'Job',
      entityId: job.id,
      ip: req.ip,
    });
    res.status(202).json({ jobId: job.id });
  });

  r.get('/leads/candidates', requirePermission('prospect.read'), async (_req, res) => {
    res.json({ candidates: await listPendingCandidates(db) });
  });

  r.post('/leads/candidates/:id/resolve', requirePermission('prospect.write'), async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const { action } = parseInput(resolveSchema, req.body);
    res.json(await resolveCandidate(db, actorOf(req), id, action));
  });

  r.get('/admin/integrations', requirePermission('settings.manage'), async (_req, res) => {
    const now = new Date();
    const [enabled, spent, lastOk, jobsPending, jobsDead, lastFailed] = await Promise.all([
      getSetting<boolean>(db, SETTING_LEADGEN_ENABLED, false),
      spentToday(db, env.LEAD_GENERATION_TIMEZONE, now),
      db.leadGenerationRun.findFirst({
        where: { status: 'SUCCEEDED' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true, acceptedCount: true },
      }),
      db.job.count({ where: { status: 'PENDING' } }),
      db.job.count({ where: { status: 'DEAD' } }),
      db.job.findFirst({
        where: { status: { in: ['DEAD', 'FAILED'] } },
        orderBy: { createdAt: 'desc' },
        select: { type: true, lastError: true, createdAt: true },
      }),
    ]);
    // Alleen aanwezig/afwezig; nooit de waarden van sleutels of tokens.
    res.json({
      anthropic: {
        apiKeyPresent: !!env.ANTHROPIC_API_KEY,
        leadModel: env.ANTHROPIC_MODEL_LEAD_RESEARCH ?? null,
        contentModel: env.ANTHROPIC_MODEL_CONTENT ?? null,
      },
      postmark: {
        tokenPresent: !!env.POSTMARK_SERVER_TOKEN,
        fromEmail: env.POSTMARK_FROM_EMAIL ?? null,
        webhookSecretPresent: !!env.POSTMARK_WEBHOOK_SECRET,
      },
      entra: { tenantConfigured: !!env.ENTRA_TENANT_ID },
      leadGeneration: {
        enabled,
        configured: isLeadGenConfigured(env),
        dailyTarget: env.LEAD_GENERATION_DAILY_TARGET,
        maxDailyCostUsd: env.ANTHROPIC_MAX_DAILY_COST,
        spentTodayUsd: Number(spent.toFixed(4)),
        lastSuccessfulRunAt: lastOk?.finishedAt ?? null,
      },
      jobs: { pending: jobsPending, dead: jobsDead, lastFailure: lastFailed },
    });
  });

  r.post('/admin/leadgen', requirePermission('settings.manage'), async (req, res) => {
    const { enabled } = parseInput(toggleSchema, req.body);
    await setSetting(db, SETTING_LEADGEN_ENABLED, enabled, req.user!.id);
    await audit(db, {
      actorId: req.user!.id,
      action: 'settings.leadgen',
      entityType: 'AppSetting',
      entityId: SETTING_LEADGEN_ENABLED,
      ip: req.ip,
      metadata: { enabled },
    });
    res.json({ enabled });
  });

  return r;
}

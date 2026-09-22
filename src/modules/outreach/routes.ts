import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import { requirePermission } from '../auth/middleware.js';
import { AppError } from '../../shared/errors/app-error.js';
import { parseInput } from '../../shared/validation/parse.js';
import type { Actor } from '../../shared/security/actor.js';
import { hasLineBreaks, paragraphsOf } from './render.js';
import {
  createDraft,
  discardDraft,
  mailConfigured,
  prepareSend,
  registerReply,
  sendDraft,
  updateDraft,
  type OutreachDeps,
} from './service.js';
import {
  DEFAULT_FOOTER,
  getOutreachSettings,
  outreachSettingsSchema,
  saveOutreachSettings,
} from './settings.js';
import { addSuppression } from './suppression.js';

const idParam = z.string().min(1).max(40);
const noBreaks = (s: string) => !hasLineBreaks(s);

const draftUpdateSchema = z
  .object({
    subject: z.string().trim().min(1).max(200).refine(noBreaks, 'Bevat ongeldige regeleinden'),
    textBody: z.string().min(20).max(10_000),
  })
  .strict();
const prepareSchema = z.object({ to: z.email().max(320).optional() }).strict();
const sendSchema = z
  .object({
    to: z.email().max(320),
    confirmToken: z.string().min(10).max(2000),
    followUpDays: z.number().int().min(1).max(60).nullable().optional(),
  })
  .strict();
const replySchema = z
  .object({ text: z.string().trim().min(1).max(5000), notInterested: z.boolean().default(false) })
  .strict();
const suppressSchema = z.object({ email: z.email().max(320) }).strict();

const actorOf = (req: Request): Actor => ({ id: req.user!.id, ip: req.ip });

/** Outreach-API (concepten, verzenden na bevestiging, antwoorden). Achter sessie + CSRF gemonteerd. */
export function outreachRouter(deps: OutreachDeps): Router {
  const { db, env } = deps;
  const r = Router();
  const prepare = requirePermission('outreach.prepare');
  const send = requirePermission('outreach.send');
  const sendLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'test' ? 100_000 : 20,
    keyGenerator: (req) => (req as Request).user?.id ?? 'anon',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  r.post('/prospects/:id/drafts', prepare, async (req, res) => {
    const draft = await createDraft(deps, actorOf(req), parseInput(idParam, req.params.id));
    res.status(201).json(draft);
  });

  r.get('/outreach/drafts/:id', prepare, async (req, res) => {
    const draft = await db.outreachDraft.findUnique({
      where: { id: parseInput(idParam, req.params.id) },
      include: {
        prospect: { select: { id: true, companyName: true, contactEmail: true, status: true } },
      },
    });
    if (!draft) throw new AppError('NOT_FOUND', 'Concept niet gevonden');
    res.json({ ...draft, paragraphs: paragraphsOf(draft.textBody) });
  });

  r.patch('/outreach/drafts/:id', prepare, async (req, res) => {
    const input = parseInput(draftUpdateSchema, req.body);
    res.json(await updateDraft(db, actorOf(req), parseInput(idParam, req.params.id), input));
  });

  r.post('/outreach/drafts/:id/discard', prepare, async (req, res) => {
    await discardDraft(db, actorOf(req), parseInput(idParam, req.params.id));
    res.status(204).end();
  });

  r.post('/outreach/drafts/:id/prepare-send', send, async (req, res) => {
    const { to } = parseInput(prepareSchema, req.body);
    res.json(await prepareSend(deps, actorOf(req), parseInput(idParam, req.params.id), to));
  });

  r.post('/outreach/drafts/:id/send', send, sendLimiter, async (req, res) => {
    const input = parseInput(sendSchema, req.body);
    const result = await sendDraft(deps, actorOf(req), parseInput(idParam, req.params.id), input);
    res.status(result.duplicate ? 200 : 201).json(result);
  });

  r.post('/prospects/:id/replies', requirePermission('prospect.write'), async (req, res) => {
    const input = parseInput(replySchema, req.body);
    res
      .status(201)
      .json(await registerReply(db, actorOf(req), parseInput(idParam, req.params.id), input));
  });

  r.post('/outreach/suppressions', send, async (req, res) => {
    const { email } = parseInput(suppressSchema, req.body);
    await addSuppression(db, email, 'MANUAL');
    await audit(db, {
      actorId: req.user!.id,
      action: 'outreach.suppress',
      entityType: 'EmailSuppression',
      ip: req.ip,
    });
    res.status(201).json({ ok: true });
  });

  r.get('/admin/outreach', requirePermission('settings.manage'), async (_req, res) => {
    // "Vastgelopen" QUEUED: Postmark bevestigde de mail, maar het bijwerken van draft/prospect/taak
    // mislukte na drie pogingen (zie sendDraft). Zeldzaam maar niet zelfherstellend; hier zichtbaar
    // gemaakt zodat een beheerder het handmatig kan afronden (prospectstatus, opvolgtaak).
    const stuckQueued = await db.emailMessage.count({
      where: { status: 'QUEUED', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    });
    const settings = await getOutreachSettings(db);
    res.json({
      configured: mailConfigured(env),
      settings,
      footerIsDefault: settings.footer === DEFAULT_FOOTER,
      fromEmail: env.POSTMARK_FROM_EMAIL ?? null,
      stuckQueued,
    });
  });

  r.post('/admin/outreach', requirePermission('settings.manage'), async (req, res) => {
    const s = parseInput(outreachSettingsSchema, req.body);
    await saveOutreachSettings(db, s, req.user!.id);
    await audit(db, {
      actorId: req.user!.id,
      action: 'settings.outreach',
      entityType: 'AppSetting',
      ip: req.ip,
      metadata: { dailyLimit: s.dailyLimit, trackOpens: s.trackOpens },
    });
    res.json(s);
  });

  return r;
}

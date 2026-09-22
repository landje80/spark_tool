import type { Job, PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { AnthropicLeadClient } from '../../integrations/anthropic/lead-client.js';
import type { LeadResearchClient } from '../../integrations/anthropic/types.js';
import type { StoragePort } from '../../integrations/storage/types.js';
import { logger } from '../../shared/logging/logger.js';
import { runLeadGeneration, type LeadGenConfig } from '../lead-generation/service.js';
import { runTechnicalCheck } from '../media-processing/pipeline.js';

export interface JobContext {
  db: PrismaClient;
  env: Env;
  now: () => Date;
  /** Vereist zodra een 'media-technical-check'-job kan lopen; optioneel voor tests die dat pad niet raken. */
  storage?: StoragePort;
  /** Vervangbaar in tests; standaard de echte Anthropic-client. */
  clientFactory?: () => LeadResearchClient;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;

export const isLeadGenConfigured = (env: Env): boolean =>
  !!env.ANTHROPIC_API_KEY && !!env.ANTHROPIC_MODEL_LEAD_RESEARCH;

export function leadGenConfig(env: Env): LeadGenConfig {
  return {
    model: env.ANTHROPIC_MODEL_LEAD_RESEARCH ?? '',
    dailyTarget: env.LEAD_GENERATION_DAILY_TARGET,
    maxDailyCost: env.ANTHROPIC_MAX_DAILY_COST,
    maxSearches: env.ANTHROPIC_WEB_SEARCH_MAX_USES,
    timezone: env.LEAD_GENERATION_TIMEZONE,
  };
}

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
/** Langer dan dit in PROCESSING (bv. een gecrasht proces tussen claim en afronding) telt als vastgelopen. */
const STALE_PROCESSING_MS = 30 * 60 * 1000;

export const HANDLERS: Record<string, JobHandler> = {
  'lead-generation': async (job, ctx) => {
    const payload = (job.payload ?? {}) as { trigger?: 'daily' | 'manual'; actorId?: string };
    if (!isLeadGenConfigured(ctx.env)) {
      // Niet stil slagen: een niet-uitgevoerde dagelijkse run moet zichtbaar mislukken (retry/dead-letter).
      throw new Error(
        'Leadgeneratie is niet geconfigureerd (ANTHROPIC_API_KEY of ANTHROPIC_MODEL_LEAD_RESEARCH ontbreekt)',
      );
    }
    if (ctx.env.NODE_ENV === 'test' && !ctx.clientFactory) {
      throw new Error('Testomgeving: de echte Anthropic-client is niet toegestaan');
    }
    const client = ctx.clientFactory?.() ?? new AnthropicLeadClient(ctx.env.ANTHROPIC_API_KEY!);
    const outcome = await runLeadGeneration(
      { db: ctx.db, client, config: leadGenConfig(ctx.env), now: ctx.now },
      { trigger: payload.trigger ?? 'daily', actorId: payload.actorId ?? null },
    );
    logger.info({ jobId: job.id, outcome }, 'Leadgeneratie afgerond');
  },

  'media-technical-check': async (job, ctx) => {
    const payload = (job.payload ?? {}) as { submissionId?: string };
    if (!payload.submissionId) throw new Error('media-technical-check: submissionId ontbreekt');
    if (!ctx.storage) throw new Error('media-technical-check: opslag niet geconfigureerd');
    await runTechnicalCheck(
      { db: ctx.db, storage: ctx.storage, env: ctx.env },
      payload.submissionId,
    );
  },

  maintenance: async (_job, ctx) => {
    const now = ctx.now();
    const sessions = await ctx.db.session.deleteMany({ where: { expiresAt: { lt: now } } });
    const jobs = await ctx.db.job.deleteMany({
      where: { status: 'SUCCEEDED', finishedAt: { lt: new Date(now.getTime() - THIRTY_DAYS_MS) } },
    });
    // Vastgelopen conceptgeneratie herstellen: een gecrasht proces tussen de PROCESSING-claim en de
    // afronding zou een submission anders voor altijd laten hangen (er is geen jobrij voor deze stap,
    // zie publishing/service.ts). updatedAt is de enige beschikbare "sinds wanneer"-indicator.
    const stuck = await ctx.db.contentSubmission.updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) },
      },
      data: { status: 'FAILED', failureReason: 'Vastgelopen: conceptgeneratie is niet afgerond' },
    });
    logger.info(
      { sessions: sessions.count, jobs: jobs.count, stuckSubmissions: stuck.count },
      'Onderhoud uitgevoerd',
    );
  },
};

import type { Job, PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { AnthropicLeadClient } from '../../integrations/anthropic/lead-client.js';
import type { LeadResearchClient } from '../../integrations/anthropic/types.js';
import { logger } from '../../shared/logging/logger.js';
import { runLeadGeneration, type LeadGenConfig } from '../lead-generation/service.js';

export interface JobContext {
  db: PrismaClient;
  env: Env;
  now: () => Date;
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

  maintenance: async (_job, ctx) => {
    const now = ctx.now();
    const sessions = await ctx.db.session.deleteMany({ where: { expiresAt: { lt: now } } });
    const jobs = await ctx.db.job.deleteMany({
      where: { status: 'SUCCEEDED', finishedAt: { lt: new Date(now.getTime() - THIRTY_DAYS_MS) } },
    });
    logger.info({ sessions: sessions.count, jobs: jobs.count }, 'Onderhoud uitgevoerd');
  },
};

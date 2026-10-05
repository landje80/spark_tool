import { safeError } from '../../shared/errors/safe-error.js';
import { logger } from '../../shared/logging/logger.js';
import { SETTING_LEADGEN_ENABLED, getSetting } from '../../shared/settings.js';
import { HANDLERS, isLeadGenConfigured, type JobContext } from './handlers.js';
import { claimNext, completeJob, enqueue, failJob } from './queue.js';

export interface ProcessSummary {
  processed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

/** Verwerkt uitvoerbare jobs tot de wachtrij leeg is, het maximum is bereikt of de deadline verstrijkt. */
export async function processJobs(
  ctx: JobContext,
  opts: { workerId: string; maxJobs?: number; deadlineMs?: number },
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { processed: 0, succeeded: 0, retried: 0, dead: 0 };
  const deadline = ctx.now().getTime() + (opts.deadlineMs ?? 25 * 60 * 1000);
  const max = opts.maxJobs ?? 20;

  while (summary.processed < max && ctx.now().getTime() < deadline) {
    const job = await claimNext(ctx.db, opts.workerId, ctx.now());
    if (!job) break;
    summary.processed++;
    const handler = HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`Onbekend jobtype: ${job.type}`);
      await handler(job, ctx);
      await completeJob(ctx.db, job.id);
      summary.succeeded++;
    } catch (err) {
      const outcome = await failJob(ctx.db, job, safeError(err), ctx.now());
      if (outcome === 'dead') summary.dead++;
      else summary.retried++;
      logger.error(
        { jobId: job.id, type: job.type, attempts: job.attempts, outcome },
        'Job mislukt',
      );
    }
  }
  return summary;
}

/** Eén volledige ronde: dagelijkse jobs inplannen en de wachtrij verwerken (CLI én HTTP-trigger). */
export async function runJobsOnce(
  ctx: JobContext,
  workerId: string,
): Promise<{
  scheduled: { leadGeneration: boolean; maintenance: boolean };
  summary: ProcessSummary;
}> {
  const scheduled = await scheduleDailyJobs(ctx);
  const summary = await processJobs(ctx, { workerId });
  return { scheduled, summary };
}

const SCHEDULE_HOUR = 6;
const SCHEDULE_MINUTE = 30;

function localParts(d: Date, tz: string): { ymd: string; minutes: number } {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .split(':')
    .map(Number) as [number, number];
  return { ymd, minutes: h * 60 + m };
}

/**
 * Plant de dagelijkse jobs in (idempotent via dedupeKey). Bedoeld om elke ~10 minuten aan te roepen door de
 * Plesk Scheduled Task: pas na 06:30 lokale tijd wordt de dagelijkse leadrun ingepland, en alleen als de
 * functie is ingeschakeld en geconfigureerd.
 */
export async function scheduleDailyJobs(
  ctx: JobContext,
): Promise<{ leadGeneration: boolean; maintenance: boolean }> {
  const { ymd, minutes } = localParts(ctx.now(), ctx.env.LEAD_GENERATION_TIMEZONE);
  const result = { leadGeneration: false, maintenance: false };
  result.maintenance = (
    await enqueue(ctx.db, { type: 'maintenance', dedupeKey: `daily-${ymd}` })
  ).created;

  if (minutes >= SCHEDULE_HOUR * 60 + SCHEDULE_MINUTE) {
    const enabled = await getSetting<boolean>(ctx.db, SETTING_LEADGEN_ENABLED, false);
    if (enabled && isLeadGenConfigured(ctx.env)) {
      result.leadGeneration = (
        await enqueue(ctx.db, {
          type: 'lead-generation',
          dedupeKey: `daily-${ymd}`,
          payload: { trigger: 'daily' },
          maxAttempts: 3,
        })
      ).created;
    }
  }
  return result;
}

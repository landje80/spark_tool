import 'dotenv/config';
import { hostname } from 'node:os';
import { getEnv } from '../config/env.js';
import { createStorage } from '../integrations/storage/index.js';
import { processJobs, scheduleDailyJobs } from '../modules/jobs/runner.js';
import { getDb } from '../shared/database/client.js';
import { installBigIntJsonSafety } from '../shared/json-safety.js';
import { logger } from '../shared/logging/logger.js';

installBigIntJsonSafety();

/**
 * Entrypoint voor de Plesk Scheduled Task (bijv. elke 10 minuten):
 *   node dist/server/src/server/run-jobs.js
 * Plant de dagelijkse jobs in en verwerkt de wachtrij. Kritieke planning staat bewust niet in het webproces.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const db = getDb();
  const ctx = { db, env, now: () => new Date(), storage: createStorage(env) };
  const scheduled = await scheduleDailyJobs(ctx);
  const summary = await processJobs(ctx, { workerId: `${hostname()}:${process.pid}` });
  logger.info({ scheduled, summary }, 'Jobrunner klaar');
  await db.$disconnect();
  if (summary.dead > 0) process.exitCode = 2; // zichtbaar in Plesk-taaklog: er zijn jobs definitief mislukt
}

main().catch((err) => {
  logger.error(
    { err: err instanceof Error ? { name: err.name, message: err.message } : 'unknown' },
    'Jobrunner crashte',
  );
  process.exit(1);
});

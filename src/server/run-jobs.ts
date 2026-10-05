import 'dotenv/config';
import { hostname } from 'node:os';
import { getEnv } from '../config/env.js';
import { createStorage } from '../integrations/storage/index.js';
import { runJobsOnce } from '../modules/jobs/runner.js';
import { getDb } from '../shared/database/client.js';
import { installBigIntJsonSafety } from '../shared/json-safety.js';
import { logger } from '../shared/logging/logger.js';

installBigIntJsonSafety();

/**
 * CLI-entrypoint voor het jobrunner (bijv. via een Scheduled Task op een server waar cron wél bij Node kan):
 *   node dist/server/src/server/run-jobs.js
 * Plant de dagelijkse jobs in en verwerkt de wachtrij. Op s1.gblict.nl draait cron in een afgeschermde
 * shell zonder toegang tot Plesk's Node; daar roept een "URL ophalen"-taak in plaats daarvan
 * /internal/run-jobs aan (src/modules/jobs/trigger-routes.ts), dat dezelfde ronde uitvoert.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const db = getDb();
  const ctx = { db, env, now: () => new Date(), storage: createStorage(env) };
  const { scheduled, summary } = await runJobsOnce(ctx, `${hostname()}:${process.pid}`);
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

import 'dotenv/config';
import { getEnv } from '../config/env.js';
import { getDb } from '../shared/database/client.js';
import { logger } from '../shared/logging/logger.js';
import { createApp } from './app.js';

// Passenger (Plesk) geeft de poort door via PORT; lokaal komt die uit .env.
const env = getEnv();
const app = createApp(env);
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, basePath: env.APP_BASE_PATH }, 'Spark Tool gestart');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Afsluiten');
  server.close(async () => {
    await getDb().$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

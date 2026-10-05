import { hostname } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { Env } from '../../config/env.js';
import type { StoragePort } from '../../integrations/storage/types.js';
import { safeError } from '../../shared/errors/safe-error.js';
import { logger } from '../../shared/logging/logger.js';
import { safeEqualString } from '../../shared/security/tokens.js';
import { runJobsOnce } from './runner.js';

/** Basic Auth: gebruikersnaam "cron", wachtwoord = LEAD_GENERATION_CRON_SECRET (constant-time). */
function basicAuthOk(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const userOk = safeEqualString(decoded.slice(0, i), 'cron');
  const passOk = safeEqualString(decoded.slice(i + 1), secret);
  return userOk && passOk;
}

/**
 * HTTP-trigger voor het jobrunner, bedoeld voor een Plesk Scheduled Task van het type "URL ophalen".
 *
 * Waarom: op s1.gblict.nl draaien cron-taken in een afgeschermde (chroot-)shell zonder toegang tot
 * Plesk's Node (/opt/plesk/node bestaat daar niet), dus `node run-jobs.js` is vanuit cron onbereikbaar.
 * Een HTTP-verzoek werkt op elke Plesk-installatie, ongeacht shell- of chroot-instellingen.
 *
 * Het verzoek wordt direct beantwoord (202); de ronde draait op de achtergrond in dit proces. Per
 * proces loopt maximaal één ronde tegelijk; over processen heen beschermen de atomaire claim in de
 * wachtrij en de dedupeKey's tegen dubbele verwerking. Niet ingesteld LEAD_GENERATION_CRON_SECRET: 503.
 */
export function jobTriggerRouter(opts: {
  env: Env;
  db: PrismaClient;
  storage: StoragePort;
}): Router {
  const { env, db, storage } = opts;
  const r = Router();
  let running = false;

  const handler: RequestHandler = (req, res) => {
    if (!env.LEAD_GENERATION_CRON_SECRET) return void res.status(503).json({ ok: false });
    if (!basicAuthOk(req.get('authorization'), env.LEAD_GENERATION_CRON_SECRET)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="cron"');
      return void res.status(401).json({ ok: false });
    }
    if (running) return void res.status(202).json({ ok: true, status: 'busy' });

    running = true;
    const ctx = { db, env, now: () => new Date(), storage };
    runJobsOnce(ctx, `${hostname()}:${process.pid}:http`)
      .then(({ scheduled, summary }) => logger.info({ scheduled, summary }, 'Jobrunner klaar'))
      .catch((err: unknown) => logger.error({ err: safeError(err) }, 'Jobrunner crashte'))
      .finally(() => {
        running = false;
      });
    res.status(202).json({ ok: true, status: 'started' });
  };

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'test' ? 100_000 : 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  // Plesk's "URL ophalen" doet een GET; POST blijft ondersteund voor andere aanroepers.
  r.get('/internal/run-jobs', limiter, handler);
  r.post('/internal/run-jobs', limiter, handler);
  return r;
}

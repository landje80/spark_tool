import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router, type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import type { Env } from '../config/env.js';
import { EntraClient } from '../integrations/microsoft/entra.js';
import { authRouter } from '../modules/auth/routes.js';
import { AnthropicStructuredClient } from '../integrations/anthropic/structured-client.js';
import { PostmarkMailClient } from '../integrations/postmark/client.js';
import { MailError, type MailPort } from '../integrations/postmark/types.js';
import { createStorage } from '../integrations/storage/index.js';
import type { StoragePort } from '../integrations/storage/types.js';
import { customersRouter } from '../modules/customers/routes.js';
import { publicContentIntakeRouter } from '../modules/content-intake/public-routes.js';
import { contentIntakeRouter } from '../modules/content-intake/routes.js';
import { leadRouter } from '../modules/lead-generation/routes.js';
import { publicOutreachRouter } from '../modules/outreach/public-routes.js';
import { outreachRouter } from '../modules/outreach/routes.js';
import {
  AiDraftWriter,
  TemplateDraftWriter,
  type DraftWriter,
} from '../modules/outreach/writer.js';
import { publishingRouter } from '../modules/publishing/routes.js';
import {
  AiConceptWriter,
  TemplateConceptWriter,
  type ConceptWriter,
} from '../modules/publishing/writer.js';
import { crmRouter } from '../modules/prospects/routes.js';
import {
  csrfProtection,
  loadUser,
  requireAuth,
  requirePermission,
} from '../modules/auth/middleware.js';
import { PrismaSessionStore } from '../modules/auth/session-store.js';
import { getDb } from '../shared/database/client.js';
import { AppError } from '../shared/errors/app-error.js';
import { publicPageAssetsRouter } from '../shared/http/public-page.js';
import { t } from '../shared/i18n/index.js';
import { installBigIntJsonSafety } from '../shared/json-safety.js';
import { logger } from '../shared/logging/logger.js';
import { PERMISSIONS, roleHas } from '../shared/security/permissions.js';

installBigIntJsonSafety();

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/src/server/app.js -> dist/web ; src/server/app.ts (tsx) -> dist/web
const WEB_DIR =
  process.env.WEB_DIST_DIR ??
  path.resolve(
    here,
    here.includes(`${path.sep}dist${path.sep}`) ? '../../../web' : '../../dist/web',
  );

/** Vervangbare afhankelijkheden (tests injecteren mocks; er wordt in tests nooit echt gemaild/aangeroepen). */
export interface AppDeps {
  mail?: MailPort;
  draftWriter?: DraftWriter;
  conceptWriter?: ConceptWriter;
  storage?: StoragePort;
  entra?: EntraClient;
}

function defaultMail(env: Env): MailPort {
  if (env.NODE_ENV !== 'test' && env.POSTMARK_SERVER_TOKEN)
    return new PostmarkMailClient(env.POSTMARK_SERVER_TOKEN);
  const reason =
    env.NODE_ENV === 'test'
      ? 'Testomgeving: echte verzending is niet toegestaan'
      : 'E-mail is niet geconfigureerd';
  return {
    send: () => Promise.reject(new MailError(reason, 'auth')),
  };
}

function defaultWriter(env: Env): DraftWriter {
  if (env.NODE_ENV !== 'test' && env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL_CONTENT) {
    return new AiDraftWriter(
      new AnthropicStructuredClient(env.ANTHROPIC_API_KEY),
      env.ANTHROPIC_MODEL_CONTENT,
    );
  }
  return new TemplateDraftWriter();
}

function defaultConceptWriter(env: Env): ConceptWriter {
  if (env.NODE_ENV !== 'test' && env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL_CONTENT) {
    return new AiConceptWriter(
      new AnthropicStructuredClient(env.ANTHROPIC_API_KEY),
      env.ANTHROPIC_MODEL_CONTENT,
    );
  }
  return new TemplateConceptWriter();
}

export function createApp(env: Env, deps: AppDeps = {}): express.Express {
  const app = express();
  const basePath = env.APP_BASE_PATH;
  const origin = new URL(env.APP_BASE_URL).origin;
  const isProd = env.NODE_ENV === 'production';
  const db = getDb();
  const storage = deps.storage ?? createStorage(env);

  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1); // Apache/Passenger vóór Node

  app.use((req, res, next) => {
    req.id = req.get('x-request-id')?.slice(0, 64) || randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", 'https://login.microsoftonline.com'],
          frameAncestors: ["'none'"],
          ...(isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: isProd ? { maxAge: 31536000, includeSubDomains: false } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use((req, _res, next) => {
    logger.debug({ reqId: req.id, method: req.method, path: req.path }, 'request');
    next();
  });

  const router = Router();

  // Gezondheid: bewust zonder details (diepere diagnose staat achter autorisatie op
  // /api/admin/health), maar wél een echte databasecheck — dit is het enige endpoint dat
  // `npm run healthcheck` en Plesk/monitoring na een deploy daadwerkelijk aanroepen, dus een
  // kapotte DATABASE_URL moet hier zichtbaar worden, niet pas bij de eerste ingelogde gebruiker.
  const healthLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'test' ? 100_000 : 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  router.get('/health', healthLimiter, async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  // Publiek en zonder sessie: Postmark-webhook (Basic Auth), afmeldpagina en mobiele uploadlink.
  router.use(publicPageAssetsRouter());
  router.use(publicOutreachRouter(env, db));
  router.use(publicContentIntakeRouter({ env, db, storage }));

  router.use(
    session({
      name: env.SESSION_COOKIE_NAME,
      secret: env.SESSION_SECRET,
      store: new PrismaSessionStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax', // 'lax' is nodig voor de terugkeer vanaf Microsoft (top-level GET)
        path: basePath || '/',
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  router.use(loadUser);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  router.use('/auth', authLimiter, authRouter(env, deps.entra));

  const api = Router();
  api.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  // Strengere limiet voor schrijfacties (aanmaken/wijzigen); in tests niet beperkend.
  api.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: env.NODE_ENV === 'test' ? 100_000 : 120,
      skip: (req) => req.method === 'GET',
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  api.use(express.json({ limit: '256kb' }));
  api.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ code: 'UNAUTHENTICATED' });
    res.json({
      user: req.user,
      csrfToken: req.session.csrfToken,
      permissions: PERMISSIONS.filter((p) => roleHas(req.user!.role, p)),
    });
  });
  api.use(requireAuth, csrfProtection(origin));
  api.get('/admin/health', requirePermission('settings.manage'), async (_req, res) => {
    const started = Date.now();
    await db.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: { ok: true, ms: Date.now() - started },
      time: new Date().toISOString(),
    });
  });
  api.use(crmRouter(env, db));
  api.use(leadRouter(env, db));
  api.use(
    outreachRouter({
      db,
      env,
      mail: deps.mail ?? defaultMail(env),
      writer: deps.draftWriter ?? defaultWriter(env),
    }),
  );
  api.use(customersRouter(db));
  api.use(contentIntakeRouter(env, db, storage));
  api.use(publishingRouter({ db, env, writer: deps.conceptWriter ?? defaultConceptWriter(env) }));
  api.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Onbekend endpoint')));
  router.use('/api', api);

  // Statische frontend; assets zijn gehasht en mogen lang worden gecachet.
  router.use(
    express.static(WEB_DIR, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, p) => {
        if (p.includes(`${path.sep}assets${path.sep}`))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  router.get(/^\/(?!api\/|auth\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(WEB_DIR, 'index.html'), (err) => {
      if (err) res.status(503).type('text').send('Frontend niet gebouwd (npm run build).');
    });
  });

  // Passenger (sub-URI) kan het prefix wel of niet afstrippen: normaliseer zodat beide werken.
  if (basePath) {
    app.use((req, _res, next) => {
      const u = req.url;
      const hasPrefix =
        u === basePath || u.startsWith(`${basePath}/`) || u.startsWith(`${basePath}?`);
      if (!hasPrefix) req.url = `${basePath}${u}`;
      next();
    });
  }
  app.use(basePath || '/', router);

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const messages = t().errors;
    if (err instanceof AppError) {
      // details (veldfouten, duplicaatmatches) zijn door onze eigen code opgebouwd en bevatten geen invoerwaarden.
      const details =
        err.code === 'VALIDATION_ERROR' || err.code === 'CONFLICT' ? err.details : undefined;
      return void res
        .status(err.status)
        .json({ code: err.code, message: messages[err.code], details, requestId: req.id });
    }
    const known = err as { code?: string; type?: string };
    if (known.code === 'P2002') {
      return void res
        .status(409)
        .json({ code: 'CONFLICT', message: messages.CONFLICT, requestId: req.id });
    }
    if (known.type === 'entity.parse.failed' || known.type === 'entity.too.large') {
      return void res
        .status(known.type === 'entity.too.large' ? 413 : 400)
        .json({ code: 'VALIDATION_ERROR', message: messages.VALIDATION_ERROR, requestId: req.id });
    }
    logger.error(
      {
        reqId: req.id,
        // Geen err.message: Prisma-fouten bevatten queryargumenten (bedrijfs- en persoonsgegevens).
        err:
          err instanceof Error
            ? {
                name: err.name,
                code: known.code,
                message: err.name.startsWith('Prisma') ? undefined : err.message,
              }
            : 'unknown',
      },
      'Onverwachte fout',
    );
    res.status(500).json({ code: 'INTERNAL', message: messages.INTERNAL, requestId: req.id });
  };
  app.use(errorHandler);

  return app;
}

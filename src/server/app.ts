import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router, type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import type { Env } from '../config/env.js';
import { authRouter } from '../modules/auth/routes.js';
import {
  csrfProtection,
  loadUser,
  requireAuth,
  requirePermission,
} from '../modules/auth/middleware.js';
import { PrismaSessionStore } from '../modules/auth/session-store.js';
import { getDb } from '../shared/database/client.js';
import { AppError } from '../shared/errors/app-error.js';
import { t } from '../shared/i18n/index.js';
import { logger } from '../shared/logging/logger.js';
import { roleHas } from '../shared/security/permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server/server/app.js -> dist/web ; src/server/app.ts (tsx) -> dist/web
const WEB_DIR =
  process.env.WEB_DIST_DIR ??
  path.resolve(
    here,
    here.includes(`${path.sep}dist${path.sep}`) ? '../../../web' : '../../dist/web',
  );

export function createApp(env: Env): express.Express {
  const app = express();
  const basePath = env.APP_BASE_PATH;
  const origin = new URL(env.APP_BASE_URL).origin;
  const isProd = env.NODE_ENV === 'production';
  const db = getDb();

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

  // Gezondheid: bewust zonder details; diepe check staat achter autorisatie.
  router.get('/health', (_req, res) => res.json({ status: 'ok' }));

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
  router.use('/auth', authLimiter, authRouter(env));

  const api = Router();
  api.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
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
      permissions: (
        [
          'prospect.read',
          'prospect.write',
          'outreach.send',
          'customer.manage',
          'content.review',
          'settings.manage',
          'user.manage',
          'audit.read',
        ] as const
      ).filter((p) => roleHas(req.user!.role, p)),
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
  router.use('/api', api);

  // Statische frontend onder /tool/; assets zijn gehasht en mogen lang worden gecachet.
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
      return void res
        .status(err.status)
        .json({ code: err.code, message: messages[err.code], requestId: req.id });
    }
    logger.error(
      {
        reqId: req.id,
        err: err instanceof Error ? { name: err.name, message: err.message } : 'unknown',
      },
      'Onverwachte fout',
    );
    res.status(500).json({ code: 'INTERNAL', message: messages.INTERNAL, requestId: req.id });
  };
  app.use(errorHandler);

  return app;
}

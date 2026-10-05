import { Router, type Request } from 'express';
import type { Env } from '../../config/env.js';
import { EntraClient } from '../../integrations/microsoft/entra.js';
import { getDb } from '../../shared/database/client.js';
import { withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { logger } from '../../shared/logging/logger.js';
import { generateToken, safeEqualString } from '../../shared/security/tokens.js';
import { audit } from '../audit/audit.js';
import { evaluateAccess } from './access.js';
import { csrfProtection } from './middleware.js';

/** Alleen paden binnen de app als returnTo toestaan (open-redirect voorkomen). */
export function safeReturnTo(value: unknown, basePath: string): string {
  const fallback = `${basePath}/dashboard`;
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith(`${basePath}/`) || value.startsWith('//') || value.includes('\\'))
    return fallback;
  return value;
}

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
}
function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
}

export function authRouter(env: Env, entra: EntraClient = new EntraClient(env)): Router {
  const router = Router();
  const basePath = env.APP_BASE_PATH;
  const loginError = (code: string) => `${basePath}/login?error=${encodeURIComponent(code)}`;

  router.get('/login', async (req, res) => {
    const flow = await entra.start();
    req.session.oidc = {
      state: flow.state,
      nonce: flow.nonce,
      codeVerifier: flow.codeVerifier,
      returnTo: safeReturnTo(req.query.returnTo, basePath),
    };
    await save(req);
    res.redirect(flow.url);
  });

  router.get('/callback', async (req, res) => {
    const pending = req.session.oidc;
    req.session.oidc = undefined; // eenmalig gebruik van state/nonce/verifier
    const { code, state, error } = req.query;
    if (error || typeof code !== 'string' || typeof state !== 'string' || !pending) {
      return res.redirect(loginError('login_failed'));
    }
    if (!safeEqualString(state, pending.state)) return res.redirect(loginError('state'));

    let claims;
    try {
      claims = await entra.complete(code, pending.codeVerifier, pending.nonce);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : 'unknown', reqId: req.id },
        'Entra token exchange mislukt',
      );
      return res.redirect(loginError('login_failed'));
    }

    const decision = evaluateAccess(
      claims,
      {
        tenantId: env.ENTRA_TENANT_ID,
        clientId: env.ENTRA_CLIENT_ID,
        allowedGroupIds: env.ENTRA_ALLOWED_GROUP_IDS,
        allowedUserIds: env.ENTRA_ALLOWED_USER_IDS,
      },
      pending.nonce,
    );
    const db = getDb();
    if (!decision.allowed) {
      await audit(db, {
        action: 'auth.denied',
        entityType: 'User',
        ip: req.ip,
        metadata: { reason: decision.reason },
      });
      return res.redirect(loginError('denied'));
    }

    // Eerste toegestane gebruiker wordt ADMIN zolang er nog geen admin bestaat (bootstrap);
    // onder een lock zodat twee gelijktijdige eerste logins niet allebei admin worden.
    let user;
    try {
      user = await db.$transaction(
        (tx) =>
          withNamedLock(tx, 'spark:user-provision', async () => {
            const hasAdmin = (await tx.user.count({ where: { role: 'ADMIN', active: true } })) > 0;
            return tx.user.upsert({
              where: { entraOid: decision.oid },
              create: {
                entraOid: decision.oid,
                tenantId: env.ENTRA_TENANT_ID,
                name: decision.name,
                email: decision.email,
                role: hasAdmin ? 'VIEWER' : 'ADMIN',
                lastLoginAt: new Date(),
              },
              update: { name: decision.name, email: decision.email, lastLoginAt: new Date() },
            });
          }),
        { timeout: 30_000 },
      );
    } catch (err) {
      // Bijvoorbeeld een e-mailadres dat al bij een andere identiteit hoort (unieke constraint).
      logger.warn(
        { code: (err as { code?: string }).code, reqId: req.id },
        'Gebruiker aanmaken/bijwerken mislukt',
      );
      return res.redirect(loginError('login_failed'));
    }
    if (!user.active) {
      await audit(db, {
        actorId: user.id,
        action: 'auth.denied',
        entityType: 'User',
        entityId: user.id,
        ip: req.ip,
        metadata: { reason: 'inactive' },
      });
      return res.redirect(loginError('denied'));
    }

    await regenerate(req); // sessierotatie na login
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.csrfToken = generateToken(24);
    req.session.createdAt = Date.now(); // absolute levensduur (zie loadUser)
    await save(req);
    await audit(db, {
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ip: req.ip,
    });
    res.redirect(safeReturnTo(pending.returnTo, basePath));
  });

  router.post('/logout', csrfProtection(new URL(env.APP_BASE_URL).origin), async (req, res) => {
    const actorId = req.session.userId;
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie(env.SESSION_COOKIE_NAME, { path: basePath || '/' });
    if (actorId)
      await audit(getDb(), {
        actorId,
        action: 'auth.logout',
        entityType: 'User',
        entityId: actorId,
        ip: req.ip,
      });
    res.json({ redirect: entra.logoutUrl() });
  });

  // Uitgeschakeld zolang er geen geldige sessie is; voorkomt onduidelijke 404's bij verkeerde methode.
  router.all('/logout', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Gebruik POST')));

  return router;
}

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getDb } from '../../shared/database/client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { roleHas, type Permission } from '../../shared/security/permissions.js';
import { safeEqualString } from '../../shared/security/tokens.js';

/** Laadt de ingelogde gebruiker uit de sessie en controleert dat die nog actief is. */
export const loadUser: RequestHandler = async (req, _res, next) => {
  try {
    const userId = req.session?.userId;
    if (userId) {
      const user = await getDb().user.findUnique({ where: { id: userId } });
      if (user?.active) {
        req.user = { id: user.id, role: user.role, name: user.name, email: user.email };
      } else {
        req.session.userId = undefined;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Niet ingelogd'));
  next();
}

/** Autorisatie op elk serverendpoint; frontendverberging is nooit voldoende. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError('UNAUTHENTICATED', 'Niet ingelogd'));
    if (!roleHas(req.user.role, permission)) {
      return next(new AppError('FORBIDDEN', `Recht ontbreekt: ${permission}`));
    }
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF: synchronizer-token in de sessie, meegestuurd als x-csrf-token, plus Origin-controle. */
export function csrfProtection(allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== allowedOrigin)
      return next(new AppError('FORBIDDEN', 'Origin niet toegestaan'));
    const expected = req.session?.csrfToken;
    const given = req.get('x-csrf-token');
    if (!expected || !given || !safeEqualString(expected, given)) {
      return next(new AppError('FORBIDDEN', 'CSRF-token ongeldig'));
    }
    next();
  };
}

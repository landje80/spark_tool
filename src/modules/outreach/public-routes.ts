import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { safeError } from '../../shared/errors/safe-error.js';
import { escapeHtml, publicPage } from '../../shared/http/public-page.js';
import { logger } from '../../shared/logging/logger.js';
import { safeEqualString } from '../../shared/security/tokens.js';
import { audit } from '../audit/audit.js';
import { canTransition } from '../prospects/status.js';
import { addSuppression } from './suppression.js';
import { verifyUnsubscribeToken } from './tokens.js';
import { processPostmarkEvent } from './webhooks.js';

/** Basic Auth-controle van Postmark-webhooks (Postmark ondersteunt geen HMAC-handtekeningen). */
function basicAuthOk(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  // Beide delen constant-time vergelijken.
  const userOk = safeEqualString(decoded.slice(0, i), 'postmark');
  const passOk = safeEqualString(decoded.slice(i + 1), secret);
  return userOk && passOk;
}

const mask = (email: string): string => {
  const [l = '', d = ''] = email.split('@');
  return `${l.slice(0, 1)}***@${d}`;
};

/**
 * Publieke routes zonder sessie: Postmark-webhook (Basic Auth) en de afmeldpagina (token in de URL).
 * Bewust apart gemonteerd vóór de sessie- en CSRF-middleware.
 */
export function publicOutreachRouter(env: Env, db: PrismaClient): Router {
  const r = Router();
  const testEnv = env.NODE_ENV === 'test';
  const page = (title: string, body: string) => publicPage(env.APP_BASE_PATH, title, body);

  r.post(
    '/webhooks/postmark',
    rateLimit({
      windowMs: 60_000,
      limit: testEnv ? 100_000 : 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    (req, res, next) => {
      if (!env.POSTMARK_WEBHOOK_SECRET) return void res.status(503).json({ ok: false });
      if (!basicAuthOk(req.get('authorization'), env.POSTMARK_WEBHOOK_SECRET)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="webhook"');
        return void res.status(401).json({ ok: false });
      }
      next();
    },
    express.json({ limit: '10mb' }),
    async (req, res) => {
      try {
        const outcome = await processPostmarkEvent(db, req.body);
        res.status(200).json({ ok: true, outcome });
      } catch (err) {
        // 5xx: Postmark probeert het later opnieuw (escalerend schema).
        logger.error({ err: safeError(err) }, 'Webhookverwerking mislukt');
        res.status(500).json({ ok: false });
      }
    },
  );

  const unsubLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: testEnv ? 100_000 : 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const notFound = (res: express.Response) =>
    void res
      .status(404)
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(page('Link ongeldig', '<p>Deze afmeldlink is niet (meer) geldig.</p>'));

  r.get('/unsubscribe/:token', unsubLimiter, async (req, res) => {
    const id = verifyUnsubscribeToken(env.SESSION_SECRET, String(req.params.token));
    const msg = id
      ? await db.emailMessage.findUnique({ where: { id }, select: { toEmail: true } })
      : null;
    if (!msg) return notFound(res);
    res
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(
        page(
          'Afmelden voor e-mail',
          `<p>Wilt u geen e-mail meer ontvangen op <strong>${escapeHtml(mask(msg.toEmail))}</strong>?</p><form method="post" action=""><button type="submit">Ja, meld mij af</button></form>`,
        ),
      );
  });

  // Ook geschikt voor "one-click" (List-Unsubscribe-Post): de POST doet de afmelding zonder verdere stappen.
  r.post(
    '/unsubscribe/:token',
    unsubLimiter,
    express.urlencoded({ extended: false, limit: '4kb' }),
    async (req, res) => {
      const id = verifyUnsubscribeToken(env.SESSION_SECRET, String(req.params.token));
      const msg = id
        ? await db.emailMessage.findUnique({
            where: { id },
            select: { toEmail: true, prospectId: true },
          })
        : null;
      if (!msg) return notFound(res);

      await addSuppression(db, msg.toEmail, 'OPT_OUT');
      if (msg.prospectId) {
        const p = await db.prospect.findUnique({
          where: { id: msg.prospectId },
          select: { status: true },
        });
        if (p && canTransition(p.status, 'NOT_INTERESTED')) {
          await db.prospect.update({
            where: { id: msg.prospectId },
            data: { status: 'NOT_INTERESTED', notInterestedReason: 'Afgemeld via afmeldlink' },
          });
          await db.prospectActivity.create({
            data: {
              prospectId: msg.prospectId,
              type: 'STATUS_CHANGED',
              oldValue: p.status,
              newValue: 'NOT_INTERESTED',
              description: 'Afgemeld via afmeldlink',
            },
          });
        }
        await audit(db, {
          action: 'outreach.unsubscribe',
          entityType: 'Prospect',
          entityId: msg.prospectId,
        });
      }
      res
        .set('Cache-Control', 'no-store')
        .type('html')
        .send(page('U bent afgemeld', '<p>U ontvangt geen e-mail meer van ons op dit adres.</p>'));
    },
  );

  return r;
}

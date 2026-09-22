import { createHmac } from 'node:crypto';
import { safeEqualString, sha256Hex } from '../../shared/security/tokens.js';

/** Afgeleide sleutel per doel, zodat een token voor het ene doel nooit voor een ander geldt. */
const sign = (secret: string, purpose: string, data: string): string => {
  const key = createHmac('sha256', secret).update(`spark:${purpose}`).digest();
  return createHmac('sha256', key).update(data).digest('base64url');
};

export interface ConfirmPayload {
  draftId: string;
  to: string;
  /** Hash van onderwerp + tekst: het bevestigde concept mag daarna niet meer wijzigen. */
  contentHash: string;
  exp: number;
}

export const contentHashOf = (subject: string, textBody: string): string =>
  sha256Hex(`${subject}\n${textBody}`);

/** Bevestigingstoken uit de preview-stap: bindt ontvanger en inhoud aan de definitieve verzendactie. */
export function signConfirm(secret: string, p: ConfirmPayload): string {
  const payload = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${payload}.${sign(secret, 'confirm', payload)}`;
}

export function verifyConfirm(
  secret: string,
  token: string,
  now = Date.now(),
): ConfirmPayload | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqualString(sig, sign(secret, 'confirm', payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConfirmPayload;
    return typeof p.exp === 'number' && p.exp > now ? p : null;
  } catch {
    return null;
  }
}

/** Afmeldtoken per verzonden e-mail; onraadbaar en niet vervalsbaar zonder de server-secret. */
export const unsubscribeToken = (secret: string, emailMessageId: string): string =>
  `${emailMessageId}.${sign(secret, 'unsubscribe', emailMessageId)}`;

export function verifyUnsubscribeToken(secret: string, token: string): string | null {
  const [id, sig] = token.split('.');
  if (!id || !sig || id.length > 40) return null;
  return safeEqualString(sig, sign(secret, 'unsubscribe', id)) ? id : null;
}

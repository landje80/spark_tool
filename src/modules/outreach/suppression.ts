import type { PrismaClient, SuppressionReason } from '@prisma/client';
import { sha256Hex } from '../../shared/security/tokens.js';

type Db = Pick<PrismaClient, 'emailSuppression'>;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
/** Alleen de hash wordt bewaard: de suppressie blijft werken ook nadat een prospect is verwijderd. */
export const emailHash = (email: string): string => sha256Hex(normalizeEmail(email));

export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const row = await db.emailSuppression.findUnique({
    where: { emailHash: emailHash(email) },
    select: { id: true },
  });
  return !!row;
}

/**
 * Idempotent: een bestaande suppressie blijft ongewijzigd (de eerste reden blijft behouden).
 *
 * Bewust `createMany` met `skipDuplicates` (één atomaire INSERT IGNORE) en geen `upsert`: Prisma's upsert
 * is hier een select-dan-insert, dus twee gelijktijdige schrijfacties voor hetzelfde adres (bv. de Bounce-
 * en Spam-testevents die Postmark bij het opslaan van een webhook tegelijk afvuurt) zagen allebei "geen
 * rij", waarna de verliezer een unique-fout kreeg en het hele webhookevent een 500 gaf.
 */
export async function addSuppression(
  db: Db,
  email: string,
  reason: SuppressionReason,
): Promise<void> {
  const n = normalizeEmail(email);
  await db.emailSuppression.createMany({
    data: [{ emailHash: emailHash(n), domain: n.split('@')[1] ?? null, reason }],
    skipDuplicates: true,
  });
}

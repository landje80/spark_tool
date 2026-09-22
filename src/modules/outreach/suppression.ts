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

/** Idempotent: een bestaande suppressie blijft ongewijzigd (de eerste reden blijft behouden). */
export async function addSuppression(
  db: Db,
  email: string,
  reason: SuppressionReason,
): Promise<void> {
  const n = normalizeEmail(email);
  await db.emailSuppression.upsert({
    where: { emailHash: emailHash(n) },
    create: { emailHash: emailHash(n), domain: n.split('@')[1] ?? null, reason },
    update: {},
  });
}

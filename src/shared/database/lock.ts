import type { Prisma } from '@prisma/client';
import { AppError } from '../errors/app-error.js';

/**
 * Serialiseert kritieke check-then-act stukken (bv. duplicaatcontrole + insert) over processen heen
 * met een MySQL/MariaDB named lock. Moet binnen een interactieve transactie draaien, zodat GET_LOCK en
 * RELEASE_LOCK op dezelfde databaseverbinding lopen.
 */
export async function withNamedLock<T>(
  tx: Prisma.TransactionClient,
  name: string,
  fn: () => Promise<T>,
  waitSeconds = 10,
): Promise<T> {
  const rows = await tx.$queryRaw<
    { l: number | bigint | null }[]
  >`SELECT GET_LOCK(${name}, ${waitSeconds}) AS l`;
  if (Number(rows[0]?.l) !== 1) {
    throw new AppError(
      'CONFLICT',
      'Systeem is bezig met een andere wijziging; probeer het zo opnieuw',
    );
  }
  try {
    return await fn();
  } finally {
    // Een mislukte release mag de oorspronkelijke fout of het resultaat niet overschrijven.
    await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`.catch(() => undefined);
  }
}

export const PROSPECT_WRITE_LOCK = 'spark:prospect-write';

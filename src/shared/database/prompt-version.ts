import type { Prisma } from '@prisma/client';
import { sha256Hex } from '../security/tokens.js';

/**
 * Legt de actuele prompttekst + schema vast als PromptVersion (traceerbaar per AI-aanroep). Een
 * wijziging in tekst of schema levert automatisch een nieuwe versie op; bestaande versies worden
 * nooit overschreven. Gedeeld door leadgeneratie en contentgeneratie (zelfde traceerbaarheidsbehoefte).
 */
export async function ensurePromptVersion(
  db: Pick<Prisma.TransactionClient, 'promptVersion'>,
  purpose: string,
  systemText: string,
  schemaJson: object,
): Promise<{ id: string; version: number }> {
  const sha256 = sha256Hex(systemText + JSON.stringify(schemaJson));

  const existing = await db.promptVersion.findFirst({ where: { purpose, sha256 } });
  if (existing) {
    if (!existing.active) {
      await db.promptVersion.updateMany({ where: { purpose }, data: { active: false } });
      await db.promptVersion.update({ where: { id: existing.id }, data: { active: true } });
    }
    return { id: existing.id, version: existing.version };
  }
  const last = await db.promptVersion.aggregate({ where: { purpose }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  await db.promptVersion.updateMany({ where: { purpose }, data: { active: false } });
  const created = await db.promptVersion.create({
    data: { purpose, version, systemText, schemaJson, sha256, active: true },
  });
  return { id: created.id, version };
}

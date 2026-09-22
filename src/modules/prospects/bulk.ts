import type { Prisma, PrismaClient } from '@prisma/client';
import { PROSPECT_WRITE_LOCK, withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { audit } from '../audit/audit.js';
import type { Actor } from './service.js';

export async function bulkAssignOwner(
  db: PrismaClient,
  actor: Actor,
  ids: string[],
  ownerId: string | null,
): Promise<number> {
  if (ownerId) {
    const u = await db.user.findUnique({
      where: { id: ownerId },
      select: { active: true, name: true },
    });
    if (!u?.active)
      throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
        { path: 'ownerId', message: 'Onbekende of inactieve gebruiker' },
      ]);
  }
  return db.$transaction(async (tx) => {
    const found = await tx.prospect.findMany({
      where: { id: { in: ids }, anonymizedAt: null },
      select: { id: true },
    });
    const foundIds = found.map((f) => f.id);
    await tx.prospect.updateMany({ where: { id: { in: foundIds } }, data: { ownerId } });
    await tx.prospectActivity.createMany({
      data: foundIds.map((prospectId) => ({
        prospectId,
        type: 'FIELD_CHANGED' as const,
        actorId: actor.id,
        description: 'Veld gewijzigd: ownerId (bulk)',
        newValue: ownerId,
      })),
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'prospect.bulk_assign',
      entityType: 'Prospect',
      ip: actor.ip,
      metadata: { count: foundIds.length, ownerId },
    });
    return foundIds.length;
  });
}

export async function bulkSetNextAction(
  db: PrismaClient,
  actor: Actor,
  ids: string[],
  nextActionAt: Date | null,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const found = await tx.prospect.findMany({
      where: { id: { in: ids }, anonymizedAt: null },
      select: { id: true },
    });
    const foundIds = found.map((f) => f.id);
    await tx.prospect.updateMany({ where: { id: { in: foundIds } }, data: { nextActionAt } });
    await tx.prospectActivity.createMany({
      data: foundIds.map((prospectId) => ({
        prospectId,
        type: 'FIELD_CHANGED' as const,
        actorId: actor.id,
        description: 'Veld gewijzigd: nextActionAt (bulk)',
        newValue: nextActionAt?.toISOString() ?? null,
      })),
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'prospect.bulk_next_action',
      entityType: 'Prospect',
      ip: actor.ip,
      metadata: { count: foundIds.length },
    });
    return foundIds.length;
  });
}

/**
 * Voegt `sourceId` samen in `targetId`. Alle gerelateerde gegevens verhuizen naar het doel;
 * de bron blijft als DUPLICATE (gearchiveerd) bestaan zodat suppressie en historie intact blijven.
 */
export async function mergeProspects(
  db: PrismaClient,
  actor: Actor,
  targetId: string,
  sourceId: string,
) {
  if (targetId === sourceId)
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: 'sourceId', message: 'Kan een prospect niet met zichzelf samenvoegen' },
    ]);
  return db.$transaction((tx) =>
    // Zelfde named lock als de andere identiteitsschrijvende paden (convertProspectToCustomer,
    // touchesIdentity-writes), naast de bestaande FOR UPDATE-rijvergrendeling hieronder.
    withNamedLock(tx, PROSPECT_WRITE_LOCK, () => mergeInTransaction(tx, actor, targetId, sourceId)),
  );
}

async function mergeInTransaction(
  tx: Prisma.TransactionClient,
  actor: Actor,
  targetId: string,
  sourceId: string,
) {
  // Beide rijen in vaste id-volgorde vergrendelen: A→B en B→A tegelijk kunnen geen cyclus of deadlock veroorzaken.
  const [first, second] = [targetId, sourceId].sort();
  await tx.$queryRaw`SELECT id FROM Prospect WHERE id IN (${first}, ${second}) ORDER BY id FOR UPDATE`;
  const [target, source] = await Promise.all([
    tx.prospect.findUnique({ where: { id: targetId } }),
    tx.prospect.findUnique({
      where: { id: sourceId },
      include: { customer: { select: { id: true } } },
    }),
  ]);
  if (!target || !source || target.anonymizedAt || source.anonymizedAt) {
    throw new AppError('NOT_FOUND', 'Prospect niet gevonden');
  }
  if (target.status === 'DUPLICATE') {
    throw new AppError('CONFLICT', 'Het doel is zelf al als dubbel samengevoegd');
  }
  if (source.customer) {
    throw new AppError(
      'CONFLICT',
      'Een prospect die al klant is kan niet als bron worden samengevoegd',
    );
  }
  if (source.status === 'DUPLICATE') throw new AppError('CONFLICT', 'Bron is al samengevoegd');

  // Unieke sleutels verhuizen alleen als het doel ze mist. Heeft het doel er al een, dan blijven
  // ze op de (DUPLICATE) bron staan en blijven ze nieuwe duplicaten tegenhouden.
  const moveDomain = target.domain == null && !!source.domain;
  const moveKvk = target.kvkNumber == null && !!source.kvkNumber;
  if (moveDomain || moveKvk) {
    await tx.prospect.update({
      where: { id: sourceId },
      data: { ...(moveDomain ? { domain: null } : {}), ...(moveKvk ? { kvkNumber: null } : {}) },
    });
  }
  const fill: Record<string, unknown> = {};
  const candidates = [
    'website',
    'phone',
    'city',
    'industry',
    'employeesMin',
    'employeesMax',
    'employeesRationale',
    'employeesSourceUrl',
    'fitScore',
    'fitRationale',
    'outreachAngle',
    'contactEmail',
  ] as const;
  for (const k of candidates) if (target[k] == null && source[k] != null) fill[k] = source[k];
  if (moveDomain) fill.domain = source.domain;
  if (moveKvk) fill.kvkNumber = source.kvkNumber;
  if (source.notes)
    fill.notes = [target.notes, `— samengevoegd uit ${source.companyName}:\n${source.notes}`]
      .filter(Boolean)
      .join('\n\n');
  if (Object.keys(fill).length) await tx.prospect.update({ where: { id: targetId }, data: fill });

  const move = { where: { prospectId: sourceId }, data: { prospectId: targetId } };
  await tx.prospectSource.updateMany(move);
  await tx.socialProfile.updateMany(move);
  await tx.prospectActivity.updateMany(move);
  await tx.outreachDraft.updateMany(move);
  await tx.emailMessage.updateMany(move);
  await tx.task.updateMany(move);
  await tx.leadCandidate.updateMany({
    where: { matchedProspectId: sourceId },
    data: { matchedProspectId: targetId },
  });

  await tx.prospect.update({
    where: { id: sourceId },
    data: { status: 'DUPLICATE', archivedAt: new Date() },
  });
  await tx.prospectActivity.create({
    data: {
      prospectId: targetId,
      type: 'MERGED',
      actorId: actor.id,
      description: `Samengevoegd met ${source.companyName}`,
      oldValue: sourceId,
    },
  });
  await audit(tx, {
    actorId: actor.id,
    action: 'prospect.merge',
    entityType: 'Prospect',
    entityId: targetId,
    ip: actor.ip,
    metadata: { sourceId },
  });
  return tx.prospect.findUniqueOrThrow({ where: { id: targetId } });
}

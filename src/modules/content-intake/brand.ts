import type { BrandProfile, Prisma, PrismaClient } from '@prisma/client';
import { withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { audit } from '../audit/audit.js';
import type { Actor } from '../../shared/security/actor.js';

/**
 * Maakt een nieuwe, geversioneerde merkprofielversie aan. Eerdere versies blijven bewaard (voor
 * traceerbaarheid van wat een AI-concept destijds als merkregels kreeg); `activate` bepaalt of deze
 * versie meteen de actieve wordt die contentgeneratie gebruikt.
 */
export async function createBrandProfileVersion(
  db: PrismaClient,
  actor: Actor,
  customerId: string,
  data: Prisma.InputJsonValue,
  activate: boolean,
): Promise<BrandProfile> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw new AppError('NOT_FOUND', 'Klant niet gevonden');

  return db.$transaction(async (tx) =>
    // Named lock i.p.v. alleen op de unieke constraint (customerId, version) vertrouwen: twee
    // gelijktijdige nieuwe versies voor dezelfde klant zouden anders beide hetzelfde volgnummer
    // berekenen en de tweede op een onnodige P2002 laten stuklopen.
    withNamedLock(tx, `spark:brand-profile:${customerId}`, async () => {
      const last = await tx.brandProfile.aggregate({
        where: { customerId },
        _max: { version: true },
      });
      const version = (last._max.version ?? 0) + 1;
      if (activate) {
        await tx.brandProfile.updateMany({ where: { customerId }, data: { active: false } });
      }
      const profile = await tx.brandProfile.create({
        data: { customerId, version, data, active: activate, createdBy: actor.id },
      });
      await audit(tx, {
        actorId: actor.id,
        action: 'content.brand_profile.create',
        entityType: 'BrandProfile',
        entityId: profile.id,
        ip: actor.ip,
        metadata: { customerId, version, activate },
      });
      return profile;
    }),
  );
}

export async function activateBrandProfile(
  db: PrismaClient,
  actor: Actor,
  customerId: string,
  id: string,
): Promise<BrandProfile> {
  const profile = await db.brandProfile.findUnique({ where: { id } });
  if (!profile || profile.customerId !== customerId) {
    throw new AppError('NOT_FOUND', 'Merkprofielversie niet gevonden');
  }
  return db.$transaction((tx) =>
    // Zelfde named lock als createBrandProfileVersion: zonder deze zouden twee gelijktijdige
    // activate-aanroepen voor dezelfde klant elkaars "alles behalve deze op inactief"-stap kunnen
    // overschrijven en samen twee actieve profielen achterlaten.
    withNamedLock(tx, `spark:brand-profile:${customerId}`, async () => {
      await tx.brandProfile.updateMany({ where: { customerId }, data: { active: false } });
      const updated = await tx.brandProfile.update({ where: { id }, data: { active: true } });
      await audit(tx, {
        actorId: actor.id,
        action: 'content.brand_profile.activate',
        entityType: 'BrandProfile',
        entityId: id,
        ip: actor.ip,
      });
      return updated;
    }),
  );
}

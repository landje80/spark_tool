import type { Prisma, PrismaClient } from '@prisma/client';

/** Eenvoudige sleutel/waarde-instellingen in de database (AppSetting). */
export async function getSetting<T>(
  db: Pick<PrismaClient, 'appSetting'>,
  key: string,
  fallback: T,
): Promise<T> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting(
  db: Pick<PrismaClient, 'appSetting'>,
  key: string,
  value: Prisma.InputJsonValue,
  updatedBy?: string,
): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value, updatedBy: updatedBy ?? null },
    update: { value, updatedBy: updatedBy ?? null },
  });
}

export const SETTING_LEADGEN_ENABLED = 'leadgen.enabled';

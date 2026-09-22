import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getSetting, setSetting } from '../../shared/settings.js';

type Db = Pick<PrismaClient, 'appSetting'>;

export interface OutreachSettings {
  dailyLimit: number;
  trackOpens: boolean;
  /** Afzenderidentificatie onderaan elke e-mail (bedrijfsnaam, adres, KvK). Aan te vullen door de eigenaar. */
  footer: string;
}

export const DEFAULT_FOOTER = 'Spark · https://spark.nicenext.nl';

export const outreachSettingsSchema = z
  .object({
    dailyLimit: z.number().int().min(1).max(500),
    trackOpens: z.boolean(),
    footer: z.string().trim().min(3).max(1000),
  })
  .strict();

export async function getOutreachSettings(db: Db): Promise<OutreachSettings> {
  const [dailyLimit, trackOpens, footer] = await Promise.all([
    getSetting<number>(db, 'outreach.dailyLimit', 50),
    getSetting<boolean>(db, 'outreach.trackOpens', false),
    getSetting<string>(db, 'outreach.footer', DEFAULT_FOOTER),
  ]);
  return { dailyLimit, trackOpens, footer };
}

export async function saveOutreachSettings(
  db: Db,
  s: OutreachSettings,
  userId: string,
): Promise<void> {
  await setSetting(db, 'outreach.dailyLimit', s.dailyLimit, userId);
  await setSetting(db, 'outreach.trackOpens', s.trackOpens, userId);
  await setSetting(db, 'outreach.footer', s.footer, userId);
}

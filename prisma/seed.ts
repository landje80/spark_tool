import 'dotenv/config';
import { PrismaClient, type Role } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/shared/security/permissions.js';

// Alleen rollen, permissies en instellingen. Nooit echte persoonsgegevens.
const db = new PrismaClient();

async function main(): Promise<void> {
  for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const permission of permissions) {
      await db.rolePermission.upsert({
        where: { role_permission: { role: role as Role, permission } },
        create: { role: role as Role, permission },
        update: {},
      });
    }
  }
  const settings: Record<string, unknown> = {
    'leadgen.enabled': false,
    'outreach.autoSend': false,
    'publishing.autoPublish': false,
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.appSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: {},
    });
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

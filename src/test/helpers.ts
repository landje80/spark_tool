import { randomBytes } from 'node:crypto';
import type { PrismaClient, Role, User } from '@prisma/client';
import cookieSignature from 'cookie-signature';
import { parseEnv } from '../config/env.js';
import { sha256Hex } from '../shared/security/tokens.js';

export const TEST_SECRET = 'test-secret-'.padEnd(48, 'x');

export const testEnv = () =>
  parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: TEST_SECRET,
    ENTRA_TENANT_ID: 't',
    ENTRA_CLIENT_ID: 'c',
    ENTRA_CLIENT_SECRET: 's',
    ENTRA_REDIRECT_URI: 'http://localhost:3000/tool/auth/callback',
    ENTRA_POST_LOGOUT_REDIRECT_URI: 'http://localhost:3000/tool/login',
  });

/** Leegt alle tabellen behalve _prisma_migrations. Weigert te draaien buiten een *_test database. */
export async function resetDb(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRaw<{ name: string }[]>`SELECT DATABASE() AS name`;
  const name = rows[0]?.name;
  if (!name?.endsWith('_test')) throw new Error(`resetDb geweigerd op database "${name}"`);
  const tables = await db.$queryRaw<{ t: string }[]>`
    SELECT table_name AS t FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'`;
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const { t } of tables) await db.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}

export async function makeUser(db: PrismaClient, role: Role, name = `Test ${role}`): Promise<User> {
  const id = randomBytes(6).toString('hex');
  return db.user.create({
    data: { entraOid: `oid-${id}`, tenantId: 't', name, email: `${id}@test.invalid`, role },
  });
}

/** Maakt een echte sessie in de database en geeft de bijbehorende cookie + CSRF-token terug. */
export async function login(db: PrismaClient, user: User, opts: { ageMs?: number } = {}) {
  const sid = randomBytes(24).toString('base64url');
  const csrf = randomBytes(12).toString('base64url');
  const expires = new Date(Date.now() + 3600_000);
  await db.session.create({
    data: {
      id: sha256Hex(sid),
      userId: user.id,
      expiresAt: expires,
      data: {
        cookie: {
          originalMaxAge: 3600_000,
          expires: expires.toISOString(),
          httpOnly: true,
          path: '/tool',
        },
        userId: user.id,
        role: user.role,
        csrfToken: csrf,
        createdAt: Date.now() - (opts.ageMs ?? 0),
      },
    },
  });
  const value = encodeURIComponent(`s:${cookieSignature.sign(sid, TEST_SECRET)}`);
  return { cookie: `spark.sid=${value}`, csrf };
}

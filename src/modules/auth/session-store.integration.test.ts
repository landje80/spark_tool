import { randomBytes } from 'node:crypto';
import type { SessionData } from 'express-session';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../shared/database/client.js';
import { sha256Hex } from '../../shared/security/tokens.js';
import { resetDb, testEnv } from '../../test/helpers.js';
import { PrismaSessionStore } from './session-store.js';

const db = getDb();
const env = testEnv();
const store = new PrismaSessionStore(db);

function session(userId: string, overrides: Partial<SessionData> = {}): SessionData {
  return {
    cookie: { originalMaxAge: 3600_000, path: env.APP_BASE_PATH, expires: undefined },
    userId,
    role: 'VIEWER',
    csrfToken: 'x',
    createdAt: Date.now(),
    ...overrides,
  } as SessionData;
}

function call<A extends unknown[]>(
  fn: (...args: [...A, (err?: unknown) => void]) => void,
  ...args: A
): Promise<void> {
  return new Promise((resolve, reject) =>
    fn(...args, (err?: unknown) => (err ? reject(err) : resolve())),
  );
}
function get(sid: string): Promise<SessionData | null | undefined> {
  return new Promise((resolve, reject) =>
    store.get(sid, (err, s) => (err ? reject(err) : resolve(s))),
  );
}

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('PrismaSessionStore', () => {
  it('set/get: slaat op onder de sha256-hash van het sid, niet het sid zelf', async () => {
    const sid = randomBytes(16).toString('hex');
    const user = await db.user.create({
      data: {
        entraOid: 'store-1',
        tenantId: 't',
        name: 'A',
        email: 'a@test.invalid',
        role: 'SALES',
      },
    });
    await call(store.set.bind(store), sid, session(user.id));

    const row = await db.session.findUnique({ where: { id: sha256Hex(sid) } });
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(user.id);
    expect(await db.session.findUnique({ where: { id: sid } })).toBeNull();

    const loaded = await get(sid);
    expect(loaded?.userId).toBe(user.id);
  });

  it('get: geeft null terug voor een onbekend of verlopen sid (niet een fout)', async () => {
    expect(await get('nooit-bestaan')).toBeNull();

    const sid = randomBytes(16).toString('hex');
    const user = await db.user.create({
      data: {
        entraOid: 'store-2',
        tenantId: 't',
        name: 'B',
        email: 'b@test.invalid',
        role: 'SALES',
      },
    });
    await db.session.create({
      data: {
        id: sha256Hex(sid),
        userId: user.id,
        expiresAt: new Date(Date.now() - 1000), // al verlopen
        data: session(user.id) as unknown as object,
      },
    });
    expect(await get(sid)).toBeNull();
  });

  it('touch: verlengt expiresAt zonder de data te wijzigen', async () => {
    const sid = randomBytes(16).toString('hex');
    const user = await db.user.create({
      data: {
        entraOid: 'store-3',
        tenantId: 't',
        name: 'C',
        email: 'c@test.invalid',
        role: 'SALES',
      },
    });
    const s = session(user.id, {
      cookie: {
        originalMaxAge: 1000,
        path: env.APP_BASE_PATH,
        expires: new Date(Date.now() + 1000),
      },
    });
    await call(store.set.bind(store), sid, s);
    const before = (await db.session.findUnique({ where: { id: sha256Hex(sid) } }))!.expiresAt;

    const later = new Date(Date.now() + 60_000);
    await call(
      store.touch.bind(store),
      sid,
      session(user.id, {
        cookie: { originalMaxAge: 60_000, path: env.APP_BASE_PATH, expires: later },
      }),
    );
    const row = await db.session.findUnique({ where: { id: sha256Hex(sid) } });
    expect(row!.expiresAt.getTime()).toBeGreaterThan(before.getTime());
    expect(row!.userId).toBe(user.id); // data zelf onveranderd door touch
  });

  it('destroy: verwijdert de rij; opnieuw destroyen van een al-verwijderd sid faalt niet', async () => {
    const sid = randomBytes(16).toString('hex');
    const user = await db.user.create({
      data: {
        entraOid: 'store-4',
        tenantId: 't',
        name: 'D',
        email: 'd@test.invalid',
        role: 'SALES',
      },
    });
    await call(store.set.bind(store), sid, session(user.id));
    await call(store.destroy.bind(store), sid);
    expect(await db.session.findUnique({ where: { id: sha256Hex(sid) } })).toBeNull();
    await expect(call(store.destroy.bind(store), sid)).resolves.toBeUndefined();
  });

  it('purgeExpired: ruimt alleen verlopen sessies op', async () => {
    const user = await db.user.create({
      data: {
        entraOid: 'store-5',
        tenantId: 't',
        name: 'E',
        email: 'e@test.invalid',
        role: 'SALES',
      },
    });
    await db.session.create({
      data: {
        id: sha256Hex('expired'),
        userId: user.id,
        expiresAt: new Date(Date.now() - 1000),
        data: session(user.id) as unknown as object,
      },
    });
    await db.session.create({
      data: {
        id: sha256Hex('geldig'),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        data: session(user.id) as unknown as object,
      },
    });
    const removed = await store.purgeExpired();
    expect(removed).toBe(1);
    expect(await db.session.findUnique({ where: { id: sha256Hex('geldig') } })).toBeTruthy();
  });
});

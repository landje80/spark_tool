import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntraClient, IdTokenClaims } from '../../integrations/microsoft/entra.js';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { resetDb, testEnv } from '../../test/helpers.js';

const db = getDb();
const API = '/tool/api';
const AUTH = '/tool/auth';

const ALLOWED_OID = 'allowed-oid-1';
const INACTIVE_OID = 'allowed-oid-2';
const RACE_OID_A = 'race-oid-a';
const RACE_OID_B = 'race-oid-b';
const NOT_ALLOWED_OID = 'not-allowed-oid';

const env = testEnv({
  ENTRA_ALLOWED_USER_IDS: [ALLOWED_OID, INACTIVE_OID, RACE_OID_A, RACE_OID_B].join(','),
});

function claimsFor(oid: string, extra: Partial<IdTokenClaims> = {}): IdTokenClaims {
  return {
    tid: env.ENTRA_TENANT_ID,
    aud: env.ENTRA_CLIENT_ID,
    iss: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`,
    nonce: 'mock-nonce',
    oid,
    name: `Test ${oid}`,
    email: `${oid}@test.invalid`,
    ...extra,
  };
}

/** Neemt de plaats in van EntraClient: `start()` geeft een vaste state/nonce terug, `complete()`
 * slaat een claims-set (of fout) op per code op, zodat de test volledig los staat van MSAL/Microsoft. */
class MockEntraClient {
  byCode = new Map<string, IdTokenClaims | Error>();
  async start() {
    return {
      url: 'https://login.microsoftonline.com/mock-authorize',
      state: 'mock-state',
      nonce: 'mock-nonce',
      codeVerifier: 'mock-verifier',
    };
  }
  async complete(code: string): Promise<IdTokenClaims> {
    const entry = this.byCode.get(code);
    if (entry instanceof Error) throw entry;
    if (!entry) throw new Error(`onbekende testcode: ${code}`);
    return entry;
  }
  logoutUrl(): string {
    return 'https://login.microsoftonline.com/mock-logout';
  }
}

const entra = new MockEntraClient();
const app = createApp(env, { entra: entra as unknown as EntraClient });

/** Doorloopt GET /login (zet de oidc-sessie) en GET /callback met de gegeven code, op één agent
 * (cookie blijft behouden tussen de twee requests, zoals een echte browser). */
async function loginFlow(code: string, state = 'mock-state') {
  const agent = request.agent(app);
  const loginRes = await agent.get(`${AUTH}/login`);
  expect(loginRes.status).toBe(302);
  const callbackRes = await agent.get(`${AUTH}/callback`).query({ code, state });
  return { agent, callbackRes };
}

beforeAll(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  entra.byCode.clear();
});

describe('login/callback-flow', () => {
  it('eerste toegestane gebruiker wordt ADMIN en krijgt een werkende sessie', async () => {
    entra.byCode.set('code-1', claimsFor(ALLOWED_OID));
    const { agent, callbackRes } = await loginFlow('code-1');

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe(`${env.APP_BASE_PATH}/dashboard`);

    const user = await db.user.findUnique({ where: { entraOid: ALLOWED_OID } });
    expect(user?.role).toBe('ADMIN');
    expect(user?.active).toBe(true);

    const me = await agent.get(`${API}/me`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user!.id);
    expect(me.body.csrfToken).toBeTruthy();

    const auditEntry = await db.auditLog.findFirst({
      where: { action: 'auth.login', actorId: user!.id },
    });
    expect(auditEntry).toBeTruthy();
  });

  it('tweede toegestane gebruiker wordt niet ook ADMIN', async () => {
    entra.byCode.set('code-1', claimsFor(ALLOWED_OID));
    await loginFlow('code-1');

    entra.byCode.set('code-2', claimsFor(INACTIVE_OID));
    await loginFlow('code-2');

    const second = await db.user.findUnique({ where: { entraOid: INACTIVE_OID } });
    expect(second?.role).toBe('VIEWER');
  });

  it('weigert een state die niet bij de sessie hoort', async () => {
    entra.byCode.set('code-1', claimsFor(ALLOWED_OID));
    const { callbackRes } = await loginFlow('code-1', 'verkeerde-state');
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe(`${env.APP_BASE_PATH}/login?error=state`);
    expect(await db.user.findUnique({ where: { entraOid: ALLOWED_OID } })).toBeNull();
  });

  it('stuurt naar login_failed als de tokenwissel bij Entra mislukt', async () => {
    entra.byCode.set('code-err', new Error('MSAL: token exchange failed'));
    const { callbackRes } = await loginFlow('code-err');
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe(`${env.APP_BASE_PATH}/login?error=login_failed`);
  });

  it('weigert een identiteit die niet op de allowlist staat (default deny)', async () => {
    entra.byCode.set('code-1', claimsFor(NOT_ALLOWED_OID));
    const { callbackRes } = await loginFlow('code-1');
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe(`${env.APP_BASE_PATH}/login?error=denied`);
    expect(await db.user.findUnique({ where: { entraOid: NOT_ALLOWED_OID } })).toBeNull();

    const auditEntry = await db.auditLog.findFirst({ where: { action: 'auth.denied' } });
    expect(auditEntry?.metadata).toMatchObject({ reason: 'not_allowlisted' });
  });

  it('weigert een gedeactiveerde gebruiker, ook al staat die op de allowlist', async () => {
    const existing = await db.user.create({
      data: {
        entraOid: INACTIVE_OID,
        tenantId: env.ENTRA_TENANT_ID,
        name: 'Uitgeschakeld',
        email: 'uitgeschakeld@test.invalid',
        role: 'MANAGER',
        active: false,
      },
    });
    entra.byCode.set('code-1', claimsFor(INACTIVE_OID));
    const { callbackRes } = await loginFlow('code-1');

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe(`${env.APP_BASE_PATH}/login?error=denied`);

    const auditEntry = await db.auditLog.findFirst({
      where: { action: 'auth.denied', actorId: existing.id },
    });
    expect(auditEntry?.metadata).toMatchObject({ reason: 'inactive' });
  });

  it('twee gelijktijdige eerste logins leveren maar één ADMIN op (bootstrap-race)', async () => {
    entra.byCode.set('code-a', claimsFor(RACE_OID_A));
    entra.byCode.set('code-b', claimsFor(RACE_OID_B));

    const [a, b] = await Promise.all([loginFlow('code-a'), loginFlow('code-b')]);
    expect(a.callbackRes.status).toBe(302);
    expect(b.callbackRes.status).toBe(302);

    const [userA, userB] = await Promise.all([
      db.user.findUnique({ where: { entraOid: RACE_OID_A } }),
      db.user.findUnique({ where: { entraOid: RACE_OID_B } }),
    ]);
    const roles = [userA?.role, userB?.role].sort();
    expect(roles).toEqual(['ADMIN', 'VIEWER']);
  });

  it('logout vernietigt de sessie in de database en geeft de Entra-afmeld-URL terug', async () => {
    entra.byCode.set('code-1', claimsFor(ALLOWED_OID));
    const { agent } = await loginFlow('code-1');
    const me = await agent.get(`${API}/me`);
    const csrf = me.body.csrfToken as string;

    const res = await agent.post(`${AUTH}/logout`).set('x-csrf-token', csrf).send();
    expect(res.status).toBe(200);
    expect(res.body.redirect).toBe('https://login.microsoftonline.com/mock-logout');

    const afterLogout = await agent.get(`${API}/me`);
    expect(afterLogout.status).toBe(401);
  });
});

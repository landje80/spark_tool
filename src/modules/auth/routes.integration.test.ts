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
async function loginFlow(code: string, state = 'mock-state', target: typeof app = app) {
  const agent = request.agent(target);
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

describe('rollen via Entra-groepen', () => {
  const G = {
    admin: 'grp-admin',
    manager: 'grp-manager',
    sales: 'grp-sales',
    content: 'grp-content',
    viewer: 'grp-viewer',
  };
  const roleEnv = testEnv({
    ENTRA_GROUP_IDS_ADMIN: G.admin,
    ENTRA_GROUP_IDS_MANAGER: G.manager,
    ENTRA_GROUP_IDS_SALES: G.sales,
    ENTRA_GROUP_IDS_CONTENT_EDITOR: G.content,
    ENTRA_GROUP_IDS_VIEWER: G.viewer,
  });
  const roleApp = createApp(roleEnv, { entra: entra as unknown as EntraClient });

  const login = async (oid: string, groups: string[] | undefined, extra = {}) => {
    entra.byCode.set(`code-${oid}`, claimsFor(oid, { groups, ...extra }));
    return loginFlow(`code-${oid}`, 'mock-state', roleApp);
  };
  const roleOf = async (oid: string) =>
    (await db.user.findUnique({ where: { entraOid: oid } }))?.role;

  it('geeft elke rolgroep de bijbehorende rol, ook aan de eerste gebruiker (geen automatische admin)', async () => {
    await login('u-viewer', [G.viewer]);
    expect(await roleOf('u-viewer')).toBe('VIEWER');
    await login('u-sales', [G.sales]);
    expect(await roleOf('u-sales')).toBe('SALES');
    await login('u-content', [G.content]);
    expect(await roleOf('u-content')).toBe('CONTENT_EDITOR');
    await login('u-manager', [G.manager]);
    expect(await roleOf('u-manager')).toBe('MANAGER');
    await login('u-admin', [G.admin]);
    expect(await roleOf('u-admin')).toBe('ADMIN');
  });

  it('kiest de hoogste rol bij meerdere groepen en laat lid van een rolgroep zonder losse allowlist inloggen', async () => {
    const { callbackRes } = await login('u-multi', [G.viewer, G.manager, G.sales]);
    expect(callbackRes.headers.location).toBe(`${roleEnv.APP_BASE_PATH}/dashboard`);
    expect(await roleOf('u-multi')).toBe('MANAGER');
  });

  it('past de rol aan bij een volgende login en legt dat vast in het auditlog', async () => {
    await login('u-admin', [G.admin]); // zodat degraderen hieronder niet de laatste admin treft
    await login('u-wissel', [G.admin]);
    expect(await roleOf('u-wissel')).toBe('ADMIN');
    await login('u-wissel', [G.sales]);
    expect(await roleOf('u-wissel')).toBe('SALES');
    const user = await db.user.findUniqueOrThrow({ where: { entraOid: 'u-wissel' } });
    const entry = await db.auditLog.findFirst({
      where: { action: 'user.role.change', entityId: user.id },
    });
    expect(entry?.metadata).toMatchObject({ from: 'ADMIN', to: 'SALES', source: 'entra_groups' });
  });

  it('degradeert nooit de enige actieve admin, ook al zit die niet in de ADMIN-groep', async () => {
    await login('u-enige', [G.admin]);
    await login('u-enige', [G.viewer]); // groep verkeerd ingesteld
    expect(await roleOf('u-enige')).toBe('ADMIN');
  });

  it('laat de rol ongewijzigd bij groepen-overage en bij een token zonder groepenlijst', async () => {
    await login('u-admin', [G.admin]);
    await login('u-overage', [G.sales]);
    // Overage: Entra stuurt geen lijst; toegang via gebruikers-ID blijft mogelijk, de rol verandert niet.
    const overageEnv = testEnv({
      ENTRA_GROUP_IDS_SALES: G.sales,
      ENTRA_ALLOWED_USER_IDS: 'u-overage',
    });
    const overageApp = createApp(overageEnv, { entra: entra as unknown as EntraClient });
    entra.byCode.set('code-overage-2', {
      ...claimsFor('u-overage'),
      groups: undefined,
      _claim_names: { groups: 'src1' },
    });
    const { callbackRes } = await loginFlow('code-overage-2', 'mock-state', overageApp);
    expect(callbackRes.headers.location).toBe(`${overageEnv.APP_BASE_PATH}/dashboard`);
    expect(await roleOf('u-overage')).toBe('SALES');
  });

  it('zonder rolgroepen blijft het oude gedrag: eerste gebruiker ADMIN, volgende VIEWER, rol ongewijzigd', async () => {
    entra.byCode.set('code-1', claimsFor(ALLOWED_OID, { groups: ['willekeurig'] }));
    await loginFlow('code-1');
    entra.byCode.set('code-2', claimsFor(INACTIVE_OID, { groups: ['willekeurig'] }));
    await loginFlow('code-2');
    expect(await roleOf(ALLOWED_OID)).toBe('ADMIN');
    expect(await roleOf(INACTIVE_OID)).toBe('VIEWER');
    await db.user.update({ where: { entraOid: INACTIVE_OID }, data: { role: 'MANAGER' } });
    await loginFlow('code-2');
    expect(await roleOf(INACTIVE_OID)).toBe('MANAGER');
  });
});

import type { Role, User } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { login, makeUser, resetDb, testEnv } from '../../test/helpers.js';

const db = getDb();
const app = createApp(testEnv());
const API = '/tool/api';

interface As {
  user: User;
  get: (url: string) => request.Test;
  send: (method: 'post' | 'patch', url: string, body?: object, csrf?: boolean) => request.Test;
}

async function as(role: Role): Promise<As> {
  const user = await makeUser(db, role);
  const { cookie, csrf } = await login(db, user);
  return {
    user,
    get: (url) => request(app).get(`${API}${url}`).set('Cookie', cookie),
    send: (method, url, body = {}, withCsrf = true) => {
      const req = request(app)[method](`${API}${url}`).set('Cookie', cookie);
      if (withCsrf) req.set('x-csrf-token', csrf);
      return req.send(body);
    },
  };
}

let sales: As;
let manager: As;
let viewer: As;

beforeAll(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  sales = await as('SALES');
  manager = await as('MANAGER');
  viewer = await as('VIEWER');
});

const create = (u: As, body: object) => u.send('post', '/prospects', body);

describe('autorisatie en CSRF', () => {
  it('weigert niet-ingelogde verzoeken', async () => {
    const res = await request(app).get(`${API}/prospects`);
    expect(res.status).toBe(401);
  });
  it('VIEWER mag lezen maar niet schrijven', async () => {
    expect((await viewer.get('/prospects')).status).toBe(200);
    expect((await create(viewer, { companyName: 'X BV' })).status).toBe(403);
  });
  it('SALES mag schrijven maar niet exporteren; MANAGER wel', async () => {
    expect((await create(sales, { companyName: 'Bakkerij Smit' })).status).toBe(201);
    expect((await sales.get('/prospects/export.csv')).status).toBe(403);
    expect((await manager.get('/prospects/export.csv')).status).toBe(200);
  });
  it('weigert schrijven zonder CSRF-token', async () => {
    const res = await sales.send('post', '/prospects', { companyName: 'Zonder Token' }, false);
    expect(res.status).toBe(403);
    expect(await db.prospect.count()).toBe(0);
  });
  it('weigert een vreemde Origin', async () => {
    const { cookie, csrf } = await login(db, sales.user);
    const res = await request(app)
      .post(`${API}/prospects`)
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .set('Origin', 'https://evil.example')
      .send({ companyName: 'Evil' });
    expect(res.status).toBe(403);
  });
  it('weigert een inactieve gebruiker', async () => {
    await db.user.update({ where: { id: sales.user.id }, data: { active: false } });
    expect((await sales.get('/prospects')).status).toBe(401);
  });
  it('geeft JSON 404 voor onbekende API-routes', async () => {
    const res = await sales.get('/bestaat-niet');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('prospect aanmaken', () => {
  it('maakt prospect, activiteit en auditregel', async () => {
    const res = await create(sales, {
      companyName: 'Bakkerij Smit B.V.',
      website: 'https://www.bakkerijsmit.nl',
      city: 'Zwolle',
      province: 'OVERIJSSEL',
    });
    expect(res.status).toBe(201);
    expect(res.body.domain).toBe('bakkerijsmit.nl');
    expect(res.body.normalizedName).toBe('bakkerij smit');
    expect(res.body.status).toBe('NEW');
    expect(
      await db.prospectActivity.count({ where: { prospectId: res.body.id, type: 'CREATED' } }),
    ).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'prospect.create' } })).toBe(1);
  });
  it('valideert invoer met veldfouten zonder waarden terug te geven', async () => {
    const res = await create(sales, { companyName: '', website: 'geen url ???', kvkNumber: '12' });
    expect(res.status).toBe(400);
    const paths = res.body.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['companyName', 'website', 'kvkNumber']));
    expect(JSON.stringify(res.body)).not.toContain('geen url');
  });
  it('weigert onbekende velden (mass assignment)', async () => {
    const res = await create(sales, {
      companyName: 'Hack BV',
      status: 'CUSTOMER',
      archivedAt: null,
    });
    expect(res.status).toBe(400);
  });
  it('blokkeert een exact duplicaat op domein, ook als www-variant', async () => {
    await create(sales, { companyName: 'Smit', website: 'smit.nl' });
    const res = await create(sales, {
      companyName: 'Heel Anders',
      website: 'https://www.smit.nl/contact',
    });
    expect(res.status).toBe(409);
    expect(res.body.details.blocking).toBe(true);
    expect(await db.prospect.count()).toBe(1);
  });
  it('meldt een fuzzy duplicaat en staat bevestiging toe', async () => {
    await create(sales, { companyName: 'Bakkerij Smit', city: 'Zwolle' });
    const first = await create(sales, { companyName: 'Bakkerij Smid', city: 'Kampen' });
    expect(first.status).toBe(409);
    expect(first.body.details.blocking).toBe(false);
    const confirmed = await create(sales, {
      companyName: 'Bakkerij Smid',
      city: 'Kampen',
      confirmDuplicate: true,
    });
    expect(confirmed.status).toBe(201);
  });
  it('vindt duplicaten ook bij gearchiveerde prospects', async () => {
    const p = await create(sales, { companyName: 'Oud Bedrijf', website: 'oud.nl' });
    await sales.send('post', `/prospects/${p.body.id}/status`, { status: 'ARCHIVED' });
    const res = await create(sales, { companyName: 'Oud Bedrijf Nieuw', website: 'oud.nl' });
    expect(res.status).toBe(409);
  });
  it('controleert dat medewerkersminimum niet boven maximum ligt', async () => {
    const res = await create(sales, { companyName: 'Groot', employeesMin: 50, employeesMax: 10 });
    expect(res.status).toBe(400);
  });
});

describe('prospect bewerken', () => {
  it('logt gewijzigde velden en herberekent afgeleide velden', async () => {
    const p = (await create(sales, { companyName: 'Oud Naam', website: 'oud.nl', city: 'Zwolle' }))
      .body;
    const res = await sales.send('patch', `/prospects/${p.id}`, {
      companyName: 'Nieuwe Naam BV',
      website: 'https://nieuw.nl',
      notes: 'geheime interne notitie',
    });
    expect(res.status).toBe(200);
    expect(res.body.normalizedName).toBe('nieuwe naam');
    expect(res.body.domain).toBe('nieuw.nl');
    const acts = await db.prospectActivity.findMany({
      where: { prospectId: p.id, type: 'FIELD_CHANGED' },
    });
    expect(acts.map((a) => a.description).sort()).toEqual([
      'Veld gewijzigd: companyName',
      'Veld gewijzigd: notes',
      'Veld gewijzigd: website',
    ]);
    // Lange velden worden alleen als "gewijzigd" gelogd, nooit met inhoud.
    expect(JSON.stringify(acts)).not.toContain('geheime interne notitie');
  });
  it('doet niets en logt niets bij ongewijzigde invoer', async () => {
    const p = (await create(sales, { companyName: 'Zelfde', city: 'Epe' })).body;
    await sales.send('patch', `/prospects/${p.id}`, { city: 'Epe' });
    expect(await db.prospectActivity.count({ where: { type: 'FIELD_CHANGED' } })).toBe(0);
  });
  it('weigert status via PATCH en een onbekende eigenaar', async () => {
    const p = (await create(sales, { companyName: 'X Y' })).body;
    expect((await sales.send('patch', `/prospects/${p.id}`, { status: 'EMAILED' })).status).toBe(
      400,
    );
    expect(
      (await sales.send('patch', `/prospects/${p.id}`, { ownerId: 'bestaat-niet' })).status,
    ).toBe(400);
  });
  it('geeft 404 voor een onbekende prospect', async () => {
    expect((await sales.send('patch', '/prospects/onbekend', { city: 'Epe' })).status).toBe(404);
  });
});

describe('statusovergangen', () => {
  it('volgt de statusmachine en logt elke wijziging', async () => {
    const p = (await create(sales, { companyName: 'Status Test' })).body;
    const ok = await sales.send('post', `/prospects/${p.id}/status`, { status: 'EMAILED' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('EMAILED');
    const acts = await db.prospectActivity.findMany({
      where: { prospectId: p.id, type: 'STATUS_CHANGED' },
    });
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ oldValue: 'NEW', newValue: 'EMAILED', actorId: sales.user.id });
  });
  it('weigert ongeldige overgang en klant worden via de status-API', async () => {
    const p = (await create(sales, { companyName: 'Status Test' })).body;
    expect(
      (await sales.send('post', `/prospects/${p.id}/status`, { status: 'REPLY_RECEIVED' })).status,
    ).toBe(409);
    expect(
      (await sales.send('post', `/prospects/${p.id}/status`, { status: 'CUSTOMER' })).status,
    ).toBe(409);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('NEW');
  });
  it('archiveert en herstelt', async () => {
    const p = (await create(sales, { companyName: 'Archief Test' })).body;
    await sales.send('post', `/prospects/${p.id}/status`, { status: 'ARCHIVED' });
    expect(
      (await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).archivedAt,
    ).not.toBeNull();
    expect((await sales.get('/prospects')).body.total).toBe(0);
    expect((await sales.get('/prospects?includeArchived=true')).body.total).toBe(1);
    await sales.send('post', `/prospects/${p.id}/status`, { status: 'NEW' });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).archivedAt).toBeNull();
  });
  it('bewaart reden bij niet geïnteresseerd', async () => {
    const p = (await create(sales, { companyName: 'Geen Interesse' })).body;
    await sales.send('post', `/prospects/${p.id}/status`, {
      status: 'NOT_INTERESTED',
      reason: 'Heeft al een bureau',
    });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).notInterestedReason).toBe(
      'Heeft al een bureau',
    );
  });
});

describe('lijst, filters en export', () => {
  beforeEach(async () => {
    const day = 24 * 3600 * 1000;
    const rows = [
      {
        companyName: 'Alpha Horeca',
        city: 'Zwolle',
        province: 'OVERIJSSEL',
        industry: 'horeca',
        fitScore: 90,
      },
      {
        companyName: 'Beta Techniek',
        city: 'Hattem',
        province: 'GELDERLAND',
        industry: 'installatietechniek',
        fitScore: 60,
        nextActionAt: new Date(Date.now() - 3 * day).toISOString(),
      },
      {
        companyName: 'Gamma Retail',
        city: 'Zwolle',
        province: 'OVERIJSSEL',
        industry: 'retail',
        fitScore: 30,
        nextActionAt: new Date().toISOString(),
      },
      { companyName: '=Evil Formule', city: 'Epe', province: 'GELDERLAND', industry: 'retail' },
    ];
    for (const r of rows) expect((await create(sales, r)).status).toBe(201);
  });

  it('zoekt, filtert en pagineert', async () => {
    expect((await sales.get('/prospects?q=alpha')).body.total).toBe(1);
    expect((await sales.get('/prospects?city=Zwolle')).body.total).toBe(2);
    expect((await sales.get('/prospects?province=GELDERLAND')).body.total).toBe(2);
    expect((await sales.get('/prospects?minScore=50')).body.total).toBe(2);
    const page = await sales.get('/prospects?pageSize=2&page=2&sort=companyName&dir=asc');
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBe(4);
  });
  it('sorteert stabiel op naam', async () => {
    const res = await sales.get('/prospects?sort=companyName&dir=asc');
    expect(res.body.items.map((i: { companyName: string }) => i.companyName)[0]).toBe(
      '=Evil Formule',
    );
  });
  it('markeert vandaag en achterstallig, en filtert daarop', async () => {
    const all = (await sales.get('/prospects')).body.items as {
      companyName: string;
      flags: Record<string, boolean>;
    }[];
    const flag = (n: string) => all.find((i) => i.companyName === n)!.flags;
    expect(flag('Gamma Retail').dueToday).toBe(true);
    expect(flag('Beta Techniek').overdue).toBe(true);
    expect(flag('Alpha Horeca')).toMatchObject({
      dueToday: false,
      overdue: false,
      needsReview: true,
    });
    expect((await sales.get('/prospects?due=today')).body.total).toBe(1);
    expect((await sales.get('/prospects?due=overdue')).body.total).toBe(1);
  });
  it('sluit gesloten statussen uit van achterstallig', async () => {
    const beta = await db.prospect.findFirstOrThrow({ where: { companyName: 'Beta Techniek' } });
    await sales.send('post', `/prospects/${beta.id}/status`, { status: 'NOT_INTERESTED' });
    expect((await sales.get('/prospects?due=overdue')).body.total).toBe(0);
  });
  it('weigert ongeldige queryparameters', async () => {
    expect((await sales.get('/prospects?pageSize=5000')).status).toBe(400);
    expect((await sales.get('/prospects?sort=passwordHash')).status).toBe(400);
    expect((await sales.get('/prospects?onbekend=1')).status).toBe(400);
  });
  it('exporteert CSV met formule-injectie-bescherming en auditlog', async () => {
    const res = await manager.get('/prospects/export.csv?sort=companyName&dir=asc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain("'=Evil Formule");
    expect(res.text).not.toMatch(/^=Evil/m);
    expect(await db.auditLog.count({ where: { action: 'prospect.export' } })).toBe(1);
  });
});

describe('activiteiten, taken en bulkacties', () => {
  it('voegt notitie en gesprek toe en weigert andere types', async () => {
    const p = (await create(sales, { companyName: 'Notitie BV' })).body;
    expect(
      (
        await sales.send('post', `/prospects/${p.id}/activities`, {
          type: 'NOTE',
          description: 'Teruggebeld',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await sales.send('post', `/prospects/${p.id}/activities`, {
          type: 'EMAIL_SENT',
          description: 'nep',
        })
      ).status,
    ).toBe(400);
    const detail = await sales.get(`/prospects/${p.id}`);
    expect(detail.body.activities[0].description).toBe('Teruggebeld');
    expect(detail.body.allowedTransitions).toContain('EMAILED');
    expect(detail.body.allowedTransitions).not.toContain('CUSTOMER');
  });
  it('maakt taken, toont ze en rondt ze af', async () => {
    const p = (await create(sales, { companyName: 'Taak BV' })).body;
    const t = await sales.send('post', `/prospects/${p.id}/tasks`, {
      type: 'CALL',
      dueAt: '2026-12-01',
      priority: 'HIGH',
      description: 'Bellen',
    });
    expect(t.status).toBe(201);
    expect(t.body.assigneeId).toBe(sales.user.id);
    expect((await sales.get('/tasks?status=OPEN&mine=true')).body.tasks).toHaveLength(1);
    await sales.send('patch', `/tasks/${t.body.id}`, { status: 'DONE' });
    expect((await sales.get('/tasks?status=OPEN')).body.tasks).toHaveLength(0);
  });
  it('wijst bulk eigenaar en volgende actiedatum toe met activiteitenlog', async () => {
    const ids = [] as string[];
    for (const n of ['Een BV', 'Twee BV', 'Drie BV'])
      ids.push((await create(sales, { companyName: n })).body.id);
    const assign = await sales.send('post', '/prospects/bulk/assign', {
      ids,
      ownerId: manager.user.id,
    });
    expect(assign.body.updated).toBe(3);
    expect(await db.prospect.count({ where: { ownerId: manager.user.id } })).toBe(3);
    const next = await sales.send('post', '/prospects/bulk/next-action', {
      ids,
      nextActionAt: '2026-10-01',
    });
    expect(next.body.updated).toBe(3);
    expect(await db.prospectActivity.count({ where: { type: 'FIELD_CHANGED' } })).toBe(6);
    expect(
      (await sales.send('post', '/prospects/bulk/assign', { ids: [], ownerId: null })).status,
    ).toBe(400);
    expect(
      (await sales.send('post', '/prospects/bulk/assign', { ids, ownerId: 'bestaat-niet' })).status,
    ).toBe(400);
  });
});

describe('samenvoegen', () => {
  it('verhuist gegevens naar het doel en markeert de bron als dubbel', async () => {
    const target = (await create(sales, { companyName: 'Doel BV', city: 'Zwolle' })).body;
    const source = (
      await create(sales, {
        companyName: 'Bron BV',
        website: 'bron.nl',
        phone: '038 123 45 67',
        notes: 'oude notitie',
      })
    ).body;
    await db.socialProfile.create({
      data: {
        prospectId: source.id,
        platform: 'LINKEDIN',
        url: 'https://linkedin.com/company/bron',
      },
    });
    await sales.send('post', `/prospects/${source.id}/activities`, {
      type: 'NOTE',
      description: 'historie',
    });

    const res = await manager.send('post', `/prospects/${target.id}/merge`, {
      sourceId: source.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe('bron.nl');
    expect(res.body.notes).toContain('oude notitie');
    expect(await db.socialProfile.count({ where: { prospectId: target.id } })).toBe(1);
    expect(
      await db.prospectActivity.count({
        where: { prospectId: target.id, description: 'historie' },
      }),
    ).toBe(1);
    const src = await db.prospect.findUniqueOrThrow({ where: { id: source.id } });
    expect(src.status).toBe('DUPLICATE');
    expect(src.domain).toBeNull();
    expect(src.archivedAt).not.toBeNull();
  });
  it('weigert samenvoegen met zichzelf, een onbekende bron en een reeds samengevoegde bron', async () => {
    const a = (await create(sales, { companyName: 'Aaa BV' })).body;
    const b = (await create(sales, { companyName: 'Bbb BV' })).body;
    expect(
      (await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: a.id })).status,
    ).toBe(400);
    expect((await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: 'x' })).status).toBe(
      404,
    );
    expect(
      (await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: b.id })).status,
    ).toBe(200);
    expect(
      (await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: b.id })).status,
    ).toBe(409);
  });
});

describe('dashboard', () => {
  it("telt KPI's, funnel en verdelingen", async () => {
    const a = (
      await create(sales, {
        companyName: 'Een BV',
        city: 'Zwolle',
        industry: 'horeca',
        nextActionAt: new Date().toISOString(),
      })
    ).body;
    await create(sales, { companyName: 'Twee BV', city: 'Zwolle', industry: 'retail' });
    await sales.send('post', `/prospects/${a.id}/status`, { status: 'EMAILED' });
    const res = await viewer.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({ newCount: 1, dueToday: 1, overdue: 0, failedJobs: 0 });
    expect(res.body.funnel.find((f: { status: string }) => f.status === 'EMAILED').count).toBe(1);
    expect(res.body.byCity[0]).toEqual({ key: 'Zwolle', count: 2 });
  });
});

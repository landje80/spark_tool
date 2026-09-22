import type { Role, User } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { login, makeUser, resetDb, testEnv } from '../../test/helpers.js';
import { convertProspectToCustomer } from '../customers/service.js';
import { mergeProspects } from './bulk.js';

// Regressietests voor de reviewer-bevindingen (races, merge-validatie, taakeigenaarschap, sessies).
const db = getDb();
const app = createApp(testEnv());
const API = '/tool/api';

async function as(role: Role, opts?: { ageMs?: number }) {
  const user: User = await makeUser(db, role);
  const { cookie, csrf } = await login(db, user, opts);
  return {
    user,
    get: (url: string) => request(app).get(`${API}${url}`).set('Cookie', cookie),
    send: (method: 'post' | 'patch', url: string, body: object = {}) => {
      const agent = request(app);
      const req = method === 'post' ? agent.post(`${API}${url}`) : agent.patch(`${API}${url}`);
      return req.set('Cookie', cookie).set('x-csrf-token', csrf).send(body);
    },
  };
}
type Client = Awaited<ReturnType<typeof as>>;

let sales: Client;
let manager: Client;
beforeEach(async () => {
  await resetDb(db);
  sales = await as('SALES');
  manager = await as('MANAGER');
});
afterAll(async () => {
  await db.$disconnect();
});

const create = (u: Client, body: object) => u.send('post', '/prospects', body);

describe('gelijktijdigheid', () => {
  it('maakt bij vijf gelijktijdige identieke aanmaakacties precies één prospect', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        create(sales, { companyName: 'Race BV', website: 'race.nl' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await db.prospect.count()).toBe(1);
  });

  it('laat bij gelijktijdige statuswijzigingen nooit twee wijzigingen vanaf dezelfde oude status toe', async () => {
    const p = (await create(sales, { companyName: 'Status Race' })).body;
    const res = await Promise.all([
      sales.send('post', `/prospects/${p.id}/status`, { status: 'ARCHIVED' }),
      manager.send('post', `/prospects/${p.id}/status`, { status: 'EMAILED' }),
    ]);
    const ok = res.filter((r) => r.status === 200).length;
    expect(ok).toBeGreaterThanOrEqual(1);
    const acts = await db.prospectActivity.findMany({
      where: { prospectId: p.id, type: { in: ['STATUS_CHANGED', 'ARCHIVED'] } },
    });
    expect(acts).toHaveLength(ok);
    // Twee wijzigingen mogen niet allebei vanaf 'NEW' vertrekken.
    expect(acts.filter((a) => a.oldValue === 'NEW')).toHaveLength(1);
  });
});

describe('duplicaatcontrole bij wijzigen', () => {
  it('blokkeert wijzigen naar een bestaand domein met details', async () => {
    await create(sales, { companyName: 'Eerste BV', website: 'eerste.nl' });
    const b = (await create(sales, { companyName: 'Tweede BV', website: 'tweede.nl' })).body;
    const res = await sales.send('patch', `/prospects/${b.id}`, {
      website: 'https://www.eerste.nl',
    });
    expect(res.status).toBe(409);
    expect(res.body.details.blocking).toBe(true);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: b.id } })).domain).toBe('tweede.nl');
  });
});

describe('samenvoegen: rechten en validatie', () => {
  it('is alleen toegestaan voor rollen met prospect.merge', async () => {
    const a = (await create(sales, { companyName: 'Aaa BV' })).body;
    const b = (await create(sales, { companyName: 'Bbb BV' })).body;
    expect((await sales.send('post', `/prospects/${a.id}/merge`, { sourceId: b.id })).status).toBe(
      403,
    );
    expect(
      (await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: b.id })).status,
    ).toBe(200);
  });

  it('weigert een doel dat zelf al dubbel of geanonimiseerd is', async () => {
    const a = (await create(sales, { companyName: 'Aaa BV' })).body;
    const b = (await create(sales, { companyName: 'Bbb BV' })).body;
    const c = (await create(sales, { companyName: 'Ccc BV' })).body;
    await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: b.id }); // b is nu DUPLICATE
    expect(
      (await manager.send('post', `/prospects/${b.id}/merge`, { sourceId: c.id })).status,
    ).toBe(409);
    await db.prospect.update({ where: { id: c.id }, data: { anonymizedAt: new Date() } });
    expect(
      (await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: c.id })).status,
    ).toBe(404);
  });

  it('behoudt unieke sleutels van de bron als het doel er al een eigen heeft', async () => {
    const target = (
      await create(sales, { companyName: 'Doel BV', kvkNumber: '11111111', website: 'doel.nl' })
    ).body;
    const source = (
      await create(sales, { companyName: 'Bron BV', kvkNumber: '22222222', website: 'bron.nl' })
    ).body;
    expect(
      (await manager.send('post', `/prospects/${target.id}/merge`, { sourceId: source.id })).status,
    ).toBe(200);
    // De bron-sleutels blijven waken: een nieuw bedrijf met dat KvK-nummer of domein is een duplicaat.
    expect((await create(sales, { companyName: 'Nieuw BV', kvkNumber: '22222222' })).status).toBe(
      409,
    );
    expect((await create(sales, { companyName: 'Nieuw BV', website: 'bron.nl' })).status).toBe(409);
  });

  it('verhuist openstaande kandidaten naar het doel', async () => {
    const a = (await create(sales, { companyName: 'Aaa BV' })).body;
    const b = (await create(sales, { companyName: 'Bbb BV' })).body;
    const run = await db.leadGenerationRun.create({ data: { runKey: 'test-run' } });
    const cand = await db.leadCandidate.create({
      data: { runId: run.id, payload: {}, matchedProspectId: b.id },
    });
    await manager.send('post', `/prospects/${a.id}/merge`, { sourceId: b.id });
    expect(
      (await db.leadCandidate.findUniqueOrThrow({ where: { id: cand.id } })).matchedProspectId,
    ).toBe(a.id);
  });
});

describe('atomiciteit bij samenvoegen en omzetten', () => {
  // Forceert een échte fout diep in de transactie (FK-schending op ProspectActivity.actorId, via een
  // niet-bestaande actor-id) om te bevestigen dat de héle transactie teruggedraaid wordt — geen halve
  // samenvoeging/omzetting blijft staan. Zelfde techniek als de webhook-rollbacktest in
  // outreach/webhooks.integration.test.ts, maar hier via een rechtstreekse serviceaanroep omdat de
  // actor-id via de HTTP-laag altijd een bestaande ingelogde gebruiker is.
  const badActor = { id: 'bestaat-niet', ip: null };

  it('draait mergeProspects volledig terug als de afsluitende activiteit niet kan worden gelogd', async () => {
    const target = (await create(sales, { companyName: 'Doel BV', city: 'Zwolle' })).body;
    const source = (
      await create(sales, { companyName: 'Bron BV', website: 'bron.nl', notes: 'oude notitie' })
    ).body;
    await db.socialProfile.create({
      data: {
        prospectId: source.id,
        platform: 'LINKEDIN',
        url: 'https://linkedin.com/company/bron',
      },
    });

    await expect(mergeProspects(db, badActor, target.id, source.id)).rejects.toThrow();

    // Niets van de samenvoeging is doorgevoerd: bron nog steeds actief, sociaal profiel nog aan de bron.
    const src = await db.prospect.findUniqueOrThrow({ where: { id: source.id } });
    expect(src.status).not.toBe('DUPLICATE');
    expect(src.archivedAt).toBeNull();
    const tgt = await db.prospect.findUniqueOrThrow({ where: { id: target.id } });
    expect(tgt.domain).toBeNull();
    expect(await db.socialProfile.count({ where: { prospectId: target.id } })).toBe(0);
    expect(await db.socialProfile.count({ where: { prospectId: source.id } })).toBe(1);
  });

  it('draait convertProspectToCustomer volledig terug als de afsluitende activiteit niet kan worden gelogd', async () => {
    const prospect = await db.prospect.create({
      data: {
        companyName: 'Kwalificeer BV',
        normalizedName: 'kwalificeer bv',
        status: 'QUALIFIED',
      },
    });

    await expect(
      convertProspectToCustomer(db, badActor, prospect.id, { allowedPlatforms: ['LINKEDIN'] }),
    ).rejects.toThrow();

    expect(await db.customer.count({ where: { prospectId: prospect.id } })).toBe(0);
    const p = await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(p.status).toBe('QUALIFIED'); // niet doorgezet naar CUSTOMER
  });
});

describe('geanonimiseerde prospects', () => {
  it('kan niet meer worden gewijzigd, geannoteerd of van taken voorzien', async () => {
    const p = (await create(sales, { companyName: 'Weg BV' })).body;
    await db.prospect.update({ where: { id: p.id }, data: { anonymizedAt: new Date() } });
    expect(
      (await sales.send('post', `/prospects/${p.id}/status`, { status: 'EMAILED' })).status,
    ).toBe(404);
    expect(
      (
        await sales.send('post', `/prospects/${p.id}/activities`, {
          type: 'NOTE',
          description: 'x',
        })
      ).status,
    ).toBe(404);
    expect((await sales.send('post', `/prospects/${p.id}/tasks`, { type: 'CALL' })).status).toBe(
      404,
    );
    expect((await sales.send('patch', `/prospects/${p.id}`, { city: 'Epe' })).status).toBe(404);
  });
});

describe('taken en eigenaarschap', () => {
  it('laat een verkoper alleen eigen of niet-toegewezen taken wijzigen; managers alles', async () => {
    const p = (await create(sales, { companyName: 'Taak BV' })).body;
    const t = await manager.send('post', `/prospects/${p.id}/tasks`, {
      type: 'CALL',
      assigneeId: manager.user.id,
    });
    expect((await sales.send('patch', `/tasks/${t.body.id}`, { status: 'DONE' })).status).toBe(403);
    expect((await manager.send('patch', `/tasks/${t.body.id}`, { status: 'DONE' })).status).toBe(
      200,
    );
    const own = await sales.send('post', `/prospects/${p.id}/tasks`, { type: 'EMAIL' });
    expect((await sales.send('patch', `/tasks/${own.body.id}`, { status: 'DONE' })).status).toBe(
      200,
    );
    expect(
      (await manager.send('patch', `/tasks/${own.body.id}`, { status: 'CANCELLED' })).status,
    ).toBe(200);
  });
});

describe('sessies', () => {
  it('weigert een sessie die ouder is dan de absolute levensduur, ook als ze nog niet verlopen is', async () => {
    const stale = await as('SALES', { ageMs: 13 * 3600_000 });
    expect((await stale.get('/prospects')).status).toBe(401);
    const fresh = await as('SALES', { ageMs: 1 * 3600_000 });
    expect((await fresh.get('/prospects')).status).toBe(200);
  });
});

describe('export', () => {
  it('bevat geen interne notities of onderbouwingen', async () => {
    await create(sales, {
      companyName: 'Export BV',
      notes: 'GEHEIM-INTERN',
      fitRationale: 'GEHEIM-REDEN',
    });
    const res = await manager.get('/prospects/export.csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Export BV');
    expect(res.text).not.toContain('GEHEIM');
  });
});

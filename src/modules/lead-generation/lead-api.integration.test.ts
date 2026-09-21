import type { Role, User } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { login, makeUser, resetDb, testEnv } from '../../test/helpers.js';
import { candidate } from '../../test/mock-lead-client.js';
import { validateCandidate } from './validate.js';
import { SEEN_URLS } from '../../test/mock-lead-client.js';

const db = getDb();
const SECRET_KEY = 'sk-ant-GEHEIM-NIET-LEKKEN';
const configured = createApp(
  testEnv({
    ANTHROPIC_API_KEY: SECRET_KEY,
    ANTHROPIC_MODEL_LEAD_RESEARCH: 'claude-opus-5',
    POSTMARK_SERVER_TOKEN: 'pm-GEHEIM-TOKEN',
  }),
);
const unconfigured = createApp(testEnv());
const API = '/tool/api';

async function as(role: Role, app = configured) {
  const user: User = await makeUser(db, role);
  const { cookie, csrf } = await login(db, user);
  return {
    user,
    get: (url: string) => request(app).get(`${API}${url}`).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      request(app).post(`${API}${url}`).set('Cookie', cookie).set('x-csrf-token', csrf).send(body),
  };
}

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

/** Legt een openstaande kandidaat (fuzzy match) vast zoals de leadrun dat doet. */
async function pendingCandidate() {
  const existing = await db.prospect.create({
    data: {
      companyName: 'Bakkerij Smit',
      normalizedName: 'bakkerij smit',
      city: 'Kampen',
      domain: 'bakkerijsmit.nl',
      province: 'OVERIJSSEL',
    },
  });
  const raw = candidate({
    name: 'Bakkerij Smid',
    domain: 'bakkerijsmid.nl',
    linkedin: 'https://www.linkedin.com/company/bakkerij-smid',
    industry: 'retail',
    city: 'Kampen',
  });
  const v = validateCandidate(raw, SEEN_URLS);
  if (!v.ok) throw new Error('fixture ongeldig');
  const run = await db.leadGenerationRun.create({ data: { runKey: 'fixture' } });
  const row = await db.leadCandidate.create({
    data: {
      runId: run.id,
      payload: v.candidate as unknown as object,
      matchedProspectId: existing.id,
      matchReason: 'vergelijkbare naam in dezelfde plaats',
    },
  });
  return { existing, row };
}

describe('reviewqueue', () => {
  it('toont openstaande kandidaten met bestaande en nieuwe gegevens naast elkaar', async () => {
    const { existing } = await pendingCandidate();
    const res = await (await as('VIEWER')).get('/leads/candidates');
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].existing.id).toBe(existing.id);
    expect(res.body.candidates[0].candidate.companyName).toBe('Bakkerij Smid');
  });

  it('voegt een kandidaat toe als nieuw prospect (met bronnen) en sluit hem af', async () => {
    const { row } = await pendingCandidate();
    const res = await (
      await as('SALES')
    ).post(`/leads/candidates/${row.id}/resolve`, { action: 'accept' });
    expect(res.status).toBe(200);
    const created = await db.prospect.findUniqueOrThrow({
      where: { id: res.body.prospectId },
      include: { sources: true },
    });
    expect(created.companyName).toBe('Bakkerij Smid');
    expect(created.sources.length).toBeGreaterThan(0);
    expect((await db.leadCandidate.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'ACCEPTED_AS_NEW',
    );
    // Tweede keer beoordelen kan niet meer.
    expect(
      (await (await as('SALES')).post(`/leads/candidates/${row.id}/resolve`, { action: 'reject' }))
        .status,
    ).toBe(409);
  });

  it('koppelt nieuwe bronnen aan de bestaande prospect zonder een tweede prospect te maken', async () => {
    const { row, existing } = await pendingCandidate();
    const res = await (
      await as('SALES')
    ).post(`/leads/candidates/${row.id}/resolve`, { action: 'attach' });
    expect(res.status).toBe(200);
    expect(await db.prospect.count()).toBe(1);
    expect(await db.prospectSource.count({ where: { prospectId: existing.id } })).toBeGreaterThan(
      0,
    );
    expect((await db.leadCandidate.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'MERGED',
    );
  });

  it('wijst een kandidaat af zonder prospect te maken en logt wie het deed', async () => {
    const { row } = await pendingCandidate();
    const sales = await as('SALES');
    expect(
      (await sales.post(`/leads/candidates/${row.id}/resolve`, { action: 'reject' })).status,
    ).toBe(200);
    expect(await db.prospect.count()).toBe(1);
    expect(await db.leadCandidate.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'REJECTED',
      reviewedBy: sales.user.id,
    });
    expect(await db.auditLog.count({ where: { action: 'lead.review.reject' } })).toBe(1);
  });

  it('weigert accepteren als er inmiddels een exact duplicaat bestaat', async () => {
    const { row } = await pendingCandidate();
    await db.prospect.create({
      data: { companyName: 'Anders', normalizedName: 'anders', domain: 'bakkerijsmid.nl' },
    });
    expect(
      (await (await as('SALES')).post(`/leads/candidates/${row.id}/resolve`, { action: 'accept' }))
        .status,
    ).toBe(409);
  });

  it('vereist schrijfrecht en valideert de actie', async () => {
    const { row } = await pendingCandidate();
    expect(
      (await (await as('VIEWER')).post(`/leads/candidates/${row.id}/resolve`, { action: 'reject' }))
        .status,
    ).toBe(403);
    expect(
      (
        await (
          await as('SALES')
        ).post(`/leads/candidates/${row.id}/resolve`, { action: 'verwijder' })
      ).status,
    ).toBe(400);
    expect(
      (await (await as('SALES')).post('/leads/candidates/onbekend/resolve', { action: 'reject' }))
        .status,
    ).toBe(404);
  });
});

describe('runs starten en bekijken', () => {
  it('laat alleen rollen met lead.run een run starten en plant een manuele job in', async () => {
    expect((await (await as('SALES')).post('/leads/runs')).status).toBe(403);
    const res = await (await as('MANAGER')).post('/leads/runs');
    expect(res.status).toBe(202);
    const job = await db.job.findUniqueOrThrow({ where: { id: res.body.jobId } });
    expect(job).toMatchObject({ type: 'lead-generation', status: 'PENDING' });
    expect(job.payload).toMatchObject({ trigger: 'manual' });
  });

  it('meldt duidelijk dat de functie niet is geconfigureerd zonder job in te plannen', async () => {
    const res = await (await as('MANAGER', unconfigured)).post('/leads/runs');
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({ reason: 'not_configured' });
    expect(await db.job.count()).toBe(0);
  });

  it('toont recente runs zonder interne details', async () => {
    await db.leadGenerationRun.create({
      data: { runKey: 'r1', status: 'SUCCEEDED', acceptedCount: 4, estimatedCostUsd: 1.2345 },
    });
    const res = await (await as('VIEWER')).get('/leads/runs');
    expect(res.body.runs[0]).toMatchObject({ acceptedCount: 4, estimatedCostUsd: 1.2345 });
  });
});

describe('beheer: integratiestatus en schakelaar', () => {
  it('is alleen zichtbaar met settings.manage en toont nooit sleutels of tokens', async () => {
    expect((await (await as('MANAGER')).get('/admin/integrations')).status).toBe(403);
    const res = await (await as('ADMIN')).get('/admin/integrations');
    expect(res.status).toBe(200);
    expect(res.body.anthropic).toMatchObject({ apiKeyPresent: true, leadModel: 'claude-opus-5' });
    expect(res.body.postmark.tokenPresent).toBe(true);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('pm-GEHEIM-TOKEN');
    expect(res.body.leadGeneration).toMatchObject({ enabled: false, configured: true });
  });

  it('schakelt de dagelijkse leadgeneratie in en uit, met auditlog', async () => {
    const admin = await as('ADMIN');
    expect((await admin.post('/admin/leadgen', { enabled: true })).body).toEqual({ enabled: true });
    expect((await admin.get('/admin/integrations')).body.leadGeneration.enabled).toBe(true);
    expect((await (await as('MANAGER')).post('/admin/leadgen', { enabled: false })).status).toBe(
      403,
    );
    expect((await admin.post('/admin/leadgen', { enabled: 'ja' })).status).toBe(400);
    expect(await db.auditLog.count({ where: { action: 'settings.leadgen' } })).toBe(1);
  });
});

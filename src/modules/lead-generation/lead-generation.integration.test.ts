import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../shared/database/client.js';
import { MockLeadClient, candidate } from '../../test/mock-lead-client.js';
import { resetDb } from '../../test/helpers.js';
import { ensurePromptVersion } from './prompt.js';
import { runLeadGeneration, type LeadGenConfig } from './service.js';

const db = getDb();
const NOW = new Date('2026-09-21T08:00:00Z');
const config: LeadGenConfig = {
  model: 'claude-opus-5',
  dailyTarget: 10,
  maxDailyCost: 5,
  maxSearches: 20,
  timezone: 'Europe/Amsterdam',
};
const deps = (client: MockLeadClient, over: Partial<LeadGenConfig> = {}) => ({
  db,
  client,
  config: { ...config, ...over },
  now: () => NOW,
});

const zwaan = () =>
  candidate({
    name: 'Café De Zwaan',
    domain: 'cafedezwaan.nl',
    linkedin: 'https://www.linkedin.com/company/cafe-de-zwaan',
  });
const vos = () =>
  candidate({
    name: 'Installatie Vos',
    domain: 'installatievos.nl',
    linkedin: 'https://www.linkedin.com/company/installatie-vos',
    industry: 'installatietechniek',
    city: 'Hattem',
    province: 'GELDERLAND',
  });

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('dagelijkse leadgeneratie', () => {
  it('slaat geldige kandidaten op met bronnen, socials, kosten en promptversie', async () => {
    const client = new MockLeadClient([zwaan(), vos()]);
    const out = await runLeadGeneration(deps(client), { trigger: 'daily' });

    expect(out).toMatchObject({
      status: 'finished',
      runStatus: 'SUCCEEDED',
      accepted: 2,
      duplicates: 0,
      review: 0,
    });
    const prospects = await db.prospect.findMany({
      include: { sources: true, socials: true },
      orderBy: { companyName: 'asc' },
    });
    expect(prospects).toHaveLength(2);
    const p = prospects.find((x) => x.companyName === 'Café De Zwaan')!;
    expect(p).toMatchObject({
      status: 'NEW',
      domain: 'cafedezwaan.nl',
      province: 'OVERIJSSEL',
      confidence: 'HIGH',
    });
    expect(p.sources.length).toBeGreaterThan(0);
    expect(p.socials[0]?.url).toBe('https://linkedin.com/company/cafe-de-zwaan');
    expect(p.fitRationale).toContain('Waarneming:');
    expect(p.foundByRunId).toBeTruthy();

    const run = await db.leadGenerationRun.findFirstOrThrow({ include: { promptVersion: true } });
    expect(run).toMatchObject({
      status: 'SUCCEEDED',
      runKey: 'daily-2026-09-21',
      acceptedCount: 2,
      model: 'claude-opus-5',
      webSearchRequests: 12,
    });
    expect(run.inputTokens).toBe(70_000);
    // Exact: 70k in + 14k uit op opus-tarief ($5/$25 per Mtok) + 12 zoekopdrachten ($0,01).
    expect(Number(run.estimatedCostUsd)).toBeCloseTo(
      (70_000 * 5 + 14_000 * 25) / 1_000_000 + 12 * 0.01,
      4,
    );
    expect(run.promptVersion?.purpose).toBe('lead-generation');
    // Leadgeneratie verstuurt nooit e-mail en maakt geen concepten aan.
    expect(await db.emailMessage.count()).toBe(0);
    expect(await db.outreachDraft.count()).toBe(0);
  });

  it('is idempotent: een tweede run op dezelfde dag doet niets en roept Anthropic niet aan', async () => {
    const client = new MockLeadClient([zwaan()]);
    await runLeadGeneration(deps(client), { trigger: 'daily' });
    const again = await runLeadGeneration(deps(client), { trigger: 'daily' });
    expect(again).toEqual({ status: 'skipped', reason: 'already_done' });
    expect(client.researchCalls).toHaveLength(1);
    expect(await db.leadGenerationRun.count()).toBe(1);
  });

  it('geeft bestaande domeinen en namen mee aan het model en weigert exacte duplicaten', async () => {
    await db.prospect.create({
      data: {
        companyName: 'Café De Zwaan',
        normalizedName: 'cafe de zwaan',
        city: 'Zwolle',
        domain: 'cafedezwaan.nl',
        status: 'ARCHIVED',
        archivedAt: new Date(),
      },
    });
    const client = new MockLeadClient([zwaan(), vos()]);
    const out = await runLeadGeneration(deps(client), { trigger: 'daily' });
    expect(out).toMatchObject({ accepted: 1, duplicates: 1 });
    expect(client.researchCalls[0]?.user).toContain('cafedezwaan.nl');
    expect(await db.prospect.count()).toBe(2); // ook gearchiveerde prospects tellen als bestaand
  });

  it('zet fuzzy matches in de reviewqueue in plaats van ze automatisch toe te voegen', async () => {
    const existing = await db.prospect.create({
      data: {
        companyName: 'Bakkerij Smit',
        normalizedName: 'bakkerij smit',
        city: 'Kampen',
        domain: 'bakkerijsmit.nl',
      },
    });
    const smid = candidate({
      name: 'Bakkerij Smid',
      domain: 'bakkerijsmid.nl',
      linkedin: 'https://www.linkedin.com/company/bakkerij-smid',
      industry: 'retail',
      city: 'Kampen',
    });
    const out = await runLeadGeneration(deps(new MockLeadClient([smid])), { trigger: 'daily' });
    expect(out).toMatchObject({ accepted: 0, review: 1 });
    expect(await db.prospect.count()).toBe(1);
    const pending = await db.leadCandidate.findMany({ where: { status: 'PENDING' } });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ matchedProspectId: existing.id });
  });

  it('wijst ongeldige kandidaten af en legt de reden vast; twijfelgevallen krijgen status IN_REVIEW', async () => {
    const buitenRegio = candidate({
      name: 'Utrechts Bedrijf',
      domain: 'utrecht-bv.nl',
      linkedin: 'https://www.linkedin.com/company/installatie-vos',
      province: 'OTHER',
    });
    const onbetrouwbaar = candidate({
      name: 'Twijfel BV',
      domain: 'installatievos.nl',
      linkedin: 'https://www.linkedin.com/company/installatie-vos',
      confidence: 'LOW',
    });
    const verzonnen = candidate({
      name: 'Verzonnen BV',
      domain: 'verzonnen-bv.nl',
      linkedin: 'https://www.linkedin.com/company/verzonnen',
      sources: [
        { type: 'OTHER', url: 'https://verzonnen.example/x', title: null, observation: null },
      ],
    });
    const out = await runLeadGeneration(
      deps(new MockLeadClient([buitenRegio, onbetrouwbaar, verzonnen])),
      { trigger: 'daily' },
    );
    expect(out).toMatchObject({ accepted: 1, rejected: 2 });
    const run = await db.leadGenerationRun.findFirstOrThrow();
    const rejected = (run.metadata as { rejected: { name: string; reason: string }[] }).rejected;
    expect(rejected.map((r) => r.name).sort()).toEqual(['Utrechts Bedrijf', 'Verzonnen BV']);
    const twijfel = await db.prospect.findFirstOrThrow({ where: { companyName: 'Twijfel BV' } });
    expect(twijfel.status).toBe('IN_REVIEW');
  });

  it('begrenst het aantal geaccepteerde prospects op het dagdoel', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      candidate({
        name: [
          'Alfa Techniek',
          'Bravo Horeca',
          'Charlie Retail',
          'Delta Garage',
          'Echo Advies',
          'Foxtrot Bouw',
        ][i]!,
        domain: `bedrijf${i}.nl`,
        linkedin: 'https://www.linkedin.com/company/cafe-de-zwaan',
        sources: [
          {
            type: 'WEBSITE',
            url: 'https://cafedezwaan.nl/over-ons',
            title: null,
            observation: null,
          },
        ],
      }),
    );
    // Elk bedrijf heeft een eigen LinkedIn-URL nodig (uniek); gebruik varianten van het toegestane pad.
    many.forEach((c, i) => {
      c.socials = [
        {
          platform: 'LINKEDIN',
          url: `https://www.linkedin.com/company/bedrijf-${i}`,
          accountName: null,
          observations: [],
        },
      ];
    });
    const out = await runLeadGeneration(deps(new MockLeadClient(many), { dailyTarget: 3 }), {
      trigger: 'daily',
    });
    expect(out).toMatchObject({ accepted: 3 });
    expect(await db.prospect.count()).toBe(3);
  });
});

describe('budget en foutafhandeling', () => {
  it('slaat een run over als het dagbudget al is verbruikt', async () => {
    await db.leadGenerationRun.create({
      data: { runKey: 'eerder', status: 'SUCCEEDED', startedAt: NOW, estimatedCostUsd: 5.5 },
    });
    const client = new MockLeadClient([zwaan()]);
    const out = await runLeadGeneration(deps(client), { trigger: 'daily' });
    expect(out).toEqual({ status: 'skipped', reason: 'budget_exceeded' });
    expect(client.researchCalls).toHaveLength(0);
  });

  it('telt echte kosten van eerdere runs mee: een volgende run wordt door het dagbudget geblokkeerd', async () => {
    const first = new MockLeadClient([zwaan()]);
    const out = await runLeadGeneration(deps(first), { trigger: 'daily' });
    expect(out).toMatchObject({ status: 'finished' });
    const spent = Number((await db.leadGenerationRun.findFirstOrThrow()).estimatedCostUsd);
    expect(spent).toBeGreaterThan(0.05); // 70k in + 14k uit + 12 zoekopdrachten op opus-tarief

    const second = new MockLeadClient([vos()]);
    const again = await runLeadGeneration(deps(second, { maxDailyCost: 0.05 }), {
      trigger: 'manual',
    });
    expect(again).toEqual({ status: 'skipped', reason: 'budget_exceeded' });
    expect(second.researchCalls).toHaveLength(0);
  });
  it('legt een technische fout vast, gooit opnieuw en hervat daarna dezelfde run', async () => {
    const client = new MockLeadClient([zwaan()]);
    const ok = client.researchImpl;
    client.researchImpl = async () => {
      throw new Error('overloaded_error: tijdelijk niet beschikbaar');
    };
    await expect(runLeadGeneration(deps(client), { trigger: 'daily' })).rejects.toThrow(
      'overloaded',
    );
    const failed = await db.leadGenerationRun.findFirstOrThrow();
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toContain('overloaded_error');

    client.researchImpl = ok;
    const out = await runLeadGeneration(deps(client), { trigger: 'daily' });
    expect(out).toMatchObject({ status: 'finished', runStatus: 'SUCCEEDED', accepted: 1 });
    expect(await db.leadGenerationRun.count()).toBe(1); // zelfde runKey, geen dubbele run
  });

  it('markeert de run als mislukt als de modeluitvoer niet aan het schema voldoet', async () => {
    const client = new MockLeadClient([]);
    client.extractImpl = async () => ({
      data: { candidates: [{ companyName: 'x' }], notes: '' },
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        webSearchRequests: 0,
        webFetchRequests: 0,
      },
      stopReason: 'end_turn',
    });
    await expect(runLeadGeneration(deps(client), { trigger: 'daily' })).rejects.toThrow('schema');
    expect((await db.leadGenerationRun.findFirstOrThrow()).status).toBe('FAILED');
    expect(await db.prospect.count()).toBe(0);
  });

  it('markeert een onvolledig onderzoek (pause_turn-limiet) als PARTIAL maar bewaart de resultaten', async () => {
    const client = new MockLeadClient([zwaan()], { stopReason: 'pause_turn' });
    const out = await runLeadGeneration(deps(client), { trigger: 'daily' });
    expect(out).toMatchObject({ runStatus: 'PARTIAL', accepted: 1 });
    expect((await db.leadGenerationRun.findFirstOrThrow()).errorMessage).toContain('niet volledig');
  });

  it('bewaart nooit secrets in de run (API-sleutel komt niet in foutmeldingen)', async () => {
    const client = new MockLeadClient([]);
    client.researchImpl = async () => {
      throw new Error('401 invalid x-api-key sk-ant-api03-GEHEIMEWAARDE123');
    };
    await expect(runLeadGeneration(deps(client), { trigger: 'daily' })).rejects.toThrow();
    const run = await db.leadGenerationRun.findFirstOrThrow();
    expect(run.errorMessage).not.toContain('GEHEIMEWAARDE');
    expect(run.errorMessage).toContain('[REDACTED]');
  });
});

describe('promptversies', () => {
  it('hergebruikt dezelfde versie bij ongewijzigde prompt en schema', async () => {
    const a = await ensurePromptVersion(db);
    const b = await ensurePromptVersion(db);
    expect(b).toEqual(a);
    expect(a.version).toBe(1);
    expect(await db.promptVersion.count()).toBe(1);
  });
});

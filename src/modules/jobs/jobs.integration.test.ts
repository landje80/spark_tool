import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../shared/database/client.js';
import { setSetting, SETTING_LEADGEN_ENABLED } from '../../shared/settings.js';
import { resetDb, testEnv } from '../../test/helpers.js';
import { MockLeadClient, candidate } from '../../test/mock-lead-client.js';
import type { JobContext } from './handlers.js';
import { backoffMs, claimNext, enqueue, failJob, MAX_BACKOFF_MS } from './queue.js';
import { processJobs, scheduleDailyJobs } from './runner.js';

const db = getDb();

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('backoff', () => {
  it('groeit exponentieel en is begrensd op één uur', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS);
  });
});

describe('wachtrij', () => {
  it('plant idempotent in via dedupeKey (ook gelijktijdig)', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueue(db, { type: 'x', dedupeKey: 'dag-1' })),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.job.count()).toBe(1);
  });

  it('claimt een job maar één keer, ook bij gelijktijdige workers', async () => {
    await enqueue(db, { type: 'x', dedupeKey: 'a' });
    const now = new Date();
    const claims = await Promise.all(['w1', 'w2', 'w3'].map((w) => claimNext(db, w, now)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = claims.find(Boolean)!;
    expect(job).toMatchObject({ status: 'RUNNING', attempts: 1 });
  });

  it('voert jobs met een toekomstige runAt nog niet uit', async () => {
    await enqueue(db, { type: 'x', dedupeKey: 'later', runAt: new Date(Date.now() + 3600_000) });
    expect(await claimNext(db, 'w', new Date())).toBeNull();
  });

  it('plant een vastgelopen (gecrashte) job opnieuw in', async () => {
    const { job } = await enqueue(db, { type: 'x', dedupeKey: 'crash' });
    const t0 = new Date();
    await claimNext(db, 'oude-worker', t0);
    const later = new Date(t0.getTime() + 121 * 60 * 1000);
    const reclaimed = await claimNext(db, 'nieuwe-worker', later);
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.lockedBy).toBe('nieuwe-worker');
  });

  it('probeert opnieuw met backoff en eindigt als DEAD na het maximum aantal pogingen', async () => {
    const t0 = new Date('2026-09-21T08:00:00Z');
    await enqueue(db, { type: 'x', dedupeKey: 'faalt', maxAttempts: 2, runAt: t0 });
    const first = (await claimNext(db, 'w', t0))!;
    expect(await failJob(db, first, 'boem', t0)).toBe('retry');
    const afterFirst = await db.job.findUniqueOrThrow({ where: { id: first.id } });
    expect(afterFirst.status).toBe('PENDING');
    expect(afterFirst.runAt.getTime()).toBe(t0.getTime() + 60_000);

    expect(await claimNext(db, 'w', new Date(t0.getTime() + 30_000))).toBeNull(); // backoff nog niet voorbij
    const second = (await claimNext(db, 'w', new Date(t0.getTime() + 61_000)))!;
    expect(await failJob(db, second, 'boem 2', t0)).toBe('dead');
    expect(await db.job.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: 'DEAD',
      lastError: 'boem 2',
    });
    expect(await claimNext(db, 'w', new Date(t0.getTime() + 7200_000))).toBeNull();
  });
});

const env = (extra: Record<string, string> = {}) =>
  testEnv({
    ANTHROPIC_API_KEY: 'sk-ant-test-niet-echt',
    ANTHROPIC_MODEL_LEAD_RESEARCH: 'claude-opus-5',
    ...extra,
  });

describe('jobrunner', () => {
  it('verwerkt een leadgeneratie-job met de geïnjecteerde (mock) client', async () => {
    const client = new MockLeadClient([
      candidate({
        name: 'Café De Zwaan',
        domain: 'cafedezwaan.nl',
        linkedin: 'https://www.linkedin.com/company/cafe-de-zwaan',
      }),
    ]);
    const ctx: JobContext = {
      db,
      env: env(),
      now: () => new Date('2026-09-21T08:00:00Z'),
      clientFactory: () => client,
    };
    await enqueue(db, {
      type: 'lead-generation',
      dedupeKey: 'daily-2026-09-21',
      payload: { trigger: 'daily' },
      runAt: new Date('2026-09-21T08:00:00Z'),
    });
    const summary = await processJobs(ctx, { workerId: 't' });
    expect(summary).toEqual({ processed: 1, succeeded: 1, retried: 0, dead: 0 });
    expect(await db.prospect.count()).toBe(1);
    expect((await db.job.findFirstOrThrow()).status).toBe('SUCCEEDED');
  });

  it('laat een falende job opnieuw proberen en uiteindelijk DEAD worden zonder de runner te laten crashen', async () => {
    const client = new MockLeadClient([]);
    client.researchImpl = async () => {
      throw new Error('API down');
    };
    let t = new Date('2026-09-21T08:00:00Z');
    const ctx: JobContext = { db, env: env(), now: () => t, clientFactory: () => client };
    await enqueue(db, {
      type: 'lead-generation',
      dedupeKey: 'daily-x',
      payload: { trigger: 'daily' },
      maxAttempts: 2,
      runAt: t,
    });

    expect(await processJobs(ctx, { workerId: 't' })).toMatchObject({ retried: 1, dead: 0 });
    t = new Date(t.getTime() + 5 * 60_000);
    expect(await processJobs(ctx, { workerId: 't' })).toMatchObject({ retried: 0, dead: 1 });
    const job = await db.job.findFirstOrThrow();
    expect(job).toMatchObject({ status: 'DEAD', attempts: 2 });
    expect(job.lastError).toContain('API down');
  });

  it('markeert onbekende jobtypes als mislukt', async () => {
    await enqueue(db, { type: 'bestaat-niet', dedupeKey: 'k', maxAttempts: 1 });
    const ctx: JobContext = { db, env: env(), now: () => new Date() };
    expect(await processJobs(ctx, { workerId: 't' })).toMatchObject({ dead: 1 });
  });

  it('laat leadgeneratie zichtbaar mislukken als API-sleutel of model ontbreekt (niet stil slagen)', async () => {
    const ctx: JobContext = {
      db,
      env: testEnv(),
      now: () => new Date(),
      clientFactory: () => new MockLeadClient([]),
    };
    await enqueue(db, { type: 'lead-generation', dedupeKey: 'd', payload: { trigger: 'daily' } });
    expect(await processJobs(ctx, { workerId: 't' })).toMatchObject({ succeeded: 0, retried: 1 });
    expect((await db.job.findFirstOrThrow()).lastError).toContain('niet geconfigureerd');
    expect(await db.leadGenerationRun.count()).toBe(0);
  });

  it('ruimt verlopen sessies en oude geslaagde jobs op (onderhoud)', async () => {
    await db.session.create({
      data: { id: 'oud', data: {}, expiresAt: new Date(Date.now() - 1000) },
    });
    await db.session.create({
      data: { id: 'nieuw', data: {}, expiresAt: new Date(Date.now() + 3600_000) },
    });
    await db.job.create({
      data: { type: 'x', status: 'SUCCEEDED', finishedAt: new Date(Date.now() - 40 * 86400_000) },
    });
    await enqueue(db, { type: 'maintenance', dedupeKey: 'm' });
    await processJobs({ db, env: env(), now: () => new Date() }, { workerId: 't' });
    expect(await db.session.findMany({ select: { id: true } })).toEqual([{ id: 'nieuw' }]);
    expect(await db.job.count({ where: { type: 'x' } })).toBe(0);
  });
});

describe('dagelijkse planning', () => {
  const at = (iso: string): JobContext => ({ db, env: env(), now: () => new Date(iso) });

  it('plant vóór 06:30 lokale tijd geen leadrun in, wel onderhoud', async () => {
    await setSetting(db, SETTING_LEADGEN_ENABLED, true);
    const r = await scheduleDailyJobs(at('2026-09-21T04:00:00Z')); // 06:00 Amsterdam
    expect(r).toEqual({ leadGeneration: false, maintenance: true });
  });

  it('plant na 06:30 precies één leadrun per dag in, ook bij herhaald aanroepen', async () => {
    await setSetting(db, SETTING_LEADGEN_ENABLED, true);
    expect((await scheduleDailyJobs(at('2026-09-21T05:00:00Z'))).leadGeneration).toBe(true); // 07:00
    expect((await scheduleDailyJobs(at('2026-09-21T05:10:00Z'))).leadGeneration).toBe(false);
    expect((await scheduleDailyJobs(at('2026-09-22T05:00:00Z'))).leadGeneration).toBe(true); // volgende dag
    expect(await db.job.count({ where: { type: 'lead-generation' } })).toBe(2);
  });

  it('plant niets in als de functie is uitgeschakeld of niet geconfigureerd', async () => {
    expect((await scheduleDailyJobs(at('2026-09-21T05:00:00Z'))).leadGeneration).toBe(false); // uit (standaard)
    await setSetting(db, SETTING_LEADGEN_ENABLED, true);
    const ctx: JobContext = { db, env: testEnv(), now: () => new Date('2026-09-21T05:00:00Z') };
    expect((await scheduleDailyJobs(ctx)).leadGeneration).toBe(false); // geen sleutel/model
  });
});

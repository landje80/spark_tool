import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { login, makeUser, resetDb, testEnv } from '../../test/helpers.js';
import type { JobContext } from './handlers.js';
import { claimNext, enqueue } from './queue.js';
import { processJobs } from './runner.js';

const db = getDb();
const env = (extra: Record<string, string> = {}) =>
  testEnv({
    ANTHROPIC_API_KEY: 'sk-ant-test-niet-echt',
    ANTHROPIC_MODEL_LEAD_RESEARCH: 'claude-opus-5',
    ...extra,
  });

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('vastgelopen jobs', () => {
  it('zet een gecrashte job met verbruikte pogingen op DEAD in plaats van eindeloos opnieuw te plannen', async () => {
    const t0 = new Date('2026-09-21T08:00:00Z');
    await enqueue(db, { type: 'x', dedupeKey: 'crasht', maxAttempts: 1, runAt: t0 });
    const claimed = await claimNext(db, 'w1', t0);
    expect(claimed?.attempts).toBe(1);

    const later = new Date(t0.getTime() + 121 * 60_000);
    expect(await claimNext(db, 'w2', later)).toBeNull();
    const job = await db.job.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(job.status).toBe('DEAD');
    expect(job.lastError).toContain('Vastgelopen');
  });

  it('plant een gecrashte job met resterende pogingen wel opnieuw in', async () => {
    const t0 = new Date('2026-09-21T08:00:00Z');
    await enqueue(db, { type: 'x', dedupeKey: 'crasht2', maxAttempts: 3, runAt: t0 });
    await claimNext(db, 'w1', t0);
    const again = await claimNext(db, 'w2', new Date(t0.getTime() + 121 * 60_000));
    expect(again).toMatchObject({ status: 'RUNNING', attempts: 2, lockedBy: 'w2' });
  });
});

describe('testomgeving gebruikt nooit de echte Anthropic-client', () => {
  it('weigert een leadgeneratie-job zonder geïnjecteerde mock', async () => {
    const ctx: JobContext = { db, env: env(), now: () => new Date() }; // geen clientFactory
    await enqueue(db, {
      type: 'lead-generation',
      dedupeKey: 'zonder-mock',
      payload: { trigger: 'daily' },
    });
    expect(await processJobs(ctx, { workerId: 't' })).toMatchObject({ succeeded: 0, retried: 1 });
    expect((await db.job.findFirstOrThrow()).lastError).toContain('niet toegestaan');
  });
});

describe('handmatige runs via de API', () => {
  const app = createApp(env());
  const as = async (role: 'MANAGER' | 'ADMIN') => {
    const user = await makeUser(db, role);
    const { cookie, csrf } = await login(db, user);
    return (url: string) =>
      request(app).post(`/tool/api${url}`).set('Cookie', cookie).set('x-csrf-token', csrf).send({});
  };

  it('staat maar één openstaande leadrun tegelijk toe (geen betaalde runs spammen)', async () => {
    const post = await as('MANAGER');
    expect((await post('/leads/runs')).status).toBe(202);
    const second = await post('/leads/runs');
    expect(second.status).toBe(409);
    expect(second.body.details).toEqual({ reason: 'already_queued' });
    expect(await db.job.count({ where: { type: 'lead-generation' } })).toBe(1);
  });

  it('plant handmatige runs zonder automatische herhaling (maxAttempts 1)', async () => {
    const post = await as('ADMIN');
    const res = await post('/leads/runs');
    expect((await db.job.findUniqueOrThrow({ where: { id: res.body.jobId } })).maxAttempts).toBe(1);
  });
});

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { resetDb, testEnv } from '../../test/helpers.js';

const db = getDb();
const SECRET = 'cron-secret-'.padEnd(32, 'x');
const URL = '/tool/internal/run-jobs';
const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('HTTP-trigger voor het jobrunner', () => {
  it('antwoordt 503 zolang LEAD_GENERATION_CRON_SECRET niet is ingesteld', async () => {
    const app = createApp(testEnv());
    const res = await request(app).get(URL).set('Authorization', basic('cron', SECRET));
    expect(res.status).toBe(503);
    expect(await db.job.count()).toBe(0);
  });

  it('weigert verzoeken zonder of met verkeerde gegevens (401) en plant niets in', async () => {
    const app = createApp(testEnv({ LEAD_GENERATION_CRON_SECRET: SECRET }));
    const none = await request(app).get(URL);
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toContain('Basic');
    expect((await request(app).get(URL).set('Authorization', basic('cron', 'fout'))).status).toBe(
      401,
    );
    expect(
      (await request(app).get(URL).set('Authorization', basic('postmark', SECRET))).status,
    ).toBe(401);
    expect(await db.job.count()).toBe(0);
  });

  it('start met juiste gegevens een ronde (202) die de dagelijkse onderhoudsjob uitvoert', async () => {
    const app = createApp(testEnv({ LEAD_GENERATION_CRON_SECRET: SECRET }));
    const res = await request(app).get(URL).set('Authorization', basic('cron', SECRET));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ok: true, status: 'started' });

    // De ronde draait op de achtergrond: wacht tot de job is afgerond.
    let status: string | undefined;
    for (let i = 0; i < 50 && status !== 'SUCCEEDED'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = (await db.job.findFirst({ where: { type: 'maintenance' } }))?.status;
    }
    expect(status).toBe('SUCCEEDED');
  });

  it('accepteert ook POST', async () => {
    const app = createApp(testEnv({ LEAD_GENERATION_CRON_SECRET: SECRET }));
    const res = await request(app).post(URL).set('Authorization', basic('cron', SECRET));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 500)); // laat de achtergrondronde eerst afronden
  });
});

import type { Role, User } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { login, makeUser, resetDb, testEnv } from '../../test/helpers.js';

const db = getDb();
const app = createApp(testEnv());
const API = '/tool/api';

async function as(role: Role) {
  const user: User = await makeUser(db, role);
  const { cookie, csrf } = await login(db, user);
  return {
    user,
    get: (url: string) => request(app).get(`${API}${url}`).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      request(app).post(`${API}${url}`).set('Cookie', cookie).set('x-csrf-token', csrf).send(body),
  };
}

const newProspect = (over: Record<string, unknown> = {}) =>
  db.prospect.create({
    data: {
      companyName: 'Café De Zwaan',
      normalizedName: 'cafe de zwaan',
      city: 'Zwolle',
      status: 'QUALIFIED',
      ...over,
    },
  });

beforeEach(async () => {
  await resetDb(db);
});

describe('prospect naar klant omzetten', () => {
  it('zet een gekwalificeerde prospect om en logt de activiteit', async () => {
    const c = await as('MANAGER');
    const prospect = await newProspect();
    const res = await c.post(`/prospects/${prospect.id}/convert-to-customer`, {
      allowedPlatforms: ['LINKEDIN'],
    });
    expect(res.status).toBe(201);
    expect(res.body.prospectId).toBe(prospect.id);

    const updated = await db.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(updated.status).toBe('CUSTOMER');
    const activity = await db.prospectActivity.findFirstOrThrow({
      where: { prospectId: prospect.id, type: 'CONVERTED_TO_CUSTOMER' },
    });
    expect(activity.newValue).toBe('CUSTOMER');
  });

  it('weigert een tweede omzetting van dezelfde prospect', async () => {
    const c = await as('MANAGER');
    const prospect = await newProspect();
    const first = await c.post(`/prospects/${prospect.id}/convert-to-customer`, {
      allowedPlatforms: ['LINKEDIN'],
    });
    expect(first.status).toBe(201);
    const second = await c.post(`/prospects/${prospect.id}/convert-to-customer`, {
      allowedPlatforms: ['LINKEDIN'],
    });
    expect(second.status).toBe(409);
  });

  it('staat gelijktijdige omzetting van dezelfde prospect maar één keer toe (Customer.prospectId is uniek)', async () => {
    const c = await as('MANAGER');
    const prospect = await newProspect();
    const convert = () =>
      c.post(`/prospects/${prospect.id}/convert-to-customer`, { allowedPlatforms: ['LINKEDIN'] });
    const [r1, r2] = await Promise.all([convert(), convert()]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await db.customer.count({ where: { prospectId: prospect.id } })).toBe(1);
  });

  it('weigert omzetting vanuit een status zonder CUSTOMER-overgang (bv. NEW)', async () => {
    const c = await as('MANAGER');
    const prospect = await newProspect({ status: 'NEW' });
    const res = await c.post(`/prospects/${prospect.id}/convert-to-customer`, {
      allowedPlatforms: ['LINKEDIN'],
    });
    expect(res.status).toBe(409);
  });

  it('SALES mag geen klant aanmaken/omzetten (alleen customer.manage)', async () => {
    const c = await as('SALES');
    const prospect = await newProspect();
    const res = await c.post(`/prospects/${prospect.id}/convert-to-customer`, {
      allowedPlatforms: ['LINKEDIN'],
    });
    expect(res.status).toBe(403);
  });

  it('CONTENT_EDITOR mag klanten lezen (content.review) maar niet aanmaken', async () => {
    const c = await as('CONTENT_EDITOR');
    const read = await c.get('/customers');
    expect(read.status).toBe(200);
    const write = await c.post('/customers', { name: 'Nieuw', allowedPlatforms: ['LINKEDIN'] });
    expect(write.status).toBe(403);
  });
});

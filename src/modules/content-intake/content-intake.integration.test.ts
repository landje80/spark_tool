import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Role, User } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { LocalStorage } from '../../integrations/storage/local.js';
import type { StoragePort } from '../../integrations/storage/types.js';
import { createApp } from '../../server/app.js';
import { getDb } from '../../shared/database/client.js';
import { login, makeUser, resetDb, testEnv } from '../../test/helpers.js';

/** Test-double die na `failAfter` geslaagde put()'s de rest laat mislukken (simuleert een opslagstoring halverwege een meerbestandsupload). */
class FlakyStorage implements StoragePort {
  private puts = 0;
  constructor(
    private readonly inner: StoragePort,
    private readonly failAfter: number,
  ) {}
  async put(key: string, data: Buffer) {
    this.puts++;
    if (this.puts > this.failAfter) throw new Error('gesimuleerde opslagstoring');
    return this.inner.put(key, data);
  }
  get(key: string) {
    return this.inner.get(key);
  }
  getStream(key: string) {
    return this.inner.getStream(key);
  }
  delete(key: string) {
    return this.inner.delete(key);
  }
  exists(key: string) {
    return this.inner.exists(key);
  }
}

const db = getDb();
const API = '/tool/api';
let dir: string;

async function as(role: Role, target: ReturnType<typeof createApp>) {
  const user: User = await makeUser(db, role);
  const { cookie, csrf } = await login(db, user);
  return {
    user,
    get: (url: string) => request(target).get(`${API}${url}`).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      request(target)
        .post(`${API}${url}`)
        .set('Cookie', cookie)
        .set('x-csrf-token', csrf)
        .send(body),
  };
}

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } })
    .jpeg()
    .toBuffer();
}

async function newCustomer() {
  return db.customer.create({
    data: { name: 'Café De Zwaan', allowedPlatforms: ['LINKEDIN', 'INSTAGRAM'] },
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-upload-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function app() {
  return createApp(testEnv(), { storage: new LocalStorage(dir) });
}

beforeEach(async () => {
  await resetDb(db);
});

describe('uploadlinks (medewerker)', () => {
  it('maakt een link aan met een eenmalig zichtbaar token', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const res = await c.post(`/customers/${customer.id}/upload-links`, { maxUses: 5 });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.url).toContain(res.body.token);
    const stored = await db.uploadLink.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.tokenHash).not.toBe(res.body.token); // alleen de hash staat in de database
  });

  it('VIEWER mag geen uploadlink aanmaken', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('VIEWER', a);
    const res = await c.post(`/customers/${customer.id}/upload-links`, {});
    expect(res.status).toBe(403);
  });

  it('intrekken maakt de link direct ongeldig', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const created = await c.post(`/customers/${customer.id}/upload-links`, {});
    await c.post(`/upload-links/${created.body.id}/revoke`);
    const res = await request(a).get(`/tool/upload/${created.body.token}`);
    expect(res.status).toBe(404);
    expect(res.text).toContain('niet (meer) geldig');
  });
});

describe('publieke uploadpagina (geen sessie)', () => {
  it('toont het formulier voor een geldige link', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const created = await c.post(`/customers/${customer.id}/upload-links`, {});
    const res = await request(a).get(`/tool/upload/${created.body.token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Café De Zwaan');
    expect(res.text).toContain('/tool/upload/app.js');
  });

  it('toont een generieke foutpagina voor een onbestaand token (geen enumeratie)', async () => {
    const a = app();
    const res = await request(a).get('/tool/upload/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.text).toContain('niet (meer) geldig');
  });

  it('accepteert een geldige inzending met foto en legt een submission + mediaasset vast', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const created = await c.post(`/customers/${customer.id}/upload-links`, {});

    const res = await request(a)
      .post(`/tool/upload/${created.body.token}`)
      .field('topic', 'Terrasfoto')
      .field('note', 'Mooie zonnige dag')
      .field('consent', 'on')
      .attach('files', await jpeg(), 'terras.jpg');
    expect(res.status).toBe(201);
    expect(res.text).toContain('Bedankt');

    const submission = await db.contentSubmission.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    expect(submission.topic).toBe('Terrasfoto');
    expect(submission.status).toBe('RECEIVED');
    const assets = await db.mediaAsset.findMany({ where: { submissionId: submission.id } });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.role).toBe('ORIGINAL');
    expect(assets[0]!.kind).toBe('IMAGE');
    expect(assets[0]!.scanStatus).toBe('PENDING');

    const link = await db.uploadLink.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(link.useCount).toBe(1);

    // De achtergrondjob voor mediaverwerking staat klaar (dedupeKey = submission id).
    const job = await db.job.findUniqueOrThrow({
      where: { type_dedupeKey: { type: 'media-technical-check', dedupeKey: submission.id } },
    });
    expect(job.status).toBe('PENDING');

    // Alleen content.review/customer.manage mag het bestand zelf downloaden; content.upload_link
    // (SALES) mag wél links maken, maar niet automatisch klantmateriaal inzien.
    const salesDownload = await c.get(`/media-assets/${assets[0]!.id}/file`);
    expect(salesDownload.status).toBe(403);
    const reviewer = await as('CONTENT_EDITOR', a);
    const reviewerDownload = await reviewer.get(`/media-assets/${assets[0]!.id}/file`);
    expect(reviewerDownload.status).toBe(200);
  });

  it('weigert zonder toestemmingsvinkje', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const created = await c.post(`/customers/${customer.id}/upload-links`, {});
    const res = await request(a)
      .post(`/tool/upload/${created.body.token}`)
      .attach('files', await jpeg(), 'x.jpg');
    expect(res.status).toBe(400);
    expect(await db.contentSubmission.count()).toBe(0);
  });

  it('weigert een bestand dat geen echte foto/video is (magic bytes), ook al heet het .jpg', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const created = await c.post(`/customers/${customer.id}/upload-links`, {});
    const res = await request(a)
      .post(`/tool/upload/${created.body.token}`)
      .field('consent', 'on')
      .attach('files', Buffer.from('helemaal geen foto'), 'foto.jpg');
    expect(res.status).toBe(400);
    expect(await db.contentSubmission.count()).toBe(0);
    // Niet-passerende inzendingen mogen het linkgebruik niet verbruiken.
    const link = await db.uploadLink.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(link.useCount).toBe(0);
  });

  it('respecteert maxUses: een tweede inzending na het bereiken van de limiet wordt geweigerd', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const created = await c.post(`/customers/${customer.id}/upload-links`, { maxUses: 1 });

    const first = await request(a)
      .post(`/tool/upload/${created.body.token}`)
      .field('consent', 'on')
      .attach('files', await jpeg(), 'a.jpg');
    expect(first.status).toBe(201);

    // Buiten een race blijkt de limiet al bij de eerste controle: net als een verlopen/ingetrokken
    // link levert dit de generieke "link ongeldig"-pagina op (geen enumeratie, zie public-routes.ts).
    const second = await request(a)
      .post(`/tool/upload/${created.body.token}`)
      .field('consent', 'on')
      .attach('files', await jpeg(), 'b.jpg');
    expect(second.status).toBe(404);
    expect(await db.contentSubmission.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it('staat gelijktijdige inzendingen tegen dezelfde eenmalige link maar één keer toe', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('SALES', a);
    const created = await c.post(`/customers/${customer.id}/upload-links`, { maxUses: 1 });
    const img = await jpeg();

    const send = () =>
      request(a)
        .post(`/tool/upload/${created.body.token}`)
        .field('consent', 'on')
        .attach('files', img, 'a.jpg');
    const [r1, r2] = await Promise.all([send(), send()]);
    const statuses = [r1.status, r2.status].sort();
    // De verliezer van de race ziet dezelfde generieke "link ongeldig"-pagina als elke andere
    // ongeldige link; alleen de database (precies één submission) bewijst dat de race goed ging.
    expect(statuses).toEqual([201, 404]);
    expect(await db.contentSubmission.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it('laat bij een opslagstoring halverwege geen submission/wees-bestand achter en verbruikt de link niet', async () => {
    const flaky = createApp(testEnv(), { storage: new FlakyStorage(new LocalStorage(dir), 1) });
    const customer = await newCustomer();
    const c = await as('SALES', flaky);
    const created = await c.post(`/customers/${customer.id}/upload-links`, { maxUses: 1 });

    const res = await request(flaky)
      .post(`/tool/upload/${created.body.token}`)
      .field('consent', 'on')
      .attach('files', await jpeg(), 'a.jpg')
      .attach('files', await jpeg(), 'b.jpg'); // het 2e bestand laat FlakyStorage mislukken
    expect(res.status).toBe(500);
    expect(await db.contentSubmission.count({ where: { customerId: customer.id } })).toBe(0);
    expect(await db.mediaAsset.count()).toBe(0);
    const link = await db.uploadLink.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(link.useCount).toBe(0); // niets echt aangeleverd, dus de eenmalige link is nog bruikbaar
  });
});

describe('merkprofiel', () => {
  it('maakt geversioneerde profielen aan en activeert er telkens maar één', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('MANAGER', a);
    const v1 = await c.post(`/customers/${customer.id}/brand-profiles`, {
      data: { toneOfVoice: 'formeel' },
      activate: true,
    });
    expect(v1.status).toBe(201);
    expect(v1.body.version).toBe(1);
    expect(v1.body.active).toBe(true);

    const v2 = await c.post(`/customers/${customer.id}/brand-profiles`, {
      data: { toneOfVoice: 'vriendelijk' },
      activate: true,
    });
    expect(v2.body.version).toBe(2);

    const profiles = await db.brandProfile.findMany({ where: { customerId: customer.id } });
    expect(profiles.filter((p) => p.active)).toHaveLength(1);
    expect(profiles.find((p) => p.active)!.version).toBe(2);
  });

  it('twee gelijktijdige nieuwe versies krijgen geen dubbel volgnummer en laten maar één actief', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('MANAGER', a);
    const create = () =>
      c.post(`/customers/${customer.id}/brand-profiles`, {
        data: { toneOfVoice: 'x' },
        activate: true,
      });
    const [r1, r2] = await Promise.all([create(), create()]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect([r1.body.version, r2.body.version].sort()).toEqual([1, 2]);

    const profiles = await db.brandProfile.findMany({ where: { customerId: customer.id } });
    expect(profiles.filter((p) => p.active)).toHaveLength(1);
  });

  it('twee gelijktijdige activate-aanroepen op verschillende versies laten maar één actief', async () => {
    const a = app();
    const customer = await newCustomer();
    const c = await as('MANAGER', a);
    const v1 = await c.post(`/customers/${customer.id}/brand-profiles`, {
      data: { toneOfVoice: 'formeel' },
      activate: true,
    });
    const v2 = await c.post(`/customers/${customer.id}/brand-profiles`, {
      data: { toneOfVoice: 'vriendelijk' },
      activate: false,
    });
    const activate = (id: string) =>
      c.post(`/customers/${customer.id}/brand-profiles/${id}/activate`);
    const [r1, r2] = await Promise.all([activate(v1.body.id), activate(v2.body.id)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);

    const profiles = await db.brandProfile.findMany({ where: { customerId: customer.id } });
    expect(profiles.filter((p) => p.active)).toHaveLength(1);
  });
});

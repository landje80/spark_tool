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
    patch: (url: string, body: object = {}) =>
      request(app).patch(`${API}${url}`).set('Cookie', cookie).set('x-csrf-token', csrf).send(body),
  };
}

async function newSubmission(
  status: 'RECEIVED' | 'TECHNICAL_CHECK' | 'DRAFT_READY' = 'TECHNICAL_CHECK',
) {
  const customer = await db.customer.create({
    data: { name: 'Café De Zwaan', allowedPlatforms: ['LINKEDIN', 'INSTAGRAM'] },
  });
  const submission = await db.contentSubmission.create({
    data: { customerId: customer.id, status, topic: 'Terras', consentAt: new Date() },
  });
  return { customer, submission };
}

beforeEach(async () => {
  await resetDb(db);
});

describe('submissiondetail', () => {
  it('GET /submissions/:id serialiseert correct als er media aan hangt (BigInt sizeBytes)', async () => {
    const { submission } = await newSubmission();
    await db.mediaAsset.create({
      data: {
        submissionId: submission.id,
        role: 'ORIGINAL',
        kind: 'IMAGE',
        storageKey: `submissions/${submission.id}/originals/a.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: BigInt(123_456),
        sha256: 'x',
        scanStatus: 'PENDING',
      },
    });
    const c = await as('CONTENT_EDITOR');
    const res = await c.get(`/submissions/${submission.id}`);
    expect(res.status).toBe(200);
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0].id).toBeTruthy();
    expect(res.body.assets[0].sizeBytes).toBeUndefined(); // niet nodig door de client, nooit een BigInt teruggeven
  });
});

describe('conceptgeneratie', () => {
  it('genereert per toegestaan platform een conceptpost (sjabloon in testomgeving)', async () => {
    const { submission } = await newSubmission();
    const c = await as('CONTENT_EDITOR');
    const res = await c.post(`/submissions/${submission.id}/generate-concept`);
    expect(res.status).toBe(201);
    expect(res.body.drafts).toHaveLength(2); // LINKEDIN + INSTAGRAM

    const updated = await db.contentSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(updated.status).toBe('DRAFT_READY');
    const drafts = await db.publicationDraft.findMany({ where: { submissionId: submission.id } });
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.status === 'DRAFT')).toBe(true);
  });

  it('weigert generatie vanuit een status die daar nog niet klaar voor is (RECEIVED)', async () => {
    const { submission } = await newSubmission('RECEIVED');
    const c = await as('CONTENT_EDITOR');
    const res = await c.post(`/submissions/${submission.id}/generate-concept`);
    expect(res.status).toBe(409);
  });

  it('maakt bij hergenereren nieuwe versies aan, niet een duplicaat', async () => {
    const { submission } = await newSubmission();
    const c = await as('CONTENT_EDITOR');
    await c.post(`/submissions/${submission.id}/generate-concept`);
    const again = await c.post(`/submissions/${submission.id}/generate-concept`);
    expect(again.status).toBe(201);
    const concepts = await db.contentConcept.findMany({ where: { submissionId: submission.id } });
    expect(concepts.map((x) => x.version).sort()).toEqual([1, 2]);
    const linkedinDrafts = await db.publicationDraft.findMany({
      where: { submissionId: submission.id, platform: 'LINKEDIN' },
    });
    expect(linkedinDrafts.map((x) => x.version).sort()).toEqual([1, 2]);
  });

  it('voorkomt dat twee gelijktijdige klikken twee keer genereren', async () => {
    const { submission } = await newSubmission();
    const c = await as('CONTENT_EDITOR');
    const [r1, r2] = await Promise.all([
      c.post(`/submissions/${submission.id}/generate-concept`),
      c.post(`/submissions/${submission.id}/generate-concept`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await db.contentConcept.count({ where: { submissionId: submission.id } })).toBe(1);
  });

  it('VIEWER mag geen concept genereren', async () => {
    const { submission } = await newSubmission();
    const c = await as('VIEWER');
    const res = await c.post(`/submissions/${submission.id}/generate-concept`);
    expect(res.status).toBe(403);
  });

  it('SALES (alleen content.upload_link) mag submissions niet lezen', async () => {
    const { submission } = await newSubmission();
    const c = await as('SALES');
    expect((await c.get('/submissions')).status).toBe(403);
    expect((await c.get(`/submissions/${submission.id}`)).status).toBe(403);
  });
});

describe('reviewen van conceptposten', () => {
  async function draftsFor(submissionId: string) {
    const c = await as('CONTENT_EDITOR');
    await c.post(`/submissions/${submissionId}/generate-concept`);
    return db.publicationDraft.findMany({ where: { submissionId } });
  }

  it('bewerken, goedkeuren en de submissionstatus volgt de conceptposten', async () => {
    const { submission } = await newSubmission();
    const drafts = await draftsFor(submission.id);
    const c = await as('CONTENT_EDITOR');

    const edit = await c.patch(`/drafts/${drafts[0]!.id}`, {
      text: 'Aangepaste tekst voor LinkedIn',
      hashtags: ['#spark'],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.text).toBe('Aangepaste tekst voor LinkedIn');

    for (const d of drafts) {
      await c.post(`/drafts/${d.id}/status`, { to: 'APPROVED' });
    }
    const sub = await db.contentSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(sub.status).toBe('APPROVED');
  });

  it('CHANGES_REQUESTED op één post zet de submission op CHANGES_REQUESTED', async () => {
    const { submission } = await newSubmission();
    const drafts = await draftsFor(submission.id);
    const c = await as('CONTENT_EDITOR');
    await c.post(`/drafts/${drafts[0]!.id}/status`, { to: 'APPROVED' });
    await c.post(`/drafts/${drafts[1]!.id}/status`, {
      to: 'CHANGES_REQUESTED',
      feedback: 'Andere foto graag',
    });
    const sub = await db.contentSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(sub.status).toBe('CHANGES_REQUESTED');

    // Een bewerking na "wijzigingen gevraagd" gaat terug naar DRAFT.
    const edit = await c.patch(`/drafts/${drafts[1]!.id}`, { text: 'Nieuwe tekst', hashtags: [] });
    expect(edit.body.status).toBe('DRAFT');
  });

  it('markeert pas "gepubliceerd" na goedkeuring, nooit rechtstreeks vanuit DRAFT', async () => {
    const { submission } = await newSubmission();
    const drafts = await draftsFor(submission.id);
    const c = await as('CONTENT_EDITOR');
    const tooEarly = await c.post(`/drafts/${drafts[0]!.id}/mark-published`);
    expect(tooEarly.status).toBe(409);

    await c.post(`/drafts/${drafts[0]!.id}/status`, { to: 'APPROVED' });
    const ok = await c.post(`/drafts/${drafts[0]!.id}/mark-published`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('PUBLISHED');
  });

  it('submission bereikt PUBLISHED pas als alle actieve conceptposten gepubliceerd zijn', async () => {
    const { submission } = await newSubmission();
    const drafts = await draftsFor(submission.id);
    const c = await as('CONTENT_EDITOR');
    for (const d of drafts) {
      await c.post(`/drafts/${d.id}/status`, { to: 'APPROVED' });
      await c.post(`/drafts/${d.id}/mark-published`);
    }
    const sub = await db.contentSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(sub.status).toBe('PUBLISHED');
  });
});

describe('handmatige submission-stappen', () => {
  it('READY_TO_PUBLISH mag alleen vanuit APPROVED', async () => {
    const { submission } = await newSubmission('DRAFT_READY');
    const c = await as('CONTENT_EDITOR');
    const early = await c.post(`/submissions/${submission.id}/advance`, { to: 'READY_TO_PUBLISH' });
    expect(early.status).toBe(409);

    await db.contentSubmission.update({
      where: { id: submission.id },
      data: { status: 'APPROVED' },
    });
    const ok = await c.post(`/submissions/${submission.id}/advance`, { to: 'READY_TO_PUBLISH' });
    expect(ok.status).toBe(200);
  });

  it('twee gelijktijdige advance-aanroepen op dezelfde submission lukken maar één keer', async () => {
    // De submissionLock + guarded updateMany in advanceSubmission serialiseren dit; zonder dat
    // zouden beide aanroepen de "status === APPROVED"-check kunnen doorstaan.
    const { submission } = await newSubmission('DRAFT_READY');
    await db.contentSubmission.update({
      where: { id: submission.id },
      data: { status: 'APPROVED' },
    });
    const c = await as('CONTENT_EDITOR');
    const advance = () =>
      c.post(`/submissions/${submission.id}/advance`, { to: 'READY_TO_PUBLISH' });
    const [r1, r2] = await Promise.all([advance(), advance()]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });
});

describe('gelijktijdigheid bij het beoordelen van conceptposten', () => {
  async function draftsFor(submissionId: string) {
    const c = await as('CONTENT_EDITOR');
    await c.post(`/submissions/${submissionId}/generate-concept`);
    return db.publicationDraft.findMany({ where: { submissionId } });
  }

  it('twee gelijktijdige goedkeuringen van dezelfde conceptpost lukken maar één keer', async () => {
    // mutateDraft's submissionLock + guarded updateMany (where: status === gelezen status)
    // serialiseren statusovergangen; zonder dat zouden beide DRAFT → APPROVED-aanroepen slagen.
    const { submission } = await newSubmission();
    const drafts = await draftsFor(submission.id);
    const c = await as('CONTENT_EDITOR');
    const approve = () => c.post(`/drafts/${drafts[0]!.id}/status`, { to: 'APPROVED' });
    const [r1, r2] = await Promise.all([approve(), approve()]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(
      (await db.publicationDraft.findUniqueOrThrow({ where: { id: drafts[0]!.id } })).status,
    ).toBe('APPROVED');
  });

  it('een goedkeuring en een gelijktijdige tekstwijziging op dezelfde post botsen niet stilzwijgend', async () => {
    const { submission } = await newSubmission();
    const drafts = await draftsFor(submission.id);
    const c = await as('CONTENT_EDITOR');
    const [approve, edit] = await Promise.all([
      c.post(`/drafts/${drafts[0]!.id}/status`, { to: 'APPROVED' }),
      c.patch(`/drafts/${drafts[0]!.id}`, { text: 'Race-tekst', hashtags: [] }),
    ]);
    // Beide acties gaan uit van status DRAFT; precies één van de twee claimt de rij, de ander krijgt
    // een expliciete 409 in plaats van dat de wijziging van de ander stilzwijgend verdwijnt.
    expect([approve.status, edit.status].sort()).toEqual([200, 409]);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../../integrations/storage/local.js';
import { getDb } from '../../shared/database/client.js';
import { resetDb, testEnv } from '../../test/helpers.js';
import { processMediaAsset, runTechnicalCheck } from './pipeline.js';

const db = getDb();
let dir: string;
let storage: LocalStorage;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-pipeline-test-'));
  storage = new LocalStorage(dir);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb(db);
});

async function newSubmissionWithImage() {
  const customer = await db.customer.create({
    data: { name: 'Café De Zwaan', allowedPlatforms: ['LINKEDIN'] },
  });
  const submission = await db.contentSubmission.create({
    data: { customerId: customer.id, status: 'RECEIVED', consentAt: new Date() },
  });
  const buffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'blue' } })
    .jpeg()
    .toBuffer();
  const key = `submissions/${submission.id}/originals/a.jpg`;
  await storage.put(key, buffer);
  const asset = await db.mediaAsset.create({
    data: {
      submissionId: submission.id,
      role: 'ORIGINAL',
      kind: 'IMAGE',
      storageKey: key,
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(buffer.byteLength),
      sha256: 'x',
      scanStatus: 'PENDING',
    },
  });
  return { submission, asset };
}

describe('processMediaAsset (echte sharp-verwerking)', () => {
  it('genereert een webafgeleide en een thumbnail, en vult de afmetingen van het origineel', async () => {
    const { submission, asset } = await newSubmissionWithImage();
    await processMediaAsset({ db, storage, env: testEnv() }, asset.id);

    const original = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(original.width).toBe(40);
    expect(original.height).toBe(30);
    expect(original.scanStatus).toBe('SKIPPED'); // geen virusscanner geïntegreerd; eerlijk signaal, geen CLEAN

    const children = await db.mediaAsset.findMany({
      where: { submissionId: submission.id, parentId: asset.id },
    });
    expect(children.map((c) => c.role).sort()).toEqual(['DERIVATIVE', 'THUMBNAIL']);
    for (const child of children) {
      expect(await storage.exists(child.storageKey)).toBe(true);
      expect(child.mimeType).toBe('image/webp');
    }
  });

  it('is idempotent: een herhaalde aanroep slaat de al aangemaakte afgeleiden over (geen dubbele sleutel)', async () => {
    const { submission, asset } = await newSubmissionWithImage();
    await processMediaAsset({ db, storage, env: testEnv() }, asset.id);
    await expect(
      processMediaAsset({ db, storage, env: testEnv() }, asset.id),
    ).resolves.not.toThrow();
    const children = await db.mediaAsset.findMany({
      where: { submissionId: submission.id, parentId: asset.id },
    });
    expect(children).toHaveLength(2); // geen duplicaten na de tweede aanroep
  });

  it('doet niets voor een asset die al een afgeleide is (role !== ORIGINAL)', async () => {
    const { submission, asset } = await newSubmissionWithImage();
    await processMediaAsset({ db, storage, env: testEnv() }, asset.id);
    const [derivative] = await db.mediaAsset.findMany({
      where: { submissionId: submission.id, role: 'DERIVATIVE' },
    });
    await expect(
      processMediaAsset({ db, storage, env: testEnv() }, derivative!.id),
    ).resolves.not.toThrow();
    // Geen nieuwe kinderen van een afgeleide aangemaakt.
    const grandchildren = await db.mediaAsset.findMany({ where: { parentId: derivative!.id } });
    expect(grandchildren).toHaveLength(0);
  });
});

describe('runTechnicalCheck', () => {
  it('verwerkt alle originelen en zet de submissionstatus door naar TECHNICAL_CHECK', async () => {
    const { submission } = await newSubmissionWithImage();
    await runTechnicalCheck({ db, storage, env: testEnv() }, submission.id);
    const updated = await db.contentSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(updated.status).toBe('TECHNICAL_CHECK');
  });

  it('laat één mislukt bestand de rest van de submission niet blokkeren', async () => {
    const { submission, asset } = await newSubmissionWithImage();
    // Origineel verwijst naar een niet-bestaande opslagsleutel: storage.get() zal falen.
    await db.mediaAsset.update({
      where: { id: asset.id },
      data: { storageKey: 'submissions/x/y.jpg' },
    });
    await expect(
      runTechnicalCheck({ db, storage, env: testEnv() }, submission.id),
    ).resolves.not.toThrow();
    const updated = await db.contentSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(updated.status).toBe('TECHNICAL_CHECK');
  });
});

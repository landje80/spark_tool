import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MediaAsset, PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import type { StoragePort } from '../../integrations/storage/types.js';
import { logger } from '../../shared/logging/logger.js';
import { makeDerivative, readImageMeta } from './image.js';
import { THUMBNAIL_PRESET, WEB_PRESET } from './presets.js';
import { extractThumbnail, probeVideo } from './video.js';

export interface MediaPipelineDeps {
  db: PrismaClient;
  storage: StoragePort;
  env: Env;
}

const derivativeKey = (original: MediaAsset, variant: string, ext: string): string =>
  `submissions/${original.submissionId}/${original.id}/${variant}.${ext}`;

async function storeChild(
  deps: MediaPipelineDeps,
  original: MediaAsset,
  role: 'DERIVATIVE' | 'THUMBNAIL',
  variant: string,
  data: Buffer,
  mimeType: string,
  ext: string,
  dims: { width: number | null; height: number | null },
): Promise<void> {
  const key = derivativeKey(original, variant, ext);
  await deps.storage.put(key, data);
  await deps.db.mediaAsset.create({
    data: {
      submissionId: original.submissionId,
      parentId: original.id,
      role,
      kind: 'IMAGE',
      storageKey: key,
      mimeType,
      sizeBytes: BigInt(data.byteLength),
      sha256: '', // afgeleiden worden niet apart op inhoud gecontroleerd; het origineel is al gevalideerd
      width: dims.width,
      height: dims.height,
      variant,
      scanStatus: 'SKIPPED',
    },
  });
}

async function processImage(
  deps: MediaPipelineDeps,
  asset: MediaAsset,
  buffer: Buffer,
): Promise<void> {
  const meta = await readImageMeta(buffer);
  if (meta) {
    await deps.db.mediaAsset.update({
      where: { id: asset.id },
      data: { width: meta.width, height: meta.height },
    });
  }
  const web = await makeDerivative(buffer, WEB_PRESET);
  if (web) {
    await storeChild(deps, asset, 'DERIVATIVE', 'web', web.buffer, web.mime, 'webp', web);
  }
  const thumb = await makeDerivative(buffer, THUMBNAIL_PRESET);
  if (thumb) {
    await storeChild(
      deps,
      asset,
      'THUMBNAIL',
      'thumbnail',
      thumb.buffer,
      thumb.mime,
      'webp',
      thumb,
    );
  }
}

async function processVideo(
  deps: MediaPipelineDeps,
  asset: MediaAsset,
  buffer: Buffer,
): Promise<void> {
  // ffmpeg/ffprobe hebben een bestandspad nodig (seeken); dit werkt tegen elke StoragePort-backend
  // omdat we altijd van een Buffer uitgaan, nooit van een lokaal opslagpad.
  const dir = await mkdtemp(path.join(tmpdir(), 'spark-video-'));
  const file = path.join(dir, `${randomUUID()}.bin`);
  try {
    await writeFile(file, buffer);
    const meta = await probeVideo(file, deps.env.FFMPEG_PATH);
    if (meta) {
      await deps.db.mediaAsset.update({
        where: { id: asset.id },
        data: {
          width: meta.width,
          height: meta.height,
          durationSec: Number.isFinite(meta.durationSec) ? meta.durationSec : null,
        },
      });
    }
    const at = meta ? Math.min(1, meta.durationSec / 2) : 0;
    const frame = await extractThumbnail(file, deps.env.FFMPEG_PATH, at);
    if (frame) {
      const dims = await readImageMeta(frame);
      await storeChild(deps, asset, 'THUMBNAIL', 'thumbnail', frame, 'image/jpeg', 'jpg', {
        width: dims?.width ?? null,
        height: dims?.height ?? null,
      });
    } else {
      logger.info(
        { assetId: asset.id },
        'Geen videothumbnail (ffmpeg niet beschikbaar of mislukt)',
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Verwerkt één origineel medium: metadata + afgeleiden (webvriendelijke versie, thumbnail). Elke stap
 * degradeert gracieus (zie image.ts/video.ts) — een ontbrekende sharp/ffmpeg-installatie op de server
 * laat de submission gewoon doorgaan zonder afgeleiden, en crasht de app nooit.
 */
export async function processMediaAsset(deps: MediaPipelineDeps, assetId: string): Promise<void> {
  const asset = await deps.db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.role !== 'ORIGINAL') return; // niets te doen (al verwerkt, of geen origineel)
  // Idempotent: een herhaalde aanroep (bv. na een gedeeltelijk mislukte runTechnicalCheck die wordt
  // herhaald) mag geen tweede keer dezelfde afgeleiden proberen aan te maken — dat zou stuklopen op
  // de unieke opslagsleutel. Al verwerkt (er bestaan al kinderen) → alleen scanStatus bevestigen.
  const alreadyProcessed = await deps.db.mediaAsset.count({ where: { parentId: asset.id } });
  if (alreadyProcessed > 0) {
    if (asset.scanStatus !== 'SKIPPED') {
      await deps.db.mediaAsset.update({ where: { id: asset.id }, data: { scanStatus: 'SKIPPED' } });
    }
    return;
  }
  const buffer = await deps.storage.get(asset.storageKey);
  if (asset.kind === 'IMAGE') await processImage(deps, asset, buffer);
  else await processVideo(deps, asset, buffer);
  // Geen echte virusscanner geïntegreerd (zie docs/security/security-design.md); de MIME is al bij
  // binnenkomst met magic bytes gecontroleerd. SKIPPED is een eerlijk signaal, geen valse "CLEAN".
  await deps.db.mediaAsset.update({ where: { id: asset.id }, data: { scanStatus: 'SKIPPED' } });
}

/** Verwerkt alle originelen van een submission en zet de status door naar TECHNICAL_CHECK. */
export async function runTechnicalCheck(
  deps: MediaPipelineDeps,
  submissionId: string,
): Promise<void> {
  const originals = await deps.db.mediaAsset.findMany({
    where: { submissionId, role: 'ORIGINAL' },
  });
  for (const asset of originals) {
    try {
      await processMediaAsset(deps, asset.id);
    } catch (err) {
      // Eén mislukt bestand mag de rest van de submission niet blokkeren; wel zichtbaar loggen.
      logger.error(
        { assetId: asset.id, err: err instanceof Error ? err.message : 'onbekend' },
        'Mediaverwerking van één bestand mislukt',
      );
    }
  }
  await deps.db.contentSubmission.updateMany({
    where: { id: submissionId, status: 'RECEIVED' },
    data: { status: 'TECHNICAL_CHECK' },
  });
}

import { randomUUID } from 'node:crypto';
import type { MediaKind, PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import type { StoragePort } from '../../integrations/storage/types.js';
import { AppError } from '../../shared/errors/app-error.js';
import { logger } from '../../shared/logging/logger.js';
import { sha256Hex } from '../../shared/security/tokens.js';
import { sniffAndValidate } from '../media-processing/scan.js';
import { enqueue } from '../jobs/queue.js';
import { claimUploadLinkUse, findValidUploadLink } from './upload-links.js';

export interface UploadDeps {
  db: PrismaClient;
  storage: StoragePort;
  env: Env;
}

export interface UploadedFile {
  buffer: Buffer;
  /** Zoals door de browser opgegeven; nooit vertrouwd, alleen als hint voor de MIME-sniff. */
  declaredMime: string;
  originalName: string;
}

const MAX_FILES = 20;

async function cleanupStorage(storage: StoragePort, keys: readonly string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      storage.delete(key).catch((err: unknown) => {
        logger.error(
          { key, err: err instanceof Error ? err.name : 'onbekend' },
          'Kon niet-gebruikt opgeslagen bestand niet opruimen',
        );
      }),
    ),
  );
}

/**
 * Verwerkt een publieke, tokengebonden inzending. Faalt sluitend, in deze volgorde:
 * 1. Elk bestand wordt eerst volledig gevalideerd (magic bytes, grootte) — niets wordt opgeslagen
 *    of geclaimd op basis van ongeldige invoer.
 *    2. Pas daarna gaan de bestanden naar de opslag; mislukt dat halverwege, dan wordt niets van het
 *       linkgebruik verbruikt (de klant kan het gewoon opnieuw proberen) en worden de al geüploade
 *       bestanden weer opgeruimd.
 * 3. Pas na een geslaagde upload wordt het linkgebruik atomair geclaimd.
 * 4. De `ContentSubmission` + alle `MediaAsset`-rijen worden in één transactie aangemaakt, zodat er
 *    nooit een submission met een deel van de bestanden in de database kan blijven staan.
 */
export async function submitContent(
  deps: UploadDeps,
  token: string,
  input: { topic: string | null; note: string | null },
  files: UploadedFile[],
  now: Date,
): Promise<{ submissionId: string }> {
  if (files.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Voeg minstens één foto of video toe');
  }
  if (files.length > MAX_FILES) {
    throw new AppError('VALIDATION_ERROR', `Maximaal ${MAX_FILES} bestanden per keer`);
  }

  const found = await findValidUploadLink(deps.db, token, now);
  if (!found.ok) throw new AppError('NOT_FOUND', 'Deze link is niet (meer) geldig');
  const { link } = found;

  const validated: {
    buffer: Buffer;
    mime: string;
    ext: string;
    kind: MediaKind;
    originalName: string;
  }[] = [];
  for (const f of files) {
    const kindGuess: MediaKind = f.declaredMime.startsWith('video/') ? 'VIDEO' : 'IMAGE';
    const sniff = await sniffAndValidate(f.buffer, kindGuess);
    if (!sniff.ok || !sniff.mime || !sniff.ext) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Bestand "${f.originalName.slice(0, 80)}" is geen ondersteund foto- of videoformaat`,
      );
    }
    const kind: MediaKind = sniff.mime.startsWith('video/') ? 'VIDEO' : 'IMAGE';
    const maxBytes =
      (kind === 'IMAGE' ? deps.env.UPLOAD_MAX_IMAGE_MB : deps.env.UPLOAD_MAX_VIDEO_MB) *
      1024 *
      1024;
    if (f.buffer.byteLength > maxBytes) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Bestand "${f.originalName.slice(0, 80)}" is te groot`,
      );
    }
    validated.push({
      buffer: f.buffer,
      mime: sniff.mime,
      ext: sniff.ext,
      kind,
      originalName: f.originalName,
    });
  }

  // De opslagsleutel hoeft het submission-id niet te bevatten (dat bestaat nog niet); een eigen
  // willekeurige batch-map is genoeg om botsingen te voorkomen. De koppeling loopt via de FK.
  const batchId = randomUUID();
  const uploaded: {
    key: string;
    mime: string;
    kind: MediaKind;
    originalName: string;
    sizeBytes: number;
    sha256: string;
  }[] = [];
  try {
    for (const v of validated) {
      const key = `submissions/${batchId}/originals/${randomUUID()}.${v.ext}`;
      await deps.storage.put(key, v.buffer);
      uploaded.push({
        key,
        mime: v.mime,
        kind: v.kind,
        originalName: v.originalName,
        sizeBytes: v.buffer.byteLength,
        sha256: sha256Hex(v.buffer),
      });
    }
  } catch (err) {
    await cleanupStorage(
      deps.storage,
      uploaded.map((u) => u.key),
    );
    logger.error(
      { err: err instanceof Error ? err.name : 'onbekend' },
      'Opslaan van geüploade bestanden mislukt; linkgebruik niet verbruikt',
    );
    throw new AppError(
      'UPSTREAM_ERROR',
      'Het opslaan van uw bestanden is mislukt. Probeer het opnieuw.',
    );
  }

  // Pas nu claimen: de inzending is inhoudelijk geldig en volledig opgeslagen, dus dit gebruik van
  // de link telt echt mee. Verliest deze aanvraag een race om de laatste toegestane keer, dan gaan
  // de zojuist geüploade bestanden weer weg — er blijft geen wees in de opslag achter.
  const claimed = await claimUploadLinkUse(deps.db, link.id, now);
  if (!claimed) {
    await cleanupStorage(
      deps.storage,
      uploaded.map((u) => u.key),
    );
    throw new AppError('CONFLICT', 'Deze link kan niet meer worden gebruikt', {
      reason: 'link_exhausted',
    });
  }

  let submissionId: string;
  try {
    const submission = await deps.db.$transaction(async (tx) => {
      const created = await tx.contentSubmission.create({
        data: {
          customerId: link.customerId,
          uploadLinkId: link.id,
          topic: input.topic,
          note: input.note,
          consentAt: now,
          status: 'RECEIVED',
        },
      });
      for (const u of uploaded) {
        await tx.mediaAsset.create({
          data: {
            submissionId: created.id,
            role: 'ORIGINAL',
            kind: u.kind,
            storageKey: u.key,
            originalName: u.originalName.slice(0, 255),
            mimeType: u.mime,
            sizeBytes: BigInt(u.sizeBytes),
            sha256: u.sha256,
            scanStatus: 'PENDING',
          },
        });
      }
      return created;
    });
    submissionId = submission.id;
  } catch (err) {
    // De link is al geclaimd (bewuste keuze: het gebruik telde, de klant heeft echt iets aangeleverd);
    // de opgeslagen bestanden zijn nu wees zonder databaserij en worden opgeruimd.
    await cleanupStorage(
      deps.storage,
      uploaded.map((u) => u.key),
    );
    logger.error(
      { err: err instanceof Error ? err.name : 'onbekend' },
      'Aanmaken van de submission na een geldige upload mislukt',
    );
    throw new AppError(
      'UPSTREAM_ERROR',
      'Het verwerken van uw inzending is mislukt. Probeer het opnieuw.',
    );
  }

  await enqueue(deps.db, {
    type: 'media-technical-check',
    dedupeKey: submissionId,
    payload: { submissionId },
  });

  return { submissionId };
}

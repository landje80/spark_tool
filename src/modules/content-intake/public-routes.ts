import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import type { StoragePort } from '../../integrations/storage/types.js';
import { AppError } from '../../shared/errors/app-error.js';
import { escapeHtml, publicPage } from '../../shared/http/public-page.js';
import { logger } from '../../shared/logging/logger.js';
import { publicUploadFormSchema } from './schemas.js';
import { findValidUploadLink } from './upload-links.js';
import { submitContent } from './upload-service.js';
import { UPLOAD_PAGE_SCRIPT } from './upload-page-script.js';

const MAX_FILES = 20;

const invalidLinkPage = (basePath: string) =>
  publicPage(basePath, 'Link ongeldig', '<p>Deze uploadlink is niet (meer) geldig.</p>');

// customerName en error komen uit de database resp. uit validatie-/foutmeldingen en kunnen in
// theorie tekens bevatten die als HTML worden geïnterpreteerd (bv. een klantnaam met '<'); alles
// wat hier terechtkomt wordt daarom altijd eerst geëscaped. Alleen de vaste, letterlijke opmaak
// eromheen is echte HTML.
function uploadForm(basePath: string, customerName: string, error?: string): string {
  const alert = error ? `<p class="alert" role="alert">${escapeHtml(error)}</p>` : '';
  return publicPage(
    basePath,
    'Materiaal aanleveren',
    `<p>Voor <strong>${escapeHtml(customerName)}</strong>. Voeg foto's of video's toe, samen met een korte omschrijving. Een medewerker van Spark bekijkt alles voordat het ergens wordt geplaatst.</p>
    ${alert}
    <form id="upload-form" method="post" enctype="multipart/form-data" novalidate>
      <label for="topic">Onderwerp (kort)</label>
      <input type="text" id="topic" name="topic" maxlength="120" autocomplete="off">
      <label for="note">Omschrijving (optioneel)</label>
      <textarea id="note" name="note" maxlength="4000"></textarea>
      <label for="files">Foto's / video's</label>
      <div class="dropzone">
        <input type="file" id="files" accept="image/*,video/*" multiple aria-describedby="files-hint">
        <p class="hint" id="files-hint">Meerdere bestanden mogelijk. Foto's en video's.</p>
      </div>
      <ul class="filelist" id="filelist"></ul>
      <p class="hint" id="form-status" role="status" aria-live="polite">Nog geen bestanden geselecteerd</p>
      <div class="checkbox">
        <input type="checkbox" id="consent" name="consent" value="on" required>
        <label for="consent" style="margin:0">Ik geef toestemming dat Spark dit materiaal gebruikt om er socialmedia-posts van te maken.</label>
      </div>
      <button type="submit" id="submit-btn">Versturen</button>
    </form>`,
    '/upload/app.js',
  );
}

const thanksPage = (basePath: string) =>
  publicPage(
    basePath,
    'Bedankt!',
    '<p class="success">Uw materiaal is ontvangen. Een medewerker van Spark neemt het door.</p>',
  );

export interface PublicContentIntakeDeps {
  env: Env;
  db: PrismaClient;
  storage: StoragePort;
}

/**
 * Publieke, tokengebonden uploadroute: geen Microsoft-login nodig. Wordt vóór de sessie-/CSRF-
 * middleware gemonteerd, net als de outreach-publieke routes.
 */
export function publicContentIntakeRouter(deps: PublicContentIntakeDeps): Router {
  const r = Router();
  const { env, db, storage } = deps;
  const basePath = env.APP_BASE_PATH;
  const testEnv = env.NODE_ENV === 'test';

  r.get('/upload/app.js', (_req, res) => {
    res
      .set('Cache-Control', 'public, max-age=86400')
      .type('application/javascript')
      .send(UPLOAD_PAGE_SCRIPT);
  });

  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: testEnv ? 100_000 : 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  r.get('/upload/:token', limiter, async (req, res) => {
    const found = await findValidUploadLink(db, String(req.params.token), new Date());
    res.set('Cache-Control', 'no-store').type('html');
    if (!found.ok) return void res.status(404).send(invalidLinkPage(basePath));
    res.send(uploadForm(basePath, found.link.customer.name));
  });

  // Bestanden gaan eerst naar een tijdelijk bestand op schijf, niet naar het geheugen: bij
  // memoryStorage zou multer's `fileSize`-limiet (noodgedwongen het grootste toegestane maximum,
  // want er is vooraf geen betrouwbaar bestandstype bekend) tot MAX_FILES × dat maximum aan RAM per
  // verzoek kunnen opeisen — een goedkope geheugen-DoS op een publieke, niet-ingelogde route.
  // Schijfruimte is ruimer en de OS-bestandscache verwerkt drukte veel beter dan het Node-heap.
  const maxBytes = Math.max(env.UPLOAD_MAX_IMAGE_MB, env.UPLOAD_MAX_VIDEO_MB) * 1024 * 1024;
  const upload = multer({
    storage: multer.diskStorage({
      destination: tmpdir(),
      filename: (_req, _file, cb) => cb(null, `spark-upload-${randomUUID()}`),
    }),
    limits: { fileSize: maxBytes, files: MAX_FILES, fields: 4, fieldSize: 8 * 1024 },
  });

  r.post(
    '/upload/:token',
    limiter,
    (req, res, next) => {
      upload.array('files', MAX_FILES)(req, res, (err: unknown) => {
        if (!err) return next();
        const message =
          err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
            ? 'Een van de bestanden is te groot.'
            : 'Het uploaden is mislukt. Probeer het opnieuw met minder of kleinere bestanden.';
        res.set('Cache-Control', 'no-store').type('html');
        findValidUploadLink(db, String(req.params.token), new Date())
          .then((found) => {
            res
              .status(400)
              .send(
                found.ok
                  ? uploadForm(basePath, found.link.customer.name, message)
                  : invalidLinkPage(basePath),
              );
          })
          .catch((lookupErr: unknown) => {
            logger.error(
              { err: lookupErr instanceof Error ? lookupErr.name : 'onbekend' },
              'Kon uploadlink niet opzoeken na multer-fout',
            );
            res.status(500).send(invalidLinkPage(basePath));
          });
      });
    },
    async (req, res) => {
      const token = String(req.params.token);
      res.set('Cache-Control', 'no-store').type('html');
      const tempFiles = (req.files as Express.Multer.File[] | undefined) ?? [];

      try {
        const parsed = publicUploadFormSchema.safeParse(req.body);
        if (!parsed.success) {
          const found = await findValidUploadLink(db, token, new Date());
          const message =
            parsed.error.issues[0]?.message ?? 'Controleer het formulier en probeer opnieuw.';
          return void res
            .status(400)
            .send(
              found.ok
                ? uploadForm(basePath, found.link.customer.name, message)
                : invalidLinkPage(basePath),
            );
        }

        const files = await Promise.all(
          tempFiles.map(async (f) => ({
            buffer: await readFile(f.path),
            declaredMime: f.mimetype,
            originalName: f.originalname,
          })),
        );
        await submitContent(
          { db, storage, env },
          token,
          { topic: parsed.data.topic ?? null, note: parsed.data.note ?? null },
          files,
          new Date(),
        );
        res.status(201).send(thanksPage(basePath));
      } catch (err) {
        // NOT_FOUND en CONFLICT('link_exhausted') betekenen voor de klant hetzelfde: deze link kan
        // niet (meer) worden gebruikt. Eén generieke pagina voorkomt dat de foutmelding zelf al
        // verraadt of een link ooit heeft bestaan (zie ook outreach/public-routes.ts).
        if (
          err instanceof AppError &&
          (err.code === 'NOT_FOUND' ||
            (err.code === 'CONFLICT' &&
              (err.details as { reason?: string } | undefined)?.reason === 'link_exhausted'))
        ) {
          return void res.status(404).send(invalidLinkPage(basePath));
        }
        const message =
          err instanceof AppError && err.code === 'VALIDATION_ERROR'
            ? err.message
            : 'Het versturen is mislukt. Probeer het opnieuw.';
        if (!(err instanceof AppError)) {
          logger.error({ err: err instanceof Error ? err.name : 'onbekend' }, 'Upload mislukt');
        }
        const found = await findValidUploadLink(db, token, new Date());
        res
          .status(err instanceof AppError && err.code === 'VALIDATION_ERROR' ? 400 : 500)
          .send(
            found.ok
              ? uploadForm(basePath, found.link.customer.name, message)
              : invalidLinkPage(basePath),
          );
      } finally {
        await Promise.all(tempFiles.map((f) => rm(f.path, { force: true }).catch(() => undefined)));
      }
    },
  );

  return r;
}

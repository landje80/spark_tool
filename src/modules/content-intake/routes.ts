import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { StoragePort } from '../../integrations/storage/types.js';
import { requireAnyPermission, requirePermission } from '../auth/middleware.js';
import { parseInput } from '../../shared/validation/parse.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { Actor } from '../prospects/service.js';
import { activateBrandProfile, createBrandProfileVersion } from './brand.js';
import { brandProfileCreateSchema, uploadLinkCreateSchema } from './schemas.js';
import { createUploadLink, revokeUploadLink } from './upload-links.js';

const idParam = z.string().min(1).max(40);
const actorOf = (req: Request): Actor => ({ id: req.user!.id, ip: req.ip });
// Klantmateriaal (foto/video) is gevoeliger dan "mag ik een uploadlink aanmaken": alleen wie content
// mag beoordelen of klanten beheert krijgt het daadwerkelijke bestand te zien, niet elke SALES-
// medewerker met louter `content.upload_link`.
const MEDIA_READ = ['customer.manage', 'content.review'] as const;

export function contentIntakeRouter(env: Env, db: PrismaClient, storage: StoragePort): Router {
  const r = Router();
  const uploadLinkWrite = requirePermission('content.upload_link');
  const customerWrite = requirePermission('customer.manage');
  const mediaRead = requireAnyPermission(MEDIA_READ);

  r.post('/customers/:id/upload-links', uploadLinkWrite, async (req, res) => {
    const customerId = parseInput(idParam, req.params.id);
    const input = parseInput(uploadLinkCreateSchema, req.body);
    const hours = input.expiresInHours ?? env.UPLOAD_TOKEN_TTL_HOURS;
    const { link, token } = await createUploadLink(db, actorOf(req), customerId, {
      campaign: input.campaign ?? null,
      expiresAt: new Date(Date.now() + hours * 3_600_000),
      maxUses: input.maxUses ?? null,
    });
    res.status(201).json({
      id: link.id,
      token,
      url: `${env.APP_BASE_URL}${env.APP_BASE_PATH}/upload/${token}`,
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
      campaign: link.campaign,
    });
  });

  r.post('/upload-links/:id/revoke', uploadLinkWrite, async (req, res) => {
    await revokeUploadLink(db, actorOf(req), parseInput(idParam, req.params.id));
    res.status(204).end();
  });

  r.post('/customers/:id/brand-profiles', customerWrite, async (req, res) => {
    const customerId = parseInput(idParam, req.params.id);
    const input = parseInput(brandProfileCreateSchema, req.body);
    res
      .status(201)
      .json(
        await createBrandProfileVersion(db, actorOf(req), customerId, input.data, input.activate),
      );
  });

  r.post('/customers/:id/brand-profiles/:profileId/activate', customerWrite, async (req, res) => {
    const customerId = parseInput(idParam, req.params.id);
    const profileId = parseInput(idParam, req.params.profileId);
    res.json(await activateBrandProfile(db, actorOf(req), customerId, profileId));
  });

  // Levert het bestand voor voorvertoning in de review-UI. Nooit publiek: alleen medewerkers die
  // content mogen beoordelen of klanten beheren (niet iedereen die alleen uploadlinks mag maken).
  r.get('/media-assets/:id/file', mediaRead, async (req, res) => {
    const id = parseInput(idParam, req.params.id);
    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new AppError('NOT_FOUND', 'Bestand niet gevonden');
    const stream = await storage.getStream(asset.storageKey);
    res
      .set('Cache-Control', 'private, max-age=86400')
      .set('Content-Type', asset.mimeType)
      .set('Content-Disposition', 'inline');
    stream.pipe(res);
  });

  return r;
}

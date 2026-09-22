import type { PrismaClient, UploadLink } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error.js';
import { generateToken, sha256Hex } from '../../shared/security/tokens.js';
import { audit } from '../audit/audit.js';
import type { Actor } from '../prospects/service.js';

export interface CreateUploadLinkInput {
  campaign: string | null;
  expiresAt: Date;
  maxUses: number | null;
}

/**
 * Maakt een uploadlink aan. Het ruwe token wordt precies één keer teruggegeven (in het antwoord op
 * deze aanroep) en daarna nooit meer opgeslagen of getoond — alleen de SHA-256-hash staat in de
 * database, zodat een databaselek geen bruikbare links oplevert.
 */
export async function createUploadLink(
  db: PrismaClient,
  actor: Actor,
  customerId: string,
  input: CreateUploadLinkInput,
): Promise<{ link: UploadLink; token: string }> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw new AppError('NOT_FOUND', 'Klant niet gevonden');
  const token = generateToken(32);
  const link = await db.uploadLink.create({
    data: {
      customerId,
      tokenHash: sha256Hex(token),
      campaign: input.campaign,
      expiresAt: input.expiresAt,
      maxUses: input.maxUses,
      createdBy: actor.id,
    },
  });
  await audit(db, {
    actorId: actor.id,
    action: 'content.upload_link.create',
    entityType: 'UploadLink',
    entityId: link.id,
    ip: actor.ip,
    metadata: { customerId },
  });
  return { link, token };
}

export async function revokeUploadLink(db: PrismaClient, actor: Actor, id: string): Promise<void> {
  const link = await db.uploadLink.findUnique({ where: { id } });
  if (!link) throw new AppError('NOT_FOUND', 'Uploadlink niet gevonden');
  if (link.revokedAt) return; // idempotent
  await db.uploadLink.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, {
    actorId: actor.id,
    action: 'content.upload_link.revoke',
    entityType: 'UploadLink',
    entityId: id,
    ip: actor.ip,
  });
}

export type LinkRejectReason = 'not_found' | 'expired' | 'revoked' | 'max_uses';

/** Alleen voor interne logica/telemetrie; de klant ziet altijd dezelfde generieke "link ongeldig"-tekst. */
export async function findValidUploadLink(
  db: PrismaClient,
  token: string,
  now: Date,
): Promise<
  | { ok: true; link: UploadLink & { customer: { id: string; name: string } } }
  | { ok: false; reason: LinkRejectReason }
> {
  const link = await db.uploadLink.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!link) return { ok: false, reason: 'not_found' };
  if (link.revokedAt) return { ok: false, reason: 'revoked' };
  if (link.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (link.maxUses !== null && link.useCount >= link.maxUses)
    return { ok: false, reason: 'max_uses' };
  return { ok: true, link };
}

/**
 * Claimt één gebruik van de link atomair: de voorwaarden (niet verlopen/ingetrokken/limiet bereikt)
 * worden in dezelfde guarded update herbevestigd, zodat twee gelijktijdige inzendingen elkaar niet
 * over de `maxUses`-grens kunnen duwen (klassiek race-conditiepatroon, zie ook jobs/queue.ts).
 */
export async function claimUploadLinkUse(
  db: PrismaClient,
  linkId: string,
  now: Date,
): Promise<boolean> {
  const link = await db.uploadLink.findUnique({ where: { id: linkId } });
  if (!link || link.revokedAt || link.expiresAt <= now) return false;
  const where =
    link.maxUses === null
      ? { id: linkId, revokedAt: null, expiresAt: { gt: now } }
      : { id: linkId, revokedAt: null, expiresAt: { gt: now }, useCount: { lt: link.maxUses } };
  const claim = await db.uploadLink.updateMany({ where, data: { useCount: { increment: 1 } } });
  return claim.count === 1;
}

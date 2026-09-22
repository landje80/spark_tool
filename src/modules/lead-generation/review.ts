import type { PrismaClient } from '@prisma/client';
import { PROSPECT_WRITE_LOCK, withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { audit } from '../audit/audit.js';
import type { Actor } from '../../shared/security/actor.js';
import { findMatches } from '../prospects/service.js';
import { createProspectFromLead, storedCandidateSchema } from './persist.js';

export type ReviewAction = 'accept' | 'attach' | 'reject';

/** Openstaande kandidaten met de bestaande en nieuwe gegevens naast elkaar. */
export async function listPendingCandidates(db: PrismaClient) {
  const rows = await db.leadCandidate.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const ids = rows.map((r) => r.matchedProspectId).filter((id): id is string => !!id);
  const matched = await db.prospect.findMany({
    where: { id: { in: ids }, anonymizedAt: null },
    select: {
      id: true,
      companyName: true,
      city: true,
      province: true,
      industry: true,
      website: true,
      domain: true,
      status: true,
      employeesMin: true,
      employeesMax: true,
      socials: { select: { platform: true, url: true } },
    },
  });
  return rows.flatMap((r) => {
    const candidate = storedCandidateSchema.safeParse(r.payload);
    if (!candidate.success) return []; // beschadigde payload wordt niet getoond of verwerkt
    return [
      {
        id: r.id,
        createdAt: r.createdAt,
        matchReason: r.matchReason,
        candidate: candidate.data,
        existing: matched.find((m) => m.id === r.matchedProspectId) ?? null,
      },
    ];
  });
}

export async function resolveCandidate(
  db: PrismaClient,
  actor: Actor,
  id: string,
  action: ReviewAction,
) {
  return db.$transaction(
    (tx) =>
      withNamedLock(tx, PROSPECT_WRITE_LOCK, async () => {
        const row = await tx.leadCandidate.findUnique({ where: { id } });
        if (!row) throw new AppError('NOT_FOUND', 'Kandidaat niet gevonden');
        if (row.status !== 'PENDING') throw new AppError('CONFLICT', 'Kandidaat is al beoordeeld');
        const parsed = storedCandidateSchema.safeParse(row.payload);
        if (!parsed.success) throw new AppError('CONFLICT', 'Kandidaatgegevens zijn beschadigd');
        const candidate = parsed.data;
        const now = new Date();
        let prospectId: string | null = null;

        if (action === 'accept') {
          // Een exact duplicaat dat sinds het onderzoek is ontstaan blokkeert nog steeds.
          const exact = (
            await findMatches(tx, {
              companyName: candidate.companyName,
              website: candidate.website,
              city: candidate.city,
              phone: candidate.phone,
              socialUrls: candidate.socials.map((s) => s.url),
            })
          ).some((m) => m.kind === 'exact');
          if (exact) throw new AppError('CONFLICT', 'Dit bedrijf bestaat inmiddels al in het CRM');
          const p = await createProspectFromLead(tx, candidate, {
            runId: null,
            actorId: actor.id,
            now,
          });
          prospectId = p.id;
        }

        if (action === 'attach') {
          if (!row.matchedProspectId)
            throw new AppError('CONFLICT', 'Geen bestaande prospect om aan te koppelen');
          const target = await tx.prospect.findUnique({
            where: { id: row.matchedProspectId },
            select: { id: true, anonymizedAt: true },
          });
          if (!target || target.anonymizedAt)
            throw new AppError('NOT_FOUND', 'Bestaande prospect niet gevonden');
          const knownSources = new Set(
            (
              await tx.prospectSource.findMany({
                where: { prospectId: target.id },
                select: { url: true },
              })
            ).map((s) => s.url),
          );
          const newSources = candidate.sources.filter(
            (s) => !knownSources.has(s.url.slice(0, 1000)),
          );
          if (newSources.length) {
            await tx.prospectSource.createMany({
              data: newSources.map((s) => ({
                prospectId: target.id,
                type: ([
                  'WEBSITE',
                  'LINKEDIN',
                  'FACEBOOK',
                  'INSTAGRAM',
                  'TIKTOK',
                  'DIRECTORY',
                  'NEWS',
                ].includes(s.type)
                  ? s.type
                  : 'OTHER') as 'OTHER',
                url: s.url.slice(0, 1000),
                title: s.title?.slice(0, 300) ?? null,
                checkedAt: now,
                observation: s.observation,
                confidence: candidate.confidence,
              })),
            });
          }
          await tx.prospect.update({ where: { id: target.id }, data: { lastVerifiedAt: now } });
          await tx.prospectActivity.create({
            data: {
              prospectId: target.id,
              type: 'NOTE',
              actorId: actor.id,
              description: `Nieuwe informatie uit leadonderzoek gekoppeld (${newSources.length} bron(nen))`,
            },
          });
          prospectId = target.id;
        }

        await tx.leadCandidate.update({
          where: { id },
          data: {
            status:
              action === 'accept' ? 'ACCEPTED_AS_NEW' : action === 'attach' ? 'MERGED' : 'REJECTED',
            reviewedBy: actor.id,
            reviewedAt: now,
          },
        });
        await audit(tx, {
          actorId: actor.id,
          action: `lead.review.${action}`,
          entityType: 'LeadCandidate',
          entityId: id,
          ip: actor.ip,
        });
        return { id, action, prospectId };
      }),
    { timeout: 30_000 },
  );
}

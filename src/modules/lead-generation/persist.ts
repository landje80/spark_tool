import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import { normalizeCompanyName, normalizeDomain, normalizePhone } from '../prospects/normalize.js';
import type { CleanCandidate } from './validate.js';

/** Vorm van een opgeslagen kandidaat (LeadCandidate.payload); opnieuw gevalideerd bij het lezen. */
export const storedCandidateSchema = z.object({
  companyName: z.string(),
  city: z.string(),
  province: z.enum(['OVERIJSSEL', 'DRENTHE', 'GELDERLAND', 'FLEVOLAND']),
  industry: z.string(),
  website: z.string(),
  domain: z.string(),
  phone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  employeesMin: z.number().nullable(),
  employeesMax: z.number().nullable(),
  employeesRationale: z.string(),
  employeesSourceUrl: z.string().nullable(),
  socials: z.array(
    z.object({
      platform: z.string(),
      url: z.string(),
      accountName: z.string().nullable(),
      observations: z.array(z.string()),
    }),
  ),
  observations: z.array(
    z.object({ kind: z.enum(['waarneming', 'interpretatie']), text: z.string() }),
  ),
  sparkFit: z.string(),
  outreachAngle: z.string(),
  fitScore: z.number(),
  sources: z.array(
    z.object({
      type: z.string(),
      url: z.string(),
      title: z.string().nullable(),
      observation: z.string().nullable(),
    }),
  ),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  duplicateSignals: z.array(z.string()),
  reviewReasons: z.array(z.string()),
});

const SOURCE_TYPES = new Set([
  'WEBSITE',
  'LINKEDIN',
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'DIRECTORY',
  'NEWS',
  'OTHER',
]);
const PLATFORMS = new Set(['LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK']);

/** Onderbouwing als leesbare tekst: waarnemingen en interpretaties afzonderlijk benoemd. */
export function rationaleOf(c: CleanCandidate): string {
  const lines = [c.sparkFit];
  for (const o of c.observations)
    lines.push(`${o.kind === 'waarneming' ? 'Waarneming' : 'Interpretatie'}: ${o.text}`);
  return lines.filter(Boolean).join('\n');
}

/** Maakt een prospect met bronnen en sociale profielen. Aanroepen binnen de PROSPECT_WRITE_LOCK-transactie. */
export async function createProspectFromLead(
  tx: Prisma.TransactionClient,
  c: CleanCandidate,
  ctx: { runId: string | null; actorId?: string | null; now: Date },
) {
  const prospect = await tx.prospect.create({
    data: {
      companyName: c.companyName,
      normalizedName: normalizeCompanyName(c.companyName),
      website: c.website,
      domain: normalizeDomain(c.website),
      phone: normalizePhone(c.phone) ?? c.phone,
      contactEmail: c.contactEmail,
      city: c.city,
      province: c.province,
      industry: c.industry,
      employeesMin: c.employeesMin,
      employeesMax: c.employeesMax,
      employeesRationale: c.employeesRationale || null,
      employeesSourceUrl: c.employeesSourceUrl,
      fitScore: c.fitScore,
      fitRationale: rationaleOf(c) || null,
      outreachAngle: c.outreachAngle || null,
      confidence: c.confidence,
      // Twijfelgevallen wachten op menselijke beoordeling voordat er opvolging plaatsvindt.
      status: c.reviewReasons.length > 0 ? 'IN_REVIEW' : 'NEW',
      foundByRunId: ctx.runId,
      lastVerifiedAt: ctx.now,
      sources: {
        create: c.sources.map((s) => ({
          type: (SOURCE_TYPES.has(s.type) ? s.type : 'OTHER') as 'OTHER',
          url: s.url.slice(0, 1000),
          title: s.title?.slice(0, 300) ?? null,
          checkedAt: ctx.now,
          observation: s.observation,
          confidence: c.confidence,
        })),
      },
      socials: {
        create: c.socials
          .filter((s) => PLATFORMS.has(s.platform))
          .map((s) => ({
            platform: s.platform as 'LINKEDIN',
            url: s.url.slice(0, 500),
            accountName: s.accountName?.slice(0, 200) ?? null,
            checkedAt: ctx.now,
            observations: s.observations,
          })),
      },
    },
  });
  await tx.prospectActivity.create({
    data: {
      prospectId: prospect.id,
      type: 'CREATED',
      actorId: ctx.actorId ?? null,
      description: ctx.runId
        ? 'Gevonden door leadgeneratie'
        : 'Toegevoegd na beoordeling van leadgeneratie',
      metadata: c.reviewReasons.length ? { reviewReasons: c.reviewReasons } : undefined,
    },
  });
  await audit(tx, {
    actorId: ctx.actorId ?? null,
    action: 'lead.accept',
    entityType: 'Prospect',
    entityId: prospect.id,
    metadata: { runId: ctx.runId, review: c.reviewReasons.length > 0 },
  });
  return prospect;
}

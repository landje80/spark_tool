import type { PrismaClient, PublicationPlatform, SubmissionStatus } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { withNamedLock } from '../../shared/database/lock.js';
import { ensurePromptVersion } from '../../shared/database/prompt-version.js';
import { AppError } from '../../shared/errors/app-error.js';
import { safeError } from '../../shared/errors/safe-error.js';
import type { Actor } from '../prospects/service.js';
import { audit } from '../audit/audit.js';
import { CONCEPT_SYSTEM_PROMPT, CONTENT_PROMPT_PURPOSE, conceptSchemaJson } from './prompt.js';
import type { ConceptWriter } from './writer.js';

/** Serialiseert het aanmaken van een nieuwe PromptVersion; voorkomt een P2002-race als twee
 *  submissions tegelijk voor het eerst met een gewijzigde prompt genereren (zie lead-generation
 *  voor hetzelfde patroon, daar via LEADGEN_CLAIM_LOCK). */
const CONTENT_PROMPT_LOCK = 'spark:content-prompt-version';

export interface PublishingDeps {
  db: PrismaClient;
  writer: ConceptWriter;
  env: Env;
}

/** Statussen van waaruit een (nieuw) concept mag worden gegenereerd. */
const GENERATABLE: readonly SubmissionStatus[] = [
  'TECHNICAL_CHECK',
  'DRAFT_READY',
  'CHANGES_REQUESTED',
  'FAILED',
];

/**
 * Genereert een nieuw contentconcept + per-platform conceptposten voor een submission. Vervangt geen
 * eerder goedgekeurde/gepubliceerde posten: elke aanroep maakt nieuwe versies aan (zie service.ts van
 * outreach voor hetzelfde idempotentie-/traceerbaarheidspatroon).
 */
export async function generateConcept(deps: PublishingDeps, actor: Actor, submissionId: string) {
  const { db } = deps;
  const submission = await db.contentSubmission.findUnique({
    where: { id: submissionId },
    include: { customer: true, assets: { where: { role: 'ORIGINAL' } } },
  });
  if (!submission) throw new AppError('NOT_FOUND', 'Aanlevering niet gevonden');
  if (!GENERATABLE.includes(submission.status)) {
    throw new AppError('CONFLICT', 'Voor deze status kan geen concept worden gegenereerd', {
      reason: 'invalid_status',
    });
  }
  // Claim: voorkomt dat twee gelijktijdige klikken twee keer (en twee keer AI-kosten) genereren.
  const claim = await db.contentSubmission.updateMany({
    where: { id: submissionId, status: submission.status },
    data: { status: 'PROCESSING' },
  });
  if (claim.count !== 1) {
    throw new AppError('CONFLICT', 'Er wordt al een concept gegenereerd', {
      reason: 'in_progress',
    });
  }

  try {
    const brandProfile = await db.brandProfile.findFirst({
      where: { customerId: submission.customerId, active: true },
    });
    const out = await deps.writer.write({
      customerName: submission.customer.name,
      allowedPlatforms: submission.customer.allowedPlatforms as PublicationPlatform[],
      brandProfile: brandProfile?.data ?? null,
      topic: submission.topic,
      note: submission.note,
      imageCount: submission.assets.filter((a) => a.kind === 'IMAGE').length,
      videoCount: submission.assets.filter((a) => a.kind === 'VIDEO').length,
    });

    const result = await db.$transaction(async (tx) => {
      const promptVersion =
        deps.writer.name === 'template'
          ? null
          : await withNamedLock(tx, CONTENT_PROMPT_LOCK, () =>
              ensurePromptVersion(
                tx,
                CONTENT_PROMPT_PURPOSE,
                CONCEPT_SYSTEM_PROMPT,
                conceptSchemaJson(),
              ),
            );
      const lastConcept = await tx.contentConcept.aggregate({
        where: { submissionId },
        _max: { version: true },
      });
      const concept = await tx.contentConcept.create({
        data: {
          submissionId,
          version: (lastConcept._max.version ?? 0) + 1,
          summary: out.summary.slice(0, 4000),
          missingContext: out.missingContext,
          model: deps.writer.name.slice(0, 100),
          promptVersionId: promptVersion?.id ?? null,
        },
      });
      const drafts = [];
      for (const d of out.drafts) {
        const lastDraft = await tx.publicationDraft.aggregate({
          where: { submissionId, platform: d.platform },
          _max: { version: true },
        });
        drafts.push(
          await tx.publicationDraft.create({
            data: {
              submissionId,
              platform: d.platform,
              version: (lastDraft._max.version ?? 0) + 1,
              text: d.text.slice(0, 3000),
              hashtags: d.hashtags.slice(0, 15),
              cta: d.cta ? d.cta.slice(0, 300) : null,
              altText: d.altText ? d.altText.slice(0, 500) : null,
              status: 'DRAFT',
            },
          }),
        );
      }
      await tx.contentSubmission.update({
        where: { id: submissionId },
        data: { status: 'DRAFT_READY', failureReason: null },
      });
      await audit(tx, {
        actorId: actor.id,
        action: 'content.generate_concept',
        entityType: 'ContentSubmission',
        entityId: submissionId,
        ip: actor.ip,
        metadata: { writer: deps.writer.name, drafts: drafts.length },
      });
      return { concept, drafts };
    });
    return result;
  } catch (err) {
    await db.contentSubmission.update({
      where: { id: submissionId },
      data: { status: 'FAILED', failureReason: safeError(err) },
    });
    throw err instanceof AppError
      ? err
      : new AppError('UPSTREAM_ERROR', 'Kon geen concept genereren');
  }
}

export async function getSubmissionDetail(db: PrismaClient, id: string) {
  const submission = await db.contentSubmission.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, allowedPlatforms: true } },
      uploadLink: { select: { id: true, campaign: true } },
      // Expliciete select i.p.v. alle kolommen: MediaAsset.sizeBytes is een BigInt, dat Express'
      // res.json() niet kan serialiseren (geen ingebouwde toJSON) en dus met een 500 zou laten
      // crashen zodra een submission media heeft. sha256 is intern en hoeft niet naar de client.
      assets: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          kind: true,
          parentId: true,
          originalName: true,
          mimeType: true,
          width: true,
          height: true,
          durationSec: true,
          scanStatus: true,
          createdAt: true,
        },
      },
      concepts: { orderBy: { version: 'desc' }, take: 5 },
      drafts: { orderBy: [{ platform: 'asc' }, { version: 'desc' }] },
    },
  });
  if (!submission) throw new AppError('NOT_FOUND', 'Aanlevering niet gevonden');
  return submission;
}

export async function listSubmissions(
  db: PrismaClient,
  q: { page: number; pageSize: number; status?: string; customerId?: string },
) {
  const where = {
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
  };
  const [total, items] = await Promise.all([
    db.contentSubmission.count({ where }),
    db.contentSubmission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        status: true,
        topic: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
        _count: { select: { assets: true, drafts: true } },
      },
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items };
}

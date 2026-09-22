import type {
  Prisma,
  PrismaClient,
  PublicationDraft,
  PublicationStatus,
  SubmissionStatus,
} from '@prisma/client';
import { withNamedLock } from '../../shared/database/lock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { audit } from '../audit/audit.js';
import type { Actor } from '../prospects/service.js';
import { assertTransitionDraft, recalcSubmissionStatus } from './status.js';

type Db = Prisma.TransactionClient;

/** Serialiseert reviewacties per submission (niet globaal): concurrente acties op conceptposten van
 *  verschillende submissions hinderen elkaar niet, maar twee gelijktijdige acties op dezelfde
 *  submission (bv. twee platformposten tegelijk goedkeuren) doen dat wel — nodig omdat de
 *  submissionstatus wordt afgeleid uit *alle* conceptposten samen (recalcSubmissionStatus). */
const submissionLock = (submissionId: string) => `spark:content-submission:${submissionId}`;

async function loadDraft(db: Db, id: string): Promise<PublicationDraft> {
  const draft = await db.publicationDraft.findUnique({ where: { id } });
  if (!draft) throw new AppError('NOT_FOUND', 'Conceptpost niet gevonden');
  return draft;
}

/** Herberekent en schrijft de submissionstatus na een wijziging aan één van de conceptposten. */
async function syncSubmissionStatus(db: Db, submissionId: string): Promise<void> {
  const [submission, drafts] = await Promise.all([
    db.contentSubmission.findUnique({ where: { id: submissionId }, select: { status: true } }),
    db.publicationDraft.findMany({ where: { submissionId }, select: { status: true } }),
  ]);
  if (!submission) return;
  const next = recalcSubmissionStatus(submission.status, drafts);
  if (next !== submission.status) {
    await db.contentSubmission.update({ where: { id: submissionId }, data: { status: next } });
  }
}

/**
 * Gedeelde kern voor elke reviewactie op een conceptpost: leest de post, laat de aanroeper valideren
 * en de nieuwe velden bepalen, past die toe via een guarded update (voorkomt dat een gelijktijdige
 * wijziging ongemerkt wordt overschreven — TOCTOU), herberekent de submissionstatus en logt, alles
 * in één transactie met een lock per submission.
 */
async function mutateDraft(
  db: PrismaClient,
  id: string,
  validate: (draft: PublicationDraft) => void,
  data: (draft: PublicationDraft) => Prisma.PublicationDraftUpdateInput,
  audit_: (tx: Db, draft: PublicationDraft) => Promise<void>,
): Promise<PublicationDraft> {
  return db.$transaction(async (tx) => {
    const draft = await loadDraft(tx, id);
    validate(draft);
    return withNamedLock(tx, submissionLock(draft.submissionId), async () => {
      const claim = await tx.publicationDraft.updateMany({
        where: { id, status: draft.status },
        data: data(draft),
      });
      if (claim.count !== 1) {
        throw new AppError('CONFLICT', 'Deze conceptpost is intussen door iemand anders gewijzigd');
      }
      const updated = await tx.publicationDraft.findUniqueOrThrow({ where: { id } });
      await syncSubmissionStatus(tx, draft.submissionId);
      await audit_(tx, updated);
      return updated;
    });
  });
}

export interface DraftEdit {
  text: string;
  hashtags: string[];
  cta: string | null;
  altText: string | null;
}

/** Bewerken mag zolang de post nog niet is goedgekeurd/gepubliceerd; een bewerking na "wijzigingen
 *  gevraagd" telt als een nieuwe indiening en gaat terug naar DRAFT. */
export async function updateDraft(db: PrismaClient, actor: Actor, id: string, input: DraftEdit) {
  return mutateDraft(
    db,
    id,
    (draft) => {
      if (!['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED'].includes(draft.status)) {
        throw new AppError('CONFLICT', 'Deze conceptpost kan niet meer worden gewijzigd');
      }
    },
    (draft) => ({
      text: input.text,
      hashtags: input.hashtags,
      cta: input.cta,
      altText: input.altText,
      status: draft.status === 'CHANGES_REQUESTED' ? 'DRAFT' : draft.status,
    }),
    (tx, updated) =>
      audit(tx, {
        actorId: actor.id,
        action: 'publishing.draft.update',
        entityType: 'PublicationDraft',
        entityId: updated.id,
        ip: actor.ip,
      }),
  );
}

export async function setDraftStatus(
  db: PrismaClient,
  actor: Actor,
  id: string,
  to: Extract<PublicationStatus, 'IN_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISCARDED'>,
  feedback: string | null,
) {
  return mutateDraft(
    db,
    id,
    (draft) => assertTransitionDraft(draft.status, to),
    (draft) => ({
      status: to,
      feedback: feedback ?? (to === 'CHANGES_REQUESTED' ? draft.feedback : null),
      reviewerId: actor.id,
    }),
    (tx, updated) =>
      audit(tx, {
        actorId: actor.id,
        action: `publishing.draft.${to.toLowerCase()}`,
        entityType: 'PublicationDraft',
        entityId: updated.id,
        ip: actor.ip,
      }),
  );
}

/**
 * Registreert dat de medewerker deze post zelf, handmatig op het platform heeft geplaatst. Er is
 * bewust geen geautomatiseerde publicatie (zie publishing/adapter.ts): dit is een eerlijke, expliciete
 * bevestiging achteraf, geen "publiceer nu"-knop.
 */
export async function markDraftPublished(db: PrismaClient, actor: Actor, id: string) {
  return mutateDraft(
    db,
    id,
    (draft) => assertTransitionDraft(draft.status, 'PUBLISHED'),
    () => ({ status: 'PUBLISHED' }),
    (tx, updated) =>
      audit(tx, {
        actorId: actor.id,
        action: 'publishing.draft.mark_published',
        entityType: 'PublicationDraft',
        entityId: updated.id,
        ip: actor.ip,
      }),
  );
}

/** Handmatige submission-stappen die niet uit de conceptposten worden afgeleid. */
export async function advanceSubmission(
  db: PrismaClient,
  actor: Actor,
  id: string,
  to: 'READY_TO_PUBLISH' | 'ARCHIVED',
) {
  const allowed: Record<'READY_TO_PUBLISH' | 'ARCHIVED', readonly SubmissionStatus[]> = {
    READY_TO_PUBLISH: ['APPROVED'],
    ARCHIVED: ['PUBLISHED', 'FAILED'],
  };
  return db.$transaction(async (tx) => {
    return withNamedLock(tx, submissionLock(id), async () => {
      const submission = await tx.contentSubmission.findUnique({ where: { id } });
      if (!submission) throw new AppError('NOT_FOUND', 'Aanlevering niet gevonden');
      const claim = await tx.contentSubmission.updateMany({
        where: { id, status: { in: [...allowed[to]] } },
        data: { status: to },
      });
      if (claim.count !== 1) {
        throw new AppError(
          'INVALID_TRANSITION',
          `Overgang ${submission.status} → ${to} is niet toegestaan`,
        );
      }
      const updated = await tx.contentSubmission.findUniqueOrThrow({ where: { id } });
      await audit(tx, {
        actorId: actor.id,
        action: 'content.submission.advance',
        entityType: 'ContentSubmission',
        entityId: id,
        ip: actor.ip,
        metadata: { to },
      });
      return updated;
    });
  });
}

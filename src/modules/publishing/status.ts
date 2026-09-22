import type { PublicationStatus, SubmissionStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error.js';

const DRAFT_TRANSITIONS: Record<PublicationStatus, readonly PublicationStatus[]> = {
  DRAFT: ['IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'DISCARDED'],
  IN_REVIEW: ['APPROVED', 'CHANGES_REQUESTED', 'DISCARDED'],
  CHANGES_REQUESTED: ['DRAFT', 'IN_REVIEW', 'DISCARDED'],
  APPROVED: ['PUBLISHED', 'CHANGES_REQUESTED', 'DISCARDED'],
  PUBLISHED: [],
  DISCARDED: [],
};

export function canTransitionDraft(from: PublicationStatus, to: PublicationStatus): boolean {
  return from === to || DRAFT_TRANSITIONS[from].includes(to);
}

export function assertTransitionDraft(from: PublicationStatus, to: PublicationStatus): void {
  if (!canTransitionDraft(from, to)) {
    throw new AppError('INVALID_TRANSITION', `Overgang ${from} → ${to} is niet toegestaan`);
  }
}

/** Statussen waarin de submissionstatus rechtstreeks uit de conceptteksten wordt afgeleid. */
const DERIVED_SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'DRAFT_READY',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
];

/**
 * Leidt de submissionstatus af uit de status van de bijbehorende conceptposten. Wordt alleen toegepast
 * als de submission al in een van de "review"-fases zit; handmatige stappen (READY_TO_PUBLISH,
 * ARCHIVED) en de voorafgaande technische fases worden hier nooit stilzwijgend overschreven.
 */
export function recalcSubmissionStatus(
  current: SubmissionStatus,
  drafts: readonly { status: PublicationStatus }[],
): SubmissionStatus {
  if (!DERIVED_SUBMISSION_STATUSES.includes(current)) return current;
  const active = drafts.filter((d) => d.status !== 'DISCARDED');
  if (active.length === 0) return current;
  if (active.some((d) => d.status === 'CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  if (active.every((d) => d.status === 'PUBLISHED')) return 'PUBLISHED';
  if (active.every((d) => d.status === 'APPROVED' || d.status === 'PUBLISHED')) return 'APPROVED';
  return 'IN_REVIEW';
}

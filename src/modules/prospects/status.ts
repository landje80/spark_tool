import type { ProspectStatus } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error.js';

/**
 * Toegestane statusovergangen. Bijna elke status mag naar ARCHIVED/INVALID/DUPLICATE;
 * die algemene uitgangen staan in ALWAYS_ALLOWED. Terugzetten uit ARCHIVED gaat naar NEW.
 */
const TRANSITIONS: Record<ProspectStatus, readonly ProspectStatus[]> = {
  NEW: ['IN_REVIEW', 'OUTREACH_PREPARED', 'EMAILED', 'CALLED', 'FOLLOW_UP', 'NOT_INTERESTED'],
  IN_REVIEW: ['NEW', 'OUTREACH_PREPARED', 'EMAILED', 'CALLED', 'FOLLOW_UP', 'NOT_INTERESTED'],
  OUTREACH_PREPARED: ['NEW', 'IN_REVIEW', 'EMAILED', 'CALLED', 'NOT_INTERESTED'],
  EMAILED: ['REPLY_RECEIVED', 'REPLY_NOT_INTERESTED', 'CALLED', 'FOLLOW_UP', 'NOT_INTERESTED'],
  REPLY_RECEIVED: ['REPLY_NOT_INTERESTED', 'CALLED', 'FOLLOW_UP', 'QUALIFIED', 'NOT_INTERESTED'],
  REPLY_NOT_INTERESTED: ['NOT_INTERESTED', 'FOLLOW_UP'],
  CALLED: ['FOLLOW_UP', 'EMAILED', 'QUALIFIED', 'NOT_INTERESTED', 'REPLY_RECEIVED'],
  FOLLOW_UP: ['EMAILED', 'CALLED', 'REPLY_RECEIVED', 'QUALIFIED', 'NOT_INTERESTED'],
  QUALIFIED: ['CUSTOMER', 'FOLLOW_UP', 'CALLED', 'EMAILED', 'NOT_INTERESTED'],
  NOT_INTERESTED: ['NEW', 'FOLLOW_UP'],
  CUSTOMER: [],
  ARCHIVED: ['NEW'],
  INVALID: ['NEW'],
  DUPLICATE: [],
};

const ALWAYS_ALLOWED: readonly ProspectStatus[] = ['ARCHIVED', 'INVALID', 'DUPLICATE'];
/** Statussen zonder algemene uitgang naar ARCHIVED/INVALID/DUPLICATE. */
const NO_GENERAL_EXIT: readonly ProspectStatus[] = ['CUSTOMER', 'ARCHIVED', 'DUPLICATE'];

export function allowedTransitions(from: ProspectStatus): ProspectStatus[] {
  const base = TRANSITIONS[from];
  if (NO_GENERAL_EXIT.includes(from)) return [...base];
  return [...new Set([...base, ...ALWAYS_ALLOWED.filter((s) => s !== from)])];
}

export function canTransition(from: ProspectStatus, to: ProspectStatus): boolean {
  return allowedTransitions(from).includes(to);
}

export function assertTransition(from: ProspectStatus, to: ProspectStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new AppError('INVALID_TRANSITION', `Overgang ${from} → ${to} is niet toegestaan`);
  }
}

import { describe, expect, it } from 'vitest';
import { canTransitionDraft, recalcSubmissionStatus } from './status.js';

describe('canTransitionDraft', () => {
  it('staat het normale reviewpad toe', () => {
    expect(canTransitionDraft('DRAFT', 'IN_REVIEW')).toBe(true);
    expect(canTransitionDraft('IN_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionDraft('APPROVED', 'PUBLISHED')).toBe(true);
  });

  it('staat "wijzigingen gevraagd" terug naar bewerken toe', () => {
    expect(canTransitionDraft('CHANGES_REQUESTED', 'DRAFT')).toBe(true);
    expect(canTransitionDraft('CHANGES_REQUESTED', 'IN_REVIEW')).toBe(true);
  });

  it('PUBLISHED en DISCARDED zijn eindstatussen', () => {
    expect(canTransitionDraft('PUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransitionDraft('DISCARDED', 'DRAFT')).toBe(false);
  });

  it('weigert een ongeldige sprong (bv. DRAFT direct naar PUBLISHED)', () => {
    expect(canTransitionDraft('DRAFT', 'PUBLISHED')).toBe(false);
  });
});

describe('recalcSubmissionStatus', () => {
  it('blijft ongewijzigd buiten de reviewfases (bv. TECHNICAL_CHECK)', () => {
    expect(recalcSubmissionStatus('TECHNICAL_CHECK', [{ status: 'APPROVED' }])).toBe(
      'TECHNICAL_CHECK',
    );
  });

  it('is IN_REVIEW zolang niet alles is goedgekeurd', () => {
    expect(
      recalcSubmissionStatus('DRAFT_READY', [{ status: 'DRAFT' }, { status: 'APPROVED' }]),
    ).toBe('IN_REVIEW');
  });

  it('is CHANGES_REQUESTED zodra één actief concept wijzigingen nodig heeft', () => {
    expect(
      recalcSubmissionStatus('IN_REVIEW', [
        { status: 'APPROVED' },
        { status: 'CHANGES_REQUESTED' },
      ]),
    ).toBe('CHANGES_REQUESTED');
  });

  it('is APPROVED als alle actieve concepten zijn goedgekeurd', () => {
    expect(
      recalcSubmissionStatus('IN_REVIEW', [{ status: 'APPROVED' }, { status: 'APPROVED' }]),
    ).toBe('APPROVED');
  });

  it('negeert DISCARDED concepten bij de afleiding', () => {
    expect(
      recalcSubmissionStatus('IN_REVIEW', [{ status: 'APPROVED' }, { status: 'DISCARDED' }]),
    ).toBe('APPROVED');
  });

  it('is PUBLISHED zodra alle (actieve) concepten gepubliceerd zijn', () => {
    expect(
      recalcSubmissionStatus('APPROVED', [{ status: 'PUBLISHED' }, { status: 'PUBLISHED' }]),
    ).toBe('PUBLISHED');
  });

  it('blijft ongewijzigd als alle concepten zijn verwijderd (niets actiefs meer)', () => {
    expect(recalcSubmissionStatus('APPROVED', [{ status: 'DISCARDED' }])).toBe('APPROVED');
  });
});

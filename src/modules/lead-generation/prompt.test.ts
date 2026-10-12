import { describe, expect, it } from 'vitest';
import { MAX_BLOCKED_DOMAINS, buildResearchUserPrompt, splitKnownDomains } from './prompt.js';

describe('splitKnownDomains', () => {
  it('normaliseert, ontdubbelt en laat ongeldige domeinen en platforms weg', () => {
    const r = splitKnownDomains([
      'WWW.Voorbeeld.nl',
      'voorbeeld.nl',
      'https://x.nl',
      'geen domein',
      'linkedin.com',
      'facebook.com',
      'bakkerij-smit.nl',
    ]);
    expect(r.blocked).toEqual(['voorbeeld.nl', 'bakkerij-smit.nl']);
    expect(r.overflow).toEqual([]);
  });

  it('blokkeert maximaal MAX_BLOCKED_DOMAINS en zet de rest in de overflow', () => {
    const many = Array.from({ length: MAX_BLOCKED_DOMAINS + 3 }, (_, i) => `bedrijf${i}.nl`);
    const r = splitKnownDomains(many);
    expect(r.blocked).toHaveLength(MAX_BLOCKED_DOMAINS);
    expect(r.overflow).toEqual(['bedrijf500.nl', 'bedrijf501.nl', 'bedrijf502.nl']);
  });
});

describe('buildResearchUserPrompt', () => {
  const base = {
    target: 3,
    ring: ['Zwolle'],
    focus: 'bouw',
    knownNames: [],
    maxSearches: 10,
    now: new Date('2026-10-12T08:00:00Z'),
  };

  it('meldt geblokkeerde bedrijven zonder ze op te sommen', () => {
    const p = buildResearchUserPrompt({ ...base, blockedCount: 42, knownDomains: [] });
    expect(p).toContain('42 bedrijven');
    expect(p).not.toContain('Het CRM is nog leeg');
  });

  it('zegt dat het CRM leeg is zonder bekende domeinen', () => {
    expect(buildResearchUserPrompt({ ...base, blockedCount: 0, knownDomains: [] })).toContain(
      'Het CRM is nog leeg',
    );
  });
});

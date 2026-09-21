import { describe, expect, it } from 'vitest';
import { findDuplicates, nameSimilarity } from './dedupe.js';
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizePhone,
  normalizeSocialUrl,
} from './normalize.js';
import { allowedTransitions, assertTransition, canTransition } from './status.js';

describe('normalisatie', () => {
  it('normaliseert bedrijfsnamen', () => {
    expect(normalizeCompanyName('Café De Zwaan B.V.')).toBe('cafe de zwaan');
    expect(normalizeCompanyName('Jansen & Zn Installatie')).toBe('jansen en zn installatie');
  });
  it('normaliseert domeinen', () => {
    expect(normalizeDomain('https://www.Voorbeeld.nl/contact?x=1')).toBe('voorbeeld.nl');
    expect(normalizeDomain('voorbeeld.nl')).toBe('voorbeeld.nl');
    expect(normalizeDomain('javascript:alert(1)')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
  });
  it('normaliseert social-URL en telefoon', () => {
    expect(normalizeSocialUrl('https://www.instagram.com/Bedrijf/?hl=nl')).toBe(
      'https://instagram.com/bedrijf',
    );
    expect(normalizePhone('038 123 45 67')).toBe('+31381234567');
    expect(normalizePhone('12')).toBeNull();
  });
});

describe('deduplicatie', () => {
  const existing = [
    { id: 'a', companyName: 'Bakkerij Smit', domain: 'bakkerijsmit.nl', city: 'Zwolle' },
    {
      id: 'b',
      companyName: 'Installatie Vos',
      domain: 'vos-install.nl',
      city: 'Hattem',
      socialUrls: ['https://linkedin.com/company/vos'],
    },
  ];
  it('vindt exacte domeinmatch ondanks www', () => {
    const m = findDuplicates(
      { companyName: 'Anders', website: 'https://www.bakkerijsmit.nl' },
      existing,
    );
    expect(m).toEqual([{ prospectId: 'a', kind: 'exact', reason: 'zelfde domein' }]);
  });
  it('vindt naam + plaats', () => {
    const m = findDuplicates({ companyName: 'bakkerij smit bv', city: 'zwolle' }, existing);
    expect(m[0]).toMatchObject({ prospectId: 'a', kind: 'exact' });
  });
  it('vindt social-URL', () => {
    const m = findDuplicates(
      { companyName: 'Zzz', socialUrls: ['https://www.linkedin.com/company/vos/'] },
      existing,
    );
    expect(m[0]).toMatchObject({ prospectId: 'b', kind: 'exact' });
  });
  it('markeert fuzzy match als fuzzy, niet als exact', () => {
    const m = findDuplicates({ companyName: 'Bakkerij Smid', city: 'Kampen' }, existing);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ prospectId: 'a', kind: 'fuzzy' });
  });
  it('geeft geen match voor een ander bedrijf', () => {
    expect(findDuplicates({ companyName: 'Autobedrijf Kok', city: 'Epe' }, existing)).toEqual([]);
  });
  it('berekent gelijkenis', () => {
    expect(nameSimilarity('Vos', 'Vos')).toBe(1);
    expect(nameSimilarity('abc', 'xyz')).toBe(0);
  });
});

describe('statusovergangen', () => {
  it('staat logische overgangen toe', () => {
    expect(canTransition('NEW', 'EMAILED')).toBe(true);
    expect(canTransition('EMAILED', 'REPLY_RECEIVED')).toBe(true);
    expect(canTransition('QUALIFIED', 'CUSTOMER')).toBe(true);
  });
  it('weigert ongeldige overgangen', () => {
    expect(canTransition('NEW', 'CUSTOMER')).toBe(false);
    expect(canTransition('CUSTOMER', 'NEW')).toBe(false);
    expect(canTransition('DUPLICATE', 'NEW')).toBe(false);
    expect(() => assertTransition('NEW', 'CUSTOMER')).toThrowError(/niet toegestaan/);
  });
  it('staat archiveren toe vanuit actieve statussen en herstel naar NEW', () => {
    expect(canTransition('FOLLOW_UP', 'ARCHIVED')).toBe(true);
    expect(canTransition('ARCHIVED', 'NEW')).toBe(true);
    expect(allowedTransitions('ARCHIVED')).toEqual(['NEW']);
  });
  it('behandelt gelijke status als no-op', () => {
    expect(() => assertTransition('NEW', 'NEW')).not.toThrow();
  });
});

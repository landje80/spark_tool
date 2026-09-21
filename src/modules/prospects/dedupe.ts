import {
  normalizeCity,
  normalizeCompanyName,
  normalizeDomain,
  normalizePhone,
  normalizeSocialUrl,
} from './normalize.js';

export interface ProspectIdentity {
  id: string;
  companyName: string;
  domain?: string | null;
  city?: string | null;
  phone?: string | null;
  kvkNumber?: string | null;
  socialUrls?: string[];
}

export interface CandidateIdentity {
  companyName: string;
  website?: string | null;
  city?: string | null;
  phone?: string | null;
  kvkNumber?: string | null;
  socialUrls?: string[];
}

export type MatchKind = 'exact' | 'fuzzy';
export interface DuplicateMatch {
  prospectId: string;
  kind: MatchKind;
  reason: string;
}

/** Levenshtein-afstand, twee rijen geheugen. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Gelijkenis tussen 0 en 1 op genormaliseerde namen. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
}

export const FUZZY_THRESHOLD = 0.85;

/**
 * Zoekt duplicaten. Exacte matches (domein, KvK, telefoon, social-URL, naam+plaats) zijn zeker;
 * fuzzy matches gaan naar de reviewqueue en worden nooit automatisch samengevoegd.
 * Geeft de sterkste match per bestaand prospect terug.
 */
export function findDuplicates(
  candidate: CandidateIdentity,
  existing: readonly ProspectIdentity[],
): DuplicateMatch[] {
  const domain = normalizeDomain(candidate.website);
  const name = normalizeCompanyName(candidate.companyName);
  const city = normalizeCity(candidate.city)?.toLowerCase() ?? null;
  const phone = normalizePhone(candidate.phone);
  const socials = new Set((candidate.socialUrls ?? []).map(normalizeSocialUrl).filter(Boolean));

  const matches = new Map<string, DuplicateMatch>();
  const put = (m: DuplicateMatch) => {
    const cur = matches.get(m.prospectId);
    if (!cur || (cur.kind === 'fuzzy' && m.kind === 'exact')) matches.set(m.prospectId, m);
  };

  for (const p of existing) {
    if (domain && normalizeDomain(p.domain) === domain) {
      put({ prospectId: p.id, kind: 'exact', reason: 'zelfde domein' });
    }
    if (candidate.kvkNumber && p.kvkNumber && candidate.kvkNumber === p.kvkNumber) {
      put({ prospectId: p.id, kind: 'exact', reason: 'zelfde KvK-nummer' });
    }
    if (phone && normalizePhone(p.phone) === phone) {
      put({ prospectId: p.id, kind: 'exact', reason: 'zelfde telefoonnummer' });
    }
    if ((p.socialUrls ?? []).some((u) => socials.has(normalizeSocialUrl(u)))) {
      put({ prospectId: p.id, kind: 'exact', reason: 'zelfde socialmedia-account' });
    }
    const pName = normalizeCompanyName(p.companyName);
    const pCity = normalizeCity(p.city)?.toLowerCase() ?? null;
    if (name && pName === name && city && pCity === city) {
      put({ prospectId: p.id, kind: 'exact', reason: 'zelfde bedrijfsnaam en plaats' });
    } else if (name && pName && nameSimilarity(name, pName) >= FUZZY_THRESHOLD) {
      const sameCity = city && pCity === city;
      put({
        prospectId: p.id,
        kind: 'fuzzy',
        reason: sameCity ? 'vergelijkbare naam in dezelfde plaats' : 'vergelijkbare bedrijfsnaam',
      });
    }
  }
  return [...matches.values()];
}

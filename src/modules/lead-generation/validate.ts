import { normalizeDomain, normalizeSocialUrl } from '../prospects/normalize.js';
import type { Candidate } from './schema.js';

const ALLOWED_PROVINCES = new Set(['OVERIJSSEL', 'DRENTHE', 'GELDERLAND', 'FLEVOLAND']);
const MIN_EMPLOYEES = 5;

const PLATFORM_HOSTS: Record<string, RegExp> = {
  LINKEDIN: /(^|\.)linkedin\.com$/,
  FACEBOOK: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/,
  INSTAGRAM: /(^|\.)instagram\.com$/,
  TIKTOK: /(^|\.)tiktok\.com$/,
};

/** Consumenten-maildomeinen: een adres daarop geldt als persoonlijk en wordt nooit opgeslagen. */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.nl',
  'outlook.com',
  'live.nl',
  'live.com',
  'yahoo.com',
  'yahoo.nl',
  'icloud.com',
  'me.com',
  'ziggo.nl',
  'kpnmail.nl',
  'planet.nl',
  'xs4all.nl',
  'hetnet.nl',
  'home.nl',
  'casema.nl',
  'telfort.nl',
  'tele2.nl',
  'online.nl',
]);

/** Alleen functionele adressen worden bewaard; voornaam.achternaam@ is een persoonsgegeven. */
const GENERIC_LOCAL = new Set([
  'info',
  'contact',
  'hallo',
  'hello',
  'mail',
  'post',
  'sales',
  'verkoop',
  'kantoor',
  'receptie',
  'administratie',
  'service',
  'support',
  'office',
  'team',
  'welkom',
  'reserveren',
  'bestellen',
]);

const DISPARAGING =
  /\b(lelijk|slecht|waardeloos|amateuristisch|beroerd|troep|rommelig|onprofessioneel|stom|belabberd|armoedig|knullig)\b/i;

/** Canonieke URL voor vergelijking: zonder www, query, fragment en afsluitende slash. */
export function canonicalUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return null;
  }
}

const hostOf = (canonical: string): string => canonical.split('/')[0] ?? canonical;

export interface CleanCandidate {
  companyName: string;
  city: string;
  province: 'OVERIJSSEL' | 'DRENTHE' | 'GELDERLAND' | 'FLEVOLAND';
  industry: string;
  website: string;
  domain: string;
  phone: string | null;
  contactEmail: string | null;
  employeesMin: number | null;
  employeesMax: number | null;
  employeesRationale: string;
  employeesSourceUrl: string | null;
  socials: { platform: string; url: string; accountName: string | null; observations: string[] }[];
  observations: { kind: 'waarneming' | 'interpretatie'; text: string }[];
  sparkFit: string;
  outreachAngle: string;
  fitScore: number;
  sources: { type: string; url: string; title: string | null; observation: string | null }[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  duplicateSignals: string[];
  /** Redenen waarom een medewerker dit moet beoordelen vóór opvolging. */
  reviewReasons: string[];
}

export type ValidationResult =
  { ok: true; candidate: CleanCandidate } | { ok: false; reason: string };

const reject = (reason: string): ValidationResult => ({ ok: false, reason });

/**
 * Strikte server-side controle van één modelkandidaat. Harde eisen leiden tot afwijzing; twijfel
 * (lage betrouwbaarheid, onbekend medewerkersaantal, niet-gecontroleerde website) leidt tot markering voor
 * menselijke beoordeling. Bronnen die niet in de echte zoekresultaten voorkwamen worden verwijderd.
 */
export function validateCandidate(c: Candidate, seenUrls: readonly string[]): ValidationResult {
  const review: string[] = [];
  const name = c.companyName.trim();
  const city = c.city.trim();
  if (!name) return reject('bedrijfsnaam ontbreekt');
  if (!city) return reject('plaats ontbreekt');
  if (!ALLOWED_PROVINCES.has(c.province))
    return reject('provincie valt buiten de toegestane regio');
  if (c.industry === 'overig') return reject('branche valt buiten de doelgroep');

  const domain = normalizeDomain(c.website);
  if (!domain) return reject('geen geldige website');
  const website = `https://${domain}`;

  const employeesMin = c.employeesMin != null && c.employeesMin >= 0 ? c.employeesMin : null;
  let employeesMax = c.employeesMax != null && c.employeesMax >= 0 ? c.employeesMax : null;
  if (employeesMin != null && employeesMax != null && employeesMin > employeesMax) {
    employeesMax = null;
    review.push('medewerkersbandbreedte is onlogisch');
  }
  const topEstimate = employeesMax ?? employeesMin;
  if (topEstimate != null && topEstimate < MIN_EMPLOYEES)
    return reject('minder dan circa 5 medewerkers');
  if (topEstimate == null) review.push('medewerkersaantal onbekend');

  const socials = c.socials
    .flatMap((s) => {
      const url = normalizeSocialUrl(s.url);
      const host = url ? hostOf(canonicalUrl(url) ?? '') : '';
      const pattern = PLATFORM_HOSTS[s.platform];
      if (!url || !pattern?.test(host)) return [];
      // Persoonlijke LinkedIn-profielen (/in/) zijn persoonsgegevens en worden nooit opgeslagen.
      if (s.platform === 'LINKEDIN' && !/^https:\/\/[^/]+\/(company|school|showcase)\//.test(url))
        return [];
      return [
        {
          platform: s.platform,
          url,
          accountName: s.accountName?.slice(0, 200) ?? null,
          observations: s.observations.slice(0, 10).map((o) => o.slice(0, 500)),
        },
      ];
    })
    .slice(0, 8);
  if (socials.length === 0) return reject('geen geldig socialmediaprofiel');

  // Alleen bronnen die echt in de zoek- of ophaalresultaten voorkwamen tellen mee (anti-hallucinatie).
  const seen = new Set(seenUrls.map(canonicalUrl).filter((u): u is string => !!u));
  const seenHosts = new Set([...seen].map(hostOf));
  const sources = c.sources.filter((s) => {
    const canon = canonicalUrl(s.url);
    if (!canon) return false;
    return seen.has(canon) || (s.type === 'WEBSITE' && seenHosts.has(hostOf(canon)));
  });
  if (sources.length === 0) return reject('geen enkele bron is in de zoekresultaten teruggevonden');
  if (sources.length < c.sources.length) {
    review.push(
      `${c.sources.length - sources.length} opgegeven bron(nen) niet in zoekresultaten teruggevonden`,
    );
  }
  if (!seenHosts.has(domain)) review.push('bedrijfswebsite niet in zoekresultaten gecontroleerd');
  if (!socials.some((s) => seen.has(canonicalUrl(s.url) ?? ''))) {
    review.push('sociale profielen niet in zoekresultaten gecontroleerd');
  }
  const empCanon = c.employeesSourceUrl ? canonicalUrl(c.employeesSourceUrl) : null;
  const employeesSourceUrl = empCanon && seen.has(empCanon) ? c.employeesSourceUrl : null;
  if (c.employeesSourceUrl && !employeesSourceUrl) {
    review.push('bron voor medewerkersaantal niet in zoekresultaten teruggevonden');
  }

  let contactEmail: string | null = null;
  if (c.contactEmail) {
    const [local = '', mailDomain = ''] = c.contactEmail.toLowerCase().split('@');
    const isBusiness =
      !!mailDomain &&
      GENERIC_LOCAL.has(local) &&
      !FREE_MAIL.has(mailDomain) &&
      (mailDomain === domain || mailDomain.endsWith(`.${domain}`));
    if (isBusiness && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contactEmail))
      contactEmail = c.contactEmail.toLowerCase();
  }

  if (c.confidence === 'LOW') review.push('lage betrouwbaarheid');
  const texts = [
    c.sparkFit,
    c.outreachAngle,
    ...c.observations.map((o) => o.text),
    ...socials.flatMap((s) => s.observations),
  ];
  if (texts.some((t) => DISPARAGING.test(t))) review.push('toon van de observaties controleren');

  return {
    ok: true,
    candidate: {
      companyName: name.slice(0, 300),
      city,
      province: c.province as CleanCandidate['province'],
      industry: c.industry,
      website,
      domain,
      phone: c.phone?.trim() || null,
      contactEmail,
      employeesMin,
      employeesMax,
      employeesRationale: c.employeesRationale.trim().slice(0, 2000),
      employeesSourceUrl,
      socials,
      observations: c.observations
        .slice(0, 20)
        .map((o) => ({ kind: o.kind, text: o.text.slice(0, 600) })),
      sparkFit: c.sparkFit.trim().slice(0, 2000),
      outreachAngle: c.outreachAngle.trim().slice(0, 2000),
      fitScore: Math.max(0, Math.min(100, Math.round(c.fitScore))),
      sources: sources.slice(0, 15).map((s) => ({
        type: s.type,
        url: s.url,
        title: s.title,
        observation: s.observation,
      })),
      confidence: c.confidence,
      duplicateSignals: c.duplicateSignals,
      reviewReasons: review,
    },
  };
}

import { describe, expect, it } from 'vitest';
import { estimateCostUsd, supportsDynamicFiltering } from '../../integrations/anthropic/cost.js';
import { emptyUsage } from '../../integrations/anthropic/types.js';
import { CandidateSchema, ExtractionSchema, type Candidate } from './schema.js';
import { canonicalUrl, validateCandidate } from './validate.js';

const SEEN = [
  'https://www.cafedezwaan.nl/over-ons',
  'https://www.linkedin.com/company/cafe-de-zwaan',
  'https://www.zwolle-bedrijven.nl/cafe-de-zwaan',
];

const base = (over: Partial<Candidate> = {}): Candidate => ({
  companyName: 'Café De Zwaan',
  city: 'Zwolle',
  province: 'OVERIJSSEL',
  industry: 'horeca',
  website: 'https://www.cafedezwaan.nl',
  phone: '038 123 45 67',
  contactEmail: 'info@cafedezwaan.nl',
  employeesMin: 8,
  employeesMax: 15,
  employeesRationale: 'LinkedIn toont 11-50 medewerkers',
  employeesSourceUrl: 'https://www.linkedin.com/company/cafe-de-zwaan',
  socials: [
    {
      platform: 'LINKEDIN',
      url: 'https://www.linkedin.com/company/cafe-de-zwaan/',
      accountName: 'Café De Zwaan',
      observations: ['Laatste bericht 14 maanden geleden'],
    },
    {
      platform: 'INSTAGRAM',
      url: 'https://instagram.com/cafedezwaan?hl=nl',
      accountName: null,
      observations: [],
    },
  ],
  observations: [{ kind: 'waarneming', text: 'Wisselende beeldkwaliteit op Instagram' }],
  sparkFit: 'Past bij contentondersteuning voor horeca',
  outreachAngle: 'Compliment over de terrasfoto’s',
  fitScore: 82,
  sources: [
    {
      type: 'WEBSITE',
      url: 'https://cafedezwaan.nl/over-ons/',
      title: 'Over ons',
      observation: null,
    },
    {
      type: 'LINKEDIN',
      url: 'https://www.linkedin.com/company/cafe-de-zwaan',
      title: null,
      observation: null,
    },
    { type: 'OTHER', url: 'https://verzonnen.example/bron', title: null, observation: null },
  ],
  confidence: 'HIGH',
  duplicateSignals: [],
  researchedAt: '2026-09-21T06:30:00.000Z',
  ...over,
});

describe('validateCandidate', () => {
  it('accepteert een goede kandidaat en normaliseert velden', () => {
    const r = validateCandidate(base(), SEEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate.domain).toBe('cafedezwaan.nl');
    expect(r.candidate.website).toBe('https://cafedezwaan.nl');
    expect(r.candidate.socials.map((s) => s.url)).toEqual([
      'https://linkedin.com/company/cafe-de-zwaan',
      'https://instagram.com/cafedezwaan',
    ]);
    expect(r.candidate.contactEmail).toBe('info@cafedezwaan.nl');
    expect(r.candidate.fitScore).toBe(82);
  });

  it('verwijdert bronnen die niet in de zoekresultaten stonden en markeert dat', () => {
    const r = validateCandidate(base(), SEEN);
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.candidate.sources).toHaveLength(2);
    expect(r.candidate.sources.map((s) => s.url)).not.toContain('https://verzonnen.example/bron');
    expect(r.candidate.reviewReasons.join(' ')).toContain('niet in zoekresultaten teruggevonden');
  });

  it('wijst af zonder enige verifieerbare bron', () => {
    const r = validateCandidate(
      base({
        sources: [
          { type: 'OTHER', url: 'https://verzonnen.example', title: null, observation: null },
        ],
      }),
      SEEN,
    );
    expect(r).toEqual({
      ok: false,
      reason: 'geen enkele bron is in de zoekresultaten teruggevonden',
    });
  });

  it('wijst af buiten de toegestane provincies of branches', () => {
    expect(validateCandidate(base({ province: 'OTHER' }), SEEN)).toMatchObject({ ok: false });
    expect(validateCandidate(base({ industry: 'overig' }), SEEN)).toMatchObject({ ok: false });
  });

  it('wijst af bij te weinig medewerkers, maar markeert een onbekend aantal voor beoordeling', () => {
    expect(validateCandidate(base({ employeesMin: 1, employeesMax: 3 }), SEEN)).toMatchObject({
      ok: false,
    });
    const r = validateCandidate(base({ employeesMin: null, employeesMax: null }), SEEN);
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.candidate.reviewReasons).toContain('medewerkersaantal onbekend');
  });

  it('eist een geldig socialmediaprofiel en filtert URL van het verkeerde platform', () => {
    const wrong = base({
      socials: [
        {
          platform: 'LINKEDIN',
          url: 'https://evil.example/company/x',
          accountName: null,
          observations: [],
        },
      ],
    });
    expect(validateCandidate(wrong, SEEN)).toEqual({
      ok: false,
      reason: 'geen geldig socialmediaprofiel',
    });
    expect(validateCandidate(base({ socials: [] }), SEEN)).toMatchObject({ ok: false });
  });

  it('bewaart alleen een zakelijk e-mailadres op het eigen domein', () => {
    for (const email of ['jan.jansen@gmail.com', 'info@ander-bedrijf.nl', 'geen-adres']) {
      const r = validateCandidate(base({ contactEmail: email }), SEEN);
      if (!r.ok) throw new Error('verwacht ok');
      expect(r.candidate.contactEmail).toBeNull();
    }
  });

  it('bewaart geen persoonlijk e-mailadres, ook niet op het eigen domein', () => {
    const personal = validateCandidate(base({ contactEmail: 'jan.jansen@cafedezwaan.nl' }), SEEN);
    const generic = validateCandidate(base({ contactEmail: 'Info@cafedezwaan.nl' }), SEEN);
    if (!personal.ok || !generic.ok) throw new Error('verwacht ok');
    expect(personal.candidate.contactEmail).toBeNull();
    expect(generic.candidate.contactEmail).toBe('info@cafedezwaan.nl');
  });

  it("slaat persoonlijke LinkedIn-profielen nooit op; alleen bedrijfspagina's", () => {
    const r = validateCandidate(
      base({
        socials: [
          {
            platform: 'LINKEDIN',
            url: 'https://www.linkedin.com/in/jan-jansen',
            accountName: 'Jan',
            observations: [],
          },
          {
            platform: 'LINKEDIN',
            url: 'https://www.linkedin.com/company/cafe-de-zwaan',
            accountName: null,
            observations: [],
          },
        ],
      }),
      SEEN,
    );
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.candidate.socials.map((s) => s.url)).toEqual([
      'https://linkedin.com/company/cafe-de-zwaan',
    ]);
    const onlyPersonal = validateCandidate(
      base({
        socials: [
          {
            platform: 'LINKEDIN',
            url: 'https://www.linkedin.com/in/jan-jansen',
            accountName: null,
            observations: [],
          },
        ],
      }),
      SEEN,
    );
    expect(onlyPersonal).toMatchObject({ ok: false });
  });

  it('markeert socials en medewerkersbron die niet in de zoekresultaten stonden voor beoordeling', () => {
    const r = validateCandidate(
      base({
        socials: [
          {
            platform: 'FACEBOOK',
            url: 'https://www.facebook.com/willekeurig',
            accountName: null,
            observations: [],
          },
        ],
        employeesSourceUrl: 'https://verzonnen.example/medewerkers',
      }),
      SEEN,
    );
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.candidate.employeesSourceUrl).toBeNull();
    expect(r.candidate.reviewReasons).toEqual(
      expect.arrayContaining([
        'sociale profielen niet in zoekresultaten gecontroleerd',
        'bron voor medewerkersaantal niet in zoekresultaten teruggevonden',
      ]),
    );
  });

  it('begrenst lange modeltekst zodat de opslag niet kan exploderen', () => {
    const long = 'x'.repeat(50_000);
    const r = validateCandidate(
      base({
        sparkFit: long,
        outreachAngle: long,
        employeesRationale: long,
        observations: Array.from({ length: 100 }, () => ({
          kind: 'waarneming' as const,
          text: long,
        })),
      }),
      SEEN,
    );
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.candidate.sparkFit.length).toBe(2000);
    expect(r.candidate.observations).toHaveLength(20);
    expect(r.candidate.observations[0]!.text.length).toBe(600);
  });
  it('markeert lage betrouwbaarheid en onprofessionele toon voor beoordeling', () => {
    const r = validateCandidate(
      base({
        confidence: 'LOW',
        observations: [{ kind: 'interpretatie', text: 'De posts zijn amateuristisch' }],
      }),
      SEEN,
    );
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.candidate.reviewReasons).toEqual(
      expect.arrayContaining(['lage betrouwbaarheid', 'toon van de observaties controleren']),
    );
  });

  it('begrenst de fit-score op 0-100', () => {
    const r = validateCandidate(base({ fitScore: 250 }), SEEN);
    if (!r.ok) throw new Error('verwacht ok');
    expect(r.candidate.fitScore).toBe(100);
  });
});

describe('canonicalUrl', () => {
  it('negeert www, query, fragment en afsluitende slash', () => {
    expect(canonicalUrl('https://www.Voorbeeld.nl/Pad/?utm=1#x')).toBe('voorbeeld.nl/pad');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('schema en kosten', () => {
  it('valideert modeluitvoer strikt en weigert ontbrekende velden', () => {
    expect(ExtractionSchema.safeParse({ candidates: [base()], notes: '' }).success).toBe(true);
    expect(CandidateSchema.safeParse({ companyName: 'x' }).success).toBe(false);
    expect(
      ExtractionSchema.safeParse({ candidates: [{ ...base(), province: 'UTRECHT' }], notes: '' })
        .success,
    ).toBe(false);
  });

  it('schat kosten per model en gebruikt een conservatief tarief voor onbekende modellen', () => {
    const usage = {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      webSearchRequests: 10,
    };
    expect(estimateCostUsd('claude-opus-5', usage)).toBeCloseTo(5 + 2.5 + 0.1, 5);
    expect(estimateCostUsd('claude-onbekend-9', usage)).toBeCloseTo(10 + 5 + 0.1, 5);
  });

  it('kiest de web-search-variant op basis van het model', () => {
    expect(supportsDynamicFiltering('claude-opus-5')).toBe(true);
    expect(supportsDynamicFiltering('claude-sonnet-5')).toBe(true);
    expect(supportsDynamicFiltering('claude-haiku-4-5')).toBe(false);
  });
});

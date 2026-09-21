import {
  emptyUsage,
  type ExtractInput,
  type ExtractResult,
  type LeadResearchClient,
  type ResearchInput,
  type ResearchResult,
  type Usage,
} from '../integrations/anthropic/types.js';
import type { Candidate } from '../modules/lead-generation/schema.js';

export const SEEN_URLS = [
  'https://spark.nicenext.nl/',
  'https://www.zwolle-horeca.nl/',
  'https://www.linkedin.com/company/cafe-de-zwaan',
  'https://www.linkedin.com/company/installatie-vos',
  'https://www.linkedin.com/company/bakkerij-smid',
  'https://cafedezwaan.nl/over-ons',
  'https://installatievos.nl/',
  'https://bakkerijsmid.nl/',
];

export function candidate(
  over: Partial<Candidate> & { name: string; domain: string; linkedin: string },
): Candidate {
  const { name, domain, linkedin, ...rest } = over;
  return {
    companyName: name,
    city: 'Zwolle',
    province: 'OVERIJSSEL',
    industry: 'horeca',
    website: `https://www.${domain}`,
    phone: null,
    contactEmail: null,
    employeesMin: 8,
    employeesMax: 20,
    employeesRationale: 'LinkedIn toont 11-50 medewerkers',
    employeesSourceUrl: linkedin,
    socials: [
      {
        platform: 'LINKEDIN',
        url: linkedin,
        accountName: name,
        observations: ['Laatste bericht 9 maanden geleden'],
      },
    ],
    observations: [{ kind: 'waarneming', text: 'Onregelmatige publicatiefrequentie op LinkedIn' }],
    sparkFit: 'Past bij contentondersteuning',
    outreachAngle: 'Compliment over recente projecten',
    fitScore: 75,
    sources: [
      { type: 'WEBSITE', url: `https://${domain}/`, title: 'Website', observation: null },
      { type: 'LINKEDIN', url: linkedin, title: null, observation: null },
    ],
    confidence: 'HIGH',
    duplicateSignals: [],
    researchedAt: '2026-09-21T08:00:00.000Z',
    ...rest,
  };
}

export const MOCK_RESEARCH_USAGE: Usage = {
  ...emptyUsage(),
  inputTokens: 50_000,
  outputTokens: 8_000,
  webSearchRequests: 12,
  webFetchRequests: 1,
};
export const MOCK_EXTRACT_USAGE: Usage = {
  ...emptyUsage(),
  inputTokens: 20_000,
  outputTokens: 6_000,
};

/** Vervangt Anthropic in tests: geen netwerk, deterministische uitvoer, legt aanroepen vast. */
export class MockLeadClient implements LeadResearchClient {
  researchCalls: ResearchInput[] = [];
  extractCalls: ExtractInput<unknown>[] = [];
  researchImpl: (i: ResearchInput) => Promise<ResearchResult>;
  extractImpl: (i: ExtractInput<unknown>) => Promise<ExtractResult<unknown>>;

  constructor(
    candidates: Candidate[] = [],
    opts: { stopReason?: string; seenUrls?: string[] } = {},
  ) {
    this.researchImpl = async (input) => {
      // Net als de echte client: verbruik per beurt melden en stoppen als het budget dat vraagt.
      const keepGoing = (await input.onTurn?.(MOCK_RESEARCH_USAGE)) ?? true;
      return {
        text: 'Onderzoeksnotities (mock)',
        seenUrls: opts.seenUrls ?? SEEN_URLS,
        usage: MOCK_RESEARCH_USAGE,
        stopReason: keepGoing ? (opts.stopReason ?? 'end_turn') : 'budget_stop',
      };
    };
    this.extractImpl = async () => ({
      data: { candidates, notes: 'mock' },
      usage: MOCK_EXTRACT_USAGE,
      stopReason: 'end_turn',
    });
  }

  research(input: ResearchInput) {
    this.researchCalls.push(input);
    return this.researchImpl(input);
  }
  async extract<T>(input: ExtractInput<T>): Promise<ExtractResult<T>> {
    this.extractCalls.push(input as ExtractInput<unknown>);
    return (await this.extractImpl(input as ExtractInput<unknown>)) as ExtractResult<T>;
  }
}

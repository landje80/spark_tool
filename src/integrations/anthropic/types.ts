import type { z } from 'zod';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearchRequests: 0,
  webFetchRequests: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  };
}

export interface ResearchInput {
  model: string;
  system: string;
  user: string;
  maxSearches: number;
  maxTokens: number;
  /** Domein dat het model mag ophalen om de eigen dienstverlening van Spark te lezen. */
  fetchDomain: string;
  /**
   * Wordt na elke beurt aangeroepen met het verbruik van die beurt (zodat kosten ook bij een latere fout
   * geboekt zijn). Geeft `false` terug om het onderzoek te stoppen, bv. omdat het dagbudget is bereikt.
   */
  onTurn?: (turnUsage: Usage) => Promise<boolean>;
}

export interface ResearchResult {
  /** Onderzoeksnotities van het model (vrije tekst). */
  text: string;
  /** Alle URL's die werkelijk in zoek- en ophaalresultaten voorkwamen (voor bronverificatie). */
  seenUrls: string[];
  usage: Usage;
  /**
   * 'end_turn' = normaal klaar; 'pause_turn' = limiet van hervattingen bereikt (onvolledig);
   * 'budget_stop' = onderzoek voortijdig gestopt door het dagbudget (onvolledig).
   */
  stopReason: string | null;
}

export interface ExtractInput<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface ExtractResult<T> {
  /** null als het model geen schema-conforme uitvoer leverde. */
  data: T | null;
  usage: Usage;
  stopReason: string | null;
}

/** Poort naar Anthropic voor leadonderzoek; in tests vervangen door een mock (nooit echte API-aanroepen). */
export interface LeadResearchClient {
  research(input: ResearchInput): Promise<ResearchResult>;
  extract<T>(input: ExtractInput<T>): Promise<ExtractResult<T>>;
}

/**
 * Poort voor een enkelvoudige gestructureerde aanroep zonder tools (conceptmails, contentconcepten).
 * In tests altijd vervangen door een mock; nooit een echte aanroep.
 */
export interface StructuredClient {
  generate<T>(input: {
    model: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens: number;
  }): Promise<T | null>;
}

import type { Usage } from './types.js';

/**
 * Indicatieve prijzen in USD per miljoen tokens (Anthropic-prijslijst, gecontroleerd 2026-09-21).
 * Onbekende modellen worden bewust tegen het duurste tarief geschat, zodat het dagbudget veilig blijft.
 * Controleer de prijzen bij elke modelwissel (skill anthropic-prompt-change).
 */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /fable|mythos/i, input: 10, output: 50 },
  { match: /opus/i, input: 5, output: 25 },
  { match: /sonnet-5/i, input: 2, output: 10 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /haiku/i, input: 1, output: 5 },
];
const FALLBACK = { input: 10, output: 50 };

/** Web search wordt per zoekopdracht gefactureerd (indicatief $10 per 1000). */
export const WEB_SEARCH_USD_PER_REQUEST = 0.01;

export function estimateCostUsd(model: string, usage: Usage): number {
  const p = PRICES.find((x) => x.match.test(model)) ?? FALLBACK;
  const tokens =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    usage.cacheReadTokens * p.input * 0.1 +
    usage.cacheWriteTokens * p.input * 1.25;
  return tokens / 1_000_000 + usage.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
}

/** Nieuwere modellen ondersteunen web search/fetch met dynamische filtering; oudere de basisvariant. */
export function supportsDynamicFiltering(model: string): boolean {
  return /opus-(5|4-[678])|sonnet-(5|4-6)|fable|mythos/i.test(model);
}

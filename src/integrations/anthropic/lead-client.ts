import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { supportsDynamicFiltering } from './cost.js';
import {
  emptyUsage,
  type ExtractInput,
  type ExtractResult,
  type LeadResearchClient,
  type ResearchInput,
  type ResearchResult,
  type Usage,
} from './types.js';

/** Maximaal aantal hervattingen na `pause_turn` (server-side tools met een lange beurt). */
const MAX_CONTINUATIONS = 5;

function usageOf(u: Anthropic.Messages.Usage): Usage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    webSearchRequests: u.server_tool_use?.web_search_requests ?? 0,
    webFetchRequests: u.server_tool_use?.web_fetch_requests ?? 0,
  };
}

function add(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  };
}

/** Alleen web search: bronnen lopen uitsluitend via zoekresultaten (en dus via de gecontroleerde URL-lijst). */
function researchTools(model: string, maxSearches: number) {
  const tools: Anthropic.Messages.ToolUnion[] = [
    supportsDynamicFiltering(model)
      ? { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }
      : { type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches },
  ];
  return tools;
}

/** Echte Anthropic-implementatie. Wordt in tests nooit gebruikt (zie LeadResearchClient). */
export class AnthropicLeadClient implements LeadResearchClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  async research(input: ResearchInput): Promise<ResearchResult> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input.user }];
    const seen = new Set<string>();
    const texts: string[] = [];
    let usage = emptyUsage();
    // `max_uses` geldt per request; over alle hervattingen heen bewaken we zelf het totaal.
    let remainingSearches = input.maxSearches;

    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      // Streamen voorkomt HTTP-timeouts bij lange, zoekintensieve beurten.
      const message = await this.client.messages
        .stream({
          model: input.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages,
          // Elke hervatting en elke interne zoekronde stuurt de hele, groeiende context (zoekresultaten) opnieuw
          // mee; automatische caching laat die herhaling tegen leestarief (0,1×) lopen i.p.v. volle prijs.
          cache_control: { type: 'ephemeral' },
          tools: researchTools(input.model, Math.max(1, remainingSearches)),
        })
        .finalMessage();
      const turnUsage = usageOf(message.usage);
      usage = add(usage, turnUsage);
      remainingSearches -= turnUsage.webSearchRequests;
      // Verbruik per beurt melden zodat het budget ook bij een latere fout klopt; false = stoppen.
      const keepGoing = (await input.onTurn?.(turnUsage)) ?? true;

      if (message.stop_reason === 'refusal')
        throw new Error('Model weigerde het onderzoek (refusal)');

      for (const block of message.content) {
        if (block.type === 'text') texts.push(block.text);
        // Serverfouten komen als 200 met een fout-object in plaats van een lijst.
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === 'web_search_result') seen.add(r.url);
        }
        if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') {
          seen.add(block.content.url);
        }
      }

      if (message.stop_reason === 'pause_turn') {
        if (!keepGoing) {
          return { text: texts.join('\n'), seenUrls: [...seen], usage, stopReason: 'budget_stop' };
        }
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      return {
        text: texts.join('\n'),
        seenUrls: [...seen],
        usage,
        stopReason: message.stop_reason,
      };
    }
    return { text: texts.join('\n'), seenUrls: [...seen], usage, stopReason: 'pause_turn' };
  }

  async extract<T>(input: ExtractInput<T>): Promise<ExtractResult<T>> {
    const response = await this.client.messages.parse({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      output_config: { format: zodOutputFormat(input.schema) },
    });
    if (response.stop_reason === 'refusal')
      throw new Error('Model weigerde de extractie (refusal)');
    return {
      data: (response.parsed_output as T | null | undefined) ?? null,
      usage: usageOf(response.usage),
      stopReason: response.stop_reason,
    };
  }
}

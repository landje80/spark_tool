import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { StructuredClient } from './types.js';

/** Enkelvoudige gestructureerde aanroep zonder tools (bv. conceptmails). Niet gebruikt in tests. */
export class AnthropicStructuredClient implements StructuredClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async generate<T>(input: {
    model: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens: number;
  }): Promise<T | null> {
    const res = await this.client.messages.parse({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      output_config: { format: zodOutputFormat(input.schema) },
    });
    if (res.stop_reason === 'refusal') return null;
    return (res.parsed_output as T | null | undefined) ?? null;
  }
}

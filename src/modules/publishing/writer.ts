import type { PublicationPlatform } from '@prisma/client';
import type { StructuredClient } from '../../integrations/anthropic/types.js';
import { buildConceptUserPrompt, CONCEPT_SYSTEM_PROMPT } from './prompt.js';
import { ConceptOutputSchema, type DraftOutput } from './schema.js';

export interface ConceptInput {
  customerName: string;
  allowedPlatforms: PublicationPlatform[];
  brandProfile: unknown;
  topic: string | null;
  note: string | null;
  imageCount: number;
  videoCount: number;
}

export interface ConceptResult {
  summary: string;
  missingContext: string[];
  drafts: DraftOutput[];
}

export interface ConceptWriter {
  /** Opgeslagen als ContentConcept.model (bv. 'template' of een modelnaam). */
  readonly name: string;
  write(input: ConceptInput): Promise<ConceptResult>;
}

/** Deterministisch, zonder AI: gebruikt uitsluitend de letterlijke notitie van de klant. */
export class TemplateConceptWriter implements ConceptWriter {
  readonly name = 'template';

  write(i: ConceptInput): Promise<ConceptResult> {
    const text = (i.note?.trim() || i.topic?.trim() || '').slice(0, 2000);
    const drafts: DraftOutput[] = i.allowedPlatforms.map((platform) => ({
      platform,
      text: text || 'Nieuw bericht — vul de tekst zelf aan.',
      hashtags: [],
      cta: '',
      altText: i.topic?.slice(0, 300) ?? '',
    }));
    return Promise.resolve({
      summary: 'Automatisch sjabloon (geen AI geconfigureerd); controleer en vul zelf aan.',
      missingContext: [
        'Geen AI-model geconfigureerd: dit concept is een kale kopie van de aangeleverde notitie.',
      ],
      drafts,
    });
  }
}

export const CONCEPT_MAX_TOKENS = 3000;

/** AI-conceptschrijver; uitvoer wordt altijd door een medewerker beoordeeld en nooit automatisch gepubliceerd. */
export class AiConceptWriter implements ConceptWriter {
  readonly name: string;

  constructor(
    private readonly client: StructuredClient,
    private readonly model: string,
    private readonly fallback: ConceptWriter = new TemplateConceptWriter(),
  ) {
    this.name = model;
  }

  async write(i: ConceptInput): Promise<ConceptResult> {
    try {
      const out = await this.client.generate({
        model: this.model,
        system: CONCEPT_SYSTEM_PROMPT,
        user: buildConceptUserPrompt(i),
        schema: ConceptOutputSchema,
        maxTokens: CONCEPT_MAX_TOKENS,
      });
      if (out && out.drafts.length > 0) {
        // Nooit vertrouwen dat het model zich aan de toegestane platformen hield: server-side filteren.
        const allowed = new Set(i.allowedPlatforms);
        const missingContext = [...out.missingContext];
        const drafts = out.drafts.filter((d) => {
          if (allowed.has(d.platform)) return true;
          missingContext.push(
            `Concept voor ${d.platform} genegeerd: niet toegestaan voor deze klant.`,
          );
          return false;
        });
        if (drafts.length > 0) return { summary: out.summary, missingContext, drafts };
      }
    } catch {
      // Val stil terug op het sjabloon; de medewerker beoordeelt het concept toch.
    }
    return this.fallback.write(i);
  }
}

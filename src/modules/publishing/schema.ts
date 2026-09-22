import { PublicationPlatform } from '@prisma/client';
import { z } from 'zod';

export const DraftOutputSchema = z.object({
  platform: z.enum(PublicationPlatform),
  text: z.string(),
  hashtags: z.array(z.string()).max(15),
  cta: z.string(),
  altText: z.string(),
});

export const ConceptOutputSchema = z.object({
  /** Korte interne samenvatting van het concept (voor de reviewer, niet gepubliceerd). */
  summary: z.string(),
  /** Wat ontbreekt of onzeker is (bv. "geen expliciete call-to-action aangeleverd"). */
  missingContext: z.array(z.string()).max(10),
  drafts: z.array(DraftOutputSchema).min(1).max(4),
});

export type ConceptOutput = z.infer<typeof ConceptOutputSchema>;
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

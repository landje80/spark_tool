import { describe, expect, it, vi } from 'vitest';
import type { StructuredClient } from '../../integrations/anthropic/types.js';
import { AiConceptWriter, TemplateConceptWriter, type ConceptInput } from './writer.js';

const baseInput: ConceptInput = {
  customerName: 'Café De Zwaan',
  allowedPlatforms: ['LINKEDIN', 'INSTAGRAM'],
  brandProfile: { toneOfVoice: 'vriendelijk' },
  topic: 'Nieuwe lentekaart',
  note: 'We hebben net onze nieuwe menukaart gefotografeerd.',
  imageCount: 3,
  videoCount: 0,
};

describe('TemplateConceptWriter', () => {
  it('maakt één concept per toegestaan platform, met een eerlijke waarschuwing', async () => {
    const out = await new TemplateConceptWriter().write(baseInput);
    expect(out.drafts.map((d) => d.platform).sort()).toEqual(['INSTAGRAM', 'LINKEDIN']);
    expect(out.missingContext.join(' ')).toMatch(/geen ai/i);
    expect(out.drafts[0]!.text).toContain('menukaart');
  });

  it('valt terug op een placeholder als er geen notitie of onderwerp is', async () => {
    const out = await new TemplateConceptWriter().write({ ...baseInput, topic: null, note: null });
    expect(out.drafts[0]!.text.length).toBeGreaterThan(0);
  });
});

describe('AiConceptWriter', () => {
  it('geeft de modeluitvoer door als alle platformen zijn toegestaan', async () => {
    const client: StructuredClient = {
      generate: vi.fn().mockResolvedValue({
        summary: 'Lentekaart-post',
        missingContext: [],
        drafts: [
          {
            platform: 'LINKEDIN',
            text: 'Onze nieuwe kaart!',
            hashtags: ['#lente'],
            cta: 'Kom langs',
            altText: 'Menukaart',
          },
        ],
      }),
    };
    const writer = new AiConceptWriter(client, 'claude-opus-5');
    const out = await writer.write(baseInput);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0]!.platform).toBe('LINKEDIN');
    expect(writer.name).toBe('claude-opus-5');
  });

  it('filtert een niet-toegestaan platform server-side en meldt dat in missingContext', async () => {
    const client: StructuredClient = {
      generate: vi.fn().mockResolvedValue({
        summary: 'x',
        missingContext: [],
        drafts: [
          { platform: 'LINKEDIN', text: 'ok', hashtags: [], cta: '', altText: '' },
          {
            platform: 'TIKTOK',
            text: 'niet toegestaan voor deze klant',
            hashtags: [],
            cta: '',
            altText: '',
          },
        ],
      }),
    };
    const writer = new AiConceptWriter(client, 'claude-opus-5');
    const out = await writer.write(baseInput); // allowedPlatforms bevat geen TIKTOK
    expect(out.drafts.map((d) => d.platform)).toEqual(['LINKEDIN']);
    expect(out.missingContext.join(' ')).toMatch(/TIKTOK/);
  });

  it('valt terug op het sjabloon als de client een fout geeft', async () => {
    const client: StructuredClient = { generate: vi.fn().mockRejectedValue(new Error('kapot')) };
    const writer = new AiConceptWriter(client, 'claude-opus-5');
    const out = await writer.write(baseInput);
    expect(out.missingContext.join(' ')).toMatch(/geen ai/i);
  });

  it('valt terug op het sjabloon als de client niets bruikbaars teruggeeft', async () => {
    const client: StructuredClient = { generate: vi.fn().mockResolvedValue(null) };
    const writer = new AiConceptWriter(client, 'claude-opus-5');
    const out = await writer.write(baseInput);
    expect(out.missingContext.join(' ')).toMatch(/geen ai/i);
  });

  it('valt terug op het sjabloon als na filtering geen enkel concept overblijft', async () => {
    const client: StructuredClient = {
      generate: vi.fn().mockResolvedValue({
        summary: 'x',
        missingContext: [],
        drafts: [
          { platform: 'TIKTOK', text: 'niet toegestaan', hashtags: [], cta: '', altText: '' },
        ],
      }),
    };
    const writer = new AiConceptWriter(client, 'claude-opus-5');
    const out = await writer.write(baseInput);
    expect(out.missingContext.join(' ')).toMatch(/geen ai/i);
  });
});

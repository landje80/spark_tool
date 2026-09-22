import { describe, expect, it } from 'vitest';
import { DisabledPublisherAdapter, disabledAdapters } from './adapter.js';

describe('DisabledPublisherAdapter', () => {
  it('weigert altijd te publiceren (fase 1: geen automatische publicatie)', async () => {
    const adapter = new DisabledPublisherAdapter('LINKEDIN');
    await expect(
      adapter.publish({
        platform: 'LINKEDIN',
        text: 'x',
        hashtags: [],
        mediaBuffer: null,
        mediaMimeType: null,
      }),
    ).rejects.toThrow(/niet geïmplementeerd/);
  });

  it('levert voor elk platform een adapter die weigert', async () => {
    const adapters = disabledAdapters();
    for (const platform of ['LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK'] as const) {
      expect(adapters[platform].platform).toBe(platform);
      await expect(
        adapters[platform].publish({
          platform,
          text: 'x',
          hashtags: [],
          mediaBuffer: null,
          mediaMimeType: null,
        }),
      ).rejects.toThrow();
    }
  });
});

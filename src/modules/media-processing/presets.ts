import type { PublicationPlatform } from '@prisma/client';

export interface ImagePreset {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Bepaalt of wordt bijgesneden (cover) of het geheel binnen de afmeting past (contain). */
  readonly fit: 'cover' | 'inside';
}

/** Eén platformneutrale "web"-afgeleide (voor voorvertoning in de app) plus een vierkante thumbnail. */
export const WEB_PRESET: ImagePreset = { name: 'web', width: 1600, height: 1600, fit: 'inside' };
export const THUMBNAIL_PRESET: ImagePreset = {
  name: 'thumbnail',
  width: 400,
  height: 400,
  fit: 'cover',
};

/**
 * Richtafmetingen per platform; puur informatief voor de reviewer (getoond bij het concept), geen
 * harde eis. Daadwerkelijke per-platform beeldbewerking (croppen naar exact deze maat) is toekomstig
 * werk; fase 1 levert één webvriendelijke afgeleide plus thumbnail voor elk origineel.
 */
export const PLATFORM_IMAGE_HINTS: Record<PublicationPlatform, string> = {
  LINKEDIN: '1200×627 (landscape) of 1080×1080 (vierkant)',
  FACEBOOK: '1200×630 (landscape)',
  INSTAGRAM: '1080×1080 (vierkant) of 1080×1350 (staand)',
  TIKTOK: '1080×1920 (staand, 9:16)',
};

export const MAX_IMAGE_PIXELS = 40_000_000; // 40 MP: beschermt tegen decompression bombs in sharp.

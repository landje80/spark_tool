import type { PublicationPlatform } from '@prisma/client';

export interface PublishInput {
  platform: PublicationPlatform;
  text: string;
  hashtags: string[];
  mediaBuffer: Buffer | null;
  mediaMimeType: string | null;
}

export interface PublishResult {
  externalPostId: string;
  publishedAt: Date;
}

/**
 * Interface voor een toekomstige platformconnector (LinkedIn, Facebook, Instagram, TikTok). Fase 1
 * heeft bewust geen werkende connector: publiceren gebeurt door de medewerker zelf, handmatig op het
 * platform; de app registreert dat achteraf (zie publishing/review.ts, `markPublished`).
 */
export interface PublisherAdapter {
  readonly platform: PublicationPlatform;
  publish(input: PublishInput): Promise<PublishResult>;
}

/** Weigert altijd: er is bewust geen automatische publicatie in fase 1. */
export class DisabledPublisherAdapter implements PublisherAdapter {
  constructor(readonly platform: PublicationPlatform) {}

  publish(): Promise<PublishResult> {
    return Promise.reject(
      new Error(
        `Automatisch publiceren naar ${this.platform} is niet geïmplementeerd (fase 1: alleen handmatig).`,
      ),
    );
  }
}

export const disabledAdapters = (): Record<PublicationPlatform, PublisherAdapter> => ({
  LINKEDIN: new DisabledPublisherAdapter('LINKEDIN'),
  FACEBOOK: new DisabledPublisherAdapter('FACEBOOK'),
  INSTAGRAM: new DisabledPublisherAdapter('INSTAGRAM'),
  TIKTOK: new DisabledPublisherAdapter('TIKTOK'),
});

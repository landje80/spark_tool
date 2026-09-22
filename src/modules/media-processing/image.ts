import sharp from 'sharp';
import { logger } from '../../shared/logging/logger.js';
import { MAX_IMAGE_PIXELS, type ImagePreset } from './presets.js';

export interface ImageMeta {
  width: number;
  height: number;
}

export interface Derivative {
  buffer: Buffer;
  width: number;
  height: number;
  mime: 'image/webp';
}

/**
 * Leest afbeeldingsmetadata. Faalt nooit hard: sharp kan ontbreken op het platform (geen
 * gecompileerde binary) of het bestand kan corrupt zijn; in beide gevallen geeft dit `null` terug
 * zodat de rest van de pipeline door kan gaan zonder de app te laten crashen.
 */
export async function readImageMeta(buffer: Buffer): Promise<ImageMeta | null> {
  try {
    const meta = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'onbekend' },
      'Kon afbeeldingsmetadata niet lezen (sharp)',
    );
    return null;
  }
}

/** Genereert één afgeleide volgens `preset`. Gracieuze degradatie: `null` bij elke sharp-fout. */
export async function makeDerivative(
  buffer: Buffer,
  preset: ImagePreset,
): Promise<Derivative | null> {
  try {
    const img = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate(); // rotate(): corrigeert EXIF-oriëntatie
    const out = await img
      .resize(preset.width, preset.height, { fit: preset.fit, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: out.data, width: out.info.width, height: out.info.height, mime: 'image/webp' };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'onbekend', preset: preset.name },
      'Kon geen afgeleide afbeelding genereren (sharp); origineel blijft behouden',
    );
    return null;
  }
}

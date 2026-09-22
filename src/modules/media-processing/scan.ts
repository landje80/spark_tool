import { fileTypeFromBuffer } from 'file-type';
import type { MediaKind } from '@prisma/client';

/** Toegestane, door magic bytes geverifieerde bestandstypen. SVG is bewust uitgesloten (XSS-risico). */
const ALLOWED: Record<MediaKind, ReadonlySet<string>> = {
  IMAGE: new Set(['image/jpeg', 'image/png', 'image/webp']),
  VIDEO: new Set(['video/mp4', 'video/quicktime', 'video/webm']),
};

export interface SniffResult {
  ok: boolean;
  mime: string | null;
  ext: string | null;
  reason?: 'unrecognized' | 'not_allowed' | 'kind_mismatch';
}

/**
 * Controleert het werkelijke bestandstype via magic bytes (nooit de opgegeven MIME/extensie
 * vertrouwen). `expectedKind` is wat de gebruiker in het formulier koos (foto/video); een echte
 * MIME die daar niet bij past wordt geweigerd.
 */
export async function sniffAndValidate(
  buffer: Buffer,
  expectedKind: MediaKind,
): Promise<SniffResult> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return { ok: false, mime: null, ext: null, reason: 'unrecognized' };
  const isImage = ALLOWED.IMAGE.has(detected.mime);
  const isVideo = ALLOWED.VIDEO.has(detected.mime);
  if (!isImage && !isVideo) {
    return { ok: false, mime: detected.mime, ext: detected.ext, reason: 'not_allowed' };
  }
  const actualKind: MediaKind = isImage ? 'IMAGE' : 'VIDEO';
  if (actualKind !== expectedKind) {
    return { ok: false, mime: detected.mime, ext: detected.ext, reason: 'kind_mismatch' };
  }
  return { ok: true, mime: detected.mime, ext: detected.ext };
}

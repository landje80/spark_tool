import { spawn } from 'node:child_process';
import path from 'node:path';
import { logger } from '../../shared/logging/logger.js';

export interface VideoMeta {
  durationSec: number;
  width: number | null;
  height: number | null;
}

const RUN_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024; // beschermt tegen een geheugenlek als ffmpeg blijft schrijven

/** ffprobe staat doorgaans naast ffmpeg; bij een kale binarynaam vertrouwen we op PATH. */
function probeBinary(ffmpegPath: string | undefined): string {
  if (!ffmpegPath) return 'ffprobe';
  const dir = path.dirname(ffmpegPath);
  const base = path.basename(ffmpegPath).replace(/ffmpeg/i, 'ffprobe');
  return dir === '.' ? base : path.join(dir, base);
}

/**
 * Voert een binary uit en verzamelt stdout als Buffer. Geeft `null` terug (nooit een throw naar de
 * aanroeper) bij een ontbrekende binary (ENOENT — bv. geen ffmpeg op deze server), een timeout, of
 * een non-zero exitcode: videoverwerking is optioneel en mag de rest van de app nooit blokkeren.
 */
function run(bin: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (result: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), RUN_TIMEOUT_MS);
    child.on('error', () => finish(null)); // o.a. ENOENT: binary niet gevonden
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) return finish(null);
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      resolve(code === 0 ? Buffer.concat(chunks) : null);
    });
  });
}

/** Duur en resolutie via ffprobe; `null` (nooit een throw) als ffprobe ontbreekt of het bestand onleesbaar is. */
export async function probeVideo(
  filePath: string,
  ffmpegPath: string | undefined,
): Promise<VideoMeta | null> {
  const out = await run(probeBinary(ffmpegPath), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-select_streams',
    'v:0',
    filePath,
  ]);
  if (!out) return null;
  try {
    const data = JSON.parse(out.toString('utf8')) as {
      format?: { duration?: string };
      streams?: { width?: number; height?: number }[];
    };
    const durationSec = Number(data.format?.duration ?? Number.NaN);
    if (!Number.isFinite(durationSec)) return null;
    const stream = data.streams?.[0];
    return { durationSec, width: stream?.width ?? null, height: stream?.height ?? null };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'onbekend' },
      'ffprobe-uitvoer onleesbaar',
    );
    return null;
  }
}

/** Eén JPEG-thumbnailframe op `atSeconds`; `null` als ffmpeg ontbreekt of het frame niet kan worden gehaald. */
export async function extractThumbnail(
  filePath: string,
  ffmpegPath: string | undefined,
  atSeconds: number,
): Promise<Buffer | null> {
  return run(ffmpegPath ?? 'ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(Math.max(0, atSeconds)),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=800:-2',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    'pipe:1',
  ]);
}

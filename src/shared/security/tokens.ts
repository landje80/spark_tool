import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Willekeurig URL-veilig token (256 bit). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time vergelijking van twee strings (via hash, dus ook bij ongelijke lengte veilig). */
export function safeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256Hex(a), 'hex'), Buffer.from(sha256Hex(b), 'hex'));
}

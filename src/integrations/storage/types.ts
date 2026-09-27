import type { Readable } from 'node:stream';

/**
 * Opslagabstractie voor klantmateriaal (originelen en afgeleiden). Fase 1 heeft alleen een lokale,
 * private implementatie (`LocalStorage`); een toekomstige S3-compatibele adapter implementeert
 * dezelfde interface zodat de rest van de app niet hoeft te wijzigen (zie ADR-009).
 */
export interface StoragePort {
  /** Slaat data op onder `key` en levert de daadwerkelijke grootte terug (voor controle). */
  put(key: string, data: Buffer): Promise<{ sizeBytes: number }>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Ongeldige opslagsleutel: ${key}`);
    this.name = 'StorageKeyError';
  }
}

/**
 * Genereert een niet-voorspelbare, veilige opslagsleutel. Nooit een door de gebruiker aangeleverde
 * bestandsnaam gebruiken (pad-traversal, botsingen, informatielek).
 */
export function assertSafeKey(key: string): void {
  // Alleen [a-z0-9/_.-], geen "..", geen leidende "/", geen lege segmenten.
  if (
    !/^[a-z0-9][a-z0-9/_.-]*$/.test(key) ||
    key.includes('..') ||
    key.includes('//') ||
    key.length > 300
  ) {
    throw new StorageKeyError(key);
  }
}

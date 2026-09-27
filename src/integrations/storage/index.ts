import type { Env } from '../../config/env.js';
import { LocalStorage } from './local.js';
import type { StoragePort } from './types.js';

export type { StoragePort } from './types.js';
export { LocalStorage } from './local.js';

/** Fabriceert de geconfigureerde opslagadapter. Fase 1: alleen `local` (zie ADR-009). */
export function createStorage(env: Env): StoragePort {
  return new LocalStorage(env.UPLOAD_PRIVATE_PATH);
}

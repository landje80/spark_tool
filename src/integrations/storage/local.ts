import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { assertSafeKey, type StoragePort } from './types.js';

/**
 * Lokale, private opslag (buiten de document root). Elke sleutel wordt herleid tot een pad ónder
 * `root`; `assertSafeKey` plus een expliciete `startsWith`-controle op het opgeloste pad voorkomen
 * pad-traversal, ook als `assertSafeKey` ooit een geval zou missen.
 */
export class LocalStorage implements StoragePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error('Opslagsleutel valt buiten de toegestane map');
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<{ sizeBytes: number }> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { mode: 0o600 });
    return { sizeBytes: data.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  getStream(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.resolve(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

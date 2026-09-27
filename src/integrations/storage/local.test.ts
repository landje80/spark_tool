import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorage } from './local.js';
import { StorageKeyError } from './types.js';

let dir: string;
let storage: LocalStorage;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-storage-'));
  storage = new LocalStorage(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('LocalStorage', () => {
  it('slaat data op en leest die weer terug', async () => {
    const data = Buffer.from('hallo wereld');
    const { sizeBytes } = await storage.put('submissions/abc/originals/1.jpg', data);
    expect(sizeBytes).toBe(data.byteLength);
    expect(await storage.exists('submissions/abc/originals/1.jpg')).toBe(true);
    expect(await storage.get('submissions/abc/originals/1.jpg')).toEqual(data);
  });

  it('verwijdert een bestand', async () => {
    await storage.put('to-delete.jpg', Buffer.from('x'));
    await storage.delete('to-delete.jpg');
    expect(await storage.exists('to-delete.jpg')).toBe(false);
  });

  it('exists() geeft false voor een niet-bestaande sleutel', async () => {
    expect(await storage.exists('nooit-aangemaakt.jpg')).toBe(false);
  });

  it('weigert pad-traversal via ".."', async () => {
    await expect(storage.put('../buiten.txt', Buffer.from('x'))).rejects.toThrow(StorageKeyError);
    await expect(storage.get('../../etc/passwd')).rejects.toThrow(StorageKeyError);
  });

  it('weigert een absoluut pad of een sleutel met dubbele slash', async () => {
    await expect(storage.put('/etc/passwd', Buffer.from('x'))).rejects.toThrow(StorageKeyError);
    await expect(storage.put('a//b.jpg', Buffer.from('x'))).rejects.toThrow(StorageKeyError);
  });
});

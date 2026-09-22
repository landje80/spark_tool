import { describe, expect, it } from 'vitest';
import { installBigIntJsonSafety } from './json-safety.js';

describe('installBigIntJsonSafety', () => {
  it('serialiseert BigInt als string i.p.v. te crashen', () => {
    installBigIntJsonSafety();
    expect(JSON.stringify({ n: 123_456n })).toBe('{"n":"123456"}');
  });

  it('is idempotent: dubbel aanroepen blijft correct werken', () => {
    installBigIntJsonSafety();
    installBigIntJsonSafety();
    expect(JSON.stringify(9007199254740993n)).toBe('"9007199254740993"');
  });
});

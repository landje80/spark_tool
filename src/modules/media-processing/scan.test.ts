import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sniffAndValidate } from './scan.js';

function tinyImage(fmt: 'jpeg' | 'png' | 'webp') {
  const img = sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } });
  return img[fmt]().toBuffer();
}

describe('sniffAndValidate', () => {
  it('accepteert een echte JPEG als IMAGE', async () => {
    const res = await sniffAndValidate(await tinyImage('jpeg'), 'IMAGE');
    expect(res.ok).toBe(true);
    expect(res.mime).toBe('image/jpeg');
  });

  it('accepteert een echte PNG en WEBP als IMAGE', async () => {
    expect((await sniffAndValidate(await tinyImage('png'), 'IMAGE')).mime).toBe('image/png');
    expect((await sniffAndValidate(await tinyImage('webp'), 'IMAGE')).mime).toBe('image/webp');
  });

  it('wijst af als de werkelijke MIME niet bij de opgegeven soort past', async () => {
    const res = await sniffAndValidate(await tinyImage('jpeg'), 'VIDEO');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('kind_mismatch');
  });

  it('wijst een herkend maar niet-toegestaan bestandstype af (bv. PDF)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');
    const res = await sniffAndValidate(pdf, 'IMAGE');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_allowed');
  });

  it('wijst onherkenbare data af', async () => {
    const res = await sniffAndValidate(
      Buffer.from('gewoon wat platte tekst, geen bestand'),
      'IMAGE',
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unrecognized');
  });

  it('herkent nooit SVG als toegestaan (XSS-risico), ook niet als "afbeelding"', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const res = await sniffAndValidate(svg, 'IMAGE');
    expect(res.ok).toBe(false);
  });
});

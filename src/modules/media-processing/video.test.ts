import { describe, expect, it } from 'vitest';
import { extractThumbnail, probeVideo } from './video.js';

// video.ts belooft nooit te gooien: videoverwerking is optioneel en mag de rest van de app nooit
// blokkeren als ffmpeg/ffprobe ontbreekt of iets onverwachts teruggeeft. Deze tests controleren die
// belofte zonder een echte ffmpeg/ffprobe-installatie nodig te hebben.
//
// Een `spawn()` van een niet-bestaand pad (ENOENT) is op elk platform hetzelfde en dus goed
// cross-platform te testen. Een "non-zero exitcode"-scenario zonder shell en zonder een echt
// ffmpeg-compatibel programma is dat niet (een controleerbaar nep-binary rechtstreeks spawnen
// gedraagt zich anders op Windows dan op POSIX); dat pad deelt in de code dezelfde
// `code === 0 ? buffer : null`-afhandeling als de hier wel geteste paden en wordt in de praktijk
// meegetest door de smoke-test met een echte ffmpeg-installatie.
const NONEXISTENT_BINARY = '/definitely/does-not-exist/ffmpeg-xyz';

describe('probeVideo', () => {
  it('geeft null terug (geen throw) als de ffprobe-binary niet bestaat', async () => {
    await expect(probeVideo('/tmp/video.mp4', NONEXISTENT_BINARY)).resolves.toBeNull();
  });

  it('geeft null terug (geen throw) als de binary geen geldige JSON teruggeeft', async () => {
    // `node -v` is een deterministisch, overal aanwezig programma dat iets op stdout schrijft dat
    // geen geldige JSON is en met exitcode 0 afsluit — precies het scenario in de catch-tak van
    // probeVideo (ffprobe-uitvoer onleesbaar).
    await expect(probeVideo('/tmp/video.mp4', process.execPath)).resolves.toBeNull();
  });

  it('gebruikt "ffprobe" op PATH als er geen ffmpegPath is meegegeven, en gooit nooit', async () => {
    // Of ffprobe toevallig wel of niet op PATH staat in de testomgeving: dit mag nooit een
    // onafgevangen fout geven, alleen null of een geldig resultaat.
    const result = await probeVideo('/tmp/video-die-niet-bestaat.mp4', undefined);
    expect(result === null || typeof result.durationSec === 'number').toBe(true);
  });
});

describe('extractThumbnail', () => {
  it('geeft null terug (geen throw) als de ffmpeg-binary niet bestaat', async () => {
    await expect(extractThumbnail('/tmp/video.mp4', NONEXISTENT_BINARY, 1)).resolves.toBeNull();
  });

  it('klemt een negatieve tijdstip af naar 0 in plaats van een ongeldig argument door te geven', async () => {
    // Geen throw, ook al is atSeconds negatief; de binary bestaat toch niet, dus het resultaat is
    // sowieso null, maar dit dekt dat Math.max(0, atSeconds) nooit een uitzondering veroorzaakt.
    await expect(extractThumbnail('/tmp/video.mp4', NONEXISTENT_BINARY, -5)).resolves.toBeNull();
  });
});

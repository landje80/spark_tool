import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.js';

const BOM = String.fromCharCode(0xfeff);

describe('csv', () => {
  it('neutraliseert formule-injectie', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+31612345678')).toBe("'+31612345678");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
  it('quote scheidingstekens en nieuwe regels', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(null)).toBe('');
  });
  it('bouwt een bestand met BOM en CRLF', () => {
    const out = toCsv(['naam', 'plaats'], [['Bakkerij', 'Zwolle']]);
    expect(out.startsWith(`${BOM}naam;plaats\r\n`)).toBe(true);
    expect(out.endsWith('Bakkerij;Zwolle\r\n')).toBe(true);
  });
});

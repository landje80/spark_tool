import { AppError } from '../../shared/errors/app-error.js';
import { escapeHtml } from '../../shared/http/public-page.js';

export { escapeHtml };

/** Bevat de waarde regeleinden of een NUL-teken? (Bewust zonder tekenklasse: formatters herschrijven die onzichtbaar.) */
export function hasLineBreaks(value: string): boolean {
  return value.includes('\n') || value.includes('\r') || value.includes(String.fromCharCode(0));
}

/** Voorkomt header-injectie: geen regeleinden of NUL-tekens in waarden die in headers terechtkomen. */
export function assertHeaderSafe(value: string, field: string): string {
  if (hasLineBreaks(value)) {
    throw new AppError('VALIDATION_ERROR', 'Ongeldige invoer', [
      { path: field, message: 'Bevat ongeldige regeleinden' },
    ]);
  }
  return value.trim();
}

/** Stuurtekens behalve tab (9), nieuwe regel (10) en carriage return (13). */
const isControlChar = (code: number): boolean =>
  code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;

/** Normaliseert tekst: LF, geen stuurtekens (behalve nieuwe regel en tab), maximaal twee opeenvolgende lege regels. */
export function cleanText(input: string): string {
  const unified = input.replace(/\r\n?/g, '\n');
  let out = '';
  for (const ch of unified) if (!isControlChar(ch.charCodeAt(0))) out += ch;
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Alinea's zijn door een lege regel gescheiden blokken. */
export function paragraphsOf(text: string): string[] {
  return cleanText(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Bouwt HTML uitsluitend uit platte tekst: alles wordt geëscaped en alleen <p>/<br> worden toegevoegd.
 * Ruwe HTML van gebruikers of AI komt daardoor nooit in een e-mail terecht (geen XSS/injectie).
 */
export function renderHtml(
  paragraphs: readonly string[],
  footerParagraphs: readonly string[] = [],
): string {
  const block = (p: string) =>
    `<p style="margin:0 0 14px 0">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`;
  const body = paragraphs.map(block).join('');
  const footer = footerParagraphs.length
    ? `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0"><div style="font-size:12px;color:#666">${footerParagraphs.map(block).join('')}</div>`
    : '';
  return `<!doctype html><html lang="nl"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#241a12">${body}${footer}</body></html>`;
}

export function renderText(
  paragraphs: readonly string[],
  footerParagraphs: readonly string[] = [],
): string {
  const main = paragraphs.join('\n\n');
  return footerParagraphs.length
    ? `${main}\n\n--\n${footerParagraphs.join('\n\n')}\n`
    : `${main}\n`;
}

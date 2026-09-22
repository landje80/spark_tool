/**
 * Zet een fout om naar een tekst die veilig is om op te slaan/te tonen: nooit Prisma-queryargumenten
 * (persoons-/bedrijfsgegevens) en nooit API-sleutels of Authorization-headers die per ongeluk in een
 * foutmelding terecht zijn gekomen.
 */
export function safeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Onbekende fout';
  const code = (err as { code?: unknown }).code;
  if (err.name.startsWith('Prisma') || (typeof code === 'string' && /^P\d{4}$/.test(code))) {
    return `${err.name}${typeof code === 'string' ? ` (${code})` : ''}`;
  }
  return `${err.name}: ${err.message}`
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/(x-api-key|authorization)\s*[:=]?\s*\S+/gi, '$1: [REDACTED]')
    .slice(0, 500);
}

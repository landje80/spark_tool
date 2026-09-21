const BOM = String.fromCharCode(0xfeff);

/** Voorkomt CSV/formule-injectie: cellen die met = + - @ (of tab/CR) beginnen krijgen een apostrof. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(csvCell).join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  // BOM zodat Excel UTF-8 goed herkent.
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

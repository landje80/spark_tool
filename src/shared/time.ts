/** Offset (ms) van `tz` ten opzichte van UTC op het gegeven moment. */
export function tzOffsetMs(instantMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    p.year ?? 0,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Begin (00:00 lokale tijd in `tz`) van de dag waarin `instant` valt, als UTC-moment. */
export function startOfDay(instant: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant); // YYYY-MM-DD
  const [y, m, d] = parts.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(guess, tz);
  return new Date(guess - tzOffsetMs(first, tz)); // tweede pass corrigeert rond zomer/wintertijd
}

/** Begin van de volgende lokale dag (dagen kunnen 23 of 25 uur duren). */
export function startOfNextDay(instant: Date, tz: string): Date {
  const start = startOfDay(instant, tz);
  return startOfDay(new Date(start.getTime() + 36 * 3600 * 1000), tz);
}

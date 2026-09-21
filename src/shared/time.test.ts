import { describe, expect, it } from 'vitest';
import { startOfDay, startOfNextDay } from './time.js';

const TZ = 'Europe/Amsterdam';

describe('dagbegrenzing in Europe/Amsterdam', () => {
  it('zomertijd (UTC+2)', () => {
    expect(startOfDay(new Date('2026-09-21T10:00:00Z'), TZ).toISOString()).toBe(
      '2026-09-20T22:00:00.000Z',
    );
  });
  it('wintertijd (UTC+1)', () => {
    expect(startOfDay(new Date('2026-01-15T10:00:00Z'), TZ).toISOString()).toBe(
      '2026-01-14T23:00:00.000Z',
    );
  });
  it('late avond UTC valt al op de volgende lokale dag', () => {
    expect(startOfDay(new Date('2026-09-21T23:30:00Z'), TZ).toISOString()).toBe(
      '2026-09-21T22:00:00.000Z',
    );
  });
  it('dag met overgang naar zomertijd duurt 23 uur', () => {
    const start = startOfDay(new Date('2026-03-29T12:00:00Z'), TZ);
    const next = startOfNextDay(new Date('2026-03-29T12:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(next.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect((next.getTime() - start.getTime()) / 3600000).toBe(23);
  });
});

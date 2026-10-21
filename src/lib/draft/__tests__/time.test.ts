import { describe, expect, it } from 'vitest';
import { LEAGUE_TIME_ZONE as CONFIG_ZONE } from '@/i18n/config';
import { LEAGUE_TIME_ZONE, defaultRedraftDeadline, wallTimeInZone, zonedWallTimeToUtc } from '../time';

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

describe('LEAGUE_TIME_ZONE', () => {
  it('is the @/i18n/config value', () => {
    expect(LEAGUE_TIME_ZONE).toBe(CONFIG_ZONE);
    expect(LEAGUE_TIME_ZONE).toBe('Europe/Berlin');
  });
});

describe('zonedWallTimeToUtc', () => {
  it('converts Berlin wall time in summer (CEST) and winter (CET)', () => {
    expect(iso(zonedWallTimeToUtc({ year: 2026, month: 10, day: 11, hour: 23, minute: 59, second: 59 }, 'Europe/Berlin'))).toBe(
      '2026-10-11T21:59:59Z',
    );
    expect(iso(zonedWallTimeToUtc({ year: 2026, month: 10, day: 25, hour: 23, minute: 59, second: 59 }, 'Europe/Berlin'))).toBe(
      '2026-10-25T22:59:59Z',
    );
  });

  it('round-trips with wallTimeInZone', () => {
    const wall = { year: 2026, month: 3, day: 29, hour: 23, minute: 59, second: 59 };
    expect(wallTimeInZone(zonedWallTimeToUtc(wall, 'Europe/Berlin'), 'Europe/Berlin')).toEqual(wall);
  });

  it('handles another zone and UTC', () => {
    expect(iso(zonedWallTimeToUtc({ year: 2026, month: 1, day: 4, hour: 12, minute: 0, second: 0 }, 'America/New_York'))).toBe(
      '2026-01-04T17:00:00Z',
    );
    expect(iso(zonedWallTimeToUtc({ year: 2026, month: 1, day: 4, hour: 12, minute: 0, second: 0 }, 'UTC'))).toBe(
      '2026-01-04T12:00:00Z',
    );
  });
});

describe('defaultRedraftDeadline (§7.7 vectors = FE §5.7)', () => {
  const cases: [string, string, number?][] = [
    ['2026-10-21T12:00:00Z', '2026-10-25T22:59:59Z'], // CET after the DST end
    ['2026-03-25T12:00:00Z', '2026-03-29T21:59:59Z'], // CEST after the DST start
    ['2026-10-11T20:00:00Z', '2026-10-11T21:59:59Z'], // Sunday 22:00 Berlin → same evening
    ['2026-10-11T21:59:59Z', '2026-10-18T21:59:59Z'], // exactly Sunday 23:59:59 → next week
    ['2026-10-11T20:00:00Z', '2026-10-18T21:59:59Z', 86_400_000], // N4 option: 24 h lead
  ];

  it.each(cases)('%s → %s (minLeadMs %s)', (now, expected, minLeadMs) => {
    const opts = minLeadMs === undefined ? undefined : { minLeadMs };
    expect(iso(defaultRedraftDeadline(new Date(now), opts))).toBe(expected);
  });

  it('is strictly later than now and lands on Sunday 23:59:59 in the league zone', () => {
    for (let day = 0; day < 14; day++) {
      const now = new Date(Date.UTC(2026, 9, 5 + day, 9, 30));
      const deadline = defaultRedraftDeadline(now);
      expect(deadline.getTime()).toBeGreaterThan(now.getTime());
      expect(deadline.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
      const wall = wallTimeInZone(deadline, LEAGUE_TIME_ZONE);
      expect(new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()).toBe(0);
      expect([wall.hour, wall.minute, wall.second]).toEqual([23, 59, 59]);
    }
  });

  it('honours an explicit time zone', () => {
    expect(iso(defaultRedraftDeadline(new Date('2026-10-21T12:00:00Z'), { timeZone: 'UTC' }))).toBe('2026-10-25T23:59:59Z');
  });
});

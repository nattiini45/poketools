import { describe, expect, it } from 'vitest';
import vectors from './fixtures/quiet-hours-vectors.json';
import {
  addRunningMs,
  isValidQuietHours,
  quietWindowEnd,
  runningMsBetween,
  wallTimeInZone,
  type QuietHours,
} from '../time';

type QuietKey = keyof typeof vectors.quiet;

const quietOf = (key: string | null): QuietHours | null => (key === null ? null : vectors.quiet[key as QuietKey]);
const ms = (iso: string): number => Date.parse(iso);
const iso = (value: number | null): string | null => (value === null ? null : new Date(value).toISOString().replace('.000Z', 'Z'));

const BERLIN: QuietHours = vectors.quiet.berlin;

describe('quiet-hours vectors (shared with the SQL parity test)', () => {
  it.each(vectors.windowEnd.map((v) => [v.name, v] as const))('windowEnd: %s', (_name, v) => {
    expect(iso(quietWindowEnd(ms(v.at), quietOf(v.quiet)))).toBe(v.expected);
  });

  it.each(vectors.running.map((v) => [v.name, v] as const))('running: %s', (_name, v) => {
    expect(runningMsBetween(ms(v.from), ms(v.to), quietOf(v.quiet))).toBe(v.expected_ms);
  });

  it.each(vectors.add.map((v) => [v.name, v] as const))('add: %s', (_name, v) => {
    expect(iso(addRunningMs(ms(v.from), v.ms, quietOf(v.quiet)))).toBe(v.expected);
  });
});

describe('quiet-hours invariants', () => {
  // Every 23 minutes over a week that contains the DST end night (an odd step, so starts hit every minute of the
  // hour over the run), with live and slow clock lengths.
  const starts = Array.from({ length: 440 }, (_, i) => ms('2026-10-22T00:00:00Z') + i * 23 * 60_000);
  const lengths = [150_000, 300_000, 5_400_000, 43_200_000, 172_800_000];

  it('no deadline lies strictly inside a window, and the deadline is exactly `ms` running time away', () => {
    for (const from of starts) {
      for (const len of lengths) {
        const deadline = addRunningMs(from, len, BERLIN);
        expect(deadline).toBeGreaterThanOrEqual(from + len);
        const end = quietWindowEnd(deadline, BERLIN);
        // A deadline may coincide with a window start (the rest ran out at 00:00), never later inside it.
        if (end !== null) expect(quietWindowEnd(deadline - 1, BERLIN)).toBeNull();
        expect(runningMsBetween(from, deadline, BERLIN)).toBe(len);
      }
    }
  });

  it('pause then resume keeps the running remainder (resume = add of the frozen ms)', () => {
    const deadline = addRunningMs(ms('2026-10-24T20:00:00Z'), 43_200_000, BERLIN);
    const pausedAt = ms('2026-10-25T02:00:00Z'); // inside the 7 h DST night
    const frozen = runningMsBetween(pausedAt, deadline, BERLIN);
    const resumedAt = ms('2026-10-25T13:00:00Z');
    const resumed = addRunningMs(resumedAt, frozen, BERLIN);
    expect(runningMsBetween(resumedAt, resumed, BERLIN)).toBe(frozen);
    // The frozen rest did not shrink while the clock was held.
    expect(runningMsBetween(pausedAt, deadline, BERLIN)).toBe(runningMsBetween(ms('2026-10-25T05:00:00Z'), deadline, BERLIN));
  });

  it('an extension adds exactly its running time', () => {
    const deadline = addRunningMs(ms('2026-10-17T21:58:00Z'), 300_000, BERLIN);
    const extended = addRunningMs(deadline, 120_000, BERLIN);
    expect(runningMsBetween(ms('2026-10-17T21:58:00Z'), extended, BERLIN)).toBe(420_000);
  });

  it('every window is [00:00, 06:00) Berlin wall time across both DST switches', () => {
    for (const day of ['2026-10-24T22:00:00Z', '2027-03-27T23:00:00Z', '2026-07-01T22:00:00Z']) {
      const end = quietWindowEnd(ms(day), BERLIN);
      expect(end).not.toBeNull();
      const wall = wallTimeInZone(new Date(end as number), 'Europe/Berlin');
      expect([wall.hour, wall.minute, wall.second]).toEqual([6, 0, 0]);
    }
  });

  it('null quiet hours are the identity (wall time)', () => {
    for (const from of starts.slice(0, 50)) {
      expect(addRunningMs(from, 300_000, null)).toBe(from + 300_000);
      expect(runningMsBetween(from, from + 300_000, null)).toBe(300_000);
      expect(quietWindowEnd(from, null)).toBeNull();
    }
  });

  it('non-positive ms returns the start unchanged', () => {
    expect(addRunningMs(1000, 0, BERLIN)).toBe(1000);
    expect(addRunningMs(1000, -5, BERLIN)).toBe(1000);
  });
});

describe('quiet-hours validation', () => {
  it.each([
    [{ startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' }, true],
    [{ startHour: 0, endHour: 23, timeZone: 'UTC' }, true],
    [{ startHour: 0, endHour: 24, timeZone: 'UTC' }, false], // the clock would never run
    [{ startHour: 6, endHour: 6, timeZone: 'UTC' }, false],
    [{ startHour: 22, endHour: 6, timeZone: 'UTC' }, false],
    [{ startHour: -1, endHour: 6, timeZone: 'UTC' }, false],
    [{ startHour: 0.5, endHour: 6, timeZone: 'UTC' }, false],
    [{ startHour: 0, endHour: 6, timeZone: '' }, false],
    [{ startHour: 0, endHour: 6, timeZone: 'X'.repeat(65) }, false], // draft__cfg_quiet: length 1..64
  ] as const)('%j → %s', (q, ok) => {
    expect(isValidQuietHours(q)).toBe(ok);
  });

  it('the helpers refuse an invalid window instead of looping', () => {
    const allDay: QuietHours = { startHour: 0, endHour: 24, timeZone: 'UTC' };
    expect(() => addRunningMs(0, 1000, allDay)).toThrow(/invalid quiet hours/);
    expect(() => runningMsBetween(0, 1000, allDay)).toThrow(/invalid quiet hours/);
    expect(() => quietWindowEnd(0, allDay)).toThrow(/invalid quiet hours/);
  });
});

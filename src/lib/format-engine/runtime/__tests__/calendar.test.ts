import { describe, expect, it } from 'vitest';
import type { PlayerActionRule, StageCalendar } from '@/lib/format-kit/types';
import {
  actionPolicyAt,
  calendarRoundAt,
  dueMarks,
  markAt,
  roundDeadlineAt,
  roundDeadlineIso,
  roundOpensAt,
  roundPolicyAt,
} from '../calendar';

function calendar(overrides: Partial<StageCalendar> = {}): StageCalendar {
  return {
    start: { kind: 'date', date: '2026-03-23' },
    time: '18:00',
    cadence: 'weekly',
    every: 1,
    round_window_hours: 168,
    marks: [],
    deadlines: [],
    ...overrides,
  };
}

const clock = { timeZone: 'Europe/Berlin', seasonStart: null };
const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

describe('roundOpensAt', () => {
  it('opens round 1 at the wall time of the start date', () => {
    expect(iso(roundOpensAt(calendar(), 1, clock))).toBe('2026-03-23T17:00:00.000Z');
  });

  it('keeps the wall time across the spring DST change', () => {
    // 2026-03-29 02:00 CET -> 03:00 CEST: round 2 (03-30) is an hour earlier in UTC.
    expect(iso(roundOpensAt(calendar(), 2, clock))).toBe('2026-03-30T16:00:00.000Z');
  });

  it('keeps the wall time across the autumn DST change', () => {
    const autumn = calendar({ start: { kind: 'date', date: '2026-10-19' } });
    expect(iso(roundOpensAt(autumn, 1, clock))).toBe('2026-10-19T16:00:00.000Z');
    expect(iso(roundOpensAt(autumn, 2, clock))).toBe('2026-10-26T17:00:00.000Z');
  });

  it('steps by days for the daily cadence and by every', () => {
    const days = calendar({ cadence: 'days', every: 3, time: '09:30' });
    expect(iso(roundOpensAt(days, 3, clock))).toBe('2026-03-29T07:30:00.000Z');
    expect(iso(roundOpensAt(calendar({ every: 2 }), 3, clock))).toBe('2026-04-20T16:00:00.000Z');
  });

  it('resolves a time that does not exist on the DST day to the gap shift', () => {
    const gap = calendar({ start: { kind: 'date', date: '2026-03-29' }, cadence: 'days', time: '02:30' });
    expect(iso(roundOpensAt(gap, 1, clock))).toBe('2026-03-29T01:30:00.000Z');
  });

  it('reads the time in UTC when the clock says so', () => {
    expect(iso(roundOpensAt(calendar(), 1, { timeZone: 'UTC', seasonStart: null }))).toBe('2026-03-23T18:00:00.000Z');
  });

  it('uses the season start for a season_start calendar and cuts a longer date', () => {
    const seasonal = calendar({ start: { kind: 'season_start' } });
    expect(iso(roundOpensAt(seasonal, 1, { ...clock, seasonStart: '2026-05-04' }))).toBe('2026-05-04T16:00:00.000Z');
    expect(iso(roundOpensAt(seasonal, 1, { ...clock, seasonStart: '2026-05-04T00:00:00Z' }))).toBe('2026-05-04T16:00:00.000Z');
  });

  it('is null when the start is unknown, the time or the round is invalid', () => {
    const seasonal = calendar({ start: { kind: 'season_start' } });
    expect(roundOpensAt(seasonal, 1, clock)).toBeNull();
    expect(roundOpensAt(calendar({ time: '25:00' }), 1, clock)).toBeNull();
    expect(roundOpensAt(calendar({ start: { kind: 'date', date: '2026-02-30' } }), 1, clock)).toBeNull();
    expect(roundOpensAt(calendar(), 0, clock)).toBeNull();
  });
});

describe('deadlines, marks and policies', () => {
  it('closes a round after the window in elapsed hours', () => {
    expect(iso(roundDeadlineAt(calendar({ round_window_hours: 120 }), 1, clock))).toBe('2026-03-28T17:00:00.000Z');
    // The window of round 1 runs over the DST change: 168 elapsed hours end an hour later on the wall clock (19:00 CEST).
    expect(iso(roundDeadlineAt(calendar(), 1, clock))).toBe('2026-03-30T17:00:00.000Z');
    expect(roundDeadlineIso(calendar(), 1, clock)).toBe('2026-03-30T17:00:00.000Z');
  });

  it('places a mark relative to the opening of its round and lists the due ones', () => {
    const marked = calendar({
      marks: [
        { key: 'early', round: 1, offset_hours: -12 },
        { key: 'later', round: 3, offset_hours: 0 },
      ],
    });
    expect(iso(markAt(marked, marked.marks[0], clock))).toBe('2026-03-23T05:00:00.000Z');
    expect(dueMarks(marked, clock, new Date('2026-03-23T04:59:59Z'))).toEqual([]);
    expect(dueMarks(marked, clock, new Date('2026-03-23T05:00:00Z')).map((m) => m.key)).toEqual(['early']);
    expect(dueMarks(marked, clock, new Date('2026-04-30T00:00:00Z')).map((m) => m.key)).toEqual(['early', 'later']);
  });

  it('lists due marks in calendar order, not declaration order (ties keep the declaration order)', () => {
    const marked = calendar({
      marks: [
        { key: 'close', round: 1, offset_hours: 24 },
        { key: 'open', round: 1, offset_hours: 0 },
        { key: 'tie_b', round: 1, offset_hours: 24 },
        { key: 'next_round', round: 2, offset_hours: -48 },
      ],
    });
    expect(dueMarks(marked, clock, new Date('2030-01-01T00:00:00Z')).map((m) => m.key)).toEqual(['open', 'close', 'tie_b', 'next_round']);
  });

  it('has no due marks when the calendar cannot be read', () => {
    const seasonal = calendar({ start: { kind: 'season_start' }, marks: [{ key: 'a', round: 1, offset_hours: 0 }] });
    expect(dueMarks(seasonal, clock, new Date('2030-01-01T00:00:00Z'))).toEqual([]);
  });

  it('adds the policy offset to the round deadline, and a stored deadline wins over the calendar', () => {
    const policy = { offset_hours: -24 };
    expect(iso(roundPolicyAt(calendar({ round_window_hours: 120 }), policy, 1, clock))).toBe('2026-03-27T17:00:00.000Z');
    expect(iso(roundPolicyAt(calendar(), policy, 1, clock, '2026-04-01T00:00:00.000Z'))).toBe('2026-03-31T00:00:00.000Z');
    expect(iso(roundPolicyAt(calendar(), policy, 1, clock, null))).toBe('2026-03-29T17:00:00.000Z');
  });

  it('anchors an action policy at the closing mark, the closing round or round 1', () => {
    const marked = calendar({ marks: [{ key: 'gift_deadline', round: 1, offset_hours: -12 }] });
    const action = (closes_on?: PlayerActionRule['window']['closes_on']): Pick<PlayerActionRule, 'window'> => ({
      window: closes_on === undefined ? {} : { closes_on },
    });
    const policy = { offset_hours: -24 };
    expect(iso(actionPolicyAt(marked, policy, action({ event: 'time', mark: 'gift_deadline' }), clock))).toBe('2026-03-22T05:00:00.000Z');
    expect(iso(actionPolicyAt(marked, policy, action({ event: 'round_start', round: 2 }), clock))).toBe('2026-03-29T16:00:00.000Z');
    expect(iso(actionPolicyAt(marked, policy, action(), clock))).toBe('2026-03-22T17:00:00.000Z');
    expect(iso(actionPolicyAt(marked, policy, action({ event: 'time', mark: 'unknown' }), clock))).toBe('2026-03-22T17:00:00.000Z');
    expect(iso(actionPolicyAt(marked, policy, null, clock))).toBe('2026-03-22T17:00:00.000Z');
  });
});

describe('calendarRoundAt', () => {
  const at = (text: string) => new Date(text);

  it('is round 1 before the first round opens, and from the moment it does', () => {
    expect(calendarRoundAt(calendar(), clock, at('2026-01-01T00:00:00Z'))).toBe(1);
    expect(calendarRoundAt(calendar(), clock, at('2026-03-23T17:00:00Z'))).toBe(1);
  });

  it('counts the rounds that have opened, a round changing at its own instant', () => {
    // Round 2 opens 2026-03-30 18:00 Berlin = 16:00Z (CEST).
    expect(calendarRoundAt(calendar(), clock, at('2026-03-30T15:59:59Z'))).toBe(1);
    expect(calendarRoundAt(calendar(), clock, at('2026-03-30T16:00:00Z'))).toBe(2);
    expect(calendarRoundAt(calendar(), clock, at('2026-04-14T00:00:00Z'))).toBe(4);
  });

  it('follows the cadence and the season start date', () => {
    const daily = calendar({ start: { kind: 'season_start' }, cadence: 'days', every: 2 });
    const seasonClock = { timeZone: 'Europe/Berlin', seasonStart: '2026-03-23' };
    expect(calendarRoundAt(daily, seasonClock, at('2026-03-26T00:00:00Z'))).toBe(2);
    expect(calendarRoundAt(daily, seasonClock, at('2026-03-28T00:00:00Z'))).toBe(3);
  });

  it('is capped at the highest round number the API accepts', () => {
    expect(calendarRoundAt(calendar(), clock, at('2099-01-01T00:00:00Z'))).toBe(500);
  });

  it('is null when the calendar cannot be read', () => {
    expect(calendarRoundAt(calendar({ start: { kind: 'season_start' } }), clock, at('2026-04-14T00:00:00Z'))).toBeNull();
    expect(calendarRoundAt(calendar({ time: '25:00' }), clock, at('2026-04-14T00:00:00Z'))).toBeNull();
  });
});

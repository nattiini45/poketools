import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { createFormatter } from '@/i18n/format';
import { LEAGUE_TIME_ZONE as CONFIG_ZONE } from '@/i18n/config';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import {
  computeClock,
  countdownParts,
  formatCountdown,
  formatDuration,
  LEAGUE_TIME_ZONE,
  type ActiveSlotLike,
} from '@/lib/draft-ui/clock';

const NOW = Date.parse('2026-10-09T12:00:00.000Z');

function slot(durationMs: number, remainingMs: number, extra: Partial<ActiveSlotLike> = {}): ActiveSlotLike {
  return {
    duration_ms: durationMs,
    extensions_applied_ms: 0,
    deadline_at: new Date(NOW + remainingMs).toISOString(),
    remaining_ms_at_pause: null,
    ...extra,
  };
}

const en = { f: createFormatter({ locale: 'en', timeZone: 'UTC' }), t: createTranslator(draftSharedMessages, 'en') };
const de = { f: createFormatter({ locale: 'de', timeZone: 'UTC' }), t: createTranslator(draftSharedMessages, 'de') };

describe('computeClock bands (§5.7 vectors)', () => {
  it.each([
    ['5:00 slot, 151 s left', 300_000, 151_000, 'ok'],
    ['5:00 slot, 150 s left', 300_000, 150_000, 'warn'],
    ['5:00 slot, 61 s left', 300_000, 61_000, 'warn'],
    ['5:00 slot, 60 s left', 300_000, 60_000, 'low'],
    ['make-up 2:30, 76 s left', 150_000, 76_000, 'ok'],
    ['make-up 2:30, 75 s left', 150_000, 75_000, 'warn'],
    ['make-up 2:30, 30 s left', 150_000, 30_000, 'low'],
  ] as const)('%s → %s', (_label, duration, remaining, band) => {
    expect(computeClock(slot(duration, remaining), NOW)?.band).toBe(band);
  });

  it('bands on whole seconds (60.4 s left still counts as 61)', () => {
    expect(computeClock(slot(300_000, 60_400), NOW)?.band).toBe('warn');
  });
});

describe('computeClock', () => {
  it('returns null without an active slot', () => {
    expect(computeClock(null, NOW)).toBeNull();
  });

  it('freezes the remaining time while paused', () => {
    const clock = computeClock(slot(300_000, 0, { remaining_ms_at_pause: 83_000 }), NOW + 3_600_000);
    expect(clock).toMatchObject({ remainingMs: 83_000, paused: true, expired: false, deadlineAt: null });
  });

  it('adds extensions to the total and computes the ratio', () => {
    const clock = computeClock(slot(300_000, 210_000, { extensions_applied_ms: 120_000 }), NOW);
    expect(clock?.totalMs).toBe(420_000);
    expect(clock?.ratio).toBeCloseTo(0.5);
    expect(clock?.deadlineAt).toBe(NOW + 210_000);
  });

  it('clamps an overdue deadline to zero and marks it expired', () => {
    const clock = computeClock(slot(300_000, -5_000), NOW);
    expect(clock).toMatchObject({ remainingMs: 0, ratio: 0, band: 'low', expired: true });
  });

  it('shows the full time for a slot without a deadline', () => {
    const clock = computeClock(slot(300_000, 0, { deadline_at: null }), NOW);
    expect(clock).toMatchObject({ remainingMs: 300_000, ratio: 1, band: 'ok', expired: false, deadlineAt: null });
  });
});

describe('computeClock with draft quiet hours', () => {
  const BERLIN = { startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' } as const;
  // 23:55 Berlin (CEST) on 2026-10-17 with a 20 min live clock: 5 min before 00:00, 15 min after 06:00.
  const START = Date.parse('2026-10-17T21:55:00Z');
  const DEADLINE = '2026-10-18T04:15:00Z';
  const quietSlot = (extra: Partial<ActiveSlotLike> = {}): ActiveSlotLike => ({
    duration_ms: 1_200_000,
    extensions_applied_ms: 0,
    deadline_at: DEADLINE,
    remaining_ms_at_pause: null,
    quiet_hours: BERLIN,
    ...extra,
  });

  it('counts running time only: 20 min left at 23:55 although the deadline is 6 h 20 min away', () => {
    expect(computeClock(quietSlot(), START)).toMatchObject({ remainingMs: 1_200_000, heldUntil: null, expired: false });
  });

  it('stands still inside the window and says when it runs again', () => {
    const at0100 = computeClock(quietSlot(), Date.parse('2026-10-17T23:00:00Z'));
    const at0500 = computeClock(quietSlot(), Date.parse('2026-10-18T03:00:00Z'));
    expect(at0100?.remainingMs).toBe(900_000);
    expect(at0500?.remainingMs).toBe(900_000);
    expect(at0100?.heldUntil).toBe(Date.parse('2026-10-18T04:00:00Z'));
    expect(at0100?.expired).toBe(false);
    expect(at0100?.deadlineAt).toBe(Date.parse(DEADLINE));
  });

  it('ticks again from 06:00', () => {
    const clock = computeClock(quietSlot(), Date.parse('2026-10-18T04:05:00Z'));
    expect(clock).toMatchObject({ remainingMs: 600_000, heldUntil: null });
  });

  it('a pause is not affected (the frozen rest is already running time)', () => {
    const clock = computeClock(quietSlot({ deadline_at: null, remaining_ms_at_pause: 83_000 }), Date.parse('2026-10-17T23:00:00Z'));
    expect(clock).toMatchObject({ remainingMs: 83_000, paused: true, heldUntil: null });
  });

  it('without quiet hours it is the wall clock (null and absent alike)', () => {
    const at = Date.parse('2026-10-17T23:00:00Z');
    expect(computeClock(quietSlot({ quiet_hours: null }), at)).toMatchObject({ remainingMs: 18_900_000, heldUntil: null });
    const { quiet_hours: _omit, ...plain } = quietSlot();
    void _omit;
    expect(computeClock(plain, at)?.remainingMs).toBe(18_900_000);
  });
});

describe('countdownParts', () => {
  it('rounds up to the second', () => {
    expect(countdownParts(27_720_000)).toEqual({ h: 7, m: 42, s: 0 });
    expect(countdownParts(160_001)).toEqual({ h: 0, m: 2, s: 41 });
    expect(countdownParts(-1)).toEqual({ h: 0, m: 0, s: 0 });
  });
});

describe('formatCountdown', () => {
  it('live: clock digits in both languages', () => {
    expect(formatCountdown(161_000, 'live', en.f, en.t)).toBe('2:41');
    expect(formatCountdown(161_000, 'live', de.f, de.t)).toBe('2:41');
  });

  it('slow ≥ 1 h: hours and minutes', () => {
    expect(formatCountdown(27_720_000, 'slow', en.f, en.t)).toBe('7h 42m');
    expect(formatCountdown(27_720_000, 'slow', de.f, de.t)).toBe('7 Std. 42 Min.');
  });

  it('slow ≥ 24 h: days and hours', () => {
    // 1 d 7 h 42 m → minutes are dropped.
    expect(formatCountdown(114_120_000, 'slow', en.f, en.t)).toBe('1d 7h');
    expect(formatCountdown(114_120_000, 'slow', de.f, de.t)).toBe('1 T. 7 Std.');
    expect(formatCountdown(86_400_000, 'slow', en.f, en.t)).toBe('1d 0h');
    // Just under a day stays in hours.
    expect(formatCountdown(86_340_000, 'slow', en.f, en.t)).toBe('23h 59m');
  });

  it('slow < 1 h: minutes and seconds', () => {
    expect(formatCountdown(2_530_000, 'slow', en.f, en.t)).toBe('42m 10s');
    expect(formatCountdown(2_530_000, 'slow', de.f, de.t)).toBe('42 Min. 10 Sek.');
  });
});

describe('formatDuration (ladder labels)', () => {
  it('formats hours with the locale decimal separator', () => {
    expect(formatDuration(5400, en.t)).toBe('1.5h');
    expect(formatDuration(5400, de.t)).toBe('1,5 Std.');
    expect(formatDuration(43_200, en.t)).toBe('12h');
    expect(formatDuration(43_200, de.t)).toBe('12 Std.');
  });

  it('falls back to minutes under an hour', () => {
    expect(formatDuration(1800, en.t)).toBe('30m');
    expect(formatDuration(1800, de.t)).toBe('30 Min.');
  });
});

describe('LEAGUE_TIME_ZONE', () => {
  it('is the re-export of the i18n config zone (critique S10)', () => {
    expect(LEAGUE_TIME_ZONE).toBe(CONFIG_ZONE);
  });
});

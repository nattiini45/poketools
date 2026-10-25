import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resolveMatchListDateWindow, startOfZonedDay } from '../match-list-dates';

const BERLIN = 'Europe/Berlin';
/** 2026-10-25 11:00 in Berlin: the day the clocks go back (25 hours long). */
const DST_END_DAY = Date.parse('2026-10-25T10:00:00Z');
/** 2026-03-29 13:00 in Berlin: the day the clocks go forward (23 hours long). */
const DST_START_DAY = Date.parse('2026-03-29T11:00:00Z');

const none = { range: '' as const, from: '', to: '' };
const instant = z.iso.datetime({ offset: true });

describe('startOfZonedDay', () => {
  it('is midnight of the viewer\'s local day', () => {
    expect(startOfZonedDay(DST_END_DAY, BERLIN).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfZonedDay(DST_END_DAY, 'UTC').toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('counts calendar days, so a DST day is still one day', () => {
    expect(startOfZonedDay(DST_END_DAY, BERLIN, 1).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(startOfZonedDay(DST_END_DAY, BERLIN, -1).toISOString()).toBe('2026-10-23T22:00:00.000Z');
    expect(startOfZonedDay(DST_START_DAY, BERLIN).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfZonedDay(DST_START_DAY, BERLIN, 1).toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('rolls over month and year ends', () => {
    const newYearsEve = Date.parse('2026-12-31T12:00:00Z');
    expect(startOfZonedDay(newYearsEve, 'UTC', 1).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(startOfZonedDay(Date.parse('2027-01-01T12:00:00Z'), 'UTC', -1).toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('follows the viewer zone, not UTC', () => {
    // 23:30 UTC on the 25th is already the 26th in Berlin and still the 25th in New York.
    const now = Date.parse('2026-10-25T23:30:00Z');
    expect(startOfZonedDay(now, 'UTC').toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(startOfZonedDay(now, BERLIN).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(startOfZonedDay(now, 'America/New_York').toISOString()).toBe('2026-10-25T04:00:00.000Z');
  });
});

describe('resolveMatchListDateWindow', () => {
  it('returns null without a range, from or to', () => {
    expect(resolveMatchListDateWindow(none, { timeZone: BERLIN, nowMs: DST_END_DAY })).toBeNull();
  });

  it('"today" on the day the clocks go back spans 25 hours', () => {
    const window = resolveMatchListDateWindow({ ...none, range: 'today' }, { timeZone: BERLIN, nowMs: DST_END_DAY });
    expect(window).toEqual({ from: '2026-10-24T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' });
    expect((Date.parse(window!.to!) - Date.parse(window!.from!)) / 3_600_000).toBe(25);
  });

  it('"today" on the day the clocks go forward spans 23 hours', () => {
    const window = resolveMatchListDateWindow({ ...none, range: 'today' }, { timeZone: BERLIN, nowMs: DST_START_DAY });
    expect((Date.parse(window!.to!) - Date.parse(window!.from!)) / 3_600_000).toBe(23);
  });

  it('"today" in UTC is the UTC day', () => {
    expect(resolveMatchListDateWindow({ ...none, range: 'today' }, { timeZone: 'UTC', nowMs: DST_END_DAY })).toEqual({
      from: '2026-10-25T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
    });
  });

  it('"next7" runs from the start of today to the start of the 7th following day', () => {
    expect(resolveMatchListDateWindow({ ...none, range: 'next7' }, { timeZone: BERLIN, nowMs: DST_END_DAY })).toEqual({
      from: '2026-10-24T22:00:00.000Z',
      // 2026-11-01 00:00 CET
      to: '2026-10-31T23:00:00.000Z',
    });
  });

  it('"last7" runs from the start of 6 days ago to the start of tomorrow', () => {
    expect(resolveMatchListDateWindow({ ...none, range: 'last7' }, { timeZone: BERLIN, nowMs: DST_END_DAY })).toEqual({
      // 2026-10-19 00:00 CEST
      from: '2026-10-18T22:00:00.000Z',
      to: '2026-10-25T23:00:00.000Z',
    });
  });

  it('"none" is the unset marker with no instants', () => {
    expect(resolveMatchListDateWindow({ ...none, range: 'none' }, { timeZone: BERLIN, nowMs: DST_END_DAY })).toEqual({
      none: true,
    });
  });

  it('a custom to-day is inclusive: it becomes the start of the following local day', () => {
    const window = resolveMatchListDateWindow(
      { range: '', from: '2026-10-20', to: '2026-10-25' },
      { timeZone: BERLIN, nowMs: DST_END_DAY },
    );
    expect(window).toEqual({ from: '2026-10-19T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' });
  });

  it('keeps one-sided custom windows one-sided', () => {
    const clock = { timeZone: BERLIN, nowMs: DST_END_DAY };
    expect(resolveMatchListDateWindow({ range: '', from: '2026-10-20', to: '' }, clock)).toEqual({
      from: '2026-10-19T22:00:00.000Z',
    });
    expect(resolveMatchListDateWindow({ range: '', from: '', to: '2026-10-20' }, clock)).toEqual({
      to: '2026-10-20T22:00:00.000Z',
    });
  });

  it('a to-day at the end of a month or year moves into the next one', () => {
    expect(
      resolveMatchListDateWindow({ range: '', from: '', to: '2026-12-31' }, { timeZone: 'UTC', nowMs: DST_END_DAY }),
    ).toEqual({ to: '2027-01-01T00:00:00.000Z' });
  });

  it('lets a relative range win over from and to', () => {
    const window = resolveMatchListDateWindow(
      { range: 'today', from: '2020-01-01', to: '2020-01-02' },
      { timeZone: 'UTC', nowMs: DST_END_DAY },
    );
    expect(window?.from).toBe('2026-10-25T00:00:00.000Z');
  });

  it('gives different instants for different viewer zones', () => {
    const nowMs = Date.parse('2026-10-25T23:30:00Z');
    const utc = resolveMatchListDateWindow({ ...none, range: 'today' }, { timeZone: 'UTC', nowMs });
    const berlin = resolveMatchListDateWindow({ ...none, range: 'today' }, { timeZone: BERLIN, nowMs });
    expect(utc).not.toEqual(berlin);
    expect(utc?.from).toBe('2026-10-25T00:00:00.000Z');
    expect(berlin?.from).toBe('2026-10-25T23:00:00.000Z');
  });

  it('only produces instants the API schema accepts', () => {
    const clock = { timeZone: 'America/New_York', nowMs: DST_END_DAY };
    for (const range of ['today', 'next7', 'last7'] as const) {
      const window = resolveMatchListDateWindow({ ...none, range }, clock);
      expect(instant.safeParse(window?.from).success).toBe(true);
      expect(instant.safeParse(window?.to).success).toBe(true);
    }
    const custom = resolveMatchListDateWindow({ range: '', from: '2026-01-02', to: '2026-01-03' }, clock);
    expect(instant.safeParse(custom?.from).success).toBe(true);
    expect(instant.safeParse(custom?.to).success).toBe(true);
  });
});

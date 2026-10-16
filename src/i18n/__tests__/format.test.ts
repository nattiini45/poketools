import { describe, expect, it } from 'vitest';
import { createFormatter, type DatePreset } from '../format';

// Node ICU builds differ in punctuation; assert stable fragments only (i18n-core §1.5).
const AT = '2026-10-09T16:30:00Z'; // 18:30 in Europe/Berlin (CEST)
const en = createFormatter({ locale: 'en', timeZone: 'Europe/Berlin' });
const de = createFormatter({ locale: 'de', timeZone: 'Europe/Berlin' });

describe('instant presets', () => {
  const cases: [DatePreset, string[], string[]][] = [
    ['date', ['9', 'Oct', '2026'], ['9.', 'Okt', '2026']],
    ['dateLong', ['9', 'October', '2026'], ['9.', 'Oktober', '2026']],
    ['dateShort', ['09', '10', '2026'], ['09.10.2026']],
    ['dateTime', ['9', 'Oct', '18:30'], ['9.', 'Okt', '18:30']],
    ['dateTimeYear', ['Oct', '2026', '18:30'], ['Okt', '2026', '18:30']],
    ['weekdayDateTime', ['Fri', 'Oct', '18:30'], ['Fr', 'Okt', '18:30']],
    ['time', ['18:30'], ['18:30']],
    ['monthYear', ['October', '2026'], ['Oktober', '2026']],
  ];
  for (const [preset, enParts, deParts] of cases) {
    it(`${preset} in en-GB and de-DE`, () => {
      const e = en.instant(AT, preset);
      const d = de.instant(AT, preset);
      for (const part of enParts) expect(e).toContain(part);
      for (const part of deParts) expect(d).toContain(part);
    });
  }

  it('follows the formatter zone, with a per-call override', () => {
    const utc = createFormatter({ locale: 'en', timeZone: 'UTC' });
    expect(utc.instant(AT, 'time')).toBe('16:30');
    expect(utc.instant(AT, 'time', { timeZone: 'Europe/Berlin' })).toBe('18:30');
    expect(en.instant(new Date(AT), 'time')).toBe('18:30');
    expect(en.instant(Date.parse(AT), 'time')).toBe('18:30');
  });

  it('returns an empty string for an invalid instant', () => {
    expect(en.instant('not a date', 'date')).toBe('');
  });
});

describe('calendarDate', () => {
  it('is zone-free (a Postgres date never shifts a day)', () => {
    const tokyo = createFormatter({ locale: 'en', timeZone: 'Pacific/Kiritimati' });
    const hawaii = createFormatter({ locale: 'en', timeZone: 'Pacific/Honolulu' });
    expect(tokyo.calendarDate('2026-10-09')).toContain('9');
    expect(hawaii.calendarDate('2026-10-09')).toBe(tokyo.calendarDate('2026-10-09'));
    expect(de.calendarDate('2026-10-09', 'dateLong')).toContain('Oktober');
    expect(de.calendarDate('2026-10-09', 'weekdayDate')).toContain('Fr');
  });
});

describe('numbers', () => {
  it('formats numbers and percentages per locale', () => {
    expect(en.number(1234.5)).toBe('1,234.5');
    expect(de.number(1234.5)).toBe('1.234,5');
    expect(en.percent(0.125)).toBe('12.5%');
    expect(de.percent(0.125)).toBe('12,5 %');
    expect(de.percentOf(12.5)).toBe('12,5 %');
    expect(en.percentOf(50, 0)).toBe('50%');
  });

  it('formats lists', () => {
    expect(de.list(['A', 'B', 'C'])).toBe('A, B und C');
    expect(en.list(['A', 'B'], 'disjunction')).toBe('A or B');
  });
});

describe('clock and duration', () => {
  it('clock', () => {
    expect(en.clock(150)).toBe('2:30');
    expect(en.clock(43509)).toBe('12:05:09');
    expect(en.clock(-5)).toBe('0:00');
    expect(en.clock(5)).toBe('0:05');
  });

  it('duration in both locales', () => {
    expect(en.duration(45)).toBe('45s');
    expect(de.duration(45)).toBe('45 Sek.');
    expect(en.duration(150)).toBe('2m 30s');
    expect(de.duration(150)).toBe('2 Min. 30 Sek.');
    expect(en.duration(43509)).toBe('12h 5m');
    expect(de.duration(43509)).toBe('12 Std. 5 Min.');
    expect(en.duration(97200)).toBe('1d 3h');
    expect(de.duration(97200)).toBe('1 T. 3 Std.');
    expect(en.duration(-1)).toBe('0s');
  });
});

describe('relative', () => {
  const now = Date.parse(AT);
  it('says "just now" under a minute', () => {
    expect(en.relative(now - 30_000, now)).toBe('just now');
    expect(de.relative(now - 30_000, now)).toBe('gerade eben');
  });

  it('uses Intl.RelativeTimeFormat beyond a minute', () => {
    expect(en.relative(now - 5 * 60_000, now)).toContain('5 minutes ago');
    expect(de.relative(now - 5 * 60_000, now)).toContain('vor 5 Minuten');
    expect(en.relative(now - 2 * 3_600_000, now)).toContain('2 hours ago');
    expect(en.relative(now + 86_400_000, now)).toBe('tomorrow');
    expect(de.relative(now - 86_400_000, now)).toBe('gestern');
  });
});

describe('zoneLabel', () => {
  it('names the zone in the locale', () => {
    const at = new Date(AT);
    expect(en.zoneLabel(at)).toMatch(/CEST|GMT\+2/);
    expect(de.zoneLabel(at)).toMatch(/MESZ|GMT\+2/);
    expect(en.zoneLabel(at, 'UTC')).toMatch(/UTC|GMT/);
  });
});

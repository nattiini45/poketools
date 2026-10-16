/**
 * Locale- and zone-aware formatting (i18n-core §1.5). Pure: the caller picks
 * the zone. Client components get a formatter from `useFormatter()` (viewer
 * zone, hydration-safe); server components format only calendar dates and
 * render `<LocalTime>` for instants (rule T2).
 */
import { INTL_TAG, type IntlTag, type Locale } from './config';
import { createTranslator } from './core';
import { timeMessages } from './messages/time';

export type DatePreset =
  | 'date'
  | 'dateLong'
  | 'dateShort'
  | 'dateTime'
  | 'dateTimeYear'
  | 'weekdayDateTime'
  | 'time'
  | 'monthYear';

export type CalendarPreset = 'date' | 'dateLong' | 'weekdayDate';

export interface Formatter {
  readonly locale: Locale;
  readonly intlTag: IntlTag;
  readonly timeZone: string;
  /** `1,234.5` | `1.234,5` */
  number(value: number, options?: Intl.NumberFormatOptions): string;
  /** `0.125` -> `12.5%` | `12,5 %` */
  percent(ratio: number, maxFractionDigits?: number): string;
  /** `12.5` -> `12.5%` | `12,5 %` */
  percentOf(value100: number, maxFractionDigits?: number): string;
  instant(value: string | number | Date, preset: DatePreset, opts?: { timeZone?: string }): string;
  /** A `YYYY-MM-DD` calendar day (Postgres `date`), formatted zone-free. */
  calendarDate(day: string, preset?: CalendarPreset): string;
  /** `Intl.RelativeTimeFormat` (`numeric: 'auto'`); under a minute -> "just now". */
  relative(value: string | number | Date, now: number): string;
  list(items: readonly string[], type?: 'conjunction' | 'disjunction' | 'unit'): string;
  /** `150` -> `2:30`, `43509` -> `12:05:09`, negative -> `0:00`. */
  clock(totalSeconds: number): string;
  /** `43509` -> `12h 5m` | `12 Std. 5 Min.`; `150` -> `2m 30s`; `97200` -> `1d 3h`; `45` -> `45s`. */
  duration(totalSeconds: number): string;
  /** Short zone name: `CEST` | `MESZ`. */
  zoneLabel(at: Date, timeZone?: string): string;
}

const PRESETS: Record<DatePreset, Intl.DateTimeFormatOptions> = {
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  dateLong: { day: 'numeric', month: 'long', year: 'numeric' },
  dateShort: { day: '2-digit', month: '2-digit', year: 'numeric' },
  dateTime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  dateTimeYear: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  weekdayDateTime: { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  monthYear: { month: 'long', year: 'numeric' },
};

const CALENDAR_PRESETS: Record<CalendarPreset, Intl.DateTimeFormatOptions> = {
  date: PRESETS.date,
  dateLong: PRESETS.dateLong,
  weekdayDate: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
};

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(tag: IntlTag, timeZone: string, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${tag}|${timeZone}|${key}`;
  let format = dateFormats.get(cacheKey);
  if (!format) {
    format = new Intl.DateTimeFormat(tag, { ...options, timeZone });
    if (dateFormats.size > 512) dateFormats.clear();
    dateFormats.set(cacheKey, format);
  }
  return format;
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const RELATIVE_STEPS: readonly [limitSeconds: number, unit: Intl.RelativeTimeFormatUnit, seconds: number][] = [
  [3600, 'minute', 60],
  [86_400, 'hour', 3600],
  [604_800, 'day', 86_400],
  [2_629_800, 'week', 604_800],
  [31_557_600, 'month', 2_629_800],
  [Number.POSITIVE_INFINITY, 'year', 31_557_600],
];

export function createFormatter(input: { locale: Locale; timeZone: string }): Formatter {
  const { locale, timeZone } = input;
  const tag = INTL_TAG[locale];
  const t = createTranslator(timeMessages, locale);

  const formatter: Formatter = {
    locale,
    intlTag: tag,
    timeZone,
    number(value, options) {
      return new Intl.NumberFormat(tag, options).format(value);
    },
    percent(ratio, maxFractionDigits = 1) {
      return new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: maxFractionDigits }).format(ratio);
    },
    percentOf(value100, maxFractionDigits = 1) {
      return formatter.percent(value100 / 100, maxFractionDigits);
    },
    instant(value, preset, opts) {
      const date = toDate(value);
      if (Number.isNaN(date.getTime())) return '';
      return dateFormat(tag, opts?.timeZone ?? timeZone, preset, PRESETS[preset]).format(date);
    },
    calendarDate(day, preset = 'date') {
      const match = CALENDAR_DAY.exec(day.slice(0, 10));
      if (!match) return day;
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      return dateFormat(tag, 'UTC', `cal:${preset}`, CALENDAR_PRESETS[preset]).format(date);
    },
    relative(value, now) {
      const date = toDate(value);
      if (Number.isNaN(date.getTime())) return '';
      const diffSeconds = (date.getTime() - now) / 1000;
      const abs = Math.abs(diffSeconds);
      if (abs < 60) return t('justNow');
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
      for (const [limit, unit, seconds] of RELATIVE_STEPS) {
        if (abs < limit) return rtf.format(Math.round(diffSeconds / seconds), unit);
      }
      return rtf.format(Math.round(diffSeconds / 31_557_600), 'year');
    },
    list(items, type = 'conjunction') {
      return new Intl.ListFormat(tag, { style: 'long', type }).format(items);
    },
    clock(totalSeconds) {
      const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const ss = String(s).padStart(2, '0');
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    },
    duration(totalSeconds) {
      const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
      const d = Math.floor(total / 86_400);
      const h = Math.floor((total % 86_400) / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (d > 0) return t('duration.dh', { d, h });
      if (h > 0) return t('duration.hm', { h, m });
      if (m > 0) return t('duration.ms', { m, s });
      return t('duration.s', { s });
    },
    zoneLabel(at, zone) {
      const parts = dateFormat(tag, zone ?? timeZone, 'zone', { timeZoneName: 'short' }).formatToParts(at);
      return parts.find((part) => part.type === 'timeZoneName')?.value ?? (zone ?? timeZone);
    },
  };
  return formatter;
}

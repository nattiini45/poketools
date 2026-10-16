/**
 * Draft clock math (draft-frontend §5.7). Pure and client-safe; display only
 * (the server owns deadlines). Absolute deadlines render through
 * `<LocalTime zone="both">`, never through a helper here (critique S10).
 */
import { LEAGUE_TIME_ZONE } from '@/i18n/config';
import type { Translator } from '@/i18n/core';
import type { Formatter } from '@/i18n/format';
import type { DraftSharedEn } from '@/i18n/messages/draft/shared';
import type { DraftActiveSlot, DraftMode } from './snapshot-types';

/** The only declaration lives in `@/i18n/config` (critique S10). */
export { LEAGUE_TIME_ZONE };

export type ClockBand = 'ok' | 'warn' | 'low';

export interface ClockView {
  remainingMs: number;
  totalMs: number;
  /** remaining / total, clamped to 0..1. */
  ratio: number;
  band: ClockBand;
  paused: boolean;
  /** Not paused and no time left. */
  expired: boolean;
  /** Epoch ms of the deadline; null while paused or when the slot has none. */
  deadlineAt: number | null;
}

export type ActiveSlotLike = Pick<
  DraftActiveSlot,
  'duration_ms' | 'extensions_applied_ms' | 'deadline_at' | 'remaining_ms_at_pause'
>;

/**
 * Band on whole seconds: `s = ceil(remaining / 1000)`, `d = total / 1000`;
 * `s > d/2` → ok, `s > d/5` → warn, else low.
 */
export function bandOf(remainingMs: number, totalMs: number): ClockBand {
  const s = Math.ceil(remainingMs / 1000);
  const d = totalMs / 1000;
  if (s > d / 2) return 'ok';
  if (s > d / 5) return 'warn';
  return 'low';
}

/**
 * @param nowServerMs "now" on the server clock (`Date.now() + serverOffsetMs`;
 *   the first render uses the snapshot's `server_now`, so markup hydrates).
 */
export function computeClock(slot: ActiveSlotLike | null, nowServerMs: number): ClockView | null {
  if (!slot) return null;
  const totalMs = Math.max(0, slot.duration_ms + slot.extensions_applied_ms);
  const paused = slot.remaining_ms_at_pause !== null;
  const parsed = slot.deadline_at === null ? Number.NaN : Date.parse(slot.deadline_at);
  const deadlineAt = !paused && Number.isFinite(parsed) ? parsed : null;

  let remainingMs: number;
  if (paused) remainingMs = Math.max(0, slot.remaining_ms_at_pause ?? 0);
  else if (deadlineAt !== null) remainingMs = Math.max(0, deadlineAt - nowServerMs);
  else remainingMs = totalMs;

  const ratio = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  return {
    remainingMs,
    totalMs,
    ratio,
    band: bandOf(remainingMs, totalMs),
    paused,
    expired: !paused && remainingMs <= 0,
    deadlineAt,
  };
}

/** Whole hours, minutes and seconds of a duration (rounded up to the second). */
export function countdownParts(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/**
 * Live: `f.clock` digits ("2:41"). Slow: "1d 7h" / "1 T. 7 Std." from 24
 * hours up, "7h 42m" / "7 Std. 42 Min." from one hour up, "42m 10s" /
 * "42 Min. 10 Sek." below.
 */
export function formatCountdown(ms: number, mode: DraftMode, f: Formatter, t: Translator<DraftSharedEn>): string {
  const { h, m, s } = countdownParts(ms);
  if (mode === 'live') return f.clock(h * 3600 + m * 60 + s);
  if (h >= 24) return t('countdown.daysHours', { d: Math.floor(h / 24), h: h % 24 });
  if (h >= 1) return t('countdown.hoursMinutes', { h, m });
  return t('countdown.minutesSeconds', { m, s });
}

/** Ladder labels: 5400 → "1.5h" / "1,5 Std."; 43200 → "12h"; under an hour → "30m" / "30 Min.". */
export function formatDuration(seconds: number, t: Translator<DraftSharedEn>): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe >= 3600) return t('countdown.hours', { h: Math.round((safe / 3600) * 10) / 10 });
  return t('countdown.minutes', { m: Math.round(safe / 60) });
}

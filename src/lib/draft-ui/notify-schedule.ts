/**
 * Which turn alerts are due (draft-frontend §5.8). Pure: the caller supplies
 * the dedupe lookup (`hasNotified` in `storage.ts`) and delivers.
 *
 * - `turn` once per slot, as soon as the viewer is on the clock.
 * - Slow drafts only: the 8 h / 4 h / 1 h reminders, each at most once per
 *   slot. Only the most urgent reminder that is due is ever sent, so a tab
 *   that was hidden for a long time sends one reminder (plus `turn`), and an
 *   earlier, less urgent reminder never fires after a later one.
 * - Nothing while the draft is paused.
 */
import type { DraftMode } from './snapshot-types';

export type NotifyKind = 'turn' | 'remind-8h' | 'remind-4h' | 'remind-1h';

/** Reminder thresholds, least urgent first. */
export const SLOW_REMINDERS_MS = [8 * 3600e3, 4 * 3600e3, 3600e3] as const;

const REMINDER_KINDS: readonly NotifyKind[] = ['remind-8h', 'remind-4h', 'remind-1h'];

export interface DueNotificationsInput {
  onClock: boolean;
  slotId: string | null;
  mode: DraftMode;
  paused: boolean;
  remainingMs: number | null;
  alreadySent: (slotId: string, kind: NotifyKind) => boolean;
  /**
   * Optional: the slot's full time. Reminders whose threshold is not below it
   * are skipped (a 6 h penalty slot never says "8 hours left").
   */
  totalMs?: number | null;
}

export function dueNotifications(input: DueNotificationsInput): NotifyKind[] {
  const { onClock, slotId, mode, paused, remainingMs, alreadySent, totalMs } = input;
  if (paused || !onClock || slotId === null) return [];

  const due: NotifyKind[] = [];
  if (!alreadySent(slotId, 'turn')) due.push('turn');

  if (mode === 'slow' && remainingMs !== null && Number.isFinite(remainingMs)) {
    let mostUrgent: NotifyKind | null = null;
    for (let i = 0; i < SLOW_REMINDERS_MS.length; i += 1) {
      const threshold = SLOW_REMINDERS_MS[i];
      const applies = totalMs === null || totalMs === undefined || threshold < totalMs;
      if (applies && remainingMs <= threshold) mostUrgent = REMINDER_KINDS[i];
    }
    if (mostUrgent !== null && !alreadySent(slotId, mostUrgent)) due.push(mostUrgent);
  }
  return due;
}

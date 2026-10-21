'use client';

/**
 * The pick timer as an HP bar (draft-frontend §5.5, §5.7). `role="timer"`
 * without `aria-live`: threshold announcements go through the announcer.
 * The colour band is always paired with the digits; the bar never flashes
 * (SPEC:536).
 *
 * Live drafts show clock digits ("2:41"). Slow drafts show the long form
 * ("7h 42m") and the absolute deadline in the viewer's zone, plus league time
 * when it differs (`<LocalTime zone="both">`).
 *
 * Quiet hours (league rule: the pick clock is frozen inside the window): while a window holds the clock the digits stand still,
 * the bar takes the paused colour and a "quiet hours" chip (plus, outside the
 * compact bar, when the clock runs again) appears. The slow-draft deadline
 * line stays: it is absolute and already counts running time only.
 */
import { useFormatter, useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { formatCountdown, type ClockView } from '@/lib/draft-ui/clock';
import type { DraftMode } from '@/lib/draft-ui/snapshot-types';
import styles from '../draft-tool.module.css';

export interface TimerBarProps {
  clock: ClockView;
  mode: DraftMode;
  /** The player on the clock (for the accessible name). */
  playerName: string;
  compact?: boolean;
}

const BAND_CLASS = { ok: styles.bandOk, warn: styles.bandWarn, low: styles.bandLow } as const;

export default function TimerBar({ clock, mode, playerName, compact = false }: TimerBarProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tGlossary = useT(glossaryMessages);
  const f = useFormatter();

  const time = formatCountdown(clock.remainingMs, mode, f, tShared);
  const held = !clock.paused && clock.heldUntil !== null;
  const fill = clock.paused || held ? styles.bandPaused : BAND_CLASS[clock.band];

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <div
        role="timer"
        aria-label={t('clock.timerAria', { player: playerName, time })}
        className={`${styles.timerTrack} ${compact ? styles.timerTrackCompact : ''}`}
      >
        <div className={`${styles.timerFill} ${fill}`} style={{ width: `${Math.round(clock.ratio * 1000) / 10}%` }} />
      </div>
      <span className={`${styles.digits} ${compact ? 'text-base' : 'text-lg'}`} aria-hidden="true">
        {time}
      </span>
      {clock.paused ? (
        <span className={`${styles.caps} text-xs font-bold text-[var(--draft-ink-2)]`}>{tGlossary('draft.paused')}</span>
      ) : null}
      {held ? (
        <span className={`${styles.caps} text-xs font-bold text-[var(--draft-ink-2)]`}>{tGlossary('draft.quietHours')}</span>
      ) : null}
      {held && !compact ? (
        <span className="text-xs text-[var(--draft-ink-2)]">
          {tShared.rich('clock.heldUntil', {
            time: () => <LocalTime value={clock.heldUntil as number} preset="weekdayDateTime" zone="both" />,
          })}
        </span>
      ) : null}
      {!clock.paused && mode === 'slow' && clock.deadlineAt !== null && !compact ? (
        <span className="text-xs text-[var(--draft-ink-2)]">
          {t.rich('clock.until', {
            time: () => <LocalTime value={clock.deadlineAt as number} preset="weekdayDateTime" zone="both" />,
          })}
        </span>
      ) : null}
    </div>
  );
}

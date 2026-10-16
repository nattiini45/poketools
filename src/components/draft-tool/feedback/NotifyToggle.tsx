'use client';

/**
 * The turn-alert bell (draft-frontend §5.8). Never prompts on its own: only
 * a click on "Enable turn alerts" calls `Notification.requestPermission()`.
 *
 * - unsupported → hidden
 * - default → "Enable turn alerts"
 * - granted → on/off switch for this pool
 * - denied → disabled, "Blocked in browser settings"
 */
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import type { NotifyState } from '../hooks/use-turn-watch';
import styles from '../draft-tool.module.css';

export default function NotifyToggle({
  state,
  onToggle,
  slow = false,
  showNotes = false,
}: {
  state: NotifyState;
  onToggle(): void;
  /** Slow drafts add the Discord note. */
  slow?: boolean;
  /** Shows the scope note under the control (players sheet); the clock bar uses the tooltip only. */
  showNotes?: boolean;
}) {
  const t = useT(draftScreenMessages);
  if (state.support === 'unsupported') return null;

  const denied = state.support === 'denied';
  const on = state.support === 'granted' && state.optedIn;
  const label = denied
    ? t('notify.denied')
    : state.support === 'default'
      ? t('notify.enable')
      : on
        ? t('notify.on')
        : t('notify.off');
  const note = slow ? `${t('notify.scopeNote')} ${t('notify.discordNote')}` : t('notify.scopeNote');
  const Icon = denied ? BellOff : on ? BellRing : Bell;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={denied}
        aria-pressed={state.support === 'granted' ? on : undefined}
        title={`${label}. ${note}`}
        className={`${styles.focusable} inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border border-[var(--draft-border)] px-2.5 text-sm hover:bg-[var(--draft-elevated)] disabled:cursor-not-allowed disabled:opacity-60 md:min-h-[36px] ${on ? 'text-[var(--draft-ink)]' : 'text-[var(--draft-ink-2)]'}`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className={showNotes ? '' : 'sr-only'}>{label}</span>
      </button>
      {showNotes ? <p className="text-xs text-[var(--draft-ink-2)]">{note}</p> : null}
    </div>
  );
}

'use client';

/**
 * The push-alert bell (draft-frontend §5.8, docs/push.md): "Push alerts on this device". It never prompts on its
 * own; only a click calls `Notification.requestPermission()` and subscribes this browser.
 *
 * - unsupported (or the server answered `push_disabled`) → hidden
 * - install-required (iPhone/iPad in a browser tab) → "Add PokéTools to your Home Screen" + how
 * - default → "Turn on push alerts"
 * - granted → on/off switch for this device
 * - denied → "Blocked in browser settings" + how to unblock
 *
 * The hint of the install and blocked states is real text, not a tooltip: touch screens (iOS above all) have no
 * hover. In the clock bar the control is a button that opens the hint under it; in the players sheet
 * (`showNotes`) the hint is always visible.
 */
import { useId, useState } from 'react';
import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { errorsPlayers } from '@/i18n/messages/errors';
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
  const errorText = useApiErrorText(errorsPlayers);
  const [hintOpen, setHintOpen] = useState(false);
  const hintId = useId();
  if (state.support === 'unsupported' || state.error?.code === 'push_disabled') return null;

  const needsInstall = state.support === 'install-required';
  const denied = state.support === 'denied';
  const busy = state.busy === true;
  const on = state.support === 'granted' && state.optedIn;
  const label = needsInstall
    ? t('notify.installRequired')
    : denied
      ? t('notify.denied')
      : busy
        ? t('notify.busy')
        : state.support === 'default'
          ? t('notify.enable')
          : on
            ? t('notify.on')
            : t('notify.off');
  const hint = needsInstall ? t('notify.installHint') : denied ? t('notify.deniedHint') : null;
  const note = slow ? `${t('notify.scopeNote')} ${t('notify.discordNote')}` : t('notify.scopeNote');
  const Icon = needsInstall ? Smartphone : denied ? BellOff : on ? BellRing : Bell;
  const hintShown = hint !== null && (showNotes || hintOpen);

  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={hint !== null ? () => setHintOpen((open) => !open) : onToggle}
        disabled={busy}
        aria-pressed={hint === null && state.support === 'granted' ? on : undefined}
        aria-expanded={hint !== null && !showNotes ? hintOpen : undefined}
        aria-describedby={hintShown ? hintId : undefined}
        title={`${label}. ${hint ?? note}`}
        className={`${styles.focusable} inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border border-[var(--draft-border)] px-2.5 text-sm hover:bg-[var(--draft-elevated)] disabled:cursor-wait disabled:opacity-60 md:min-h-[36px] ${on ? 'text-[var(--draft-ink)]' : 'text-[var(--draft-ink-2)]'}`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className={showNotes ? '' : 'sr-only'}>{label}</span>
      </button>
      {hintShown ? (
        <p
          id={hintId}
          className={
            showNotes
              ? 'text-xs text-[var(--draft-ink-2)]'
              : 'absolute right-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-[var(--draft-border)] bg-[var(--draft-elevated)] p-3 text-xs text-[var(--draft-ink)] shadow-lg'
          }
        >
          {hint}
        </p>
      ) : null}
      {showNotes && hint === null ? <p className="text-xs text-[var(--draft-ink-2)]">{note}</p> : null}
      {state.error ? (
        <p
          role="alert"
          className={
            showNotes
              ? 'text-xs text-[var(--draft-taken-ink)]'
              : 'absolute right-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-[var(--draft-taken-border)] bg-[var(--draft-taken-bg)] p-3 text-xs text-[var(--draft-taken-ink)] shadow-lg'
          }
        >
          {errorText(state.error)}
        </p>
      ) : null}
    </div>
  );
}

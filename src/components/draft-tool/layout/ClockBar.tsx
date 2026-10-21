'use client';

/**
 * The clock bar (draft-frontend §5.3, §5.5): round and pick (with the
 * make-up marker), who is on the clock, the timer, the extensions, who is
 * next, the bell, the players button and, for pool admins, the Admin button
 * (opens the room's admin sheet). States: pending, running, paused (frozen
 * time), complete (link to the tokens page). The paused banner always renders
 * here, in the room, never only in the sheet. There is no blocked-slot banner:
 * every pick keeps the pool completable (`20261018140200`), so nothing writes
 * a blocked slot any more.
 *
 * "You are on the clock" and "Draft paused" are stored in sentence case and
 * rendered ALL CAPS through `.caps` (critique S4).
 */
import type { ReactNode } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { formatDuration, type ClockView } from '@/lib/draft-ui/clock';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { ExtensionKind } from '@/lib/draft-ui/snapshot-types';
import NotifyToggle from '../feedback/NotifyToggle';
import type { NotifyState } from '../hooks/use-turn-watch';
import TimerBar from './TimerBar';
import UpcomingOrderStrip from './UpcomingOrderStrip';
import styles from '../draft-tool.module.css';

export const EXTENSION_SECONDS: Record<ExtensionKind, number> = { plus120: 120, plus60: 60 };

export interface ClockBarProps {
  vm: DraftViewModel;
  clock: ClockView | null;
  notify: NotifyState;
  onNotifyToggle(): void;
  onExtension(kind: ExtensionKind): void;
  onOpenPlayers(): void;
  /** Tokens page (shown when the draft is complete). */
  tokensHref?: string;
  /** An extension request is in flight. */
  extensionBusy?: boolean;
  /** `config.makeup_seconds`, for the make-up chips of the tablet "Next 5" row. */
  makeupSeconds?: number | null;
  /** Pool admins only: opens the room's admin sheet. Without it there is no Admin button. */
  onOpenAdmin?(): void;
  /** Starts loading the admin sheet's code on hover/focus, before the click. */
  onPrefetchAdmin?(): void;
  /** The admin sheet is open (`aria-expanded`). */
  adminOpen?: boolean;
}

/** Tablet (768–1023 px): the order strip collapses into the clock bar as "Next 5" (§5.3). */
export const NEXT_IN_CLOCK_BAR = 5;

export default function ClockBar({
  vm,
  clock,
  notify,
  onNotifyToggle,
  onExtension,
  onOpenPlayers,
  tokensHref,
  extensionBusy = false,
  makeupSeconds = null,
  onOpenAdmin,
  onPrefetchAdmin,
  adminOpen = false,
}: ClockBarProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tGlossary = useT(glossaryMessages);
  const f = useFormatter();
  const slot = vm.activeSlot;
  const running = vm.status === 'in_progress';
  const me = vm.participants.find((p) => p.isViewer);

  let status: ReactNode = null;
  if (vm.status === 'pending') status = <span className="font-semibold">{t('clock.pending')}</span>;
  else if (vm.status === 'complete') {
    status = (
      <span className="flex flex-wrap items-center gap-2 font-semibold">
        {t('clock.complete')}
        {tokensHref && vm.viewer.isParticipant ? (
          <Link href={tokensHref} className={`${styles.focusable} rounded text-sm font-medium text-[var(--draft-accent)] underline underline-offset-2`}>
            {t('clock.toTokens')}
          </Link>
        ) : null}
      </span>
    );
  }

  const showExtensions =
    running && vm.mode === 'live' && vm.viewerOnClock && !vm.paused && slot?.status === 'active' && vm.viewer.extensions.plus120 !== 'na';
  const penaltyStage = me?.penalty_stage ?? 0;
  const showPenalty = vm.mode === 'slow' && me !== undefined && penaltyStage > 0 && vm.ladderSeconds[penaltyStage] !== undefined;

  return (
    <section className={styles.clockBar} aria-label={t('clock.label')}>
      {slot && running ? (
        <span className="flex items-center gap-2 text-sm font-semibold">
          {t('clock.roundPick', { round: slot.round, pick: slot.pick_number })}
          {slot.kind === 'makeup' ? (
            <span className="rounded-full border border-[var(--draft-border)] px-2 py-0.5 text-xs font-medium text-[var(--draft-ink-2)]">
              ↻ {tGlossary('draft.makeupPick')}
            </span>
          ) : null}
        </span>
      ) : null}

      {status}

      {vm.paused && running ? (
        <span className={`${styles.banner} ${styles.bannerPaused} ${styles.caps} text-sm`}>{tGlossary('draft.paused')}</span>
      ) : null}

      {slot && running ? (
        <div className="flex min-w-0 flex-[2_1_16rem] flex-wrap items-center gap-x-3 gap-y-1">
          {vm.viewerOnClock ? (
            <span className={`${styles.banner} ${styles.caps} text-sm`}>{tGlossary('draft.youOnClock')}</span>
          ) : (
            <span className="min-w-0 truncate text-sm font-semibold" title={slot.playerName}>
              {tGlossary('draft.playerOnClock', { name: slot.playerName })}
            </span>
          )}
          {clock ? (
            <>
              <div className={styles.wideOnly}>
                <TimerBar clock={clock} mode={vm.mode} playerName={slot.playerName} />
              </div>
              {/* Phones: digits + a 4 px HP bar (§5.3 item 1). */}
              <div className={styles.phoneOnly}>
                <TimerBar clock={clock} mode={vm.mode} playerName={slot.playerName} compact />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {showExtensions ? (
        <div className="flex items-center gap-1.5" title={t('clock.extHint')}>
          {(['plus120', 'plus60'] as const).map((kind) => {
            const used = vm.viewer.extensions[kind] === 'used';
            const time = f.clock(EXTENSION_SECONDS[kind]);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onExtension(kind)}
                disabled={used || extensionBusy}
                aria-label={used ? undefined : t('clock.extAria', { time })}
                className={`${styles.focusable} ${styles.digits} min-h-[44px] rounded-lg border border-[var(--draft-border)] px-2.5 text-sm hover:bg-[var(--draft-elevated)] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[32px]`}
              >
                {t('clock.extAdd', { time })}
                {used ? <span className="ml-1 text-xs font-normal">({t('clock.extUsed')})</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {showPenalty ? (
        <span className="text-xs text-[var(--draft-ink-2)]">
          {t('clock.penalty', { duration: formatDuration(vm.ladderSeconds[penaltyStage], tShared) })}
        </span>
      ) : null}

      {running && vm.nextPlayer ? (
        vm.viewerUpNext ? (
          <span className={`${styles.banner} ${styles.caps} text-xs`}>{tGlossary('draft.youNext')}</span>
        ) : (
          <span className={`${styles.nextSingle} min-w-0 truncate text-sm text-[var(--draft-ink-2)]`} title={vm.nextPlayer.name}>
            {t('clock.next', { player: vm.nextPlayer.name })}
          </span>
        )
      ) : null}

      {running && vm.upcoming.length > 0 ? (
        <div className={styles.nextFive}>
          <span className="shrink-0 text-xs font-semibold text-[var(--draft-ink-2)]">{t('clock.nextFive', { n: NEXT_IN_CLOCK_BAR })}</span>
          <UpcomingOrderStrip items={vm.upcoming} activeSlot={slot} makeupSeconds={makeupSeconds} limit={NEXT_IN_CLOCK_BAR} />
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {vm.viewer.isParticipant && vm.status !== 'complete' ? (
          <NotifyToggle state={notify} onToggle={onNotifyToggle} slow={vm.mode === 'slow'} />
        ) : null}
        {onOpenAdmin ? (
          <button
            type="button"
            onClick={onOpenAdmin}
            onPointerEnter={onPrefetchAdmin}
            onFocus={onPrefetchAdmin}
            aria-haspopup="dialog"
            aria-expanded={adminOpen}
            className={`${styles.focusable} inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--draft-border)] px-3 text-sm hover:bg-[var(--draft-elevated)] md:min-h-[36px]`}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t('clock.admin')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenPlayers}
          className={`${styles.focusable} inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--draft-border)] px-3 text-sm hover:bg-[var(--draft-elevated)] md:min-h-[36px]`}
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          {t('clock.players')}
        </button>
      </div>
    </section>
  );
}

'use client';

/**
 * The players sheet (draft-frontend §5.5): every participant with budget
 * left, picks made, the slow-draft penalty stage, used extensions and the
 * roster sprites. A Radix dialog sliding in from the side; on phones it
 * fills the width.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { uiMessages } from '@/i18n/messages/ui';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver } from '@/lib/draft-finder/names-port';
import { formatDuration } from '@/lib/draft-ui/clock';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import NotifyToggle from '../feedback/NotifyToggle';
import type { NotifyState } from '../hooks/use-turn-watch';
import { EXTENSION_SECONDS } from './ClockBar';
import styles from '../draft-tool.module.css';

export interface PlayersSheetProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  open: boolean;
  onClose(): void;
  notify?: NotifyState;
  onNotifyToggle?(): void;
}

export default function PlayersSheet({ vm, catalog, open, onClose, notify, onNotifyToggle }: PlayersSheetProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tUi = useT(uiMessages);
  const f = useFormatter();
  const dl = useDataLocale();
  const byId = new Map<string, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l]));
  const players = [...vm.participants].sort((a, b) => a.seat - b.seat);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-poke-inverse/30 backdrop-blur-[2px]" />
        <Dialog.Content
          // `.tokens`, not `.root`: the root's `position: relative` would beat Tailwind's `fixed` (same specificity, later sheet).
          className={`${styles.tokens} fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-3 overflow-y-auto border-l border-[var(--draft-border)] bg-[var(--draft-surface)] p-4 shadow-poke-lg`}
        >
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-bold">{t('players.title')}</Dialog.Title>
            <Dialog.Close
              className={`${styles.focusable} rounded p-1 text-[var(--draft-ink-2)] hover:text-[var(--draft-ink)]`}
              aria-label={tUi('modal.close')}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t('clock.players')}</Dialog.Description>

          {notify && onNotifyToggle && vm.viewer.isParticipant ? (
            <NotifyToggle state={notify} onToggle={onNotifyToggle} slow={vm.mode === 'slow'} showNotes />
          ) : null}

          <ul className="flex flex-col gap-2">
            {players.map((p) => {
              const onClock = vm.activeSlot?.player_id === p.player_id && vm.status === 'in_progress';
              const used = (['plus120', 'plus60'] as const)
                .filter((k) => (k === 'plus120' ? p.extensions.plus120_used : p.extensions.plus60_used))
                .map((k) => t('clock.extAdd', { time: f.clock(EXTENSION_SECONDS[k]) }));
              const stageSeconds = vm.ladderSeconds[p.penalty_stage];
              return (
                <li
                  key={p.player_id}
                  className={`rounded-lg border p-3 ${p.isViewer ? 'border-[var(--draft-accent)]' : 'border-[var(--draft-border)]'} bg-[var(--draft-elevated)]`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 truncate font-semibold" title={p.name}>
                      {p.name} {p.isViewer ? <span className="font-normal text-[var(--draft-ink-2)]">{t('players.you')}</span> : null}
                    </span>
                    <span className="text-xs text-[var(--draft-ink-2)]">
                      {onClock ? <span className="mr-2 font-semibold text-[var(--draft-ink)]">{t('players.onClock')}</span> : null}
                      {p.done ? <span className="mr-2">{t('players.done')}</span> : null}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--draft-ink-2)]">
                    <span>{t('players.budget', { n: p.budget_remaining })}</span>
                    <span>{t('players.picks', { made: p.picks_made, total: p.slots_total })}</span>
                    {vm.mode === 'slow' && stageSeconds !== undefined ? (
                      <span>{t('clock.penalty', { duration: formatDuration(stageSeconds, tShared) })}</span>
                    ) : null}
                    {p.timeout_count > 0 ? <span>{t('players.timeouts', { count: p.timeout_count })}</span> : null}
                    {used.length > 0 ? <span>{t('players.extensionsUsed', { list: f.list(used) })}</span> : null}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {p.rosterLineIds.length === 0 ? (
                      <li className="text-xs text-[var(--draft-ink-2)]">{t('players.rosterEmpty')}</li>
                    ) : (
                      p.rosterLineIds.map((lineId) => {
                        const entry = byId.get(lineId);
                        if (!entry) return null;
                        const base = entry.stages[0].name;
                        const stage3 = entry.stages[2]?.name ?? null;
                        return (
                          <li key={lineId} title={pkmnNameResolver.lineLabel(base, stage3, dl)}>
                            <PokemonSprite name={base} size={32} />
                          </li>
                        );
                      })
                    )}
                  </ul>
                </li>
              );
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

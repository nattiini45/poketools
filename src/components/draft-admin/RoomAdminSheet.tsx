'use client';

/**
 * The draft room's admin sheet (draft-frontend §7.1 inside §5.5; owner
 * feedback 2026-10-18): a right-hand Radix sheet with one tab per admin
 * section of this pool (Live, Picks, Settings, Redraft, Penalties) and links
 * to the audit trail and the full control page.
 *
 * - Pool admins only: `DraftToolClient` lazy-loads this module (`React.lazy`)
 *   the first time the Admin button is used, so players never download it.
 * - One poller: the sheet reads the room's snapshot (`snap`, from the room's
 *   `useDraftSnapshot`) and never polls itself; every write refreshes the
 *   room's snapshot or applies the snapshot a rule error carries.
 * - Lazy tab data: only the open tab is mounted (and only the selected tab
 *   carries `aria-controls`), so the Redraft submissions (BE #20) and the
 *   refused automatic publish (`publish_refused_at`, same response) load when
 *   the Redraft tab opens.
 * - The pick itself stays in the room: "Pick for the active player" switches
 *   the room's admin override on and closes the sheet (`onPickForActive`);
 *   the caller moves the focus to the override switch (`onCloseAutoFocus`).
 * - Blocking banners (paused, blocked slot) stay in the room's clock bar;
 *   the sheet repeats "Draft paused" in its header for phones, where it
 *   covers the room.
 * - Nested dialogs (the armed confirms of start/abort, void/correct, publish)
 *   are Radix dialogs rendered inside this sheet's content: Radix stacks
 *   them, Escape closes only the top one, and focus returns to the control
 *   that opened it.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import Link from 'next/link';
import styles from '@/components/draft-tool/draft-tool.module.css';
import { useT } from '@/i18n/client';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { uiMessages } from '@/i18n/messages/ui';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import { createAdminDraftActions, type AdminDraftActions } from './admin-actions';
import { AdminSurfaceProvider, InlineError } from './admin-ui';
import CreateRedraft from './CreateRedraft';
import { PoolAdminSectionView, poolAdminSections, type PoolAdminSection, type PoolAdminSnapshot } from './pool-admin';

export type RoomAdminTab = PoolAdminSection;

export interface RoomAdminSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  poolId: string;
  seasonId: string;
  /** League groups: the pool's group (its "Create Redraft" creates that group's Redraft); null without groups. */
  seasonGroupId?: string | null;
  /** League groups: the group's display name (labels "Create Redraft"); null without groups. */
  seasonGroupName?: string | null;
  catalog: DraftLineCatalog;
  /** The room's snapshot (one poller); `stale` = the room's last poll failed. */
  snap: PoolAdminSnapshot & { stale: boolean };
  /** Control page and audit trail of this league (the sheet appends `?pool=`); null hides the link. */
  links: { control: string | null; audit: string | null };
  /** Switch the room's admin override on (the sheet closes itself afterwards). */
  onPickForActive(): void;
  /** Radix `onCloseAutoFocus` of the sheet (the room focuses its override switch after "Pick for"). */
  onCloseAutoFocus?(event: Event): void;
  /** Preview/test injection; default `createAdminDraftActions(poolId, seasonId)`. */
  actions?: AdminDraftActions;
  /** Preview/test: the tab that is open first (default `live`). */
  initialTab?: RoomAdminTab;
}

/**
 * Touch targets: 44 px on phones for the buttons, selects, text/number inputs
 * and the labels that wrap a checkbox (the whole label is the hit area) of
 * every section. A checkbox itself keeps its native size inside that label.
 */
const PANEL_TOUCH = [
  '[&_button]:min-h-[44px] md:[&_button]:min-h-0',
  '[&_select]:min-h-[44px] md:[&_select]:min-h-0',
  '[&_input:not([type=checkbox]):not([type=radio])]:min-h-[44px] md:[&_input:not([type=checkbox]):not([type=radio])]:min-h-0',
  '[&_label:has(input[type=checkbox])]:min-h-[44px] md:[&_label:has(input[type=checkbox])]:min-h-0',
].join(' ');
const LINK = `${styles.focusable} inline-flex min-h-[44px] items-center rounded-lg border border-[var(--draft-border,var(--poke-border))] px-3 text-sm hover:bg-[var(--draft-elevated,var(--poke-elevated))] md:min-h-[36px]`;

function withPool(href: string, poolId: string): string {
  return `${href}?pool=${encodeURIComponent(poolId)}`;
}

export default function RoomAdminSheet({
  open,
  onOpenChange,
  poolId,
  seasonId,
  seasonGroupId = null,
  seasonGroupName = null,
  catalog,
  snap,
  links,
  onPickForActive,
  onCloseAutoFocus,
  actions: injected,
  initialTab = 'live',
}: RoomAdminSheetProps) {
  const t = useT(draftAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const tUi = useT(uiMessages);
  const baseId = useId();
  const deadlineFieldId = useId();
  // One writer per mounted sheet; the room keys its client by pool id, so a pool switch remounts it.
  const [actions] = useState<AdminDraftActions>(
    () => injected ?? createAdminDraftActions(poolId, seasonId, seasonGroupId),
  );
  const [selected, setSelected] = useState<RoomAdminTab>(initialTab);
  const tabRefs = useRef(new Map<RoomAdminTab, HTMLButtonElement>());
  const focusDeadline = useRef(false);

  const { vm } = snap;
  const tabs = poolAdminSections(vm);
  // A tab that no longer exists (a mode change dropped Penalties) falls back to Live.
  const tab: RoomAdminTab = tabs.includes(selected) ? selected : 'live';

  useEffect(() => {
    if (tab !== 'redraft' || !focusDeadline.current) return;
    focusDeadline.current = false;
    document.getElementById(deadlineFieldId)?.focus();
  }, [tab, deadlineFieldId]);

  const select = (next: RoomAdminTab, focus: boolean) => {
    setSelected(next);
    if (focus) tabRefs.current.get(next)?.focus();
  };

  // WAI-ARIA tabs, automatic activation: arrows move and open, Home/End jump.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(tab);
    const target =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? tabs[(i + 1) % tabs.length]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === 'Home'
            ? tabs[0]
            : e.key === 'End'
              ? tabs[tabs.length - 1]
              : null;
    if (!target) return;
    e.preventDefault();
    select(target, true);
  };

  const tabId = (x: RoomAdminTab) => `${baseId}-tab-${x}`;
  const panelId = (x: RoomAdminTab) => `${baseId}-panel-${x}`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-poke-inverse/30 backdrop-blur-[2px]" />
        <Dialog.Content
          // `.tokens`, not `.root` (see PlayersSheet): the root's `position: relative` would beat `fixed`.
          className={`${styles.tokens} fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] shadow-poke-lg`}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <AdminSurfaceProvider surface="room">
            <header className="flex flex-col gap-1 border-b border-[var(--draft-border,var(--poke-border))] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="text-lg font-bold">{t('room.title')}</Dialog.Title>
                  <p className="text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]">
                    {vm.kind === 'initial' ? tGlossary('draft.initialDraft') : tGlossary('draft.redraft')}
                    {' · '}
                    {t(`panel.phase.${vm.phase}`)}
                    {vm.paused && vm.status === 'in_progress' ? (
                      <span className="ml-2 font-semibold text-[var(--draft-warn-ink,var(--poke-amber-ink))]">
                        {tGlossary('draft.paused')}
                      </span>
                    ) : null}
                  </p>
                </div>
                <Dialog.Close
                  className={`${styles.focusable} inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-[var(--draft-ink-2,var(--poke-text-secondary))] hover:text-[var(--draft-ink,var(--poke-text-primary))] md:min-h-[36px] md:min-w-[36px]`}
                  aria-label={tUi('modal.close')}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </Dialog.Close>
              </div>
              <Dialog.Description className="text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">{t('room.description')}</Dialog.Description>
            </header>

            <div
              role="tablist"
              aria-label={t('room.tabsLabel')}
              aria-orientation="horizontal"
              onKeyDown={onTabKey}
              className="flex flex-wrap gap-1 border-b border-[var(--draft-border,var(--poke-border))] px-4 py-2"
            >
              {tabs.map((x) => {
                const active = x === tab;
                return (
                  <button
                    key={x}
                    ref={(el) => {
                      if (el) tabRefs.current.set(x, el);
                      else tabRefs.current.delete(x);
                    }}
                    id={tabId(x)}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    // Only the open tab's panel is mounted, so only that tab may point at it.
                    aria-controls={active ? panelId(x) : undefined}
                    tabIndex={active ? 0 : -1}
                    onClick={() => select(x, false)}
                    className={`${styles.focusable} min-h-[44px] rounded-lg border px-3 text-sm md:min-h-[36px] ${
                      active
                        ? 'border-[var(--draft-ink,var(--poke-text-primary))] font-semibold text-[var(--draft-ink,var(--poke-text-primary))]'
                        : 'border-transparent text-[var(--draft-ink-2,var(--poke-text-secondary))] hover:bg-[var(--draft-elevated,var(--poke-elevated))]'
                    }`}
                  >
                    {t(`room.tab.${x}`)}
                  </button>
                );
              })}
            </div>

            <div
              id={panelId(tab)}
              role="tabpanel"
              aria-labelledby={tabId(tab)}
              tabIndex={0}
              className={`${styles.focusable} flex-1 space-y-4 overflow-y-auto p-4 ${PANEL_TOUCH}`}
            >
              {snap.stale ? <InlineError text={t('panel.stale')} /> : null}
              {/* Only the open tab is mounted: its reads (Redraft submissions) run when it opens. */}
              <PoolAdminSectionView
                key={tab}
                section={tab}
                snap={snap}
                actions={actions}
                catalog={catalog}
                deadlineFieldId={deadlineFieldId}
                pickFor={{
                  kind: 'override',
                  onEnable: () => {
                    onPickForActive();
                    onOpenChange(false);
                  },
                }}
                deadline={{
                  kind: 'action',
                  onOpen: () => {
                    focusDeadline.current = true;
                    select('redraft', false);
                  },
                }}
                showClock={false}
              />
              {tab === 'live' && vm.kind === 'initial' && vm.phase === 'complete' ? <CreateRedraft actions={actions} groupName={seasonGroupName} /> : null}
            </div>

            {links.control || links.audit ? (
              <footer className="flex flex-wrap gap-2 border-t border-[var(--draft-border,var(--poke-border))] p-4">
                {links.audit ? (
                  <Link href={withPool(links.audit, poolId)} className={LINK}>
                    {tGlossary('draft.auditTrail')}
                  </Link>
                ) : null}
                {links.control ? (
                  <Link href={withPool(links.control, poolId)} className={LINK}>
                    {t('room.fullControl')}
                  </Link>
                ) : null}
              </footer>
            ) : null}
          </AdminSurfaceProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

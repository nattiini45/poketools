'use client';

/**
 * The admin control panel (draft-frontend §7.1, page §3.4): one tab per pool
 * (Initial draft / Redraft n). The open tab polls its snapshot (3 s, DF2a's
 * `useDraftSnapshot`) and renders the shared pool sections (`pool-admin.tsx`:
 * live controls, the Redraft manager, settings, pick corrections, slow-draft
 * penalties) as stacked cards. The draft room's admin sheet renders the same
 * sections as tabs from the room's own poll (`RoomAdminSheet`). There is no
 * blocked-pick resolver: the pool always stays completable, so the player on
 * the clock always has a legal pick. "Create Redraft" is per season (a league
 * with groups: per group, bound to the selected tab's group; tabs read
 * "Group · Initial draft" and number Redrafts per group). Token
 * balances and the Comeback switch live on the league admin page's Draft tab
 * only (`TokenAdminSummary` there; owner feedback: no duplicate), so this page
 * links there instead.
 *
 * The pool tabs are a tablist with arrow-key / Home / End navigation (roving
 * tabindex) and 44 px tall on phones.
 *
 * Every write goes through `AdminDraftActions` (default
 * `createAdminDraftActions`); a success refreshes
 * the snapshot, a rule error applies the snapshot it carries. State holds
 * DTOs and `ApiErrorLike` objects, never translated text.
 *
 * `dataSourceFor` / `actionsFor` are test and preview
 * injections (same pattern as `DraftToolClient.dataSource`): `/draft-preview`
 * mounts the panel on an in-memory fake without any network call.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { createHttpDataSource, type DraftDataSource } from '@/components/draft-tool/data-source';
import { useDraftSnapshot } from '@/components/draft-tool/hooks/use-draft-snapshot';
import { useT } from '@/i18n/client';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import type { AdminPoolSummary, DraftSnapshotDTO } from '@/types/draft-queue';
import { createAdminDraftActions, type AdminDraftActions } from './admin-actions';
import { HINT, InlineError, PanelCard } from './admin-ui';
import { poolTabs, type PoolTab } from './admin-view';
import CreateRedraft from './CreateRedraft';
import { PoolAdminSectionView, poolAdminSections, type PoolAdminSection, type PoolAdminSnapshot } from './pool-admin';

export interface DraftControlPanelProps {
  seasonId: string;
  pools: AdminPoolSummary[];
  catalog: DraftLineCatalog;
  /** Seeded on the server with `{ tick: false }`; a pool whose read failed is missing (the client polls). */
  initialSnapshots: Record<string, DraftSnapshotDTO>;
  /** The tab that opens first (`?pool=`, validated by the page); null/unknown = the running pool, else the newest. */
  initialPoolId?: string | null;
  /**
   * Admin data, read on the server: pool id -> `draft_pools.publish_refused_at` for a Redraft whose
   * automatic publish was refused (only pools still in their submission phase). Never in a snapshot.
   */
  publishRefusedAt?: Readonly<Record<string, string>>;
  links: { audit: string; room: string };
  /** Preview/test injection; default `createHttpDataSource(poolId, seasonId)`. */
  dataSourceFor?(poolId: string): DraftDataSource;
  /** Preview/test injection; default `createAdminDraftActions(poolId, seasonId)`. */
  actionsFor?(poolId: string): AdminDraftActions;
}

export type { AdminDraftActions };

/** The tab that opens first: the requested pool, else a running pool (a redraft wins), else the newest. */
export function initialTab(pools: readonly AdminPoolSummary[], requested?: string | null): string | null {
  if (requested && pools.some((p) => p.id === requested)) return requested;
  const running = [...pools].reverse().find((p) => p.status === 'in_progress');
  return running?.id ?? pools.at(-1)?.id ?? null;
}

/** Control-page order of the stacked cards (the room sheet uses `poolAdminSections` as tabs). */
const PAGE_ORDER: readonly PoolAdminSection[] = ['live', 'redraft', 'settings', 'picks', 'penalties'];

const SECTION_TITLE: Record<PoolAdminSection, 'live' | 'redraft' | 'settings' | 'corrections' | 'penalties'> = {
  live: 'live',
  redraft: 'redraft',
  settings: 'settings',
  picks: 'corrections',
  penalties: 'penalties',
};

/**
 * One pool tab of the control page: this page has no draft room around it,
 * so the open tab runs its own snapshot poll and feeds the shared sections.
 */
function PoolPanel({
  pool,
  seasonId,
  catalog,
  initial,
  roomHref,
  publishRefusedAt,
  dataSourceFor,
  actionsFor,
}: {
  pool: AdminPoolSummary;
  seasonId: string;
  catalog: DraftLineCatalog;
  initial: DraftSnapshotDTO | null;
  roomHref: string;
  publishRefusedAt: string | null;
  dataSourceFor?: DraftControlPanelProps['dataSourceFor'];
  actionsFor?: DraftControlPanelProps['actionsFor'];
}) {
  const t = useT(draftAdminMessages);
  const deadlineFieldId = useId();
  // Created once per mounted pool tab (the panel keys `PoolPanel` by pool id),
  // so an inline `dataSourceFor` does not restart the poll on every render.
  const [source] = useState<DraftDataSource>(() => dataSourceFor?.(pool.id) ?? createHttpDataSource(pool.id, seasonId));
  const [actions] = useState<AdminDraftActions>(
    () => actionsFor?.(pool.id) ?? createAdminDraftActions(pool.id, seasonId, pool.season_group_id ?? null),
  );
  const { dto, vm, stale, refresh, applySnapshot, serverOffsetMs } = useDraftSnapshot(source, initial, {
    poolId: pool.id,
    catalog,
  });

  if (!vm || !dto) {
    return <p className={HINT}>{stale ? t('panel.loadFailed') : t('panel.loading')}</p>;
  }

  const snap: PoolAdminSnapshot = { vm, dto, serverOffsetMs, refresh, applySnapshot };
  const present = new Set(poolAdminSections(vm));

  return (
    <div className="space-y-4">
      {stale ? <InlineError text={t('panel.stale')} /> : null}
      {PAGE_ORDER.filter((section) => present.has(section)).map((section) => (
        <PanelCard key={section} title={t(`panel.sections.${SECTION_TITLE[section]}`)}>
          <PoolAdminSectionView
            section={section}
            snap={snap}
            actions={actions}
            catalog={catalog}
            deadlineFieldId={deadlineFieldId}
            pickFor={{ kind: 'link', href: roomHref }}
            deadline={{ kind: 'anchor', href: `#${deadlineFieldId}` }}
            publishRefusedAt={publishRefusedAt}
          />
        </PanelCard>
      ))}
    </div>
  );
}

function SeasonCreateRedraft({
  seasonId,
  pool,
  actionsFor,
}: {
  seasonId: string;
  /** The Initial draft pool the Redraft follows (a league with groups: the selected group's). */
  pool: AdminPoolSummary;
  actionsFor?: DraftControlPanelProps['actionsFor'];
}) {
  const [actions] = useState<AdminDraftActions>(
    () => actionsFor?.(pool.id) ?? createAdminDraftActions(pool.id, seasonId, pool.season_group_id ?? null),
  );
  return <CreateRedraft actions={actions} groupName={pool.season_group_name ?? null} />;
}

/** The DOM ids of a pool tab and of the panel it controls. */
function poolTabId(base: string, poolId: string): string {
  return `${base}-tab-${poolId}`;
}
function poolPanelId(base: string): string {
  return `${base}-panel`;
}

export default function DraftControlPanel({
  seasonId,
  pools,
  catalog,
  initialSnapshots,
  initialPoolId,
  publishRefusedAt,
  links,
  dataSourceFor,
  actionsFor,
}: DraftControlPanelProps) {
  const t = useT(draftAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const tabs = useMemo(() => poolTabs(pools), [pools]);
  const [active, setActive] = useState<string | null>(() => initialTab(pools, initialPoolId));
  const pool = pools.find((p) => p.id === active) ?? null;
  // "Create Redraft" follows the selected tab's group (a league without groups: the season's one Initial draft).
  const activeGroupId = pool?.season_group_id ?? null;
  const initialPool = pools.find((p) => p.kind === 'initial' && (p.season_group_id ?? null) === activeGroupId) ?? null;
  const roomHref = pool ? `${links.room}?pool=${encodeURIComponent(pool.id)}` : links.room;
  const idBase = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const tabLabel = (tab: PoolTab): string => {
    const draft = tab.kind === 'initial' ? tGlossary('draft.initialDraft') : t('panel.tabRedraft', { n: tab.redraftNo });
    return tab.groupName ? t('panel.tabInGroup', { group: tab.groupName, draft }) : draft;
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((x) => x.id === active);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const id = tabs[next]?.id;
    if (!id) return;
    setActive(id);
    tabRefs.current.get(id)?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label={t('panel.poolTabs')} onKeyDown={onTabKeyDown} className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const p = pools.find((x) => x.id === tab.id);
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.id, el);
                  else tabRefs.current.delete(tab.id);
                }}
                id={poolTabId(idBase, tab.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={selected ? poolPanelId(idBase) : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(tab.id)}
                className={`min-h-11 rounded-poke-md border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus sm:min-h-0 ${
                  selected
                    ? 'border-poke-accent bg-poke-accent text-poke-surface'
                    : 'border-poke-border bg-poke-elevated text-poke-text-primary hover:border-poke-accent'
                }`}
              >
                {tabLabel(tab)}
                {p ? <span className="ml-2 text-xs opacity-80">{t(`panel.phase.${p.phase}`)}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={roomHref} className="inline-flex min-h-11 items-center text-poke-accent hover:underline sm:min-h-0">
            {t('panel.openRoom')}
          </Link>
          <Link
            href={pool ? `${links.audit}?pool=${encodeURIComponent(pool.id)}` : links.audit}
            className="inline-flex min-h-11 items-center text-poke-accent hover:underline sm:min-h-0"
          >
            {tGlossary('draft.auditTrail')}
          </Link>
        </div>
      </div>

      {pool ? (
        <div role="tabpanel" id={poolPanelId(idBase)} aria-labelledby={poolTabId(idBase, pool.id)}>
          <PoolPanel
            key={pool.id}
            pool={pool}
            seasonId={seasonId}
            catalog={catalog}
            initial={initialSnapshots[pool.id] ?? null}
            roomHref={roomHref}
            publishRefusedAt={publishRefusedAt?.[pool.id] ?? null}
            dataSourceFor={dataSourceFor}
            actionsFor={actionsFor}
          />
        </div>
      ) : (
        <p className={HINT}>{t('page.noPools')}</p>
      )}

      {initialPool ? (
        <SeasonCreateRedraft key={initialPool.id} seasonId={seasonId} pool={initialPool} actionsFor={actionsFor} />
      ) : null}

      <PanelCard title={t('panel.sections.tokens')}>
        <p className={HINT}>{t('panel.tokensMoved')}</p>
        <Link
          href={leagueAdminHref(seasonId, 'draft')}
          className="inline-flex min-h-11 items-center text-sm font-medium text-poke-accent hover:underline sm:min-h-0"
        >
          {t('panel.tokensLink')}
        </Link>
      </PanelCard>
    </div>
  );
}

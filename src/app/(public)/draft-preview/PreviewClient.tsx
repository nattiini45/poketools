'use client';

/**
 * Client entry of `/draft-preview` (DF3): turns the scenario JSON from the
 * server page into in-memory `createFakeDataSource` backends and mounts the
 * scenario's real screen against them:
 *
 * - `pick`: `DraftToolClient` (the draft room); a scenario preset (pinned
 *   line, filters, open confirm dialog) goes in through its `initialView` /
 *   `initialConfirmLineId` preview props; a pool admin's room gets the fake as
 *   its admin sheet's `AdminDraftActions` (`adminActions`), and a preset
 *   `adminTab` opens the sheet at mount;
 * - `redraft`: `RedraftCenter` (`/leagues/[id]/redraft`);
 * - `tokens`: `TokenCenter` (`/leagues/[id]/tokens`);
 * - `admin`: `DraftControlPanel` (one fake per pool, the fake's
 *   `AdminDraftActions` for every write; a scenario's `publishRefusedAt` is
 *   the control page's server-read admin data);
 * - `tokenAdmin`: `TokenAdminSummary` as the league admin page's Draft tab
 *   shows it (the fake as its `TokenSource` and Comeback switch);
 * - `audit`: `DraftAuditViewer` with a loader over the fixture audit rows.
 *
 * A scenario with `init.indexState` (`live-index-loading`, `live-index-failed`)
 * gets no server-built index and its own index URL, so the room shows its
 * index-loading / index-failed state instead of the shared cached index.
 *
 * Every port is injected, so nothing here reaches `fetch`, an `/api` route or
 * Supabase. A preset view is the first render's state, so a pinned line's
 * "not draftable" reasons, the filters and the dialog are in the server markup.
 */
import { useCallback, useMemo } from 'react';
import DraftAuditViewer from '@/components/draft-admin/DraftAuditViewer';
import DraftControlPanel from '@/components/draft-admin/DraftControlPanel';
import TokenAdminSummary from '@/components/draft-admin/TokenAdminSummary';
import type { AuditPage } from '@/components/draft-admin/admin-actions';
import RedraftCenter from '@/components/draft-redraft/RedraftCenter';
import TokenCenter from '@/components/draft-tokens/TokenCenter';
import DraftToolClient from '@/components/draft-tool/DraftToolClient';
import type { DraftToolLinks } from '@/components/draft-tool/DraftToolScreen';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import { EMPTY_FILTERS, initialFinderState, type FinderViewState } from '@/lib/draft-finder/filter-types';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { auditQueryFrom, createFakeDataSource, type FakeDataSource } from './fake-source';
import type { PreviewPreset, PreviewScenario } from './fixtures';

/** Preview-internal hrefs for the non-pick screens (built by the page from the picker state). */
export interface PreviewScreenLinks {
  /** RedraftCenter "go to the room": the `redraft-picking` scenario. */
  redraftRoom: string;
  /** DraftControlPanel room / audit links (it appends `?pool=`; the page ends them in `#`). */
  adminRoom: string;
  adminAudit: string;
}

export interface PreviewClientProps {
  scenario: PreviewScenario;
  seasonId: string;
  leagueName: string;
  catalog: DraftLineCatalog;
  index: DraftSearchIndex;
  links: DraftToolLinks;
  screenLinks: PreviewScreenLinks;
  /**
   * `?groups=1`: the fixture league group of the shown pools. The control panel and the audit trail label their
   * tabs by it ("Group A · Initial draft") and "Create Redraft" names it, in the panel and in the room's admin sheet.
   */
  group?: { id: string; name: string } | null;
}

type AuditLoad = { ok: true; data: AuditPage } | { ok: false };

/** The finder view a preset starts from (exported for the scenario test). */
export function presetView(preset: PreviewPreset): FinderViewState {
  return {
    ...initialFinderState({ pinnedLineId: preset.pinnedLineId ?? null }),
    filters: preset.filters ?? EMPTY_FILTERS,
    filterPanelOpen: preset.filterPanelOpen ?? false,
  };
}

export default function PreviewClient({
  scenario,
  seasonId,
  leagueName,
  catalog,
  index,
  links,
  screenLinks,
  group = null,
}: PreviewClientProps) {
  const source = useMemo(() => createFakeDataSource({ ...scenario.init, index }), [scenario.init, index]);
  // The admin scenarios: one backend per pool; the scenario's own pool reuses `source`.
  const poolSources = useMemo(() => {
    const out = new Map<string, FakeDataSource>([[scenario.poolId, source]]);
    for (const pool of scenario.admin?.pools ?? []) {
      if (!out.has(pool.summary.id)) out.set(pool.summary.id, createFakeDataSource({ ...pool.init, index }));
    }
    return out;
  }, [scenario.admin, scenario.poolId, source, index]);
  const sourceFor = useCallback((poolId: string): FakeDataSource => poolSources.get(poolId) ?? source, [poolSources, source]);
  const loadAuditPage = useCallback(
    async (poolId: string, query: string): Promise<AuditLoad> => {
      const res = await sourceFor(poolId).audit(auditQueryFrom(query));
      return res.ok ? { ok: true, data: res.data } : { ok: false };
    },
    [sourceFor],
  );
  const indexState = scenario.init.indexState;
  // Its own URL per index state: the room caches prepared indexes by URL, and these states must not hit it.
  const indexUrl = indexState ? `preview:${indexState}:${catalog.listVersionId}` : `preview:${catalog.listVersionId}`;
  const preset = scenario.preset;

  const admin = scenario.admin;
  const adminPools = (admin?.pools ?? []).map((p) =>
    group ? { ...p.summary, season_group_id: group.id, season_group_name: group.name } : p.summary,
  );
  switch (scenario.screen) {
    case 'redraft':
      return (
        <RedraftCenter
          seasonId={seasonId}
          poolId={scenario.poolId}
          catalog={catalog}
          initialSnapshot={scenario.init.snapshot}
          viewer={{ playerId: scenario.viewer.playerId }}
          links={{ room: screenLinks.redraftRoom }}
          dataSource={source}
          redraftSource={source}
        />
      );
    case 'tokens':
      return <TokenCenter seasonId={seasonId} catalog={catalog} source={source} />;
    case 'admin':
      if (!admin) break;
      return (
        <DraftControlPanel
          seasonId={seasonId}
          pools={adminPools}
          catalog={catalog}
          initialSnapshots={Object.fromEntries(
            admin.pools.flatMap((p): [string, DraftSnapshotDTO][] => (p.init.snapshot ? [[p.summary.id, p.init.snapshot]] : [])),
          )}
          publishRefusedAt={admin.publishRefusedAt}
          links={{ audit: screenLinks.adminAudit, room: screenLinks.adminRoom }}
          dataSourceFor={sourceFor}
          actionsFor={sourceFor}
        />
      );
    case 'tokenAdmin':
      if (!admin) break;
      return (
        <TokenAdminSummary
          seasonId={seasonId}
          catalog={catalog}
          participants={admin.participants}
          comebackSpendOpen={admin.comebackSpendOpen}
          hasRedraft={admin.hasRedraft}
          source={source}
          setComebackOpen={(open) => source.setComebackOpen(open)}
        />
      );
    case 'audit':
      if (!admin) break;
      return (
        <DraftAuditViewer
          seasonId={seasonId}
          pools={adminPools}
          initialPoolId={scenario.poolId}
          participants={admin.participants}
          catalog={catalog}
          loadPage={loadAuditPage}
        />
      );
    case 'pick':
      break;
  }

  return (
    <DraftToolClient
      poolId={scenario.poolId}
      seasonId={seasonId}
      seasonGroup={group}
      leagueName={leagueName}
      catalog={catalog}
      initialSnapshot={scenario.init.snapshot}
      indexUrl={indexUrl}
      initialIndex={indexState ? undefined : index}
      viewer={scenario.viewer}
      dataSource={source}
      links={links}
      initialView={preset ? presetView(preset) : undefined}
      initialConfirmLineId={preset?.dialog === true ? preset.pinnedLineId : undefined}
      adminActions={source}
      initialAdminTab={preset?.adminTab}
    />
  );
}

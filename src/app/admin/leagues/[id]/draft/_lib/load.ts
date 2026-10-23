import 'server-only';

/**
 * Shared gate and reads of the admin draft pages (draft-frontend §3.4):
 * `/admin/leagues/[id]/draft` and `/admin/leagues/[id]/draft/audit`.
 *
 * Gate: the admin layout's `AdminGuard` (any admin, live) plus the resource
 * check of this season (site admin, or resource admin of the season), read
 * live before any draft data is loaded. Participants cross into the client
 * only as `toPublicPlayerRef` (`{ id, name }`, AGENTS.md "never pass raw
 * players rows to client components").
 */
import { gateResourceAdmin } from '@/lib/auth/resource-gate';
import { getSeasonParticipants, getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeasonWithGroups } from '@/lib/supabase/queries/drafts';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { getPublishRefusals } from '@/lib/supabase/queries/draft-publish-refusals';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { lineThresholdsFromEntries } from '@/lib/draft/epb-thresholds';
import { buildLineCatalog, type DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import { isLegacyBoardPool, isQueuePool } from '@/lib/draft-ui/select-pool';
import { toPublicPlayerRef, type PublicPlayerRef } from '@/lib/players/public-player';
import type { Locale } from '@/i18n/config';
import { DEFAULT_BANNED_MOVES, type FormatRules } from '@/types/format-rules';
import type { AdminPoolSummary } from '@/types/draft-queue';

export type DraftAdminGate =
  | { kind: 'ok'; playerId: string }
  /** Signed out or not an admin at all: `AdminGuard` redirects / denies. */
  | { kind: 'guard' }
  /** An admin, but not of this season. */
  | { kind: 'forbidden' };

/**
 * Live check: site admin, or resource admin of this season in good standing.
 * A route id that is not a uuid is a 404 before any auth or admin read.
 */
export async function gateDraftAdmin(seasonId: string): Promise<DraftAdminGate> {
  const gate = await gateResourceAdmin('season', seasonId);
  return gate.kind === 'ok' ? { kind: 'ok', playerId: gate.playerId } : gate;
}

export type AdminDraftData =
  | { kind: 'notFound' }
  | { kind: 'notEpb'; leagueName: string }
  | { kind: 'noList'; leagueName: string }
  | {
      kind: 'ok';
      leagueName: string;
      /** Queue-engine pools only: the control panel's tabs and snapshot seeds. */
      pools: AdminPoolSummary[];
      /** Legacy-engine (pre-M2) pools: listed with links, never snapshotted (POOL_ENGINE_LEGACY). */
      legacyPools: AdminPoolSummary[];
      participants: PublicPlayerRef[];
      catalog: DraftLineCatalog;
      formatRules: FormatRules | null;
    };

/** League, pools, participants (narrow) and the line catalog. Call only after `gateDraftAdmin` passed. */
export async function loadAdminDraftData(seasonId: string, locale: Locale): Promise<AdminDraftData> {
  const league = await getSeasonWithDetails(seasonId);
  if (!league) return { kind: 'notFound' };
  if (!isEvolutionPointBuy(league.format_type)) return { kind: 'notEpb', leagueName: league.name };
  const listVersionId = league.point_buy_list_id;
  if (!listVersionId) return { kind: 'noList', leagueName: league.name };

  // League groups: the pools with their group (ordered by group, then creation), so the control panel labels its
  // tabs by group and binds "Create Redraft" to the selected pool's group. A league without groups: creation order.
  const [groupedPools, rows, entries, formatRules] = await Promise.all([
    getDraftPoolsBySeasonWithGroups(seasonId),
    getSeasonParticipants(seasonId),
    getListEntries(listVersionId),
    getFormatRules(seasonId),
  ]);
  const banned = formatRules?.banned_moves?.length ? formatRules.banned_moves : DEFAULT_BANNED_MOVES;
  // Narrow to the panel's summary (no budget, parent or timestamps cross into the client).
  const allPools: AdminPoolSummary[] = groupedPools.map((p) => ({
    id: p.id,
    engine: p.engine,
    kind: p.kind,
    phase: p.phase,
    mode: p.mode,
    status: p.status,
    season_group_id: p.season_group_id,
    season_group_name: p.season_group_name ? translateEngineLabel('group', p.season_group_name, locale) : null,
  }));
  return {
    kind: 'ok',
    leagueName: league.name,
    pools: allPools.filter(isQueuePool),
    legacyPools: allPools.filter(isLegacyBoardPool),
    participants: rows.map(toPublicPlayerRef),
    catalog: buildLineCatalog(entries, lineThresholdsFromEntries(entries), banned, locale),
    formatRules,
  };
}

/**
 * `draft_pools.publish_refused_at` of the season's Redraft pools that are still in their submission phase:
 * the deadline tick refused to publish them (REDRAFT_NOT_COMPLETABLE / POOL_CHECK_LIMIT) and retries after a
 * change or an hour later. Admin data: it crosses to the control panel as `pool id -> instant` for the first
 * render; the Redraft section then follows the admin submissions read (`GET …/redraft/submissions`, which
 * carries the same column). No query when no such pool exists. A failed read throws (the page's error
 * boundary), it is never read as "not refused".
 */
export async function loadPublishRefusals(pools: readonly AdminPoolSummary[]): Promise<Record<string, string>> {
  const ids = pools.filter((p) => p.kind === 'redraft' && p.phase === 'submissions').map((p) => p.id);
  return getPublishRefusals(ids);
}

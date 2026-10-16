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
import { notFound } from 'next/navigation';
import { getLiveAccess } from '@/lib/auth/helpers';
import { isValidUuid } from '@/lib/utils/uuid';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getSeasonParticipants, getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
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
  if (!isValidUuid(seasonId)) notFound();
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return { kind: 'guard' };
  if (access.isSiteAdmin) return { kind: 'ok', playerId: access.player.playerId };
  const allowed = await isResourceAdminFor(access.player.playerId, 'season', seasonId);
  return allowed ? { kind: 'ok', playerId: access.player.playerId } : { kind: 'forbidden' };
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

  const [allPools, rows, entries, formatRules] = await Promise.all([
    getDraftPoolsBySeason(seasonId),
    getSeasonParticipants(seasonId),
    getListEntries(listVersionId),
    getFormatRules(seasonId),
  ]);
  const banned = formatRules?.banned_moves?.length ? formatRules.banned_moves : DEFAULT_BANNED_MOVES;
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

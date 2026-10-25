/**
 * Server-side, format-aware standings entry point.
 *
 * Loads the season's format and (for evolution_point_buy) the per-player
 * evolution-points map and the stored tiebreaker order, then delegates to the pure dispatcher in
 * standings.ts. Non-EPB seasons and standalone tournaments pay a single
 * seasons lookup and keep the generic computeStandings behavior.
 *
 * Callers that already hold the season's format (a page that loaded the
 * season row) or that compute many tables at once (the profile composer)
 * resolve a `SeasonStandingsContext` once and call the pure
 * `computeStandingsFromContext` per table instead of paying the lookups per
 * call.
 *
 * Server-only: imports service-role query modules. Client components must
 * use computeStandingsForFormat with props instead.
 */

import { computeStandingsForFormat } from './standings';
import { getSeasonById, getSeasonFormatTypes } from '@/lib/supabase/queries/seasons';
import { getSeasonEvolutionPoints } from '@/lib/supabase/queries/evolutions';
import { getFormatRules, getTiebreakerOrdersBySeason } from '@/lib/supabase/queries/format-rules';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import type { StandingsOptions } from './standings';
import type { Standing, MatchRecord } from './types';
import type { TiebreakerStep } from '@/types/format-rules';

/** What the format-aware standings need to know about a tournament's season. */
export interface SeasonStandingsContext {
  /** The season's format; null for a standalone tournament or a missing season. */
  formatType: string | null;
  /** Per-player evolution points; set only for evolution_point_buy seasons. */
  evolutionPoints?: Record<string, number>;
  /**
   * The season's stored `format_rules.tiebreaker_order`, as read; set only for evolution_point_buy seasons that have
   * a format rules row. The standings check it (`effectiveTiebreakerChain`) and fall back to the pack's chain for
   * an absent or unusable order.
   */
  tiebreakerOrder?: readonly TiebreakerStep[];
}

/** The context of a tournament without a season (generic standings). */
export const NO_SEASON_CONTEXT: SeasonStandingsContext = { formatType: null };

/**
 * Sum `evolution_points_awarded` per player — the exact reduction
 * `getSeasonEvolutionPoints` applies to the season's `evolution_tracker`
 * rows. A caller that already loaded the season's trackers derives the map
 * from them instead of reading the table a second time. Pure.
 */
export function sumEvolutionPoints(
  rows: readonly { player_id: string; evolution_points_awarded: number }[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.player_id] = (totals[row.player_id] ?? 0) + row.evolution_points_awarded;
  }
  return totals;
}

/** The context of an Evolution Point Buy season from the rows it is built from (a missing rules row adds no order). */
export function epbStandingsContext(
  formatType: string,
  evolutionPoints: Record<string, number>,
  tiebreakerOrder: readonly TiebreakerStep[] | null | undefined,
): SeasonStandingsContext {
  return tiebreakerOrder ? { formatType, evolutionPoints, tiebreakerOrder } : { formatType, evolutionPoints };
}

/**
 * The context of a season already known to be Evolution Point Buy: its evolution points and stored tiebreaker order
 * in two parallel reads. For a caller that holds the season's format (it read the season or the stage's season join)
 * and so needs no seasons lookup.
 */
export async function loadEpbStandingsContext(
  seasonId: string,
  formatType: string,
): Promise<SeasonStandingsContext> {
  const [evolutionPoints, formatRules] = await Promise.all([
    getSeasonEvolutionPoints(seasonId),
    getFormatRules(seasonId),
  ]);
  return epbStandingsContext(formatType, evolutionPoints, formatRules?.tiebreaker_order);
}

/** One season's context: the season row, plus its evolution points and stored tiebreaker order when EPB. */
export async function loadSeasonStandingsContext(
  seasonId: string | null | undefined,
): Promise<SeasonStandingsContext> {
  if (!seasonId) return NO_SEASON_CONTEXT;
  const season = await getSeasonById(seasonId);
  if (!season) return NO_SEASON_CONTEXT;
  if (!isEvolutionPointBuy(season.format_type)) return { formatType: season.format_type };
  return loadEpbStandingsContext(seasonId, season.format_type);
}

/**
 * Contexts for many seasons at once: ONE seasons read for every format, then
 * one evolution-points read per distinct EPB season and ONE format rules read
 * for all of them (only when there is an EPB season), all in parallel. Seasons
 * that do not exist are absent from the map (callers fall back to
 * `NO_SEASON_CONTEXT`, the same result `loadSeasonStandingsContext` gives).
 */
export async function loadSeasonStandingsContexts(
  seasonIds: readonly (string | null | undefined)[],
): Promise<Map<string, SeasonStandingsContext>> {
  const ids = [...new Set(seasonIds.filter((id): id is string => Boolean(id)))];
  const contexts = new Map<string, SeasonStandingsContext>();
  if (ids.length === 0) return contexts;

  const formats = await getSeasonFormatTypes(ids);
  const epbIds = ids.filter((id) => {
    const format = formats.get(id);
    return format !== undefined && isEvolutionPointBuy(format);
  });
  const [epbPoints, orders] = await Promise.all([
    Promise.all(epbIds.map((id) => getSeasonEvolutionPoints(id))),
    epbIds.length > 0 ? getTiebreakerOrdersBySeason(epbIds) : new Map<string, TiebreakerStep[]>(),
  ]);
  const pointsById = new Map(epbIds.map((id, index) => [id, epbPoints[index]]));

  for (const id of ids) {
    const formatType = formats.get(id);
    if (formatType === undefined) continue;
    const evolutionPoints = pointsById.get(id);
    contexts.set(id, evolutionPoints ? epbStandingsContext(formatType, evolutionPoints, orders.get(id)) : { formatType });
  }
  return contexts;
}

/**
 * Standings from an already-resolved season context. Pure — the same
 * dispatch `computeStandingsForSeason` performs after its lookups.
 */
export function computeStandingsFromContext(
  context: SeasonStandingsContext,
  participantIds: string[],
  participantNames: Record<string, string>,
  matches: MatchRecord[],
  participantAvatars: Record<string, string | null> = {},
  options: StandingsOptions = {},
  participantGymTypes: Record<string, string | null> = {},
): Standing[] {
  return computeStandingsForFormat(
    context.formatType,
    participantIds,
    participantNames,
    matches,
    participantAvatars,
    options,
    participantGymTypes,
    { evolutionPoints: context.evolutionPoints, tiebreakerOrder: context.tiebreakerOrder },
  );
}

export async function computeStandingsForSeason(
  seasonId: string | null | undefined,
  participantIds: string[],
  participantNames: Record<string, string>,
  matches: MatchRecord[],
  participantAvatars: Record<string, string | null> = {},
  options: StandingsOptions = {},
  participantGymTypes: Record<string, string | null> = {},
): Promise<Standing[]> {
  const context = await loadSeasonStandingsContext(seasonId);
  return computeStandingsFromContext(
    context,
    participantIds,
    participantNames,
    matches,
    participantAvatars,
    options,
    participantGymTypes,
  );
}

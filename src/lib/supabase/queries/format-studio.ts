/**
 * Bounded, read-only queries behind the Format Studio (`src/lib/format-studio/loader.ts`). Server only.
 *
 * Each read is a plain PostgREST query on ids that come from the database or from an `isValidUuid`-checked
 * route param (nothing is built from user input). Id lists are read in chunks of 50 and every chunk is paged with
 * `.range()` until a short page, so neither the request URL nor PostgREST's `max_rows` ceiling can drop a row
 * silently. Counts come from `child ( count )` embeds or head counts; no player or match row is touched.
 */
import 'server-only';

import { supabase } from '../client';

/** Ids per `.in(…)` filter. */
const BATCH_IDS = 50;

/** The PostgREST `max_rows` ceiling (`supabase/config.toml`): a full page may have been truncated server-side. */
const PAGE_SIZE = 1000;

function chunksOf(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_IDS) chunks.push(unique.slice(i, i + BATCH_IDS));
  return chunks;
}

/** `child ( count )` embeds arrive as `[{ count: n }]`. */
function embeddedCount(value: unknown): number {
  if (!Array.isArray(value) || value.length === 0) return 0;
  const first = value[0] as { count?: unknown };
  return typeof first.count === 'number' ? first.count : 0;
}

/**
 * Groups per phase: phase (tournament) id to its `tournament_groups` count, for every phase of the given leagues.
 * A phase without groups maps to 0. Phases of other leagues are never read.
 */
export async function getStageGroupCounts(seasonIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const chunk of chunksOf(seasonIds)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('tournaments')
        .select('id, tournament_groups ( count )')
        .in('season_id', chunk)
        .order('id')
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      for (const row of data) counts.set(row.id, embeddedCount(row.tournament_groups));
      if (data.length < PAGE_SIZE) break;
    }
  }
  return counts;
}

/**
 * League groups per league (`season_groups`, the editor on the league admin page): league id to its group count,
 * counted in JS from the paged rows. A league without groups maps to 0.
 */
export async function getLeagueGroupCounts(seasonIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>([...new Set(seasonIds)].map((id) => [id, 0]));
  for (const chunk of chunksOf(seasonIds)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('season_groups')
        .select('id, season_id')
        .in('season_id', chunk)
        .order('season_id')
        .order('id')
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      for (const row of data) counts.set(row.season_id, (counts.get(row.season_id) ?? 0) + 1);
      if (data.length < PAGE_SIZE) break;
    }
  }
  return counts;
}

/**
 * How many of a league's participants carry a gym type and how many a Core Liga core: two head counts on
 * `season_participants`, no participant or player row is read.
 */
export async function getSeasonTypeAssignmentCounts(
  seasonId: string,
): Promise<{ gymTyped: number; cored: number }> {
  const [gym, core] = await Promise.all([
    supabase
      .from('season_participants')
      .select('player_id', { count: 'exact', head: true })
      .eq('season_id', seasonId)
      .not('gym_type', 'is', null),
    supabase
      .from('season_participants')
      .select('player_id', { count: 'exact', head: true })
      .eq('season_id', seasonId)
      .not('core_types', 'is', null),
  ]);

  if (gym.error) throw gym.error;
  if (core.error) throw core.error;
  return { gymTyped: gym.count ?? 0, cored: core.count ?? 0 };
}

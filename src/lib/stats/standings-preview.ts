import { buildStandingsRowsFromMatchRecords } from '@/lib/stats/standings-rows';
import { getCompletedMatchRecords, getCompletedMatchRecordsBatch } from '@/lib/supabase/queries/matches';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { getSeasonParticipants, getSeasonStageIds } from '@/lib/supabase/queries/seasons';
import type { StandingsRow } from '@/types/game';

export interface StandingsPreviewRow {
  rank: number;
  player_id: string;
  player_name: string;
  wins: number;
  losses: number;
}

function toPreviewRows(standings: StandingsRow[], limit: number): StandingsPreviewRow[] {
  return standings.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    player_id: row.player_id,
    player_name: row.player_name,
    wins: row.wins,
    losses: row.losses,
  }));
}

async function loadLeagueStandings(seasonId: string): Promise<StandingsRow[]> {
  // Both reads throw on a Supabase error: a failed stage read must not turn
  // into an all-zero table that the public cache then serves to everyone.
  const parts = await getSeasonParticipants(seasonId);
  const tournamentIds = await getSeasonStageIds(seasonId);
  const recordsMap = await getCompletedMatchRecordsBatch(tournamentIds);
  const matchRecords = [...recordsMap.values()].flat();
  return buildStandingsRowsFromMatchRecords(
    parts.map((p) => ({
      id: p.id,
      name: p.name,
      avatar_url: p.avatar_url,
      gym_type: p.gym_type,
    })),
    matchRecords,
  );
}

/**
 * Top-N standings for a league or tournament (home featured card, etc.).
 */
export async function getStandingsPreview(
  kind: 'league' | 'tournament',
  id: string,
  limit = 3,
): Promise<StandingsPreviewRow[]> {
  if (kind === 'tournament') {
    const [parts, records] = await Promise.all([
      getParticipants(id),
      getCompletedMatchRecords(id),
    ]);
    const standings = buildStandingsRowsFromMatchRecords(
      parts.map((p) => ({
        id: p.id,
        name: p.name,
        avatar_url: p.avatar_url,
        gym_type: null,
      })),
      records,
    );
    return toPreviewRows(standings, limit);
  }

  const standings = await loadLeagueStandings(id);
  return toPreviewRows(standings, limit);
}

/**
 * A limit no league reaches, so a preview read with it holds the whole table.
 * The dashboard reads every league through the cached preview, and the row
 * count is the league's player total.
 */
export const FULL_STANDINGS_LIMIT = 1000;

export interface PlayerStandingSnapshot {
  rank: number;
  total: number;
  wins: number;
  losses: number;
}

/** One player's rank in a full standings table (dashboard league cards). */
export function playerStandingFromRows(
  rows: readonly StandingsPreviewRow[],
  playerId: string,
): PlayerStandingSnapshot | null {
  const row = rows.find((r) => r.player_id === playerId);
  if (!row) return null;
  return { rank: row.rank, total: rows.length, wins: row.wins, losses: row.losses };
}

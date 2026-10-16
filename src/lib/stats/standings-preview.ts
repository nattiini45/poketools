import { buildStandingsRowsFromMatchRecords } from '@/lib/stats/standings-rows';
import { getCompletedMatchRecords, getCompletedMatchRecordsBatch } from '@/lib/supabase/queries/matches';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { supabase } from '@/lib/supabase/client';
import type { StandingsRow } from '@/types/game';

export interface StandingsPreviewRow {
  rank: number;
  player_name: string;
  wins: number;
  losses: number;
}

function toPreviewRows(standings: StandingsRow[], limit: number): StandingsPreviewRow[] {
  return standings.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    player_name: row.player_name,
    wins: row.wins,
    losses: row.losses,
  }));
}

async function loadLeagueStandings(seasonId: string): Promise<StandingsRow[]> {
  const parts = await getSeasonParticipants(seasonId);
  const { data: seasonTournaments } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);
  const tournamentIds = (seasonTournaments ?? []).map((t) => t.id);
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
 * Current player rank in an active league (dashboard mini-standings).
 */
export async function getPlayerRankInLeague(
  seasonId: string,
  playerId: string,
): Promise<{ rank: number; total: number; wins: number; losses: number } | null> {
  const standings = await loadLeagueStandings(seasonId);
  const index = standings.findIndex((s) => s.player_id === playerId);
  if (index === -1) return null;
  const row = standings[index];
  return {
    rank: index + 1,
    total: standings.length,
    wins: row.wins,
    losses: row.losses,
  };
}

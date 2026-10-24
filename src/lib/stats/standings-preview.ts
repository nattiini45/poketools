import { buildStandingsRowsFromMatchRecords } from '@/lib/stats/standings-rows';
import { getCompletedMatchRecords, getCompletedMatchRecordsBatch } from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { loadScoringByes, loadSeasonSwissByeRounds } from '@/lib/tournament/scoring-byes';
import { formatScoresByes, scoringByeRecords } from '@/lib/tournament/byes';
import { getSeasonParticipants, getSeasonStageBrackets } from '@/lib/supabase/queries/seasons';
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
  const { stageIds, hasSwissStage, formatType } = await getSeasonStageBrackets(seasonId);
  // The Swiss stages' stored byes score in the season table as in each stage's own table: one rounds read for all
  // stages. A league without a Swiss stage has none, and Evolution Point Buy tables never read byes, so neither
  // pays the read.
  const readsByes = hasSwissStage && formatScoresByes(formatType);
  const [recordsMap, byeRoundsByStage] = await Promise.all([
    getCompletedMatchRecordsBatch(stageIds),
    readsByes ? loadSeasonSwissByeRounds(seasonId) : undefined,
  ]);
  const matchRecords = [...recordsMap.values()].flat();
  // The loader holds Swiss stages only.
  const byes = scoringByeRecords('swiss', [...(byeRoundsByStage?.values() ?? [])].flat());
  return buildStandingsRowsFromMatchRecords(
    parts.map((p) => ({
      id: p.id,
      name: p.name,
      avatar_url: p.avatar_url,
      gym_type: p.gym_type,
    })),
    matchRecords,
    byes,
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
    const [parts, records, tournament] = await Promise.all([
      getParticipants(id),
      getCompletedMatchRecords(id),
      getTournamentById(id),
    ]);
    // A Swiss tournament's table scores the byes stored on its rounds, except a stage of an Evolution Point Buy
    // league (`loadScoringByes` returns none for it).
    const byes = tournament ? await loadScoringByes(tournament) : [];
    const standings = buildStandingsRowsFromMatchRecords(
      parts.map((p) => ({
        id: p.id,
        name: p.name,
        avatar_url: p.avatar_url,
        gym_type: null,
      })),
      records,
      byes,
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

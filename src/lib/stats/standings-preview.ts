import { buildStandingsRowsFromMatchRecords, rankingForPhase } from '@/lib/stats/standings-rows';
import { getCompletedMatchRecords, getCompletedMatchRecordsBatch } from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { loadScoringByes, loadSeasonSwissByeRounds } from '@/lib/tournament/scoring-byes';
import { formatScoresByes, scoringByeRecords } from '@/lib/tournament/byes';
import { getPublicSeasonParticipants, getSeasonParticipants, getSeasonStageBrackets } from '@/lib/supabase/queries/seasons';
import { loadRankingContext, type SeasonStandingsContext } from '@/lib/tournament/season-standings';
import { loadNativeSeasonStandingsContext } from '@/lib/league-phase/standings-context';
import { getPhaseRankingStages } from '@/lib/supabase/queries/league-phases';
import { getCompletedPhaseMatchRecordsBatch } from '@/lib/supabase/queries/phase-format-runtime';
import { getByeRoundsByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import type { ByeRecord, MatchRecord } from '@/lib/tournament/types';
import type { StandingsRow } from '@/types/game';
import { finalLeaguePlacings, groupStageIds, groupStageRanking, isPlayoffStage, type LeagueRankingStage } from '@/lib/tournament/league-placings';

export interface StandingsPreviewRow {
  rank: number;
  player_id: string;
  player_name: string;
  wins: number;
  losses: number;
}

function toPreviewRows(standings: StandingsRow[], limit: number): StandingsPreviewRow[] {
  return standings.slice(0, limit).map((row, index) => ({
    rank: row.rank ?? index + 1,
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
  const { stageIds, hasSwissStage, formatType, stages, hasGroups } = await getSeasonStageBrackets(seasonId);
  // The Swiss stages' stored byes score in the season table as in each stage's own table: one rounds read for all
  // stages. A league without a Swiss stage has none, and Evolution Point Buy tables never read byes, so neither
  // pays the read.
  const readsByes = hasSwissStage && formatScoresByes(formatType);
  // An Evolution Point Buy table ranks by the season's stored tiebreaker order and its evolution points, a kit league
  // by its format, like the league's own tables: more reads only for such a league.
  const [recordsMap, byeRoundsByStage, ranking] = await Promise.all([
    getCompletedMatchRecordsBatch(stageIds),
    readsByes ? loadSeasonSwissByeRounds(seasonId) : undefined,
    formatType ? loadRankingContext(seasonId, formatType) : undefined,
  ]);
  const byes = scoringByeRecords('swiss', [...(byeRoundsByStage?.values() ?? [])].flat());
  return leaguePreviewTable(parts, recordsMap, byes, ranking, stageIds, stages, hasGroups);
}

function leaguePreviewTable(
  parts: readonly Pick<Awaited<ReturnType<typeof getSeasonParticipants>>[number], 'id' | 'name' | 'avatar_url' | 'gym_type'>[],
  recordsMap: ReadonlyMap<string, MatchRecord[]>,
  byes: readonly ByeRecord[],
  ranking: SeasonStandingsContext | undefined,
  stageIds: readonly string[],
  stages?: readonly LeagueRankingStage[],
  hasGroups?: boolean,
): StandingsRow[] {
  const matchRecords = (stages ? groupStageIds(stages) : stageIds).flatMap((id) => recordsMap.get(id) ?? []);
  const table = buildStandingsRowsFromMatchRecords(
    parts.map((p) => ({
      id: p.id,
      name: p.name,
      avatar_url: p.avatar_url,
      gym_type: p.gym_type,
    })),
    matchRecords,
    byes,
    ranking && stages ? groupStageRanking(ranking, stages) : ranking,
    undefined,
    hasGroups && stages?.some(isPlayoffStage),
  );
  return stages ? finalLeaguePlacings(table, stages, recordsMap) ?? table : table;
}

export async function getNativeLeagueStandingsPreview(seasonId: string, limit: number): Promise<StandingsPreviewRow[]> {
  const [parts, stages] = await Promise.all([getPublicSeasonParticipants(seasonId), getPhaseRankingStages(seasonId)]);
  const ids = stages.map((stage) => stage.id);
  const [records, ranking] = await Promise.all([
    getCompletedPhaseMatchRecordsBatch(ids),
    stages.length ? loadNativeSeasonStandingsContext(seasonId) : undefined,
  ]);
  const swissIds = ranking && formatScoresByes(ranking.formatType)
    ? stages.filter((stage) => stage.bracket_type === 'swiss').map((stage) => stage.id)
    : [];
  const byeRounds = await getByeRoundsByPhaseIds(swissIds);
  const byes = scoringByeRecords('swiss', [...byeRounds.values()].flat());
  return toPreviewRows(leaguePreviewTable(parts, records, byes, ranking, ids, stages, stages.some((stage) => stage.hasGroups)), limit);
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
    // A stage of an Evolution Point Buy or kit league ranks like the league's tables; every other tournament keeps
    // the generic ranking and reads nothing more.
    const ranking =
      tournament?.season_id && tournament.season_format_type
        ? await loadRankingContext(tournament.season_id, tournament.season_format_type)
        : undefined;
    const standings = buildStandingsRowsFromMatchRecords(
      parts.map((p) => ({
        id: p.id,
        name: p.name,
        avatar_url: p.avatar_url,
        gym_type: null,
      })),
      records,
      byes,
      rankingForPhase(ranking, id),
      tournament ?? undefined,
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

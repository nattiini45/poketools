/**
 * League-data agent tools (PRD §5, Layer 2). Thin, read-only wrappers around the
 * existing Supabase query modules — no new SQL, no RPCs — that flatten domain
 * objects into compact, JSON-safe summaries for the LLM:
 *   - queryLeagueData    — roster / standings / usage aggregates for a scope
 *   - getMatchHistory    — a player's completed matches (opponent, score, replay)
 *   - getUpcomingMatches — a player's not-yet-played matches
 *
 * `playerId` / `scopeId` always come from the validated tool input, never from
 * session or cookies (the executors are transport-agnostic per PRD §5).
 */
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getAggregates } from '@/lib/supabase/queries/aggregates';
import {
  getMatchesByPlayer,
  getMatchesByPlayerWithTournament,
  getCompletedMatchRecords,
  getUpcomingMatches as getUpcomingMatchesQuery,
} from '@/lib/supabase/queries/matches';
import { buildStandingsRowsFromMatchRecords } from '@/lib/stats/standings-rows';
import { loadScoringByes } from '@/lib/tournament/scoring-byes';
import type { MatchWithPlayers } from '@/types/match';
import type {
  QueryLeagueDataInput,
  GetMatchHistoryInput,
  GetUpcomingMatchesInput,
} from './schemas';

// ─── Caps ────────────────────────────────────────────────────────────

const MAX_AGGREGATE_ROWS = 25;

// ─── Result shapes ───────────────────────────────────────────────────

export interface RosterEntry {
  player_id: string;
  name: string;
  seed: number | null;
}

export interface StandingEntry {
  player_id: string;
  name: string;
  wins: number;
  losses: number;
  games_played: number;
}

export interface UsageEntry {
  pokemon: string;
  appearances: number;
  brought: number;
  wins: number;
  games: number;
  kos_dealt: number;
}

export type QueryLeagueDataResult =
  | { scope: QueryLeagueDataInput['scope']; infoType: 'participants'; roster: RosterEntry[] }
  | { scope: QueryLeagueDataInput['scope']; infoType: 'standings'; standings: StandingEntry[] }
  | { scope: QueryLeagueDataInput['scope']; infoType: 'aggregates'; usage: UsageEntry[] };

export interface MatchHistoryEntry {
  match_id: string;
  tournament_id: string;
  tournament_name: string | null;
  opponent_id: string;
  opponent_name: string;
  /** 'win' | 'loss' | null (null when no winner recorded). */
  result: 'win' | 'loss' | null;
  /** Games won by the player vs the opponent, e.g. "2-1". */
  score: string;
  date_played: string | null;
  replay_urls: string[];
}

export interface UpcomingMatchEntry {
  match_id: string;
  tournament_id: string;
  opponent_id: string;
  opponent_name: string;
  status: string;
  scheduled_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function opponentOf(match: MatchWithPlayers, playerId: string): { id: string; name: string } {
  return match.player_1_id === playerId
    ? { id: match.player_2_id, name: match.player_2_name }
    : { id: match.player_1_id, name: match.player_1_name };
}

function scoreFor(match: MatchWithPlayers, playerId: string, opponentId: string): string {
  let mine = 0;
  let theirs = 0;
  for (const g of match.games) {
    if (g.winner_id === playerId) mine++;
    else if (g.winner_id === opponentId) theirs++;
  }
  return `${mine}-${theirs}`;
}

function replayUrls(match: MatchWithPlayers): string[] {
  return match.games.map((g) => g.replay_url).filter((u): u is string => !!u);
}

// ─── queryLeagueData ─────────────────────────────────────────────────

export async function queryLeagueData(
  input: QueryLeagueDataInput,
): Promise<QueryLeagueDataResult> {
  const { scope, infoType } = input;

  if (infoType === 'aggregates') {
    const aggregates = await getAggregates(scope.type, scope.id ?? null);
    const usage: UsageEntry[] = aggregates.slice(0, MAX_AGGREGATE_ROWS).map((a) => ({
      pokemon: a.pokemon_name,
      appearances: a.total_appearances,
      brought: a.total_brought,
      wins: a.total_wins,
      games: a.total_games,
      kos_dealt: a.total_kos_dealt,
    }));
    return { scope, infoType, usage };
  }

  // Roster and standings are tournament-scoped (they key off a single tournament's
  // participant list). League/all-time scopes only support aggregates above.
  if (scope.type !== 'tournament' || !scope.id) {
    throw new Error(`infoType '${infoType}' requires a tournament scope with an id`);
  }

  const participants = await getParticipants(scope.id);

  if (infoType === 'participants') {
    const roster: RosterEntry[] = participants.map((p) => ({
      player_id: p.id,
      name: p.name,
      seed: p.seed,
    }));
    return { scope, infoType, roster };
  }

  // infoType === 'standings'
  const [records, tournament] = await Promise.all([
    getCompletedMatchRecords(scope.id),
    getTournamentById(scope.id),
  ]);
  // A Swiss tournament's table scores the byes stored on its rounds.
  const byes = tournament ? await loadScoringByes(tournament) : [];
  const rows = buildStandingsRowsFromMatchRecords(
    participants.map((p) => ({ id: p.id, name: p.name, avatar_url: p.avatar_url })),
    records,
    byes,
  );
  const standings: StandingEntry[] = rows.map((r) => ({
    player_id: r.player_id,
    name: r.player_name,
    wins: r.wins,
    losses: r.losses,
    games_played: r.game_wins,
  }));
  return { scope, infoType, standings };
}

// ─── getMatchHistory ─────────────────────────────────────────────────

export async function getMatchHistory(
  input: GetMatchHistoryInput,
): Promise<MatchHistoryEntry[]> {
  const limit = input.limit ?? 20;

  // With tournament name context when unscoped; tournament-filtered otherwise.
  const matches = input.tournamentId
    ? await getMatchesByPlayer(input.playerId, input.tournamentId)
    : await getMatchesByPlayerWithTournament(input.playerId);

  const completed = matches.filter((m) => m.status === 'completed').slice(0, limit);

  return completed.map((m) => {
    const opp = opponentOf(m, input.playerId);
    const tournamentName =
      'tournament_name' in m ? (m as { tournament_name: string }).tournament_name : null;
    return {
      match_id: m.id,
      tournament_id: m.tournament_id,
      tournament_name: tournamentName,
      opponent_id: opp.id,
      opponent_name: opp.name,
      result: m.winner_id ? (m.winner_id === input.playerId ? 'win' : 'loss') : null,
      score: scoreFor(m, input.playerId, opp.id),
      date_played: m.date_played,
      replay_urls: replayUrls(m),
    };
  });
}

// ─── getUpcomingMatches ──────────────────────────────────────────────

export async function getUpcomingMatches(
  input: GetUpcomingMatchesInput,
): Promise<UpcomingMatchEntry[]> {
  const matches = await getUpcomingMatchesQuery(input.playerId);
  return matches.map((m) => {
    const opp = opponentOf(m, input.playerId);
    return {
      match_id: m.id,
      tournament_id: m.tournament_id,
      opponent_id: opp.id,
      opponent_name: opp.name,
      status: m.status,
      scheduled_at: m.scheduled_at,
    };
  });
}

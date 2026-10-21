/**
 * Comeback Token (formerly "kill token") DB reads for Evolution Point Buy.
 * Pure shutout scoring stays in point-buy-engine / tokens / aggregation.
 *
 * Which matches earn is the format pack's `epb.comeback.earnWindow`: `season` loads every
 * completed match of the season; `first_half` passes a scope (the primary stage and its last
 * Hinrunde round, `getHinrundeScope`) and only those matches are loaded: the round bound is a query
 * filter, not a post-filter (tokens are earned in the first half only). Spending is
 * gated separately (redraft complete or the admin switch, `comebackSpendOpen`).
 */

import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';

/** Restricts the load to the Hinrunde: matches of `tournament_id` with `round_number <= last_round`. */
export interface ComebackEarnScope {
  tournament_id: string;
  last_round: number;
}

export interface ComebackMatchRow {
  id: string;
  player_1_id: string;
  player_2_id: string;
  winner_id: string;
  /** EPB matchday (`rounds.round_number`). */
  round_number: number;
}

export interface ComebackTokenStat {
  player_id: string;
  pokemon_name: string;
  was_koed: boolean;
}

export interface ComebackTokenData {
  /** Completed matches with a winner (whole season, or the earn scope only) */
  matches: ComebackMatchRow[];
  /** game_id → battle stat rows used for survivor scoring */
  statsByGame: Map<string, ComebackTokenStat[]>;
  /** match_id → game ids */
  gamesByMatch: Map<string, string[]>;
}

/**
 * Load the completed matches (with a winner) that can earn Comeback Tokens, and their battle
 * stats. Without `scope`: every completed match of the season. With `scope`: only the matches of
 * the scope's stage up to its last Hinrunde round (the second half and other stages never load).
 * Returns empty matches when nothing qualifies. Matches, games and battle stats are paged with
 * `.range()` so a full season is never truncated at `max_rows`.
 */
export async function fetchComebackTokenData(
  seasonId: string,
  scope?: ComebackEarnScope,
): Promise<ComebackTokenData> {
  const empty: ComebackTokenData = {
    matches: [],
    statsByGame: new Map(),
    gamesByMatch: new Map(),
  };

  const { data: tournaments, error: tErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);
  if (tErr) throw tErr;
  if (!tournaments || tournaments.length === 0) return empty;

  const tournamentIds = tournaments.map((t) => t.id);
  if (scope) {
    // A scope from another season can never match: refuse it loudly instead of loading nothing.
    if (!tournamentIds.includes(scope.tournament_id)) {
      throw new Error(`Comeback earn scope tournament ${scope.tournament_id} is not a stage of season ${seasonId}`);
    }
    if (scope.last_round < 1) return empty;
  }

  const matches = await readAllPages((from, to) => {
    let query = supabase
      .from('matches')
      .select('id, player_1_id, player_2_id, winner_id, status, rounds!inner(round_number)')
      .in('tournament_id', scope ? [scope.tournament_id] : tournamentIds)
      .eq('status', 'completed')
      .not('winner_id', 'is', null);
    // The Hinrunde bound runs in the query: with the !inner embed, a filter on the embedded round drops the
    // parent match, so second-half matches are never loaded.
    if (scope) query = query.lte('rounds.round_number', scope.last_round);
    return query.order('id').range(from, to);
  });
  if (matches.length === 0) return empty;

  const completed: ComebackMatchRow[] = [];
  for (const match of matches) {
    if (!match.winner_id) continue;
    const roundNumber = (match.rounds as { round_number: number }).round_number;
    // The query already bounds the rounds; a row past the Hinrunde here means the filter did not apply.
    if (scope && roundNumber > scope.last_round) {
      throw new Error(`Comeback earn scope: match ${match.id} of round ${roundNumber} is past round ${scope.last_round}`);
    }
    completed.push({
      id: match.id,
      player_1_id: match.player_1_id,
      player_2_id: match.player_2_id,
      winner_id: match.winner_id,
      round_number: roundNumber,
    });
  }
  if (completed.length === 0) return empty;

  const matchIds = completed.map((match) => match.id);
  const games = await readAllPages((from, to) =>
    supabase.from('games').select('id, match_id').in('match_id', matchIds).order('id').range(from, to),
  );

  const gameIds = games.map((game) => game.id);
  if (gameIds.length === 0) return empty;

  const battleStats = await readAllPages((from, to) =>
    supabase
      .from('battle_stats')
      .select('id, game_id, player_id, pokemon_name, was_koed')
      .in('game_id', gameIds)
      .order('id')
      .range(from, to),
  );

  const statsByGame = new Map<string, ComebackTokenStat[]>();
  for (const stat of battleStats) {
    const list = statsByGame.get(stat.game_id) ?? [];
    list.push({ player_id: stat.player_id, pokemon_name: stat.pokemon_name, was_koed: stat.was_koed });
    statsByGame.set(stat.game_id, list);
  }

  const gamesByMatch = new Map<string, string[]>();
  for (const game of games) {
    const list = gamesByMatch.get(game.match_id) ?? [];
    list.push(game.id);
    gamesByMatch.set(game.match_id, list);
  }

  return { matches: completed, statsByGame, gamesByMatch };
}

/**
 * Comeback Token (formerly "kill token") DB reads for Evolution Point Buy.
 * Pure shutout scoring stays in point-buy-engine / tokens / aggregation.
 *
 * Comeback Tokens accrue from every completed match of the season — there is
 * no Hinrunde cap (draft-backend §12.2, BR-5). Spending is gated separately
 * (redraft complete or the admin switch, `comebackSpendOpen`).
 */

import { supabase } from '../client';

/** PostgREST `max_rows`: a page never returns more rows than this. */
const PAGE_SIZE = 1000;

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
  /** Completed matches with a winner, whole season */
  matches: ComebackMatchRow[];
  /** game_id → battle stat rows used for survivor scoring */
  statsByGame: Map<string, ComebackTokenStat[]>;
  /** match_id → game ids */
  gamesByMatch: Map<string, string[]>;
}

/**
 * Load every completed match of the season (with a winner) and its battle
 * stats for Comeback Token accounting. Returns empty matches when the season
 * has no tournaments / completed games yet. Battle stats are paged with
 * `.range()` so a full season is never truncated at `max_rows`.
 */
export async function fetchComebackTokenData(seasonId: string): Promise<ComebackTokenData> {
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

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, player_1_id, player_2_id, winner_id, status, rounds!inner(round_number)')
    .in('tournament_id', tournaments.map((t) => t.id))
    .eq('status', 'completed')
    .not('winner_id', 'is', null);
  if (mErr) throw mErr;
  if (!matches || matches.length === 0) return empty;

  const completed: ComebackMatchRow[] = [];
  for (const match of matches) {
    if (!match.winner_id) continue;
    completed.push({
      id: match.id,
      player_1_id: match.player_1_id,
      player_2_id: match.player_2_id,
      winner_id: match.winner_id,
      round_number: (match.rounds as { round_number: number }).round_number,
    });
  }
  if (completed.length === 0) return empty;

  const matchIds = completed.map((match) => match.id);
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id, match_id')
    .in('match_id', matchIds);
  if (gErr) throw gErr;

  const gameIds = (games ?? []).map((game) => game.id);
  if (gameIds.length === 0) return empty;

  const battleStats: (ComebackTokenStat & { game_id: string })[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: bsErr } = await supabase
      .from('battle_stats')
      .select('id, game_id, player_id, pokemon_name, was_koed')
      .in('game_id', gameIds)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (bsErr) throw bsErr;
    const rows = page ?? [];
    for (const row of rows) {
      battleStats.push({
        game_id: row.game_id,
        player_id: row.player_id,
        pokemon_name: row.pokemon_name,
        was_koed: row.was_koed,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  const statsByGame = new Map<string, ComebackTokenStat[]>();
  for (const stat of battleStats) {
    const list = statsByGame.get(stat.game_id) ?? [];
    list.push({ player_id: stat.player_id, pokemon_name: stat.pokemon_name, was_koed: stat.was_koed });
    statsByGame.set(stat.game_id, list);
  }

  const gamesByMatch = new Map<string, string[]>();
  for (const game of games ?? []) {
    const list = gamesByMatch.get(game.match_id) ?? [];
    list.push(game.id);
    gamesByMatch.set(game.match_id, list);
  }

  return { matches: completed, statsByGame, gamesByMatch };
}

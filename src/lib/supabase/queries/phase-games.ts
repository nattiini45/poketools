import { supabase } from '../client';
import { isUniqueViolationOf } from '../unique-violation';
import type { Tables, TablesInsert } from '@/types/database';
import type { Game, GameCreateInput, BattleStat, BattleStatInsert } from '@/types/game';
import { phaseGameStatsLockMachine } from '@/lib/league-phase/phase-game-marker-state';

type GameRow = Tables<'phase_games'>;
type BattleStatRow = Tables<'phase_battle_stats'>;

function toGame(row: GameRow): Game {
  return {
    id: row.id,
    match_id: row.match_id,
    game_number: row.game_number,
    winner_id: row.winner_id,
    replay_url: row.replay_url,
    replay_hash: row.replay_hash,
    source: row.source,
    parsed: row.parsed,
    stats_locked: row.stats_locked,
    aggregate_applied_at: row.aggregate_applied_at,
    evolution_applied_at: row.evolution_applied_at,
    exclude_all_time: row.exclude_all_time,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toBattleStat(row: BattleStatRow): BattleStat {
  return {
    id: row.id,
    game_id: row.game_id,
    player_id: row.player_id,
    pokemon_name: row.pokemon_name,
    was_brought: row.was_brought,
    was_lead: row.was_lead,
    kos_dealt: row.kos_dealt,
    was_koed: row.was_koed,
    moves_used: Array.isArray(row.moves_used) ? row.moves_used as string[] : [],
    turns_active: row.turns_active,
    match_won: row.match_won,
    created_at: row.created_at,
  };
}


export async function getPhaseGamesByMatch(matchId: string): Promise<Game[]> {
  const { data, error } = await supabase
    .from('phase_games')
    .select('*')
    .eq('match_id', matchId)
    .order('game_number');

  if (error) throw error;
  return data.map(toGame);
}

export async function getPhaseGameById(id: string): Promise<Game | null> {
  const { data, error } = await supabase
    .from('phase_games')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toGame(data) : null;
}

import { GameNumberConflictError, ReplayAlreadyRecordedError, BattleStatsDuplicatePokemonError, type GameEditLeaseClaimOutcome, type UncountedGameDeleteOutcome } from './games';
const GAMES_MATCH_GAME_NUMBER_KEY = 'phase_games_match_id_game_number_key';
const GAMES_REPLAY_HASH_KEY = 'phase_games_replay_hash_key';
const BATTLE_STATS_GAME_PLAYER_POKEMON_KEY = 'phase_battle_stats_game_player_pokemon_key';
export async function createPhaseGame(input: GameCreateInput): Promise<Game> {
  const insert: TablesInsert<'phase_games'> = {
    match_id: input.match_id,
    game_number: input.game_number,
    winner_id: input.winner_id,
    replay_url: input.replay_url ?? '',
    replay_hash: input.replay_hash ?? null,
    source: input.source,
    parsed: input.parsed ?? false,
    exclude_all_time: input.exclude_all_time,
  };

  const { data, error } = await supabase
    .from('phase_games')
    .insert(insert)
    .select()
    .single();

  if (error) {
    if (isUniqueViolationOf(error, GAMES_MATCH_GAME_NUMBER_KEY)) {
      console.error(
        `[createPhaseGame] game ${input.game_number} of match ${input.match_id} already exists (concurrent submission)`,
        error
      );
      throw new GameNumberConflictError();
    }
    if ((isUniqueViolationOf(error, GAMES_REPLAY_HASH_KEY) || isUniqueViolationOf(error, 'games_global_replay_hash_key'))) {
      console.error(
        `[createPhaseGame] replay ${input.replay_url ?? ''} of match ${input.match_id} is already bound to a game ` +
          `(concurrent or repeated submission of the same battle)`,
        error
      );
      throw new ReplayAlreadyRecordedError();
    }
    throw error;
  }
  return toGame(data);
}

export async function findPhaseGameIdByReplayHash(replayHash: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('phase_games')
    .select('id')
    .eq('replay_hash', replayHash)
    .maybeSingle();

  if (error) throw error;
  if (data) return data.id;
  const { findGameIdByReplayHash } = await import('./games');
  return findGameIdByReplayHash(replayHash);
}

export async function markPhaseGameParsed(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('phase_games')
    .update({ parsed: true })
    .eq('id', gameId);

  if (error) throw error;
}

export async function updatePhaseGameWinner(gameId: string, winnerId: string): Promise<Game> {
  const { data, error } = await supabase
    .from('phase_games')
    .update({ winner_id: winnerId })
    .eq('id', gameId)
    .select()
    .single();

  if (error) throw error;
  return toGame(data);
}


export async function setPhaseGameStatsLocked(
  gameId: string,
  locked = true
): Promise<void> {
  phaseGameStatsLockMachine.assertTransition('unlocked', locked ? 'locked' : 'unlocked', 'admin');
  const { error } = await supabase
    .from('phase_games')
    .update({ stats_locked: locked })
    .eq('id', gameId);

  if (error) throw error;
}

const GAME_EDIT_LEASE_CLAIM_OUTCOMES: readonly GameEditLeaseClaimOutcome[] = ['claimed', 'leased', 'stale', 'missing'];

export const GAME_EDIT_LEASE_TTL_SECONDS = 120;

export async function claimPhaseGameEditLease(
  gameId: string,
  expectedUpdatedAt: string,
  token: string
): Promise<GameEditLeaseClaimOutcome> {
  const { data, error } = await supabase.rpc('claim_phase_game_edit_lease', {
    p_game_id: gameId,
    p_expected_updated_at: expectedUpdatedAt,
    p_token: token,
    p_ttl_seconds: GAME_EDIT_LEASE_TTL_SECONDS,
  });

  if (error) throw error;
  const outcome = GAME_EDIT_LEASE_CLAIM_OUTCOMES.find((o) => o === data);
  if (!outcome) {
    throw new Error(`claim_game_edit_lease returned an unexpected outcome for game ${gameId}: ${String(data)}`);
  }
  return outcome;
}

export async function releasePhaseGameEditLease(gameId: string, token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('release_phase_game_edit_lease', {
    p_game_id: gameId,
    p_token: token,
  });

  if (error) throw error;
  return data === true;
}

export async function deleteUncountedPhaseGameRow(gameId: string): Promise<UncountedGameDeleteOutcome> {
  const { data, error } = await supabase
    .from('phase_games')
    .delete()
    .eq('id', gameId)
    .is('aggregate_applied_at', null)
    .select('id');

  if (error) throw error;
  if (data.length > 0) return 'deleted';

  const { data: remaining, error: readError } = await supabase
    .from('phase_games')
    .select('id')
    .eq('id', gameId)
    .maybeSingle();

  if (readError) throw readError;
  return remaining ? 'counted' : 'missing';
}

export async function getPhaseGameWinCounts(
  matchId: string
): Promise<{ player_1_wins: number; player_2_wins: number; player_ids: [string, string] }> {
  const { data, error } = await supabase
    .from('phase_games')
    .select('winner_id')
    .eq('match_id', matchId);

  if (error) throw error;

  const { data: match, error: matchErr } = await supabase
    .from('phase_matches')
    .select('player_1_id, player_2_id')
    .eq('id', matchId)
    .single();

  if (matchErr) throw matchErr;

  let player_1_wins = 0;
  let player_2_wins = 0;
  for (const game of data) {
    if (game.winner_id === match.player_1_id) player_1_wins++;
    else if (game.winner_id === match.player_2_id) player_2_wins++;
  }

  return {
    player_1_wins,
    player_2_wins,
    player_ids: [match.player_1_id, match.player_2_id],
  };
}

export async function getNextPhaseGameNumber(matchId: string): Promise<number> {
  const { data, error } = await supabase
    .from('phase_games')
    .select('game_number')
    .eq('match_id', matchId)
    .order('game_number', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data.length > 0 ? data[0].game_number + 1 : 1;
}


export async function createPhaseBattleStats(stats: BattleStatInsert[]): Promise<BattleStat[]> {
  const inserts: TablesInsert<'phase_battle_stats'>[] = stats.map((s) => ({
    game_id: s.game_id,
    player_id: s.player_id,
    pokemon_name: s.pokemon_name,
    was_brought: s.was_brought ?? true,
    was_lead: s.was_lead ?? false,
    kos_dealt: s.kos_dealt ?? 0,
    was_koed: s.was_koed ?? false,
    moves_used: (s.moves_used ?? []) as unknown as TablesInsert<'phase_battle_stats'>['moves_used'],
    turns_active: s.turns_active ?? 0,
    match_won: s.match_won ?? false,
  }));

  const { data, error } = await supabase
    .from('phase_battle_stats')
    .insert(inserts)
    .select();

  if (error) {
    if (isUniqueViolationOf(error, BATTLE_STATS_GAME_PLAYER_POKEMON_KEY)) {
      console.error(
        `[createPhaseBattleStats] duplicate Pokémon for one player in game ${stats[0]?.game_id ?? '?'}`,
        error
      );
      throw new BattleStatsDuplicatePokemonError();
    }
    throw error;
  }
  return data.map(toBattleStat);
}

export async function deletePhaseBattleStatsByGame(gameId: string): Promise<void> {
  const { error } = await supabase
    .from('phase_battle_stats')
    .delete()
    .eq('game_id', gameId);

  if (error) throw error;
}

export async function getPhaseBattleStatsByGame(gameId: string): Promise<BattleStat[]> {
  const { data, error } = await supabase
    .from('phase_battle_stats')
    .select('*')
    .eq('game_id', gameId);

  if (error) throw error;
  return data.map(toBattleStat);
}

export async function getPhaseBattleStatsByMatch(
  matchId: string
): Promise<Record<string, BattleStat[]>> {
  const { data: games, error: gamesErr } = await supabase
    .from('phase_games')
    .select('id')
    .eq('match_id', matchId);

  if (gamesErr) throw gamesErr;
  if (!games.length) return {};

  const gameIds = games.map((g) => g.id);

  const { data, error } = await supabase
    .from('phase_battle_stats')
    .select('*')
    .in('game_id', gameIds);

  if (error) throw error;

  const grouped: Record<string, BattleStat[]> = {};
  for (const row of data) {
    const stat = toBattleStat(row);
    if (!grouped[stat.game_id]) grouped[stat.game_id] = [];
    grouped[stat.game_id].push(stat);
  }
  return grouped;
}

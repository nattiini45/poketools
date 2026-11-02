import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import { assertValidUuid } from '@/lib/utils/uuid';
import type { Json, Tables, TablesInsert } from '@/types/database';
import type { PlayerStreaks } from '@/types/streak';

type PlayerStreaksRow = Tables<'player_streaks'>;

function toPlayerStreaks(row: PlayerStreaksRow): PlayerStreaks {
  return {
    id: row.id,
    player_id: row.player_id,
    current_win_streak: row.current_win_streak,
    best_win_streak: row.best_win_streak,
    current_loss_streak: row.current_loss_streak,
    best_loss_streak: row.best_loss_streak,
    current_ko_streak: row.current_ko_streak,
    best_ko_streak: row.best_ko_streak,
    current_flawless_streak: row.current_flawless_streak,
    best_flawless_streak: row.best_flawless_streak,
    last_match_id: row.last_match_id,
  };
}

export interface PlayerStreaksUpsertInput {
  current_win_streak: number;
  best_win_streak: number;
  current_loss_streak: number;
  best_loss_streak: number;
  current_ko_streak: number;
  best_ko_streak: number;
  current_flawless_streak: number;
  best_flawless_streak: number;
  last_match_id: string | null;
  updated_at?: string;
}

export async function getPlayerStreaks(playerId: string): Promise<PlayerStreaks | null> {
  const { data, error } = await supabase
    .from('player_streaks')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayerStreaks(data) : null;
}

export async function upsertPlayerStreaks(
  playerId: string,
  data: PlayerStreaksUpsertInput
): Promise<PlayerStreaks> {
  const payload: TablesInsert<'player_streaks'> = {
    player_id: playerId,
    current_win_streak: data.current_win_streak,
    best_win_streak: data.best_win_streak,
    current_loss_streak: data.current_loss_streak,
    best_loss_streak: data.best_loss_streak,
    current_ko_streak: data.current_ko_streak,
    best_ko_streak: data.best_ko_streak,
    current_flawless_streak: data.current_flawless_streak,
    best_flawless_streak: data.best_flawless_streak,
    last_match_id: data.last_match_id,
    updated_at: data.updated_at ?? new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from('player_streaks')
    .upsert(payload, { onConflict: 'player_id' })
    .select()
    .single();

  if (error) throw error;
  return toPlayerStreaks(row);
}

/**
 * SQLSTATE `streaks_replace_player` raises when its completed-match fence fails: PostgREST's custom-error form
 * (HTTP 409). Not 40001: PostgREST never answers a 40001 raised inside a function, the request hangs until the
 * gateway times out.
 */
const FENCE_REFUSED = 'PT409';

/**
 * `streaks_replace_player` refused the write (nothing written): the player's
 * set of completed matches changed after the replay read it. Re-read the
 * history and replay again.
 */
export class StreaksStaleError extends Error {
  readonly playerId: string;

  constructor(playerId: string, cause: unknown) {
    super(`completed matches of player ${playerId} changed after the streak replay read them; nothing was written`, {
      cause,
    });
    this.name = 'StreaksStaleError';
    this.playerId = playerId;
  }
}

/**
 * Replace one player's streak row in ONE statement through the service-role
 * RPC `streaks_replace_player`
 * (supabase/migrations/20261102130000_streaks_replace_player.sql): per-player
 * advisory lock, fence on `expectedMatchIds` (every completed match of the
 * player the replay read), then upsert. A different completed set raises
 * PT409, which becomes `StreaksStaleError`; the caller re-reads and retries.
 * Other errors propagate unchanged.
 */
export async function replacePlayerStreaks(
  playerId: string,
  data: PlayerStreaksUpsertInput,
  expectedMatchIds: readonly string[]
): Promise<void> {
  assertValidUuid(playerId, 'playerId');
  const state = {
    current_win_streak: data.current_win_streak,
    best_win_streak: data.best_win_streak,
    current_loss_streak: data.current_loss_streak,
    best_loss_streak: data.best_loss_streak,
    current_ko_streak: data.current_ko_streak,
    best_ko_streak: data.best_ko_streak,
    current_flawless_streak: data.current_flawless_streak,
    best_flawless_streak: data.best_flawless_streak,
    last_match_id: data.last_match_id,
  };

  const { error } = await supabase.rpc('streaks_replace_player', {
    p_player_id: playerId,
    p_state: state as Json,
    p_expected_match_ids: [...expectedMatchIds],
  });

  if (error) {
    if (error.code === FENCE_REFUSED) throw new StreaksStaleError(playerId, error);
    throw error;
  }
}

/** One player's battle-stat totals of a match, summed over every game of it. */
export interface PlayerMatchStatTotals {
  total_kos_dealt: number;
  total_kos_lost: number;
}

/**
 * The player's own battle_stats rows of every COMPLETED match, summed per
 * match, in ONE paged read (not one read per match). A match the player has
 * no row for is absent from the map: its KO figures are unknown, not zero.
 * Paged to the end (`readAllPages`): a truncated read would turn a match with
 * stats into an unknown one and silently change the streaks.
 */
export async function getPlayerStatTotalsByMatch(playerId: string): Promise<Map<string, PlayerMatchStatTotals>> {
  assertValidUuid(playerId, 'playerId');
  const rows = await readAllPages<{
    id: string;
    kos_dealt: number;
    was_koed: boolean;
    games: unknown;
  }>((from, to) =>
    supabase
      .from('battle_stats')
      .select('id, kos_dealt, was_koed, games!inner ( match_id, matches!inner ( status ) )')
      .eq('player_id', playerId)
      .eq('games.matches.status', 'completed')
      .order('id', { ascending: true })
      .range(from, to)
  );

  const totals = new Map<string, PlayerMatchStatTotals>();
  for (const row of rows) {
    const matchId = (row.games as { match_id: string }).match_id;
    const entry = totals.get(matchId) ?? { total_kos_dealt: 0, total_kos_lost: 0 };
    entry.total_kos_dealt += row.kos_dealt;
    if (row.was_koed) entry.total_kos_lost += 1;
    totals.set(matchId, entry);
  }
  return totals;
}

export async function getStreakLeaderboard(): Promise<PlayerStreaks[]> {
  const { data, error } = await supabase
    .from('player_streaks')
    .select('*')
    .order('best_win_streak', { ascending: false });

  if (error) throw error;
  return data.map(toPlayerStreaks);
}

import { supabase } from '../client';
import { getTestAccountIds } from './test-accounts';
import type { Tables, TablesInsert } from '@/types/database';
import type { SignaturePokemon } from '@/types/signature';
import type { PlayerRating, RatingHistoryEntry, RatingLeaderboardEntry } from '@/types/rating';

type PlayerRatingRow = Tables<'player_ratings'>;
type RatingHistoryRow = Tables<'rating_history'>;
type PlayerRow = Tables<'players'>;
type PlayerSignaturesRow = Tables<'player_signatures'>;

function toPlayerRating(row: PlayerRatingRow): PlayerRating {
  return {
    id: row.id,
    player_id: row.player_id,
    rating: row.rating,
    rd: row.rd,
    volatility: row.volatility,
    peak_rating: row.peak_rating,
    peak_date: row.peak_date,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    last_match_at: row.last_match_at,
  };
}

function toRatingHistoryEntry(row: RatingHistoryRow): RatingHistoryEntry {
  return {
    id: row.id,
    player_id: row.player_id,
    match_id: row.match_id,
    rating_before: row.rating_before,
    rating_after: row.rating_after,
    rd_before: row.rd_before,
    rd_after: row.rd_after,
    opponent_id: row.opponent_id,
    opponent_rating: row.opponent_rating,
    result: row.result as RatingHistoryEntry['result'],
    rating_change: row.rating_change ?? row.rating_after - row.rating_before,
    recorded_at: row.recorded_at,
  };
}

export interface PlayerRatingUpsertInput {
  rating: number;
  rd: number;
  volatility: number;
  peak_rating: number;
  peak_date: string | null;
  wins: number;
  losses: number;
  draws: number;
  last_match_at: string | null;
  updated_at?: string;
}

export interface RatingHistoryInsertInput {
  player_id: string;
  match_id: string;
  rating_before: number;
  rating_after: number;
  rd_before: number;
  rd_after: number;
  opponent_id: string;
  opponent_rating: number;
  result: RatingHistoryEntry['result'];
}

export async function getPlayerRating(playerId: string): Promise<PlayerRating | null> {
  const { data, error } = await supabase
    .from('player_ratings')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayerRating(data) : null;
}

export async function upsertPlayerRating(
  playerId: string,
  data: PlayerRatingUpsertInput
): Promise<PlayerRating> {
  const payload: TablesInsert<'player_ratings'> = {
    player_id: playerId,
    rating: data.rating,
    rd: data.rd,
    volatility: data.volatility,
    peak_rating: data.peak_rating,
    peak_date: data.peak_date,
    wins: data.wins,
    losses: data.losses,
    draws: data.draws,
    last_match_at: data.last_match_at,
    updated_at: data.updated_at ?? new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from('player_ratings')
    .upsert(payload, { onConflict: 'player_id' })
    .select()
    .single();

  if (error) throw error;
  return toPlayerRating(row);
}

export async function getRatingHistory(
  playerId: string,
  limit = 30
): Promise<RatingHistoryEntry[]> {
  const { data, error } = await supabase
    .from('rating_history')
    .select('*')
    .eq('player_id', playerId)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data.map(toRatingHistoryEntry);
}

export async function getRatingHistoryByMatch(matchId: string): Promise<RatingHistoryEntry[]> {
  const { data, error } = await supabase
    .from('rating_history')
    .select('*')
    .eq('match_id', matchId)
    .order('recorded_at', { ascending: false });

  if (error) throw error;
  return data.map(toRatingHistoryEntry);
}

/**
 * Batch-fetch rating_history rows for multiple matches in a single query.
 * Used by the chronological rating rebuild to gather each opponent's frozen
 * (rating_before, rd_before) state per match without N+1 per-match queries.
 */
export async function getRatingHistoryByMatches(
  matchIds: string[]
): Promise<RatingHistoryEntry[]> {
  if (matchIds.length === 0) return [];

  const { data, error } = await supabase
    .from('rating_history')
    .select('*')
    .in('match_id', matchIds);

  if (error) throw error;
  return data.map(toRatingHistoryEntry);
}

/**
 * Delete all rating_history rows for a single player. Used by the
 * chronological rebuild to rewrite one player's history without touching
 * opponents' rows (we only read opponents' frozen states, never modify them).
 */
export async function deleteRatingHistoryByPlayer(playerId: string): Promise<void> {
  const { error } = await supabase
    .from('rating_history')
    .delete()
    .eq('player_id', playerId);

  if (error) throw error;
}

/**
 * Batch-insert multiple rating_history rows in a single query.
 * Used by the chronological rebuild to persist the replayed curve.
 */
export async function insertRatingHistoryBatch(
  entries: RatingHistoryInsertInput[]
): Promise<RatingHistoryEntry[]> {
  if (entries.length === 0) return [];

  const payload: TablesInsert<'rating_history'>[] = entries.map((entry) => ({
    player_id: entry.player_id,
    match_id: entry.match_id,
    rating_before: entry.rating_before,
    rating_after: entry.rating_after,
    rd_before: entry.rd_before,
    rd_after: entry.rd_after,
    opponent_id: entry.opponent_id,
    opponent_rating: entry.opponent_rating,
    result: entry.result,
  }));

  const { data, error } = await supabase
    .from('rating_history')
    .insert(payload)
    .select();

  if (error) throw error;
  return data.map(toRatingHistoryEntry);
}

export async function insertRatingHistory(
  entry: RatingHistoryInsertInput
): Promise<RatingHistoryEntry> {
  const payload: TablesInsert<'rating_history'> = {
    player_id: entry.player_id,
    match_id: entry.match_id,
    rating_before: entry.rating_before,
    rating_after: entry.rating_after,
    rd_before: entry.rd_before,
    rd_after: entry.rd_after,
    opponent_id: entry.opponent_id,
    opponent_rating: entry.opponent_rating,
    result: entry.result,
  };

  const { data, error } = await supabase
    .from('rating_history')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return toRatingHistoryEntry(data);
}

export async function getLeaderboard(minGames?: number): Promise<PlayerRating[]> {
  let query = supabase
    .from('player_ratings')
    .select('*')
    .order('rating', { ascending: false })
    .limit(1000);

  // Global leaderboards never include test accounts. PostgREST `in` values
  // are plain UUIDs — no quoting needed (the ids come from the players.id
  // uuid column, so they cannot contain filter metacharacters).
  const testIds = await getTestAccountIds();
  if (testIds.length > 0) {
    query = query.not('player_id', 'in', `(${testIds.join(',')})`);
  }

  const { data, error } = await query;

  if (error) throw error;

  const mapped = data.map(toPlayerRating);
  if (!minGames || minGames <= 0) {
    return mapped;
  }

  return mapped.filter((r) => (r.wins + r.losses + r.draws) >= minGames);
}

export async function getLeaderboardEntries(minGames?: number): Promise<RatingLeaderboardEntry[]> {
  const ratings = await getLeaderboard(minGames);
  if (ratings.length === 0) return [];

  const playerIds = [...new Set(ratings.map((rating) => rating.player_id))];

  const [{ data: players, error: playersError }, { data: signatures, error: signaturesError }] =
    await Promise.all([
      supabase
        .from('players')
        .select('id, name, avatar_url')
        .in('id', playerIds),
      supabase
        .from('player_signatures')
        .select('player_id, signatures')
        .in('player_id', playerIds),
    ]);

  if (playersError) throw playersError;
  if (signaturesError) throw signaturesError;

  const playerMap = new Map<string, Pick<PlayerRow, 'name' | 'avatar_url'>>();
  for (const player of players as Pick<PlayerRow, 'id' | 'name' | 'avatar_url'>[]) {
    playerMap.set(player.id, { name: player.name, avatar_url: player.avatar_url });
  }

  const signaturesMap = new Map<string, SignaturePokemon[]>();
  for (const row of signatures as Pick<PlayerSignaturesRow, 'player_id' | 'signatures'>[]) {
    const raw = row.signatures;
    signaturesMap.set(
      row.player_id,
      Array.isArray(raw) ? (raw as unknown as SignaturePokemon[]) : []
    );
  }

  return ratings.map((rating) => {
    const player = playerMap.get(rating.player_id);
    return {
      ...rating,
      player_name: player?.name ?? 'Unknown Player',
      player_avatar_url: player?.avatar_url ?? null,
      signatures: signaturesMap.get(rating.player_id) ?? [],
    };
  });
}

/**
 * Batch-fetch ratings for multiple players in a single query.
 * Used by standings endpoint to avoid N+1 per-player queries.
 */
export async function getPlayerRatingsBatch(
  playerIds: string[]
): Promise<Map<string, PlayerRating>> {
  if (playerIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('player_ratings')
    .select('*')
    .in('player_id', playerIds);

  if (error) throw error;

  const result = new Map<string, PlayerRating>();
  for (const row of data) {
    result.set(row.player_id, toPlayerRating(row));
  }
  return result;
}

export async function deleteRatingHistoryByMatch(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('rating_history')
    .delete()
    .eq('match_id', matchId);

  if (error) throw error;
}

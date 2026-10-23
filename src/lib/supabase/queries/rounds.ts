import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Tables } from '@/types/database';
import type { Round, RoundStatus } from '@/types/round';
import type { RoundByeSource } from '@/lib/tournament/byes';

type RoundRow = Tables<'rounds'>;

function toRound(row: RoundRow): Round {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    name: row.name,
    round_number: row.round_number,
    best_of: row.best_of,
    status: row.status as RoundStatus,
    pairings_generated: row.pairings_generated,
    deadline: row.deadline,
    bracket_side: (row.bracket_side as Round['bracket_side']) ?? null,
    bye_player_ids: row.bye_player_ids ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getRoundsByTournament(tournamentId: string): Promise<Round[]> {
  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('round_number');

  if (error) throw error;
  return data.map(toRound);
}

/** The columns of a round that standings read to score its byes. */
export interface ByeRound extends RoundByeSource {
  id: string;
  tournament_id: string;
}

function toByeRound(row: Pick<RoundRow, 'id' | 'tournament_id' | 'round_number' | 'bye_player_ids'>): ByeRound {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    round_number: row.round_number,
    bye_player_ids: row.bye_player_ids ?? [],
  };
}

/** The PostgREST `max_rows` ceiling (`supabase/config.toml`); a full page may have been cut, so the read pages. */
const BYE_ROUNDS_PAGE_SIZE = 1000;

/**
 * The bye columns of every round of the given tournaments, in ONE query per page (not one per tournament), grouped
 * by tournament in round order. A tournament without rounds maps to an empty list. Selects only what the standings
 * need, so the batch stays small for a season or a profile with many Swiss tournaments.
 */
export async function getByeRoundsByTournamentIds(
  tournamentIds: readonly string[],
): Promise<Map<string, ByeRound[]>> {
  const unique = [...new Set(tournamentIds)];
  const grouped = new Map<string, ByeRound[]>(unique.map((id) => [id, []]));
  if (unique.length === 0) return grouped;

  for (let from = 0; ; from += BYE_ROUNDS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('rounds')
      .select('id, tournament_id, round_number, bye_player_ids')
      .in('tournament_id', unique)
      .order('tournament_id')
      .order('round_number')
      .range(from, from + BYE_ROUNDS_PAGE_SIZE - 1);

    if (error) throw error;
    for (const row of data) grouped.get(row.tournament_id)?.push(toByeRound(row));
    if (data.length < BYE_ROUNDS_PAGE_SIZE) break;
  }
  return grouped;
}

/**
 * The bye columns of every round of a season's Swiss stages, in one query: the stage filter runs in the database
 * (an inner embed on the round's tournament), so the caller needs neither the stage list nor one read per stage.
 * Rounds come in stage, then round order.
 */
export async function getSwissByeRoundsBySeason(seasonId: string): Promise<ByeRound[]> {
  const rounds: ByeRound[] = [];
  for (let from = 0; ; from += BYE_ROUNDS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('rounds')
      .select('id, tournament_id, round_number, bye_player_ids, tournaments!inner ( season_id, bracket_type )')
      .eq('tournaments.season_id', seasonId)
      .eq('tournaments.bracket_type', 'swiss')
      .order('tournament_id')
      .order('round_number')
      .range(from, from + BYE_ROUNDS_PAGE_SIZE - 1);

    if (error) throw error;
    rounds.push(...data.map(toByeRound));
    if (data.length < BYE_ROUNDS_PAGE_SIZE) break;
  }
  return rounds;
}

export async function getRoundById(id: string): Promise<Round | null> {
  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toRound(data) : null;
}

/**
 * The first round of a phase whose groups mirror league groups is refused when the phase groups no longer match the
 * league groups (a move, placement or enrollment change committed after the mirror;
 * 20261019110000_league_groups_first_round_guard.sql). Nothing was written: generating again re-mirrors the phase.
 */
function isPhaseGroupsStale(error: { code?: string; message?: string }): boolean {
  return error.code === 'P0001' && error.message === 'PHASE_GROUPS_STALE';
}

export async function createRound(input: {
  tournament_id: string;
  name: string;
  round_number: number;
  best_of: number;
  bracket_side?: string | null;
  /** Players the pairing result gave a bye (Swiss / round robin); omitted for elimination. */
  bye_player_ids?: string[];
}): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .insert({
      tournament_id: input.tournament_id,
      name: input.name,
      round_number: input.round_number,
      best_of: input.best_of,
      bracket_side: input.bracket_side ?? null,
      // Written only when there is a bye, so a round without one inserts exactly what it did before.
      ...(input.bye_player_ids && input.bye_player_ids.length > 0
        ? { bye_player_ids: input.bye_player_ids }
        : {}),
      pairings_generated: true,
    })
    .select()
    .single();

  if (error) {
    if (isPhaseGroupsStale(error)) {
      console.error('[createRound] phase groups changed before the first round:', error);
      throw new UserFacingError('The league groups changed while the round was being generated; generate it again', {
        code: 'PHASE_GROUPS_STALE',
        status: 409,
      });
    }
    throw error;
  }
  return toRound(data);
}

export async function updateRoundStatus(
  id: string,
  status: RoundStatus
): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

export async function updateRoundBestOf(
  id: string,
  bestOf: number
): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .update({ best_of: bestOf })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

/**
 * Replace the byes stored on a round. Used when generation reuses an existing empty round (a retry after an
 * interrupted call) instead of inserting one, so the reused round carries this call's byes like a fresh insert does.
 * An UPDATE never fires the rounds insert guard (`trg_rounds_league_groups_guard` is BEFORE INSERT only).
 */
export async function updateRoundByePlayers(
  id: string,
  byePlayerIds: string[]
): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .update({ bye_player_ids: byePlayerIds })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

/** Set the round's deadline (an ISO 8601 instant), or clear it with `null`. */
export async function updateRoundDeadline(
  id: string,
  deadline: string | null
): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .update({ deadline })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

export async function deleteRound(id: string): Promise<void> {
  const { error } = await supabase
    .from('rounds')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

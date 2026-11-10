import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { isUniqueViolationOf } from '../unique-violation';
import type { Json, Tables } from '@/types/database';
import type { Round, RoundStatus } from '@/types/round';
import type { TournamentStatus } from '@/types/tournament';
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

/** The PostgREST `max_rows` ceiling (`supabase/config.toml`); a full page may have been cut, so the read pages. */
const BYE_ROUNDS_PAGE_SIZE = 1000;

/** The columns of a round that the format cron reads to find the `round_end` events a completion left unfired. */
export interface RoundStatusRow {
  id: string;
  tournament_id: string;
  round_number: number;
  status: RoundStatus;
}

/**
 * The id, number and status of every round of the given tournaments, paged (the PostgREST `max_rows` ceiling cuts a long
 * list), in tournament then round order. The format cron reads the phases of one league with it: one query for all of them,
 * not one per phase. A tournament without rounds contributes nothing.
 */
export async function listRoundStatusesByTournamentIds(tournamentIds: readonly string[]): Promise<RoundStatusRow[]> {
  const unique = [...new Set(tournamentIds)];
  const rounds: RoundStatusRow[] = [];
  if (unique.length === 0) return rounds;
  for (let from = 0; ; from += BYE_ROUNDS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('rounds')
      .select('id, tournament_id, round_number, status')
      .in('tournament_id', unique)
      .order('tournament_id')
      .order('round_number')
      // Neither key is unique, so `id` makes the page boundaries stable.
      .order('id')
      .range(from, from + BYE_ROUNDS_PAGE_SIZE - 1);

    if (error) throw error;
    for (const row of data) {
      rounds.push({ id: row.id, tournament_id: row.tournament_id, round_number: row.round_number, status: row.status as RoundStatus });
    }
    if (data.length < BYE_ROUNDS_PAGE_SIZE) break;
  }
  return rounds;
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
      // Neither key is unique, so `id` makes the page boundaries stable.
      .order('id')
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
      // Neither key is unique, so `id` makes the page boundaries stable.
      .order('id')
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

/**
 * UNIQUE (tournament_id, round_number) on `rounds`
 * (supabase/migrations/20261102122000_rounds_tournament_round_number_key.sql).
 */
export const ROUNDS_TOURNAMENT_ROUND_NUMBER_KEY = 'rounds_tournament_round_number_key';

/**
 * A concurrent (or repeated) generation wrote this round number first. The losing request wrote nothing
 * for the round, so the client reloads and, if the round is wrong, deletes it before generating again.
 * HTTP 409, code `rounds_round_already_written`.
 */
export class RoundAlreadyWrittenError extends UserFacingError {
  constructor(roundName: string) {
    super(`${roundName} already exists with its matches. Delete it to generate it again.`, {
      code: 'rounds_round_already_written',
      params: { round: roundName },
      status: 409,
    });
    this.name = 'RoundAlreadyWrittenError';
  }
}

/**
 * The refusals of a round write that leave this module as a typed error, shared by `createRound`,
 * `createRoundWithMatches` and `addMatchesToRound`; anything else is returned unchanged (the caller throws it).
 * `roundName` words the duplicate-number refusal.
 */
function mapRoundWriteError(error: { code?: string; message?: string }, roundName: string, tag: string): unknown {
  if (isUniqueViolationOf(error, ROUNDS_TOURNAMENT_ROUND_NUMBER_KEY)) {
    console.error(`[${tag}] round "${roundName}" of the tournament already exists (concurrent generation)`, error);
    return new RoundAlreadyWrittenError(roundName);
  }
  if (isPhaseGroupsStale(error)) {
    console.error(`[${tag}] phase groups changed before the first round:`, error);
    return new UserFacingError('The league groups changed while the round was being generated; generate it again', {
      code: 'PHASE_GROUPS_STALE',
      status: 409,
    });
  }
  if (isRoundWriteSignal(error, 'rounds_phase_completed')) {
    return new UserFacingError('This phase was completed while the round was being created, so no round was written. No more rounds can be generated.', {
      code: 'rounds_phase_completed',
      status: 409,
    });
  }
  // Only a write into an existing round (`addMatchesToRound`) raises these two, both decided under the round row lock.
  if (isRoundWriteSignal(error, 'rounds_round_completed')) {
    return new UserFacingError(`${roundName} is already completed, so no matches were written into it. Delete it to generate it again.`, {
      code: 'rounds_round_completed',
      params: { round: roundName },
      status: 409,
    });
  }
  if (isRoundWriteSignal(error, 'rounds_round_already_written')) {
    // A concurrent retry filled the round first; nothing of this call was written.
    return new RoundAlreadyWrittenError(roundName);
  }
  if (isRoundWriteSignal(error, 'tournament_not_found')) {
    return new UserFacingError('Tournament not found', { code: 'tournament_not_found', status: 404 });
  }
  // A retry that reuses an empty round another admin deleted meanwhile.
  if (isRoundWriteSignal(error, 'round_not_found')) {
    return new UserFacingError('Round not found', { code: 'round_not_found', status: 404 });
  }
  // The round was paired from a kit format that was replaced, switched or detached since: nothing was written.
  if (isRoundWriteSignal(error, 'format_context_stale')) {
    return new UserFacingError('The league format changed while the round was being generated, so no round was written. Generate it again.', {
      code: 'format_context_stale',
      status: 409,
    });
  }
  return error;
}

/** A domain refusal of `round_write` (`RAISE EXCEPTION '<code>' USING ERRCODE = 'P0001'`, message = code). */
function isRoundWriteSignal(error: { code?: string; message?: string }, signal: string): boolean {
  return error.code === 'P0001' && error.message === signal;
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

  if (error) throw mapRoundWriteError(error, input.name, 'createRound');
  return toRound(data);
}

/** One pairing of a round: the players of a `scheduled` match. */
export interface RoundMatchInput {
  player_1_id: string;
  player_2_id: string;
}

/**
 * Writes a round and its matches in ONE transaction under the phase row lock (`round_write`,
 * 20261106090000_format_challenges.sql), for the three round generators (generate-round, generate-all-rounds,
 * rounds/manual). A phase that completed first (a stage end that landed after the route's own guards) refuses the write
 * (409 `rounds_phase_completed`) and nothing is left behind, not even an empty round; a stage end that comes second waits
 * for the write and finds its unfinished matches, so the phase stays active. `createRound` plus `createMatchBatch` are two
 * requests and cannot give either guarantee. A concurrent generation of the same number answers
 * `RoundAlreadyWrittenError`, a first round of a mirrored phase whose groups changed 409 `PHASE_GROUPS_STALE`.
 *
 * The same transaction takes the league's locks first (the season advisory lock and the seasons row FOR KEY SHARE, so a
 * format attach, detach or league delete waits for the write and sees its round), moves an upcoming phase to `active` and
 * raises `current_round` (callers no longer write them in a second request), and, with `expected_revision` (the revision
 * of the kit phase the round was paired from), refuses a write planned from a format that was replaced since
 * (`format_context_stale`, 409 through the format runtime error mapping; nothing is written).
 */
export async function createRoundWithMatches(input: {
  tournament_id: string;
  name: string;
  round_number: number;
  best_of: number;
  /** Players the pairing result gave a bye (Swiss / round robin); omitted for elimination. */
  bye_player_ids?: string[];
  matches: readonly RoundMatchInput[];
  /** `season_formats.revision` of the kit phase the round was paired from; omitted for a phase the kit does not run. */
  expected_revision?: number;
}): Promise<Round> {
  const { data, error } = await supabase.rpc('round_write', {
    p_tournament_id: input.tournament_id,
    p_round_id: NULL_ARG as string,
    p_name: input.name,
    p_round_number: input.round_number,
    p_best_of: input.best_of,
    p_bye_player_ids: input.bye_player_ids ?? [],
    p_matches: roundMatchesJson(input.matches),
    ...(input.expected_revision === undefined ? {} : { p_expected_revision: input.expected_revision }),
  });
  if (error) throw mapRoundWriteError(error, input.name, 'createRoundWithMatches');
  return parseRoundWrite(data);
}

/** A round of a planned elimination bracket, with the id the app chose (its matches name it). */
export interface BracketRoundInput {
  id: string;
  name: string;
  round_number: number;
  best_of: number;
  bracket_side: string | null;
}

/** A match of a planned elimination bracket. */
export interface BracketMatchInput {
  id: string;
  round_id: string;
  player_1_id: string;
  player_2_id: string;
  bracket_side: string | null;
  bracket_pos: number | null;
}

function detailOf(error: { details?: string }): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(error.details ?? '');
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Writes (or, with `replace`, replaces) an elimination bracket in ONE transaction under the phase row lock
 * (`bracket_write`, 20261109210000_bracket_write.sql): the rounds, the matches, the enrollment freeze and the move to
 * `active` with `current_round`. The status must still be `expectedStatus` under the lock, so a completion (an admin's, or
 * the format's stage end) that committed first refuses the write with 409 `tournament_status_changed` and nothing is
 * written; one that comes second waits for the write. A first write refuses a phase that has rounds
 * (409 `bracket_already_generated`); a replace refuses while a match is played (409 `REGENERATE_PLAYED`).
 */
export async function writeBracket(input: {
  tournament_id: string;
  expected_status: TournamentStatus;
  replace: boolean;
  rounds: readonly BracketRoundInput[];
  matches: readonly BracketMatchInput[];
  current_round: number;
}): Promise<{ rounds: number; matches: number }> {
  const { data, error } = await supabase.rpc('bracket_write', {
    p_tournament_id: input.tournament_id,
    p_expected_status: input.expected_status,
    p_replace: input.replace,
    p_rounds: input.rounds as unknown as Json,
    p_matches: input.matches as unknown as Json,
    p_current_round: input.current_round,
  });
  if (error) {
    if (isRoundWriteSignal(error, 'tournament_status_changed')) {
      throw new UserFacingError('This tournament or phase changed its status in the meantime. Reload the page and try again.', {
        code: 'tournament_status_changed',
        params: { from: input.expected_status },
        status: 409,
      });
    }
    if (isRoundWriteSignal(error, 'bracket_already_generated')) {
      throw new UserFacingError('Bracket already generated', { code: 'bracket_already_generated', status: 409 });
    }
    if (isRoundWriteSignal(error, 'bracket_matches_played')) {
      const count = Number(detailOf(error).count ?? 0);
      throw new UserFacingError(`${count} played match(es) will be reset and all results rolled back.`, {
        code: 'REGENERATE_PLAYED',
        params: { count },
        status: 409,
      });
    }
    if (isRoundWriteSignal(error, 'tournament_not_found')) {
      throw new UserFacingError('Tournament not found', { code: 'tournament_not_found', status: 404 });
    }
    throw error;
  }
  const result = (data ?? {}) as { rounds?: number; matches?: number };
  return { rounds: result.rounds ?? input.rounds.length, matches: result.matches ?? input.matches.length };
}

/**
 * Writes the matches of a round that already exists (an interrupted call left it without matches) under the phase row
 * lock, like `createRoundWithMatches`: a completed phase refuses them (409 `rounds_phase_completed`) and the round is
 * left as it was. With `byePlayerIds` the round's stored byes are replaced in the same transaction (a retry brings the
 * reused round to this call's byes like a fresh insert), so a refused write changes neither the matches nor the byes;
 * omitted, they stay. The round's other columns are never touched. With neither matches nor byes nothing is written.
 * The round row is locked `FOR UPDATE` and re-read under the lock: a round that was completed meanwhile is refused
 * (409 `rounds_round_completed`), and so is one that has matches by now (409 `rounds_round_already_written`, a concurrent
 * retry of the same round wrote first), each leaving the round and its byes as they were. Of two concurrent retries
 * exactly one writes.
 */
export async function addMatchesToRound(
  round: Pick<Round, 'id' | 'name' | 'tournament_id'> & {
    /** `season_formats.revision` of the kit phase the matches were paired from (see `createRoundWithMatches`). */
    expected_revision?: number;
  },
  matches: readonly RoundMatchInput[],
  byePlayerIds?: readonly string[],
): Promise<void> {
  if (matches.length === 0 && byePlayerIds === undefined) return;
  const { data, error } = await supabase.rpc('round_write', {
    p_tournament_id: round.tournament_id,
    p_round_id: round.id,
    p_name: NULL_ARG as string,
    p_round_number: NULL_ARG as number,
    p_best_of: NULL_ARG as number,
    p_bye_player_ids: byePlayerIds === undefined ? (NULL_ARG as string[]) : [...byePlayerIds],
    p_matches: roundMatchesJson(matches),
    ...(round.expected_revision === undefined ? {} : { p_expected_revision: round.expected_revision }),
  });
  if (error) throw mapRoundWriteError(error, round.name, 'addMatchesToRound');
  parseRoundWrite(data);
}

/** The generated RPC types mark every parameter non-null although `round_write` accepts NULL for these. */
const NULL_ARG: unknown = null;

function roundMatchesJson(matches: readonly RoundMatchInput[]): Json {
  return matches.map((match) => ({ player_1_id: match.player_1_id, player_2_id: match.player_2_id }));
}

function parseRoundWrite(data: unknown): Round {
  const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as { round?: unknown }) : null;
  if (body === null || typeof body.round !== 'object' || body.round === null) {
    throw new Error(`round_write returned an unexpected result: ${JSON.stringify(data)}`);
  }
  return toRound(body.round as RoundRow);
}

/**
 * Moves a round's status as a compare-and-set on `from`, the status the writer read (roundMachine,
 * src/lib/tournament/round-state.ts; the writer checks the move). A round that moved on in between is not overwritten:
 * nothing is written and a 409 `round_status_changed` is thrown. Completion goes through `completeRound`.
 */
export async function updateRoundStatus(
  id: string,
  status: RoundStatus,
  from: RoundStatus
): Promise<Round> {
  const { data, error } = await supabase
    .from('rounds')
    .update({ status })
    .eq('id', id)
    .eq('status', from)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new UserFacingError('This round changed its status in the meantime. Reload the page and try again.', {
      code: 'round_status_changed',
      params: { from },
      status: 409,
    });
  }
  return toRound(data);
}

/** What `completeRound` found; see `round_complete` in 20261106090000_format_challenges.sql. */
export type CompleteRoundResult =
  /** This call moved the round. `unfinished` is the number of matches it left open, counted under the lock (> 0 only when forced). */
  | { outcome: 'completed'; round: Round; unfinished: number }
  /** Refused: `unfinished` matches are not completed and the call was not forced. The round is untouched. */
  | { outcome: 'unfinished'; unfinished: number }
  /** Nothing to do: the round was already completed (a repeat, or another call won) or is gone. */
  | { outcome: 'unchanged' };

/**
 * Atomic claim of the transition to `completed`, decided under a lock on the round row (`round_complete`): the
 * unfinished matches are counted after the lock is held, so a challenge accepted a moment before is counted, and one
 * accepted a moment after finds the round completed (it locks the round before it inserts its match). Without `force`
 * unfinished matches refuse the completion; with it they are reported in `unfinished` for the audit entry. A caller that
 * acts on a completion (audit, events, recap) acts only on `outcome: 'completed'`, which exactly one of overlapping
 * calls gets.
 */
export async function completeRound(id: string, options: { force: boolean }): Promise<CompleteRoundResult> {
  const { data, error } = await supabase.rpc('round_complete', { p_round_id: id, p_force: options.force });
  if (error) throw error;
  const result = parseRoundComplete(data);
  if (result === null) throw new Error(`round_complete returned an unexpected result: ${JSON.stringify(data)}`);
  return result;
}

function parseRoundComplete(data: unknown): CompleteRoundResult | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const body = data as { outcome?: unknown; round?: unknown; unfinished?: unknown };
  const count = typeof body.unfinished === 'number' ? body.unfinished : 0;
  switch (body.outcome) {
    case 'completed':
      if (typeof body.round !== 'object' || body.round === null) return null;
      return { outcome: 'completed', round: toRound(body.round as RoundRow), unfinished: count };
    case 'unfinished':
      return { outcome: 'unfinished', unfinished: count };
    case 'already_completed':
    case 'not_found':
      return { outcome: 'unchanged' };
    default:
      return null;
  }
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

import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import tournamentErrors from '@/i18n/messages/errors/tournaments/en';
import { isUniqueViolationOf } from '../unique-violation';
import type { Json, Tables } from '@/types/database';
import type { RoundStatus } from '@/types/round';
import type { PhaseRound, PhaseStatus } from '@/types/league-phase';
import { phaseRoundMachine } from '@/lib/league-phase/phase-round-state';
import type { PhaseRoundActor } from '@/lib/league-phase/phase-round-state';
import { readBoundedPages } from '../read-bounded-pages';
import type { RoundByeSource } from '@/lib/tournament/byes';

type RoundRow = Tables<'phase_rounds'>;

function toRound(row: RoundRow): PhaseRound {
  return {
    id: row.id,
    phase_id: row.phase_id,
    name: row.name,
    round_number: row.round_number,
    best_of: row.best_of,
    status: row.status as RoundStatus,
    pairings_generated: row.pairings_generated,
    deadline: row.deadline,
    bracket_side: (row.bracket_side as PhaseRound['bracket_side']) ?? null,
    bye_player_ids: row.bye_player_ids ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getRoundsByPhase(phaseId: string): Promise<PhaseRound[]> {
  const { rows } = await readBoundedPages((from, to) => supabase.from('phase_rounds').select('*').eq('phase_id', phaseId).order('round_number').order('id').range(from, to), { label: 'getRoundsByPhase' });
  return rows.map(toRound);
}

export interface RoundStatusRow {
  id: string;
  phase_id: string;
  round_number: number;
  status: RoundStatus;
}

export async function listRoundStatusesByPhaseIds(phaseIds: readonly string[]): Promise<RoundStatusRow[]> {
  const unique = [...new Set(phaseIds)];
  const result: RoundStatusRow[] = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    const { rows } = await readBoundedPages((from, to) => supabase.from('phase_rounds')
      .select('id, phase_id, round_number, status').in('phase_id', unique.slice(offset, offset + 50))
      .order('phase_id').order('round_number').order('id').range(from, to), { label: 'listRoundStatusesByPhaseIds' });
    result.push(...rows);
  }
  return result;
}

export interface ByeRound extends RoundByeSource {
  id: string;
  phase_id: string;
}

function toByeRound(row: Pick<RoundRow, 'id' | 'phase_id' | 'round_number' | 'bye_player_ids'>): ByeRound {
  return {
    id: row.id,
    phase_id: row.phase_id,
    round_number: row.round_number,
    bye_player_ids: row.bye_player_ids ?? [],
  };
}

export async function getByeRoundsByPhaseIds(phaseIds: readonly string[]): Promise<Map<string, ByeRound[]>> {
  const unique = [...new Set(phaseIds)];
  const grouped = new Map<string, ByeRound[]>(unique.map(id => [id, []]));
  for (let offset = 0; offset < unique.length; offset += 50) {
    const { rows } = await readBoundedPages((from, to) => supabase.from('phase_rounds')
      .select('id, phase_id, round_number, bye_player_ids').in('phase_id', unique.slice(offset, offset + 50))
      .order('phase_id').order('round_number').order('id').range(from, to), { label: 'getByeRoundsByPhaseIds' });
    for (const row of rows) grouped.get(row.phase_id)?.push(toByeRound(row));
  }
  return grouped;
}

export async function getSwissByeRoundsBySeason(seasonId: string): Promise<ByeRound[]> {
  const { rows } = await readBoundedPages((from, to) => supabase.from('phase_rounds')
    .select('id, phase_id, round_number, bye_player_ids, league_phases!inner ( season_id, bracket_type )')
    .eq('league_phases.season_id', seasonId).eq('league_phases.bracket_type', 'swiss')
    .order('phase_id').order('round_number').order('id').range(from, to), { label: 'getSwissByeRoundsBySeason' });
  return rows.map(toByeRound);
}

export async function getPhaseRoundById(id: string, phaseId?: string): Promise<PhaseRound | null> {
  let query = supabase
    .from('phase_rounds')
    .select('*')
    .eq('id', id);
  if (phaseId !== undefined) query = query.eq('phase_id', phaseId);
  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return data ? toRound(data) : null;
}

function isPhaseGroupsStale(error: { code?: string; message?: string }): boolean {
  return error.code === 'P0001' && error.message === 'PHASE_GROUPS_STALE';
}

function phaseGroupsStaleError(error: unknown) {
  const refusal = new UserFacingError('The league groups changed while the round was being generated; generate it again', {
    code: 'PHASE_GROUPS_STALE',
    status: 409,
  });
  return Object.assign(refusal, { cause: error });
}

export const PHASE_ROUNDS_PHASE_ROUND_NUMBER_KEY = 'phase_rounds_phase_round_number_key';

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

function mapRoundWriteError(error: { code?: string; message?: string }, roundName: string, tag: string): unknown {
  if (isUniqueViolationOf(error, PHASE_ROUNDS_PHASE_ROUND_NUMBER_KEY)) {
    console.error(`[${tag}] round "${roundName}" of the tournament already exists (concurrent generation)`, error);
    return new RoundAlreadyWrittenError(roundName);
  }
  if (isPhaseGroupsStale(error)) {
    console.error(`[${tag}] phase groups changed before the first round:`, error);
    return phaseGroupsStaleError(error);
  }
  if (isRoundWriteSignal(error, 'rounds_phase_completed')) {
    return new UserFacingError('This phase was completed while the round was being created, so no round was written. No more rounds can be generated.', {
      code: 'rounds_phase_completed',
      status: 409,
    });
  }

  if (isRoundWriteSignal(error, 'rounds_round_completed')) {
    return new UserFacingError(`${roundName} is already completed, so no matches were written into it. Delete it to generate it again.`, {
      code: 'rounds_round_completed',
      params: { round: roundName },
      status: 409,
    });
  }
  if (isRoundWriteSignal(error, 'rounds_round_already_written')) {

    return new RoundAlreadyWrittenError(roundName);
  }
  if (isRoundWriteSignal(error, 'tournament_not_found')) {
    return new UserFacingError('Tournament not found', { code: 'tournament_not_found', status: 404 });
  }

  if (isRoundWriteSignal(error, 'round_not_found')) {
    return new UserFacingError('Round not found', { code: 'round_not_found', status: 404 });
  }

  if (isRoundWriteSignal(error, 'format_context_stale')) {
    return new UserFacingError('The league format changed while the round was being generated, so no round was written. Generate it again.', {
      code: 'format_context_stale',
      status: 409,
    });
  }
  return error;
}

function isRoundWriteSignal(error: { code?: string; message?: string }, signal: string): boolean {
  return error.code === 'P0001' && error.message === signal;
}

export async function createPhaseRound(input: {
  phase_id: string; name: string; round_number: number; best_of: number;
  bracket_side?: string | null; bye_player_ids?: string[];
}): Promise<PhaseRound> {
  const { data, error } = await supabase.rpc('phase_round_write', {
    p_phase_id: input.phase_id, p_round_id: NULL_ARG as string,
    p_name: input.name, p_round_number: input.round_number, p_best_of: input.best_of,
    p_bye_player_ids: input.bye_player_ids ?? [], p_matches: [],
    p_bracket_side: input.bracket_side ?? NULL_ARG as string,
    p_start_phase: false,
  });
  if (error) throw mapRoundWriteError(error, input.name, 'createPhaseRound');
  return parseRoundWrite(data);
}

export interface RoundMatchInput {
  player_1_id: string;
  player_2_id: string;
}

export async function createPhaseRoundWithMatches(input: {
  phase_id: string;
  name: string;
  round_number: number;
  best_of: number;

  bye_player_ids?: string[];
  matches: readonly RoundMatchInput[];

  expected_revision?: number;
}): Promise<PhaseRound> {
  const { data, error } = await supabase.rpc('phase_round_write', {
    p_phase_id: input.phase_id,
    p_round_id: NULL_ARG as string,
    p_name: input.name,
    p_round_number: input.round_number,
    p_best_of: input.best_of,
    p_bye_player_ids: input.bye_player_ids ?? [],
    p_matches: roundMatchesJson(input.matches),
    ...(input.expected_revision === undefined ? {} : { p_expected_revision: input.expected_revision }),
  });
  if (error) throw mapRoundWriteError(error, input.name, 'createPhaseRoundWithMatches');
  return parseRoundWrite(data);
}

export interface BracketRoundInput {
  id: string;
  name: string;
  round_number: number;
  best_of: number;
  bracket_side: string | null;
}

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

export interface PhaseBracketInputGuard {
  updatedAt: string;
  seeds: { player_id: string; seed: number | null; starting_bracket: 'winners' | 'losers' }[];
  formatRevision?: number;
}

export async function writePhaseBracket(input: {
  phase_id: string;
  expected_status: PhaseStatus;
  replace: boolean;
  rounds: readonly BracketRoundInput[];
  matches: readonly BracketMatchInput[];
  current_round: number;
  guard?: PhaseBracketInputGuard;
}): Promise<{ rounds: number; matches: number }> {
  const args = {
    p_phase_id: input.phase_id,
    p_expected_status: input.expected_status,
    p_replace: input.replace,
    p_rounds: input.rounds as unknown as Json,
    p_matches: input.matches as unknown as Json,
    p_current_round: input.current_round,
  };
  const { data, error } = input.guard
    ? await supabase.rpc('phase_bracket_write_guarded', {
      ...args, p_expected_updated_at: input.guard.updatedAt, p_expected_seeds: input.guard.seeds,
      ...(input.guard.formatRevision !== undefined ? { p_expected_revision: input.guard.formatRevision } : {}),
    })
    : await supabase.rpc('phase_bracket_write', args);
  if (error) {
    if (isPhaseGroupsStale(error)) {
      throw phaseGroupsStaleError(error);
    }
    if (isRoundWriteSignal(error, 'tournament_status_changed')) {
      throw new UserFacingError('This tournament or phase changed its status in the meantime. Reload the page and try again.', {
        code: 'tournament_status_changed',
        params: { from: input.expected_status },
        status: 409,
      });
    }
    if (isRoundWriteSignal(error, 'phase_bracket_inputs_changed')) {
      throw new UserFacingError(tournamentErrors.phase_bracket_inputs_changed, { code: 'phase_bracket_inputs_changed', status: 409 });
    }
    if (isRoundWriteSignal(error, 'format_context_stale')) {
      throw new UserFacingError('The league format changed while the round was being generated, so no round was written. Generate it again.', {
        code: 'format_context_stale', status: 409,
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

export async function addMatchesToPhaseRound(
  round: Pick<PhaseRound, 'id' | 'name' | 'phase_id'> & {

    expected_revision?: number;
  },
  matches: readonly RoundMatchInput[],
  byePlayerIds?: readonly string[],
): Promise<void> {
  if (matches.length === 0 && byePlayerIds === undefined) return;
  const { data, error } = await supabase.rpc('phase_round_write', {
    p_phase_id: round.phase_id,
    p_round_id: round.id,
    p_name: NULL_ARG as string,
    p_round_number: NULL_ARG as number,
    p_best_of: NULL_ARG as number,
    p_bye_player_ids: byePlayerIds === undefined ? (NULL_ARG as string[]) : [...byePlayerIds],
    p_matches: roundMatchesJson(matches),
    ...(round.expected_revision === undefined ? {} : { p_expected_revision: round.expected_revision }),
  });
  if (error) throw mapRoundWriteError(error, round.name, 'addMatchesToPhaseRound');
  parseRoundWrite(data);
}

const NULL_ARG: unknown = null;

function roundMatchesJson(matches: readonly RoundMatchInput[]): Json {
  return matches.map((match) => ({ player_1_id: match.player_1_id, player_2_id: match.player_2_id }));
}

function parseRoundWrite(data: unknown): PhaseRound {
  const body = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as { round?: unknown }) : null;
  if (body === null || typeof body.round !== 'object' || body.round === null) {
    throw new Error(`round_write returned an unexpected result: ${JSON.stringify(data)}`);
  }
  return toRound(body.round as RoundRow);
}

export async function updatePhaseRoundStatus(
  id: string,
  status: RoundStatus,
  from: RoundStatus,
  actor: PhaseRoundActor = 'admin',
): Promise<PhaseRound> {
  if (status !== from) phaseRoundMachine.assertTransition(from, status, actor);
  const { data, error } = await supabase
    .from('phase_rounds')
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

export type CompleteRoundResult =

  | { outcome: 'completed'; round: PhaseRound; unfinished: number }

  | { outcome: 'unfinished'; unfinished: number }

  | { outcome: 'unchanged' };

export async function completePhaseRound(id: string, options: { force: boolean }): Promise<CompleteRoundResult> {
  const { data, error } = await supabase.rpc('phase_round_complete', { p_round_id: id, p_force: options.force });
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

export async function updatePhaseRoundBestOf(
  id: string,
  bestOf: number,
): Promise<PhaseRound> {
  const { data, error } = await supabase
    .from('phase_rounds')
    .update({ best_of: bestOf })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new UserFacingError('This round changed its status in the meantime. Reload the page and try again.', {
      code: 'round_status_changed',
      params: { from: 'pending' },
      status: 409,
    });
  }
  return toRound(data);
}

export async function updatePhaseRoundDeadline(
  id: string,
  deadline: string | null
): Promise<PhaseRound> {
  const { data, error } = await supabase
    .from('phase_rounds')
    .update({ deadline })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRound(data);
}

export async function deletePhaseRound(id: string): Promise<void> {
  const { error } = await supabase.rpc('phase_round_delete', { p_round_id: id });
  if (error) throw error;
}

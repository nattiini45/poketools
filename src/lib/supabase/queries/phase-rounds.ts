import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import tournamentErrors from '@/i18n/messages/errors/tournaments/en';
import seasonErrors from '@/i18n/messages/errors/seasons/en';
import { isUniqueViolationOf } from '../unique-violation';
import type { Json, Tables } from '@/types/database';
import type { RoundStatus } from '@/types/round';
import type { Phase, PhaseRound, PhaseStatus } from '@/types/league-phase';
import type { Season } from '@/types/season';
import { phaseRoundMachine } from '@/lib/league-phase/phase-round-state';
import { phaseMachine } from '@/lib/league-phase/phase-state';
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

export interface PhaseRoundGroupLayout {
  name: string;
  group_number: number;
  season_group_id: string | null;
  members: { player_id: string; seed: number }[];
}

interface GeneratedPhaseScope {
  phase_id: string;
  season_id: string;
  phase_status: PhaseStatus;
  expected_updated_at: string;
  expected_revision?: number;
  inputs: {
    phase: Pick<Phase, 'status' | 'current_round' | 'bracket_type' | 'stage_spec' | 'name' | 'bo_overrides' | 'best_of_default'>;
    season: Pick<Season, 'start_date' | 'format_type'>;
    participants: { id: string; name: string; seed: number | null }[];
    rounds: Pick<PhaseRound, 'id' | 'round_number' | 'status' | 'bye_player_ids' | 'pairings_generated' | 'bracket_side'>[];
    matches: Pick<Tables<'phase_matches'>, 'id' | 'round_id' | 'status' | 'winner_id' | 'player_1_id' | 'player_2_id'>[];
    groups: (PhaseRoundGroupLayout & { id: string })[];
    league_groups: { id: string; name: string; sort_order: number; player_ids: string[] }[];
  };
  replacement_groups?: PhaseRoundGroupLayout[];
}

interface GeneratedPhaseRoundPlan {
  round_id: string | null;
  name: string;
  round_number: number;
  best_of: number;
  bye_player_ids: string[];
  matches: readonly RoundMatchInput[];
  deadline: string | null;
}

function generatedScopeArgs(input: GeneratedPhaseScope) {
  if (input.phase_status === 'upcoming') phaseMachine.assertTransition('upcoming', 'active', 'admin');
  return {
    p_phase_id: input.phase_id, p_season_id: input.season_id,
    p_expected_updated_at: input.expected_updated_at,
    p_inputs: input.inputs as unknown as Json,
    ...(input.replacement_groups === undefined ? {} : { p_replacement_groups: input.replacement_groups as unknown as Json }),
    ...(input.expected_revision === undefined ? {} : { p_expected_revision: input.expected_revision }),
  };
}

export async function writeGeneratedPhaseRound(input: GeneratedPhaseScope & GeneratedPhaseRoundPlan): Promise<PhaseRound> {
  const { data, error } = await supabase.rpc('phase_round_generate', {
    ...generatedScopeArgs(input),
    p_round_id: (input.round_id ?? NULL_ARG) as string,
    p_name: input.name,
    p_round_number: input.round_number,
    p_best_of: input.best_of,
    p_bye_player_ids: input.bye_player_ids,
    p_matches: roundMatchesJson(input.matches),
    p_deadline: (input.deadline ?? NULL_ARG) as string,
  });
  if (error) throw mapGeneratedRoundError(error, input.name, 'writeGeneratedPhaseRound');
  return parseRoundWrite(data);
}

export async function writeGeneratedPhaseRoundBatch(input: GeneratedPhaseScope, rounds: GeneratedPhaseRoundPlan[]): Promise<PhaseRound[]> {
  if (rounds.length === 0) throw new Error('No phase rounds to write');
  const { data, error } = await supabase.rpc('phase_round_generate_batch', {
    ...generatedScopeArgs(input),
    p_rounds: rounds.map(({ round_id, name, round_number, best_of, bye_player_ids, matches, deadline }) => ({
      round_id, name, round_number, best_of, bye_player_ids, matches: roundMatchesJson(matches), deadline,
    })),
  });
  if (error) throw mapGeneratedRoundError(error, rounds[0].name, 'writeGeneratedPhaseRoundBatch');
  if (!Array.isArray(data) || data.length !== rounds.length) throw new Error('Unexpected phase round batch result');
  return data.map(parseRoundWrite);
}

function mapGeneratedRoundError(error: { code?: string; message?: string }, name: string, tag: string): unknown {
  if (error.code === '55P03') {
    return Object.assign(new UserFacingError('Another operation is changing this phase. No round was written. Try again.', {
      code: 'round_status_changed', status: 409,
    }), { cause: error });
  }
  if (isRoundWriteSignal(error, 'phase_round_inputs_changed')) {
    return Object.assign(new UserFacingError('The phase or its pairing history changed while this round was being generated. No round was written. Generate it again.', {
      code: 'round_status_changed', status: 409,
    }), { cause: error });
  }
  return mapRoundWriteError(error, name, tag);
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

export async function writePhaseBracketRepair(input: {
  seasonId: string;
  phaseId: string;
  updatedAt: string;
  seeds: { player_id: string; name: string; seed: number | null; starting_bracket: string }[];
  rounds: Pick<PhaseRound, 'id' | 'round_number' | 'bracket_side' | 'status'>[];
  matches: { id: string; updated_at: string; has_games: boolean }[];
  slots: (Omit<BracketMatchInput, 'id'> & { match_id: string | null })[];
}): Promise<{ slots_materialized: number; slots_updated: number }> {
  const { data, error } = await supabase.rpc('phase_bracket_repair', {
    p_season_id: input.seasonId,
    p_phase_id: input.phaseId,
    p_expected_updated_at: input.updatedAt,
    p_expected_seeds: input.seeds,
    p_expected_rounds: input.rounds,
    p_expected_matches: input.matches,
    p_slots: input.slots,
  });
  if (error) {
    if (error.code === '55P03' || isRoundWriteSignal(error, 'phase_bracket_repair_changed')) {
      throw Object.assign(new UserFacingError(tournamentErrors.phase_bracket_repair_changed, {
        code: 'phase_bracket_repair_changed', status: 409,
      }), { cause: error });
    }
    if (isRoundWriteSignal(error, 'phase_bracket_repair_linked')) {
      throw Object.assign(new UserFacingError(tournamentErrors.phase_bracket_repair_linked, {
        code: 'phase_bracket_repair_linked', status: 409,
      }), { cause: error });
    }
    if (isRoundWriteSignal(error, 'PHASE_NOT_FOUND')) {
      throw new UserFacingError('Phase not found', { code: 'PHASE_NOT_FOUND', status: 404 });
    }
    throw error;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)
    && typeof data.slots_materialized === 'number' && typeof data.slots_updated === 'number') {
    return { slots_materialized: data.slots_materialized, slots_updated: data.slots_updated };
  }
  throw new Error('Unexpected phase bracket repair result');
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

const adminRoundDeleteRefusals = {
  season_not_found: [seasonErrors.season_not_found, 404],
  PHASE_NOT_FOUND: [seasonErrors.PHASE_NOT_FOUND, 404],
  round_not_found: [tournamentErrors.round_not_found, 404],
  phase_round_delete_confirm_required: [tournamentErrors.phase_round_delete_confirm_required, 400],
  STRUCTURE_ELIM_ROUND_DELETE: [tournamentErrors.STRUCTURE_ELIM_ROUND_DELETE, 400],
  phase_round_delete_locked: [tournamentErrors.phase_round_delete_locked, 409],
  phase_round_delete_dependent: [tournamentErrors.phase_round_delete_dependent, 409],
  phase_round_delete_results: [tournamentErrors.phase_round_delete_results, 409],
  phase_round_delete_teams: [tournamentErrors.phase_round_delete_teams, 409],
  phase_round_delete_linked: [tournamentErrors.phase_round_delete_linked, 409],
  phase_round_delete_changed: [tournamentErrors.phase_round_delete_changed, 409],
} as const;

export async function deleteAdminPhaseRound(
  seasonId: string, phaseId: string, roundId: string, expectedUpdatedAt: string, confirm: true,
) {
  const { data, error } = await supabase.rpc('phase_admin_round_delete', {
    p_season_id: seasonId, p_phase_id: phaseId, p_round_id: roundId,
    p_expected_updated_at: expectedUpdatedAt, p_confirm: confirm,
  });
  if (error) {
    const signal = error.code === 'P0001' ? error.message
      : error.code === '55P03' || error.code === '40P01' ? 'phase_round_delete_changed'
        : null;
    if (signal && Object.hasOwn(adminRoundDeleteRefusals, signal)) {
      const code = signal as keyof typeof adminRoundDeleteRefusals;
      const [message, status] = adminRoundDeleteRefusals[code];
      throw Object.assign(new UserFacingError(message, { code, status }), { cause: error });
    }
    throw error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.name !== 'string' || typeof data.round_number !== 'number' || typeof data.matches !== 'number') {
    throw new Error('Native round deletion returned an invalid result');
  }
  return { name: data.name, round_number: data.round_number, matches: data.matches };
}

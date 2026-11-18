import { supabase } from '../client';
import type { Tables, TablesInsert, Json } from '@/types/database';
import type { PlayerStatus } from '@/types/player';
import { readBoundedPages } from '../read-bounded-pages';
import type { Phase, PhaseWithDetails, PhaseFormData, PhaseStatus, PhaseParticipant } from '@/types/league-phase';
import { phaseMachine } from '@/lib/league-phase/phase-state';
import { parseAdvancementRule, parseBoOverrides, parseEnrollmentSource } from '@/types/tournament';
import type { SeasonFormatType } from '@/types/season';
import type { EnrollmentSource } from '@/types/season';
import { SeedConflictError } from '@/lib/tournament/seed-errors';
import { UserFacingError } from '@/lib/api/user-facing-error';

type PhaseRow = Tables<'league_phases'>;

function toPhase(row: PhaseRow): Phase {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    season_id: row.season_id,
    bracket_type: row.bracket_type,
    ruleset_id: row.ruleset_id,
    best_of_default: row.best_of_default,
    bo_overrides: parseBoOverrides(row.bo_overrides),
    is_doubles: row.is_doubles,
    team_visibility: row.team_visibility,
    status: row.status as PhaseStatus,
    current_round: row.current_round,
    stage_order: row.stage_order,
    advancement_rule: parseAdvancementRule(row.advancement_rule),
    enrollment_source: parseEnrollmentSource(row.enrollment_source),
    archived: row.archived,
    legacy: row.legacy,
    bracket_reset_enabled: row.bracket_reset_enabled,
    third_place_enabled: row.third_place_enabled,
    format_stage_key: row.format_stage_key,
    format_group: row.format_group,
    stage_spec: row.stage_spec,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function embeddedCount(embed: { count: number }[] | null | undefined): number {
  return embed?.[0]?.count ?? 0;
}

export async function createPhase(input: PhaseFormData): Promise<Phase> {
  const insertData: TablesInsert<'league_phases'> = {
    name: input.name,
    description: input.description ?? '',
    season_id: input.season_id,
    bracket_type: input.bracket_type,
    ruleset_id: input.ruleset_id,
    best_of_default: input.best_of_default,
    bo_overrides: (input.bo_overrides as Json) ?? {},
    is_doubles: input.is_doubles,
    team_visibility: input.team_visibility,
    stage_order: input.stage_order ?? 0,
    advancement_rule: (input.advancement_rule as Json) ?? null,
    bracket_reset_enabled: input.bracket_reset_enabled ?? true,
    third_place_enabled: input.third_place_enabled ?? false,
    format_stage_key: input.format_stage_key ?? null,
    format_group: input.format_group ?? 0,
    stage_spec: input.stage_spec ?? null,
  };

  const { data, error } = await supabase
    .from('league_phases')
    .insert(insertData)
    .select()
    .single();

  if (error) throw error;
  return toPhase(data);
}

export async function getPhasesBySeasonId(seasonId: string): Promise<PhaseWithDetails[]> {
  return (await getPhasesBySeasonIds([seasonId])).get(seasonId) ?? [];
}

const STAGE_BATCH_IDS = 50;

export async function getPhasesBySeasonIds(seasonIds: string[]): Promise<Map<string, PhaseWithDetails[]>> {
  const unique = [...new Set(seasonIds)];
  const grouped = new Map<string, PhaseWithDetails[]>(unique.map((id) => [id, []]));

  for (let i = 0; i < unique.length; i += STAGE_BATCH_IDS) {
    const chunk = unique.slice(i, i + STAGE_BATCH_IDS);
    const { rows } = await readBoundedPages(
      (from, to) => supabase
        .from('league_phases')
        .select(`
          *,
          rulesets:ruleset_definition_versions ( name:name_text ),
          seasons ( name, format_type ),
          phase_participants ( count )
        `)
        .in('season_id', chunk)
        .order('season_id')
        .order('stage_order')
        .order('created_at')
        .order('id')
        .range(from, to),
      { label: 'getPhasesBySeasonIds' },
    );
    for (const row of rows) {
      const stage: PhaseWithDetails = {
        ...toPhase(row),
        season_format_type: (row.seasons as { format_type: SeasonFormatType } | null)?.format_type ?? null,
        ruleset_name: (row.rulesets as { name: string } | null)?.name ?? '',
        season_name: (row.seasons as { name: string } | null)?.name ?? '',
        participant_count: embeddedCount(row.phase_participants),
      };
      grouped.get(stage.season_id)?.push(stage);
    }
  }

  return grouped;
}

export interface PhaseStatusGuard {
  from: PhaseStatus;
}

export async function updatePhase(
  id: string,
  input: Partial<PhaseFormData> & {
    status?: PhaseStatus;
    current_round?: number;
    archived?: boolean;
    enrollment_source?: EnrollmentSource | null;
  },
  guard?: PhaseStatusGuard
): Promise<Phase> {
  if (input.status !== undefined && !guard) throw new Error('A phase status update requires its expected status');
  if (input.current_round !== undefined && !guard) throw new Error('A phase round counter update requires its expected status');
  if (input.status !== undefined && guard && input.status !== guard.from) phaseMachine.assertTransition(guard.from, input.status, 'admin');
  const updates: Record<string, unknown> = {};
  if (input.format_stage_key !== undefined) updates.format_stage_key = input.format_stage_key;
  if (input.format_group !== undefined) updates.format_group = input.format_group;
  if (input.stage_spec !== undefined) updates.stage_spec = input.stage_spec;
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.season_id !== undefined) updates.season_id = input.season_id;
  if (input.bracket_type !== undefined) updates.bracket_type = input.bracket_type;
  if (input.ruleset_id !== undefined) updates.ruleset_id = input.ruleset_id;
  if (input.best_of_default !== undefined) updates.best_of_default = input.best_of_default;
  if (input.bo_overrides !== undefined) updates.bo_overrides = input.bo_overrides;
  if (input.is_doubles !== undefined) updates.is_doubles = input.is_doubles;
  if (input.team_visibility !== undefined) updates.team_visibility = input.team_visibility;
  if (input.stage_order !== undefined) updates.stage_order = input.stage_order;
  if (input.advancement_rule !== undefined) {
    updates.advancement_rule = input.advancement_rule as Json;
  }
  if (input.status !== undefined) updates.status = input.status;
  if (input.current_round !== undefined) updates.current_round = input.current_round;
  if (input.archived !== undefined) updates.archived = input.archived;
  if (input.bracket_reset_enabled !== undefined) {
    updates.bracket_reset_enabled = input.bracket_reset_enabled;
  }
  if (input.third_place_enabled !== undefined) {
    updates.third_place_enabled = input.third_place_enabled;
  }
  if (input.enrollment_source !== undefined) {
    updates.enrollment_source = input.enrollment_source as Json;
  }

  if (guard) {
    const { data, error } = await supabase
      .from('league_phases')
      .update(updates)
      .eq('id', id)
      .eq('status', guard.from)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new UserFacingError('This tournament or phase changed its status in the meantime. Reload the page and try again.', {
        code: 'tournament_status_changed',
        params: { from: guard.from },
        status: 409,
      });
    }
    return toPhase(data);
  }

  const { data, error } = await supabase
    .from('league_phases')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toPhase(data);
}

export type CompletePhaseResult =
  | { outcome: 'completed'; phase: Phase }
  | { outcome: 'not_active' }
  | { outcome: 'unsettled'; unknownUnfinished: number };

export async function completePhaseIfActive(
  id: string,
  knownUnfinished: readonly string[],
): Promise<CompletePhaseResult> {
  const { data, error } = await supabase.rpc('league_phase_complete_at_stage_end', {
    p_phase_id: id,
    p_known_unfinished: [...knownUnfinished],
  });
  if (error) throw error;
  const result = parseNativePhaseComplete(data);
  if (result === null) throw new Error(`phase_complete_at_stage_end returned an unexpected result: ${JSON.stringify(data)}`);
  return result;
}

function parseNativePhaseComplete(data: unknown): CompletePhaseResult | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const body = data as { outcome?: unknown; phase?: unknown; unknown_unfinished?: unknown };
  switch (body.outcome) {
    case 'completed':
      if (typeof body.phase !== 'object' || body.phase === null) return null;
      return { outcome: 'completed', phase: toPhase(body.phase as PhaseRow) };
    case 'not_active':
      return { outcome: 'not_active' };
    case 'unsettled':
      return { outcome: 'unsettled', unknownUnfinished: typeof body.unknown_unfinished === 'number' ? body.unknown_unfinished : 0 };
    default:
      return null;
  }
}

export async function archivePhasesBySeason(seasonId: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('league_phases')
    .update({ archived })
    .eq('season_id', seasonId);
  if (error) throw error;
}

export async function deletePhase(id: string): Promise<void> {
  const { error } = await supabase
    .from('league_phases')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

type StartingBracket = PhaseParticipant['starting_bracket'];

function toStartingBracket(value: string | null | undefined): StartingBracket {
  if (value === 'losers') return 'losers';
  return 'winners';
}

function mapParticipantRow(
  row: { seed: number | null; starting_bracket: string | null | undefined; players: Tables<'players'> },
): PhaseParticipant {
  const p = row.players;
  return {
    id: p.id,
    name: p.name,
    discord_id: p.discord_id,
    auth_user_id: p.auth_user_id,
    ps_username: p.ps_username,
    champions_username: p.champions_username,
    is_admin: p.is_admin,
    is_creator: p.is_creator,
    is_guest: p.is_guest,
    is_test_account: p.is_test_account,
    joined_date: p.joined_date,
    avatar_url: p.avatar_url ?? null,
    avatar_config: (p.avatar_config as unknown as import('@/types/avatar').AvatarConfig) ?? null,
    status: p.status as PlayerStatus,
    suspended_until: p.suspended_until,
    ban_reason: p.ban_reason,
    created_at: p.created_at,
    updated_at: p.updated_at,
    seed: row.seed,
    starting_bracket: toStartingBracket(row.starting_bracket),
  };
}

export async function getPhaseParticipants(phaseId: string): Promise<PhaseParticipant[]> {
  const grouped = await getPhaseParticipantsBatch([phaseId]);
  return (grouped.get(phaseId) ?? []).sort((a, b) => {
    if (a.seed !== null && b.seed !== null) return a.seed - b.seed;
    if (a.seed !== null) return -1;
    if (b.seed !== null) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getPhaseParticipantsBatch(
  phaseIds: string[]
): Promise<Map<string, PhaseParticipant[]>> {
  const unique = [...new Set(phaseIds)];
  const result = new Map<string, PhaseParticipant[]>(unique.map(id => [id, []]));
  for (let offset = 0; offset < unique.length; offset += 50) {
    const { rows } = await readBoundedPages(
    (from, to) =>
      supabase
        .from('phase_participants')
        .select(`
      phase_id,
      player_id,
      seed,
      starting_bracket,
      players ( * )
    `)
        .in('phase_id', unique.slice(offset, offset + 50))
        .order('phase_id')
        .order('player_id')
        .range(from, to),
    { label: 'getPhaseParticipantsBatch' }
  );

  for (const row of rows) {
    const participant = mapParticipantRow({
      seed: row.seed,
      starting_bracket: row.starting_bracket,
      players: row.players as Tables<'players'>,
    });
    const list = result.get(row.phase_id) ?? [];
    list.push(participant);
    result.set(row.phase_id, list);
  }
  }

  return result;
}

export async function isPlayerPhaseParticipant(
  playerId: string,
  phaseId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('phase_participants')
    .select('player_id')
    .eq('phase_id', phaseId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}


export async function getPhaseById(id: string): Promise<Phase | null> {
  const { data, error } = await supabase.from('league_phases').select('*, seasons ( format_type )').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { ...toPhase(data), season_format_type: (data.seasons as { format_type: SeasonFormatType } | null)?.format_type ?? null } : null;
}

export async function getPhaseWithDetails(id: string, seasonId?: string): Promise<PhaseWithDetails | null> {
  let query = supabase.from('league_phases')
    .select('*, rulesets:ruleset_definition_versions ( name:name_text ), seasons ( name, format_type ), phase_participants ( count )')
    .eq('id', id);
  if (seasonId !== undefined) query = query.eq('season_id', seasonId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? {
    ...toPhase(data),
    season_format_type: (data.seasons as { format_type: SeasonFormatType } | null)?.format_type ?? null,
    season_name: (data.seasons as { name: string } | null)?.name ?? '',
    ruleset_name: (data.rulesets as { name: string } | null)?.name ?? '',
    participant_count: embeddedCount(data.phase_participants),
  } : null;
}

export async function freezePhaseEnrollment(phaseId: string): Promise<void> {
  const { error } = await supabase.rpc('phase_enrollment_freeze', { p_phase_id: phaseId });
  if (error) throw error;
}

export async function addPhaseParticipant(phaseId: string, playerId: string): Promise<void> {
  const { error } = await supabase.rpc('phase_participant_edit', { p_phase_id: phaseId, p_player_id: playerId, p_add: true });
  if (error) throw error;
}

function throwPhaseRosterError(error: { code: string; message: string }): never {
  if (error.code === 'P0001' && error.message === 'PHASE_GROUP_ROSTER_SCHEDULED') {
    throw new UserFacingError('A player in a group cannot be removed once the phase has rounds. Use a substitution instead.', {
      code: 'PHASE_GROUP_ROSTER_SCHEDULED', status: 409,
    });
  }
  throw error;
}

export async function removePhaseParticipant(phaseId: string, playerId: string): Promise<void> {
  const { error } = await supabase.rpc('phase_participant_edit', { p_phase_id: phaseId, p_player_id: playerId, p_add: false });
  if (error) throwPhaseRosterError(error);
}

export interface PhaseParticipantSwap { swapped: boolean; seed: number | null }

export async function swapPhaseParticipant(phaseId: string, outPlayerId: string, inPlayerId: string): Promise<PhaseParticipantSwap> {
  if (!await isPlayerPhaseParticipant(outPlayerId, phaseId)) return { swapped: false, seed: null };
  await freezePhaseEnrollment(phaseId);
  const { data, error } = await supabase.rpc('phase_participant_swap', { p_phase_id: phaseId, p_out: outPlayerId, p_in: inPlayerId });
  if (error) throw error;
  return data as unknown as PhaseParticipantSwap;
}

export async function updatePhaseParticipantSeeds(phaseId: string, seeds: Array<{ player_id: string; seed: number | null; starting_bracket?: StartingBracket }>): Promise<void> {
  if (seeds.length === 0) return;
  const { error } = await supabase.rpc('phase_participant_seeds', { p_phase_id: phaseId, p_seeds: seeds as unknown as Json });
  if (error) {
    if (error.code === 'P0001' && error.message === 'SEED_CONFLICT') {
      let details: unknown;
      try {
        details = JSON.parse(error.details || '{}');
      } catch {
        throw error;
      }
      if (typeof details === 'object' && details !== null && 'seed' in details && typeof details.seed === 'number') {
        throw new SeedConflictError(details.seed);
      }
    }
    throw error;
  }
}

export async function replacePhaseParticipants(phaseId: string, entries: Array<{ player_id: string; seed: number }>): Promise<void> {
  const { error } = await supabase.rpc('phase_participants_replace', { p_phase_id: phaseId, p_entries: entries as unknown as Json });
  if (error) throwPhaseRosterError(error);
}

export async function replacePhaseEnrollment(phaseId: string, entries: Array<{ player_id: string; seed: number }>, source: EnrollmentSource, expectedSyncedAt: string | null, force = false): Promise<boolean> {
  const { data, error } = await supabase.rpc('phase_enrollment_replace', {
    p_phase_id: phaseId, p_entries: entries as unknown as Json, p_source: source as unknown as Json,
    p_expected_synced_at: expectedSyncedAt as unknown as string, p_force: force,
  });
  if (error) {
    if (error.code === 'P0001' && error.message === 'enrollment_frozen') throw new UserFacingError('Enrollment is frozen. Confirm to overwrite imported standings.', { code: 'ENROLLMENT_FROZEN' });
    if (error.code === 'P0001' && error.message === 'enrollment_rounds_exist') throw new UserFacingError('Enrollment cannot be re-synced while rounds exist. Confirm to overwrite.', { code: 'ENROLLMENT_ROUNDS_EXIST' });
    throwPhaseRosterError(error);
  }
  return data === true;
}

export async function shiftPhaseStageOrders(seasonId: string, fromOrder: number, delta: number): Promise<void> {
  const { error } = await supabase.rpc('phase_stage_orders_shift', { p_season_id: seasonId, p_from_order: fromOrder, p_delta: delta });
  if (error) throw error;
}

export async function reorderPhases(seasonId: string, orderedPhaseIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('phase_stage_orders_reorder', { p_season_id: seasonId, p_phase_ids: orderedPhaseIds });
  if (error) throw error;
}

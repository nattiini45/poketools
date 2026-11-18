import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const results: Array<{ data: unknown; error: unknown }> = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['from', 'select', 'insert', 'update', 'delete', 'eq', 'in', 'order']) {
    builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder; };
  }
  for (const method of ['range', 'single', 'maybeSingle', 'rpc']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(results.shift() ?? { data: [], error: null });
    };
  }
  builder.then = (resolve: unknown) => Promise.resolve(results.shift() ?? { data: [], error: null }).then(resolve as (value: unknown) => unknown);
  return { calls, results, builder };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: h.builder }));

import {
  getPhaseById, getPhaseWithDetails, getPhasesBySeasonIds, getPhaseParticipantsBatch,
  updatePhase, completePhaseIfActive, freezePhaseEnrollment, replacePhaseEnrollment,
  addPhaseParticipant, removePhaseParticipant, replacePhaseParticipants,
  updatePhaseParticipantSeeds, swapPhaseParticipant, reorderPhases, shiftPhaseStageOrders,
} from '@/lib/supabase/queries/league-phases';
import {
  getRoundsByPhase, getByeRoundsByPhaseIds, listRoundStatusesByPhaseIds,
  createPhaseRound, createPhaseRoundWithMatches, addMatchesToPhaseRound,
  writePhaseBracket, completePhaseRound, updatePhaseRoundStatus, deletePhaseRound, deleteAdminPhaseRound,
} from '@/lib/supabase/queries/phase-rounds';
import {
  getGroupsByPhase, createPhaseGroupBatch, addPhaseGroupMembersBatch,
  movePhaseGroupMember, handOverPhaseGroupRow, swapGroupMemberInPhase,
} from '@/lib/supabase/queries/phase-groups';

const phase = {
  id: 'phase-a', season_id: 'league-a', name: 'Table phase', description: '',
  bracket_type: 'swiss', ruleset_id: 'rules-a', best_of_default: 3, bo_overrides: { Finals: 5 },
  is_doubles: false, team_visibility: 'hidden_until_match', status: 'active', current_round: 2,
  stage_order: 1, advancement_rule: { type: 'top_n', count: 2, per_group: false },
  enrollment_source: { type: 'roster', source_phase_id: null, synced_at: '2026-11-17T12:00:00Z', frozen: true },
  archived: false, legacy: false, bracket_reset_enabled: true, third_place_enabled: false,
  format_stage_key: 'groups', format_group: 1, stage_spec: { pairing: { kind: 'swiss' } },
  created_at: '2026-11-17T12:00:00Z', updated_at: '2026-11-17T12:00:00Z',
};
const round = {
  id: 'round-a', phase_id: 'phase-a', name: 'Round 2', round_number: 2, best_of: 3,
  status: 'pending', pairings_generated: true, bracket_side: null, deadline: null,
  bye_player_ids: ['player-c'], created_at: phase.created_at, updated_at: phase.updated_at,
};
const roundInput = {
  phase_id: 'phase-a', name: 'Round 2', round_number: 2, best_of: 3,
  matches: [{ player_1_id: 'player-a', player_2_id: 'player-b' }],
};
const source = { type: 'roster' as const, source_phase_id: null, synced_at: phase.updated_at, frozen: false };
const ok = (data: unknown) => h.results.push({ data, error: null });
const fail = (message: string, code = 'P0001', details?: string) => h.results.push({ data: null, error: { code, message, details } });
const calls = (method: string) => h.calls.filter(call => call.method === method).map(call => call.args);

beforeEach(() => { h.calls.length = 0; h.results.length = 0; });

describe('native phase reads', () => {
  it('reads native identity and all kit metadata without a tournament row', async () => {
    ok({ ...phase, seasons: { format_type: 'custom' } });
    expect(await getPhaseById(phase.id)).toEqual({ ...phase, season_format_type: 'custom' });
    expect(calls('from')).toEqual([['league_phases']]);
  });

  it('counts participants with an embed, not child ids', async () => {
    ok({ ...phase, seasons: { name: 'Example League', format_type: 'custom' }, rulesets: { name: 'Rules' }, phase_participants: [{ count: 1200 }] });
    expect(await getPhaseWithDetails(phase.id)).toMatchObject({ participant_count: 1200, season_name: 'Example League', ruleset_name: 'Rules' });
    expect(String(calls('select')[0])).toContain('phase_participants ( count )');
  });

  it('never falls back when native identity is missing or the read fails', async () => {
    ok(null);
    expect(await getPhaseById('gone')).toBeNull();
    fail('read unavailable', '57014');
    await expect(getPhaseById('phase-a')).rejects.toMatchObject({ code: '57014' });
    expect(calls('from')).toEqual([['league_phases'], ['league_phases']]);
  });

  it('batches leagues with stable paging beyond max_rows', async () => {
    const joined = { ...phase, seasons: { name: 'Example', format_type: 'custom' }, rulesets: { name: 'Rules' }, phase_participants: [{ count: 2 }] };
    ok(Array.from({ length: 1000 }, (_, index) => ({ ...joined, id: 'phase-' + index })));
    ok([{ ...joined, id: 'last' }]);
    const grouped = await getPhasesBySeasonIds(['league-a', 'league-a', 'league-empty']);
    expect(grouped.get('league-a')).toHaveLength(1001);
    expect(grouped.get('league-empty')).toEqual([]);
    expect(calls('range')).toEqual([[0, 999], [1000, 1999]]);
    expect(calls('order').slice(0, 4)).toEqual([['season_id'], ['stage_order'], ['created_at'], ['id']]);
  });

  it('bounds IN lists and skips empty participant/round reads', async () => {
    expect(await getPhaseParticipantsBatch([])).toEqual(new Map());
    expect(await listRoundStatusesByPhaseIds([])).toEqual([]);
    expect(h.calls).toEqual([]);
    await getPhaseParticipantsBatch(Array.from({ length: 51 }, (_, i) => 'phase-' + i));
    expect(calls('in').map(args => (args[1] as string[]).length)).toEqual([50, 1]);
    expect(calls('order')).toEqual([['phase_id'], ['player_id'], ['phase_id'], ['player_id']]);
  });

  it('reads groups and members in two paged waves without truncating embedded members', async () => {
    ok([{ id: 'group-a', phase_id: phase.id, season_id: phase.season_id, name: 'A', group_number: 1, season_group_id: null }]);
    ok([{ group_id: 'group-a', player_id: 'player-b', seed: 2, players: { name: 'Trainer B' } }, { group_id: 'group-a', player_id: 'player-a', seed: 1, players: { name: 'Trainer A' } }]);
    const groups = await getGroupsByPhase(phase.id);
    expect(groups[0].members.map(member => member.player_id)).toEqual(['player-a', 'player-b']);
    expect(calls('from')).toEqual([['phase_groups'], ['phase_group_members']]);
    expect(calls('select')[1]).toEqual(['group_id, player_id, seed, players ( name )']);
  });

  it('pages round reads and exposes phase ids on bye/status projections', async () => {
    ok(Array.from({ length: 1000 }, (_, i) => ({ ...round, id: 'r-' + i })));
    ok([round]);
    expect(await getRoundsByPhase(phase.id)).toHaveLength(1001);
    expect(calls('range')).toEqual([[0, 999], [1000, 1999]]);
    h.calls.length = 0;
    ok([round]);
    expect((await getByeRoundsByPhaseIds([phase.id])).get(phase.id)).toEqual([{ id: round.id, phase_id: phase.id, round_number: 2, bye_player_ids: ['player-c'] }]);
    expect(calls('order')).toEqual([['phase_id'], ['round_number'], ['id']]);
  });
});

describe('native lifecycle and enrollment writes', () => {
  it('requires a guarded legal status move and reports a lost CAS distinctly', async () => {
    await expect(updatePhase(phase.id, { status: 'completed' })).rejects.toThrow('expected status');
    await expect(updatePhase(phase.id, { status: 'upcoming' }, { from: 'active' })).rejects.toThrow();
    expect(h.calls).toEqual([]);
    ok(null);
    await expect(updatePhase(phase.id, { status: 'completed' }, { from: 'active' })).rejects.toMatchObject({ code: 'tournament_status_changed', statusCode: 409 });
    expect(calls('eq')).toContainEqual(['status', 'active']);
  });

  it('scopes an admin config edit to its league and captured status even with no status change', async () => {
    ok({ ...phase, name: 'Renamed phase' });
    await expect(updatePhase(phase.id, { name: 'Renamed phase' }, { from: 'active', seasonId: phase.season_id }))
      .resolves.toMatchObject({ name: 'Renamed phase' });
    expect(calls('eq')).toEqual([['id', phase.id], ['status', 'active'], ['season_id', phase.season_id]]);
  });

  it('uses a distinct native stage-end completion and explicit phase result', async () => {
    ok({ outcome: 'completed', phase: { ...phase, status: 'completed' } });
    expect(await completePhaseIfActive(phase.id, ['match-known'])).toMatchObject({ outcome: 'completed', phase: { id: phase.id, status: 'completed' } });
    expect(calls('rpc')).toEqual([['league_phase_complete_at_stage_end', { p_phase_id: phase.id, p_known_unfinished: ['match-known'] }]]);
    ok({ outcome: 'unsettled', unknown_unfinished: 1 });
    expect(await completePhaseIfActive(phase.id, [])).toEqual({ outcome: 'unsettled', unknownUnfinished: 1 });
  });

  it('freezes only through the native atomic flag writer', async () => {
    ok(true);
    await freezePhaseEnrollment(phase.id);
    expect(calls('rpc')).toEqual([['phase_enrollment_freeze', { p_phase_id: phase.id }]]);
  });

  it('sends the enrollment timestamp CAS and preserves its failure catalog', async () => {
    ok(false);
    expect(await replacePhaseEnrollment(phase.id, [], source, null)).toBe(false);
    expect(calls('rpc')[0]).toEqual(['phase_enrollment_replace', { p_phase_id: phase.id, p_entries: [], p_source: source, p_expected_synced_at: null, p_force: false }]);
    fail('enrollment_frozen');
    await expect(replacePhaseEnrollment(phase.id, [], source, null)).rejects.toMatchObject({ code: 'ENROLLMENT_FROZEN' });
    fail('enrollment_rounds_exist');
    await expect(replacePhaseEnrollment(phase.id, [], source, null)).rejects.toMatchObject({ code: 'ENROLLMENT_ROUNDS_EXIST' });
  });

  it('writes seeds and ordering as set-based native RPCs', async () => {
    await updatePhaseParticipantSeeds(phase.id, [{ player_id: 'player-a', seed: 2, starting_bracket: 'losers' }]);
    await reorderPhases('league-a', [phase.id]);
    await shiftPhaseStageOrders('league-a', 2, 1);
    expect(calls('rpc').map(args => args[0])).toEqual(['phase_participant_seeds', 'phase_stage_orders_reorder', 'phase_stage_orders_shift']);
    fail('SEED_CONFLICT', 'P0001', '{"seed":2}');
    await expect(updatePhaseParticipantSeeds(phase.id, [{ player_id: 'player-a', seed: 2 }])).rejects.toMatchObject({ code: 'SEED_CONFLICT' });
  });

  it('keeps a refusal distinct and delegates freezing to the atomic roster edit', async () => {
    await addPhaseParticipant(phase.id, 'player-a');
    fail('PHASE_GROUP_ROSTER_SCHEDULED');
    await expect(removePhaseParticipant(phase.id, 'player-a')).rejects.toMatchObject({
      code: 'PHASE_GROUP_ROSTER_SCHEDULED', statusCode: 409,
    });
    expect(calls('rpc')).toEqual([
      ['phase_participant_edit', { p_phase_id: phase.id, p_player_id: 'player-a', p_add: true }],
      ['phase_participant_edit', { p_phase_id: phase.id, p_player_id: 'player-a', p_add: false }],
    ]);
    fail('PHASE_GROUP_ROSTER_SCHEDULED');
    await expect(replacePhaseParticipants(phase.id, [])).rejects.toMatchObject({ code: 'PHASE_GROUP_ROSTER_SCHEDULED' });
    fail('PHASE_GROUP_ROSTER_SCHEDULED');
    await expect(replacePhaseEnrollment(phase.id, [], source, null, true)).rejects.toMatchObject({
      code: 'PHASE_GROUP_ROSTER_SCHEDULED',
    });
  });

  it('hands enrollment and the cascading group slot over through one locked swap', async () => {
    ok({ player_id: 'player-a' });
    ok(true);
    ok({ swapped: true, seed: null });
    expect(await swapPhaseParticipant(phase.id, 'player-a', 'player-b')).toEqual({ swapped: true, seed: null });
    expect(calls('rpc').map(args => args[0])).toEqual(['phase_enrollment_freeze', 'phase_participant_swap']);
    expect(calls('from')).toEqual([['phase_participants']]);
  });
});

describe('native round and bracket writes', () => {
  it('writes rounds with explicit native ownership and revision', async () => {
    ok({ round, matches: 1 });
    expect(await createPhaseRoundWithMatches({ ...roundInput, expected_revision: 7 })).toEqual(round);
    expect(calls('rpc')).toEqual([['phase_round_write', { p_phase_id: phase.id, p_round_id: null, p_name: 'Round 2', p_round_number: 2, p_best_of: 3, p_bye_player_ids: [], p_matches: roundInput.matches, p_expected_revision: 7 }]]);
  });

  it('creates an empty round through the same parent-locked writer', async () => {
    ok({ round, matches: 0 });
    await createPhaseRound({ ...roundInput, bracket_side: 'losers' });
    expect(calls('rpc')[0][0]).toBe('phase_round_write');
    expect(calls('rpc')[0][1]).toMatchObject({ p_matches: [], p_bracket_side: 'losers' });
    expect(calls('from')).toEqual([]);
  });

  it.each(['rounds_phase_completed', 'rounds_round_completed', 'rounds_round_already_written', 'format_context_stale', 'PHASE_GROUPS_STALE'])('preserves refusal %s', async code => {
    fail(code);
    await expect(addMatchesToPhaseRound({ id: round.id, name: round.name, phase_id: phase.id }, roundInput.matches)).rejects.toMatchObject({ code, statusCode: 409 });
  });

  it('maps the native unique round key to the existing duplicate-round catalog code', async () => {
    fail('duplicate key value violates unique constraint "phase_rounds_phase_round_number_key"', '23505');
    await expect(createPhaseRoundWithMatches(roundInput)).rejects.toMatchObject({ code: 'rounds_round_already_written', statusCode: 409 });
  });

  it('uses native bracket CAS and preserves the played-match conflict', async () => {
    fail('bracket_matches_played', 'P0001', '{"count":2}');
    await expect(writePhaseBracket({ phase_id: phase.id, expected_status: 'active', replace: true, rounds: [], matches: [], current_round: 1 })).rejects.toMatchObject({ code: 'REGENERATE_PLAYED', params: { count: 2 } });
    expect(calls('rpc')[0][0]).toBe('phase_bracket_write');
  });

  it('completes and deletes through native round RPCs', async () => {
    ok({ outcome: 'unfinished', unfinished: 2 });
    expect(await completePhaseRound(round.id, { force: false })).toEqual({ outcome: 'unfinished', unfinished: 2 });
    ok({ outcome: 'completed', round: { ...round, status: 'completed' }, unfinished: 2 });
    expect(await completePhaseRound(round.id, { force: true })).toMatchObject({ outcome: 'completed', unfinished: 2 });
    await deletePhaseRound(round.id);
    expect(calls('rpc').map(args => args[0])).toEqual(['phase_round_complete', 'phase_round_complete', 'phase_round_delete']);
  });

  it('uses one scoped RPC for admin deletion and reads the committed audit metadata', async () => {
    const deleted = { name: round.name, round_number: round.round_number, matches: 2 };
    ok(deleted);
    await expect(deleteAdminPhaseRound(phase.season_id, phase.id, round.id, round.updated_at, true)).resolves.toEqual(deleted);
    expect(h.calls).toEqual([{ method: 'rpc', args: ['phase_admin_round_delete', {
      p_season_id: phase.season_id, p_phase_id: phase.id, p_round_id: round.id,
      p_expected_updated_at: round.updated_at, p_confirm: true,
    }] }]);
  });

  it.each([
    ['P0001', 'round_not_found', 'round_not_found', 404],
    ['P0001', 'PHASE_NOT_FOUND', 'PHASE_NOT_FOUND', 404],
    ['P0001', 'season_not_found', 'season_not_found', 404],
    ['P0001', 'STRUCTURE_ELIM_ROUND_DELETE', 'STRUCTURE_ELIM_ROUND_DELETE', 400],
    ['P0001', 'phase_round_delete_confirm_required', 'phase_round_delete_confirm_required', 400],
    ['P0001', 'phase_round_delete_changed', 'phase_round_delete_changed', 409],
    ['P0001', 'phase_round_delete_locked', 'phase_round_delete_locked', 409],
    ['P0001', 'phase_round_delete_dependent', 'phase_round_delete_dependent', 409],
    ['P0001', 'phase_round_delete_results', 'phase_round_delete_results', 409],
    ['P0001', 'phase_round_delete_teams', 'phase_round_delete_teams', 409],
    ['P0001', 'phase_round_delete_linked', 'phase_round_delete_linked', 409],
    ['55P03', 'lock unavailable', 'phase_round_delete_changed', 409],
    ['40P01', 'deadlock detected', 'phase_round_delete_changed', 409],
  ])('maps admin round deletion refusal %s / %s', async (sqlCode, signal, code, statusCode) => {
    fail(signal, sqlCode);
    await expect(deleteAdminPhaseRound(phase.season_id, phase.id, round.id, round.updated_at, true))
      .rejects.toMatchObject({ code, statusCode, cause: { code: sqlCode, message: signal } });
  });

  it('does not report an unexpected delete response as success', async () => {
    ok(null);
    await expect(deleteAdminPhaseRound(phase.season_id, phase.id, round.id, round.updated_at, true))
      .rejects.toThrow('Native round deletion returned an invalid result');
  });

  it('does not overwrite a round whose state moved on', async () => {
    ok(null);
    await expect(updatePhaseRoundStatus(round.id, 'active', 'pending')).rejects.toMatchObject({ code: 'round_status_changed' });
    expect(calls('eq')).toContainEqual(['status', 'pending']);
  });

  it('allows a system revert without granting that move to an admin', async () => {
    await expect(updatePhaseRoundStatus(round.id, 'active', 'completed')).rejects.toThrow();
    expect(h.calls).toEqual([]);
    ok({ ...round, status: 'active' });
    expect(await updatePhaseRoundStatus(round.id, 'active', 'completed', 'system')).toMatchObject({ status: 'active' });
    expect(calls('eq')).toContainEqual(['status', 'completed']);
  });

  it('fails closed on malformed completion results', async () => {
    ok({ outcome: 'unknown' });
    await expect(completePhaseRound(round.id, { force: false })).rejects.toThrow('unexpected result');
    ok({ outcome: 'completed', tournament: phase });
    await expect(completePhaseIfActive(phase.id, [])).rejects.toThrow('unexpected result');
  });
});

describe('native group writes', () => {
  it('locks the parent before fixed-table group/member operations and rejects mixed-owner batches', async () => {
    ok([{ id: 'group-a' }]);
    await createPhaseGroupBatch([{ phase_id: phase.id, season_id: phase.season_id, name: 'A', group_number: 1 }]);
    await addPhaseGroupMembersBatch([{ phase_id: phase.id, group_id: 'group-a', player_id: 'player-a', seed: 1 }]);
    expect(calls('rpc').map(args => args[0])).toEqual(['phase_group_write', 'phase_group_write']);
    expect(calls('rpc')[1][1]).toMatchObject({ p_operation: 'add_members', p_phase_id: phase.id });
    await expect(addPhaseGroupMembersBatch([{ phase_id: 'one', group_id: 'a', player_id: 'x', seed: 1 }, { phase_id: 'two', group_id: 'b', player_id: 'y', seed: 1 }])).rejects.toThrow('one phase');
  });

  it('runs group move, handover and swap as parent-locked atomic RPCs', async () => {
    await movePhaseGroupMember(phase.id, 'group-a', 'group-b', 'player-a', 2);
    ok({ written: false, reason: 'target_grouped', held_group_ids: ['group-b'] });
    expect(await handOverPhaseGroupRow(phase.id, 'group-a', 'player-a', 'player-b')).toMatchObject({ written: false, reason: 'target_grouped' });
    ok({ written: true, held: null });
    expect(await swapGroupMemberInPhase(phase.id, 'player-a', 'player-b')).toEqual({ written: true, held: null });
    expect(calls('rpc').map(args => args[0])).toEqual(['phase_group_member_move', 'phase_group_row_handover', 'phase_group_member_swap']);
  });
});

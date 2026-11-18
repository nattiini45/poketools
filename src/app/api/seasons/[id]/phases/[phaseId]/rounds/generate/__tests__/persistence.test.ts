import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { writeGeneratedPhaseRound } from '@/lib/supabase/queries/phase-rounds';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: h }));

const input: Parameters<typeof writeGeneratedPhaseRound>[0] = {
  phase_id: 'phase', season_id: 'league', phase_status: 'upcoming', round_id: null,
  name: 'Round 1', round_number: 1, best_of: 3, deadline: '2026-11-20T00:00:00Z', bye_player_ids: ['c'],
  matches: [{ player_1_id: 'a', player_2_id: 'b' }], expected_updated_at: '2026-11-18T00:00:00Z', expected_revision: 7,
  inputs: {
    phase: { status: 'upcoming', current_round: 0, bracket_type: 'swiss', name: 'Table', best_of_default: 3, bo_overrides: {}, stage_spec: null },
    season: { start_date: null, format_type: 'custom' },
    rounds: [], matches: [], participants: [], groups: [], league_groups: [],
  },
  replacement_groups: [{ name: 'Group A', group_number: 1, season_group_id: 'league-group', members: [{ player_id: 'a', seed: 1 }] }],
};

beforeEach(() => vi.clearAllMocks());

it('submits the mirror, deadline, round and fixtures to one guarded native RPC', async () => {
  const round = { id: 'round', phase_id: 'phase', bye_player_ids: ['c'], deadline: input.deadline };
  h.rpc.mockResolvedValueOnce({ data: { round, matches: 1 }, error: null });
  await expect(writeGeneratedPhaseRound(input)).resolves.toMatchObject(round);
  expect(h.rpc).toHaveBeenCalledExactlyOnceWith('phase_round_generate', {
    p_phase_id: 'phase', p_season_id: 'league', p_round_id: null, p_name: 'Round 1', p_round_number: 1, p_best_of: 3,
    p_deadline: input.deadline, p_bye_player_ids: ['c'], p_matches: input.matches, p_expected_updated_at: input.expected_updated_at,
    p_expected_revision: 7, p_inputs: input.inputs, p_replacement_groups: input.replacement_groups,
  });
  expect(h.from).not.toHaveBeenCalled();
});

it.each([
  ['P0001', 'phase_round_inputs_changed', 'round_status_changed'],
  ['P0001', 'PHASE_GROUPS_STALE', 'PHASE_GROUPS_STALE'],
  ['P0001', 'format_context_stale', 'format_context_stale'],
  ['P0001', 'rounds_phase_completed', 'rounds_phase_completed'],
  ['55P03', 'could not obtain lock', 'round_status_changed'],
])('maps guarded RPC refusal %s/%s without attempting a fallback write', async (code, message, mapped) => {
  h.rpc.mockResolvedValueOnce({ error: { code, message }, data: null });
  await expect(writeGeneratedPhaseRound(input)).rejects.toMatchObject({ statusCode: 409, code: mapped });
  expect(h.rpc).toHaveBeenCalledTimes(1);
  expect(h.from).not.toHaveBeenCalled();
});

it('takes the season/revision/phase locks and checks pairing inputs before any mirror or fixture mutation', () => {
  const sql = readFileSync('supabase/migrations/20261118104000_phase_round_generate.sql', 'utf8');
  const steps = [
    'pg_advisory_xact_lock', 'FROM public.seasons', 'public.format__check_revision', 'FROM public.league_phases', 'public.phase_storage_mode()',
    "p_inputs -> 'phase'", "p_inputs -> 'rounds'", "p_inputs -> 'matches'", "p_inputs -> 'participants'",
    "p_inputs -> 'groups'", "p_inputs -> 'league_groups'", 'DELETE FROM public.phase_groups', 'INSERT INTO public.phase_group_members',
    'v_result := public.phase_round_write',
  ];
  const offsets = steps.map(step => sql.indexOf(step));
  expect(offsets.every(offset => offset >= 0)).toBe(true);
  expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM public\.phase_rounds WHERE phase_id = p_phase_id\) THEN\s+RAISE EXCEPTION 'PHASE_GROUPS_STALE'/);
  expect(sql).not.toMatch(/public\.(?:tournaments|tournament_groups|rounds|matches)\b/);
  expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.phase_round_generate\([^;]+\) FROM PUBLIC, anon, authenticated;/);
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.phase_round_generate\([^;]+\) TO service_role;/);
});

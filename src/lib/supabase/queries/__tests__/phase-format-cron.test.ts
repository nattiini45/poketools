import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { supabase } from '@/lib/supabase/client';
import { listNativeKitCronPhases, listNativeFinalizedMatches, listNativeUncompletedMatches, completePhaseFormatForfeit } from '../phase-format-cron';
import { FormatRuntimeError } from '../format-runtime';

function query(rows: Record<string, unknown>[]) {
  return {
    select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null })),
    then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
  };
}

beforeEach(() => vi.resetAllMocks());

describe('native format cron persistence', () => {
  it('reads calendars only from actual native phases with active kit league filters', async () => {
    const q = query([{ id: 'phase', season_id: 'league', status: 'active', format_stage_key: 'main', stage_spec: { stage: { calendar: {} } }, seasons: { start_date: '2026-06-01', season_formats: { clock_shift_seconds: 12 } } }]);
    vi.mocked(supabase.from).mockReturnValue(q as never);
    expect(await listNativeKitCronPhases()).toEqual([{ id: 'phase', season_id: 'league', status: 'active', format_stage_key: 'main', season_start_date: '2026-06-01', clock_shift_seconds: 12 }]);
    expect(supabase.from).toHaveBeenCalledWith('league_phases');
    expect(q.eq).toHaveBeenCalledWith('seasons.season_formats.engine', 'kit');
    expect(q.in).toHaveBeenCalledWith('status', ['upcoming', 'active']);
  });

  it('pages finalized native matches and keeps their completion tokens and real phase ids', async () => {
    const rows = Array.from({ length: 1001 }, (_, n) => ({ id: String(n), phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', confirmed_at: null, finalized_at: '2026-06-01T00:00:00Z' }));
    const q = query(rows);
    vi.mocked(supabase.from).mockReturnValue(q as never);
    const result = await listNativeFinalizedMatches(['phase']);
    expect(result).toHaveLength(1001);
    expect(result[0]).toMatchObject({ phase_id: 'phase', confirmed_at: null });
    expect(result[0]).not.toHaveProperty('tournament_id');
    expect(result[0]).not.toHaveProperty('finalized_at');
    expect(q.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(supabase.from).toHaveBeenCalledWith('phase_matches');
  });

  it('bounds pending-revert lookup chunks and skips empty inputs', async () => {
    const q = query([{ id: 'match', phase_id: 'phase', status: 'scheduled' }]);
    vi.mocked(supabase.from).mockReturnValue(q as never);
    expect(await listNativeUncompletedMatches([], ['match'])).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
    await listNativeUncompletedMatches(['phase'], Array.from({ length: 101 }, (_, n) => String(n)));
    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(q.in.mock.calls.filter(([field]) => field === 'id').map(([, ids]) => ids.length)).toEqual([100, 1]);
    expect(q.neq).toHaveBeenCalledWith('status', 'completed');
  });

  it('calls the native-only forfeit RPC and retains stale errors', async () => {
    const input = { seasonId: 'league', matchId: 'match', expectedStatus: 'scheduled' as const, player1Id: 'p1', player2Id: 'p2', winnerId: 'p1', revision: 7 };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    expect(await completePhaseFormatForfeit(input)).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('phase_format_forfeit_complete', { p_season_id: 'league', p_match_id: 'match', p_expected_status: 'scheduled', p_player_1_id: 'p1', p_player_2_id: 'p2', p_winner_id: 'p1', p_expected_revision: 7 });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: 'P0001', message: 'format_context_stale' } } as never);
    await expect(completePhaseFormatForfeit(input)).rejects.toBeInstanceOf(FormatRuntimeError);
  });

  it('defines a native guarded CAS with no legacy matches write or new owned objects', () => {
    const sql = readFileSync('supabase/migrations/20261117127000_phase_format_cron.sql', 'utf8');
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('format__assert_season_open');
    expect(sql).toContain('format__check_revision');
    expect(sql).toContain('UPDATE public.phase_matches');
    expect(sql).toContain('m.status = p_expected_status');
    expect(sql).toContain('m.player_1_id = p_player_1_id AND m.player_2_id = p_player_2_id');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).not.toContain('public.matches');
    expect(sql).not.toMatch(/CREATE (?:TABLE|TRIGGER|POLICY)/);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { supabase } from '@/lib/supabase/client';
import { getNativeKitGameCounts, getNativeKitKills, getNativeKitMatchIds, getNativeKitOutcomes } from '../phase-format-runtime';
import { firePhaseFormatMatchEvent, FormatRuntimeError } from '../format-runtime';

function query(rows: Record<string, unknown>[]) {
  return {
    select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null })),
  };
}

beforeEach(() => vi.resetAllMocks());

describe('native kit consumers', () => {
  it('pages native match ids past max_rows and never fabricates tournament identity', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ id: String(index), phase_id: 'phase' }));
    const q = query(rows);
    vi.mocked(supabase.from).mockReturnValue(q as never);
    expect(await getNativeKitMatchIds(['phase', 'phase'])).toEqual(rows);
    expect(supabase.from).toHaveBeenCalledWith('phase_matches');
    expect(q.in).toHaveBeenCalledWith('phase_id', ['phase']);
    expect(q.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });

  it('validates outcome kinds and projects only outcome facts', async () => {
    const q = query([{ match_id: 'match', kind: 'forfeit', p1_faints: 0, p2_faints: 6, phase_matches: { phase_id: 'phase' } }]);
    vi.mocked(supabase.from).mockReturnValue(q as never);
    expect(await getNativeKitOutcomes(['phase'])).toEqual([{ match_id: 'match', kind: 'forfeit', p1_faints: 0, p2_faints: 6 }]);
    expect(supabase.from).toHaveBeenCalledWith('phase_match_outcomes');
    vi.mocked(supabase.from).mockReturnValue(query([{ match_id: 'match', kind: 'unknown' }]) as never);
    await expect(getNativeKitOutcomes(['phase'])).rejects.toThrow('unknown kind');
  });

  it('counts games and kill differential through completed native matches only', async () => {
    const games = query([{ id: 'g1', match_id: 'match' }, { id: 'g2', match_id: 'match' }]);
    vi.mocked(supabase.from).mockReturnValue(games as never);
    expect(await getNativeKitGameCounts(['phase'])).toEqual({ match: 2 });
    expect(games.eq).toHaveBeenCalledWith('phase_matches.status', 'completed');
    const stats = query([{ player_id: 'p1', kos_dealt: 3, was_koed: true, phase_games: { match_id: 'match' } }, { player_id: 'p1', kos_dealt: 2, was_koed: false, phase_games: { match_id: 'match' } }]);
    vi.mocked(supabase.from).mockReturnValue(stats as never);
    expect(await getNativeKitKills(['phase'])).toEqual({ match: { p1: 4 } });
    expect(stats.eq).toHaveBeenCalledWith('phase_games.phase_matches.status', 'completed');
    expect(supabase.from).toHaveBeenLastCalledWith('phase_battle_stats');
  });

  it('splits bounded IN batches and does no work for empty input', async () => {
    vi.mocked(supabase.from).mockReturnValue(query([]) as never);
    expect(await getNativeKitMatchIds([])).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
    await getNativeKitMatchIds(Array.from({ length: 51 }, (_, n) => String(n)));
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });
});

describe('native completion fence writer', () => {
  const input = { seasonId: 'league', eventKey: 'match_completed:match', event: 'match_completed', payload: {}, ops: [], firedBy: null, revision: 7, matchFence: { matchId: 'match', confirmedAt: '2026-11-17T10:00:00Z', winnerId: 'p1' } };

  it('never hands the native fence to the legacy matches RPC', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    expect(await firePhaseFormatMatchEvent(input)).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('phase_format_fire_match_event', expect.objectContaining({ p_match_id: 'match', p_confirmed_at: input.matchFence.confirmedAt, p_winner_id: 'p1', p_expected_revision: 7 }));
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects an absent winner and preserves the stale error code', async () => {
    await expect(firePhaseFormatMatchEvent({ ...input, matchFence: undefined })).rejects.toThrow('match fence');
    await expect(firePhaseFormatMatchEvent({ ...input, matchFence: { matchId: 'match', confirmedAt: input.matchFence.confirmedAt } })).rejects.toThrow('winner fence');
    expect(supabase.rpc).not.toHaveBeenCalled();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { code: 'P0001', message: 'format_context_stale' } } as never);
    await expect(firePhaseFormatMatchEvent(input)).rejects.toBeInstanceOf(FormatRuntimeError);
  });

  it('sends a historical NULL token as a defaulted RPC argument, never as an absent match fence', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    expect(await firePhaseFormatMatchEvent({ ...input, matchFence: { ...input.matchFence, confirmedAt: null } })).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('phase_format_fire_match_event', expect.objectContaining({ p_match_id: 'match', p_winner_id: 'p1', p_confirmed_at: undefined }));
  });

  it('requires native owner, winner and confirmation under locks and restricts execution', () => {
    const sql = readFileSync('supabase/migrations/20261117125000_phase_format_match_effects.sql', 'utf8');
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('p.season_id = p_season_id');
    expect(sql).toContain('m.confirmed_at IS NOT DISTINCT FROM p_confirmed_at');
    expect(sql).toContain('p_confirmed_at timestamptz DEFAULT NULL');
    expect(sql).toContain('m.winner_id = p_winner_id');
    expect(sql).toContain('FOR SHARE OF m');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('TO service_role');
    expect(sql).not.toContain('public.matches');
    expect(sql).not.toContain('CREATE TRIGGER');
  });
});

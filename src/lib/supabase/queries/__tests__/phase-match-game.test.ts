import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { query, settle, rpc } = vi.hoisted(() => {
  const settle = vi.fn();
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const key of ['from', 'select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'order', 'range', 'limit', 'not', 'lte', 'gt', 'or']) {
    query[key] = vi.fn().mockReturnValue(query);
  }
  query.single = vi.fn();
  query.maybeSingle = vi.fn();
  query.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(settle()).then(resolve));
  return { query, settle, rpc: vi.fn() };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: query.from, rpc } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { createPhaseGame, findPhaseGameIdByReplayHash, deleteUncountedPhaseGameRow, claimPhaseGameEditLease, setPhaseGameStatsLocked } from '../phase-games';
import { ReplayAlreadyRecordedError } from '../games';
import { getPhaseMatchById, updatePhaseMatchStatus, markPhaseMatchFinalized, deletePhaseMatchesByIds, hasDownstreamPhaseMatches } from '../phase-matches';
import { cleanPhaseMatchChildren, deletePhaseMatchAnalyses, deletePhaseMatchPrepAnalyses } from '../phase-match-children';
import { recordPhaseMatchOutcome, deletePhaseMatchOutcome } from '../phase-match-outcomes';
import { insertPhaseMatchSnapshots } from '../phase-match-snapshots';

const id = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  for (const mock of Object.values(query)) mock.mockClear();
  query.single.mockReset();
  query.maybeSingle.mockReset();
  rpc.mockReset();
  settle.mockReset().mockReturnValue({ data: [], error: null, count: 0 });
});

describe('native match and game persistence', () => {
  it('maps phase identity and joined players without a tournament field', async () => {
    query.maybeSingle.mockResolvedValue({ data: {
      id, phase_id: 'phase', round_id: 'round', player_1_id: 'one', player_2_id: 'two', status: 'scheduled',
      player_1: { name: 'Fixture One' }, player_2: { name: 'Fixture Two' }, winner: null,
      games: [], round: { status: 'pending', round_number: 3 },
    }, error: null });
    const result = await getPhaseMatchById(id);
    expect(result).toMatchObject({ phase_id: 'phase', player_1_name: 'Fixture One', round_number: 3 });
    expect(result).not.toHaveProperty('tournament_id');
    expect(query.from).toHaveBeenCalledWith('phase_matches');
    expect(query.select.mock.calls[0][0]).toContain('phase_rounds!phase_matches_phase_round_fkey');
  });

  it('enforces the shared rules before a status CAS and writes completion timestamps atomically', async () => {
    await expect(updatePhaseMatchStatus(id, 'completed', 'one', 'two', undefined, 'scheduled', 'player')).rejects.toThrow();
    expect(query.from).not.toHaveBeenCalled();
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await updatePhaseMatchStatus(id, 'completed', 'one', 'two', undefined, 'pending_confirmation', 'player')).toBeNull();
    expect(query.eq).toHaveBeenCalledWith('status', 'pending_confirmation');
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', finalized_at: null, confirmed_at: expect.any(String), date_played: expect.any(String), auto_confirm_at: null }));
  });

  it('fences finalized markers on the completion token, including NULL', async () => {
    await markPhaseMatchFinalized(id, '2026-11-17T00:00:00Z', { confirmedAt: null });
    expect(query.eq).toHaveBeenCalledWith('status', 'completed');
    expect(query.is).toHaveBeenCalledWith('confirmed_at', null);
  });

  it.each(['phase_games_replay_hash_key', 'games_global_replay_hash_key'])('maps %s to the existing safe replay error', async (constraint) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    query.single.mockResolvedValue({ data: null, error: { code: '23505', message: `duplicate key violates unique constraint "${constraint}"` } });
    try {
      await expect(createPhaseGame({ match_id: id, game_number: 1, source: 'manual', winner_id: 'one', exclude_all_time: false })).rejects.toBeInstanceOf(ReplayAlreadyRecordedError);
    } finally { log.mockRestore(); }
  });

  it('looks up replays in both stores only on the explicit native path', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { id }, error: null });
    expect(await findPhaseGameIdByReplayHash('a'.repeat(64))).toBe(id);
    expect(query.from.mock.calls.map(([table]) => table)).toEqual(['phase_games', 'games']);
  });

  it('uses native leases and refuses an unknown database result', async () => {
    rpc.mockResolvedValue({ data: 'claimed', error: null });
    expect(await claimPhaseGameEditLease(id, 'version', 'token')).toBe('claimed');
    expect(rpc).toHaveBeenCalledWith('claim_phase_game_edit_lease', expect.objectContaining({ p_game_id: id, p_token: 'token', p_ttl_seconds: 120 }));
    rpc.mockResolvedValue({ data: 'unknown', error: null });
    await expect(claimPhaseGameEditLease(id, 'version', 'token')).rejects.toThrow('unexpected outcome');
  });

  it('fences a game delete and recognizes an already counted game', async () => {
    query.maybeSingle.mockResolvedValue({ data: { id }, error: null });
    expect(await deleteUncountedPhaseGameRow(id)).toBe('counted');
    expect(query.is).toHaveBeenCalledWith('aggregate_applied_at', null);
    expect(query.from.mock.calls.every(([table]) => table === 'phase_games')).toBe(true);
  });

  it('does not offer a stats unlock that the machine forbids', async () => {
    await expect(setPhaseGameStatsLocked(id, false)).rejects.toThrow();
    expect(query.from).not.toHaveBeenCalled();
    await setPhaseGameStatsLocked(id);
    expect(query.update).toHaveBeenCalledWith({ stats_locked: true });
  });

  it('uses the native outcome and snapshot RPCs and preserves staging fences', async () => {
    rpc.mockResolvedValue({ data: 'written', error: null });
    await recordPhaseMatchOutcome({ matchId: id, kind: 'forfeit', source: 'admin', force: true, p1Faints: null, p2Faints: null, reason: 'Fixture decision', setBy: id, openOnly: true });
    expect(rpc).toHaveBeenCalledWith('phase_match_outcome_record', expect.objectContaining({ p_match_id: id, p_open_only: true }));
    await deletePhaseMatchOutcome(id, { onlyIfSetAt: 'token' });
    expect(query.eq).toHaveBeenCalledWith('set_at', 'token');
    await insertPhaseMatchSnapshots(id, []);
    expect(rpc).toHaveBeenCalledWith('phase_epb_replace_match_snapshots', { p_match_id: id, p_snapshots: [] });
  });

  it('requires a successful native team-release effect before destructive child cleanup', async () => {
    const effects = { releaseTeams: vi.fn().mockRejectedValue(new Error('Library transfer unavailable')) };
    await expect(cleanPhaseMatchChildren(id, effects)).rejects.toThrow('Library transfer unavailable');
    expect(query.from).not.toHaveBeenCalled();
    effects.releaseTeams.mockResolvedValue(2);
    expect(await cleanPhaseMatchChildren(id, effects)).toMatchObject({ teamPointersCleared: 2, socialImageCleared: true });
    expect(query.from).not.toHaveBeenCalledWith('phase_teams');
    expect(query.eq).toHaveBeenCalledWith('phase_match_id', id);
  });

  it('requires team release before native match deletion', async () => {
    const releaseTeams = vi.fn().mockRejectedValueOnce(new Error('Release failed')).mockResolvedValue(1);
    await expect(deletePhaseMatchesByIds([id], { releaseTeams })).rejects.toThrow('Release failed');
    expect(query.delete).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: 1, error: null });
    await deletePhaseMatchesByIds([id], { releaseTeams });
    expect(rpc).toHaveBeenCalledWith('phase_matches_delete_scheduled', { p_match_ids: [id] });
    expect(query.delete).not.toHaveBeenCalled();
  });

  it('fails the whole native deletion after a submission changed any requested match', async () => {
    const releaseTeams = vi.fn().mockResolvedValue(1);
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'phase_match_delete_changed' } });
    await expect(deletePhaseMatchesByIds([id], { releaseTeams })).rejects.toMatchObject({ code: 'round_changed', statusCode: 409 });
    expect(releaseTeams).toHaveBeenCalledWith(id);
    expect(query.delete).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps missing requested match ids idempotent without comparing the deleted count', async () => {
    const releaseTeams = vi.fn().mockResolvedValue(0);
    rpc.mockResolvedValue({ data: 0, error: null });
    await expect(deletePhaseMatchesByIds([id, id], { releaseTeams })).resolves.toBeUndefined();
    expect(releaseTeams).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('phase_matches_delete_scheduled', { p_match_ids: [id] });
    expect(query.delete).not.toHaveBeenCalled();
  });

  it('pins the guarded SQL deletion to ordered locks and whole-batch status/game refusal', () => {
    const sql = readFileSync('supabase/migrations/20261117128000_phase_match_delete_guard.sql', 'utf8');
    const phaseLock = sql.indexOf('PERFORM public.phase__lock(v_phase_id)');
    const roundLock = sql.indexOf('ORDER BY r.id FOR UPDATE');
    const matchLock = sql.indexOf('ORDER BY m.id FOR UPDATE');
    const statusCheck = sql.indexOf("m.status <> 'scheduled'");
    const gameCheck = sql.indexOf('FROM public.phase_games g WHERE g.match_id = ANY(v_locked_ids)');
    const remove = sql.indexOf('DELETE FROM public.phase_matches m WHERE m.id = ANY(v_locked_ids)');
    expect(phaseLock).toBeGreaterThan(0);
    expect(roundLock).toBeGreaterThan(phaseLock);
    expect(matchLock).toBeGreaterThan(roundLock);
    expect(statusCheck).toBeGreaterThan(matchLock);
    expect(gameCheck).toBeGreaterThan(statusCheck);
    expect(remove).toBeGreaterThan(gameCheck);
    expect(sql.slice(matchLock, remove)).toContain("RAISE EXCEPTION 'phase_match_delete_changed'");
    expect(sql).toContain("SECURITY INVOKER SET search_path = ''");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.phase_matches_delete_scheduled(uuid[]) FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.phase_matches_delete_scheduled(uuid[]) TO service_role');
    expect(sql).not.toMatch(/SKIP LOCKED|DELETE FROM public\.phase_matches[^;]+status\s*=/);
  });

  it('detects downstream winners from the pre-reset native snapshot', async () => {
    query.single.mockResolvedValue({ data: { round_number: 1 }, error: null });
    settle.mockReturnValueOnce({ data: [{ id: 'later' }], error: null })
      .mockReturnValueOnce({ data: [], error: null })
      .mockReturnValueOnce({ data: [{ id: 'downstream' }], error: null });
    expect(await hasDownstreamPhaseMatches(id, { phase_id: 'phase', winner_id: id, round_id: 'round' })).toBe(true);
    expect(query.gt).toHaveBeenCalledWith('round_number', 1);
    expect(query.eq).toHaveBeenCalledWith('phase_id', 'phase');
    expect(query.in).toHaveBeenCalledWith('round_id', ['later']);
    expect(query.from).not.toHaveBeenCalledWith('matches');
    expect(query.from).not.toHaveBeenCalledWith('rounds');
  });

  it('keeps analysis and prep-analysis cleanup independent', async () => {
    settle.mockReturnValueOnce({ error: new Error('Analysis failure') }).mockReturnValueOnce({ error: null });
    const result = await Promise.allSettled([deletePhaseMatchAnalyses(id), deletePhaseMatchPrepAnalyses(id)]);
    expect(result.map((entry) => entry.status)).toEqual(['rejected', 'fulfilled']);
    expect(query.from.mock.calls.map(([table]) => table)).toEqual(['phase_match_analyses', 'phase_match_prep_analyses']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { mergeRatingStreams } from '../rating-streak-streams';
import { computeStreaksFromHistory, recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { loadAndComputeRatingCurve, updateRatingsWithStorage } from '@/lib/rating/updateRatings';
import type { RatingStoragePort, RatingStreamMatch } from '@/lib/rating/storage';
import { StreaksStaleError } from '@/lib/supabase/queries/streaks';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

const scope = { testSeasonTournamentIds: new Set<string>(), testSeasonPhaseIds: new Set(['test-phase']) };
const p = '00000000-0000-4000-8000-000000000001';
const opponent = '00000000-0000-4000-8000-000000000002';
function match(id: string, extra: Partial<RatingStreamMatch> = {}): RatingStreamMatch {
  return { id, phase_id: 'phase', player_1_id: p, player_2_id: opponent, winner_id: p, date_played: '2026-01-01T00:00:00.000002Z', created_at: '2026-01-01T00:00:00Z', ...extra };
}
function storage(matches: RatingStreamMatch[]): RatingStoragePort {
  return {
    countsForRatings: vi.fn().mockResolvedValue(true),
    loadScope: vi.fn().mockResolvedValue(scope),
    getCompletedMatches: vi.fn().mockResolvedValue(matches),
    getPlayerRating: vi.fn().mockResolvedValue(null),
    getHistoryByMatch: vi.fn().mockResolvedValue([]),
    getHistoryByMatches: vi.fn().mockResolvedValue([]),
    applyMatchResult: vi.fn().mockResolvedValue('applied'),
    replacePlayerCurve: vi.fn().mockResolvedValue(0),
  };
}

describe('mixed rating and streak algorithms', () => {
  it('deduplicates preserved UUIDs, prefers native ownership and uses microsecond total ordering', () => {
    const legacy = match('a', { phase_id: undefined, tournament_id: 'old-phase' });
    const native = match('a');
    const early = match('z', { date_played: '2026-01-01T00:00:00.000001Z' });
    expect(mergeRatingStreams([legacy], [native, early])).toEqual([early, native]);
    expect(mergeRatingStreams([], [match('a'), match('b')]).map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('replays both sources through the real rating engine and excludes test phases and reset ids', async () => {
    const port = storage([match('standalone', { phase_id: undefined, tournament_id: 'cup' }), match('native'), match('test', { phase_id: 'test-phase' }), match('reset')]);
    const curve = await loadAndComputeRatingCurve(p, { storage: port, excludeMatchIds: ['reset'] });
    expect(curve.computed.matchesReplayed).toBe(2);
    expect(curve.computed.finalState.wins).toBe(2);
    expect(port.getHistoryByMatches).toHaveBeenCalledWith(['standalone', 'native']);
  });

  it('recomputes the real live rating step on a stale native write', async () => {
    const port = storage([]);
    vi.mocked(port.applyMatchResult).mockResolvedValueOnce('stale').mockResolvedValueOnce('applied');
    const result = await updateRatingsWithStorage(p, opponent, false, 'native', port);
    expect(result.status).toBe('rated');
    expect(port.applyMatchResult).toHaveBeenCalledTimes(2);
    expect(port.getPlayerRating).toHaveBeenCalledTimes(4);
  });

  it('stores only the pointer of the last counted source and preserves unknown stats', () => {
    const first = match('first', { phase_id: undefined, tournament_id: 'cup', date_played: '2025-01-01T00:00:00Z' });
    const native = computeStreaksFromHistory(p, [first, match('native')], new Map(), scope);
    expect(native.current_win_streak).toBe(2);
    expect(native.current_flawless_streak).toBe(0);
    expect(native.last_match_id).toBeNull();
    expect(native.last_phase_match_id).toBe('native');
    const last = computeStreaksFromHistory(p, [match('native'), { ...first, date_played: '2027-01-01T00:00:00Z' }], new Map(), scope);
    expect(last.last_match_id).toBe('first');
    expect(last.last_phase_match_id ?? null).toBeNull();
  });

  it('re-reads both source histories after a streak fence refusal', async () => {
    const port = {
      loadScope: vi.fn().mockResolvedValue(scope), getCompletedMatches: vi.fn().mockResolvedValue([match('native')]),
      getPlayerStreaks: vi.fn().mockResolvedValue(null), getStatTotals: vi.fn().mockResolvedValue(new Map()),
      replacePlayerStreaks: vi.fn().mockRejectedValueOnce(new StreaksStaleError(p, null)).mockResolvedValue(undefined),
    };
    expect((await recomputeStreaksWithStorage(p, port)).win_streak.after).toBe(1);
    expect(port.getCompletedMatches).toHaveBeenCalledTimes(2);
    expect(port.replacePlayerStreaks).toHaveBeenLastCalledWith(p, expect.objectContaining({ last_match_id: null, last_phase_match_id: 'native' }), ['native'], ['native']);
  });
});

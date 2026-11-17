import { describe, expect, it, vi } from 'vitest';
import { rebuildRatingsForPlayersWithStorage, updateRatingsWithStorage } from '@/lib/rating/updateRatings';
import { RatingCurveStaleError } from '@/lib/supabase/queries/ratings';
import type { RatingStoragePort, RatingStreamMatch } from '@/lib/rating/storage';
import type { RatingHistoryEntry } from '@/types/rating';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

const p1 = '00000000-0000-4000-8000-000000000001';
const p2 = '00000000-0000-4000-8000-000000000002';
const completion = { winnerId: p1, confirmedAt: '2026-01-01T00:00:00Z' };
function history(player: string): RatingHistoryEntry {
  return { id: player, match_id: 'match', player_id: player, opponent_id: player === p1 ? p2 : p1, rating_before: 1500, rating_after: 1510, rd_before: 350, rd_after: 300, opponent_rating: 1500, result: player === p1 ? 'win' : 'loss', rating_change: 10, recorded_at: completion.confirmedAt };
}
function port() {
  return {
    requiresCompletionFence: true,
    countsForRatings: vi.fn<RatingStoragePort['countsForRatings']>().mockResolvedValue(true),
    loadScope: vi.fn<RatingStoragePort['loadScope']>().mockResolvedValue({ testSeasonTournamentIds: new Set(), testSeasonPhaseIds: new Set() }),
    getCompletedMatches: vi.fn<RatingStoragePort['getCompletedMatches']>().mockResolvedValue([]),
    getPlayerRating: vi.fn<RatingStoragePort['getPlayerRating']>().mockResolvedValue(null),
    getHistoryByMatch: vi.fn<RatingStoragePort['getHistoryByMatch']>().mockResolvedValue([history(p1), history(p2)]),
    getHistoryByMatches: vi.fn<RatingStoragePort['getHistoryByMatches']>().mockResolvedValue([]),
    applyMatchResult: vi.fn<RatingStoragePort['applyMatchResult']>().mockResolvedValue('applied'),
    replacePlayerCurve: vi.fn<RatingStoragePort['replacePlayerCurve']>().mockImplementation(async (_id, _state, rows) => rows.length),
  };
}

describe('native rating completion and stream fences', () => {
  it('never reuses existing history before the requested completion was checked under the SQL lock', async () => {
    const storage = port();
    storage.applyMatchResult.mockResolvedValue('match_changed');
    await expect(updateRatingsWithStorage(p1, p2, false, 'match', storage, completion)).rejects.toThrow('no longer the expected completion');
    expect(storage.applyMatchResult).toHaveBeenCalledWith('match', expect.any(Array), completion);
    expect(storage.getHistoryByMatch).not.toHaveBeenCalled();
  });

  it('reuses history only after fenced already_applied and retains the same identity across stale retries', async () => {
    const storage = port();
    const order: string[] = [];
    storage.applyMatchResult.mockImplementationOnce(async () => { order.push('stale'); return 'stale'; }).mockImplementationOnce(async () => { order.push('verified'); return 'already_applied'; });
    storage.getHistoryByMatch.mockImplementation(async () => { order.push('history'); return [history(p1), history(p2)]; });
    expect((await updateRatingsWithStorage(p1, p2, false, 'match', storage, completion)).status).toBe('rated');
    expect(order).toEqual(['stale', 'verified', 'history']);
    expect(storage.applyMatchResult.mock.calls.map((call) => call[2])).toEqual([completion, completion]);
  });

  it('requires an explicit identity but preserves a historical null completion token', async () => {
    const storage = port();
    await expect(updateRatingsWithStorage(p1, p2, false, 'match', storage)).rejects.toThrow('no expected completion token');
    expect(storage.applyMatchResult).not.toHaveBeenCalled();
    const historical = { winnerId: p1, confirmedAt: null };
    await updateRatingsWithStorage(p1, p2, false, 'match', storage, historical);
    expect(storage.applyMatchResult).toHaveBeenCalledWith('match', expect.any(Array), historical);
  });

  it('passes all countable matches and outcomes to replacement, then replays a changed stream on refusal', async () => {
    const storage = port();
    const first: RatingStreamMatch = { id: 'one', phase_id: 'phase', player_1_id: p1, player_2_id: p2, winner_id: p1, confirmed_at: completion.confirmedAt, date_played: completion.confirmedAt, created_at: completion.confirmedAt };
    const added: RatingStreamMatch = { ...first, id: 'two', winner_id: p2, confirmed_at: '2026-01-02T00:00:00Z', date_played: '2026-01-02T00:00:00Z' };
    let matches = [first];
    storage.getCompletedMatches.mockImplementation(async () => matches);
    storage.replacePlayerCurve.mockImplementationOnce(async () => { matches = [first, added]; throw new RatingCurveStaleError(p1, null); }).mockImplementation(async (_id, _state, rows) => rows.length);
    const results = await rebuildRatingsForPlayersWithStorage([p1, p2], storage);
    expect(results.find((result) => result.playerId === p1)?.matchesReplayed).toBe(2);
    expect(storage.replacePlayerCurve.mock.calls[0][4]).toEqual([first]);
    expect(storage.replacePlayerCurve.mock.calls[1][4]).toEqual([first, added]);
  });
});

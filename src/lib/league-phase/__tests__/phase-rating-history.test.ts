import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMixedRatingStorage, getPhaseRatingHistoryByMatches, mixedStreakStorage } from '../rating-streak-streams';
import { computeStreaksFromHistory } from '@/lib/gamification/streaks';
import type { RatingStreamMatch } from '@/lib/rating/storage';
import type { Tables } from '@/types/database';

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Tables<'rating_history'>[]>,
  calls: [] as Array<{ table: string; ids: string[]; from: number; to: number }>,
  tables: [] as string[],
  error: null as unknown,
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: {
  rpc: fixture.rpc,
  from: (table: string) => {
    fixture.tables.push(table);
    let ids: string[] = [];
    const query = {
      select: () => query,
      is: () => query,
      in: (_column: string, values: string[]) => { ids = values; return query; },
      order: () => query,
      range: (from: number, to: number) => {
        fixture.calls.push({ table, ids, from, to });
        const rows = (fixture.rows[table] ?? []).filter((row) => ids.includes(row.match_id));
        return Promise.resolve({ data: rows.slice(from, to + 1), error: fixture.error });
      },
    };
    return query;
  },
} }));

function history(matchId: string, playerId: string, ratingAfter = 1510): Tables<'rating_history'> {
  return {
    id: `${matchId}-${playerId}`, match_id: matchId, player_id: playerId,
    rating_before: 1500, rating_after: ratingAfter, rd_before: 350, rd_after: 300,
    opponent_id: 'opponent', opponent_rating: 1500, result: 'win',
    rating_change: ratingAfter - 1500, recorded_at: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  fixture.rows = {};
  fixture.calls = [];
  fixture.tables = [];
  fixture.error = null;
  fixture.rpc.mockReset();
});

describe('source-specific phase rating verification', () => {
  it('never accepts complete tournament ratings when phase ratings are absent', async () => {
    fixture.rows.rating_history = [history('match', 'one'), history('match', 'two')];
    expect(await getPhaseRatingHistoryByMatches(['match'])).toEqual([]);
    expect(fixture.tables).toEqual(['phase_rating_history']);
  });

  it('deduplicates requested ids, bounds IN chunks and pages each source-specific read', async () => {
    const ids = Array.from({ length: 151 }, (_, index) => `match-${index}`);
    const rows = ids.flatMap((id) => [history(id, 'one'), history(id, 'two')]);
    fixture.rows.phase_rating_history = rows;
    expect(await getPhaseRatingHistoryByMatches([...ids, ...ids])).toHaveLength(302);
    expect(fixture.tables.every((table) => table === 'phase_rating_history')).toBe(true);
    expect(fixture.calls.map((call) => [call.ids.length, call.from, call.to])).toEqual([
      [150, 0, 999], [150, 300, 1299], [1, 0, 999], [1, 2, 1001],
    ]);
  });

  it('retains union semantics for mixed-source rebuilds', async () => {
    fixture.rows.rating_history = [history('standalone', 'one')];
    fixture.rows.phase_rating_history = [history('phase', 'one')];
    const rows = await createMixedRatingStorage('phase').getHistoryByMatches(['standalone', 'phase']);
    expect(rows.map((row) => row.match_id)).toEqual(['standalone', 'phase']);
    expect(new Set(fixture.tables)).toEqual(new Set(['rating_history', 'phase_rating_history']));
  });

  it('sends the surviving native history and streak pointer to the fenced mixed replacements', async () => {
    const date = '2026-01-01T00:00:00Z';
    const nativeMatch: RatingStreamMatch = {
      id: 'native-match', phase_id: 'native-phase', player_1_id: 'one', player_2_id: 'opponent',
      winner_id: 'one', confirmed_at: date, date_played: date, created_at: date,
    };
    const nativeHistory = { ...history(nativeMatch.id, 'one'), result: 'win' as const };
    fixture.rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ error: null });

    await createMixedRatingStorage('tournament').replacePlayerCurve('one', {
      rating: 1510, rd: 300, volatility: 0.06, peak_rating: 1510, peak_date: date,
      wins: 1, losses: 0, draws: 0, last_match_at: date,
    }, [nativeHistory], ['removed-standalone-match', nativeMatch.id], [nativeMatch]);
    const streaks = computeStreaksFromHistory('one', [nativeMatch], new Map(), {
      testSeasonTournamentIds: new Set(), testSeasonPhaseIds: new Set(),
    });
    await mixedStreakStorage.replacePlayerStreaks('one', streaks, [nativeMatch.id], [nativeMatch.id]);

    expect(fixture.rpc.mock.calls.map(([rpc]) => rpc)).toEqual(['rating_replace_player_streams', 'streaks_replace_player_streams']);
    expect(fixture.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_history: [{ match_id: 'native-match', player_id: 'one' }],
      p_expected_matches: [{ kind: 'phase', match_id: 'native-match', confirmed_at: date }],
    });
    expect(fixture.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_state: { current_win_streak: 1, last_match_id: null, last_phase_match_id: 'native-match', counted_match_ids: ['native-match'] },
      p_expected_match_ids: ['native-match'],
    });
  });

  it('does not query empty input and propagates a phase read failure', async () => {
    expect(await getPhaseRatingHistoryByMatches([])).toEqual([]);
    expect(fixture.tables).toEqual([]);
    fixture.error = { code: 'phase_read_failed' };
    await expect(getPhaseRatingHistoryByMatches(['match'])).rejects.toEqual(fixture.error);
    expect(fixture.tables).toEqual(['phase_rating_history']);
  });
});

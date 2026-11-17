import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMixedRatingStorage, getPhaseRatingHistoryByMatches } from '../rating-streak-streams';
import type { Tables } from '@/types/database';

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Tables<'rating_history'>[]>,
  calls: [] as Array<{ table: string; ids: string[]; from: number; to: number }>,
  tables: [] as string[],
  error: null as unknown,
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: {
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
});

describe('source-specific phase rating verification', () => {
  it('never accepts complete legacy history when phase history is absent', async () => {
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

  it('does not query empty input and propagates a phase read failure', async () => {
    expect(await getPhaseRatingHistoryByMatches([])).toEqual([]);
    expect(fixture.tables).toEqual([]);
    fixture.error = { code: 'phase_read_failed' };
    await expect(getPhaseRatingHistoryByMatches(['match'])).rejects.toEqual(fixture.error);
    expect(fixture.tables).toEqual(['phase_rating_history']);
  });
});

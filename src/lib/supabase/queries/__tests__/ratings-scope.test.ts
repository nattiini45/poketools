/**
 * The reads behind "test leagues stay out of ratings" (src/lib/rating/rating-scope.ts):
 *   - `loadRatingScope` reads the test leagues, then their tournaments, each
 *     complete under `max_rows`, and never falls back on a failed read;
 *   - `getMatchTournamentIdForRating` is the live update's narrow match read;
 *   - `listSeasonCompletedMatchPlayerIds` lists whose curves a test-league
 *     flag rebuild rewrites.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Page = { data: unknown; error: { message: string; code?: string } | null };

const h = vi.hoisted(() => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const pages: Page[] = [];
  const builder: Record<string, unknown> = {};
  const record = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const m of ['from', 'select', 'in', 'eq', 'order']) {
    builder[m] = record(m);
  }
  const terminal = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      const next = pages.shift();
      if (!next) throw new Error('test: no scripted page left');
      return Promise.resolve(next);
    };
  builder.range = terminal('range');
  builder.maybeSingle = terminal('maybeSingle');
  return { calls, pages, builder };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: h.builder }));
vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  getTestAccountIds: vi.fn().mockResolvedValue([]),
}));

import { getMatchTournamentIdForRating, listSeasonCompletedMatchPlayerIds, loadRatingScope } from '../ratings';
import { matchCountsForRatings } from '@/lib/rating/rating-scope';

const SEASON = '33333333-3333-4333-8333-333333333333';
const MATCH = '44444444-4444-4444-8444-444444444444';

function callsOf(method: string) {
  return h.calls.filter((c) => c.method === method);
}

beforeEach(() => {
  h.calls.length = 0;
  h.pages.length = 0;
});

describe('loadRatingScope', () => {
  it('reads the test leagues, then their tournaments, and keeps those tournaments out of ratings', async () => {
    h.pages.push({ data: [{ id: 'season-test' }], error: null }, { data: [], error: null });
    h.pages.push({ data: [{ id: 't-1' }, { id: 't-2' }], error: null }, { data: [], error: null });

    const scope = await loadRatingScope();

    expect(callsOf('from').map((c) => c.args[0])).toEqual(['seasons', 'seasons', 'tournaments', 'tournaments']);
    expect(callsOf('eq')[0].args).toEqual(['is_test_season', true]);
    expect(callsOf('in')[0].args).toEqual(['season_id', ['season-test']]);
    expect(matchCountsForRatings({ tournament_id: 't-1' }, scope)).toBe(false);
    expect(matchCountsForRatings({ tournament_id: 't-2' }, scope)).toBe(false);
    expect(matchCountsForRatings({ tournament_id: 't-normal' }, scope)).toBe(true);
  });

  it('asks for no tournaments when no league is a test league', async () => {
    h.pages.push({ data: [], error: null });

    const scope = await loadRatingScope();

    expect(callsOf('from').map((c) => c.args[0])).toEqual(['seasons']);
    expect(scope.testSeasonTournamentIds.size).toBe(0);
  });

  it('reads every tournament past max_rows', async () => {
    h.pages.push({ data: [{ id: 'season-test' }], error: null }, { data: [], error: null });
    h.pages.push(
      { data: Array.from({ length: 1000 }, (_, i) => ({ id: `t-${i}` })), error: null },
      { data: [{ id: 't-1000' }], error: null },
    );

    const scope = await loadRatingScope();

    expect(scope.testSeasonTournamentIds.size).toBe(1001);
    expect(callsOf('range').slice(2).map((c) => c.args)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('throws a failed read unchanged (never treats a test league as a normal one)', async () => {
    const error = { message: 'boom', code: '57014' };
    h.pages.push({ data: null, error });
    await expect(loadRatingScope()).rejects.toBe(error);
  });
});

describe('getMatchTournamentIdForRating', () => {
  it('reads the tournament of the match', async () => {
    h.pages.push({ data: { tournament_id: 't-1' }, error: null });
    await expect(getMatchTournamentIdForRating(MATCH)).resolves.toBe('t-1');
    expect(callsOf('eq')[0].args).toEqual(['id', MATCH]);
  });

  it('returns null for a missing match and throws a failed read unchanged', async () => {
    h.pages.push({ data: null, error: null });
    await expect(getMatchTournamentIdForRating(MATCH)).resolves.toBeNull();

    const error = { message: 'boom' };
    h.pages.push({ data: null, error });
    await expect(getMatchTournamentIdForRating(MATCH)).rejects.toBe(error);
  });

  it('refuses a malformed match id before any request', async () => {
    await expect(getMatchTournamentIdForRating('not-a-uuid')).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
});

describe('listSeasonCompletedMatchPlayerIds', () => {
  it('lists the unique players of the league phases’ completed matches', async () => {
    h.pages.push({ data: [{ id: 'phase-1' }, { id: 'phase-2' }], error: null }, { data: [], error: null });
    h.pages.push(
      {
        data: [
          { player_1_id: 'p1', player_2_id: 'p2' },
          { player_1_id: 'p2', player_2_id: 'p3' },
        ],
        error: null,
      },
      { data: [], error: null },
    );

    await expect(listSeasonCompletedMatchPlayerIds(SEASON)).resolves.toEqual(['p1', 'p2', 'p3']);
    // One filter set per page request (readAllPages asks once more to prove the end).
    expect(new Set(callsOf('eq').map((c) => JSON.stringify(c.args)))).toEqual(
      new Set([JSON.stringify(['season_id', SEASON]), JSON.stringify(['status', 'completed'])]),
    );
    expect(callsOf('in')[0].args).toEqual(['tournament_id', ['phase-1', 'phase-2']]);
  });

  it('reads no matches for a league without phases', async () => {
    h.pages.push({ data: [], error: null });
    await expect(listSeasonCompletedMatchPlayerIds(SEASON)).resolves.toEqual([]);
    expect(callsOf('from').map((c) => c.args[0])).toEqual(['tournaments']);
  });

  it('throws a failed match read unchanged', async () => {
    const error = { message: 'boom' };
    h.pages.push({ data: [{ id: 'phase-1' }], error: null }, { data: [], error: null });
    h.pages.push({ data: null, error });
    await expect(listSeasonCompletedMatchPlayerIds(SEASON)).rejects.toBe(error);
  });
});

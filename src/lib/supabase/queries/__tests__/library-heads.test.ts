import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * The heads of the published library listing: the first `take` rows plus the exact total, read in `.range()` pages so a
 * merged listing over both stores can answer any offset exactly (never an approximated one).
 */

const CHAIN = ['from', 'select', 'not', 'or', 'overlaps', 'order', 'range'] as const;

const { mock } = vi.hoisted(() => {
  const calls: Record<string, Mock<(...args: unknown[]) => unknown>> = {};
  const builder: Record<string, unknown> = {};
  for (const name of ['from', 'select', 'not', 'or', 'overlaps', 'order', 'range']) {
    calls[name] = vi.fn<(...args: unknown[]) => unknown>();
    builder[name] = (...args: unknown[]) => {
      calls[name](...args);
      return builder;
    };
  }
  // PostgREST builders are thenable: awaiting the chain resolves the response a test queued on `range`.
  builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(calls.range()).then(onFulfilled, onRejected);
  return { mock: { calls, builder } };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mock.builder }));

import { listLibraryHead } from '@/lib/supabase/queries/teams';
import { listPhaseLibraryHead } from '@/lib/supabase/queries/phase-teams';

const legacyRows = Array.from({ length: 7 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  player_id: 'p1',
  pokemon: [{ species: 'Pikachu' }],
  library_title: `Team ${index}`,
  library_description: null,
  library_tags: null,
  library_published_at: `2026-10-0${index + 1}T10:00:00Z`,
  forked_from_team_id: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
}));

beforeEach(() => {
  for (const name of CHAIN) mock.calls[name].mockReset();
});

describe('listLibraryHead', () => {
  it('returns the first `take` rows in the listing order with the exact count of published rows', async () => {
    mock.calls.range.mockResolvedValue({ data: legacyRows, error: null, count: 7 });
    const result = await listLibraryHead(3);
    expect(mock.calls.not).toHaveBeenCalledWith('library_published_at', 'is', null);
    expect(mock.calls.order).toHaveBeenCalledWith('library_published_at', { ascending: false });
    expect(mock.calls.order).toHaveBeenCalledWith('id');
    expect(mock.calls.range).toHaveBeenCalledWith(0, 999);
    expect(result.data.map((row) => row.id)).toEqual(legacyRows.slice(0, 3).map((row) => row.id));
    expect(result.total).toBe(7);
  });

  it('carries the filters into the head read', async () => {
    mock.calls.range.mockResolvedValue({ data: [], error: null, count: 0 });
    await listLibraryHead(10, { search: 'rain', tags: ['rain'] });
    expect(mock.calls.overlaps).toHaveBeenCalledWith('library_tags', ['rain']);
    expect(mock.calls.or).toHaveBeenCalled();
  });
});

describe('listPhaseLibraryHead', () => {
  it('returns the native head from the same order, sliced to `take`, with its own exact total', async () => {
    mock.calls.range.mockResolvedValue({
      data: legacyRows.map((row) => ({ ...row, phase_id: 'phase-1', season_id: null, name: 'Native', match_id: null,
        import_source: 'manual', locked: false, is_draft_team: false, draft_pool_id: null,
        forked_from_phase_team_id: null })),
      error: null,
      count: 7,
    });
    const result = await listPhaseLibraryHead(2);
    expect(mock.calls.order).toHaveBeenCalledWith('library_published_at', { ascending: false });
    expect(mock.calls.order).toHaveBeenCalledWith('id');
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(7);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError',
] as const;

const { mockBuilder } = vi.hoisted(() => {
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError',
  ] as const;
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.single = vi.fn();
  builder.maybeSingle = vi.fn();
  return { mockBuilder: builder };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import {
  listReplayLibraryFacetRows,
  listReplayLibraryPage,
  listReplayLibraryRows,
  REPLAY_LIBRARY_READ_CHUNK,
} from '../replay-library';

const replayRow = {
  id: 'game-2',
  game_number: 2,
  replay_url: 'https://replay.pokemonshowdown.com/gen9ou-123',
  created_at: '2026-07-01T10:00:00Z',
  matches: {
    id: 'match-1',
    tournament_id: 'tournament-1',
    date_played: '2026-06-30T12:00:00Z',
    created_at: '2026-06-28T12:00:00Z',
    player_1: { name: 'Opponent 1', ps_username: 'opp1ps' },
    player_2: { name: 'Opponent 2', ps_username: 'opp2ps' },
    rounds: { name: 'Round 3' },
    tournaments: {
      name: 'Summer Open',
      seasons: { name: 'Summer League' },
    },
  },
};

function replayRowWithId(id: string) {
  return { ...replayRow, id, replay_url: `https://replay.pokemonshowdown.com/${id}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of chainMethods) {
    mockBuilder[method].mockReset();
    mockBuilder[method].mockReturnValue(mockBuilder);
  }
});

describe('listReplayLibraryRows', () => {
  it('returns spoiler-free replay rows with full label pieces', async () => {
    mockBuilder.range.mockReturnValueOnce({
      data: [replayRow],
      error: null,
      count: 1,
    });

    const result = await listReplayLibraryRows();

    expect(result).toEqual([
      {
        label: 'Opponent 1 vs Opponent 2, Summer League, Round 3, match 2',
        date: '2026-06-30T12:00:00Z',
        league: 'Summer League',
        tournamentName: 'Summer Open',
        round: 'Round 3',
        matchNumber: 2,
        player1Name: 'Opponent 1',
        player1PsUsername: 'opp1ps',
        player2Name: 'Opponent 2',
        player2PsUsername: 'opp2ps',
        matchUrl: '/tournaments/tournament-1/matches/match-1',
        replayUrl: 'https://replay.pokemonshowdown.com/gen9ou-123',
      },
    ]);
  });

  it('uses safe fallback values when league or round metadata is missing', async () => {
    mockBuilder.range.mockReturnValueOnce({
      data: [
        {
          ...replayRow,
          matches: {
            ...replayRow.matches,
            rounds: null,
            tournaments: {
              ...replayRow.matches.tournaments,
              seasons: null,
            },
          },
        },
      ],
      error: null,
      count: 1,
    });

    const result = await listReplayLibraryRows();

    expect(result[0]).toMatchObject({
      label: 'Opponent 1 vs Opponent 2, Unknown league, Unknown round, match 2',
      league: 'Unknown league',
      round: 'Unknown round',
    });
  });

  it('falls back to the game created date when the match date is missing', async () => {
    mockBuilder.range.mockReturnValueOnce({
      data: [
        {
          ...replayRow,
          created_at: '2026-07-02T08:00:00Z',
          matches: {
            ...replayRow.matches,
            date_played: null,
          },
        },
      ],
      error: null,
      count: 1,
    });

    const result = await listReplayLibraryRows();

    expect(result[0].date).toBe('2026-07-02T08:00:00Z');
  });

  it('does not apply a default row cap when no limit is provided', async () => {
    mockBuilder.range.mockReturnValueOnce({
      data: [replayRow],
      error: null,
      count: 1,
    });

    const result = await listReplayLibraryRows();

    expect(result).toHaveLength(1);
    expect(mockBuilder.limit).not.toHaveBeenCalled();
  });

  it('filters to rows that actually have a replay URL and orders newest first', async () => {
    mockBuilder.limit.mockReturnValue({
      data: [],
      error: null,
    });

    await listReplayLibraryRows(24);

    expect(mockBuilder.from).toHaveBeenCalledWith('games');
    expect(mockBuilder.eq).toHaveBeenCalledWith('parsed', true);
    expect(mockBuilder.eq).toHaveBeenCalledWith('source', 'ps_replay');
    expect(mockBuilder.neq).toHaveBeenCalledWith('replay_url', '');
    expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockBuilder.limit).toHaveBeenCalledWith(24);
  });

  it('throws when the query fails', async () => {
    mockBuilder.range.mockReturnValueOnce({
      data: null,
      error: new Error('replay query failed'),
      count: null,
    });

    await expect(listReplayLibraryRows()).rejects.toThrow('replay query failed');
  });
});

describe('listReplayLibraryRows (reads past max_rows)', () => {
  it('pages with .range() until the exact count has arrived', async () => {
    const first = Array.from({ length: REPLAY_LIBRARY_READ_CHUNK }, (_, i) => replayRowWithId(`g${i}`));
    const second = Array.from({ length: 500 }, (_, i) => replayRowWithId(`g${1000 + i}`));
    mockBuilder.range
      .mockReturnValueOnce({ data: first, error: null, count: 1500 })
      .mockReturnValueOnce({ data: second, error: null, count: null });

    const result = await listReplayLibraryRows();

    // Before: one unbounded read, silently capped at 1000 rows by PostgREST max_rows.
    expect(result).toHaveLength(1500);
    expect(mockBuilder.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockBuilder.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(mockBuilder.select).toHaveBeenNthCalledWith(1, expect.any(String), { count: 'exact' });
    expect(mockBuilder.select).toHaveBeenNthCalledWith(2, expect.any(String), undefined);
    expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockBuilder.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(mockBuilder.limit).not.toHaveBeenCalled();
  });

  it('keeps paging when the server returns fewer rows than a chunk', async () => {
    const first = Array.from({ length: 400 }, (_, i) => replayRowWithId(`g${i}`));
    const second = Array.from({ length: 200 }, (_, i) => replayRowWithId(`g${400 + i}`));
    mockBuilder.range
      .mockReturnValueOnce({ data: first, error: null, count: 600 })
      .mockReturnValueOnce({ data: second, error: null, count: null });

    const result = await listReplayLibraryRows();

    expect(result).toHaveLength(600);
    expect(mockBuilder.range).toHaveBeenNthCalledWith(2, 400, 1399);
  });

  it('drops a row repeated across chunks by a concurrent insert', async () => {
    mockBuilder.range
      .mockReturnValueOnce({ data: [replayRowWithId('a'), replayRowWithId('b')], error: null, count: 4 })
      .mockReturnValueOnce({ data: [replayRowWithId('b'), replayRowWithId('c')], error: null, count: null })
      .mockReturnValueOnce({ data: [], error: null, count: null });

    const result = await listReplayLibraryRows();

    expect(result.map((r) => r.replayUrl)).toEqual([
      'https://replay.pokemonshowdown.com/a',
      'https://replay.pokemonshowdown.com/b',
      'https://replay.pokemonshowdown.com/c',
    ]);
  });
});

describe('listReplayLibraryPage', () => {
  it('reads one page with .range() and an exact count', async () => {
    mockBuilder.range.mockReturnValueOnce({ data: [replayRow], error: null, count: 45 });

    const result = await listReplayLibraryPage({ page: 2, perPage: 20, ascending: false });

    expect(mockBuilder.from).toHaveBeenCalledWith('games');
    expect(mockBuilder.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
    expect(mockBuilder.eq).toHaveBeenCalledWith('parsed', true);
    expect(mockBuilder.eq).toHaveBeenCalledWith('source', 'ps_replay');
    expect(mockBuilder.neq).toHaveBeenCalledWith('replay_url', '');
    expect(mockBuilder.order).toHaveBeenNthCalledWith(1, 'matches(date_played)', {
      ascending: false,
      nullsFirst: true,
    });
    expect(mockBuilder.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false });
    expect(mockBuilder.range).toHaveBeenCalledTimes(1);
    expect(mockBuilder.range).toHaveBeenCalledWith(20, 39);
    expect(mockBuilder.limit).not.toHaveBeenCalled();
    expect(result.total).toBe(45);
    expect(result.page).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].label).toBe('Opponent 1 vs Opponent 2, Summer League, Round 3, match 2');
  });

  it('sorts oldest first with in-progress matches last when ascending', async () => {
    mockBuilder.range.mockReturnValueOnce({ data: [], error: null, count: 0 });

    const result = await listReplayLibraryPage({ page: 1, perPage: 50, ascending: true });

    expect(mockBuilder.order).toHaveBeenNthCalledWith(1, 'matches(date_played)', {
      ascending: true,
      nullsFirst: false,
    });
    expect(mockBuilder.range).toHaveBeenCalledWith(0, 49);
    expect(result).toEqual({ rows: [], total: 0, page: 1 });
  });

  it('serves the last page when PostgREST rejects an offset past the end', async () => {
    mockBuilder.range
      .mockReturnValueOnce({
        data: null,
        error: { code: 'PGRST103', message: 'Requested range not satisfiable' },
        count: null,
      })
      .mockReturnValueOnce({ data: [replayRow], error: null, count: 45 });
    // The head count query ends at .neq(); the two page queries continue to .range().
    mockBuilder.neq
      .mockReturnValueOnce(mockBuilder)
      .mockReturnValueOnce({ count: 45, error: null })
      .mockReturnValueOnce(mockBuilder);

    const result = await listReplayLibraryPage({ page: 9, perPage: 20, ascending: false });

    expect(mockBuilder.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact', head: true });
    expect(mockBuilder.range).toHaveBeenNthCalledWith(1, 160, 179);
    expect(mockBuilder.range).toHaveBeenNthCalledWith(2, 40, 59);
    expect(result.page).toBe(3);
    expect(result.total).toBe(45);
  });

  it('uses the returned count to clamp an empty page past the end', async () => {
    mockBuilder.range
      .mockReturnValueOnce({ data: [], error: null, count: 45 })
      .mockReturnValueOnce({ data: [replayRow], error: null, count: 45 });

    const result = await listReplayLibraryPage({ page: 5, perPage: 20, ascending: false });

    expect(mockBuilder.range).toHaveBeenNthCalledWith(2, 40, 59);
    expect(mockBuilder.select).not.toHaveBeenCalledWith(expect.any(String), {
      count: 'exact',
      head: true,
    });
    expect(result.page).toBe(3);
  });

  it('throws other query errors', async () => {
    mockBuilder.range.mockReturnValueOnce({ data: null, error: new Error('page failed'), count: null });

    await expect(
      listReplayLibraryPage({ page: 1, perPage: 20, ascending: false }),
    ).rejects.toThrow('page failed');
  });
});

describe('listReplayLibraryFacetRows', () => {
  it('reads only the dropdown names, with the same fallbacks as full rows', async () => {
    mockBuilder.range.mockReturnValueOnce({
      data: [
        { matches: replayRow.matches },
        {
          matches: {
            rounds: null,
            tournaments: { name: 'Weekly #1', seasons: null },
          },
        },
      ],
      error: null,
      count: 2,
    });

    const result = await listReplayLibraryFacetRows();

    const [select] = mockBuilder.select.mock.calls[0] as [string];
    expect(select).not.toContain('replay_url');
    expect(select).not.toContain('player_1');
    expect(mockBuilder.range).toHaveBeenCalledWith(0, REPLAY_LIBRARY_READ_CHUNK - 1);
    expect(result).toEqual([
      { league: 'Summer League', tournamentName: 'Summer Open', round: 'Round 3' },
      { league: 'Unknown league', tournamentName: 'Weekly #1', round: 'Unknown round' },
    ]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ──────────────────────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'filter', 'not', 'or', 'order', 'limit', 'range', 'match',
  'returns', 'throwOnError',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
    'contains', 'filter', 'not', 'or', 'order', 'limit', 'range', 'match',
    'returns', 'throwOnError',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

vi.mock('@/lib/utils/uuid', () => ({
  assertValidUuid: vi.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────
import {
  getBattleStatsForTournament,
  getBattleStatsByMatch,
  getOpponentBattleStatsInTournament,
  getPlayerBattleStats,
  getBattleStatsForSeason,
  getBattleStatsForTournaments,
} from '../games';

// ── Fixtures ───────────────────────────────────────────────────────
const battleStatRow = {
  id: 'bs-1',
  game_id: 'g-1',
  player_id: 'p-1',
  pokemon_name: 'Pikachu',
  was_brought: true,
  was_lead: true,
  kos_dealt: 2,
  was_koed: false,
  moves_used: ['Thunderbolt', 'Volt Switch'],
  turns_active: 5,
  match_won: true,
  created_at: '2025-01-01T00:00:00Z',
};

function resetMocks() {
  // mockReset clears calls, instances, AND the mockReturnValueOnce queue.
  // mockClear alone leaves stale once-values that leak between tests.
  for (const m of chainMethods) {
    mockBuilder[m].mockReset().mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockReset();
  mockBuilder.maybeSingle.mockReset();
}

beforeEach(resetMocks);

// ====================================================================
// LINES 224-475 — functions not covered by rounds-games.test.ts
// ====================================================================

describe('getBattleStatsForTournament', () => {
  it('returns mapped tournament battle stats with round numbers', async () => {
    // Chain: from().select().eq().order().order().range() -> terminal .range
    mockBuilder.range.mockReturnValue({
      data: [
        {
          id: 'bs-1',
          game_id: 'g-1',
          player_id: 'p-1',
          pokemon_name: 'Pikachu',
          was_brought: true,
          was_lead: true,
          kos_dealt: 2,
          was_koed: false,
          moves_used: ['Thunderbolt'],
          turns_active: 5,
          match_won: true,
          games: {
            match_id: 'm-1',
            matches: { tournament_id: 't-1', rounds: { round_number: 1 } },
          },
        },
      ],
      error: null,
    });

    const result = await getBattleStatsForTournament('t-1');
    expect(result).toHaveLength(1);
    // Narrow rows: extra columns in the response never reach the result.
    expect(result[0]).toEqual({
      game_id: 'g-1',
      player_id: 'p-1',
      pokemon_name: 'Pikachu',
      was_brought: true,
      was_lead: true,
      kos_dealt: 2,
      was_koed: false,
      round_number: 1,
    });
  });

  it('selects only the ranking columns (no moves_used, turns_active, match_won or id)', async () => {
    mockBuilder.range.mockReturnValue({ data: [], error: null });

    await getBattleStatsForTournament('t-1');

    const select = String(mockBuilder.select.mock.calls[0][0]);
    expect(select).not.toMatch(/moves_used|turns_active|match_won|match_id/);
    expect(select).not.toMatch(/(^|[\s,])id\s*,/);
    for (const column of ['game_id', 'player_id', 'pokemon_name', 'was_brought', 'was_lead', 'kos_dealt', 'was_koed', 'round_number']) {
      expect(select).toContain(column);
    }
    expect(mockBuilder.eq).toHaveBeenCalledWith('games.matches.tournament_id', 't-1');
  });

  it('throws on database error', async () => {
    mockBuilder.range.mockReturnValue({ data: null, error: new Error('db err') });
    await expect(getBattleStatsForTournament('t-1')).rejects.toThrow('db err');
  });
});

describe('getBattleStatsByMatch', () => {
  it('returns grouped stats by game_id', async () => {
    // First query: .from('games').select('id').eq('match_id', ...) -> terminal .eq
    mockBuilder.eq.mockReturnValueOnce({
      data: [{ id: 'g-1' }, { id: 'g-2' }],
      error: null,
    });
    // Second query: .from('battle_stats').select('*').in('game_id', [...]) -> terminal .in
    mockBuilder.in.mockReturnValueOnce({
      data: [
        { ...battleStatRow, game_id: 'g-1' },
        { ...battleStatRow, id: 'bs-2', game_id: 'g-2' },
      ],
      error: null,
    });

    const result = await getBattleStatsByMatch('m-1');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['g-1']).toHaveLength(1);
    expect(result['g-2']).toHaveLength(1);
  });

  it('returns empty object when no games exist', async () => {
    mockBuilder.eq.mockReturnValueOnce({ data: [], error: null });
    const result = await getBattleStatsByMatch('m-99');
    expect(result).toEqual({});
  });

  it('throws when games query fails', async () => {
    mockBuilder.eq.mockReturnValueOnce({ data: null, error: new Error('games err') });
    await expect(getBattleStatsByMatch('m-1')).rejects.toThrow('games err');
  });

  it('throws when battle stats query fails', async () => {
    mockBuilder.eq.mockReturnValueOnce({
      data: [{ id: 'g-1' }],
      error: null,
    });
    mockBuilder.in.mockReturnValueOnce({ data: null, error: new Error('stats err') });
    await expect(getBattleStatsByMatch('m-1')).rejects.toThrow('stats err');
  });
});

describe('getOpponentBattleStatsInTournament', () => {
  /**
   * fetchBattleStatsForPlayerInScope chain (3 sequential queries):
   * 1. from('matches').select('id').in('tournament_id').eq('status').or(...) -> terminal .or
   *    - .in() must return builder (chain continues)
   *    - .eq() must return builder (chain continues)
   *    - .or() is terminal
   * 2. from('games').select('id').in('match_id') -> terminal .in
   *    - first .in() returned builder, this second .in() is terminal
   * 3. from('battle_stats').select('*').in('game_id').eq('player_id') -> terminal .eq
   *    - .in() must return builder (chain continues)
   *    - .eq() is terminal
   *
   * Mock ordering must follow: in(builder), or(terminal), in(terminal), in(builder), eq(terminal)
   */
  /**
   * Sets up mockReturnValueOnce in the exact order the runtime will consume them.
   *
   * Runtime execution order for fetchBattleStatsForPlayerInScope:
   *   .from('matches').select('id')
   *   .in('tournament_id', ...)   <- 1st .in() call
   *   .eq('status', 'completed') <- 1st .eq() call
   *   .or(...)                   <- terminal for matches query
   *
   *   .from('games').select('id')
   *   .in('match_id', ...)       <- 2nd .in() call, terminal for games query
   *
   *   .from('battle_stats').select('*')
   *   .in('game_id', ...)        <- 3rd .in() call
   *   .eq('player_id', ...)      <- 2nd .eq() call, terminal for stats query
   */
  function mockFetchScope(
    matchData: { data: unknown[] | null; error: Error | null },
    gameData?: { data: unknown[] | null; error: Error | null },
    statsData?: { data: unknown[] | null; error: Error | null },
  ) {
    // Query 1: .in('tournament_id') -> builder, .eq('status') -> builder, .or() -> terminal
    mockBuilder.in.mockReturnValueOnce(mockBuilder); // 1st .in() -> chain continues
    mockBuilder.eq.mockReturnValueOnce(mockBuilder); // 1st .eq('status') -> chain continues
    mockBuilder.or.mockReturnValueOnce(matchData);   // .or() -> terminal

    if (!gameData) return; // matches failed or empty, no further queries

    // Query 2: .in('match_id') -> terminal
    mockBuilder.in.mockReturnValueOnce(gameData);    // 2nd .in() -> terminal

    if (!statsData) return; // games failed or empty, no further queries

    // Query 3: .in('game_id') -> builder, .eq('player_id') -> terminal
    mockBuilder.in.mockReturnValueOnce(mockBuilder); // 3rd .in() -> chain continues
    mockBuilder.eq.mockReturnValueOnce(statsData);   // 2nd .eq() -> terminal
  }

  it('returns tournament-scope stats when >= 3 exist', async () => {
    mockFetchScope(
      { data: [{ id: 'match-1' }], error: null },
      { data: [{ id: 'g-1' }], error: null },
      {
        data: [
          { ...battleStatRow, id: 'bs-1' },
          { ...battleStatRow, id: 'bs-2' },
          { ...battleStatRow, id: 'bs-3' },
        ],
        error: null,
      },
    );

    const result = await getOpponentBattleStatsInTournament('opp-1', 't-1');
    expect(result).toHaveLength(3);
  });

  it('returns tournament stats when no seasonId even if < 3', async () => {
    mockFetchScope(
      { data: [{ id: 'match-1' }], error: null },
      { data: [{ id: 'g-1' }], error: null },
      { data: [{ ...battleStatRow, id: 'bs-1' }], error: null },
    );

    const result = await getOpponentBattleStatsInTournament('opp-1', 't-1');
    expect(result).toHaveLength(1);
  });

  it('returns empty when no matches found', async () => {
    mockFetchScope({ data: [], error: null });

    const result = await getOpponentBattleStatsInTournament('opp-1', 't-1');
    expect(result).toEqual([]);
  });

  it('returns empty when matches query errors (no throw, returns [])', async () => {
    mockFetchScope({ data: null, error: new Error('match err') });

    const result = await getOpponentBattleStatsInTournament('opp-1', 't-1');
    expect(result).toEqual([]);
  });

  it('falls back to season scope when tournament has < 3 stats', async () => {
    // First fetchBattleStatsForPlayerInScope: tournament scope, returns 2 stats (< 3)
    mockFetchScope(
      { data: [{ id: 'match-1' }], error: null },
      { data: [{ id: 'g-1' }], error: null },
      {
        data: [
          { ...battleStatRow, id: 'bs-1' },
          { ...battleStatRow, id: 'bs-2' },
        ],
        error: null,
      },
    );

    // Season tournaments query: from('tournaments').select('id').eq('season_id') -> terminal .eq
    mockBuilder.eq.mockReturnValueOnce({
      data: [{ id: 't-1' }, { id: 't-2' }],
      error: null,
    });

    // Second fetchBattleStatsForPlayerInScope: season scope
    mockFetchScope(
      { data: [{ id: 'match-1' }, { id: 'match-2' }], error: null },
      { data: [{ id: 'g-1' }, { id: 'g-2' }], error: null },
      {
        data: [
          { ...battleStatRow, id: 'bs-1' },
          { ...battleStatRow, id: 'bs-2' },
          { ...battleStatRow, id: 'bs-3' },
          { ...battleStatRow, id: 'bs-4' },
        ],
        error: null,
      },
    );

    const result = await getOpponentBattleStatsInTournament('opp-1', 't-1', 'season-1');
    expect(result).toHaveLength(4);
  });

  it('returns tournament stats if season tournaments query fails', async () => {
    // Tournament scope returns empty (no matches)
    mockFetchScope({ data: [], error: null });

    // Season tournaments query fails
    mockBuilder.eq.mockReturnValueOnce({
      data: null,
      error: new Error('season err'),
    });

    const result = await getOpponentBattleStatsInTournament('opp-1', 't-1', 'season-1');
    expect(result).toEqual([]);
  });
});

describe('getPlayerBattleStats', () => {
  it('returns mapped player stats with tournament_id', async () => {
    // Chain: from('battle_stats').select().eq('player_id').limit()
    // .eq returns builder (default), .limit is terminal
    mockBuilder.limit.mockReturnValueOnce({
      data: [
        {
          pokemon_name: 'Pikachu',
          kos_dealt: 3,
          was_koed: false,
          match_won: true,
          games: {
            matches: { tournament_id: 't-1' },
          },
        },
      ],
      error: null,
    });

    const result = await getPlayerBattleStats('p-1');
    expect(result).toHaveLength(1);
    expect(result[0].pokemon_name).toBe('Pikachu');
    expect(result[0].tournament_id).toBe('t-1');
    expect(result[0].kos_dealt).toBe(3);
  });

  it('throws on database error', async () => {
    mockBuilder.limit.mockReturnValueOnce({ data: null, error: new Error('stats err') });
    await expect(getPlayerBattleStats('p-1')).rejects.toThrow('stats err');
  });
});

describe('getBattleStatsForSeason', () => {
  it('returns stats across all tournaments in a season', async () => {
    // First query: from('tournaments').select().eq() -> terminal .eq
    mockBuilder.eq.mockReturnValueOnce({
      data: [{ id: 't-1' }, { id: 't-2' }],
      error: null,
    });

    // Second query: from('battle_stats').select().in().order().order() -> builder, .range() -> terminal
    mockBuilder.in.mockReturnValueOnce(mockBuilder);
    mockBuilder.range.mockReturnValueOnce({
      data: [
        {
          id: 'bs-1',
          game_id: 'g-1',
          player_id: 'p-1',
          pokemon_name: 'Pikachu',
          was_brought: true,
          was_lead: true,
          kos_dealt: 2,
          was_koed: false,
          moves_used: ['Thunderbolt'],
          turns_active: 5,
          match_won: true,
          games: {
            match_id: 'm-1',
            matches: { tournament_id: 't-1', rounds: { round_number: 1 } },
          },
        },
      ],
      error: null,
    });

    const result = await getBattleStatsForSeason('s-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      game_id: 'g-1',
      player_id: 'p-1',
      pokemon_name: 'Pikachu',
      was_brought: true,
      was_lead: true,
      kos_dealt: 2,
      was_koed: false,
      round_number: 1,
    });
    expect(mockBuilder.in).toHaveBeenCalledWith('games.matches.tournament_id', ['t-1', 't-2']);
    const select = String(mockBuilder.select.mock.calls[1][0]);
    expect(select).not.toMatch(/moves_used|turns_active|match_won/);
  });

  it('returns empty array when season has no tournaments', async () => {
    mockBuilder.eq.mockReturnValueOnce({ data: [], error: null });
    const result = await getBattleStatsForSeason('s-empty');
    expect(result).toEqual([]);
  });

  it('throws when tournaments query fails', async () => {
    mockBuilder.eq.mockReturnValueOnce({ data: null, error: new Error('season err') });
    await expect(getBattleStatsForSeason('s-1')).rejects.toThrow('season err');
  });

  it('throws when battle stats query fails', async () => {
    mockBuilder.eq.mockReturnValueOnce({
      data: [{ id: 't-1' }],
      error: null,
    });
    mockBuilder.in.mockReturnValueOnce(mockBuilder);
    mockBuilder.range.mockReturnValueOnce({ data: null, error: new Error('stats err') });
    await expect(getBattleStatsForSeason('s-1')).rejects.toThrow('stats err');
  });
});

// ====================================================================
// D36: the tournament/season battle_stats reads stay complete under max_rows
// ====================================================================

describe('tournament battle_stats reads past the max_rows ceiling', () => {
  const MAX_ROWS = 1000; // supabase/config.toml

  function statRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      game_id: `g-${i}`,
      player_id: 'p-1',
      pokemon_name: `Mon${i}`,
      was_brought: true,
      was_lead: false,
      kos_dealt: 1,
      was_koed: false,
      games: { matches: { tournament_id: 't-1', rounds: { round_number: 1 } } },
    }));
  }

  /**
   * Serve `rows` the way PostgREST does: every response is capped at
   * `max_rows`, an explicit `.limit()` above it included.
   */
  function serve(rows: ReturnType<typeof statRows>) {
    mockBuilder.range.mockImplementation((from: number, to: number) => ({
      data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)),
      error: null,
    }));
    mockBuilder.limit.mockImplementation((n: number) => ({
      data: rows.slice(0, Math.min(n, MAX_ROWS)),
      error: null,
    }));
  }

  it('getBattleStatsForTournament pages with .range() instead of truncating at 1000', async () => {
    serve(statRows(2500));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await getBattleStatsForTournament('t-1');

      // Before: one .limit(10000) read, silently capped at 1000 rows.
      expect(result).toHaveLength(2500);
      expect(new Set(result.map((r) => r.game_id)).size).toBe(2500);
      expect(mockBuilder.range.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
      expect(mockBuilder.limit).not.toHaveBeenCalled();
      // A stable order is what makes paging safe.
      expect(mockBuilder.order.mock.calls).toEqual([
        ['created_at', { ascending: true }], ['id', { ascending: true }],
        ['created_at', { ascending: true }], ['id', { ascending: true }],
        ['created_at', { ascending: true }], ['id', { ascending: true }],
      ]);
      expect(mockBuilder.eq).toHaveBeenCalledWith('games.matches.tournament_id', 't-1');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('getBattleStatsForTournaments (the season read) pages the same way', async () => {
    serve(statRows(1200));

    const result = await getBattleStatsForTournaments(['t-1', 't-2'], 'season s-1');

    expect(result).toHaveLength(1200);
    expect(mockBuilder.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(mockBuilder.order.mock.calls).toEqual([
      ['created_at', { ascending: true }], ['id', { ascending: true }],
      ['created_at', { ascending: true }], ['id', { ascending: true }],
    ]);
    expect(mockBuilder.in).toHaveBeenCalledWith('games.matches.tournament_id', ['t-1', 't-2']);
    expect(mockBuilder.limit).not.toHaveBeenCalled();
  });

  it('up to max_rows rows is still one query', async () => {
    serve(statRows(3));

    expect(await getBattleStatsForTournament('t-1')).toHaveLength(3);
    expect(mockBuilder.range.mock.calls).toEqual([[0, 999]]);
  });

  it('a full last window costs one extra, empty read and no warning', async () => {
    serve(statRows(1000));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await getBattleStatsForTournament('t-1')).toHaveLength(1000);
      expect(mockBuilder.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the 10,000-row cap and now really reaches its warning', async () => {
    serve(statRows(10500));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await getBattleStatsForTournaments(['t-1'], 'season s-1');

      expect(result).toHaveLength(10000);
      expect(mockBuilder.range).toHaveBeenCalledTimes(10);
      expect(mockBuilder.range.mock.calls.at(-1)).toEqual([9000, 9999]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('getBattleStatsForTournaments: result count hit 10,000 limit for season s-1'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('a read error on a later page is thrown, not dropped', async () => {
    const rows = statRows(1500);
    mockBuilder.range.mockImplementation((from: number, to: number) =>
      from === 0
        ? { data: rows.slice(from, to + 1), error: null }
        : { data: null, error: new Error('page 2 failed') },
    );

    await expect(getBattleStatsForTournament('t-1')).rejects.toThrow('page 2 failed');
  });
});

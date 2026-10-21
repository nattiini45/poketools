import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ──────────────────────────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError', 'rpc',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError', 'rpc',
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

// ── Imports (after mock) ───────────────────────────────────────────────
import {
  getPlayerStreaks,
  upsertPlayerStreaks,
  getStreakLeaderboard,
} from '../streaks';

import {
  getPlayerSignatures,
  getPlayerSignaturesBatch,
  upsertPlayerSignatures,
} from '../signatures';

import {
  getAggregates,
  getTotalGamesInScope,
  getAllTimePlayerAggregates,
  getGlobalKillRankForPokemon,
  getAggregateForPokemon,
  getPlayerAggregatesForPokemon,
  getAggregateScopesForPokemon,
  getPlayerIdsForPokemon,
} from '../aggregates';

// ── Helpers ────────────────────────────────────────────────────────────
function resetMocks() {
  for (const m of chainMethods) {
    mockBuilder[m].mockClear().mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockReset();
  mockBuilder.maybeSingle.mockReset();
}

// ────────────────────────────────────────────────────────────────────────
// Streaks
// ────────────────────────────────────────────────────────────────────────
describe('queries/streaks', () => {
  beforeEach(resetMocks);

  const streakRow = {
    id: 's1',
    player_id: 'p1',
    current_win_streak: 3,
    best_win_streak: 5,
    current_loss_streak: 0,
    best_loss_streak: 2,
    current_ko_streak: 1,
    best_ko_streak: 4,
    current_flawless_streak: 0,
    best_flawless_streak: 1,
    last_match_id: 'm1',
  };

  describe('getPlayerStreaks', () => {
    it('returns mapped streak data', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: streakRow, error: null });

      const result = await getPlayerStreaks('p1');
      expect(result).toEqual(streakRow);
      expect(mockBuilder.from).toHaveBeenCalledWith('player_streaks');
      expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    });

    it('returns null when no data', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getPlayerStreaks('p-none');
      expect(result).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'DB error' },
      });
      await expect(getPlayerStreaks('p1')).rejects.toEqual({ message: 'DB error' });
    });
  });

  describe('upsertPlayerStreaks', () => {
    it('upserts and returns mapped data', async () => {
      mockBuilder.single.mockResolvedValue({ data: streakRow, error: null });

      const result = await upsertPlayerStreaks('p1', {
        current_win_streak: 3,
        best_win_streak: 5,
        current_loss_streak: 0,
        best_loss_streak: 2,
        current_ko_streak: 1,
        best_ko_streak: 4,
        current_flawless_streak: 0,
        best_flawless_streak: 1,
        last_match_id: 'm1',
      });

      expect(result).toEqual(streakRow);
      expect(mockBuilder.upsert).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'upsert error' },
      });

      await expect(
        upsertPlayerStreaks('p1', {
          current_win_streak: 0,
          best_win_streak: 0,
          current_loss_streak: 0,
          best_loss_streak: 0,
          current_ko_streak: 0,
          best_ko_streak: 0,
          current_flawless_streak: 0,
          best_flawless_streak: 0,
          last_match_id: null,
        }),
      ).rejects.toEqual({ message: 'upsert error' });
    });
  });

  describe('getStreakLeaderboard', () => {
    it('returns mapped list ordered by best_win_streak', async () => {
      mockBuilder.order.mockReturnValue({
        data: [streakRow],
        error: null,
      });

      const result = await getStreakLeaderboard();
      expect(result).toHaveLength(1);
      expect(result[0].best_win_streak).toBe(5);
      expect(mockBuilder.order).toHaveBeenCalledWith('best_win_streak', { ascending: false });
    });

    it('returns empty on no data', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await getStreakLeaderboard();
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'leaderboard error' },
      });
      await expect(getStreakLeaderboard()).rejects.toEqual({ message: 'leaderboard error' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Signatures
// ────────────────────────────────────────────────────────────────────────
describe('queries/signatures', () => {
  beforeEach(resetMocks);

  const sigRow = {
    id: 'sig1',
    player_id: 'p1',
    signatures: [{ pokemon_name: 'Charizard', games: 10 }],
    updated_at: '2025-01-01T00:00:00Z',
  };

  describe('getPlayerSignatures', () => {
    it('returns mapped signatures', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: sigRow, error: null });

      const result = await getPlayerSignatures('p1');
      expect(result).not.toBeNull();
      expect(result!.signatures).toEqual([{ pokemon_name: 'Charizard', games: 10 }]);
    });

    it('returns null when no data', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getPlayerSignatures('p-none');
      expect(result).toBeNull();
    });

    it('handles non-array signatures gracefully', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { ...sigRow, signatures: 'invalid' },
        error: null,
      });

      const result = await getPlayerSignatures('p1');
      expect(result!.signatures).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'sig error' },
      });
      await expect(getPlayerSignatures('p1')).rejects.toEqual({ message: 'sig error' });
    });
  });

  describe('getPlayerSignaturesBatch', () => {
    it('returns empty map for empty input', async () => {
      const result = await getPlayerSignaturesBatch([]);
      expect(result.size).toBe(0);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('returns map keyed by player_id', async () => {
      mockBuilder.in.mockReturnValue({
        data: [
          { player_id: 'p1', signatures: [{ pokemon_name: 'Pikachu' }] },
          { player_id: 'p2', signatures: [{ pokemon_name: 'Eevee' }] },
        ],
        error: null,
      });

      const result = await getPlayerSignaturesBatch(['p1', 'p2']);
      expect(result.get('p1')).toEqual([{ pokemon_name: 'Pikachu' }]);
      expect(result.get('p2')).toEqual([{ pokemon_name: 'Eevee' }]);
    });

    it('throws on error', async () => {
      mockBuilder.in.mockReturnValue({
        data: null,
        error: { message: 'batch error' },
      });
      await expect(getPlayerSignaturesBatch(['p1'])).rejects.toEqual({
        message: 'batch error',
      });
    });
  });

  describe('upsertPlayerSignatures', () => {
    it('upserts and returns mapped data', async () => {
      mockBuilder.single.mockResolvedValue({ data: sigRow, error: null });

      const result = await upsertPlayerSignatures('p1', [
        { pokemon_name: 'Charizard', games: 10 } as never,
      ]);

      expect(result.id).toBe('sig1');
      expect(mockBuilder.upsert).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'upsert sig error' },
      });
      await expect(upsertPlayerSignatures('p1', [])).rejects.toEqual({
        message: 'upsert sig error',
      });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Aggregates
// ────────────────────────────────────────────────────────────────────────
describe('queries/aggregates', () => {
  beforeEach(resetMocks);

  const aggRow = {
    id: 'a1',
    scope_type: 'tournament',
    scope_id: 't1',
    pokemon_name: 'Garchomp',
    total_appearances: 10,
    total_brought: 8,
    total_led: 3,
    total_kos_dealt: 12,
    total_koed: 4,
    total_wins: 6,
    total_games: 10,
    move_counts: { Earthquake: 5, 'Dragon Claw': 3 },
    last_updated: '2025-01-01T00:00:00Z',
  };

  const playerAggRow = {
    ...aggRow,
    id: 'pa1',
    player_id: 'p1',
  };

  // ── getAggregates ─────────────────────────────────────────────────
  describe('getAggregates', () => {
    it('returns aggregates for a scoped query', async () => {
      mockBuilder.order.mockReturnValue({ data: [aggRow], error: null });

      const result = await getAggregates('tournament', 't1');
      expect(result).toHaveLength(1);
      expect(result[0].pokemon_name).toBe('Garchomp');
      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_type', 'tournament');
      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_id', 't1');
    });

    it('uses is(null) when scopeId is null', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });

      await getAggregates('all_time', null);
      expect(mockBuilder.is).toHaveBeenCalledWith('scope_id', null);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'agg error' },
      });
      await expect(getAggregates('tournament', 't1')).rejects.toEqual({
        message: 'agg error',
      });
    });
  });

  // updateAggregatesForScope, applyAggregateJob and rollbackGameAggregates
  // (scopes, deltas, RPC payloads, outcomes) are covered in
  // aggregate-apply.test.ts.

  // ── getTotalGamesInScope ──────────────────────────────────────────
  describe('getTotalGamesInScope', () => {
    it('returns number from RPC', async () => {
      mockBuilder.rpc.mockResolvedValue({ data: 42, error: null });

      const result = await getTotalGamesInScope('tournament', 't1');
      expect(result).toBe(42);
      expect(mockBuilder.rpc).toHaveBeenCalledWith('get_total_games_in_scope', {
        p_scope_type: 'tournament',
        p_scope_id: 't1',
      });
    });

    it('returns 0 for non-number data', async () => {
      mockBuilder.rpc.mockResolvedValue({ data: null, error: null });
      const result = await getTotalGamesInScope('all_time', null);
      expect(result).toBe(0);
    });

    it('throws on error', async () => {
      mockBuilder.rpc.mockResolvedValue({ error: { message: 'rpc err' } });
      await expect(getTotalGamesInScope('tournament', 't1')).rejects.toEqual({
        message: 'rpc err',
      });
    });
  });

  // ── getAllTimePlayerAggregates ─────────────────────────────────────
  describe('getAllTimePlayerAggregates', () => {
    it('returns mapped player aggregates', async () => {
      mockBuilder.order.mockReturnValue({ data: [playerAggRow], error: null });

      const result = await getAllTimePlayerAggregates('p1');
      expect(result).toHaveLength(1);
      expect(result[0].player_id).toBe('p1');
      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_type', 'all_time');
      expect(mockBuilder.is).toHaveBeenCalledWith('scope_id', null);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'pa error' },
      });
      await expect(getAllTimePlayerAggregates('p1')).rejects.toEqual({
        message: 'pa error',
      });
    });
  });

  // ── getGlobalKillRankForPokemon ───────────────────────────────────
  describe('getGlobalKillRankForPokemon', () => {
    it('returns empty for empty input', async () => {
      const result = await getGlobalKillRankForPokemon([]);
      expect(result.rankings.size).toBe(0);
      expect(result.totalRanked).toBe(0);
    });

    it('computes dense rank correctly', async () => {
      mockBuilder.order.mockReturnValue({
        data: [
          { pokemon_name: 'Garchomp', total_kos_dealt: 50 },
          { pokemon_name: 'Landorus', total_kos_dealt: 40 },
          { pokemon_name: 'Pikachu', total_kos_dealt: 40 },
          { pokemon_name: 'Eevee', total_kos_dealt: 10 },
        ],
        error: null,
      });

      const result = await getGlobalKillRankForPokemon(['Garchomp', 'Pikachu', 'Eevee']);
      expect(result.totalRanked).toBe(4);
      expect(result.rankings.get('Garchomp')).toEqual({ rank: 1, kos: 50 });
      // Pikachu and Landorus tie at 40 so both rank 2
      expect(result.rankings.get('Pikachu')).toEqual({ rank: 2, kos: 40 });
      expect(result.rankings.get('Eevee')).toEqual({ rank: 4, kos: 10 });
    });

    it('returns empty rankings when data is null', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await getGlobalKillRankForPokemon(['Garchomp']);
      expect(result.rankings.size).toBe(0);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'rank error' },
      });
      await expect(getGlobalKillRankForPokemon(['X'])).rejects.toEqual({
        message: 'rank error',
      });
    });
  });

  // ── getAggregateForPokemon ────────────────────────────────────────
  describe('getAggregateForPokemon', () => {
    it('returns aggregate for a pokemon with scopeId', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: aggRow, error: null });

      const result = await getAggregateForPokemon('Garchomp', 'tournament', 't1');
      expect(result).not.toBeNull();
      expect(result!.pokemon_name).toBe('Garchomp');
    });

    it('uses is(null) when scopeId is null', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

      await getAggregateForPokemon('Garchomp', 'all_time', null);
      expect(mockBuilder.is).toHaveBeenCalledWith('scope_id', null);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getAggregateForPokemon('Unknown', 'all_time', null);
      expect(result).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'agg pokemon error' },
      });
      await expect(
        getAggregateForPokemon('X', 'all_time', null),
      ).rejects.toEqual({ message: 'agg pokemon error' });
    });
  });

  // ── getPlayerAggregatesForPokemon ─────────────────────────────────
  describe('getPlayerAggregatesForPokemon', () => {
    it('returns player aggregates', async () => {
      mockBuilder.order.mockReturnValue({ data: [playerAggRow], error: null });

      const result = await getPlayerAggregatesForPokemon('Garchomp', 'tournament', 't1');
      expect(result).toHaveLength(1);
    });

    it('filters by playerId when provided', async () => {
      mockBuilder.order.mockReturnValue({ data: [playerAggRow], error: null });

      await getPlayerAggregatesForPokemon('Garchomp', 'tournament', 't1', 'p1');
      expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'pa pokemon error' },
      });
      await expect(
        getPlayerAggregatesForPokemon('X', 'all_time', null),
      ).rejects.toEqual({ message: 'pa pokemon error' });
    });
  });

  // ── getAggregateScopesForPokemon ──────────────────────────────────
  describe('getAggregateScopesForPokemon', () => {
    it('returns scope list', async () => {
      mockBuilder.eq.mockReturnValue({
        data: [
          { scope_type: 'all_time', scope_id: null },
          { scope_type: 'tournament', scope_id: 't1' },
        ],
        error: null,
      });

      const result = await getAggregateScopesForPokemon('Garchomp');
      expect(result).toHaveLength(2);
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({
        data: null,
        error: { message: 'scope error' },
      });
      await expect(getAggregateScopesForPokemon('X')).rejects.toEqual({
        message: 'scope error',
      });
    });
  });

  // ── getPlayerIdsForPokemon ────────────────────────────────────────
  describe('getPlayerIdsForPokemon', () => {
    it('returns deduplicated player IDs', async () => {
      // select().eq('pokemon_name').eq('scope_type') -- 2 eq calls
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({
          data: [
            { player_id: 'p1' },
            { player_id: 'p2' },
            { player_id: 'p1' }, // duplicate
          ],
          error: null,
        });

      const result = await getPlayerIdsForPokemon('Garchomp');
      expect(result).toEqual(['p1', 'p2']);
    });

    it('throws on error', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({
          data: null,
          error: { message: 'player ids error' },
        });
      await expect(getPlayerIdsForPokemon('X')).rejects.toEqual({
        message: 'player ids error',
      });
    });
  });
});

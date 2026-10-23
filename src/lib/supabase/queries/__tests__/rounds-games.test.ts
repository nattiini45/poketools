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

// assertValidUuid is called in games.ts — mock it to be a no-op
vi.mock('@/lib/utils/uuid', () => ({
  assertValidUuid: vi.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────
import {
  getRoundsByTournament,
  getRoundById,
  createRound,
  updateRoundStatus,
  updateRoundBestOf,
  deleteRound,
} from '../rounds';

import {
  getGamesByMatch,
  getGameById,
  createGame,
  GameNumberConflictError,
  GAMES_MATCH_GAME_NUMBER_KEY,
  GAMES_REPLAY_HASH_KEY,
  ReplayAlreadyRecordedError,
  BATTLE_STATS_GAME_PLAYER_POKEMON_KEY,
  BattleStatsDuplicatePokemonError,
  findGameIdByReplayHash,
  markGameParsed,
  updateGameWinner,
  deleteUncountedGameRow,
  getGameWinCounts,
  getNextGameNumber,
  createBattleStats,
  deleteBattleStatsByGame,
  getBattleStatsByGame,
} from '../games';

// ── Fixtures ───────────────────────────────────────────────────────
const roundRow = {
  id: 'rd-1',
  tournament_id: 't-1',
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status: 'pending',
  pairings_generated: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const gameRow = {
  id: 'g-1',
  match_id: 'm-1',
  game_number: 1,
  winner_id: 'p-1',
  replay_url: 'https://replay.pokemonshowdown.com/test',
  source: 'manual',
  parsed: false,
  stats_locked: false,
  aggregate_applied_at: null,
  exclude_all_time: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

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

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

// ====================================================================
// ROUNDS
// ====================================================================
describe('queries/rounds', () => {
  // ── getRoundsByTournament ──
  describe('getRoundsByTournament', () => {
    it('returns rounds ordered by round_number', async () => {
      // Chain: .from.select.eq.order — terminal is .order
      mockBuilder.order.mockReturnValue({ data: [roundRow], error: null });
      const result = await getRoundsByTournament('t-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rd-1');
      expect(mockBuilder.from).toHaveBeenCalledWith('rounds');
      expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't-1');
      expect(mockBuilder.order).toHaveBeenCalledWith('round_number');
    });

    it('returns empty array when none', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      expect(await getRoundsByTournament('t-99')).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('db err') });
      await expect(getRoundsByTournament('t-1')).rejects.toThrow('db err');
    });
  });

  // ── getRoundById ──
  describe('getRoundById', () => {
    it('returns the round when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: roundRow, error: null });
      const result = await getRoundById('rd-1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Round 1');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getRoundById('missing')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getRoundById('rd-1')).rejects.toThrow('err');
    });
  });

  // ── createRound ──
  describe('createRound', () => {
    it('creates and returns the round', async () => {
      mockBuilder.single.mockResolvedValue({ data: roundRow, error: null });
      const result = await createRound({
        tournament_id: 't-1',
        name: 'Round 1',
        round_number: 1,
        best_of: 3,
      });
      expect(result.name).toBe('Round 1');
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tournament_id: 't-1',
          pairings_generated: true,
        }),
      );
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('insert fail') });
      await expect(
        createRound({ tournament_id: 't-1', name: 'R1', round_number: 1, best_of: 3 }),
      ).rejects.toThrow('insert fail');
    });

    it('maps the first-round guard (phase groups stale against the league groups) to 409 PHASE_GROUPS_STALE', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'PHASE_GROUPS_STALE', details: '{"tournament_id": "t-1"}', hint: null },
      });
      await expect(
        createRound({ tournament_id: 't-1', name: 'Round 1', round_number: 1, best_of: 3 }),
      ).rejects.toMatchObject({ code: 'PHASE_GROUPS_STALE', statusCode: 409 });
    });

    it('rethrows any other P0001 unchanged', async () => {
      const other = { code: 'P0001', message: 'SOMETHING_ELSE', details: null, hint: null };
      mockBuilder.single.mockResolvedValue({ data: null, error: other });
      await expect(
        createRound({ tournament_id: 't-1', name: 'Round 1', round_number: 1, best_of: 3 }),
      ).rejects.toBe(other);
    });
  });

  // ── updateRoundStatus ──
  describe('updateRoundStatus', () => {
    it('updates and returns the round', async () => {
      const updated = { ...roundRow, status: 'active' };
      mockBuilder.single.mockResolvedValue({ data: updated, error: null });
      const result = await updateRoundStatus('rd-1', 'active');
      expect(result.status).toBe('active');
      expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'active' });
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('fail') });
      await expect(updateRoundStatus('rd-1', 'completed')).rejects.toThrow('fail');
    });
  });

  // ── updateRoundBestOf ──
  describe('updateRoundBestOf', () => {
    it('updates best_of and returns the round', async () => {
      const updated = { ...roundRow, best_of: 5 };
      mockBuilder.single.mockResolvedValue({ data: updated, error: null });
      const result = await updateRoundBestOf('rd-1', 5);
      expect(result.best_of).toBe(5);
      expect(mockBuilder.update).toHaveBeenCalledWith({ best_of: 5 });
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('fail') });
      await expect(updateRoundBestOf('rd-1', 5)).rejects.toThrow('fail');
    });
  });

  // ── deleteRound ──
  describe('deleteRound', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteRound('rd-1')).resolves.toBeUndefined();
      expect(mockBuilder.from).toHaveBeenCalledWith('rounds');
      expect(mockBuilder.delete).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('fk constraint') });
      await expect(deleteRound('rd-1')).rejects.toThrow('fk constraint');
    });
  });
});

// ====================================================================
// GAMES
// ====================================================================
describe('queries/games', () => {
  // ── getGamesByMatch ──
  describe('getGamesByMatch', () => {
    it('returns games ordered by game_number', async () => {
      // Chain: .from.select.eq.order — terminal .order
      mockBuilder.order.mockReturnValue({ data: [gameRow], error: null });
      const result = await getGamesByMatch('m-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('g-1');
      expect(mockBuilder.from).toHaveBeenCalledWith('games');
      expect(mockBuilder.order).toHaveBeenCalledWith('game_number');
    });

    it('returns empty array when none', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      expect(await getGamesByMatch('m-99')).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getGamesByMatch('m-1')).rejects.toThrow('err');
    });
  });

  // ── getGameById ──
  describe('getGameById', () => {
    it('returns the game when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: gameRow, error: null });
      const result = await getGameById('g-1');
      expect(result).not.toBeNull();
      expect(result!.match_id).toBe('m-1');
    });

    it('maps exclude_all_time from the row through toGame', async () => {
      // Guards the frozen all_time gate: a row carrying exclude_all_time=true
      // must map through toGame to exclude_all_time=true. A missing select or
      // mapping would surface here instead of silently yielding undefined.
      const excludedRow = { ...gameRow, exclude_all_time: true };
      mockBuilder.maybeSingle.mockResolvedValue({ data: excludedRow, error: null });
      const result = await getGameById('g-1');
      expect(result).not.toBeNull();
      expect(result!.exclude_all_time).toBe(true);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getGameById('missing')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getGameById('g-1')).rejects.toThrow('err');
    });
  });

  // ── createGame ──
  describe('createGame', () => {
    it('creates and returns a game', async () => {
      mockBuilder.single.mockResolvedValue({ data: gameRow, error: null });
      const result = await createGame({
        match_id: 'm-1',
        game_number: 1,
        winner_id: 'p-1',
        source: 'manual',
        exclude_all_time: false,
      });
      expect(result.game_number).toBe(1);
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ match_id: 'm-1', source: 'manual' }),
      );
    });

    it('defaults replay_url to empty string and parsed to false', async () => {
      mockBuilder.single.mockResolvedValue({ data: gameRow, error: null });
      await createGame({ match_id: 'm-1', game_number: 1, winner_id: 'p-1', source: 'manual', exclude_all_time: false });
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ replay_url: '', parsed: false }),
      );
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('ins fail') });
      await expect(
        createGame({ match_id: 'm-1', game_number: 1, winner_id: 'p-1', source: 'manual', exclude_all_time: false }),
      ).rejects.toThrow('ins fail');
    });

    it('maps a unique violation of (match_id, game_number) to a 409 match_result_conflict (H2)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pgError = {
        code: '23505',
        message: `duplicate key value violates unique constraint "${GAMES_MATCH_GAME_NUMBER_KEY}"`,
        details: 'Key (match_id, game_number)=(m-1, 2) already exists.',
      };
      mockBuilder.single.mockResolvedValue({ data: null, error: pgError });

      const err = await createGame({ match_id: 'm-1', game_number: 2, winner_id: 'p-1', source: 'manual', exclude_all_time: false })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GameNumberConflictError);
      expect(err).toMatchObject({ code: 'match_result_conflict', statusCode: 409 });
      expect(errorSpy).toHaveBeenCalledWith(
        '[createGame] game 2 of match m-1 already exists (concurrent submission)',
        pgError,
      );
      errorSpy.mockRestore();
    });

    it('stores the replay hash in the same insert, and null when there is none', async () => {
      const hash = 'ab'.repeat(32);
      mockBuilder.single.mockResolvedValue({ data: gameRow, error: null });
      await createGame({
        match_id: 'm-1', game_number: 1, winner_id: 'p-1', source: 'ps_replay', exclude_all_time: false,
        replay_url: 'https://replay.pokemonshowdown.com/test', replay_hash: hash,
      });
      expect(mockBuilder.insert).toHaveBeenLastCalledWith(expect.objectContaining({ replay_hash: hash }));

      await createGame({ match_id: 'm-1', game_number: 2, winner_id: 'p-1', source: 'manual', exclude_all_time: false });
      expect(mockBuilder.insert).toHaveBeenLastCalledWith(expect.objectContaining({ replay_hash: null }));
    });

    it('maps a unique violation of games_replay_hash_key to a 409 replay_already_recorded (race-safe)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pgError = {
        code: '23505',
        message: `duplicate key value violates unique constraint "${GAMES_REPLAY_HASH_KEY}"`,
      };
      mockBuilder.single.mockResolvedValue({ data: null, error: pgError });

      const err = await createGame({
        match_id: 'm-1', game_number: 1, winner_id: 'p-1', source: 'ps_replay', exclude_all_time: false,
        replay_url: 'gen9ou-1', replay_hash: 'ab'.repeat(32),
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ReplayAlreadyRecordedError);
      expect(err).toMatchObject({ code: 'replay_already_recorded', statusCode: 409 });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[createGame] replay gen9ou-1 of match m-1'), pgError);
      errorSpy.mockRestore();
    });

    it('rethrows an unrelated unique violation unchanged (no masking)', async () => {
      const pgError = {
        code: '23505',
        message: 'duplicate key value violates unique constraint "games_pkey"',
      };
      mockBuilder.single.mockResolvedValue({ data: null, error: pgError });

      await expect(
        createGame({ match_id: 'm-1', game_number: 1, winner_id: 'p-1', source: 'manual', exclude_all_time: false }),
      ).rejects.toBe(pgError);
    });

    it('rethrows other database errors unchanged', async () => {
      const pgError = { code: '23503', message: 'insert or update on table "games" violates foreign key constraint' };
      mockBuilder.single.mockResolvedValue({ data: null, error: pgError });

      await expect(
        createGame({ match_id: 'm-1', game_number: 1, winner_id: 'p-1', source: 'manual', exclude_all_time: false }),
      ).rejects.toBe(pgError);
    });
  });

  // ── markGameParsed ──
  describe('markGameParsed', () => {
    it('updates parsed flag without error', async () => {
      // Chain: .from.update.eq — terminal .eq
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(markGameParsed('g-1')).resolves.toBeUndefined();
      expect(mockBuilder.update).toHaveBeenCalledWith({ parsed: true });
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('fail') });
      await expect(markGameParsed('g-1')).rejects.toThrow('fail');
    });
  });

  // ── updateGameWinner ──
  describe('updateGameWinner', () => {
    it('updates and returns the game', async () => {
      const updated = { ...gameRow, winner_id: 'p-2' };
      mockBuilder.single.mockResolvedValue({ data: updated, error: null });
      const result = await updateGameWinner('g-1', 'p-2');
      expect(result.winner_id).toBe('p-2');
      expect(mockBuilder.update).toHaveBeenCalledWith({ winner_id: 'p-2' });
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('fail') });
      await expect(updateGameWinner('g-1', 'p-2')).rejects.toThrow('fail');
    });
  });

  // ── deleteUncountedGameRow ──
  describe('deleteUncountedGameRow', () => {
    it('deletes in one statement fenced on a NULL marker', async () => {
      mockBuilder.select.mockReturnValueOnce(Promise.resolve({ data: [{ id: 'g-1' }], error: null }));
      await expect(deleteUncountedGameRow('g-1')).resolves.toBe('deleted');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'g-1');
      expect(mockBuilder.is).toHaveBeenCalledWith('aggregate_applied_at', null);
      expect(mockBuilder.maybeSingle).not.toHaveBeenCalled();
    });

    it("answers 'counted' when the row survived the fence (the marker is set)", async () => {
      mockBuilder.select.mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { id: 'g-1' }, error: null });
      await expect(deleteUncountedGameRow('g-1')).resolves.toBe('counted');
    });

    it("answers 'missing' when the row is gone", async () => {
      mockBuilder.select.mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      await expect(deleteUncountedGameRow('g-1')).resolves.toBe('missing');
    });

    it('throws a failed delete', async () => {
      mockBuilder.select.mockReturnValueOnce(Promise.resolve({ data: null, error: new Error('del fail') }));
      await expect(deleteUncountedGameRow('g-1')).rejects.toThrow('del fail');
    });

    it('throws a failed re-read', async () => {
      mockBuilder.select.mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('read fail') });
      await expect(deleteUncountedGameRow('g-1')).rejects.toThrow('read fail');
    });
  });

  // ── getGameWinCounts ──
  describe('getGameWinCounts', () => {
    it('counts wins for each player', async () => {
      // First call: games.select('winner_id').eq('match_id', ...) — terminal .eq
      // Second call: matches.select.eq.single
      // Both go through the same mockBuilder, so we sequence the mocks.
      // Call 1 (games select): .eq returns { data, error }
      mockBuilder.eq.mockReturnValueOnce({
        data: [{ winner_id: 'p-1' }, { winner_id: 'p-1' }, { winner_id: 'p-2' }],
        error: null,
      });
      // Call 2 (matches select): .single resolves
      mockBuilder.single.mockResolvedValueOnce({
        data: { player_1_id: 'p-1', player_2_id: 'p-2' },
        error: null,
      });

      const result = await getGameWinCounts('m-1');
      expect(result.player_1_wins).toBe(2);
      expect(result.player_2_wins).toBe(1);
      expect(result.player_ids).toEqual(['p-1', 'p-2']);
    });

    it('throws on games query error', async () => {
      mockBuilder.eq.mockReturnValueOnce({ data: null, error: new Error('game err') });
      await expect(getGameWinCounts('m-1')).rejects.toThrow('game err');
    });

    it('throws on match query error', async () => {
      mockBuilder.eq.mockReturnValueOnce({ data: [], error: null });
      mockBuilder.single.mockResolvedValueOnce({
        data: null,
        error: new Error('match err'),
      });
      await expect(getGameWinCounts('m-1')).rejects.toThrow('match err');
    });
  });

  // ── getNextGameNumber ──
  describe('getNextGameNumber', () => {
    it('returns next number when games exist', async () => {
      // Chain: .from.select.eq.order.limit — terminal .limit
      mockBuilder.limit.mockReturnValue({
        data: [{ game_number: 3 }],
        error: null,
      });
      const result = await getNextGameNumber('m-1');
      expect(result).toBe(4);
    });

    it('returns 1 when no games exist', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });
      const result = await getNextGameNumber('m-1');
      expect(result).toBe(1);
    });

    it('throws on error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getNextGameNumber('m-1')).rejects.toThrow('err');
    });
  });

  // ── createBattleStats ──
  describe('createBattleStats', () => {
    it('creates and returns battle stats', async () => {
      // Chain: .from.insert.select — terminal .select (no .single; returns array)
      mockBuilder.select.mockReturnValue({ data: [battleStatRow], error: null });
      const result = await createBattleStats([{
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
      }]);
      expect(result).toHaveLength(1);
      expect(result[0].pokemon_name).toBe('Pikachu');
    });

    it('throws on error', async () => {
      mockBuilder.select.mockReturnValue({ data: null, error: new Error('ins fail') });
      await expect(
        createBattleStats([{
          game_id: 'g-1', player_id: 'p-1', pokemon_name: 'Pikachu',
        }]),
      ).rejects.toThrow('ins fail');
    });

    it('maps the one-row-per-Pokémon unique index to a 409 battle_stats_duplicate_pokemon', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const pgError = {
        code: '23505',
        message: `duplicate key value violates unique constraint "${BATTLE_STATS_GAME_PLAYER_POKEMON_KEY}"`,
      };
      mockBuilder.select.mockReturnValue({ data: null, error: pgError });

      const err = await createBattleStats([
        { game_id: 'g-1', player_id: 'p-1', pokemon_name: 'Pikachu' },
        { game_id: 'g-1', player_id: 'p-1', pokemon_name: 'pikachu' },
      ]).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BattleStatsDuplicatePokemonError);
      expect(err).toMatchObject({ code: 'battle_stats_duplicate_pokemon', statusCode: 409 });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('game g-1'), pgError);
      errorSpy.mockRestore();
    });
  });

  // ── findGameIdByReplayHash ──
  describe('findGameIdByReplayHash', () => {
    it('returns the bound game id, or null', async () => {
      const hash = 'cd'.repeat(32);
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { id: 'g-9' }, error: null });
      await expect(findGameIdByReplayHash(hash)).resolves.toBe('g-9');
      expect(mockBuilder.eq).toHaveBeenCalledWith('replay_hash', hash);

      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      await expect(findGameIdByReplayHash(hash)).resolves.toBeNull();
    });

    it('throws on a read error (fail closed)', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('read fail') });
      await expect(findGameIdByReplayHash('cd'.repeat(32))).rejects.toThrow('read fail');
    });
  });

  // ── deleteBattleStatsByGame ──
  describe('deleteBattleStatsByGame', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteBattleStatsByGame('g-1')).resolves.toBeUndefined();
      expect(mockBuilder.from).toHaveBeenCalledWith('battle_stats');
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('del') });
      await expect(deleteBattleStatsByGame('g-1')).rejects.toThrow('del');
    });
  });

  // ── getBattleStatsByGame ──
  describe('getBattleStatsByGame', () => {
    it('returns stats for the game', async () => {
      // Chain: .from.select.eq — terminal .eq
      mockBuilder.eq.mockReturnValue({ data: [battleStatRow], error: null });
      const result = await getBattleStatsByGame('g-1');
      expect(result).toHaveLength(1);
      expect(result[0].kos_dealt).toBe(2);
    });

    it('returns empty array when none', async () => {
      mockBuilder.eq.mockReturnValue({ data: [], error: null });
      expect(await getBattleStatsByGame('g-99')).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getBattleStatsByGame('g-1')).rejects.toThrow('err');
    });
  });
});

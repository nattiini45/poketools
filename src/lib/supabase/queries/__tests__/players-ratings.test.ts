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

// ratings.ts excludes test accounts via test-accounts helpers; stub them so the
// leaderboard tests don't need to mock the underlying player query chain.
vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  getTestAccountIds: vi.fn().mockResolvedValue([]),
  shouldExcludeFromAllTime: vi.fn().mockResolvedValue(false),
}));

// ── Imports (after mock) ───────────────────────────────────────────
import {
  getPlayerByDiscordId,
  getPlayerById,
  getPlayerByPsUsername,
  getPlayersByIds,
  listPlayers,
  createPlayer,
  updatePlayer,
  deletePlayer,
  getPlayerParticipations,
  resolvePlayerNames,
  getPublicPlayers,
} from '../players';

import {
  getPlayerRating,
  getRatingHistory,
  getRatingHistoryByMatch,
  getLeaderboard,
  getLeaderboardEntries,
  getPlayerRatingsBatch,
} from '../ratings';

// ── Fixtures ───────────────────────────────────────────────────────
const playerRow = {
  id: 'p-1',
  name: 'Ash',
  discord_id: '12345',
  ps_username: 'ash_k',
  champions_username: 'Ash_C',
  is_admin: false,
  is_creator: false,
  joined_date: '2025-01-01',
  avatar_url: null,
  avatar_config: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const ratingRow = {
  id: 'r-1',
  player_id: 'p-1',
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  peak_rating: 1500,
  peak_date: null,
  wins: 5,
  losses: 3,
  draws: 0,
  last_match_at: '2025-06-01T00:00:00Z',
};

const historyRow = {
  id: 'h-1',
  player_id: 'p-1',
  match_id: 'm-1',
  rating_before: 1500,
  rating_after: 1520,
  rd_before: 350,
  rd_after: 340,
  opponent_id: 'p-2',
  opponent_rating: 1480,
  result: 'win',
  rating_change: 20,
  recorded_at: '2025-06-01T00:00:00Z',
};

// ── Reset ──────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // Re-chain: every chain method returns mockBuilder so chains work
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

// ====================================================================
// PLAYERS
// ====================================================================
describe('queries/players', () => {
  // ── getPlayerByDiscordId ──
  describe('getPlayerByDiscordId', () => {
    it('returns a player when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: playerRow, error: null });
      const result = await getPlayerByDiscordId('12345');
      expect(result).not.toBeNull();
      expect(result!.discord_id).toBe('12345');
      expect(mockBuilder.from).toHaveBeenCalledWith('players');
      expect(mockBuilder.eq).toHaveBeenCalledWith('discord_id', '12345');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getPlayerByDiscordId('99999');
      expect(result).toBeNull();
    });

    it('throws on supabase error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('db error') });
      await expect(getPlayerByDiscordId('12345')).rejects.toThrow('db error');
    });
  });

  // ── getPlayerById ──
  describe('getPlayerById', () => {
    it('returns a player when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: playerRow, error: null });
      const result = await getPlayerById('p-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('p-1');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getPlayerById('missing')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('fail') });
      await expect(getPlayerById('p-1')).rejects.toThrow('fail');
    });
  });

  // ── getPlayerByPsUsername ──
  describe('getPlayerByPsUsername', () => {
    it('returns a player (case-insensitive)', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: playerRow, error: null });
      const result = await getPlayerByPsUsername('ASH_K');
      expect(result).not.toBeNull();
      expect(mockBuilder.ilike).toHaveBeenCalledWith('ps_username', 'ASH_K');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getPlayerByPsUsername('nobody')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('db') });
      await expect(getPlayerByPsUsername('x')).rejects.toThrow('db');
    });
  });

  // ── getPlayersByIds ──
  describe('getPlayersByIds', () => {
    it('returns empty map for empty input', async () => {
      const result = await getPlayersByIds([]);
      expect(result.size).toBe(0);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('returns map keyed by id', async () => {
      // .in() is the terminal method here (no .order/.limit after it)
      mockBuilder.in.mockReturnValue({ data: [playerRow], error: null });
      const result = await getPlayersByIds(['p-1']);
      expect(result.size).toBe(1);
      expect(result.get('p-1')!.name).toBe('Ash');
    });

    it('throws on error', async () => {
      mockBuilder.in.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getPlayersByIds(['p-1'])).rejects.toThrow('err');
    });
  });

  // ── listPlayers ──
  describe('listPlayers', () => {
    it('returns paginated players with total', async () => {
      // Chain ends with .ilike or .range depending on search; without search the await hits the query object
      // listPlayers builds a query then awaits it. The last chained call before await is .range (or .ilike).
      // We need the final chain result to resolve with data.
      mockBuilder.range.mockReturnValue({ data: [playerRow], error: null, count: 1 });
      const result = await listPlayers({ limit: 10, offset: 0 });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('applies a contains search over name and ps_username', async () => {
      mockBuilder.or.mockReturnValue({ data: [], error: null, count: 0 });
      const result = await listPlayers({ search: 'Ash' });
      expect(result.data).toHaveLength(0);
      expect(mockBuilder.or).toHaveBeenCalledWith('name.ilike."%Ash%",ps_username.ilike."%Ash%"');
    });

    it('keeps only active non-guest players with a login when registeredOnly is set, ANDed with the search', async () => {
      mockBuilder.or
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ data: [], error: null, count: 0 });
      await listPlayers({ search: 'Ash', registeredOnly: true });
      expect(mockBuilder.eq).toHaveBeenCalledWith('is_guest', false);
      // A banned or suspended account is no link target: claim_guest_player refuses it (SOURCE_NOT_ACTIVE).
      expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'active');
      expect(mockBuilder.or).toHaveBeenNthCalledWith(1, 'name.ilike."%Ash%",ps_username.ilike."%Ash%"');
      expect(mockBuilder.or).toHaveBeenNthCalledWith(2, 'discord_id.not.is.null,auth_user_id.not.is.null');
    });

    it('orders by name, then id, by default', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      await listPlayers();
      expect(mockBuilder.order.mock.calls).toEqual([['name', { ascending: true }], ['id']]);
    });

    it('orders by the requested column and breaks ties by name, then id', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      await listPlayers({ sort: { column: 'ps_username', direction: 'desc' } });
      expect(mockBuilder.order.mock.calls).toEqual([
        ['ps_username', { ascending: false }],
        ['name'],
        ['id'],
      ]);
    });

    it('keeps only what the public directory shows when visibleOnly is set', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ data: [], error: null, count: 0 });
      await listPlayers({ visibleOnly: true });
      expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'active');
      expect(mockBuilder.eq).toHaveBeenCalledWith('is_test_account', false);
    });

    it('does not filter by status or test account without visibleOnly', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      await listPlayers();
      expect(mockBuilder.eq).not.toHaveBeenCalled();
    });

    it('clamps limit to 200', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      await listPlayers({ limit: 500 });
      // range(0, 199) = 200 items
      expect(mockBuilder.range).toHaveBeenCalledWith(0, 199);
    });

    it('throws on error', async () => {
      mockBuilder.range.mockReturnValue({ data: null, error: new Error('fail'), count: null });
      await expect(listPlayers()).rejects.toThrow('fail');
    });
  });

  // ── createPlayer ──
  describe('createPlayer', () => {
    it('creates and returns a player', async () => {
      mockBuilder.single.mockResolvedValue({ data: playerRow, error: null });
      const result = await createPlayer({
        name: 'Ash',
        discord_id: '12345',
        ps_username: 'ash_k',
      });
      expect(result.name).toBe('Ash');
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ash', discord_id: '12345' }),
      );
    });

    it('defaults optional fields to empty string', async () => {
      mockBuilder.single.mockResolvedValue({ data: playerRow, error: null });
      await createPlayer({ name: 'Ash', discord_id: '12345' });
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ ps_username: '', champions_username: '' }),
      );
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('dup') });
      await expect(
        createPlayer({ name: 'Ash', discord_id: '12345' }),
      ).rejects.toThrow('dup');
    });
  });

  // ── updatePlayer ──
  describe('updatePlayer', () => {
    it('updates and returns the player', async () => {
      const updated = { ...playerRow, name: 'Ash K.' };
      mockBuilder.single.mockResolvedValue({ data: updated, error: null });
      const result = await updatePlayer('p-1', { name: 'Ash K.' });
      expect(result.name).toBe('Ash K.');
      expect(mockBuilder.update).toHaveBeenCalledWith({ name: 'Ash K.' });
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('nope') });
      await expect(updatePlayer('p-1', { name: 'X' })).rejects.toThrow('nope');
    });
  });

  // ── deletePlayer ──
  describe('deletePlayer', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deletePlayer('p-1')).resolves.toBeUndefined();
      expect(mockBuilder.from).toHaveBeenCalledWith('players');
      expect(mockBuilder.delete).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('fk') });
      await expect(deletePlayer('p-1')).rejects.toThrow('fk');
    });
  });

  // ── getPlayerParticipations ──
  describe('getPlayerParticipations', () => {
    it('returns tournament IDs', async () => {
      mockBuilder.eq.mockReturnValue({
        data: [{ tournament_id: 't-1' }, { tournament_id: 't-2' }],
        error: null,
      });
      const result = await getPlayerParticipations('p-1');
      expect(result.tournamentIds).toEqual(['t-1', 't-2']);
    });

    it('returns empty array when none', async () => {
      mockBuilder.eq.mockReturnValue({ data: [], error: null });
      const result = await getPlayerParticipations('p-1');
      expect(result.tournamentIds).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getPlayerParticipations('p-1')).rejects.toThrow('err');
    });
  });

  // ── resolvePlayerNames ──
  describe('resolvePlayerNames', () => {
    it('returns empty object for empty input', async () => {
      const result = await resolvePlayerNames([]);
      expect(result).toEqual({});
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('returns id-to-name map', async () => {
      mockBuilder.in.mockReturnValue({
        data: [{ id: 'p-1', name: 'Ash' }],
        error: null,
      });
      const result = await resolvePlayerNames(['p-1']);
      expect(result).toEqual({ 'p-1': 'Ash' });
    });

    it('throws on error', async () => {
      mockBuilder.in.mockReturnValue({ data: null, error: new Error('err') });
      await expect(resolvePlayerNames(['p-1'])).rejects.toThrow('err');
    });
  });

  // ── getPublicPlayers (test isolation) ──
  describe('getPublicPlayers', () => {
    it('excludes test accounts from the public directory', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      await getPublicPlayers();
      expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'active');
      expect(mockBuilder.eq).toHaveBeenCalledWith('is_test_account', false);
    });

    it('keeps the is_test_account=false filter on the search path (spec §27 "excluded from global player directory/search")', async () => {
      // With a search term, .ilike('name', ...) is the terminal chain call.
      mockBuilder.ilike.mockReturnValue({ data: [], error: null, count: 0 });
      await getPublicPlayers({ search: 'Evo' });
      // The exclusion filter is applied unconditionally, before the search branch.
      expect(mockBuilder.eq).toHaveBeenCalledWith('is_test_account', false);
      expect(mockBuilder.ilike).toHaveBeenCalledWith('name', '%Evo%');
    });
  });
});

// ====================================================================
// RATINGS
// ====================================================================
describe('queries/ratings', () => {
  // ── getPlayerRating ──
  describe('getPlayerRating', () => {
    it('returns rating when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: ratingRow, error: null });
      const result = await getPlayerRating('p-1');
      expect(result).not.toBeNull();
      expect(result!.rating).toBe(1500);
      expect(mockBuilder.from).toHaveBeenCalledWith('player_ratings');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getPlayerRating('p-99')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('fail') });
      await expect(getPlayerRating('p-1')).rejects.toThrow('fail');
    });
  });

  // ── getRatingHistory ──
  describe('getRatingHistory', () => {
    it('returns history entries', async () => {
      // Chain: .from.select.eq.order.limit — terminal is .limit
      mockBuilder.limit.mockReturnValue({ data: [historyRow], error: null });
      const result = await getRatingHistory('p-1');
      expect(result).toHaveLength(1);
      expect(result[0].rating_change).toBe(20);
      expect(mockBuilder.limit).toHaveBeenCalledWith(30);
    });

    it('accepts custom limit', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });
      await getRatingHistory('p-1', 10);
      expect(mockBuilder.limit).toHaveBeenCalledWith(10);
    });

    it('throws on error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: new Error('fail') });
      await expect(getRatingHistory('p-1')).rejects.toThrow('fail');
    });
  });

  // ── getRatingHistoryByMatch ──
  describe('getRatingHistoryByMatch', () => {
    it('returns entries for the match', async () => {
      // Chain: .from.select.eq.order — terminal is .order
      mockBuilder.order.mockReturnValue({ data: [historyRow], error: null });
      const result = await getRatingHistoryByMatch('m-1');
      expect(result).toHaveLength(1);
      expect(result[0].match_id).toBe('m-1');
    });

    it('returns empty array when none', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await getRatingHistoryByMatch('m-99');
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getRatingHistoryByMatch('m-1')).rejects.toThrow('err');
    });
  });

  // ── getLeaderboard ──
  describe('getLeaderboard', () => {
    it('returns all ratings sorted by rating desc', async () => {
      // Chain: .from.select.order.limit — terminal is .limit
      mockBuilder.limit.mockReturnValue({ data: [ratingRow], error: null });
      const result = await getLeaderboard();
      expect(result).toHaveLength(1);
      expect(mockBuilder.order).toHaveBeenCalledWith('rating', { ascending: false });
    });

    it('filters by minGames when provided', async () => {
      const lowGames = { ...ratingRow, wins: 1, losses: 0, draws: 0 };
      const highGames = { ...ratingRow, id: 'r-2', player_id: 'p-2', wins: 10, losses: 5, draws: 0 };
      mockBuilder.limit.mockReturnValue({ data: [lowGames, highGames], error: null });
      const result = await getLeaderboard(5);
      expect(result).toHaveLength(1);
      expect(result[0].player_id).toBe('p-2');
    });

    it('returns all when minGames is 0', async () => {
      mockBuilder.limit.mockReturnValue({ data: [ratingRow], error: null });
      const result = await getLeaderboard(0);
      expect(result).toHaveLength(1);
    });

    it('throws on error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getLeaderboard()).rejects.toThrow('err');
    });
  });

  // ── getPlayerRatingsBatch ──
  describe('getPlayerRatingsBatch', () => {
    it('returns empty map for empty input', async () => {
      const result = await getPlayerRatingsBatch([]);
      expect(result.size).toBe(0);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('returns map keyed by player_id', async () => {
      mockBuilder.in.mockReturnValue({ data: [ratingRow], error: null });
      const result = await getPlayerRatingsBatch(['p-1']);
      expect(result.size).toBe(1);
      expect(result.get('p-1')!.rating).toBe(1500);
    });

    it('throws on error', async () => {
      mockBuilder.in.mockReturnValue({ data: null, error: new Error('batch err') });
      await expect(getPlayerRatingsBatch(['p-1'])).rejects.toThrow('batch err');
    });
  });

  // ── getLeaderboardEntries ──
  describe('getLeaderboardEntries', () => {
    it('returns empty array when no ratings exist', async () => {
      // getLeaderboard: .from.select.order.limit -> terminal .limit
      mockBuilder.limit.mockReturnValue({ data: [], error: null });
      const result = await getLeaderboardEntries();
      expect(result).toEqual([]);
    });

    it('enriches ratings with player names, avatars, and signatures', async () => {
      // getLeaderboard: .from.select.order.limit
      mockBuilder.limit.mockReturnValueOnce({ data: [ratingRow], error: null });

      // Promise.all parallel queries:
      // Q1: players query: .from.select.in -> terminal .in
      // Q2: signatures query: .from.select.in -> terminal .in
      // These both go through .in, so we mock two calls
      mockBuilder.in
        .mockReturnValueOnce({
          data: [{ id: 'p-1', name: 'Ash', avatar_url: 'https://example.com/ash.png' }],
          error: null,
        })
        .mockReturnValueOnce({
          data: [{ player_id: 'p-1', signatures: [{ pokemon_name: 'Pikachu', sprite_id: 'pikachu' }] }],
          error: null,
        });

      const result = await getLeaderboardEntries();
      expect(result).toHaveLength(1);
      expect(result[0].player_name).toBe('Ash');
      expect(result[0].player_avatar_url).toBe('https://example.com/ash.png');
      expect(result[0].signatures).toHaveLength(1);
      expect(result[0].signatures[0].pokemon_name).toBe('Pikachu');
    });

    it('uses fallback name when player not found in map', async () => {
      const unknownRating = { ...ratingRow, player_id: 'p-unknown' };
      mockBuilder.limit.mockReturnValueOnce({ data: [unknownRating], error: null });

      mockBuilder.in
        .mockReturnValueOnce({ data: [], error: null })    // no players found
        .mockReturnValueOnce({ data: [], error: null });   // no signatures found

      const result = await getLeaderboardEntries();
      expect(result[0].player_name).toBe('Unknown Player');
      expect(result[0].player_avatar_url).toBeNull();
      expect(result[0].signatures).toEqual([]);
    });

    it('handles non-array signatures gracefully', async () => {
      mockBuilder.limit.mockReturnValueOnce({ data: [ratingRow], error: null });

      mockBuilder.in
        .mockReturnValueOnce({
          data: [{ id: 'p-1', name: 'Ash', avatar_url: null }],
          error: null,
        })
        .mockReturnValueOnce({
          data: [{ player_id: 'p-1', signatures: 'not-an-array' }],
          error: null,
        });

      const result = await getLeaderboardEntries();
      expect(result[0].signatures).toEqual([]);
    });

    it('throws when players query fails', async () => {
      mockBuilder.limit.mockReturnValueOnce({ data: [ratingRow], error: null });

      mockBuilder.in
        .mockReturnValueOnce({ data: null, error: new Error('players err') })
        .mockReturnValueOnce({ data: [], error: null });

      await expect(getLeaderboardEntries()).rejects.toThrow('players err');
    });

    it('throws when signatures query fails', async () => {
      mockBuilder.limit.mockReturnValueOnce({ data: [ratingRow], error: null });

      mockBuilder.in
        .mockReturnValueOnce({
          data: [{ id: 'p-1', name: 'Ash', avatar_url: null }],
          error: null,
        })
        .mockReturnValueOnce({ data: null, error: new Error('sig err') });

      await expect(getLeaderboardEntries()).rejects.toThrow('sig err');
    });

    it('respects minGames filter', async () => {
      const lowGames = { ...ratingRow, wins: 1, losses: 0, draws: 0 };
      mockBuilder.limit.mockReturnValueOnce({ data: [lowGames], error: null });
      // getLeaderboard with minGames=5 filters out this entry, returns empty
      const result = await getLeaderboardEntries(5);
      expect(result).toEqual([]);
    });
  });
});

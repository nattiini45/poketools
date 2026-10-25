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

// ── Imports ────────────────────────────────────────────────────────────

// evolutions
import {
  getTierById,
  getTierList,
  getWildcards,
  getPlayerWildcards,
  getAllTiers,
  getTierByBasePokemon,
  createTier,
  updateTier,
  deleteTier,
  bulkCreateTiers,
  getSeasonTrackers,
  getPlayerTrackers,
  getPlayerTrackersWithTiers,
  createTracker,
  updateTracker,
  deleteTrackerById,
  getSeasonKosForLine,
} from '../evolutions';

// meta-usage
import {
  getUsageByFormat,
  getPokemonUsageStats,
  getAvailableFormats,
  getLastImportDate,
  upsertUsageRow,
  upsertUsageBatch,
  clearFormatUsage,
} from '../meta-usage';

// usage-hybrid
import {
  getHybridUsageList,
  getHybridPokemonDetail,
} from '../usage-hybrid';

// match-analyses
import {
  getMatchAnalysis,
  createMatchAnalysis,
  updateMatchAnalysis,
  deleteMatchAnalysis,
} from '../match-analyses';

// match-prep-analyses
import {
  getMatchPrepAnalysis,
  createMatchPrepAnalysis,
  updateMatchPrepAnalysis,
  deleteMatchPrepAnalysis,
  deleteMatchPrepAnalysesByMatch,
} from '../match-prep-analyses';

// match-prep-teams
import {
  getMatchPrepTeam,
  getMatchPrepTeams,
  upsertMatchPrepTeam,
  listMatchPrepTeamsByPlayer,
  deleteMatchPrepTeam,
} from '../match-prep-teams';

// resource-admins
import {
  isResourceAdminFor,
  hasAnyResourceAdminRole,
  getResourceAdmins,
  getAdminAssignments,
  getAdminSeasonIds,
  getAdminTournamentIds,
  addResourceAdmin,
  removeResourceAdmin,
} from '../resource-admins';

// wiki-notes
import {
  getApprovedNotes,
  createNote,
  updateNote,
  deleteNote,
  approveNote,
  getNoteById,
} from '../wiki-notes';

// avatar-gallery
import {
  insertGalleryItem,
  getPlayerGallery,
  getGalleryItem,
  deleteGalleryItem,
  getCommunityAvatars,
} from '../avatar-gallery';

// ── Helpers ────────────────────────────────────────────────────────────
function resetMocks() {
  // mockReset clears calls, instances, AND the mockReturnValueOnce queue.
  // mockClear alone leaves stale once-values that leak between tests.
  for (const m of chainMethods) {
    mockBuilder[m].mockReset().mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockReset();
  mockBuilder.maybeSingle.mockReset();
}

// ────────────────────────────────────────────────────────────────────────
// Evolutions
// ────────────────────────────────────────────────────────────────────────
describe('queries/evolutions', () => {
  beforeEach(resetMocks);

  const tierRow = {
    id: 'et1',
    season_id: 's1',
    player_id: null,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage2_kos: 3,
    stage3_pokemon: 'Charizard',
    stage3_kos: 6,
    power_tier: 'A',
    created_at: '2025-01-01T00:00:00Z',
  };

  const trackerRow = {
    id: 'tr1',
    season_id: 's1',
    player_id: 'p1',
    base_pokemon: 'Charmander',
    current_form: 'Charmeleon',
    total_kos: 4,
    current_stage: 2,
    evolved_at: '2025-02-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-02-01T00:00:00Z',
  };

  describe('getTierById', () => {
    it('returns mapped tier', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: tierRow, error: null });
      const result = await getTierById('et1');
      expect(result).not.toBeNull();
      expect(result!.base_pokemon).toBe('Charmander');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getTierById('x')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(getTierById('x')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getTierList', () => {
    it('returns tier list entries (excludes wildcards)', async () => {
      mockBuilder.order.mockReturnValue({ data: [tierRow], error: null });
      const result = await getTierList('s1');
      expect(result).toHaveLength(1);
      expect(mockBuilder.is).toHaveBeenCalledWith('player_id', null);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(getTierList('s1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getWildcards', () => {
    it('returns wildcard entries', async () => {
      const wildcardRow = { ...tierRow, player_id: 'p1' };
      mockBuilder.order.mockReturnValue({ data: [wildcardRow], error: null });
      const result = await getWildcards('s1');
      expect(result).toHaveLength(1);
      expect(mockBuilder.not).toHaveBeenCalledWith('player_id', 'is', null);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(getWildcards('s1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getPlayerWildcards', () => {
    it('returns wildcards for specific player', async () => {
      mockBuilder.order.mockReturnValue({
        data: [{ ...tierRow, player_id: 'p1' }],
        error: null,
      });
      const result = await getPlayerWildcards('s1', 'p1');
      expect(result).toHaveLength(1);
      expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    });
  });

  describe('getAllTiers', () => {
    it('returns all tiers for a season', async () => {
      mockBuilder.order.mockReturnValue({ data: [tierRow], error: null });
      const result = await getAllTiers('s1');
      expect(result).toHaveLength(1);
    });
  });

  describe('createTier', () => {
    it('inserts and returns tier', async () => {
      mockBuilder.single.mockResolvedValue({ data: tierRow, error: null });
      const result = await createTier({
        season_id: 's1',
        base_pokemon: 'Charmander',
        stage2_pokemon: 'Charmeleon',
        stage2_kos: 3,
        stage3_pokemon: 'Charizard',
        stage3_kos: 6,
        power_tier: 'A',
      });
      expect(result.base_pokemon).toBe('Charmander');
      expect(mockBuilder.insert).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(
        createTier({
          season_id: 's1',
          base_pokemon: 'X',
          stage2_pokemon: 'Y',
          stage2_kos: 1,
        }),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('updateTier', () => {
    it('updates and returns tier', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...tierRow, stage2_kos: 5 }, error: null });
      const result = await updateTier('et1', { stage2_kos: 5 });
      expect(result.stage2_kos).toBe(5);
    });
  });

  describe('deleteTier', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteTier('et1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(deleteTier('et1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('bulkCreateTiers', () => {
    it('bulk inserts and returns tiers', async () => {
      mockBuilder.select.mockReturnValue({ data: [tierRow], error: null });
      const result = await bulkCreateTiers([
        {
          season_id: 's1',
          base_pokemon: 'Charmander',
          stage2_pokemon: 'Charmeleon',
          stage2_kos: 3,
        },
      ]);
      expect(result).toHaveLength(1);
    });

    it('throws on error', async () => {
      mockBuilder.select.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(
        bulkCreateTiers([
          { season_id: 's1', base_pokemon: 'X', stage2_pokemon: 'Y', stage2_kos: 1 },
        ]),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getSeasonTrackers', () => {
    it('returns trackers ordered by player_id then base_pokemon', async () => {
      // Double .order() chain: first returns mockBuilder, second returns data
      mockBuilder.order
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ data: [trackerRow], error: null });
      const result = await getSeasonTrackers('s1');
      expect(result).toHaveLength(1);
      expect(result[0].current_form).toBe('Charmeleon');
    });
  });

  describe('getPlayerTrackers', () => {
    it('returns player-scoped trackers', async () => {
      mockBuilder.order.mockReturnValue({ data: [trackerRow], error: null });
      const result = await getPlayerTrackers('s1', 'p1');
      expect(result).toHaveLength(1);
    });
  });

  describe('createTracker', () => {
    it('creates tracker with base form defaults', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...trackerRow, current_stage: 1, total_kos: 0, current_form: 'Charmander' }, error: null });
      const result = await createTracker({
        season_id: 's1',
        player_id: 'p1',
        base_pokemon: 'Charmander',
      });
      expect(result.current_stage).toBe(1);
      expect(result.total_kos).toBe(0);
    });
  });

  describe('updateTracker', () => {
    it('updates tracker evolution state', async () => {
      mockBuilder.single.mockResolvedValue({ data: trackerRow, error: null });
      const result = await updateTracker('tr1', {
        current_form: 'Charmeleon',
        total_kos: 4,
        current_stage: 2,
      });
      expect(result.current_form).toBe('Charmeleon');
    });
  });

  describe('deleteTrackerById', () => {
    it('deletes exactly one tracker row by id', async () => {
      mockBuilder.eq.mockReturnValueOnce({ error: null });
      await expect(deleteTrackerById('tr1')).resolves.toBeUndefined();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'tr1');
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValueOnce({ error: { message: 'err' } });
      await expect(deleteTrackerById('X')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getTierByBasePokemon', () => {
    it('returns tier for global tier list entry (no playerId)', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: tierRow, error: null });
      const result = await getTierByBasePokemon('s1', 'Charmander');
      expect(result).not.toBeNull();
      expect(result!.base_pokemon).toBe('Charmander');
      expect(mockBuilder.is).toHaveBeenCalledWith('player_id', null);
    });

    it('returns tier for player-specific wildcard', async () => {
      const wildcardRow = { ...tierRow, player_id: 'p1' };
      mockBuilder.maybeSingle.mockResolvedValue({ data: wildcardRow, error: null });
      const result = await getTierByBasePokemon('s1', 'Charmander', 'p1');
      expect(result).not.toBeNull();
      expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getTierByBasePokemon('s1', 'MissingNo');
      expect(result).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(getTierByBasePokemon('s1', 'Charmander')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getPlayerTrackersWithTiers', () => {
    it('returns trackers enriched with tier data', async () => {
      // getPlayerTrackers: from.select.eq.eq.order -> terminal .order
      mockBuilder.order
        .mockReturnValueOnce({ data: [trackerRow], error: null })
        // getAllTiers: from.select.eq.order -> terminal .order
        .mockReturnValueOnce({ data: [tierRow], error: null });

      const result = await getPlayerTrackersWithTiers('s1', 'p1');
      expect(result).toHaveLength(1);
      expect(result[0].base_pokemon).toBe('Charmander');
      expect(result[0].tier.stage2_pokemon).toBe('Charmeleon');
    });

    it('prefers player-specific wildcard over general tier', async () => {
      const wildcardTier = { ...tierRow, id: 'wt1', player_id: 'p1', stage2_kos: 5 };
      mockBuilder.order
        .mockReturnValueOnce({ data: [trackerRow], error: null })
        .mockReturnValueOnce({ data: [tierRow, wildcardTier], error: null });

      const result = await getPlayerTrackersWithTiers('s1', 'p1');
      expect(result[0].tier.stage2_kos).toBe(5);
    });

    it('throws when no tier found for tracker', async () => {
      const orphanTracker = { ...trackerRow, base_pokemon: 'Bulbasaur' };
      mockBuilder.order
        .mockReturnValueOnce({ data: [orphanTracker], error: null })
        .mockReturnValueOnce({ data: [tierRow], error: null });

      await expect(getPlayerTrackersWithTiers('s1', 'p1')).rejects.toThrow(
        'No evolution tier found for Bulbasaur in season s1'
      );
    });
  });

  describe('getSeasonKosForLine', () => {
    it('returns summed KOs across multi-step chain', async () => {
      // Query 1: from().select().eq() -> tournaments
      mockBuilder.eq.mockReturnValueOnce({
        data: [{ id: 't1' }],
        error: null,
      });
      // Query 2: from().select().in() -> matches
      mockBuilder.in.mockReturnValueOnce({
        data: [{ id: 'match1' }],
        error: null,
      });
      // Query 3: from().select().in() -> games
      mockBuilder.in.mockReturnValueOnce({
        data: [{ id: 'game1' }],
        error: null,
      });
      // Query 4: from().select().eq().in().in() -> battle_stats
      // The .eq() must return mockBuilder, then first .in() returns mockBuilder,
      // then second .in() returns data
      mockBuilder.eq.mockReturnValueOnce(mockBuilder);
      mockBuilder.in
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({
          data: [{ kos_dealt: 3 }, { kos_dealt: 2 }],
          error: null,
        });

      const result = await getSeasonKosForLine('s1', 'p1', ['Charmander', 'Charmeleon']);
      expect(result).toBe(5);
    });

    it('returns 0 when no tournaments found', async () => {
      mockBuilder.eq.mockReturnValueOnce({ data: [], error: null });
      const result = await getSeasonKosForLine('s1', 'p1', ['X']);
      expect(result).toBe(0);
    });

    it('returns 0 when no matches found', async () => {
      mockBuilder.eq.mockReturnValueOnce({ data: [{ id: 't1' }], error: null });
      mockBuilder.in.mockReturnValueOnce({ data: [], error: null });
      const result = await getSeasonKosForLine('s1', 'p1', ['X']);
      expect(result).toBe(0);
    });

    it('returns 0 when no games found', async () => {
      mockBuilder.eq.mockReturnValueOnce({ data: [{ id: 't1' }], error: null });
      mockBuilder.in.mockReturnValueOnce({ data: [{ id: 'match1' }], error: null });
      mockBuilder.in.mockReturnValueOnce({ data: [], error: null });
      const result = await getSeasonKosForLine('s1', 'p1', ['X']);
      expect(result).toBe(0);
    });

    it('throws when tournaments query fails', async () => {
      mockBuilder.eq.mockReturnValueOnce({ data: null, error: { message: 'err' } });
      await expect(getSeasonKosForLine('s1', 'p1', ['X'])).rejects.toEqual({ message: 'err' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Meta Usage
// ────────────────────────────────────────────────────────────────────────
describe('queries/meta-usage', () => {
  beforeEach(resetMocks);

  const usageRow = {
    id: 'u1',
    format: 'gen9ou',
    pokemon_name: 'Garchomp',
    usage_pct: 25.5,
    lead_pct: 10.2,
    moves: { Earthquake: 80 },
    items: { 'Choice Scarf': 40 },
    abilities: { 'Rough Skin': 60 },
    teammates: { Heatran: 30 },
    spreads: { 'Jolly:252/0/0/0/4/252': 50 },
    tera_types: { Ground: 45 },
    counters: null,
    viability: null,
    last_imported: '2025-01-01T00:00:00Z',
  };

  describe('getUsageByFormat', () => {
    it('returns paginated usage data with count', async () => {
      mockBuilder.range.mockReturnValue({
        data: [usageRow],
        error: null,
        count: 1,
      });

      const result = await getUsageByFormat('gen9ou');
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.data[0].pokemon_name).toBe('Garchomp');
      expect(mockBuilder.from).toHaveBeenCalledWith('meta_usage_cache');
    });

    it('returns empty on no data', async () => {
      mockBuilder.range.mockReturnValue({ data: null, error: null, count: 0 });
      const result = await getUsageByFormat('gen9ou');
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('applies search filter', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      await getUsageByFormat('gen9ou', { search: 'Gar' });
      expect(mockBuilder.ilike).toHaveBeenCalledWith('pokemon_name', 'Gar%');
    });

    it('applies minUsage filter', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      await getUsageByFormat('gen9ou', { minUsage: 5 });
      expect(mockBuilder.gte).toHaveBeenCalledWith('usage_pct', 5);
    });

    it('throws on error', async () => {
      mockBuilder.range.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(getUsageByFormat('gen9ou')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getPokemonUsageStats', () => {
    it('returns usage for a specific pokemon', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: usageRow, error: null });
      const result = await getPokemonUsageStats('Garchomp', 'gen9ou');
      expect(result).not.toBeNull();
      expect(result!.usage_pct).toBeCloseTo(0.255);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getPokemonUsageStats('Unknown', 'gen9ou')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(getPokemonUsageStats('X', 'gen9ou')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getAvailableFormats', () => {
    it('returns deduplicated sorted formats', async () => {
      mockBuilder.order.mockReturnValue({
        data: [
          { format: 'gen9ou' },
          { format: 'gen9uu' },
          { format: 'gen9ou' }, // duplicate
        ],
        error: null,
      });

      const result = await getAvailableFormats();
      expect(result).toEqual(['gen9ou', 'gen9uu']);
    });

    it('returns empty on null data', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await getAvailableFormats();
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(getAvailableFormats()).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getLastImportDate', () => {
    it('returns Date object', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { last_imported: '2025-06-01T00:00:00Z' },
        error: null,
      });

      const result = await getLastImportDate();
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    });

    it('returns null when no data', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getLastImportDate()).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(getLastImportDate()).rejects.toEqual({ message: 'err' });
    });
  });

  describe('upsertUsageRow', () => {
    it('upserts without error', async () => {
      mockBuilder.upsert.mockReturnValue({ error: null });

      await expect(
        upsertUsageRow({
          format: 'gen9ou',
          pokemon_name: 'Garchomp',
          usage_pct: 25,
          lead_pct: null,
          moves: {},
          items: {},
          abilities: {},
          teammates: {},
          spreads: {},
          tera_types: null,
          counters: null,
          viability: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.upsert.mockReturnValue({ error: { message: 'err' } });
      await expect(
        upsertUsageRow({
          format: 'gen9ou',
          pokemon_name: 'X',
          usage_pct: 0,
          lead_pct: null,
          moves: {},
          items: {},
          abilities: {},
          teammates: {},
          spreads: {},
          tera_types: null,
          counters: null,
          viability: null,
        }),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('upsertUsageBatch', () => {
    it('no-ops for empty array', async () => {
      await upsertUsageBatch([]);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('upserts batch', async () => {
      mockBuilder.upsert.mockReturnValue({ error: null });
      await expect(
        upsertUsageBatch([
          {
            format: 'gen9ou',
            pokemon_name: 'X',
            usage_pct: 0,
            lead_pct: null,
            moves: {},
            items: {},
            abilities: {},
            teammates: {},
            spreads: {},
            tera_types: null,
            counters: null,
            viability: null,
          },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe('clearFormatUsage', () => {
    it('deletes rows for a format', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(clearFormatUsage('gen9ou')).resolves.toBeUndefined();
      expect(mockBuilder.delete).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(clearFormatUsage('gen9ou')).rejects.toEqual({ message: 'err' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Usage Hybrid
// ────────────────────────────────────────────────────────────────────────
describe('queries/usage-hybrid', () => {
  beforeEach(resetMocks);

  describe('getHybridUsageList', () => {
    it('returns meta-only results when no scope', async () => {
      // getUsageByFormat chain: from -> select -> eq -> order -> range
      mockBuilder.range.mockReturnValue({
        data: [
          {
            id: 'u1',
            format: 'gen9ou',
            pokemon_name: 'Garchomp',
            usage_pct: 25,
            lead_pct: null,
            moves: {},
            items: {},
            abilities: {},
            teammates: {},
            spreads: {},
            tera_types: null,
            counters: null,
            viability: null,
            last_imported: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
        count: 1,
      });

      const result = await getHybridUsageList({ format: 'gen9ou' });
      expect(result.source).toBe('meta');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].usage_pct).toBeCloseTo(0.25);
    });

    it('returns empty when meta has no data', async () => {
      mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
      const result = await getHybridUsageList({ format: 'gen9ou' });
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('merges league aggregate data with meta (hybrid source)', async () => {
      // getAggregates chain: from.select.eq('scope_type').eq('scope_id').order() -> terminal .order
      // getUsageByFormat chain: from.select.eq('format').order().range() -> terminal .range
      // Full .eq sequence: eq('scope_type'), eq('scope_id'), eq('format') — all return builder
      // Terminal for aggregates is .order(), terminal for meta is .range()
      mockBuilder.order.mockReturnValueOnce({
        data: [
          {
            id: 'a1', scope_type: 'league', scope_id: 's1',
            pokemon_name: 'Garchomp', total_appearances: 10, total_brought: 10,
            total_led: 5, total_kos_dealt: 20, total_koed: 5, total_wins: 8,
            total_games: 20, move_counts: {}, last_updated: '2025-01-01T00:00:00Z',
          },
          {
            id: 'a2', scope_type: 'league', scope_id: 's1',
            pokemon_name: 'Landorus', total_appearances: 5, total_brought: 5,
            total_led: 2, total_kos_dealt: 10, total_koed: 3, total_wins: 4,
            total_games: 20, move_counts: {}, last_updated: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      // getUsageByFormat: terminal .range()
      // Include a meta-only Pokémon (Dragapult) so the merged list has
      // source='meta' items alongside source='hybrid'/'league' items,
      // which triggers the 'hybrid' overall source classification.
      mockBuilder.range.mockReturnValueOnce({
        data: [
          {
            id: 'u1', format: 'gen9ou', pokemon_name: 'Garchomp',
            usage_pct: 25, lead_pct: null, moves: {}, items: {},
            abilities: {}, teammates: {}, spreads: {},
            tera_types: null, counters: null, viability: null,
            last_imported: '2025-01-01T00:00:00Z',
          },
          {
            id: 'u2', format: 'gen9ou', pokemon_name: 'Dragapult',
            usage_pct: 15, lead_pct: null, moves: {}, items: {},
            abilities: {}, teammates: {}, spreads: {},
            tera_types: null, counters: null, viability: null,
            last_imported: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
        count: 2,
      });

      mockBuilder.rpc.mockResolvedValueOnce({ data: 20, error: null });

      const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1' });
      expect(result.source).toBe('hybrid');
      // Should include Garchomp (meta+league overlap), Dragapult (meta-only), Landorus (league-only)
      expect(result.data).toHaveLength(3);
      const garchomp = result.data.find((d) => d.pokemon_name === 'Garchomp');
      expect(garchomp).toBeDefined();
      expect(garchomp!.source).toBe('hybrid');
      expect(garchomp!.usage_pct).toBeCloseTo(0.5);
      const landorus = result.data.find((d) => d.pokemon_name === 'Landorus');
      expect(landorus).toBeDefined();
      expect(landorus!.source).toBe('league');
      const dragapult = result.data.find((d) => d.pokemon_name === 'Dragapult');
      expect(dragapult).toBeDefined();
      expect(dragapult!.source).toBe('meta');
      expect(dragapult!.usage_pct).toBeCloseTo(0.15);
    });

    it('uses scope total games for league-only list usage_pct', async () => {
      mockBuilder.order.mockReturnValueOnce({
        data: [
          {
            id: 'a1', scope_type: 'league', scope_id: 's1',
            pokemon_name: 'Landorus', total_appearances: 5, total_brought: 5,
            total_led: 2, total_kos_dealt: 10, total_koed: 3, total_wins: 4,
            total_games: 20, move_counts: {}, last_updated: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      mockBuilder.range.mockReturnValueOnce({ data: [], error: null, count: 0 });
      mockBuilder.rpc.mockResolvedValueOnce({ data: 25, error: null });

      const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1' });
      expect(result.source).toBe('league');
      expect(result.data[0].usage_pct).toBeCloseTo(0.2);
    });

    it('returns league-only source when no meta pokemon overlap', async () => {
      // getAggregates: terminal .order()
      mockBuilder.order.mockReturnValueOnce({
        data: [
          {
            id: 'a1', scope_type: 'league', scope_id: 's1',
            pokemon_name: 'Landorus', total_appearances: 5, total_brought: 5,
            total_led: 2, total_kos_dealt: 10, total_koed: 3, total_wins: 4,
            total_games: 20, move_counts: {}, last_updated: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      // getUsageByFormat returns empty meta
      mockBuilder.range.mockReturnValueOnce({ data: [], error: null, count: 0 });

      mockBuilder.rpc.mockResolvedValueOnce({ data: 20, error: null });

      const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1' });
      expect(result.source).toBe('league');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].pokemon_name).toBe('Landorus');
      expect(result.data[0].usage_pct).toBeCloseTo(0.25);
    });

    it('applies search filter on league-merged list', async () => {
      // getAggregates: terminal .order()
      mockBuilder.order.mockReturnValueOnce({
        data: [
          {
            id: 'a1', scope_type: 'league', scope_id: 's1',
            pokemon_name: 'Garchomp', total_appearances: 10, total_brought: 10,
            total_led: 5, total_kos_dealt: 20, total_koed: 5, total_wins: 8,
            total_games: 20, move_counts: {}, last_updated: '2025-01-01T00:00:00Z',
          },
          {
            id: 'a2', scope_type: 'league', scope_id: 's1',
            pokemon_name: 'Gardevoir', total_appearances: 8, total_brought: 8,
            total_led: 3, total_kos_dealt: 15, total_koed: 4, total_wins: 6,
            total_games: 20, move_counts: {}, last_updated: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      // getUsageByFormat with search already applied at DB level
      mockBuilder.range.mockReturnValueOnce({
        data: [
          {
            id: 'u1', format: 'gen9ou', pokemon_name: 'Garchomp',
            usage_pct: 25, lead_pct: null, moves: {}, items: {},
            abilities: {}, teammates: {}, spreads: {},
            tera_types: null, counters: null, viability: null,
            last_imported: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
        count: 1,
      });

      const result = await getHybridUsageList({
        format: 'gen9ou',
        seasonId: 's1',
        search: 'Gar',
      });

      // Search filter applies client-side on the merged list
      for (const item of result.data) {
        expect(item.pokemon_name.toLowerCase().startsWith('gar')).toBe(true);
      }
    });

    it('handles aggregates fetch failure gracefully (falls back to meta)', async () => {
      // getAggregates: terminal .order() throws via error in response
      mockBuilder.order.mockReturnValueOnce({ data: null, error: new Error('agg fail') });

      // getUsageByFormat still works (terminal .range())
      mockBuilder.range.mockReturnValueOnce({
        data: [
          {
            id: 'u1', format: 'gen9ou', pokemon_name: 'Garchomp',
            usage_pct: 25, lead_pct: null, moves: {}, items: {},
            abilities: {}, teammates: {}, spreads: {},
            tera_types: null, counters: null, viability: null,
            last_imported: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
        count: 1,
      });

      const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1' });
      expect(result.source).toBe('meta');
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getHybridPokemonDetail', () => {
    it('returns null when pokemon not in meta', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getHybridPokemonDetail('Unknown', { format: 'gen9ou' });
      expect(result).toBeNull();
    });

    it('returns detail from meta', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: {
          id: 'u1',
          format: 'gen9ou',
          pokemon_name: 'Garchomp',
          usage_pct: 0.25,
          lead_pct: 0.1,
          moves: { Earthquake: 80 },
          items: {},
          abilities: {},
          teammates: {},
          spreads: {},
          tera_types: null,
          counters: null,
          viability: null,
          last_imported: '2025-01-01T00:00:00Z',
        },
        error: null,
      });

      const result = await getHybridPokemonDetail('Garchomp', { format: 'gen9ou' });
      expect(result).not.toBeNull();
      expect(result!.pokemon_name).toBe('Garchomp');
      expect(result!.source).toBe('meta');
    });

    it('returns league-only detail when meta is missing', async () => {
      mockBuilder.maybeSingle
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 'a1',
            scope_type: 'league',
            scope_id: 's1',
            pokemon_name: 'Landorus',
            total_appearances: 8,
            total_brought: 8,
            total_led: 2,
            total_kos_dealt: 10,
            total_koed: 2,
            total_wins: 6,
            total_games: 20,
            move_counts: { Earthquake: 4, 'U-turn': 4 },
            last_updated: '2025-01-01T00:00:00Z',
          },
          error: null,
        });

      mockBuilder.rpc.mockResolvedValueOnce({ data: 20, error: null });

      const result = await getHybridPokemonDetail('Landorus', {
        format: 'gen9ou',
        seasonId: 's1',
      });
      expect(result).not.toBeNull();
      expect(result!.source).toBe('league');
      expect(result!.usage_pct).toBeCloseTo(0.4);
      expect(result!.moves.Earthquake).toBe(50);
    });

    it('merges league usage when meta and aggregate exist', async () => {
      mockBuilder.maybeSingle
        .mockResolvedValueOnce({
          data: {
            id: 'u1',
            format: 'gen9ou',
            pokemon_name: 'Garchomp',
            usage_pct: 0.25,
            lead_pct: 0.1,
            moves: { Earthquake: 80 },
            items: {},
            abilities: {},
            teammates: {},
            spreads: {},
            tera_types: null,
            counters: null,
            viability: null,
            last_imported: '2025-01-01T00:00:00Z',
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: 'a1',
            scope_type: 'league',
            scope_id: 's1',
            pokemon_name: 'Garchomp',
            total_appearances: 10,
            total_brought: 10,
            total_led: 3,
            total_kos_dealt: 12,
            total_koed: 2,
            total_wins: 8,
            total_games: 20,
            move_counts: {},
            last_updated: '2025-01-01T00:00:00Z',
          },
          error: null,
        });

      mockBuilder.rpc.mockResolvedValueOnce({ data: 20, error: null });

      const result = await getHybridPokemonDetail('Garchomp', {
        format: 'gen9ou',
        seasonId: 's1',
      });
      expect(result!.source).toBe('hybrid');
      expect(result!.usage_pct).toBeCloseTo(0.5);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Match Analyses
// ────────────────────────────────────────────────────────────────────────
describe('queries/match-analyses', () => {
  beforeEach(resetMocks);

  const analysisRow = {
    id: 'ma1',
    match_id: 'm1',
    model_id: 'claude-3',
    analysis: { summary: 'Good game' },
    prompt_tokens: 100,
    completion_tokens: 200,
    generation_time_ms: 1500,
    status: 'completed',
    error: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };

  describe('getMatchAnalysis', () => {
    it('returns mapped analysis', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: analysisRow, error: null });
      const result = await getMatchAnalysis('m1');
      expect(result).not.toBeNull();
      expect(result!.model_id).toBe('claude-3');
    });

    it('logs and rethrows a query error instead of reporting "no analysis"', async () => {
      const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const dbError = { message: 'table not found' };
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getMatchAnalysis('m1')).rejects.toBe(dbError);
      expect(logSpy).toHaveBeenCalledWith('[match-analyses] Query error:', 'table not found');
      logSpy.mockRestore();
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getMatchAnalysis('m-none')).toBeNull();
    });

    it('propagates a thrown exception', async () => {
      mockBuilder.maybeSingle.mockRejectedValue(new Error('network'));
      await expect(getMatchAnalysis('m1')).rejects.toThrow('network');
    });
  });

  describe('createMatchAnalysis', () => {
    it('creates and returns analysis', async () => {
      mockBuilder.single.mockResolvedValue({ data: analysisRow, error: null });
      const result = await createMatchAnalysis('m1', 'claude-3');
      expect(result.match_id).toBe('m1');
      expect(mockBuilder.insert).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(createMatchAnalysis('m1', 'x')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('updateMatchAnalysis', () => {
    it('updates without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(
        updateMatchAnalysis('ma1', { status: 'completed' }),
      ).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(
        updateMatchAnalysis('ma1', { status: 'failed' }),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('deleteMatchAnalysis', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteMatchAnalysis('m1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(deleteMatchAnalysis('m1')).rejects.toEqual({ message: 'err' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Match Prep Analyses
// ────────────────────────────────────────────────────────────────────────
describe('queries/match-prep-analyses', () => {
  beforeEach(resetMocks);

  const prepRow = {
    id: 'mpa1',
    match_id: 'm1',
    player_id: 'p1',
    model_id: 'claude-3',
    analysis: { strategy: 'Lead with Garchomp' },
    has_user_team: true,
    prompt_tokens: 50,
    completion_tokens: 100,
    generation_time_ms: 800,
    status: 'completed',
    error: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };

  describe('getMatchPrepAnalysis', () => {
    it('returns mapped analysis', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: prepRow, error: null });
      const result = await getMatchPrepAnalysis('m1', 'p1');
      expect(result).not.toBeNull();
      expect(result!.has_user_team).toBe(true);
    });

    it('logs and rethrows a query error instead of reporting "no report"', async () => {
      const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const dbError = { message: 'table not found' };
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getMatchPrepAnalysis('m1', 'p1')).rejects.toBe(dbError);
      expect(logSpy).toHaveBeenCalledWith('[match-prep-analyses] Query error:', 'table not found');
      logSpy.mockRestore();
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getMatchPrepAnalysis('m1', 'p-none')).toBeNull();
    });

    it('propagates a thrown exception', async () => {
      mockBuilder.maybeSingle.mockRejectedValue(new Error('network'));
      await expect(getMatchPrepAnalysis('m1', 'p1')).rejects.toThrow('network');
    });
  });

  describe('createMatchPrepAnalysis', () => {
    it('creates and returns', async () => {
      mockBuilder.single.mockResolvedValue({ data: prepRow, error: null });
      const result = await createMatchPrepAnalysis('m1', 'p1', 'claude-3', true);
      expect(result.player_id).toBe('p1');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(
        createMatchPrepAnalysis('m1', 'p1', 'x', false),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('updateMatchPrepAnalysis', () => {
    it('updates without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(
        updateMatchPrepAnalysis('mpa1', { status: 'completed' }),
      ).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(
        updateMatchPrepAnalysis('mpa1', { status: 'failed' }),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('deleteMatchPrepAnalysis', () => {
    it('deletes by match + player', async () => {
      // Double .eq() chain
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: null });
      await expect(deleteMatchPrepAnalysis('m1', 'p1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: { message: 'err' } });
      await expect(deleteMatchPrepAnalysis('m1', 'p1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('deleteMatchPrepAnalysesByMatch', () => {
    it('deletes all for a match', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteMatchPrepAnalysesByMatch('m1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(deleteMatchPrepAnalysesByMatch('m1')).rejects.toEqual({ message: 'err' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Match Prep Teams
// ────────────────────────────────────────────────────────────────────────
describe('queries/match-prep-teams', () => {
  beforeEach(resetMocks);

  const prepTeamRow = {
    id: 'mpt1',
    match_id: 'm1',
    player_id: 'p1',
    pokemon: [{ species: 'Garchomp', moves: ['Earthquake'] }],
    import_source: 'paste',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };

  describe('getMatchPrepTeam', () => {
    it('returns mapped prep team', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: prepTeamRow, error: null });
      const result = await getMatchPrepTeam('m1', 'p1');
      expect(result).not.toBeNull();
      expect(result!.match_id).toBe('m1');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getMatchPrepTeam('m1', 'p-none')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(getMatchPrepTeam('m1', 'p1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getMatchPrepTeams', () => {
    it('returns all teams for a match', async () => {
      mockBuilder.eq.mockReturnValue({ data: [prepTeamRow], error: null });
      const result = await getMatchPrepTeams('m1');
      expect(result).toHaveLength(1);
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(getMatchPrepTeams('m1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('upsertMatchPrepTeam', () => {
    it('upserts and returns', async () => {
      mockBuilder.single.mockResolvedValue({ data: prepTeamRow, error: null });
      const result = await upsertMatchPrepTeam('m1', 'p1', [] as never, 'paste' as never);
      expect(result.id).toBe('mpt1');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(
        upsertMatchPrepTeam('m1', 'p1', [] as never, 'paste' as never),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('listMatchPrepTeamsByPlayer', () => {
    it('returns teams ordered by updated_at', async () => {
      mockBuilder.order.mockReturnValue({ data: [prepTeamRow], error: null });
      const result = await listMatchPrepTeamsByPlayer('p1');
      expect(result).toHaveLength(1);
      expect(mockBuilder.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    });
  });

  describe('deleteMatchPrepTeam', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteMatchPrepTeam('mpt1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(deleteMatchPrepTeam('mpt1')).rejects.toEqual({ message: 'err' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Resource Admins
// ────────────────────────────────────────────────────────────────────────
describe('queries/resource-admins', () => {
  beforeEach(resetMocks);

  describe('isResourceAdminFor', () => {
    it('returns true when count > 0 for season type', async () => {
      // select().eq().eq().eq() -- 3 eq calls, last is terminal
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ count: 1, error: null });
      const result = await isResourceAdminFor('p1', 'season', 's1');
      expect(result).toBe(true);
    });

    it('returns false when count is 0', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ count: 0, error: null });
      const result = await isResourceAdminFor('p1', 'season', 's1');
      expect(result).toBe(false);
    });

    it('throws on error', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ count: null, error: { message: 'err' } });
      await expect(isResourceAdminFor('p1', 'season', 's1')).rejects.toEqual({
        message: 'err',
      });
    });

    it('delegates to season-or-tournament check for tournament type', async () => {
      // isSeasonOrTournamentAdmin does 3 queries:
      // 1) Direct check: select().eq().eq().eq() -> count 0 (3 eq calls)
      // 2) Tournament lookup: from().select().eq().maybeSingle() (1 eq call)
      // 3) Season admin check: select().eq().eq().eq() -> count 1 (3 eq calls)
      // Total: 7 eq calls
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)   // Q1 eq #1
        .mockReturnValueOnce(mockBuilder)   // Q1 eq #2
        .mockReturnValueOnce({ count: 0, error: null })  // Q1 eq #3 (terminal)
        .mockReturnValueOnce(mockBuilder)   // Q2 eq #1 (tournament lookup, maybeSingle is terminal)
        .mockReturnValueOnce(mockBuilder)   // Q3 eq #1
        .mockReturnValueOnce(mockBuilder)   // Q3 eq #2
        .mockReturnValueOnce({ count: 1, error: null }); // Q3 eq #3 (terminal)
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { season_id: 's1' },
        error: null,
      });

      const result = await isResourceAdminFor('p1', 'tournament', 't1');
      expect(result).toBe(true);
    });
  });

  describe('hasAnyResourceAdminRole', () => {
    it('returns true when any assignments exist', async () => {
      mockBuilder.eq.mockReturnValue({ count: 3, error: null });
      expect(await hasAnyResourceAdminRole('p1')).toBe(true);
    });

    it('returns false when no assignments', async () => {
      mockBuilder.eq.mockReturnValue({ count: 0, error: null });
      expect(await hasAnyResourceAdminRole('p1')).toBe(false);
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ count: null, error: { message: 'err' } });
      await expect(hasAnyResourceAdminRole('p1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getResourceAdmins', () => {
    it('returns admins with player names', async () => {
      // select().eq('resource_type').eq('resource_id') -- 2 eq calls
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({
          data: [
            {
              id: 'ra1',
              player_id: 'p1',
              resource_type: 'season',
              resource_id: 's1',
              created_at: '2025-01-01T00:00:00Z',
              players: { name: 'Alice' },
            },
          ],
          error: null,
        });

      const result = await getResourceAdmins('season', 's1');
      expect(result).toHaveLength(1);
      expect(result[0].player_name).toBe('Alice');
    });

    it('handles null data', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ data: null, error: null });
      const result = await getResourceAdmins('season', 's1');
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ data: null, error: { message: 'err' } });
      await expect(getResourceAdmins('season', 's1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getAdminAssignments', () => {
    it('returns assignments for player', async () => {
      mockBuilder.eq.mockReturnValue({
        data: [
          {
            id: 'ra1',
            player_id: 'p1',
            resource_type: 'season',
            resource_id: 's1',
            created_at: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
      });

      const result = await getAdminAssignments('p1');
      expect(result).toHaveLength(1);
      expect(result[0].resource_type).toBe('season');
    });
  });

  describe('getAdminSeasonIds', () => {
    it('returns season IDs', async () => {
      // select().eq('player_id').eq('resource_type') -- 2 eq calls
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({
          data: [{ resource_id: 's1' }, { resource_id: 's2' }],
          error: null,
        });
      const result = await getAdminSeasonIds('p1');
      expect(result).toEqual(['s1', 's2']);
    });

    it('throws on error', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ data: null, error: { message: 'err' } });
      await expect(getAdminSeasonIds('p1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getAdminTournamentIds', () => {
    it('returns direct tournament IDs when no season assignments', async () => {
      // getAdminAssignments: from.select.eq -> terminal .eq
      mockBuilder.eq.mockReturnValueOnce({
        data: [
          { id: 'ra1', player_id: 'p1', resource_type: 'tournament', resource_id: 't1', created_at: '2025-01-01T00:00:00Z' },
          { id: 'ra2', player_id: 'p1', resource_type: 'tournament', resource_id: 't2', created_at: '2025-01-01T00:00:00Z' },
        ],
        error: null,
      });

      const result = await getAdminTournamentIds('p1');
      expect(result).toEqual(['t1', 't2']);
    });

    it('includes season tournament IDs when season assignments exist', async () => {
      // getAdminAssignments
      mockBuilder.eq.mockReturnValueOnce({
        data: [
          { id: 'ra1', player_id: 'p1', resource_type: 'tournament', resource_id: 't1', created_at: '2025-01-01T00:00:00Z' },
          { id: 'ra2', player_id: 'p1', resource_type: 'season', resource_id: 's1', created_at: '2025-01-01T00:00:00Z' },
        ],
        error: null,
      });

      // Query tournaments for season s1: from.select.in -> terminal .in
      mockBuilder.in.mockReturnValueOnce({
        data: [{ id: 't2' }, { id: 't3' }],
        error: null,
      });

      const result = await getAdminTournamentIds('p1');
      expect(result).toContain('t1');
      expect(result).toContain('t2');
      expect(result).toContain('t3');
    });

    it('deduplicates tournament IDs from direct and season assignments', async () => {
      mockBuilder.eq.mockReturnValueOnce({
        data: [
          { id: 'ra1', player_id: 'p1', resource_type: 'tournament', resource_id: 't1', created_at: '2025-01-01T00:00:00Z' },
          { id: 'ra2', player_id: 'p1', resource_type: 'season', resource_id: 's1', created_at: '2025-01-01T00:00:00Z' },
        ],
        error: null,
      });

      // Season tournaments include t1 (already a direct assignment)
      mockBuilder.in.mockReturnValueOnce({
        data: [{ id: 't1' }, { id: 't2' }],
        error: null,
      });

      const result = await getAdminTournamentIds('p1');
      // Should be deduplicated
      const unique = [...new Set(result)];
      expect(result).toEqual(unique);
    });

    it('returns empty when player has no assignments', async () => {
      mockBuilder.eq.mockReturnValueOnce({ data: [], error: null });
      const result = await getAdminTournamentIds('p1');
      expect(result).toEqual([]);
    });

    it('throws when season tournaments query fails', async () => {
      mockBuilder.eq.mockReturnValueOnce({
        data: [
          { id: 'ra1', player_id: 'p1', resource_type: 'season', resource_id: 's1', created_at: '2025-01-01T00:00:00Z' },
        ],
        error: null,
      });

      mockBuilder.in.mockReturnValueOnce({ data: null, error: new Error('db err') });
      await expect(getAdminTournamentIds('p1')).rejects.toThrow('db err');
    });
  });

  describe('addResourceAdmin', () => {
    it('inserts and returns resource admin', async () => {
      mockBuilder.single.mockResolvedValue({
        data: {
          id: 'ra1',
          player_id: 'p1',
          resource_type: 'season',
          resource_id: 's1',
          created_at: '2025-01-01T00:00:00Z',
        },
        error: null,
      });

      const result = await addResourceAdmin('p1', 'season', 's1');
      expect(result.player_id).toBe('p1');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(addResourceAdmin('p1', 'season', 's1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('removeResourceAdmin', () => {
    it('deletes without error', async () => {
      // delete().eq().eq().eq() -- 3 eq calls
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: null });
      await expect(removeResourceAdmin('p1', 'season', 's1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: { message: 'err' } });
      await expect(removeResourceAdmin('p1', 'season', 's1')).rejects.toEqual({
        message: 'err',
      });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Wiki Notes
// ────────────────────────────────────────────────────────────────────────
describe('queries/wiki-notes', () => {
  beforeEach(resetMocks);

  const noteRow = {
    id: 'wn1',
    entity_type: 'pokemon',
    entity_name: 'Garchomp',
    author_id: 'p1',
    content: 'Strong in Gen 9 OU',
    scope_type: 'global',
    scope_id: null,
    approved: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    players: { name: 'Alice' },
  };

  describe('getApprovedNotes', () => {
    it('returns approved notes with author names', async () => {
      mockBuilder.limit.mockReturnValue({ data: [noteRow], error: null });

      const result = await getApprovedNotes('pokemon', 'Garchomp');
      expect(result).toHaveLength(1);
      expect(result[0].author_name).toBe('Alice');
      expect(result[0].approved).toBe(true);
    });

    it('applies optional scope filters', async () => {
      // Chain: select().eq().eq().eq().eq(scope_type).eq(scope_id).order().limit()
      mockBuilder.eq.mockReturnValue(mockBuilder);
      mockBuilder.order.mockReturnValue(mockBuilder);
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder) // entity_type
        .mockReturnValueOnce(mockBuilder) // entity_name
        .mockReturnValueOnce(mockBuilder) // approved
        .mockReturnValueOnce(mockBuilder) // scope_type
        .mockReturnValueOnce(mockBuilder); // scope_id (now chains through)
      mockBuilder.limit.mockReturnValue({ data: [], error: null }); // terminal
      await getApprovedNotes('pokemon', 'Garchomp', 'tournament', 't1');
      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_type', 'tournament');
      expect(mockBuilder.eq).toHaveBeenCalledWith('scope_id', 't1');
    });

    it('handles null data', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: null });
      const result = await getApprovedNotes('pokemon', 'X');
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(getApprovedNotes('pokemon', 'X')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('createNote', () => {
    it('creates and returns note', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...noteRow, approved: false, players: undefined },
        error: null,
      });

      const result = await createNote('p1', {
        entity_type: 'pokemon',
        entity_name: 'Garchomp',
        content: 'Strong in Gen 9 OU',
      });

      expect(result.approved).toBe(false);
      expect(mockBuilder.insert).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(
        createNote('p1', {
          entity_type: 'pokemon',
          entity_name: 'X',
          content: 'test',
        }),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('updateNote', () => {
    it('updates without error and reports that a row changed', async () => {
      mockBuilder.select.mockResolvedValue({ data: [{ id: 'wn1' }], error: null });
      await expect(updateNote('wn1', 'updated content', 'author')).resolves.toBe(true);
    });

    it('reports false when no row changed (a blocked or deleted note)', async () => {
      mockBuilder.select.mockResolvedValue({ data: [], error: null });
      await expect(updateNote('wn1', 'updated content', 'author')).resolves.toBe(false);
    });

    it('throws on error', async () => {
      mockBuilder.select.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(updateNote('wn1', 'x', 'moderator')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('deleteNote', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteNote('wn1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(deleteNote('wn1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('approveNote', () => {
    it('approves without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(approveNote('wn1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'err' } });
      await expect(approveNote('wn1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getNoteById', () => {
    it('returns mapped note', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...noteRow, players: undefined },
        error: null,
      });
      const result = await getNoteById('wn1');
      expect(result).not.toBeNull();
      expect(result!.entity_name).toBe('Garchomp');
    });

    it('returns null for PGRST116 (not found)', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      });
      expect(await getNoteById('x')).toBeNull();
    });

    it('throws on non-PGRST116 error', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { code: 'OTHER', message: 'bad' },
      });
      await expect(getNoteById('x')).rejects.toEqual({ code: 'OTHER', message: 'bad' });
    });

    it('returns null when data is null without error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: null });
      expect(await getNoteById('x')).toBeNull();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Avatar Gallery
// ────────────────────────────────────────────────────────────────────────
describe('queries/avatar-gallery', () => {
  beforeEach(resetMocks);

  const galleryRow = {
    id: 'ag1',
    player_id: 'p1',
    image_url: 'https://storage.example.com/gallery/img.png',
    choices: { type: 'standard', pokemon: 'Pikachu' },
    style: 'anime',
    created_at: '2025-01-01T00:00:00Z',
  };

  describe('insertGalleryItem', () => {
    it('inserts and returns gallery item', async () => {
      mockBuilder.single.mockResolvedValue({ data: galleryRow, error: null });

      const result = await insertGalleryItem({
        player_id: 'p1',
        image_url: 'https://storage.example.com/gallery/img.png',
        choices: { type: 'standard', pokemon: 'Pikachu' } as never,
        style: 'anime',
      });

      expect(result.id).toBe('ag1');
      expect(mockBuilder.insert).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(
        insertGalleryItem({
          player_id: 'p1',
          image_url: 'x',
          choices: {} as never,
          style: 'anime',
        }),
      ).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getPlayerGallery', () => {
    it('returns gallery items for player', async () => {
      mockBuilder.limit.mockReturnValue({ data: [galleryRow], error: null });

      const result = await getPlayerGallery('p1');
      expect(result).toHaveLength(1);
      expect(result[0].style).toBe('anime');
    });

    it('handles null data', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: null });
      const result = await getPlayerGallery('p1');
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: { message: 'err' } });
      await expect(getPlayerGallery('p1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getGalleryItem', () => {
    it('returns gallery item by id', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: galleryRow, error: null });
      const result = await getGalleryItem('ag1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('ag1');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getGalleryItem('x')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: { message: 'err' } });
      await expect(getGalleryItem('x')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('deleteGalleryItem', () => {
    it('returns true when item deleted', async () => {
      // delete().eq('id').eq('player_id') -- 2 eq calls
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: null, count: 1 });
      const result = await deleteGalleryItem('ag1', 'p1');
      expect(result).toBe(true);
    });

    it('returns false when no item matched', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: null, count: 0 });
      const result = await deleteGalleryItem('x', 'p1');
      expect(result).toBe(false);
    });

    it('throws on error', async () => {
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: { message: 'err' }, count: null });
      await expect(deleteGalleryItem('ag1', 'p1')).rejects.toEqual({ message: 'err' });
    });
  });

  describe('getCommunityAvatars', () => {
    it('returns gallery items from other players', async () => {
      // First query: players
      mockBuilder.neq.mockReturnValueOnce({
        data: [
          { id: 'p2', name: 'Bob', avatar_url: 'https://storage.example.com/gallery/bob.png' },
        ],
        error: null,
      });
      // Second query: gallery rows
      mockBuilder.limit.mockReturnValue({
        data: [
          { ...galleryRow, id: 'ag2', player_id: 'p2', image_url: 'https://storage.example.com/gallery/bob.png' },
        ],
        error: null,
      });

      const result = await getCommunityAvatars('p1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when no players have AI avatars', async () => {
      mockBuilder.neq.mockReturnValueOnce({
        data: [{ id: 'p2', name: 'Bob', avatar_url: 'https://cdn.example.com/normal.png' }],
        error: null,
      });

      const result = await getCommunityAvatars('p1');
      expect(result).toEqual([]);
    });

    it('returns empty when no players found', async () => {
      mockBuilder.neq.mockReturnValueOnce({ data: [], error: null });
      const result = await getCommunityAvatars('p1');
      expect(result).toEqual([]);
    });

    it('throws when players query fails', async () => {
      mockBuilder.neq.mockReturnValueOnce({ data: null, error: { message: 'err' } });
      await expect(getCommunityAvatars('p1')).rejects.toEqual({ message: 'err' });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreNotInPoolError, CoreTypesConflictError } from '@/lib/season/core-assignment';
import { DraftRuleError } from '@/lib/draft/errors';

// ── Supabase mock builder ─────────────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError',
] as const;

const mockBuilder = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return mb;
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

// ── Imports under test ────────────────────────────────────────────
import {
  listSeasons,
  listArchivedSeasons,
  listSeasonsByIds,
  getSeasonById,
  getSeasonWithDetails,
  createSeason,
  updateSeason,
  deleteSeason,
  SeasonHasDependentsError,
  getSeasonsByPlayer,
  getSeasonParticipants,
  addSeasonParticipant,
  swapSeasonParticipant,
  updateParticipantGymType,
  updateParticipantCoreTypes,
} from '../seasons';

import {
  listRulesets,
  getRulesetById,
  createRuleset,
  updateRuleset,
  deleteRuleset,
} from '../rulesets';

import {
  getSampleSets,
  getSampleSetsByFormat,
  searchSampleSets,
  upsertSampleSet,
  upsertSampleSetBatch,
  clearGenerationSets,
} from '../sample-sets';

// ── Fixtures ──────────────────────────────────────────────────────

const seasonRow = {
  id: 's1',
  name: 'Season 1',
  description: 'Test season',
  format_type: 'singles',
  ruleset_id: 'r1',
  start_date: '2025-01-01',
  end_date: '2025-06-01',
  status: 'active',
  archived: false,
  legacy: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

// Child counts arrive as PostgREST count embeds (`child ( count )`), not id arrays.
const seasonWithJoins = {
  ...seasonRow,
  rulesets: { name: 'Standard' },
  season_participants: [{ count: 2 }],
  tournaments: [{ count: 1 }],
};

const rulesetRow = {
  id: 'r1',
  name: 'Standard',
  base_format: 'gen9ou',
  is_doubles: false,
  clauses: ['Sleep Clause'],
  banned_pokemon: ['Mewtwo'],
  banned_moves: [],
  banned_items: [],
  banned_abilities: [],
  added_pokemon: [],
  custom_rules_string: null,
  min_shared_type_pct: 0,
  created_by: 'p1',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const sampleSetRow = {
  id: 'ss1',
  generation: 9,
  format: 'ou',
  pokemon_name: 'Garchomp',
  set_name: 'Swords Dance',
  moveset: { moves: ['Earthquake', 'Swords Dance', 'Scale Shot', 'Stone Edge'] },
  description: 'Standard SD set',
  outdated: false,
  last_imported: '2025-01-01T00:00:00Z',
};

const dbError = { message: 'DB error', code: 'PGRST000' };

// ── Reset ─────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockReset();
  mockBuilder.maybeSingle.mockReset();
});

// ===================================================================
// SEASONS
// ===================================================================

describe('seasons', () => {
  // ── listSeasons ─────────────────────────────────────────────────
  describe('listSeasons', () => {
    it('returns mapped seasons with details', async () => {
      mockBuilder.limit.mockReturnValue({ data: [seasonWithJoins], error: null });

      const result = await listSeasons();

      expect(mockBuilder.from).toHaveBeenCalledWith('seasons');
      expect(mockBuilder.eq).toHaveBeenCalledWith('archived', false);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Season 1');
      expect(result[0].ruleset_name).toBe('Standard');
      expect(result[0].participant_count).toBe(2);
      expect(result[0].tournament_count).toBe(1);
    });

    it('lists test leagues by default, sorted after the real leagues', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });

      await listSeasons();

      expect(mockBuilder.eq).toHaveBeenCalledWith('archived', false);
      expect(mockBuilder.eq).not.toHaveBeenCalledWith('is_test_season', expect.anything());
      // Real leagues (false) first, then newest first inside each group; both
      // before the 100-row cap, so test leagues never push a real one out.
      expect(mockBuilder.order.mock.calls).toEqual([
        ['is_test_season', { ascending: true }],
        ['created_at', { ascending: false }],
      ]);
      expect(mockBuilder.limit).toHaveBeenCalledWith(100);
    });

    it('keeps test leagues with includeTestSeasons: true (admin lists)', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });

      await listSeasons({ includeTestSeasons: true });

      expect(mockBuilder.eq).not.toHaveBeenCalledWith('is_test_season', expect.anything());
    });

    it('leaves test leagues out with includeTestSeasons: false', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });

      await listSeasons({ includeTestSeasons: false });

      expect(mockBuilder.eq).toHaveBeenCalledWith('is_test_season', false);
    });

    it('handles null rulesets join', async () => {
      const row = { ...seasonWithJoins, rulesets: null };
      mockBuilder.limit.mockReturnValue({ data: [row], error: null });

      const result = await listSeasons();
      expect(result[0].ruleset_name).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: dbError });
      await expect(listSeasons()).rejects.toEqual(dbError);
    });

    it('returns empty array when no seasons exist', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });
      const result = await listSeasons();
      expect(result).toEqual([]);
    });
  });

  // ── listArchivedSeasons ─────────────────────────────────────────
  describe('listArchivedSeasons', () => {
    it('filters by archived = true', async () => {
      const archived = { ...seasonWithJoins, archived: true };
      mockBuilder.limit.mockReturnValue({ data: [archived], error: null });

      const result = await listArchivedSeasons();

      expect(mockBuilder.eq).toHaveBeenCalledWith('archived', true);
      expect(result).toHaveLength(1);
    });

    it('throws on database error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: dbError });
      await expect(listArchivedSeasons()).rejects.toEqual(dbError);
    });
  });

  // ── listSeasonsByIds ────────────────────────────────────────────
  describe('listSeasonsByIds', () => {
    it('returns empty array for empty ids', async () => {
      const result = await listSeasonsByIds([]);
      expect(result).toEqual([]);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('filters by id list', async () => {
      mockBuilder.order.mockReturnValue({ data: [seasonWithJoins], error: null });

      const result = await listSeasonsByIds(['s1']);

      expect(mockBuilder.in).toHaveBeenCalledWith('id', ['s1']);
      expect(result).toHaveLength(1);
    });

    it('does not filter by archived unless asked (profile and filter callers want both)', async () => {
      mockBuilder.order.mockReturnValue({ data: [seasonWithJoins], error: null });

      await listSeasonsByIds(['s1']);

      expect(mockBuilder.eq).not.toHaveBeenCalledWith('archived', expect.anything());
    });

    it('archived: false keeps archived leagues out of the active admin list', async () => {
      mockBuilder.order.mockReturnValue({ data: [seasonWithJoins], error: null });

      await listSeasonsByIds(['s1', 's2'], { archived: false });

      expect(mockBuilder.in).toHaveBeenCalledWith('id', ['s1', 's2']);
      expect(mockBuilder.eq).toHaveBeenCalledWith('archived', false);
    });

    it('archived: true lists only archived leagues of the given ids', async () => {
      mockBuilder.order.mockReturnValue({ data: [{ ...seasonWithJoins, archived: true }], error: null });

      await listSeasonsByIds(['s1'], { archived: true });

      expect(mockBuilder.eq).toHaveBeenCalledWith('archived', true);
    });

    it('returns empty for empty ids even with an archived filter, without a read', async () => {
      expect(await listSeasonsByIds([], { archived: true })).toEqual([]);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(listSeasonsByIds(['s1'])).rejects.toEqual(dbError);
    });
  });

  // ── getSeasonById ───────────────────────────────────────────────
  describe('getSeasonById', () => {
    it('returns mapped season', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: seasonRow, error: null });

      const result = await getSeasonById('s1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 's1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('s1');
      expect(result!.format_type).toBe('singles');
    });

    it('maps the stored content language', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: { ...seasonRow, language: 'en' }, error: null });

      const result = await getSeasonById('s1');

      expect(result!.language).toBe('en');
    });

    it('falls back to the default content language for a missing or unknown value', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: seasonRow, error: null });
      expect((await getSeasonById('s1'))!.language).toBe('de');

      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { ...seasonRow, language: 'fr' }, error: null });
      expect((await getSeasonById('s1'))!.language).toBe('de');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getSeasonById('missing');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getSeasonById('s1')).rejects.toEqual(dbError);
    });
  });

  // ── getSeasonWithDetails ────────────────────────────────────────
  describe('getSeasonWithDetails', () => {
    it('returns mapped season with joins', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: seasonWithJoins, error: null });

      const result = await getSeasonWithDetails('s1');

      expect(result).not.toBeNull();
      expect(result!.ruleset_name).toBe('Standard');
      expect(result!.participant_count).toBe(2);
      expect(result!.tournament_count).toBe(1);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getSeasonWithDetails('missing');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getSeasonWithDetails('s1')).rejects.toEqual(dbError);
    });
  });

  // ── createSeason ────────────────────────────────────────────────
  describe('createSeason', () => {
    it('inserts and returns the created season', async () => {
      mockBuilder.single.mockResolvedValue({ data: seasonRow, error: null });

      const result = await createSeason({
        name: 'Season 1',
        description: 'Test season',
        format_type: 'singles',
        ruleset_id: 'r1',
        start_date: '2025-01-01',
        end_date: '2025-06-01',
      });

      expect(mockBuilder.from).toHaveBeenCalledWith('seasons');
      expect(mockBuilder.insert).toHaveBeenCalledWith({
        name: 'Season 1',
        description: 'Test season',
        format_type: 'singles',
        ruleset_id: 'r1',
        start_date: '2025-01-01',
        end_date: '2025-06-01',
      });
      expect(result.id).toBe('s1');
    });

    it('defaults optional fields to null/empty', async () => {
      mockBuilder.single.mockResolvedValue({ data: seasonRow, error: null });

      await createSeason({ name: 'Minimal', format_type: 'singles' });

      expect(mockBuilder.insert).toHaveBeenCalledWith({
        name: 'Minimal',
        description: '',
        format_type: 'singles',
        ruleset_id: null,
        start_date: null,
        end_date: null,
      });
    });

    it('sends the content language when set', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...seasonRow, language: 'en' }, error: null });

      const result = await createSeason({ name: 'EN League', format_type: 'singles', language: 'en' });

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg.language).toBe('en');
      expect(result.language).toBe('en');
    });

    it('omits the language key when unset so the DB default applies', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...seasonRow, language: 'de' }, error: null });

      await createSeason({ name: 'Minimal', format_type: 'singles' });

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect('language' in insertArg).toBe(false);
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(createSeason({ name: 'Fail', format_type: 'singles' })).rejects.toEqual(dbError);
    });
  });

  // ── updateSeason ────────────────────────────────────────────────
  describe('updateSeason', () => {
    it('updates provided fields only', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...seasonRow, name: 'Updated' }, error: null });

      const result = await updateSeason('s1', { name: 'Updated' });

      expect(mockBuilder.update).toHaveBeenCalledWith({ name: 'Updated' });
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 's1');
      expect(result.name).toBe('Updated');
    });

    it('supports status and archived fields', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...seasonRow, status: 'completed', archived: true }, error: null });

      await updateSeason('s1', { status: 'completed', archived: true });

      expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'completed', archived: true });
    });

    it('updates the content language', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...seasonRow, language: 'en' }, error: null });

      const result = await updateSeason('s1', { language: 'en' });

      expect(mockBuilder.update).toHaveBeenCalledWith({ language: 'en' });
      expect(result.language).toBe('en');
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(updateSeason('s1', { name: 'Fail' })).rejects.toEqual(dbError);
    });
  });

  // ── deleteSeason ────────────────────────────────────────────────
  describe('deleteSeason', () => {
    it('deletes the season by id', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await deleteSeason('s1');

      expect(mockBuilder.from).toHaveBeenCalledWith('seasons');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 's1');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(deleteSeason('s1')).rejects.toEqual(dbError);
    });

    it('answers SEASON_HAS_DEPENDENTS (409) when a row still references the league (23503)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockBuilder.eq.mockReturnValue({
          error: {
            code: '23503',
            message:
              'update or delete on table "seasons" violates foreign key constraint "tournaments_season_id_fkey" on table "tournaments"',
            details: 'Key (id)=(s1) is still referenced from table "tournaments".',
          },
        });
        const refusal = deleteSeason('s1');
        await expect(refusal).rejects.toBeInstanceOf(SeasonHasDependentsError);
        await expect(deleteSeason('s1')).rejects.toMatchObject({
          code: 'SEASON_HAS_DEPENDENTS',
          statusCode: 409,
          constraint: 'tournaments_season_id_fkey',
        });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('tournaments_season_id_fkey'));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('does not map other errors to SEASON_HAS_DEPENDENTS', async () => {
      const other = { code: '42501', message: 'permission denied for table seasons' };
      mockBuilder.eq.mockReturnValue({ error: other });
      await expect(deleteSeason('s1')).rejects.toBe(other);
    });
  });

  // ── getSeasonsByPlayer ──────────────────────────────────────────
  describe('getSeasonsByPlayer', () => {
    it('returns empty array when player has no seasons', async () => {
      // First query: season_participants returns empty
      mockBuilder.eq.mockReturnValue({ data: [], error: null });

      const result = await getSeasonsByPlayer('p1');
      expect(result).toEqual([]);
    });

    it('throws on database error in participant lookup', async () => {
      mockBuilder.eq.mockReturnValue({ data: null, error: dbError });
      await expect(getSeasonsByPlayer('p1')).rejects.toEqual(dbError);
    });

    it('keeps test leagues, sorted after the real ones (newest first in each group)', async () => {
      mockBuilder.eq.mockReturnValueOnce({
        data: [{ season_id: 'test-new' }, { season_id: 'real-mid' }, { season_id: 'real-old' }],
        error: null,
      });
      // listSeasonsByIds: newest first, as the query orders it.
      mockBuilder.order.mockReturnValueOnce({
        data: [
          { ...seasonWithJoins, id: 'test-new', is_test_season: true, created_at: '2026-03-01T00:00:00Z' },
          { ...seasonWithJoins, id: 'real-mid', is_test_season: false, created_at: '2026-02-01T00:00:00Z' },
          { ...seasonWithJoins, id: 'real-old', is_test_season: false, created_at: '2026-01-01T00:00:00Z' },
        ],
        error: null,
      });

      const result = await getSeasonsByPlayer('p1');

      expect(mockBuilder.in).toHaveBeenCalledWith('id', ['test-new', 'real-mid', 'real-old']);
      expect(result.map((s) => [s.id, s.is_test_season])).toEqual([
        ['real-mid', false],
        ['real-old', false],
        ['test-new', true],
      ]);
    });
  });

  // ── getSeasonParticipants ───────────────────────────────────────
  describe('getSeasonParticipants', () => {
    it('returns mapped participants', async () => {
      const playerRow = {
        id: 'p1',
        name: 'Ash',
        discord_id: 'disc1',
        ps_username: 'AshPS',
        champions_username: null,
        is_admin: false,
        is_creator: false,
        joined_date: '2025-01-01',
        avatar_url: null,
        avatar_config: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };
      mockBuilder.eq.mockReturnValue({
        data: [{ player_id: 'p1', gym_type: 'Fire', players: playerRow }],
        error: null,
      });

      const result = await getSeasonParticipants('s1');

      expect(mockBuilder.from).toHaveBeenCalledWith('season_participants');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Ash');
      expect(result[0].gym_type).toBe('Fire');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ data: null, error: dbError });
      await expect(getSeasonParticipants('s1')).rejects.toEqual(dbError);
    });
  });

  // ── addSeasonParticipant ────────────────────────────────────────
  describe('addSeasonParticipant', () => {
    it('inserts participant record', async () => {
      mockBuilder.insert.mockReturnValue({ error: null });

      await addSeasonParticipant('s1', 'p1');

      expect(mockBuilder.from).toHaveBeenCalledWith('season_participants');
      expect(mockBuilder.insert).toHaveBeenCalledWith({ season_id: 's1', player_id: 'p1' });
    });

    it('throws on database error', async () => {
      mockBuilder.insert.mockReturnValue({ error: dbError });
      await expect(addSeasonParticipant('s1', 'p1')).rejects.toEqual(dbError);
    });
  });

  // ── swapSeasonParticipant ───────────────────────────────────────
  describe('swapSeasonParticipant', () => {
    it('hands the roster row to the incoming player in one UPDATE (gym/core metadata stay on the row)', async () => {
      mockBuilder.select.mockReturnValueOnce({ data: [{ player_id: 'p-in' }], error: null });

      await swapSeasonParticipant('s1', 'p-out', 'p-in');

      expect(mockBuilder.from).toHaveBeenCalledTimes(1);
      expect(mockBuilder.from).toHaveBeenCalledWith('season_participants');
      expect(mockBuilder.update).toHaveBeenCalledWith({ player_id: 'p-in' });
      expect(mockBuilder.eq).toHaveBeenNthCalledWith(1, 'season_id', 's1');
      expect(mockBuilder.eq).toHaveBeenNthCalledWith(2, 'player_id', 'p-out');
      expect(mockBuilder.select).toHaveBeenCalledWith('player_id');
      expect(mockBuilder.delete).not.toHaveBeenCalled();
      expect(mockBuilder.insert).not.toHaveBeenCalled();
    });

    it('throws when the outgoing player is not on the roster (no row updated)', async () => {
      mockBuilder.select.mockReturnValueOnce({ data: [], error: null });

      await expect(swapSeasonParticipant('s1', 'p-out', 'p-in')).rejects.toThrow(
        'Outgoing player is not on the league roster',
      );
    });

    it('throws the UPDATE error (e.g. the incoming player is already on the roster) with no other write', async () => {
      mockBuilder.select.mockReturnValueOnce({ data: null, error: dbError });

      await expect(swapSeasonParticipant('s1', 'p-out', 'p-in')).rejects.toEqual(dbError);
      expect(mockBuilder.delete).not.toHaveBeenCalled();
      expect(mockBuilder.insert).not.toHaveBeenCalled();
    });

    it("maps the membership trigger's refusal (group drafting) to 409 SEASON_GROUP_SUBSTITUTION_LOCKED", async () => {
      mockBuilder.select.mockReturnValueOnce({
        data: null,
        error: {
          code: 'P0001',
          message: 'SEASON_GROUP_SUBSTITUTION_LOCKED',
          details: '{"season_group_id": "g-1"}',
          hint: null,
        },
      });

      const err = await swapSeasonParticipant('s1', 'p-out', 'p-in').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DraftRuleError);
      expect(err).toMatchObject({
        code: 'SEASON_GROUP_SUBSTITUTION_LOCKED',
        statusCode: 409,
        detail: { season_group_id: 'g-1' },
      });
    });

    it('maps a primary-key clash to 409 IN_ALREADY_ON_ROSTER', async () => {
      mockBuilder.select.mockReturnValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } });

      await expect(swapSeasonParticipant('s1', 'p-out', 'p-in')).rejects.toMatchObject({
        code: 'IN_ALREADY_ON_ROSTER',
        statusCode: 409,
      });
    });
  });

  // ── updateParticipantGymType ────────────────────────────────────
  describe('updateParticipantGymType', () => {
    it('updates gym type for a participant', async () => {
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockReturnValueOnce({ error: null });

      await updateParticipantGymType('s1', 'p1', 'Water');

      expect(mockBuilder.update).toHaveBeenCalledWith({ gym_type: 'Water' });
    });

    it('supports null gym type', async () => {
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockReturnValueOnce({ error: null });

      await updateParticipantGymType('s1', 'p1', null);

      expect(mockBuilder.update).toHaveBeenCalledWith({ gym_type: null });
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockReturnValueOnce({ error: dbError });
      await expect(updateParticipantGymType('s1', 'p1', 'Fire')).rejects.toEqual(dbError);
    });
  });

  // ── updateParticipantCoreTypes ──────────────────────────────────
  describe('updateParticipantCoreTypes', () => {
    it('clears core types for a participant', async () => {
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockReturnValueOnce({ error: null });

      await updateParticipantCoreTypes('s1', 'p1', null);

      expect(mockBuilder.update).toHaveBeenCalledWith({
        core_types: null,
        core_assigned_at: null,
      });
    });

    it('sets normalized core types with timestamp', async () => {
      mockBuilder.maybeSingle
        .mockResolvedValueOnce({ data: { core_pool: [['Fire', 'Grass', 'Water']] }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: null });
      mockBuilder.contains.mockReturnValueOnce(mockBuilder);
      mockBuilder.neq.mockReturnValueOnce(mockBuilder);

      await updateParticipantCoreTypes('s1', 'p1', ['Water', 'Fire', 'Grass']);

      expect(mockBuilder.contains).toHaveBeenCalledWith('core_types', ['Fire', 'Grass', 'Water']);
      expect(mockBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          core_types: ['Fire', 'Grass', 'Water'],
          core_assigned_at: expect.any(String),
        }),
      );
    });

    it('throws CoreTypesConflictError when triple is taken', async () => {
      mockBuilder.maybeSingle
        .mockResolvedValueOnce({ data: { core_pool: [['Fire', 'Grass', 'Water']] }, error: null })
        .mockResolvedValueOnce({ data: { player_id: 'p2' }, error: null });
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockReturnValueOnce(mockBuilder);
      mockBuilder.contains.mockReturnValueOnce(mockBuilder);
      mockBuilder.neq.mockReturnValueOnce(mockBuilder);

      await expect(
        updateParticipantCoreTypes('s1', 'p1', ['Fire', 'Water', 'Grass']),
      ).rejects.toBeInstanceOf(CoreTypesConflictError);
    });

    it('throws CoreNotInPoolError when triple is not in pool', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { core_pool: [['Electric', 'Flying', 'Steel']] },
        error: null,
      });

      await expect(
        updateParticipantCoreTypes('s1', 'p1', ['Fire', 'Water', 'Grass']),
      ).rejects.toBeInstanceOf(CoreNotInPoolError);
    });

    it('throws on database error during duplicate lookup', async () => {
      mockBuilder.maybeSingle
        .mockResolvedValueOnce({ data: { core_pool: [['Fire', 'Grass', 'Water']] }, error: null })
        .mockResolvedValueOnce({ data: null, error: dbError });
      mockBuilder.eq.mockReturnValueOnce(mockBuilder).mockReturnValueOnce(mockBuilder);
      mockBuilder.contains.mockReturnValueOnce(mockBuilder);
      mockBuilder.neq.mockReturnValueOnce(mockBuilder);

      await expect(
        updateParticipantCoreTypes('s1', 'p1', ['Fire', 'Water', 'Grass']),
      ).rejects.toEqual(dbError);
    });

    it('maps unique-index violation to CoreTypesConflictError', async () => {
      mockBuilder.maybeSingle
        .mockResolvedValueOnce({ data: { core_pool: [['Fire', 'Grass', 'Water']] }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        });
      mockBuilder.contains.mockReturnValueOnce(mockBuilder);
      mockBuilder.neq.mockReturnValueOnce(mockBuilder);

      await expect(
        updateParticipantCoreTypes('s1', 'p1', ['Fire', 'Water', 'Grass']),
      ).rejects.toBeInstanceOf(CoreTypesConflictError);
    });
  });
});

// ===================================================================
// RULESETS
// ===================================================================

describe('rulesets', () => {
  // ── listRulesets ────────────────────────────────────────────────
  describe('listRulesets', () => {
    it('returns mapped rulesets ordered by name', async () => {
      mockBuilder.order.mockReturnValue({ data: [rulesetRow], error: null });

      const result = await listRulesets();

      expect(mockBuilder.from).toHaveBeenCalledWith('rulesets');
      expect(mockBuilder.order).toHaveBeenCalledWith('name');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Standard');
      expect(result[0].bans.pokemon).toEqual(['Mewtwo']);
    });

    it('returns empty array when no rulesets exist', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await listRulesets();
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(listRulesets()).rejects.toEqual(dbError);
    });
  });

  // ── getRulesetById ──────────────────────────────────────────────
  describe('getRulesetById', () => {
    it('returns mapped ruleset', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: rulesetRow, error: null });

      const result = await getRulesetById('r1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'r1');
      expect(result).not.toBeNull();
      expect(result!.base_format).toBe('gen9ou');
      expect(result!.bans.pokemon).toEqual(['Mewtwo']);
      expect(result!.additions.pokemon).toEqual([]);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getRulesetById('missing');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getRulesetById('r1')).rejects.toEqual(dbError);
    });
  });

  // ── createRuleset ───────────────────────────────────────────────
  describe('createRuleset', () => {
    it('inserts and returns the created ruleset', async () => {
      mockBuilder.single.mockResolvedValue({ data: rulesetRow, error: null });

      const result = await createRuleset(
        {
          name: 'Standard',
          base_format: 'gen9ou',
          is_doubles: false,
          clauses: ['Sleep Clause'],
          banned_pokemon: ['Mewtwo'],
          banned_moves: [],
          banned_items: [],
          banned_abilities: [],
          added_pokemon: [],
          custom_rules_string: '',
          min_shared_type_pct: 0,
          team_constraints: null,
        },
        'p1'
      );

      expect(mockBuilder.from).toHaveBeenCalledWith('rulesets');
      expect(mockBuilder.insert).toHaveBeenCalled();
      expect(result.id).toBe('r1');
    });

    it('accepts null createdBy', async () => {
      mockBuilder.single.mockResolvedValue({ data: rulesetRow, error: null });

      await createRuleset(
        {
          name: 'System',
          base_format: 'gen9ou',
          is_doubles: false,
          clauses: [],
          banned_pokemon: [],
          banned_moves: [],
          banned_items: [],
          banned_abilities: [],
          added_pokemon: [],
          custom_rules_string: '',
          min_shared_type_pct: 0,
          team_constraints: null,
        },
        null
      );

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg.created_by).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(
        createRuleset(
          {
            name: 'Fail',
            base_format: 'gen9ou',
            is_doubles: false,
            clauses: [],
            banned_pokemon: [],
            banned_moves: [],
            banned_items: [],
            banned_abilities: [],
            added_pokemon: [],
            custom_rules_string: '',
            min_shared_type_pct: 0,
            team_constraints: null,
          },
          'p1'
        )
      ).rejects.toEqual(dbError);
    });
  });

  // ── updateRuleset ───────────────────────────────────────────────
  describe('updateRuleset', () => {
    it('updates only provided fields', async () => {
      mockBuilder.single.mockResolvedValue({ data: { ...rulesetRow, name: 'Custom' }, error: null });

      const result = await updateRuleset('r1', { name: 'Custom' });

      expect(mockBuilder.update).toHaveBeenCalledWith({ name: 'Custom' });
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'r1');
      expect(result.name).toBe('Custom');
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(updateRuleset('r1', { name: 'Fail' })).rejects.toEqual(dbError);
    });
  });

  // ── deleteRuleset ───────────────────────────────────────────────
  describe('deleteRuleset', () => {
    it('deletes the ruleset by id', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await deleteRuleset('r1');

      expect(mockBuilder.from).toHaveBeenCalledWith('rulesets');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'r1');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(deleteRuleset('r1')).rejects.toEqual(dbError);
    });
  });
});

// ===================================================================
// SAMPLE SETS
// ===================================================================

describe('sample-sets', () => {
  // ── getSampleSets ───────────────────────────────────────────────
  // getSampleSets chains .order() three times; the last one is the terminal call.
  describe('getSampleSets', () => {
    function setupOrderChain(result: { data: unknown; error: unknown }) {
      // .order('outdated') -> mockBuilder, .order('format') -> mockBuilder, .order('set_name') -> result
      mockBuilder.order
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(result);
    }

    it('returns sample sets for a pokemon', async () => {
      setupOrderChain({ data: [sampleSetRow], error: null });

      const result = await getSampleSets('Garchomp');

      expect(mockBuilder.from).toHaveBeenCalledWith('smogon_sample_sets');
      expect(mockBuilder.eq).toHaveBeenCalledWith('pokemon_name', 'Garchomp');
      expect(mockBuilder.eq).toHaveBeenCalledWith('outdated', false);
      expect(result).toHaveLength(1);
      expect(result[0].pokemon_name).toBe('Garchomp');
    });

    it('applies generation and format filters', async () => {
      setupOrderChain({ data: [], error: null });

      await getSampleSets('Garchomp', { generation: 9, format: 'ou' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('generation', 9);
      expect(mockBuilder.eq).toHaveBeenCalledWith('format', 'ou');
    });

    it('includes outdated when requested', async () => {
      setupOrderChain({ data: [], error: null });

      await getSampleSets('Garchomp', { includeOutdated: true });

      // Should NOT filter by outdated
      const outdatedCalls = mockBuilder.eq.mock.calls.filter(
        (c: unknown[]) => c[0] === 'outdated'
      );
      expect(outdatedCalls).toHaveLength(0);
    });

    it('returns empty array on null data', async () => {
      setupOrderChain({ data: null, error: null });
      const result = await getSampleSets('Unknown');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      setupOrderChain({ data: null, error: dbError });
      await expect(getSampleSets('Garchomp')).rejects.toEqual(dbError);
    });
  });

  // ── getSampleSetsByFormat ───────────────────────────────────────
  // getSampleSetsByFormat chains .order() twice; the last one is the terminal call.
  describe('getSampleSetsByFormat', () => {
    function setupDoubleOrder(result: { data: unknown; error: unknown }) {
      mockBuilder.order
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce(result);
    }

    it('returns sets grouped by pokemon name', async () => {
      const sets = [
        { ...sampleSetRow, pokemon_name: 'Garchomp', set_name: 'SD' },
        { ...sampleSetRow, id: 'ss2', pokemon_name: 'Garchomp', set_name: 'Scarf' },
        { ...sampleSetRow, id: 'ss3', pokemon_name: 'Landorus-Therian', set_name: 'Defensive' },
      ];
      setupDoubleOrder({ data: sets, error: null });

      const result = await getSampleSetsByFormat('ou', 9);

      expect(mockBuilder.eq).toHaveBeenCalledWith('generation', 9);
      expect(mockBuilder.eq).toHaveBeenCalledWith('format', 'ou');
      expect(Object.keys(result)).toHaveLength(2);
      expect(result['Garchomp']).toHaveLength(2);
      expect(result['Landorus-Therian']).toHaveLength(1);
    });

    it('returns empty object for no results', async () => {
      setupDoubleOrder({ data: [], error: null });
      const result = await getSampleSetsByFormat('ou', 9);
      expect(result).toEqual({});
    });

    it('throws on database error', async () => {
      setupDoubleOrder({ data: null, error: dbError });
      await expect(getSampleSetsByFormat('ou', 9)).rejects.toEqual(dbError);
    });
  });

  // ── searchSampleSets ────────────────────────────────────────────
  describe('searchSampleSets', () => {
    it('searches by name with limit', async () => {
      mockBuilder.limit.mockReturnValue({ data: [sampleSetRow], error: null });

      const result = await searchSampleSets('Garchomp');

      expect(mockBuilder.or).toHaveBeenCalledWith('pokemon_name.ilike."%Garchomp%",set_name.ilike."%Garchomp%"');
      expect(mockBuilder.limit).toHaveBeenCalledWith(20);
      expect(result).toHaveLength(1);
    });

    it('quotes and LIKE-escapes the search so it cannot add conditions (L1)', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });

      await searchSampleSets('a,id.neq.x)"%');

      expect(mockBuilder.or).toHaveBeenCalledWith(
        'pokemon_name.ilike."%a,id.neq.x)\\"\\\\%%",set_name.ilike."%a,id.neq.x)\\"\\\\%%"'
      );
    });

    it('applies generation filter when provided', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });

      await searchSampleSets('Garchomp', 9);

      expect(mockBuilder.eq).toHaveBeenCalledWith('generation', 9);
    });

    it('returns empty array on null data', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: null });
      const result = await searchSampleSets('Unknown');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: dbError });
      await expect(searchSampleSets('Garchomp')).rejects.toEqual(dbError);
    });
  });

  // ── upsertSampleSet ─────────────────────────────────────────────
  describe('upsertSampleSet', () => {
    it('upserts a single sample set', async () => {
      mockBuilder.upsert.mockReturnValue({ error: null });

      await upsertSampleSet({
        generation: 9,
        format: 'ou',
        pokemon_name: 'Garchomp',
        set_name: 'Swords Dance',
        moveset: { moves: ['Earthquake'] } as never,
        description: null as never,
        outdated: false,
      });

      expect(mockBuilder.from).toHaveBeenCalledWith('smogon_sample_sets');
      expect(mockBuilder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          generation: 9,
          format: 'ou',
          pokemon_name: 'Garchomp',
          set_name: 'Swords Dance',
        }),
        { onConflict: 'generation,format,pokemon_name,set_name' }
      );
    });

    it('throws on database error', async () => {
      mockBuilder.upsert.mockReturnValue({ error: dbError });
      await expect(
        upsertSampleSet({
          generation: 9,
          format: 'ou',
          pokemon_name: 'Garchomp',
          set_name: 'SD',
          moveset: { moves: [] } as never,
          description: null as never,
          outdated: false,
        })
      ).rejects.toEqual(dbError);
    });
  });

  // ── upsertSampleSetBatch ────────────────────────────────────────
  describe('upsertSampleSetBatch', () => {
    it('does nothing for empty array', async () => {
      await upsertSampleSetBatch([]);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('upserts multiple records', async () => {
      mockBuilder.upsert.mockReturnValue({ error: null });

      await upsertSampleSetBatch([
        {
          generation: 9,
          format: 'ou',
          pokemon_name: 'Garchomp',
          set_name: 'SD',
          moveset: { moves: [] } as never,
          description: null as never,
          outdated: false,
        },
        {
          generation: 9,
          format: 'ou',
          pokemon_name: 'Landorus-Therian',
          set_name: 'Defensive',
          moveset: { moves: [] } as never,
          description: null as never,
          outdated: false,
        },
      ]);

      const upsertArg = mockBuilder.upsert.mock.calls[0][0] as unknown[];
      expect(upsertArg).toHaveLength(2);
    });

    it('throws on database error', async () => {
      mockBuilder.upsert.mockReturnValue({ error: dbError });
      await expect(
        upsertSampleSetBatch([
          {
            generation: 9,
            format: 'ou',
            pokemon_name: 'Garchomp',
            set_name: 'SD',
            moveset: { moves: [] } as never,
            description: null as never,
            outdated: false,
          },
        ])
      ).rejects.toEqual(dbError);
    });
  });

  // ── clearGenerationSets ─────────────────────────────────────────
  describe('clearGenerationSets', () => {
    it('deletes all sets for a generation', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await clearGenerationSets(9);

      expect(mockBuilder.from).toHaveBeenCalledWith('smogon_sample_sets');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('generation', 9);
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(clearGenerationSets(9)).rejects.toEqual(dbError);
    });
  });
});

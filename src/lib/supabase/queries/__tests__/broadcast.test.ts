import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  getMomentsByMatch,
  getMomentsByGame,
  getRecentMomentsByMatch,
  createMoment,
  createMomentsBatch,
  deleteMoment,
} from '../broadcast-moments';

import {
  getPresetById,
  getPresetsByOwner,
  createPreset,
  updatePreset,
  deletePreset,
} from '../broadcast-presets';

import {
  listCastSessions,
  getCastSessionById,
  createCastSession,
  updateCastSession,
  deleteCastSession,
} from '../cast-sessions';

// ── Fixtures ──────────────────────────────────────────────────────

const momentRow = {
  id: 'm1',
  game_id: 'g1',
  match_id: 'match1',
  turn_number: 5,
  moment_type: 'big_ko',
  description: 'Garchomp fainted',
  pokemon_name: 'Garchomp',
  timestamp: '2025-01-01T00:10:00Z',
  created_by: 'p1',
};

const presetRow = {
  id: 'pr1',
  name: 'Default Overlay',
  owner_id: 'p1',
  preset_type: 'match_preview',
  config: { theme: 'dark', show_stats: true },
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const castSessionRow = {
  id: 'cs1',
  owner_id: 'p1',
  realtime_key: '00000000-0000-4000-8000-000000000001',
  match_id: 'match1',
  tournament_id: 't1',
  season_id: 's1',
  name: 'Finals Cast',
  mode: 'cast',
  status: 'draft',
  player1_id: 'p1',
  player1_name: 'Ash',
  player1_avatar_url: null,
  player2_id: 'p2',
  player2_name: 'Gary',
  player2_avatar_url: null,
  player1_team: [],
  player2_team: [],
  tracker_state: null,
  overlay_config: {},
  caster_notes: {},
  format: 'gen9ou',
  generation: 9,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
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
// BROADCAST MOMENTS
// ===================================================================

describe('broadcast-moments', () => {
  // ── getMomentsByMatch ───────────────────────────────────────────
  describe('getMomentsByMatch', () => {
    it('returns moments ordered by timestamp ascending', async () => {
      mockBuilder.order.mockReturnValue({ data: [momentRow], error: null });

      const result = await getMomentsByMatch('match1');

      expect(mockBuilder.from).toHaveBeenCalledWith('broadcast_moments');
      expect(mockBuilder.eq).toHaveBeenCalledWith('match_id', 'match1');
      expect(mockBuilder.order).toHaveBeenCalledWith('timestamp', { ascending: true });
      expect(result).toHaveLength(1);
      expect(result[0].moment_type).toBe('big_ko');
    });

    it('returns empty array on null data', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await getMomentsByMatch('match1');
      expect(result).toEqual([]);
    });

    it('returns empty array when no moments exist', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await getMomentsByMatch('match1');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(getMomentsByMatch('match1')).rejects.toEqual(dbError);
    });
  });

  // ── getMomentsByGame ────────────────────────────────────────────
  describe('getMomentsByGame', () => {
    it('returns moments for a specific game', async () => {
      mockBuilder.order.mockReturnValue({ data: [momentRow], error: null });

      const result = await getMomentsByGame('g1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('game_id', 'g1');
      expect(result).toHaveLength(1);
      expect(result[0].game_id).toBe('g1');
    });

    it('returns empty array on null data', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await getMomentsByGame('g1');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(getMomentsByGame('g1')).rejects.toEqual(dbError);
    });
  });

  // ── getRecentMomentsByMatch ─────────────────────────────────────
  describe('getRecentMomentsByMatch', () => {
    it('returns limited moments in descending order', async () => {
      mockBuilder.limit.mockReturnValue({ data: [momentRow], error: null });

      const result = await getRecentMomentsByMatch('match1', 3);

      expect(mockBuilder.order).toHaveBeenCalledWith('timestamp', { ascending: false });
      expect(mockBuilder.limit).toHaveBeenCalledWith(3);
      expect(result).toHaveLength(1);
    });

    it('uses default limit of 5', async () => {
      mockBuilder.limit.mockReturnValue({ data: [], error: null });

      await getRecentMomentsByMatch('match1');

      expect(mockBuilder.limit).toHaveBeenCalledWith(5);
    });

    it('returns empty array on null data', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: null });
      const result = await getRecentMomentsByMatch('match1');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.limit.mockReturnValue({ data: null, error: dbError });
      await expect(getRecentMomentsByMatch('match1')).rejects.toEqual(dbError);
    });
  });

  // ── createMoment ────────────────────────────────────────────────
  describe('createMoment', () => {
    it('inserts and returns the created moment', async () => {
      mockBuilder.single.mockResolvedValue({ data: momentRow, error: null });

      const result = await createMoment({
        match_id: 'match1',
        moment_type: 'big_ko',
        created_by: 'p1',
        game_id: 'g1',
        turn_number: 5,
        description: 'Garchomp fainted',
        pokemon_name: 'Garchomp',
      });

      expect(mockBuilder.from).toHaveBeenCalledWith('broadcast_moments');
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          match_id: 'match1',
          moment_type: 'big_ko',
          game_id: 'g1',
        })
      );
      expect(result.id).toBe('m1');
    });

    it('defaults optional fields to null', async () => {
      mockBuilder.single.mockResolvedValue({ data: momentRow, error: null });

      await createMoment({
        match_id: 'match1',
        moment_type: 'big_ko',
        created_by: 'p1',
      });

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg.game_id).toBeNull();
      expect(insertArg.turn_number).toBeNull();
      expect(insertArg.description).toBeNull();
      expect(insertArg.pokemon_name).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(
        createMoment({ match_id: 'match1', moment_type: 'big_ko', created_by: 'p1' })
      ).rejects.toEqual(dbError);
    });
  });

  // ── createMomentsBatch ──────────────────────────────────────────
  describe('createMomentsBatch', () => {
    it('returns empty array for empty input', async () => {
      const result = await createMomentsBatch([]);
      expect(result).toEqual([]);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('inserts multiple moments', async () => {
      mockBuilder.select.mockReturnValue({ data: [momentRow, { ...momentRow, id: 'm2' }], error: null });

      const result = await createMomentsBatch([
        { match_id: 'match1', moment_type: 'big_ko', created_by: 'p1' },
        { match_id: 'match1', moment_type: 'highlight', created_by: 'p1' },
      ]);

      expect(mockBuilder.insert).toHaveBeenCalled();
      const insertArg = mockBuilder.insert.mock.calls[0][0] as unknown[];
      expect(insertArg).toHaveLength(2);
      expect(result).toHaveLength(2);
    });

    it('returns empty array on null data', async () => {
      mockBuilder.select.mockReturnValue({ data: null, error: null });

      const result = await createMomentsBatch([
        { match_id: 'match1', moment_type: 'big_ko', created_by: 'p1' },
      ]);
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.select.mockReturnValue({ data: null, error: dbError });
      await expect(
        createMomentsBatch([
          { match_id: 'match1', moment_type: 'big_ko', created_by: 'p1' },
        ])
      ).rejects.toEqual(dbError);
    });
  });

  // ── deleteMoment ────────────────────────────────────────────────
  describe('deleteMoment', () => {
    it('deletes by id', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await deleteMoment('m1');

      expect(mockBuilder.from).toHaveBeenCalledWith('broadcast_moments');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(deleteMoment('m1')).rejects.toEqual(dbError);
    });
  });
});

// ===================================================================
// BROADCAST PRESETS
// ===================================================================

describe('broadcast-presets', () => {
  // ── getPresetById ───────────────────────────────────────────────
  describe('getPresetById', () => {
    it('returns mapped preset', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: presetRow, error: null });

      const result = await getPresetById('pr1');

      expect(mockBuilder.from).toHaveBeenCalledWith('broadcast_presets');
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'pr1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Default Overlay');
      expect(result!.preset_type).toBe('match_preview');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getPresetById('missing');
      expect(result).toBeNull();
    });

    it('throws on database error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });
      await expect(getPresetById('pr1')).rejects.toEqual(dbError);
    });
  });

  // ── getPresetsByOwner ───────────────────────────────────────────
  describe('getPresetsByOwner', () => {
    it('returns presets for owner ordered by updated_at desc', async () => {
      mockBuilder.order.mockReturnValue({ data: [presetRow], error: null });

      const result = await getPresetsByOwner('p1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'p1');
      expect(mockBuilder.order).toHaveBeenCalledWith('updated_at', { ascending: false });
      expect(result).toHaveLength(1);
    });

    it('returns empty array on null data', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await getPresetsByOwner('p1');
      expect(result).toEqual([]);
    });

    it('returns empty array when owner has no presets', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await getPresetsByOwner('nobody');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(getPresetsByOwner('p1')).rejects.toEqual(dbError);
    });
  });

  // ── createPreset ────────────────────────────────────────────────
  describe('createPreset', () => {
    it('inserts and returns the created preset', async () => {
      mockBuilder.single.mockResolvedValue({ data: presetRow, error: null });

      const result = await createPreset({
        name: 'Default Overlay',
        owner_id: 'p1',
        preset_type: 'match_preview',
        config: { theme: 'dark', show_stats: true } as never,
      });

      expect(mockBuilder.from).toHaveBeenCalledWith('broadcast_presets');
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Default Overlay',
          owner_id: 'p1',
          preset_type: 'match_preview',
        })
      );
      expect(result.id).toBe('pr1');
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(
        createPreset({
          name: 'Fail',
          owner_id: 'p1',
          preset_type: 'match_preview',
          config: {} as never,
        })
      ).rejects.toEqual(dbError);
    });
  });

  // ── updatePreset ────────────────────────────────────────────────
  describe('updatePreset', () => {
    it('updates name field', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...presetRow, name: 'Updated Overlay' },
        error: null,
      });

      const result = await updatePreset('pr1', { name: 'Updated Overlay' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'pr1');
      expect(result.name).toBe('Updated Overlay');
    });

    it('updates config field', async () => {
      const newConfig = { theme: 'light', show_stats: false };
      mockBuilder.single.mockResolvedValue({
        data: { ...presetRow, config: newConfig },
        error: null,
      });

      await updatePreset('pr1', { config: newConfig as never });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.config).toEqual(newConfig);
    });

    it('includes updated_at timestamp', async () => {
      mockBuilder.single.mockResolvedValue({ data: presetRow, error: null });

      await updatePreset('pr1', { name: 'Test' });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.updated_at).toBeDefined();
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(updatePreset('pr1', { name: 'Fail' })).rejects.toEqual(dbError);
    });
  });

  // ── deletePreset ────────────────────────────────────────────────
  describe('deletePreset', () => {
    it('deletes by id', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await deletePreset('pr1');

      expect(mockBuilder.from).toHaveBeenCalledWith('broadcast_presets');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'pr1');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(deletePreset('pr1')).rejects.toEqual(dbError);
    });
  });
});

// ===================================================================
// CAST SESSIONS
// ===================================================================

describe('cast-sessions', () => {
  // ── listCastSessions ────────────────────────────────────────────
  describe('listCastSessions', () => {
    it('returns sessions for owner ordered by updated_at desc', async () => {
      mockBuilder.order.mockReturnValue({ data: [castSessionRow], error: null });

      const result = await listCastSessions('p1');

      expect(mockBuilder.from).toHaveBeenCalledWith('cast_sessions');
      expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'p1');
      expect(mockBuilder.order).toHaveBeenCalledWith('updated_at', { ascending: false });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Finals Cast');
      expect(result[0].mode).toBe('cast');
    });

    it('returns empty array when owner has no sessions', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await listCastSessions('nobody');
      expect(result).toEqual([]);
    });

    it('throws on database error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: dbError });
      await expect(listCastSessions('p1')).rejects.toEqual(dbError);
    });
  });

  // ── getCastSessionById ──────────────────────────────────────────
  describe('getCastSessionById', () => {
    it('returns mapped session', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      const result = await getCastSessionById('cs1');

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'cs1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Finals Cast');
      expect(result!.format).toBe('gen9ou');
      expect(result!.generation).toBe(9);
    });

    it('returns null on PGRST116 (not found)', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await getCastSessionById('missing');
      expect(result).toBeNull();
    });

    it('throws on non-PGRST116 errors', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(getCastSessionById('cs1')).rejects.toEqual(dbError);
    });
  });

  // ── createCastSession ───────────────────────────────────────────
  describe('createCastSession', () => {
    it('inserts and returns the created session', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      const result = await createCastSession('p1', {
        name: 'Finals Cast',
        mode: 'cast',
        match_id: 'match1',
        tournament_id: 't1',
        season_id: 's1',
        player1_id: 'p1',
        player1_name: 'Ash',
        player2_id: 'p2',
        player2_name: 'Gary',
      });

      expect(mockBuilder.from).toHaveBeenCalledWith('cast_sessions');
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          owner_id: 'p1',
          name: 'Finals Cast',
          mode: 'cast',
        })
      );
      expect(result.id).toBe('cs1');
    });

    it('applies default values for optional fields', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      await createCastSession('p1', {});

      const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertArg.name).toBe('Untitled Session');
      expect(insertArg.mode).toBe('cast');
      expect(insertArg.match_id).toBeNull();
      expect(insertArg.tournament_id).toBeNull();
      expect(insertArg.season_id).toBeNull();
      expect(insertArg.player1_id).toBeNull();
      expect(insertArg.player1_name).toBeNull();
      expect(insertArg.player2_id).toBeNull();
      expect(insertArg.player2_name).toBeNull();
      expect(insertArg.format).toBe('gen9ou');
      expect(insertArg.generation).toBe(9);
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(createCastSession('p1', { name: 'Fail' })).rejects.toEqual(dbError);
    });
  });

  // ── updateCastSession ───────────────────────────────────────────
  describe('updateCastSession', () => {
    it('updates provided fields', async () => {
      mockBuilder.single.mockResolvedValue({
        data: { ...castSessionRow, name: 'Updated', status: 'live' },
        error: null,
      });

      const result = await updateCastSession('cs1', { name: 'Updated', status: 'live' });

      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'cs1');
      expect(result.name).toBe('Updated');
      expect(result.status).toBe('live');
    });

    it('includes updated_at timestamp', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      await updateCastSession('cs1', { name: 'Test' });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.updated_at).toBeDefined();
    });

    it('handles team and tracker_state updates', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      const team = [{ species: 'Garchomp' }];
      const tracker = { turn: 1 };
      await updateCastSession('cs1', {
        player1_team: team as never,
        tracker_state: tracker,
      });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.player1_team).toEqual(team);
      expect(updateArg.tracker_state).toEqual(tracker);
    });

    it('does not include unset fields in payload', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      await updateCastSession('cs1', { name: 'Only Name' });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.name).toBe('Only Name');
      expect(updateArg).not.toHaveProperty('status');
      expect(updateArg).not.toHaveProperty('mode');
      expect(updateArg).not.toHaveProperty('player1_team');
    });

    it('handles player2_avatar_url, player2_team, overlay_config, caster_notes updates', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      const overlayConfig = { theme: 'dark', layout: 'standard' };
      const casterNotes = { round: 'Finals', notes: 'Great match' } as never as never;
      const team2 = [{ species: 'Dragonite' }];

      await updateCastSession('cs1', {
        player2_avatar_url: 'https://example.com/avatar.png',
        player2_team: team2 as never,
        overlay_config: overlayConfig as never,
        caster_notes: casterNotes,
      });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.player2_avatar_url).toBe('https://example.com/avatar.png');
      expect(updateArg.player2_team).toEqual(team2);
      expect(updateArg.overlay_config).toEqual(overlayConfig);
      expect(updateArg.caster_notes).toEqual(casterNotes);
    });

    it('handles format and generation updates', async () => {
      mockBuilder.single.mockResolvedValue({ data: castSessionRow, error: null });

      await updateCastSession('cs1', {
        format: 'gen8ou',
        generation: 8,
      });

      const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateArg.format).toBe('gen8ou');
      expect(updateArg.generation).toBe(8);
    });

    it('throws on database error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: dbError });
      await expect(updateCastSession('cs1', { name: 'Fail' })).rejects.toEqual(dbError);
    });
  });

  // ── deleteCastSession ───────────────────────────────────────────
  describe('deleteCastSession', () => {
    it('deletes by id', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await deleteCastSession('cs1');

      expect(mockBuilder.from).toHaveBeenCalledWith('cast_sessions');
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'cs1');
    });

    it('throws on database error', async () => {
      mockBuilder.eq.mockReturnValue({ error: dbError });
      await expect(deleteCastSession('cs1')).rejects.toEqual(dbError);
    });
  });
});

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
import {
  listAchievementDefinitions,
  getAchievementDefinition,
  createAchievementDefinition,
  updateAchievementDefinition,
  deleteAchievementDefinition,
  getPlayerAchievements,
  getPlayerAchievementKeys,
  upsertPlayerAchievement,
} from '../achievements';

// ── Helpers ────────────────────────────────────────────────────────────
function resetMocks() {
  for (const m of chainMethods) {
    mockBuilder[m].mockClear().mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockReset();
  mockBuilder.maybeSingle.mockReset();
}

// ── Test data ──────────────────────────────────────────────────────────
const defRow = {
  id: 'ad1',
  key: 'first_win',
  name: 'First Win',
  description: 'Win your first match',
  icon: 'trophy',
  category: 'combat',
  tier: 'bronze',
  repeatable: false,
  hidden: false,
  criteria: { type: 'win_count', threshold: 1 },
  created_at: '2025-01-01T00:00:00Z',
};

const playerAchRow = {
  id: 'pa1',
  player_id: 'p1',
  achievement_id: 'ad1',
  earned_at: '2025-06-01T00:00:00Z',
  context: { match_id: 'm1' },
  times_earned: 1,
};

// ────────────────────────────────────────────────────────────────────────
describe('queries/achievements', () => {
  beforeEach(resetMocks);

  // ── listAchievementDefinitions ────────────────────────────────────
  describe('listAchievementDefinitions', () => {
    it('returns mapped definitions', async () => {
      mockBuilder.order.mockReturnValue({ data: [defRow], error: null });

      const result = await listAchievementDefinitions();
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('first_win');
      expect(result[0].category).toBe('combat');
      expect(mockBuilder.from).toHaveBeenCalledWith('achievement_definitions');
    });

    it('returns empty array when no definitions', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await listAchievementDefinitions();
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'list error' },
      });
      await expect(listAchievementDefinitions()).rejects.toEqual({
        message: 'list error',
      });
    });
  });

  // ── getAchievementDefinition ──────────────────────────────────────
  describe('getAchievementDefinition', () => {
    it('returns mapped definition', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: defRow, error: null });

      const result = await getAchievementDefinition('ad1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('First Win');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getAchievementDefinition('nonexistent');
      expect(result).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'get error' },
      });
      await expect(getAchievementDefinition('ad1')).rejects.toEqual({
        message: 'get error',
      });
    });
  });

  // ── createAchievementDefinition ───────────────────────────────────
  describe('createAchievementDefinition', () => {
    it('inserts and returns mapped definition', async () => {
      mockBuilder.single.mockResolvedValue({ data: defRow, error: null });

      const result = await createAchievementDefinition({
        key: 'first_win',
        name: 'First Win',
        description: 'Win your first match',
        icon: 'trophy',
        category: 'combat',
        tier: 'bronze',
        repeatable: false,
        hidden: false,
        criteria: { type: 'win_count', threshold: 1 } as never,
      });

      expect(result.key).toBe('first_win');
      expect(mockBuilder.insert).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'create error' },
      });

      await expect(
        createAchievementDefinition({
          key: 'x',
          name: 'X',
          description: 'x',
          icon: null,
          category: 'combat',
          tier: 'bronze',
          repeatable: false,
          hidden: false,
          criteria: {} as never,
        }),
      ).rejects.toEqual({ message: 'create error' });
    });
  });

  // ── updateAchievementDefinition ───────────────────────────────────
  describe('updateAchievementDefinition', () => {
    it('updates and returns mapped definition', async () => {
      const updatedRow = { ...defRow, name: 'Updated Win' };
      mockBuilder.single.mockResolvedValue({ data: updatedRow, error: null });

      const result = await updateAchievementDefinition('ad1', { name: 'Updated Win' });
      expect(result.name).toBe('Updated Win');
      expect(mockBuilder.update).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'ad1');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'update error' },
      });

      await expect(
        updateAchievementDefinition('ad1', { name: 'X' }),
      ).rejects.toEqual({ message: 'update error' });
    });
  });

  // ── deleteAchievementDefinition ───────────────────────────────────
  describe('deleteAchievementDefinition', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });

      await expect(deleteAchievementDefinition('ad1')).resolves.toBeUndefined();
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'ad1');
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: { message: 'delete error' } });

      await expect(deleteAchievementDefinition('ad1')).rejects.toEqual({
        message: 'delete error',
      });
    });
  });

  // ── getPlayerAchievements ─────────────────────────────────────────
  describe('getPlayerAchievements', () => {
    it('returns earned achievements with joined definitions', async () => {
      mockBuilder.order.mockReturnValue({
        data: [
          {
            ...playerAchRow,
            achievement_definitions: defRow,
          },
        ],
        error: null,
      });

      const result = await getPlayerAchievements('p1');
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('first_win');
      expect(result[0].earned_at).toBe('2025-06-01T00:00:00Z');
      expect(result[0].times_earned).toBe(1);
    });

    it('returns empty array when none earned', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      const result = await getPlayerAchievements('p-none');
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({
        data: null,
        error: { message: 'player ach error' },
      });
      await expect(getPlayerAchievements('p1')).rejects.toEqual({
        message: 'player ach error',
      });
    });
  });

  // ── getPlayerAchievementKeys ──────────────────────────────────────
  describe('getPlayerAchievementKeys', () => {
    it('returns set of achievement keys', async () => {
      mockBuilder.eq.mockReturnValue({
        data: [
          { achievement_definitions: { key: 'first_win' } },
          { achievement_definitions: { key: 'streak_3' } },
        ],
        error: null,
      });

      const result = await getPlayerAchievementKeys('p1');
      expect(result).toBeInstanceOf(Set);
      expect(result.has('first_win')).toBe(true);
      expect(result.has('streak_3')).toBe(true);
      expect(result.size).toBe(2);
    });

    it('returns empty set when none', async () => {
      mockBuilder.eq.mockReturnValue({ data: [], error: null });
      const result = await getPlayerAchievementKeys('p-none');
      expect(result.size).toBe(0);
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({
        data: null,
        error: { message: 'keys error' },
      });
      await expect(getPlayerAchievementKeys('p1')).rejects.toEqual({
        message: 'keys error',
      });
    });
  });

  // ── upsertPlayerAchievement ───────────────────────────────────────
  describe('upsertPlayerAchievement', () => {
    it('creates new when no existing achievement', async () => {
      // First call: maybeSingle returns null (no existing)
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      // Second call: insert().select().single()
      mockBuilder.single.mockResolvedValue({ data: playerAchRow, error: null });

      const result = await upsertPlayerAchievement('p1', 'ad1', { match_id: 'm1' });
      expect(result.times_earned).toBe(1);
      expect(mockBuilder.insert).toHaveBeenCalled();
    });

    it('increments times_earned when existing', async () => {
      // First call: maybeSingle returns existing row
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { ...playerAchRow, times_earned: 2 },
        error: null,
      });
      // Second call: update().eq().select().single()
      mockBuilder.single.mockResolvedValue({
        data: { ...playerAchRow, times_earned: 3 },
        error: null,
      });

      const result = await upsertPlayerAchievement('p1', 'ad1', { match_id: 'm2' });
      expect(result.times_earned).toBe(3);
      expect(mockBuilder.update).toHaveBeenCalled();
    });

    it('throws when fetch fails', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'fetch fail' },
      });

      await expect(
        upsertPlayerAchievement('p1', 'ad1', {}),
      ).rejects.toEqual({ message: 'fetch fail' });
    });

    it('throws when insert fails', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockBuilder.single.mockResolvedValue({
        data: null,
        error: { message: 'insert fail' },
      });

      await expect(
        upsertPlayerAchievement('p1', 'ad1', {}),
      ).rejects.toEqual({ message: 'insert fail' });
    });
  });
});

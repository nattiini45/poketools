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

// ── Imports ────────────────────────────────────────────────────────
import {
  getDraftPoolById,
  getDraftPoolBySeason,
  getDraftPoolsBySeason,
  getDraftPoolWithDetails,
  listDraftPools,
  createDraftPool,
  updateDraftPoolStatus,
  switchDraftPoolToFreeOrder,
  deleteDraftPool,
  getPicksByPool,
  getPicksByPlayer,
  createDraftPick,
  undoLastPick,
  getPickCount,
} from '../drafts';

import {
  getPoolEntries,
  getPoolEntry,
  createPoolEntry,
  bulkCreatePoolEntries,
  updatePoolEntry,
  deletePoolEntry,
  deleteAllPoolEntries,
} from '../draft-pool-entries';

import {
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
} from '../draft-pool-templates';

import {
  getTierLimits,
  getTierLimit,
  upsertTierLimits,
} from '../draft-tier-limits';

import {
  getReplayEventsByPool,
  getReplayEventById,
  getNextSequenceNumber,
  createReplayEvent,
  updateReplayEvent,
  deleteReplayEvent,
} from '../draft-replay-events';

// ── Fixtures ───────────────────────────────────────────────────────
const draftPoolRow = {
  id: 'dp-1',
  season_id: 's-1',
  draft_type: 'snake',
  point_budget: 100,
  pool_mode: 'tier',
  default_point_cost: null,
  team_size_mode: null,
  team_size_exact: null,
  team_size_min: null,
  team_size_max: null,
  status: 'pending',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const draftPickRow = {
  id: 'pk-1',
  draft_pool_id: 'dp-1',
  player_id: 'p-1',
  pokemon_name: 'Pikachu',
  pick_number: 1,
  round: 1,
  points_spent: 10,
  timestamp: '2025-01-01T00:00:00Z',
};

const poolEntryRow = {
  id: 'pe-1',
  season_id: 's-1',
  pokemon_name: 'Pikachu',
  power_tier: 'A',
  point_cost: 10,
  created_at: '2025-01-01T00:00:00Z',
};

const templateRow = {
  id: 'tpl-1',
  name: 'Standard',
  description: 'A standard template',
  created_by: 'p-1',
  pool_mode: 'tier',
  entries: [{ pokemon_name: 'Pikachu', power_tier: 'A' }],
  created_at: '2025-01-01T00:00:00Z',
};

const tierLimitRow = {
  id: 'tl-1',
  season_id: 's-1',
  power_tier: 'S',
  max_picks: 1,
};

const replayEventRow = {
  id: 're-1',
  draft_pool_id: 'dp-1',
  pick_id: 'pk-1',
  event_type: 'pick',
  event_data: { pokemon_name: 'Pikachu' },
  sequence_number: 1,
  wall_clock_time: '2025-01-01T00:00:00Z',
  display_duration_ms: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

// ====================================================================
// DRAFT POOLS
// ====================================================================
describe('queries/drafts — pools', () => {
  describe('getDraftPoolById', () => {
    it('returns pool when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: draftPoolRow, error: null });
      const result = await getDraftPoolById('dp-1');
      expect(result).not.toBeNull();
      expect(result!.draft_type).toBe('snake');
      expect(mockBuilder.from).toHaveBeenCalledWith('draft_pools');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getDraftPoolById('missing')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('db err') });
      await expect(getDraftPoolById('dp-1')).rejects.toThrow('db err');
    });
  });

  describe('getDraftPoolBySeason', () => {
    it('returns pool for the season', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: draftPoolRow, error: null });
      const result = await getDraftPoolBySeason('s-1');
      expect(result).not.toBeNull();
      expect(mockBuilder.eq).toHaveBeenCalledWith('season_id', 's-1');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getDraftPoolBySeason('s-99')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getDraftPoolBySeason('s-1')).rejects.toThrow('err');
    });

    it('reads the oldest pool, so a second (redraft) pool cannot break maybeSingle', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: draftPoolRow, error: null });
      await getDraftPoolBySeason('s-1');
      expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: true });
      expect(mockBuilder.limit).toHaveBeenCalledWith(1);
    });
  });

  describe('queue-engine columns (B-SNAP)', () => {
    it('a row without the M2 columns maps to a legacy pool with the column defaults', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: draftPoolRow, error: null });
      const pool = await getDraftPoolById('dp-1');
      expect(pool).toMatchObject({ engine: 'legacy', kind: 'initial', mode: 'live', phase: 'setup', pause_reason: null });
    });

    it('maps and narrows the queue columns of a pool row', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: {
          ...draftPoolRow, engine: 'queue', kind: 'redraft', mode: 'slow', phase: 'submissions', list_version_id: 'lv-1',
          parent_pool_id: 'dp-0', pause_reason: 'blocked_slot', state_version: 5, slow_ladder_seconds: [600],
          extension_seconds: [120, 60], submission_deadline_at: '2026-10-18T21:59:59Z',
        },
        error: null,
      });
      const pool = await getDraftPoolById('dp-1');
      expect(pool).toMatchObject({
        engine: 'queue', kind: 'redraft', mode: 'slow', phase: 'submissions', list_version_id: 'lv-1',
        parent_pool_id: 'dp-0', pause_reason: 'blocked_slot', state_version: 5, slow_ladder_seconds: [600],
        extension_seconds: [120, 60], submission_deadline_at: '2026-10-18T21:59:59Z',
      });
    });

    it('drops values outside the known unions', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { ...draftPoolRow, engine: 'turbo', kind: 'weird', pause_reason: null },
        error: null,
      });
      const pool = await getDraftPoolById('dp-1');
      // Unknown text falls back to the column default (the CHECK constraints rule it out in the database).
      expect(pool?.engine).toBe('legacy');
      expect(pool?.kind).toBe('initial');
      expect(pool?.pause_reason).toBeNull();
    });

    it('maps the line and queue columns of a pick row', async () => {
      mockBuilder.order.mockResolvedValueOnce({
        data: [{ ...draftPickRow, line_id: 'eevee--sylveon', slot_id: 'sl-1', made_by_role: 'admin', voided_at: null }],
        error: null,
      });
      const [pick] = await getPicksByPlayer('dp-1', 'p-1');
      expect(pick).toMatchObject({ line_id: 'eevee--sylveon', slot_id: 'sl-1', made_by_role: 'admin', voided_at: null });
    });
  });

  describe('getDraftPoolsBySeason', () => {
    it('narrows an unknown engine to legacy, so the queue pages never open it', async () => {
      mockBuilder.order.mockResolvedValueOnce({
        data: [{ id: 'dp-9', engine: 'turbo', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' }],
        error: null,
      });
      const [pool] = await getDraftPoolsBySeason('s-1');
      expect(pool?.engine).toBe('legacy');
    });

    it('lists the season pools oldest first as summaries', async () => {
      mockBuilder.order.mockResolvedValueOnce({
        data: [
          { id: 'dp-1', engine: 'legacy', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
          { id: 'dp-2', engine: 'queue', kind: 'redraft', phase: 'submissions', mode: 'slow', status: 'pending' },
        ],
        error: null,
      });
      const pools = await getDraftPoolsBySeason('s-1');
      expect(pools).toEqual([
        { id: 'dp-1', engine: 'legacy', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
        { id: 'dp-2', engine: 'queue', kind: 'redraft', phase: 'submissions', mode: 'slow', status: 'pending' },
      ]);
      expect(mockBuilder.select).toHaveBeenCalledWith('id, engine, kind, phase, mode, status');
      expect(mockBuilder.eq).toHaveBeenCalledWith('season_id', 's-1');
      expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('returns [] for a season without pools and throws on error', async () => {
      mockBuilder.order.mockResolvedValueOnce({ data: [], error: null });
      expect(await getDraftPoolsBySeason('s-9')).toEqual([]);
      mockBuilder.order.mockResolvedValueOnce({ data: null, error: new Error('err') });
      await expect(getDraftPoolsBySeason('s-1')).rejects.toThrow('err');
    });
  });

  describe('getDraftPoolWithDetails', () => {
    it('returns pool with season name, participant count, and pick count', async () => {
      // Main query: from.select.eq.maybeSingle -> .eq returns builder, maybeSingle terminal
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: {
          ...draftPoolRow,
          seasons: { name: 'Season 1' },
          draft_picks: [{ id: 'pk-1' }, { id: 'pk-2' }],
        },
        error: null,
      });
      // Participant count: from.select({ count: 'exact', head: true }).eq('season_id', ...)
      // .select returns builder, .eq terminal with count
      mockBuilder.eq.mockReturnValueOnce(mockBuilder); // eq('id', id) for main query
      mockBuilder.eq.mockReturnValueOnce({ count: 8, error: null }); // eq('season_id') for count

      const result = await getDraftPoolWithDetails('dp-1');
      expect(result).not.toBeNull();
      expect(result!.season_name).toBe('Season 1');
      expect(result!.participant_count).toBe(8);
      expect(result!.pick_count).toBe(2);
    });

    it('returns null when pool not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      const result = await getDraftPoolWithDetails('missing');
      expect(result).toBeNull();
    });

    it('defaults season name to empty string when null', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { ...draftPoolRow, seasons: null, draft_picks: [] },
        error: null,
      });
      mockBuilder.eq.mockReturnValueOnce(mockBuilder);
      mockBuilder.eq.mockReturnValueOnce({ count: 0, error: null });

      const result = await getDraftPoolWithDetails('dp-1');
      expect(result!.season_name).toBe('');
    });

    it('throws on main query error', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('q err') });
      await expect(getDraftPoolWithDetails('dp-1')).rejects.toThrow('q err');
    });

    it('throws on participant count error', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { ...draftPoolRow, seasons: { name: 'S1' }, draft_picks: [] },
        error: null,
      });
      mockBuilder.eq.mockReturnValueOnce(mockBuilder);
      mockBuilder.eq.mockReturnValueOnce({ count: null, error: new Error('cnt err') });
      await expect(getDraftPoolWithDetails('dp-1')).rejects.toThrow('cnt err');
    });
  });

  describe('listDraftPools', () => {
    it('returns pools with details and batch participant counts', async () => {
      // Main query: from.select.order -> terminal .order
      mockBuilder.order.mockReturnValueOnce({
        data: [
          {
            ...draftPoolRow,
            seasons: { name: 'Season 1' },
            draft_picks: [{ id: 'pk-1' }],
          },
        ],
        error: null,
      });

      // Participant counts: from.select.in -> terminal .in
      mockBuilder.in.mockReturnValueOnce({
        data: [
          { season_id: 's-1' },
          { season_id: 's-1' },
          { season_id: 's-1' },
        ],
        error: null,
      });

      const result = await listDraftPools();
      expect(result).toHaveLength(1);
      expect(result[0].season_name).toBe('Season 1');
      expect(result[0].participant_count).toBe(3);
      expect(result[0].pick_count).toBe(1);
    });

    it('returns empty array when none', async () => {
      mockBuilder.order.mockReturnValueOnce({ data: [], error: null });
      const result = await listDraftPools();
      expect(result).toEqual([]);
    });

    it('handles null season join gracefully', async () => {
      mockBuilder.order.mockReturnValueOnce({
        data: [{ ...draftPoolRow, seasons: null, draft_picks: null }],
        error: null,
      });
      mockBuilder.in.mockReturnValueOnce({ data: [], error: null });

      const result = await listDraftPools();
      expect(result[0].season_name).toBe('');
      expect(result[0].pick_count).toBe(0);
    });

    it('throws on main query error', async () => {
      mockBuilder.order.mockReturnValueOnce({ data: null, error: new Error('list err') });
      await expect(listDraftPools()).rejects.toThrow('list err');
    });

    it('throws on participant count error', async () => {
      mockBuilder.order.mockReturnValueOnce({
        data: [{ ...draftPoolRow, seasons: { name: 'S1' }, draft_picks: [] }],
        error: null,
      });
      mockBuilder.in.mockReturnValueOnce({ data: null, error: new Error('cnt err') });
      await expect(listDraftPools()).rejects.toThrow('cnt err');
    });
  });

  describe('createDraftPool', () => {
    it('creates and returns a draft pool', async () => {
      mockBuilder.single.mockResolvedValue({ data: draftPoolRow, error: null });
      const result = await createDraftPool({
        season_id: 's-1',
        draft_type: 'snake',
        point_budget: 100,
        pool_mode: 'tier',
      });
      expect(result.season_id).toBe('s-1');
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ season_id: 's-1', draft_type: 'snake' }),
      );
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('dup') });
      await expect(
        createDraftPool({ season_id: 's-1', draft_type: 'snake' }),
      ).rejects.toThrow('dup');
    });
  });

  describe('updateDraftPoolStatus', () => {
    it('updates status and returns pool', async () => {
      const updated = { ...draftPoolRow, status: 'in_progress' };
      mockBuilder.single.mockResolvedValue({ data: updated, error: null });
      const result = await updateDraftPoolStatus('dp-1', 'in_progress');
      expect(result.status).toBe('in_progress');
      expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'in_progress' });
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('fail') });
      await expect(updateDraftPoolStatus('dp-1', 'in_progress')).rejects.toThrow('fail');
    });
  });

  describe('switchDraftPoolToFreeOrder', () => {
    it('updates only a running legacy pool not yet in free order, in one statement', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: { ...draftPoolRow, pick_order: 'free' }, error: null });
      const result = await switchDraftPoolToFreeOrder('dp-1');
      expect(result?.pick_order).toBe('free');
      expect(mockBuilder.update).toHaveBeenCalledWith({ pick_order: 'free' });
      expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'dp-1');
      expect(mockBuilder.eq).toHaveBeenCalledWith('engine', 'legacy');
      expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'in_progress');
      expect(mockBuilder.neq).toHaveBeenCalledWith('pick_order', 'free');
    });

    it('returns null when no row matched', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await switchDraftPoolToFreeOrder('dp-1')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('fail') });
      await expect(switchDraftPoolToFreeOrder('dp-1')).rejects.toThrow('fail');
    });
  });

  describe('deleteDraftPool', () => {
    it('deletes a pending pool', async () => {
      // getDraftPoolById chain: .from.select.eq.maybeSingle
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: draftPoolRow, error: null });
      // delete chain: .from.delete.eq — use mockReturnValueOnce so
      // the first .eq (in getDraftPoolById) returns mockBuilder for chaining,
      // and the second .eq (in the delete) returns { error: null }.
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)       // getDraftPoolById .eq('id', id) -> chain
        .mockReturnValueOnce({ error: null });   // delete .eq('id', id) -> terminal

      await expect(deleteDraftPool('dp-1')).resolves.toBeUndefined();
    });

    it('throws when pool not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      await expect(deleteDraftPool('dp-1')).rejects.toThrow('Draft pool not found');
    });

    it('throws when pool is not pending', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { ...draftPoolRow, status: 'in_progress' },
        error: null,
      });
      await expect(deleteDraftPool('dp-1')).rejects.toThrow('pending status');
    });

    it('deletes a cancelled queue pool even though draft_cancel set its status to complete', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { ...draftPoolRow, engine: 'queue', phase: 'cancelled', status: 'complete' },
        error: null,
      });
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: null });
      await expect(deleteDraftPool('dp-1')).resolves.toBeUndefined();
    });

    it('refuses a queue pool that is drafting', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { ...draftPoolRow, engine: 'queue', phase: 'drafting', status: 'in_progress' },
        error: null,
      });
      await expect(deleteDraftPool('dp-1')).rejects.toThrow('setup or cancelled');
    });

    it('throws on delete error', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: draftPoolRow, error: null });
      // First .eq (in getDraftPoolById) returns mockBuilder, second (in delete) returns error
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: new Error('fk') });
      await expect(deleteDraftPool('dp-1')).rejects.toThrow('fk');
    });
  });
});

// ====================================================================
// DRAFT PICKS
// ====================================================================
describe('queries/drafts — picks', () => {
  describe('getPicksByPool', () => {
    it('returns picks with player names', async () => {
      // Chain: .from.select.eq.order — terminal .order
      const pickWithPlayer = { ...draftPickRow, players: { name: 'Ash' } };
      mockBuilder.order.mockReturnValue({ data: [pickWithPlayer], error: null });
      const result = await getPicksByPool('dp-1');
      expect(result).toHaveLength(1);
      expect(result[0].player_name).toBe('Ash');
    });

    it('returns empty array when none', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      expect(await getPicksByPool('dp-1')).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getPicksByPool('dp-1')).rejects.toThrow('err');
    });
  });

  describe('getPicksByPlayer', () => {
    it('returns picks for the player in the pool', async () => {
      // Chain: .from.select.eq.eq.order — terminal .order
      mockBuilder.order.mockReturnValue({ data: [draftPickRow], error: null });
      const result = await getPicksByPlayer('dp-1', 'p-1');
      expect(result).toHaveLength(1);
      expect(result[0].pokemon_name).toBe('Pikachu');
    });

    it('returns empty when player has no picks', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      expect(await getPicksByPlayer('dp-1', 'p-99')).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getPicksByPlayer('dp-1', 'p-1')).rejects.toThrow('err');
    });
  });

  describe('createDraftPick', () => {
    it('creates and returns a pick', async () => {
      mockBuilder.single.mockResolvedValue({ data: draftPickRow, error: null });
      const result = await createDraftPick({
        draft_pool_id: 'dp-1',
        player_id: 'p-1',
        pokemon_name: 'Pikachu',
        pick_number: 1,
        round: 1,
        points_spent: 10,
      });
      expect(result.pokemon_name).toBe('Pikachu');
      expect(mockBuilder.from).toHaveBeenCalledWith('draft_picks');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('ins fail') });
      await expect(
        createDraftPick({
          draft_pool_id: 'dp-1', player_id: 'p-1',
          pokemon_name: 'Eevee', pick_number: 1, round: 1,
        }),
      ).rejects.toThrow('ins fail');
    });
  });

  describe('undoLastPick', () => {
    it('removes the last pick and returns info', async () => {
      // Select chain: .from.select.eq.order.limit.maybeSingle
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { id: 'pk-1', player_id: 'p-1', pokemon_name: 'Pikachu', line_id: null },
        error: null,
      });
      // Delete chain: .from.delete.eq — the .eq call for the delete
      // is the SECOND .eq call overall. First .eq (select chain) should
      // return mockBuilder for chaining. Second .eq (delete chain) returns terminal.
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)       // select chain .eq -> chain continues
        .mockReturnValueOnce({ error: null });   // delete chain .eq -> terminal

      const result = await undoLastPick('dp-1');
      expect(result).toEqual({ player_id: 'p-1', pokemon_name: 'Pikachu', line_id: null });
      expect(mockBuilder.select).toHaveBeenCalledWith('id, player_id, pokemon_name, line_id');
    });

    it('returns the undone pick line_id for queue-engine rows', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { id: 'pk-2', player_id: 'p-1', pokemon_name: 'Oshawott', line_id: 'oshawott--samurotthisui' },
        error: null,
      });
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: null });

      const result = await undoLastPick('dp-1');
      expect(result).toEqual({ player_id: 'p-1', pokemon_name: 'Oshawott', line_id: 'oshawott--samurotthisui' });
    });

    it('throws when no picks exist', async () => {
      // Select chain: .from.select.eq.order.limit.maybeSingle
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      await expect(undoLastPick('dp-1')).rejects.toThrow('No picks to undo');
    });

    it('throws on select error', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('sel err') });
      await expect(undoLastPick('dp-1')).rejects.toThrow('sel err');
    });

    it('throws on delete error', async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { id: 'pk-1', player_id: 'p-1', pokemon_name: 'Pikachu' },
        error: null,
      });
      // First .eq (select chain) returns mockBuilder, second .eq (delete) returns error
      mockBuilder.eq
        .mockReturnValueOnce(mockBuilder)
        .mockReturnValueOnce({ error: new Error('del err') });
      await expect(undoLastPick('dp-1')).rejects.toThrow('del err');
    });
  });

  describe('getPickCount', () => {
    it('returns the count', async () => {
      // Chain: .from.select.eq — terminal .eq (with count in select opts)
      mockBuilder.eq.mockReturnValue({ count: 5, error: null });
      const result = await getPickCount('dp-1');
      expect(result).toBe(5);
    });

    it('returns 0 when count is null', async () => {
      mockBuilder.eq.mockReturnValue({ count: null, error: null });
      expect(await getPickCount('dp-1')).toBe(0);
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ count: null, error: new Error('cnt err') });
      await expect(getPickCount('dp-1')).rejects.toThrow('cnt err');
    });
  });
});

// ====================================================================
// DRAFT POOL ENTRIES
// ====================================================================
describe('queries/draft-pool-entries', () => {
  describe('getPoolEntries', () => {
    it('returns entries ordered by tier, then name, then id, in one counted page', async () => {
      mockBuilder.range.mockResolvedValueOnce({ data: [poolEntryRow], error: null, count: 1 });
      const result = await getPoolEntries('s-1');
      expect(result).toHaveLength(1);
      expect(result[0].pokemon_name).toBe('Pikachu');
      expect(mockBuilder.select).toHaveBeenCalledWith('*', { count: 'exact' });
      expect(mockBuilder.order.mock.calls.map((c) => c[0])).toEqual(['power_tier', 'pokemon_name', 'id']);
      expect(mockBuilder.range).toHaveBeenCalledTimes(1);
      expect(mockBuilder.range).toHaveBeenCalledWith(0, 999);
    });

    it('pages past max_rows until the counted total arrived', async () => {
      const page = (n: number, offset: number) =>
        Array.from({ length: n }, (_, k) => ({ ...poolEntryRow, id: `pe-${offset + k}` }));
      mockBuilder.range
        .mockResolvedValueOnce({ data: page(1000, 0), error: null, count: 1500 })
        .mockResolvedValueOnce({ data: page(500, 1000), error: null, count: null });
      const result = await getPoolEntries('s-1');
      expect(result).toHaveLength(1500);
      expect(mockBuilder.range).toHaveBeenNthCalledWith(2, 1000, 1999);
      // Only the first page asks for the count.
      expect(mockBuilder.select).toHaveBeenNthCalledWith(2, '*', undefined);
    });

    it('stops when entries vanish while paging', async () => {
      mockBuilder.range
        .mockResolvedValueOnce({ data: [poolEntryRow], error: null, count: 3 })
        .mockResolvedValueOnce({ data: [], error: null, count: null });
      expect(await getPoolEntries('s-1')).toHaveLength(1);
    });

    it('returns empty array when none', async () => {
      mockBuilder.range.mockResolvedValueOnce({ data: [], error: null, count: 0 });
      expect(await getPoolEntries('s-1')).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.range.mockResolvedValueOnce({ data: null, error: new Error('err'), count: null });
      await expect(getPoolEntries('s-1')).rejects.toThrow('err');
    });
  });

  describe('getPoolEntry', () => {
    it('returns entry when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: poolEntryRow, error: null });
      const result = await getPoolEntry('s-1', 'Pikachu');
      expect(result).not.toBeNull();
      expect(result!.power_tier).toBe('A');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getPoolEntry('s-1', 'MissingNo')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getPoolEntry('s-1', 'Pikachu')).rejects.toThrow('err');
    });
  });

  describe('createPoolEntry', () => {
    it('creates and returns an entry', async () => {
      mockBuilder.single.mockResolvedValue({ data: poolEntryRow, error: null });
      const result = await createPoolEntry({
        season_id: 's-1',
        pokemon_name: 'Pikachu',
        power_tier: 'A',
        point_cost: 10,
      });
      expect(result.season_id).toBe('s-1');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('ins fail') });
      await expect(
        createPoolEntry({ season_id: 's-1', pokemon_name: 'Pikachu' }),
      ).rejects.toThrow('ins fail');
    });
  });

  describe('bulkCreatePoolEntries', () => {
    it('returns empty array for empty input', async () => {
      const result = await bulkCreatePoolEntries([]);
      expect(result).toEqual([]);
      expect(mockBuilder.from).not.toHaveBeenCalled();
    });

    it('creates and returns entries', async () => {
      // Chain: .from.insert.select — terminal .select
      mockBuilder.select.mockReturnValue({ data: [poolEntryRow], error: null });
      const result = await bulkCreatePoolEntries([
        { season_id: 's-1', pokemon_name: 'Pikachu' },
      ]);
      expect(result).toHaveLength(1);
    });

    it('throws on error', async () => {
      mockBuilder.select.mockReturnValue({ data: null, error: new Error('bulk fail') });
      await expect(
        bulkCreatePoolEntries([{ season_id: 's-1', pokemon_name: 'Pikachu' }]),
      ).rejects.toThrow('bulk fail');
    });
  });

  describe('updatePoolEntry', () => {
    it('updates and returns entry', async () => {
      const updated = { ...poolEntryRow, power_tier: 'S' };
      mockBuilder.single.mockResolvedValue({ data: updated, error: null });
      const result = await updatePoolEntry('pe-1', { power_tier: 'S' });
      expect(result.power_tier).toBe('S');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('upd') });
      await expect(updatePoolEntry('pe-1', { power_tier: 'B' })).rejects.toThrow('upd');
    });
  });

  describe('deletePoolEntry', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deletePoolEntry('pe-1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('del') });
      await expect(deletePoolEntry('pe-1')).rejects.toThrow('del');
    });
  });

  describe('deleteAllPoolEntries', () => {
    it('deletes all for the season', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteAllPoolEntries('s-1')).resolves.toBeUndefined();
      expect(mockBuilder.from).toHaveBeenCalledWith('draft_pool_entries');
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('del') });
      await expect(deleteAllPoolEntries('s-1')).rejects.toThrow('del');
    });
  });
});

// ====================================================================
// DRAFT POOL TEMPLATES
// ====================================================================
describe('queries/draft-pool-templates', () => {
  describe('listTemplates', () => {
    it('returns templates ordered by created_at desc', async () => {
      // Chain: .from.select.order — terminal .order
      mockBuilder.order.mockReturnValue({ data: [templateRow], error: null });
      const result = await listTemplates();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Standard');
      expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('returns empty array when none', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      expect(await listTemplates()).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('err') });
      await expect(listTemplates()).rejects.toThrow('err');
    });
  });

  describe('getTemplate', () => {
    it('returns template when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: templateRow, error: null });
      const result = await getTemplate('tpl-1');
      expect(result).not.toBeNull();
      expect(result!.pool_mode).toBe('tier');
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getTemplate('missing')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getTemplate('tpl-1')).rejects.toThrow('err');
    });
  });

  describe('createTemplate', () => {
    it('creates and returns a template', async () => {
      mockBuilder.single.mockResolvedValue({ data: templateRow, error: null });
      const result = await createTemplate({
        name: 'Standard',
        pool_mode: 'tier',
        entries: [{ pokemon_name: 'Pikachu', power_tier: 'A' }],
      }, 'p-1');
      expect(result.name).toBe('Standard');
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Standard', created_by: 'p-1' }),
      );
    });

    it('sets created_by to null when not provided', async () => {
      mockBuilder.single.mockResolvedValue({ data: templateRow, error: null });
      await createTemplate({
        name: 'Standard',
        pool_mode: 'tier',
        entries: [],
      });
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: null }),
      );
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('ins fail') });
      await expect(
        createTemplate({ name: 'X', pool_mode: 'tier', entries: [] }),
      ).rejects.toThrow('ins fail');
    });
  });

  describe('deleteTemplate', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteTemplate('tpl-1')).resolves.toBeUndefined();
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('del') });
      await expect(deleteTemplate('tpl-1')).rejects.toThrow('del');
    });
  });
});

// ====================================================================
// DRAFT TIER LIMITS
// ====================================================================
describe('queries/draft-tier-limits', () => {
  describe('getTierLimits', () => {
    it('returns limits ordered by power_tier', async () => {
      // Chain: .from.select.eq.order — terminal .order
      mockBuilder.order.mockReturnValue({ data: [tierLimitRow], error: null });
      const result = await getTierLimits('s-1');
      expect(result).toHaveLength(1);
      expect(result[0].power_tier).toBe('S');
    });

    it('returns empty array when none', async () => {
      mockBuilder.order.mockReturnValue({ data: [], error: null });
      expect(await getTierLimits('s-1')).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getTierLimits('s-1')).rejects.toThrow('err');
    });
  });

  describe('getTierLimit', () => {
    it('returns limit when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: tierLimitRow, error: null });
      const result = await getTierLimit('s-1', 'S');
      expect(result).not.toBeNull();
      expect(result!.max_picks).toBe(1);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getTierLimit('s-1', 'Z')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getTierLimit('s-1', 'S')).rejects.toThrow('err');
    });
  });

  describe('upsertTierLimits', () => {
    it('deletes then inserts new limits', async () => {
      // Step 1: delete existing — .eq returns { error }
      mockBuilder.eq.mockReturnValueOnce({ error: null });
      // Step 2: insert new — .select is terminal
      mockBuilder.select.mockReturnValue({ data: [tierLimitRow], error: null });

      const result = await upsertTierLimits('s-1', [
        { power_tier: 'S', max_picks: 1, season_id: 's1' },
      ]);
      expect(result).toHaveLength(1);
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.insert).toHaveBeenCalled();
    });

    it('returns empty array when all limits are 0 (unlimited)', async () => {
      mockBuilder.eq.mockReturnValueOnce({ error: null });
      const result = await upsertTierLimits('s-1', [
        { power_tier: 'S', max_picks: 0, season_id: 's1' },
      ]);
      expect(result).toEqual([]);
    });

    it('throws on delete error', async () => {
      mockBuilder.eq.mockReturnValueOnce({ error: new Error('del err') });
      await expect(
        upsertTierLimits('s-1', [{ power_tier: 'S', max_picks: 1, season_id: 's1' }]),
      ).rejects.toThrow('del err');
    });

    it('throws on insert error', async () => {
      mockBuilder.eq.mockReturnValueOnce({ error: null });
      mockBuilder.select.mockReturnValue({ data: null, error: new Error('ins err') });
      await expect(
        upsertTierLimits('s-1', [{ power_tier: 'S', max_picks: 1, season_id: 's1' }]),
      ).rejects.toThrow('ins err');
    });
  });
});

// ====================================================================
// DRAFT REPLAY EVENTS
// ====================================================================
describe('queries/draft-replay-events', () => {
  describe('getReplayEventsByPool', () => {
    it('returns events ordered by sequence_number', async () => {
      // Chain: .from.select.eq.order — terminal .order
      mockBuilder.order.mockReturnValue({ data: [replayEventRow], error: null });
      const result = await getReplayEventsByPool('dp-1');
      expect(result).toHaveLength(1);
      expect(result[0].event_type).toBe('pick');
      expect(mockBuilder.order).toHaveBeenCalledWith('sequence_number', { ascending: true });
    });

    it('returns empty array for null data', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: null });
      const result = await getReplayEventsByPool('dp-1');
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      mockBuilder.order.mockReturnValue({ data: null, error: new Error('err') });
      await expect(getReplayEventsByPool('dp-1')).rejects.toThrow('err');
    });
  });

  describe('getReplayEventById', () => {
    it('returns event when found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: replayEventRow, error: null });
      const result = await getReplayEventById('re-1');
      expect(result).not.toBeNull();
      expect(result!.sequence_number).toBe(1);
    });

    it('returns null when not found', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await getReplayEventById('missing')).toBeNull();
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getReplayEventById('re-1')).rejects.toThrow('err');
    });
  });

  describe('getNextSequenceNumber', () => {
    it('returns next number when events exist', async () => {
      // Chain: .from.select.eq.order.limit.maybeSingle — terminal .maybeSingle
      mockBuilder.maybeSingle.mockResolvedValue({
        data: { sequence_number: 5 },
        error: null,
      });
      const result = await getNextSequenceNumber('dp-1');
      expect(result).toBe(6);
    });

    it('returns 1 when no events exist', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
      const result = await getNextSequenceNumber('dp-1');
      expect(result).toBe(1);
    });

    it('throws on error', async () => {
      mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('err') });
      await expect(getNextSequenceNumber('dp-1')).rejects.toThrow('err');
    });
  });

  describe('createReplayEvent', () => {
    it('creates and returns an event', async () => {
      mockBuilder.single.mockResolvedValue({ data: replayEventRow, error: null });
      const result = await createReplayEvent({
        draft_pool_id: 'dp-1',
        event_type: 'pick',
        event_data: { pokemon_name: 'Pikachu' } as never,
        sequence_number: 1,
      });
      expect(result.draft_pool_id).toBe('dp-1');
      expect(mockBuilder.from).toHaveBeenCalledWith('draft_replay_events');
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('ins') });
      await expect(
        createReplayEvent({
          draft_pool_id: 'dp-1',
          event_type: 'pick',
          event_data: {} as never,
          sequence_number: 1,
        }),
      ).rejects.toThrow('ins');
    });
  });

  describe('updateReplayEvent', () => {
    it('updates and returns the event', async () => {
      const updated = { ...replayEventRow, display_duration_ms: 3000 };
      mockBuilder.single.mockResolvedValue({ data: updated, error: null });
      const result = await updateReplayEvent('re-1', { display_duration_ms: 3000 });
      expect(result.display_duration_ms).toBe(3000);
    });

    it('throws on error', async () => {
      mockBuilder.single.mockResolvedValue({ data: null, error: new Error('upd') });
      await expect(updateReplayEvent('re-1', {})).rejects.toThrow('upd');
    });
  });

  describe('deleteReplayEvent', () => {
    it('deletes without error', async () => {
      mockBuilder.eq.mockReturnValue({ error: null });
      await expect(deleteReplayEvent('re-1')).resolves.toBeUndefined();
      expect(mockBuilder.from).toHaveBeenCalledWith('draft_replay_events');
    });

    it('throws on error', async () => {
      mockBuilder.eq.mockReturnValue({ error: new Error('del') });
      await expect(deleteReplayEvent('re-1')).rejects.toThrow('del');
    });
  });
});

/**
 * The season points ledger in a league with groups (20261018180000): one initial pool per group, so each trainer's
 * base budget is their group's initial pool (twin of `epb__season_remaining_points`). A league without groups keeps
 * its old reads (progress-engine.test.ts 'draft token ledger').
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  applyTrackerProgressWithLog: vi.fn(),
  getTrackerByLine: vi.fn(),
  getLegacyTrackerByBase: vi.fn(),
  getPlayerTrackers: vi.fn(),
  getSeasonTrackers: vi.fn(),
  updateTracker: vi.fn(),
}));
vi.mock('@/lib/draft/epb-thresholds', () => ({ getSeasonLineThresholds: vi.fn() }));
vi.mock('@/lib/supabase/queries/epb-token-grants', () => ({ getTokenGrants: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/drafts')>();
  return {
    GroupedLeaguePoolLookupError: actual.GroupedLeaguePoolLookupError,
    getDraftPoolBySeason: vi.fn(),
    getDraftPoolsBySeason: vi.fn(),
    getDraftPoolsBySeasonWithGroups: vi.fn(),
    getPicksByPool: vi.fn(),
  };
});
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupMembership: vi.fn() }));
vi.mock('@/lib/supabase/queries/redraft', () => ({ getRedraftHistory: vi.fn(), getRedraftSlotRefunds: vi.fn() }));
vi.mock('@/lib/supabase/queries/epb-draft-token-purchases', () => ({
  getDraftTokenPurchases: vi.fn(),
  purchaseDraftTokenRpc: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/epb-comeback-tokens', () => ({
  getComebackTokenSpends: vi.fn(),
  spendComebackTokensRpc: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/progress-log', () => ({ getCosmoMatchdays: vi.fn() }));
vi.mock('@/lib/match/evolution-match-evaluator', () => ({ recheckEpbStages: vi.fn() }));
vi.mock('@/lib/supabase/queries/epb-kill-tokens', () => ({ fetchComebackTokenData: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: vi.fn() }));
vi.mock('@/lib/season/epb-phase', () => ({ getHinrundeScope: vi.fn() }));

import { computeRemainingPointsFromLedger, loadDraftTokenLedger } from '../progress-engine';
import {
  getDraftPoolBySeason,
  getDraftPoolsBySeasonWithGroups,
  getPicksByPool,
  GroupedLeaguePoolLookupError,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroupMembership } from '@/lib/supabase/queries/season-groups';
import { getTokenGrants } from '@/lib/supabase/queries/epb-token-grants';
import { getRedraftHistory, getRedraftSlotRefunds } from '@/lib/supabase/queries/redraft';
import { getDraftTokenPurchases } from '@/lib/supabase/queries/epb-draft-token-purchases';

const mockGetPool = vi.mocked(getDraftPoolBySeason);
const mockGetPools = vi.mocked(getDraftPoolsBySeasonWithGroups);
const mockGetPicks = vi.mocked(getPicksByPool);
const mockMembership = vi.mocked(getSeasonGroupMembership);

type PoolRow = Awaited<ReturnType<typeof getDraftPoolsBySeasonWithGroups>>[number];
const pool = (id: string, group: string, kind: 'initial' | 'redraft', budget: number | null, phase = 'complete'): PoolRow => ({
  id,
  engine: 'queue',
  kind,
  phase: phase as PoolRow['phase'],
  mode: 'live',
  status: 'complete',
  season_group_id: group,
  season_group_name: group.toUpperCase(),
  season_group_sort_order: group === 'a' ? 1 : 2,
  parent_pool_id: null,
  point_budget: budget,
  created_at: '2026-10-18T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPool.mockRejectedValue(new GroupedLeaguePoolLookupError('s1'));
  mockGetPools.mockResolvedValue([
    pool('init-a', 'a', 'initial', 180),
    pool('init-b', 'b', 'initial', 150),
    pool('redraft-a', 'a', 'redraft', null),
    pool('redraft-b', 'b', 'redraft', null, 'cancelled'),
  ]);
  mockMembership.mockResolvedValue({ p1: 'a', p2: 'a', p4: 'b', p5: 'b' });
  const picks: Record<string, { player_id: string; points_spent: number; voided_at: string | null }[]> = {
    'init-a': [{ player_id: 'p1', points_spent: 30, voided_at: null }, { player_id: 'p2', points_spent: 20, voided_at: null }],
    'init-b': [
      { player_id: 'p4', points_spent: 30, voided_at: null },
      { player_id: 'p5', points_spent: 25, voided_at: '2026-10-18T01:00:00Z' },
    ],
    'redraft-a': [{ player_id: 'p1', points_spent: 12, voided_at: null }],
  };
  mockGetPicks.mockImplementation(async (poolId: string) => (picks[poolId] ?? []) as never);
  vi.mocked(getTokenGrants).mockResolvedValue([]);
  vi.mocked(getRedraftHistory).mockResolvedValue([]);
  vi.mocked(getDraftTokenPurchases).mockResolvedValue([{ player_id: 'p4', points_spent: 3 }] as never);
  vi.mocked(getRedraftSlotRefunds).mockResolvedValue([
    { player_id: 'p1', dropped_price: 10, draft_pool_id: 'redraft-a' },
  ] as never);
});

describe('loadDraftTokenLedger in a league with groups', () => {
  it("switches to the grouped reads when getDraftPoolBySeason refuses, and bases each trainer on their group's pool", async () => {
    const ledger = await loadDraftTokenLedger('s1');
    expect(mockGetPools).toHaveBeenCalledWith('s1');
    expect(mockMembership).toHaveBeenCalledWith('s1');
    // every initial pool, plus the redraft pool that has drops; never the drop-less cancelled redraft
    expect(mockGetPicks.mock.calls.map((c) => c[0]).sort()).toEqual(['init-a', 'init-b', 'redraft-a']);
    expect(ledger.initialPoolBudgetByPlayer).toEqual({ p1: 180, p2: 180, p4: 150, p5: 150 });

    // group A: 180 - 30 - 12 + 10 refund
    expect(computeRemainingPointsFromLedger(ledger, 'p1', 100, 3)).toBe(148);
    expect(computeRemainingPointsFromLedger(ledger, 'p2', 100, 3)).toBe(160);
    // group B: 150 - 30 - 3 token purchase; a voided pick costs nothing
    expect(computeRemainingPointsFromLedger(ledger, 'p4', 100, 3)).toBe(117);
    expect(computeRemainingPointsFromLedger(ledger, 'p5', 100, 3)).toBe(150);
    // a trainer in no group falls back to format_rules.draft_budget
    expect(computeRemainingPointsFromLedger(ledger, 'nobody', 100, 3)).toBe(100);
  });

  it('a known group pool goes straight to the grouped reads', async () => {
    const ledger = await loadDraftTokenLedger('s1', {
      pool: { id: 'init-b', season_id: 's1', kind: 'initial', season_group_id: 'b' },
      picks: [],
    });
    expect(mockGetPool).not.toHaveBeenCalled();
    expect(ledger.initialPoolBudgetByPlayer?.p4).toBe(150);
  });

  it('a group without its initial pool yet uses format_rules.draft_budget for its trainers', async () => {
    mockGetPools.mockResolvedValue([pool('init-a', 'a', 'initial', 180)]);
    vi.mocked(getRedraftSlotRefunds).mockResolvedValue([]);
    const ledger = await loadDraftTokenLedger('s1');
    expect(ledger.initialPoolBudgetByPlayer).toEqual({ p1: 180, p2: 180, p4: null, p5: null });
    expect(computeRemainingPointsFromLedger(ledger, 'p4', 100, 3)).toBe(97); // 100 - 3 token purchase
  });

  it('every other error of the ungrouped reads propagates unchanged', async () => {
    const failure = new Error('connection reset');
    mockGetPool.mockRejectedValue(failure);
    await expect(loadDraftTokenLedger('s1')).rejects.toBe(failure);
    expect(mockGetPools).not.toHaveBeenCalled();
  });
});

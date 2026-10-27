import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE (§27 CRYSTAL ANIMATION): the spec §27 replay-step behavior tests for the
// crystal/MatchEvolutionReplay animation — reads stored evolution events, makes
// NO mutation, Skip / reduced-motion / autoplay-once — are DEFERRED. The replay
// step derivation currently lives INLINE in the React component
// src/components/evolution/MatchEvolutionReplay.tsx (not a pure, importable
// helper), and this vitest environment is `node` (no jsdom / React Testing
// Library harness), so exercising it requires first extracting a pure helper
// from the component and adding a jsdom test setup. Recorded here per the 4A
// review so the rationale is not lost.

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  applyTrackerProgressWithLog: vi.fn(),
  getTrackerByLine: vi.fn(),
  getLegacyTrackerByBase: vi.fn(),
  getPlayerTrackers: vi.fn(),
  getSeasonTrackers: vi.fn(),
  updateTracker: vi.fn(),
}));

vi.mock('@/lib/draft/epb-thresholds', () => ({
  getSeasonLineThresholds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/epb-token-grants', () => ({
  getTokenGrants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolsBySeason: vi.fn(),
  getPicksByPool: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/redraft', () => ({
  getRedraftHistory: vi.fn(),
  getRedraftSlotRefunds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/epb-draft-token-purchases', () => ({
  getDraftTokenPurchases: vi.fn(),
  purchaseDraftTokenRpc: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/epb-comeback-tokens', () => ({
  getComebackTokenSpends: vi.fn(),
  spendComebackTokensRpc: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/progress-log', () => ({
  getCosmoMatchdays: vi.fn(),
}));

vi.mock('@/lib/match/evolution-match-evaluator', () => ({
  recheckEpbStages: vi.fn(),
}));

// fetchComebackTokenData is mocked so computeEarnedComebackTokens can be fed
// controlled match/game/stat data. computePokemonScore (from
// @/lib/match/aggregation) stays REAL — it is pure shutout scoring and is the
// behavior that converts KO counts into survivor scorelines under test.
vi.mock('@/lib/supabase/queries/epb-kill-tokens', () => ({
  fetchComebackTokenData: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(),
}));

vi.mock('@/lib/season/epb-phase', () => ({
  getHinrundeScope: vi.fn(),
}));

// The pack's earn window and participation-line rate, switchable per test (defaults: the example pack's).
const packMocks = vi.hoisted(() => ({
  earnWindow: null as 'season' | 'first_half' | null,
  participationRate: null as number | null,
  draftKillRate: null as number | null,
}));
vi.mock('@/lib/format-pack', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/format-pack')>();
  return {
    ...actual,
    comebackEarnWindow: () => packMocks.earnWindow ?? actual.comebackEarnWindow(),
    comebackTokensPerProgress: (isParticipationLine: boolean) =>
      isParticipationLine && packMocks.participationRate !== null
        ? packMocks.participationRate
        : actual.comebackTokensPerProgress(isParticipationLine),
    draftKillTokensPerProgress: (isParticipationLine: boolean) =>
      isParticipationLine && packMocks.draftKillRate !== null
        ? packMocks.draftKillRate
        : actual.draftKillTokensPerProgress(isParticipationLine),
  };
});

// ─── Import after mocks ────────────────────────────────────────────

import {
  applyProgress,
  awardCosmoPoint,
  computeRemainingPoints,
  computeEarnedComebackTokens,
  purchaseDraftKillToken,
  spendComebackTokens,
  checkEarlyStage3Lock,
  hasAllocatedDraftTokens,
  loadDraftTokenLedger,
  computeRemainingPointsFromLedger,
  hasAllocatedDraftTokensFromLedger,
  comebackSpentTotal,
} from '../progress-engine';
import {
  applyTrackerProgressWithLog,
  getLegacyTrackerByBase,
  getTrackerByLine,
  getPlayerTrackers,
  getSeasonTrackers,
  updateTracker,
} from '@/lib/supabase/queries/evolutions';
import { getTokenGrants } from '@/lib/supabase/queries/epb-token-grants';
import {
  getDraftPoolBySeason,
  getDraftPoolsBySeason,
  getPicksByPool,
} from '@/lib/supabase/queries/drafts';
import { getRedraftHistory, getRedraftSlotRefunds } from '@/lib/supabase/queries/redraft';
import {
  getDraftTokenPurchases,
  purchaseDraftTokenRpc,
} from '@/lib/supabase/queries/epb-draft-token-purchases';
import { getComebackTokenSpends, spendComebackTokensRpc } from '@/lib/supabase/queries/epb-comeback-tokens';
import { getCosmoMatchdays } from '@/lib/supabase/queries/progress-log';
import { recheckEpbStages } from '@/lib/match/evolution-match-evaluator';
import { fetchComebackTokenData } from '@/lib/supabase/queries/epb-kill-tokens';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getHinrundeScope } from '@/lib/season/epb-phase';
import type { EvolutionTracker } from '@/types/evolution';
import type { EpbTokenGrant } from '@/lib/supabase/queries/epb-token-grants';
import { comebackTokensFromTable, epbPack } from '@/lib/format-pack';

const mockApplyWithLog = vi.mocked(applyTrackerProgressWithLog);
const mockGetTrackerByLine = vi.mocked(getTrackerByLine);
const mockGetLegacyTrackerByBase = vi.mocked(getLegacyTrackerByBase);
const mockGetPlayerTrackers = vi.mocked(getPlayerTrackers);
const mockGetGrants = vi.mocked(getTokenGrants);
const mockGetPool = vi.mocked(getDraftPoolBySeason);
const mockGetPools = vi.mocked(getDraftPoolsBySeason);
const mockGetPicks = vi.mocked(getPicksByPool);
const mockGetSeasonRedraftHistory = vi.mocked(getRedraftHistory);
const mockGetSlotRefunds = vi.mocked(getRedraftSlotRefunds);
const mockGetPurchases = vi.mocked(getDraftTokenPurchases);
const mockPurchaseRpc = vi.mocked(purchaseDraftTokenRpc);
const mockSpendRpc = vi.mocked(spendComebackTokensRpc);
const mockGetSpends = vi.mocked(getComebackTokenSpends);
const mockGetCosmoMatchdays = vi.mocked(getCosmoMatchdays);
const mockRecheck = vi.mocked(recheckEpbStages);
const mockGetSeasonLineThresholds = vi.mocked(getSeasonLineThresholds);
const mockFetchComebackTokenData = vi.mocked(fetchComebackTokenData);
const mockGetSeasonTrackers = vi.mocked(getSeasonTrackers);
const mockUpdateTracker = vi.mocked(updateTracker);
const mockGetListEntries = vi.mocked(getListEntries);
const mockGetHinrundeScope = vi.mocked(getHinrundeScope);

// ─── Fixtures ──────────────────────────────────────────────────────

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker-1',
    season_id: 's1',
    player_id: 'p1',
    base_pokemon: 'Charmander',
    current_form: 'Charmander',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

function makeGrant(overrides: Partial<EpbTokenGrant> = {}): EpbTokenGrant {
  return {
    season_id: 's1',
    player_id: 'p1',
    grant_type: 'draft_token',
    token_count: 1,
    created_by: null,
    created_at: '2026-01-01',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSeasonRedraftHistory.mockResolvedValue([]);
  mockGetGrants.mockResolvedValue([]);
  mockGetPurchases.mockResolvedValue([]);
  mockGetSlotRefunds.mockResolvedValue([]);
  mockGetPools.mockResolvedValue([]);
  mockGetCosmoMatchdays.mockResolvedValue([]);
  mockRecheck.mockResolvedValue([]);
  mockGetSpends.mockResolvedValue([]);
  mockGetListEntries.mockResolvedValue([]);
  mockGetPlayerTrackers.mockResolvedValue([]);
  packMocks.earnWindow = null;
  packMocks.participationRate = null;
  packMocks.draftKillRate = null;
});

// ─── applyProgress ─────────────────────────────────────────────────

describe('applyProgress', () => {
  it('maps draft_token source to draft_tokens column and logs', async () => {
    mockGetLegacyTrackerByBase.mockResolvedValue(makeTracker());

    await applyProgress('s1', 'p1', 'Charmander', 'draft_token', 1);

    expect(mockGetLegacyTrackerByBase).toHaveBeenCalledWith('s1', 'p1', 'Charmander');
    expect(mockApplyWithLog).toHaveBeenCalledWith(
      'tracker-1', 'draft_token', 1,
      expect.objectContaining({ matchday: null })
    );
  });

  it('resolves a line id through the line-keyed lookup (branched bases)', async () => {
    mockGetTrackerByLine.mockResolvedValue(makeTracker({ id: 't-hisui', line_id: 'oshawott--samurotthisui' }));

    await applyProgress('s1', 'p1', 'oshawott--samurotthisui', 'real_kill', 2);

    expect(mockGetTrackerByLine).toHaveBeenCalledWith('s1', 'p1', 'oshawott--samurotthisui');
    expect(mockGetLegacyTrackerByBase).not.toHaveBeenCalled();
    expect(mockApplyWithLog).toHaveBeenCalledWith('t-hisui', 'real_kill', 2, expect.anything());
  });

  it('accepts transferred-progress corrections (own column since M4)', async () => {
    mockGetTrackerByLine.mockResolvedValue(makeTracker());

    await applyProgress('s1', 'p1', 'dreepy--dragapult', 'transferred', -1);

    expect(mockApplyWithLog).toHaveBeenCalledWith('tracker-1', 'transferred', -1, expect.anything());
  });

  it('no-ops for amount 0', async () => {
    await applyProgress('s1', 'p1', 'Charmander', 'real_kill', 0);
    expect(mockGetTrackerByLine).not.toHaveBeenCalled();
    expect(mockGetLegacyTrackerByBase).not.toHaveBeenCalled();
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });

  it('throws when tracker is missing', async () => {
    mockGetLegacyTrackerByBase.mockResolvedValue(null);
    await expect(
      applyProgress('s1', 'p1', 'Missingno', 'real_kill', 1)
    ).rejects.toThrow('No tracker found');
  });

  it('sends TRACKER_NOT_FOUND with the base species as {pokemon} (line id)', async () => {
    mockGetTrackerByLine.mockResolvedValue(null);
    await expect(
      applyProgress('s1', 'p1', 'teddiursa--ursalunabloodmoon', 'real_kill', 1)
    ).rejects.toMatchObject({
      code: 'TRACKER_NOT_FOUND',
      statusCode: 400,
      params: { pokemon: 'teddiursa' },
    });
  });

  it('rejects column-less sources (admin_correction)', async () => {
    mockGetLegacyTrackerByBase.mockResolvedValue(makeTracker());
    await expect(
      applyProgress('s1', 'p1', 'Charmander', 'admin_correction', 1)
    ).rejects.toThrow('does not map to a tracker column');
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });
});

// ─── awardCosmoPoint (Cosmo Tokens per matchday brought) ───────────

describe('awardCosmoPoint', () => {
  // The example pack's participation line (src/format-packs/example/epb.ts).
  const DRATINI = 'dratini--dragonite';

  beforeEach(() => {
    mockGetSeasonLineThresholds.mockResolvedValue([
      {
        line_id: DRATINI,
        base_pokemon: 'Dratini',
        stage2_pokemon: 'Dragonair',
        stage3_pokemon: 'Dragonite',
        stage2_kos: 5,
        stage3_kos: 10,
      },
      {
        line_id: 'pichu--raichu',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage3_pokemon: 'Raichu',
        stage2_kos: 1,
        stage3_kos: 4,
      },
    ]);
  });

  function cosmogTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
    return makeTracker({
      id: 't-cosmog',
      base_pokemon: 'Dratini',
      current_form: 'Dragonair',
      current_stage: 2,
      line_id: DRATINI,
      locked_stage3_pokemon: 'Dragonite',
      ...overrides,
    });
  }

  /** One player's evidence for one match: battle rows (either player) and the registered team (null = none). */
  function ev(
    battleStats: { player_id: string; pokemon_name: string }[],
    registeredSpecies: string[] | null = null,
    playerId = 'p1',
  ) {
    return { playerId, registeredSpecies, battleStats };
  }

  it('awards the pack per-matchday Cosmo Tokens when the participation line was brought (tracker found by line id)', async () => {
    mockGetPlayerTrackers.mockResolvedValue([
      makeTracker({ id: 't-pichu', base_pokemon: 'Pichu', line_id: 'pichu--raichu' }),
      cosmogTracker(),
    ]);

    const result = await awardCosmoPoint('s1', 3, ev([
      { player_id: 'p1', pokemon_name: 'Dragonair' },
      { player_id: 'p1', pokemon_name: 'Pichu' },
    ]));

    expect(result).toBe(true);
    expect(mockGetCosmoMatchdays).toHaveBeenCalledWith('t-cosmog');
    expect(mockApplyWithLog).toHaveBeenCalledTimes(1);
    expect(mockApplyWithLog).toHaveBeenCalledWith(
      't-cosmog', 'cosmo_point', epbPack.participationPoints.perMatchday,
      expect.objectContaining({ matchday: 3 })
    );
  });

  // "brought" = in the registered team; battle data is not required.
  it('awards from the registered team alone, without any battle stats', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);

    const result = await awardCosmoPoint('s1', 3, ev([], ['Pichu', 'Dragonair']));

    expect(result).toBe(true);
    expect(mockApplyWithLog).toHaveBeenCalledWith(
      't-cosmog', 'cosmo_point', epbPack.participationPoints.perMatchday,
      expect.objectContaining({ matchday: 3 })
    );
  });

  it('a registered team without the line plus an own battle row naming it still awards (union)', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);

    const result = await awardCosmoPoint('s1', 3, ev([{ player_id: 'p1', pokemon_name: 'Dratini' }], ['Pichu']));

    expect(result).toBe(true);
  });

  it('does not award when the registered team lacks the line and there is no battle data', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);

    const result = await awardCosmoPoint('s1', 3, ev([], ['Pichu', 'Pikachu']));

    expect(result).toBe(false);
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });

  it('reads nothing without a registered team and without own battle rows', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);

    expect(await awardCosmoPoint('s1', 3, ev([]))).toBe(false);
    expect(await awardCosmoPoint('s1', 3, ev([], []))).toBe(false);
    // Only the opponent's rows: nothing shows what p1 brought.
    expect(await awardCosmoPoint('s1', 3, ev([{ player_id: 'p2', pokemon_name: 'Dragonair' }]))).toBe(false);
    expect(mockGetPlayerTrackers).not.toHaveBeenCalled();
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });

  it('another player’s battle rows never count for the player', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker({ player_id: 'p2' })]);

    // p2 registered no participation line; Dragonair appears only in p1's rows.
    const result = await awardCosmoPoint('s1', 3, ev([{ player_id: 'p1', pokemon_name: 'Dragonair' }], ['Pichu'], 'p2'));

    expect(mockGetPlayerTrackers).toHaveBeenCalledWith('s1', 'p2');
    expect(result).toBe(false);
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });

  it('does not award when the line was not brought', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);

    const result = await awardCosmoPoint('s1', 3, ev([
      { player_id: 'p1', pokemon_name: 'Pikachu' },
      { player_id: 'p2', pokemon_name: 'Dragonair' }, // the opponent's mon does not count
    ]));

    expect(result).toBe(false);
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });

  it('awards at most one token per matchday', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);
    mockGetCosmoMatchdays.mockResolvedValue([1, 3]);

    const result = await awardCosmoPoint('s1', 3, ev([], ['Dragonair']));

    expect(result).toBe(false);
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });

  it('treats the cosmo unique-index violation as already awarded (concurrent finalization)', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);
    mockGetCosmoMatchdays.mockResolvedValue([]); // both racers read "not yet awarded"
    mockApplyWithLog.mockRejectedValueOnce({
      code: '23505',
      message: 'duplicate key value violates unique constraint "evo_progress_log_cosmo_matchday_uniq"',
    });

    const result = await awardCosmoPoint('s1', 3, ev([{ player_id: 'p1', pokemon_name: 'Dragonair' }]));

    expect(result).toBe(false);
    expect(mockApplyWithLog).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other unique violation or error from the award', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);
    mockGetCosmoMatchdays.mockResolvedValue([]);
    const other = { code: '23505', message: 'duplicate key value violates unique constraint "some_other_key"' };
    mockApplyWithLog.mockRejectedValueOnce(other);

    await expect(
      awardCosmoPoint('s1', 3, ev([{ player_id: 'p1', pokemon_name: 'Dragonair' }]))
    ).rejects.toBe(other);
  });

  it('awards again on a new matchday', async () => {
    mockGetPlayerTrackers.mockResolvedValue([cosmogTracker()]);
    mockGetCosmoMatchdays.mockResolvedValue([1, 3]);

    expect(await awardCosmoPoint('s1', 4, ev([{ player_id: 'p1', pokemon_name: 'Dragonair' }]))).toBe(true);
  });

  it('does not award from the pack untilStage on', async () => {
    mockGetPlayerTrackers.mockResolvedValue([
      cosmogTracker({ current_stage: epbPack.participationPoints.untilStage, current_form: 'Dragonite' }),
    ]);

    const result = await awardCosmoPoint('s1', 5, ev([{ player_id: 'p1', pokemon_name: 'Dragonite' }], ['Dragonite']));

    expect(result).toBe(false);
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });

  it('returns false when player has no participation line', async () => {
    mockGetPlayerTrackers.mockResolvedValue([
      makeTracker({ id: 't-pichu', base_pokemon: 'Pichu', line_id: 'pichu--raichu' }),
    ]);
    expect(await awardCosmoPoint('s1', 1, ev([{ player_id: 'p1', pokemon_name: 'Pichu' }], ['Pichu']))).toBe(false);
    expect(mockApplyWithLog).not.toHaveBeenCalled();
  });
});

// ─── purchaseDraftKillToken ────────────────────────────────────────

describe('purchaseDraftKillToken', () => {
  beforeEach(() => {
    mockGetSeasonLineThresholds.mockResolvedValue([
      { line_id: 'chikorita--meganium', base_pokemon: 'Chikorita', stage2_pokemon: 'Bayleef', stage3_pokemon: 'Meganium', stage2_kos: 2, stage3_kos: 7 },
    ]);
    mockPurchaseRpc.mockResolvedValue({
      purchase_id: 'pur-1',
      tracker_id: 't-chiko',
      line_id: 'chikorita--meganium',
      points_spent: 3,
      tokens_used: 1,
      progress: 1,
      remaining_points: 4,
      replay: false,
    });
  });

  it('passes the next cumulative threshold of the owned line to the RPC', async () => {
    mockGetTrackerByLine.mockResolvedValue(
      makeTracker({ id: 't-chiko', base_pokemon: 'Chikorita', line_id: 'chikorita--meganium', current_stage: 2, total_kos: 3 })
    );

    const result = await purchaseDraftKillToken('s1', null, 'p1', 'chikorita--meganium', 'req-1', 'p1');

    expect(mockGetTrackerByLine).toHaveBeenCalledWith('s1', 'p1', 'chikorita--meganium');
    expect(mockPurchaseRpc).toHaveBeenCalledWith({
      seasonId: 's1',
      playerId: 'p1',
      actorId: 'p1',
      lineId: 'chikorita--meganium',
      nextThreshold: 7,
      clientRequestId: 'req-1',
      tokensPerProgress: 1,
    });
    expect(result.purchase_id).toBe('pur-1');
    // A purchase never evolves a line: no stage recheck.
    expect(mockRecheck).not.toHaveBeenCalled();
  });

  it('passes a null threshold when the player owns no tracker (the RPC refuses TRACKER_NOT_OWNED)', async () => {
    mockGetTrackerByLine.mockResolvedValue(null);

    await purchaseDraftKillToken('s1', null, 'p1', 'chikorita--meganium', 'req-1', 'admin-1');

    expect(mockPurchaseRpc).toHaveBeenCalledWith(expect.objectContaining({ nextThreshold: null, actorId: 'admin-1' }));
  });

  it('propagates the RPC error for the route to map', async () => {
    mockGetTrackerByLine.mockResolvedValue(
      makeTracker({ base_pokemon: 'Chikorita', line_id: 'chikorita--meganium' })
    );
    const rpcError = { code: 'P0001', message: 'TOKEN_WOULD_EVOLVE', details: '{"next":2,"progress":1}' };
    mockPurchaseRpc.mockRejectedValue(rpcError);

    await expect(purchaseDraftKillToken('s1', null, 'p1', 'chikorita--meganium', 'req-1', 'p1')).rejects.toBe(rpcError);
  });

  describe('participation line (pack rate mocked to 2)', () => {
    const DRATINI = 'dratini--dragonite';
    beforeEach(() => {
      packMocks.draftKillRate = 2;
      mockGetSeasonLineThresholds.mockResolvedValue([
        { line_id: 'chikorita--meganium', base_pokemon: 'Chikorita', stage2_pokemon: 'Bayleef', stage3_pokemon: 'Meganium', stage2_kos: 2, stage3_kos: 7 },
        { line_id: DRATINI, base_pokemon: 'Dratini', stage2_pokemon: 'Dragonair', stage3_pokemon: 'Dragonite', stage2_kos: 5, stage3_kos: 12 },
      ]);
      mockGetListEntries.mockResolvedValue([
        listEntry('Chikorita', 'Bayleef', 'Meganium'),
        listEntry('Dratini', 'Dragonair', 'Dragonite', { cosmog: true }),
      ]);
    });

    it('sends rate 2 for the participation line, resolved from the list entry', async () => {
      mockGetTrackerByLine.mockResolvedValue(makeTracker({ id: 't-d', base_pokemon: 'Dratini', line_id: DRATINI, current_stage: 1, total_kos: 1 }));

      await purchaseDraftKillToken('s1', 'list-1', 'p1', DRATINI, 'req-1', 'p1');

      expect(mockGetListEntries).toHaveBeenCalledWith('list-1');
      expect(mockPurchaseRpc).toHaveBeenCalledWith(
        expect.objectContaining({ lineId: DRATINI, nextThreshold: 5, tokensPerProgress: 2 }),
      );
      expect(mockRecheck).not.toHaveBeenCalled();
    });

    it('sends rate 1 for every other line', async () => {
      mockGetTrackerByLine.mockResolvedValue(makeTracker({ id: 't-chiko', base_pokemon: 'Chikorita', line_id: 'chikorita--meganium', total_kos: 0 }));

      await purchaseDraftKillToken('s1', 'list-1', 'p1', 'chikorita--meganium', 'req-1', 'p1');

      expect(mockPurchaseRpc).toHaveBeenCalledWith(expect.objectContaining({ tokensPerProgress: 1 }));
    });

    it('the stored participation flag of the list entry decides, like the overview (a base the pack does not flag)', async () => {
      mockGetListEntries.mockResolvedValue([listEntry('Chikorita', 'Bayleef', 'Meganium', { cosmog: true })]);
      mockGetTrackerByLine.mockResolvedValue(makeTracker({ id: 't-chiko', base_pokemon: 'Chikorita', line_id: 'chikorita--meganium', total_kos: 0 }));

      await purchaseDraftKillToken('s1', 'list-1', 'p1', 'chikorita--meganium', 'req-1', 'p1');

      expect(mockPurchaseRpc).toHaveBeenCalledWith(expect.objectContaining({ tokensPerProgress: 2 }));
    });

    it('without a list entry the tracker base decides (the pack line rule)', async () => {
      mockGetListEntries.mockResolvedValue([]);
      mockGetTrackerByLine.mockResolvedValue(makeTracker({ id: 't-d', base_pokemon: 'Dratini', line_id: DRATINI, total_kos: 1 }));

      await purchaseDraftKillToken('s1', 'list-1', 'p1', DRATINI, 'req-1', 'p1');

      expect(mockPurchaseRpc).toHaveBeenCalledWith(expect.objectContaining({ tokensPerProgress: 2 }));
    });

    it('a season without a point-buy list reads no entries and falls back to the tracker base', async () => {
      mockGetTrackerByLine.mockResolvedValue(makeTracker({ id: 't-d', base_pokemon: 'Dratini', line_id: DRATINI, total_kos: 1 }));

      await purchaseDraftKillToken('s1', null, 'p1', DRATINI, 'req-1', 'p1');

      expect(mockGetListEntries).not.toHaveBeenCalled();
      expect(mockPurchaseRpc).toHaveBeenCalledWith(expect.objectContaining({ tokensPerProgress: 2 }));
    });

    it('no owned tracker: the RPC refuses TRACKER_NOT_OWNED, the rate stays 1', async () => {
      mockGetTrackerByLine.mockResolvedValue(null);

      await purchaseDraftKillToken('s1', 'list-1', 'p1', DRATINI, 'req-1', 'p1');

      expect(mockPurchaseRpc).toHaveBeenCalledWith(expect.objectContaining({ nextThreshold: null, tokensPerProgress: 1 }));
    });
  });
});

// ─── spendComebackTokens ───────────────────────────────────────────

/** Comeback data for one match lost by `loser` with `koed` of 6 Pokémon down (example pack: 0:4+ → 1 token). */
function shutout(loser: string, koed: number, id = 'm1', gameId = 'g1', roundNumber = 2) {
  const winner = loser === 'p1' ? 'p2' : 'p1';
  return {
    matches: [{ id, player_1_id: loser, player_2_id: winner, winner_id: winner, round_number: roundNumber }],
    statsByGame: new Map([
      [gameId, [
        ...Array.from({ length: koed }, (_, i) => ({ player_id: loser, pokemon_name: `L${i}`, was_koed: true })),
        ...Array.from({ length: koed }, (_, i) => ({ player_id: winner, pokemon_name: `W${i}`, was_koed: false })),
      ]],
    ]),
    gamesByMatch: new Map([[id, [gameId]]]),
  };
}

/** `count` shutout losses of p1 (each 0:5 → 1 token in the example pack). */
function shutouts(count: number) {
  const parts = Array.from({ length: count }, (_, i) => shutout('p1', 5, `m${i + 1}`, `g${i + 1}`, i + 1));
  return {
    matches: parts.flatMap((p) => p.matches),
    statsByGame: new Map(parts.flatMap((p) => [...p.statsByGame])),
    gamesByMatch: new Map(parts.flatMap((p) => [...p.gamesByMatch])),
  };
}

/** A season list entry (only the fields the rate lookup reads). */
function listEntry(base: string, stage2: string, stage3: string | null, special: Record<string, boolean> | null = null) {
  return { base_pokemon: base, stage2_pokemon: stage2, stage3_pokemon: stage3, special_rules: special } as never;
}

const LIST = 'list-1';
const GIBLE = 'gible--garchomp';
const DRATINI_LINE = 'dratini--dragonite';

describe('spendComebackTokens', () => {
  beforeEach(() => {
    mockGetListEntries.mockResolvedValue([
      listEntry('Gible', 'Gabite', 'Garchomp'),
      listEntry('Dratini', 'Dragonair', 'Dragonite', { cosmog: true }),
    ]);
  });

  it('computes the earned total, calls the RPC with each line’s rate, then re-resolves the player’s stages', async () => {
    mockFetchComebackTokenData.mockResolvedValue(shutout('p1', 5)); // 0:5 → 1 token earned (example pack)
    mockSpendRpc.mockResolvedValue({ spent: 1, balance_after: 0, tracker_ids: ['t1'], replay: false });

    const result = await spendComebackTokens('s1', LIST, 'p1', [{ line_id: GIBLE, count: 1 }], 'req-9', 'p1');

    expect(mockGetListEntries).toHaveBeenCalledWith(LIST);
    expect(mockSpendRpc).toHaveBeenCalledWith({
      seasonId: 's1',
      playerId: 'p1',
      actorId: 'p1',
      earnedTotal: 1,
      allocations: [{ line_id: GIBLE, count: 1, ratio: 1 }],
      clientRequestId: 'req-9',
    });
    expect(mockRecheck).toHaveBeenCalledWith('s1', ['p1']);
    expect(result).toEqual({ spent: 1, balance_after: 0, tracker_ids: ['t1'], replay: false, earned: 1 });
  });

  it('a player without shutout losses is refused before the RPC (balance 0)', async () => {
    mockFetchComebackTokenData.mockResolvedValue({ matches: [], statsByGame: new Map(), gamesByMatch: new Map() });

    await expect(
      spendComebackTokens('s1', LIST, 'p3', [{ line_id: GIBLE, count: 1 }], 'req-1', 'p3')
    ).rejects.toMatchObject({ code: 'COMEBACK_BALANCE_SHORT', params: { balance: 0 } });
    expect(mockSpendRpc).not.toHaveBeenCalled();
    expect(mockRecheck).not.toHaveBeenCalled();
  });

  it('an RPC refusal still propagates when the TS pre-check passes (the SQL stays authoritative)', async () => {
    mockFetchComebackTokenData.mockResolvedValue(shutout('p1', 5));
    mockSpendRpc.mockRejectedValue({ code: 'P0001', message: 'COMEBACK_BALANCE_SHORT' });

    await expect(
      spendComebackTokens('s1', LIST, 'p1', [{ line_id: GIBLE, count: 1 }], 'req-1', 'p1')
    ).rejects.toMatchObject({ message: 'COMEBACK_BALANCE_SHORT' });
    expect(mockSpendRpc).toHaveBeenCalledWith(expect.objectContaining({ earnedTotal: 1 }));
    expect(mockRecheck).not.toHaveBeenCalled();
  });

  // No legacy Comeback stock: the spend path never reads epb_token_grants (the database refuses kill_token rows).
  it('never reads epb_token_grants (no legacy Comeback stock): 1 earned is the whole balance', async () => {
    mockFetchComebackTokenData.mockResolvedValue(shutout('p1', 5)); // 0:5 → 1 earned (example pack)
    mockGetGrants.mockResolvedValue([makeGrant({ player_id: 'p1', grant_type: 'draft_token', token_count: 1 })]);
    mockSpendRpc.mockResolvedValue({ spent: 1, balance_after: 0, tracker_ids: ['t1'], replay: false });

    await spendComebackTokens('s1', LIST, 'p1', [{ line_id: GIBLE, count: 1 }], 'req-2', 'p1');

    expect(mockGetGrants).not.toHaveBeenCalled();
    expect(mockSpendRpc).toHaveBeenCalledWith(expect.objectContaining({ earnedTotal: 1 }));
  });

  it('counts earlier spends; a replayed request id skips the pre-check', async () => {
    mockFetchComebackTokenData.mockResolvedValue(shutouts(2)); // two 0:5 losses → 2 earned
    mockGetSpends.mockResolvedValue([
      { id: 'sp1', season_id: 's1', player_id: 'p1', line_id: GIBLE, tracker_id: 't1', amount: 1,
        client_request_id: 'req-old', created_by: 'p1', created_at: '2026-10-01' },
    ]);
    mockSpendRpc.mockResolvedValue({ spent: 1, balance_after: 0, tracker_ids: [], replay: true });

    await expect(
      spendComebackTokens('s1', LIST, 'p1', [{ line_id: GIBLE, count: 2 }], 'req-new', 'p1')
    ).rejects.toMatchObject({ code: 'COMEBACK_BALANCE_SHORT', params: { balance: 1 } });

    const replay = await spendComebackTokens('s1', LIST, 'p1', [{ line_id: GIBLE, count: 1 }], 'req-old', 'p1');
    expect(replay.replay).toBe(true);
    expect(mockSpendRpc).toHaveBeenCalledTimes(1);
  });

  describe('participation-line rate (pack rate mocked to 2)', () => {
    beforeEach(() => {
      packMocks.participationRate = 2;
    });

    it('sends ratio 2 for the participation line and 1 elsewhere; the balance stays in tokens', async () => {
      mockFetchComebackTokenData.mockResolvedValue(shutouts(3)); // 3 earned
      mockSpendRpc.mockResolvedValue({ spent: 3, balance_after: 0, tracker_ids: ['t1', 't2'], replay: false });

      await spendComebackTokens(
        's1', LIST, 'p1', [{ line_id: DRATINI_LINE, count: 2 }, { line_id: GIBLE, count: 1 }], 'req-r', 'p1',
      );

      expect(mockSpendRpc).toHaveBeenCalledWith(expect.objectContaining({
        earnedTotal: 3,
        allocations: [
          { line_id: DRATINI_LINE, count: 2, ratio: 2 },
          { line_id: GIBLE, count: 1, ratio: 1 },
        ],
      }));
    });

    it('refuses a count that is not a multiple of the line’s rate before the RPC', async () => {
      mockFetchComebackTokenData.mockResolvedValue(shutouts(5));

      await expect(
        spendComebackTokens('s1', LIST, 'p1', [{ line_id: DRATINI_LINE, count: 3 }], 'req-odd', 'p1')
      ).rejects.toMatchObject({ code: 'COMEBACK_TOKENS_NOT_MULTIPLE', params: { ratio: 2 }, statusCode: 422 });
      expect(mockSpendRpc).not.toHaveBeenCalled();
      expect(mockRecheck).not.toHaveBeenCalled();
    });

    it('the rate check comes before the balance check', async () => {
      mockFetchComebackTokenData.mockResolvedValue({ matches: [], statsByGame: new Map(), gamesByMatch: new Map() });

      await expect(
        spendComebackTokens('s1', LIST, 'p1', [{ line_id: DRATINI_LINE, count: 1 }], 'req-odd', 'p1')
      ).rejects.toMatchObject({ code: 'COMEBACK_TOKENS_NOT_MULTIPLE' });
    });

    it('a line missing from the list and from the player’s trackers keeps rate 1 (the RPC refuses an unowned line)', async () => {
      mockFetchComebackTokenData.mockResolvedValue(shutouts(1));
      mockSpendRpc.mockResolvedValue({ spent: 1, balance_after: 0, tracker_ids: [], replay: false });

      await spendComebackTokens('s1', LIST, 'p1', [{ line_id: 'abra--alakazam', count: 1 }], 'req-u', 'p1');

      expect(mockGetPlayerTrackers).toHaveBeenCalledWith('s1', 'p1');
      expect(mockSpendRpc).toHaveBeenCalledWith(
        expect.objectContaining({ allocations: [{ line_id: 'abra--alakazam', count: 1, ratio: 1 }] }),
      );
    });

    it('every line in the list: the trackers are not read', async () => {
      mockFetchComebackTokenData.mockResolvedValue(shutouts(2));
      mockSpendRpc.mockResolvedValue({ spent: 2, balance_after: 0, tracker_ids: ['t1'], replay: false });

      await spendComebackTokens('s1', LIST, 'p1', [{ line_id: DRATINI_LINE, count: 2 }], 'req-l', 'p1');

      expect(mockGetPlayerTrackers).not.toHaveBeenCalled();
    });

    it('a season without a list prices a line by the base of the player’s tracker (same resolution as the overview)', async () => {
      mockFetchComebackTokenData.mockResolvedValue(shutouts(3));
      mockSpendRpc.mockResolvedValue({ spent: 3, balance_after: 0, tracker_ids: ['t1', 't2'], replay: false });
      mockGetPlayerTrackers.mockResolvedValue([
        makeTracker({ id: 't1', line_id: DRATINI_LINE, base_pokemon: 'Dratini' }),
        makeTracker({ id: 't2', line_id: GIBLE, base_pokemon: 'Gible' }),
        makeTracker({ id: 't3', line_id: null, base_pokemon: 'Dratini' }),
      ]);

      await spendComebackTokens(
        's1', null, 'p1', [{ line_id: DRATINI_LINE, count: 2 }, { line_id: GIBLE, count: 1 }], 'req-n', 'p1',
      );

      expect(mockGetListEntries).not.toHaveBeenCalled();
      expect(mockSpendRpc).toHaveBeenCalledWith(expect.objectContaining({
        allocations: [
          { line_id: DRATINI_LINE, count: 2, ratio: 2 },
          { line_id: GIBLE, count: 1, ratio: 1 },
        ],
      }));
    });

    it('a failed tracker read propagates before the RPC', async () => {
      mockFetchComebackTokenData.mockResolvedValue(shutouts(1));
      mockGetPlayerTrackers.mockRejectedValue(new Error('db down'));

      await expect(
        spendComebackTokens('s1', null, 'p1', [{ line_id: GIBLE, count: 1 }], 'req-f', 'p1')
      ).rejects.toThrow('db down');
      expect(mockSpendRpc).not.toHaveBeenCalled();
    });

    it('a replay of a stored request skips the rate pre-check (the RPC answers it)', async () => {
      mockFetchComebackTokenData.mockResolvedValue(shutouts(2));
      mockGetSpends.mockResolvedValue([
        { id: 'sp1', season_id: 's1', player_id: 'p1', line_id: DRATINI_LINE, tracker_id: 't1', amount: 2,
          client_request_id: 'req-old', created_by: 'p1', created_at: '2026-10-01' },
      ]);
      mockSpendRpc.mockResolvedValue({ spent: 2, balance_after: 0, tracker_ids: [], replay: true });

      const replay = await spendComebackTokens('s1', LIST, 'p1', [{ line_id: DRATINI_LINE, count: 3 }], 'req-old', 'p1');

      expect(replay.replay).toBe(true);
    });
  });
});

describe('comebackSpentTotal', () => {
  it('sums the player’s spends only (tokens; no legacy grant stock)', () => {
    expect(comebackSpentTotal([{ player_id: 'p1', amount: 1 }, { player_id: 'p2', amount: 5 }, { player_id: 'p1', amount: 2 }], 'p1')).toBe(3);
    expect(comebackSpentTotal([], 'p1')).toBe(0);
  });
});

// ─── computeRemainingPoints ────────────────────────────────────────

describe('computeRemainingPoints', () => {
  it('budget minus spent minus token cost', async () => {
    mockGetPool.mockResolvedValue({ id: 'pool-1' } as never);
    mockGetPicks.mockResolvedValue([
      { player_id: 'p1', points_spent: 100 },
      { player_id: 'p1', points_spent: 74 },
      { player_id: 'p2', points_spent: 180 },
    ] as never);
    // Purchased tokens come from the one-shot grant (redraft-proof)
    mockGetGrants.mockResolvedValue([
      makeGrant({ player_id: 'p1', grant_type: 'draft_token', token_count: 1 }),
    ]);

    // 180 - 174 - (1 token × 3) = 3
    expect(await computeRemainingPoints('s1', 'p1', 180, 3)).toBe(3);
  });

  it('deducts redraft upgrade costs (budget bypass fix)', async () => {
    mockGetPool.mockResolvedValue({ id: 'pool-1' } as never);
    mockGetPicks.mockResolvedValue([
      { player_id: 'p1', points_spent: 170 },
    ] as never);
    mockGetGrants.mockResolvedValue([]);
    mockGetSeasonRedraftHistory.mockResolvedValue([
      { player_id: 'p1', points_spent: 5 } as never,
      { player_id: 'p1', points_spent: 3 } as never,
      { player_id: 'p2', points_spent: 9 } as never,
    ]);

    // 180 - 170 - 0 - (5 + 3) = 2
    expect(await computeRemainingPoints('s1', 'p1', 180, 3)).toBe(2);
  });

  it('returns full budget when no draft pool exists', async () => {
    mockGetPool.mockResolvedValue(null);
    expect(await computeRemainingPoints('s1', 'p1', 180, 3)).toBe(180);
  });

  it('is seasonRemainingPoints: purchases spent, voids free, redraft refunds back, pool budget first', async () => {
    mockGetPool.mockResolvedValue({ id: 'pool-1', season_id: 's1', point_budget: 150, phase: 'complete' } as never);
    mockGetPicks.mockImplementation(async (poolId) =>
      (poolId === 'pool-1'
        ? [
            { player_id: 'p1', points_spent: 100, voided_at: null },
            { player_id: 'p1', points_spent: 30, voided_at: '2026-10-01T00:00:00Z' }, // void: free
            { player_id: 'p1', points_spent: 20, voided_at: null },
          ]
        : [{ player_id: 'p1', points_spent: 17, voided_at: null }]) as never
    );
    mockGetPurchases.mockResolvedValue([
      { player_id: 'p1', points_spent: 3 },
      { player_id: 'p2', points_spent: 3 },
    ] as never);
    mockGetSlotRefunds.mockResolvedValue([
      { player_id: 'p1', draft_pool_id: 'pool-r', dropped_price: 20 },
    ]);
    mockGetPools.mockResolvedValue([
      { id: 'pool-1', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
      { id: 'pool-r', kind: 'redraft', phase: 'drafting', mode: 'live', status: 'in_progress' },
    ] as never);

    // 150 (pool budget, not 180) − 100 − 20 − 3 (purchase) + 20 (refund) − 17 (redraft pick) = 30
    expect(await computeRemainingPoints('s1', 'p1', 180, 3)).toBe(30);
    expect(mockGetPicks).toHaveBeenCalledWith('pool-r');
  });

  it('ignores picks of a cancelled redraft pool', async () => {
    mockGetPool.mockResolvedValue({ id: 'pool-1', season_id: 's1', point_budget: null } as never);
    mockGetPicks.mockImplementation(async (poolId) =>
      (poolId === 'pool-1' ? [{ player_id: 'p1', points_spent: 170 }] : [{ player_id: 'p1', points_spent: 9 }]) as never
    );
    mockGetSlotRefunds.mockResolvedValue([{ player_id: 'p1', draft_pool_id: 'pool-r', dropped_price: 5 }]);
    mockGetPools.mockResolvedValue([
      { id: 'pool-1', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
      { id: 'pool-r', kind: 'redraft', phase: 'cancelled', mode: 'live', status: 'complete' },
    ] as never);

    // 180 − 170 + 5; the cancelled pool's 9 does not count
    expect(await computeRemainingPoints('s1', 'p1', 180, 3)).toBe(15);
  });
});

// ─── One-shot guards (grant-based, redraft-proof) ─────────────────

describe('hasAllocatedDraftTokens', () => {
  it('true when the player has a draft_token grant', async () => {
    mockGetGrants.mockResolvedValue([makeGrant({ player_id: 'p1' })]);
    expect(await hasAllocatedDraftTokens('s1', 'p1')).toBe(true);
    expect(mockGetGrants).toHaveBeenCalledWith('s1', 'draft_token');
  });

  it('false when only other players have grants', async () => {
    mockGetGrants.mockResolvedValue([makeGrant({ player_id: 'p2' })]);
    expect(await hasAllocatedDraftTokens('s1', 'p1')).toBe(false);
  });
});

// ─── Batched token ledger (draft state route, DATA-PLAN fix 2) ─────
//
// The ledger variants must return exactly what the per-player functions
// return. Each parity case replays a fixture through BOTH paths.

describe('draft token ledger', () => {
  type PickRow = { player_id: string; points_spent: number | null };
  type RedraftRow = { player_id: string; points_spent: number };

  /** Wire the per-player mocks and the season-wide mocks to one fake season. */
  function wireSeason(fixture: {
    pool: { id: string; season_id: string } | null;
    picks: PickRow[];
    grants: EpbTokenGrant[];
    redrafts: RedraftRow[];
  }) {
    mockGetPool.mockResolvedValue(fixture.pool as never);
    mockGetPicks.mockResolvedValue(fixture.picks as never);
    mockGetGrants.mockImplementation(async (_seasonId, grantType) =>
      fixture.grants.filter((g) => !grantType || g.grant_type === grantType),
    );
    mockGetSeasonRedraftHistory.mockResolvedValue(fixture.redrafts as never);
  }

  const parityFixtures = {
    'budget minus spent minus token cost': {
      pool: { id: 'pool-1', season_id: 's1' },
      picks: [
        { player_id: 'p1', points_spent: 100 },
        { player_id: 'p1', points_spent: 74 },
        { player_id: 'p2', points_spent: 180 },
      ],
      grants: [makeGrant({ player_id: 'p1', grant_type: 'draft_token', token_count: 1 })],
      redrafts: [],
    },
    'redraft upgrade costs (budget bypass fix)': {
      pool: { id: 'pool-1', season_id: 's1' },
      picks: [{ player_id: 'p1', points_spent: 170 }],
      grants: [],
      redrafts: [
        { player_id: 'p1', points_spent: 5 },
        { player_id: 'p1', points_spent: 3 },
      ],
    },
    'no draft pool': {
      pool: null,
      picks: [],
      grants: [makeGrant({ player_id: 'p1', token_count: 2 })],
      redrafts: [{ player_id: 'p1', points_spent: 4 }],
    },
    'mixed season: nulls, grants and other players': {
      pool: { id: 'pool-1', season_id: 's1' },
      picks: [
        { player_id: 'p1', points_spent: 60 },
        { player_id: 'p1', points_spent: null },
        { player_id: 'p2', points_spent: 90 },
        { player_id: 'p3', points_spent: 179 },
      ],
      grants: [
        makeGrant({ player_id: 'p2', grant_type: 'draft_token', token_count: 2 }),
      ],
      redrafts: [
        { player_id: 'p2', points_spent: 7 },
        { player_id: 'p3', points_spent: 1 },
      ],
    },
  };

  for (const [name, fixture] of Object.entries(parityFixtures)) {
    it(`matches computeRemainingPoints and hasAllocatedDraftTokens: ${name}`, async () => {
      wireSeason(fixture);
      const ledger = await loadDraftTokenLedger('s1');

      for (const playerId of ['p1', 'p2', 'p3', 'nobody']) {
        const expectedRemaining = await computeRemainingPoints('s1', playerId, 180, 3);
        const expectedAllocated = await hasAllocatedDraftTokens('s1', playerId);
        expect(computeRemainingPointsFromLedger(ledger, playerId, 180, 3)).toBe(expectedRemaining);
        expect(hasAllocatedDraftTokensFromLedger(ledger, playerId)).toBe(expectedAllocated);
      }
    });
  }

  it('reads each source once for the whole season', async () => {
    wireSeason(parityFixtures['mixed season: nulls, grants and other players']);

    await loadDraftTokenLedger('s1');

    expect(mockGetPool).toHaveBeenCalledTimes(1);
    expect(mockGetPicks).toHaveBeenCalledTimes(1);
    expect(mockGetPicks).toHaveBeenCalledWith('pool-1');
    expect(mockGetGrants).toHaveBeenCalledTimes(1);
    expect(mockGetGrants).toHaveBeenCalledWith('s1', 'draft_token'); // the only grant type the database stores
    expect(mockGetSeasonRedraftHistory).toHaveBeenCalledTimes(1);
    expect(mockGetSeasonRedraftHistory).toHaveBeenCalledWith('s1');
    expect(mockGetPurchases).toHaveBeenCalledTimes(1);
    expect(mockGetPurchases).toHaveBeenCalledWith('s1');
    expect(mockGetSlotRefunds).toHaveBeenCalledTimes(1);
    expect(mockGetSlotRefunds).toHaveBeenCalledWith('s1');
    // No redraft slots → no redraft pool picks to read.
    expect(mockGetPools).not.toHaveBeenCalled();
  });

  it('keeps the draft_token grants in the ledger, and no kill-grant field', async () => {
    wireSeason(parityFixtures['mixed season: nulls, grants and other players']);

    const ledger = await loadDraftTokenLedger('s1');

    expect(ledger.draftGrants).toEqual([expect.objectContaining({ player_id: 'p2', token_count: 2 })]);
    expect(ledger).not.toHaveProperty('killGrants');
  });

  it('reuses a pool and picks the caller already holds', async () => {
    wireSeason(parityFixtures['budget minus spent minus token cost']);
    const picks = [{ player_id: 'p1', points_spent: 50 }];

    const ledger = await loadDraftTokenLedger('s1', {
      pool: { id: 'pool-1', season_id: 's1' },
      picks,
    });

    expect(ledger.picks).toEqual([
      { player_id: 'p1', points_spent: 50, voided_at: null, pool_cancelled: false },
    ]);
    expect(mockGetPool).not.toHaveBeenCalled();
    expect(mockGetPicks).not.toHaveBeenCalled();
    // 180 - 50 - 1 token × 3
    expect(computeRemainingPointsFromLedger(ledger, 'p1', 180, 3)).toBe(127);
  });

  it('ignores a known pool from another season and loads the right one', async () => {
    wireSeason(parityFixtures['budget minus spent minus token cost']);

    const ledger = await loadDraftTokenLedger('s1', {
      pool: { id: 'pool-x', season_id: 's-other' },
      picks: [],
    });

    expect(mockGetPool).toHaveBeenCalledWith('s1');
    expect(mockGetPicks).toHaveBeenCalledWith('pool-1');
    expect(computeRemainingPointsFromLedger(ledger, 'p1', 180, 3)).toBe(3);
  });

  it('ignores a known redraft pool (the initial pool carries the budget)', async () => {
    wireSeason(parityFixtures['budget minus spent minus token cost']);

    await loadDraftTokenLedger('s1', {
      pool: { id: 'pool-r', season_id: 's1', kind: 'redraft' },
      picks: [],
    });

    expect(mockGetPool).toHaveBeenCalledWith('s1');
    expect(mockGetPicks).toHaveBeenCalledWith('pool-1');
  });

  it('a hand-built ledger without the newer sources still computes (optional fields)', () => {
    const ledger = {
      picks: [{ player_id: 'p1', points_spent: 10 }],
      draftGrants: [],
      redrafts: [],
      draftTokenPurchases: [],
      redraftRefunds: [],
      initialPoolBudget: null,
    };
    expect(computeRemainingPointsFromLedger(ledger, 'p1', 180, 3)).toBe(170);
  });

  it('a season without a pool yields picks: null and the full budget', async () => {
    wireSeason(parityFixtures['no draft pool']);

    const ledger = await loadDraftTokenLedger('s1');

    expect(ledger.picks).toBeNull();
    expect(mockGetPicks).not.toHaveBeenCalled();
    expect(computeRemainingPointsFromLedger(ledger, 'p1', 180, 3)).toBe(180);
    expect(hasAllocatedDraftTokensFromLedger(ledger, 'p1')).toBe(true);
  });
});

// ─── computeEarnedComebackTokens ───────────
//
// fetchComebackTokenData returns the completed matches inside the pack's earn
// window (the example pack: 'season', every match; 'first_half' passes the
// Hinrunde scope); here we feed a controlled match/game/stat set and let the REAL computePokemonScore
// convert KO counts into survivor scorelines, then assert the margins map to
// the format pack's Comeback Token table (example pack: 0:4 – 0:6 = 1, below = 0)
// and accrue only for the loser.

describe('computeEarnedComebackTokens', () => {
  /** Comeback Tokens earned per player (the `byPlayer` totals). */
  const earnedByPlayer = async (seasonId: string) =>
    (await computeEarnedComebackTokens(seasonId)).byPlayer;

  type Stat = { player_id: string; pokemon_name: string; was_koed: boolean };

  /**
   * Build a single-game match where `loserId` lost all `teamSize` mons
   * (shutout) and `winnerId` lost none. computePokemonScore then yields
   * loserSurvivors=0 and winnerSurvivors=teamSize — the exact shutout
   * scoreline the kill-token table keys on.
   */
  function shutoutMatch(
    matchId: string,
    p1Id: string,
    p2Id: string,
    winnerId: string,
    loserTeamSize: number,
    roundNumber = 1
  ) {
    const loserId = winnerId === p1Id ? p2Id : p1Id;
    const gameId = `game-${matchId}`;
    const stats: Stat[] = [];
    // Loser's whole team fainted; winner's none.
    for (let i = 0; i < loserTeamSize; i++) {
      stats.push({ player_id: loserId, pokemon_name: `Loser-${i}`, was_koed: true });
      stats.push({ player_id: winnerId, pokemon_name: `Winner-${i}`, was_koed: false });
    }
    return {
      match: {
        id: matchId,
        player_1_id: p1Id,
        player_2_id: p2Id,
        winner_id: winnerId,
        round_number: roundNumber,
      },
      gameId,
      stats,
    };
  }

  /** Wire fetchComebackTokenData to return the provided matches. */
  function wireHinrunde(
    built: ReturnType<typeof shutoutMatch>[]
  ): void {
    const matches = built.map((b) => b.match);
    const statsByGame = new Map<string, Stat[]>();
    const gamesByMatch = new Map<string, string[]>();
    for (const b of built) {
      statsByGame.set(b.gameId, b.stats);
      gamesByMatch.set(b.match.id, [b.gameId]);
    }
    mockFetchComebackTokenData.mockResolvedValue({ matches, statsByGame, gamesByMatch });
  }

  it('returns {} when no first-half matches exist', async () => {
    mockFetchComebackTokenData.mockResolvedValue({
      matches: [],
      statsByGame: new Map(),
      gamesByMatch: new Map(),
    });
    expect(await earnedByPlayer('s1')).toEqual({});
  });

  it('awards 0 kill tokens for a 0:3 shutout (below the example table 0:4 row)', async () => {
    wireHinrunde([shutoutMatch('m1', 'p1', 'p2', 'p2', 3)]);
    expect(await earnedByPlayer('s1')).toEqual({});
  });

  it('awards 1 kill token for a 0:4 shutout loss to the loser only', async () => {
    // p1 loses 0:4 (all 4 of p1's mons fainted, p2's none).
    wireHinrunde([shutoutMatch('m2', 'p1', 'p2', 'p2', 4)]);
    expect(await earnedByPlayer('s1')).toEqual({ p1: 1 });
  });

  it('awards the table tokens for 0:5 and 0:6 shutout losses', async () => {
    for (const size of [5, 6]) {
      wireHinrunde([shutoutMatch(`m-${size}`, 'p1', 'p2', 'p2', size)]);
      expect(await earnedByPlayer('s1')).toEqual({ p1: comebackTokensFromTable(0, size) });
    }
  });

  it('awards 0 kill tokens for a 0:2 shutout', async () => {
    wireHinrunde([shutoutMatch('m5', 'p1', 'p2', 'p2', 2)]);
    expect(await earnedByPlayer('s1')).toEqual({});
  });

  it('awards nothing to the winner of a shutout', async () => {
    wireHinrunde([shutoutMatch('m6', 'p1', 'p2', 'p2', 4)]);
    const earned = await earnedByPlayer('s1');
    // Winner p2 earned nothing; only the loser appears (or the map is empty
    // if the winner was never a loser in any match).
    expect(earned.p2).toBeUndefined();
  });

  it('accumulates across multiple Hinrunde matches for the same loser', async () => {
    // p1 loses two shutouts: 0:4 (1 token) + 0:5 (1 token) = 2 tokens.
    wireHinrunde([
      shutoutMatch('m7', 'p1', 'p2', 'p2', 4),
      shutoutMatch('m8', 'p1', 'p3', 'p3', 5),
    ]);
    expect(await earnedByPlayer('s1')).toEqual({ p1: 2 });
  });

  it('the season window (example pack) has no Hinrunde cap: a second-half shutout counts too', async () => {
    wireHinrunde([
      shutoutMatch('m10', 'p1', 'p2', 'p2', 4, 2),
      shutoutMatch('m11', 'p1', 'p3', 'p3', 6, 14),
    ]);
    expect(await earnedByPlayer('s1')).toEqual({ p1: 2 });
    expect(mockFetchComebackTokenData).toHaveBeenCalledWith('s1', undefined);
    expect(mockGetHinrundeScope).not.toHaveBeenCalled();
  });

  describe('first_half earn window (pack window mocked)', () => {
    beforeEach(() => {
      packMocks.earnWindow = 'first_half';
    });

    it('loads only the Hinrunde of the primary stage (the redraft gate boundary)', async () => {
      const scope = { tournament_id: 'stage-1', last_round: 4 };
      mockGetHinrundeScope.mockResolvedValue(scope);
      wireHinrunde([shutoutMatch('m1', 'p1', 'p2', 'p2', 4, 4)]);

      expect(await earnedByPlayer('s1')).toEqual({ p1: 1 });
      expect(mockGetHinrundeScope).toHaveBeenCalledWith('s1');
      expect(mockFetchComebackTokenData).toHaveBeenCalledWith('s1', scope);
    });

    it('earns nothing (and loads no match) before the primary stage has rounds', async () => {
      mockGetHinrundeScope.mockResolvedValue(null);

      expect(await computeEarnedComebackTokens('s1')).toEqual({ byPlayer: {}, history: [] });
      expect(mockFetchComebackTokenData).not.toHaveBeenCalled();
    });

    it('earns nothing when the stage has no Hinrunde round (one round)', async () => {
      mockGetHinrundeScope.mockResolvedValue({ tournament_id: 'stage-1', last_round: 0 });

      expect(await computeEarnedComebackTokens('s1')).toEqual({ byPlayer: {}, history: [] });
      expect(mockFetchComebackTokenData).not.toHaveBeenCalled();
    });

    it('a failed Hinrunde read propagates (never read as "nothing earned")', async () => {
      const failure = new Error('rounds read failed');
      mockGetHinrundeScope.mockRejectedValue(failure);

      await expect(computeEarnedComebackTokens('s1')).rejects.toBe(failure);
    });

    it('the spend pre-check sees only first-half earnings', async () => {
      mockGetHinrundeScope.mockResolvedValue({ tournament_id: 'stage-1', last_round: 4 });
      // The scoped load returns no match (the only shutout was in the second half).
      mockFetchComebackTokenData.mockResolvedValue({ matches: [], statsByGame: new Map(), gamesByMatch: new Map() });

      await expect(
        spendComebackTokens('s1', null, 'p1', [{ line_id: 'gible--garchomp', count: 1 }], 'req-1', 'p1'),
      ).rejects.toMatchObject({ code: 'COMEBACK_BALANCE_SHORT', params: { balance: 0 } });
      expect(mockSpendRpc).not.toHaveBeenCalled();
    });
  });

  it('returns per-match history (score loser first, ascending matchday)', async () => {
    wireHinrunde([
      shutoutMatch('m12', 'p1', 'p2', 'p2', 6, 9),
      shutoutMatch('m13', 'p3', 'p1', 'p1', 4, 2),
      shutoutMatch('m14', 'p2', 'p3', 'p3', 3, 3), // 0:3 → no token, no history row
    ]);

    const earned = await computeEarnedComebackTokens('s1');

    expect(earned.byPlayer).toEqual({ p1: 1, p3: 1 });
    expect(earned.history).toEqual([
      { player_id: 'p3', match_id: 'm13', matchday: 2, score: '0:4', tokens: 1 },
      { player_id: 'p1', match_id: 'm12', matchday: 9, score: '0:6', tokens: 1 },
    ]);
  });

  it('does not accrue tokens for matches with no games (skipped)', async () => {
    const built = shutoutMatch('m9', 'p1', 'p2', 'p2', 4);
    // gamesByMatch empty for this match → skipped, no tokens earned.
    mockFetchComebackTokenData.mockResolvedValue({
      matches: [built.match],
      statsByGame: new Map([[built.gameId, built.stats]]),
      gamesByMatch: new Map(), // no games mapped
    });
    expect(await earnedByPlayer('s1')).toEqual({});
  });
});

// ─── checkEarlyStage3Lock (§27 STAGE 3 SUSPENSION, engine-level) ────
//
// A line that reached the pack's lock stage by its lock matchday is suspended
// for the next `suspendMatchdays` (example pack: stage 3 by matchday 2, one
// matchday). Already-suspended trackers are not re-suspended.

describe('checkEarlyStage3Lock', () => {
  const lock = epbPack.stageLock;

  it('suspends a lock-stage line reached by the lock matchday (suspended_until = matchday + suspendMatchdays)', async () => {
    mockGetSeasonTrackers.mockResolvedValue([
      makeTracker({ id: 't1', base_pokemon: 'Charmander', current_stage: lock.stage, suspended_until_matchday: null }),
    ]);

    const suspended = await checkEarlyStage3Lock('s1', lock.byMatchday);

    expect(suspended).toEqual(['Charmander']);
    expect(mockUpdateTracker).toHaveBeenCalledWith('t1', {
      suspended_until_matchday: lock.byMatchday + lock.suspendMatchdays,
    });
  });

  it('example pack: stage 3 at matchday 2 → suspended until matchday 3', async () => {
    mockGetSeasonTrackers.mockResolvedValue([
      makeTracker({ id: 't1', base_pokemon: 'Charmander', current_stage: 3, suspended_until_matchday: null }),
    ]);
    expect(await checkEarlyStage3Lock('s1', 2)).toEqual(['Charmander']);
    expect(mockUpdateTracker).toHaveBeenCalledWith('t1', { suspended_until_matchday: 3 });
  });

  it('does NOT suspend when the lock stage was reached after the lock matchday', async () => {
    mockGetSeasonTrackers.mockResolvedValue([
      makeTracker({ id: 't2', base_pokemon: 'Charmeleon', current_stage: lock.stage, suspended_until_matchday: null }),
    ]);

    const suspended = await checkEarlyStage3Lock('s1', lock.byMatchday + 1);
    expect(suspended).toEqual([]);
    expect(mockUpdateTracker).not.toHaveBeenCalled();
  });

  it('does NOT suspend a line below the lock stage even early in the season', async () => {
    mockGetSeasonTrackers.mockResolvedValue([
      makeTracker({ id: 't3', base_pokemon: 'Squirtle', current_stage: lock.stage - 1, suspended_until_matchday: null }),
      makeTracker({ id: 't4', base_pokemon: 'Magikarp', current_stage: 1, suspended_until_matchday: null }),
    ]);

    const suspended = await checkEarlyStage3Lock('s1', 1);
    expect(suspended).toEqual([]);
    expect(mockUpdateTracker).not.toHaveBeenCalled();
  });

  it('does NOT re-suspend a tracker already suspended', async () => {
    mockGetSeasonTrackers.mockResolvedValue([
      makeTracker({ id: 't5', base_pokemon: 'Bulbasaur', current_stage: lock.stage, suspended_until_matchday: 2 }),
    ]);

    const suspended = await checkEarlyStage3Lock('s1', 1);
    expect(suspended).toEqual([]);
    expect(mockUpdateTracker).not.toHaveBeenCalled();
  });

  it('scopes to the provided playerIds (match-finalize path)', async () => {
    mockGetSeasonTrackers.mockResolvedValue([
      makeTracker({ id: 't6', player_id: 'p1', base_pokemon: 'Charmander', current_stage: lock.stage, suspended_until_matchday: null }),
      makeTracker({ id: 't7', player_id: 'p2', base_pokemon: 'Squirtle', current_stage: lock.stage, suspended_until_matchday: null }),
    ]);

    const suspended = await checkEarlyStage3Lock('s1', lock.byMatchday, ['p1']);
    expect(suspended).toEqual(['Charmander']);
    // Only p1's tracker was touched.
    expect(mockUpdateTracker).toHaveBeenCalledTimes(1);
    expect(mockUpdateTracker).toHaveBeenCalledWith('t6', {
      suspended_until_matchday: lock.byMatchday + lock.suspendMatchdays,
    });
  });

  it('returns [] when there are no trackers', async () => {
    mockGetSeasonTrackers.mockResolvedValue([]);
    expect(await checkEarlyStage3Lock('s1', 1)).toEqual([]);
    expect(mockUpdateTracker).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeasonGroup: vi.fn(),
  getDraftPoolsBySeasonWithGroups: vi.fn(),
  getPicksByPool: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/epb-comeback-tokens', () => ({ getComebackTokenSpends: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupMembership: vi.fn() }));
vi.mock('@/lib/supabase/queries/epb-draft-token-purchases', () => ({ getDraftTokenPurchases: vi.fn() }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({ getPlayerTrackers: vi.fn(), getSeasonTrackers: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getPlayerIdsWithCompletedMatches: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: vi.fn() }));
vi.mock('@/lib/supabase/queries/progress-log', () => ({ getCosmoMatchdays: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/draft/progress-engine')>();
  return { ...actual, loadDraftTokenLedger: vi.fn(), computeEarnedComebackTokens: vi.fn() };
});

import {
  buildTokenOverview,
  getEpbSeason,
  loadTokenSeasonContext,
  readJsonBody,
  trackerLineId,
  type TokenSeasonContext,
} from '../_lib/overview';
import { computeEarnedComebackTokens, loadDraftTokenLedger, type DraftTokenLedger } from '@/lib/draft/progress-engine';
import { getDraftPoolBySeasonGroup, getDraftPoolsBySeasonWithGroups } from '@/lib/supabase/queries/drafts';
import { getComebackTokenSpends } from '@/lib/supabase/queries/epb-comeback-tokens';
import { getSeasonGroupMembership } from '@/lib/supabase/queries/season-groups';
import { getDraftTokenPurchases } from '@/lib/supabase/queries/epb-draft-token-purchases';
import { getPlayerTrackers, getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getPlayerIdsWithCompletedMatches } from '@/lib/supabase/queries/matches';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getCosmoMatchdays } from '@/lib/supabase/queries/progress-log';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';
import { epbPack } from '@/lib/format-pack';
import exampleList from '@/lib/draft/__tests__/fixtures/example-list.json';

const SEASON = '00000000-0000-4000-8000-0000000000a1';
const LIST = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const NOW = new Date('2026-10-11T12:00:00Z');

function entry(
  base: string,
  stage2: string,
  stage3: string | null,
  k2: number,
  k3: number | null,
  special: PointBuyListEntry['special_rules'] = null,
): PointBuyListEntry {
  return {
    id: `entry-${base}-${stage3 ?? stage2}`,
    list_version_id: LIST,
    line_number: 1,
    base_pokemon: base,
    stage2_pokemon: stage2,
    stage3_pokemon: stage3,
    price: 10,
    kills_to_stage2: k2,
    additional_kills_to_stage3: k3,
    price_group: 'mittel',
    early_rating: null,
    mid_rating: null,
    late_rating: null,
    rationale: null,
    historical_data: null,
    special_rules: special,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
  } as PointBuyListEntry;
}

const IGGLY = entry('Igglybuff', 'Jigglypuff', 'Wigglytuff', 1, 3);
const CHIKO = entry('Chikorita', 'Bayleef', 'Meganium', 2, 4);
/**
 * The active format pack's override line (the example pack's is its participation line), with
 * sheet thresholds the override raises: at the sheet value the line would evolve.
 */
const OVERRIDE = epbPack.lineOverrides[0];
const OVERRIDE_K2 = OVERRIDE.kills_to_stage2!;
const OV = exampleList.entries.find((e) => e.line_id === OVERRIDE.line_id)!;
const OV_ID = OVERRIDE.line_id;
/** Five-source progress two below the override threshold (so one more token cannot evolve it). */
const OV_PROGRESS = OVERRIDE_K2 - 2;
const COSMOG = entry(OV.base_pokemon, OV.stage2_pokemon, OV.stage3_pokemon, OV_PROGRESS, 10, OV.special_rules as PointBuyListEntry['special_rules']);

function tracker(
  id: string,
  playerId: string,
  lineId: string | null,
  base: string,
  over: Partial<EvolutionTracker> = {},
): EvolutionTracker {
  const t: EvolutionTracker = {
    id,
    season_id: SEASON,
    player_id: playerId,
    base_pokemon: base,
    current_form: base,
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: lineId,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...over,
  };
  t.total_kos = t.real_kills + (t.transferred_evo_progress ?? 0) + t.draft_tokens + t.kill_tokens + t.cosmo_points;
  return t;
}

function ledgerFor(spentByPlayer: Record<string, number>, grants: Record<string, number> = {}): DraftTokenLedger {
  return {
    picks: Object.entries(spentByPlayer).map(([player_id, points_spent]) => ({ player_id, points_spent })),
    draftGrants: Object.entries(grants).map(([player_id, token_count]) => ({ player_id, token_count })),
    redrafts: [],
    draftTokenPurchases: [],
    redraftRefunds: [],
    initialPoolBudget: epbPack.defaults.draftBudget,
  };
}

function ctx(over: Partial<TokenSeasonContext> = {}): TokenSeasonContext {
  const entries = [IGGLY, CHIKO, COSMOG];
  return {
    seasonId: SEASON,
    budget: epbPack.defaults.draftBudget,
    cost: epbPack.defaults.tokenRatio,
    max: epbPack.defaults.tokenMax,
    comebackAdminOpened: false,
    initialPhase: 'complete',
    closesAt: null,
    redraftComplete: false,
    anyLeagueMatchConfirmed: false,
    entriesByLine: new Map(entries.map((e) => [`${e.base_pokemon.toLowerCase()}--${(e.stage3_pokemon ?? e.stage2_pokemon).toLowerCase()}`, e])),
    ledger: ledgerFor({ [P1]: epbPack.defaults.draftBudget - 10 }),
    earned: { byPlayer: {}, history: [] },
    spends: [],
    purchases: [],
    trackers: [
      tracker('t-iggly', P1, 'igglybuff--wigglytuff', 'Igglybuff'),
      tracker('t-chiko', P1, 'chikorita--meganium', 'Chikorita'),
    ],
    cosmoMatchdays: new Map(),
    ...over,
  };
}

const lineOf = (dto: ReturnType<typeof buildTokenOverview>, lineId: string) =>
  dto.draft_kill.lines.find((l) => l.line_id === lineId);

describe('buildTokenOverview — Draft Kill Tokens', () => {
  it('Igglybuff-like k2=1 is refused (would evolve); Chikorita k2=2 at 0 is eligible', () => {
    const dto = buildTokenOverview(ctx(), P1, NOW);
    expect(dto.draft_kill.window).toBe('open');
    expect(lineOf(dto, 'igglybuff--wigglytuff')).toMatchObject({
      eligible: false,
      reason: 'TOKEN_WOULD_EVOLVE',
      next_threshold: 1,
      progress: 0,
    });
    expect(lineOf(dto, 'chikorita--meganium')).toMatchObject({ eligible: true, reason: null, next_threshold: 2 });
    expect(dto.draft_kill).toMatchObject({
      cost: epbPack.defaults.tokenRatio,
      max: epbPack.defaults.tokenMax,
      owned: 0,
      unspent_points: 10,
      cutoff_at: null,
    });
  });

  it('window: before the initial draft is complete, closed after the first confirmed result or the explicit cutoff', () => {
    expect(buildTokenOverview(ctx({ initialPhase: 'drafting' }), P1, NOW).draft_kill.window).toBe('before');
    expect(buildTokenOverview(ctx({ anyLeagueMatchConfirmed: true }), P1, NOW).draft_kill.window).toBe('closed');
    const explicit = ctx({ closesAt: '2026-10-12T00:00:00Z', anyLeagueMatchConfirmed: true });
    const dto = buildTokenOverview(explicit, P1, NOW);
    expect(dto.draft_kill.window).toBe('open');
    expect(dto.draft_kill.cutoff_at).toBe('2026-10-12T00:00:00Z');
    expect(buildTokenOverview(explicit, P1, new Date('2026-10-12T00:00:00Z')).draft_kill.window).toBe('closed');
    expect(lineOf(buildTokenOverview(ctx({ initialPhase: null }), P1, NOW), 'chikorita--meganium')?.reason).toBe(
      'TOKEN_WINDOW_CLOSED',
    );
  });

  it('owned counts purchases plus legacy grant tokens; a line with a purchase is refused (line limit)', () => {
    const purchases = [
      {
        id: 'pu1',
        season_id: SEASON,
        player_id: P1,
        line_id: 'chikorita--meganium',
        tracker_id: 't-chiko',
        points_spent: epbPack.defaults.tokenRatio,
        client_request_id: 'r1',
        created_by: P1,
        created_at: '2026-10-02T00:00:00Z',
      },
    ];
    // A league with two tokens per player, so the line limit shows before the player limit.
    const one = buildTokenOverview(ctx({ purchases, max: 2 }), P1, NOW);
    expect(one.draft_kill.owned).toBe(1);
    expect(lineOf(one, 'chikorita--meganium')).toMatchObject({ has_token: true, reason: 'TOKEN_LINE_LIMIT' });

    const limit = buildTokenOverview(
      ctx({ purchases, max: 2, ledger: ledgerFor({ [P1]: epbPack.defaults.draftBudget - 30 }, { [P1]: 1 }) }),
      P1,
      NOW,
    );
    expect(limit.draft_kill.owned).toBe(2);
    expect(lineOf(limit, 'chikorita--meganium')?.reason).toBe('TOKEN_PLAYER_LIMIT');
  });

  it('too few unspent points → TOKEN_POINTS_SHORT; stage 3 → LINE_FULLY_EVOLVED', () => {
    const short = buildTokenOverview(ctx({ ledger: ledgerFor({ [P1]: epbPack.defaults.draftBudget - 2 }) }), P1, NOW);
    expect(short.draft_kill.unspent_points).toBe(2);
    expect(lineOf(short, 'chikorita--meganium')?.reason).toBe('TOKEN_POINTS_SHORT');

    const evolved = buildTokenOverview(
      ctx({ trackers: [tracker('t-chiko', P1, 'chikorita--meganium', 'Chikorita', { current_stage: 3, real_kills: 6 })] }),
      P1,
      NOW,
    );
    expect(lineOf(evolved, 'chikorita--meganium')).toMatchObject({ reason: 'LINE_FULLY_EVOLVED', next_threshold: null });
  });

  it('progress 4 of 5 is blocked (cumulative stage 3 threshold of a stage-2 line)', () => {
    // Chikorita: stage 2 at 2, stage 3 at 2 + 4 = 6 → 5/6 blocked, 4/6 ok.
    const atFive = buildTokenOverview(
      ctx({ trackers: [tracker('t-chiko', P1, 'chikorita--meganium', 'Chikorita', { current_stage: 2, real_kills: 5 })] }),
      P1,
      NOW,
    );
    expect(lineOf(atFive, 'chikorita--meganium')).toMatchObject({
      reason: 'TOKEN_WOULD_EVOLVE',
      next_threshold: 6,
      progress: 5,
    });
  });
});

describe('buildTokenOverview — Comeback Tokens, Participation Tokens and progress sources', () => {
  it('balance = earned − spent, history only for the player, spend window from redraft or admin switch', () => {
    const earned = {
      byPlayer: { [P1]: 2, [P2]: 1 },
      history: [
        { player_id: P1, match_id: 'm1', matchday: 1, score: '0:4', tokens: 1 },
        { player_id: P2, match_id: 'm2', matchday: 1, score: '0:5', tokens: 1 },
        { player_id: P1, match_id: 'm3', matchday: 2, score: '0:6', tokens: 1 },
      ],
    };
    const spends = [
      {
        id: 's1',
        season_id: SEASON,
        player_id: P1,
        line_id: 'chikorita--meganium',
        tracker_id: 't-chiko',
        amount: 1,
        client_request_id: 'r2',
        created_by: P1,
        created_at: '2026-10-05T00:00:00Z',
      },
    ];
    const dto = buildTokenOverview(ctx({ earned, spends }), P1, NOW);
    expect(dto.comeback).toEqual({
      earned: 2,
      spent: 1,
      unspent: 1,
      history: [
        { matchday: 1, score: '0:4', tokens: 1 },
        { matchday: 2, score: '0:6', tokens: 1 },
      ],
      spend_open: false,
      // The active pack's earn window (first half only, or the whole season).
      earn_window: 'season',
    });
    expect(buildTokenOverview(ctx({ redraftComplete: true }), P1, NOW).comeback.spend_open).toBe(true);
    expect(buildTokenOverview(ctx({ comebackAdminOpened: true }), P1, NOW).comeback.spend_open).toBe(true);
    expect(buildTokenOverview(ctx({ redraftComplete: true }), P1, NOW).redraft_complete).toBe(true);
  });

  it('a negative raw balance shows 0 and is logged', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spends = [
      {
        id: 's1',
        season_id: SEASON,
        player_id: P1,
        line_id: 'chikorita--meganium',
        tracker_id: null,
        amount: 2,
        client_request_id: 'r3',
        created_by: P1,
        created_at: '2026-10-05T00:00:00Z',
      },
    ];
    expect(buildTokenOverview(ctx({ spends }), P1, NOW).comeback.unspent).toBe(0);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it('lines keep the five sources apart; total = their sum; the override line uses the pack override', () => {
    const cosmog = tracker('t-cosmog', P1, OV_ID, OV.base_pokemon, {
      real_kills: OV_PROGRESS - 3,
      transferred_evo_progress: 1,
      draft_tokens: 0,
      kill_tokens: 1,
      cosmo_points: 1,
    });
    const dto = buildTokenOverview(
      ctx({ trackers: [cosmog], cosmoMatchdays: new Map([['t-cosmog', [1, 3]]]) }),
      P1,
      NOW,
    );
    expect(dto.lines).toEqual([
      {
        line_id: OV_ID,
        stage: 1,
        self_earned_kills: OV_PROGRESS - 3,
        transferred_evo_progress: 1,
        draft_token_progress: 0,
        comeback_token_progress: 1,
        cosmo_token_progress: 1,
        total_progress: OV_PROGRESS,
        next_threshold: OVERRIDE_K2,
        // The per-line comeback rate: the participation line's Comeback Token rate (pack value).
        comeback_tokens_per_progress: epbPack.participationPoints.comebackTokensPerProgress,
      },
    ]);
    expect(dto.cosmo).toEqual({ line_id: OV_ID, tokens: 1, matchdays_brought: [1, 3] });
    // The sheet value is overridden upward: progress + 1 < override → eligible (at the sheet value it would evolve).
    expect(lineOf(dto, OV_ID)).toMatchObject({ eligible: true, progress: OV_PROGRESS, next_threshold: OVERRIDE_K2 });
  });

  it('Comeback Token rate per line: the participation line costs the pack rate, every other line 1', () => {
    const dto = buildTokenOverview(
      ctx({
        trackers: [
          tracker('t-part', P1, OV_ID, OV.base_pokemon),
          tracker('t-chiko', P1, 'chikorita--meganium', 'Chikorita'),
        ],
      }),
      P1,
      NOW,
    );
    expect(dto.lines.find((l) => l.line_id === OV_ID)?.comeback_tokens_per_progress).toBe(epbPack.participationPoints.comebackTokensPerProgress);
    expect(dto.lines.find((l) => l.line_id === 'chikorita--meganium')?.comeback_tokens_per_progress).toBe(1);
  });

  it('a player without lines gets empty lists and no Cosmo entry; only ids and numbers leave', () => {
    const dto = buildTokenOverview(ctx(), P2, NOW);
    expect(dto.player_id).toBe(P2);
    expect(dto.lines).toEqual([]);
    expect(dto.draft_kill.lines).toEqual([]);
    expect(dto.cosmo).toBeNull();
    expectNoPrivatePlayerData(buildTokenOverview(ctx(), P1, NOW));
  });

  it('trackerLineId falls back to the one entry of the same base, never to an ambiguous branch', () => {
    const lines = ctx().entriesByLine;
    expect(trackerLineId({ line_id: null, base_pokemon: 'Chikorita' }, lines)).toBe('chikorita--meganium');
    const branched = new Map(lines);
    branched.set('chikorita--other', entry('Chikorita', 'Bayleef', 'Other', 2, 4));
    expect(trackerLineId({ line_id: null, base_pokemon: 'Chikorita' }, branched)).toBeNull();
    expect(trackerLineId({ line_id: 'chikorita--other', base_pokemon: 'Chikorita' }, branched)).toBe('chikorita--other');
  });
});

describe('loadTokenSeasonContext — one read per source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormatRules).mockResolvedValue({
      draft_budget: epbPack.defaults.draftBudget,
      draft_token_ratio: epbPack.defaults.tokenRatio,
      draft_token_max: epbPack.defaults.tokenMax,
      comeback_spend_open: true,
    } as never);
    vi.mocked(getDraftPoolsBySeasonWithGroups).mockResolvedValue([
      { id: 'pool-1', kind: 'initial', phase: 'complete', mode: 'live', status: 'completed' },
      { id: 'pool-2', kind: 'redraft', phase: 'complete', mode: 'slow', status: 'completed' },
    ] as never);
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValue({
      id: 'pool-1',
      kind: 'initial',
      phase: 'complete',
      token_purchase_closes_at: null,
    } as never);
    vi.mocked(getListEntries).mockResolvedValue([CHIKO, COSMOG]);
    vi.mocked(loadDraftTokenLedger).mockResolvedValue(ledgerFor({ [P1]: 170 }));
    vi.mocked(computeEarnedComebackTokens).mockResolvedValue({ byPlayer: {}, history: [] });
    vi.mocked(getComebackTokenSpends).mockResolvedValue([]);
    vi.mocked(getDraftTokenPurchases).mockResolvedValue([]);
    vi.mocked(getPlayerTrackers).mockResolvedValue([
      tracker('t-chiko', P1, 'chikorita--meganium', 'Chikorita'),
      tracker('t-cosmog', P1, OV_ID, OV.base_pokemon, { cosmo_points: 1 }),
    ]);
    vi.mocked(getSeasonTrackers).mockResolvedValue([]);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([{ id: 'stage-1' }] as never);
    vi.mocked(getPlayerIdsWithCompletedMatches).mockResolvedValue(new Set([P2]));
    vi.mocked(getCosmoMatchdays).mockResolvedValue([2]);
  });

  it('scopes per-player reads, reads the cutoff matches only for the default cutoff, and the participation matchdays once', async () => {
    const c = await loadTokenSeasonContext({ id: SEASON, point_buy_list_id: LIST }, P1);
    expect(getPlayerTrackers).toHaveBeenCalledWith(SEASON, P1);
    expect(getSeasonTrackers).not.toHaveBeenCalled();
    expect(getComebackTokenSpends).toHaveBeenCalledWith(SEASON, P1);
    expect(getDraftTokenPurchases).toHaveBeenCalledWith(SEASON, P1);
    expect(getListEntries).toHaveBeenCalledWith(LIST);
    expect(getPlayerIdsWithCompletedMatches).toHaveBeenCalledWith(['stage-1']);
    expect(getCosmoMatchdays).toHaveBeenCalledTimes(1);
    expect(getCosmoMatchdays).toHaveBeenCalledWith('t-cosmog');
    expect(c).toMatchObject({
      initialPhase: 'complete',
      redraftComplete: true,
      anyLeagueMatchConfirmed: true,
      comebackAdminOpened: true,
    });
    expect(buildTokenOverview(c, P1, NOW).draft_kill.window).toBe('closed');
  });

  it('an explicit cutoff skips the match read; a season without a list reads no entries; no player → whole season', async () => {
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValue({
      id: 'pool-1',
      kind: 'initial',
      phase: 'complete',
      token_purchase_closes_at: '2026-10-20T00:00:00Z',
    } as never);
    const c = await loadTokenSeasonContext({ id: SEASON, point_buy_list_id: null });
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
    expect(getListEntries).not.toHaveBeenCalled();
    expect(getSeasonTrackers).toHaveBeenCalledWith(SEASON);
    expect(getComebackTokenSpends).toHaveBeenCalledWith(SEASON, undefined);
    expect(c.closesAt).toBe('2026-10-20T00:00:00Z');
    expect(c.anyLeagueMatchConfirmed).toBe(false);
  });

  it('falls back to the format_rules defaults and treats a missing initial pool as "before"', async () => {
    vi.mocked(getFormatRules).mockResolvedValue(null);
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValue(null);
    vi.mocked(getDraftPoolsBySeasonWithGroups).mockResolvedValue([]);
    const c = await loadTokenSeasonContext({ id: SEASON, point_buy_list_id: LIST }, P1);
    expect(c).toMatchObject({
      budget: epbPack.defaults.draftBudget,
      cost: epbPack.defaults.tokenRatio,
      max: epbPack.defaults.tokenMax,
      comebackAdminOpened: false,
      initialPhase: null,
    });
    expect(buildTokenOverview(c, P1, NOW).draft_kill.window).toBe('before');
  });
});

describe('loadTokenSeasonContext — league groups (each trainer’s own group’s pools)', () => {
  const GA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const GB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormatRules).mockResolvedValue({ comeback_spend_open: false } as never);
    // Group A: initial complete with an explicit cutoff, Redraft complete. Group B: initial still drafting.
    vi.mocked(getDraftPoolsBySeasonWithGroups).mockResolvedValue([
      { id: 'a-1', kind: 'initial', phase: 'complete', season_group_id: GA },
      { id: 'b-1', kind: 'initial', phase: 'drafting', season_group_id: GB },
      { id: 'a-2', kind: 'redraft', phase: 'complete', season_group_id: GA },
    ] as never);
    vi.mocked(getDraftPoolBySeasonGroup).mockImplementation(async (_season, group) => {
      if (group === null) return null;
      return (group === GA
        ? { id: 'a-1', kind: 'initial', phase: 'complete', token_purchase_closes_at: '2026-10-20T00:00:00Z' }
        : { id: 'b-1', kind: 'initial', phase: 'drafting', token_purchase_closes_at: null }) as never;
    });
    vi.mocked(getSeasonGroupMembership).mockResolvedValue({ [P1]: GA, [P2]: GB });
    vi.mocked(getListEntries).mockResolvedValue([CHIKO, COSMOG]);
    vi.mocked(loadDraftTokenLedger).mockResolvedValue(ledgerFor({ [P1]: 170, [P2]: 170 }));
    vi.mocked(computeEarnedComebackTokens).mockResolvedValue({ byPlayer: {}, history: [] });
    vi.mocked(getComebackTokenSpends).mockResolvedValue([]);
    vi.mocked(getDraftTokenPurchases).mockResolvedValue([]);
    vi.mocked(getPlayerTrackers).mockResolvedValue([]);
    vi.mocked(getSeasonTrackers).mockResolvedValue([]);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([{ id: 'stage-1' }] as never);
    vi.mocked(getPlayerIdsWithCompletedMatches).mockResolvedValue(new Set());
    vi.mocked(getCosmoMatchdays).mockResolvedValue([]);
  });

  it('the admin overview reads every group’s initial pool and builds each trainer from their own group', async () => {
    const c = await loadTokenSeasonContext({ id: SEASON, point_buy_list_id: LIST });
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON, null, 'initial');
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON, GA, 'initial');
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON, GB, 'initial');
    const a = buildTokenOverview(c, P1, NOW);
    const b = buildTokenOverview(c, P2, NOW);
    expect(a).toMatchObject({ initial_draft_complete: true, redraft_complete: true });
    expect(a.draft_kill.cutoff_at).toBe('2026-10-20T00:00:00Z');
    // Comeback spending opens with the trainer's own group's Redraft (epb_spend_comeback_tokens).
    expect(a.comeback.spend_open).toBe(true);
    expect(b).toMatchObject({ initial_draft_complete: false, redraft_complete: false });
    expect(b.draft_kill.window).toBe('before');
    expect(b.comeback.spend_open).toBe(false);
  });

  it('one trainer’s overview reads only that trainer’s group’s initial pool', async () => {
    await loadTokenSeasonContext({ id: SEASON, point_buy_list_id: LIST }, P2);
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON, GB, 'initial');
    expect(getDraftPoolBySeasonGroup).not.toHaveBeenCalledWith(SEASON, GA, 'initial');
  });

  it('a trainer in no group of a grouped league has no pool (window "before", nothing complete)', async () => {
    const c = await loadTokenSeasonContext({ id: SEASON, point_buy_list_id: LIST });
    const outsider = buildTokenOverview(c, '00000000-0000-4000-8000-0000000000ff', NOW);
    expect(outsider).toMatchObject({ initial_draft_complete: false, redraft_complete: false });
    expect(outsider.draft_kill.window).toBe('before');
  });

  it('a league without groups reads no membership', async () => {
    vi.mocked(getDraftPoolsBySeasonWithGroups).mockResolvedValue([
      { id: 'pool-1', kind: 'initial', phase: 'complete', season_group_id: null },
    ] as never);
    await loadTokenSeasonContext({ id: SEASON, point_buy_list_id: LIST }, P1);
    expect(getSeasonGroupMembership).not.toHaveBeenCalled();
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledTimes(1);
  });
});

describe('getEpbSeason / readJsonBody', () => {
  it('refuses a missing season and a non-EPB season with their codes', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);
    await expect(getEpbSeason(SEASON)).rejects.toMatchObject({ code: 'season_not_found', statusCode: 404 });
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON, format_type: 'swiss', point_buy_list_id: null } as never);
    await expect(getEpbSeason(SEASON)).rejects.toMatchObject({ code: 'format_mismatch' });
    vi.mocked(getSeasonById).mockResolvedValue({
      id: SEASON,
      format_type: 'evolution_point_buy',
      point_buy_list_id: LIST,
    } as never);
    await expect(getEpbSeason(SEASON)).resolves.toEqual({ id: SEASON, point_buy_list_id: LIST });
  });

  it('malformed JSON is a 400 invalid_json', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = { json: () => Promise.reject(new SyntaxError('Unexpected token')) } as unknown as Request;
    await expect(readJsonBody(bad)).rejects.toMatchObject({ code: 'invalid_json', statusCode: 400 });
    err.mockRestore();
  });
});

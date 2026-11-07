import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormat: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ getFormatRuntime: vi.fn() }));
vi.mock('@/lib/supabase/queries/ratings', () => ({ getPlayerRatingsBatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getParticipantsBatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({
  getKitPhases: vi.fn(),
  getOutcomesByPhases: vi.fn(),
  getPhaseBattleStats: vi.fn(),
  getPhaseGameCounts: vi.fn(),
  getSeasonKitHead: vi.fn(),
  getPhaseMatchIds: vi.fn(),
  getPhaseMembers: vi.fn(),
  getStandingAdjustments: vi.fn(),
}));

import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getKitPhases, getOutcomesByPhases, getPhaseBattleStats, getPhaseGameCounts, getStandingAdjustments } from '@/lib/supabase/queries/format-engine';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import type { Edge, RankStep, Stage } from '@/lib/format-kit/types';
import { kitAdvancingPlayers, type KitAdvanceInput } from '../advance';

const SEASON = '11111111-1111-4111-8111-111111111111';
const text = (en: string) => ({ en: { v: en, s: 'human' as const }, base: 'en' as const });

function stage(key: string, rank: RankStep[], columns: string[] = []): Stage {
  return {
    key,
    name: text(key),
    participants: { from: 'roster', seeding: 'signup' },
    pairing: { kind: 'round_robin', legs: 1, mirror_legs: true },
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 0 },
    rank,
    columns,
  };
}

const rec = (match_id: string, p1: string, p2: string, winner: string) => ({ match_id, player_1_id: p1, player_2_id: p2, winner_id: winner, round_number: 1 });

/** a beats everyone, b beats c and d, c beats d: a > b > c > d on points. Participant order is the reverse. */
const INPUT: KitAdvanceInput = {
  seasonId: SEASON,
  sourcePhaseId: 'src',
  targetPhaseId: 'tgt',
  participantIds: ['d', 'c', 'b', 'a'],
  participantNames: { a: 'A', b: 'B', c: 'C', d: 'D' },
  matches: [rec('m1', 'a', 'b', 'a'), rec('m2', 'a', 'c', 'a'), rec('m3', 'a', 'd', 'a'), rec('m4', 'b', 'c', 'b'), rec('m5', 'b', 'd', 'b'), rec('m6', 'c', 'd', 'c')],
  byes: [],
  groupOf: {},
};

function arrange(source: Stage, metrics: unknown[] = [], select: Edge['select'] = [{ kind: 'top_n', n: 1 }]) {
  const edge: Edge = { key: 'to_finals', from: source.key, to: 'finals', select, seeding: 'rank', gate: 'admin_confirm' };
  vi.mocked(getSeasonFormat).mockResolvedValue({
    engine: 'kit',
    seed: 'seed-0123456789',
    spec: { edges: [edge], metrics },
    tunables: {},
    amendments: [],
  } as never);
  vi.mocked(getKitPhases).mockResolvedValue([
    { id: 'src', format_stage_key: source.key, stage_order: 1, stage_spec: { v: 1, stage: source } },
    { id: 'tgt', format_stage_key: 'finals', stage_order: 2, stage_spec: { v: 1, stage: stage('finals', []) } },
  ] as never);
  vi.mocked(getOutcomesByPhases).mockResolvedValue([]);
  vi.mocked(getStandingAdjustments).mockResolvedValue([]);
  vi.mocked(getPhaseGameCounts).mockResolvedValue({});
  vi.mocked(getPhaseBattleStats).mockResolvedValue([]);
  vi.mocked(getFormatRuntime).mockResolvedValue({
    relationLinks: [],
    resourceItems: [],
    actionSubmissions: [],
    eventLog: [],
    flags: [],
    playerAttrs: [],
    trackProgress: [],
    checks: [],
    adjustments: [],
  });
}

const pick = async () => (await kitAdvancingPlayers(INPUT))?.map((p) => p.player_id);

beforeEach(() => vi.clearAllMocks());

describe('kitAdvancingPlayers ranks like the public table', () => {
  it('cuts by a custom metric the stage ranks by', async () => {
    const pointsMetric = { kind: 'metric.define', of: 'player', key: 'pts2', label: text('Points'), expr: { k: 'ref', name: 'points', t: 'number' } };
    arrange(stage('groups', [{ kind: 'metric', metric: 'pts2', direction: 'desc' }]), [pointsMetric]);
    // Without the metric the rank step is skipped and the cut falls back to participant order (d first).
    expect(await pick()).toEqual(['a']);
  });

  it('counts the points an admin added to a player', async () => {
    arrange(stage('groups', [{ kind: 'metric', metric: 'points', direction: 'desc' }]));
    vi.mocked(getStandingAdjustments).mockResolvedValue([
      { kind: 'points', target: { stage: 'groups', player_id: 'd' }, delta: { points: 20 }, created_at: '2026-11-01T00:00:00Z' },
    ]);
    expect(await pick()).toEqual(['d']);
  });

  it("follows the admin's order", async () => {
    arrange(stage('groups', [{ kind: 'manual' }]));
    vi.mocked(getStandingAdjustments).mockResolvedValue([
      { kind: 'rank', target: { stage: 'groups' }, delta: { order: ['c', 'a'] }, created_at: '2026-11-01T00:00:00Z' },
    ]);
    expect(await pick()).toEqual(['c']);
  });

  it('cuts by seed from the phase participants', async () => {
    const { getParticipantsBatch } = await import('@/lib/supabase/queries/tournaments');
    arrange(stage('groups', [{ kind: 'metric', metric: 'seed', direction: 'asc' }]));
    vi.mocked(getParticipantsBatch).mockResolvedValue(new Map([['src', [{ id: 'a', seed: 4 }, { id: 'b', seed: 3 }, { id: 'c', seed: 2 }, { id: 'd', seed: 1 }] as never]]));
    expect(await pick()).toEqual(['d']);
  });

  it('cuts by rating from the player ratings', async () => {
    arrange(stage('groups', [{ kind: 'metric', metric: 'rating', direction: 'desc' }]));
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map([['b', { rating: 1900 }], ['a', { rating: 1500 }]]) as never);
    expect(await pick()).toEqual(['b']);
  });
});

describe('kitAdvancingPlayers counts games like the public table', () => {
  /** Games per match, powers of two so every player's total differs: a 7, b 25, c 42, d 52. */
  const GAMES = { m1: 1, m2: 2, m3: 4, m4: 8, m5: 16, m6: 32 };
  const gamesAtLeast = (n: number): Edge['select'] => [
    { kind: 'threshold', when: { k: 'cmp', op: '>=', a: { k: 'ref', name: 'games_played', t: 'number' }, b: { k: 'num', v: n } } },
  ];

  it('reads the game counts of the source phase', async () => {
    arrange(stage('groups', [{ kind: 'metric', metric: 'points', direction: 'desc' }]));
    vi.mocked(getPhaseGameCounts).mockResolvedValue(GAMES);
    await pick();
    expect(getPhaseGameCounts).toHaveBeenCalledWith(['src']);
  });

  it('advances the players whose games_played meets a threshold', async () => {
    arrange(stage('groups', [{ kind: 'metric', metric: 'points', direction: 'desc' }]), [], gamesAtLeast(40));
    vi.mocked(getPhaseGameCounts).mockResolvedValue(GAMES);
    expect(await pick()).toEqual(['c', 'd']);
  });

  it('advances nobody on a games_played threshold while no game is recorded', async () => {
    arrange(stage('groups', [{ kind: 'metric', metric: 'points', direction: 'desc' }]), [], gamesAtLeast(1));
    expect(await pick()).toEqual([]);
  });

  it('cuts by a games_played rank step', async () => {
    // Without counts the step ties everybody and the cut falls back to participant order (d first).
    arrange(stage('groups', [{ kind: 'metric', metric: 'games_played', direction: 'asc' }]));
    vi.mocked(getPhaseGameCounts).mockResolvedValue(GAMES);
    expect(await pick()).toEqual(['a']);
  });
});

describe('kitAdvancingPlayers counts kills like the public table', () => {
  const stat = (game_id: string, player_id: string, kos_dealt: number, was_koed: boolean) => ({
    game_id,
    player_id,
    pokemon_name: 'x',
    was_brought: true,
    was_lead: false,
    kos_dealt,
    was_koed,
    round_number: 1,
  });
  /** a dealt 9 kills, d lost one Pokemon without a kill: a +9, b 0, c 0, d -1. */
  const STATS = [stat('g1', 'a', 9, false), stat('g1', 'd', 0, true)];
  const killRank: RankStep[] = [{ kind: 'metric', metric: 'kill_differential', direction: 'desc' }];
  const killsAtLeast = (n: number): Edge['select'] => [
    { kind: 'threshold', when: { k: 'cmp', op: '>=', a: { k: 'ref', name: 'kill_differential', t: 'number' }, b: { k: 'num', v: n } } },
  ];

  it('reads the battle stats of the source phase', async () => {
    arrange(stage('groups', killRank));
    vi.mocked(getPhaseBattleStats).mockResolvedValue(STATS);
    await pick();
    expect(getPhaseBattleStats).toHaveBeenCalledWith(['src']);
  });

  it('cuts by a kill_differential rank step', async () => {
    // Without the stats the step ties everybody and the cut falls back to participant order (d first).
    arrange(stage('groups', killRank));
    vi.mocked(getPhaseBattleStats).mockResolvedValue(STATS);
    expect(await pick()).toEqual(['a']);
  });

  it('advances the players whose kill_differential meets a threshold', async () => {
    arrange(stage('groups', [{ kind: 'metric', metric: 'points', direction: 'desc' }]), [], killsAtLeast(1));
    vi.mocked(getPhaseBattleStats).mockResolvedValue(STATS);
    expect(await pick()).toEqual(['a']);
  });

  it('does not count kills of a Swiss stage, which the public table does not either', async () => {
    arrange({ ...stage('groups', killRank), pairing: { kind: 'swiss', rounds: 'auto', avoid_repeats: true } });
    vi.mocked(getPhaseBattleStats).mockResolvedValue(STATS);
    expect(await pick()).toEqual(['d']);
    expect(getPhaseBattleStats).not.toHaveBeenCalled();
  });
});

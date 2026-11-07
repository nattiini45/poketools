import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormat: vi.fn() }));
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

import { kitAdvancingPlayers, type KitAdvanceInput } from '../advance';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getKitPhases, getOutcomesByPhases, getPhaseBattleStats, getPhaseGameCounts, getStandingAdjustments } from '@/lib/supabase/queries/format-engine';
import type { AdvanceSelect, Edge, Stage } from '@/lib/format-kit/types';

const SEASON = '11111111-1111-4111-8111-111111111111';

function stage(key: string): Stage {
  return {
    key,
    name: { en: { v: key, s: 'human' }, base: 'en' },
    participants: { from: 'roster', seeding: 'signup' },
    pairing: { kind: 'round_robin', legs: 1, mirror_legs: true },
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 0 },
    rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    columns: [],
  };
}

function arrange(select: AdvanceSelect[], engine: 'kit' | 'shadow' = 'kit', seeding: Edge['seeding'] = 'rank') {
  const edge: Edge = { key: 'to_finals', from: 'groups', to: 'finals', select, seeding, gate: 'admin_confirm' };
  vi.mocked(getSeasonFormat).mockResolvedValue({ engine, seed: 'seed-0123456789', spec: { edges: [edge] } } as never);
  vi.mocked(getKitPhases).mockResolvedValue([
    { id: 'src', format_stage_key: 'groups', stage_order: 1, stage_spec: { v: 1, stage: stage('groups') } },
    { id: 'tgt', format_stage_key: 'finals', stage_order: 2, stage_spec: { v: 1, stage: stage('finals') } },
  ] as never);
  vi.mocked(getOutcomesByPhases).mockResolvedValue([]);
  vi.mocked(getStandingAdjustments).mockResolvedValue([]);
  vi.mocked(getPhaseGameCounts).mockResolvedValue({});
  vi.mocked(getPhaseBattleStats).mockResolvedValue([]);
}

const rec = (match_id: string, p1: string, p2: string, winner: string) => ({
  match_id,
  player_1_id: p1,
  player_2_id: p2,
  winner_id: winner,
  round_number: 1,
});

/** a beats everyone, b beats c and d, c beats d: a > b > c > d. */
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

beforeEach(() => vi.clearAllMocks());

describe('kitAdvancingPlayers', () => {
  it('moves the best players along the edge, seeded by the source table', async () => {
    arrange([{ kind: 'top_n', n: 2 }]);
    expect(await kitAdvancingPlayers(INPUT)).toEqual([
      { player_id: 'a', seed: 1, select: 0 },
      { player_id: 'b', seed: 2, select: 0 },
    ]);
  });

  it('runs selections in order without picking a player twice (top 1, then bottom 2)', async () => {
    arrange([{ kind: 'top_n', n: 1 }, { kind: 'bottom_n', n: 2 }]);
    const players = await kitAdvancingPlayers(INPUT);
    expect(players?.map((p) => p.player_id)).toEqual(['a', 'c', 'd']);
  });

  it('is null in shadow mode and without an edge between the stages', async () => {
    arrange([{ kind: 'top_n', n: 2 }], 'shadow');
    expect(await kitAdvancingPlayers(INPUT)).toBeNull();
    arrange([{ kind: 'top_n', n: 2 }]);
    expect(await kitAdvancingPlayers({ ...INPUT, targetPhaseId: 'elsewhere' })).toBeNull();
  });

  it('waits for an admin list on a manual_list selection', async () => {
    arrange([{ kind: 'manual_list' }], 'kit', 'manual');
    await expect(kitAdvancingPlayers(INPUT)).rejects.toMatchObject({ code: 'advance_manual_list_required', statusCode: 409 });
    expect((await kitAdvancingPlayers({ ...INPUT, manualList: ['c', 'a'] }))?.map((p) => p.player_id)).toEqual(['c', 'a']);
  });
});

describe('kitAdvancingPlayers into a foreach_group phase', () => {
  const groupOf = { a: 1, b: 2, c: 1, d: 2 };

  function arrangeGroups() {
    arrange([{ kind: 'per_group', n: 2 }]);
    vi.mocked(getKitPhases).mockResolvedValue([
      { id: 'src', format_stage_key: 'groups', format_group: 0, stage_order: 1, stage_spec: { v: 1, stage: stage('groups') } },
      { id: 'tgt1', format_stage_key: 'finals', format_group: 1, stage_order: 2, stage_spec: { v: 1, stage: stage('finals') } },
      { id: 'tgt2', format_stage_key: 'finals', format_group: 2, stage_order: 2, stage_spec: { v: 1, stage: stage('finals') } },
    ] as never);
  }

  it('fills each group phase with the players of its own group, seeded from 1', async () => {
    arrangeGroups();
    const first = await kitAdvancingPlayers({ ...INPUT, targetPhaseId: 'tgt1', groupOf });
    const second = await kitAdvancingPlayers({ ...INPUT, targetPhaseId: 'tgt2', groupOf });
    expect(first?.map((p) => [p.player_id, p.seed])).toEqual([['a', 1], ['c', 2]]);
    expect(second?.map((p) => [p.player_id, p.seed])).toEqual([['b', 1], ['d', 2]]);
  });

  it('is null for a phase the league does not have', async () => {
    arrangeGroups();
    const all = await kitAdvancingPlayers({ ...INPUT, targetPhaseId: 'tgt', groupOf });
    expect(all).toBeNull();
  });
});
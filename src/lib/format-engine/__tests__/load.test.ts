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
  getPhaseMatchIds: vi.fn(),
  getPhaseMembers: vi.fn(),
  getSeasonKitHead: vi.fn(),
  getStandingAdjustments: vi.fn(),
}));

import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getKitPhases, getOutcomesByPhases, getPhaseBattleStats, getPhaseGameCounts, getPhaseMatchIds, getPhaseMembers, getSeasonKitHead, getStandingAdjustments } from '@/lib/supabase/queries/format-engine';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getParticipantsBatch } from '@/lib/supabase/queries/tournaments';
import type { Stage } from '@/lib/format-kit/types';
import { kitForPhase, kitStandings } from '../context';
import { loadKitPhase, loadKitStandingsData, loadSeedsAndRatings, loadStageTableExtras } from '../load';

const SEASON = '11111111-1111-4111-8111-111111111111';

function stage(key: string, over: Partial<Stage> = {}): Stage {
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
    ...over,
  };
}

const phaseRow = (id: string, s: Stage, group = 0) => ({
  id,
  format_stage_key: s.key,
  format_group: group,
  stage_order: 1,
  stage_spec: { v: 1, stage: s },
});

const points = (stageKey: string, player: string, delta: number) => ({
  kind: 'points' as const,
  target: { stage: stageKey, player_id: player },
  delta: { points: delta },
  created_at: '2026-11-01T00:00:00Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSeasonKitHead).mockResolvedValue({ engine: 'kit', seed: 'seed-0123456789' });
  vi.mocked(getPhaseMatchIds).mockResolvedValue([]);
  vi.mocked(getPhaseGameCounts).mockResolvedValue({});
  vi.mocked(getPhaseBattleStats).mockResolvedValue([]);
  vi.mocked(getOutcomesByPhases).mockResolvedValue([]);
  vi.mocked(getStandingAdjustments).mockResolvedValue([]);
  vi.mocked(getSeasonFormat).mockResolvedValue({ engine: 'kit', seed: 'seed-0123456789', spec: { stages: [], metrics: [] }, tunables: {}, amendments: [] } as never);
});

describe('loadKitStandingsData for a foreach_group stage', () => {
  const finals = stage('finals');

  function arrange() {
    vi.mocked(getKitPhases).mockResolvedValue([phaseRow('g1', finals, 1), phaseRow('g2', finals, 2)] as never);
    vi.mocked(getPhaseMembers).mockResolvedValue([
      { tournament_id: 'g1', player_id: 'a' },
      { tournament_id: 'g1', player_id: 'b' },
      { tournament_id: 'g2', player_id: 'c' },
      { tournament_id: 'g2', player_id: 'd' },
    ]);
    vi.mocked(getStandingAdjustments).mockResolvedValue([
      points('finals', 'a', 2),
      points('finals', 'd', 5),
      { kind: 'rank', target: { stage: 'finals' }, delta: { order: ['b', 'a', 'd', 'c'] }, created_at: '2026-11-02T00:00:00Z' },
    ]);
  }

  it('keeps the adjustments of every group, not the last group only', async () => {
    arrange();
    const data = await loadKitStandingsData(SEASON);
    expect(data?.adjustments).toEqual({ g1: { a: 2 }, g2: { d: 5 } });
    expect(data?.manualOrder).toEqual({ g1: ['b', 'a', 'd', 'c'], g2: ['b', 'a', 'd', 'c'] });
  });

  it('shows the adjusted points of the first group in its public table', async () => {
    arrange();
    const data = await loadKitStandingsData(SEASON);
    const rows = kitStandings(data!, ['a', 'b'], { a: 'A', b: 'B' }, [], {}, {}, {});
    expect(rows.find((row) => row.player_id === 'a')?.points).toBe(2);
  });
});

describe('seeds and ratings', () => {
  it('reads nothing for a stage that ranks by neither', async () => {
    const out = await loadSeedsAndRatings([{ phaseId: 'p', stage: stage('cup'), playerIds: ['a'] }]);
    expect(out).toEqual({});
    expect(getParticipantsBatch).not.toHaveBeenCalled();
    expect(getPlayerRatingsBatch).not.toHaveBeenCalled();
  });

  it('reads the seed of the phase participants for a stage that ranks by seed', async () => {
    vi.mocked(getParticipantsBatch).mockResolvedValue(
      new Map([['p', [{ id: 'a', seed: 2 }, { id: 'b', seed: 1 }, { id: 'c', seed: null }] as never]]),
    );
    const seeded = stage('cup', { rank: [{ kind: 'metric', metric: 'seed', direction: 'asc' }] });
    expect(await loadSeedsAndRatings([{ phaseId: 'p', stage: seeded, playerIds: ['a', 'b', 'c'] }])).toEqual({ seeds: { p: { a: 2, b: 1 } } });
  });

  it('reads the rating of a player for a stage that shows the rating column', async () => {
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map([['a', { rating: 1650 }]]) as never);
    const rated = stage('cup', { columns: ['rating'] });
    expect(await loadSeedsAndRatings([{ phaseId: 'p', stage: rated, playerIds: ['a', 'b'] }])).toEqual({ ratings: { a: 1650 } });
    expect(getPlayerRatingsBatch).toHaveBeenCalledWith(['a', 'b']);
  });

  it('gives the public table the seeds, so a seed rank step orders the players', async () => {
    const seeded = stage('cup', { rank: [{ kind: 'metric', metric: 'seed', direction: 'asc' }] });
    vi.mocked(getKitPhases).mockResolvedValue([phaseRow('p', seeded)] as never);
    vi.mocked(getPhaseMembers).mockResolvedValue([
      { tournament_id: 'p', player_id: 'a' },
      { tournament_id: 'p', player_id: 'b' },
    ]);
    vi.mocked(getParticipantsBatch).mockResolvedValue(new Map([['p', [{ id: 'a', seed: 2 }, { id: 'b', seed: 1 }] as never]]));
    const data = await loadKitStandingsData(SEASON);
    const rows = kitStandings(data!, ['a', 'b'], { a: 'A', b: 'B' }, [], {}, {}, {});
    expect(rows.map((row) => row.player_id)).toEqual(['b', 'a']);
  });
});

describe('loadStageTableExtras and loadKitPhase', () => {
  const cup = stage('cup');

  it('carries the point adjustments and the admin order of the phase', async () => {
    vi.mocked(getStandingAdjustments).mockResolvedValue([
      points('cup', 'a', 3),
      { kind: 'rank', target: { stage: 'cup' }, delta: { order: ['b', 'a'] }, created_at: '2026-11-02T00:00:00Z' },
    ]);
    const extras = await loadStageTableExtras({ seasonId: SEASON, phase: phaseRow('p', cup) as never, stage: cup, seed: 's', playerIds: ['a', 'b'] });
    expect(extras).toEqual({ pointAdjustments: { a: 3 }, manualOrder: ['b', 'a'] });
    expect(getFormatRuntime).not.toHaveBeenCalled();
  });

  it('adds the metrics of the format only when one applies to the stage', async () => {
    const spec = {
      stages: [],
      metrics: [{ kind: 'metric.define', of: 'player', key: 'luck', label: { en: { v: 'l', s: 'human' }, base: 'en' }, expr: { k: 'num', v: 1 } }],
    };
    vi.mocked(getSeasonFormat).mockResolvedValue({ engine: 'kit', seed: 's', spec, tunables: {}, amendments: [] } as never);
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
    const extras = await loadStageTableExtras({ seasonId: SEASON, phase: phaseRow('p', cup) as never, stage: cup, seed: 's', playerIds: ['a'] });
    expect(extras.metricDefs?.map((d) => d.key)).toEqual(['luck']);
    expect(extras.playerRefs).toHaveProperty('a');
  });

  it('carries the game counts of the phase, so games_played is real in every consumer', async () => {
    vi.mocked(getPhaseGameCounts).mockResolvedValue({ m1: 2, m2: 3 });
    const extras = await loadStageTableExtras({ seasonId: SEASON, phase: phaseRow('p', cup) as never, stage: cup, seed: 's', playerIds: ['a', 'b'] });
    expect(extras.gameCounts).toEqual({ m1: 2, m2: 3 });
    expect(getPhaseGameCounts).toHaveBeenCalledWith(['p']);
  });

  it('hands the generate routes the game counts with the phase', async () => {
    vi.mocked(getKitPhases).mockResolvedValue([phaseRow('p', cup)] as never);
    vi.mocked(getPhaseMembers).mockResolvedValue([{ tournament_id: 'p', player_id: 'a' }]);
    vi.mocked(getPhaseGameCounts).mockResolvedValue({ m1: 2 });
    expect((await loadKitPhase(SEASON, 'p'))?.tableExtras).toEqual({ gameCounts: { m1: 2 } });
  });

  describe('kill stats', () => {
    const killStat = { game_id: 'g1', player_id: 'a', pokemon_name: 'x', was_brought: true, was_lead: false, kos_dealt: 2, was_koed: false, round_number: 1 };
    const load = (s: Stage) => loadStageTableExtras({ seasonId: SEASON, phase: phaseRow('p', s) as never, stage: s, seed: 's', playerIds: ['a'] });

    it('carries the battle stats of a round robin phase, so kill_differential is real in every consumer', async () => {
      vi.mocked(getPhaseBattleStats).mockResolvedValue([killStat]);
      expect((await load(cup)).battleStats).toEqual([killStat]);
      expect(getPhaseBattleStats).toHaveBeenCalledWith(['p']);
    });

    it('reads no battle stats for a stage the public table does not count kills in', async () => {
      vi.mocked(getPhaseBattleStats).mockResolvedValue([killStat]);
      const extras = await load(stage('swiss', { pairing: { kind: 'swiss', rounds: 3, avoid_repeats: true } }));
      expect(extras).not.toHaveProperty('battleStats');
      expect(getPhaseBattleStats).not.toHaveBeenCalled();
    });

    it('hands the generate routes the battle stats with the phase', async () => {
      vi.mocked(getKitPhases).mockResolvedValue([phaseRow('p', cup)] as never);
      vi.mocked(getPhaseMembers).mockResolvedValue([{ tournament_id: 'p', player_id: 'a' }]);
      vi.mocked(getPhaseBattleStats).mockResolvedValue([killStat]);
      expect((await loadKitPhase(SEASON, 'p'))?.tableExtras).toEqual({ battleStats: [killStat] });
    });
  });

  it('hands the generate routes the extras with the phase', async () => {
    vi.mocked(getKitPhases).mockResolvedValue([phaseRow('p', cup)] as never);
    vi.mocked(getPhaseMembers).mockResolvedValue([{ tournament_id: 'p', player_id: 'a' }]);
    vi.mocked(getStandingAdjustments).mockResolvedValue([points('cup', 'a', 3)]);
    const phase = await loadKitPhase(SEASON, 'p');
    expect(phase?.tableExtras).toEqual({ pointAdjustments: { a: 3 } });
  });
});

describe('game counts in the public kit data', () => {
  const swiss = stage('swiss', { pairing: { kind: 'swiss', rounds: 3, avoid_repeats: true } });
  const cup = stage('cup');
  const rec = (match_id: string, p1: string, p2: string, winner: string) => ({ match_id, player_1_id: p1, player_2_id: p2, winner_id: winner, round_number: 1 });

  function arrange() {
    vi.mocked(getKitPhases).mockResolvedValue([phaseRow('s', swiss), phaseRow('c', cup)] as never);
    vi.mocked(getPhaseMembers).mockResolvedValue([
      { tournament_id: 's', player_id: 'a' },
      { tournament_id: 's', player_id: 'b' },
      { tournament_id: 'c', player_id: 'c' },
      { tournament_id: 'c', player_id: 'd' },
    ]);
    vi.mocked(getPhaseMatchIds).mockResolvedValue([
      { id: 'm1', tournament_id: 's' },
      { id: 'm2', tournament_id: 'c' },
    ]);
    vi.mocked(getPhaseGameCounts).mockResolvedValue({ m1: 3, m2: 2 });
  }

  it('reads the counts of every phase once, and leaves them out when no game exists', async () => {
    arrange();
    expect((await loadKitStandingsData(SEASON))?.gameCounts).toEqual({ m1: 3, m2: 2 });
    expect(getPhaseGameCounts).toHaveBeenCalledWith(['s', 'c']);
    vi.mocked(getPhaseGameCounts).mockResolvedValue({});
    expect(await loadKitStandingsData(SEASON)).not.toHaveProperty('gameCounts');
  });

  it('gives a Swiss table its games_played, though no caller passes game lists for it', async () => {
    arrange();
    const data = await loadKitStandingsData(SEASON);
    const rows = kitStandings(kitForPhase(data, 's')!, ['a', 'b'], { a: 'A', b: 'B' }, [rec('m1', 'a', 'b', 'a')]);
    expect(rows.map((row) => row.games_played)).toEqual([3, 3]);
  });

  it('narrows the counts to the phase a stage page shows', async () => {
    arrange();
    const data = await loadKitStandingsData(SEASON);
    expect(kitForPhase(data, 's')?.gameCounts).toEqual({ m1: 3 });
    expect(kitForPhase(data, 'c')?.gameCounts).toEqual({ m2: 2 });
  });

  it('counts them in the season-wide table too, and a caller game list still wins', async () => {
    arrange();
    const data = await loadKitStandingsData(SEASON);
    const matches = [rec('m1', 'a', 'b', 'a'), rec('m2', 'c', 'd', 'c')];
    const season = kitStandings(data!, ['a', 'b', 'c', 'd'], {}, matches);
    expect(Object.fromEntries(season.map((row) => [row.player_id, row.games_played]))).toEqual({ a: 3, b: 3, c: 2, d: 2 });
    const listed = kitStandings(data!, ['a', 'b', 'c', 'd'], {}, matches, {}, { gamesByMatch: { m1: ['a'] } });
    expect(Object.fromEntries(listed.map((row) => [row.player_id, row.games_played]))).toEqual({ a: 1, b: 1, c: 2, d: 2 });
  });
});

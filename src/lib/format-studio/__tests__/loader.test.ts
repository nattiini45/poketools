/**
 * The Format Studio loader (query modules mocked). One league is one wave of at most five reads, the exact set
 * depending on the format; a list of leagues is three reads however many leagues it holds, plus the type assignment
 * counts of a classic league without a core pool; zero phases return early; the result is plain JSON without a locale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonFormatType, SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';

const mocks = vi.hoisted(() => ({
  getStagesBySeasonIds: vi.fn(),
  getStageGroupCounts: vi.fn(),
  getLeagueGroupCounts: vi.fn(),
  getSeasonTypeAssignmentCounts: vi.fn(),
  getFormatRules: vi.fn(),
  getTierLimits: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonIds: mocks.getStagesBySeasonIds }));
vi.mock('@/lib/supabase/queries/format-studio', () => ({
  getStageGroupCounts: mocks.getStageGroupCounts,
  getLeagueGroupCounts: mocks.getLeagueGroupCounts,
  getSeasonTypeAssignmentCounts: mocks.getSeasonTypeAssignmentCounts,
}));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: mocks.getFormatRules }));
vi.mock('@/lib/supabase/queries/draft-tier-limits', () => ({ getTierLimits: mocks.getTierLimits }));

import { availableLeagueAdminTabs } from '@/lib/league-admin/tabs';
import { loadLeagueFormat, loadLeagueFormatSummaries, presetViews } from '../loader';

function league(id: string, patch: Partial<SeasonWithDetails> = {}): SeasonWithDetails {
  return {
    id,
    name: `League ${id}`,
    description: '',
    format_type: 'singles',
    ruleset_id: 'rs-main',
    start_date: null,
    end_date: null,
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: null,
    route_theme: undefined,
    language: 'en',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ruleset_name: 'Main ruleset',
    participant_count: 8,
    tournament_count: 2,
    ...patch,
  };
}

function stage(id: string, seasonId: string, patch: Partial<TournamentWithDetails> = {}): TournamentWithDetails {
  return {
    id,
    name: `Phase ${id}`,
    description: '',
    season_id: seasonId,
    bracket_type: 'round_robin',
    ruleset_id: 'rs-main',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'always_public',
    status: 'upcoming',
    current_round: 0,
    stage_order: 0,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    bracket_reset_enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ruleset_name: 'Main ruleset',
    season_name: null,
    participant_count: 8,
    ...patch,
  };
}

/** Round robin into a four-player single elimination: compiles without errors for an eight-player roster. */
function cupStages(seasonId: string, extra: Partial<TournamentWithDetails> = {}): TournamentWithDetails[] {
  return [
    stage(`${seasonId}-a`, seasonId, { advancement_rule: { type: 'top_n', count: 4, per_group: false }, ...extra }),
    stage(`${seasonId}-b`, seasonId, { bracket_type: 'single_elim', stage_order: 1 }),
  ];
}

function mockReads(stagesBySeason: Map<string, TournamentWithDetails[]>) {
  mocks.getStagesBySeasonIds.mockResolvedValue(stagesBySeason);
  mocks.getStageGroupCounts.mockResolvedValue(new Map());
  mocks.getLeagueGroupCounts.mockResolvedValue(new Map());
  mocks.getSeasonTypeAssignmentCounts.mockResolvedValue({ gymTyped: 0, cored: 0 });
  mocks.getFormatRules.mockResolvedValue(null);
  mocks.getTierLimits.mockResolvedValue([]);
}

const readCount = () => Object.values(mocks).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
const called = () => Object.entries(mocks).filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name).sort();

beforeEach(() => {
  vi.clearAllMocks();
  mockReads(new Map([['s1', cupStages('s1')]]));
});

describe('loadLeagueFormat reads', () => {
  const expectations: [SeasonFormatType, string[]][] = [
    ['singles', ['getLeagueGroupCounts', 'getSeasonTypeAssignmentCounts', 'getStageGroupCounts', 'getStagesBySeasonIds']],
    ['doubles', ['getLeagueGroupCounts', 'getSeasonTypeAssignmentCounts', 'getStageGroupCounts', 'getStagesBySeasonIds']],
    [
      'draft',
      ['getLeagueGroupCounts', 'getSeasonTypeAssignmentCounts', 'getStageGroupCounts', 'getStagesBySeasonIds', 'getTierLimits'],
    ],
    ['evolution_point_buy', ['getFormatRules', 'getLeagueGroupCounts', 'getStageGroupCounts', 'getStagesBySeasonIds']],
  ];

  it.each(expectations)('%s: the exact set of reads, at most five, each scoped to this league', async (format, names) => {
    await loadLeagueFormat(league('s1', { format_type: format }));
    expect(called()).toEqual(names);
    expect(readCount()).toBeLessThanOrEqual(5);
    expect(mocks.getStagesBySeasonIds).toHaveBeenCalledWith(['s1']);
    expect(mocks.getStageGroupCounts).toHaveBeenCalledWith(['s1']);
    expect(mocks.getLeagueGroupCounts).toHaveBeenCalledWith(['s1']);
    for (const fn of [mocks.getSeasonTypeAssignmentCounts, mocks.getFormatRules, mocks.getTierLimits]) {
      for (const call of fn.mock.calls) expect(call).toEqual(['s1']);
    }
  });

  it('starts every read in one wave, before any of them has answered', async () => {
    const pending: (() => void)[] = [];
    const later = <T,>(value: T) =>
      new Promise<T>((resolve) => {
        pending.push(() => resolve(value));
      });
    mocks.getStagesBySeasonIds.mockReturnValue(later(new Map([['s1', cupStages('s1')]])));
    mocks.getStageGroupCounts.mockReturnValue(later(new Map()));
    mocks.getLeagueGroupCounts.mockReturnValue(later(new Map()));
    mocks.getSeasonTypeAssignmentCounts.mockReturnValue(later({ gymTyped: 0, cored: 0 }));
    mocks.getTierLimits.mockReturnValue(later([]));

    const result = loadLeagueFormat(league('s1', { format_type: 'draft' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readCount()).toBe(5);
    pending.forEach((resolve) => resolve());
    await expect(result).resolves.toMatchObject({ kind: 'ok' });
  });

  it('passes the format rules and tier limits it read to the descriptor (they reach the module facts)', async () => {
    mocks.getTierLimits.mockResolvedValue([{ id: 'x', season_id: 's1', power_tier: 'S', max_picks: 1 }]);
    const result = await loadLeagueFormat(league('s1', { format_type: 'draft' }));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const mod = result.view.definition?.modules.find((m) => m.adapter === 'legacy_draft');
    expect(mod?.facts.some((fact) => fact.key === 'tier_limit_s' && fact.value === 1)).toBe(true);
  });

  it('rethrows a failed read instead of showing a partial format', async () => {
    const failure = new Error('read failed');
    mocks.getStageGroupCounts.mockRejectedValue(failure);
    await expect(loadLeagueFormat(league('s1'))).rejects.toBe(failure);
  });
});

describe('loadLeagueFormat result', () => {
  it('returns no_phases for a league without phases', async () => {
    mockReads(new Map([['s1', []]]));
    await expect(loadLeagueFormat(league('s1'))).resolves.toEqual({ kind: 'no_phases' });
  });

  it('returns no_phases when the league is missing from the read', async () => {
    mockReads(new Map());
    await expect(loadLeagueFormat(league('s1'))).resolves.toEqual({ kind: 'no_phases' });
  });

  it('compiles the descriptor into a view with the plan, order, coverage and no problems', async () => {
    const result = await loadLeagueFormat(league('s1'));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.view.ok).toBe(true);
    expect(result.view.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.view.definition?.stages).toHaveLength(2);
    expect(result.view.order).toEqual(['stage_1', 'stage_2']);
    expect(result.view.plan).toHaveLength(2);
    expect(result.view.coverage?.total).toBeGreaterThan(0);
    expect(result.editorLinks).toEqual({});
  });

  it('takes the ruleset names from the league and phase rows already read', async () => {
    mockReads(
      new Map([
        ['s1', [stage('a', 's1', { ruleset_id: 'rs-playoffs', ruleset_name: 'Playoff ruleset' }), stage('b', 's1', { stage_order: 1 })]],
      ]),
    );
    const result = await loadLeagueFormat(league('s1'));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.view.rulesets).toEqual(
      expect.arrayContaining([
        { id: 'rs-main', name: 'Main ruleset' },
        { id: 'rs-playoffs', name: 'Playoff ruleset' },
      ]),
    );
    expect(readCount()).toBe(4);
  });

  it('is plain JSON and holds no locale', async () => {
    const result = await loadLeagueFormat(league('s1'));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(Object.keys(result.view).sort()).toEqual(
      ['capabilities', 'coverage', 'definition', 'diagnostics', 'hash', 'ok', 'order', 'plan', 'rulesets'],
    );
    expect(JSON.stringify(result)).not.toMatch(/"locale"/);
  });

  describe('editor links', () => {
    it('Evolution Point Buy links its module to the Rules tab', async () => {
      const result = await loadLeagueFormat(league('s1', { format_type: 'evolution_point_buy' }));
      if (result.kind !== 'ok') throw new Error('expected ok');
      expect(result.editorLinks).toEqual({ epb: '/admin/leagues/s1?tab=rules' });
    });

    it('the classic draft links its module to the Rules tab', async () => {
      const result = await loadLeagueFormat(league('s1', { format_type: 'draft' }));
      if (result.kind !== 'ok') throw new Error('expected ok');
      expect(result.editorLinks).toEqual({ legacy_draft: '/admin/leagues/s1?tab=rules' });
    });

    it('Core Liga links its module to the Participants tab', async () => {
      mocks.getSeasonTypeAssignmentCounts.mockResolvedValue({ gymTyped: 0, cored: 3 });
      const result = await loadLeagueFormat(league('s1'));
      if (result.kind !== 'ok') throw new Error('expected ok');
      expect(result.editorLinks).toEqual({ core_liga: '/admin/leagues/s1?tab=participants' });
    });

    it('every link points at a tab the format has', async () => {
      mocks.getSeasonTypeAssignmentCounts.mockResolvedValue({ gymTyped: 1, cored: 1 });
      for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy'] as const) {
        const result = await loadLeagueFormat(league('s1', { format_type: format }));
        if (result.kind !== 'ok') throw new Error('expected ok');
        const tabs: string[] = availableLeagueAdminTabs(format);
        for (const href of Object.values(result.editorLinks)) {
          const tab = new URL(href, 'http://localhost').searchParams.get('tab');
          expect(tabs).toContain(tab);
        }
      }
    });
  });
});

describe('loadLeagueFormatSummaries', () => {
  it('reads nothing for an empty list', async () => {
    await expect(loadLeagueFormatSummaries([])).resolves.toEqual([]);
    expect(readCount()).toBe(0);
  });

  it('makes exactly three reads for one league that needs no type assignment counts', async () => {
    const rows = await loadLeagueFormatSummaries([league('s1', { format_type: 'evolution_point_buy' })]);
    expect(readCount()).toBe(3);
    expect(called()).toEqual(['getLeagueGroupCounts', 'getStageGroupCounts', 'getStagesBySeasonIds']);
    expect(rows).toHaveLength(1);
  });

  it('makes exactly three reads for 30 leagues and passes all their ids', async () => {
    const leagues = Array.from({ length: 30 }, (_, i) =>
      i % 2 ? league(`s${i}`, { core_pool: [['fire', 'water', 'grass']] }) : league(`s${i}`, { format_type: 'evolution_point_buy' }),
    );
    mockReads(new Map(leagues.map((l) => [l.id, cupStages(l.id)])));
    const rows = await loadLeagueFormatSummaries(leagues);
    expect(readCount()).toBe(3);
    expect(mocks.getStagesBySeasonIds).toHaveBeenCalledWith(leagues.map((l) => l.id));
    expect(mocks.getStageGroupCounts).toHaveBeenCalledWith(leagues.map((l) => l.id));
    expect(mocks.getLeagueGroupCounts).toHaveBeenCalledWith(leagues.map((l) => l.id));
    expect(rows.map((r) => r.id)).toEqual(leagues.map((l) => l.id));
  });

  it('summarises phases, pairings in order, problems and coverage per league', async () => {
    const bad = league('bad', { participant_count: 8 });
    mockReads(
      new Map([
        ['s1', cupStages('s1')],
        ['bad', cupStages('bad', { best_of_default: 2 })],
        ['none', []],
      ]),
    );
    const rows = await loadLeagueFormatSummaries([league('s1', { is_test_season: true }), bad, league('none')]);
    const [good, broken, empty] = rows;
    expect(good).toMatchObject({
      id: 's1',
      name: 'League s1',
      formatType: 'singles',
      isTest: true,
      stageCount: 2,
      pairings: ['round_robin', 'single_elim'],
      errors: 0,
    });
    expect(good.coverage?.total).toBeGreaterThan(0);
    expect(broken.errors).toBeGreaterThan(0);
    expect(empty).toEqual({
      id: 'none',
      name: 'League none',
      formatType: 'singles',
      isTest: false,
      stageCount: 0,
      pairings: [],
      errors: 0,
      warnings: 0,
      coverage: null,
    });
  });

  describe('coverage agrees with the league detail', () => {
    const modulesOf = async (l: SeasonWithDetails) => {
      const [row] = await loadLeagueFormatSummaries([l]);
      const detail = await loadLeagueFormat(l);
      if (detail.kind !== 'ok') throw new Error('expected ok');
      return { summary: row.coverage, detail: detail.view.coverage };
    };

    it('counts the Core Liga module of a gym-typed league without a core pool, like the detail does', async () => {
      mocks.getSeasonTypeAssignmentCounts.mockResolvedValue({ gymTyped: 2, cored: 0 });
      const { summary, detail } = await modulesOf(league('s1'));
      expect(summary?.legacy).toBe(1);
      expect(summary).toEqual(detail);
    });

    it('has no Core Liga module without a pool and without assignments, in both', async () => {
      const { summary, detail } = await modulesOf(league('s1'));
      expect(summary?.legacy).toBe(0);
      expect(summary).toEqual(detail);
    });

    it('reads the counts once per classic league without a pool and nowhere else', async () => {
      const leagues = [
        league('s1'),
        league('s2', { format_type: 'draft' }),
        league('s3', { core_pool: [['fire', 'water', 'grass']] }),
        league('s4', { format_type: 'evolution_point_buy' }),
      ];
      mockReads(new Map(leagues.map((l) => [l.id, cupStages(l.id)])));
      await loadLeagueFormatSummaries(leagues);
      expect(mocks.getSeasonTypeAssignmentCounts.mock.calls).toEqual([['s1'], ['s2']]);
      expect(mocks.getFormatRules).not.toHaveBeenCalled();
      expect(mocks.getTierLimits).not.toHaveBeenCalled();
    });
  });

  it('is plain JSON', async () => {
    const rows = await loadLeagueFormatSummaries([league('s1')]);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });
});

describe('presetViews', () => {
  it('gives the three presets as ok views, in gallery order', () => {
    const views = presetViews();
    expect(views.map((v) => v.id)).toEqual(['classic-league', 'cup', 'swiss-top-cut']);
    for (const { view } of views) {
      expect(view.ok).toBe(true);
      expect(view.definition).not.toBeNull();
      expect(view.coverage?.total).toBeGreaterThan(0);
    }
  });

  it('compiles once per process', () => {
    expect(presetViews()).toBe(presetViews());
  });

  it('is plain JSON and reads nothing', () => {
    const views = presetViews();
    expect(JSON.parse(JSON.stringify(views))).toEqual(views);
    expect(readCount()).toBe(0);
  });
});

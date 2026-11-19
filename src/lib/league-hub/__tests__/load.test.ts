/**
 * loadLeagueHubPanel: what each tab hands the hub when its reads succeed or
 * fail.
 *
 *   - A failed tab read is optional to the page: it is logged under its tab
 *     and the panel becomes `{ tab: 'unavailable' }`, so the world, roster,
 *     schedule and rules still render (the preflight found any failed
 *     tab read 500ing the whole league page). The world payload is not
 *     optional: its failure still rejects.
 *   - The phase cards list the members the group tables list (enrolled
 *     players; an ungrouped substitute placed with their opponents).
 *   - Phase chips show the displayed status (finished matches move a stale
 *     stored status on), and only phases a later phase follows show their
 *     advancement rule.
 *
 * The public read cache and the ruleset query are mocked; nothing reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({
  tournamentRounds: vi.fn(),
  tournamentParticipants: vi.fn(),
  tournamentGroups: vi.fn(),
  tournamentBattleStats: vi.fn(),
  tournamentReports: vi.fn(),
  aggregatesSummary: vi.fn(),
  totalGames: vi.fn(),
  seasonBattleStats: vi.fn(),
}));
const phaseReads = vi.hoisted(() => ({
  rounds: vi.fn(),
  participants: vi.fn(),
  groups: vi.fn(),
  battleStats: vi.fn(),
  reports: vi.fn(),
  seasonGameTotal: vi.fn(),
  seasonBattleStats: vi.fn(),
}));
const rulesets = vi.hoisted(() => ({ getRulesetById: vi.fn() }));

vi.mock('@/lib/cache/public-reads', () => ({ publicReads: reads }));
vi.mock('@/lib/cache/phase-public-reads', () => ({ phasePublicReads: phaseReads }));
vi.mock('@/lib/supabase/queries/rulesets', () => rulesets);

import { loadLeagueHubPanel, type LeagueHubLoadContext, type LeagueHubPanelData } from '../load';
import type { LeagueHubTab } from '../tabs';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { PublicMatch } from '@/lib/match/public-match';
import type { PublicPhaseReport } from '@/lib/league-phase/public-report';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import type { SeasonWithDetails, TournamentGroupWithMembers } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PhaseGroupWithMembers, PhaseRound } from '@/types/league-phase';

const STAMP = '2026-03-01T18:00:00Z';

function stage(id: string, overrides: Partial<TournamentWithDetails>): TournamentWithDetails {
  return {
    id,
    name: `Phase ${id}`,
    bracket_type: 'round_robin',
    status: 'active',
    best_of_default: 3,
    participant_count: 4,
    advancement_rule: null,
    current_round: 1,
    stage_order: 1,
    ruleset_id: 'rs-1',
    ...overrides,
  } as TournamentWithDetails;
}

const GROUPS = stage('groups', { advancement_rule: { type: 'top_n', count: 2, per_group: true }, stage_order: 1 });
const PLAYOFFS = stage('playoffs', {
  bracket_type: 'single_elim',
  advancement_rule: { type: 'top_n', count: 2, per_group: false },
  stage_order: 2,
  participant_count: 2,
});

function match(id: string, stageId: string, p1: string, p2: string, winner: string | null): PublicMatch {
  return {
    id,
    round_id: `${stageId}-r1`,
    tournament_id: stageId,
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    status: winner ? 'completed' : 'scheduled',
    date_played: null,
    scheduled_at: null,
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: STAMP,
    updated_at: STAMP,
    player_1_name: p1,
    player_2_name: p2,
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: winner,
    round_status: 'active',
    games: winner
      ? [{ id: `${id}-g1`, game_number: 1, winner_id: winner, replay_url: '', source: 'manual', stats_locked: false }]
      : [],
  };
}

function fixture(m: PublicMatch): LeagueFixture {
  return { stageId: m.tournament_id, stageName: m.tournament_id, match: m };
}

// Group A's row still names the departed player; the substitute holds no row.
const GROUP_ROWS: TournamentGroupWithMembers[] = [
  {
    id: 'g-a',
    tournament_id: 'groups',
    name: 'Group A',
    group_number: 1,
    created_at: STAMP,
    updated_at: STAMP,
    members: [
      { player_id: 'ash', player_name: 'Ash (row)', seed: 1, gym_type: null },
      { player_id: 'departed', player_name: 'Departed', seed: 2, gym_type: null },
    ],
  },
];

const FIXTURES: LeagueFixture[] = [
  fixture(match('m-1', 'groups', 'sub', 'ash', 'sub')),
  fixture(match('m-2', 'groups', 'ash', 'sub', null)), // still to play: the group phase is running
  // The playoff final is played, though its stored status still says active.
  fixture(match('m-final', 'playoffs', 'ash', 'sub', 'ash')),
];

function context(routeData: Promise<WorldRouteData | null> = Promise.resolve(routeDataOf())): LeagueHubLoadContext {
  return {
    seasonId: 'season-1',
    league: { id: 'season-1', format_type: 'singles', ruleset_id: 'rs-1' } as SeasonWithDetails,
    stages: [GROUPS, PLAYOFFS],
    participants: [
      { id: 'ash', name: 'Ash', gym_type: 'Fire', avatar_url: null, core_types: null },
      { id: 'sub', name: 'Late Sub', gym_type: 'Water', avatar_url: null, core_types: null },
    ],
    routeData,
  };
}

function routeDataOf(): WorldRouteData {
  return { fixtures: FIXTURES, standings: [], trackers: [] } as unknown as WorldRouteData;
}

beforeEach(() => {
  for (const fn of Object.values(phaseReads)) fn.mockResolvedValue([]);
  phaseReads.seasonGameTotal.mockResolvedValue(0);
  reads.tournamentRounds.mockResolvedValue([]);
  reads.tournamentParticipants.mockImplementation(async (id: string) =>
    id === 'groups'
      ? [
          { id: 'ash', name: 'Ash', avatar_url: null, seed: 1, starting_bracket: 'winners' },
          { id: 'sub', name: 'Late Sub', avatar_url: null, seed: 2, starting_bracket: 'winners' },
        ]
      : [],
  );
  reads.tournamentGroups.mockImplementation(async (id: string) => (id === 'groups' ? GROUP_ROWS : []));
  reads.tournamentBattleStats.mockResolvedValue([]);
  reads.tournamentReports.mockResolvedValue([]);
  reads.aggregatesSummary.mockResolvedValue([]);
  reads.totalGames.mockResolvedValue(0);
  reads.seasonBattleStats.mockResolvedValue([]);
  rulesets.getRulesetById.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of [...Object.values(reads), ...Object.values(phaseReads), rulesets.getRulesetById]) fn.mockReset();
});

describe('a failed tab read', () => {
  const failing: [LeagueHubTab, () => void][] = [
    ['matches', () => reads.tournamentRounds.mockRejectedValue(new Error('rounds down'))],
    ['groups', () => reads.tournamentGroups.mockRejectedValue(new Error('groups down'))],
    ['playoffs', () => reads.tournamentParticipants.mockRejectedValue(new Error('enrollment down'))],
    ['phases', () => reads.tournamentGroups.mockRejectedValue(new Error('groups down'))],
    ['insights', () => reads.seasonBattleStats.mockRejectedValue(new Error('stats down'))],
    ['rules', () => rulesets.getRulesetById.mockRejectedValue(new Error('ruleset down'))],
    ['reports', () => reads.tournamentReports.mockRejectedValue(new Error('reports down'))],
  ];

  it.each(failing)('%s: becomes an unavailable panel and is logged under its tab', async (tab, fail) => {
    fail();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const panel = await loadLeagueHubPanel(tab, context());
    expect(panel).toEqual({ tab: 'unavailable', requested: tab });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe(`[league-hub] ${tab} tab read failed:`);
    expect(log.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('a failed world payload still rejects: it is not a tab read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadLeagueHubPanel('groups', context(Promise.reject(new Error('payload down'))))).rejects.toThrow(
      'payload down',
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('a missing world payload is still null (the page answers notFound)', async () => {
    expect(await loadLeagueHubPanel('phases', context(Promise.resolve(null)))).toBeNull();
  });
});

describe('insights tab doubles flag', () => {
  async function insights(
    formatType: string,
    stages: Partial<TournamentWithDetails>[] = [],
  ): Promise<Extract<LeagueHubPanelData, { tab: 'insights' }>> {
    const base = context();
    const panel = await loadLeagueHubPanel('insights', {
      ...base,
      league: { ...base.league, format_type: formatType } as SeasonWithDetails,
      stages: stages.map((s, i) => stage(`s${i}`, s)),
    });
    expect(panel?.tab).toBe('insights');
    return panel as Extract<LeagueHubPanelData, { tab: 'insights' }>;
  }

  it.each([
    ['singles', false],
    ['draft', false],
    ['evolution_point_buy', false],
    ['doubles', true],
  ])('%s: follows the league type', async (formatType, expected) => {
    expect((await insights(formatType)).isDoubles).toBe(expected);
    expect((await insights(formatType, [{ is_doubles: !expected }])).isDoubles).toBe(expected);
  });

  it('a custom league is doubles when it has stages and every stage is doubles', async () => {
    expect((await insights('custom')).isDoubles).toBe(false);
    expect((await insights('custom', [{ is_doubles: false }])).isDoubles).toBe(false);
    expect((await insights('custom', [{ is_doubles: true }, { is_doubles: false }])).isDoubles).toBe(false);
    expect((await insights('custom', [{ is_doubles: true }, { is_doubles: true }])).isDoubles).toBe(true);
  });
});

describe('standings tab', () => {
  it('a league without groups: the season table, no group tables, ranked by points', async () => {
    const panel = await loadLeagueHubPanel('standings', context());
    expect(panel).toEqual({
      tab: 'standings',
      standings: [],
      groupStandings: [],
      standingsRanking: 'points',
      isEvolutionPointBuy: false,
    });
    // Rendered from the world payload alone: no tab read.
    for (const fn of Object.values(reads)) expect(fn).not.toHaveBeenCalled();
  });

  it('a league with groups: the group tables and the combined ranking from the world payload', async () => {
    const groupStandings = [{ groupId: 'sg-1', name: 'Gold', standings: [] }];
    const data = { ...routeDataOf(), groupStandings, standingsRanking: 'points_per_match' } as WorldRouteData;
    const panel = await loadLeagueHubPanel('standings', context(Promise.resolve(data)));
    expect(panel).toMatchObject({ tab: 'standings', groupStandings, standingsRanking: 'points_per_match' });
  });
});

describe('phases tab', () => {
  async function phases(): Promise<Extract<LeagueHubPanelData, { tab: 'phases' }>> {
    const panel = await loadLeagueHubPanel('phases', context());
    if (panel?.tab !== 'phases') throw new Error(`expected the phases panel, got ${panel?.tab}`);
    return panel;
  }

  it('reads the groups and enrollment of each table phase, never the elimination phase', async () => {
    await phases();
    expect(reads.tournamentGroups.mock.calls.map(([id]) => id)).toEqual(['groups']);
    expect(reads.tournamentParticipants.mock.calls.map(([id]) => id)).toEqual(['groups']);
  });

  it('lists the members the group table lists: the departed player out, the substitute in', async () => {
    const [groupsPhase] = (await phases()).phases;
    expect(groupsPhase.groups[0].members).toEqual([
      { player_id: 'ash', player_name: 'Ash', seed: 1, gym_type: 'Fire' },
      { player_id: 'sub', player_name: 'Late Sub', seed: 0, gym_type: 'Water' },
    ]);
  });

  it('shows the advancement rule only on a phase a later phase follows', async () => {
    const panel = await phases();
    expect(panel.phases.map((p) => [p.stage.id, p.showAdvancement])).toEqual([
      ['groups', true],
      ['playoffs', false],
    ]);
  });

  it('shows a finished phase as completed while its stored status lags', async () => {
    const panel = await phases();
    expect(panel.phases.map((p) => [p.stage.id, p.stage.status])).toEqual([
      ['groups', 'active'],
      ['playoffs', 'completed'],
    ]);
    expect(PLAYOFFS.status).toBe('active');
  });
});

describe('groups tab', () => {
  it('drops the advancement rule of a phase no later phase follows', async () => {
    const panel = await loadLeagueHubPanel('groups', {
      ...context(),
      stages: [GROUPS],
    });
    if (panel?.tab !== 'groups') throw new Error('expected the groups panel');
    expect(panel.stages[0].advancementRule).toEqual(GROUPS.advancement_rule);
    const last = await loadLeagueHubPanel('groups', {
      ...context(),
      stages: [stage('first', { bracket_type: 'swiss', stage_order: 1 }), GROUPS],
    });
    if (last?.tab !== 'groups') throw new Error('expected the groups panel');
    expect(last.stages.find((s) => s.stage.id === 'groups')?.advancementRule).toBeNull();
  });
});

describe('groups tab ranking of an Evolution Point Buy league', () => {
  // `sub` beat `ash` in m-1; `ash` holds the evolution points.
  const trackers = [{ player_id: 'ash', evolution_points_awarded: 10 }];
  const rankedBy = async (formatRules: unknown) => {
    const base = context();
    const data = { ...routeDataOf(), trackers, formatRules } as unknown as WorldRouteData;
    const panel = await loadLeagueHubPanel('groups', {
      ...base,
      league: { ...base.league, format_type: 'evolution_point_buy' } as SeasonWithDetails,
      stages: [GROUPS],
      routeData: Promise.resolve(data),
    });
    if (panel?.tab !== 'groups') throw new Error('expected the groups panel');
    return panel.stages[0].tables.flatMap((table) => table.standings.map((row) => row.player_id));
  };

  it('ranks by the stored tiebreaker order from the world payload, with no extra read', async () => {
    expect(await rankedBy({ tiebreaker_order: ['evolution_points', 'match_points'] })).toEqual(['ash', 'sub']);
    // The mocked read cache has no format rules read: the tab would throw if it asked for one.
  });

  it('ranks by the format pack chain without a rules row or with an order it cannot use', async () => {
    expect(await rankedBy(null)).toEqual(['sub', 'ash']);
    expect(await rankedBy({ tiebreaker_order: [] })).toEqual(['sub', 'ash']);
  });
});

describe('groups tab byes', () => {
  const swissStage = stage('swiss', { bracket_type: 'swiss', stage_order: 1 });

  it('reads the rounds of a Swiss table, which scores its stored byes', async () => {
    const panel = await loadLeagueHubPanel('groups', { ...context(), stages: [swissStage] });
    if (panel?.tab !== 'groups') throw new Error('expected the groups panel');
    expect(reads.tournamentRounds).toHaveBeenCalledWith('swiss');
  });

  it('reads no rounds for the Swiss table of an Evolution Point Buy league, which scores no byes', async () => {
    const base = context();
    const panel = await loadLeagueHubPanel('groups', {
      ...base,
      league: { ...base.league, format_type: 'evolution_point_buy' } as SeasonWithDetails,
      stages: [swissStage],
    });
    if (panel?.tab !== 'groups') throw new Error('expected the groups panel');
    expect(panel.stages.map((s) => s.stage.id)).toEqual(['swiss']);
    expect(reads.tournamentRounds).not.toHaveBeenCalled();
  });
});

describe('playoffs tab', () => {
  it('shows the elimination phase with its displayed status', async () => {
    const panel = await loadLeagueHubPanel('playoffs', context());
    if (panel?.tab !== 'playoffs') throw new Error('expected the playoffs panel');
    expect(panel.stages.map((s) => [s.stage.id, s.stage.status])).toEqual([['playoffs', 'completed']]);
  });
});

describe.each(['legacy', 'phase'] as const)('%s hub read budget', (storage) => {
  const native = storage === 'phase';
  const selected = {
    rounds: native ? phaseReads.rounds : reads.tournamentRounds,
    participants: native ? phaseReads.participants : reads.tournamentParticipants,
    groups: native ? phaseReads.groups : reads.tournamentGroups,
    battleStats: native ? phaseReads.battleStats : reads.tournamentBattleStats,
    reports: native ? phaseReads.reports : reads.tournamentReports,
    gameTotal: native ? phaseReads.seasonGameTotal : reads.totalGames,
    seasonStats: native ? phaseReads.seasonBattleStats : reads.seasonBattleStats,
    aggregates: reads.aggregatesSummary,
    ruleset: rulesets.getRulesetById,
  };
  const cases: [LeagueHubTab, Partial<Record<keyof typeof selected, string[][]>>][] = [
    ['standings', {}],
    ['matches', { rounds: [['groups'], ['swiss'], ['playoffs']] }],
    ['groups', {
      groups: [['groups'], ['swiss']],
      participants: [['groups'], ['swiss']],
      battleStats: [['groups']],
      rounds: [['swiss']],
    }],
    ['playoffs', { rounds: [['playoffs']], participants: [['playoffs']] }],
    ['phases', { groups: [['groups'], ['swiss']], participants: [['groups'], ['swiss']] }],
    ['insights', {
      aggregates: [['league', 'season-1']],
      gameTotal: [native ? ['season-1'] : ['league', 'season-1']],
      seasonStats: [['season-1']],
    }],
    ['rules', { ruleset: [['rs-1']] }],
    ['reports', { reports: [['groups'], ['swiss'], ['playoffs']] }],
  ];

  it.each(cases)('%s reads only the selected tab from its owner', async (tab, expected) => {
    const panel = await loadLeagueHubPanel(tab, {
      ...context(),
      stages: [GROUPS, stage('swiss', { bracket_type: 'swiss' }), PLAYOFFS],
      storage,
    });
    expect(panel?.tab).toBe(tab);
    for (const key of Object.keys(selected) as (keyof typeof selected)[]) {
      expect(selected[key].mock.calls).toEqual(expected[key] ?? []);
    }
    const otherStore = native ? Object.values(reads).filter((read) => read !== reads.aggregatesSummary) : Object.values(phaseReads);
    for (const read of otherStore) expect(read).not.toHaveBeenCalled();
  });
});

describe('phase-owned hub rows', () => {
  const legacyFixture = FIXTURES[2];
  const { tournament_id: phaseId, ...common } = match('m-final', 'playoffs', 'ash', 'sub', 'ash');
  const nativeMatch = { ...common, phase_id: phaseId, season_id: 'season-1' };
  const nativeFixture = { ...legacyFixture, match: nativeMatch };
  const round: PhaseRound = {
    id: nativeMatch.round_id,
    phase_id: phaseId,
    name: 'Finals',
    round_number: 1,
    best_of: 3,
    status: 'active',
    pairings_generated: true,
    deadline: null,
    bracket_side: 'winners',
    bye_player_ids: [],
    created_at: STAMP,
    updated_at: STAMP,
  };

  it('keeps native match and round identities in the match and bracket panels', async () => {
    phaseReads.rounds.mockResolvedValue([round]);
    const ctx: LeagueHubLoadContext = {
      ...context(Promise.resolve({ ...routeDataOf(), fixtures: [nativeFixture] })),
      stages: [PLAYOFFS],
      storage: 'phase',
    };
    const matchPanel = await loadLeagueHubPanel('matches', ctx);
    expect(matchPanel).toMatchObject({
      tab: 'matches',
      stages: [{ rounds: [{ name: 'Finals', status: 'completed', matches: [nativeMatch] }] }],
    });
    const bracketPanel = await loadLeagueHubPanel('playoffs', ctx);
    expect(bracketPanel).toMatchObject({ tab: 'playoffs', stages: [{ rounds: [round], matches: [nativeMatch] }] });
    if (bracketPanel?.tab !== 'playoffs') throw new Error('expected the playoffs panel');
    expect(bracketPanel.stages[0].rounds[0]).not.toHaveProperty('tournament_id');
    expect(bracketPanel.stages[0].matches[0]).not.toHaveProperty('tournament_id');
  });

  it('ranks native group members from native fixtures and refreshes their public labels on the phase card', async () => {
    const { tournament_id, ...fields } = match('m-group', 'groups', 'ash', 'sub', 'sub');
    const group: PhaseGroupWithMembers = {
      id: 'native-group',
      phase_id: tournament_id,
      season_id: 'season-1',
      name: 'Group A',
      group_number: 1,
      season_group_id: null,
      created_at: STAMP,
      updated_at: STAMP,
      members: [
        { player_id: 'ash', player_name: 'Ash (group row)', seed: 1, gym_type: null },
        { player_id: 'sub', player_name: 'Sub (group row)', seed: 2, gym_type: null },
      ],
    };
    phaseReads.groups.mockResolvedValue([group]);
    phaseReads.participants.mockResolvedValue(context().participants);
    const ctx: LeagueHubLoadContext = {
      ...context(Promise.resolve({
        ...routeDataOf(),
        fixtures: [{
          stageId: group.phase_id,
          stageName: GROUPS.name,
          match: { ...fields, phase_id: group.phase_id, season_id: group.season_id },
        }],
      })),
      stages: [GROUPS],
      storage: 'phase',
    };

    const groups = await loadLeagueHubPanel('groups', ctx);
    if (groups?.tab !== 'groups') throw new Error('expected the groups panel');
    expect(groups.stages[0].tables[0].standings.map((row) => row.player_id)).toEqual(['sub', 'ash']);

    const phases = await loadLeagueHubPanel('phases', ctx);
    if (phases?.tab !== 'phases') throw new Error('expected the phases panel');
    expect(phases.phases[0].groups[0]).toEqual({
      ...group,
      members: [
        { player_id: 'ash', player_name: 'Ash', seed: 1, gym_type: 'Fire' },
        { player_id: 'sub', player_name: 'Late Sub', seed: 2, gym_type: 'Water' },
      ],
    });
  });

  it('preserves a native report allowlist, without legacy report ownership or model metadata', async () => {
    const report: PublicPhaseReport = {
      id: 'report-1',
      phase_id: phaseId,
      round_id: round.id,
      report_type: 'round_recap',
      content: {} as PublicPhaseReport['content'],
      status: 'completed',
      created_at: STAMP,
      updated_at: STAMP,
    };
    phaseReads.reports.mockResolvedValue([report]);
    const panel = await loadLeagueHubPanel('reports', { ...context(), stages: [PLAYOFFS], storage: 'phase' });
    expect(panel).toEqual({ tab: 'reports', reports: [{ stage: PLAYOFFS, reports: [report] }] });
  });

  it('logs an optional failed phase read without retrying on legacy storage', async () => {
    const error = new Error('phase enrollment unavailable');
    phaseReads.participants.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadLeagueHubPanel('playoffs', { ...context(), storage: 'phase' })).toEqual({
      tab: 'unavailable', requested: 'playoffs',
    });
    expect(log).toHaveBeenCalledWith('[league-hub] playoffs tab read failed:', error);
    expect(reads.tournamentParticipants).not.toHaveBeenCalled();
  });
});

/**
 * loadLeagueHubPanel: what each tab hands the hub when its reads succeed or
 * fail.
 *
 *   - A failed tab read is optional to the page: it is logged under its tab
 *     and the panel becomes `{ tab: 'unavailable' }`, so the world, roster,
 *     schedule and rules still render (the PR #65 preflight found any failed
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
const rulesets = vi.hoisted(() => ({ getRulesetById: vi.fn() }));

vi.mock('@/lib/cache/public-reads', () => ({ publicReads: reads }));
vi.mock('@/lib/supabase/queries/rulesets', () => rulesets);

import { loadLeagueHubPanel, type LeagueHubLoadContext, type LeagueHubPanelData } from '../load';
import type { LeagueHubTab } from '../tabs';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { PublicMatch } from '@/lib/match/public-match';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import type { SeasonWithDetails, TournamentGroupWithMembers } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';

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
  for (const fn of [...Object.values(reads), rulesets.getRulesetById]) fn.mockReset();
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

describe('playoffs tab', () => {
  it('shows the elimination phase with its displayed status', async () => {
    const panel = await loadLeagueHubPanel('playoffs', context());
    if (panel?.tab !== 'playoffs') throw new Error('expected the playoffs panel');
    expect(panel.stages.map((s) => [s.stage.id, s.stage.status])).toEqual([['playoffs', 'completed']]);
  });
});

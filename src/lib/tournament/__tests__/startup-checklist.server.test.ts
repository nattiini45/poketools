import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentWithDetails: vi.fn(), getParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ seasonHasGroups: vi.fn(), getSeasonGroupMembership: vi.fn() }));

import { summarizeParticipants } from '@/components/tournament/participants-events';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getSeasonGroupMembership, seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getParticipants, getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { buildStartupChecklist, type StartupChecklistInput } from '../startup-checklist';
import { assembleStartupInput, loadStartupInput, needsLeagueMembership, startupChecklistState } from '../startup-checklist.server';

const SEASON = '00000000-0000-4000-8000-000000008001';
const TID = '00000000-0000-4000-8000-000000007710';
const player = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`;

const tournament = (over: Record<string, unknown> = {}) =>
  ({ id: TID, bracket_type: 'round_robin', status: 'upcoming', ruleset_id: 'v1', ruleset_name: 'Gen 9 OU', best_of_default: 3, season_id: null, ...over }) as never;
const roster = (count: number, seeded = 0) => Array.from({ length: count }, (_, i) => ({ id: player(i), seed: i < seeded ? i + 1 : null }));
const round = (n: number, status = 'completed', bracket_side: string | null = null) => ({ name: `Round ${n}`, round_number: n, status, bracket_side });

/**
 * The input the round manager is given by the two admin pages, written out the way those pages assemble it (the standalone
 * page: `groupsInUse={groups.length > 0}`; the phase page: `phaseGroups.length > 0 || leagueHasGroups`, and the league
 * membership for a Swiss or round robin phase of a league with groups) and the manager's participant summary.
 */
function pageInput(t: Record<string, unknown>, rounds: ReturnType<typeof round>[], rows: Array<{ id: string; seed: number | null }>, own: { groups: number; leagueHasGroups: boolean; membership: Record<string, string> }): StartupChecklistInput {
  const standalone = t.season_id === null;
  const groupsInUse = standalone ? own.groups > 0 : own.groups > 0 || own.leagueHasGroups;
  const leagueGroupOf = !standalone && own.leagueHasGroups && (t.bracket_type === 'swiss' || t.bracket_type === 'round_robin') ? own.membership : null;
  return {
    bracketType: t.bracket_type as never,
    tournamentStatus: t.status as never,
    rulesetSet: Boolean(t.ruleset_id),
    rulesetName: t.ruleset_name as string,
    bestOfDefault: t.best_of_default as number,
    participants: summarizeParticipants(rows),
    rounds: rounds as never,
    groupsInUse,
    leagueGroupOf,
  };
}

function script(t: Record<string, unknown>, rounds: ReturnType<typeof round>[], rows: Array<{ id: string; seed: number | null }>, own: { groups: number; leagueHasGroups: boolean; membership: Record<string, string> }) {
  vi.mocked(getTournamentWithDetails).mockResolvedValue(tournament(t));
  vi.mocked(getRoundsByTournament).mockResolvedValue(rounds as never);
  vi.mocked(getParticipants).mockResolvedValue(rows as never);
  vi.mocked(getGroupsByTournament).mockResolvedValue(Array.from({ length: own.groups }, () => ({})) as never);
  vi.mocked(seasonHasGroups).mockResolvedValue(own.leagueHasGroups);
  vi.mocked(getSeasonGroupMembership).mockResolvedValue(own.membership);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadStartupInput', () => {
  it('returns null for a tournament that does not exist', async () => {
    vi.mocked(getTournamentWithDetails).mockResolvedValue(null);
    expect(await loadStartupInput(TID)).toBeNull();
    expect(getParticipants).not.toHaveBeenCalled();
  });

  it('reads the roster as stored and the rounds, and never writes', async () => {
    script({}, [], roster(8, 3), { groups: 0, leagueHasGroups: false, membership: {} });
    const input = await loadStartupInput(TID);
    expect(input).toMatchObject({
      bracketType: 'round_robin',
      tournamentStatus: 'upcoming',
      rulesetSet: true,
      rulesetName: 'Gen 9 OU',
      bestOfDefault: 3,
      participants: { count: 8, seededCount: 3 },
      groupsInUse: false,
      leagueGroupOf: null,
    });
    // A standalone tournament never asks for league groups.
    expect(seasonHasGroups).not.toHaveBeenCalled();
    expect(getSeasonGroupMembership).not.toHaveBeenCalled();
  });

  it('reads the league membership only for a Swiss or round robin phase of a league with groups', async () => {
    script({ season_id: SEASON, bracket_type: 'swiss' }, [], roster(4), { groups: 0, leagueHasGroups: true, membership: { [player(0)]: 'g1' } });
    expect((await loadStartupInput(TID))?.leagueGroupOf).toEqual({ [player(0)]: 'g1' });
    vi.mocked(getSeasonGroupMembership).mockClear();
    script({ season_id: SEASON, bracket_type: 'single_elim' }, [], roster(4), { groups: 0, leagueHasGroups: true, membership: { [player(0)]: 'g1' } });
    expect((await loadStartupInput(TID))?.leagueGroupOf).toBeNull();
    expect(getSeasonGroupMembership).not.toHaveBeenCalled();
    expect(needsLeagueMembership('double_elim', true)).toBe(false);
  });
});

describe('parity with the input the round manager is given', () => {
  const cases: Array<{ name: string; t: Record<string, unknown>; rounds: ReturnType<typeof round>[]; rows: Array<{ id: string; seed: number | null }>; own: { groups: number; leagueHasGroups: boolean; membership: Record<string, string> } }> = [
    { name: 'an empty standalone tournament', t: {}, rounds: [], rows: [], own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'one player', t: {}, rounds: [], rows: roster(1), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a ready 8-player elimination, partly seeded', t: { bracket_type: 'single_elim' }, rounds: [], rows: roster(8, 5), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a fully seeded 8-player elimination', t: { bracket_type: 'single_elim' }, rounds: [], rows: roster(8, 8), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'no ruleset and a best of zero', t: { ruleset_id: '', ruleset_name: '', best_of_default: 0 }, rounds: [], rows: roster(4), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a standalone tournament with its own groups', t: {}, rounds: [], rows: roster(6), own: { groups: 2, leagueHasGroups: false, membership: {} } },
    { name: 'a swiss tournament after round 1', t: { bracket_type: 'swiss', status: 'active' }, rounds: [round(1, 'completed')], rows: roster(6), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a swiss tournament with a round in progress', t: { bracket_type: 'swiss', status: 'active' }, rounds: [round(1, 'completed'), round(2, 'active')], rows: roster(6), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a round robin with every round generated', t: { status: 'active' }, rounds: [round(1), round(2), round(3)], rows: roster(4), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a built bracket', t: { bracket_type: 'single_elim', status: 'active' }, rounds: [round(1, 'pending', 'winners')], rows: roster(8), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a finished tournament', t: { status: 'completed' }, rounds: [round(1)], rows: roster(4), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    { name: 'a league phase without groups', t: { season_id: SEASON }, rounds: [], rows: roster(6), own: { groups: 0, leagueHasGroups: false, membership: {} } },
    {
      name: 'a round robin phase of a league with groups, one player not placed',
      t: { season_id: SEASON },
      rounds: [],
      rows: roster(4),
      own: { groups: 0, leagueHasGroups: true, membership: { [player(0)]: 'a', [player(1)]: 'a', [player(2)]: 'b' } },
    },
    { name: 'an elimination phase of a league with groups', t: { season_id: SEASON, bracket_type: 'single_elim' }, rounds: [], rows: roster(4, 4), own: { groups: 0, leagueHasGroups: true, membership: {} } },
    { name: 'a phase with its own groups in a league without any', t: { season_id: SEASON }, rounds: [], rows: roster(4), own: { groups: 2, leagueHasGroups: false, membership: {} } },
  ];

  for (const c of cases) {
    it(`builds the same checklist for ${c.name}`, async () => {
      script(c.t, c.rounds, c.rows, c.own);
      const loaded = await loadStartupInput(TID);
      const expected = pageInput(tournament(c.t) as never, c.rounds, c.rows, c.own);
      expect(loaded).not.toBeNull();
      expect(buildStartupChecklist(loaded as StartupChecklistInput)).toEqual(buildStartupChecklist(expected));
      // The same fields, not just the same answer.
      expect(loaded).toEqual(expected);
    });
  }
});

describe('startupChecklistState', () => {
  it('is the same JSON for the same state and changes with any item', () => {
    const base = assembleStartupInput({
      tournament: { bracket_type: 'single_elim', status: 'upcoming', ruleset_id: 'v', ruleset_name: 'Gen 9 OU', best_of_default: 3, season_id: null },
      rounds: [],
      participants: roster(8, 0),
      groupCount: 0,
      leagueHasGroups: false,
      leagueGroupOf: null,
    });
    const state = (input: StartupChecklistInput) => JSON.stringify(startupChecklistState(buildStartupChecklist(input)));
    expect(state(base)).toBe(state({ ...base }));
    expect(state({ ...base, participants: { count: 8, seededCount: 8, playerIds: base.participants?.playerIds ?? [] } })).not.toBe(state(base));
    expect(state({ ...base, participants: { count: 1, seededCount: 0, playerIds: [] } })).not.toBe(state(base));
    expect(startupChecklistState(buildStartupChecklist(base))).toMatchObject({ blocked: false, items: [{ id: 'participants', state: 'done' }, { id: 'ruleset' }, { id: 'bestOf' }, { id: 'seeding', state: 'attention' }] });
  });
});

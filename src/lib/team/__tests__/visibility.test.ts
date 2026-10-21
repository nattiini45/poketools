import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkTeamForkAccess,
  decideMatchRosterVisibility,
  decideTeamPokemonVisibility,
  isVisibleToAnonymous,
  selectAnonymousVisibleLeads,
  filterTeamVisibility,
  filterTeamPokemonForBroadcast,
  pickDisplayTeams,
  resolveTeamVisibility,
  toVisibleTeam,
  redactedPokemon,
  selectVisibleMatchPrepRosters,
  REDACTED_POKEMON,
} from '../visibility';
import type { TeamViewer } from '../visibility';
import { PUBLIC_TEAM_FIELDS } from '../public-team';
import type { Team } from '@/types/team';
import type { TeamVisibilityFacts } from '@/lib/supabase/queries/teams';
import { expectNoPrivateTeamData, teamRowWithShareSecrets } from './private-team-fields';

// ── Mocks: the team-level rule reads visibility facts and share tokens
// through the team queries. The matches mock proves that no rule reads the
// owner's other matches (the removed owner-level rule did). ─────────────

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamVisibilityFacts: vi.fn(),
  getTeamByShareToken: vi.fn(),
}));

import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import { getTeamByShareToken, getTeamVisibilityFacts } from '@/lib/supabase/queries/teams';
const mockedGetMatches = vi.mocked(getMatchesByPlayer);
const mockedFacts = vi.mocked(getTeamVisibilityFacts);
const mockedByToken = vi.mocked(getTeamByShareToken);

// ── Helpers ──────────────────────────────────────────────────────────

function makeTeam(overrides?: Partial<Team>): Team {
  return teamRowWithShareSecrets({
    id: 'team-1',
    player_id: 'owner-1',
    tournament_id: 'tourney-1',
    pokemon: [
      {
        name: 'Pikachu',
        species: 'Pikachu',
        gender: '',
        item: 'Light Ball',
        ability: 'Static',
        evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: 'Timid',
        level: 100,
        moves: ['Thunderbolt', 'Volt Switch', 'Grass Knot', 'Hidden Power'],
      },
    ],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  });
}

function facts(
  matchStatus: TeamVisibilityFacts['match_status'],
  tournamentVisibility: TeamVisibilityFacts['tournament_visibility'] = 'hidden_until_match'
): TeamVisibilityFacts {
  return { match_status: matchStatus, tournament_visibility: tournamentVisibility };
}

const STRANGER: TeamViewer = { viewerId: 'viewer-1', isAdmin: false };
const ANONYMOUS: TeamViewer = { viewerId: null, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockedFacts.mockResolvedValue(new Map());
});

// ── Team-level rule (spec §7, H3) ────────────────────────────────────

describe('decideTeamPokemonVisibility (pure spec §7 table)', () => {
  const planned = makeTeam({ match_id: null });
  const linked = makeTeam({ match_id: 'match-1' });
  const published = makeTeam({ library_published_at: '2026-01-01T00:00:00Z' });
  const personal = makeTeam({ tournament_id: null });

  it.each([
    ['admin, planned team, no facts', planned, { viewerId: 'a', isAdmin: true }, undefined, true],
    ['owner, planned team, no facts', planned, { viewerId: 'owner-1', isAdmin: false }, undefined, true],
    ['anonymous, library-published planned team', published, ANONYMOUS, undefined, true],
    ['anonymous, always_public tournament, planned team', planned, ANONYMOUS, facts(null, 'always_public'), true],
    ['stranger, row linked to a completed match', linked, STRANGER, facts('completed'), true],
    ['anonymous, row linked to a completed match', linked, ANONYMOUS, facts('completed'), true],
    ['stranger, row linked to a scheduled match', linked, STRANGER, facts('scheduled'), false],
    ['stranger, row linked to an in-progress match', linked, STRANGER, facts('in_progress'), false],
    ['stranger, planned row in a hidden_until_match tournament', planned, STRANGER, facts(null), false],
    ['anonymous, personal team (no tournament)', personal, ANONYMOUS, facts(null, null), false],
    ['stranger, facts missing (row not found)', linked, STRANGER, undefined, false],
  ] as const)('%s', (_label, team, viewer, teamFacts, expected) => {
    expect(decideTeamPokemonVisibility(team, viewer, teamFacts)).toBe(expected);
  });

  it('a planned row stays hidden even when its facts claim a completed match (no match link)', () => {
    expect(decideTeamPokemonVisibility(planned, STRANGER, facts('completed'))).toBe(false);
  });
});

describe('resolveTeamVisibility', () => {
  it('reads no facts for an admin or for the owner', async () => {
    const team = makeTeam({ player_id: 'viewer-1' });
    expect(await resolveTeamVisibility([team], { viewerId: 'x', isAdmin: true })).toEqual([true]);
    expect(await resolveTeamVisibility([team], STRANGER)).toEqual([true]);
    expect(mockedFacts).not.toHaveBeenCalled();
  });

  it('reads the facts once for every undecided row and decides each row on its own facts', async () => {
    const own = makeTeam({ id: 'own', player_id: 'viewer-1' });
    const done = makeTeam({ id: 'done', player_id: 'p2', match_id: 'm-done' });
    const pending = makeTeam({ id: 'pending', player_id: 'p2', match_id: 'm-pending' });
    const planned = makeTeam({ id: 'planned', player_id: 'p2' });
    const open = makeTeam({ id: 'open', player_id: 'p3', tournament_id: 'tourney-open' });
    mockedFacts.mockResolvedValue(
      new Map([
        ['done', facts('completed')],
        ['pending', facts('scheduled')],
        ['planned', facts(null)],
        ['open', facts(null, 'always_public')],
      ])
    );

    const result = await resolveTeamVisibility([own, done, pending, planned, open], STRANGER);

    expect(result).toEqual([true, true, false, false, true]);
    expect(mockedFacts).toHaveBeenCalledTimes(1);
    expect(mockedFacts).toHaveBeenCalledWith(['done', 'pending', 'planned', 'open']);
  });

  it('H3 regression: the owner finishing another match does not reveal a planned team', async () => {
    const planned = makeTeam({ id: 'planned', player_id: 'p2' });
    // The legacy rule would consult the owner's matches; the team-level rule must not.
    mockedGetMatches.mockResolvedValue([{ status: 'completed' } as never]);
    mockedFacts.mockResolvedValue(new Map([['planned', facts(null)]]));

    expect(await resolveTeamVisibility([planned], ANONYMOUS)).toEqual([false]);
    expect(mockedGetMatches).not.toHaveBeenCalled();
  });

  it('propagates a failed facts read (fail closed, no silent reveal)', async () => {
    mockedFacts.mockRejectedValue(new Error('facts read failed'));
    await expect(resolveTeamVisibility([makeTeam()], STRANGER)).rejects.toThrow('facts read failed');
  });
});

describe('filterTeamVisibility / toVisibleTeam (allowlist output)', () => {
  it('returns an empty list for no teams without a query', async () => {
    expect(await filterTeamVisibility([], STRANGER)).toEqual([]);
    expect(mockedFacts).not.toHaveBeenCalled();
  });

  it('redacts hidden rows, keeps metadata, and never carries the share columns', async () => {
    const hidden = makeTeam({ id: 'hidden', player_id: 'stranger' });
    const visible = makeTeam({ id: 'visible', player_id: 'stranger', match_id: 'm-1' });
    mockedFacts.mockResolvedValue(
      new Map([
        ['hidden', facts(null)],
        ['visible', facts('completed')],
      ])
    );

    const result = await filterTeamVisibility([hidden, visible], STRANGER);

    expect(result[0].pokemon).toEqual(REDACTED_POKEMON);
    expect(result[0].id).toBe('hidden');
    expect(result[0].player_id).toBe('stranger');
    expect(result[1].pokemon).toEqual(visible.pokemon);
    for (const team of result) {
      expect(Object.keys(team).sort()).toEqual([...PUBLIC_TEAM_FIELDS].sort());
    }
    expectNoPrivateTeamData(result);
  });

  it('the owner view is a PublicTeam too (no share columns)', () => {
    const team = makeTeam();
    const out = toVisibleTeam(team, true);
    expect(out.pokemon).toEqual(team.pokemon);
    expectNoPrivateTeamData(out);
  });
});

describe('pickDisplayTeams (one row per player for the league pages)', () => {
  it('keeps first-seen player order and prefers the newest visible row', () => {
    const aPlanned = makeTeam({ id: 'a-planned', player_id: 'a', created_at: '2026-01-01T00:00:00Z' });
    const bPlanned = makeTeam({ id: 'b-planned', player_id: 'b', created_at: '2026-01-02T00:00:00Z' });
    const aMatch1 = makeTeam({ id: 'a-m1', player_id: 'a', created_at: '2026-01-03T00:00:00Z' });
    const aMatch2 = makeTeam({ id: 'a-m2', player_id: 'a', created_at: '2026-01-04T00:00:00Z' });
    const aMatch3 = makeTeam({ id: 'a-m3', player_id: 'a', created_at: '2026-01-05T00:00:00Z' });

    const picked = pickDisplayTeams(
      [aPlanned, bPlanned, aMatch1, aMatch2, aMatch3],
      [false, false, true, true, false]
    );

    expect(picked.map((p) => [p.team.id, p.visible])).toEqual([
      ['a-m2', true],
      ['b-planned', false],
    ]);
  });

  it('a player with only hidden rows shows their first row, hidden', () => {
    const first = makeTeam({ id: 'first', player_id: 'a' });
    const second = makeTeam({ id: 'second', player_id: 'a', created_at: '2026-02-01T00:00:00Z' });
    expect(pickDisplayTeams([first, second], [false, false])).toEqual([{ team: first, visible: false }]);
  });
});

describe('checkTeamForkAccess', () => {
  it('a library-published team may be forked without a token', async () => {
    const source = makeTeam({ library_published_at: '2026-01-01T00:00:00Z' });
    expect(await checkTeamForkAccess(source)).toBe('allowed');
    expect(mockedByToken).not.toHaveBeenCalled();
  });

  it('an unpublished team without a token is private (whether or not it is shared)', async () => {
    expect(await checkTeamForkAccess(makeTeam())).toBe('source_private');
    expect(mockedByToken).not.toHaveBeenCalled();
  });

  it('a matching, enabled share token allows the fork', async () => {
    const source = makeTeam({ id: 'shared-team' });
    mockedByToken.mockResolvedValue(makeTeam({ id: 'shared-team' }));
    expect(await checkTeamForkAccess(source, 'tok')).toBe('allowed');
    expect(mockedByToken).toHaveBeenCalledWith('tok');
  });

  it('the token of another team, or a disabled or unknown token, is refused', async () => {
    const source = makeTeam({ id: 'shared-team' });
    mockedByToken.mockResolvedValue(makeTeam({ id: 'other-team' }));
    expect(await checkTeamForkAccess(source, 'tok')).toBe('share_token_invalid');
    mockedByToken.mockResolvedValue(null);
    expect(await checkTeamForkAccess(source, 'tok')).toBe('share_token_invalid');
  });
});

// ── Match-scoped surfaces (broadcast, tracker, caster, cast populate, AI) ──

describe('decideMatchRosterVisibility (spec §7, per match)', () => {
  const STRANGER_VIEW: TeamViewer = { viewerId: 'viewer-1', isAdmin: false };
  const ANON: TeamViewer = { viewerId: null, isAdmin: false };

  it.each([
    ['admin, scheduled', { viewerId: 'admin-1', isAdmin: true }, 'scheduled', 'hidden_until_match', true],
    ['owner, scheduled', { viewerId: 'owner-1', isAdmin: false }, 'scheduled', 'hidden_until_match', true],
    ['stranger, scheduled', STRANGER_VIEW, 'scheduled', 'hidden_until_match', false],
    ['stranger, in progress', STRANGER_VIEW, 'in_progress', 'hidden_until_match', false],
    ['anonymous, scheduled', ANON, 'scheduled', 'hidden_until_match', false],
    ['anonymous, completed', ANON, 'completed', 'hidden_until_match', true],
    ['anonymous, always_public', ANON, 'scheduled', 'always_public', true],
    ['anonymous, tournament unknown', ANON, 'scheduled', null, false],
  ] as const)('%s', (_label, viewer, status, mode, expected) => {
    expect(decideMatchRosterVisibility(makeTeam(), viewer, { status }, mode)).toBe(expected);
  });

  it('a library-published team is visible for any match', () => {
    const team = makeTeam({ library_published_at: '2026-01-01T00:00:00Z' });
    expect(decideMatchRosterVisibility(team, ANON, { status: 'scheduled' }, 'hidden_until_match')).toBe(true);
  });

  it("H3 regression: the owner finishing OTHER matches does not reveal this match's roster", () => {
    // The removed owner-level rule read the owner's matches; the per-match rule reads nothing.
    mockedGetMatches.mockResolvedValue([{ status: 'completed' } as never]);
    expect(decideMatchRosterVisibility(makeTeam(), ANON, { status: 'scheduled' }, 'hidden_until_match')).toBe(false);
    expect(mockedGetMatches).not.toHaveBeenCalled();
  });
});

describe('filterTeamPokemonForBroadcast (anonymous, per match)', () => {
  it('returns an empty array when there is no team', () => {
    expect(filterTeamPokemonForBroadcast(null, { status: 'completed' }, 'hidden_until_match')).toEqual([]);
  });

  it('returns the sets once the match is completed', () => {
    const team = makeTeam();
    expect(filterTeamPokemonForBroadcast(team, { status: 'completed' }, 'hidden_until_match')).toEqual(team.pokemon);
  });

  it('redacts an upcoming match roster even when the owner completed other matches', () => {
    mockedGetMatches.mockResolvedValue([{ status: 'completed' } as never]);
    const result = filterTeamPokemonForBroadcast(makeTeam(), { status: 'scheduled' }, 'hidden_until_match');
    expect(result).toEqual(REDACTED_POKEMON);
    expect(result).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain('Pikachu');
    expect(mockedGetMatches).not.toHaveBeenCalled();
  });

  it('shows an upcoming match roster of an always_public tournament', () => {
    const team = makeTeam();
    expect(filterTeamPokemonForBroadcast(team, { status: 'scheduled' }, 'always_public')).toEqual(team.pokemon);
  });
});

// ── Anonymous rows from facts alone (public world aces) ──────────────

describe('isVisibleToAnonymous', () => {
  it.each([
    ['a completed match, hidden_until_match', facts('completed'), true],
    ['an always_public tournament, no match', facts(null, 'always_public'), true],
    ['a scheduled match, hidden_until_match', facts('scheduled'), false],
    ['a planned row (no match)', facts(null), false],
    ['a personal team (no match, no tournament)', facts(null, null), false],
    ['no facts (row not found)', undefined, false],
  ])('%s -> %s', (_label, input, expected) => {
    expect(isVisibleToAnonymous(input)).toBe(expected);
  });
});

describe('selectAnonymousVisibleLeads (public world aces)', () => {
  const lead = (id: string, f: TeamVisibilityFacts) => ({
    id,
    player_id: `p-${id}`,
    updated_at: '2026-09-01T00:00:00Z',
    lead_species: 'Garchomp',
    facts: f,
  });

  it('keeps the completed-match leads of a hidden_until_match league and drops the facts, in order', () => {
    const kept = selectAnonymousVisibleLeads([
      lead('played', facts('completed')),
      lead('upcoming', facts('scheduled')),
      lead('planned', facts(null)),
      lead('open', facts(null, 'always_public')),
    ]);

    expect(kept).toEqual([
      { id: 'played', player_id: 'p-played', updated_at: '2026-09-01T00:00:00Z', lead_species: 'Garchomp' },
      { id: 'open', player_id: 'p-open', updated_at: '2026-09-01T00:00:00Z', lead_species: 'Garchomp' },
    ]);
    expect(mockedFacts).not.toHaveBeenCalled();
  });
});

// ── Redacted roster isolation (code review CR-1 minor) ───────────────

describe('redacted rosters', () => {
  it('keeps the comparison constant deeply frozen', () => {
    expect(Object.isFrozen(REDACTED_POKEMON)).toBe(true);
    for (const set of REDACTED_POKEMON) {
      expect(Object.isFrozen(set)).toBe(true);
      expect(Object.isFrozen(set.evs)).toBe(true);
      expect(Object.isFrozen(set.ivs)).toBe(true);
      expect(Object.isFrozen(set.moves)).toBe(true);
    }
  });

  it('gives every hidden team its own copy, so one mutation never leaks into another response', () => {
    const a = toVisibleTeam(makeTeam({ id: 'a' }), false);
    const b = toVisibleTeam(makeTeam({ id: 'b' }), false);
    expect(a.pokemon).not.toBe(b.pokemon);
    a.pokemon[0].species = 'Pikachu';
    a.pokemon[0].moves.push('Thunderbolt');
    expect(b.pokemon).toEqual(REDACTED_POKEMON);
    expect(redactedPokemon()).toEqual(REDACTED_POKEMON);
    expect(REDACTED_POKEMON[0].species).toBe('hidden');
  });

  it('returns a fresh copy from the broadcast filter too', () => {
    const first = filterTeamPokemonForBroadcast(makeTeam(), { status: 'scheduled' }, 'hidden_until_match');
    const second = filterTeamPokemonForBroadcast(makeTeam(), { status: 'scheduled' }, 'hidden_until_match');
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });
});

// ── Match-prep rosters on the submit page (code review H3) ───────────

describe('selectVisibleMatchPrepRosters', () => {
  const mon = (species: string) => makeTeam().pokemon.map((p) => ({ ...p, species })).slice(0, 1);
  const rows = [
    { player_id: 'p1', pokemon: mon('Pikachu') },
    { player_id: 'p2', pokemon: mon('Garchomp') },
  ];
  const match = (status: 'scheduled' | 'in_progress' | 'completed') => ({
    id: 'm-1',
    status,
    player_1_id: 'p1',
    player_2_id: 'p2',
  });
  const p1: TeamViewer = { viewerId: 'p1', isAdmin: false };
  const p2: TeamViewer = { viewerId: 'p2', isAdmin: false };

  it('shows a participant only their own side before the match completes', () => {
    expect(selectVisibleMatchPrepRosters(rows, match('scheduled'), p1, 'hidden_until_match')).toEqual({
      player1: rows[0].pokemon,
      player2: [],
    });
    expect(selectVisibleMatchPrepRosters(rows, match('in_progress'), p2, 'hidden_until_match')).toEqual({
      player1: [],
      player2: rows[1].pokemon,
    });
  });

  it('never returns the redacted placeholder for a hidden side', () => {
    const result = selectVisibleMatchPrepRosters(rows, match('scheduled'), p1, 'hidden_until_match');
    expect(JSON.stringify(result)).not.toContain('Garchomp');
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('shows both sides when the tournament is always_public', () => {
    expect(selectVisibleMatchPrepRosters(rows, match('scheduled'), p1, 'always_public')).toEqual({
      player1: rows[0].pokemon,
      player2: rows[1].pokemon,
    });
  });

  it('shows both sides to an admin', () => {
    expect(
      selectVisibleMatchPrepRosters(rows, match('scheduled'), { viewerId: 'admin', isAdmin: true }, 'hidden_until_match')
    ).toEqual({ player1: rows[0].pokemon, player2: rows[1].pokemon });
  });

  it('shows both sides once the match is completed', () => {
    expect(selectVisibleMatchPrepRosters(rows, match('completed'), p1, 'hidden_until_match')).toEqual({
      player1: rows[0].pokemon,
      player2: rows[1].pokemon,
    });
  });

  it('treats an unknown tournament setting (null) like hidden_until_match', () => {
    expect(selectVisibleMatchPrepRosters(rows, match('scheduled'), p2, null)).toEqual({
      player1: [],
      player2: rows[1].pokemon,
    });
  });

  it('is undefined when no side is visible or no row exists', () => {
    expect(selectVisibleMatchPrepRosters([rows[1]], match('scheduled'), p1, 'hidden_until_match')).toBeUndefined();
    expect(selectVisibleMatchPrepRosters([], match('completed'), p1, 'always_public')).toBeUndefined();
  });

  it('ignores rows of players outside the match', () => {
    const stray = [{ player_id: 'p3', pokemon: mon('Mew') }];
    expect(selectVisibleMatchPrepRosters(stray, match('completed'), p1, 'always_public')).toBeUndefined();
  });
});

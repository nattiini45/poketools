/**
 * Public league team pages (non-EPB): spec §7 per team row (code review H3)
 * and no share-link data in the rendered page (C1).
 *
 * The pages run for real with the queries mocked; the real visibility module
 * decides. Sprites and the team display are stubbed to print species names,
 * so the HTML shows exactly which rosters reached the page.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PokemonSet, Team } from '@/types/team';
import type { TeamVisibilityFacts } from '@/lib/supabase/queries/teams';
import type { PhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getLeagueDisplayTeams } from '@/lib/team/phase-visibility';
import { PRIVATE_TEAM_SENTINELS, teamRowWithShareSecrets } from '@/lib/team/__tests__/private-team-fields';

const mocks = vi.hoisted(() => ({
  viewer: null as { playerId: string; isAdmin: boolean } | null,
  mode: 'legacy' as PhaseStorageMode,
  format: 'standard',
  getTeamVisibilityFacts: vi.fn(),
  getStagesBySeasonId: vi.fn(async () => [{ id: 'stage-1' }]),
  listTeamsByTournamentIds: vi.fn<(tournamentIds: string[]) => Promise<Team[]>>(),
  listSeasonPhaseRostersWithFacts: vi.fn(),
}));

vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: async () => mocks.mode }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  permanentRedirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/components/shared/PokemonSprite', () => ({
  default: ({ name }: { name: string }) => createElement('i', { 'data-species': name }, name),
}));
vi.mock('@/components/teambuilder/TeamDisplay', () => ({
  default: ({ pokemon }: { pokemon: PokemonSet[] }) =>
    createElement('ul', { 'data-roster': JSON.stringify(pokemon) }, pokemon.map((p, i) => createElement('li', { key: i }, p.species))),
}));
vi.mock('@/lib/auth/helpers', () => ({
  // The pages decide roles from the LIVE read; the token copy is stale and
  // claims admin, so any use of it would show in the demoted-admin tests.
  getLiveAccess: vi.fn(async () =>
    mocks.viewer
      ? {
          player: mocks.viewer,
          isSiteAdmin: mocks.viewer.isAdmin,
          isAnyAdmin: mocks.viewer.isAdmin,
          isCreator: mocks.viewer.isAdmin,
        }
      : null,
  ),
  getSessionPlayer: vi.fn(async () => (mocks.viewer ? { ...mocks.viewer, isAdmin: true } : null)),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(async () => ({ id: 'season-1', name: 'Spring League', format_type: mocks.format })),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: mocks.getStagesBySeasonId,
}));
vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayersByIds: vi.fn(
    async () =>
      new Map([
        ['alice', { name: 'Alice' }],
        ['bob', { name: 'Bob' }],
      ]),
  ),
  getPlayerById: vi.fn(async (id: string) => ({ id, name: id === 'alice' ? 'Alice' : 'Bob' })),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  listTeamsByTournamentIds: mocks.listTeamsByTournamentIds,
  getTeamVisibilityFacts: mocks.getTeamVisibilityFacts,
  getTeamByShareToken: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({
  listSeasonPhaseRostersWithFacts: mocks.listSeasonPhaseRostersWithFacts,
}));

import LeagueTeamsPage from '../page';
import PlayerTeamPage from '../[pid]/page';

function set(species: string) {
  return {
    name: '',
    species,
    gender: '',
    item: '',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: '',
    level: 100,
    moves: [],
  };
}

function row(id: string, playerId: string, species: string, overrides: Partial<Team> = {}): Team {
  return teamRowWithShareSecrets({
    id,
    player_id: playerId,
    tournament_id: 'stage-1',
    pokemon: [set(species)],
    ...overrides,
  });
}

const FACTS: Record<string, TeamVisibilityFacts> = {
  'alice-planned': { match_status: null, tournament_visibility: 'hidden_until_match' },
  'alice-m1': { match_status: 'completed', tournament_visibility: 'hidden_until_match' },
  'bob-planned': { match_status: null, tournament_visibility: 'hidden_until_match' },
  'bob-m2': { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer = null;
  mocks.mode = 'legacy';
  mocks.format = 'standard';
  mocks.listSeasonPhaseRostersWithFacts.mockReset();
  mocks.listTeamsByTournamentIds.mockResolvedValue([
    row('alice-planned', 'alice', 'Pelipper', { created_at: '2026-01-01T00:00:00Z' }),
    row('bob-planned', 'bob', 'Torkoal', { created_at: '2026-01-02T00:00:00Z' }),
    row('alice-m1', 'alice', 'Barraskewda', { match_id: 'm1', created_at: '2026-01-03T00:00:00Z' }),
    row('bob-m2', 'bob', 'Venusaur', { match_id: 'm2', created_at: '2026-01-04T00:00:00Z' }),
  ]);
  mocks.getTeamVisibilityFacts.mockImplementation(
    async (ids: string[]) => new Map(ids.flatMap((id) => (FACTS[id] ? [[id, FACTS[id]]] : []))),
  );
});

const LIST_PROPS = { params: Promise.resolve({ id: 'season-1' }) };

describe('league team list page', () => {
  it('anonymous: shows a roster only from a row linked to a completed match', async () => {
    const html = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));

    // Alice: her completed-match row is shown; her planned row is not.
    expect(html).toContain('Barraskewda');
    expect(html).not.toContain('Pelipper');
    // Bob: planned + scheduled-match rows only, so all hidden.
    expect(html).not.toContain('Torkoal');
    expect(html).not.toContain('Venusaur');
    expect(html).toContain('Hidden until a match played with this team is completed');
    expect(html).not.toContain(PRIVATE_TEAM_SENTINELS.share_token);
  });

  it('the owner sees their own planned roster; others stay hidden', async () => {
    mocks.viewer = { playerId: 'bob', isAdmin: false };
    const html = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));

    expect(html).toContain('Venusaur'); // newest own row
    expect(html).toContain('Barraskewda');
    expect(html).not.toContain('Pelipper');
  });

  it('a failed visibility read fails the render (no unredacted fallback)', async () => {
    mocks.getTeamVisibilityFacts.mockRejectedValue(new Error('facts down'));
    await expect(LeagueTeamsPage(LIST_PROPS)).rejects.toThrow('facts down');
  });
});

describe('league player team page', () => {
  const props = (pid: string) => ({ params: Promise.resolve({ id: 'season-1', pid }) });

  it('anonymous: a player whose rows are planned or pending is hidden', async () => {
    const html = renderToStaticMarkup(await PlayerTeamPage(props('bob')));

    expect(html).toContain('This team is hidden until a match played with it is completed.');
    expect(html).not.toContain('Torkoal');
    expect(html).not.toContain('Venusaur');
    expect(html).toContain('hidden');
  });

  it('anonymous: a player with a completed-match row shows that roster', async () => {
    const html = renderToStaticMarkup(await PlayerTeamPage(props('alice')));

    expect(html).toContain('Barraskewda');
    expect(html).not.toContain('Pelipper');
    expect(html).not.toContain('This team is hidden');
    expect(html).not.toContain(PRIVATE_TEAM_SENTINELS.share_token);
  });

  it('an admin sees the roster without a facts read', async () => {
    mocks.viewer = { playerId: 'admin', isAdmin: true };
    const html = renderToStaticMarkup(await PlayerTeamPage(props('bob')));

    expect(html).toContain('Venusaur');
    expect(mocks.getTeamVisibilityFacts).not.toHaveBeenCalled();
  });

  it('a demoted admin (live is_admin false, stale token says admin) sees hidden rosters hidden', async () => {
    mocks.viewer = { playerId: 'ex-admin', isAdmin: false };
    const html = renderToStaticMarkup(await PlayerTeamPage(props('bob')));

    expect(html).not.toContain('Venusaur');
    expect(html).not.toContain('Torkoal');
  });
});

describe('league team list page: live roles', () => {
  it('a demoted admin (live is_admin false, stale token says admin) gets no admin view', async () => {
    mocks.viewer = { playerId: 'ex-admin', isAdmin: false };
    const html = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));

    expect(html).not.toContain('Venusaur');
    expect(html).not.toContain('Torkoal');
    expect(html).not.toContain('Pelipper');
  });

  it('a live admin sees every roster', async () => {
    mocks.viewer = { playerId: 'admin', isAdmin: true };
    const html = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));

    expect(html).toContain('Venusaur');
    expect(mocks.getTeamVisibilityFacts).not.toHaveBeenCalled();
  });
});

describe.each(['phase', 'frozen_phase'] as const)('league team pages in %s mode', (mode) => {
  const props = (pid: string) => ({ params: Promise.resolve({ id: 'season-1', pid }) });
  const nativeRoster = (
    id: string, player_id: string, species: string, day: number, facts: TeamVisibilityFacts,
    { match_id = null, library_published_at = null }: Partial<Pick<Team, 'match_id' | 'library_published_at'>> = {},
  ) => ({
    id, player_id, pokemon: [{ ...set(species), moves: [`private-move-${id}`] }],
    created_at: `2026-01-0${day}T00:00:00Z`, match_id, library_published_at, facts,
  });

  beforeEach(() => {
    mocks.mode = mode;
    const rosters = [
      nativeRoster('bob-planned', 'bob', 'Torkoal', 1, FACTS['bob-planned']),
      nativeRoster('alice-old', 'alice', 'Kilowattrel', 2, FACTS['alice-m1'], { match_id: 'm0' }),
      nativeRoster('alice-complete', 'alice', 'Barraskewda', 3, FACTS['alice-m1'], { match_id: 'm1' }),
      nativeRoster('bob-scheduled', 'bob', 'Venusaur', 4, FACTS['bob-m2'], { match_id: 'm2' }),
      nativeRoster('alice-planned', 'alice', 'Pelipper', 5, FACTS['alice-planned']),
      nativeRoster('always-public', 'moth', 'Butterfree', 6, { match_status: null, tournament_visibility: 'always_public' }),
      nativeRoster('published', 'wisp', 'Lampent', 7, FACTS['bob-planned'], { library_published_at: '2026-02-01T00:00:00Z' }),
    ];
    mocks.listSeasonPhaseRostersWithFacts.mockImplementation(async (_seasonId: string, playerId?: string) => (
      playerId === undefined ? rosters : rosters.filter((team) => team.player_id === playerId)
    ));
  });

  it('renders the same newest visible row and keeps the earliest hidden row in player order', async () => {
    const list = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));
    const detail = renderToStaticMarkup(await PlayerTeamPage(props('alice')));
    for (const html of [list, detail]) {
      expect(html).toContain('Barraskewda');
      expect(html).not.toContain('Pelipper');
      expect(html).not.toContain('Kilowattrel');
      expect(html).not.toContain('private-move-alice-planned');
    }
    expect(list.indexOf('/teams/bob')).toBeLessThan(list.indexOf('/teams/alice'));
    expect(list).toContain('Butterfree');
    expect(list).toContain('Lampent');
    expect(list).not.toContain('Venusaur');
    expect(mocks.listSeasonPhaseRostersWithFacts.mock.calls).toEqual([['season-1', undefined], ['season-1', 'alice']]);
    expect(getPlayersByIds).toHaveBeenCalledExactlyOnceWith(['bob', 'alice', 'moth', 'wisp']);
    expect(mocks.getStagesBySeasonId).not.toHaveBeenCalled();
    expect(mocks.listTeamsByTournamentIds).not.toHaveBeenCalled();
    expect(mocks.getTeamVisibilityFacts).not.toHaveBeenCalled();
  });

  it('does not pass hidden sets to the client for anonymous and demoted viewers', async () => {
    for (const viewer of [null, { playerId: 'ex-admin', isAdmin: false }]) {
      mocks.viewer = viewer;
      const html = renderToStaticMarkup(await PlayerTeamPage(props('bob')));
      expect(html).toContain('This team is hidden until a match played with it is completed.');
      expect(html.match(/&quot;species&quot;:&quot;hidden&quot;/g)).toHaveLength(6);
      expect(html).not.toMatch(/Torkoal|Venusaur|private-move-|share_token|tournament_id/);
    }
  });

  it('picks the earliest team if none are visible and drops the hidden row’s metadata', async () => {
    const [team] = await getLeagueDisplayTeams('season-1', { viewerId: null, isAdmin: false }, 'bob');
    expect(team).toEqual({
      id: 'bob-planned',
      player_id: 'bob',
      visible: false,
      pokemon: Array(6).fill(expect.objectContaining({ species: 'hidden', moves: [] })),
    });
  });

  it('shows the newest own or site-admin-visible row on both pages', async () => {
    for (const viewer of [{ playerId: 'bob', isAdmin: false }, { playerId: 'admin', isAdmin: true }]) {
      mocks.viewer = viewer;
      const list = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));
      const detail = renderToStaticMarkup(await PlayerTeamPage(props('bob')));
      expect(list).toContain('Venusaur');
      expect(detail).toContain('private-move-bob-scheduled');
      expect(detail).not.toContain('Torkoal');
    }
  });

  it('does not fall back to legacy on an empty scope or a read error', async () => {
    await expect(PlayerTeamPage(props('other-season-player'))).rejects.toThrow('NOT_FOUND');
    mocks.listSeasonPhaseRostersWithFacts.mockResolvedValueOnce([]);
    const html = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));
    expect(html).not.toContain('/teams/alice');
    mocks.listSeasonPhaseRostersWithFacts.mockRejectedValueOnce(new Error('native roster read failed'));
    await expect(LeagueTeamsPage(LIST_PROPS)).rejects.toThrow('native roster read failed');
    expect(mocks.listTeamsByTournamentIds).not.toHaveBeenCalled();
  });
});

it.each(['legacy', 'frozen_legacy'] as const)('keeps the legacy team source in %s mode', async (mode) => {
  mocks.mode = mode;
  const list = renderToStaticMarkup(await LeagueTeamsPage(LIST_PROPS));
  const detail = renderToStaticMarkup(await PlayerTeamPage({ params: Promise.resolve({ id: 'season-1', pid: 'alice' }) }));
  expect(list).toContain('Barraskewda');
  expect(detail).toContain('Barraskewda');
  expect(mocks.getStagesBySeasonId.mock.calls).toEqual([['season-1'], ['season-1']]);
  expect(mocks.listTeamsByTournamentIds.mock.calls).toEqual([[['stage-1']], [['stage-1']]]);
  expect(mocks.listSeasonPhaseRostersWithFacts).not.toHaveBeenCalled();
});

it('keeps both EPB redirects ahead of team reads', async () => {
  mocks.mode = 'phase';
  mocks.format = 'evolution_point_buy';
  await expect(LeagueTeamsPage(LIST_PROPS)).rejects.toThrow('REDIRECT /leagues/season-1#teams');
  await expect(PlayerTeamPage({ params: Promise.resolve({ id: 'season-1', pid: 'alice' }) }))
    .rejects.toThrow('REDIRECT /leagues/season-1?team=alice#teams');
  expect(mocks.getStagesBySeasonId).not.toHaveBeenCalled();
  expect(mocks.listSeasonPhaseRostersWithFacts).not.toHaveBeenCalled();
});

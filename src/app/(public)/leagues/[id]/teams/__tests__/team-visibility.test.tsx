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
import type { Team } from '@/types/team';
import type { TeamVisibilityFacts } from '@/lib/supabase/queries/teams';
import { PRIVATE_TEAM_SENTINELS, teamRowWithShareSecrets } from '@/lib/team/__tests__/private-team-fields';

const mocks = vi.hoisted(() => ({
  viewer: null as { playerId: string; isAdmin: boolean } | null,
  teams: [] as unknown[],
  facts: new Map<string, unknown>(),
  getTeamVisibilityFacts: vi.fn(),
}));

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
  default: ({ pokemon }: { pokemon: { species: string }[] }) =>
    createElement('ul', null, pokemon.map((p, i) => createElement('li', { key: i }, p.species))),
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
  getSeasonById: vi.fn(async () => ({ id: 'season-1', name: 'Spring League', format_type: 'standard' })),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(async () => [{ id: 'stage-1' }]),
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
  listTeamsByTournamentIds: vi.fn(async () => mocks.teams),
  getTeamVisibilityFacts: mocks.getTeamVisibilityFacts,
  getTeamByShareToken: vi.fn(),
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
  mocks.teams = [
    row('alice-planned', 'alice', 'Pelipper', { created_at: '2026-01-01T00:00:00Z' }),
    row('bob-planned', 'bob', 'Torkoal', { created_at: '2026-01-02T00:00:00Z' }),
    row('alice-m1', 'alice', 'Barraskewda', { match_id: 'm1', created_at: '2026-01-03T00:00:00Z' }),
    row('bob-m2', 'bob', 'Venusaur', { match_id: 'm2', created_at: '2026-01-04T00:00:00Z' }),
  ];
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

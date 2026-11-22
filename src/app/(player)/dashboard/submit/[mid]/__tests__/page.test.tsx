/**
 * Submit-result page: spec §7 per side for the match-prep rosters that
 * pre-fill the manual stat form (code review H3). The page runs for real with
 * its reads mocked; the real visibility module decides, and the client form
 * is stubbed to record the rosters it receives.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PokemonSet } from '@/types/team';

const mocks = vi.hoisted(() => ({
  access: null as unknown,
  match: null as unknown,
  prepRows: [] as unknown[],
  prepError: null as Error | null,
  tournament: { data: null as unknown, error: null as unknown },
  clientProps: [] as Record<string, unknown>[],
  tournamentSelect: vi.fn(),
  isResourceAdminFor: vi.fn(async (_playerId: string, _type: string, _id: string) => false),
  resolveOwner: vi.fn(),
  nativeMatch: vi.fn(),
  nativePrep: vi.fn(),
  nativeContext: vi.fn(),
  nativeAdmin: vi.fn(),
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
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/components/shared/AuthGuard', () => ({
  default: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));
vi.mock('@/components/match/MatchStatusBadge', () => ({
  default: ({ status }: { status: string }) => createElement('span', null, status),
}));
vi.mock('@/lib/auth/helpers', () => ({
  getLiveAccess: vi.fn(async () => mocks.access),
  getSessionPlayer: vi.fn(async () => {
    throw new Error('the submit page must decide roles from the live read');
  }),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(async () => mocks.match),
}));
vi.mock('@/lib/league-phase/match-route-owner', () => ({ resolveIdOnlyMatchRoute: mocks.resolveOwner }));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: mocks.nativeAdmin }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mocks.nativeMatch }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPhaseMatchPrepTeams: mocks.nativePrep }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseSubmitContext: mocks.nativeContext }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: (playerId: string, type: string, id: string) => mocks.isResourceAdminFor(playerId, type, id),
}));
vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({
  getMatchPrepTeams: vi.fn(async () => {
    if (mocks.prepError) throw mocks.prepError;
    return mocks.prepRows;
  }),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'tournaments') throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string) => {
          mocks.tournamentSelect(columns);
          return {
            eq: () => ({ maybeSingle: async () => mocks.tournament }),
          };
        },
      };
    },
  },
}));
vi.mock('../SubmitResultClient', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.clientProps.push(props);
    return createElement('form', { 'data-testid': 'submit-client' });
  },
}));

import SubmitResultPage from '../page';

function set(species: string): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item: 'Leftovers',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: '',
    level: 100,
    moves: ['Protect'],
  };
}

function viewer(playerId: string, isSiteAdmin = false, isResourceAdmin = false) {
  return {
    player: { playerId, isAdmin: isSiteAdmin, isResourceAdmin },
    isSiteAdmin,
    isAnyAdmin: isSiteAdmin || isResourceAdmin,
    isCreator: isSiteAdmin,
  };
}

function matchWith(status: string) {
  return {
    id: 'm-1',
    tournament_id: 't-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    status,
  };
}

const PROPS = { params: Promise.resolve({ mid: 'm-1' }) };

async function render() {
  return renderToStaticMarkup(await SubmitResultPage(PROPS));
}

function prepTeamsProp() {
  expect(mocks.clientProps).toHaveLength(1);
  return mocks.clientProps[0].prepTeams;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientProps = [];
  mocks.access = viewer('p1');
  mocks.match = matchWith('scheduled');
  mocks.prepRows = [
    { id: 'r1', match_id: 'm-1', player_id: 'p1', pokemon: [set('Pikachu')] },
    { id: 'r2', match_id: 'm-1', player_id: 'p2', pokemon: [set('Garchomp')] },
  ];
  mocks.prepError = null;
  mocks.resolveOwner.mockResolvedValue({ kind: 'legacy' });
  mocks.nativeAdmin.mockResolvedValue(false);
  mocks.tournament = {
    data: { team_visibility: 'hidden_until_match', ruleset: { gen: 8 } },
    error: null,
  };
});

describe('native phase result submission page', () => {
  beforeEach(() => {
    const { tournament_id: _legacyId, ...match } = matchWith('scheduled');
    mocks.resolveOwner.mockResolvedValue({ kind: 'phase', phase_id: 'p-1', season_id: 's-1' });
    mocks.nativeMatch.mockResolvedValue({ ...match, phase_id: 'p-1' });
    mocks.nativePrep.mockResolvedValue(mocks.prepRows);
    mocks.nativeContext.mockResolvedValue({ teamVisibility: 'hidden_until_match', generation: 7 });
  });

  it('loads only native phase data, keeps the other roster hidden and returns to the canonical match', async () => {
    await render();
    expect(prepTeamsProp()).toEqual({ player1: [set('Pikachu')], player2: [] });
    expect(mocks.clientProps[0]).toMatchObject({
      matchId: 'm-1', generation: 7, redirectTo: '/leagues/s-1/phases/p-1/matches/m-1', isAdmin: false,
    });
    expect(mocks.nativeContext).toHaveBeenCalledWith('p-1', 's-1');
    expect(mocks.tournamentSelect).not.toHaveBeenCalled();
  });

  it('lets a live phase-only admin see both sides and use manual replay assignment', async () => {
    mocks.access = viewer('organizer');
    mocks.nativeAdmin.mockResolvedValue(true);
    await render();
    expect(prepTeamsProp()).toEqual({ player1: [set('Pikachu')], player2: [set('Garchomp')] });
    expect(mocks.clientProps[0].isAdmin).toBe(true);
  });

  it('refuses an outsider before reading either team or ruleset', async () => {
    mocks.access = viewer('outsider');
    await expect(render()).rejects.toThrow('REDIRECT /dashboard');
    expect(mocks.nativePrep).not.toHaveBeenCalled();
    expect(mocks.nativeContext).not.toHaveBeenCalled();
  });

  it('refuses a match that no longer belongs to the verified phase', async () => {
    mocks.nativeMatch.mockResolvedValue({ phase_id: 'another-phase' });
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(mocks.nativePrep).not.toHaveBeenCalled();
    expect(mocks.tournamentSelect).not.toHaveBeenCalled();
  });
});

describe('submit page roster visibility (spec §7)', () => {
  it('a participant sees only their own side before the match completes', async () => {
    await render();
    expect(prepTeamsProp()).toEqual({ player1: [set('Pikachu')], player2: [] });
    expect(JSON.stringify(mocks.clientProps)).not.toContain('Garchomp');
  });

  it('the other participant sees only their side', async () => {
    mocks.access = viewer('p2');
    mocks.match = matchWith('in_progress');
    await render();
    expect(prepTeamsProp()).toEqual({ player1: [], player2: [set('Garchomp')] });
  });

  it('an always_public tournament shows both sides', async () => {
    mocks.tournament = { data: { team_visibility: 'always_public', ruleset: null }, error: null };
    await render();
    expect(prepTeamsProp()).toEqual({ player1: [set('Pikachu')], player2: [set('Garchomp')] });
  });

  it('a site admin sees both sides (live role)', async () => {
    mocks.access = viewer('admin', true);
    const html = await render();
    expect(prepTeamsProp()).toEqual({ player1: [set('Pikachu')], player2: [set('Garchomp')] });
    expect(mocks.clientProps[0].isAdmin).toBe(true);
    expect(html).toContain('submit-client');
  });

  it('a resource admin of the match league who does not play gets the admin view and both rosters', async () => {
    mocks.access = viewer('organizer', false, true);
    mocks.isResourceAdminFor.mockResolvedValue(true);
    const html = await render();
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('organizer', 'tournament', 't-1');
    expect(prepTeamsProp()).toEqual({ player1: [set('Pikachu')], player2: [set('Garchomp')] });
    expect(mocks.clientProps[0].isAdmin).toBe(true);
    expect(html).toContain('submit-client');
    expect(html).toContain('on behalf of the players');
  });

  it('a resource admin of another league is sent back to the dashboard', async () => {
    mocks.access = viewer('other-organizer', false, true);
    mocks.isResourceAdminFor.mockResolvedValue(false);
    await expect(render()).rejects.toThrow('REDIRECT /dashboard');
    expect(mocks.clientProps).toHaveLength(0);
  });

  it('a participant who is also a resource admin is treated as a participant (no on-behalf note)', async () => {
    mocks.access = viewer('p1', false, true);
    mocks.isResourceAdminFor.mockResolvedValue(true);
    const html = await render();
    expect(html).not.toContain('on behalf of the players');
    expect(mocks.clientProps).toHaveLength(1);
  });

  it('a plain player (no admin role at all) costs no role lookup', async () => {
    mocks.access = viewer('stranger');
    await expect(render()).rejects.toThrow('REDIRECT /dashboard');
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('a demoted admin (live is_admin false) gets no admin view', async () => {
    mocks.access = viewer('ex-admin', false);
    await expect(render()).rejects.toThrow('REDIRECT /dashboard');
    expect(mocks.clientProps).toHaveLength(0);
  });

  it('a completed match offers no form, so no roster reaches the client', async () => {
    mocks.match = matchWith('completed');
    const html = await render();
    expect(mocks.clientProps).toHaveLength(0);
    expect(html).not.toContain('Garchomp');
  });

  it('reads the tournament visibility and the ruleset in one select', async () => {
    await render();
    expect(mocks.tournamentSelect).toHaveBeenCalledWith('team_visibility, ruleset:ruleset_definition_versions ( gen )');
    expect(mocks.clientProps[0].generation).toBe(8);
  });

  it('defaults to generation 9 when the phase has no ruleset version', async () => {
    mocks.tournament = {
      data: { team_visibility: 'hidden_until_match', ruleset: null },
      error: null,
    };
    await render();
    expect(mocks.clientProps[0].generation).toBe(9);
  });

  it('passes no rosters when no side is visible', async () => {
    mocks.prepRows = [{ id: 'r2', match_id: 'm-1', player_id: 'p2', pokemon: [set('Garchomp')] }];
    await render();
    expect(prepTeamsProp()).toBeUndefined();
  });
});

describe('submit page error paths (no masking)', () => {
  it('fails the page when the match-prep read fails', async () => {
    mocks.prepError = new Error('prep read failed');
    await expect(render()).rejects.toThrow('prep read failed');
    expect(mocks.clientProps).toHaveLength(0);
  });

  it('fails the page when the tournament read fails', async () => {
    mocks.tournament = { data: null, error: new Error('tournament read failed') };
    await expect(render()).rejects.toThrow('tournament read failed');
    expect(mocks.clientProps).toHaveLength(0);
  });

  it('redirects a signed-out visitor home', async () => {
    mocks.access = null;
    await expect(render()).rejects.toThrow('REDIRECT /');
  });

  it('redirects a signed-in identity without a player to the dashboard (#142)', async () => {
    mocks.access = { player: null, isSiteAdmin: false, isAnyAdmin: false, isCreator: false };
    await expect(render()).rejects.toThrow('REDIRECT /dashboard');
  });

  it('is a 404 for an unknown match', async () => {
    mocks.match = null;
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });
});

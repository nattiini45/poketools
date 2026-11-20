/**
 * Dashboard team page in phase mode: the id's owner decides the store. A native phase team renders its own roster
 * (the transfer keeps ids, so the URL a player bookmarked keeps working), and a legacy row keeps exactly today's page.
 * The page runs for real with its reads mocked; the client editor records what it receives.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const TEAM_ID = '7c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';
const PHASE_ID = '8d2e3f40-5b6c-4d7e-9f80-a1b2c3d4e5f6';
const SEASON_ID = '9e3f4051-6c7d-4e8f-a091-b2c3d4e5f607';
const MATCH_ID = 'af405162-7d8e-4f90-b1a2-c3d4e5f60718';
const OWNER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_ID = '2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e';

const mocks = vi.hoisted(() => ({
  mode: 'phase' as string,
  access: null as unknown,
  team: null as unknown,
  phaseTeam: null as unknown,
  phase: null as unknown,
  match: null as unknown,
  getTeamById: vi.fn(),
  getTeamVisibilityFacts: vi.fn(async (_ids: string[]) => new Map()),
  getPhaseTeamById: vi.fn(),
  getPhaseById: vi.fn(),
  getPhaseMatchById: vi.fn(),
  clientProps: [] as Record<string, unknown>[],
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
vi.mock('@/components/teambuilder/TeambuilderClient', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.clientProps.push(props);
    return createElement('div', { 'data-testid': 'editor' });
  },
}));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: vi.fn(async () => mocks.mode) }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({
  getPhaseTeamById: (id: string) => {
    mocks.getPhaseTeamById(id);
    return Promise.resolve(mocks.phaseTeam);
  },
  getPhaseTeamVisibilityFacts: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: () => mocks.getPhaseById() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: () => mocks.getPhaseMatchById() }));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamById: (id: string) => {
    mocks.getTeamById(id);
    return Promise.resolve(mocks.team);
  },
  getTeamVisibilityFacts: (ids: string[]) => mocks.getTeamVisibilityFacts(ids) as never,
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(async () => ({ id: 'ruleset-1', name: 'League rules', base_format: 'gen9ou', gen: 9 })),
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(async () => null),
  getDraftPoolBySeasonGroup: vi.fn(async () => null),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn(async () => null) }));
vi.mock('server-only', () => ({}));

import DashboardTeamPage from '../page';

const access = (playerId: string, isSiteAdmin = false) => ({
  player: { playerId, name: 'P', isAdmin: false, isResourceAdmin: false, isCreator: false, status: 'active' },
  isSiteAdmin,
  isAnyAdmin: isSiteAdmin,
  isCreator: isSiteAdmin,
});

async function render(tid = TEAM_ID): Promise<string> {
  return renderToStaticMarkup(await DashboardTeamPage({ params: Promise.resolve({ tid }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientProps = [];
  mocks.mode = 'phase';
  mocks.access = access(OWNER_ID);
  mocks.team = null;
  mocks.getPhaseById.mockImplementation(async () => mocks.phase);
  mocks.getPhaseMatchById.mockImplementation(async () => mocks.match);
  mocks.phase = { id: PHASE_ID, season_id: SEASON_ID, ruleset_id: 'ruleset-1', status: 'active', archived: false };
  mocks.match = { id: MATCH_ID, phase_id: PHASE_ID, status: 'scheduled' };
  mocks.phaseTeam = {
    id: TEAM_ID,
    player_id: OWNER_ID,
    phase_id: PHASE_ID,
    season_id: SEASON_ID,
    name: 'League rain',
    match_id: null,
    pokemon: [{ species: 'Pelipper' }],
    locked: false,
  };
});

describe('dashboard team page: a native phase team', () => {
  it('renders the phase roster against the phase\'s pinned ruleset, with no tournament id', async () => {
    expect(await render()).toContain('data-testid="editor"');
    expect(mocks.clientProps[0]).toMatchObject({
      teamId: TEAM_ID,
      phaseId: PHASE_ID,
      tournamentId: null,
      seasonId: SEASON_ID,
      initialPokemon: [{ species: 'Pelipper' }],
      rulesetId: 'ruleset-1',
      baseFormat: 'gen9ou',
      gen: 9,
      locked: false,
      matchId: null,
    });
    expect(mocks.getTeamById).not.toHaveBeenCalled();
  });

  it('redirects a non-owner who is no site admin, without reading the phase', async () => {
    mocks.access = access(OTHER_ID);
    await expect(render()).rejects.toThrow('REDIRECT /dashboard');
    expect(mocks.getPhaseById).not.toHaveBeenCalled();
    expect(mocks.clientProps).toHaveLength(0);
  });

  it('opens locked for the owner of a roster registered for a completed match, and editable for a site admin', async () => {
    mocks.phaseTeam = { ...(mocks.phaseTeam as object), match_id: MATCH_ID };
    mocks.match = { id: MATCH_ID, phase_id: PHASE_ID, status: 'completed' };
    await render();
    // The row's match rides along, so the live check is judged by that match's round.
    expect(mocks.clientProps[0]).toMatchObject({ locked: true, lockReason: 'completed_match', matchId: MATCH_ID });

    mocks.access = access(OTHER_ID, true);
    mocks.getPhaseMatchById.mockClear();
    await render();
    expect(mocks.clientProps[1]).toMatchObject({ locked: false });
    expect(mocks.getPhaseMatchById).not.toHaveBeenCalled();
  });

  it('answers notFound when the row\'s phase is gone', async () => {
    mocks.phase = null;
    await expect(render()).rejects.toThrow('NOT_FOUND');
    expect(mocks.clientProps).toHaveLength(0);
  });
});

describe('dashboard team page: the store the id names', () => {
  it('keeps the legacy page for an id no native row holds', async () => {
    mocks.phaseTeam = null;
    mocks.team = { id: TEAM_ID, player_id: OWNER_ID, tournament_id: null, name: 'Rain', pokemon: [{ species: 'Pelipper' }], locked: false };
    await render();
    expect(mocks.clientProps[0]).toMatchObject({ teamId: TEAM_ID, tournamentId: null });
    expect(mocks.clientProps[0].phaseId).toBeUndefined();
    expect(mocks.getPhaseById).not.toHaveBeenCalled();
  });

  it('reads no phase storage in legacy mode', async () => {
    mocks.mode = 'legacy';
    mocks.team = { id: TEAM_ID, player_id: OWNER_ID, tournament_id: null, name: 'Rain', pokemon: [], locked: false };
    await render();
    expect(mocks.getPhaseTeamById).not.toHaveBeenCalled();
    expect(mocks.getTeamById).toHaveBeenCalledWith(TEAM_ID);
  });

  it('refuses to render from either store while the storage is frozen mid-transfer', async () => {
    mocks.mode = 'frozen_phase';
    await expect(render()).rejects.toMatchObject({ code: 'phase_storage_unavailable' });
    expect(mocks.getTeamById).not.toHaveBeenCalled();
  });
});

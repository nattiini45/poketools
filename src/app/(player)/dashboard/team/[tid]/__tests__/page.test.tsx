/**
 * Dashboard team page: the owner-or-admin gate reads the LIVE player and roles
 * (`getLiveAccess`), never the token copy, because the page renders the full
 * roster (AGENTS.md view-gate rule; L-TEAMS gate). The page runs for real with
 * its reads mocked; the client editor is stubbed to record what it receives.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const TEAM_ID = '7c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';
const OWNER_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_ID = '2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e';

const mocks = vi.hoisted(() => ({
  access: null as unknown,
  team: null as unknown,
  getTeamById: vi.fn(),
  getTeamVisibilityFacts: vi.fn(),
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
vi.mock('@/lib/auth/helpers', () => ({
  getLiveAccess: vi.fn(async () => mocks.access),
  getSessionPlayer: vi.fn(async () => {
    throw new Error('the team page must gate on the live read');
  }),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamById: (id: string) => {
    mocks.getTeamById(id);
    return Promise.resolve(mocks.team);
  },
  getTeamVisibilityFacts: (ids: string[]) => mocks.getTeamVisibilityFacts(ids),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(async () => null),
  getDraftPoolBySeasonGroup: vi.fn(async () => null),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn(async () => null) }));

import DashboardTeamPage from '../page';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import {
  getDraftPoolBySeason,
  getDraftPoolBySeasonGroup,
  GroupedLeaguePoolLookupError,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer } from '@/lib/supabase/queries/season-groups';

function player(playerId: string) {
  return { playerId, name: 'P', isAdmin: false, isResourceAdmin: false, isCreator: false, status: 'active' };
}

function access(playerId: string, isSiteAdmin = false) {
  return { player: player(playerId), isSiteAdmin, isAnyAdmin: isSiteAdmin, isCreator: isSiteAdmin };
}

async function render(tid = TEAM_ID): Promise<string> {
  const element = await DashboardTeamPage({ params: Promise.resolve({ tid }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  mocks.clientProps.length = 0;
  mocks.getTeamById.mockClear();
  mocks.getTeamVisibilityFacts.mockReset();
  mocks.team = {
    id: TEAM_ID,
    player_id: OWNER_ID,
    tournament_id: null,
    name: 'Rain',
    pokemon: [{ species: 'Pelipper' }],
    locked: false,
  };
});

describe('dashboard team page gate', () => {
  it('redirects a signed-out visitor home', async () => {
    mocks.access = null;
    await expect(render()).rejects.toThrow('REDIRECT /');
  });

  it('renders the roster for the owner', async () => {
    mocks.access = access(OWNER_ID);
    expect(await render()).toContain('data-testid="editor"');
    expect(mocks.clientProps[0]).toMatchObject({ teamId: TEAM_ID, initialPokemon: [{ species: 'Pelipper' }] });
  });

  it('renders it for a live site admin', async () => {
    mocks.access = access(OTHER_ID, true);
    expect(await render()).toContain('data-testid="editor"');
  });

  it('redirects a non-owner whose live access is not site admin (the gate reads isSiteAdmin, not a player flag)', async () => {
    mocks.access = { ...access(OTHER_ID, false), player: { ...player(OTHER_ID), isAdmin: true } };
    await expect(render()).rejects.toThrow('REDIRECT /dashboard');
    expect(mocks.clientProps).toHaveLength(0);
  });

  it('answers notFound for a malformed id without the team read', async () => {
    mocks.access = access(OWNER_ID);
    await expect(render("x' OR 1=1")).rejects.toThrow('NOT_FOUND');
    expect(mocks.getTeamById).not.toHaveBeenCalled();
  });
});

describe('dashboard team page: the draft pool of a league with groups', () => {
  const SEASON = '3c4d5e6f-7081-4c9d-8e0f-2a3b4c5d6e7f';

  it('a site admin viewing a trainer’s team gets the OWNER’s group pool (not the admin’s)', async () => {
    mocks.access = access(OTHER_ID, true);
    mocks.team = { ...(mocks.team as object), tournament_id: 'tour-1' };
    vi.mocked(getTournamentById).mockResolvedValueOnce({ id: 'tour-1', season_id: SEASON, ruleset_id: 'rs' } as never);
    vi.mocked(getDraftPoolBySeason).mockRejectedValueOnce(new GroupedLeaguePoolLookupError(SEASON));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValueOnce({ id: 'group-a', season_id: SEASON, name: 'Group A', sort_order: 1 });
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValueOnce({ id: 'pool-a' } as never);
    await render();
    expect(getSeasonGroupOfPlayer).toHaveBeenCalledWith(SEASON, OWNER_ID);
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON, 'group-a', 'initial');
    expect(mocks.clientProps[0]).toMatchObject({ isDraftLeague: true, seasonId: SEASON });
  });
});

describe('dashboard team page: a team of a COMPLETED match (lead ruling round 5)', () => {
  function linkedTo(status: string): void {
    mocks.team = { ...(mocks.team as object), match_id: 'match-1' };
    mocks.getTeamVisibilityFacts.mockResolvedValue(
      new Map([[TEAM_ID, { match_status: status, tournament_visibility: 'hidden_until_match' }]]),
    );
  }

  it('opens locked for the owner, with the completed-match reason', async () => {
    mocks.access = access(OWNER_ID);
    linkedTo('completed');
    await render();
    expect(mocks.getTeamVisibilityFacts).toHaveBeenCalledWith([TEAM_ID]);
    expect(mocks.clientProps[0]).toMatchObject({ locked: true, lockReason: 'completed_match' });
  });

  it('stays editable for the owner while the match is not completed', async () => {
    mocks.access = access(OWNER_ID);
    linkedTo('pending_confirmation');
    await render();
    expect(mocks.clientProps[0]).toMatchObject({ locked: false, lockReason: 'tournament' });
  });

  it('stays editable for a live site admin (corrections), without the status read', async () => {
    mocks.access = access(OTHER_ID, true);
    linkedTo('completed');
    await render();
    expect(mocks.getTeamVisibilityFacts).not.toHaveBeenCalled();
    expect(mocks.clientProps[0]).toMatchObject({ locked: false });
  });

  it('a planned team needs no status read', async () => {
    mocks.access = access(OWNER_ID);
    await render();
    expect(mocks.getTeamVisibilityFacts).not.toHaveBeenCalled();
    expect(mocks.clientProps[0]).toMatchObject({ locked: false });
  });
});

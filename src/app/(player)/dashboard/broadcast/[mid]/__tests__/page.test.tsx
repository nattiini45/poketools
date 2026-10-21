/**
 * Battle tracker page: roles come from the LIVE read (AGENTS.md view gates),
 * spec §7 per side for the planned rosters, and a failed caster wiring is
 * logged, never swallowed (code review CR-1 minors). The tracker client is
 * stubbed to record what reaches it.
 */
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  access: null as unknown,
  trackerProps: [] as Record<string, unknown>[],
  fetchCasterData: vi.fn(),
  listCastSessions: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('@/components/shared/AuthGuard', () => ({
  default: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));
vi.mock('@/components/broadcast/tracker/BattleTracker', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.trackerProps.push(props);
    return createElement('section', { 'data-testid': 'tracker' });
  },
}));
vi.mock('@/lib/auth/helpers', () => ({
  getLiveAccess: vi.fn(async () => mocks.access),
  // The token copy is stale and claims creator + admin: using it would show.
  getSession: vi.fn(async () => ({ player: { playerId: 'stale', isAdmin: true, isCreator: true } })),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(async () => ({
    id: 'm-1',
    tournament_id: 't-1',
    round_id: 'r-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    status: 'scheduled',
    games: [],
  })),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(async () => ({
    id: 't-1',
    best_of_default: 3,
    team_visibility: 'hidden_until_match',
    ruleset_id: null,
    season_id: null,
  })),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForMatch: vi.fn(async (playerId: string) => ({
    id: `team-${playerId}`,
    player_id: playerId,
    match_id: null,
    library_published_at: null,
    pokemon: [{ species: playerId === 'p1' ? 'Pikachu' : 'Garchomp' }],
  })),
}));
vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  listCastSessions: mocks.listCastSessions,
  createCastSession: vi.fn(),
  updateCastSession: vi.fn(),
}));
vi.mock('@/lib/broadcast/caster-data', () => ({
  fetchCasterData: mocks.fetchCasterData,
}));

import TrackerPage from '../page';

const PROPS = { params: Promise.resolve({ mid: 'm-1' }) };

function access(playerId: string, flags: { admin?: boolean; creator?: boolean } = {}) {
  const admin = flags.admin ?? false;
  return {
    player: { playerId, isAdmin: admin, isCreator: flags.creator ?? false },
    isSiteAdmin: admin,
    isAnyAdmin: admin,
    isCreator: admin || (flags.creator ?? false),
  };
}

async function render() {
  return renderToStaticMarkup(await TrackerPage(PROPS));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.trackerProps = [];
  mocks.fetchCasterData.mockResolvedValue(null);
  mocks.listCastSessions.mockResolvedValue([{ id: 'cs-1', match_id: 'm-1', status: 'live' }]);
});

describe('tracker page live roles and roster visibility', () => {
  it('refuses a non-participant whose live row is neither creator nor admin', async () => {
    mocks.access = access('ex-admin');
    await render();
    expect(mocks.trackerProps).toHaveLength(0);
  });

  it('a participant sees only their own planned roster before the match', async () => {
    mocks.access = access('p1');
    await render();
    const [props] = mocks.trackerProps;
    expect((props.player1 as { pokemon?: string[] }).pokemon).toEqual(['Pikachu']);
    expect((props.player2 as { pokemon?: string[] }).pokemon).toBeUndefined();
    expect(mocks.fetchCasterData).not.toHaveBeenCalled();
  });

  it('a live creator sees no planned roster and passes a non-admin viewer to caster data', async () => {
    mocks.access = access('creator-1', { creator: true });
    await render();
    const [props] = mocks.trackerProps;
    expect((props.player1 as { pokemon?: string[] }).pokemon).toBeUndefined();
    expect((props.player2 as { pokemon?: string[] }).pokemon).toBeUndefined();
    expect(mocks.fetchCasterData).toHaveBeenCalledWith('m-1', { viewerId: 'creator-1', isAdmin: false });
    expect(props.sessionId).toBe('cs-1');
  });

  it('a live admin sees both rosters', async () => {
    mocks.access = access('admin-1', { admin: true });
    await render();
    const [props] = mocks.trackerProps;
    expect((props.player1 as { pokemon?: string[] }).pokemon).toEqual(['Pikachu']);
    expect((props.player2 as { pokemon?: string[] }).pokemon).toEqual(['Garchomp']);
    expect(mocks.fetchCasterData).toHaveBeenCalledWith('m-1', { viewerId: 'admin-1', isAdmin: true });
  });

  it('signed out: no tracker', async () => {
    mocks.access = null;
    await render();
    expect(mocks.trackerProps).toHaveLength(0);
  });

  it('logs a failed caster wiring with the original error and still renders the tracker', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('caster data down');
    mocks.fetchCasterData.mockRejectedValue(failure);
    mocks.access = access('creator-1', { creator: true });

    await render();

    expect(consoleError).toHaveBeenCalledWith(
      '[dashboard/broadcast] caster data / cast session wiring failed:',
      failure,
    );
    expect(mocks.trackerProps).toHaveLength(1);
    expect(mocks.trackerProps[0].casterData).toBeNull();
    consoleError.mockRestore();
  });
});

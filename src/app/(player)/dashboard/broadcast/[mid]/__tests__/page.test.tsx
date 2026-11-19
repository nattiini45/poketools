/**
 * Battle tracker page: roles come from the LIVE read (AGENTS.md view gates),
 * spec §7 per side for the planned rosters, and a failed caster wiring is
 * logged, never swallowed (code review CR-1 minors). The tracker client is
 * stubbed to record what reaches it.
 */
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  access: null as unknown,
  trackerProps: [] as Record<string, unknown>[],
  fetchCasterData: vi.fn(),
  listCastSessions: vi.fn(),
  mode: vi.fn(),
  nativeOwner: vi.fn(),
  nativeMatch: vi.fn(),
  phase: vi.fn(),
  phaseRound: vi.fn(),
  nativeTeam: vi.fn(),
  standalone: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: mocks.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: mocks.nativeOwner,
  standaloneMatchAliasExists: mocks.standalone,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mocks.nativeMatch }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: mocks.phase }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: mocks.phaseRound }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseTeamForMatch: mocks.nativeTeam }));

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
import { getMatchById } from '@/lib/supabase/queries/matches';
import { createCastSession } from '@/lib/supabase/queries/cast-sessions';

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
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
  mocks.trackerProps = [];
  mocks.fetchCasterData.mockResolvedValue(null);
  mocks.listCastSessions.mockResolvedValue([{ id: 'cs-1', match_id: 'm-1', status: 'live' }]);
});
afterEach(() => vi.unstubAllEnvs());

const MATCH = '10000000-0000-4000-8000-000000000001';
const PHASE = '10000000-0000-4000-8000-000000000002';
const LEAGUE = '10000000-0000-4000-8000-000000000003';
const NATIVE_PROPS = { params: Promise.resolve({ mid: MATCH }) };

describe('native dashboard tracker', () => {
  beforeEach(() => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    mocks.mode.mockResolvedValue('phase');
    mocks.standalone.mockResolvedValue(false);
    mocks.nativeOwner.mockResolvedValue({ kind: 'phase', phase_id: PHASE, season_id: LEAGUE });
    mocks.phase.mockResolvedValue({ id: PHASE, season_id: LEAGUE, team_visibility: 'hidden_until_match' });
    mocks.phaseRound.mockResolvedValue({ id: 'fixture-round', phase_id: PHASE, best_of: 5 });
    mocks.nativeMatch.mockResolvedValue({
      id: MATCH, phase_id: PHASE, round_id: 'fixture-round',
      player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Fixture Aster', player_2_name: 'Fixture Birch',
      player_1_avatar_url: null, player_2_avatar_url: null, status: 'scheduled',
      notes: 'secret match note', games: [{ id: 'game', game_number: 1, private_context: 'secret internal field' }],
    });
    mocks.nativeTeam.mockImplementation(async (playerId: string) => ({
      player_id: playerId, match_id: MATCH, library_published_at: null,
      pokemon: [{ species: playerId === 'p1' ? 'Visible fixture' : 'Private fixture', item: 'secret item' }],
    }));
  });

  it('opens a native-only match for its participant with own species and round best-of, never private fields', async () => {
    mocks.access = access('p1');
    renderToStaticMarkup(await TrackerPage(NATIVE_PROPS));
    expect(mocks.trackerProps[0]).toMatchObject({
      matchId: MATCH, bestOf: 5, player1: { pokemon: ['Visible fixture'] },
      player2: { pokemon: undefined }, gamesSubmitted: [{ id: 'game' }],
    });
    const serialized = JSON.stringify(mocks.trackerProps);
    expect(serialized).not.toMatch(/Private fixture|secret item|secret match note|secret internal field|realtime_key/);
    expect(mocks.trackerProps[0]).not.toHaveProperty('openPhaseSession');
    expect(mocks.fetchCasterData).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it('passes only live viewer authority to native caster data and requests an owner-local session from the client', async () => {
    mocks.access = access('fixture-caster', { creator: true });
    renderToStaticMarkup(await TrackerPage(NATIVE_PROPS));
    expect(mocks.trackerProps[0]).toMatchObject({
      openPhaseSession: true, player1: { pokemon: undefined }, player2: { pokemon: undefined },
    });
    expect(mocks.fetchCasterData).toHaveBeenCalledExactlyOnceWith(MATCH, { viewerId: 'fixture-caster', isAdmin: false });
    expect(mocks.listCastSessions).not.toHaveBeenCalled();
    expect(createCastSession).not.toHaveBeenCalled();
  });

  it('does not expose roster data to a nonparticipant resource admin without creator access', async () => {
    mocks.access = { ...access('resource-admin'), isAnyAdmin: true };
    renderToStaticMarkup(await TrackerPage(NATIVE_PROPS));
    expect(mocks.trackerProps).toHaveLength(0);
    expect(mocks.nativeTeam).not.toHaveBeenCalled();
  });

  it('fails closed for a different round/phase or a retired match', async () => {
    mocks.access = access('p1');
    mocks.phaseRound.mockResolvedValueOnce({ id: 'fixture-round', phase_id: 'wrong-phase', best_of: 5 });
    renderToStaticMarkup(await TrackerPage(NATIVE_PROPS));
    mocks.nativeOwner.mockResolvedValueOnce(null);
    renderToStaticMarkup(await TrackerPage(NATIVE_PROPS));
    expect(mocks.trackerProps).toHaveLength(0);
    expect(mocks.nativeTeam).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it.each(['frozen_phase', 'frozen_legacy'])('refuses %s before looking up the match', async (mode) => {
    mocks.access = access('p1');
    mocks.mode.mockResolvedValue(mode);
    await expect(TrackerPage(NATIVE_PROPS)).rejects.toMatchObject({ code: 'phase_storage_unavailable' });
    expect(mocks.nativeOwner).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });
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

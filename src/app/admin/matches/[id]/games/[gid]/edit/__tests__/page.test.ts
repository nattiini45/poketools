/**
 * `/admin/matches/[id]/games/[gid]/edit` renders one game's edit form under
 * the match named by `[id]`. The per-match gate (`canAdministerMatch`) checks
 * the URL's match, while `PATCH /api/admin/games/[id]` authorizes against the
 * game's OWN match. So the page must 404 when the game does not belong to the
 * URL's match, before the gate; otherwise an admin of match A's tournament
 * could view a game of another tournament's match under match A's players.
 * The page runs as a plain async function (vitest 'node' env) and its element
 * tree is walked without rendering the children.
 */
import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveAccess } from '@/lib/auth/helpers';
import { fullMatchRow } from '@/lib/match/__tests__/private-match-fields';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, { value: string }>(),
  getMatchById: vi.fn(),
  getGameById: vi.fn(),
  getBattleStatsByGame: vi.fn(),
  getPhaseGameById: vi.fn(),
  getPhaseMatchById: vi.fn(),
  getPhaseBattleStatsByGame: vi.fn(),
  findNativePhaseAliasOwner: vi.fn(),
  standaloneMatchAliasExists: vi.fn(),
  readPhaseStorageMode: vi.fn(),
  isPhaseAdminFor: vi.fn(),
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  isResourceAdminFor: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
// The pages translate through `getT` (i18n-core §1.2), which reads the
// language cookie; `cookies()` needs a request scope, so it is stubbed here.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => mocks.cookies.get(name) }),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: mocks.getMatchById }));
vi.mock('@/lib/supabase/queries/games', () => ({
  getGameById: mocks.getGameById,
  getBattleStatsByGame: mocks.getBattleStatsByGame,
}));
vi.mock('@/lib/supabase/queries/phase-games', () => ({
  getPhaseGameById: mocks.getPhaseGameById,
  getPhaseBattleStatsByGame: mocks.getPhaseBattleStatsByGame,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mocks.getPhaseMatchById }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: mocks.findNativePhaseAliasOwner,
  standaloneMatchAliasExists: mocks.standaloneMatchAliasExists,
}));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: mocks.readPhaseStorageMode }));
vi.mock('@/lib/supabase/queries/phase-admins', () => ({ isPhaseAdminFor: mocks.isPhaseAdminFor }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/components/shared/AdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/ui/PageContainer', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../EditGameForm', () => ({ default: () => null }));

import EditGamePage from '../page';
import EditGameForm from '../EditGameForm';
import { MatchAccessDenied } from '../../../../match-access';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_MATCH_ID = '44444444-4444-4444-8444-444444444444';
const GAME_ID = '55555555-5555-4555-8555-555555555555';
const PHASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEASON_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function access(flags: Partial<Omit<LiveAccess, 'player'>>): LiveAccess {
  return {
    player: { playerId: 'viewer-1' } as LiveAccess['player'],
    isSiteAdmin: false,
    isAnyAdmin: false,
    isCreator: false,
    isSuperadmin: false,
    ...flags,
  };
}

const GAME_VERSION = '2026-10-19T08:00:00.123456+00:00';

function gameRow(matchId: string) {
  return { id: GAME_ID, match_id: matchId, game_number: 2, winner_id: null, updated_at: GAME_VERSION };
}

/** The first element of `type` anywhere in an element tree. */
function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findElement(n, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === type) return node as unknown as { props: Record<string, unknown> };
  return findElement(node.props.children, type);
}

/** Every element type anywhere in an element tree (props.children). */
function types(node: ReactNode, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    node.forEach((n) => types(n, out));
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    out.push(node.type);
    types(node.props.children, out);
  }
  return out;
}

async function renderPage(id = MATCH_ID, gid = GAME_ID) {
  return types(await EditGamePage({ params: Promise.resolve({ id, gid }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
  mocks.cookies.clear();
  mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID }));
  mocks.getGameById.mockResolvedValue(gameRow(MATCH_ID));
  mocks.getBattleStatsByGame.mockResolvedValue([]);
  mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
  mocks.isResourceAdminFor.mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

describe('native admin game edit', () => {
  beforeEach(() => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    mocks.readPhaseStorageMode.mockResolvedValue('phase');
    mocks.findNativePhaseAliasOwner.mockResolvedValue({ kind: 'phase', phase_id: PHASE_ID, season_id: SEASON_ID });
    const { tournament_id: _tournamentId, ...phaseMatch } = fullMatchRow({ id: MATCH_ID });
    mocks.getPhaseMatchById.mockResolvedValue({ ...phaseMatch, phase_id: PHASE_ID });
    mocks.getPhaseGameById.mockResolvedValue(gameRow(MATCH_ID));
    mocks.getPhaseBattleStatsByGame.mockResolvedValue([{ game_id: GAME_ID, pokemon_name: 'Bulbasaur' }]);
    mocks.getLiveAccess.mockResolvedValue({
      ...access({}),
      player: { playerId: 'viewer-1', isAdmin: false, status: 'active' } as LiveAccess['player'],
    });
    mocks.isPhaseAdminFor.mockResolvedValue(true);
  });

  it('binds the native game and phase-only role before reading private editor stats and its fresh version', async () => {
    const tree = await EditGamePage({
      params: Promise.resolve({ id: MATCH_ID, gid: GAME_ID }),
      searchParams: Promise.resolve({ back: 'page=3&status=disputed' }),
    });
    expect(findElement(tree, EditGameForm)?.props).toMatchObject({
      matchId: MATCH_ID, gameId: GAME_ID, gameUpdatedAt: GAME_VERSION, isSiteAdmin: false, native: true,
      battleStats: [{ game_id: GAME_ID, pokemon_name: 'Bulbasaur' }],
      returnHref: `/admin/matches/${MATCH_ID}?back=${encodeURIComponent('status=disputed&page=3')}`,
    });
    expect(mocks.findNativePhaseAliasOwner).toHaveBeenCalledWith({ matchId: MATCH_ID });
    expect(mocks.isPhaseAdminFor).toHaveBeenCalledWith('viewer-1', PHASE_ID);
    expect(mocks.getPhaseBattleStatsByGame).toHaveBeenCalledWith(GAME_ID);
    expect(mocks.getGameById).not.toHaveBeenCalled();
    expect(mocks.getBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('does not fetch private stats when the live role was revoked', async () => {
    mocks.isPhaseAdminFor.mockResolvedValue(false);
    expect(await renderPage()).not.toContain(EditGameForm);
    expect(mocks.getPhaseBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('rejects a native game from another match even when the viewer administers the URL match', async () => {
    mocks.getPhaseGameById.mockResolvedValue(gameRow(OTHER_MATCH_ID));
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.isPhaseAdminFor).not.toHaveBeenCalled();
    expect(mocks.getPhaseBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('rejects a legacy shadow game under a native match', async () => {
    mocks.getPhaseGameById.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getGameById).not.toHaveBeenCalled();
  });

  it('refuses a colliding native game id under a standalone match', async () => {
    mocks.findNativePhaseAliasOwner.mockResolvedValue(null);
    mocks.standaloneMatchAliasExists.mockResolvedValue(true);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getGameById).not.toHaveBeenCalled();
    expect(mocks.getPhaseBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('keeps the standalone editor after a native game miss', async () => {
    mocks.findNativePhaseAliasOwner.mockResolvedValue(null);
    mocks.standaloneMatchAliasExists.mockResolvedValue(true);
    mocks.getPhaseGameById.mockResolvedValue(null);
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    expect(await renderPage()).toContain(EditGameForm);
    expect(mocks.getBattleStatsByGame).toHaveBeenCalledWith(GAME_ID);
    expect(mocks.getPhaseBattleStatsByGame).not.toHaveBeenCalled();
  });
});

describe('EditGamePage: optimistic concurrency', () => {
  it('hands the form the game version it loaded, so a stale save is refused', async () => {
    const tree = await EditGamePage({ params: Promise.resolve({ id: MATCH_ID, gid: GAME_ID }) });
    const form = findElement(tree, EditGameForm);

    expect(form?.props.gameUpdatedAt).toBe(GAME_VERSION);
    expect(mocks.readPhaseStorageMode).not.toHaveBeenCalled();
    expect(mocks.getPhaseGameById).not.toHaveBeenCalled();
  });
});

describe('EditGamePage: the way back keeps the list query', () => {
  const returnHref = async (back?: string) => {
    const tree = await EditGamePage({
      params: Promise.resolve({ id: MATCH_ID, gid: GAME_ID }),
      ...(back === undefined ? {} : { searchParams: Promise.resolve({ back }) }),
    });
    return findElement(tree, EditGameForm)?.props.returnHref;
  };

  it('hands the form the match page with the canonical back query', async () => {
    expect(await returnHref('page=2&status=disputed')).toBe(
      `/admin/matches/${MATCH_ID}?back=${encodeURIComponent('status=disputed&page=2')}`,
    );
  });

  it('drops an invalid or missing back value', async () => {
    expect(await returnHref('//evil.example')).toBe(`/admin/matches/${MATCH_ID}`);
    expect(await returnHref()).toBe(`/admin/matches/${MATCH_ID}`);
  });
});

describe('EditGamePage: game must belong to the URL match', () => {
  it('renders the form for a game of the URL match to its resource admin', async () => {
    const rendered = await renderPage();

    expect(rendered).toContain(EditGameForm);
    expect(rendered).not.toContain(MatchAccessDenied);
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('viewer-1', 'tournament', TOURNAMENT_ID);
  });

  it("404s a game of ANOTHER match, before the gate and without reading its battle stats", async () => {
    mocks.getGameById.mockResolvedValue(gameRow(OTHER_MATCH_ID));

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    expect(mocks.getBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('404s a mismatched pair for a site admin too', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.getGameById.mockResolvedValue(gameRow(OTHER_MATCH_ID));

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('shows access denied to a resource admin of another tournament', async () => {
    mocks.isResourceAdminFor.mockResolvedValue(false);

    const rendered = await renderPage();

    expect(rendered).toContain(MatchAccessDenied);
    expect(rendered).not.toContain(EditGameForm);
    expect(mocks.getBattleStatsByGame).not.toHaveBeenCalled();
  });

  it('404s a missing game or a malformed id', async () => {
    mocks.getGameById.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');

    await expect(renderPage(MATCH_ID, 'abc')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

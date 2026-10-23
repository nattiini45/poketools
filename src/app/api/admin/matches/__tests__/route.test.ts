import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return {
    requireAnyAdmin: vi.fn(),
    AuthError,
  };
});

// Real scope predicates, mocked scope read.
vi.mock('@/lib/auth/admin-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/admin-scope')>()),
  getAdminScope: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  listAdminMatchesPage: vi.fn(),
  findPlayerIdsForMatchSearch: vi.fn(),
  listTournamentIdsBySeason: vi.fn(),
}));

import { GET } from '@/app/api/admin/matches/route';
import { adminMatchListQuerySchema } from '@/lib/admin/match-list';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import type { AdminScope } from '@/lib/auth/admin-scope';
import {
  findPlayerIdsForMatchSearch,
  listAdminMatchesPage,
  listTournamentIdsBySeason,
} from '@/lib/supabase/queries/matches';

const PLAYER = { playerId: 'p-admin', isAdmin: true, isResourceAdmin: false };
const SEASON = '11111111-1111-4111-8111-111111111111';
const SEASON_OTHER = '99999999-9999-4999-8999-999999999999';
const PHASE_A = '22222222-2222-4222-8222-222222222222';
const PHASE_B = '33333333-3333-4333-8333-333333333333';
const STANDALONE = '44444444-4444-4444-8444-444444444444';
const PLAYER_ID_1 = '55555555-5555-4555-8555-555555555555';
const PLAYER_ID_2 = '66666666-6666-4666-8666-666666666666';
const MATCH_ID = '77777777-7777-4777-8777-777777777777';

const SITE_SCOPE: AdminScope = { playerId: 'p-admin', isSiteAdmin: true, seasonIds: null, tournamentIds: null };
/** A season admin of SEASON (phases A and B) with no other assignment. */
const SEASON_ADMIN_SCOPE: AdminScope = {
  playerId: 'p-res',
  isSiteAdmin: false,
  seasonIds: [SEASON],
  tournamentIds: [PHASE_A, PHASE_B],
};
/** A tournament-only admin of PHASE_A (a phase of SEASON) and the standalone tournament. */
const TOURNAMENT_ADMIN_SCOPE: AdminScope = {
  playerId: 'p-res',
  isSiteAdmin: false,
  seasonIds: [],
  tournamentIds: [PHASE_A, STANDALONE],
};

// Embedded players carry only the narrow shape (name, avatar_url) from the query layer.
const mockRow = {
  id: MATCH_ID,
  tournament_id: PHASE_A,
  tournament_name: 'Group stage',
  season_id: SEASON,
  season_name: 'Summer League',
  round_id: 'round-1',
  player_1_id: PLAYER_ID_1,
  player_2_id: PLAYER_ID_2,
  player_1_name: 'Mara',
  player_2_name: 'Nora',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  winner_name: null,
  status: 'scheduled',
  winner_id: null,
  games: [],
};

function req(search = ''): NextRequest {
  return { url: `http://localhost:3000/api/admin/matches${search}` } as unknown as NextRequest;
}

function pageOf(rows: unknown[] = [mockRow], total = rows.length) {
  return { rows, total } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER as never);
  vi.mocked(getAdminScope).mockResolvedValue(SITE_SCOPE);
  vi.mocked(listAdminMatchesPage).mockResolvedValue(pageOf());
  vi.mocked(listTournamentIdsBySeason).mockResolvedValue([PHASE_A, PHASE_B]);
  vi.mocked(findPlayerIdsForMatchSearch).mockResolvedValue({ ids: [PLAYER_ID_1], truncated: false });
});

describe('GET /api/admin/matches: guard', () => {
  it('uses the any-admin guard and reads the scope of the live player', async () => {
    await GET(req());
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(getAdminScope).toHaveBeenCalledWith(PLAYER);
  });

  it('runs the guard before parsing: an unauthenticated caller gets 403, not a 400', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const res = await GET(req('?page=0'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
    expect(getAdminScope).not.toHaveBeenCalled();
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  it('lets a resource admin in and restricts the query to their tournaments', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(listAdminMatchesPage).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentIds: [PHASE_A, PHASE_B] })
    );
  });

  it('does not restrict a site admin', async () => {
    await GET(req());
    expect(listAdminMatchesPage).toHaveBeenCalledWith(expect.objectContaining({ tournamentIds: null }));
  });

  it('returns an empty page, not an error, for a resource admin with no tournaments', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...SEASON_ADMIN_SCOPE, seasonIds: [], tournamentIds: [] });
    const body = await (await GET(req())).json();
    expect(body).toEqual({
      success: true,
      data: { rows: [], total: 0, page: 1, pageSize: 50, searchTruncated: false },
    });
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  it('asks a resource admin with a very wide scope to narrow it, instead of building a huge IN list', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    vi.mocked(getAdminScope).mockResolvedValue({ ...SEASON_ADMIN_SCOPE, tournamentIds: many });
    const res = await GET(req());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.error).toContain('pick one tournament, or a league with at most 100 stages');
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  describe('narrowing a scope wider than the cap', () => {
    const wide = [
      PHASE_A,
      ...Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    ];
    const WIDE_SCOPE: AdminScope = { ...SEASON_ADMIN_SCOPE, tournamentIds: wide };

    it('lets season_id narrow it to the in-scope phases of that league only', async () => {
      const outside = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      vi.mocked(getAdminScope).mockResolvedValue(WIDE_SCOPE);
      vi.mocked(listTournamentIdsBySeason).mockResolvedValue([PHASE_A, outside]);

      const res = await GET(req(`?season_id=${SEASON}`));

      expect(res.status).toBe(200);
      expect(listAdminMatchesPage).toHaveBeenCalledTimes(1);
      expect(listAdminMatchesPage).toHaveBeenCalledWith(expect.objectContaining({ tournamentIds: [PHASE_A] }));
    });

    it('lets tournament_id narrow it to that one tournament', async () => {
      vi.mocked(getAdminScope).mockResolvedValue(WIDE_SCOPE);

      const res = await GET(req(`?tournament_id=${PHASE_A}`));

      expect(res.status).toBe(200);
      expect(listAdminMatchesPage).toHaveBeenCalledWith(expect.objectContaining({ tournamentIds: [PHASE_A] }));
    });

    it('still refuses the unfiltered view and a league that alone exceeds the cap', async () => {
      vi.mocked(getAdminScope).mockResolvedValue(WIDE_SCOPE);
      vi.mocked(listTournamentIdsBySeason).mockResolvedValue(wide);

      expect((await GET(req())).status).toBe(400);
      expect((await GET(req(`?season_id=${SEASON}`))).status).toBe(400);
      expect(listAdminMatchesPage).not.toHaveBeenCalled();
    });
  });
});

describe('GET /api/admin/matches: scope of requested ids', () => {
  it('403s a tournament_id outside the scope (not an empty list)', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    const res = await GET(req(`?tournament_id=${STANDALONE}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Admin access required for this resource',
      code: 'forbidden',
    });
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  it('403s a season_id the admin has no phase or assignment in', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    vi.mocked(listTournamentIdsBySeason).mockResolvedValue(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    const res = await GET(req(`?season_id=${SEASON_OTHER}`));
    expect(res.status).toBe(403);
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  it('allows a tournament-only admin to filter by the league of their phase, narrowed to their phase', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(TOURNAMENT_ADMIN_SCOPE);
    const res = await GET(req(`?season_id=${SEASON}`));
    expect(res.status).toBe(200);
    expect(listAdminMatchesPage).toHaveBeenCalledWith(expect.objectContaining({ tournamentIds: [PHASE_A] }));
  });

  it('allows a season admin to filter by a league that has no phases yet (empty page)', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...SEASON_ADMIN_SCOPE, seasonIds: [SEASON, SEASON_OTHER] });
    vi.mocked(listTournamentIdsBySeason).mockResolvedValue([]);
    const res = await GET(req(`?season_id=${SEASON_OTHER}`));
    expect(res.status).toBe(200);
    expect((await res.json()).data.total).toBe(0);
  });

  it('resolves season_id to that league’s phases for a site admin', async () => {
    await GET(req(`?season_id=${SEASON}`));
    expect(listTournamentIdsBySeason).toHaveBeenCalledWith(SEASON);
    expect(listAdminMatchesPage).toHaveBeenCalledWith(expect.objectContaining({ tournamentIds: [PHASE_A, PHASE_B] }));
  });

  it('passes an in-scope tournament_id as the only tournament', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    await GET(req(`?tournament_id=${PHASE_B}`));
    expect(listAdminMatchesPage).toHaveBeenCalledWith(expect.objectContaining({ tournamentIds: [PHASE_B] }));
  });

  it('intersects tournament_id with season_id: a phase of another league yields an empty page', async () => {
    vi.mocked(listTournamentIdsBySeason).mockResolvedValue([PHASE_B]);
    const body = await (await GET(req(`?season_id=${SEASON}&tournament_id=${PHASE_A}`))).json();
    expect(body.data.total).toBe(0);
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  it('passes the standalone flag, restricted to the scope for a resource admin', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(TOURNAMENT_ADMIN_SCOPE);
    await GET(req('?standalone=true'));
    expect(listAdminMatchesPage).toHaveBeenCalledWith(
      expect.objectContaining({ standaloneOnly: true, tournamentIds: [PHASE_A, STANDALONE] })
    );
  });
});

describe('GET /api/admin/matches: validation', () => {
  it('keeps a __proto__ parameter off the prototype and refuses it as an unknown parameter', async () => {
    const parse = vi.spyOn(adminMatchListQuerySchema, 'safeParse');
    try {
      const res = await GET(req('?__proto__=x&__proto__=y&page=2&page_size=25'));
      expect(res.status).toBe(400);

      // The object the handler hands to the schema: `__proto__` is a plain own key, the prototype is untouched.
      const raw = parse.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(raw, '__proto__')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(raw, 'page')).toBe(true);
    } finally {
      parse.mockRestore();
    }
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  it('passes on only the known filters, with a plain prototype', async () => {
    await GET(req('?page=2&page_size=25'));

    const passed = vi.mocked(listAdminMatchesPage).mock.calls[0][0];
    expect(passed).toMatchObject({ page: 2, pageSize: 25 });
    expect(Object.getPrototypeOf(passed)).toBe(Object.prototype);
    expect(Object.keys(passed)).not.toContain('__proto__');
    expect(Object.keys(passed)).not.toContain('constructor');
  });

  it.each([
    ['unknown status', '?status=bogus'],
    ['one bad status in a list', '?status=disputed,bogus'],
    ['non-uuid season_id', '?season_id=abc'],
    ['non-uuid tournament_id', '?tournament_id=abc'],
    ['q over 100 characters', `?q=${'x'.repeat(101)}`],
    ['page 0', '?page=0'],
    ['negative page', '?page=-1'],
    ['page_size not offered', '?page_size=7'],
    ['page_size above the maximum', '?page_size=1000'],
    ['unknown parameter', '?limit=500'],
    ['constructor parameter', '?constructor=x'],
    ['repeated parameter', '?page=1&page=2'],
    ['standalone with season_id', `?standalone=true&season_id=${SEASON}`],
  ])('400s %s with the shared validation code', async (_label, search) => {
    const res = await GET(req(search));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(typeof body.error).toBe('string');
    expect(body.params.issues).toBe(body.error);
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/matches: paging and filters', () => {
  it('defaults to page 1 of 50 and echoes the paging in the response', async () => {
    vi.mocked(listAdminMatchesPage).mockResolvedValue(pageOf([mockRow], 731));
    const res = await GET(req());
    const body = await res.json();

    expect(listAdminMatchesPage).toHaveBeenCalledWith({
      tournamentIds: null,
      standaloneOnly: false,
      statuses: undefined,
      playerIds: undefined,
      matchId: undefined,
      page: 1,
      pageSize: 50,
    });
    expect(body).toEqual({
      success: true,
      data: { rows: [mockRow], total: 731, page: 1, pageSize: 50, searchTruncated: false },
    });
  });

  it('passes page and page_size through and reports the total beyond 200 rows', async () => {
    vi.mocked(listAdminMatchesPage).mockResolvedValue(pageOf([mockRow], 4321));
    const body = await (await GET(req('?page=4&page_size=100'))).json();
    expect(listAdminMatchesPage).toHaveBeenCalledWith(expect.objectContaining({ page: 4, pageSize: 100 }));
    expect(body.data).toMatchObject({ total: 4321, page: 4, pageSize: 100 });
  });

  it('passes a status list as an array', async () => {
    await GET(req('?status=disputed,pending_confirmation'));
    expect(listAdminMatchesPage).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['disputed', 'pending_confirmation'] })
    );
  });

  it('carries the league name of a phase row so the list can show League / Phase', async () => {
    const body = await (await GET(req())).json();
    expect(body.data.rows[0]).toMatchObject({ season_name: 'Summer League', tournament_name: 'Group stage' });
  });
});

describe('GET /api/admin/matches: q', () => {
  it('resolves players by name or username, then filters on their seats', async () => {
    vi.mocked(findPlayerIdsForMatchSearch).mockResolvedValue({ ids: [PLAYER_ID_1, PLAYER_ID_2], truncated: false });
    await GET(req('?q=%20Mara%20'));
    expect(findPlayerIdsForMatchSearch).toHaveBeenCalledWith('Mara');
    expect(listAdminMatchesPage).toHaveBeenCalledWith(
      expect.objectContaining({ playerIds: [PLAYER_ID_1, PLAYER_ID_2], matchId: undefined })
    );
  });

  it('returns an empty page, without reading matches, when no player matches', async () => {
    vi.mocked(findPlayerIdsForMatchSearch).mockResolvedValue({ ids: [], truncated: false });
    const body = await (await GET(req('?q=nobody'))).json();
    expect(body).toEqual({
      success: true,
      data: { rows: [], total: 0, page: 1, pageSize: 50, searchTruncated: false },
    });
    expect(listAdminMatchesPage).not.toHaveBeenCalled();
  });

  it('says so when the search matched more players than it expands', async () => {
    vi.mocked(findPlayerIdsForMatchSearch).mockResolvedValue({ ids: [PLAYER_ID_1], truncated: true });
    const body = await (await GET(req('?q=a'))).json();
    expect(body.data.searchTruncated).toBe(true);
  });

  it('treats a full uuid as a match id and skips the player search', async () => {
    await GET(req(`?q=${MATCH_ID}`));
    expect(findPlayerIdsForMatchSearch).not.toHaveBeenCalled();
    expect(listAdminMatchesPage).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: MATCH_ID, playerIds: undefined })
    );
  });

  it('keeps the search inside the scope', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    await GET(req('?q=mara'));
    expect(listAdminMatchesPage).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentIds: [PHASE_A, PHASE_B], playerIds: [PLAYER_ID_1] })
    );
  });
});

describe('GET /api/admin/matches: no private player data', () => {
  it('serializes players in the narrow shape only', async () => {
    const res = await GET(req());
    // `status` is the match status here, not the player's moderation status; the sentinel check still applies.
    expectNoPrivatePlayerData(await res.json(), { allowKeys: ['status'] });
  });
});

describe('GET /api/admin/matches: errors', () => {
  it('returns 500 with the fallback message on an unexpected error', async () => {
    vi.mocked(listAdminMatchesPage).mockRejectedValue(new Error('DB error'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to list matches' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps a failed player search distinguishable in the log, with the same safe response', async () => {
    vi.mocked(findPlayerIdsForMatchSearch).mockRejectedValue(new Error('players table unavailable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req('?q=mara'));
    expect(res.status).toBe(500);
    expect(spy.mock.calls.flat().some((arg) => arg instanceof Error && arg.message === 'players table unavailable')).toBe(true);
    spy.mockRestore();
  });
});

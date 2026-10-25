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
  return { requireAnyAdmin: vi.fn(), AuthError };
});

// Real scope predicates, mocked scope read.
vi.mock('@/lib/auth/admin-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/admin-scope')>()),
  getAdminScope: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({ listAdminMatchRounds: vi.fn() }));

import { GET } from '../route';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import type { AdminScope } from '@/lib/auth/admin-scope';
import { listAdminMatchRounds } from '@/lib/supabase/queries/matches';

const PLAYER = { playerId: 'p1', isAdmin: false, isResourceAdmin: true };
const TOURNAMENT = '22222222-2222-4222-8222-222222222222';
const OTHER_TOURNAMENT = '33333333-3333-4333-8333-333333333333';

const SITE_SCOPE: AdminScope = { playerId: 'p1', isSiteAdmin: true, seasonIds: null, tournamentIds: null };
const RESOURCE_SCOPE: AdminScope = {
  playerId: 'p1',
  isSiteAdmin: false,
  seasonIds: [],
  tournamentIds: [TOURNAMENT],
};

const ROUNDS = [
  { id: 'r1', name: 'Round 1', round_number: 1, bracket_side: null },
  { id: 'r2', name: 'Round 2', round_number: 2, bracket_side: 'winners' },
];

function req(search = ''): NextRequest {
  return { url: `http://localhost:3000/api/admin/matches/filter-options/rounds${search}` } as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER as never);
  vi.mocked(getAdminScope).mockResolvedValue(SITE_SCOPE);
  vi.mocked(listAdminMatchRounds).mockResolvedValue(ROUNDS);
});

describe('GET /api/admin/matches/filter-options/rounds: guard', () => {
  it('denies a non-admin before reading anything', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const res = await GET(req(`?tournament_id=${TOURNAMENT}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
    expect(getAdminScope).not.toHaveBeenCalled();
    expect(listAdminMatchRounds).not.toHaveBeenCalled();
  });

  it('answers an unauthenticated caller with 401 before validating the query', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Authentication required', 401, 'unauthenticated'));
    const res = await GET(req('?page=0'));
    expect(res.status).toBe(401);
    expect(getAdminScope).not.toHaveBeenCalled();
    expect(listAdminMatchRounds).not.toHaveBeenCalled();
  });

  it('reads the scope of the live player', async () => {
    await GET(req(`?tournament_id=${TOURNAMENT}`));
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(getAdminScope).toHaveBeenCalledWith(PLAYER);
  });
});

describe('GET /api/admin/matches/filter-options/rounds: validation', () => {
  it.each([
    ['a missing tournament_id', ''],
    ['an empty tournament_id', '?tournament_id='],
    ['a non-uuid tournament_id', '?tournament_id=abc'],
    ['an extra parameter', `?tournament_id=${TOURNAMENT}&limit=5`],
    ['a repeated tournament_id', `?tournament_id=${TOURNAMENT}&tournament_id=${OTHER_TOURNAMENT}`],
    ['a __proto__ parameter', `?tournament_id=${TOURNAMENT}&__proto__=x`],
  ])('400s %s with the shared validation code, before any read', async (_label, search) => {
    const res = await GET(req(search));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(typeof body.error).toBe('string');
    expect(body.params.issues).toBe(body.error);
    expect(listAdminMatchRounds).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/matches/filter-options/rounds: scope', () => {
  it('lets a site admin read the rounds of any tournament', async () => {
    const res = await GET(req(`?tournament_id=${OTHER_TOURNAMENT}`));
    expect(res.status).toBe(200);
    expect(listAdminMatchRounds).toHaveBeenCalledWith(OTHER_TOURNAMENT);
  });

  it('lets a resource admin read the rounds of a tournament in their scope', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(RESOURCE_SCOPE);
    const res = await GET(req(`?tournament_id=${TOURNAMENT}`));
    expect(res.status).toBe(200);
    expect(listAdminMatchRounds).toHaveBeenCalledWith(TOURNAMENT);
  });

  it('403s a tournament outside the scope of a resource admin (not an empty list), without reading it', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(RESOURCE_SCOPE);
    const res = await GET(req(`?tournament_id=${OTHER_TOURNAMENT}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Admin access required for this resource',
      code: 'forbidden',
    });
    expect(listAdminMatchRounds).not.toHaveBeenCalled();
  });

  it('403s every tournament for a resource admin with no assignments', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...RESOURCE_SCOPE, tournamentIds: [] });
    const res = await GET(req(`?tournament_id=${TOURNAMENT}`));
    expect(res.status).toBe(403);
    expect(listAdminMatchRounds).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/matches/filter-options/rounds: payload', () => {
  it('returns the rounds as the query returns them (in play order)', async () => {
    const res = await GET(req(`?tournament_id=${TOURNAMENT}`));
    expect(await res.json()).toEqual({ success: true, data: ROUNDS });
  });

  it('returns an empty list for a tournament without rounds', async () => {
    vi.mocked(listAdminMatchRounds).mockResolvedValue([]);
    const res = await GET(req(`?tournament_id=${TOURNAMENT}`));
    expect(await res.json()).toEqual({ success: true, data: [] });
  });

  it('carries no private player data', async () => {
    const res = await GET(req(`?tournament_id=${TOURNAMENT}`));
    expectNoPrivatePlayerData(await res.json());
  });
});

describe('GET /api/admin/matches/filter-options/rounds: errors', () => {
  it('returns 500 with the fallback message on an unexpected error, and logs the cause', async () => {
    vi.mocked(listAdminMatchRounds).mockRejectedValue(new Error('rounds table unavailable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req(`?tournament_id=${TOURNAMENT}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to load match rounds' });
    expect(spy.mock.calls.flat().some((arg) => arg instanceof Error && arg.message === 'rounds table unavailable')).toBe(true);
    spy.mockRestore();
  });
});

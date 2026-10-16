import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamById: vi.fn(),
  updateTeamPokemon: vi.fn(),
  deleteTeam: vi.fn(),
}));

vi.mock('@/lib/team/visibility', () => ({
  canViewTeamPokemon: vi.fn(),
  filterTeamVisibility: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/teams/[id]/route';
import { requirePlayer, requireAdmin, AuthError } from '@/lib/auth/helpers';
import { getTeamById, updateTeamPokemon, deleteTeam } from '@/lib/supabase/queries/teams';
import { canViewTeamPokemon, filterTeamVisibility } from '@/lib/team/visibility';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: 'team-1' }) };

const mockPlayer = {
  playerId: 'player-1',
  name: 'Ash',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

const mockTeam = {
  id: 'team-1',
  player_id: 'player-1',
  tournament_id: 'tourney-1',
  pokemon: [{ species: 'Pikachu' }],
  locked: false,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/teams/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 404 when team not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(null);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Team not found');
    expect(json.code).toBe('team_not_found');
  });

  it('returns full team when visible', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(canViewTeamPokemon).mockResolvedValue(true);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.pokemon).toBeDefined();
  });

  it('returns redacted team when not visible', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(canViewTeamPokemon).mockResolvedValue(false);
    const redacted = { ...mockTeam, pokemon: [] };
    vi.mocked(filterTeamVisibility).mockResolvedValue([redacted] as never);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pokemon).toEqual([]);
  });
});

describe('PATCH /api/teams/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await PATCH(makeRequest({ pokemon: [], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 404 when team not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ pokemon: [], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Team not found');
    expect(json.code).toBe('team_not_found');
  });

  it('returns 403 when not the team owner or admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'other-player' } as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);

    const res = await PATCH(makeRequest({ pokemon: [], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not your team');
    expect(json.code).toBe('team_not_owner');
  });

  it('returns 409 when team is locked', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue({ ...mockTeam, locked: true } as never);

    const res = await PATCH(makeRequest({ pokemon: [], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Team is locked');
    expect(json.code).toBe('team_locked');
  });

  it('updates team pokemon successfully', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    const updatedTeam = { ...mockTeam, pokemon: [{ species: 'Charizard' }] };
    vi.mocked(updateTeamPokemon).mockResolvedValue(updatedTeam as never);

    const res = await PATCH(
      makeRequest({ pokemon: [{ species: 'Charizard' }], import_source: 'pokepastes' }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateTeamPokemon).toHaveBeenCalledWith(
      'team-1',
      [{ species: 'Charizard' }],
      'pokepastes',
      undefined, // no name in this request
    );
  });

  it('passes the team name through when provided', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(updateTeamPokemon).mockResolvedValue(mockTeam as never);

    const res = await PATCH(
      makeRequest({
        pokemon: [{ species: 'Charizard' }],
        import_source: 'pokepastes',
        name: 'Sun Squad',
      }),
      routeParams,
    );

    expect(res.status).toBe(200);
    expect(updateTeamPokemon).toHaveBeenCalledWith(
      'team-1',
      [{ species: 'Charizard' }],
      'pokepastes',
      'Sun Squad',
    );
  });
});

describe('DELETE /api/teams/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 404 when team not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(null);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Team not found');
    expect(json.code).toBe('team_not_found');
  });

  it('returns 403 when not owner or admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'other-player' } as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not your team');
    expect(json.code).toBe('team_not_owner');
  });

  it('returns 409 when locked and non-admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue({ ...mockTeam, locked: true } as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Team is locked');
    expect(json.code).toBe('team_locked');
  });

  it('allows admin to delete locked team', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, isAdmin: true } as never);
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTeamById).mockResolvedValue({ ...mockTeam, locked: true } as never);
    vi.mocked(deleteTeam).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(deleteTeam).toHaveBeenCalledWith('team-1');
  });

  it('deletes unlocked team for owner', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(deleteTeam).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(deleteTeam).toHaveBeenCalledWith('team-1');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Team, TeamWithContext } from '@/types/team';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  listTeamsByTournament: vi.fn(),
  listTeamsByPlayerWithContext: vi.fn(),
  getPlayerTeamForTournament: vi.fn(),
  createTeam: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  isPlayerTournamentParticipant: vi.fn(),
}));

vi.mock('@/lib/team/visibility', () => ({
  filterTeamVisibilityBatch: vi.fn(),
}));

import { GET, POST } from '@/app/api/teams/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import {
  listTeamsByTournament,
  listTeamsByPlayerWithContext,
  getPlayerTeamForTournament,
  createTeam,
} from '@/lib/supabase/queries/teams';
import { getTournamentById, isPlayerTournamentParticipant } from '@/lib/supabase/queries/tournaments';
import { filterTeamVisibilityBatch } from '@/lib/team/visibility';

const mockPokemonSet = {
  name: '',
  species: 'Pikachu',
  gender: '',
  item: 'Light Ball',
  ability: 'Static',
  evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Timid',
  level: 100,
  moves: ['Thunderbolt', 'Volt Switch', 'Grass Knot', 'Hidden Power Ice'],
};

const UUID = '00000000-0000-4000-8000-000000000001';
const UUID_NOTFOUND = '00000000-0000-4000-8000-000000000002';

const mockTeam: Team = {
  id: 'team-1',
  name: '',
  player_id: 'player-1',
  tournament_id: UUID,
  season_id: null,
  match_id: null,
  pokemon: [mockPokemonSet],
  import_source: 'manual',
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
  share_token: null,
  share_enabled_at: null,
  library_published_at: null,
  library_title: null,
  library_description: null,
  library_tags: null,
  forked_from_team_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const mockTeamWithContext: TeamWithContext = {
  ...mockTeam,
  tournament_name: 'Tournament One',
};

const player = {
  playerId: 'player-1',
  name: 'Ash',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: 'AshPS',
  championsUsername: '',
  avatarUrl: null,
  status: 'active' as const,
};

const adminPlayer = {
  ...player,
  playerId: 'admin-1',
  name: 'Admin',
  isAdmin: true,
};

describe('GET /api/teams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const url = new URL('http://localhost:3000/api/teams');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('returns teams by tournament_id with visibility filtering', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByTournament).mockResolvedValue([mockTeam]);
    vi.mocked(filterTeamVisibilityBatch).mockResolvedValue([mockTeam]);

    const url = new URL('http://localhost:3000/api/teams?tournament_id=tourney-1');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockTeam]);
    expect(vi.mocked(filterTeamVisibilityBatch)).toHaveBeenCalledWith(
      [mockTeam],
      { viewerId: 'player-1', isAdmin: false, tournamentId: 'tourney-1' },
    );
  });

  it('returns own teams by player_id', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByPlayerWithContext).mockResolvedValue({ data: [mockTeamWithContext], total: 1 });

    const url = new URL('http://localhost:3000/api/teams?player_id=player-1');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockTeamWithContext]);
    expect(body.total).toBe(1);
  });

  it('returns 403 when non-admin tries to view other player teams', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);

    const url = new URL('http://localhost:3000/api/teams?player_id=other-player');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Cannot view other players' teams");
    expect(body.code).toBe('team_list_forbidden');
  });

  it('admin can view any player teams', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    vi.mocked(listTeamsByPlayerWithContext).mockResolvedValue({ data: [mockTeamWithContext], total: 1 });

    const url = new URL('http://localhost:3000/api/teams?player_id=player-1');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns own teams by default when no query params', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByPlayerWithContext).mockResolvedValue({ data: [], total: 0 });

    const url = new URL('http://localhost:3000/api/teams');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(listTeamsByPlayerWithContext)).toHaveBeenCalledWith('player-1', { limit: 50, offset: 0 });
  });

  it('passes limit and offset params', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByPlayerWithContext).mockResolvedValue({ data: [], total: 0 });

    const url = new URL('http://localhost:3000/api/teams?limit=10&offset=20');
    const request = { url: url.toString() } as unknown as NextRequest;

    await GET(request);

    expect(vi.mocked(listTeamsByPlayerWithContext)).toHaveBeenCalledWith('player-1', { limit: 10, offset: 20 });
  });
});

describe('POST /api/teams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(player);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('returns 400 when pokemon is missing', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('pokemon');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('returns 400 when pokemon is empty', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('pokemon');
  });

  it('creates a personal team (no tournament_id) with status 201', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID_NOTFOUND, pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Tournament not found');
    expect(body.code).toBe('tournament_not_found');
  });

  it('returns 403 when tournament is completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID, status: 'completed' } as Awaited<ReturnType<typeof getTournamentById>>);

    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('team submission is closed');
    expect(body.code).toBe('team_submission_closed');
  });

  it('returns 403 when non-admin is not a participant', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID, status: 'active' } as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(isPlayerTournamentParticipant).mockResolvedValue(false);

    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('You are not a participant in this tournament');
    expect(body.code).toBe('team_not_tournament_participant');
  });

  it('returns 409 when player already has a team', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID, status: 'active' } as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(isPlayerTournamentParticipant).mockResolvedValue(true);
    vi.mocked(getPlayerTeamForTournament).mockResolvedValue(mockTeam);

    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('You already have a team for this tournament');
    expect(body.code).toBe('team_already_submitted');
  });

  it('creates team and returns 201', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID, status: 'active' } as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(isPlayerTournamentParticipant).mockResolvedValue(true);
    vi.mocked(getPlayerTeamForTournament).mockResolvedValue(null);
    vi.mocked(createTeam).mockResolvedValue(mockTeam);

    const teamData = { tournament_id: UUID, pokemon: [mockPokemonSet] };
    const request = {
      json: vi.fn().mockResolvedValue(teamData),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockTeam);
    expect(vi.mocked(createTeam)).toHaveBeenCalledWith('player-1', teamData);
  });

  it('admin skips participant check', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID, status: 'active' } as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(getPlayerTeamForTournament).mockResolvedValue(null);
    vi.mocked(createTeam).mockResolvedValue(mockTeam);

    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(vi.mocked(isPlayerTournamentParticipant)).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getTournamentById).mockRejectedValue(new Error('DB error'));

    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to create team');
    expect(body.code).toBeUndefined();
  });
});

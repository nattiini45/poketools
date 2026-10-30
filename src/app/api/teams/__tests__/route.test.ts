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
  getTeamVisibilityFacts: vi.fn(),
  getTeamByShareToken: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  isPlayerTournamentParticipant: vi.fn(),
}));

// The real visibility module runs (only the queries are mocked), so these
// tests exercise spec §7 and the PublicTeam allowlist end to end.

import { GET, POST } from '@/app/api/teams/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import {
  listTeamsByTournament,
  listTeamsByPlayerWithContext,
  getPlayerTeamForTournament,
  createTeam,
  getTeamVisibilityFacts,
} from '@/lib/supabase/queries/teams';
import { getTournamentById, isPlayerTournamentParticipant } from '@/lib/supabase/queries/tournaments';
import { REDACTED_POKEMON } from '@/lib/team/visibility';
import { expectNoPrivateTeamData, teamRowWithShareSecrets } from '@/lib/team/__tests__/private-team-fields';

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
  player_id: '00000000-0000-4000-8000-000000000011',
  tournament_id: UUID,
  season_id: null,
  match_id: null,
  pokemon: [mockPokemonSet],
  import_source: 'manual',
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
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
  playerId: '00000000-0000-4000-8000-000000000011',
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

  it('returns teams by tournament_id: own team in full, others per spec §7, no share columns', async () => {
    const own = teamRowWithShareSecrets({ id: 'own', player_id: '00000000-0000-4000-8000-000000000011' });
    const planned = teamRowWithShareSecrets({ id: 'planned', player_id: 'player-2' });
    const played = teamRowWithShareSecrets({ id: 'played', player_id: 'player-3', match_id: 'match-done' });
    const pending = teamRowWithShareSecrets({ id: 'pending', player_id: 'player-3', match_id: 'match-next' });
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByTournament).mockResolvedValue([own, planned, played, pending]);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(
      new Map([
        ['planned', { match_status: null, tournament_visibility: 'hidden_until_match' }],
        ['played', { match_status: 'completed', tournament_visibility: 'hidden_until_match' }],
        ['pending', { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }],
      ]),
    );

    const url = new URL('http://localhost:3000/api/teams?tournament_id=00000000-0000-4000-8000-000000000001');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.map((t: Team) => t.id)).toEqual(['own', 'planned', 'played', 'pending']);
    expect(body.data[0].pokemon).toEqual(own.pokemon);
    expect(body.data[1].pokemon).toEqual(REDACTED_POKEMON);
    expect(body.data[2].pokemon).toEqual(played.pokemon);
    expect(body.data[3].pokemon).toEqual(REDACTED_POKEMON);
    expect(vi.mocked(getTeamVisibilityFacts)).toHaveBeenCalledWith(['planned', 'played', 'pending']);
    expectNoPrivateTeamData(body);
  });

  it('an always_public tournament shows planned rosters to every player', async () => {
    const planned = teamRowWithShareSecrets({ id: 'planned', player_id: 'player-2' });
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByTournament).mockResolvedValue([planned]);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(
      new Map([['planned', { match_status: null, tournament_visibility: 'always_public' }]]),
    );

    const url = new URL('http://localhost:3000/api/teams?tournament_id=00000000-0000-4000-8000-000000000001');
    const body = await (await GET({ url: url.toString() } as unknown as NextRequest)).json();

    expect(body.data[0].pokemon).toEqual(planned.pokemon);
    expectNoPrivateTeamData(body);
  });

  it('an admin sees every roster without a facts read', async () => {
    const planned = teamRowWithShareSecrets({ id: 'planned', player_id: 'player-2' });
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    vi.mocked(listTeamsByTournament).mockResolvedValue([planned]);

    const url = new URL('http://localhost:3000/api/teams?tournament_id=00000000-0000-4000-8000-000000000001');
    const body = await (await GET({ url: url.toString() } as unknown as NextRequest)).json();

    expect(body.data[0].pokemon).toEqual(planned.pokemon);
    expect(vi.mocked(getTeamVisibilityFacts)).not.toHaveBeenCalled();
    expectNoPrivateTeamData(body);
  });

  it('a failed visibility read is a 500, never an unredacted list', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByTournament).mockResolvedValue([teamRowWithShareSecrets({ id: 'x', player_id: 'player-2' })]);
    vi.mocked(getTeamVisibilityFacts).mockRejectedValue(new Error('facts down'));

    const url = new URL('http://localhost:3000/api/teams?tournament_id=00000000-0000-4000-8000-000000000001');
    const response = await GET({ url: url.toString() } as unknown as NextRequest);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('own team list (player_id) carries no share columns', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByPlayerWithContext).mockResolvedValue({
      data: [Object.assign(teamRowWithShareSecrets({ player_id: '00000000-0000-4000-8000-000000000011' }), { tournament_name: 'Cup' })],
      total: 1,
    });

    const url = new URL('http://localhost:3000/api/teams?player_id=00000000-0000-4000-8000-000000000011');
    const body = await (await GET({ url: url.toString() } as unknown as NextRequest)).json();

    expect(body.data[0].tournament_name).toBe('Cup');
    expectNoPrivateTeamData(body);
  });

  it('returns own teams by player_id', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByPlayerWithContext).mockResolvedValue({ data: [mockTeamWithContext], total: 1 });

    const url = new URL('http://localhost:3000/api/teams?player_id=00000000-0000-4000-8000-000000000011');
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

    const url = new URL('http://localhost:3000/api/teams?player_id=00000000-0000-4000-8000-000000000099');
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

    const url = new URL('http://localhost:3000/api/teams?player_id=00000000-0000-4000-8000-000000000011');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 400 team_list_tournament_id_invalid for a malformed tournament_id, without a query', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);

    const url = new URL('http://localhost:3000/api/teams?tournament_id=not-a-uuid');
    const response = await GET({ url: url.toString() } as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'tournament_id must be a valid UUID',
      code: 'team_list_tournament_id_invalid',
    });
    expect(vi.mocked(listTeamsByTournament)).not.toHaveBeenCalled();
  });

  it('returns 400 team_list_player_id_invalid for a malformed player_id, without a query', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);

    const url = new URL("http://localhost:3000/api/teams?player_id=1')or(true");
    const response = await GET({ url: url.toString() } as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'player_id must be a valid UUID',
      code: 'team_list_player_id_invalid',
    });
    expect(vi.mocked(listTeamsByPlayerWithContext)).not.toHaveBeenCalled();
  });

  it('checks auth before validating ids (401, not 400, when signed out)', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const url = new URL('http://localhost:3000/api/teams?tournament_id=not-a-uuid');
    const response = await GET({ url: url.toString() } as unknown as NextRequest);

    expect(response.status).toBe(401);
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
    expect(vi.mocked(listTeamsByPlayerWithContext)).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000011', { limit: 50, offset: 0 });
  });

  it('passes limit and offset params', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player);
    vi.mocked(listTeamsByPlayerWithContext).mockResolvedValue({ data: [], total: 0 });

    const url = new URL('http://localhost:3000/api/teams?limit=10&offset=20');
    const request = { url: url.toString() } as unknown as NextRequest;

    await GET(request);

    expect(vi.mocked(listTeamsByPlayerWithContext)).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000011', { limit: 10, offset: 20 });
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

  it.each([
    ['a set without evs', { ...mockPokemonSet, evs: undefined }],
    ['a negative EV', { ...mockPokemonSet, evs: { ...mockPokemonSet.evs, hp: -760 } }],
    ['five moves', { ...mockPokemonSet, moves: ['a', 'b', 'c', 'd', 'e'] }],
    ['an IV above 31', { ...mockPokemonSet, ivs: { ...mockPokemonSet.ivs, hp: 32 } }],
    ['level 0', { ...mockPokemonSet, level: 0 }],
    ['an item of 101 characters', { ...mockPokemonSet, item: 'x'.repeat(101) }],
    ['a set that is null', null],
  ])('refuses %s with a coded 400 and stores nothing', async (_label, badSet) => {
    const request = {
      json: vi.fn().mockResolvedValue({ tournament_id: UUID, pokemon: [badSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(createTeam).not.toHaveBeenCalled();
  });

  it('creates a personal team (no tournament_id) with status 201', async () => {
    vi.mocked(createTeam).mockResolvedValue({ ...mockTeam, tournament_id: null });
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
    expect(vi.mocked(createTeam)).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000011', teamData);
  });

  it('the created team is a PublicTeam (no share columns)', async () => {
    vi.mocked(createTeam).mockResolvedValue(teamRowWithShareSecrets({ player_id: '00000000-0000-4000-8000-000000000011', tournament_id: null }));

    const request = {
      json: vi.fn().mockResolvedValue({ pokemon: [mockPokemonSet] }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expectNoPrivateTeamData(body);
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

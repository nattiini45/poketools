import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { makeSet } from '@/test/team-fixtures';

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
  getTeamVisibilityFacts: vi.fn(),
  getTeamByShareToken: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/revalidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/revalidation')>()),
  expirePublicTags: vi.fn(),
}));

// The real visibility module runs: these tests exercise spec §7 (H3) and the
// PublicTeam allowlist (C1) with only the queries mocked.

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/teams/[id]/route';
import { requirePlayer, requireAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTeamById,
  updateTeamPokemon,
  deleteTeam,
  getTeamVisibilityFacts,
} from '@/lib/supabase/queries/teams';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { expirePublicTags } from '@/lib/revalidation';
import { REDACTED_POKEMON } from '@/lib/team/visibility';
import { expectNoPrivateTeamData, teamRowWithShareSecrets } from '@/lib/team/__tests__/private-team-fields';
import { TeamMatchCompletedError } from '@/lib/team/completed-match-lock';
import type { TeamVisibilityFacts } from '@/lib/supabase/queries/teams';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed' }) };

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
  id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed',
  player_id: 'player-1',
  tournament_id: 'tourney-1',
  pokemon: [makeSet('Pikachu')],
  locked: false,
};

/** The facts read of the route's team id: its linked match's status. */
function mockMatchStatus(status: TeamVisibilityFacts['match_status']): void {
  vi.mocked(getTeamVisibilityFacts).mockResolvedValue(
    new Map([[mockTeam.id, { match_status: status, tournament_visibility: 'hidden_until_match' }]]),
  );
}

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

  it.each([
    ['a set without evs', { ...makeSet('Pikachu'), evs: undefined }],
    ['a negative EV', { ...makeSet('Pikachu'), evs: { hp: -760, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 } }],
    ['five moves', { ...makeSet('Pikachu'), moves: ['a', 'b', 'c', 'd', 'e'] }],
    ['a set that is a string', 'Pikachu'],
  ])('refuses %s with a coded 400 before it reads or writes the team', async (_label, badSet) => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await PATCH(makeRequest({ pokemon: [badSet], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(updateTeamPokemon).not.toHaveBeenCalled();
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

  it('the owner gets the full roster, without share columns and without a facts read', async () => {
    const team = teamRowWithShareSecrets({ id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed', player_id: 'player-1' });
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(team);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.pokemon).toEqual(team.pokemon);
    expect(getTeamVisibilityFacts).not.toHaveBeenCalled();
    expectNoPrivateTeamData(json);
  });

  it('a planned team of another player is redacted even when its owner completed other matches (H3)', async () => {
    const team = teamRowWithShareSecrets({ id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed', player_id: 'owner-9' });
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(team);
    vi.mocked(getMatchesByPlayer).mockResolvedValue([{ status: 'completed' }] as never);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(
      new Map([['a270be7b-7033-4b49-808c-bf2d5ef8e0ed', { match_status: null, tournament_visibility: 'hidden_until_match' }]]),
    );

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pokemon).toEqual(REDACTED_POKEMON);
    expect(json.data.id).toBe('a270be7b-7033-4b49-808c-bf2d5ef8e0ed');
    expect(getMatchesByPlayer).not.toHaveBeenCalled();
    expectNoPrivateTeamData(json);
  });

  it('a team of another player linked to a completed match is visible, still without share columns', async () => {
    const team = teamRowWithShareSecrets({ id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed', player_id: 'owner-9', match_id: 'match-1' });
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(team);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(
      new Map([['a270be7b-7033-4b49-808c-bf2d5ef8e0ed', { match_status: 'completed', tournament_visibility: 'hidden_until_match' }]]),
    );

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(json.data.pokemon).toEqual(team.pokemon);
    expectNoPrivateTeamData(json);
  });

  it('a team of another player linked to a scheduled match stays redacted', async () => {
    const team = teamRowWithShareSecrets({ id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed', player_id: 'owner-9', match_id: 'match-1' });
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(team);
    vi.mocked(getTeamVisibilityFacts).mockResolvedValue(
      new Map([['a270be7b-7033-4b49-808c-bf2d5ef8e0ed', { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' }]]),
    );

    const json = await (await GET({} as NextRequest, routeParams)).json();

    expect(json.data.pokemon).toEqual(REDACTED_POKEMON);
  });

  it('an admin sees any roster', async () => {
    const team = teamRowWithShareSecrets({ id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed', player_id: 'owner-9' });
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, isAdmin: true } as never);
    vi.mocked(getTeamById).mockResolvedValue(team);

    const json = await (await GET({} as NextRequest, routeParams)).json();

    expect(json.data.pokemon).toEqual(team.pokemon);
    expectNoPrivateTeamData(json);
  });
});

describe('PATCH /api/teams/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Pikachu')], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 404 when team not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Pikachu')], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Team not found');
    expect(json.code).toBe('team_not_found');
  });

  it('returns 403 when not the team owner or admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'other-player' } as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Pikachu')], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not your team');
    expect(json.code).toBe('team_not_owner');
  });

  it('returns 409 when team is locked', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue({ ...mockTeam, locked: true } as never);

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Pikachu')], import_source: 'manual' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Team is locked');
    expect(json.code).toBe('team_locked');
  });

  it('updates team pokemon successfully', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    const updatedTeam = { ...mockTeam, pokemon: [makeSet('Charizard')] };
    vi.mocked(updateTeamPokemon).mockResolvedValue(updatedTeam as never);

    const res = await PATCH(
      makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'pokepastes' }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateTeamPokemon).toHaveBeenCalledWith(
      'a270be7b-7033-4b49-808c-bf2d5ef8e0ed',
      [makeSet('Charizard')],
      'pokepastes',
      undefined, // no name in this request
      { correction: false },
    );
    // A planned row needs no match-status read.
    expect(getTeamVisibilityFacts).not.toHaveBeenCalled();
    // A planned row counts in no item usage: nothing to expire.
    expect(expirePublicTags).not.toHaveBeenCalled();
  });

  it('the updated team is a PublicTeam (no share columns)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(updateTeamPokemon).mockResolvedValue(teamRowWithShareSecrets({ id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed', player_id: 'player-1' }));

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'manual' }), routeParams);

    expect(res.status).toBe(200);
    expectNoPrivateTeamData(await res.json());
  });

  it('editing a match-linked team expires the cached item usage of its scopes (H9)', async () => {
    const linked = teamRowWithShareSecrets({
      id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed',
      player_id: 'player-1',
      match_id: 'm-1',
      tournament_id: 'tourney-1',
    });
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(linked);
    mockMatchStatus('scheduled');
    vi.mocked(updateTeamPokemon).mockResolvedValue(linked);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourney-1', season_id: 'season-1' } as never);

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'manual' }), routeParams);

    expect(res.status).toBe(200);
    expect(getTeamVisibilityFacts).toHaveBeenCalledWith(['a270be7b-7033-4b49-808c-bf2d5ef8e0ed']);
    // The item usage scopes and the league world (its aces read match-linked rows).
    expect(expirePublicTags).toHaveBeenCalledWith([
      'aggregates:all_time',
      'aggregates:tournament:tourney-1',
      'aggregates:league:season-1',
      'season:season-1',
    ]);
  });

  it('a failed tournament lookup after a committed edit still returns the update and expires the other tags', async () => {
    const linked = teamRowWithShareSecrets({
      id: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed',
      player_id: 'player-1',
      match_id: 'm-1',
      tournament_id: 'tourney-1',
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(linked);
    mockMatchStatus('in_progress');
    vi.mocked(updateTeamPokemon).mockResolvedValue(linked);
    vi.mocked(getTournamentById).mockRejectedValue(new Error('tournament read failed'));

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'manual' }), routeParams);

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(expirePublicTags).toHaveBeenCalledWith(['aggregates:all_time', 'aggregates:tournament:tourney-1']);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('tournament lookup failed after a committed write'),
      expect.objectContaining({ teamId: 'a270be7b-7033-4b49-808c-bf2d5ef8e0ed', tournamentId: 'tourney-1' })
    );
    consoleError.mockRestore();
  });

  it('passes the team name through when provided', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(updateTeamPokemon).mockResolvedValue(mockTeam as never);

    const res = await PATCH(
      makeRequest({
        pokemon: [makeSet('Charizard')],
        import_source: 'pokepastes',
        name: 'Sun Squad',
      }),
      routeParams,
    );

    expect(res.status).toBe(200);
    expect(updateTeamPokemon).toHaveBeenCalledWith(
      'a270be7b-7033-4b49-808c-bf2d5ef8e0ed',
      [makeSet('Charizard')],
      'pokepastes',
      'Sun Squad',
      { correction: false },
    );
  });

  describe('a team linked to a COMPLETED match (lead ruling round 5)', () => {
    const linked = { ...mockTeam, match_id: 'm-1' };

    it('refuses the owner with 409 team_match_completed and writes nothing (the teambuilder library save path)', async () => {
      vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
      vi.mocked(getTeamById).mockResolvedValue(linked as never);
      mockMatchStatus('completed');

      // The exact body useTeamSave sends for an existing team.
      const res = await PATCH(
        makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'manual', name: 'Final roster' }),
        routeParams,
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        success: false,
        error: 'This team belongs to a completed match and can no longer be changed',
        code: 'team_match_completed',
      });
      expect(updateTeamPokemon).not.toHaveBeenCalled();
      expect(expirePublicTags).not.toHaveBeenCalled();
    });

    it('lets a site admin correct it (the write goes through the correction path) and expires the league world', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'admin-1', isAdmin: true } as never);
      vi.mocked(getTeamById).mockResolvedValue(linked as never);
      vi.mocked(updateTeamPokemon).mockResolvedValue({ ...linked, pokemon: [makeSet('Charizard')] } as never);
      vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourney-1', season_id: 'season-1' } as never);

      const res = await PATCH(makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'manual' }), routeParams);

      expect(res.status).toBe(200);
      expect(updateTeamPokemon).toHaveBeenCalledWith(
        'a270be7b-7033-4b49-808c-bf2d5ef8e0ed',
        [makeSet('Charizard')],
        'manual',
        undefined,
        { correction: true },
      );
      // An admin needs no status read: the correction is allowed in every status.
      expect(getTeamVisibilityFacts).not.toHaveBeenCalled();
      expect(expirePublicTags).toHaveBeenCalledWith(expect.arrayContaining(['season:season-1']));
    });

    it('a completion racing the edit: the database refusal answers the same 409', async () => {
      vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
      vi.mocked(getTeamById).mockResolvedValue(linked as never);
      mockMatchStatus('pending_confirmation');
      vi.mocked(updateTeamPokemon).mockRejectedValue(new TeamMatchCompletedError());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await PATCH(makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'manual' }), routeParams);

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('team_match_completed');
      expect(expirePublicTags).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  it('a planned row in an always_public stage expires the league world (its lead is a public ace)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(updateTeamPokemon).mockResolvedValue({ ...mockTeam, match_id: null, season_id: null } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      season_id: 'season-1',
      team_visibility: 'always_public',
    } as never);

    const res = await PATCH(makeRequest({ pokemon: [makeSet('Charizard')], import_source: 'manual' }), routeParams);

    expect(res.status).toBe(200);
    expect(expirePublicTags).toHaveBeenCalledWith(['season:season-1']);
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
    expect(deleteTeam).toHaveBeenCalledWith('a270be7b-7033-4b49-808c-bf2d5ef8e0ed', { correction: true });
  });

  it('deleting a match-linked team expires the cached item usage (H9)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue({ ...mockTeam, match_id: 'm-1' } as never);
    mockMatchStatus('scheduled');
    vi.mocked(deleteTeam).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourney-1', season_id: null } as never);

    const res = await DELETE({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(expirePublicTags).toHaveBeenCalledWith(['aggregates:all_time', 'aggregates:tournament:tourney-1']);
  });

  it('a failed tournament lookup after a committed delete still returns success (logged)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue({ ...mockTeam, match_id: 'm-1' } as never);
    mockMatchStatus('scheduled');
    vi.mocked(deleteTeam).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockRejectedValue(new Error('tournament read failed'));

    const res = await DELETE({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(deleteTeam).toHaveBeenCalledWith('a270be7b-7033-4b49-808c-bf2d5ef8e0ed', { correction: false });
    expect(expirePublicTags).toHaveBeenCalledWith(['aggregates:all_time', 'aggregates:tournament:tourney-1']);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('deletes unlocked team for owner', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getTeamById).mockResolvedValue(mockTeam as never);
    vi.mocked(deleteTeam).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(deleteTeam).toHaveBeenCalledWith('a270be7b-7033-4b49-808c-bf2d5ef8e0ed', { correction: false });
  });

  describe('a team linked to a COMPLETED match (lead ruling round 5)', () => {
    const linked = { ...mockTeam, match_id: 'm-1' };

    it('refuses the owner with 409 team_match_completed and deletes nothing', async () => {
      vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
      vi.mocked(getTeamById).mockResolvedValue(linked as never);
      mockMatchStatus('completed');

      const res = await DELETE({} as NextRequest, routeParams);

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('team_match_completed');
      expect(deleteTeam).not.toHaveBeenCalled();
      expect(expirePublicTags).not.toHaveBeenCalled();
    });

    it('lets a site admin delete it as a correction', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'admin-1', isAdmin: true } as never);
      vi.mocked(getTeamById).mockResolvedValue(linked as never);
      vi.mocked(deleteTeam).mockResolvedValue(undefined as never);
      vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourney-1', season_id: 'season-1' } as never);

      const res = await DELETE({} as NextRequest, routeParams);

      expect(res.status).toBe(200);
      expect(deleteTeam).toHaveBeenCalledWith('a270be7b-7033-4b49-808c-bf2d5ef8e0ed', { correction: true });
      expect(getTeamVisibilityFacts).not.toHaveBeenCalled();
      expect(expirePublicTags).toHaveBeenCalledWith(expect.arrayContaining(['season:season-1']));
    });

    it('a completion racing the delete: the database refusal answers the same 409', async () => {
      vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
      vi.mocked(getTeamById).mockResolvedValue(linked as never);
      mockMatchStatus('pending_confirmation');
      vi.mocked(deleteTeam).mockRejectedValue(new TeamMatchCompletedError());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await DELETE({} as NextRequest, routeParams);

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('team_match_completed');
      consoleError.mockRestore();
    });
  });
});

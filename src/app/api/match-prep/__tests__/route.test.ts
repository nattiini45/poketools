import { makeSet } from '@/test/team-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

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

vi.mock('@/lib/api/error-response', async () => {
  const { AuthError } = await import('@/lib/auth/helpers');
  const { UserFacingError } = await import('@/lib/api/user-facing-error');
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: vi.fn((err: unknown, fallback: string) => {
      if (err instanceof UserFacingError) {
        return NextResponse.json(
          { success: false, error: err.message },
          { status: err.statusCode }
        );
      }
      if (err instanceof AuthError) {
        return NextResponse.json(
          { success: false, error: (err as InstanceType<typeof AuthError>).message },
          { status: (err as InstanceType<typeof AuthError>).statusCode }
        );
      }
      return NextResponse.json({ success: false, error: fallback }, { status: 500 });
    }),
  };
});

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/season/format-utils', () => ({
  isEvolutionPointBuy: vi.fn(() => false),
}));

vi.mock('@/lib/draft/epb-team-validation', () => ({
  assertNoSuspendedLinesInTeam: vi.fn(),
  assertEpbTeamCompliant: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({
  getMatchPrepTeam: vi.fn(),
  upsertMatchPrepTeam: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  upsertTeamForMatch: vi.fn(),
}));

vi.mock('@/lib/team/item-usage-cache', () => ({
  expireItemUsageReads: vi.fn(),
}));

// --------------- imports (after mocks) ---------------

import { GET, POST } from '@/app/api/match-prep/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { assertEpbTeamCompliant, assertNoSuspendedLinesInTeam } from '@/lib/draft/epb-team-validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getMatchPrepTeam, upsertMatchPrepTeam } from '@/lib/supabase/queries/match-prep-teams';
import { upsertTeamForMatch } from '@/lib/supabase/queries/teams';
import { expireItemUsageReads } from '@/lib/team/item-usage-cache';

// --------------- helpers ---------------

const MATCH_ID = '00000000-0000-4000-8000-000000000001';
const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000002';
const P1_ID = '00000000-0000-4000-8000-000000000010';
const P2_ID = '00000000-0000-4000-8000-000000000020';
const OUTSIDER_ID = '00000000-0000-4000-8000-000000000030';
const ADMIN_ID = '00000000-0000-4000-8000-000000000040';

function makeGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/match-prep');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return { nextUrl: url, url: url.toString() } as unknown as NextRequest;
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

const match = {
  id: MATCH_ID,
  tournament_id: TOURNAMENT_ID,
  round_id: '00000000-0000-4000-8000-000000000003',
  player_1_id: P1_ID,
  player_2_id: P2_ID,
};

const tournament = {
  id: TOURNAMENT_ID,
  season_id: '00000000-0000-4000-8000-000000000004',
  season_format_type: 'singles',
};

const pokemon = [
  makeSet('Pikachu', { moves: ['Thunderbolt'] }),
  makeSet('Charizard', { moves: ['Flamethrower'] }),
];

// --------------- GET tests ---------------

describe('GET /api/match-prep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: P1_ID,
      name: 'Alice',
      isAdmin: false,
    } as never);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

    const response = await GET(makeGetRequest({ match_id: MATCH_ID }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });

  it('returns 400 when match_id is missing', async () => {
    const response = await GET(makeGetRequest());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('match_id');
    expect(payload.code).toBe('MISSING_PARAM');
    expect(payload.params).toEqual({ name: 'match_id' });
  });

  it('returns the prep team for the current player', async () => {
    const prep = { match_id: MATCH_ID, player_id: P1_ID, pokemon };
    vi.mocked(getMatchPrepTeam).mockResolvedValue(prep as never);

    const response = await GET(makeGetRequest({ match_id: MATCH_ID }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(prep);
    expect(getMatchPrepTeam).toHaveBeenCalledWith(MATCH_ID, P1_ID);
  });

  it('returns null when no prep team exists', async () => {
    vi.mocked(getMatchPrepTeam).mockResolvedValue(null as never);

    const response = await GET(makeGetRequest({ match_id: MATCH_ID }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toBeNull();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getMatchPrepTeam).mockRejectedValue(new Error('db'));

    const response = await GET(makeGetRequest({ match_id: MATCH_ID }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});

// --------------- POST tests ---------------

describe('POST /api/match-prep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: P1_ID,
      name: 'Alice',
      isAdmin: false,
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(upsertTeamForMatch).mockResolvedValue(undefined as never);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
    }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });

  it('returns 400 when match_id is missing', async () => {
    const response = await POST(makePostRequest({ pokemon, import_source: 'manual' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('match_id');
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
  });

  it('returns 400 when pokemon is missing', async () => {
    const response = await POST(makePostRequest({ match_id: MATCH_ID, import_source: 'manual' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('pokemon');
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
  });

  it('returns 400 for a malformed set and registers nothing', async () => {
    const response = await POST(
      makePostRequest({ match_id: MATCH_ID, pokemon: [{ ...makeSet('Pikachu'), evs: undefined }], import_source: 'manual' }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('validation_failed');
    expect(upsertMatchPrepTeam).not.toHaveBeenCalled();
  });

  it('returns 404 when match does not exist', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
    }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('match_not_found');
  });

  it('returns 403 when player is not a match participant and not admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: OUTSIDER_ID,
      name: 'Eve',
      isAdmin: false,
    } as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('not a participant');
    expect(payload.code).toBe('match_prep_not_participant');
  });

  it('saves the prep team for the current player', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    const savedPrep = { match_id: MATCH_ID, player_id: P1_ID, pokemon };
    vi.mocked(upsertMatchPrepTeam).mockResolvedValue(savedPrep as never);

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(savedPrep);
    expect(upsertMatchPrepTeam).toHaveBeenCalledWith(MATCH_ID, P1_ID, pokemon, 'manual');
    expect(upsertTeamForMatch).toHaveBeenCalledWith(P1_ID, MATCH_ID, TOURNAMENT_ID, pokemon, 'manual', { correction: false });
  });

  it('refuses a participant rewrite once the match is completed (409, nothing written)', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed' } as never);

    const response = await POST(makePostRequest({ match_id: MATCH_ID, pokemon }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      success: false,
      error: 'This match is completed; its registered team can no longer be changed',
      code: 'match_prep_match_completed',
    });
    expect(upsertMatchPrepTeam).not.toHaveBeenCalled();
    expect(upsertTeamForMatch).not.toHaveBeenCalled();
  });

  it('expires the item-usage cache when an admin rewrites a COMPLETED match row (H9)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: P1_ID, name: 'Alice', isAdmin: true } as never);
    vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed' } as never);
    vi.mocked(upsertMatchPrepTeam).mockResolvedValue({ match_id: MATCH_ID } as never);
    const synced = { id: 'team-1', match_id: MATCH_ID, tournament_id: TOURNAMENT_ID };
    vi.mocked(upsertTeamForMatch).mockResolvedValue(synced as never);

    const response = await POST(makePostRequest({ match_id: MATCH_ID, pokemon }));

    expect(response.status).toBe(200);
    // The admin rewrite is a correction: the database lock on completed rosters lets only it through.
    expect(upsertTeamForMatch).toHaveBeenCalledWith(P1_ID, MATCH_ID, TOURNAMENT_ID, pokemon, 'manual', { correction: true });
    expect(expireItemUsageReads).toHaveBeenCalledWith(synced, 'api/match-prep');
  });

  it('does not expire the item-usage cache for a match that is not completed', async () => {
    vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'scheduled' } as never);
    vi.mocked(upsertMatchPrepTeam).mockResolvedValue({ match_id: MATCH_ID } as never);
    vi.mocked(upsertTeamForMatch).mockResolvedValue({ id: 'team-1', match_id: MATCH_ID } as never);

    const response = await POST(makePostRequest({ match_id: MATCH_ID, pokemon }));

    expect(response.status).toBe(200);
    expect(expireItemUsageReads).not.toHaveBeenCalled();
  });

  it('does not expire the item-usage cache when the locked row was not rewritten', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: P1_ID, name: 'Alice', isAdmin: true } as never);
    vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'completed' } as never);
    vi.mocked(upsertMatchPrepTeam).mockResolvedValue({ match_id: MATCH_ID } as never);
    vi.mocked(upsertTeamForMatch).mockResolvedValue(null);

    const response = await POST(makePostRequest({ match_id: MATCH_ID, pokemon }));

    expect(response.status).toBe(200);
    expect(expireItemUsageReads).not.toHaveBeenCalled();
  });

  it('allows admins to save for a different participant', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: ADMIN_ID,
      name: 'Admin',
      isAdmin: true,
    } as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(upsertMatchPrepTeam).mockResolvedValue({
      match_id: MATCH_ID,
      player_id: P2_ID,
      pokemon,
    } as never);

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'pokepastes',
      player_id: P2_ID,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(upsertMatchPrepTeam).toHaveBeenCalledWith(MATCH_ID, P2_ID, pokemon, 'pokepastes');
    expect(upsertTeamForMatch).toHaveBeenCalledWith(P2_ID, MATCH_ID, TOURNAMENT_ID, pokemon, 'pokepastes', { correction: true });
  });

  it('returns 400 when admin specifies a non-participant as target', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: ADMIN_ID,
      name: 'Admin',
      isAdmin: true,
    } as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
      player_id: OUTSIDER_ID,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('not a participant');
    expect(payload.code).toBe('match_prep_target_not_participant');
  });

  it('does not fail if upsertTeamForMatch throws (non-fatal sync)', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(upsertMatchPrepTeam).mockResolvedValue({
      match_id: MATCH_ID,
      player_id: P1_ID,
      pokemon,
    } as never);
    vi.mocked(upsertTeamForMatch).mockRejectedValue(new Error('sync failed'));

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
    }));
    const payload = await response.json();

    // Should still succeed despite sync error
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
  });

  it('rejects an invalid EPB team with 400 even when the round is missing (no matchday bypass)', async () => {
    // Regression: assertEpbTeamCompliant must run for EVERY EPB team, not only
    // when a matchday is known. A missing round (null) / undefined round_number
    // must NOT let an invalid EPB team slip through to persistence.
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(isEvolutionPointBuy).mockReturnValue(true);
    // No round → matchday is undefined. The suspension check is skipped, but
    // EPB compliance must still run and reject the team.
    vi.mocked(getRoundById).mockResolvedValue(null as never);
    vi.mocked(assertEpbTeamCompliant).mockRejectedValue(
      new UserFacingError('Baton Pass is banned by the season format rules')
    );

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('Baton Pass is banned');
    // EPB compliance must have run (it's what threw) …
    expect(assertEpbTeamCompliant).toHaveBeenCalledWith(
      tournament.season_id,
      P1_ID,
      pokemon
    );
    // … and the matchday-dependent suspension check must have been skipped.
    expect(vi.mocked(assertNoSuspendedLinesInTeam)).not.toHaveBeenCalled();
    // Persistence must never have been reached.
    expect(upsertMatchPrepTeam).not.toHaveBeenCalled();
    expect(upsertTeamForMatch).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('db'));

    const response = await POST(makePostRequest({
      match_id: MATCH_ID,
      pokemon,
      import_source: 'manual',
    }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});

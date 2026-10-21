import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Error codes of the team library and share-link routes (i18n-core §4.1,
 * package A2). The English `error` text is unchanged; every failure branch
 * also carries `success: false` and a catalog `code` the client translates.
 */

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

vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 })),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamById: vi.fn(),
  getTeamByShareToken: vi.fn(),
  listLibraryTeams: vi.fn(),
  publishTeamToLibrary: vi.fn(),
  unpublishTeamFromLibrary: vi.fn(),
  forkTeam: vi.fn(),
  setTeamShareToken: vi.fn(),
  disableTeamShareToken: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
}));

// The real visibility module runs (fork gate, share view): only the queries
// are mocked.

import { POST as publish, DELETE as unpublish } from '@/app/api/teams/library/route';
import { POST as fork } from '@/app/api/teams/library/fork/route';
import { GET as getLibraryEntry } from '@/app/api/teams/library/[id]/route';
import { POST as createShare, DELETE as disableShare } from '@/app/api/teams/share/route';
import { GET as getShared } from '@/app/api/teams/shared/[token]/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { GET as listLibrary } from '@/app/api/teams/library/route';
import {
  getTeamById,
  getTeamByShareToken,
  setTeamShareToken,
  disableTeamShareToken,
  forkTeam,
  listLibraryTeams,
  publishTeamToLibrary,
} from '@/lib/supabase/queries/teams';
import errorsTeamsEn from '@/i18n/messages/errors/teams/en';
import errorsTeamsDe from '@/i18n/messages/errors/teams/de';
import {
  expectNoPrivateTeamData,
  PRIVATE_TEAM_SENTINELS,
  teamRowWithShareSecrets,
} from '@/lib/team/__tests__/private-team-fields';

const TEAM_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_TEAM_ID = '00000000-0000-4000-8000-000000000002';
const SHARE_TOKEN = '00000000-0000-4000-8000-0000000000aa';

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

function jsonRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost:3000/api/teams/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function read(res: Response) {
  return (await res.json()) as {
    success?: boolean;
    error?: string;
    code?: string;
    params?: Record<string, string | number>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
});

describe('POST/DELETE /api/teams/library', () => {
  it('sends validation_failed with the issues as params', async () => {
    const body = await read(await publish(jsonRequest({})));
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('sends team_not_found when publishing an unknown team', async () => {
    vi.mocked(getTeamById).mockResolvedValue(null);
    const res = await publish(jsonRequest({ teamId: TEAM_ID }));
    const body = await read(res);
    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Team not found', code: 'team_not_found' });
  });

  it('sends team_not_found when unpublishing an unknown team', async () => {
    vi.mocked(getTeamById).mockResolvedValue(null);
    const res = await unpublish(jsonRequest({ teamId: TEAM_ID }));
    expect(res.status).toBe(404);
    expect((await read(res)).code).toBe('team_not_found');
  });
});

describe('POST /api/teams/library/fork', () => {
  it('sends team_fork_source_not_found for an unknown source', async () => {
    vi.mocked(getTeamById).mockResolvedValue(null);
    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID }));
    expect(res.status).toBe(404);
    expect(await read(res)).toEqual({
      success: false,
      error: 'Source team not found',
      code: 'team_fork_source_not_found',
    });
  });

  it('sends team_fork_source_private for an unpublished team without a share token', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'owner-9' }));
    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID }));
    expect(res.status).toBe(403);
    const body = await read(res);
    expect(body.error).toBe('Source team is not publicly accessible');
    expect(body.code).toBe('team_fork_source_private');
    // A shared team is not forkable by id alone (C1): no token, no lookup, no copy.
    expect(getTeamByShareToken).not.toHaveBeenCalled();
    expect(forkTeam).not.toHaveBeenCalled();
  });

  it('sends team_fork_share_token_invalid when the token belongs to another team', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'owner-9' }));
    vi.mocked(getTeamByShareToken).mockResolvedValue(teamRowWithShareSecrets({ id: OTHER_TEAM_ID }));
    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID, shareToken: SHARE_TOKEN }));
    expect(res.status).toBe(403);
    expect(await read(res)).toEqual({
      success: false,
      error: 'Share link does not match the source team or is disabled',
      code: 'team_fork_share_token_invalid',
    });
    expect(forkTeam).not.toHaveBeenCalled();
  });

  it('sends team_fork_share_token_invalid for a disabled or unknown token', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'owner-9' }));
    vi.mocked(getTeamByShareToken).mockResolvedValue(null);
    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID, shareToken: SHARE_TOKEN }));
    expect(res.status).toBe(403);
    expect((await read(res)).code).toBe('team_fork_share_token_invalid');
  });

  it('forks a shared team with its matching token, returning a PublicTeam', async () => {
    const source = teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'owner-9' });
    vi.mocked(getTeamById).mockResolvedValue(source);
    vi.mocked(getTeamByShareToken).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID }));
    vi.mocked(forkTeam).mockResolvedValue(
      teamRowWithShareSecrets({ id: 'fork-1', player_id: 'player-1', forked_from_team_id: TEAM_ID }),
    );

    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID, shareToken: SHARE_TOKEN }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getTeamByShareToken).toHaveBeenCalledWith(SHARE_TOKEN);
    expect(forkTeam).toHaveBeenCalledWith(source, 'player-1');
    expect(body.team.id).toBe('fork-1');
    expectNoPrivateTeamData(body);
  });

  it('forks a library-published team without a token', async () => {
    const source = teamRowWithShareSecrets({ id: TEAM_ID, library_published_at: '2026-01-01T00:00:00Z' });
    vi.mocked(getTeamById).mockResolvedValue(source);
    vi.mocked(forkTeam).mockResolvedValue(teamRowWithShareSecrets({ id: 'fork-1', player_id: 'player-1' }));

    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID }));

    expect(res.status).toBe(200);
    expect(forkTeam).toHaveBeenCalledWith(source, 'player-1');
    expectNoPrivateTeamData(await res.json());
  });

  it('rejects a tournamentId (a fork never enters a tournament) with validation_failed', async () => {
    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID, tournamentId: OTHER_TEAM_ID }));
    expect(res.status).toBe(400);
    expect((await read(res)).code).toBe('validation_failed');
    expect(getTeamById).not.toHaveBeenCalled();
  });

  it('rejects a share token that is not a UUID with validation_failed', async () => {
    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID, shareToken: 'zz,share_token.neq.x' }));
    expect(res.status).toBe(400);
    expect((await read(res)).code).toBe('validation_failed');
  });
});

describe('GET /api/teams/library (L1 boundary)', () => {
  function listRequest(query: string): NextRequest {
    return new Request(`http://localhost:3000/api/teams/library${query}`) as unknown as NextRequest;
  }

  it('sends validation_failed for a search over 200 characters, without a query', async () => {
    const res = await listLibrary(listRequest(`?search=${'a'.repeat(201)}`));
    expect(res.status).toBe(400);
    const body = await read(res);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(listLibraryTeams).not.toHaveBeenCalled();
  });

  it('passes a trimmed search with PostgREST punctuation through to the query', async () => {
    vi.mocked(listLibraryTeams).mockResolvedValue({ data: [], total: 0 });
    const res = await listLibrary(listRequest(`?search=${encodeURIComponent('  rain, (sun)  ')}&tags=ou,doubles`));
    expect(res.status).toBe(200);
    expect(listLibraryTeams).toHaveBeenCalledWith({
      search: 'rain, (sun)',
      tags: ['ou', 'doubles'],
      limit: 50,
      offset: 0,
    });
  });

  it('publishing returns a PublicTeam (no share columns)', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'player-1' }));
    vi.mocked(publishTeamToLibrary).mockResolvedValue(
      teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'player-1', library_published_at: '2026-01-01T00:00:00Z' }),
    );
    const res = await publish(jsonRequest({ teamId: TEAM_ID, title: 'Rain' }));
    expect(res.status).toBe(200);
    expectNoPrivateTeamData(await res.json());
  });
});

describe('GET /api/teams/library/[id]', () => {
  it('sends team_library_entry_not_found for an unpublished team', async () => {
    vi.mocked(getTeamById).mockResolvedValue({ id: TEAM_ID, library_published_at: null } as never);
    const res = await getLibraryEntry({} as NextRequest, { params: Promise.resolve({ id: TEAM_ID }) });
    expect(res.status).toBe(404);
    expect(await read(res)).toEqual({
      success: false,
      error: 'Team not found or not published',
      code: 'team_library_entry_not_found',
    });
  });
});

describe('POST/DELETE /api/teams/share', () => {
  it('sends team_not_found for an unknown team', async () => {
    vi.mocked(getTeamById).mockResolvedValue(null);
    const res = await createShare(jsonRequest({ teamId: TEAM_ID }));
    expect(res.status).toBe(404);
    expect((await read(res)).code).toBe('team_not_found');

    const del = await disableShare(jsonRequest({ teamId: TEAM_ID }));
    expect(del.status).toBe(404);
    expect((await read(del)).code).toBe('team_not_found');
  });

  it('returns the new token and URL to the owner (the only response that carries a token)', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'player-1' }));
    vi.mocked(setTeamShareToken).mockResolvedValue({
      team_id: TEAM_ID,
      share_token: SHARE_TOKEN,
      share_enabled_at: '2026-10-18T00:00:00Z',
    });
    const res = await createShare(jsonRequest({ teamId: TEAM_ID }, { origin: 'https://poke.example' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      shareToken: SHARE_TOKEN,
      shareUrl: `https://poke.example/teams/shared/${SHARE_TOKEN}`,
    });
  });

  it('refuses another player (403 forbidden) without touching the share link', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'owner-9' }));
    const res = await createShare(jsonRequest({ teamId: TEAM_ID }));
    expect(res.status).toBe(403);
    expect((await read(res)).code).toBe('forbidden');
    expect(setTeamShareToken).not.toHaveBeenCalled();

    const del = await disableShare(jsonRequest({ teamId: TEAM_ID }));
    expect(del.status).toBe(403);
    expect(disableTeamShareToken).not.toHaveBeenCalled();
  });

  it('disables the link for the owner', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'player-1' }));
    vi.mocked(disableTeamShareToken).mockResolvedValue(undefined);
    const res = await disableShare(jsonRequest({ teamId: TEAM_ID }));
    expect(res.status).toBe(200);
    expect(disableTeamShareToken).toHaveBeenCalledWith(TEAM_ID);
  });

  it('sends team_share_site_url_missing when no origin or site URL is known', async () => {
    vi.mocked(getTeamById).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1' } as never);
    vi.mocked(setTeamShareToken).mockResolvedValue({
      team_id: TEAM_ID,
      share_token: SHARE_TOKEN,
      share_enabled_at: '2026-10-18T00:00:00Z',
    });
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    try {
      const res = await createShare(jsonRequest({ teamId: TEAM_ID }));
      expect(res.status).toBe(500);
      const body = await read(res);
      expect(body.error).toBe('Server misconfiguration: site URL not set');
      expect(body.code).toBe('team_share_site_url_missing');
      // The link is never enabled behind the error response.
      expect(setTeamShareToken).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('sends validation_failed for a body without teamId', async () => {
    const body = await read(await disableShare(jsonRequest({})));
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });
});

describe('GET /api/teams/shared/[token]', () => {
  it('sends team_share_token_invalid for an empty token', async () => {
    const res = await getShared({} as NextRequest, { params: Promise.resolve({ token: '' }) });
    expect(res.status).toBe(400);
    expect(await read(res)).toEqual({ success: false, error: 'Invalid token', code: 'team_share_token_invalid' });
  });

  it('sends team_share_token_invalid for a token that is not a UUID, without a query', async () => {
    const res = await getShared({} as NextRequest, { params: Promise.resolve({ token: 'nope' }) });
    expect(res.status).toBe(400);
    expect((await read(res)).code).toBe('team_share_token_invalid');
    expect(getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('sends team_shared_not_found for an unknown or disabled token', async () => {
    vi.mocked(getTeamByShareToken).mockResolvedValue(null);
    const res = await getShared({} as NextRequest, { params: Promise.resolve({ token: SHARE_TOKEN }) });
    expect(res.status).toBe(404);
    expect((await read(res)).code).toBe('team_shared_not_found');
  });

  it('returns the full roster of an enabled link, but never the token', async () => {
    const team = teamRowWithShareSecrets({ id: TEAM_ID });
    vi.mocked(getTeamByShareToken).mockResolvedValue(team);
    const res = await getShared({} as NextRequest, { params: Promise.resolve({ token: SHARE_TOKEN }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.team.pokemon).toEqual(team.pokemon);
    expectNoPrivateTeamData(body);
    expect(JSON.stringify(body)).not.toContain(PRIVATE_TEAM_SENTINELS.share_token);
  });
});

describe('errors/teams catalog', () => {
  it('keeps each English message equal to the server text it translates', () => {
    expect(errorsTeamsEn.team_not_found).toBe('Team not found');
    expect(errorsTeamsEn.team_shared_not_found).toBe('Team not found or link expired');
    expect(errorsTeamsEn.team_fork_source_private).toBe('Source team is not publicly accessible');
    expect(errorsTeamsEn.team_fork_share_token_invalid).toBe(
      'Share link does not match the source team or is disabled',
    );
    expect(errorsTeamsDe.team_fork_share_token_invalid).toBeTruthy();
  });
});

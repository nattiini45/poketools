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

vi.mock('@/lib/team/visibility', () => ({
  filterLibraryEntryForDisplay: vi.fn((entry: unknown) => entry),
  filterTeamForShare: vi.fn((team: unknown) => team),
}));

import { POST as publish, DELETE as unpublish } from '@/app/api/teams/library/route';
import { POST as fork } from '@/app/api/teams/library/fork/route';
import { GET as getLibraryEntry } from '@/app/api/teams/library/[id]/route';
import { POST as createShare, DELETE as disableShare } from '@/app/api/teams/share/route';
import { GET as getShared } from '@/app/api/teams/shared/[token]/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getTeamById, getTeamByShareToken, setTeamShareToken } from '@/lib/supabase/queries/teams';
import errorsTeamsEn from '@/i18n/messages/errors/teams/en';

const TEAM_ID = '00000000-0000-4000-8000-000000000001';

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

  it('sends team_fork_source_private for a team that is neither published nor shared', async () => {
    vi.mocked(getTeamById).mockResolvedValue({
      id: TEAM_ID,
      library_published_at: null,
      share_enabled_at: null,
    } as never);
    const res = await fork(jsonRequest({ sourceTeamId: TEAM_ID }));
    expect(res.status).toBe(403);
    const body = await read(res);
    expect(body.error).toBe('Source team is not publicly accessible');
    expect(body.code).toBe('team_fork_source_private');
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

  it('sends team_share_site_url_missing when no origin or site URL is known', async () => {
    vi.mocked(getTeamById).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1' } as never);
    vi.mocked(setTeamShareToken).mockResolvedValue({ share_token: 'tok' } as never);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    try {
      const res = await createShare(jsonRequest({ teamId: TEAM_ID }));
      expect(res.status).toBe(500);
      const body = await read(res);
      expect(body.error).toBe('Server misconfiguration: site URL not set');
      expect(body.code).toBe('team_share_site_url_missing');
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

  it('sends team_shared_not_found for an unknown or disabled token', async () => {
    vi.mocked(getTeamByShareToken).mockResolvedValue(null);
    const res = await getShared({} as NextRequest, { params: Promise.resolve({ token: 'nope' }) });
    expect(res.status).toBe(404);
    expect((await read(res)).code).toBe('team_shared_not_found');
  });
});

describe('errors/teams catalog', () => {
  it('keeps each English message equal to the server text it translates', () => {
    expect(errorsTeamsEn.team_not_found).toBe('Team not found');
    expect(errorsTeamsEn.team_shared_not_found).toBe('Team not found or link expired');
    expect(errorsTeamsEn.team_fork_source_private).toBe('Source team is not publicly accessible');
  });
});

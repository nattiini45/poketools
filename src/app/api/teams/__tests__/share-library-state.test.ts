import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Characterization of the share-link (`teams.share_token` + `share_enabled_at`) and library-publication
 * (`teams.library_published_at`) routes: every move the owner can make today, from either state. The machines are
 * `team.share` and `team.library` (src/lib/team/team-share-state.ts, docs/state-machines.md).
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
  listLibraryTeams: vi.fn(),
  publishTeamToLibrary: vi.fn(),
  unpublishTeamFromLibrary: vi.fn(),
  setTeamShareToken: vi.fn(),
  disableTeamShareToken: vi.fn(),
}));

import { POST as publish, DELETE as unpublish } from '@/app/api/teams/library/route';
import { POST as createShare, DELETE as disableShare } from '@/app/api/teams/share/route';
import { requirePlayer } from '@/lib/auth/helpers';
import {
  getTeamById,
  publishTeamToLibrary,
  unpublishTeamFromLibrary,
  setTeamShareToken,
  disableTeamShareToken,
} from '@/lib/supabase/queries/teams';
import { teamRowWithShareSecrets } from '@/lib/team/__tests__/private-team-fields';

const TEAM_ID = '00000000-0000-4000-8000-000000000001';
const TOKEN_A = '00000000-0000-4000-8000-0000000000aa';
const TOKEN_B = '00000000-0000-4000-8000-0000000000bb';

const owner = {
  playerId: 'player-1',
  name: 'Ash',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

function jsonRequest(body: unknown, method = 'POST'): NextRequest {
  return new Request('http://localhost:3000/api/teams/x', {
    method,
    headers: { 'Content-Type': 'application/json', origin: 'https://poke.example' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(owner as never);
});

describe('share link (characterization)', () => {
  it('generating again rotates the link: each POST mints a new token and answers 200', async () => {
    vi.mocked(getTeamById).mockResolvedValue(teamRowWithShareSecrets({ id: TEAM_ID, player_id: 'player-1' }));
    vi.mocked(setTeamShareToken)
      .mockResolvedValueOnce({ team_id: TEAM_ID, share_token: TOKEN_A, share_enabled_at: '2026-11-01T00:00:00Z' })
      .mockResolvedValueOnce({ team_id: TEAM_ID, share_token: TOKEN_B, share_enabled_at: '2026-11-02T00:00:00Z' });

    const first = await createShare(jsonRequest({ teamId: TEAM_ID }));
    const second = await createShare(jsonRequest({ teamId: TEAM_ID }));

    expect((await first.json()).shareToken).toBe(TOKEN_A);
    expect((await second.json()).shareToken).toBe(TOKEN_B);
    expect(setTeamShareToken).toHaveBeenCalledTimes(2);
  });

  it('disabling a team that has no link answers 200 (idempotent)', async () => {
    vi.mocked(getTeamById).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1' } as never);
    vi.mocked(disableTeamShareToken).mockResolvedValue(undefined);

    const res = await disableShare(jsonRequest({ teamId: TEAM_ID }, 'DELETE'));

    expect(res.status).toBe(200);
    expect(disableTeamShareToken).toHaveBeenCalledWith(TEAM_ID);
  });

  it('an admin manages the link of another player', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...owner, playerId: 'admin-1', isAdmin: true } as never);
    vi.mocked(getTeamById).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1' } as never);
    vi.mocked(setTeamShareToken).mockResolvedValue({ team_id: TEAM_ID, share_token: TOKEN_A, share_enabled_at: '2026-11-01T00:00:00Z' });
    vi.mocked(disableTeamShareToken).mockResolvedValue(undefined);

    expect((await createShare(jsonRequest({ teamId: TEAM_ID }))).status).toBe(200);
    expect((await disableShare(jsonRequest({ teamId: TEAM_ID }, 'DELETE'))).status).toBe(200);
  });
});

describe('library publication (characterization)', () => {
  it('publishes an unpublished team', async () => {
    vi.mocked(getTeamById).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1', library_published_at: null } as never);
    vi.mocked(publishTeamToLibrary).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1', library_published_at: '2026-11-01T00:00:00Z' } as never);

    const res = await publish(jsonRequest({ teamId: TEAM_ID, title: 'Rain' }));

    expect(res.status).toBe(200);
    expect(publishTeamToLibrary).toHaveBeenCalledTimes(1);
  });

  it('publishing an already published team answers 200 and rewrites the entry', async () => {
    vi.mocked(getTeamById).mockResolvedValue({
      id: TEAM_ID,
      player_id: 'player-1',
      library_published_at: '2026-10-01T00:00:00Z',
      library_title: 'Old',
    } as never);
    vi.mocked(publishTeamToLibrary).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1', library_published_at: '2026-11-01T00:00:00Z' } as never);

    const res = await publish(jsonRequest({ teamId: TEAM_ID, title: 'New' }));

    expect(res.status).toBe(200);
    expect(vi.mocked(publishTeamToLibrary).mock.calls[0][0]).toBe(TEAM_ID);
    expect(vi.mocked(publishTeamToLibrary).mock.calls[0][1]).toEqual({ title: 'New', description: undefined, tags: undefined });
  });

  it('publishes a team linked to a match that is not played yet (open product question: kept as is)', async () => {
    vi.mocked(getTeamById).mockResolvedValue({
      id: TEAM_ID,
      player_id: 'player-1',
      tournament_id: 'tourney-1',
      match_id: 'match-1',
      library_published_at: null,
    } as never);
    vi.mocked(publishTeamToLibrary).mockResolvedValue({ id: TEAM_ID, player_id: 'player-1', library_published_at: '2026-11-01T00:00:00Z' } as never);

    const res = await publish(jsonRequest({ teamId: TEAM_ID, title: 'Prep' }));

    expect(res.status).toBe(200);
  });

  it('unpublishes a published team, and unpublishing an unpublished team answers 200 too', async () => {
    vi.mocked(unpublishTeamFromLibrary).mockResolvedValue({ id: TEAM_ID } as never);
    vi.mocked(getTeamById).mockResolvedValueOnce({ id: TEAM_ID, player_id: 'player-1', library_published_at: '2026-10-01T00:00:00Z' } as never);
    expect((await unpublish(jsonRequest({ teamId: TEAM_ID }, 'DELETE'))).status).toBe(200);

    vi.mocked(getTeamById).mockResolvedValueOnce({ id: TEAM_ID, player_id: 'player-1', library_published_at: null } as never);
    expect((await unpublish(jsonRequest({ teamId: TEAM_ID }, 'DELETE'))).status).toBe(200);
    expect(unpublishTeamFromLibrary).toHaveBeenCalledTimes(2);
  });

  it('refuses another player (403) without writing', async () => {
    vi.mocked(getTeamById).mockResolvedValue({ id: TEAM_ID, player_id: 'owner-9', library_published_at: null } as never);

    expect((await publish(jsonRequest({ teamId: TEAM_ID, title: 'Rain' }))).status).toBe(403);
    expect((await unpublish(jsonRequest({ teamId: TEAM_ID }, 'DELETE'))).status).toBe(403);
    expect(publishTeamToLibrary).not.toHaveBeenCalled();
    expect(unpublishTeamFromLibrary).not.toHaveBeenCalled();
  });
});

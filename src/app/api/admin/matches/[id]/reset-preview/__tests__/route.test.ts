import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { requirePlayer: vi.fn(), AuthError };
});

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  previewMatchReset: vi.fn(),
}));

import { GET } from '@/app/api/admin/matches/[id]/reset-preview/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { previewMatchReset } from '@/lib/pkmn/game-pipeline';

const MATCH_ID = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const routeParams = { params: Promise.resolve({ id: MATCH_ID }) };
const request = {} as NextRequest;

const leagueOfTournament: Record<string, string> = { 'tourn-in-league-a': 'league-a' };
const leaguesOfAdmin: Record<string, string[]> = { 'league-admin-a': ['league-a'], 'league-admin-b': ['league-b'] };

describe('GET /api/admin/matches/[id]/reset-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'admin-1', name: 'Admin', isAdmin: true } as never);
    vi.mocked(getMatchById).mockResolvedValue({
      id: MATCH_ID,
      tournament_id: 'tourn-in-league-a',
      status: 'completed',
    } as never);
    vi.mocked(isResourceAdminFor).mockImplementation(async (playerId, _type, tournamentId) =>
      (leaguesOfAdmin[playerId] ?? []).includes(leagueOfTournament[tournamentId])
    );
  });

  describe('access', () => {
    it('answers 401 when the guard rejects an anonymous caller', async () => {
      vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

      expect((await GET(request, routeParams)).status).toBe(401);
      expect(previewMatchReset).not.toHaveBeenCalled();
    });

    it('answers 403 for a player who is no admin', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p9', name: 'Pat', isAdmin: false } as never);

      expect((await GET(request, routeParams)).status).toBe(403);
      expect(previewMatchReset).not.toHaveBeenCalled();
    });

    it('lets a resource admin of the match league in', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'league-admin-a', name: 'LA', isAdmin: false } as never);
      vi.mocked(previewMatchReset).mockResolvedValue({ games_to_delete: 0, was_completed: false, downstream: [] });

      expect((await GET(request, routeParams)).status).toBe(200);
    });

    it('answers 403 for a resource admin of another league', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'league-admin-b', name: 'LB', isAdmin: false } as never);

      const res = await GET(request, routeParams);

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('forbidden');
      expect(previewMatchReset).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown match', async () => {
      vi.mocked(getMatchById).mockResolvedValue(null);

      expect((await GET(request, routeParams)).status).toBe(404);
      expect(previewMatchReset).not.toHaveBeenCalled();
    });
  });

  describe('response', () => {
    it('returns the games, the completed flag and the downstream list', async () => {
      const preview = {
        games_to_delete: 2,
        was_completed: true,
        downstream: [
          { id: 'm-final', player_1_name: 'Alice', player_2_name: 'Cara', status: 'completed', round_name: 'Finals' },
        ],
      };
      vi.mocked(previewMatchReset).mockResolvedValue(preview as never);

      const res = await GET(request, routeParams);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, data: preview });
      expect(previewMatchReset).toHaveBeenCalledWith(MATCH_ID);
    });

    it('returns zeros for a scheduled match', async () => {
      vi.mocked(previewMatchReset).mockResolvedValue({ games_to_delete: 0, was_completed: false, downstream: [] });

      const body = await (await GET(request, routeParams)).json();

      expect(body.data).toEqual({ games_to_delete: 0, was_completed: false, downstream: [] });
    });

    it('answers 500 with the static fallback when the preview fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(previewMatchReset).mockRejectedValue(new Error('db down'));

      const res = await GET(request, routeParams);

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Failed to preview the match reset');
    });
  });
});

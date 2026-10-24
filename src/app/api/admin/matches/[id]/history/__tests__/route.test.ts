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

vi.mock('@/lib/audit/queries', () => ({
  listMatchAuditEvents: vi.fn(),
}));

import { GET } from '@/app/api/admin/matches/[id]/history/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { listMatchAuditEvents } from '@/lib/audit/queries';
import { toMatchHistoryEntry } from '@/lib/admin/match-detail';

const MATCH_ID = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const routeParams = { params: Promise.resolve({ id: MATCH_ID }) };
const match = { id: MATCH_ID, tournament_id: 'tourn-in-league-a', status: 'completed' };

function request(query = ''): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/admin/matches/${MATCH_ID}/history${query}`) } as unknown as NextRequest;
}

// Tournament -> league, and which league each resource admin runs: the same
// cascade isResourceAdminFor applies (a league admin administers its tournaments).
const leagueOfTournament: Record<string, string> = { 'tourn-in-league-a': 'league-a' };
const leaguesOfAdmin: Record<string, string[]> = { 'league-admin-a': ['league-a'], 'league-admin-b': ['league-b'] };

describe('GET /api/admin/matches/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'admin-1', name: 'Admin', isAdmin: true } as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(isResourceAdminFor).mockImplementation(async (playerId, _type, tournamentId) =>
      (leaguesOfAdmin[playerId] ?? []).includes(leagueOfTournament[tournamentId])
    );
    vi.mocked(listMatchAuditEvents).mockResolvedValue({ entries: [], total: 0, offset: 0, limit: 20 });
  });

  describe('access', () => {
    it('answers 401 when the guard rejects an anonymous caller', async () => {
      vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

      expect((await GET(request(), routeParams)).status).toBe(401);
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });

    it('answers 403 for a player who is no admin', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p9', name: 'Pat', isAdmin: false } as never);

      const res = await GET(request(), routeParams);

      expect(res.status).toBe(403);
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });

    it('lets a resource admin of the match league in', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'league-admin-a', name: 'LA', isAdmin: false } as never);

      const res = await GET(request(), routeParams);

      expect(res.status).toBe(200);
      expect(listMatchAuditEvents).toHaveBeenCalledTimes(1);
    });

    it('answers 403 for a resource admin of another league', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'league-admin-b', name: 'LB', isAdmin: false } as never);

      const res = await GET(request(), routeParams);

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('forbidden');
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown match', async () => {
      vi.mocked(getMatchById).mockResolvedValue(null);

      expect((await GET(request(), routeParams)).status).toBe(404);
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });
  });

  describe('paging', () => {
    it('defaults to the first page of 20', async () => {
      await GET(request(), routeParams);

      expect(listMatchAuditEvents).toHaveBeenCalledWith(MATCH_ID, { offset: 0, limit: 20 });
    });

    it('passes the offset and limit of the query string', async () => {
      await GET(request('?offset=40&limit=10'), routeParams);

      expect(listMatchAuditEvents).toHaveBeenCalledWith(MATCH_ID, { offset: 40, limit: 10 });
    });

    it.each([
      ['a negative offset', '?offset=-1'],
      ['an offset past 1000', '?offset=1001'],
      ['a zero limit', '?limit=0'],
      ['a limit over 50', '?limit=51'],
      ['a non-numeric limit', '?limit=abc'],
    ])('answers 400 validation_failed for %s', async (_label, query) => {
      const res = await GET(request(query), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });

    it('ignores unrelated query keys', async () => {
      await GET(request('?offset=20&unused=1'), routeParams);

      expect(listMatchAuditEvents).toHaveBeenCalledWith(MATCH_ID, { offset: 20, limit: 20 });
    });
  });

  describe('response', () => {
    it('returns the page as the data of the envelope, without any ip address', async () => {
      const entries = [
        toMatchHistoryEntry({
          id: 'a1',
          actor_id: 'admin-1',
          actor_name: 'Admin',
          action: 'match.reopen',
          resource_type: 'match',
          resource_id: MATCH_ID,
          resource_name: 'A vs B',
          changes: { status: { before: 'completed', after: 'in_progress' } },
          metadata: { reason: 'typo' },
          ip_address: '203.0.113.9',
          created_at: '2026-10-24T10:00:00Z',
        }),
      ];
      vi.mocked(listMatchAuditEvents).mockResolvedValue({ entries, total: 21, offset: 20, limit: 20 });

      const res = await GET(request('?offset=20'), routeParams);
      const text = await res.text();
      const body = JSON.parse(text);

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(21);
      expect(body.data.entries[0]).toMatchObject({ id: 'a1', action: 'match.reopen', reason: 'typo' });
      expect(text).not.toContain('203.0.113.9');
      expect(text).not.toContain('ip_address');
    });

    it('answers 500 with the static fallback when the read fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(listMatchAuditEvents).mockRejectedValue(new Error('db down'));

      const res = await GET(request(), routeParams);

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Failed to load the match history');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: vi.fn(),
  standaloneMatchAliasExists: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-admins', () => ({ isPhaseAdminFor: vi.fn() }));

import { GET } from '@/app/api/admin/matches/[id]/history/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { listMatchAuditEvents, type AuditLogRecord } from '@/lib/audit/queries';
import { toMatchHistoryEntry } from '@/lib/admin/match-detail';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { findNativePhaseAliasOwner, standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { isPhaseAdminFor } from '@/lib/supabase/queries/phase-admins';

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
    vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'admin-1', name: 'Admin', isAdmin: true } as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(isResourceAdminFor).mockImplementation(async (playerId, _type, tournamentId) =>
      (leaguesOfAdmin[playerId] ?? []).includes(leagueOfTournament[tournamentId])
    );
    vi.mocked(listMatchAuditEvents).mockResolvedValue({ entries: [], total: 0, offset: 0, limit: 20 });
  });
  afterEach(() => vi.unstubAllEnvs());

  describe('phase storage', () => {
    const phaseId = '38a17d3a-52c5-4abf-85b5-e64422b625e1';
    const seasonId = 'a63038b2-e1cf-42bb-99c5-d2f4ef7cd120';

    beforeEach(() => {
      vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
      vi.mocked(readPhaseStorageMode).mockResolvedValue('phase');
      vi.mocked(findNativePhaseAliasOwner).mockResolvedValue({ kind: 'phase', phase_id: phaseId, season_id: seasonId });
      vi.mocked(getPhaseMatchById).mockResolvedValue({ id: MATCH_ID, phase_id: phaseId } as never);
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'phase-admin', isAdmin: false } as never);
      vi.mocked(isPhaseAdminFor).mockResolvedValue(true);
    });

    it('lets the live phase grant page the same native events as the page', async () => {
      expect((await GET(request('?offset=20'), routeParams)).status).toBe(200);
      expect(isPhaseAdminFor).toHaveBeenCalledWith('phase-admin', phaseId);
      expect(getMatchById).not.toHaveBeenCalled();
      expect(listMatchAuditEvents).toHaveBeenCalledExactlyOnceWith(MATCH_ID, { offset: 20, limit: 20 }, 'phase');
    });

    it('refuses after the phase grant is revoked', async () => {
      vi.mocked(isPhaseAdminFor).mockResolvedValue(false);
      expect((await GET(request(), routeParams)).status).toBe(403);
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });

    it('refuses a mismatched owner without trying the legacy row', async () => {
      vi.mocked(getPhaseMatchById).mockResolvedValue({ id: MATCH_ID, phase_id: seasonId } as never);
      expect((await GET(request(), routeParams)).status).toBe(404);
      expect(getMatchById).not.toHaveBeenCalled();
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });

    it('preserves standalone history but refuses a retired league alias', async () => {
      vi.mocked(findNativePhaseAliasOwner).mockResolvedValue(null);
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'admin-1', isAdmin: true } as never);
      vi.mocked(standaloneMatchAliasExists).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      expect((await GET(request(), routeParams)).status).toBe(404);
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
      expect((await GET(request(), routeParams)).status).toBe(200);
      expect(standaloneMatchAliasExists).toHaveBeenCalledWith(MATCH_ID, match.tournament_id);
      expect(listMatchAuditEvents).toHaveBeenCalledExactlyOnceWith(MATCH_ID, { offset: 0, limit: 20 }, 'tournament');
    });

    it('returns maintenance unavailability before resolving either store', async () => {
      vi.mocked(readPhaseStorageMode).mockResolvedValue('frozen_phase');
      const res = await GET(request(), routeParams);
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('phase_storage_unavailable');
      expect(findNativePhaseAliasOwner).not.toHaveBeenCalled();
      expect(getMatchById).not.toHaveBeenCalled();
      expect(listMatchAuditEvents).not.toHaveBeenCalled();
    });
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

      expect(listMatchAuditEvents).toHaveBeenCalledWith(MATCH_ID, { offset: 0, limit: 20 }, 'tournament');
    });

    it('passes the offset and limit of the query string', async () => {
      await GET(request('?offset=40&limit=10'), routeParams);

      expect(listMatchAuditEvents).toHaveBeenCalledWith(MATCH_ID, { offset: 40, limit: 10 }, 'tournament');
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

      expect(listMatchAuditEvents).toHaveBeenCalledWith(MATCH_ID, { offset: 20, limit: 20 }, 'tournament');
    });
  });

  describe('response', () => {
    it('returns the page as the data of the envelope, without any ip address', async () => {
      const row: AuditLogRecord = {
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
      };
      const entries = [toMatchHistoryEntry(row)];
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

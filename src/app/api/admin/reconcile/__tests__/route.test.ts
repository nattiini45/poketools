import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  // Mirror the real helper: AuthError subclasses pass through with their real
  // status code (so auth tests observe true auth enforcement), everything else
  // returns the static 500 fallback.
  safeErrorResponse: vi.fn((err: unknown, fallback: string, status?: number, code?: string) => {
    if (status !== undefined) {
      return NextResponse.json({ success: false, error: fallback, code }, { status });
    }
    if (
      err instanceof Error &&
      'statusCode' in err &&
      typeof (err as { statusCode: unknown }).statusCode === 'number'
    ) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: (err as { statusCode: number }).statusCode }
      );
    }
    return NextResponse.json({ success: false, error: fallback }, { status: 500 });
  }),
}));

vi.mock('@/lib/reconcile/reconcile-season', () => ({
  reconcileAllSeasons: vi.fn(),
  reconcileSeasonDerivedData: vi.fn(),
}));

vi.mock('@/lib/reconcile/reconcile-streaks', () => ({
  reconcileStreaks: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/admin/reconcile/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  reconcileAllSeasons,
  reconcileSeasonDerivedData,
} from '@/lib/reconcile/reconcile-season';
import { reconcileStreaks } from '@/lib/reconcile/reconcile-streaks';
import { logAuditEvent } from '@/lib/audit/log';
import type { ReconcileReport } from '@/lib/reconcile/reconcile-season';
import type { StreaksReconcileReport } from '@/lib/reconcile/reconcile-streaks';

const VALID_SEASON_ID = '11111111-1111-4111-8111-111111111111';

function makeReport(over: Partial<ReconcileReport> = {}): ReconcileReport {
  return {
    seasonId: VALID_SEASON_ID,
    dryRun: true,
    evolution: { checked: false, mismatches: [], impossibleLineups: [] },
    ratings: { checked: true, mismatches: [], integrity: { gaps: [], unratedMatchIds: [], repairRefusal: null } },
    aggregates: { checked: false },
    streaks: { checked: false },
    playersAffected: [],
    summary: { totalMismatches: 0, repaired: false },
    ...over,
  };
}

describe('POST /api/admin/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated callers (401)', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401));

    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      })
    );
    const json = await res.json();

    expect(safeErrorResponse).toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
    expect(reconcileAllSeasons).not.toHaveBeenCalled();
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('rejects non-admin callers (403)', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403));

    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      })
    );
    const json = await res.json();

    expect(safeErrorResponse).toHaveBeenCalled();
    expect(res.status).toBe(403);
    expect(json.error).toBe('Admin access required');
    expect(reconcileAllSeasons).not.toHaveBeenCalled();
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid scope', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'planet' }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('reconcile_scope_invalid');
    expect(reconcileAllSeasons).not.toHaveBeenCalled();
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_json on a malformed body (never treated as an empty object)', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(undefined as never);
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"scope": "season",',
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('invalid_json');
    expect(reconcileAllSeasons).not.toHaveBeenCalled();
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('returns 400 on a JSON null body', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Request body must be a JSON object');
    expect(json.code).toBe('reconcile_body_not_object');
    expect(reconcileAllSeasons).not.toHaveBeenCalled();
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('returns 400 on a JSON array body', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ scope: 'all' }]),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Request body must be a JSON object');
    expect(reconcileAllSeasons).not.toHaveBeenCalled();
  });

  it('returns 400 when repair is a non-boolean (string "true")', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all', repair: 'true' }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('repair must be a boolean');
    expect(json.code).toBe('reconcile_repair_not_boolean');
    expect(reconcileAllSeasons).not.toHaveBeenCalled();
  });

  it('returns 400 when repair is a number', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'season', season_id: VALID_SEASON_ID, repair: 1 }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('repair must be a boolean');
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('returns 400 on missing season_id for season scope', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'season' }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('reconcile_season_id_required');
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid season_id (not a UUID)', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'season', season_id: 'not-a-uuid' }),
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('INVALID_PARAM');
    expect(json.params).toEqual({ name: 'season_id' });
    expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
  });

  it('runs a season dry-run and returns the report', async () => {
    const report = makeReport({ summary: { totalMismatches: 2, repaired: false } });
    vi.mocked(reconcileSeasonDerivedData).mockResolvedValueOnce(report);

    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'season', season_id: VALID_SEASON_ID }),
      })
    );
    const json = await res.json();

    expect(reconcileSeasonDerivedData).toHaveBeenCalledWith(VALID_SEASON_ID, { repair: false });
    expect(json.success).toBe(true);
    expect(json.data.summary.totalMismatches).toBe(2);
  });

  it('threads the repair flag through for a season', async () => {
    const report = makeReport({
      dryRun: false,
      summary: { totalMismatches: 2, repaired: true },
    });
    vi.mocked(reconcileSeasonDerivedData).mockResolvedValueOnce(report);

    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'season', season_id: VALID_SEASON_ID, repair: true }),
      })
    );
    const json = await res.json();

    expect(reconcileSeasonDerivedData).toHaveBeenCalledWith(VALID_SEASON_ID, { repair: true });
    expect(json.success).toBe(true);
    expect(json.data.summary.repaired).toBe(true);
  });

  it('runs all-seasons dry-run and returns the reports', async () => {
    const reports = [
      makeReport({ seasonId: '22222222-2222-4222-8222-222222222222' }),
      makeReport({
        seasonId: '33333333-3333-4333-8333-333333333333',
        summary: { totalMismatches: 1, repaired: false },
      }),
    ];
    vi.mocked(reconcileAllSeasons).mockResolvedValueOnce(reports);

    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      })
    );
    const json = await res.json();

    expect(reconcileAllSeasons).toHaveBeenCalledWith({ repair: false });
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
  });

  it('threads the repair flag through for all seasons', async () => {
    vi.mocked(reconcileAllSeasons).mockResolvedValueOnce([]);

    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all', repair: true }),
      })
    );

    expect(reconcileAllSeasons).toHaveBeenCalledWith({ repair: true });
    expect(res.status).toBe(200);
  });

  it('defaults repair to false when omitted', async () => {
    vi.mocked(reconcileSeasonDerivedData).mockResolvedValueOnce(makeReport());

    await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'season', season_id: VALID_SEASON_ID }),
      })
    );

    expect(reconcileSeasonDerivedData).toHaveBeenCalledWith(VALID_SEASON_ID, { repair: false });
  });

  it('uses safeErrorResponse on service failure', async () => {
    vi.mocked(reconcileAllSeasons).mockRejectedValueOnce(new Error('boom'));

    const res = await POST(
      new Request('http://localhost/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      })
    );

    expect(safeErrorResponse).toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  describe('streaks scope', () => {
    const ADMIN = {
      playerId: '22222222-2222-4222-8222-222222222222',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active',
    } as const;

    function makeStreaksReport(over: Partial<StreaksReconcileReport> = {}): StreaksReconcileReport {
      return {
        seasonId: null,
        dryRun: true,
        checked: 2,
        players: [
          { playerId: 'p1', status: 'current', mismatchedFields: [] },
          { playerId: 'p2', status: 'stale', mismatchedFields: ['best_win_streak'] },
        ],
        summary: { stale: 1, repaired: false },
        ...over,
      };
    }

    function post(body: unknown) {
      return POST(
        new Request('http://localhost/api/admin/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
    }

    it('runs a dry run over every player when season_id is absent', async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);
      vi.mocked(reconcileStreaks).mockResolvedValueOnce(makeStreaksReport());

      const res = await post({ scope: 'streaks' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(reconcileStreaks).toHaveBeenCalledWith({ seasonId: undefined, repair: false });
      expect(json.data.players[1].status).toBe('stale');
      expect(reconcileAllSeasons).not.toHaveBeenCalled();
      expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('narrows to a season when season_id is present', async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);
      vi.mocked(reconcileStreaks).mockResolvedValueOnce(makeStreaksReport({ seasonId: VALID_SEASON_ID }));

      await post({ scope: 'streaks', season_id: VALID_SEASON_ID });

      expect(reconcileStreaks).toHaveBeenCalledWith({ seasonId: VALID_SEASON_ID, repair: false });
    });

    it('rejects a malformed season_id for the streaks scope', async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);

      const res = await post({ scope: 'streaks', season_id: 'not-a-uuid' });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('INVALID_PARAM');
      expect(reconcileStreaks).not.toHaveBeenCalled();
    });

    it('repairs through reconcileStreaks only and audits the repair', async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(ADMIN);
      vi.mocked(reconcileStreaks).mockResolvedValueOnce(
        makeStreaksReport({ dryRun: false, rebuilt: { players: 2 }, summary: { stale: 1, repaired: true } })
      );

      const res = await post({ scope: 'streaks', repair: true });

      expect(res.status).toBe(200);
      expect(reconcileStreaks).toHaveBeenCalledWith({ seasonId: undefined, repair: true });
      // The streaks repair must never touch the rating, aggregate or evolution
      // rebuilders — those live behind the season/all scopes.
      expect(reconcileAllSeasons).not.toHaveBeenCalled();
      expect(reconcileSeasonDerivedData).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'match.repair', metadata: expect.objectContaining({ scope: 'streaks' }) })
      );
    });
  });
});
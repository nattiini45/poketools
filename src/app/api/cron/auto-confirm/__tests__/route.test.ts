import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/match/finalize', () => ({
  findMatchesNeedingAdmin: vi.fn(),
  finalizeMatchCompletion: vi.fn(),
  healMatchFinalization: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  listMatchesReadyForAutoConfirm: vi.fn(),
  listMatchesNeedingFinalize: vi.fn(),
  updateMatchStatus: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST, maxDuration } from '@/app/api/cron/auto-confirm/route';
import { safeErrorResponse } from '@/lib/api/error-response';
import { findMatchesNeedingAdmin, finalizeMatchCompletion, healMatchFinalization } from '@/lib/match/finalize';
import {
  getMatchById,
  listMatchesNeedingFinalize,
  listMatchesReadyForAutoConfirm,
  updateMatchStatus,
} from '@/lib/supabase/queries/matches';
import { logAuditEvent } from '@/lib/audit/log';

const originalCronSecret = process.env.CRON_SECRET;
const match = {
  id: 'match-1',
  round_id: 'round-1',
  tournament_id: 'tournament-1',
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  winner_id: 'player-1',
  status: 'pending_confirmation',
  submitter_id: 'player-2',
  date_played: null,
  scheduled_at: null,
  auto_confirm_at: '2026-05-21T00:00:00Z',
  confirmed_at: null,
  notes: '',
  social_image_url: null,
  created_at: '2026-05-20T00:00:00Z',
  updated_at: '2026-05-20T00:00:00Z',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  winner_name: 'Alice',
  round_status: 'active',
  games: [],
};
const match2 = { ...match, id: 'match-2', winner_id: 'player-2' };

function request(secret = 'secret') {
  return new Request('http://localhost/api/cron/auto-confirm?limit=5', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('POST /api/cron/auto-confirm', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.CRON_SECRET = 'secret';
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValue([match] as never);
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValue([]);
    vi.mocked(updateMatchStatus).mockResolvedValue({ ...match, status: 'completed' } as never);
    vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: true, complete: true, failed_steps: [] });
    vi.mocked(healMatchFinalization).mockResolvedValue({ healed: true, failed_steps: [] });
    vi.mocked(findMatchesNeedingAdmin).mockResolvedValue(new Map());
    vi.mocked(getMatchById).mockResolvedValue({ ...match, status: 'pending_confirmation' } as never);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    errorSpy.mockRestore();
  });

  it('gives the batch the full function budget', () => {
    expect(maxDuration).toBe(300);
  });

  it('returns cron_not_configured and logs when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('cron_not_configured');
    expect(errorSpy).toHaveBeenCalledWith('[cron/auto-confirm] CRON_SECRET not configured');
    expect(listMatchesReadyForAutoConfirm).not.toHaveBeenCalled();
  });

  it('rejects unauthorized cron calls without touching any match', async () => {
    const res = await POST(request('wrong'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe('cron_unauthorized');
    expect(listMatchesReadyForAutoConfirm).not.toHaveBeenCalled();
    expect(listMatchesNeedingFinalize).not.toHaveBeenCalled();
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('rejects a request without a bearer header', async () => {
    const res = await POST(new Request('http://localhost/api/cron/auto-confirm', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  function requestWithLimit(limit: string | null) {
    const query = limit === null ? '' : `?limit=${encodeURIComponent(limit)}`;
    return new Request(`http://localhost/api/cron/auto-confirm${query}`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
    });
  }

  it('passes a valid limit through and defaults to 25 without one', async () => {
    await POST(requestWithLimit('100'));
    expect(vi.mocked(listMatchesReadyForAutoConfirm).mock.calls[0][1]).toBe(100);

    await POST(requestWithLimit(null));
    expect(vi.mocked(listMatchesReadyForAutoConfirm).mock.calls[1][1]).toBe(25);
  });

  it.each(['not-a-number', '0', '101', '-3', '2.5', ''])(
    'returns 400 validation_failed for limit=%j instead of clamping or defaulting',
    async (limit) => {
      const res = await POST(requestWithLimit(limit));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.code).toBe('validation_failed');
      expect(body.params.issues).toEqual(expect.any(String));
      expect(listMatchesReadyForAutoConfirm).not.toHaveBeenCalled();
      expect(listMatchesNeedingFinalize).not.toHaveBeenCalled();
      expect(updateMatchStatus).not.toHaveBeenCalled();
    },
  );

  it('completes ready pending confirmations with a compare-and-set and the shared finalizer', async () => {
    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.completed).toBe(1);
    expect(body.data.failed).toEqual([]);
    expect(listMatchesReadyForAutoConfirm).toHaveBeenCalledWith(expect.any(String), 5);
    expect(updateMatchStatus).toHaveBeenCalledWith(
      'match-1',
      'completed',
      'player-1',
      undefined,
      'Auto-confirmed after timeout.',
      'pending_confirmation'
    );
    expect(finalizeMatchCompletion).toHaveBeenCalledWith({
      match: { ...match, status: 'completed' },
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.auto_confirm' }));
  });

  it('skips ready matches without a winner', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([{ ...match, winner_id: null }] as never);

    const res = await POST(request());
    const body = await res.json();

    expect(body.data.completed).toBe(0);
    expect(body.data.skipped_no_winner).toBe(1);
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('skips a match a player confirmed or disputed after the list read (CAS miss): no finalize, no audit', async () => {
    vi.mocked(updateMatchStatus).mockResolvedValueOnce(null);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.skipped_conflict).toBe(1);
    expect(body.data.completed).toBe(0);
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('keeps processing the batch when one match throws, then fails the run with a distinct code', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([match, match2] as never);
    const boom = new Error('db down');
    vi.mocked(updateMatchStatus)
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce({ ...match2, status: 'completed' } as never);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.code).toBe('auto_confirm_partial_failure');
    expect(body.params).toEqual({ count: 1 });
    const details = JSON.parse(body.details);
    expect(details.completed).toBe(1);
    expect(details.failed).toEqual([{ match_id: 'match-1', steps: ['confirm'] }]);
    expect(finalizeMatchCompletion).toHaveBeenCalledTimes(1);
    expect(finalizeMatchCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ winnerId: 'player-2' })
    );
    expect(errorSpy).toHaveBeenCalledWith('[cron/auto-confirm] could not auto-confirm match match-1', boom);
    // The match is re-read so the log tells a write that never landed from a
    // committed-but-unfinalized completion.
    expect(getMatchById).toHaveBeenCalledWith('match-1');
    expect(errorSpy).toHaveBeenCalledWith(
      '[cron/auto-confirm] match match-1 is still pending_confirmation: the auto-confirm write did not commit'
    );
    expect(safeErrorResponse).not.toHaveBeenCalled();
  });

  it('logs a completion that committed although the confirm write threw (lost response), without finalizing it', async () => {
    vi.mocked(updateMatchStatus).mockRejectedValueOnce(new Error('fetch timeout after 10000 ms'));
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...match, status: 'completed' } as never);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.parse(body.details).failed).toEqual([{ match_id: 'match-1', steps: ['confirm'] }]);
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('match match-1 is completed although the auto-confirm failed')
    );
  });

  it('logs both errors when the re-read after a failed confirm also fails', async () => {
    const boom = new Error('write failed');
    const readErr = new Error('read failed');
    vi.mocked(updateMatchStatus).mockRejectedValueOnce(boom);
    vi.mocked(getMatchById).mockRejectedValueOnce(readErr);

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith('[cron/auto-confirm] could not auto-confirm match match-1', boom);
    expect(errorSpy).toHaveBeenCalledWith(
      '[cron/auto-confirm] could not re-read match match-1 after the failed auto-confirm',
      readErr
    );
  });

  it('logs a match that vanished after a failed confirm', async () => {
    vi.mocked(updateMatchStatus).mockRejectedValueOnce(new Error('write failed'));
    vi.mocked(getMatchById).mockResolvedValueOnce(null);

    await POST(request());

    expect(errorSpy).toHaveBeenCalledWith(
      '[cron/auto-confirm] match match-1 no longer exists after the failed auto-confirm'
    );
  });

  it('reports finalize step failures as a failed run (the match is completed and left for the heal)', async () => {
    vi.mocked(finalizeMatchCompletion).mockResolvedValueOnce({
      finalized: true,
      complete: false,
      failed_steps: ['ratings'],
    });

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('auto_confirm_partial_failure');
    const details = JSON.parse(body.details);
    expect(details.completed).toBe(1);
    expect(details.failed).toEqual([{ match_id: 'match-1', steps: ['ratings'] }]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.auto_confirm' }));
  });

  it('reports a finalize that refused to run (e.g. a non-participant winner)', async () => {
    vi.mocked(finalizeMatchCompletion).mockResolvedValueOnce({
      finalized: false,
      reason: 'winner_not_participant',
    });

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.parse(body.details).failed).toEqual([{ match_id: 'match-1', steps: ['confirm'] }]);
  });

  it('heals completed matches whose finalize did not finish, older than 10 minutes', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const stuck = { ...match, id: 'match-9', status: 'completed' };
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([stuck] as never);
    const before = Date.now();

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.heal).toEqual({
      checked: 1, healed: 1, skipped: 0, failed: [], needs_admin: [], scan_truncated: false,
    });
    expect(body.data.needsAdmin).toEqual([]);
    expect(healMatchFinalization).toHaveBeenCalledWith(stuck);
    expect(findMatchesNeedingAdmin).toHaveBeenCalledWith([stuck]);
    const [cutoff, limit, after] = vi.mocked(listMatchesNeedingFinalize).mock.calls[0];
    expect(limit).toBe(100);
    expect(after).toBeUndefined();
    const cutoffMs = new Date(cutoff).getTime();
    expect(cutoffMs).toBeLessThanOrEqual(before - 10 * 60 * 1000 + 50);
    expect(cutoffMs).toBeGreaterThan(before - 11 * 60 * 1000);
  });

  it('fails the run when a heal stays incomplete or throws, and still heals the rest', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const a = { ...match, id: 'match-a', status: 'completed' };
    const b = { ...match, id: 'match-b', status: 'completed' };
    const c = { ...match, id: 'match-c', status: 'completed' };
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([a, b, c] as never);
    vi.mocked(healMatchFinalization)
      .mockResolvedValueOnce({ healed: false, failed_steps: ['ratings'] })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ healed: true, failed_steps: [] });

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('auto_confirm_partial_failure');
    expect(body.params).toEqual({ count: 2 });
    const details = JSON.parse(body.details);
    expect(details.heal).toEqual({
      checked: 3,
      healed: 1,
      skipped: 0,
      failed: [
        { match_id: 'match-a', steps: ['ratings'] },
        { match_id: 'match-b', steps: [] },
      ],
      needs_admin: [],
      scan_truncated: false,
    });
  });

  it('skips heals of matches reset meanwhile without failing the run', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const a = { ...match, id: 'match-a', status: 'completed' };
    const b = { ...match, id: 'match-b', status: 'completed' };
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([a, b] as never);
    vi.mocked(healMatchFinalization)
      .mockResolvedValueOnce({ healed: false, skipped: true, reason: 'not_completed', failed_steps: [] })
      .mockResolvedValueOnce({ healed: true, failed_steps: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.heal).toEqual({
      checked: 2, healed: 1, skipped: 1, failed: [], needs_admin: [], scan_truncated: false,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('heal skipped match match-a: not_completed'));
    warn.mockRestore();
  });

  it('reports needs-admin rows in needsAdmin and answers 200 when they are the only problem (ruling CR-2)', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const a = { ...match, id: 'match-a', status: 'completed' };
    const b = { ...match, id: 'match-b', status: 'completed' };
    const c = { ...match, id: 'match-c', status: 'completed' };
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([a, b, c] as never);
    vi.mocked(findMatchesNeedingAdmin).mockResolvedValueOnce(
      new Map([['match-a', 'ratings_missing'], ['match-b', 'winner_not_participant']])
    );

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.needsAdmin).toEqual(['match-a', 'match-b']);
    expect(body.data.heal).toEqual({
      checked: 3,
      healed: 1,
      skipped: 0,
      failed: [],
      needs_admin: [
        { match_id: 'match-a', steps: [], reason: 'ratings_missing' },
        { match_id: 'match-b', steps: [], reason: 'winner_not_participant' },
      ],
      scan_truncated: false,
    });
    // Classified rows never reach the heal (no per-row read, no heal attempt).
    expect(healMatchFinalization).toHaveBeenCalledTimes(1);
    expect(healMatchFinalization).toHaveBeenCalledWith(c);
    // One error line per run lists them.
    expect(errorSpy).toHaveBeenCalledWith(
      '[cron/auto-confirm] 2 completed match(es) need an admin: match-a (ratings_missing), match-b (winner_not_participant)'
    );
  });

  it('lists a heal that turns needs-admin after the classification (state changed in between)', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const a = { ...match, id: 'match-a', status: 'completed' };
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([a] as never);
    vi.mocked(healMatchFinalization).mockResolvedValueOnce({
      healed: false, needs_admin: true, reason: 'ratings_missing', failed_steps: ['ratings'],
    });

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.needsAdmin).toEqual(['match-a']);
    expect(body.data.heal.needs_admin).toEqual([
      { match_id: 'match-a', steps: ['ratings'], reason: 'ratings_missing' },
    ]);
  });

  it('still fails the run for real failures when needs-admin rows exist, counting only the failures', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const a = { ...match, id: 'match-a', status: 'completed' };
    const b = { ...match, id: 'match-b', status: 'completed' };
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([a, b] as never);
    vi.mocked(findMatchesNeedingAdmin).mockResolvedValueOnce(new Map([['match-a', 'ratings_missing']]));
    vi.mocked(healMatchFinalization).mockResolvedValueOnce({ healed: false, failed_steps: ['streaks'] });

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.params).toEqual({ count: 1 });
    const details = JSON.parse(body.details);
    expect(details.needsAdmin).toEqual(['match-a']);
    expect(details.heal.failed).toEqual([{ match_id: 'match-b', steps: ['streaks'] }]);
  });

  it('fails the run through safeErrorResponse when the needs-admin classification read fails', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([{ ...match, status: 'completed' }] as never);
    const err = new Error('history read failed');
    vi.mocked(findMatchesNeedingAdmin).mockRejectedValueOnce(err);

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(err, 'Failed to auto-confirm matches');
    expect(healMatchFinalization).not.toHaveBeenCalled();
  });

  it('does not let skipped rows starve the heal budget, and stops after 25 attempts', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const skippedRows = Array.from({ length: 30 }, (_, i) => ({ ...match, id: `skip-${i}`, status: 'completed' }));
    const healRows = Array.from({ length: 30 }, (_, i) => ({ ...match, id: `heal-${i}`, status: 'completed' }));
    vi.mocked(listMatchesNeedingFinalize).mockResolvedValueOnce([...skippedRows, ...healRows] as never);
    vi.mocked(healMatchFinalization).mockImplementation(async (m) =>
      m.id.startsWith('skip-')
        ? { healed: false, skipped: true, reason: 'not_completed', failed_steps: [] }
        : { healed: true, failed_steps: [] }
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.heal).toEqual({
      checked: 55, healed: 25, skipped: 30, failed: [], needs_admin: [], scan_truncated: false,
    });
    expect(healMatchFinalization).toHaveBeenCalledTimes(55);
    warn.mockRestore();
  });

  it('pages past a full page of needs-admin rows with a keyset cursor, so they cannot starve healable rows', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    const stuckRows = Array.from({ length: 100 }, (_, i) => ({
      ...match,
      id: `stuck-${i}`,
      status: 'completed',
      updated_at: `2026-05-20T00:00:${String(i % 60).padStart(2, '0')}Z`,
    }));
    const healable = { ...match, id: 'healable', status: 'completed', updated_at: '2026-05-21T00:00:00Z' };
    vi.mocked(listMatchesNeedingFinalize)
      .mockResolvedValueOnce(stuckRows as never)
      .mockResolvedValueOnce([healable] as never);
    vi.mocked(findMatchesNeedingAdmin)
      .mockResolvedValueOnce(new Map(stuckRows.map((row) => [row.id, 'ratings_missing'] as const)))
      .mockResolvedValueOnce(new Map());

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.needsAdmin).toHaveLength(100);
    expect(body.data.heal.checked).toBe(101);
    expect(body.data.heal.healed).toBe(1);
    expect(healMatchFinalization).toHaveBeenCalledTimes(1);
    expect(healMatchFinalization).toHaveBeenCalledWith(healable);
    // The second page continues behind the last row of the first.
    const last = stuckRows[99];
    expect(vi.mocked(listMatchesNeedingFinalize).mock.calls[1][2]).toEqual({
      updated_at: last.updated_at,
      id: last.id,
    });
  });

  it('stops after 10 pages and reports scan_truncated when rows are left', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    let n = 0;
    const page = () =>
      Array.from({ length: 100 }, () => {
        n += 1;
        return { ...match, id: `stuck-${n}`, status: 'completed' };
      });
    vi.mocked(listMatchesNeedingFinalize).mockImplementation(async (_cutoff, limit) =>
      (limit === 1 ? [{ ...match, id: 'more', status: 'completed' }] : page()) as never
    );
    vi.mocked(findMatchesNeedingAdmin).mockImplementation(
      async (rows) => new Map(rows.map((row) => [row.id, 'ratings_missing'] as const))
    );

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.heal.checked).toBe(1000);
    expect(body.data.heal.scan_truncated).toBe(true);
    // 10 pages plus the one-row probe.
    expect(listMatchesNeedingFinalize).toHaveBeenCalledTimes(11);
    expect(healMatchFinalization).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('heal scan stopped after 1000 worklist rows'));
  });

  it('does not report scan_truncated when the worklist ends exactly at the page cap', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([]);
    let n = 0;
    vi.mocked(listMatchesNeedingFinalize).mockImplementation(async (_cutoff, limit) => {
      if (limit === 1) return [];
      return Array.from({ length: 100 }, () => {
        n += 1;
        return { ...match, id: `stuck-${n}`, status: 'completed' };
      }) as never;
    });
    vi.mocked(findMatchesNeedingAdmin).mockImplementation(
      async (rows) => new Map(rows.map((row) => [row.id, 'ratings_missing'] as const))
    );

    const res = await POST(request());
    const body = await res.json();

    expect(body.data.heal.scan_truncated).toBe(false);
  });

  it('returns 500 through safeErrorResponse when the worklist read itself fails', async () => {
    const err = new Error('list failed');
    vi.mocked(listMatchesNeedingFinalize).mockRejectedValueOnce(err);

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(err, 'Failed to auto-confirm matches');
  });
});

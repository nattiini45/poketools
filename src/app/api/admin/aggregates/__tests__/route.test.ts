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
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) =>
    NextResponse.json({ success: false, error: fallback }, { status: 500 })
  ),
}));

vi.mock('@/lib/match/aggregate-queue', () => ({
  getAggregateJobStats: vi.fn(),
}));

vi.mock('@/lib/match/aggregate-rebuild', () => ({
  drainPendingAggregateJobs: vi.fn(),
  rebuildAggregatesForScope: vi.fn(),
}));

import { GET, POST } from '@/app/api/admin/aggregates/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getAggregateJobStats } from '@/lib/match/aggregate-queue';
import {
  drainPendingAggregateJobs,
  rebuildAggregatesForScope,
} from '@/lib/match/aggregate-rebuild';

describe('GET /api/admin/aggregates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns job stats for admins', async () => {
    vi.mocked(getAggregateJobStats).mockResolvedValueOnce({
      pending: 2,
      processing: 0,
      completed: 10,
      failed: 1,
      cancelled: 0,
    });

    const res = await GET();
    const json = await res.json();

    expect(requireAdmin).toHaveBeenCalled();
    expect(json.success).toBe(true);
    expect(json.data.jobs.pending).toBe(2);
  });

  it('uses safeErrorResponse on failure', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('boom'));

    const res = await GET();

    expect(safeErrorResponse).toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/aggregates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated callers', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AuthError('Unauthorized', 401));

    const res = await POST(new Request('http://localhost/api/admin/aggregates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'drain' }),
    }));

    expect(safeErrorResponse).toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it('drains pending jobs', async () => {
    vi.mocked(drainPendingAggregateJobs).mockResolvedValueOnce({
      processed: 3,
      failed: 0,
      reclaimed: 1,
      rounds: 2,
      statsAfter: {
        pending: 0,
        processing: 0,
        completed: 13,
        failed: 1,
        cancelled: 0,
      },
    });

    const res = await POST(new Request('http://localhost/api/admin/aggregates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'drain' }),
    }));
    const json = await res.json();

    expect(drainPendingAggregateJobs).toHaveBeenCalled();
    expect(json.success).toBe(true);
    expect(json.data.processed).toBe(3);
  });

  it('validates rebuild scope', async () => {
    const res = await POST(new Request('http://localhost/api/admin/aggregates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rebuild', scope_type: 'tournament' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('aggregate_scope_id_required');
    expect(rebuildAggregatesForScope).not.toHaveBeenCalled();
  });

  it('rebuilds all_time scope', async () => {
    vi.mocked(rebuildAggregatesForScope).mockResolvedValueOnce({
      gamesProcessed: 12,
      aggregatesDeleted: 40,
      playerAggregatesDeleted: 80,
    });

    const res = await POST(new Request('http://localhost/api/admin/aggregates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rebuild', scope_type: 'all_time' }),
    }));
    const json = await res.json();

    expect(rebuildAggregatesForScope).toHaveBeenCalledWith('all_time', null);
    expect(json.success).toBe(true);
    expect(json.data.gamesProcessed).toBe(12);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/match/aggregate-queue', () => ({
  processAggregateJobs: vi.fn(),
  getAggregateJobHealth: vi.fn(),
  countFailedAggregateJobs: vi.fn(),
  processAllAggregateJobs: vi.fn(),
  getAllAggregateJobHealth: vi.fn(),
  countAllFailedAggregateJobs: vi.fn(),
  AggregateQueueClaimError: class AggregateQueueClaimError extends Error {},
  AggregateQueueRunError: class AggregateQueueRunError extends Error {},
}));

vi.mock('@/lib/api/error-response', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/error-response')>();
  return { ...actual, safeErrorResponse: vi.fn(actual.safeErrorResponse) };
});
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ revalidatePhaseMatchPages: vi.fn() }));

import { GET, POST, maxDuration } from '@/app/api/cron/process-aggregates/route';
import {
  AggregateQueueClaimError,
  AggregateQueueRunError,
  countAllFailedAggregateJobs,
  countFailedAggregateJobs,
  getAllAggregateJobHealth,
  getAggregateJobHealth,
  processAllAggregateJobs,
  processAggregateJobs,
} from '@/lib/match/aggregate-queue';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { revalidatePhaseMatchPages } from '@/lib/revalidation';

// ─── Helpers ────────────────────────────────────────────────────────

/** Mock NextRequest at runtime using the native Request constructor */
function makeCronRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  return new Request(url, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }) as unknown as NextRequest;
}

const AUTH = { Authorization: 'Bearer test-secret' };
const URL_BASE = 'http://localhost/api/cron/process-aggregates';

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/cron/process-aggregates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
    vi.mocked(getAggregateJobHealth).mockResolvedValue({ strandedPending: 0, staleProcessing: 0 });
    vi.mocked(countFailedAggregateJobs).mockResolvedValue(0);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('processes aggregate jobs with valid Bearer token', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({
      processed: 5,
      failed: 1,
      reclaimed: 2,
    });

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    // A retriable job failure is counted, not a failed run.
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { processed: 5, failed: 1, reclaimed: 2, failedJobs: 0 } });
    expect(processAggregateJobs).toHaveBeenCalledWith(20);
    expect(getAggregateJobHealth).toHaveBeenCalledTimes(1);
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(processAllAggregateJobs).not.toHaveBeenCalled();
  });

  it('processes both queues and invalidates the applied phase in phase mode', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    vi.mocked(readPhaseStorageMode).mockResolvedValueOnce('phase');
    vi.mocked(getAllAggregateJobHealth).mockResolvedValueOnce({ strandedPending: 0, staleProcessing: 0 });
    vi.mocked(countAllFailedAggregateJobs).mockResolvedValueOnce(0);
    vi.mocked(processAllAggregateJobs).mockImplementationOnce(async (_limit, invalidate) => {
      await invalidate?.({ kind: 'phase', phase_id: 'phase-id', season_id: 'league-id' });
      return { processed: 2, failed: 0, reclaimed: 1 };
    });

    const response = await GET(makeCronRequest(`${URL_BASE}?limit=7`, { method: 'GET', headers: AUTH }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { processed: 2, failed: 0, reclaimed: 1, failedJobs: 0 } });
    expect(readPhaseStorageMode).toHaveBeenCalledTimes(1);
    expect(processAllAggregateJobs).toHaveBeenCalledWith(7, expect.any(Function));
    expect(getAllAggregateJobHealth).toHaveBeenCalledTimes(1);
    expect(countAllFailedAggregateJobs).toHaveBeenCalledTimes(1);
    expect(processAggregateJobs).not.toHaveBeenCalled();
    expect(revalidatePhaseMatchPages).toHaveBeenCalledWith('phase-id', undefined, 'league-id');
  });

  it.each(['frozen_legacy', 'frozen_phase'] as const)('refuses %s without reclaiming or claiming either queue', async (mode) => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    vi.mocked(readPhaseStorageMode).mockResolvedValueOnce(mode);
    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    expect(processAggregateJobs).not.toHaveBeenCalled();
    expect(processAllAggregateJobs).not.toHaveBeenCalled();
    expect(getAggregateJobHealth).not.toHaveBeenCalled();
    expect(getAllAggregateJobHealth).not.toHaveBeenCalled();
  });

  it('serves GET (Vercel Cron) with the same handler', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({ processed: 0, failed: 0, reclaimed: 0 });

    const response = await GET(makeCronRequest(URL_BASE, { method: 'GET', headers: AUTH }));

    expect(response.status).toBe(200);
  });

  it('declares a max duration below the 5-minute reclaim window', () => {
    expect(maxDuration).toBeLessThan(300);
  });

  it('returns 401 when Authorization header is missing', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    const response = await POST(makeCronRequest(URL_BASE));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('cron_unauthorized');
    expect(processAggregateJobs).not.toHaveBeenCalled();
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
  });

  it('returns 401 when Bearer token is invalid', async () => {
    const response = await POST(makeCronRequest(URL_BASE, { headers: { Authorization: 'Bearer wrong-token' } }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('cron_unauthorized');
    expect(processAggregateJobs).not.toHaveBeenCalled();
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(makeCronRequest(URL_BASE, { headers: { Authorization: 'Bearer any-token' } }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Cron not configured');
    expect(body.code).toBe('cron_not_configured');
    expect(processAggregateJobs).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('passes custom limit to processAggregateJobs', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({ processed: 0, failed: 0, reclaimed: 0 });

    const response = await POST(makeCronRequest(`${URL_BASE}?limit=10`, { headers: AUTH }));

    expect(response.status).toBe(200);
    expect(processAggregateJobs).toHaveBeenCalledWith(10);
  });

  it.each(['not-a-number', '0', '101', '2.5', ''])(
    'returns 400 validation_failed for limit=%j instead of silently using a default',
    async (limit) => {
      const response = await POST(makeCronRequest(`${URL_BASE}?limit=${limit}`, { headers: AUTH }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.code).toBe('validation_failed');
      expect(body.params.issues).toEqual(expect.any(String));
      expect(processAggregateJobs).not.toHaveBeenCalled();
    },
  );

  it('returns 500 aggregate_claim_failed when the claim RPC fails (H6)', async () => {
    const claimError = new AggregateQueueClaimError({ cause: { code: '22P02' } });
    vi.mocked(processAggregateJobs).mockRejectedValueOnce(claimError);

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: 'Failed to claim aggregate jobs',
      code: 'aggregate_claim_failed',
    });
    expect(safeErrorResponse).toHaveBeenCalledWith(
      claimError,
      'Failed to claim aggregate jobs',
      500,
      'aggregate_claim_failed',
    );
    expect(getAggregateJobHealth).not.toHaveBeenCalled();
  });

  it('returns 500 aggregate_queue_failed when the reclaim or a queue write fails (M2)', async () => {
    const runError = new AggregateQueueRunError({ processed: 1, failed: 0, reclaimed: 0 }, [{ message: 'reclaim down' }]);
    vi.mocked(processAggregateJobs).mockRejectedValueOnce(runError);

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: 'Failed to process aggregate jobs',
      code: 'aggregate_queue_failed',
    });
    expect(safeErrorResponse).toHaveBeenCalledWith(
      runError,
      'Failed to process aggregate jobs',
      500,
      'aggregate_queue_failed',
    );
    expect(getAggregateJobHealth).not.toHaveBeenCalled();
  });

  it('returns 500 aggregate_queue_failed (not a health code) for an unwrapped run error, e.g. the revalidation', async () => {
    const revalidateError = new Error('revalidateTag failed');
    vi.mocked(processAggregateJobs).mockRejectedValueOnce(revalidateError);

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('aggregate_queue_failed');
    expect(safeErrorResponse).toHaveBeenCalledWith(
      revalidateError,
      'Failed to process aggregate jobs',
      500,
      'aggregate_queue_failed',
    );
    expect(getAggregateJobHealth).not.toHaveBeenCalled();
  });

  it('returns 500 aggregate_health_failed when the failed-job count fails', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({ processed: 0, failed: 0, reclaimed: 0 });
    const countError = new Error('count failed');
    vi.mocked(countFailedAggregateJobs).mockRejectedValueOnce(countError);

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('aggregate_health_failed');
    expect(safeErrorResponse).toHaveBeenCalledWith(
      countError,
      'Failed to check aggregate job health',
      500,
      'aggregate_health_failed',
    );
  });

  it('reports exhausted failed jobs in the body and logs them, but answers 200 (ruling CR-3)', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({ processed: 2, failed: 0, reclaimed: 0 });
    vi.mocked(countFailedAggregateJobs).mockResolvedValueOnce(3);
    const consoleErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { processed: 2, failed: 0, reclaimed: 0, failedJobs: 3 } });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'cron/process-aggregates',
      expect.stringContaining('aggregate job(s) ended failed (attempts exhausted)'),
      { failedJobs: 3 }
    );
    consoleErrorSpy.mockRestore();
  });

  it('returns 500 aggregate_health_failed when the health probe fails', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({ processed: 0, failed: 0, reclaimed: 0 });
    const probeError = new Error('probe failed');
    vi.mocked(getAggregateJobHealth).mockRejectedValueOnce(probeError);

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('aggregate_health_failed');
    expect(safeErrorResponse).toHaveBeenCalledWith(
      probeError,
      'Failed to check aggregate job health',
      500,
      'aggregate_health_failed',
    );
  });

  it.each([
    [{ strandedPending: 3, staleProcessing: 0 }],
    [{ strandedPending: 0, staleProcessing: 2 }],
  ])('returns 500 aggregate_jobs_stranded when jobs can never drain (%j)', async (health) => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({ processed: 4, failed: 0, reclaimed: 0 });
    vi.mocked(getAggregateJobHealth).mockResolvedValueOnce(health);
    const consoleErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const response = await POST(makeCronRequest(URL_BASE, { headers: AUTH }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.code).toBe('aggregate_jobs_stranded');
    expect(body.params).toEqual({ stranded: health.strandedPending, stale: health.staleProcessing });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'cron/process-aggregates',
      'Aggregate jobs cannot drain',
      expect.objectContaining({ ...health, run: { processed: 4, failed: 0, reclaimed: 0 } })
    );
    consoleErrorSpy.mockRestore();
  });
});

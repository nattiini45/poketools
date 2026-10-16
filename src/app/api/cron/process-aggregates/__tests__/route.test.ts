import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/match/aggregate-queue', () => ({
  processAggregateJobs: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) =>
    NextResponse.json({ success: false, error: fallback }, { status: 500 })
  ),
}));

import { POST } from '@/app/api/cron/process-aggregates/route';
import { processAggregateJobs } from '@/lib/match/aggregate-queue';

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

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/cron/process-aggregates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it('processes aggregate jobs with valid Bearer token', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({
      processed: 5,
      failed: 1,
      reclaimed: 2,
    });

    const request = makeCronRequest('http://localhost/api/cron/process-aggregates', {
      headers: { Authorization: 'Bearer test-secret' },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.processed).toBe(5);
    expect(body.data.failed).toBe(1);
    expect(body.data.reclaimed).toBe(2);
    expect(processAggregateJobs).toHaveBeenCalledWith(20);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const request = makeCronRequest('http://localhost/api/cron/process-aggregates');

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('cron_unauthorized');
  });

  it('returns 401 when Bearer token is invalid', async () => {
    const request = makeCronRequest('http://localhost/api/cron/process-aggregates', {
      headers: { Authorization: 'Bearer wrong-token' },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('cron_unauthorized');
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;

    const request = makeCronRequest('http://localhost/api/cron/process-aggregates', {
      headers: { Authorization: 'Bearer any-token' },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Cron not configured');
    expect(body.code).toBe('cron_not_configured');
  });

  it('passes custom limit to processAggregateJobs', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({
      processed: 0,
      failed: 0,
      reclaimed: 0,
    });

    const request = makeCronRequest(
      'http://localhost/api/cron/process-aggregates?limit=10',
      { headers: { Authorization: 'Bearer test-secret' } }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(processAggregateJobs).toHaveBeenCalledWith(10);
  });

  it('uses default limit when limit query param is invalid', async () => {
    vi.mocked(processAggregateJobs).mockResolvedValueOnce({
      processed: 0,
      failed: 0,
      reclaimed: 0,
    });

    const request = makeCronRequest(
      'http://localhost/api/cron/process-aggregates?limit=not-a-number',
      { headers: { Authorization: 'Bearer test-secret' } }
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(processAggregateJobs).toHaveBeenCalledWith(20);
  });
});
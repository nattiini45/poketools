import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const limitMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn(() => ({ limit: limitMock })));
const fromMock = vi.hoisted(() => vi.fn(() => ({ select: selectMock })));

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: fromMock },
}));

vi.mock('@/lib/admin/export-rate-limit', () => ({
  checkAndRecordAdminExport: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/admin/export/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { checkAndRecordAdminExport } from '@/lib/admin/export-rate-limit';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(checkAndRecordAdminExport).mockResolvedValue({
      allowed: true,
      remaining: 19,
      reset_at: '2026-05-22T00:00:00Z',
    });
    limitMock.mockResolvedValue({ data: [{ name: 'Ash', discord_id: '111111111111111111' }], error: null });
  });

  it('exports CSV with rate limit headers', async () => {
    const res = await POST(request({ resource: 'players', format: 'csv', limit: 10 }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('19');
    expect(text).toContain('"name"');
    expect(fromMock).toHaveBeenCalledWith('players');
    expect(limitMock).toHaveBeenCalledWith(10);
  });

  it('returns 429 when export rate limit is exhausted', async () => {
    vi.mocked(checkAndRecordAdminExport).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      reset_at: '2026-05-22T00:00:00Z',
    });

    const res = await POST(request({ resource: 'players', format: 'json' }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.code).toBe('admin_export_rate_limited');
    expect(body.params).toEqual({ resetAt: '2026-05-22T00:00:00Z' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid export resources', async () => {
    const res = await POST(request({ resource: 'secrets', format: 'json' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(checkAndRecordAdminExport).not.toHaveBeenCalled();
  });
});
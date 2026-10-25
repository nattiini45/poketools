import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const rangeMock = vi.hoisted(() => vi.fn());
const orderMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

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
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkAndRecordAdminExport } from '@/lib/admin/export-rate-limit';
import { logAuditEvent } from '@/lib/audit/log';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Serves `size` rows through `.range()`; the first page also answers the exact count. */
function serveTable(size: number) {
  rangeMock.mockImplementation(async (from: number, to: number) => ({
    data: Array.from({ length: Math.max(0, Math.min(to + 1, size) - from) }, (_, i) => ({ id: from + i })),
    count: from === 0 ? size : null,
    error: null,
  }));
}

describe('POST /api/admin/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = { order: orderMock, range: rangeMock };
    fromMock.mockReturnValue({ select: selectMock });
    selectMock.mockReturnValue(chain);
    orderMock.mockReturnValue(chain);
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(checkAndRecordAdminExport).mockResolvedValue({
      allowed: true,
      remaining: 19,
      reset_at: '2026-05-22T00:00:00Z',
    });
    rangeMock.mockResolvedValue({
      data: [{ name: 'Ash', discord_id: '111111111111111111' }],
      count: 1,
      error: null,
    });
  });

  it('exports CSV with rate limit headers', async () => {
    const res = await POST(request({ resource: 'players', format: 'csv', limit: 10 }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('19');
    expect(text).toContain('"name"');
    expect(fromMock).toHaveBeenCalledWith('players');
    expect(rangeMock).toHaveBeenCalledWith(0, 9);
  });

  it('neutralizes formula-leading cells in CSV exports', async () => {
    rangeMock.mockResolvedValueOnce({
      data: [{ name: 'Ash', ps_username: '=1+1', rating_delta: -5 }],
      count: 1,
      error: null,
    });

    const res = await POST(request({ resource: 'players', format: 'csv', limit: 10 }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('"\'=1+1"');
    expect(text).toContain('"-5"');
    const cells = text.split('\n').flatMap((line) => line.split(','));
    expect(cells.some((cell) => cell.startsWith('"='))).toBe(false);
  });

  it('exports past the 1000-row cap in a stable order and reports N of M', async () => {
    serveTable(4200);

    const csv = await POST(request({ resource: 'matches', format: 'csv', limit: 2500 }));
    const csvText = await csv.text();
    expect(csv.status).toBe(200);
    expect(csv.headers.get('X-Export-Count')).toBe('2500');
    expect(csv.headers.get('X-Export-Total')).toBe('4200');
    // header line + 2,500 data rows
    expect(csvText.trim().split('\n')).toHaveLength(2501);

    const json = await POST(request({ resource: 'matches', format: 'json', limit: 2500 }));
    const body = await json.json();
    expect(json.headers.get('X-Export-Count')).toBe('2500');
    expect(json.headers.get('X-Export-Total')).toBe('4200');
    expect(body.data).toHaveLength(2500);

    expect(selectMock).toHaveBeenCalledWith('*', { count: 'exact' });
    expect(selectMock).toHaveBeenCalledWith('*', undefined);
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(orderMock).toHaveBeenCalledWith('id', { ascending: true });
    expect(rangeMock.mock.calls.slice(0, 3)).toEqual([[0, 999], [1000, 1999], [2000, 2499]]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admin.export',
      metadata: { format: 'csv', count: 2500, total: 4200, limit: 2500, truncated: true },
    }));
  });

  it('reports truncated false when the table is smaller than the limit', async () => {
    serveTable(40);

    const res = await POST(request({ resource: 'players', format: 'json', limit: 1000 }));
    const body = await res.json();

    expect(body.data).toHaveLength(40);
    expect(res.headers.get('X-Export-Count')).toBe('40');
    expect(res.headers.get('X-Export-Total')).toBe('40');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { format: 'json', count: 40, total: 40, limit: 1000, truncated: false },
    }));
  });

  it('answers 500 through safeErrorResponse when a page fails mid-read', async () => {
    rangeMock
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), count: 3000, error: null })
      .mockResolvedValueOnce({ data: null, count: null, error: new Error('db down') });

    const res = await POST(request({ resource: 'players', format: 'json', limit: 3000 }));

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(expect.any(Error), 'Failed to export data');
    expect(logAuditEvent).not.toHaveBeenCalled();
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

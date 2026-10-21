import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/audit/queries', () => ({
  listAuditLogEntries: vi.fn(),
}));

import { GET } from '@/app/api/admin/audit-log/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { listAuditLogEntries } from '@/lib/audit/queries';
import { safeErrorResponse } from '@/lib/api/error-response';

function request(url = 'http://localhost/api/admin/audit-log') {
  return new NextRequest(url);
}

describe('GET /api/admin/audit-log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(listAuditLogEntries).mockResolvedValue({
      entries: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
  });

  it('returns filtered audit log entries for admins', async () => {
    vi.mocked(listAuditLogEntries).mockResolvedValueOnce({
      entries: [{
        id: 'audit-1',
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'match.override',
        resource_type: 'match',
        resource_id: 'match-1',
        resource_name: 'A vs B',
        changes: null,
        metadata: null,
        ip_address: null,
        created_at: '2026-05-21T00:00:00Z',
      }],
      total: 1,
      limit: 25,
      offset: 0,
    });

    const res = await GET(request('http://localhost/api/admin/audit-log?action=match.override&resource_type=match&limit=25'));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.entries).toHaveLength(1);
    expect(listAuditLogEntries).toHaveBeenCalledWith(expect.objectContaining({
      action: 'match.override',
      resource_type: 'match',
      limit: 25,
      offset: 0,
    }));
  });

  it('returns 400 for invalid date ranges', async () => {
    const res = await GET(request('http://localhost/api/admin/audit-log?from=2026-05-22T00:00:00.000Z&to=2026-05-21T00:00:00.000Z'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(listAuditLogEntries).not.toHaveBeenCalled();
  });

  it('delegates unexpected errors to safeErrorResponse', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('auth failed'));

    await GET(request());

    expect(safeErrorResponse).toHaveBeenCalledWith(expect.any(Error), 'Failed to load audit log');
  });
});
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  listNoteReports: vi.fn(),
}));

import { GET } from '@/app/api/admin/wiki/reports/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { listNoteReports } from '@/lib/supabase/queries/wiki-notes';

describe('GET /api/admin/wiki/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(listNoteReports).mockResolvedValue([]);
  });

  it('lists open reports', async () => {
    const request = new NextRequest('http://localhost/api/admin/wiki/reports?status=open');
    const res = await GET(request);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(vi.mocked(listNoteReports)).toHaveBeenCalledWith({
      status: 'open',
      limit: 50,
      offset: 0,
    });
  });

  it('rejects invalid status filters with validation_failed', async () => {
    const request = new NextRequest('http://localhost/api/admin/wiki/reports?status=unknown');
    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(vi.mocked(listNoteReports)).not.toHaveBeenCalled();
  });
});
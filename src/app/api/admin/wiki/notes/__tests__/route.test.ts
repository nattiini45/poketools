import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  listNotesForModeration: vi.fn(),
}));

import { GET } from '@/app/api/admin/wiki/notes/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { listNotesForModeration } from '@/lib/supabase/queries/wiki-notes';

describe('GET /api/admin/wiki/notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(listNotesForModeration).mockResolvedValue([]);
  });

  it('lists pending notes with validated pagination', async () => {
    const request = new NextRequest('http://localhost/api/admin/wiki/notes?status=pending&limit=25&offset=5');
    const res = await GET(request);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(vi.mocked(listNotesForModeration)).toHaveBeenCalledWith({
      status: 'pending',
      limit: 25,
      offset: 5,
    });
  });

  it('rejects invalid status filters', async () => {
    const request = new NextRequest('http://localhost/api/admin/wiki/notes?status=unknown');
    const res = await GET(request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });
});
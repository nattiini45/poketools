import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  updateNoteReportStatus: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { PATCH } from '@/app/api/admin/wiki/reports/[id]/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { updateNoteReportStatus } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/admin/wiki/reports/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(updateNoteReportStatus).mockResolvedValue(undefined);
  });

  it('updates report status and logs audit event', async () => {
    const res = await PATCH(makeRequest({ status: 'reviewed' }), makeParams('r1'));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(vi.mocked(updateNoteReportStatus)).toHaveBeenCalledWith('r1', 'reviewed');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.report.update',
      resource_id: 'r1',
    }));
  });

  it('rejects invalid report status', async () => {
    const res = await PATCH(makeRequest({ status: 'bad' }), makeParams('r1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });
});
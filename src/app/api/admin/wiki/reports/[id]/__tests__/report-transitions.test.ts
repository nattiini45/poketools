import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Characterization of the legal wiki report moves (docs/state-machines.md, "Wiki note report"): a moderator
 * closes an open report as reviewed or dismissed.
 */

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  getNoteReportStatus: vi.fn(),
  updateNoteReportStatus: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { PATCH } from '@/app/api/admin/wiki/reports/[id]/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { getNoteReportStatus, updateNoteReportStatus } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';

const REPORT_ID = '214a2430-2359-48cd-8870-84e554ae7fc6';

function patch(body: Record<string, unknown>) {
  const request = { json: vi.fn().mockResolvedValue(body), headers: new Headers() } as unknown as NextRequest;
  return PATCH(request, { params: Promise.resolve({ id: REPORT_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(getNoteReportStatus).mockResolvedValue('open');
  vi.mocked(updateNoteReportStatus).mockResolvedValue(true as never);
});

describe('wiki report moderation: legal moves', () => {
  it.each(['reviewed', 'dismissed'] as const)('a moderator closes an open report as %s', async (status) => {
    const res = await patch({ status });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: true } });
    expect(vi.mocked(updateNoteReportStatus).mock.calls[0].slice(0, 2)).toEqual([REPORT_ID, status]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.report.update',
      metadata: { status },
    }));
  });
});

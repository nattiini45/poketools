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

describe('wiki report moderation: compare-and-set and refused moves', () => {
  it('guards the write with the status it read', async () => {
    await patch({ status: 'dismissed' });
    expect(updateNoteReportStatus).toHaveBeenCalledWith(REPORT_ID, 'dismissed', 'open');
  });

  it('allows repeating the close a moderator already made', async () => {
    vi.mocked(getNoteReportStatus).mockResolvedValue('reviewed');
    const res = await patch({ status: 'reviewed' });
    expect(res.status).toBe(200);
    expect(updateNoteReportStatus).toHaveBeenCalledWith(REPORT_ID, 'reviewed', 'reviewed');
  });

  it.each([
    ['reviewed', 'dismissed'],
    ['dismissed', 'reviewed'],
  ] as const)('refuses to move a %s report to %s (state_transition_invalid)', async (from, to) => {
    vi.mocked(getNoteReportStatus).mockResolvedValue(from);
    const res = await patch({ status: to });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'state_transition_invalid', params: { machine: 'wiki_note_report.status', from, to } });
    expect(updateNoteReportStatus).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a moderator reopening a report: only the reporter reopens it (state_transition_forbidden)', async () => {
    vi.mocked(getNoteReportStatus).mockResolvedValue('dismissed');
    const res = await patch({ status: 'open' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('state_transition_forbidden');
    expect(updateNoteReportStatus).not.toHaveBeenCalled();
  });

  it('answers 404 wiki_report_not_found for an unknown report and writes nothing', async () => {
    vi.mocked(getNoteReportStatus).mockResolvedValue(null);
    const res = await patch({ status: 'reviewed' });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('wiki_report_not_found');
    expect(updateNoteReportStatus).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 409 wiki_report_changed when another moderator closed it between the read and the write', async () => {
    vi.mocked(updateNoteReportStatus).mockResolvedValue(false as never);
    const res = await patch({ status: 'reviewed' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('wiki_report_changed');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

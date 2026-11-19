import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(), superadmin: vi.fn(), mode: vi.fn(), owner: vi.fn(),
  listNotes: vi.fn(), listReports: vi.fn(), getNote: vi.fn(), writeNote: vi.fn(), getReport: vi.fn(),
  closeReport: vi.fn(), rate: vi.fn(), audit: vi.fn(), expire: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: h.auth, isSuperadmin: h.superadmin,
  AuthError: class extends Error {
    constructor(message: string, readonly statusCode: number, readonly code: string) {
      super(message);
    }
  },
}));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({ resolveLeaguePhaseRoute: h.owner }));
vi.mock('@/lib/supabase/queries/phase-wiki-notes', () => ({
  phaseWikiStorage: {
    listNotes: h.listNotes, listReports: h.listReports, getNote: h.getNote, writeNote: h.writeNote,
    getReport: h.getReport, closeReport: h.closeReport,
  },
}));
vi.mock('@/lib/utils/rate-limit', () => ({ checkRateLimit: h.rate }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: h.expire }));

import { GET } from '../[queue]/route';
import { PATCH } from '../[queue]/[entryId]/route';

const id = 'ab000000-0000-4000-8000-000000000001';
const phaseId = 'ab000000-0000-4000-8000-000000000002';
const noteId = 'ab000000-0000-4000-8000-000000000003';
const reportId = 'ab000000-0000-4000-8000-000000000004';
const href = 'http://localhost/api/seasons/league/phases/phase/wiki/moderation';
const stamp = '2026-11-19T12:00:00.123456+00:00';
const newer = '2026-11-19T12:00:00.123457+00:00';
const note = {
  id: noteId, phase_id: phaseId, entity_type: 'move', entity_name: 'Tackle', author_id: 'author',
  content: 'Synthetic note', approved: false, rejected_at: null, resubmission_blocked_at: null, updated_at: stamp,
};
const report = { id: reportId, note_id: noteId, reporter_id: 'reporter', status: 'open', updated_at: stamp };
const admin = { playerId: 'admin', name: 'Sample Admin', isAdmin: true };
const approve = { approved: true, expected_state: 'pending', expected_updated_at: stamp };
const close = { status: 'reviewed', expected_status: 'open', expected_updated_at: stamp };

function list(queue: string, query = '') {
  return GET(new NextRequest(`${href}/${queue}${query}`), { params: Promise.resolve({ id, phaseId, queue }) });
}

function patch(queue: string, body: object, entryId = queue === 'notes' ? noteId : reportId) {
  return PATCH(new NextRequest(`${href}/${queue}/${entryId}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: id.toUpperCase(), phaseId: phaseId.toUpperCase(), queue, entryId: entryId.toUpperCase() }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ player: admin });
  h.superadmin.mockReturnValue(false);
  h.mode.mockResolvedValue('phase');
  h.owner.mockResolvedValue({ kind: 'phase', phase_id: phaseId, season_id: id });
  h.listNotes.mockResolvedValue([note]);
  h.listReports.mockResolvedValue([{ ...report, note }]);
  h.getNote.mockResolvedValue(note);
  h.getReport.mockResolvedValue(report);
  h.writeNote.mockResolvedValue(true);
  h.closeReport.mockResolvedValue(true);
});

describe('native phase wiki moderation', () => {
  it.each(['phase', 'frozen_phase'])('returns only the requested, uncached admin queues in %s', async mode => {
    h.mode.mockResolvedValue(mode);
    const notes = await list('notes', '?status=rejected&limit=10&offset=5');
    expect(notes.headers.get('cache-control')).toBe('no-store');
    expect(await notes.json()).toEqual({ success: true, data: [note] });
    expect(h.listNotes).toHaveBeenCalledExactlyOnceWith(phaseId, false, undefined, { status: 'rejected', limit: 10, offset: 5 });
    const reports = await list('reports', '?status=open');
    expect(await reports.json()).toEqual({ success: true, data: [{ ...report, note }] });
    expect(h.listReports).toHaveBeenCalledExactlyOnceWith(phaseId, { status: 'open', limit: 50, offset: 0 });
    expect(h.owner).toHaveBeenCalledWith(id, phaseId, 'phase');
  });

  it.each([[null, 403], [{ ...admin, isAdmin: false, isResourceAdmin: true }, 403]])(
    'denies non-admin identities before opening either store', async (player, status) => {
      h.auth.mockResolvedValue({ player });
      for (const response of [await list('notes'), await list('reports'), await patch('notes', approve), await patch('reports', close)]) {
        expect(response.status).toBe(status);
      }
      expect(h.mode).not.toHaveBeenCalled();
      expect(h.owner).not.toHaveBeenCalled();
    },
  );

  it.each([['legacy', 404], ['frozen_legacy', 503], ['frozen_phase', 503]])('refuses moderation writes in %s', async (mode, status) => {
    h.mode.mockResolvedValue(mode);
    if (mode !== 'frozen_phase') {
      expect((await list('notes')).status).toBe(status);
      expect((await list('reports')).status).toBe(status);
    }
    expect((await patch('notes', approve)).status).toBe(status);
    expect((await patch('reports', close)).status).toBe(status);
    expect(h.owner).not.toHaveBeenCalled();
    expect(h.getNote).not.toHaveBeenCalled();
    expect(h.getReport).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });

  it('rejects wrong league and wrong-phase entries without writing', async () => {
    h.owner.mockResolvedValueOnce(null);
    expect((await list('reports')).status).toBe(404);
    expect(h.listReports).not.toHaveBeenCalled();
    h.getNote.mockResolvedValueOnce(null);
    h.getReport.mockResolvedValueOnce(null);
    expect((await patch('notes', approve)).status).toBe(404);
    expect((await patch('reports', close)).status).toBe(404);
    expect(h.getNote).toHaveBeenCalledWith(phaseId, noteId);
    expect(h.getReport).toHaveBeenCalledWith(phaseId, reportId);
    expect(h.writeNote).not.toHaveBeenCalled();
    expect(h.closeReport).not.toHaveBeenCalled();
  });

  it('rejects invalid ids, oversized pages, mixed actions and missing expected versions', async () => {
    const invalidId = await patch('reports', close, 'invalid');
    expect(await invalidId.json()).toMatchObject({ code: 'INVALID_WIKI_REPORT_ID' });
    for (const response of [
      await list('notes', '?limit=101'),
      await patch('notes', { ...approve, rejected: true }),
      await patch('notes', { approved: true, expected_state: 'pending' }),
      await patch('reports', { status: 'dismissed', expected_updated_at: stamp }),
    ]) expect(response.status).toBe(400);
    expect(h.listNotes).not.toHaveBeenCalled();
    expect(h.getNote).not.toHaveBeenCalled();
    expect(h.getReport).not.toHaveBeenCalled();
  });

  it('approves or unpublishes only as a live site admin and expires/audits after each commit', async () => {
    expect((await patch('notes', approve)).status).toBe(200);
    expect(h.writeNote).toHaveBeenCalledWith(note, expect.objectContaining({ approved: true, approved_by: admin.playerId }), false);
    expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.approve', resource_id: noteId, metadata: { phase_id: phaseId, season_id: id },
    }));
    const published = { ...note, approved: true };
    h.getNote.mockResolvedValueOnce(published);
    expect((await patch('notes', { rejected: true, expected_state: 'approved', expected_updated_at: stamp })).status).toBe(200);
    expect(h.audit).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'wiki.note.reject', metadata: { reason: null, was_approved: true, phase_id: phaseId, season_id: id },
    }));
    expect(h.writeNote.mock.invocationCallOrder[0]).toBeLessThan(h.expire.mock.invocationCallOrder[0]);
    expect(h.writeNote.mock.invocationCallOrder[0]).toBeLessThan(h.audit.mock.invocationCallOrder[0]);
    expect(h.rate).not.toHaveBeenCalled();
  });

  it('requires the live superadmin for a resubmission block and makes repeats a no-op', async () => {
    const block = { block_resubmission: true, expected_state: 'rejected', expected_updated_at: stamp };
    const rejected = { ...note, rejected_at: stamp };
    h.getNote.mockResolvedValue(rejected);
    const refused = await patch('notes', block);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'wiki_note_block_superadmin_only' });
    expect(h.getNote).not.toHaveBeenCalled();
    h.superadmin.mockReturnValue(true);
    expect((await patch('notes', block)).status).toBe(200);
    expect(h.writeNote).toHaveBeenCalledWith(rejected, expect.objectContaining({ resubmission_blocked_by: admin.playerId }), false);
    expect(h.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'wiki.note.block_resubmission' }));
    h.getNote.mockResolvedValue({ ...rejected, resubmission_blocked_at: stamp, updated_at: newer });
    expect((await patch('notes', { ...block, expected_state: 'blocked', expected_updated_at: newer })).status).toBe(200);
    expect(h.writeNote).toHaveBeenCalledOnce();
    expect(h.audit).toHaveBeenCalledOnce();
    expect(h.expire).toHaveBeenCalledOnce();
    expect((await patch('notes', { ...block, block_resubmission: false, expected_state: 'blocked', expected_updated_at: newer })).status).toBe(200);
    expect(h.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'wiki.note.unblock_resubmission' }));
  });

  it('refuses note changes at microsecond precision and failed write CAS without side effects', async () => {
    const stale = await patch('notes', { ...approve, expected_updated_at: newer });
    expect(await stale.json()).toMatchObject({ code: 'wiki_note_changed' });
    expect(h.writeNote).not.toHaveBeenCalled();
    h.writeNote.mockResolvedValue(false);
    const raced = await patch('notes', approve);
    expect(raced.status).toBe(409);
    expect(await raced.json()).toMatchObject({ code: 'wiki_note_changed' });
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });

  it('requires the exact report status/version, refuses reopen and swaps, and audits only a committed close', async () => {
    h.getReport.mockResolvedValueOnce({ ...report, updated_at: newer });
    expect(await (await patch('reports', close)).json()).toMatchObject({ code: 'wiki_report_changed' });
    expect(await (await patch('reports', { ...close, status: 'open' })).json()).toMatchObject({ code: 'state_transition_forbidden' });
    h.getReport.mockResolvedValueOnce({ ...report, status: 'dismissed' });
    expect(await (await patch('reports', { ...close, expected_status: 'dismissed' })).json()).toMatchObject({ code: 'state_transition_invalid' });
    expect(h.closeReport).not.toHaveBeenCalled();
    h.closeReport.mockResolvedValueOnce(false);
    expect(await (await patch('reports', close)).json()).toMatchObject({ code: 'wiki_report_changed' });
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
    expect((await patch('reports', close)).status).toBe(200);
    expect(h.closeReport).toHaveBeenLastCalledWith(report, 'reviewed');
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'wiki.report.update', resource_type: 'wiki_note_report', resource_id: reportId,
      metadata: { status: 'reviewed', note_id: noteId, phase_id: phaseId, season_id: id },
    }));
    expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
    expect(h.writeNote).not.toHaveBeenCalled();
  });
});

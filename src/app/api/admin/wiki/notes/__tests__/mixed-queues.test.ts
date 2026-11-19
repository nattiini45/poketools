import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';

const h = vi.hoisted(() => ({ from: vi.fn(), admin: vi.fn(), mode: vi.fn(), audit: vi.fn(), expire: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: h.from } }));
vi.mock('@/lib/auth/helpers', () => ({ requireAdmin: h.admin }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: h.expire }));

import { GET as notes } from '../route';
import { GET as reports } from '../../reports/route';
import { PATCH } from '../../reports/[id]/route';

const db = {
  wiki_notes: createMockSupabase(),
  wiki_note_reports: createMockSupabase(),
  phase_wiki_notes: createMockSupabase(),
  phase_wiki_note_reports: createMockSupabase(),
  league_phases: createMockSupabase(),
  tournaments: createMockSupabase(),
};
const admin = { playerId: 'admin', name: 'Sample Admin', isAdmin: true };
const phaseId = 'ab000000-0000-4000-8000-000000000002';
const seasonId = 'ab000000-0000-4000-8000-000000000003';
const reportId = 'ab000000-0000-4000-8000-000000000004';
const noteId = 'ab000000-0000-4000-8000-000000000005';
const tournamentId = 'ab000000-0000-4000-8000-000000000006';
const when = '2026-11-19T12:00:00.123455+00:00';
const newer = '2026-11-19T12:00:00.123456+00:00';
const older = '2026-11-19T11:00:00Z';
const baseNote = { entity_type: 'move', entity_name: 'Tackle', content: 'Synthetic note', author_id: 'trainer', approved: false, updated_at: when };
const legacy = { ...baseNote, id: 'z', scope_type: 'global', scope_id: null, created_at: when };
const native = { ...baseNote, id: noteId, phase_id: phaseId, created_at: newer, moderation_flags: ['sample'] };
const report = {
  id: reportId, note_id: noteId, status: 'open', reporter_id: 'trainer',
  created_at: newer, updated_at: when, reason: 'spam', details: 'Synthetic report',
};
const nativeOwner = { note_id: noteId, reporter_id: 'trainer', note: { phase_id: phaseId, phase: { season_id: seasonId } } };
const retiredReport = { ...report, note: { scope_type: 'tournament', scope_id: phaseId } };
const expected = { status: 'reviewed', expected_status: 'open', expected_updated_at: when };
const url = 'http://localhost/api/admin/wiki';

function patch(body: object) {
  return PATCH(new NextRequest(`${url}/reports/${reportId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: reportId.toUpperCase() }) });
}

function setPages(table: keyof typeof db, rows: object[]) {
  const store = db[table];
  const range = vi.mocked(store.range as ReturnType<typeof vi.fn>);
  range.mockImplementation((from: number, to: number) => {
    store.__setResult(rows.slice(from, to + 1));
    return store;
  });
}

beforeEach(() => {
  for (const mock of Object.values(h)) mock.mockReset();
  for (const store of Object.values(db)) {
    store.__reset();
    vi.mocked(store.range as ReturnType<typeof vi.fn>).mockReturnValue(store);
    store.maybeSingle.mockImplementation(() => Promise.resolve({ data: null, error: null }));
  }
  h.admin.mockResolvedValue(admin);
  h.mode.mockResolvedValue('phase');
  h.from.mockImplementation((table: keyof typeof db) => {
    if (!(table in db)) throw new Error(`Unexpected table: ${table}`);
    return db[table];
  });
});

describe('global admin Wiki queues', () => {
  it.each(['legacy', 'frozen_legacy'])('keeps the exact query page and no native reads in %s', async mode => {
    h.mode.mockResolvedValue(mode);
    db.wiki_notes.__setResult([legacy]);
    db.wiki_note_reports.__setResult([{ ...report, wiki_notes: legacy }]);
    const noteResponse = await notes(new NextRequest(`${url}/notes?status=pending&offset=3&limit=2`));
    const reportResponse = await reports(new NextRequest(`${url}/reports?status=open&offset=4&limit=1`));
    expect(noteResponse.headers.get('cache-control')).toBeNull();
    expect(await noteResponse.json()).toMatchObject({ success: true, data: [{ id: 'z', scope_type: 'global' }] });
    expect(await reportResponse.json()).toMatchObject({ success: true, data: [{ id: reportId, note: { id: 'z' } }] });
    expect(h.from.mock.calls).toEqual([['wiki_notes'], ['wiki_note_reports']]);
    expect(db.wiki_notes.range).toHaveBeenCalledExactlyOnceWith(3, 4);
    expect(db.wiki_note_reports.range).toHaveBeenCalledExactlyOnceWith(4, 4);
    expect(db.wiki_notes.order).toHaveBeenCalledExactlyOnceWith('created_at', { ascending: false });
  });

  it.each(['phase', 'frozen_phase'])('orders the filtered native and retained notes together before applying offset in %s', async mode => {
    h.mode.mockResolvedValue(mode);
    const retired = { ...legacy, id: noteId, scope_type: 'tournament', scope_id: phaseId, created_at: newer };
    const orphan = { ...retired, id: 'orphan', scope_id: 'ab000000-0000-4000-8000-000000000007' };
    const standalone = { ...legacy, id: 'old-standalone', scope_type: 'tournament', scope_id: tournamentId, created_at: older };
    setPages('wiki_notes', [retired, orphan, legacy, standalone]);
    setPages('phase_wiki_notes', [{ ...native, id: 'a' }, { ...native, id: 'b', created_at: older }]);
    db.league_phases.__setResult([{ id: phaseId }]);
    db.tournaments.__setResult([{ id: tournamentId }]);
    const response = await notes(new NextRequest(`${url}/notes?status=rejected&offset=1&limit=3`));
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    expect(result.data.map((note: { id: string }) => note.id)).toEqual(['z', 'old-standalone', 'b']);
    expect(result.data[2]).toMatchObject({ phase_id: phaseId, moderation_flags: ['sample'] });
    expect(result.data[2]).not.toHaveProperty('scope_type');
    expect(db.wiki_notes.not).toHaveBeenCalledWith('rejected_at', 'is', null);
    expect(db.phase_wiki_notes.not).toHaveBeenCalledWith('rejected_at', 'is', null);
    expect(db.wiki_notes.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(db.phase_wiki_notes.order).toHaveBeenCalledWith('id', { ascending: false });
  });

  it('reads another page if retired reports control the first chunk and keeps the real phase and admin fields', async () => {
    const oldReports = Array.from({ length: 50 }, (_, index) => ({
      ...report, id: `retired-${index}`, wiki_notes: { ...legacy, scope_type: 'tournament', scope_id: phaseId },
    }));
    setPages('wiki_note_reports', [...oldReports, { ...report, id: 'retained', created_at: older, wiki_notes: legacy }]);
    setPages('phase_wiki_note_reports', [{ ...report, note: native, players: { name: 'Sample Reporter' } }]);
    db.league_phases.__setResult([{ id: phaseId }]);
    const response = await reports(new NextRequest(`${url}/reports?status=open&limit=2`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([reportId, 'retained']);
    expect(body.data[0]).toMatchObject({ reporter_name: 'Sample Reporter', details: report.details, note: { phase_id: phaseId } });
    expect(body.data[1]).not.toHaveProperty('scope_type');
    expect(db.wiki_note_reports.range).toHaveBeenCalledWith(50, 99);
    expect(db.wiki_note_reports.eq).toHaveBeenCalledWith('status', 'open');
    expect(db.phase_wiki_note_reports.eq).toHaveBeenCalledWith('status', 'open');
  });

  it('fails closed on a read or ownership error instead of serving a legacy-only page', async () => {
    db.phase_wiki_notes.__setError(new Error('native queue offline'));
    db.wiki_notes.__setResult([legacy]);
    const nativeFailure = await notes(new NextRequest(`${url}/notes`));
    expect(nativeFailure.status).toBe(500);
    expect(await nativeFailure.json()).toEqual({ success: false, error: 'Failed to list wiki notes' });
    db.phase_wiki_notes.__setResult([]);
    db.wiki_notes.__setResult([{ ...legacy, scope_type: 'tournament', scope_id: tournamentId }]);
    db.tournaments.__setError(new Error('ownership lookup offline'));
    expect((await notes(new NextRequest(`${url}/notes`))).status).toBe(500);
  });

  it('refuses an unprovable deep page instead of returning a misleading partial queue', async () => {
    setPages('wiki_notes', Array.from({ length: 2_001 }, (_, index) => ({ ...legacy, id: `legacy-${index}` })));
    const response = await notes(new NextRequest(`${url}/notes?offset=2000&limit=1`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'wiki_queue_scan_limit' });
    expect(db.wiki_notes.range).toHaveBeenCalledTimes(10);
  });

  it('returns a short page or an empty deep page only when both stores are exhausted', async () => {
    setPages('wiki_notes', [legacy]);
    setPages('phase_wiki_notes', [native]);
    expect(await (await notes(new NextRequest(`${url}/notes?offset=1&limit=2`))).json()).toMatchObject({
      success: true, data: [{ id: legacy.id }],
    });
    expect(await (await notes(new NextRequest(`${url}/notes?offset=5000&limit=1`))).json()).toEqual({
      success: true, data: [],
    });
  });

  it('does not return a mixed page with conflicting entry IDs', async () => {
    setPages('wiki_notes', [{ ...legacy, id: noteId }]);
    setPages('phase_wiki_notes', [native]);
    const response = await notes(new NextRequest(`${url}/notes?limit=2`));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'wiki_queue_id_conflict' });
  });

  it('requires live site admin before reading either queue or resolving a report', async () => {
    h.admin.mockRejectedValue(Object.assign(new Error('Admin access required'), { statusCode: 403, code: 'forbidden' }));
    expect((await notes(new NextRequest(`${url}/notes`))).status).toBe(403);
    expect((await reports(new NextRequest(`${url}/reports`))).status).toBe(403);
    expect((await patch(expected)).status).toBe(403);
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe('legacy report-ID close after native cutover', () => {
  it('requires the observed version, CAS-closes the real report, and audits/expires after the write', async () => {
    db.phase_wiki_note_reports.maybeSingle
      .mockResolvedValueOnce({ data: nativeOwner, error: null })
      .mockResolvedValueOnce({ data: nativeOwner, error: null })
      .mockResolvedValueOnce({ data: { ...report, updated_at: newer }, error: null })
      .mockResolvedValueOnce({ data: nativeOwner, error: null })
      .mockResolvedValueOnce({ data: report, error: null });
    db.phase_wiki_note_reports.__setResult([{ id: reportId }]);
    const missing = await patch({ status: 'reviewed' });
    expect(missing.status).toBe(400);
    expect(await (await patch(expected)).json()).toMatchObject({ code: 'wiki_report_changed' });
    expect(db.phase_wiki_note_reports.update).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    const response = await patch(expected);
    expect(await response.json()).toEqual({ success: true, data: { updated: true } });
    expect(db.phase_wiki_note_reports.eq).toHaveBeenCalledWith('id', reportId);
    expect(db.phase_wiki_note_reports.eq).toHaveBeenCalledWith('phase_wiki_notes.phase_id', phaseId);
    expect(db.phase_wiki_note_reports.eq).toHaveBeenCalledWith('status', 'open');
    expect(db.phase_wiki_note_reports.eq).toHaveBeenCalledWith('updated_at', when);
    expect(db.wiki_note_reports.update).not.toHaveBeenCalled();
    expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, seasonId);
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'wiki.report.update', resource_id: reportId,
      metadata: { phase_id: phaseId, season_id: seasonId, status: 'reviewed', note_id: noteId },
    }));
    expect(db.phase_wiki_note_reports.update.mock.invocationCallOrder[0]).toBeLessThan(h.audit.mock.invocationCallOrder[0]);
  });

  it.each(['frozen_phase', 'frozen_legacy'])('refuses phase reports in %s before mutation', async mode => {
    h.mode.mockResolvedValue(mode);
    if (mode === 'frozen_phase') db.phase_wiki_note_reports.maybeSingle.mockResolvedValue({ data: nativeOwner, error: null });
    else {
      db.wiki_note_reports.maybeSingle.mockResolvedValue({ data: retiredReport, error: null });
      db.tournaments.maybeSingle.mockResolvedValue({ data: { id: phaseId, season_id: seasonId }, error: null });
    }
    expect((await patch(expected)).status).toBe(503);
    if (mode === 'frozen_legacy') expect(h.from).not.toHaveBeenCalledWith('phase_wiki_note_reports');
    expect(db.phase_wiki_note_reports.update).not.toHaveBeenCalled();
    expect(db.wiki_note_reports.update).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });

  it('rejects conflicting report lineage rather than acting on either row', async () => {
    db.phase_wiki_note_reports.maybeSingle.mockResolvedValue({ data: nativeOwner, error: null });
    db.wiki_note_reports.maybeSingle.mockResolvedValue({ data: { ...retiredReport, reporter_id: 'other' }, error: null });
    const response = await patch(expected);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'wiki_report_owner_conflict' });
    expect(db.phase_wiki_note_reports.update).not.toHaveBeenCalled();
    expect(db.wiki_note_reports.update).not.toHaveBeenCalled();
  });

  it('does not close a retired legacy report with no native counterpart or fall back on a failed probe', async () => {
    db.wiki_note_reports.maybeSingle.mockResolvedValue({ data: retiredReport, error: null });
    db.league_phases.maybeSingle.mockResolvedValue({ data: { id: phaseId, season_id: seasonId }, error: null });
    expect((await patch(expected)).status).toBe(404);
    db.phase_wiki_note_reports.maybeSingle.mockResolvedValue({ data: null, error: new Error('lookup unavailable') });
    expect((await patch(expected)).status).toBe(500);
    expect(db.wiki_note_reports.update).not.toHaveBeenCalled();
    expect(db.phase_wiki_note_reports.update).not.toHaveBeenCalled();
  });

  it('keeps retained standalone reports on the legacy status CAS with the old body', async () => {
    db.wiki_note_reports.maybeSingle.mockResolvedValue({ data: {
      ...report, note: { scope_type: 'tournament', scope_id: tournamentId },
    }, error: null });
    db.tournaments.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: tournamentId }, error: null });
    db.wiki_note_reports.__setResult([{ id: reportId }]);
    expect((await patch({ status: 'reviewed' })).status).toBe(200);
    expect(db.wiki_note_reports.eq).toHaveBeenCalledWith('status', 'open');
    expect(db.wiki_note_reports.update).toHaveBeenCalledOnce();
    expect(db.phase_wiki_note_reports.update).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'wiki.report.update', metadata: { status: 'reviewed' } }));
    expect(h.expire).not.toHaveBeenCalled();
  });
});

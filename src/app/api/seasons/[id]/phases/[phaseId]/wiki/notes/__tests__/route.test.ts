import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(), mode: vi.fn(), owner: vi.fn(),
  list: vi.fn(), create: vi.fn(), note: vi.fn(), write: vi.fn(),
  findReport: vi.fn(), submitReport: vi.fn(),
  rate: vi.fn(), audit: vi.fn(), expire: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: h.auth, isSuperadmin: () => false,
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
    listNotes: h.list, createNote: h.create, getNote: h.note, writeNote: h.write,
    findReport: h.findReport, submitReport: h.submitReport,
  },
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/utils/rate-limit')>(),
  checkRateLimit: h.rate,
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: h.expire }));

import { GET, POST } from '../route';
import { PATCH, DELETE } from '../[noteId]/route';
import { POST as report } from '../[noteId]/report/route';

const id = 'ab000000-0000-4000-8000-000000000001';
const phaseId = 'ab000000-0000-4000-8000-000000000002';
const noteId = 'ab000000-0000-4000-8000-000000000003';
const params = { params: Promise.resolve({ id: id.toUpperCase(), phaseId: phaseId.toUpperCase(), noteId }) };
const href = 'http://localhost/api/seasons/league/phases/phase/wiki/notes';
const stamp = '2026-11-19T12:00:00Z';
const input = { entity_type: 'move', entity_name: 'Tackle', content: 'A synthetic note.' };
const note = {
  ...input, id: noteId, phase_id: phaseId, approved: true, author_id: 'author',
  author_name: 'Sample Player', approved_by: 'moderator', approved_at: stamp,
  rejected_at: null, resubmission_blocked_at: null, moderation_flags: ['sample'],
  created_at: stamp, updated_at: stamp,
};
const author = { playerId: 'author', name: 'Sample Player', isAdmin: false };

function json(method: string, data: object) {
  return new NextRequest(href, { method, body: JSON.stringify(data) });
}

const read = () => GET(new NextRequest(`${href}?entity_type=move&entity_name=Tackle`), params);
const writes = [
  ['create', () => POST(json('POST', input), params)],
  ['edit', () => PATCH(json('PATCH', { content: input.content }), params)],
  ['delete', () => DELETE(new NextRequest(href, { method: 'DELETE' }), params)],
  ['report', () => report(json('POST', { reason: 'spam' }), params)],
] as const;
const rateOptions = { limit: 10, windowSeconds: 86_400 };

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ player: author });
  h.mode.mockResolvedValue('phase');
  h.owner.mockResolvedValue({ kind: 'phase', phase_id: phaseId, season_id: id });
  h.list.mockResolvedValue([note, { ...note, approved: false }, { ...note, rejected_at: stamp }]);
  h.create.mockResolvedValue({ ...note, approved: false });
  h.note.mockResolvedValue(note);
  h.write.mockResolvedValue(true);
  h.findReport.mockResolvedValue(null);
  h.submitReport.mockResolvedValue({
    id: 'receipt', status: 'open', created_at: stamp, updated_at: stamp, reporter_id: 'author', reason: 'spam',
  });
  h.rate.mockResolvedValue({ allowed: true });
});

describe('native phase wiki notes', () => {
  it.each(['phase', 'frozen_phase'])('lists approved notes using an uncached %s snapshot', async (mode) => {
    h.mode.mockResolvedValue(mode);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(h.owner).toHaveBeenCalledWith(id, phaseId, 'phase');
    expect(h.list).toHaveBeenCalledWith(phaseId, true, { type: 'move', name: 'Tackle' });
    expect(await response.json()).toEqual({ success: true, data: [{
      ...input, id: noteId, phase_id: phaseId, author_name: 'Sample Player', created_at: stamp, updated_at: stamp,
    }] });
  });

  it.each([['legacy', 404], ['frozen_legacy', 503]])('does not query phase storage in %s', async (mode, status) => {
    h.mode.mockResolvedValue(mode);
    for (const enter of [read, ...writes.map(([, action]) => action)]) {
      expect((await enter()).status).toBe(status);
    }
    expect(h.owner).not.toHaveBeenCalled();
    expect(h.list).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
  });

  it.each(writes)('refuses %s during frozen native mode before looking up or touching the phase', async (_name, action) => {
    h.mode.mockResolvedValue('frozen_phase');
    expect((await action()).status).toBe(503);
    expect(h.owner).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });

  it('requires a registered live player and rejects another league before reading notes', async () => {
    h.auth.mockResolvedValueOnce({ player: null });
    expect((await read()).status).toBe(403);
    expect(h.owner).not.toHaveBeenCalled();
    h.owner.mockResolvedValue(null);
    expect((await read()).status).toBe(404);
    for (const [, action] of writes) expect((await action()).status).toBe(404);
    expect(h.owner).toHaveBeenCalledWith(id, phaseId, 'phase');
    expect(h.list).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
  });

  it('passes live auth failures through without touching the mode or stores', async () => {
    h.auth.mockRejectedValue(Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'unauthorized' }));
    const response = await read();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.owner).not.toHaveBeenCalled();
  });

  it('does not turn a failed ownership lookup into a missing phase or expose its details', async () => {
    h.owner.mockRejectedValue(new Error('private ownership query detail'));
    const response = await read();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to fetch phase wiki notes' });
    expect(h.list).not.toHaveBeenCalled();
  });

  it('validates UUIDs, queries, JSON, and strict write bodies before touching wiki storage', async () => {
    const badParams = { params: Promise.resolve({ id, phaseId, noteId: 'invalid' }) };
    const badId = await PATCH(json('PATCH', { content: input.content }), badParams);
    expect(await badId.json()).toMatchObject({ code: 'INVALID_NOTE_ID' });
    expect(h.mode).not.toHaveBeenCalled();
    const invalidJson = await POST(new NextRequest(href, { method: 'POST', body: '{' }), params);
    expect(await invalidJson.json()).toMatchObject({ code: 'invalid_json' });
    for (const response of [
      await GET(new NextRequest(`${href}?entity_type=move`), params),
      await POST(json('POST', { ...input, scope_type: 'league' }), params),
      await PATCH(json('PATCH', { content: input.content, approved: true }), params),
      await report(json('POST', { reason: 'invalid' }), params),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'validation_failed' });
    }
    expect(h.list).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
  });

  it.each([
    ['wiki-notes', writes[0][1]],
    ['wiki-report', writes[3][1]],
  ] as const)('shares the %s rate bucket with global writes', async (bucket, action) => {
    h.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const response = await action();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(h.rate).toHaveBeenCalledWith(bucket, author.playerId, rateOptions);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
  });

  it('returns only a newly submitted note receipt', async () => {
    const response = await writes[0][1]();
    expect(response.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith(phaseId, 'author', input, expect.any(Array));
    expect(await response.json()).toEqual({
      success: true, data: { id: noteId, phase_id: phaseId, approved: false, created_at: stamp, updated_at: stamp },
    });
  });

  it('delegates note ownership, resubmission, and stale mutations to the native service', async () => {
    h.auth.mockResolvedValueOnce({ player: { ...author, playerId: 'other', isResourceAdmin: true } });
    const forbidden = await writes[1][1]();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: 'wiki_note_edit_forbidden' });
    h.note.mockResolvedValueOnce(null);
    expect((await writes[2][1]()).status).toBe(404);
    expect(h.note).toHaveBeenCalledWith(phaseId, noteId);
    expect(h.write).not.toHaveBeenCalled();

    h.write.mockResolvedValueOnce(false);
    const stale = await writes[1][1]();
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'wiki_note_changed' });
    expect(h.write).toHaveBeenCalledWith(note, expect.objectContaining({ approved: false, approved_at: null }), false);
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });

  it('keeps approval when a live site admin edits the note', async () => {
    h.auth.mockResolvedValue({ player: { ...author, playerId: 'admin', isAdmin: true } });
    const response = await writes[1][1]();
    expect(await response.json()).toEqual({ success: true, data: { updated: true, requeued: false } });
    expect(h.write).toHaveBeenCalledWith(note, { content: input.content, moderation_flags: [] }, false);
    expect(h.rate).not.toHaveBeenCalled();
  });

  it('rejects a report on a pending note and returns only a receipt on success', async () => {
    h.note.mockResolvedValueOnce({ ...note, approved: false });
    expect((await writes[3][1]()).status).toBe(404);
    expect(h.findReport).not.toHaveBeenCalled();
    expect(h.submitReport).not.toHaveBeenCalled();
    const response = await writes[3][1]();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true, data: { id: 'receipt', status: 'open', created_at: stamp, updated_at: stamp },
    });
  });

  it.each([
    ['wiki.note.create', writes[0][1], h.create],
    ['wiki.note.update', writes[1][1], h.write],
    ['wiki.note.delete', writes[2][1], h.write],
    ['wiki.note.report', writes[3][1], h.submitReport],
  ] as const)('expires the verified phase and league and audits %s only after the write', async (auditAction, action, mutation) => {
    expect((await action()).ok).toBe(true);
    expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: auditAction, resource_id: noteId, resource_name: 'move:Tackle',
      metadata: expect.objectContaining({ phase_id: phaseId, season_id: id }),
    }));
    expect(mutation.mock.invocationCallOrder[0]).toBeLessThan(h.expire.mock.invocationCallOrder[0]);
    expect(mutation.mock.invocationCallOrder[0]).toBeLessThan(h.audit.mock.invocationCallOrder[0]);
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';

const h = vi.hoisted(() => ({
  player: vi.fn(), admin: vi.fn(), superadmin: vi.fn(), mode: vi.fn(), rate: vi.fn(),
  nativeOwner: vi.fn(), nativePhase: vi.fn(), legacyPhase: vi.fn(), standalone: vi.fn(),
  nativeNote: vi.fn(), nativeCreate: vi.fn(), nativeWrite: vi.fn(), findReport: vi.fn(), nativeReport: vi.fn(),
  legacyNote: vi.fn(), legacyCreate: vi.fn(), legacyUpdate: vi.fn(), legacyDelete: vi.fn(),
  legacyReport: vi.fn(), legacyApprove: vi.fn(), legacyReject: vi.fn(), legacyBlock: vi.fn(),
  audit: vi.fn(), expire: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: h.player, requireAdmin: h.admin, isSuperadminNow: h.superadmin }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findLegacyPhaseAliasOwner: h.legacyPhase, findNativePhaseAliasOwner: h.nativePhase,
  standaloneTournamentAliasExists: h.standalone,
}));
vi.mock('@/lib/supabase/queries/phase-wiki-notes', () => ({
  findNativeWikiNoteOwner: h.nativeOwner,
  phaseWikiStorage: {
    getNote: h.nativeNote, createNote: h.nativeCreate, writeNote: h.nativeWrite,
    findReport: h.findReport, submitReport: h.nativeReport,
  },
}));
vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  getNoteById: h.legacyNote, createNote: h.legacyCreate, updateNote: h.legacyUpdate, deleteNote: h.legacyDelete,
  createNoteReport: h.legacyReport, approveNote: h.legacyApprove, rejectNote: h.legacyReject, setNoteResubmissionBlock: h.legacyBlock,
}));
vi.mock('@/lib/utils/rate-limit', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/utils/rate-limit')>(),
  checkRateLimit: h.rate,
}));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: h.expire }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));
vi.mock('@/lib/supabase/client', () => ({ supabase: createMockSupabase() }));

import { POST as create } from '../route';
import { PATCH, DELETE } from '../[id]/route';
import { POST as report } from '../[id]/report/route';
import { supabase } from '@/lib/supabase/client';

const noteId = 'ab000000-0000-4000-8000-000000000001';
const phaseId = 'ab000000-0000-4000-8000-000000000002';
const seasonId = 'ab000000-0000-4000-8000-000000000003';
const when = '2026-11-19T12:00:00.123455+00:00';
const next = '2026-11-19T12:00:00.123456+00:00';
const owner = { kind: 'phase', phase_id: phaseId, season_id: seasonId };
const input = { entity_type: 'move', entity_name: 'Tackle', content: 'Synthetic note' };
const note = {
  ...input, id: noteId, phase_id: phaseId, author_id: 'author', approved: true, approved_by: 'admin',
  rejected_at: null, resubmission_blocked_at: null, created_at: when, updated_at: when,
};
const player = { playerId: 'author', name: 'Sample Author', isAdmin: false };
const admin = { playerId: 'admin', name: 'Sample Admin', isAdmin: true };
const legacy = { ...note, scope_type: 'global', scope_id: null };
const retired = { ...legacy, scope_type: 'tournament', scope_id: phaseId };
const receipt = { id: 'report', status: 'open', created_at: when, updated_at: when };
const path = { params: Promise.resolve({ id: noteId.toUpperCase() }) };
const href = 'http://localhost/api/wiki/notes';
const scoped = { ...input, scope_type: 'tournament', scope_id: phaseId.toUpperCase() };
const db = supabase as unknown as ReturnType<typeof createMockSupabase>;

function request(method: string, body?: object) {
  return new NextRequest(href, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

const submit = () => report(request('POST', { reason: 'spam' }), path);
const edit = () => PATCH(request('PATCH', { content: 'Edited note' }), path);
const remove = () => DELETE(request('DELETE'), path);

beforeEach(() => {
  for (const mock of Object.values(h)) mock.mockReset();
  db.__reset();
  h.player.mockResolvedValue(player);
  h.admin.mockResolvedValue(admin);
  h.superadmin.mockResolvedValue(false);
  h.mode.mockResolvedValue('phase');
  h.rate.mockResolvedValue({ allowed: true });
  h.nativeOwner.mockResolvedValue(owner);
  h.nativePhase.mockResolvedValue(null);
  h.legacyPhase.mockResolvedValue(null);
  h.standalone.mockResolvedValue(false);
  h.nativeNote.mockResolvedValue(note);
  h.nativeCreate.mockResolvedValue({ ...note, approved: false });
  h.nativeWrite.mockResolvedValue(true);
  h.findReport.mockResolvedValue(null);
  h.nativeReport.mockResolvedValue({ ...receipt, note_id: noteId, reporter_id: player.playerId, reason: 'spam' });
  h.legacyNote.mockResolvedValue(null);
  h.legacyCreate.mockResolvedValue(legacy);
  h.legacyUpdate.mockResolvedValue(true);
  h.legacyReport.mockResolvedValue({ ...receipt, note_id: noteId, reporter_id: player.playerId, reason: 'spam' });
});

describe('global wiki note-ID write bridge', () => {
  it('resolves the native owner through the note-to-phase relationship, not the legacy scope', async () => {
    const { findNativeWikiNoteOwner } = await vi.importActual<typeof import('@/lib/supabase/queries/phase-wiki-notes')>(
      '@/lib/supabase/queries/phase-wiki-notes',
    );
    db.__setResult({ phase_id: phaseId, phase: { season_id: seasonId } });
    await expect(findNativeWikiNoteOwner(noteId)).resolves.toEqual(owner);
    expect(db.from).toHaveBeenCalledExactlyOnceWith('phase_wiki_notes');
    expect(db.select).toHaveBeenCalledExactlyOnceWith('phase_id, phase:league_phases!inner(season_id)');
    expect(db.eq).toHaveBeenCalledExactlyOnceWith('id', noteId);
    db.__setError(new Error('owner query unavailable'));
    await expect(findNativeWikiNoteOwner(noteId)).rejects.toThrow('owner query unavailable');
  });

  it('routes a report to its approved native note, returns only the receipt, and expends the legacy bucket once', async () => {
    h.legacyNote.mockResolvedValue(retired);
    const response = await submit();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, data: receipt });
    expect(h.nativeOwner).toHaveBeenCalledExactlyOnceWith(noteId);
    expect(h.nativeNote).toHaveBeenCalledExactlyOnceWith(phaseId, noteId);
    expect(h.nativeReport).toHaveBeenCalledExactlyOnceWith(note, player.playerId, 'spam', null, null);
    expect(h.legacyReport).not.toHaveBeenCalled();
    expect(h.rate).toHaveBeenCalledExactlyOnceWith('wiki-report', player.playerId, { limit: 10, windowSeconds: 86_400 });
    expect(h.player.mock.invocationCallOrder[0]).toBeLessThan(h.nativeOwner.mock.invocationCallOrder[0]);
    expect(h.rate.mock.invocationCallOrder[0]).toBeLessThan(h.nativeOwner.mock.invocationCallOrder[0]);
    expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, seasonId);
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'wiki.note.report', resource_id: noteId, metadata: { reason: 'spam', phase_id: phaseId, season_id: seasonId },
    }));
  });

  it('does not report through a stale approved copy after the native note is rejected or gone', async () => {
    h.legacyNote.mockResolvedValue(retired);
    h.nativeNote.mockResolvedValueOnce({ ...note, approved: false });
    expect(await (await submit()).json()).toMatchObject({ code: 'wiki_note_not_found' });
    h.nativeOwner.mockResolvedValue(null);
    h.nativePhase.mockResolvedValue(owner);
    expect(await (await submit()).json()).toMatchObject({ code: 'wiki_note_not_found' });
    expect(h.legacyReport).not.toHaveBeenCalled();
    expect(h.nativeReport).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });

  it('does not fall back on native lookup failure or a conflicting same-ID legacy note', async () => {
    h.legacyNote.mockResolvedValue(legacy);
    h.nativeOwner.mockRejectedValueOnce(new Error('ownership read failed'));
    expect((await submit()).status).toBe(500);
    const collision = await remove();
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({ code: 'wiki_note_owner_conflict' });
    expect(h.legacyReport).not.toHaveBeenCalled();
    expect(h.legacyDelete).not.toHaveBeenCalled();
    expect(h.nativeWrite).not.toHaveBeenCalled();
  });

  it('does not write when a matching legacy phase scope resolves to another league', async () => {
    h.legacyNote.mockResolvedValue(retired);
    h.legacyPhase.mockResolvedValue({ season_id: 'a-different-league' });
    expect(await (await edit()).json()).toMatchObject({ code: 'wiki_note_owner_conflict' });
    h.nativePhase.mockResolvedValue(owner);
    expect(await (await create(request('POST', scoped))).json()).toMatchObject({ code: 'wiki_note_owner_conflict' });
    expect(h.nativeWrite).not.toHaveBeenCalled();
    expect(h.nativeCreate).not.toHaveBeenCalled();
    expect(h.legacyUpdate).not.toHaveBeenCalled();
    expect(h.legacyCreate).not.toHaveBeenCalled();
  });

  it('does no ownership read after an auth or rate-limit denial', async () => {
    h.player.mockRejectedValueOnce(Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'unauthenticated' }));
    expect((await submit()).status).toBe(401);
    h.rate.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    expect((await submit()).status).toBe(429);
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.nativeOwner).not.toHaveBeenCalled();
    expect(h.legacyNote).not.toHaveBeenCalled();
  });

  it('delegates author edit, delete, cross-author denial and race handling to the native CAS service', async () => {
    h.player.mockResolvedValueOnce({ ...player, playerId: 'another', isResourceAdmin: true });
    expect(await (await edit()).json()).toMatchObject({ code: 'wiki_note_edit_forbidden' });
    h.nativeWrite.mockResolvedValueOnce(false);
    expect(await (await edit()).json()).toMatchObject({ code: 'wiki_note_changed' });
    expect(h.expire).not.toHaveBeenCalled();
    expect(await (await edit()).json()).toEqual({ success: true, data: { updated: true, requeued: true } });
    expect(h.nativeWrite).toHaveBeenLastCalledWith(note, expect.objectContaining({ approved: false, content: 'Edited note' }), false);
    expect(await (await remove()).json()).toEqual({ success: true, data: { deleted: true } });
    expect(h.nativeWrite).toHaveBeenLastCalledWith(note, {}, true);
    expect(h.expire).toHaveBeenCalledTimes(2);
    expect(h.legacyUpdate).not.toHaveBeenCalled();
    expect(h.legacyDelete).not.toHaveBeenCalled();
  });

  it('checks a supplied verdict timestamp exactly but retains the legacy request-read default', async () => {
    const stale = { rejected: true, expected_state: 'approved', expected_updated_at: next };
    expect(await (await PATCH(request('PATCH', stale), path)).json()).toMatchObject({ code: 'wiki_note_changed' });
    expect(h.nativeWrite).not.toHaveBeenCalled();
    expect((await PATCH(request('PATCH', { rejected: true }), path)).status).toBe(200);
    expect(h.nativeWrite).toHaveBeenCalledWith(note, expect.objectContaining({ approved: false, rejected_by: admin.playerId }), false);
    expect(h.admin.mock.invocationCallOrder[0]).toBeLessThan(h.nativeOwner.mock.invocationCallOrder[0]);
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'wiki.note.reject' }));
    expect(h.legacyReject).not.toHaveBeenCalled();
  });

  it('requires live superadmin before resolving a block and preserves the legacy body and response', async () => {
    const block = () => PATCH(request('PATCH', { block_resubmission: true }), path);
    expect(await (await block()).json()).toMatchObject({ code: 'wiki_note_block_superadmin_only' });
    expect(h.nativeOwner).not.toHaveBeenCalled();
    expect(h.legacyNote).not.toHaveBeenCalled();
    h.superadmin.mockResolvedValue(true);
    const rejected = { ...note, approved: false, rejected_at: when };
    h.nativeNote.mockResolvedValue(rejected);
    expect(await (await block()).json()).toEqual({ success: true, data: { updated: true, blocked: true } });
    expect(h.nativeWrite).toHaveBeenCalledExactlyOnceWith(rejected, expect.objectContaining({ resubmission_blocked_by: admin.playerId }), false);
    expect(h.legacyBlock).not.toHaveBeenCalled();
  });

  it('resolves explicit tournament-scope create to native ownership without echoing a tournament alias', async () => {
    h.nativePhase.mockResolvedValue(owner);
    const response = await create(request('POST', scoped));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, data: {
      id: noteId, phase_id: phaseId, approved: false, created_at: when, updated_at: when,
    } });
    expect(h.nativePhase).toHaveBeenCalledExactlyOnceWith({ phaseId });
    expect(h.nativeCreate).toHaveBeenCalledExactlyOnceWith(phaseId, player.playerId, input, []);
    expect(h.legacyCreate).not.toHaveBeenCalled();
    expect(h.rate).toHaveBeenCalledExactlyOnceWith('wiki-notes', player.playerId, { limit: 10, windowSeconds: 86_400 });
    expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, seasonId);
  });

  it('does not create in an ambiguous, unresolved or retired tournament scope', async () => {
    expect(await (await create(request('POST', scoped))).json()).toMatchObject({ code: 'tournament_not_found' });
    h.legacyPhase.mockResolvedValueOnce({ season_id: seasonId });
    expect(await (await create(request('POST', scoped))).json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
    h.nativePhase.mockResolvedValue(owner);
    h.standalone.mockResolvedValue(true);
    expect(await (await create(request('POST', scoped))).json()).toMatchObject({ code: 'wiki_note_owner_conflict' });
    expect(h.legacyCreate).not.toHaveBeenCalled();
    expect(h.nativeCreate).not.toHaveBeenCalled();
  });

  it.each(['frozen_phase', 'frozen_legacy'])('fences phase note and scope writes in %s without blocking global writes', async mode => {
    h.mode.mockResolvedValue(mode);
    if (mode === 'frozen_legacy') {
      h.legacyNote.mockResolvedValue(retired);
      h.legacyPhase.mockResolvedValue({ season_id: seasonId });
    } else {
      h.nativePhase.mockResolvedValue(owner);
    }
    for (const response of [await submit(), await edit(), await remove(), await create(request('POST', scoped))]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    }
    if (mode === 'frozen_legacy') {
      expect(h.nativeOwner).not.toHaveBeenCalled();
      expect(h.nativePhase).not.toHaveBeenCalled();
    }
    expect(h.nativeNote).not.toHaveBeenCalled();
    expect(h.nativeCreate).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
    h.legacyNote.mockResolvedValue(legacy);
    h.nativeOwner.mockResolvedValue(null);
    expect((await submit()).status).toBe(201);
    expect(h.legacyReport).toHaveBeenCalledOnce();
    expect((await create(request('POST', input))).status).toBe(201);
    expect(h.legacyCreate).toHaveBeenCalledOnce();
  });

  it('keeps a verified standalone note on the legacy contract in phase mode', async () => {
    h.nativeOwner.mockResolvedValue(null);
    h.legacyNote.mockResolvedValue(retired);
    h.standalone.mockResolvedValue(true);
    const response = await submit();
    expect(await response.json()).toMatchObject({
      success: true, data: { ...receipt, note_id: noteId, reporter_id: player.playerId, reason: 'spam' },
    });
    expect(h.legacyReport).toHaveBeenCalledOnce();
    expect(h.nativeReport).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalled();
  });
});

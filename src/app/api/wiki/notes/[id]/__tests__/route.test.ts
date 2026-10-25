import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireAdmin: vi.fn(),
  getSession: vi.fn(),
  isSuperadmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  getNoteById: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  approveNote: vi.fn(),
  rejectNote: vi.fn(),
  setNoteResubmissionBlock: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { PATCH, DELETE } from '@/app/api/wiki/notes/[id]/route';
import { requirePlayer, requireAdmin, getSession, isSuperadmin, AuthError } from '@/lib/auth/helpers';
import {
  getNoteById,
  updateNote,
  deleteNote,
  approveNote,
  rejectNote,
  setNoteResubmissionBlock,
} from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';

const PLAYER = { playerId: 'p1', name: 'Test', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' as const };
const ADMIN = { playerId: 'admin1', name: 'Test', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' as const };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const dummyRequest = {} as NextRequest;

const fakeNote = {
  id: 'c3a68c4f-2629-4673-845a-8984a71168c1',
  author_id: 'p1',
  entity_type: 'pokemon' as const,
  entity_name: 'Pikachu',
  content: 'Original note',
  scope_type: 'global' as const,
  scope_id: null,
  approved: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// ── PATCH ────────────────────────────────────────────────────

describe('PATCH /api/wiki/notes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
  });

  // ── Approval flow (admin) ─────────────────────────────────

  it('approves a note when approved=true (admin path)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);
    vi.mocked(approveNote).mockResolvedValue(undefined as never);

    const res = await PATCH(makeRequest({ approved: true }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.updated).toBe(true);
    expect(vi.mocked(requireAdmin)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(approveNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1', 'admin1');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.approve',
      resource_id: 'c3a68c4f-2629-4673-845a-8984a71168c1',
    }));
  });

  it('rejects a note when rejected=true (admin path)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);
    vi.mocked(rejectNote).mockResolvedValue(undefined as never);

    const res = await PATCH(makeRequest({ rejected: true, rejection_reason: 'Needs sources' }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(vi.mocked(rejectNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1', 'admin1', 'Needs sources');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.reject',
      resource_id: 'c3a68c4f-2629-4673-845a-8984a71168c1',
    }));
  });

  it('stores a null reason (no English default) when rejected without one', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);
    vi.mocked(rejectNote).mockResolvedValue(undefined as never);

    const res = await PATCH(makeRequest({ rejected: true }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect((await res.json()).success).toBe(true);
    expect(vi.mocked(rejectNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1', 'admin1', null);
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.reject',
      metadata: { reason: null, was_approved: true },
    }));
  });

  it('returns AuthError when non-admin tries to approve', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Admin required',
      403,
    );
    vi.mocked(requireAdmin).mockRejectedValue(err);

    const res = await PATCH(makeRequest({ approved: true }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(403);
  });

  // ── Content update (author) ───────────────────────────────

  it('returns 404 when note not found', async () => {
    vi.mocked(getNoteById).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ content: 'Updated' }), makeParams('80603476-3ea8-4d9d-8d6c-3366329e1b46'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Note not found');
    expect(body.code).toBe('wiki_note_not_found');
  });

  it('returns 403 when non-author non-admin edits note', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p2', name: 'Test', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' as const });
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);

    const res = await PATCH(makeRequest({ content: 'Hack attempt' }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Not authorized');
    expect(body.code).toBe('wiki_note_edit_forbidden');
  });

  it('rejects empty content', async () => {
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);

    const res = await PATCH(makeRequest({ content: '' }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('content');
    expect(body.code).toBe('validation_failed');
  });

  it('returns wiki_note_content_required when an edit has no content', async () => {
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);

    const res = await PATCH(makeRequest({}), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'content is required', code: 'wiki_note_content_required' });
  });

  it('returns wiki_note_approve_reject_conflict when approving and rejecting at once', async () => {
    const res = await PATCH(makeRequest({ approved: true, rejected: true }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'A note cannot be approved and rejected in the same request',
      code: 'wiki_note_approve_reject_conflict',
    });
  });

  it('rejects content over 2000 characters', async () => {
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);

    const res = await PATCH(makeRequest({ content: 'x'.repeat(2001) }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('2000 characters');
  });

  it('updates note content when author edits', async () => {
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);
    vi.mocked(updateNote).mockResolvedValue(true);

    const res = await PATCH(makeRequest({ content: 'Updated content' }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.updated).toBe(true);
    expect(vi.mocked(updateNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1', 'Updated content', 'author');
  });

  it('re-queues an approved note when its author edits it', async () => {
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never); // approved: true, author p1
    vi.mocked(updateNote).mockResolvedValue(true);

    const res = await PATCH(makeRequest({ content: 'Edited after approval' }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { updated: true, requeued: true } });
    expect(vi.mocked(updateNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1', 'Edited after approval', 'author');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.update',
      metadata: { requeued: true, was_approved: true },
    }));
  });

  it('allows admin to update any note', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(ADMIN);
    vi.mocked(getNoteById).mockResolvedValue(fakeNote); // author_id is 'p1', not 'admin1'
    vi.mocked(updateNote).mockResolvedValue(true);

    const res = await PATCH(makeRequest({ content: 'Admin edit' }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { updated: true, requeued: false } });
    expect(vi.mocked(updateNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1', 'Admin edit', 'moderator');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.update',
      metadata: { requeued: false, was_approved: true },
    }));
  });
});

// ── Resubmission block ───────────────────────────────────────

const NOTE_ID = 'c3a68c4f-2629-4673-845a-8984a71168c1';
const rejectedNote = { ...fakeNote, approved: false, rejected_at: '2026-01-02T00:00:00.000Z', resubmission_blocked_at: null };
const blockedNote = { ...rejectedNote, resubmission_blocked_at: '2026-01-03T00:00:00.000Z' };
const SUPERADMIN = { ...ADMIN, playerId: 'super1' };

function forbidden(): Error {
  return new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })('Admin required', 403);
}

describe('PATCH /api/wiki/notes/[id] block_resubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
    vi.mocked(requireAdmin).mockResolvedValue(SUPERADMIN as never);
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'super-discord' } } as never);
    vi.mocked(isSuperadmin).mockReturnValue(true);
    vi.mocked(setNoteResubmissionBlock).mockResolvedValue(true);
  });

  it('lets the superadmin block a rejected note, audits it, and leaves the note rejected', async () => {
    vi.mocked(getNoteById).mockResolvedValue(rejectedNote as never);

    const res = await PATCH(makeRequest({ block_resubmission: true }), makeParams(NOTE_ID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: true, blocked: true } });
    expect(setNoteResubmissionBlock).toHaveBeenCalledWith(NOTE_ID, true, 'super1');
    // blocking is not a verdict: nothing approves, rejects or edits the note
    expect(approveNote).not.toHaveBeenCalled();
    expect(rejectNote).not.toHaveBeenCalled();
    expect(updateNote).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.block_resubmission',
      resource_id: NOTE_ID,
      actor_id: 'super1',
    }));
  });

  it('lets the superadmin allow resubmitting again, audited as an unblock', async () => {
    vi.mocked(getNoteById).mockResolvedValue(blockedNote as never);

    const res = await PATCH(makeRequest({ block_resubmission: false }), makeParams(NOTE_ID));

    expect(await res.json()).toEqual({ success: true, data: { updated: true, blocked: false } });
    expect(setNoteResubmissionBlock).toHaveBeenCalledWith(NOTE_ID, false, 'super1');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'wiki.note.unblock_resubmission' }));
  });

  it('refuses a site admin who is not the superadmin with 403 and writes nothing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(isSuperadmin).mockReturnValue(false);
    vi.mocked(getNoteById).mockResolvedValue(rejectedNote as never);

    const res = await PATCH(makeRequest({ block_resubmission: true }), makeParams(NOTE_ID));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('wiki_note_block_superadmin_only');
    expect(setNoteResubmissionBlock).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a site admin who is not the superadmin when unblocking too', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(isSuperadmin).mockReturnValue(false);

    const res = await PATCH(makeRequest({ block_resubmission: false }), makeParams(NOTE_ID));

    expect(res.status).toBe(403);
    expect(setNoteResubmissionBlock).not.toHaveBeenCalled();
  });

  it('refuses a plain author or signed-out caller (requireAdmin rejects)', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(forbidden());

    const res = await PATCH(makeRequest({ block_resubmission: true }), makeParams(NOTE_ID));

    expect(res.status).toBe(403);
    expect(setNoteResubmissionBlock).not.toHaveBeenCalled();
  });

  it('answers 409 for a note that is not rejected (pending or approved)', async () => {
    for (const note of [{ ...fakeNote }, { ...fakeNote, approved: false, rejected_at: null }]) {
      vi.mocked(getNoteById).mockResolvedValue(note as never);

      const res = await PATCH(makeRequest({ block_resubmission: true }), makeParams(NOTE_ID));

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('wiki_note_block_not_rejected');
    }
    expect(setNoteResubmissionBlock).not.toHaveBeenCalled();
  });

  it('answers 409 when the note was approved or re-queued between the read and the write', async () => {
    vi.mocked(getNoteById).mockResolvedValue(rejectedNote as never);
    vi.mocked(setNoteResubmissionBlock).mockResolvedValue(false);

    const res = await PATCH(makeRequest({ block_resubmission: true }), makeParams(NOTE_ID));

    expect(res.status).toBe(409);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown note', async () => {
    vi.mocked(getNoteById).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ block_resubmission: true }), makeParams(NOTE_ID));

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('wiki_note_not_found');
  });

  it('repeating the current state is a no-op: nothing written, nothing audited', async () => {
    vi.mocked(getNoteById).mockResolvedValue(blockedNote as never);
    const again = await PATCH(makeRequest({ block_resubmission: true }), makeParams(NOTE_ID));
    expect(await again.json()).toEqual({ success: true, data: { updated: true, blocked: true } });

    vi.mocked(getNoteById).mockResolvedValue(rejectedNote as never);
    const none = await PATCH(makeRequest({ block_resubmission: false }), makeParams(NOTE_ID));
    expect(await none.json()).toEqual({ success: true, data: { updated: true, blocked: false } });

    expect(setNoteResubmissionBlock).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-boolean flag', { block_resubmission: 'yes' }],
    ['an extra field next to the flag', { block_resubmission: true, approved: true }],
    ['an edit mixed in', { block_resubmission: true, content: 'sneaky' }],
  ])('rejects %s with 400 before any auth or write', async (_name, body) => {
    const res = await PATCH(makeRequest(body), makeParams(NOTE_ID));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(setNoteResubmissionBlock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/wiki/notes/[id] edit of a blocked note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
    vi.mocked(updateNote).mockResolvedValue(true);
  });

  it('refuses the author with a typed 403 and re-queues nothing', async () => {
    vi.mocked(getNoteById).mockResolvedValue(blockedNote as never);

    const res = await PATCH(makeRequest({ content: 'Trying again' }), makeParams(NOTE_ID));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: 'A moderator closed this note for resubmission',
      code: 'wiki_note_resubmission_blocked',
    });
    expect(updateNote).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('still refuses when the block lands between the check and the write (the UPDATE touches no row)', async () => {
    vi.mocked(getNoteById).mockResolvedValue(rejectedNote as never);
    vi.mocked(updateNote).mockResolvedValue(false);

    const res = await PATCH(makeRequest({ content: 'Racing the block' }), makeParams(NOTE_ID));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('wiki_note_resubmission_blocked');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 404 when the note was deleted between the check and the write', async () => {
    vi.mocked(getNoteById).mockResolvedValueOnce(rejectedNote as never).mockResolvedValueOnce(null);
    vi.mocked(updateNote).mockResolvedValue(false);

    const res = await PATCH(makeRequest({ content: 'Too late' }), makeParams(NOTE_ID));

    expect(res.status).toBe(404);
  });

  it('still re-queues a rejected note that is not blocked (the resubmit path)', async () => {
    vi.mocked(getNoteById).mockResolvedValue(rejectedNote as never);

    const res = await PATCH(makeRequest({ content: 'Reworked' }), makeParams(NOTE_ID));

    expect(await res.json()).toEqual({ success: true, data: { updated: true, requeued: true } });
    expect(updateNote).toHaveBeenCalledWith(NOTE_ID, 'Reworked', 'author');
  });

  it('lets a site admin edit a blocked note; the block does not apply to moderators', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(ADMIN);
    vi.mocked(getNoteById).mockResolvedValue(blockedNote as never);

    const res = await PATCH(makeRequest({ content: 'Moderator fix' }), makeParams(NOTE_ID));

    expect(await res.json()).toEqual({ success: true, data: { updated: true, requeued: false } });
    expect(updateNote).toHaveBeenCalledWith(NOTE_ID, 'Moderator fix', 'moderator');
  });
});

// ── DELETE ────────────────────────────────────────────────────

describe('DELETE /api/wiki/notes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
  });

  it('requires player auth', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Not authenticated',
      401,
    );
    vi.mocked(requirePlayer).mockRejectedValue(err);

    const res = await DELETE(dummyRequest, makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when note not found', async () => {
    vi.mocked(getNoteById).mockResolvedValue(null);

    const res = await DELETE(dummyRequest, makeParams('80603476-3ea8-4d9d-8d6c-3366329e1b46'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Note not found', code: 'wiki_note_not_found' });
  });

  it('returns 403 when non-author non-admin deletes note', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p2', name: 'Test', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' as const });
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);

    const res = await DELETE(dummyRequest, makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Not authorized');
    expect(body.code).toBe('wiki_note_delete_forbidden');
  });

  it('deletes note when author deletes', async () => {
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);
    vi.mocked(deleteNote).mockResolvedValue(undefined as never);

    const res = await DELETE(dummyRequest, makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
    expect(vi.mocked(deleteNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.delete',
      resource_id: 'c3a68c4f-2629-4673-845a-8984a71168c1',
    }));
  });

  it('allows admin to delete any note', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(ADMIN);
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never);
    vi.mocked(deleteNote).mockResolvedValue(undefined as never);

    const res = await DELETE(dummyRequest, makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

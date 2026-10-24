import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireAdmin: vi.fn(),
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
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { PATCH, DELETE } from '@/app/api/wiki/notes/[id]/route';
import { requirePlayer, requireAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getNoteById,
  updateNote,
  deleteNote,
  approveNote,
  rejectNote,
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
    vi.mocked(updateNote).mockResolvedValue(undefined as never);

    const res = await PATCH(makeRequest({ content: 'Updated content' }), makeParams('c3a68c4f-2629-4673-845a-8984a71168c1'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.updated).toBe(true);
    expect(vi.mocked(updateNote)).toHaveBeenCalledWith('c3a68c4f-2629-4673-845a-8984a71168c1', 'Updated content', 'author');
  });

  it('re-queues an approved note when its author edits it', async () => {
    vi.mocked(getNoteById).mockResolvedValue(fakeNote as never); // approved: true, author p1
    vi.mocked(updateNote).mockResolvedValue(undefined as never);

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
    vi.mocked(updateNote).mockResolvedValue(undefined as never);

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

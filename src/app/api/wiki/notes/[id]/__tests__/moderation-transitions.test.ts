import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Characterization of the legal wiki note moderation moves (docs/state-machines.md, "Wiki note moderation"):
 * every move a moderator, the superadmin or an author performs today keeps working.
 */

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireAdmin: vi.fn(),
  isSuperadminNow: vi.fn(),
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

import { PATCH } from '@/app/api/wiki/notes/[id]/route';
import { requireAdmin, requirePlayer, isSuperadminNow } from '@/lib/auth/helpers';
import {
  approveNote,
  getNoteById,
  rejectNote,
  setNoteResubmissionBlock,
  updateNote,
} from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';

const NOTE_ID = 'c3a68c4f-2629-4673-845a-8984a71168c1';
const ADMIN = { playerId: 'admin1', name: 'Admin', isAdmin: true };
const AUTHOR = { playerId: 'p1', name: 'Author', isAdmin: false };

const base = {
  id: NOTE_ID,
  author_id: 'p1',
  entity_type: 'pokemon' as const,
  entity_name: 'Pikachu',
  content: 'Original note',
  scope_type: 'global' as const,
  scope_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};
const NOTES = {
  pending: { ...base, approved: false, rejected_at: null },
  approved: { ...base, approved: true, approved_at: '2026-01-02T00:00:00.000Z', rejected_at: null },
  rejected: { ...base, approved: false, rejected_at: '2026-01-02T00:00:00.000Z' },
  blocked: {
    ...base,
    approved: false,
    rejected_at: '2026-01-02T00:00:00.000Z',
    resubmission_blocked_at: '2026-01-03T00:00:00.000Z',
    resubmission_blocked_by: 'admin1',
  },
};

function patch(body: Record<string, unknown>) {
  const request = { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
  return PATCH(request, { params: Promise.resolve({ id: NOTE_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
  vi.mocked(requirePlayer).mockResolvedValue(AUTHOR as never);
  vi.mocked(isSuperadminNow).mockResolvedValue(true);
  vi.mocked(approveNote).mockResolvedValue(true as never);
  vi.mocked(rejectNote).mockResolvedValue(true as never);
  vi.mocked(updateNote).mockResolvedValue(true);
  vi.mocked(setNoteResubmissionBlock).mockResolvedValue(true);
});

describe('wiki note moderation: legal moves', () => {
  it.each(['pending', 'rejected', 'blocked'] as const)('a moderator approves a %s note', async (state) => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES[state] as never);
    const res = await patch({ approved: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: true } });
    expect(vi.mocked(approveNote).mock.calls[0].slice(0, 2)).toEqual([NOTE_ID, 'admin1']);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'wiki.note.approve' }));
  });

  it.each(['pending', 'approved'] as const)('a moderator rejects a %s note', async (state) => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES[state] as never);
    const res = await patch({ rejected: true, rejection_reason: 'Needs sources' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: true } });
    expect(vi.mocked(rejectNote).mock.calls[0].slice(0, 3)).toEqual([NOTE_ID, 'admin1', 'Needs sources']);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.reject',
      metadata: { reason: 'Needs sources', was_approved: state === 'approved' },
    }));
  });

  it.each(['pending', 'approved', 'rejected'] as const)('the author edit of a %s note re-queues it', async (state) => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES[state] as never);
    const res = await patch({ content: 'Edited' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: true, requeued: true } });
    expect(updateNote).toHaveBeenCalledWith(NOTE_ID, 'Edited', 'author');
  });

  it('the author edit of a blocked note is refused with wiki_note_resubmission_blocked', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.blocked as never);
    const res = await patch({ content: 'Edited' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('wiki_note_resubmission_blocked');
    expect(updateNote).not.toHaveBeenCalled();
  });

  it.each(['pending', 'approved', 'rejected', 'blocked'] as const)('a moderator edit keeps a %s note in its state', async (state) => {
    vi.mocked(requirePlayer).mockResolvedValue(ADMIN as never);
    vi.mocked(getNoteById).mockResolvedValue(NOTES[state] as never);
    const res = await patch({ content: 'Edited' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: true, requeued: false } });
    expect(updateNote).toHaveBeenCalledWith(NOTE_ID, 'Edited', 'moderator');
  });

  it('the superadmin blocks a rejected note', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.rejected as never);
    const res = await patch({ block_resubmission: true });
    expect(await res.json()).toEqual({ success: true, data: { updated: true, blocked: true } });
    expect(setNoteResubmissionBlock).toHaveBeenCalledWith(NOTE_ID, true, 'admin1');
  });

  it('the superadmin unblocks a blocked note', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.blocked as never);
    const res = await patch({ block_resubmission: false });
    expect(await res.json()).toEqual({ success: true, data: { updated: true, blocked: false } });
    expect(setNoteResubmissionBlock).toHaveBeenCalledWith(NOTE_ID, false, 'admin1');
  });
});

describe('wiki note moderation: compare-and-set and refused moves', () => {
  it('passes the state and version the moderator saw to the guarded write', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.pending as never);
    const res = await patch({ approved: true, expected_state: 'pending', expected_updated_at: base.updated_at });
    expect(res.status).toBe(200);
    expect(approveNote).toHaveBeenCalledWith(NOTE_ID, 'admin1', { from: 'pending', updatedAt: base.updated_at });
  });

  it('refuses to approve text the author edited after the moderator loaded it (wiki_note_changed)', async () => {
    vi.mocked(getNoteById).mockResolvedValue({ ...NOTES.pending, content: 'Edited', updated_at: '2026-01-05T00:00:00.000Z' } as never);
    const res = await patch({ approved: true, expected_state: 'pending', expected_updated_at: base.updated_at });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'wiki_note_changed' });
    expect(approveNote).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a verdict on a note whose state moved since the moderator loaded it (wiki_note_changed)', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.rejected as never);
    const res = await patch({ approved: true, expected_state: 'pending', expected_updated_at: base.updated_at });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('wiki_note_changed');
    expect(approveNote).not.toHaveBeenCalled();
  });

  it('accepts the same instant written with another offset', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.pending as never);
    const res = await patch({ rejected: true, expected_state: 'pending', expected_updated_at: '2026-01-01T01:00:00.000+01:00' });
    expect(res.status).toBe(200);
    expect(rejectNote).toHaveBeenCalledWith(NOTE_ID, 'admin1', null, { from: 'pending', updatedAt: '2026-01-01T01:00:00.000+01:00' });
  });

  it('answers wiki_note_changed when the guarded write matched no row and the note still exists', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.pending as never);
    vi.mocked(approveNote).mockResolvedValue(false as never);
    const res = await patch({ approved: true });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('wiki_note_changed');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 404 when the guarded write matched no row because the note is gone', async () => {
    vi.mocked(getNoteById).mockResolvedValueOnce(NOTES.pending as never).mockResolvedValueOnce(null);
    vi.mocked(rejectNote).mockResolvedValue(false as never);
    const res = await patch({ rejected: true });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('wiki_note_not_found');
  });

  it.each([
    ['approve', 'approved', { approved: true }],
    ['reject', 'rejected', { rejected: true }],
  ] as const)('refuses to %s a note that is already %s (state_transition_invalid)', async (_verb, state, body) => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES[state] as never);
    const res = await patch(body);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'state_transition_invalid', params: { machine: 'wiki_note.moderation', from: state } });
    expect(approveNote).not.toHaveBeenCalled();
    expect(rejectNote).not.toHaveBeenCalled();
  });

  it('refuses a site admin rejecting a blocked note: only the superadmin moves it back (state_transition_forbidden)', async () => {
    vi.mocked(getNoteById).mockResolvedValue(NOTES.blocked as never);
    const res = await patch({ rejected: true });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('state_transition_forbidden');
    expect(rejectNote).not.toHaveBeenCalled();
  });

  it('rejects a malformed expected state or version with 400 before any write', async () => {
    for (const body of [{ approved: true, expected_state: 'live' }, { approved: true, expected_updated_at: 'yesterday' }]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
    }
    expect(approveNote).not.toHaveBeenCalled();
  });
});

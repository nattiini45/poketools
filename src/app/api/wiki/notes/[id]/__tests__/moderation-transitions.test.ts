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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
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
  createNoteReport: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/wiki/notes/[id]/report/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { createNoteReport, getNoteById } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';

const PLAYER = { playerId: 'p1', name: 'Reporter', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' as const };

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const approvedNote = {
  id: 'n1',
  entity_type: 'pokemon' as const,
  entity_name: 'Pikachu',
  author_id: 'author-1',
  content: 'Useful note',
  scope_type: 'global' as const,
  scope_id: null,
  approved: true,
  created_at: '2026-04-15T00:00:00.000Z',
  updated_at: '2026-04-15T00:00:00.000Z',
};

describe('POST /api/wiki/notes/[id]/report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
    vi.mocked(getNoteById).mockResolvedValue(approvedNote as never);
    vi.mocked(createNoteReport).mockResolvedValue({
      id: 'r1',
      note_id: 'n1',
      reporter_id: 'p1',
      reason: 'inaccurate',
      details: 'Outdated format info',
      status: 'open',
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    });
  });

  it('creates a report for an approved note', async () => {
    const res = await POST(
      makeRequest({ reason: 'inaccurate', details: 'Outdated format info' }),
      makeParams('n1'),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(vi.mocked(createNoteReport)).toHaveBeenCalledWith('p1', 'n1', 'inaccurate', 'Outdated format info');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.report',
      resource_id: 'n1',
    }));
  });

  it('rejects invalid report reasons', async () => {
    const res = await POST(makeRequest({ reason: 'bad' }), makeParams('n1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('does not report pending notes through the public endpoint', async () => {
    vi.mocked(getNoteById).mockResolvedValue({ ...approvedNote, approved: false } as never);
    const res = await POST(makeRequest({ reason: 'spam' }), makeParams('n1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Note not found', code: 'wiki_note_not_found' });
  });
});
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
  createNote: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/wiki/notes/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { createNote } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';

const PLAYER = { playerId: 'p1', name: 'Test', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' as const };

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe('POST /api/wiki/notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
  });

  // ── Auth ──────────────────────────────────────────────────

  it('requires player auth', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Not authenticated',
      401,
    );
    vi.mocked(requirePlayer).mockRejectedValue(err);

    const res = await POST(makeRequest({ entity_type: 'pokemon' as const, entity_name: 'Pikachu', content: 'note' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Not authenticated');
  });

  // ── Validation ────────────────────────────────────────────

  it('rejects when required fields are missing', async () => {
    const res = await POST(makeRequest({ entity_type: 'pokemon' as const }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('entity_name');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('rejects invalid entity_type', async () => {
    const res = await POST(
      makeRequest({ entity_type: 'unknown', entity_name: 'Pikachu', content: 'note' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('entity_type');
  });

  it('rejects invalid scope_type', async () => {
    const res = await POST(
      makeRequest({
        entity_type: 'pokemon' as const,
        entity_name: 'Pikachu',
        content: 'note',
        scope_type: 'bad',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('scope_type');
  });

  it('rejects content over 2000 characters', async () => {
    const res = await POST(
      makeRequest({
        entity_type: 'pokemon' as const,
        entity_name: 'Pikachu',
        content: 'x'.repeat(2001),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('2000 characters');
  });

  // ── Happy path ────────────────────────────────────────────

  it('creates a note and returns 201', async () => {
    const noteData = {
      entity_type: 'pokemon' as const,
      entity_name: 'Pikachu',
      content: 'Great in VGC',
    };

    const createdNote = {
      id: 'n1',
      ...noteData,
      author_id: 'p1',
      approved: false,
      scope_type: 'global' as const,
      scope_id: null,
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    };
    vi.mocked(createNote).mockResolvedValue(createdNote as never);

    const res = await POST(makeRequest(noteData));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(createdNote);
    expect(vi.mocked(createNote)).toHaveBeenCalledWith('p1', noteData);
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wiki.note.create',
      resource_id: 'n1',
    }));
  });

  it('accepts all valid entity_types', async () => {
    const validTypes = ['pokemon', 'move', 'item', 'ability', 'tera'] as const;

    for (const entityType of validTypes) {
      vi.clearAllMocks();
      vi.mocked(requirePlayer).mockResolvedValue(PLAYER);
      vi.mocked(createNote).mockResolvedValue({
        id: 'n1',
        entity_type: entityType,
        entity_name: 'Test',
        content: 'note',
        author_id: 'p1',
        approved: false,
        scope_type: 'global' as const,
        scope_id: null,
        created_at: '2026-04-15T00:00:00.000Z',
        updated_at: '2026-04-15T00:00:00.000Z',
      });

      const res = await POST(
        makeRequest({ entity_type: entityType, entity_name: 'Test', content: 'note' }),
      );
      expect(res.status).toBe(201);
    }
  });
});

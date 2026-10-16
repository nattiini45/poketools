import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/draft-pool-templates', () => ({
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST } from '@/app/api/draft-pool-templates/route';
import { requireAuth, requireAdmin } from '@/lib/auth/helpers';
import { listTemplates, createTemplate } from '@/lib/supabase/queries/draft-pool-templates';
import { safeErrorResponse } from '@/lib/api/error-response';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const mockAdmin = {
  playerId: 'admin-1',
  name: 'Admin',
  isAdmin: true,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/draft-pool-templates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns templates when authenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    const templates = [{ id: 't1', name: 'Gen 9 OU' }];
    vi.mocked(listTemplates).mockResolvedValue(templates as never);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(templates);
  });

  it('delegates to safeErrorResponse on auth failure', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Not authenticated'));

    await GET();
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('POST /api/draft-pool-templates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to safeErrorResponse on auth failure', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('Not admin'));

    await POST(makeRequest({ name: 'Test', entries: [{ pokemon_name: 'Pikachu' }] }));
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('returns 400 when name missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await POST(makeRequest({ entries: [{ pokemon_name: 'Pikachu' }] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('name');
    expect(json.code).toBe('validation_failed');
    expect(json.params.issues).toBe(json.error);
  });

  it('returns 400 when entries empty', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await POST(makeRequest({ name: 'Test', pool_mode: 'tier', entries: [] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('entries');
    expect(json.code).toBe('validation_failed');
  });

  it('creates template successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    const created = { id: 't1', name: 'Gen 9 OU' };
    vi.mocked(createTemplate).mockResolvedValue(created as never);

    const res = await POST(
      makeRequest({ name: 'Gen 9 OU', pool_mode: 'tier', entries: [{ pokemon_name: 'Pikachu' }] }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Gen 9 OU');
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gen 9 OU' }),
      'admin-1',
    );
  });
});

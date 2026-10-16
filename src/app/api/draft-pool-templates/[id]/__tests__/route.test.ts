import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
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
  getTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, DELETE } from '@/app/api/draft-pool-templates/[id]/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { getTemplate, deleteTemplate } from '@/lib/supabase/queries/draft-pool-templates';
import { safeErrorResponse } from '@/lib/api/error-response';

// ─── Helpers ────────────────────────────────────────────────────────

const routeParams = { params: Promise.resolve({ id: 'template-1' }) };

const mockTemplate = {
  id: 'template-1',
  name: 'Gen 9 OU',
  entries: [{ pokemon_name: 'Pikachu' }],
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/draft-pool-templates/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to safeErrorResponse on auth failure', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('Not admin'));

    await GET({} as NextRequest, routeParams);
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('returns 404 when template not found', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTemplate).mockResolvedValue(null);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Template not found');
    expect(json.code).toBe('pool_template_not_found');
  });

  it('returns template successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTemplate).mockResolvedValue(mockTemplate as never);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Gen 9 OU');
  });
});

describe('DELETE /api/draft-pool-templates/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to safeErrorResponse on auth failure', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('Not admin'));

    await DELETE({} as NextRequest, routeParams);
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('returns 404 when template not found', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTemplate).mockResolvedValue(null);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Template not found');
    expect(json.code).toBe('pool_template_not_found');
  });

  it('deletes template successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTemplate).mockResolvedValue(mockTemplate as never);
    vi.mocked(deleteTemplate).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(deleteTemplate).toHaveBeenCalledWith('template-1');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    requireAdmin: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/smogon/import-sets', () => ({
  importGenerationSets: vi.fn(),
}));

import { POST } from '../route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { importGenerationSets } from '@/lib/smogon/import-sets';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/admin/import-sets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(importGenerationSets).mockResolvedValue({
      generation: 9,
      status: 'success' as const,
      setsCount: 150,
      analysesCount: 50,
    });
  });

  it('imports sets for a valid generation', async () => {
    const res = await POST(makeRequest({ generation: 9 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.setsCount).toBe(150);
    expect(importGenerationSets).toHaveBeenCalledWith(9);
  });

  it('returns 400 when generation is missing', async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('generation');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
  });

  it('returns 400 for generation 0', async () => {
    const res = await POST(makeRequest({ generation: 0 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('generation');
  });

  it('returns 400 for generation 10', async () => {
    const res = await POST(makeRequest({ generation: 10 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('generation');
  });

  it('returns auth error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Admin required', 403));

    const res = await POST(makeRequest({ generation: 9 }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Admin required');
  });

  it('returns 500 when import fails', async () => {
    vi.mocked(importGenerationSets).mockRejectedValue(new Error('Smogon API down'));

    const res = await POST(makeRequest({ generation: 9 }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to import sets');
  });
});

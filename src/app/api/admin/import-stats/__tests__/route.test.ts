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

vi.mock('@/lib/smogon/import-stats', () => ({
  importFormatStats: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from '../route';
import { revalidateTag } from 'next/cache';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { importFormatStats } from '@/lib/smogon/import-stats';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/admin/import-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(importFormatStats).mockResolvedValue({
      format: 'gen9ou',
      status: 'success' as const,
      pokemonCount: 200,
    });
  });

  it('imports stats for a valid format', async () => {
    const res = await POST(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.pokemonCount).toBe(200);
    expect(importFormatStats).toHaveBeenCalledWith('gen9ou');
    // /insights reads imported usage from the public read cache (D37).
    expect(revalidateTag).toHaveBeenCalledWith('meta-usage', { expire: 0 });
  });

  it('expires the usage read even when the format reports an error (chunks may have landed)', async () => {
    vi.mocked(importFormatStats).mockResolvedValue({
      format: 'gen9ou',
      status: 'error' as const,
      pokemonCount: 0,
      error: 'HTTP 500',
    });

    await POST(makeRequest({ format: 'gen9ou' }));

    expect(revalidateTag).toHaveBeenCalledWith('meta-usage', { expire: 0 });
  });

  it('returns 400 when format is missing', async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('format');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns 400 when format is empty string', async () => {
    const res = await POST(makeRequest({ format: '' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('format');
  });

  it('returns auth error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Admin required', 403));

    const res = await POST(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Admin required');
  });

  it('returns 500 when import fails', async () => {
    vi.mocked(importFormatStats).mockRejectedValue(new Error('Fetch failed'));

    const res = await POST(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to import stats');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  importAllStats: vi.fn(),
  importFormatStats: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from '../route';
import { revalidateTag } from 'next/cache';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { importAllStats, importFormatStats } from '@/lib/smogon/import-stats';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as Request;
}

function makeEmptyRequest(): Request {
  return { json: vi.fn().mockRejectedValue(new Error('no body')) } as unknown as Request;
}

const MOCK_RESULT = {
  format: 'gen9ou',
  status: 'success' as const,
  pokemonCount: 200,
};

describe('POST /api/admin/import-usage-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(importAllStats).mockResolvedValue([MOCK_RESULT]);
    vi.mocked(importFormatStats).mockResolvedValue(MOCK_RESULT);
  });

  it('imports all formats when no body is provided', async () => {
    const res = await POST(makeEmptyRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.summary.total_formats).toBe(1);
    expect(json.data.summary.total_pokemon).toBe(200);
    expect(importAllStats).toHaveBeenCalled();
    // /insights reads imported usage from the public read cache (D37).
    expect(revalidateTag).toHaveBeenCalledWith('meta-usage', { expire: 0 });
  });

  it('imports specific formats when provided', async () => {
    const res = await POST(makeRequest({ formats: ['gen9ou', 'gen9uu'] }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(importFormatStats).toHaveBeenCalledTimes(2);
    // .map passes (value, index, array) — assert first arg only
    expect(vi.mocked(importFormatStats).mock.calls[0][0]).toBe('gen9ou');
    expect(vi.mocked(importFormatStats).mock.calls[1][0]).toBe('gen9uu');
    expect(revalidateTag).toHaveBeenCalledWith('meta-usage', { expire: 0 });
  });

  it('returns summary statistics in the response', async () => {
    vi.mocked(importAllStats).mockResolvedValue([
      { ...MOCK_RESULT, format: 'gen9ou', status: 'success' as const },
      { ...MOCK_RESULT, format: 'gen9uu', status: 'skipped' as const, pokemonCount: 0 },
      { ...MOCK_RESULT, format: 'gen9ru', status: 'error' as const, pokemonCount: 0 },
    ]);

    const res = await POST(makeEmptyRequest());
    const json = await res.json();

    expect(json.data.summary.total_formats).toBe(3);
    expect(json.data.summary.success).toBe(1);
    expect(json.data.summary.skipped).toBe(1);
    expect(json.data.summary.errors).toBe(1);
    expect(json.data.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns auth error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Unauthorized', 403));

    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Unauthorized');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns 500 when import fails', async () => {
    vi.mocked(importAllStats).mockRejectedValue(new Error('Smogon unreachable'));

    const res = await POST(makeEmptyRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to import usage stats');
  });
});

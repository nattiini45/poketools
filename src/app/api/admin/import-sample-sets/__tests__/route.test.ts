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

vi.mock('@/lib/smogon/import-sets', () => ({
  importAllSets: vi.fn(),
  importGenerationSets: vi.fn(),
}));

import { POST } from '../route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { importAllSets, importGenerationSets } from '@/lib/smogon/import-sets';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as Request;
}

function makeEmptyRequest(): Request {
  return { json: vi.fn().mockRejectedValue(new Error('no body')) } as unknown as Request;
}

const MOCK_RESULT = {
  generation: 9,
  status: 'success' as const,
  setsCount: 100,
  analysesCount: 30,
};

describe('POST /api/admin/import-sample-sets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(importAllSets).mockResolvedValue([MOCK_RESULT]);
    vi.mocked(importGenerationSets).mockResolvedValue(MOCK_RESULT);
  });

  it('imports all generations when no body is provided', async () => {
    const res = await POST(makeEmptyRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.summary.total_generations).toBe(1);
    expect(json.data.summary.total_sets).toBe(100);
    expect(importAllSets).toHaveBeenCalled();
  });

  it('imports specific generations when provided', async () => {
    const res = await POST(makeRequest({ generations: [5, 9] }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(importGenerationSets).toHaveBeenCalledTimes(2);
    // .map passes (value, index, array) — assert first arg only
    expect(vi.mocked(importGenerationSets).mock.calls[0][0]).toBe(5);
    expect(vi.mocked(importGenerationSets).mock.calls[1][0]).toBe(9);
  });

  it('returns summary statistics in the response', async () => {
    vi.mocked(importAllSets).mockResolvedValue([
      { ...MOCK_RESULT, generation: 8, status: 'success' as const },
      { ...MOCK_RESULT, generation: 9, status: 'skipped' as const, setsCount: 0, analysesCount: 0 },
    ]);

    const res = await POST(makeEmptyRequest());
    const json = await res.json();

    expect(json.data.summary.total_generations).toBe(2);
    expect(json.data.summary.success).toBe(1);
    expect(json.data.summary.skipped).toBe(1);
    expect(json.data.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns auth error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Unauthorized', 403));

    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 500 when import fails', async () => {
    vi.mocked(importAllSets).mockRejectedValue(new Error('Network error'));

    const res = await POST(makeEmptyRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to import sample sets');
  });
});

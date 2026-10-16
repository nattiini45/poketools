import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/replay-frames', () => ({
  getReplayFrames: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 29, retryAfterSeconds: 0 })),
}));

import { GET } from '../route';
import { getReplayFrames } from '@/lib/pkmn/replay-frames';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { safeErrorResponse } from '@/lib/api/error-response';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

// ── Helpers ────────────────────────────────────────────────────────────

const MOCK_FRAMES = {
  meta: { format: 'gen9ou', players: ['Alice', 'Bob'], turns: 10 },
  frames: [{ turn: 0, weather: null, terrain: null, pseudoWeather: [], sides: [{}, {}], events: [], p1: {}, p2: {} }],
} as never;

describe('GET /api/replay-frames', () => {
  // Public: no auth required
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Validation ─────────────────────────────────────────────────────

  it('returns 400 when url param is missing', async () => {
    const res = await GET(makeRequest(undefined, {}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Missing required parameter');
    expect(body.code).toBe('replay_url_missing');
  });

  it('returns 400 for an invalid replay URL', async () => {
    const res = await GET(makeRequest(undefined, { url: 'not a valid url!@#' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid replay URL');
    expect(body.code).toBe('replay_url_invalid');
  });

  it('returns 400 for a URL with path traversal characters', async () => {
    const res = await GET(makeRequest(undefined, { url: '../../../etc/passwd' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid replay URL');
    expect(body.code).toBe('replay_url_invalid');
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('returns frames for a valid replay ID', async () => {
    vi.mocked(getReplayFrames).mockResolvedValue(MOCK_FRAMES);

    const res = await GET(makeRequest(undefined, { url: 'gen9ou-123456' }));
    const body = await res.json();

    expect(body).toEqual(MOCK_FRAMES);
    expect(getReplayFrames).toHaveBeenCalledWith('gen9ou-123456');
  });

  it('returns frames for a full replay URL', async () => {
    vi.mocked(getReplayFrames).mockResolvedValue(MOCK_FRAMES);

    const res = await GET(
      makeRequest(undefined, { url: 'https://replay.pokemonshowdown.com/gen9ou-123456' }),
    );
    const body = await res.json();

    expect(body).toEqual(MOCK_FRAMES);
    expect(getReplayFrames).toHaveBeenCalledWith(
      'https://replay.pokemonshowdown.com/gen9ou-123456',
    );
  });

  it('sets Cache-Control header for successful responses', async () => {
    vi.mocked(getReplayFrames).mockResolvedValue(MOCK_FRAMES);

    const res = await GET(makeRequest(undefined, { url: 'gen9ou-123456' }));

    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  // ── Error path ─────────────────────────────────────────────────────

  it('returns safeErrorResponse when getReplayFrames throws', async () => {
    vi.mocked(getReplayFrames).mockRejectedValue(new Error('Network error'));

    const res = await GET(makeRequest(undefined, { url: 'gen9ou-123456' }));

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to process replay',
    );
  });

  it('returns 429 with rate_limited and the retry delay when the limit is hit', async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 42 });

    const res = await GET(makeRequest(undefined, { url: 'gen9ou-12345' }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(body).toEqual({
      success: false,
      error: 'Rate limit exceeded',
      code: 'rate_limited',
      params: { seconds: 42 },
    });
    expect(getReplayFrames).not.toHaveBeenCalled();
  });
});

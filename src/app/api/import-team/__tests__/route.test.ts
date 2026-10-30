import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  return { requirePlayer: vi.fn(), AuthError };
});

// A ruleset id from the request is read through the exposure check (shared or pinned rulesets only).
vi.mock('@/lib/ruleset-studio/exposure', () => ({
  readExposedRuleset: vi.fn(),
}));

vi.mock('@/lib/pkmn/teams', () => ({
  parseTeamText: vi.fn(),
}));

// The preview runs the shared team check (`checkTeam`, pinned in src/lib/team/__tests__/check.test.ts).
vi.mock('@/lib/team/check.server', () => ({
  checkTeam: vi.fn(),
}));

// The limiter decision is mocked; the 429 body comes from the real `rateLimitedResponse`.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { POST } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { parseTeamText } from '@/lib/pkmn/teams';
import { checkTeam } from '@/lib/team/check.server';
import { checkRateLimit } from '@/lib/utils/rate-limit';

const mockRequirePlayer = requirePlayer as ReturnType<typeof vi.fn>;
const mockGetRuleset = readExposedRuleset as ReturnType<typeof vi.fn>;
const mockParseTeam = parseTeamText as ReturnType<typeof vi.fn>;
const mockCheckTeam = checkTeam as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/import-team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/import-team', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-1' });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('parses team from text successfully', async () => {
    const pokemon = [
      { species: 'Garchomp', ability: 'Rough Skin', moves: ['Earthquake'] },
    ];
    mockParseTeam.mockReturnValue(pokemon);

    const res = await POST(makeRequest({ text: 'Garchomp @ Life Orb\nAbility: Rough Skin' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.pokemon).toEqual(pokemon);
    expect(json.data.validation).toBeNull();
  });

  it('returns 400 when neither text nor url provided', async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Provide either text or url');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
  });

  it('returns 400 when no pokemon parsed', async () => {
    mockParseTeam.mockReturnValue([]);

    const res = await POST(makeRequest({ text: 'garbage input' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Could not parse');
    expect(json.code).toBe('team_import_no_pokemon');
  });

  it('returns 400 for invalid pokepaste URL', async () => {
    const res = await POST(makeRequest({ url: 'https://example.com/not-pokepaste' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Invalid pokepast.es URL');
    expect(json.code).toBe('team_import_pokepaste_url_invalid');
  });

  it('validates against ruleset when ruleset_id provided', async () => {
    const pokemon = [{ species: 'Garchomp' }];
    const ruleset = { id: 'r-1', name: 'VGC 2024' };
    const validation = { valid: true, errors: [] };

    mockParseTeam.mockReturnValue(pokemon);
    mockGetRuleset.mockResolvedValue(ruleset);
    mockCheckTeam.mockResolvedValue(validation);

    const res = await POST(makeRequest({ text: 'Garchomp', ruleset_id: '00000000-0000-4000-8000-000000000001' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.validation).toEqual(validation);
    expect(mockCheckTeam).toHaveBeenCalledWith({ pokemon, ruleset });
  });

  it('returns 404 when ruleset not found', async () => {
    mockParseTeam.mockReturnValue([{ species: 'Garchomp' }]);
    mockGetRuleset.mockResolvedValue(null);

    const res = await POST(makeRequest({ text: 'Garchomp', ruleset_id: '00000000-0000-4000-8000-000000009999' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Ruleset not found');
    expect(json.code).toBe('ruleset_not_found');
  });

  it('returns auth error when not authenticated', async () => {
    mockRequirePlayer.mockRejectedValue(new AuthError('Not authenticated', 401));

    const res = await POST(makeRequest({ text: 'Garchomp' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Not authenticated');
  });

  it('returns 500 on unexpected error', async () => {
    mockRequirePlayer.mockRejectedValue(new Error('unexpected'));

    const res = await POST(makeRequest({ text: 'Garchomp' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to import team');
  });

  it('returns 502 with a code when pokepast.es cannot be fetched', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('gone', { status: 503 }));
    try {
      const res = await POST(makeRequest({ url: 'https://pokepast.es/abc123' }));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.error).toBe('Failed to fetch from pokepast.es');
      expect(json.code).toBe('team_import_pokepaste_fetch_failed');
      expect(errorSpy).toHaveBeenCalledWith('[api/import-team] pokepast.es returned HTTP 503 for paste abc123');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('fetches pokepast.es with a timeout signal and no caching', async () => {
    mockParseTeam.mockReturnValue([{ species: 'Garchomp' }]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Garchomp', { status: 200 }));
    try {
      const res = await POST(makeRequest({ url: 'https://pokepast.es/abc123' }));

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://pokepast.es/abc123/raw');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.cache).toBe('no-store');
      expect(mockParseTeam).toHaveBeenCalledWith('Garchomp');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns 502 fetch_failed when the pokepast.es fetch times out', async () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeout);
    try {
      const res = await POST(makeRequest({ url: 'https://pokepast.es/abc123' }));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.code).toBe('team_import_pokepaste_fetch_failed');
      expect(mockParseTeam).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[api/import-team] pokepast.es fetch failed (network/timeout) for paste abc123:',
        timeout
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns 502 without parsing when pokepast.es declares an oversized Content-Length', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Garchomp', { status: 200, headers: { 'content-length': '50001' } })
    );
    try {
      const res = await POST(makeRequest({ url: 'https://pokepast.es/abc123' }));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.code).toBe('team_import_pokepaste_fetch_failed');
      expect(mockParseTeam).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[api/import-team] pokepast.es paste abc123 declares Content-Length 50001 > 50000'
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns 502 without parsing when the pokepast.es body is oversized', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('x'.repeat(50_001), { status: 200 }));
    try {
      const res = await POST(makeRequest({ url: 'https://pokepast.es/abc123' }));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.code).toBe('team_import_pokepaste_fetch_failed');
      expect(mockParseTeam).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('[api/import-team] pokepast.es paste abc123 body is 50001 chars > 50000');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns 502 and logs the error when the pokepast.es body cannot be read', async () => {
    const readError = new Error('stream reset');
    const body = new ReadableStream({
      pull(controller) {
        controller.error(readError);
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    try {
      const res = await POST(makeRequest({ url: 'https://pokepast.es/abc123' }));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.code).toBe('team_import_pokepaste_fetch_failed');
      expect(mockParseTeam).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[api/import-team] pokepast.es body read failed for paste abc123:',
        readError
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('checks the rate limiter per player: 20 imports per hour', async () => {
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-rate-limit' });
    mockParseTeam.mockReturnValue([{ species: 'Garchomp' }]);

    const ok = await POST(makeRequest({ text: 'Garchomp' }));

    expect(ok.status).toBe(200);
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledWith('import-team', 'p-rate-limit', {
      limit: 20,
      windowSeconds: 3600,
    });
  });

  it('returns 429 with rate_limited and the retry seconds once the limiter denies', async () => {
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-rate-limit' });
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 1234 });

    const res = await POST(makeRequest({ text: 'Garchomp' }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1234');
    expect(json.code).toBe('rate_limited');
    expect(json.params.seconds).toBe(1234);
    expect(json.error).toBe('Rate limit exceeded. Try again in 1234s.');
    expect(mockParseTeam).not.toHaveBeenCalled();
  });
});

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
  return { requirePlayer: vi.fn(), AuthError };
});

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
}));

vi.mock('@/lib/pkmn/teams', () => ({
  parseTeamText: vi.fn(),
}));

vi.mock('@/lib/pkmn/validation', () => ({
  validateTeam: vi.fn(),
}));

import { POST } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { parseTeamText } from '@/lib/pkmn/teams';
import { validateTeam } from '@/lib/pkmn/validation';

const mockRequirePlayer = requirePlayer as ReturnType<typeof vi.fn>;
const mockGetRuleset = getRulesetById as ReturnType<typeof vi.fn>;
const mockParseTeam = parseTeamText as ReturnType<typeof vi.fn>;
const mockValidateTeam = validateTeam as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/import-team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/import-team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-1' });
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
    mockValidateTeam.mockReturnValue(validation);

    const res = await POST(makeRequest({ text: 'Garchomp', ruleset_id: '00000000-0000-4000-8000-000000000001' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.validation).toEqual(validation);
    expect(mockValidateTeam).toHaveBeenCalledWith(pokemon, ruleset);
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
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // Runs last and uses its own player id: the limiter is in-memory per key.
  it('returns 429 with rate_limited and the retry seconds after 20 imports per hour', async () => {
    mockRequirePlayer.mockResolvedValue({ playerId: 'p-rate-limit' });
    mockParseTeam.mockReturnValue([{ species: 'Garchomp' }]);
    for (let i = 0; i < 20; i++) {
      const ok = await POST(makeRequest({ text: 'Garchomp' }));
      expect(ok.status).toBe(200);
    }

    const res = await POST(makeRequest({ text: 'Garchomp' }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toMatch(/^Rate limit exceeded\. Try again in \d+s\.$/);
    expect(json.code).toBe('rate_limited');
    expect(json.params.seconds).toBeGreaterThan(0);
    expect(json.error).toBe(`Rate limit exceeded. Try again in ${json.params.seconds}s.`);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks (no real AI provider is ever called) ─────────────────────

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

vi.mock('@/lib/ai/client', () => ({
  complete: vi.fn(),
}));

vi.mock('@/lib/ai/rate-limit', () => ({
  checkAndRecordAiGeneration: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/teams/ai/team-coach/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { complete } from '@/lib/ai/client';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { outputLanguageInstruction } from '@/lib/ai/language';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: unknown, cookie?: string) =>
  ({
    json: () => Promise.resolve(body),
    headers: new Headers(cookie ? { cookie } : {}),
  }) as unknown as NextRequest;

const mockPlayer = { playerId: 'player-1', name: 'Ash', isAdmin: false };

const team = [
  { species: 'Garchomp', item: 'Choice Scarf', ability: 'Rough Skin', moves: ['Earthquake'] },
  { species: 'Rotom-Wash', item: 'Leftovers', ability: 'Levitate', moves: ['Hydro Pump'] },
];
const validBody = { team, format: 'gen9ou', generation: 9 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
  vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
  vi.mocked(complete).mockResolvedValue({
    content: '- Solid balance.',
    model: 'test-model',
    prompt_tokens: 1,
    completion_tokens: 1,
  });
});

describe('POST /api/teams/ai/team-coach', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(complete).not.toHaveBeenCalled();
  });

  it('sends a code next to each unchanged English validation error', async () => {
    const invalid = await POST(makeRequest({ team: [], format: 'gen9ou', generation: 9 }));
    expect(invalid.status).toBe(400);
    const invalidJson = await invalid.json();
    expect(invalidJson).toMatchObject({ code: 'validation_failed', params: { issues: invalidJson.error } });

    const format = await POST(makeRequest({ ...validBody, format: 'Not A Format' }));
    expect(format.status).toBe(400);
    expect(await format.json()).toMatchObject({ error: 'Invalid format', code: 'ai_coach_format_invalid' });

    const empty = await POST(makeRequest({ ...validBody, team: [{ item: 'Leftovers' }] }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      error: 'At least one Pokémon is required',
      code: 'ai_coach_team_empty',
    });

    expect(complete).not.toHaveBeenCalled();
  });

  it('codes the daily limit (daily_limit_reached with limit and used)', async () => {
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: 'AI rate limit reached (10/10 today)',
      code: 'daily_limit_reached',
      params: { limit: 10, used: 10 },
    });
  });

  it('coaches in the viewer’s language (the prompt changes only by the language line)', async () => {
    const res = await POST(makeRequest(validBody, 'plc_locale=de'));
    expect(await res.json()).toEqual({ success: true, content: '- Solid balance.' });

    const [system, user] = vi.mocked(complete).mock.calls[0];
    expect(system.endsWith(`\n\n${outputLanguageInstruction('de')}`)).toBe(true);
    expect(system).toContain('You analyze entire teams');
    expect(user).toContain('• Garchomp @ Choice Scarf');

    await POST(makeRequest(validBody));
    expect(vi.mocked(complete).mock.calls[1][0].endsWith(`\n\n${outputLanguageInstruction('en')}`)).toBe(true);
  });
});

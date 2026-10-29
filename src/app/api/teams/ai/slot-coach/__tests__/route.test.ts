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

import { POST } from '@/app/api/teams/ai/slot-coach/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { complete } from '@/lib/ai/client';
import { RefusalError, ModelRejectedError } from '@/lib/ai/errors';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { outputLanguageInstruction } from '@/lib/ai/language';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: unknown, cookie?: string) =>
  ({
    json: () => Promise.resolve(body),
    headers: new Headers(cookie ? { cookie } : {}),
  }) as unknown as NextRequest;

const mockPlayer = { playerId: 'player-1', name: 'Ash', isAdmin: false };

const garchomp = { species: 'Garchomp', item: 'Choice Scarf', ability: 'Rough Skin', moves: ['Earthquake'] };
const validBody = { set: garchomp, team: [garchomp], format: 'gen9ou', generation: 9 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
  vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
  vi.mocked(complete).mockResolvedValue({
    content: '- Looks good.',
    model: 'test-model',
    prompt_tokens: 1,
    completion_tokens: 1,
  });
});

describe('POST /api/teams/ai/slot-coach', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(complete).not.toHaveBeenCalled();
  });

  it('sends a code next to each unchanged English validation error', async () => {
    const format = await POST(makeRequest({ ...validBody, format: 'Not A Format' }));
    expect(format.status).toBe(400);
    expect(await format.json()).toMatchObject({ error: 'Invalid format', code: 'ai_coach_format_invalid' });

    const generation = await POST(makeRequest({ ...validBody, generation: 12 }));
    expect(generation.status).toBe(400);
    expect(await generation.json()).toMatchObject({
      error: 'Invalid generation',
      code: 'ai_coach_generation_invalid',
    });

    const species = await POST(makeRequest({ ...validBody, set: { item: 'Leftovers' } }));
    expect(species.status).toBe(400);
    expect(await species.json()).toMatchObject({
      error: 'A Pokémon set with species is required',
      code: 'ai_coach_species_required',
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
    expect(complete).not.toHaveBeenCalled();
  });

  it('coaches in the viewer’s language (the prompt changes only by the language line)', async () => {
    const res = await POST(makeRequest(validBody, 'plc_locale=de'));
    expect(await res.json()).toEqual({ success: true, content: '- Looks good.' });

    const [system, user] = vi.mocked(complete).mock.calls[0];
    expect(system.endsWith(`\n\n${outputLanguageInstruction('de')}`)).toBe(true);
    expect(system).toContain('You are an expert competitive Pokémon team builder coach.');
    expect(user).toContain('**Garchomp**');

    await POST(makeRequest(validBody));
    expect(vi.mocked(complete).mock.calls[1][0].endsWith(`\n\n${outputLanguageInstruction('en')}`)).toBe(true);
  });
});

describe('POST /api/teams/ai/slot-coach — input validation and failures', () => {
  const longName = 'x'.repeat(101);

  it.each([
    ['a null teammate', { team: [garchomp, null] }],
    ['a missing team', { team: undefined }],
    ['more than six teammates', { team: Array.from({ length: 7 }, () => garchomp) }],
    ['a set with an oversized item', { set: { ...garchomp, item: longName } }],
    ['a teammate with an oversized nickname', { team: [{ ...garchomp, name: longName }] }],
    ['a set with more than four moves', { set: { ...garchomp, moves: ['a', 'b', 'c', 'd', 'e'] } }],
    ['an EV value out of range', { set: { ...garchomp, evs: { hp: 100000 } } }],
    ['EVs that are not an object of numbers', { set: { ...garchomp, evs: { hp: 'lots' } } }],
  ])('rejects %s with validation_failed and never charges a generation', async (_label, patch) => {
    const res = await POST(makeRequest({ ...validBody, ...patch }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'validation_failed' });
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps the pinned codes ahead of the structural check, and for a non-object body', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ai_coach_format_invalid' });

    const noSet = await POST(makeRequest({ ...validBody, set: undefined }));
    expect(await noSet.json()).toMatchObject({ code: 'ai_coach_species_required' });
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
  });

  it('accepts a lenient set (blank teammates, missing optional fields, null optionals)', async () => {
    const res = await POST(
      makeRequest({
        ...validBody,
        set: { species: 'Garchomp', item: null, moves: ['Earthquake', '', '', ''], evs: { hp: 4, atk: 252 } },
        team: [{ species: '' }, { item: 'Leftovers' }, garchomp],
      }),
    );

    expect(res.status).toBe(200);
    expect(checkAndRecordAiGeneration).toHaveBeenCalledTimes(1);
    const [, user] = vi.mocked(complete).mock.calls[0];
    expect(user).toContain('- EVs: 4 hp / 252 atk');
  });

  it('asks for the slot-coach usage surface', async () => {
    await POST(makeRequest(validBody));
    expect(vi.mocked(complete).mock.calls[0][2]).toMatchObject({ surface: 'slot-coach' });
  });

  it.each([
    ['a refusal', () => new RefusalError('claude-sonnet-4-6'), 422, 'ai_output_refused'],
    ['a rejected request', () => new ModelRejectedError('claude-sonnet-4-6', 400, 'invalid_request_error'), 502, 'ai_service_unavailable'],
  ])('answers %s with its own status and code', async (_label, makeError, status, code) => {
    vi.mocked(complete).mockRejectedValue(makeError());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ success: false, code });
    errorSpy.mockRestore();
  });
});

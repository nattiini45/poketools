import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

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

vi.mock('@/lib/ai/agent/memory', () => ({
  getOrCreateProfile: vi.fn(),
  updateProfileConfig: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST } from '@/app/api/ai/agent/config/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getOrCreateProfile, updateProfileConfig } from '@/lib/ai/agent/memory';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: unknown) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const mockPlayer = { playerId: 'player-1', name: 'Ash', isAdmin: false };

const profileRow = {
  player_id: 'player-1',
  model_priority: ['deepseek-v4-pro', 'claude-haiku-4-5'],
  default_persona: 'linden_teambuilding',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/ai/agent/config', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the profile model priority + default persona', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getOrCreateProfile).mockResolvedValue(profileRow as never);

    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.model_priority).toEqual(['deepseek-v4-pro', 'claude-haiku-4-5']);
    expect(json.data.default_persona).toBe('linden_teambuilding');
  });
});

describe('POST /api/ai/agent/config', () => {
  it('returns 400 on an empty update', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(updateProfileConfig).not.toHaveBeenCalled();
  });

  it('returns 400 when a model id is not in the registry', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await POST(makeRequest({ model_priority: ['gpt-9-ultra'] }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('Unknown model id');
    expect(json).toMatchObject({ code: 'ai_model_ids_unknown', params: { ids: 'gpt-9-ultra' } });
    expect(updateProfileConfig).not.toHaveBeenCalled();
  });

  it('codes a validation failure (validation_failed + issues)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const json = await (await POST(makeRequest({}))).json();
    expect(json).toMatchObject({ code: 'validation_failed', params: { issues: json.error } });
  });

  it('updates the config on the happy path', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getOrCreateProfile).mockResolvedValue(profileRow as never);
    vi.mocked(updateProfileConfig).mockResolvedValue({
      ...profileRow,
      model_priority: ['claude-haiku-4-5', 'deepseek-v4-pro'],
      default_persona: 'linden_match_prep',
    } as never);

    const res = await POST(
      makeRequest({ model_priority: ['claude-haiku-4-5', 'deepseek-v4-pro'], default_persona: 'linden_match_prep' }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.default_persona).toBe('linden_match_prep');
    expect(updateProfileConfig).toHaveBeenCalledWith('player-1', {
      model_priority: ['claude-haiku-4-5', 'deepseek-v4-pro'],
      default_persona: 'linden_match_prep',
    });
  });
});

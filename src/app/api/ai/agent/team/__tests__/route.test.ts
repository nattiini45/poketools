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

vi.mock('@/lib/ai/rate-limit', () => ({
  checkAndRecordAiGeneration: vi.fn(),
}));

vi.mock('@/lib/ai/agent/tools/execute', () => ({
  executeTool: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/ai/agent/team/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { executeTool } from '@/lib/ai/agent/tools/execute';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: unknown) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const mockPlayer = { playerId: 'player-1', name: 'Ash', isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 20, remaining: 19, used: 1 });
});

describe('POST /api/ai/agent/team', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest({ format: 'gen9ou' }));
    expect(res.status).toBe(401);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 20, remaining: 0, used: 20 });

    const res = await POST(makeRequest({ format: 'gen9ou' }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: 'AI agent limit reached (20 per day). Try again later.',
      code: 'daily_limit_reached',
      params: { limit: 20 },
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('returns 400 when format is missing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await POST(makeRequest({ core_pokemon: ['Garchomp'] }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json).toMatchObject({ code: 'validation_failed', params: { issues: json.error } });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('builds a team via executeTool on the happy path', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(executeTool).mockResolvedValue({ ok: true, data: { team: [{ species: 'Garchomp' }] } });

    const res = await POST(makeRequest({ format: 'gen9ou', core_pokemon: ['Garchomp'] }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.team[0].species).toBe('Garchomp');
    expect(executeTool).toHaveBeenCalledWith('buildTeam', expect.objectContaining({ format: 'gen9ou', team_size: 6 }));
  });

  it('returns a safe 500 when the tool fails', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(executeTool).mockResolvedValue({ ok: false, error: 'internal boom' });

    const res = await POST(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe('Agent team build failed');
    expect(json.error).not.toContain('boom');
  });
});

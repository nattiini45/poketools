import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
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

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/ai/agent/orchestrator', () => ({
  runAgent: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/ai/agent/tournament-report/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { runAgent } from '@/lib/ai/agent/orchestrator';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: unknown) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const UUID_T = '00000000-0000-4000-8000-000000000010';
const UUID_R = '00000000-0000-4000-8000-000000000020';

const mockAdmin = { playerId: 'admin-1', name: 'Mod', isAdmin: true };
const tournament = { id: UUID_T, name: 'Spring Cup' };
const round = { id: UUID_R, round_number: 3, name: 'Round 3' };

const streamingRunAgent = {
  result: { toUIMessageStreamResponse: () => new Response('streamed') },
  getMetadata: () => ({}),
};

const validBody = { tournament_id: UUID_T, round_id: UUID_R, report_type: 'round_recap' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 20, remaining: 19, used: 1 });
});

describe('POST /api/ai/agent/tournament-report', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 20, remaining: 0, used: 20 });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(json.error).toContain('limit reached');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await POST(makeRequest({ tournament_id: UUID_T, report_type: 'bogus' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 404 when the tournament is missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue(null);
    vi.mocked(getRoundById).mockResolvedValue(round as never);

    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe('Tournament not found');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 404 when the round is missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(getRoundById).mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe('Round not found');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('streams a round recap via the Kale persona', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(getRoundById).mockResolvedValue(round as never);
    vi.mocked(runAgent).mockResolvedValue(streamingRunAgent as never);

    const res = await POST(makeRequest(validBody));
    expect(await res.text()).toBe('streamed');
    expect(runAgent).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runAgent).mock.calls[0][0];
    expect(arg.userId).toBe('admin-1');
    expect(arg.persona).toBe('kale');
    expect(arg.messages[0].content).toContain('Spring Cup');
    expect(arg.messages[0].content).toContain('recap');
  });

  it('frames a forecast when report_type is round_forecast', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(getRoundById).mockResolvedValue(round as never);
    vi.mocked(runAgent).mockResolvedValue(streamingRunAgent as never);

    const res = await POST(makeRequest({ ...validBody, report_type: 'round_forecast' }));
    expect(await res.text()).toBe('streamed');
    const arg = vi.mocked(runAgent).mock.calls[0][0];
    expect(arg.messages[0].content).toContain('forecast');
  });

  it('keeps Kale English: no output language is requested', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(getRoundById).mockResolvedValue(round as never);
    vi.mocked(runAgent).mockResolvedValue(streamingRunAgent as never);

    await POST(makeRequest(validBody));
    expect(vi.mocked(runAgent).mock.calls[0][0].outputLocale).toBeUndefined();
  });

  it('sends a code (and params) next to the unchanged English error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const invalid = await (await POST(makeRequest({ tournament_id: UUID_T, report_type: 'bogus' }))).json();
    expect(invalid).toMatchObject({ code: 'validation_failed', params: { issues: invalid.error } });

    vi.mocked(getTournamentById).mockResolvedValue(null);
    vi.mocked(getRoundById).mockResolvedValue(round as never);
    expect(await (await POST(makeRequest(validBody))).json()).toMatchObject({
      error: 'Tournament not found',
      code: 'tournament_not_found',
    });

    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(getRoundById).mockResolvedValue(null);
    expect(await (await POST(makeRequest(validBody))).json()).toMatchObject({
      error: 'Round not found',
      code: 'round_not_found',
    });

    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 20, remaining: 0, used: 20 });
    expect(await (await POST(makeRequest(validBody))).json()).toMatchObject({
      code: 'daily_limit_reached',
      params: { limit: 20 },
    });
  });
});

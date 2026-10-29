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

vi.mock('@/lib/ai/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/constants')>()),
  AI_ANALYSIS_STALE_MS: 300_000,
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-reports', () => ({
  getTournamentReport: vi.fn(),
  createTournamentReport: vi.fn(),
  updateTournamentReport: vi.fn(),
  deleteTournamentReport: vi.fn(),
}));

vi.mock('@/lib/ai/kale/pipeline', () => ({
  runPipeline: vi.fn(),
}));

vi.mock('@/lib/ai/kale/registry', () => ({}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/ai/rate-limit', () => ({
  checkAndRecordAiGeneration: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/ai/tournament-report/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import {
  getTournamentReport,
  createTournamentReport,
  updateTournamentReport,
} from '@/lib/supabase/queries/tournament-reports';
import { runPipeline } from '@/lib/ai/kale/pipeline';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const UUID_TOURNAMENT = '00000000-0000-4000-8000-000000000001';
const UUID_ROUND = '00000000-0000-4000-8000-000000000002';

const mockAdmin = {
  playerId: 'admin-1',
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

async function readStream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result = '';
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (chunk.value) result += decoder.decode(chunk.value);
  }
  return result;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/ai/tournament-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
  });

  it('returns 401 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue(null);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain('limit reached');
  });

  it('returns 400 when required fields missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('round_id');
  });

  it('returns 400 for invalid report_type', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'invalid_type' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('report_type');
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue(null);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Tournament not found');
  });

  it('returns 404 when round not found', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue(null);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Round not found');
  });

  it('returns cached report when completed and force=false', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue({
      id: 'report-1',
      status: 'completed',
      content: { sections: [] },
    } as never);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('completed');
  });

  it('serves a cached report without consuming a rate-limit slot', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue({
      id: 'report-1',
      status: 'completed',
      content: { sections: [] },
    } as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe('report-1');
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
    expect(createTournamentReport).not.toHaveBeenCalled();
  });

  it('does not consume a slot for invalid bodies, missing rows or already_pending', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    expect((await POST(makeRequest({ tournament_id: UUID_TOURNAMENT }))).status).toBe(400);

    vi.mocked(getTournamentById).mockResolvedValue(null);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    expect(
      (await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }))).status,
    ).toBe(404);

    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getTournamentReport).mockResolvedValue({
      id: 'report-1',
      status: 'pending',
      created_at: new Date().toISOString(),
    } as never);
    expect(
      (await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }))).status,
    ).toBe(200);

    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
  });

  it('consumes a slot when force=true regenerates a completed report', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue({
      id: 'report-1',
      status: 'completed',
      content: { sections: [] },
    } as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(
      makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap', force: true }),
    );

    expect(res.status).toBe(429);
    expect(checkAndRecordAiGeneration).toHaveBeenCalledWith('admin-1', 'tournament-report');
  });

  it('returns 400 for a malformed JSON body and 500 with a distinct message on lookup failure', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bad = await POST({ json: () => Promise.reject(new SyntaxError('bad json')) } as unknown as NextRequest);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid JSON body');

    vi.mocked(getTournamentById).mockRejectedValueOnce(new Error('db down'));
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    const lookup = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    expect(lookup.status).toBe(500);
    expect((await lookup.json()).error).toBe('Failed to load tournament or round');

    errorSpy.mockRestore();
  });

  it('answers a failed cached-report read with 500 and never starts a generation', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(getTournamentReport).mockRejectedValueOnce(new Error('db down'));
    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to load tournament report');
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('returns already_pending for recent pending record', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue({
      id: 'report-1',
      status: 'pending',
      created_at: new Date().toISOString(),
    } as never);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('already_pending');
  });

  it('streams a successful report generation', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue(null);
    vi.mocked(createTournamentReport).mockResolvedValue({ id: 'new-report' } as never);
    vi.mocked(runPipeline).mockResolvedValue({
      content: { sections: [{ title: 'Recap', body: 'Round 1 was amazing' }] },
      promptTokens: 100,
      completionTokens: 200,
      generationTimeMs: 5000,
      modelUsed: 'claude-sonnet-4-6',
      validationErrors: [],
    } as never);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const streamText = await readStream(res);
    expect(streamText).toContain('"status":"done"');
    // The row keeps the model the pipeline reports as having answered.
    expect(updateTournamentReport).toHaveBeenCalledWith(
      'new-report',
      expect.objectContaining({ status: 'completed', model_id: 'claude-sonnet-4-6' }),
    );
  });

  it('marks stale pending record as failed', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue({
      id: 'report-old',
      status: 'pending',
      created_at: new Date(Date.now() - 600_000).toISOString(),
    } as never);
    vi.mocked(createTournamentReport).mockResolvedValue({ id: 'new-report' } as never);
    vi.mocked(runPipeline).mockResolvedValue({
      content: { sections: [] },
      promptTokens: 50,
      completionTokens: 100,
      generationTimeMs: 3000,
      modelUsed: 'claude-sonnet-4-6',
      validationErrors: [],
    } as never);

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(updateTournamentReport).toHaveBeenCalledWith('report-old', expect.objectContaining({ status: 'failed' }));
  });

  it('sends codes next to the unchanged English errors (i18n)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    const body = { tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' };

    const invalid = await (await POST(makeRequest({ tournament_id: UUID_TOURNAMENT }))).json();
    expect(invalid).toMatchObject({ code: 'validation_failed', params: { issues: invalid.error } });

    const bad = await POST({ json: () => Promise.reject(new SyntaxError('bad json')) } as unknown as NextRequest);
    expect(await bad.json()).toMatchObject({ error: 'Invalid JSON body', code: 'invalid_json' });

    vi.mocked(getTournamentById).mockResolvedValue(null);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    expect(await (await POST(makeRequest(body))).json()).toMatchObject({ code: 'tournament_not_found' });

    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue(null);
    expect(await (await POST(makeRequest(body))).json()).toMatchObject({ code: 'round_not_found' });

    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue(null);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });
    expect(await (await POST(makeRequest(body))).json()).toMatchObject({
      error: 'Report generation limit reached (10 per day). Try again later.',
      code: 'daily_limit_reached',
      params: { limit: 10 },
    });
  });

  it('adds ai_report_failed to the SSE failed frame (Kale stays English)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: UUID_TOURNAMENT } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: UUID_ROUND } as never);
    vi.mocked(getTournamentReport).mockResolvedValue(null);
    vi.mocked(createTournamentReport).mockResolvedValue({ id: 'new-report' } as never);
    vi.mocked(runPipeline).mockRejectedValue(new Error('pipeline down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest({ tournament_id: UUID_TOURNAMENT, round_id: UUID_ROUND, report_type: 'round_recap' }));
    const text = await readStream(res);
    const frame = JSON.parse(text.split('\n\n').filter(Boolean).at(-1)!.replace(/^data: /, ''));
    expect(frame).toEqual({
      status: 'failed',
      error: 'Report generation failed — please try again later.',
      code: 'ai_report_failed',
    });

    errorSpy.mockRestore();
  });
});

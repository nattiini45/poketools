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

vi.mock('@/lib/ai/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/constants')>()),
  AI_ANALYSIS_STALE_MS: 300_000,
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-analyses', () => ({
  getMatchAnalysis: vi.fn(),
  createMatchAnalysis: vi.fn(),
  updateMatchAnalysis: vi.fn(),
  deleteMatchAnalysis: vi.fn(),
}));

vi.mock('@/lib/ai/context-builder', () => ({
  buildMatchAnalysisPrompt: vi.fn(),
}));

vi.mock('@/lib/ai/client', () => ({
  completeStreaming: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/ai/rate-limit', () => ({
  checkAndRecordAiGeneration: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({
  resolveContentLocale: vi.fn(async () => 'en'),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/ai/match-analysis/route';
import { resolveContentLocale } from '@/i18n/content-locale';
import { outputLanguageInstruction } from '@/lib/ai/language';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  getMatchAnalysis,
  createMatchAnalysis,
  updateMatchAnalysis,
} from '@/lib/supabase/queries/match-analyses';
import { buildMatchAnalysisPrompt } from '@/lib/ai/context-builder';
import { completeStreaming } from '@/lib/ai/client';
import { OutputCapError, RefusalError, ModelRejectedError } from '@/lib/ai/errors';
import { revalidateMatchPages } from '@/lib/revalidation';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const mockPlayer = {
  playerId: 'player-1',
  name: 'Ash',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

const UUID_MATCH = '00000000-0000-4000-8000-000000000001';

const mockMatch = {
  id: UUID_MATCH,
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  tournament_id: 'tourney-1',
  status: 'completed',
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

describe('POST /api/ai/match-analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain('limit reached');
  });

  it('returns 400 when match_id is missing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('match_id');
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(null);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Match not found');
  });

  it('returns 400 when match status is invalid', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'scheduled' } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('pending_confirmation or completed');
  });

  it('returns 403 when non-participant non-admin triggers analysis', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-3' } as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Only match participants or admins');
  });

  it('returns cached analysis when completed and force=false', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'completed',
      analysis: { summary: 'test' },
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('completed');
  });

  it('serves a cached analysis without consuming a rate-limit slot', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'completed',
      analysis: { summary: 'test' },
    } as never);
    // Even a player who has used every slot still gets the stored analysis.
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe('analysis-1');
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
    expect(createMatchAnalysis).not.toHaveBeenCalled();
  });

  it('does not consume a slot for already_pending, 404, 400 or 403 outcomes', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'pending',
      created_at: new Date().toISOString(),
    } as never);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(200);

    vi.mocked(getMatchById).mockResolvedValue(null);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(404);

    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'scheduled' } as never);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(400);

    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-3' } as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(403);

    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
  });

  it('consumes a slot when force=true regenerates a completed analysis', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'completed',
      analysis: { summary: 'test' },
    } as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ match_id: UUID_MATCH, force: true }));

    expect(res.status).toBe(429);
    expect(checkAndRecordAiGeneration).toHaveBeenCalledWith('player-1', 'match-analysis');
  });

  it('returns 400 for a malformed JSON body', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await POST({ json: () => Promise.reject(new SyntaxError('bad json')) } as unknown as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON body');
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
  });

  it('keeps lookup and rate-limit failures distinguishable', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(getMatchById).mockRejectedValueOnce(new Error('db down'));
    const lookup = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(lookup.status).toBe(500);
    expect((await lookup.json()).error).toBe('Failed to load match');

    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(checkAndRecordAiGeneration).mockRejectedValueOnce(new Error('rpc down'));
    const limiter = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(limiter.status).toBe(500);
    expect((await limiter.json()).error).toBe('Failed to check AI rate limit');

    errorSpy.mockRestore();
  });

  it('answers a failed cached-analysis read with 500 and never starts a generation', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(getMatchAnalysis).mockRejectedValueOnce(new Error('db down'));
    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to load match analysis');
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('returns already_pending for recent pending record', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'pending',
      created_at: new Date().toISOString(),
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('already_pending');
  });

  it('marks stale pending record as failed before retrying', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue({
      id: 'analysis-old',
      status: 'pending',
      created_at: new Date(Date.now() - 600_000).toISOString(),
    } as never);
    vi.mocked(createMatchAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(buildMatchAnalysisPrompt).mockResolvedValue({
      systemPrompt: 'system',
      userPrompt: 'user',
    });
    vi.mocked(completeStreaming).mockResolvedValue({
      content: JSON.stringify({
        summary: 'Great match',
        mvp: { pokemon: 'Pikachu', player: 'Ash', reasoning: 'Carried' },
        game_breakdowns: [{ game_number: 1, winner: 'Ash', narrative: 'Dominant', key_plays: ['Sweep'] }],
      }),
      model: 'test-model',
      prompt_tokens: 100,
      completion_tokens: 200,
    });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(updateMatchAnalysis).toHaveBeenCalledWith('analysis-old', expect.objectContaining({ status: 'failed' }));
  });

  it('streams a successful analysis', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(createMatchAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(buildMatchAnalysisPrompt).mockResolvedValue({
      systemPrompt: 'system',
      userPrompt: 'user',
    });
    vi.mocked(completeStreaming).mockResolvedValue({
      content: JSON.stringify({
        summary: 'Great match',
        mvp: { pokemon: 'Pikachu', player: 'Ash', reasoning: 'Carried' },
        game_breakdowns: [{ game_number: 1, winner: 'Ash', narrative: 'Dominant', key_plays: ['Sweep'] }],
      }),
      model: 'test-model',
      prompt_tokens: 100,
      completion_tokens: 200,
    });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const streamText = await readStream(res);
    expect(streamText).toContain('"status":"done"');
  });

  it('allows admin to trigger analysis for any match', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'admin-1', isAdmin: true } as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(createMatchAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(buildMatchAnalysisPrompt).mockResolvedValue({
      systemPrompt: 'system',
      userPrompt: 'user',
    });
    vi.mocked(completeStreaming).mockResolvedValue({
      content: JSON.stringify({
        summary: 'test',
        mvp: { pokemon: 'Pikachu' },
        game_breakdowns: [],
      }),
      model: 'test-model',
      prompt_tokens: 50,
      completion_tokens: 100,
    });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });
});

describe('POST /api/ai/match-analysis — error codes and output language (i18n)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
    vi.mocked(resolveContentLocale).mockResolvedValue('en');
  });

  it('sends a code (and params) next to the unchanged English error', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const invalid = await (await POST(makeRequest({}))).json();
    expect(invalid).toMatchObject({ code: 'validation_failed', params: { issues: invalid.error } });

    const badJson = await POST({ json: () => Promise.reject(new SyntaxError('bad')) } as unknown as NextRequest);
    expect(await badJson.json()).toMatchObject({ error: 'Invalid JSON body', code: 'invalid_json' });

    vi.mocked(getMatchById).mockResolvedValue(null);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'Match not found',
      code: 'match_not_found',
    });

    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'scheduled' } as never);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'Match must be pending_confirmation or completed, got scheduled',
      code: 'ai_match_status_invalid',
      params: { status: 'scheduled' },
    });

    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-3' } as never);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      code: 'ai_analysis_participants_only',
    });

    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'AI analysis limit reached (10 per day). Try again later.',
      code: 'daily_limit_reached',
      params: { limit: 10 },
    });
  });

  it('writes a stored analysis in the league language (the prompt changes only by the language line)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(createMatchAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(buildMatchAnalysisPrompt).mockResolvedValue({ systemPrompt: 'system', userPrompt: 'user' });
    vi.mocked(resolveContentLocale).mockResolvedValue('de');
    vi.mocked(completeStreaming).mockResolvedValue({
      content: JSON.stringify({ summary: 'Starkes Spiel', mvp: { pokemon: 'Pikachu' }, game_breakdowns: [] }),
      model: 'test-model',
      prompt_tokens: 1,
      completion_tokens: 1,
    });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(await readStream(res)).toContain('"status":"done"');

    expect(resolveContentLocale).toHaveBeenCalledWith({ matchId: UUID_MATCH });
    const [system, user] = vi.mocked(completeStreaming).mock.calls[0];
    expect(system).toBe(`system\n\n${outputLanguageInstruction('de')}`);
    expect(user).toBe('user');
  });

  it('adds ai_analysis_failed to the SSE failed frame', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(createMatchAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(buildMatchAnalysisPrompt).mockResolvedValue({ systemPrompt: 'system', userPrompt: 'user' });
    vi.mocked(completeStreaming).mockRejectedValue(new Error('provider down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const text = await readStream(await POST(makeRequest({ match_id: UUID_MATCH })));
    const frame = JSON.parse(text.split('\n\n').filter(Boolean).at(-1)!.replace(/^data: /, ''));
    expect(frame).toEqual({
      status: 'failed',
      error: 'Analysis failed — please try again later.',
      code: 'ai_analysis_failed',
    });

    errorSpy.mockRestore();
  });
});

// ─── Stored model, failure mapping and safe sends ───────────────────

describe('POST /api/ai/match-analysis — hardening', () => {
  const analysisJson = JSON.stringify({
    summary: 'Great match',
    mvp: { pokemon: 'Pikachu', player: 'Ash', reasoning: 'Carried' },
    game_breakdowns: [],
  });

  function arrange() {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue(null);
    vi.mocked(createMatchAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(buildMatchAnalysisPrompt).mockResolvedValue({ systemPrompt: 'system', userPrompt: 'user' });
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
  }

  function lastFrame(text: string) {
    return JSON.parse(text.split('\n\n').filter(Boolean).at(-1)!.replace(/^data: /, ''));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateMatchAnalysis).mockResolvedValue(undefined);
  });

  it('asks for JSON output and stores the model that actually answered', async () => {
    arrange();
    vi.mocked(completeStreaming).mockResolvedValue({
      content: analysisJson,
      model: 'claude-haiku-4-5-20251001',
      prompt_tokens: 100,
      completion_tokens: 200,
      fallback_used: true,
    });

    expect(await readStream(await POST(makeRequest({ match_id: UUID_MATCH })))).toContain('"status":"done"');

    expect(vi.mocked(completeStreaming).mock.calls[0][4]).toMatchObject({ jsonOutput: true });
    // The row is created with the model that was asked, then updated to the responder.
    expect(createMatchAnalysis).toHaveBeenCalledWith(UUID_MATCH, expect.any(String));
    expect(updateMatchAnalysis).toHaveBeenCalledWith(
      'new-analysis',
      expect.objectContaining({ status: 'completed', model_id: 'claude-haiku-4-5-20251001' }),
    );
  });

  it.each([
    [
      'a truncated answer',
      () => new OutputCapError('claude-sonnet-4-6', 4096),
      { code: 'ai_output_truncated', stored: 'ai_output_truncated: max_tokens 4096 on claude-sonnet-4-6' },
    ],
    [
      'a refusal',
      () => new RefusalError('claude-sonnet-4-6', 'cyber'),
      { code: 'ai_output_refused', stored: 'ai_output_refused: cyber on claude-sonnet-4-6' },
    ],
    [
      'a rejected request',
      () => new ModelRejectedError('claude-sonnet-4-6', 400, 'invalid_request_error'),
      { code: 'ai_service_unavailable', stored: 'ai_service_unavailable: HTTP 400 invalid_request_error on claude-sonnet-4-6' },
    ],
  ])('maps %s to its own code, safe message and stable stored error', async (_label, makeError, expected) => {
    arrange();
    vi.mocked(completeStreaming).mockRejectedValue(makeError());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const frame = lastFrame(await readStream(await POST(makeRequest({ match_id: UUID_MATCH }))));

    expect(frame).toMatchObject({ status: 'failed', code: expected.code });
    expect(typeof frame.error).toBe('string');
    expect(updateMatchAnalysis).toHaveBeenCalledWith(
      'new-analysis',
      expect.objectContaining({ status: 'failed', error: expected.stored }),
    );
    errorSpy.mockRestore();
  });

  it('stores a stable code and short cause, never the provider message, for other failures', async () => {
    arrange();
    const upstream = Object.assign(new Error('529 {"error":{"message":"private provider text"}}'), { status: 529 });
    vi.mocked(completeStreaming).mockRejectedValue(upstream);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const frame = lastFrame(await readStream(await POST(makeRequest({ match_id: UUID_MATCH }))));

    expect(frame).toEqual({
      status: 'failed',
      error: 'Analysis failed — please try again later.',
      code: 'ai_analysis_failed',
    });
    expect(updateMatchAnalysis).toHaveBeenCalledWith(
      'new-analysis',
      expect.objectContaining({ status: 'failed', error: 'ai_analysis_failed: upstream HTTP 529' }),
    );
    errorSpy.mockRestore();
  });

  it('keeps a stored analysis completed when the client has already left', async () => {
    arrange();
    let release: () => void = () => {};
    vi.mocked(completeStreaming).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ content: analysisJson, model: 'test-model', prompt_tokens: 1, completion_tokens: 1 });
        }),
    );

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const reader = res.body!.getReader();
    await reader.read(); // the first heartbeat
    await reader.cancel(); // the browser goes away; the next enqueue and the close would throw
    await vi.waitFor(() => expect(completeStreaming).toHaveBeenCalled());
    release();
    await vi.waitFor(() => expect(updateMatchAnalysis).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    const calls = vi.mocked(updateMatchAnalysis).mock.calls;
    expect(calls.some(([, patch]) => patch.status === 'completed')).toBe(true);
    expect(calls.some(([, patch]) => patch.status === 'failed')).toBe(false);
  });

  it('keeps a stored analysis completed when page revalidation fails afterwards', async () => {
    arrange();
    vi.mocked(completeStreaming).mockResolvedValue({
      content: analysisJson,
      model: 'test-model',
      prompt_tokens: 1,
      completion_tokens: 1,
    });
    vi.mocked(revalidateMatchPages).mockRejectedValueOnce(new Error('cache down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const text = await readStream(await POST(makeRequest({ match_id: UUID_MATCH })));

    expect(text).toContain('"status":"done"');
    expect(vi.mocked(updateMatchAnalysis).mock.calls.some(([, patch]) => patch.status === 'failed')).toBe(false);
    errorSpy.mockRestore();
  });
});

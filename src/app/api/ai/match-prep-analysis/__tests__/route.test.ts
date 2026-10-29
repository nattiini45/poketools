import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  isSuperadmin: vi.fn(),
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

vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({
  getMatchPrepAnalysis: vi.fn(),
  createMatchPrepAnalysis: vi.fn(),
  updateMatchPrepAnalysis: vi.fn(),
  deleteMatchPrepAnalysis: vi.fn(),
}));

vi.mock('@/lib/ai/context-builder', () => ({
  buildMatchPrepPrompt: vi.fn(),
}));

vi.mock('@/lib/ai/client', () => ({
  completeStreaming: vi.fn(),
}));

vi.mock('@/lib/ai/rate-limit', () => ({
  checkAndRecordAiGeneration: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({
  resolveContentLocale: vi.fn(async () => 'en'),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/ai/match-prep-analysis/route';
import { resolveContentLocale } from '@/i18n/content-locale';
import { outputLanguageInstruction } from '@/lib/ai/language';
import { requireAuth, isSuperadmin, AuthError } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  getMatchPrepAnalysis,
  createMatchPrepAnalysis,
  updateMatchPrepAnalysis,
} from '@/lib/supabase/queries/match-prep-analyses';
import { buildMatchPrepPrompt } from '@/lib/ai/context-builder';
import { completeStreaming } from '@/lib/ai/client';
import { OutputCapError, RefusalError, ModelRejectedError } from '@/lib/ai/errors';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const UUID_MATCH = '00000000-0000-4000-8000-000000000001';

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

const mockSession = {
  player: mockPlayer,
  user: { id: 'discord-1' },
};

const mockMatch = {
  id: UUID_MATCH,
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  tournament_id: 'tourney-1',
  status: 'scheduled',
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

describe('POST /api/ai/match-prep-analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 403 when user is not a registered player', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...mockSession, player: null } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not a registered player');
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue(null);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain('limit reached');
  });

  it('returns 400 when match_id is missing', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);

    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('match_id');
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(null);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Match not found');
  });

  it('returns 400 when match is not scheduled', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'completed' } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('only available for scheduled');
  });

  it('returns 403 when non-participant non-superadmin triggers scouting', async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ...mockSession,
      player: { ...mockPlayer, playerId: 'player-3' },
    } as never);
    vi.mocked(isSuperadmin).mockReturnValue(false);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Only match participants');
  });

  it('returns cached analysis when completed and force=false', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'completed',
      analysis: { opponent_profile: 'test' },
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('completed');
  });

  it('serves a cached scouting report without consuming a rate-limit slot', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'completed',
      analysis: { opponent_profile: 'test' },
    } as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe('analysis-1');
    expect(getMatchPrepAnalysis).toHaveBeenCalledWith(UUID_MATCH, 'player-1');
    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
    expect(createMatchPrepAnalysis).not.toHaveBeenCalled();
  });

  it('does not consume a slot for already_pending, 404, 400 or 403 outcomes', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);

    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'pending',
      created_at: new Date().toISOString(),
    } as never);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(200);

    vi.mocked(getMatchById).mockResolvedValue(null);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(404);

    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'completed' } as never);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(400);

    vi.mocked(requireAuth).mockResolvedValue({
      ...mockSession,
      player: { ...mockPlayer, playerId: 'player-3' },
    } as never);
    vi.mocked(isSuperadmin).mockReturnValue(false);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    expect((await POST(makeRequest({ match_id: UUID_MATCH }))).status).toBe(403);

    expect(checkAndRecordAiGeneration).not.toHaveBeenCalled();
  });

  it('consumes a slot when force=true regenerates a completed scouting report', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'completed',
      analysis: { opponent_profile: 'test' },
    } as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });

    const res = await POST(makeRequest({ match_id: UUID_MATCH, force: true }));

    expect(res.status).toBe(429);
    expect(checkAndRecordAiGeneration).toHaveBeenCalledWith('player-1', 'match-prep-analysis');
  });

  it('returns 400 for a malformed JSON body and 500 with a distinct message on lookup failure', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bad = await POST({ json: () => Promise.reject(new SyntaxError('bad json')) } as unknown as NextRequest);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid JSON body');

    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockRejectedValueOnce(new Error('db down'));
    const lookup = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(lookup.status).toBe(500);
    expect((await lookup.json()).error).toBe('Failed to load scouting report');

    errorSpy.mockRestore();
  });

  it('returns already_pending for recent pending record', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'pending',
      created_at: new Date().toISOString(),
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('already_pending');
  });

  it('marks stale pending record as failed', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue({
      id: 'analysis-1',
      status: 'pending',
      created_at: new Date(Date.now() - 600_000).toISOString(),
    } as never);
    vi.mocked(buildMatchPrepPrompt).mockResolvedValue({
      systemPrompt: 'system',
      userPrompt: 'user',
      hasUserTeam: false,
    });
    vi.mocked(createMatchPrepAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(completeStreaming).mockResolvedValue({
      content: JSON.stringify({
        opponent_profile: 'test',
        signature_pokemon: [],
        tendencies: { lead_patterns: '', play_style: '', favorite_moves: '' },
        recommendations: { threats_to_watch: [], suggested_leads: '', coverage_gaps: '', key_advice: '' },
      }),
      model: 'test-model',
      prompt_tokens: 100,
      completion_tokens: 200,
    });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(updateMatchPrepAnalysis).toHaveBeenCalledWith('analysis-1', expect.objectContaining({ status: 'failed' }));
  });

  it('streams a successful scouting report', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue(null);
    vi.mocked(buildMatchPrepPrompt).mockResolvedValue({
      systemPrompt: 'system',
      userPrompt: 'user',
      hasUserTeam: true,
    });
    vi.mocked(createMatchPrepAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(completeStreaming).mockResolvedValue({
      content: JSON.stringify({
        opponent_profile: 'Aggressive player',
        signature_pokemon: [{ pokemon: 'Pikachu', usage_note: 'Leads with it' }],
        tendencies: { lead_patterns: 'Fast leads', play_style: 'Aggressive', favorite_moves: 'Volt Switch' },
        recommendations: { threats_to_watch: ['Garchomp'], suggested_leads: 'Use bulky', coverage_gaps: 'Ice', key_advice: 'Play safe' },
        matchup_analysis: { your_advantages: 'Speed', their_advantages: 'Power', neutral_ground: 'Bulk' },
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
});

describe('POST /api/ai/match-prep-analysis — error codes and output language (i18n)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
    vi.mocked(isSuperadmin).mockReturnValue(false);
    vi.mocked(resolveContentLocale).mockResolvedValue('en');
  });

  it('sends a code (and params) next to the unchanged English error', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...mockSession, player: null } as never);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'Not a registered player',
      code: 'ai_not_registered_player',
    });

    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    const invalid = await (await POST(makeRequest({}))).json();
    expect(invalid).toMatchObject({ code: 'validation_failed', params: { issues: invalid.error } });

    vi.mocked(getMatchById).mockResolvedValue(null);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      code: 'match_not_found',
    });

    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, status: 'completed' } as never);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'Scouting is only available for scheduled matches (current: completed)',
      code: 'ai_scouting_scheduled_only',
      params: { status: 'completed' },
    });

    vi.mocked(getMatchById).mockResolvedValue({ ...mockMatch, player_1_id: 'p-x', player_2_id: 'p-y' } as never);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'Only match participants can trigger scouting',
      code: 'ai_scouting_participants_only',
    });

    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue(null);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 10, remaining: 0, used: 10 });
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'Scouting report limit reached (10 per day). Try again later.',
      code: 'daily_limit_reached',
      params: { limit: 10 },
    });
  });

  it('writes a stored report in the league language and codes the failed frame', async () => {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue(null);
    vi.mocked(buildMatchPrepPrompt).mockResolvedValue({ systemPrompt: 'system', userPrompt: 'user', hasUserTeam: false });
    vi.mocked(createMatchPrepAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(resolveContentLocale).mockResolvedValue('de');
    vi.mocked(completeStreaming).mockResolvedValue({
      content: 'not json',
      model: 'test-model',
      prompt_tokens: 1,
      completion_tokens: 1,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const text = await readStream(await POST(makeRequest({ match_id: UUID_MATCH })));

    expect(resolveContentLocale).toHaveBeenCalledWith({ matchId: UUID_MATCH });
    expect(vi.mocked(completeStreaming).mock.calls[0][0]).toBe(`system\n\n${outputLanguageInstruction('de')}`);
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

describe('POST /api/ai/match-prep-analysis — hardening', () => {
  const scoutingJson = JSON.stringify({
    opponent_profile: 'A patient balance player.',
    signature_pokemon: [],
    tendencies: {},
    recommendations: {},
  });

  function arrange() {
    vi.mocked(requireAuth).mockResolvedValue(mockSession as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue(null);
    vi.mocked(buildMatchPrepPrompt).mockResolvedValue({ systemPrompt: 'system', userPrompt: 'user', hasUserTeam: false });
    vi.mocked(createMatchPrepAnalysis).mockResolvedValue({ id: 'new-analysis' } as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 10, remaining: 9, used: 1 });
  }

  function lastFrame(text: string) {
    return JSON.parse(text.split('\n\n').filter(Boolean).at(-1)!.replace(/^data: /, ''));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateMatchPrepAnalysis).mockResolvedValue(undefined);
  });

  it('asks for JSON output and stores the model that actually answered', async () => {
    arrange();
    vi.mocked(completeStreaming).mockResolvedValue({
      content: scoutingJson,
      model: 'claude-haiku-4-5-20251001',
      prompt_tokens: 100,
      completion_tokens: 200,
      fallback_used: true,
    });

    expect(await readStream(await POST(makeRequest({ match_id: UUID_MATCH })))).toContain('"status":"done"');

    expect(vi.mocked(completeStreaming).mock.calls[0][4]).toMatchObject({ jsonOutput: true });
    expect(createMatchPrepAnalysis).toHaveBeenCalledWith(UUID_MATCH, 'player-1', expect.any(String), false);
    expect(updateMatchPrepAnalysis).toHaveBeenCalledWith(
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
      () => new RefusalError('claude-sonnet-4-6'),
      { code: 'ai_output_refused', stored: 'ai_output_refused: refusal on claude-sonnet-4-6' },
    ],
    [
      'a rejected request',
      () => new ModelRejectedError('claude-sonnet-4-6', 401, 'authentication_error'),
      { code: 'ai_service_unavailable', stored: 'ai_service_unavailable: HTTP 401 authentication_error on claude-sonnet-4-6' },
    ],
  ])('maps %s to its own code, safe message and stable stored error', async (_label, makeError, expected) => {
    arrange();
    vi.mocked(completeStreaming).mockRejectedValue(makeError());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const frame = lastFrame(await readStream(await POST(makeRequest({ match_id: UUID_MATCH }))));

    expect(frame).toMatchObject({ status: 'failed', code: expected.code });
    expect(updateMatchPrepAnalysis).toHaveBeenCalledWith(
      'new-analysis',
      expect.objectContaining({ status: 'failed', error: expected.stored }),
    );
    errorSpy.mockRestore();
  });

  it('keeps a stored report completed when the client has already left', async () => {
    arrange();
    let release: () => void = () => {};
    vi.mocked(completeStreaming).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ content: scoutingJson, model: 'test-model', prompt_tokens: 1, completion_tokens: 1 });
        }),
    );

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const reader = res.body!.getReader();
    await reader.read(); // the first heartbeat
    await reader.cancel(); // the browser goes away; the next enqueue and the close would throw
    await vi.waitFor(() => expect(completeStreaming).toHaveBeenCalled());
    release();
    await vi.waitFor(() => expect(updateMatchPrepAnalysis).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    const calls = vi.mocked(updateMatchPrepAnalysis).mock.calls;
    expect(calls.some(([, patch]) => patch.status === 'completed')).toBe(true);
    expect(calls.some(([, patch]) => patch.status === 'failed')).toBe(false);
  });
});

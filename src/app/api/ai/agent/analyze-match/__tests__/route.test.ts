import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  getSession: vi.fn(),
  isSuperadmin: vi.fn(),
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

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/ai/agent/orchestrator', () => ({
  runAgent: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-analyses', () => ({
  getMatchAnalysis: vi.fn(),
  createMatchAnalysis: vi.fn(),
  updateMatchAnalysis: vi.fn(),
  deleteMatchAnalysis: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({
  getMatchPrepAnalysis: vi.fn(),
  createMatchPrepAnalysis: vi.fn(),
  updateMatchPrepAnalysis: vi.fn(),
  deleteMatchPrepAnalysis: vi.fn(),
}));

vi.mock('@/lib/ai/context-builder', () => ({
  gatherMatchContext: vi.fn(),
  gatherMatchPrepContext: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({
  resolveContentLocale: vi.fn(async () => 'de'),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/ai/agent/analyze-match/route';
import { resolveContentLocale } from '@/i18n/content-locale';
import { requirePlayer, getSession, isSuperadmin, AuthError } from '@/lib/auth/helpers';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { runAgent } from '@/lib/ai/agent/orchestrator';
import {
  getMatchAnalysis,
  createMatchAnalysis,
  updateMatchAnalysis,
} from '@/lib/supabase/queries/match-analyses';
import {
  getMatchPrepAnalysis,
  createMatchPrepAnalysis,
  updateMatchPrepAnalysis,
} from '@/lib/supabase/queries/match-prep-analyses';
import { gatherMatchContext, gatherMatchPrepContext } from '@/lib/ai/context-builder';
import { revalidateMatchPages } from '@/lib/revalidation';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: unknown, cookie?: string) =>
  ({
    json: () => Promise.resolve(body),
    headers: new Headers(cookie ? { cookie } : {}),
  }) as unknown as NextRequest;

const UUID_MATCH = '00000000-0000-4000-8000-000000000001';

const mockPlayer = { playerId: 'player-1', name: 'Ash', isAdmin: false };

const mockSession = { player: mockPlayer, user: { id: 'discord-1' } };

const scheduledMatch = {
  id: UUID_MATCH,
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  player_1_name: 'Ash',
  player_2_name: 'Gary',
  tournament_id: 'tourney-1',
  status: 'scheduled',
};

const completedMatch = { ...scheduledMatch, status: 'completed' };

const streamingRunAgent = {
  result: { toUIMessageStreamResponse: () => new Response('streamed') },
  getMetadata: () => ({}),
};

const VALID_ANALYSIS_JSON = JSON.stringify({
  summary: 'A clean sweep under the sun.',
  turning_point: 'Turn 5 Solar Beam.',
  mvp: { pokemon: 'Vulpix', player: 'Ash', reasoning: 'Set the sun and enabled the sweep.' },
  game_breakdowns: [{ game_number: 1, winner: 'Ash', narrative: 'Sun up early.', key_plays: ['SR up'] }],
  meta_observations: 'Standard sun build.',
  what_if: 'Leading Scovillain loses the sun, so the Solar Beam line never happens.',
});

const postMatchRunAgent = {
  result: { text: Promise.resolve(VALID_ANALYSIS_JSON) },
  getMetadata: () => ({ usage: { input_tokens: 100, output_tokens: 50 }, conversation_id: 'conv-1' }),
};

const VALID_SCOUTING_JSON = JSON.stringify({
  opponent_profile: 'A patient sun team pilot.',
  signature_pokemon: [{ pokemon: 'Vulpix', usage_note: 'Leads to set Drought.' }],
  tendencies: { lead_patterns: 'Leads Vulpix.', play_style: 'Setup-oriented.', favorite_moves: 'Solar Beam.' },
  meta_positioning: 'Leans on the sun core.',
  suggested_picks: [{ pokemon: 'Rhydon', role: 'Wall', set_summary: 'Eviolite / Lightning Rod / ...', reasoning: 'Blanks the sun sweepers.' }],
  recommendations: { threats_to_watch: ['Scovillain'], suggested_leads: 'Lead a sun blocker.', coverage_gaps: 'Weak to rain.', key_advice: 'Deny the sun.' },
});

const scoutRunAgent = {
  result: { text: Promise.resolve(VALID_SCOUTING_JSON) },
  getMetadata: () => ({ usage: { input_tokens: 80, output_tokens: 40 }, conversation_id: 'conv-2' }),
};

/** Read the full SSE body from a streamed Response. */
async function readBody(res: Response): Promise<string> {
  return res.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 20, remaining: 19, used: 1 });
  vi.mocked(getSession).mockResolvedValue(mockSession as never);
  vi.mocked(isSuperadmin).mockReturnValue(false);
  // post_match defaults: no cached analysis, fresh row created, context gathered.
  vi.mocked(getMatchAnalysis).mockResolvedValue(null);
  vi.mocked(createMatchAnalysis).mockResolvedValue({ id: 'rec-1' } as never);
  vi.mocked(gatherMatchContext).mockResolvedValue({ context: 'MATCH-CTX', gen: 9 } as never);
  // opponent_scout defaults: no cached report, fresh per-player row, prep context.
  vi.mocked(getMatchPrepAnalysis).mockResolvedValue(null);
  vi.mocked(createMatchPrepAnalysis).mockResolvedValue({ id: 'prep-1' } as never);
  vi.mocked(gatherMatchPrepContext).mockResolvedValue({ context: 'PREP-CTX', gen: 9, hasUserTeam: false } as never);
});

describe('POST /api/ai/agent/analyze-match', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 20, remaining: 0, used: 20 });

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(json.error).toContain('limit reached');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await POST(makeRequest({ analysis_type: 'bogus' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 404 when the match is not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(null);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe('Match not found');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 403 when a non-participant non-superadmin requests a scout', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-3' } as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toContain('Only match participants');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 400 when scouting a non-scheduled match', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('scheduled');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 403 when a non-participant non-admin requests post_match analysis', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-3' } as never);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toContain('participants or admins');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 400 when post_match analysis runs on a scheduled match', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('completed');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('generates + persists a structured opponent_scout (default analysis_type) and signals done', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    vi.mocked(runAgent).mockResolvedValue(scoutRunAgent as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH }));
    const body = await readBody(res);
    expect(body).toContain('"status":"done"');

    // The deterministic scouting context is injected into the agent message.
    const arg = vi.mocked(runAgent).mock.calls[0][0];
    expect(arg.userId).toBe('player-1');
    expect(arg.persona).toBe('linden_match_prep');
    expect(arg.context?.upcoming_match_id).toBe(UUID_MATCH);
    expect(arg.messages[0].content).toContain('Gary');
    expect(arg.messages[0].content).toContain('PREP-CTX');

    // Per-player row created with the gathered hasUserTeam flag, then completed.
    expect(createMatchPrepAnalysis).toHaveBeenCalledWith(UUID_MATCH, 'player-1', expect.any(String), false);
    expect(updateMatchPrepAnalysis).toHaveBeenCalledWith(
      'prep-1',
      expect.objectContaining({ status: 'completed', has_user_team: false }),
    );
  });

  it('streams a free-text report for threat_assessment (no structured card)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    vi.mocked(runAgent).mockResolvedValue(streamingRunAgent as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'threat_assessment' }));
    expect(await res.text()).toBe('streamed');
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(createMatchPrepAnalysis).not.toHaveBeenCalled();
    const arg = vi.mocked(runAgent).mock.calls[0][0];
    expect(arg.messages[0].content).toContain('Gary');
  });

  it('lets a superadmin scout a match they are not part of', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-3' } as never);
    vi.mocked(isSuperadmin).mockReturnValue(true);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    vi.mocked(runAgent).mockResolvedValue(scoutRunAgent as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }));
    expect(await readBody(res)).toContain('"status":"done"');
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(createMatchPrepAnalysis).toHaveBeenCalledWith(UUID_MATCH, 'player-3', expect.any(String), false);
  });

  it('returns done from cache for opponent_scout when a completed report exists and not forced', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    vi.mocked(getMatchPrepAnalysis).mockResolvedValue({
      id: 'prep-1',
      status: 'completed',
      created_at: new Date().toISOString(),
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }));
    expect(await readBody(res)).toContain('"status":"done"');
    expect(runAgent).not.toHaveBeenCalled();
    expect(createMatchPrepAnalysis).not.toHaveBeenCalled();
  });

  it('streams failed and logs when the cached scout-report read fails (never treated as "no report")', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const readError = new Error('db down');
    vi.mocked(getMatchPrepAnalysis).mockRejectedValueOnce(readError);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }));
    const body = await readBody(res);
    const frame = JSON.parse(body.split('\n\n').filter(Boolean).at(-1)!.replace(/^data: /, ''));
    // Its own catalogued code, distinct from a failed generation.
    expect(frame).toEqual({
      status: 'failed',
      error: 'Could not load the stored analysis — please try again later.',
      code: 'ai_analysis_cache_read_failed',
    });
    expect(createMatchPrepAnalysis).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    // The original error object is logged, not only its message.
    expect(errorSpy).toHaveBeenCalledWith('[ai/agent/analyze-match] opponent_scout stored-report read failed:', readError);
    errorSpy.mockRestore();
  });

  it('marks the scout report failed when the model output cannot be parsed', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    vi.mocked(runAgent).mockResolvedValue({
      result: { text: Promise.resolve('not json at all') },
      getMetadata: () => ({ usage: { input_tokens: 10, output_tokens: 5 } }),
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }));
    expect(await readBody(res)).toContain('"status":"failed"');
    expect(updateMatchPrepAnalysis).toHaveBeenCalledWith(
      'prep-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('generates + persists a structured post_match analysis and signals done', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    vi.mocked(runAgent).mockResolvedValue(postMatchRunAgent as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }));
    const body = await readBody(res);
    expect(body).toContain('"status":"done"');

    // The deterministic match context is injected into the agent message.
    const arg = vi.mocked(runAgent).mock.calls[0][0];
    expect(arg.persona).toBe('linden_match_prep');
    expect(arg.messages[0].content).toContain(UUID_MATCH);
    expect(arg.messages[0].content).toContain('MATCH-CTX');

    // The parsed analysis is persisted as completed + pages revalidated.
    expect(createMatchAnalysis).toHaveBeenCalledWith(UUID_MATCH, expect.any(String));
    expect(updateMatchAnalysis).toHaveBeenCalledWith(
      'rec-1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(revalidateMatchPages).toHaveBeenCalled();
  });

  it('returns done from cache without re-running when an analysis exists and not forced', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    vi.mocked(getMatchAnalysis).mockResolvedValue({
      id: 'rec-1',
      status: 'completed',
      created_at: new Date().toISOString(),
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }));
    const body = await readBody(res);
    expect(body).toContain('"status":"done"');
    expect(runAgent).not.toHaveBeenCalled();
    expect(createMatchAnalysis).not.toHaveBeenCalled();
  });

  it('streams failed and logs when the cached analysis read fails (never treated as "no analysis")', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const readError = new Error('db down');
    vi.mocked(getMatchAnalysis).mockRejectedValueOnce(readError);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }));
    const body = await readBody(res);
    const frame = JSON.parse(body.split('\n\n').filter(Boolean).at(-1)!.replace(/^data: /, ''));
    // Its own catalogued code, distinct from a failed generation.
    expect(frame).toEqual({
      status: 'failed',
      error: 'Could not load the stored analysis — please try again later.',
      code: 'ai_analysis_cache_read_failed',
    });
    expect(createMatchAnalysis).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    // The original error object is logged, not only its message.
    expect(errorSpy).toHaveBeenCalledWith('[ai/agent/analyze-match] post_match stored-analysis read failed:', readError);
    errorSpy.mockRestore();
  });

  it('marks the analysis failed when the model output cannot be parsed', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    vi.mocked(runAgent).mockResolvedValue({
      result: { text: Promise.resolve('not json at all') },
      getMetadata: () => ({ usage: { input_tokens: 10, output_tokens: 5 } }),
    } as never);

    const res = await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }));
    const body = await readBody(res);
    expect(body).toContain('"status":"failed"');
    expect(updateMatchAnalysis).toHaveBeenCalledWith(
      'rec-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });
});

describe('POST /api/ai/agent/analyze-match — error codes and output language (i18n)', () => {
  it('sends a code (and params) next to the unchanged English error', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const invalid = await (await POST(makeRequest({ analysis_type: 'bogus' }))).json();
    expect(invalid).toMatchObject({ code: 'validation_failed', params: { issues: invalid.error } });

    vi.mocked(getMatchById).mockResolvedValue(null);
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'Match not found',
      code: 'match_not_found',
    });

    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    expect(
      await (await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }))).json(),
    ).toMatchObject({
      error: 'Match analysis is only available for completed matches (current: scheduled)',
      code: 'ai_analysis_completed_only',
      params: { status: 'scheduled' },
    });

    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    expect(
      await (await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }))).json(),
    ).toMatchObject({ code: 'ai_scouting_scheduled_only', params: { status: 'completed' } });

    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, playerId: 'player-3' } as never);
    expect(
      await (await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }))).json(),
    ).toMatchObject({ code: 'ai_analysis_participants_only' });

    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    expect(
      await (await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }))).json(),
    ).toMatchObject({ code: 'ai_scouting_participants_only' });

    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 20, remaining: 0, used: 20 });
    expect(await (await POST(makeRequest({ match_id: UUID_MATCH }))).json()).toMatchObject({
      error: 'AI agent limit reached (20 per day). Try again later.',
      code: 'daily_limit_reached',
      params: { limit: 20 },
    });
  });

  it('writes stored analyses and scouting reports in the league language', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    vi.mocked(runAgent).mockResolvedValue(postMatchRunAgent as never);
    await readBody(await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' }, 'plc_locale=en')));
    expect(resolveContentLocale).toHaveBeenCalledWith({ matchId: UUID_MATCH });
    expect(vi.mocked(runAgent).mock.calls[0][0].outputLocale).toBe('de');

    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    vi.mocked(runAgent).mockResolvedValue(scoutRunAgent as never);
    await readBody(await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'opponent_scout' }, 'plc_locale=en')));
    expect(vi.mocked(runAgent).mock.calls[1][0].outputLocale).toBe('de');
  });

  it('streams threat_assessment (live, no shared report) in the viewer’s language', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch as never);
    vi.mocked(runAgent).mockResolvedValue(streamingRunAgent as never);

    await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'threat_assessment' }, 'plc_locale=en'));
    expect(vi.mocked(runAgent).mock.calls[0][0].outputLocale).toBe('en');
    expect(resolveContentLocale).not.toHaveBeenCalled();
  });

  it('adds ai_analysis_failed to the SSE failed frame', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    vi.mocked(runAgent).mockResolvedValue({
      result: { text: Promise.resolve('not json at all') },
      getMetadata: () => ({}),
    } as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const body = await readBody(await POST(makeRequest({ match_id: UUID_MATCH, analysis_type: 'post_match' })));
    const frame = JSON.parse(body.split('\n\n').filter(Boolean).at(-1)!.replace(/^data: /, ''));
    expect(frame).toEqual({
      status: 'failed',
      error: 'Analysis failed — please try again later.',
      code: 'ai_analysis_failed',
    });

    errorSpy.mockRestore();
  });
});

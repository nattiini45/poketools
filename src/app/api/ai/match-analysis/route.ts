import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { aiMatchAnalysisSchema, formatZodErrors } from '@/lib/validation';
import { AI_ANALYSIS_STALE_MS } from '@/lib/ai/constants';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  getMatchAnalysis,
  createMatchAnalysis,
  updateMatchAnalysis,
  deleteMatchAnalysis,
} from '@/lib/supabase/queries/match-analyses';
import { buildMatchAnalysisPrompt } from '@/lib/ai/context-builder';
import { parseAnalysisResponse } from '@/lib/ai/parse-analysis';
import { completeStreaming } from '@/lib/ai/client';
import { revalidateMatchPages } from '@/lib/revalidation';
import { checkAndRecordAiGeneration, type AiRateLimitResult } from '@/lib/ai/rate-limit';
import { withOutputLanguage } from '@/lib/ai/language';
import { resolveContentLocale } from '@/i18n/content-locale';
import type { ApiResult } from '@/types/api';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { MatchAnalysis } from '@/types/game';
import type { MatchWithPlayers } from '@/types/match';

export const maxDuration = 300;

const DEFAULT_MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';
const HEARTBEAT_INTERVAL_MS = 5_000;
/** Code of the SSE `failed` frame (`errors/ai`). */
const FAILED_CODE: ApiErrorCode = 'ai_analysis_failed';

// ─── POST: Trigger analysis for a match ─────────────────────────────

export async function POST(request: NextRequest) {
  // ── Pre-validation (fast, before streaming) ────────────────────────
  let player;
  try {
    player = await requirePlayer();
  } catch (err) {
    return safeErrorResponse(err, 'Failed to trigger match analysis');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    return safeErrorResponse(err, 'Invalid JSON body', 400, 'invalid_json');
  }
  const zodResult = aiMatchAnalysisSchema.safeParse(rawBody);

  if (!zodResult.success) {
    const issues = formatZodErrors(zodResult.error);
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: issues, code: 'validation_failed', params: { issues } },
      { status: 400 }
    );
  }

  const matchId = zodResult.data.match_id;
  const force = zodResult.data.force;

  let match: MatchWithPlayers | null;
  try {
    match = await getMatchById(matchId);
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load match');
  }
  if (!match) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Match not found', code: 'match_not_found' },
      { status: 404 }
    );
  }

  const validStatuses = ['pending_confirmation', 'completed'];
  if (!validStatuses.includes(match.status)) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: `Match must be pending_confirmation or completed, got ${match.status}`,
        code: 'ai_match_status_invalid',
        params: { status: match.status },
      },
      { status: 400 }
    );
  }

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;
  if (!isParticipant && !player.isAdmin) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'Only match participants or admins can trigger analysis',
        code: 'ai_analysis_participants_only',
      },
      { status: 403 }
    );
  }

  // Cache first: a stored analysis, or one already being generated, is served
  // before the rate limiter, so it never spends a daily generation slot.
  let existing: MatchAnalysis | null;
  try {
    existing = await getMatchAnalysis(matchId);
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load match analysis');
  }

  // Idempotent unless force=true
  if (existing?.status === 'completed' && !force) {
    return NextResponse.json<ApiResult<MatchAnalysis>>({
      success: true,
      data: existing,
    });
  }

  const pendingAge =
    existing?.status === 'pending' ? Date.now() - new Date(existing.created_at).getTime() : null;
  if (pendingAge !== null && pendingAge <= AI_ANALYSIS_STALE_MS && !force) {
    // Recent pending — don't start a duplicate
    return new Response(
      JSON.stringify({ status: 'already_pending' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Guard against stuck pending records — mark stale ones as failed, then
  // fall through to create a new attempt
  if (existing && pendingAge !== null && pendingAge > AI_ANALYSIS_STALE_MS) {
    try {
      await updateMatchAnalysis(existing.id, {
        status: 'failed',
        error: 'Analysis timed out',
        generation_time_ms: pendingAge,
      });
    } catch (err) {
      return safeErrorResponse(err, 'Failed to expire stale match analysis');
    }
  }

  // Rate limit — 10 per day per player, charged only when a generation starts
  let rateLimit: AiRateLimitResult;
  try {
    rateLimit = await checkAndRecordAiGeneration(player.playerId, 'match-analysis');
  } catch (err) {
    return safeErrorResponse(err, 'Failed to check AI rate limit');
  }
  if (!rateLimit.allowed) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: `AI analysis limit reached (${rateLimit.limit} per day). Try again later.`,
        code: 'daily_limit_reached',
        params: { limit: rateLimit.limit },
      },
      { status: 429, headers: { 'Retry-After': '3600' } }
    );
  }

  // ── Stream the LLM work with heartbeats ────────────────────────────
  // Streaming keeps the Vercel function alive for up to 5 minutes on
  // the Hobby plan, vs 60s for buffered responses. Heartbeat chunks
  // every 5s prevent idle-timeout during the LLM's thinking phase.

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Chunk-driven heartbeat: emit a thinking event whenever 5s
      // elapse between LLM chunks, keeping the Vercel connection alive.
      let lastHeartbeat = Date.now();
      function emitHeartbeatIfNeeded() {
        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          try {
            controller.enqueue(encoder.encode('data: {"status":"thinking"}\n\n'));
          } catch { /* stream closed */ }
          lastHeartbeat = now;
        }
      }

      // Send an initial heartbeat immediately so the client knows the stream is alive
      try {
        controller.enqueue(encoder.encode('data: {"status":"thinking"}\n\n'));
      } catch { /* stream closed */ }

      // Safety-net interval: if the LLM blocks without sending chunks
      // (e.g. a long initial thinking phase), this keeps Vercel alive.
      const fallbackHeartbeat = setInterval(() => {
        emitHeartbeatIfNeeded();
      }, HEARTBEAT_INTERVAL_MS);

      try {
        // Delete previous attempt
        if (existing) {
          await deleteMatchAnalysis(matchId);
        }

        const record = await createMatchAnalysis(matchId, DEFAULT_MODEL);
        const startTime = Date.now();

        try {
          const [{ systemPrompt, userPrompt }, contentLocale] = await Promise.all([
            buildMatchAnalysisPrompt(matchId),
            // A stored analysis follows the league's language (i18n-core §6.4).
            resolveContentLocale({ matchId }),
          ]);

          // Stream from LLM — each chunk triggers a heartbeat check
          const result = await completeStreaming(
            withOutputLanguage(systemPrompt, contentLocale),
            userPrompt,
            emitHeartbeatIfNeeded,
          );
          const generationTime = Date.now() - startTime;

          const analysis = parseAnalysisResponse(result.content);

          await updateMatchAnalysis(record.id, {
            analysis,
            prompt_tokens: result.prompt_tokens,
            completion_tokens: result.completion_tokens,
            generation_time_ms: generationTime,
            status: 'completed',
            error: null,
          });

          await revalidateMatchPages(match.tournament_id, match.id);

          controller.enqueue(
            encoder.encode(`data: {"status":"done"}\n\n`)
          );
        } catch (llmError) {
          const errorMessage = llmError instanceof Error ? llmError.message : 'Unknown LLM error';
          console.error('[ai/match-analysis] LLM error:', errorMessage);

          await updateMatchAnalysis(record.id, {
            status: 'failed',
            error: errorMessage,
            generation_time_ms: Date.now() - startTime,
          });

          const safeMessage = 'Analysis failed — please try again later.';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ status: 'failed', error: safeMessage, code: FAILED_CODE })}\n\n`)
          );
        }
      } catch (setupError) {
        const message = setupError instanceof Error ? setupError.message : 'Internal error';
        console.error('[ai/match-analysis] Setup error:', message);
        const safeMessage = 'Analysis failed — please try again later.';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ status: 'failed', error: safeMessage, code: FAILED_CODE })}\n\n`)
        );
      } finally {
        clearInterval(fallbackHeartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isSuperadmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { aiMatchPrepSchema, formatZodErrors } from '@/lib/validation';
import { AI_ANALYSIS_STALE_MS, getClaudeModelId } from '@/lib/ai/constants';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  getMatchPrepAnalysis,
  createMatchPrepAnalysis,
  updateMatchPrepAnalysis,
  deleteMatchPrepAnalysis,
} from '@/lib/supabase/queries/match-prep-analyses';
import { buildMatchPrepPrompt } from '@/lib/ai/context-builder';
import { parseScoutingResponse } from '@/lib/ai/parse-scouting';
import { completeStreaming } from '@/lib/ai/client';
import { checkAndRecordAiGeneration, type AiRateLimitResult } from '@/lib/ai/rate-limit';
import { withOutputLanguage } from '@/lib/ai/language';
import { describeAiFailure } from '@/lib/ai/failure';
import { createSafeSseSender } from '@/lib/ai/sse';
import { resolveContentLocale } from '@/i18n/content-locale';
import type { ApiResult } from '@/types/api';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { MatchPrepAnalysis } from '@/types/game';
import type { MatchWithPlayers } from '@/types/match';

export const maxDuration = 300;

const HEARTBEAT_INTERVAL_MS = 5_000;
/** Code of the SSE `failed` frame (`errors/ai`). */
const FAILED_CODE: ApiErrorCode = 'ai_analysis_failed';
const FAILED_MESSAGE = 'Analysis failed — please try again later.';

// ─── POST: Generate scouting report ──────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
  let session;
  try {
    session = await requireAuth();
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate scouting report');
  }
  const player = session.player;
  if (!player) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Not a registered player', code: 'ai_not_registered_player' },
      { status: 403 }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    return safeErrorResponse(err, 'Invalid JSON body', 400, 'invalid_json');
  }
  const zodResult = aiMatchPrepSchema.safeParse(rawBody);

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

  // Scouting is only available for scheduled matches
  if (match.status !== 'scheduled') {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: `Scouting is only available for scheduled matches (current: ${match.status})`,
        code: 'ai_scouting_scheduled_only',
        params: { status: match.status },
      },
      { status: 400 }
    );
  }

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;
  // Only participants and superadmin — regular admins must not see opponent prep
  if (!isParticipant && !isSuperadmin(session)) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'Only match participants can trigger scouting',
        code: 'ai_scouting_participants_only',
      },
      { status: 403 }
    );
  }

  // Cache first: a stored report, or one already being generated, is served
  // before the rate limiter, so it never spends a daily generation slot.
  let existing: MatchPrepAnalysis | null;
  try {
    existing = await getMatchPrepAnalysis(matchId, player.playerId);
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load scouting report');
  }

  // Idempotent unless force=true
  if (existing?.status === 'completed' && !force) {
    return NextResponse.json<ApiResult<MatchPrepAnalysis>>({
      success: true,
      data: existing,
    });
  }

  const pendingAge =
    existing?.status === 'pending' ? Date.now() - new Date(existing.created_at).getTime() : null;
  if (pendingAge !== null && pendingAge <= AI_ANALYSIS_STALE_MS && !force) {
    return new Response(
      JSON.stringify({ status: 'already_pending' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Guard stale pending records
  if (existing && pendingAge !== null && pendingAge > AI_ANALYSIS_STALE_MS) {
    try {
      await updateMatchPrepAnalysis(existing.id, {
        status: 'failed',
        error: 'Analysis timed out',
        generation_time_ms: pendingAge,
      });
    } catch (err) {
      return safeErrorResponse(err, 'Failed to expire stale scouting report');
    }
  }

  // Rate limit — 10 per day per player, charged only when a generation starts
  let rateLimit: AiRateLimitResult;
  try {
    rateLimit = await checkAndRecordAiGeneration(player.playerId, 'match-prep-analysis');
  } catch (err) {
    return safeErrorResponse(err, 'Failed to check AI rate limit');
  }
  if (!rateLimit.allowed) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: `Scouting report limit reached (${rateLimit.limit} per day). Try again later.`,
        code: 'daily_limit_reached',
        params: { limit: rateLimit.limit },
      },
      { status: 429, headers: { 'Retry-After': '3600' } }
    );
  }

  // ── Stream the LLM work ────────────────────────────────────────────

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Every frame goes through the safe sender: a browser that left must not turn a stored
      // report into a failed one.
      const sse = createSafeSseSender(controller);

      let lastHeartbeat = Date.now();
      function emitHeartbeatIfNeeded() {
        const now = Date.now();
        if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
          sse.send({ status: 'thinking' });
          lastHeartbeat = now;
        }
      }

      sse.send({ status: 'thinking' });

      const fallbackHeartbeat = setInterval(() => {
        emitHeartbeatIfNeeded();
      }, HEARTBEAT_INTERVAL_MS);

      try {
        // Delete previous attempt
        if (existing) {
          await deleteMatchPrepAnalysis(matchId, player.playerId);
        }

        const [{ systemPrompt, userPrompt, hasUserTeam }, contentLocale] = await Promise.all([
          buildMatchPrepPrompt(matchId, player.playerId),
          // A stored report follows the league's language (i18n-core §6.4).
          resolveContentLocale({ matchId }),
        ]);

        // The row starts with the model we ask for; a completed row is updated to the model
        // that actually answered (a fallback answer must not be labelled with the primary).
        const record = await createMatchPrepAnalysis(
          matchId,
          player.playerId,
          getClaudeModelId(),
          hasUserTeam
        );
        const startTime = Date.now();

        try {
          const result = await completeStreaming(
            withOutputLanguage(systemPrompt, contentLocale),
            userPrompt,
            emitHeartbeatIfNeeded,
            4096,
            // The answer is parsed as JSON, so one cut off at the output cap is a failure.
            { jsonOutput: true, surface: 'match-prep-analysis' },
          );
          const generationTime = Date.now() - startTime;

          const analysis = parseScoutingResponse(result.content, hasUserTeam);

          await updateMatchPrepAnalysis(record.id, {
            analysis,
            model_id: result.model || undefined,
            has_user_team: hasUserTeam,
            prompt_tokens: result.prompt_tokens,
            completion_tokens: result.completion_tokens,
            generation_time_ms: generationTime,
            status: 'completed',
            error: null,
          });

          // Saved as completed: a closed stream cannot flip it to failed.
          sse.send({ status: 'done' });
        } catch (llmError) {
          const errorMessage = llmError instanceof Error ? llmError.message : 'Unknown LLM error';
          console.error('[ai/match-prep-analysis] LLM error:', errorMessage);

          const failure = describeAiFailure(llmError, { code: FAILED_CODE, message: FAILED_MESSAGE });
          await updateMatchPrepAnalysis(record.id, {
            status: 'failed',
            error: failure.stored,
            generation_time_ms: Date.now() - startTime,
          });

          sse.send({ status: 'failed', error: failure.message, code: failure.code });
        }
      } catch (setupError) {
        const message = setupError instanceof Error ? setupError.message : 'Internal error';
        console.error('[ai/match-prep-analysis] Setup error:', message);
        sse.send({ status: 'failed', error: FAILED_MESSAGE, code: FAILED_CODE });
      } finally {
        clearInterval(fallbackHeartbeat);
        sse.close();
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

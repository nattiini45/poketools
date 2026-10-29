import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { aiTournamentReportSchema, formatZodErrors } from '@/lib/validation';
import { AI_ANALYSIS_STALE_MS, getKaleModelId } from '@/lib/ai/constants';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import {
  getTournamentReport,
  createTournamentReport,
  updateTournamentReport,
  deleteTournamentReport,
} from '@/lib/supabase/queries/tournament-reports';
import { runPipeline } from '@/lib/ai/kale/pipeline';
// Force registry initialization
import '@/lib/ai/kale/registry';
import { revalidateMatchPages } from '@/lib/revalidation';
import { checkAndRecordAiGeneration, type AiRateLimitResult } from '@/lib/ai/rate-limit';
import { describeAiFailure } from '@/lib/ai/failure';
import { createSafeSseSender } from '@/lib/ai/sse';
import type { ApiResult } from '@/types/api';
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { TournamentReport } from '@/types/tournament-report';
import type { Tournament } from '@/types/tournament';
import type { Round } from '@/types/round';

export const maxDuration = 300;

const HEARTBEAT_INTERVAL_MS = 5_000;
/** Code of the SSE `failed` frame (`errors/ai`). */
const FAILED_CODE: ApiErrorCode = 'ai_report_failed';
const FAILED_MESSAGE = 'Report generation failed — please try again later.';

// ─── POST: Generate or regenerate a tournament report ────────────────

export async function POST(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate tournament report');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    return safeErrorResponse(err, 'Invalid JSON body', 400, 'invalid_json');
  }
  const zodResult = aiTournamentReportSchema.safeParse(rawBody);

  if (!zodResult.success) {
    const issues = formatZodErrors(zodResult.error);
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: issues, code: 'validation_failed', params: { issues } },
      { status: 400 }
    );
  }

  const tournamentId = zodResult.data.tournament_id;
  const roundId = zodResult.data.round_id;
  const reportType = zodResult.data.report_type;
  const force = zodResult.data.force;

  let tournament: Tournament | null;
  let round: Round | null;
  try {
    [tournament, round] = await Promise.all([
      getTournamentById(tournamentId),
      getRoundById(roundId),
    ]);
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load tournament or round');
  }

  if (!tournament) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
      { status: 404 }
    );
  }
  if (!round) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Round not found', code: 'round_not_found' },
      { status: 404 }
    );
  }

  // Cache first: a stored report, or one already being generated, is served
  // before the rate limiter, so it never spends a daily generation slot.
  let existing: TournamentReport | null;
  try {
    existing = await getTournamentReport(tournamentId, roundId, reportType);
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load tournament report');
  }

  // Idempotent unless force=true
  if (existing?.status === 'completed' && !force) {
    return NextResponse.json<ApiResult<TournamentReport>>({
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
      await updateTournamentReport(existing.id, {
        status: 'failed',
        error: 'Report generation timed out',
        generation_time_ms: pendingAge,
      });
    } catch (err) {
      return safeErrorResponse(err, 'Failed to expire stale tournament report');
    }
  }

  // Rate limit — 10 per day per admin, charged only when a generation starts
  let rateLimit: AiRateLimitResult;
  try {
    rateLimit = await checkAndRecordAiGeneration(admin.playerId, 'tournament-report');
  } catch (err) {
    return safeErrorResponse(err, 'Failed to check AI rate limit');
  }
  if (!rateLimit.allowed) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: `Report generation limit reached (${rateLimit.limit} per day). Try again later.`,
        code: 'daily_limit_reached',
        params: { limit: rateLimit.limit },
      },
      { status: 429, headers: { 'Retry-After': '3600' } }
    );
  }

  // ── Stream with heartbeats ─────────────────────────────────────────
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
        if (existing) {
          await deleteTournamentReport(tournamentId, roundId, reportType);
        }

        const record = await createTournamentReport(tournamentId, roundId, reportType, getKaleModelId());
        let pipelineResult: Awaited<ReturnType<typeof runPipeline>> | null = null;

        try {
          // Run the Kale 2.0 pipeline with heartbeat callback
          pipelineResult = await runPipeline(
            reportType,
            { tournamentId, roundId, playerId: zodResult.data.player_id },
            emitHeartbeatIfNeeded
          );

          const validationErrorLog = pipelineResult.validationErrors.length > 0
            ? JSON.stringify(pipelineResult.validationErrors)
            : null;

          await updateTournamentReport(record.id, {
            content: pipelineResult.content,
            // The model that answered, not the one that was asked ('unknown' = no task finished).
            ...(pipelineResult.modelUsed && pipelineResult.modelUsed !== 'unknown' && { model_id: pipelineResult.modelUsed }),
            prompt_tokens: pipelineResult.promptTokens,
            completion_tokens: pipelineResult.completionTokens,
            generation_time_ms: pipelineResult.generationTimeMs,
            status: 'completed',
            error: validationErrorLog,
          });
        } catch (pipelineError) {
          pipelineResult = null;
          const errorMessage = pipelineError instanceof Error ? pipelineError.message : 'Unknown pipeline error';
          console.error('[ai/tournament-report] Pipeline error:', errorMessage);

          const failure = describeAiFailure(pipelineError, { code: FAILED_CODE, message: FAILED_MESSAGE });
          await updateTournamentReport(record.id, {
            status: 'failed',
            error: failure.stored,
            generation_time_ms: 0,
          });

          sse.send({ status: 'failed', error: failure.message, code: failure.code });
        }

        if (pipelineResult) {
          // The report is saved as completed. Nothing after this point (page revalidation, a
          // closed stream) may flip it to failed.
          try {
            await revalidateMatchPages(tournamentId);
          } catch (revalidateError) {
            console.error(
              '[ai/tournament-report] Revalidation failed after the report was stored:',
              revalidateError instanceof Error ? revalidateError.message : revalidateError,
            );
          }
          sse.send({ status: 'done', model: pipelineResult.modelUsed });
        }
      } catch (setupError) {
        const message = setupError instanceof Error ? setupError.message : 'Internal error';
        console.error('[ai/tournament-report] Setup error:', message);
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

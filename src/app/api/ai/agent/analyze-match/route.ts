import { NextResponse, type NextRequest } from 'next/server';
import { requirePlayer, getSession, isSuperadmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { agentAnalyzeMatchSchema, formatZodErrors } from '@/lib/validation';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { AI_ANALYSIS_STALE_MS } from '@/lib/ai/constants';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  getMatchAnalysis,
  createMatchAnalysis,
  updateMatchAnalysis,
  deleteMatchAnalysis,
} from '@/lib/supabase/queries/match-analyses';
import {
  getMatchPrepAnalysis,
  createMatchPrepAnalysis,
  updateMatchPrepAnalysis,
  deleteMatchPrepAnalysis,
} from '@/lib/supabase/queries/match-prep-analyses';
import { runAgent } from '@/lib/ai/agent/orchestrator';
import { gatherMatchContext, gatherMatchPrepContext } from '@/lib/ai/context-builder';
import { parseAnalysisResponse } from '@/lib/ai/parse-analysis';
import { parseScoutingResponse } from '@/lib/ai/parse-scouting';
import { revalidateMatchPages } from '@/lib/revalidation';
import { resolveContentLocale } from '@/i18n/content-locale';
import { getRequestLocale } from '@/i18n/server';
import {
  buildAnalyzeMatchMessage,
  buildPostMatchAnalysisMessage,
  buildScoutingAnalysisMessage,
} from '@/lib/ai/agent/prompts/linden';
import type { AgentRequest } from '@/lib/ai/agent/types';
import type { ApiResult } from '@/types/api';
import type { ApiErrorCode } from '@/i18n/messages/errors';

export const maxDuration = 300;

/** Statuses a post-match breakdown may run against (mirrors legacy match-analysis). */
const POST_MATCH_STATUSES = new Set(['pending_confirmation', 'completed']);
const HEARTBEAT_INTERVAL_MS = 5_000;
/** Code of the SSE `failed` frame (`errors/ai`). */
const FAILED_CODE: ApiErrorCode = 'ai_analysis_failed';
const FAILED_MESSAGE = 'Analysis failed — please try again later.';
/**
 * Code of the SSE `failed` frame when the stored-analysis read itself fails. It is
 * distinct from FAILED_CODE so a database read failure is never reported as a failed
 * generation, and never read as "no analysis yet" (AGENTS.md rule 5).
 */
const CACHE_READ_FAILED_CODE: ApiErrorCode = 'ai_analysis_cache_read_failed';
const CACHE_READ_FAILED_MESSAGE = 'Could not load the stored analysis — please try again later.';

/** One SSE `failed` frame: the English message plus its catalogued code. */
function failedFrame(error: string, code: ApiErrorCode): string {
  return `data: ${JSON.stringify({ status: 'failed', error, code })}\n\n`;
}
/** Informational model id stored on the analysis row (real model is router-chosen). */
const AGENT_MATCH_PREP_MODEL_ID = 'linden-match-prep-agent';

type LoadedMatch = NonNullable<Awaited<ReturnType<typeof getMatchById>>>;

/**
 * POST /api/ai/agent/analyze-match (PRD §7) — streamed, tool-driven match
 * analysis via the `linden_match_prep` agent persona.
 *
 * Authorization replicates the two legacy routes exactly:
 *   - `post_match` follows /api/ai/match-analysis — participant OR site admin,
 *     match must be pending_confirmation/completed.
 *   - `opponent_scout` / `threat_assessment` follow /api/ai/match-prep-analysis —
 *     participant OR superadmin only (regular admins must not see opponent prep),
 *     match must be scheduled.
 *
 * Unlike the legacy SSE routes we don't prompt-pack the replay data or persist a
 * structured row; we hand the agent a focused task message plus the match id in
 * context and let it pull history / H2H / usage / calcs through its own tools.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const rateLimit = await checkAndRecordAiGeneration(player.playerId, 'agent-chat');
    if (!rateLimit.allowed) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `AI agent limit reached (${rateLimit.limit} per day). Try again later.`,
          code: 'daily_limit_reached',
          params: { limit: rateLimit.limit },
        },
        { status: 429, headers: { 'Retry-After': '3600' } },
      );
    }

    const parsed = agentAnalyzeMatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const { match_id: matchId, analysis_type: analysisType } = parsed.data;

    const match = await getMatchById(matchId);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 },
      );
    }

    const isParticipant =
      player.playerId === match.player_1_id || player.playerId === match.player_2_id;

    // ── Per-flavour status + authorization (legacy parity) ────────────
    if (analysisType === 'post_match') {
      if (!POST_MATCH_STATUSES.has(match.status)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Match analysis is only available for completed matches (current: ${match.status})`,
            code: 'ai_analysis_completed_only',
            params: { status: match.status },
          },
          { status: 400 },
        );
      }
      // match-analysis rules: participants or site admins.
      if (!isParticipant && !player.isAdmin) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'Only match participants or admins can trigger analysis',
            code: 'ai_analysis_participants_only',
          },
          { status: 403 },
        );
      }
    } else {
      // opponent_scout / threat_assessment — scouting is scheduled-only.
      if (match.status !== 'scheduled') {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Scouting is only available for scheduled matches (current: ${match.status})`,
            code: 'ai_scouting_scheduled_only',
            params: { status: match.status },
          },
          { status: 400 },
        );
      }
      // match-prep rules: participants and superadmin only — regular admins
      // must not see opponent prep.
      const session = await getSession();
      if (!isParticipant && !isSuperadmin(session)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'Only match participants can trigger scouting',
            code: 'ai_scouting_participants_only',
          },
          { status: 403 },
        );
      }
    }

    // ── post_match: structured, persisted analysis. Supersedes the legacy
    //    /api/ai/match-analysis route — same JSON cards, same per-match cache,
    //    but generated by the agent (deterministic match context injected +
    //    optional tool enrichment) instead of a single Claude call. ─────────
    if (analysisType === 'post_match') {
      return runPostMatchAnalysis(player.playerId, match, parsed.data.force);
    }

    // ── opponent_scout: structured, per-player, persisted scouting report.
    //    Supersedes the legacy /api/ai/match-prep-analysis route — same JSON
    //    cards, same per-(match, player) cache — but generated by the agent
    //    (deterministic scouting context injected + optional tool enrichment). ──
    if (analysisType === 'opponent_scout') {
      return runOpponentScout(player.playerId, match, parsed.data.force);
    }

    // ── threat_assessment — the one remaining free-text flavour (no structured
    //    card consumes it). Streamed UI-message response. ──
    const isP1 = match.player_1_id === player.playerId;
    const selfName = isParticipant
      ? (isP1 ? match.player_1_name : match.player_2_name)
      : match.player_1_name;
    const opponentName = isParticipant
      ? (isP1 ? match.player_2_name : match.player_1_name)
      : match.player_2_name;

    const userMessage = buildAnalyzeMatchMessage(analysisType, {
      matchId,
      selfName,
      opponentName,
      player1Name: match.player_1_name,
      player2Name: match.player_2_name,
    });

    const agentRequest: AgentRequest = {
      userId: player.playerId,
      persona: 'linden_match_prep',
      messages: [{ role: 'user', content: userMessage }],
      // The context pack uses upcoming_match_id to load H2H vs this opponent;
      // for post_match it's a harmless hint the agent can still scope from.
      context: { upcoming_match_id: matchId },
      // Live free text for this viewer only (no shared report row): the
      // viewer's language (i18n-core §6.4).
      outputLocale: getRequestLocale(request),
    };

    const { result, getMetadata } = await runAgent(agentRequest);
    const conversationId = getMetadata().conversation_id;
    return result.toUIMessageStreamResponse(
      conversationId ? { headers: { 'X-Agent-Conversation-Id': conversationId } } : undefined,
    );
  } catch (err) {
    return safeErrorResponse(err, 'Agent match analysis failed');
  }
}

// ─── post_match: structured + persisted SSE flow ─────────────────────

/**
 * Generate and persist a structured post-match analysis via the agent, behind
 * an SSE + heartbeat envelope (keeps the Vercel function alive for up to 5min).
 * Mirrors the legacy `/api/ai/match-analysis` lifecycle exactly — idempotent
 * cache, stale-pending guard, `match_analyses` row — so the existing
 * `MatchAnalysisCard` reload-on-done flow renders the same structured cards.
 */
function runPostMatchAnalysis(playerId: string, match: LoadedMatch, force: boolean): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
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
      try {
        controller.enqueue(encoder.encode('data: {"status":"thinking"}\n\n'));
      } catch { /* stream closed */ }
      const fallbackHeartbeat = setInterval(emitHeartbeatIfNeeded, HEARTBEAT_INTERVAL_MS);

      try {
        // Idempotent unless forced: completed cache hit → reuse; recent pending
        // → don't start a duplicate; stale pending → mark failed and re-run.
        let existing: Awaited<ReturnType<typeof getMatchAnalysis>>;
        try {
          existing = await getMatchAnalysis(match.id);
        } catch (readError) {
          console.error('[ai/agent/analyze-match] post_match stored-analysis read failed:', readError);
          controller.enqueue(encoder.encode(failedFrame(CACHE_READ_FAILED_MESSAGE, CACHE_READ_FAILED_CODE)));
          return;
        }
        if (existing?.status === 'completed' && !force) {
          controller.enqueue(encoder.encode('data: {"status":"done"}\n\n'));
          return;
        }
        if (existing?.status === 'pending') {
          const age = Date.now() - new Date(existing.created_at).getTime();
          if (age > AI_ANALYSIS_STALE_MS) {
            await updateMatchAnalysis(existing.id, {
              status: 'failed',
              error: 'Analysis timed out',
              generation_time_ms: age,
            });
          } else if (!force) {
            controller.enqueue(encoder.encode('data: {"status":"already_pending"}\n\n'));
            return;
          }
        }

        if (existing) await deleteMatchAnalysis(match.id);
        const record = await createMatchAnalysis(match.id, AGENT_MATCH_PREP_MODEL_ID);
        const startTime = Date.now();

        try {
          // Deterministically gather the weather-aware context and inject it so
          // the agent is never blind; it may still enrich via its tools.
          const [{ context, gen }, outputLocale] = await Promise.all([
            gatherMatchContext(match.id),
            // A stored analysis follows the league's language (i18n-core §6.4).
            resolveContentLocale({ matchId: match.id }),
          ]);
          const userMessage = buildPostMatchAnalysisMessage({
            matchId: match.id,
            player1Name: match.player_1_name,
            player2Name: match.player_2_name,
            gen,
            matchContext: context,
          });

          const { result, getMetadata } = await runAgent({
            userId: playerId,
            persona: 'linden_match_prep',
            messages: [{ role: 'user', content: userMessage }],
            context: { upcoming_match_id: match.id },
            outputLocale,
          });

          const finalText = await result.text;
          const usage = getMetadata().usage;
          const analysis = parseAnalysisResponse(finalText);

          await updateMatchAnalysis(record.id, {
            analysis,
            prompt_tokens: usage?.input_tokens,
            completion_tokens: usage?.output_tokens,
            generation_time_ms: Date.now() - startTime,
            status: 'completed',
            error: null,
          });

          await revalidateMatchPages(match.tournament_id, match.id);
          controller.enqueue(encoder.encode('data: {"status":"done"}\n\n'));
        } catch (llmError) {
          const message = llmError instanceof Error ? llmError.message : 'Unknown error';
          console.error('[ai/agent/analyze-match] post_match error:', llmError);
          await updateMatchAnalysis(record.id, {
            status: 'failed',
            error: message,
            generation_time_ms: Date.now() - startTime,
          });
          controller.enqueue(encoder.encode(failedFrame(FAILED_MESSAGE, FAILED_CODE)));
        }
      } catch (setupError) {
        console.error('[ai/agent/analyze-match] post_match setup error:', setupError);
        controller.enqueue(encoder.encode(failedFrame(FAILED_MESSAGE, FAILED_CODE)));
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

// ─── opponent_scout: structured + persisted (per-player) SSE flow ─────

/**
 * Generate and persist a structured scouting report via the agent, behind an SSE
 * + heartbeat envelope. Mirrors the legacy `/api/ai/match-prep-analysis`
 * lifecycle exactly — per-(match, player) cache, stale-pending guard,
 * `match_prep_analyses` row, `has_user_team` flag — so the existing
 * `ScoutingReportCard` reload-on-done flow renders the same structured cards.
 *
 * Unlike post-match there is no replay of this (scheduled) match, so the agent
 * has no match-context tool to call; the deterministic opponent-scouting context
 * is injected and it enriches with its existing tools (getMatchHistory,
 * getUsageStats, calculateDamage, searchStrategyKnowledge).
 */
function runOpponentScout(playerId: string, match: LoadedMatch, force: boolean): Response {
  const encoder = new TextEncoder();

  const isP1 = match.player_1_id === playerId;
  const playerName = isP1 ? match.player_1_name : match.player_2_name;
  const opponentName = isP1 ? match.player_2_name : match.player_1_name;

  const stream = new ReadableStream({
    async start(controller) {
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
      try {
        controller.enqueue(encoder.encode('data: {"status":"thinking"}\n\n'));
      } catch { /* stream closed */ }
      const fallbackHeartbeat = setInterval(emitHeartbeatIfNeeded, HEARTBEAT_INTERVAL_MS);

      try {
        // Idempotent unless forced. Cache is per (match, player) — each
        // participant gets their own perspective-scoped report.
        let existing: Awaited<ReturnType<typeof getMatchPrepAnalysis>>;
        try {
          existing = await getMatchPrepAnalysis(match.id, playerId);
        } catch (readError) {
          console.error('[ai/agent/analyze-match] opponent_scout stored-report read failed:', readError);
          controller.enqueue(encoder.encode(failedFrame(CACHE_READ_FAILED_MESSAGE, CACHE_READ_FAILED_CODE)));
          return;
        }
        if (existing?.status === 'completed' && !force) {
          controller.enqueue(encoder.encode('data: {"status":"done"}\n\n'));
          return;
        }
        if (existing?.status === 'pending') {
          const age = Date.now() - new Date(existing.created_at).getTime();
          if (age > AI_ANALYSIS_STALE_MS) {
            await updateMatchPrepAnalysis(existing.id, {
              status: 'failed',
              error: 'Analysis timed out',
              generation_time_ms: age,
            });
          } else if (!force) {
            controller.enqueue(encoder.encode('data: {"status":"already_pending"}\n\n'));
            return;
          }
        }

        if (existing) await deleteMatchPrepAnalysis(match.id, playerId);

        // Gather the perspective-scoped scouting context up front: it sets
        // hasUserTeam (which schema branch to persist) and grounds the agent.
        const [{ context, gen, hasUserTeam }, outputLocale] = await Promise.all([
          gatherMatchPrepContext(match.id, playerId),
          // A stored report follows the league's language (i18n-core §6.4).
          resolveContentLocale({ matchId: match.id }),
        ]);
        const record = await createMatchPrepAnalysis(
          match.id,
          playerId,
          AGENT_MATCH_PREP_MODEL_ID,
          hasUserTeam,
        );
        const startTime = Date.now();

        try {
          const userMessage = buildScoutingAnalysisMessage({
            matchId: match.id,
            playerName,
            opponentName,
            gen,
            hasUserTeam,
            prepContext: context,
          });

          const { result, getMetadata } = await runAgent({
            userId: playerId,
            persona: 'linden_match_prep',
            messages: [{ role: 'user', content: userMessage }],
            context: { upcoming_match_id: match.id },
            outputLocale,
          });

          const finalText = await result.text;
          const usage = getMetadata().usage;
          const analysis = parseScoutingResponse(finalText, hasUserTeam);

          await updateMatchPrepAnalysis(record.id, {
            analysis,
            has_user_team: hasUserTeam,
            prompt_tokens: usage?.input_tokens,
            completion_tokens: usage?.output_tokens,
            generation_time_ms: Date.now() - startTime,
            status: 'completed',
            error: null,
          });

          controller.enqueue(encoder.encode('data: {"status":"done"}\n\n'));
        } catch (llmError) {
          const message = llmError instanceof Error ? llmError.message : 'Unknown error';
          console.error('[ai/agent/analyze-match] opponent_scout error:', llmError);
          await updateMatchPrepAnalysis(record.id, {
            status: 'failed',
            error: message,
            generation_time_ms: Date.now() - startTime,
          });
          controller.enqueue(encoder.encode(failedFrame(FAILED_MESSAGE, FAILED_CODE)));
        }
      } catch (setupError) {
        console.error('[ai/agent/analyze-match] opponent_scout setup error:', setupError);
        controller.enqueue(encoder.encode(failedFrame(FAILED_MESSAGE, FAILED_CODE)));
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

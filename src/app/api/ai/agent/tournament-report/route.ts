import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { agentTournamentReportSchema, formatZodErrors } from '@/lib/validation';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { runAgent } from '@/lib/ai/agent/orchestrator';
import { buildTournamentReportMessage } from '@/lib/ai/agent/prompts/kale';
import type { AgentRequest } from '@/lib/ai/agent/types';
import type { ApiResult } from '@/types/api';

export const maxDuration = 300;

/**
 * POST /api/ai/agent/tournament-report (PRD §8) — streamed, tool-driven
 * round recap / forecast via the `kale` agent persona.
 *
 * The legacy Kale 2.0 pipeline (`/api/ai/tournament-report`) stays untouched
 * (docs/deprecations.md); this is the AGENT path beside it. Reports are
 * admin-triggered, so authorization is `requireAdmin()` (not `requirePlayer()`).
 * Unlike the legacy route we don't persist a structured report row — we hand
 * Kale a focused task message plus the tournament/round identifiers and let it
 * pull standings / match results / upcoming fixtures / usage through its tools.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();

    const rateLimit = await checkAndRecordAiGeneration(admin.playerId, 'agent-chat');
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

    const parsed = agentTournamentReportSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const { tournament_id: tournamentId, round_id: roundId, report_type: reportType } = parsed.data;

    const [tournament, round] = await Promise.all([
      getTournamentById(tournamentId),
      getRoundById(roundId),
    ]);

    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 },
      );
    }
    if (!round) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round not found', code: 'round_not_found' },
        { status: 404 },
      );
    }

    const userMessage = buildTournamentReportMessage(reportType, {
      tournamentId,
      roundId,
      tournamentName: tournament.name,
      roundNumber: round.round_number,
    });

    const agentRequest: AgentRequest = {
      userId: admin.playerId,
      persona: 'kale',
      messages: [{ role: 'user', content: userMessage }],
    };

    const { result, getMetadata } = await runAgent(agentRequest);
    const conversationId = getMetadata().conversation_id;
    return result.toUIMessageStreamResponse(
      conversationId ? { headers: { 'X-Agent-Conversation-Id': conversationId } } : undefined,
    );
  } catch (err) {
    return safeErrorResponse(err, 'Agent tournament report failed');
  }
}

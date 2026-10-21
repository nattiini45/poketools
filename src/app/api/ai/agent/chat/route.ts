import { NextResponse, type NextRequest } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { agentChatSchema, formatZodErrors } from '@/lib/validation';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { runAgent } from '@/lib/ai/agent/orchestrator';
import type { AgentRequest } from '@/lib/ai/agent/types';
import type { ApiResult } from '@/types/api';
import { getRequestLocale } from '@/i18n/server';

export const maxDuration = 300;

/**
 * POST /api/ai/agent/chat (PRD §7) — streamed agent chat.
 *
 * `requirePlayer()` first, then the per-player daily rate limit, then Zod
 * validation, then `runAgent()`. The streamed AI-SDK UI message response is
 * returned directly; all errors funnel through `safeErrorResponse()`.
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

    const parsed = agentChatSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const agentRequest: AgentRequest = {
      userId: player.playerId,
      persona: body.persona,
      messages: body.messages,
      conversationId: body.conversation_id,
      context: body.context,
      // Live chat follows the viewer's language (i18n-core §6.4); Kale stays English.
      outputLocale: getRequestLocale(request),
    };

    const { result, getMetadata } = await runAgent(agentRequest);
    // Surface the conversation id so multi-turn clients can resend it as
    // `conversation_id` and continue the SAME row instead of forking a new one.
    const conversationId = getMetadata().conversation_id;
    return result.toUIMessageStreamResponse(
      conversationId ? { headers: { 'X-Agent-Conversation-Id': conversationId } } : undefined,
    );
  } catch (err) {
    return safeErrorResponse(err, 'Agent chat failed');
  }
}

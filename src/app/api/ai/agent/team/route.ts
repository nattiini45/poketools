import { NextResponse, type NextRequest } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { agentTeamSchema, formatZodErrors } from '@/lib/validation';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { executeTool } from '@/lib/ai/agent/tools/execute';
import type { ApiResult } from '@/types/api';

export const maxDuration = 300;

/**
 * POST /api/ai/agent/team (PRD §7) — one-shot team build.
 *
 * Calls the deterministic `buildTeam` meta-tool directly via `executeTool`
 * (no LLM) and returns the structured team + pokepaste link + coverage.
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

    const parsed = agentTeamSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const result = await executeTool('buildTeam', parsed.data);
    if (!result.ok) {
      // Surface server-side, return the static fallback to the client.
      throw new Error(`buildTeam failed: ${result.error}`);
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (err) {
    return safeErrorResponse(err, 'Agent team build failed');
  }
}

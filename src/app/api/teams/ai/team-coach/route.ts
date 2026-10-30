import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { complete } from '@/lib/ai/client';
import { AI_MAX_TOKENS } from '@/lib/ai/constants';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { teamCoachSchema, formatZodErrors } from '@/lib/validation';
import { withOutputLanguage } from '@/lib/ai/language';
import { buildTeamCoachSystemPrompt, buildTeamCoachUserPrompt } from '@/lib/ai/coach-prompts';
import { getRequestLocale } from '@/i18n/server';
import { parseFormatId } from '@/lib/pkmn/format-id';
import type { ApiResult } from '@/types/api';

/**
 * POST /api/teams/ai/team-coach
 * Body: { team: PokemonSet[], format: string, generation: number }
 * Returns holistic AI coaching for the entire team.
 */
export async function POST(req: NextRequest) {
  try {
    const player = await requirePlayer();

    const rawBody = await req.json();
    const zodResult = teamCoachSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }
    const { team, format, generation } = zodResult.data;

    if (parseFormatId(format) === null) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid format', code: 'ai_coach_format_invalid' },
        { status: 400 },
      );
    }

    const filledTeam = team.filter((t) => t.species);
    if (filledTeam.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'At least one Pokémon is required', code: 'ai_coach_team_empty' },
        { status: 400 },
      );
    }

    const rl = await checkAndRecordAiGeneration(player.playerId, 'team-coach');
    if (!rl.allowed) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `AI rate limit reached (${rl.used}/${rl.limit} today)`,
          code: 'daily_limit_reached',
          params: { limit: rl.limit, used: rl.used },
        },
        { status: 429 }
      );
    }

    // Live coaching follows the viewer's language (i18n-core §6.4).
    const systemPrompt = withOutputLanguage(buildTeamCoachSystemPrompt(), getRequestLocale(req));
    const userPrompt = buildTeamCoachUserPrompt(filledTeam, format, generation);

    const result = await complete(systemPrompt, userPrompt, { surface: 'team-coach', maxTokens: AI_MAX_TOKENS.coach });
    return NextResponse.json({ success: true, content: result.content });
  } catch (error) {
    return safeErrorResponse(error, 'AI team coach failed');
  }
}

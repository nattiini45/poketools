import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { slotCoachSetsSchema, formatZodErrors } from '@/lib/validation';
import { complete } from '@/lib/ai/client';
import { AI_MAX_TOKENS } from '@/lib/ai/constants';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { withOutputLanguage } from '@/lib/ai/language';
import { buildSlotCoachSystemPrompt, buildSlotCoachUserPrompt } from '@/lib/ai/coach-prompts';
import { getRequestLocale } from '@/i18n/server';
import { parseFormatId } from '@/lib/pkmn/format-id';
import type { ApiResult } from '@/types/api';

/**
 * POST /api/teams/ai/slot-coach
 * Body: { set: PokemonSet, team: PokemonSet[], format: string, generation: number }
 * Returns AI coaching suggestions for a single team slot.
 */
export async function POST(req: NextRequest) {
  try {
    const player = await requirePlayer();

    const body: unknown = await req.json();
    const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const { format, generation } = input;

    if (!format || typeof format !== 'string' || parseFormatId(format) === null) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid format', code: 'ai_coach_format_invalid' },
        { status: 400 },
      );
    }
    if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 1 || generation > 9) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid generation', code: 'ai_coach_generation_invalid' },
        { status: 400 },
      );
    }

    const rawSet = input.set as { species?: unknown } | null | undefined;
    if (typeof rawSet?.species !== 'string' || !rawSet.species) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'A Pokémon set with species is required', code: 'ai_coach_species_required' },
        { status: 400 },
      );
    }

    // Structure and size of the sets, checked before a daily generation is charged: a malformed
    // request must not burn a slot (or throw on a null teammate inside the prompt builder).
    const zodResult = slotCoachSetsSchema.safeParse({ set: input.set, team: input.team });
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }
    const { set, team } = zodResult.data;

    const rl = await checkAndRecordAiGeneration(player.playerId, 'slot-coach');
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
    const systemPrompt = withOutputLanguage(buildSlotCoachSystemPrompt(), getRequestLocale(req));
    const userPrompt = buildSlotCoachUserPrompt(set, team, format, generation);

    const result = await complete(systemPrompt, userPrompt, { surface: 'slot-coach', maxTokens: AI_MAX_TOKENS.coach });
    return NextResponse.json({ success: true, content: result.content });
  } catch (error) {
    return safeErrorResponse(error, 'AI slot coach failed');
  }
}

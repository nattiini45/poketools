import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { slotCoachSetsSchema, formatZodErrors, type CoachPokemonSet } from '@/lib/validation';
import { complete } from '@/lib/ai/client';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { withOutputLanguage } from '@/lib/ai/language';
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

    const result = await complete(systemPrompt, userPrompt, { surface: 'slot-coach' });
    return NextResponse.json({ success: true, content: result.content });
  } catch (error) {
    return safeErrorResponse(error, 'AI slot coach failed');
  }
}

function buildSlotCoachSystemPrompt(): string {
  return `You are an expert competitive Pokémon team builder coach. You analyze individual team slots (Pokémon sets) and provide concise, actionable feedback.

Rules:
- Be specific — reference actual moves, items, abilities, and EV spreads
- Focus on synergy with the rest of the team
- Keep responses SHORT (3-5 bullet points max)
- Use competitive Pokémon terminology correctly
- If the set looks good, say so briefly and suggest minor optimizations
- Never suggest illegal combinations (wrong abilities, incompatible moves, etc.)
- Reference the format when relevant (e.g. common threats in that tier)`;
}

function buildSlotCoachUserPrompt(
  set: CoachPokemonSet,
  team: CoachPokemonSet[],
  format: string,
  generation: number,
): string {
  const teammates = team
    .filter((t) => t.species && t.species !== set.species)
    .map((t) => `${t.species} (${t.item || 'No Item'}, ${t.ability || '?'})`)
    .join(', ') || 'None yet';

  const evSummary = Object.entries(set.evs ?? {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(' / ');

  return `Analyze this team slot in ${format.toUpperCase()} (Gen ${generation}):

**${set.species}** ${set.name ? `(${set.name})` : ''}
- Item: ${set.item || 'None'}
- Ability: ${set.ability || 'None'}
- Nature: ${set.nature || 'None'}
- EVs: ${evSummary || 'None'}
${set.tera_type ? `- Tera Type: ${set.tera_type}` : ''}
- Moves: ${(set.moves ?? []).filter(Boolean).join(', ') || 'None'}

Teammates: ${teammates}

Provide 3-5 specific suggestions for improving this set. Focus on:
1. Move coverage and synergy
2. EV optimization
3. Item/ability choices
4. Role on the team`;
}

import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { complete } from '@/lib/ai/client';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { teamCoachSchema, formatZodErrors } from '@/lib/validation';
import { withOutputLanguage } from '@/lib/ai/language';
import { getRequestLocale } from '@/i18n/server';
import { parseFormatId } from '@/lib/pkmn/format-id';
import type { ApiResult } from '@/types/api';
import type { PokemonSet } from '@/types/team';

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

    const filledTeam = (team as PokemonSet[]).filter((t: PokemonSet) => t.species);
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

    const result = await complete(systemPrompt, userPrompt);
    return NextResponse.json({ success: true, content: result.content });
  } catch (error) {
    return safeErrorResponse(error, 'AI team coach failed');
  }
}

function buildTeamCoachSystemPrompt(): string {
  return `You are an expert competitive Pokémon team builder coach. You analyze entire teams and provide holistic feedback on team structure, synergy, and strategy.

Rules:
- Assess overall team archetype and strategy coherence
- Identify type synergies and defensive cores
- Evaluate role distribution (win con, wallbreaker, pivot, check, etc.)
- Identify shared weaknesses to common threats
- Suggest specific improvements with named Pokémon/moves/items
- Keep responses focused (5-8 bullet points)
- Use competitive Pokémon terminology correctly
- Reference the format's metagame when relevant
- Rate overall team quality at the end (S/A/B/C/D/F tier)`;
}

function buildTeamCoachUserPrompt(
  team: PokemonSet[],
  format: string,
  generation: number,
): string {
  const setLines = team.map((set) => {
    const moves = (set.moves ?? []).filter(Boolean).join(', ') || 'None';
    const evSummary = Object.entries(set.evs ?? {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join('/');
    return `• ${set.species}${set.name ? ` (${set.name})` : ''} @ ${set.item || 'None'} | ${set.ability || '?'} | ${set.nature || '?'} | ${evSummary || 'No EVs'} | Moves: ${moves}${set.tera_type ? ` | Tera: ${set.tera_type}` : ''}`;
  });

  return `Analyze this team in ${format.toUpperCase()} (Gen ${generation}):

${setLines.join('\n')}

Provide a holistic team analysis covering:
1. Team archetype and strategy
2. Offensive synergy and coverage
3. Defensive cores and type balance
4. Shared weaknesses and threats
5. Role distribution assessment
6. Specific improvement suggestions
7. Overall tier rating (S/A/B/C/D/F)`;
}

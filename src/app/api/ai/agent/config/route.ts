import { NextResponse, type NextRequest } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { agentConfigSchema, formatZodErrors } from '@/lib/validation';
import { getOrCreateProfile, updateProfileConfig } from '@/lib/ai/agent/memory';
import { AGENT_MODELS } from '@/lib/ai/agent/provider';
import type { ApiResult } from '@/types/api';

export const maxDuration = 300;

/**
 * GET /api/ai/agent/config (PRD §7) — the player's model priority + default
 * persona, creating a default profile row on first use.
 */
export async function GET() {
  try {
    const player = await requirePlayer();
    const profile = await getOrCreateProfile(player.playerId);
    return NextResponse.json({
      success: true,
      data: {
        model_priority: profile.model_priority,
        default_persona: profile.default_persona,
        // The full registry (id + tier) so the settings UI can render the
        // ordered list without duplicating the model catalogue client-side.
        available_models: AGENT_MODELS.map((m) => ({ id: m.id, tier: m.tier })),
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load agent config');
  }
}

/**
 * POST /api/ai/agent/config (PRD §7) — update model priority and/or default
 * persona. Every `model_priority` id is validated against the known
 * `AGENT_MODELS` registry; the persona enum is validated by the schema.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();

    const parsed = agentConfigSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const body = parsed.data;

    if (body.model_priority) {
      const known = new Set(AGENT_MODELS.map((m) => m.id));
      const unrecognised = body.model_priority.filter((id) => !known.has(id));
      if (unrecognised.length > 0) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: `Unknown model id(s): ${unrecognised.join(', ')}`,
            code: 'ai_model_ids_unknown',
            params: { ids: unrecognised.join(', ') },
          },
          { status: 400 },
        );
      }
    }

    // Ensure a row exists, then apply the patch.
    await getOrCreateProfile(player.playerId);
    const profile = await updateProfileConfig(player.playerId, {
      model_priority: body.model_priority,
      default_persona: body.default_persona,
    });

    return NextResponse.json({
      success: true,
      data: {
        model_priority: profile.model_priority,
        default_persona: profile.default_persona,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update agent config');
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { formatZodErrors, matchResetSchema } from '@/lib/validation';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { ResetMatchResult } from '@/types/game';
import { authorizeCorrectionTarget, correctionAuditTarget, nativeCorrectionServices, revalidateCorrectionTarget } from './correction-target';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/admin/matches/[id]/reset — reset a match to scheduled */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await authorizeCorrectionTarget(params);
    if (!access.ok) return access.response;
    const { player, target } = access;
    const { id, match } = target;

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = matchResetSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const cascade = parsed.data.cascade === true;
    const result = target.kind === 'phase'
      ? await (await nativeCorrectionServices(target.owner)).resetMatch(id, player.playerId, cascade)
      : await resetMatch(id, player.playerId, cascade);

    await revalidateCorrectionTarget(target);

    const audit = correctionAuditTarget(target);
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.reset',
      resource_type: audit.resourceType,
      resource_id: id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: {
        status: { before: match.status, after: 'scheduled' },
        winner_id: { before: match.winner_id, after: null },
        submitter_id: { before: match.submitter_id, after: null },
      },
      metadata: {
        ...audit.metadata,
        games_deleted: result.games_deleted,
        has_downstream_matches: result.has_downstream_matches,
        cascade,
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        // Itemized recalculation summary (spec §24) — surfaces the derived
        // records that were recalculated so the audit log records what was
        // rebuilt, not just that a reset happened. All fields are best-effort:
        // legacy seasons omit the EPB evolution detail.
        recalculation: result.recalculation
          ? {
              gamesDeleted: result.recalculation.gamesDeleted,
              childrenCleanup: result.recalculation.childrenCleanup,
              ratingsRebuiltPlayers: result.recalculation.ratingsRebuilt?.players.length ?? 0,
              evolutionRepaired: result.recalculation.evolutionRepaired
                ? {
                    trackersUpdated: result.recalculation.evolutionRepaired.trackersUpdated,
                    eventsRewritten: result.recalculation.evolutionRepaired.eventsRewritten,
                    evolutionPoints: result.recalculation.evolutionRepaired.evolutionPoints,
                    impossibleLineups: result.recalculation.evolutionRepaired.impossibleLineups.length,
                  }
                : undefined,
              impossibleLineups: result.recalculation.impossibleLineups.length,
            }
          : undefined,
      },
    });

    return NextResponse.json<ApiResult<ResetMatchResult>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to reset match');
  }
}

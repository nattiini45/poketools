import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { cascadeActionSchema, formatZodErrors } from '@/lib/validation';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { ResetMatchResult } from '@/types/game';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/admin/matches/[id]/reset — reset a match to scheduled */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_MATCH_ID');
    if (invalidId) return invalidId;

    const match = await getMatchById(id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    // Require site admin or tournament resource admin
    const hasAdminAccess = player.isAdmin ||
      await isResourceAdminFor(player.playerId, 'tournament', match.tournament_id);

    if (!hasAdminAccess) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Admin access required', code: 'forbidden' },
        { status: 403 }
      );
    }

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = cascadeActionSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = await resetMatch(id, player.playerId, parsed.data.cascade === true);

    await revalidateMatchPages(match.tournament_id, id);

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'match.reset',
      resource_type: 'match',
      resource_id: id,
      resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
      changes: {
        status: { before: match.status, after: 'scheduled' },
        winner_id: { before: match.winner_id, after: null },
        submitter_id: { before: match.submitter_id, after: null },
      },
      metadata: {
        tournament_id: match.tournament_id,
        games_deleted: result.games_deleted,
        has_downstream_matches: result.has_downstream_matches,
        cascade: parsed.data.cascade === true,
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

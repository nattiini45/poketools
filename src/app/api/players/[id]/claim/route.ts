import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { playerClaimSchema, formatZodErrors } from '@/lib/validation';
import {
  claimGuestPlayer,
  getPlayerActivityCounts,
  getPlayerById,
} from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { leagueTrashBlockOf } from '@/lib/league-trash/db-error';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/players/[id]/claim
 *
 * Transfer discord_id/auth_user_id from a fresh empty account onto a guest row.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: guestId } = await params;
    const admin = await requireAdmin();
    const invalidGuestId = rejectInvalidPathId(guestId, 'INVALID_PLAYER_ID');
    if (invalidGuestId) return invalidGuestId;

    const rawBody = await request.json().catch(() => null);
    const zodResult = playerClaimSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const { source_player_id: sourcePlayerId } = zodResult.data;

    if (guestId === sourcePlayerId) {
      throw new UserFacingError('Guest and source account must be different players', {
        code: 'claim_same_player',
      });
    }

    const [guest, source] = await Promise.all([
      getPlayerById(guestId),
      getPlayerById(sourcePlayerId),
    ]);

    if (!guest?.is_guest) {
      throw new UserFacingError('Target player is not a guest account', {
        code: 'NOT_GUEST',
      });
    }
    if (!source) {
      throw new UserFacingError('Source player not found', { code: 'SOURCE_NOT_FOUND' });
    }
    if (source.is_guest) {
      throw new UserFacingError('Source player must be a registered account', {
        code: 'SOURCE_IS_GUEST',
      });
    }
    // A banned or suspended source would hand its identity to an 'active' guest row
    // and lose its sanction with the deleted row. The RPC re-checks (55000).
    if (source.status !== 'active') {
      throw new UserFacingError('Source account is banned or suspended', {
        code: 'SOURCE_NOT_ACTIVE',
        status: 409,
      });
    }

    const activity = await getPlayerActivityCounts(sourcePlayerId);
    const hasActivity =
      activity.seasonParticipations > 0 ||
      activity.tournamentParticipations > 0 ||
      activity.matchCount > 0 ||
      activity.teamCount > 0 ||
      activity.matchProposals > 0 ||
      activity.draftPicks > 0 ||
      activity.wikiNotes > 0 ||
      activity.evolutionTrackerRows > 0;

    if (hasActivity) {
      throw new UserFacingError(
        'Source account has existing activity — use substitute instead',
        { code: 'SOURCE_HAS_ACTIVITY', status: 409 },
      );
    }

    let claimed: Player;
    try {
      claimed = await claimGuestPlayer(guestId, sourcePlayerId);
    } catch (err) {
      // The claim deletes the source row. Anything the activity pre-check does not count
      // raises 23503 and the RPC rolls the whole claim back, leaving both rows unchanged:
      // a NO ACTION reference (league history, rating opponents, ...) blocks the delete
      // itself, and the RPC refuses up front while a CASCADE / SET NULL reference still
      // holds source rows (presets, cast sessions, AI generations, achievements, ...)
      // that the delete would otherwise silently destroy.
      if ((err as { code?: string } | null)?.code === '23503') {
        // A league in the recycle bin that the source appears in blocks the delete through its junction table; the
        // answer is the same (the source has activity), the log says which kind of reference it was.
        const inTrashedLeague = leagueTrashBlockOf(err) === 'player';
        console.error(
          inTrashedLeague
            ? '[players] guest claim blocked: the source account appears in a league in the trash:'
            : '[players] guest claim blocked by a reference to the source account:',
          err,
        );
        throw new UserFacingError(
          'Source account has existing activity — use substitute instead',
          { code: 'SOURCE_HAS_ACTIVITY', status: 409 },
        );
      }
      // The source was banned or suspended between the pre-check and the locked re-check.
      if ((err as { code?: string } | null)?.code === '55000') {
        console.error('[players] guest claim refused: source account not in good standing:', err);
        throw new UserFacingError('Source account is banned or suspended', {
          code: 'SOURCE_NOT_ACTIVE',
          status: 409,
        });
      }
      throw err;
    }

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'player.claim',
      resource_type: 'player',
      resource_id: guestId,
      resource_name: guest.name,
      changes: {
        is_guest: { before: true, after: false },
        discord_id: { before: guest.discord_id, after: claimed.discord_id },
        auth_user_id: { before: guest.auth_user_id, after: claimed.auth_user_id },
      },
      metadata: {
        source_player_id: sourcePlayerId,
        source_player_name: source.name,
      },
    });

    return NextResponse.json<ApiResult<Player>>({ success: true, data: claimed });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to link guest account');
  }
}

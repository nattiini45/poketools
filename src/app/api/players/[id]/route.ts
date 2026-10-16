import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, isSuperadmin } from '@/lib/auth/helpers';
import { supabase } from '@/lib/supabase/client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { playerUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  getPlayerById,
  updatePlayer,
  deletePlayer,
  getPlayerCompetitiveRefs,
} from '@/lib/supabase/queries/players';
import { logAuditEvent, diffField } from '@/lib/audit/log';
import { toPublicPlayer } from '@/lib/players/public-player';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { Player, PublicPlayer } from '@/types/player';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Expire the public read-cache entries that show this player's card (name,
 * usernames, creator badge): every read that embeds a player carries
 * `publicTags.players`, and the profile also carries `publicTags.player(id)`.
 * Without this a rename shows only after the TTL, and after an idle spell
 * only on the second view.
 */
function expirePlayerReads(playerId: string): void {
  expirePublicTags([publicTags.players, publicTags.player(playerId)]);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const player = await getPlayerById(id);

    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }

    // Admins and self see the full player object (decided from the live
    // player requireAuth returns); everyone else gets the PublicPlayer card,
    // an allowlist with no identity, moderation or admin columns.
    const isSelf = session.player?.playerId === id;
    const isAdminUser = session.player?.isAdmin === true;
    if (isSelf || isAdminUser) {
      return NextResponse.json<ApiResult<Player>>({ success: true, data: player });
    }

    return NextResponse.json<ApiResult<PublicPlayer>>({ success: true, data: toPublicPlayer(player) });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch player');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const rawBody = await request.json();
    const zodResult = playerUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;

    // Non-admins can only update their own ps_username and champions_username
    const isOwnProfile = session.player?.playerId === id;
    const isAdminUser = session.player?.isAdmin === true;

    if (!isOwnProfile && !isAdminUser) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized to update this player', code: 'player_update_forbidden' },
        { status: 403 }
      );
    }

    // Non-admins can only change their own usernames
    if (!isAdminUser) {
      const allowedUpdate: Record<string, unknown> = {};
      if (body.ps_username !== undefined) allowedUpdate.ps_username = body.ps_username;
      if (body.champions_username !== undefined) allowedUpdate.champions_username = body.champions_username;
      const player = await updatePlayer(id, allowedUpdate);
      expirePlayerReads(id);
      return NextResponse.json<ApiResult<Player>>({ success: true, data: player });
    }

    // Only SUPERADMIN can change is_creator
    if (body.is_creator !== undefined && !isSuperadmin(session)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Only the superadmin can manage creator status', code: 'creator_status_superadmin_only' },
        { status: 403 }
      );
    }

    // Get the player before update for diffing
    const before = await getPlayerById(id);
    const player = await updatePlayer(id, body);
    expirePlayerReads(id);

    // Audit log for admin mutations (role changes, etc.)
    if (before && isAdminUser && session.player) {
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      diffField(changes, 'is_admin', before.is_admin, body.is_admin ?? before.is_admin);
      diffField(changes, 'is_creator', before.is_creator, body.is_creator ?? before.is_creator);

      if (Object.keys(changes).length > 0) {
        logAuditEvent({
          actor_id: session.player.playerId,
          actor_name: session.player.name,
          action: 'player.update',
          resource_type: 'player',
          resource_id: id,
          resource_name: player.name,
          changes,
        });
      }
    }

    return NextResponse.json<ApiResult<Player>>({ success: true, data: player });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update player');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();

    // Fetch before deletion for audit log
    const before = await getPlayerById(id);

    if (!before) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }

    // Block hard-deleting competitors: matches.player_1/2_id and match_proposals
    // refs are NOT NULL, so they cannot be nulled out, and cascading them would
    // destroy opponents' tournament history. Direct admins to suspend/ban instead.
    const refs = await getPlayerCompetitiveRefs(id);
    if (refs.matches > 0 || refs.proposals > 0) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Cannot delete a player with match history (${refs.matches} ${refs.matches === 1 ? 'match' : 'matches'}). Suspend or ban them instead.`,
          code: 'player_has_match_history',
          params: { count: refs.matches },
        },
        { status: 409 }
      );
    }

    // EvoLiga / EPB history (redrafts, trades, evolution events, token grants,
    // snapshots, rating opponents) references players with ON DELETE NO ACTION
    // as well; refuse up front with the coded 409 rather than letting the
    // DELETE fail on the foreign key.
    if (refs.leagueHistory > 0) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Cannot delete this player because other records still reference them.',
          code: 'player_still_referenced',
        },
        { status: 409 }
      );
    }

    // A player seated in an unfinished queue draft (design decision):
    // the seat rows would cascade away mid-draft and break the draft order.
    if (refs.activeDrafts > 0) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error:
            'Cannot delete a player who is seated in an unfinished draft. Finish or cancel the draft, or remove the player from it, first.',
          code: 'player_in_active_draft',
        },
        { status: 409 }
      );
    }

    await deletePlayer(id);
    expirePlayerReads(id);

    // Cascade: remove the linked Supabase Auth user so no orphaned login
    // remains (no FK exists — see the email_password_auth migration).
    if (before.auth_user_id) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(before.auth_user_id);
      if (authDeleteError) {
        console.error('[players] failed to delete linked auth user:', authDeleteError.message);
      }
    }

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    diffField(changes, 'name', before.name, '[deleted]');
    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'player.delete',
      resource_type: 'player',
      resource_id: id,
      resource_name: before.name,
      changes,
    });

    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    // Residual FK violation (a NOT NULL ref we intentionally leave blocking, or
    // a row added after the pre-check). Map to a clear 409 instead of an opaque 500.
    if ((err as { code?: string })?.code === '23503') {
      console.error('[players] delete blocked by residual FK reference:', err);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cannot delete this player because other records still reference them.', code: 'player_still_referenced' },
        { status: 409 }
      );
    }
    return safeErrorResponse(err, 'Failed to delete player');
  }
}
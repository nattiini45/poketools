import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { draftErrorResponse } from '@/lib/draft/http';
import { expireDraftReads, expireSeasonReads } from '@/lib/revalidation';
import { getSeasonGroups, placeSeasonGroupMember } from '@/lib/supabase/queries/season-groups';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { seasonGroupMemberSchema } from '../_lib/schemas';
import { loadEditorDTO } from '../_lib/load';
import type { ApiResult } from '@/types/api';
import type { LeagueGroupsEditorDTO } from '@/types/league-groups-editor';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/seasons/[id]/groups/members — place a trainer in a league group (league admin only): a move from
 * another group, or the first placement of a participant added after the groups were made. Body
 * `{ player_id, group_id }`. The membership guard refuses it once a phase of the league has a round (409
 * SEASON_GROUPS_SCHEDULED), while the old or the new group has a live (not cancelled) draft pool or the trainer holds
 * lines of the old group (409 SEASON_GROUP_LOCKED), and when it would leave the old group with fewer than two
 * trainers (422 SEASON_GROUP_TOO_SMALL). 422 SEASON_GROUP_PLAYER_NOT_FOUND for a trainer outside the roster, 404
 * SEASON_GROUP_NOT_FOUND for a group of another league. Audited (`season.group.member.place`). Answers the editor's
 * fresh DTO.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const admin = await requireResourceAdmin('season', id);

    const body = seasonGroupMemberSchema.parse(await request.json());
    const [groups, roster] = await Promise.all([getSeasonGroups(id), getSeasonParticipants(id)]);
    const target = groups.find((g) => g.id === body.group_id);
    if (!target) {
      throw new UserFacingError('Group not found in this league', { code: 'SEASON_GROUP_NOT_FOUND', status: 404 });
    }
    if (!roster.some((p) => p.id === body.player_id)) {
      throw new UserFacingError('This trainer is not a participant of this league', {
        code: 'SEASON_GROUP_PLAYER_NOT_FOUND',
        status: 422,
      });
    }
    const from = groups.find((g) => g.player_ids.includes(body.player_id)) ?? null;
    let stages: { id: string }[] | undefined;
    if (from?.id !== target.id) {
      await placeSeasonGroupMember(id, body.player_id, target.id);
      stages = await getStagesBySeasonId(id);
      expireSeasonReads(id, stages.map((s) => s.id));
      expireDraftReads(id);
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'season.group.member.place',
        resource_type: 'season',
        resource_id: id,
        changes: { season_group_id: { before: from?.id ?? null, after: target.id } },
        metadata: { player_id: body.player_id },
      });
    }

    const dto = await loadEditorDTO(id, stages);
    return NextResponse.json<ApiResult<LeagueGroupsEditorDTO>>({ success: true, data: dto });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to place the trainer in a league group');
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { draftErrorResponse } from '@/lib/draft/http';
import { expireDraftReads, expireSeasonReads } from '@/lib/revalidation';
import {
  SeasonGroupNameTakenError,
  getSeasonGroups,
  renameSeasonGroup,
} from '@/lib/supabase/queries/season-groups';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { seasonGroupRenameSchema } from '../_lib/schemas';
import type { ApiResult } from '@/types/api';
import type { SeasonGroup } from '@/types/season-group';

interface RouteParams {
  params: Promise<{ id: string; groupId: string }>;
}

/**
 * PATCH /api/seasons/[id]/groups/[groupId] — rename one league group (league admin only). Body `{ name }`
 * (1..60 characters, trimmed). Allowed at any time, also while the group drafts: a name changes no seat, pool or
 * line. 404 SEASON_GROUP_NOT_FOUND for a group of another league; 409 SEASON_GROUP_NAME_TAKEN for a name another
 * group of the league has. Audited (`season.group.rename`).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, groupId } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidGroupId = rejectInvalidPathId(groupId, 'INVALID_GROUP_ID');
    if (invalidGroupId) return invalidGroupId;
    const admin = await requireResourceAdmin('season', id);

    const { name } = seasonGroupRenameSchema.parse(await request.json());
    const before = (await getSeasonGroups(id)).find((g) => g.id === groupId);
    let renamed: SeasonGroup | null;
    try {
      renamed = before ? await renameSeasonGroup(id, groupId, name) : null;
    } catch (err) {
      if (!(err instanceof SeasonGroupNameTakenError)) throw err;
      // The query module logged the database error; the cause stays distinct here (its own code).
      throw new UserFacingError('Another group of this league already has this name', {
        code: 'SEASON_GROUP_NAME_TAKEN',
        status: 409,
      });
    }
    if (!before || !renamed) {
      throw new UserFacingError('Group not found in this league', { code: 'SEASON_GROUP_NOT_FOUND', status: 404 });
    }

    const stages = await getStagesBySeasonId(id);
    expireSeasonReads(id, stages.map((s) => s.id));
    expireDraftReads(id);
    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'season.group.rename',
      resource_type: 'season',
      resource_id: id,
      resource_name: renamed.name,
      changes: { name: { before: before.name, after: renamed.name } },
      metadata: { season_group_id: groupId },
    });
    return NextResponse.json<ApiResult<SeasonGroup>>({ success: true, data: renamed });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to rename the league group');
  }
}

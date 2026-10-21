import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { logAuditEvent } from '@/lib/audit/log';
import { draftErrorResponse } from '@/lib/draft/http';
import { expireDraftReads, expireSeasonReads } from '@/lib/revalidation';
import { getSeasonGroups, replaceSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { seasonGroupsReplaceSchema } from './_lib/schemas';
import { plannedGroups } from './_lib/plan';
import { loadEditorDTO, loadLeagueSeedOrder } from './_lib/load';
import type { ApiResult } from '@/types/api';
import type { LeagueGroupsEditorDTO } from '@/types/league-groups-editor';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/seasons/[id]/groups — the league groups editor's data (league admin only): the groups with their
 * members and lock state, whether a phase already has a round (`scheduleLocked`), and the roster in seed order
 * (`LeagueGroupsEditorDTO`; names and seeds only).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    await requireResourceAdmin('season', id);
    const dto = await loadEditorDTO(id);
    return NextResponse.json<ApiResult<LeagueGroupsEditorDTO>>({ success: true, data: dto });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to fetch league groups');
  }
}

/**
 * PUT /api/seasons/[id]/groups — create, re-create or clear a league's groups (league admin only).
 * Body (`seasonGroupsReplaceSchema`): `{ mode: 'serpentine', group_count }`, `{ mode: 'manual', groups }` or
 * `{ mode: 'clear' }`. One transaction (`season_groups_replace`); refused once a phase of the league has a round
 * (SEASON_GROUPS_SCHEDULED), while the league has a live draft pool or drafted lines (SEASON_GROUP_LOCKED), when a
 * group would hold fewer than two trainers (SEASON_GROUP_TOO_SMALL) or a participant would be in no group, and when a
 * group to remove is still used (SEASON_GROUP_IN_USE). Audited (`season.groups.replace`). Answers the editor's
 * fresh DTO (with `scheduleLocked`).
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const admin = await requireResourceAdmin('season', id);

    const body = seasonGroupsReplaceSchema.parse(await request.json());
    const [existing, stages] = await Promise.all([getSeasonGroups(id), getStagesBySeasonId(id)]);
    const participants = await loadLeagueSeedOrder(id, stages);
    const planned = plannedGroups(body, participants, existing);
    const saved = await replaceSeasonGroups(id, planned);

    expireSeasonReads(id, stages.map((s) => s.id));
    expireDraftReads(id);
    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'season.groups.replace',
      resource_type: 'season',
      resource_id: id,
      changes: {
        groups: {
          before: existing.map((g) => ({ id: g.id, name: g.name, player_ids: g.player_ids })),
          after: saved.map((g) => ({ id: g.id, name: g.name, player_ids: g.player_ids })),
        },
      },
      metadata: { mode: body.mode },
    });

    const dto = await loadEditorDTO(id, stages);
    return NextResponse.json<ApiResult<LeagueGroupsEditorDTO>>({ success: true, data: dto });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to save league groups');
  }
}

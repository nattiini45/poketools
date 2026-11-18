import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { phaseGroupMemberMoveSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertNativePhaseNotArchived } from '@/lib/league-phase/admin-locks';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getGroupsByPhase, movePhaseGroupMember } from '@/lib/supabase/queries/phase-groups';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getGroupsByTournament, moveGroupMember } from '@/lib/supabase/queries/tournament-groups';
import { expirePhaseReads, expireTournamentReads } from '@/lib/revalidation';
import { assertPhaseGroupsEditable } from '@/lib/tournament/group-rounds';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

/** PATCH /api/seasons/[id]/phases/[phaseId]/groups/members */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;

    const native = await requireOpenPhaseRouteMode() === 'phase';
    const phaseId = native ? requestedPhaseId.toLowerCase() : requestedPhaseId;
    const seasonId = native ? id.toLowerCase() : id;
    const phase = native ? await getPhaseById(phaseId) : await getTournamentById(phaseId);
    if (!phase || phase.season_id !== seasonId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (native) assertNativePhaseNotArchived(phase);

    const rawBody = await request.json();
    const parsed = phaseGroupMemberMoveSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // A league with groups moves trainers in the league groups editor; its phases follow.
    await assertPhaseGroupsEditable(seasonId);

    const player_id = native ? parsed.data.player_id.toLowerCase() : parsed.data.player_id;
    const from_group_id = native ? parsed.data.from_group_id.toLowerCase() : parsed.data.from_group_id;
    const to_group_id = native ? parsed.data.to_group_id.toLowerCase() : parsed.data.to_group_id;
    const groups = await (native ? getGroupsByPhase(phaseId) : getGroupsByTournament(phaseId));
    const groupIds = new Set(groups.map((g) => g.id));
    if (!groupIds.has(from_group_id) || !groupIds.has(to_group_id)) {
      throw new UserFacingError('Invalid group for this phase', {
        code: 'PHASE_GROUP_INVALID',
        status: 400,
      });
    }

    const fromGroup = groups.find((g) => g.id === from_group_id);
    if (!fromGroup?.members.some((m) => m.player_id === player_id)) {
      throw new UserFacingError('Player is not in the source group', {
        code: 'PHASE_GROUP_MEMBER_NOT_FOUND',
        status: 400,
      });
    }

    const toGroup = groups.find((g) => g.id === to_group_id);
    if (!toGroup) {
      throw new UserFacingError('Invalid group for this phase', {
        code: 'PHASE_GROUP_INVALID',
        status: 400,
      });
    }
    const nextSeed = parsed.data.seed ?? toGroup.members.length + 1;
    if (native) {
      await movePhaseGroupMember(phaseId, from_group_id, to_group_id, player_id, nextSeed);
      expirePhaseReads(phaseId, seasonId);
    } else {
      await moveGroupMember(from_group_id, to_group_id, player_id, nextSeed);
      expireTournamentReads(phaseId, seasonId);
    }

    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to move group member');
  }
}

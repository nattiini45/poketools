import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { phaseGroupMemberMoveSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getGroupsByTournament, moveGroupMember } from '@/lib/supabase/queries/tournament-groups';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

/** PATCH /api/seasons/[id]/phases/[phaseId]/groups/members */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    await requireResourceAdmin('season', id);

    const phase = await getTournamentById(phaseId);
    if (!phase || phase.season_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Phase not found', code: 'PHASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rawBody = await request.json();
    const parsed = phaseGroupMemberMoveSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const { player_id, from_group_id, to_group_id, seed } = parsed.data;
    const groups = await getGroupsByTournament(phaseId);
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
    const nextSeed = seed ?? toGroup.members.length + 1;
    await moveGroupMember(from_group_id, to_group_id, player_id, nextSeed);
    expireTournamentReads(phaseId, id);

    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to move group member');
  }
}

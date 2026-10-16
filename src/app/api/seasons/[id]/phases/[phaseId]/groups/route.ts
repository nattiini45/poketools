import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { phaseGroupsCreateSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import {
  getGroupsByTournament,
  createGroupBatch,
  deleteGroupsByTournament,
  addGroupMembersBatch,
} from '@/lib/supabase/queries/tournament-groups';
import { assignSerpentine, groupLabel } from '@/lib/tournament/serpentine';
import { expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { TournamentGroupWithMembers } from '@/types/season';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

async function assertPhaseInSeason(seasonId: string, phaseId: string) {
  const phase = await getTournamentById(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new UserFacingError('Phase not found in this league', {
      code: 'PHASE_NOT_FOUND',
      status: 404,
    });
  }
  return phase;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    await assertPhaseInSeason(id, phaseId);
    const groups = await getGroupsByTournament(phaseId);
    return NextResponse.json<ApiResult<TournamentGroupWithMembers[]>>({
      success: true,
      data: groups,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch phase groups');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    await requireResourceAdmin('season', id);
    await assertPhaseInSeason(id, phaseId);

    const rawBody = await request.json();
    const parsed = phaseGroupsCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const { group_count: groupCount, serpentine } = parsed.data;
    const participants = await getParticipants(phaseId);
    const seeded = participants
      .filter((p) => p.seed !== null)
      .map((p) => ({ player_id: p.id, seed: p.seed! }));

    if (seeded.length < groupCount) {
      throw new UserFacingError(
        'Need at least as many seeded participants as groups',
        { code: 'PHASE_GROUPS_INSUFFICIENT_SEEDS', status: 400 }
      );
    }

    await deleteGroupsByTournament(phaseId);

    const groupRows = Array.from({ length: groupCount }, (_, i) => ({
      tournament_id: phaseId,
      name: `Group ${groupLabel(i)}`,
      group_number: i + 1,
    }));
    const created = await createGroupBatch(groupRows);

    if (serpentine) {
      const buckets = assignSerpentine(seeded, groupCount);
      const members: { group_id: string; player_id: string; seed: number }[] = [];
      for (const [groupIndex, playerIds] of buckets.entries()) {
        const groupId = created[groupIndex].id;
        playerIds.forEach((playerId, idx) => {
          members.push({ group_id: groupId, player_id: playerId, seed: idx + 1 });
        });
      }
      await addGroupMembersBatch(members);
    }
    expireTournamentReads(phaseId, id);

    const groups = await getGroupsByTournament(phaseId);
    return NextResponse.json<ApiResult<TournamentGroupWithMembers[]>>(
      { success: true, data: groups },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create phase groups');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    await requireResourceAdmin('season', id);
    await assertPhaseInSeason(id, phaseId);
    await deleteGroupsByTournament(phaseId);
    expireTournamentReads(phaseId, id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete phase groups');
  }
}

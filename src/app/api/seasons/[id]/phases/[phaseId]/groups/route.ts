import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { phaseGroupsCreateSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertNativePhaseNotArchived } from '@/lib/league-phase/admin-locks';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { getPhaseById, getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getGroupsByPhase, replaceAdminPhaseGroups } from '@/lib/supabase/queries/phase-groups';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import {
  getGroupsByTournament,
  createGroupBatch,
  deleteGroupsByTournament,
  addGroupMembersBatch,
} from '@/lib/supabase/queries/tournament-groups';
import { assertPhaseGroupsEditable } from '@/lib/tournament/group-rounds';
import { assignSerpentine, groupLabel } from '@/lib/tournament/serpentine';
import { expirePhaseReads, expireTournamentReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { TournamentGroupWithMembers } from '@/types/season';
import type { PhaseGroupWithMembers } from '@/types/league-phase';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

async function assertPhaseInSeason(id: string, requestedPhaseId: string) {
  const native = await requireOpenPhaseRouteMode() === 'phase';
  const phaseId = native ? requestedPhaseId.toLowerCase() : requestedPhaseId;
  const seasonId = native ? id.toLowerCase() : id;
  const phase = native ? await getPhaseById(phaseId) : await getTournamentById(phaseId);
  if (!phase || phase.season_id !== seasonId) {
    throw new UserFacingError('Phase not found in this league', {
      code: 'PHASE_NOT_FOUND',
      status: 404,
    });
  }
  return { native, phaseId, seasonId, phase };
}

/**
 * GET /api/seasons/[id]/phases/[phaseId]/groups — a phase's groups with their members (names and seeds; the league
 * hub shows the same groups publicly). Path ids are UUID-guarded (404 INVALID_SEASON_ID / INVALID_PHASE_ID) before
 * any read.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  // Public: no auth required
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const { native, phaseId } = await assertPhaseInSeason(id, requestedPhaseId);
    const groups = await (native ? getGroupsByPhase(phaseId) : getGroupsByTournament(phaseId));
    return NextResponse.json<ApiResult<TournamentGroupWithMembers[] | PhaseGroupWithMembers[]>>({
      success: true,
      data: groups,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch phase groups');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId: requestedPhaseId } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const { native, phaseId, seasonId, phase } = await assertPhaseInSeason(id, requestedPhaseId);
    if (native) assertNativePhaseNotArchived(phase);

    const rawBody = await request.json();
    const parsed = phaseGroupsCreateSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    // A league with groups: its phases mirror them (league groups editor), nothing is regenerated here.
    await assertPhaseGroupsEditable(seasonId);

    const { group_count: groupCount, serpentine } = parsed.data;
    const participants = await (native ? getPhaseParticipants(phaseId) : getParticipants(phaseId));
    const seeded = participants
      .filter((p) => p.seed !== null)
      .map((p) => ({ player_id: p.id, seed: p.seed! }));

    if (seeded.length < groupCount) {
      throw new UserFacingError(
        'Need at least as many seeded participants as groups',
        { code: 'PHASE_GROUPS_INSUFFICIENT_SEEDS', status: 400 }
      );
    }

    const names = Array.from({ length: groupCount }, (_, i) => `Group ${groupLabel(i)}`);
    const buckets = serpentine ? assignSerpentine(seeded, groupCount) : new Map<number, string[]>();
    if (native) {
      await replaceAdminPhaseGroups(seasonId, phaseId, names.map((name, index) => ({ name, members: buckets.get(index) ?? [] })), seeded);
      expirePhaseReads(phaseId, seasonId);
      const groups = await getGroupsByPhase(phaseId);
      return NextResponse.json<ApiResult<PhaseGroupWithMembers[]>>({ success: true, data: groups }, { status: 201 });
    }

    await deleteGroupsByTournament(phaseId);
    const created = await createGroupBatch(names.map((name, index) => ({
      tournament_id: phaseId, name, group_number: index + 1,
    })));
    if (serpentine) {
      const members: { group_id: string; player_id: string; seed: number }[] = [];
      for (const [groupIndex, playerIds] of buckets.entries()) {
        const groupId = created[groupIndex].id;
        playerIds.forEach((playerId, idx) => {
          members.push({ group_id: groupId, player_id: playerId, seed: idx + 1 });
        });
      }
      await addGroupMembersBatch(members);
    }
    expireTournamentReads(phaseId, seasonId);

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
    const { id, phaseId: requestedPhaseId } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;
    const invalidPhaseId = rejectInvalidPathId(requestedPhaseId, 'INVALID_PHASE_ID');
    if (invalidPhaseId) return invalidPhaseId;
    const { native, phaseId, seasonId, phase } = await assertPhaseInSeason(id, requestedPhaseId);
    if (native) assertNativePhaseNotArchived(phase);
    await assertPhaseGroupsEditable(seasonId);
    if (native) {
      await replaceAdminPhaseGroups(seasonId, phaseId, [], []);
      expirePhaseReads(phaseId, seasonId);
    } else {
      await deleteGroupsByTournament(phaseId);
      expireTournamentReads(phaseId, seasonId);
    }
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete phase groups');
  }
}

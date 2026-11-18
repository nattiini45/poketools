import { NextResponse, type NextRequest } from 'next/server';
import { readJsonBody } from '@/lib/api/json-body';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { requirePlayer } from '@/lib/auth/helpers';
import { toPublicPhaseMatch } from '@/lib/cache/phase-public-reads';
import { phaseRoundMachine } from '@/lib/league-phase/phase-round-state';
import { expirePhaseReads } from '@/lib/revalidation';
import { getPhaseMatchesByRound } from '@/lib/supabase/queries/phase-matches';
import { completePhaseRound, deleteAdminPhaseRound, updatePhaseRoundBestOf, updatePhaseRoundDeadline, updatePhaseRoundStatus } from '@/lib/supabase/queries/phase-rounds';
import { formatZodErrors, phaseDeleteSchema, roundUpdateSchema } from '@/lib/validation';
import tournamentErrors from '@/i18n/messages/errors/tournaments/en';
import type { ApiResult } from '@/types/api';
import type { PhaseRound } from '@/types/league-phase';
import { onPhaseRoundCompleted } from '../_lib/effects';
import { invalidPhaseRoundPath, loadOwnedRound, loadRoundPhase, phaseRoundError, type RoundParams } from '../_lib/scope';

function unfinishedMatches(name: string, count: number) {
  return new UserFacingError(
    `${name} still has ${count} unfinished match(es). Finish them, or complete the round anyway with a reason.`,
    { code: 'round_matches_unfinished', params: { round: name, count }, status: 409 },
  );
}

// Public: no auth required — round detail with public matches only.
export async function GET(_request: NextRequest, { params }: { params: Promise<RoundParams> }) {
  try {
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { phase } = await loadRoundPhase(path);
    const round = await loadOwnedRound(phase.id, path.rid);
    const matches = (await getPhaseMatchesByRound(round.id)).map(toPublicPhaseMatch);
    return NextResponse.json({ success: true, data: { ...round, matches } });
  } catch (error) {
    return phaseRoundError(error, 'Failed to fetch round');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<RoundParams> }) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { phase, season } = await loadRoundPhase(path, actor);
    const before = await loadOwnedRound(phase.id, path.rid);
    const json = await readJsonBody(request);
    if (!json.ok) return json.response;
    const parsed = roundUpdateSchema.safeParse(json.value);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      throw new UserFacingError(issues, { code: 'validation_failed', params: { issues } });
    }
    const { best_of, status, deadline, force, reason } = parsed.data;
    if (best_of !== undefined && before.status !== 'pending') {
      throw new UserFacingError('Can only change best_of on pending rounds', { code: 'round_best_of_locked' });
    }
    const statusChanged = status !== undefined && status !== before.status;
    if (statusChanged) phaseRoundMachine.assertTransition(before.status, status, 'admin');
    const completing = statusChanged && status === 'completed';
    if (completing && best_of !== undefined && !force) {
      const count = (await getPhaseMatchesByRound(before.id)).filter(match => match.status !== 'completed').length;
      if (count > 0) throw unfinishedMatches(before.name, count);
    }

    let round = before;
    let completed: PhaseRound | undefined;
    let wrote = false;
    try {
      if (best_of !== undefined) {
        round = await updatePhaseRoundBestOf(round.id, best_of);
        wrote = true;
      }
      if (completing) {
        const from = round.status;
        const claim = await completePhaseRound(round.id, { force: force === true });
        if (claim.outcome === 'unfinished') throw unfinishedMatches(round.name, claim.unfinished);
        if (claim.outcome === 'unchanged') {
          round = await loadOwnedRound(phase.id, round.id);
        } else {
          round = completed = claim.round;
          wrote = true;
          if (claim.unfinished > 0) {
            logAuditEvent({
              actor_id: actor.playerId, actor_name: actor.name, action: 'round.force_complete',
              resource_type: 'phase_round', resource_id: round.id, resource_name: round.name,
              changes: { status: { before: from, after: round.status } },
              metadata: { phase_id: phase.id, round_number: round.round_number, unfinished_matches: claim.unfinished, reason },
            });
          }
        }
      } else if (statusChanged) {
        round = await updatePhaseRoundStatus(round.id, status, before.status);
        wrote = true;
      }
      if (deadline !== undefined) {
        const priorDeadline = round.deadline;
        round = await updatePhaseRoundDeadline(round.id, deadline);
        wrote = true;
        const instant = (value: string | null) => value === null ? null : Date.parse(value);
        if (instant(priorDeadline) !== instant(round.deadline)) {
          logAuditEvent({
            actor_id: actor.playerId, actor_name: actor.name, action: 'phase.update',
            resource_type: 'phase_round', resource_id: round.id, resource_name: round.name,
            changes: { deadline: { before: priorDeadline, after: round.deadline } },
            metadata: { phase_id: phase.id, field: 'deadline' },
          });
        }
      }
    } finally {
      if (wrote) expirePhaseReads(phase.id, season.id);
      if (completed) await onPhaseRoundCompleted(phase, completed);
    }
    return NextResponse.json<ApiResult<PhaseRound>>({ success: true, data: round });
  } catch (error) {
    return phaseRoundError(error, 'Failed to update round');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<RoundParams> }) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { phase, season } = await loadRoundPhase(path, actor);
    const round = await loadOwnedRound(phase.id, path.rid);
    const text = await request.text();
    const json = await readJsonBody({ json: async () => text.trim() ? JSON.parse(text) : null });
    if (!json.ok) return json.response;
    const confirmation = phaseDeleteSchema.safeParse(json.value);
    if (!confirmation.success) {
      throw new UserFacingError(tournamentErrors.phase_round_delete_confirm_required, {
        code: 'phase_round_delete_confirm_required', status: 400,
      });
    }
    const deleted = await deleteAdminPhaseRound(season.id, phase.id, round.id, round.updated_at, confirmation.data.confirm);
    logAuditEvent({
      actor_id: actor.playerId, actor_name: actor.name, action: 'round.delete',
      resource_type: 'phase_round', resource_id: round.id, resource_name: deleted.name,
      metadata: { season_id: season.id, phase_id: phase.id, round_number: deleted.round_number, deleted_matches: deleted.matches },
    });
    expirePhaseReads(phase.id, season.id);
    return NextResponse.json<ApiResult<{ deleted: true }>>({ success: true, data: { deleted: true } });
  } catch (error) {
    return phaseRoundError(error, 'Failed to delete round');
  }
}

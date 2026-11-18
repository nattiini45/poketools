import { NextResponse, type NextRequest } from 'next/server';
import { readJsonBody } from '@/lib/api/json-body';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { requirePlayer } from '@/lib/auth/helpers';
import { planPhaseRoundReset } from '@/lib/league-phase/round-reset';
import { logger } from '@/lib/logger';
import { MatchAlreadyScheduledError } from '@/lib/pkmn/game-pipeline';
import { expirePhaseReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { finishPhaseRoundReset } from '@/lib/supabase/queries/phase-rounds';
import { cascadeActionSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { ResetRoundResult } from '@/types/game';
import { nativeRoundServices } from '../../_lib/effects';
import { invalidPhaseRoundPath, loadOwnedRound, loadRoundPhase, phaseRoundError, type RoundParams } from '../../_lib/scope';

export async function POST(request: NextRequest, { params }: { params: Promise<RoundParams> }) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { season, phase } = await loadRoundPhase(path, actor);
    if (phase.archived) throw new UserFacingError('Archived phase is read-only', { code: 'phase_round_reset_archived', status: 409 });
    const round = await loadOwnedRound(phase.id, path.rid);
    const json = request.body ? await readJsonBody(request) : { ok: true as const, value: {} };
    if (!json.ok) return json.response;
    const parsed = cascadeActionSchema.safeParse(json.value);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      throw new UserFacingError(issues, { code: 'validation_failed', params: { issues } });
    }
    const cascade = parsed.data.cascade === true;
    const plan = await planPhaseRoundReset(phase, round, cascade);
    const { resetMatch } = nativeRoundServices(phase).matches;
    const result: ResetRoundResult = { matches_reset: 0, total_games_deleted: 0, evolution_events: [] };
    const attempted = new Set<string>();
    let completed = false;
    try {
      for (const target of plan.targets) {
        attempted.add(target.id);
        try {
          const reset = await resetMatch(target.id, actor.playerId, cascade);
          result.matches_reset++;
          result.total_games_deleted += reset.games_deleted;
          result.evolution_events.push(...reset.evolution_events);
          if (reset.format_revert_failed) result.format_revert_failed = true;
          if (reset.evolution_recheck_failed) result.evolution_recheck_failed = true;
          if (reset.stage_already_ended && !result.stage_already_ended) result.stage_already_ended = reset.stage_already_ended;
        } catch (error) {
          if (!(error instanceof MatchAlreadyScheduledError)) throw error;
        }
      }
      const current = await loadOwnedRound(phase.id, round.id);
      await finishPhaseRoundReset(season.id, phase.id, current, plan.downstreamIds);
      completed = true;
    } finally {
      if (completed || attempted.size) {
        expirePhaseReads(phase.id, season.id);
        const affected = new Set([...attempted, ...plan.downstreamIds]);
        const expired = await Promise.allSettled(
          [...affected].map(matchId => revalidatePhaseMatchPages(phase.id, matchId, season.id)),
        );
        for (const outcome of expired) {
          if (outcome.status === 'rejected') logger.error('phase-round-reset', 'Could not expire a reset match page', { phaseId: phase.id, error: outcome.reason });
        }
        logAuditEvent({
          actor_id: actor.playerId, actor_name: actor.name, action: 'round.reset',
          resource_type: 'phase_round', resource_id: round.id, resource_name: round.name,
          metadata: { season_id: season.id, phase_id: phase.id, cascade, completed,
            matches_reset: result.matches_reset, total_games_deleted: result.total_games_deleted },
        });
      }
    }
    return NextResponse.json<ApiResult<ResetRoundResult>>({ success: true, data: result });
  } catch (error) {
    return phaseRoundError(error, 'Failed to reset round');
  }
}

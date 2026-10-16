import type { ApiErrorCode } from '@/i18n/messages/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { LeaguePhase } from '@/types/season';
import type { Round } from '@/types/round';
import type { TournamentWithDetails } from '@/types/tournament';

export class PhaseGuardError extends UserFacingError {
  constructor(message: string, code: ApiErrorCode) {
    super(message, { code, status: 400 });
    this.name = 'PhaseGuardError';
  }
}

export function buildLeaguePhase(
  tournament: TournamentWithDetails,
  rounds: Round[]
): LeaguePhase {
  const roundsCompleted = rounds.filter((r) => r.status === 'completed').length;
  return {
    id: tournament.id,
    season_id: tournament.season_id!,
    name: tournament.name,
    description: tournament.description,
    bracket_type: tournament.bracket_type,
    ruleset_id: tournament.ruleset_id,
    ruleset_name: tournament.ruleset_name,
    best_of_default: tournament.best_of_default,
    bo_overrides: tournament.bo_overrides,
    is_doubles: tournament.is_doubles,
    team_visibility: tournament.team_visibility,
    status: tournament.status,
    stage_order: tournament.stage_order,
    advancement_rule: tournament.advancement_rule,
    enrollment_source: tournament.enrollment_source,
    participant_count: tournament.participant_count,
    rounds_total: rounds.length,
    rounds_completed: roundsCompleted,
    archived: tournament.archived,
    created_at: tournament.created_at,
    updated_at: tournament.updated_at,
  };
}

export function assertPhaseEditable(
  phase: { status: string },
  field: 'bracket_type' | 'participants' | 'reorder'
): void {
  if (field === 'reorder' && phase.status !== 'upcoming') {
    throw new PhaseGuardError('Only upcoming phases can be reordered', 'PHASE_REORDER_LOCKED');
  }
  if (field === 'bracket_type' && phase.status === 'active') {
    throw new PhaseGuardError(
      'Bracket type cannot be changed while the phase is active',
      'PHASE_BRACKET_LOCKED'
    );
  }
  if (field === 'participants' && phase.status === 'completed') {
    throw new PhaseGuardError(
      'Participants cannot be changed on a completed phase',
      'PHASE_PARTICIPANTS_LOCKED'
    );
  }
}

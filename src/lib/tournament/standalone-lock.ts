import { UserFacingError } from '@/lib/api/user-facing-error';
import type { BracketType, Tournament, TournamentStatus } from '@/types/tournament';

/**
 * Locks on a standalone tournament's settings once it has started
 * (PATCH /api/tournaments/[id]). League phases have their own guards
 * (`assertSeasonPhaseTournamentEditable`, `assertPhaseEditable`). Pure and
 * client-safe: the settings editor reads `isTournamentStarted` to disable the
 * same fields the server would refuse.
 */

export interface TournamentStartSignals {
  status: TournamentStatus;
  rounds_total: number;
}

/** A tournament has started when it left `upcoming` or already has a round. */
export function isTournamentStarted(signals: TournamentStartSignals): boolean {
  return signals.status !== 'upcoming' || signals.rounds_total > 0;
}

/** Why a tournament's structure is frozen: it left `upcoming`, or an upcoming one already has a generated round. */
export type TournamentLockReason = 'started' | 'rounds';

/** The reason the locked fields cannot change, or `null` while they can. */
export function tournamentLockReason(signals: TournamentStartSignals): TournamentLockReason | null {
  if (signals.status !== 'upcoming') return 'started';
  return signals.rounds_total > 0 ? 'rounds' : null;
}

/** The fields that lock once a standalone tournament has started. */
export const STANDALONE_LOCKED_FIELDS = ['bracket_type', 'ruleset_id', 'is_doubles'] as const;

type StandaloneBefore = Pick<Tournament, 'bracket_type' | 'ruleset_id' | 'is_doubles'>;

interface StandaloneBody {
  bracket_type?: BracketType;
  ruleset_id?: string;
  is_doubles?: boolean;
}

/** Whether the body really changes one of the locked fields (a resent stored value is not a change). */
export function changesStandaloneLockedField(
  before: StandaloneBefore,
  body: StandaloneBody
): boolean {
  return STANDALONE_LOCKED_FIELDS.some(
    (field) => body[field] !== undefined && body[field] !== before[field]
  );
}

/**
 * Throws when a started standalone tournament gets a different bracket type,
 * ruleset or doubles setting. A value equal to the stored one passes: the
 * settings form sends the whole object.
 */
export function assertStandaloneSettingsEditable(
  before: StandaloneBefore,
  body: StandaloneBody,
  started: boolean
): void {
  if (!started) return;
  if (body.bracket_type !== undefined && body.bracket_type !== before.bracket_type) {
    throw new UserFacingError('The bracket type cannot be changed once the tournament has started', {
      code: 'tournament_bracket_locked',
      status: 400,
    });
  }
  if (body.ruleset_id !== undefined && body.ruleset_id !== before.ruleset_id) {
    throw new UserFacingError('The ruleset cannot be changed once the tournament has started', {
      code: 'tournament_ruleset_locked',
      status: 400,
    });
  }
  if (body.is_doubles !== undefined && body.is_doubles !== before.is_doubles) {
    throw new UserFacingError('The doubles setting cannot be changed once the tournament has started', {
      code: 'tournament_doubles_locked',
      status: 400,
    });
  }
}

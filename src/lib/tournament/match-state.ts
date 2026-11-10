import type { ApiErrorCode } from '@/i18n/messages/errors';
import { defineMachine } from '@/lib/state-machine/machine';
import type { MatchStatus } from '@/types/match';

/**
 * Match State Machine (spec Section 8)
 *
 * scheduled → in_progress (game submitted)
 * in_progress → in_progress (additional games)
 * in_progress → pending_confirmation (Bo threshold reached)
 * pending_confirmation → completed (opponent confirms OR 24hr timeout)
 * pending_confirmation → disputed (player flags)
 * disputed → completed (admin manual override)
 *
 * Admin-only moves (ADMIN_TRANSITIONS): any state back to scheduled (reset),
 * completed / pending_confirmation / disputed back to in_progress (reopen:
 * games are kept, only the result is withdrawn), and the forward overrides
 * scheduled / in_progress → completed (a result an admin sets directly: a
 * no-show, a dropped player, or a result agreed outside the app; no
 * confirmation step, the admin's decision is the confirmation). The game
 * pipeline also takes in_progress → disputed on the admins' behalf when a
 * replay is an engine tie (no draws are scored).
 */

const VALID_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  scheduled: ['in_progress'],
  in_progress: ['in_progress', 'pending_confirmation'],
  pending_confirmation: ['completed', 'disputed'],
  completed: [],
  disputed: ['completed'],
};

/** Admin-only transitions: resetting, reopening and settling a match. */
const ADMIN_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  scheduled: ['completed'],
  in_progress: ['scheduled', 'completed', 'disputed'],
  pending_confirmation: ['in_progress', 'scheduled'],
  completed: ['scheduled', 'in_progress'],
  disputed: ['scheduled', 'in_progress'],
};

/** Statuses an admin can reopen to in_progress without resetting the match. */
export const REOPENABLE_MATCH_STATUSES: readonly MatchStatus[] = [
  'completed',
  'pending_confirmation',
  'disputed',
];

/** Whether a match in `status` can be reopened to in_progress (admin only). */
export function canReopenMatch(status: MatchStatus): boolean {
  return REOPENABLE_MATCH_STATUSES.includes(status);
}

/**
 * Whether `value` is one of the five `match_status` enum labels. An own-key
 * check, so inherited Object keys (`constructor`, `__proto__`, `toString`)
 * are not statuses.
 */
export function isMatchStatus(value: unknown): value is MatchStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VALID_TRANSITIONS, value);
}

/**
 * Next states for `from` in `table`. An unknown `from` (a DB enum label added
 * without regenerating the types) has no next states: the machine fails
 * closed instead of throwing on an undefined row.
 */
function nextStates(table: Record<MatchStatus, MatchStatus[]>, from: MatchStatus): readonly MatchStatus[] {
  return isMatchStatus(from) ? table[from] : [];
}

export function isValidTransition(
  from: MatchStatus,
  to: MatchStatus,
  isAdmin?: boolean
): boolean {
  if (nextStates(VALID_TRANSITIONS, from).includes(to)) return true;
  if (isAdmin && nextStates(ADMIN_TRANSITIONS, from).includes(to)) return true;
  return false;
}

export function getValidNextStates(current: MatchStatus, isAdmin?: boolean): MatchStatus[] {
  const states = [...nextStates(VALID_TRANSITIONS, current)];
  if (isAdmin) {
    for (const s of nextStates(ADMIN_TRANSITIONS, current)) {
      if (!states.includes(s)) states.push(s);
    }
  }
  return states;
}

export interface TransitionContext {
  /** Who is initiating the transition */
  actor_id: string;
  /** Is the actor an admin? */
  is_admin: boolean;
  /** Winner ID (required for pending_confirmation → completed) */
  winner_id?: string;
  /** Match player_1_id */
  player_1_id: string;
  /** Match player_2_id */
  player_2_id: string;
}

export interface TransitionResult {
  valid: boolean;
  /** English reason (log line and client fallback). */
  error?: string;
  /** `errors/matches` catalog code so the client can render `error` in the viewer's language. */
  code?: ApiErrorCode;
  /** Values for the catalog message's `{placeholders}`. */
  params?: Record<string, string | number>;
}

/**
 * Validates whether a match state transition is allowed given the context.
 * Returns a result indicating success or a descriptive error.
 */
export function validateTransition(
  from: MatchStatus,
  to: MatchStatus,
  context: TransitionContext
): TransitionResult {
  // An admin-only transition attempted by a non-admin is its own cause, not
  // an invalid transition: checked first, because `isValidTransition` below
  // already rejects it for a non-admin.
  const adminOnly =
    !nextStates(VALID_TRANSITIONS, from).includes(to) && nextStates(ADMIN_TRANSITIONS, from).includes(to);
  if (adminOnly && !context.is_admin) {
    if (from === 'scheduled' && to === 'completed') {
      return {
        valid: false,
        error: 'Only admins can settle a match that has not been played',
        code: 'match_settle_admin_only',
      };
    }
    // Forward overrides (in_progress -> completed / disputed) skip the
    // confirmation step; every other admin-only move resets the match.
    if (to === 'completed' || to === 'disputed') {
      return {
        valid: false,
        error: 'Only admins can complete or dispute a match that is still in progress',
        code: 'match_status_override_admin_only',
      };
    }
    return {
      valid: false,
      error: 'Only admins can reset match state',
      code: 'match_reset_admin_only',
    };
  }

  if (!isValidTransition(from, to, context.is_admin)) {
    // Also covers an unknown `from`: it has no next states, so the result is
    // a catalogued rejection, never a TypeError.
    return {
      valid: false,
      error: `Invalid transition: ${String(from)} → ${String(to)}`,
      code: 'match_transition_invalid',
      params: { from: String(from), to: String(to) },
    };
  }

  // Only admins can resolve disputes
  if (from === 'disputed' && to === 'completed' && !context.is_admin) {
    return {
      valid: false,
      error: 'Only admins can resolve disputed matches',
      code: 'match_dispute_resolve_admin_only',
    };
  }

  if (to === 'completed') {
    if (!context.winner_id) {
      return {
        valid: false,
        error: 'Cannot complete a match without a winner',
        code: 'match_complete_no_winner',
      };
    }

    if (context.winner_id !== context.player_1_id && context.winner_id !== context.player_2_id) {
      return {
        valid: false,
        error: 'Winner must be one of the match participants',
        code: 'match_winner_not_participant',
      };
    }
  }

  // Only match participants or admins can confirm
  if (from === 'pending_confirmation' && to === 'completed') {
    const isParticipant =
      context.actor_id === context.player_1_id ||
      context.actor_id === context.player_2_id;
    if (!isParticipant && !context.is_admin) {
      return {
        valid: false,
        error: 'Only match participants or admins can confirm results',
        code: 'match_confirm_participants_only',
      };
    }
  }

  // Only participants or admins can dispute
  if (from === 'pending_confirmation' && to === 'disputed') {
    const isParticipant =
      context.actor_id === context.player_1_id ||
      context.actor_id === context.player_2_id;
    if (!isParticipant && !context.is_admin) {
      return {
        valid: false,
        error: 'Only match participants or admins can dispute results',
        code: 'match_dispute_participants_only',
      };
    }
  }

  return { valid: true };
}

/**
 * Determines if a Bo series has reached its threshold.
 * e.g., in Bo3, first to 2 wins. In Bo5, first to 3 wins.
 */
export function hasReachedBoThreshold(
  best_of: number,
  player_1_wins: number,
  player_2_wins: number
): { reached: boolean; winner_id_index: 1 | 2 | null } {
  const winsNeeded = Math.ceil(best_of / 2);

  if (player_1_wins >= winsNeeded) {
    return { reached: true, winner_id_index: 1 };
  }
  if (player_2_wins >= winsNeeded) {
    return { reached: true, winner_id_index: 2 };
  }
  return { reached: false, winner_id_index: null };
}

/** Who moves a match: a participant, an admin, or the app itself (crons and the game pipeline). */
export type MatchActor = 'player' | 'admin' | 'system';

/**
 * The match machine as data, for docs/state-machines.md and for UI that
 * derives the available action. For players and admins the tables above stay
 * the enforced source; `match-machine-parity.test.ts` holds this definition
 * equal to `validateTransition` for every (from, to). The `system` moves
 * (crons and the game pipeline) are checked against this definition directly
 * (`assertTransition`).
 */
export const matchMachine = defineMachine({
  id: 'match',
  title: 'Match',
  storage: 'matches.status (enum match_status) with confirmed_at, auto_confirm_at, date_played and finalized_at',
  summary:
    'A pairing from scheduling to a confirmed result (spec Section 8). Every status write takes its timestamps from matchTimestampsFor: it clears finalized_at, a completion stamps confirmed_at and date_played and clears auto_confirm_at, a move into pending_confirmation starts the auto-confirm deadline of the result source, and a move back clears the result timestamps.',
  doc: 'docs/match.md',
  states: ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'],
  initial: ['scheduled'],
  terminal: [],
  actors: ['player', 'admin', 'system'],
  codes: { invalid: 'match_transition_invalid' },
  transitions: [
    {
      event: 'record_game',
      from: ['scheduled', 'in_progress'],
      to: 'in_progress',
      actors: ['player', 'admin'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'A game is submitted and the series has no winner yet.',
    },
    {
      event: 'reach_threshold',
      from: ['in_progress'],
      to: 'pending_confirmation',
      actors: ['player', 'admin'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'A game gives one player the wins the best-of needs; auto_confirm_at starts the deadline of the result source (24 h for a replay, 48 h for a screenshot, none for a manual result without one).',
    },
    {
      event: 'confirm',
      from: ['pending_confirmation'],
      to: 'completed',
      actors: ['player', 'admin'],
      writers: ['src/app/api/confirm-match/[mid]/route.ts', 'src/lib/match/bulk-actions.ts'],
      note: 'The opponent (not the submitter) or an admin confirms the reported result.',
    },
    {
      event: 'auto_confirm',
      from: ['pending_confirmation'],
      to: 'completed',
      actors: ['system'],
      writers: ['src/app/api/cron/auto-confirm/route.ts'],
      note: 'The auto-confirm cron, once auto_confirm_at has passed; a result without a deadline waits for a person.',
    },
    {
      event: 'dispute',
      from: ['pending_confirmation'],
      to: 'disputed',
      actors: ['player', 'admin'],
      writers: ['src/app/api/confirm-match/[mid]/route.ts'],
      note: 'A participant (or an admin) flags the reported result.',
    },
    {
      event: 'resolve_dispute',
      from: ['disputed'],
      to: 'completed',
      actors: ['admin'],
      writers: ['src/app/api/confirm-match/[mid]/route.ts'],
    },
    {
      event: 'settle',
      from: ['scheduled'],
      to: 'completed',
      actors: ['admin'],
      writers: ['src/app/api/admin/matches/[id]/result/route.ts'],
      note: 'An admin records a result for a match that was never played (a no-show, a drop, a result agreed outside the app), with a reason; no confirmation step.',
    },
    {
      event: 'set_result',
      from: ['in_progress'],
      to: 'completed',
      actors: ['admin'],
      writers: ['src/app/api/confirm-match/[mid]/route.ts', 'src/app/api/admin/matches/[id]/result/route.ts'],
      note: 'An admin completes a running series directly; no confirmation step.',
    },
    {
      event: 'forfeit',
      from: ['scheduled', 'in_progress'],
      to: 'completed',
      actors: ['system'],
      writers: [
        'src/lib/format-engine/runtime/cron.ts',
        'supabase/migrations/20261105090000_format_runtime.sql#format_forfeit_complete',
      ],
      note: 'The format cron completes a match as a deadline forfeit when one side registered no team.',
    },
    {
      event: 'flag_dispute',
      from: ['in_progress'],
      to: 'disputed',
      actors: ['admin'],
      writers: ['src/app/api/confirm-match/[mid]/route.ts'],
      note: 'An admin marks a running series disputed.',
    },
    {
      event: 'flag_tie',
      from: ['in_progress'],
      to: 'disputed',
      actors: ['system'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'The game pipeline, on the admins\' behalf, when a replay is an engine tie (no draws are scored).',
    },
    {
      event: 'reopen',
      from: ['pending_confirmation', 'completed', 'disputed'],
      to: 'in_progress',
      actors: ['admin'],
      writers: ['src/lib/match/reopen.ts'],
      note: 'Withdraws the result and keeps the games.',
    },
    {
      event: 'reset',
      from: ['in_progress', 'pending_confirmation', 'completed', 'disputed'],
      to: 'scheduled',
      actors: ['admin'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'resetMatch / resetRound: deletes the games and rolls their aggregates back.',
    },
    {
      event: 'recount',
      from: ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'],
      to: 'in_progress',
      actors: ['system'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'After an admin edits or deletes a game, the status follows the remaining games (reevaluateMatchStatus): games left, best-of not reached.',
    },
    {
      event: 'recount',
      from: ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'],
      to: 'pending_confirmation',
      actors: ['system'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'As above, best-of still reached: the result waits for a confirmation again, without an auto-confirm deadline (one already running is kept).',
    },
    {
      event: 'recount',
      from: ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'],
      to: 'scheduled',
      actors: ['system'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'As above, no game left.',
    },
  ],
});

export type MatchEvent = (typeof matchMachine.spec.transitions)[number]['event'];

/** The statuses one event leaves (`sourcesOf` narrowed to one event): the compare-and-set guard of its writer. */
export function matchEventSources(event: MatchEvent): MatchStatus[] {
  return [...new Set(matchMachine.spec.transitions.filter((t) => t.event === event).flatMap((t) => t.from))];
}

/** The status the auto-confirm cron completes a match from (event `auto_confirm`). */
export const AUTO_CONFIRM_FROM: MatchStatus = matchEventSources('auto_confirm')[0];

/** The timestamp columns a status write sets together with the status. */
export interface MatchTimestampPatch {
  finalized_at: null;
  confirmed_at?: string | null;
  date_played?: string | null;
  auto_confirm_at?: string | null;
}

/**
 * The timestamps of a status write from `from` to `to`, the one place every match status writer takes them from
 * (`updateMatchStatus`, `transitionMatchStatus`, `resetMatchFields`; the SQL forfeit writes the same completion
 * stamps, pinned by `match-timestamps-sql.test.ts`). A key that is absent leaves the column as stored.
 *
 * - Every status write clears `finalized_at`: a completion starts a fresh finalize run, a match that leaves
 *   `completed` has no finalized result any more.
 * - `completed`: confirmed and played now, no auto-confirm deadline.
 * - `scheduled`: no result timestamps at all.
 * - `pending_confirmation`: the deadline of the result source (`autoConfirmAt`, none when not given) and no
 *   confirmation; a match that stays pending keeps its running deadline.
 * - `in_progress`: the first game changes nothing; a match moved back from a result loses its result timestamps.
 * - `disputed`: the deadline stops (a disputed match is never auto-confirmed).
 */
export function matchTimestampsFor(
  from: MatchStatus,
  to: MatchStatus,
  options: { now?: string; autoConfirmAt?: string | null } = {},
): MatchTimestampPatch {
  switch (to) {
    case 'completed': {
      const now = options.now ?? new Date().toISOString();
      return { finalized_at: null, date_played: now, confirmed_at: now, auto_confirm_at: null };
    }
    case 'scheduled':
      return { finalized_at: null, date_played: null, confirmed_at: null, auto_confirm_at: null };
    case 'pending_confirmation':
      if (from === to) return { finalized_at: null };
      return {
        finalized_at: null,
        auto_confirm_at: options.autoConfirmAt ?? null,
        confirmed_at: null,
        ...(from === 'completed' ? { date_played: null } : {}),
      };
    case 'in_progress':
      if (from === 'scheduled') return { finalized_at: null };
      if (from === 'in_progress') return { finalized_at: null, auto_confirm_at: null };
      return { finalized_at: null, auto_confirm_at: null, confirmed_at: null, date_played: null };
    case 'disputed':
      return { finalized_at: null, auto_confirm_at: null };
  }
}

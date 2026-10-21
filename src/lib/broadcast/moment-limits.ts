/**
 * Bounds on a broadcast moment marked in the tracker, shared by the tracker UI
 * (client) and the manual-result zod schema (server). The server rejects the
 * whole game submission when one moment breaks a bound, so the tracker must
 * not be able to produce a moment outside them.
 *
 * Dependency-free on purpose: the tracker is a client component and must not
 * pull the validation module (and the format pack it imports) into its bundle.
 */
import type { BroadcastMomentInsert, BroadcastMomentType } from '@/types/broadcast';

/** Longest moment note, in UTF-16 code units (what `maxLength` and zod count). */
export const MOMENT_DESCRIPTION_MAX_LENGTH = 500;
/** Highest moment turn number (Showdown ends a battle at turn 1000). */
export const MOMENT_MAX_TURN = 1000;
/** Most moments one submitted game may carry. */
export const MOMENT_MAX_PER_GAME = 100;

/** Turn 0 (no turn counted yet) becomes null; anything above the cap is held at the cap. */
export function boundMomentTurn(turn: number): number | null {
  if (!Number.isFinite(turn) || turn <= 0) return null;
  return Math.min(Math.trunc(turn), MOMENT_MAX_TURN);
}

/**
 * Empty notes become null. A note longer than the cap is cut at the cap
 * without splitting a surrogate pair. The note input carries the same
 * `maxLength`, so this only guards input that bypassed it.
 */
export function boundMomentNote(note: string): string | null {
  if (note.length === 0) return null;
  if (note.length <= MOMENT_DESCRIPTION_MAX_LENGTH) return note;
  let end = MOMENT_DESCRIPTION_MAX_LENGTH;
  const last = note.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return note.slice(0, end);
}

/** Builds the moment the tracker dispatches, inside the server's bounds. */
export function buildTrackerMoment(input: {
  matchId: string;
  momentType: BroadcastMomentType;
  turn: number;
  note: string;
  now: Date;
}): BroadcastMomentInsert {
  return {
    match_id: input.matchId,
    moment_type: input.momentType,
    turn_number: boundMomentTurn(input.turn),
    description: boundMomentNote(input.note),
    timestamp: input.now.toISOString(),
    created_by: '', // set by API route
  };
}

/**
 * Catalogued warning (`errors/matches`) the manual-result route sends with a
 * 200 when the game was recorded but its moments could not be saved. The game
 * is committed, so the request does not fail (a retry would record the game
 * twice); the tracker shows the warning instead of losing it silently.
 */
export const MOMENTS_NOT_SAVED_WARNING = 'manual_result_moments_not_saved' as const;

export interface MomentsNotSavedWarning {
  code: typeof MOMENTS_NOT_SAVED_WARNING;
  /** English message (client fallback), like an API error's `error`. */
  error: string;
  params: { count: number };
}

/** What the manual-result route reports about the moments of the submitted game. */
export interface ManualResultMomentsOutcome {
  /** Moments stored with the game (0 when none were sent or saving failed). */
  moments_saved: number;
  /** Present only when moments were sent and could not be saved. */
  warning?: MomentsNotSavedWarning;
}

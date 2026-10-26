/**
 * What a league, phase or tournament shows about the ruleset version it pins: the pinned version, whether a newer one
 * exists, and a count of what would change (`+3 banned, 1 unbanned`). Client-safe: types and pure functions only; the
 * server half that reads the rows is `pin-info.server.ts`.
 *
 * The change counts come from the two FROZEN resolved rules (the same comparison the pins route records), so a republish
 * that only picked up a corrected catalog is visible although the documents are equal.
 */
import { diffResolved, type RulesDifference } from '@/lib/ruleset-kit/effective';
import { RULESET_CATEGORIES, type ResolvedRules } from '@/lib/ruleset-kit/types';

/** What moving a pin from one version to another changes, in numbers the card prints. */
export interface PinChangeSummary {
  /** Entries newly banned (lists in block mode). */
  banned: number;
  /** Entries no longer banned (lists in block mode). */
  unbanned: number;
  /** Entries newly legal (lists in allowlist mode). */
  allowed: number;
  /** Entries no longer legal (lists in allowlist mode). */
  disallowed: number;
  clausesAdded: number;
  clausesRemoved: number;
  /** A list switched between block and allowlist mode, which the entry counts cannot express. */
  modeChanged: boolean;
  /** Something else differs: generation, game type, shared-type rule, team constraints or notes. */
  otherChanged: boolean;
}

/** The newer version a pin could move to. */
export interface PinUpdate {
  version_no: number;
  change: PinChangeSummary;
}

/** The ruleset a target pins, as the pin card needs it. */
export interface RulesetPinInfo {
  definition_id: string;
  /** The name frozen into the pinned version. */
  name: string;
  version_id: string;
  version_no: number;
  /** The newest published version when it is newer than the pinned one. */
  update: PinUpdate | null;
  /** Whether the viewer may open the ruleset in the studio (a link is shown only then). */
  can_view: boolean;
}

/** The numbers of a move from `from` to `to`. */
export function summarizeChange(from: ResolvedRules, to: ResolvedRules): PinChangeSummary {
  const diff = diffResolved(from, to);
  const summary: PinChangeSummary = {
    banned: 0,
    unbanned: 0,
    allowed: 0,
    disallowed: 0,
    clausesAdded: diff.clausesAdded.length,
    clausesRemoved: diff.clausesRemoved.length,
    modeChanged: false,
    otherChanged: diff.otherChanged,
  };
  for (const category of RULESET_CATEGORIES) {
    const list = diff[category];
    if (list.modeChanged) {
      summary.modeChanged = true;
    } else if (to[category].mode === 'block') {
      summary.banned += list.added.length;
      summary.unbanned += list.removed.length;
    } else {
      summary.allowed += list.added.length;
      summary.disallowed += list.removed.length;
    }
  }
  return summary;
}

/** True when nothing the card can count or name differs (the versions enforce the same). */
export function isEmptyChange(change: PinChangeSummary): boolean {
  return (
    change.banned === 0 &&
    change.unbanned === 0 &&
    change.allowed === 0 &&
    change.disallowed === 0 &&
    change.clausesAdded === 0 &&
    change.clausesRemoved === 0 &&
    !change.modeChanged &&
    !change.otherChanged
  );
}

/** Whether a league or phase counts as running, which asks for a confirmation before its pin moves (`pins.ts` agrees). */
export function pinTargetStarted(status: string): boolean {
  return status !== 'upcoming';
}

/** Whether a league or phase is finished: its pin is locked. */
export function pinTargetCompleted(status: string): boolean {
  return status === 'completed';
}

// ─── The answer of the pins route ───────────────────────────────────────────────────────────────

/** One league or phase the pins route moved. */
export interface MovedPin {
  kind: 'season' | 'tournament';
  id: string;
  name: string;
  /** The version the target pinned before. */
  from_version_id: string | null;
  /** True when the target had started (the move was confirmed). */
  started: boolean;
  /** For the audit record and the answer: what changed between the two versions. */
  difference: RulesDifference | null;
}

export interface MovePinsOutcome {
  version_id: string;
  version_no: number;
  moved: MovedPin[];
}

// ─── What moving a pin does to the teams already submitted ────────────────────────────────────────────

/** One league or phase of a pin-impact answer. */
export interface PinImpactTarget {
  kind: 'season' | 'tournament';
  id: string;
  name: string;
  /** Teams that were checked: the target's teams that can still change. */
  checked: number;
  /** Teams that are valid under the pinned version and would not be under the target version. */
  would_break: number;
}

/**
 * The answer of `POST /api/ruleset-definitions/[id]/pins/impact`: how many of the already-submitted teams of the targets would
 * stop being valid if their pin moved to `version_no`. A team that is invalid already is not counted (it does not BECOME
 * invalid), and a team that can no longer change (locked, or linked to a completed match) is not checked. `truncated` says the
 * check stopped at its bound, so the counts cover only the first `checked` teams.
 */
export interface PinImpact {
  version_no: number;
  /** Sum of `checked` over the targets. */
  checked: number;
  /** Sum of `would_break` over the targets. */
  would_break: number;
  truncated: boolean;
  targets: PinImpactTarget[];
}

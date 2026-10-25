/**
 * Pure rules behind the phase controls on the league admin phase screens: the group counts
 * the groups panel offers, the confirm gate in front of a group re-draw and the insert
 * position of a new phase. The position rules mirror `POST /api/seasons/[id]/phases`
 * (`insert_at` runs from 1 to the highest stage order + 1; a position in front of a phase that
 * already started is refused with `PHASE_INSERT_LOCKED`), so the form never offers a
 * position the API would answer with an error.
 *
 * Pure and client-safe: no reads, no React.
 */
import type { TournamentStatus } from '@/types/tournament';

/** The group counts of a phase (`phaseGroupsCreateSchema`: 2 to 26, one letter per group). */
export const PHASE_GROUP_COUNT_MIN = 2;
export const PHASE_GROUP_COUNT_MAX = 26;
export const PHASE_GROUP_COUNTS: readonly number[] = Array.from(
  { length: PHASE_GROUP_COUNT_MAX - PHASE_GROUP_COUNT_MIN + 1 },
  (_, i) => PHASE_GROUP_COUNT_MIN + i,
);

/**
 * A serpentine assign deletes every group of the phase (members and manual moves with them) and
 * draws new ones from the seeds, so it asks first when the phase already has groups.
 */
export function redrawNeedsConfirm(existingGroupCount: number): boolean {
  return existingGroupCount > 0;
}

/**
 * The position of each phase as people count it: 1 for the first phase, in stage order. The stored
 * `stage_order` is not shown, because it need not start at 1 (a phase created before positions were
 * assigned holds 0) and can have gaps after a delete.
 */
export function phaseNumbers(phases: readonly { id: string; stage_order: number }[]): Map<string, number> {
  const ordered = [...phases].sort((a, b) => a.stage_order - b.stage_order);
  return new Map(ordered.map((phase, index) => [phase.id, index + 1]));
}

/** Where a new phase goes: the end of the league, or next to an existing phase. */
export type PhaseInsertMode = 'end' | 'before' | 'after';

export interface PhasePositionPhase {
  id: string;
  name: string;
  stage_order: number;
  status: TournamentStatus;
}

export interface PhaseAnchorOption {
  phaseId: string;
  /** The `insert_at` to send; `undefined` is a plain append (nothing sits behind the anchor). */
  insertAt: number | undefined;
  /** The API would refuse this position: a phase from it onwards has already started. */
  disabled: boolean;
}

function insertAtFor(mode: 'before' | 'after', anchor: PhasePositionPhase, phases: readonly PhasePositionPhase[]): number | undefined {
  if (mode === 'before') return Math.max(1, anchor.stage_order);
  return phases.some((p) => p.stage_order > anchor.stage_order) ? anchor.stage_order + 1 : undefined;
}

/** The phases a new phase can be put before or after, in stage order, with the position each gives. */
export function phaseAnchorOptions(
  mode: 'before' | 'after',
  phases: readonly PhasePositionPhase[],
): PhaseAnchorOption[] {
  return [...phases]
    .sort((a, b) => a.stage_order - b.stage_order)
    .map((anchor) => {
      const insertAt = insertAtFor(mode, anchor, phases);
      const disabled =
        insertAt !== undefined && phases.some((p) => p.stage_order >= insertAt && p.status !== 'upcoming');
      return { phaseId: anchor.id, insertAt, disabled };
    });
}

/**
 * The `insert_at` for the chosen position, or `undefined` for a plain append: the end of the league,
 * no anchor chosen, an anchor that is not a phase of the league, or one the API would refuse.
 */
export function resolveInsertAt(
  mode: PhaseInsertMode,
  anchorId: string | null,
  phases: readonly PhasePositionPhase[],
): number | undefined {
  if (mode === 'end' || anchorId === null) return undefined;
  const option = phaseAnchorOptions(mode, phases).find((o) => o.phaseId === anchorId);
  if (!option || option.disabled) return undefined;
  return option.insertAt;
}

/**
 * Guards of the phase routes for a league with an attached format. Server only.
 *
 * `format_attach_season` is the only writer of a kit league's phases: it creates one phase per stage (per group for a
 * `foreach_group` stage), keyed by `tournaments.format_stage_key`, and freezes the stage on the row. The engine reads the
 * phases by that key, so a phase that is deleted, reordered, rebuilt as another bracket type, or a hand-made phase added
 * beside them leaves the frozen spec and the rows out of step. These guards refuse such a write with a clear 409
 * `format_phase_owned` (replace or detach the format instead) rather than syncing the two. They never touch a league
 * without a format, so the legacy phase routes behave as before.
 *
 * - `assertSeasonPhasesFree`: the league has no attached format (creating or reordering phases).
 * - `assertFormatPhaseDeletable` / `assertFormatPhaseUnchanged`: the phase is not one the format created (delete; a changed
 *   structural field). The unchanged values a form sends back pass.
 * - `assertFormatPhaseStatusUnchanged`: the status of a format phase moves through `PATCH /api/tournaments/[id]` only, which
 *   runs the format's reaction (stage start and end, checks, auto advance); the league's phase route writes none of that.
 * - `assertFormatPhaseRosterOpen`: a format phase that has started takes no roster change here (the draw, the groups and
 *   the one-shot grants of its stage start were made for the roster it started with; a player is replaced with a substitute).
 * - `assertSeasonRosterMembers`: every enrollee is on the league roster (the format routes refuse everybody else).
 */
import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { getKitPhases, getSeasonKitHead } from '@/lib/supabase/queries/format-engine';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { FormatStudioError } from './errors';

/** The columns the frozen stage fixes: a changed value would put the row out of step with `tournaments.stage_spec`. */
export const FORMAT_STRUCTURAL_PHASE_FIELDS = [
  'bracket_type',
  'best_of_default',
  'bo_overrides',
  'is_doubles',
  'bracket_reset_enabled',
  'third_place_enabled',
  'stage_order',
] as const;

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const key = (value: object) => JSON.stringify(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)));
  return key(a) === key(b);
};

async function isFormatPhase(seasonId: string, phaseId: string): Promise<boolean> {
  return (await getKitPhases(seasonId)).some((phase) => phase.id === phaseId);
}

/** 409 `format_phase_owned` while the league has an attached format (a hand-made phase, a reorder). */
export async function assertSeasonPhasesFree(seasonId: string): Promise<void> {
  if ((await getSeasonKitHead(seasonId)) !== null) throw new FormatStudioError('format_phase_owned');
}

/** 409 `format_phase_owned` for the phase of an attached format's stage (a delete). A phase of no season passes. */
export async function assertFormatPhaseDeletable(seasonId: string | null, phaseId: string): Promise<void> {
  if (seasonId !== null && (await isFormatPhase(seasonId, phaseId))) throw new FormatStudioError('format_phase_owned');
}

/** 409 `format_phase_owned` when `body` changes a structural field of a format phase; unchanged values pass. */
export async function assertFormatPhaseUnchanged(
  seasonId: string | null,
  before: { id: string } & Partial<Record<(typeof FORMAT_STRUCTURAL_PHASE_FIELDS)[number], unknown>>,
  body: Partial<Record<(typeof FORMAT_STRUCTURAL_PHASE_FIELDS)[number], unknown>>,
): Promise<void> {
  if (seasonId === null) return;
  const changed = FORMAT_STRUCTURAL_PHASE_FIELDS.some((field) => body[field] !== undefined && !sameValue(body[field], before[field]));
  if (changed && (await isFormatPhase(seasonId, before.id))) throw new FormatStudioError('format_phase_owned');
}

/** 409 `format_phase_owned` when a request to the league's phase route changes the status of a format phase. */
export async function assertFormatPhaseStatusUnchanged(
  seasonId: string,
  phase: { id: string; status: string },
  nextStatus: string | undefined,
): Promise<void> {
  if (nextStatus !== undefined && nextStatus !== phase.status && (await isFormatPhase(seasonId, phase.id))) {
    throw new FormatStudioError('format_phase_owned');
  }
}

/** 409 `format_phase_owned` for a roster change (add, remove, seeds, sync) of a format phase that has left `upcoming`. */
export async function assertFormatPhaseRosterOpen(seasonId: string, phase: { id: string; status: string }): Promise<void> {
  if (phase.status !== 'upcoming' && (await isFormatPhase(seasonId, phase.id))) throw new FormatStudioError('format_phase_owned');
}

/** 400 `PHASE_ROSTER_REQUIRED` unless every player is on the league roster. */
export async function assertSeasonRosterMembers(seasonId: string, playerIds: readonly string[]): Promise<void> {
  const rosterIds = new Set((await getSeasonParticipants(seasonId)).map((p) => p.id));
  if (playerIds.some((pid) => !rosterIds.has(pid))) {
    throw new UserFacingError('All enrollees must be league roster members', { code: 'PHASE_ROSTER_REQUIRED', status: 400 });
  }
}

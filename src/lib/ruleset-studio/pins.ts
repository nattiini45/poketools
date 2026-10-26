import 'server-only';
/**
 * Pins: which version of a ruleset a league or a phase enforces.
 *
 * `seasons.ruleset_id` and `tournaments.ruleset_id` hold the id of an immutable version, so publishing a new version never
 * changes a running league. Moving a league or a phase to another version of the SAME ruleset is an explicit act:
 *
 *  - `listUsage` says who pins which version (counts for everyone who may see the ruleset; names only for site admins and
 *    for the admins of that league, so an owner of a gallery ruleset does not learn the names of other communities' leagues);
 *  - `movePins` moves up to 50 targets to one version. Every target must be administered by the caller (a site admin, or a
 *    resource admin of the league or phase, live), must pin a version of this ruleset now, and must not be completed
 *    (`ruleset_pin_locked`). A target that has already started needs its id in `confirm_started`
 *    (`ruleset_pin_confirm_required` names the targets, nothing is written). Each move is a compare-and-set on the version
 *    the caller saw, so a pin that moved meanwhile is a conflict (`ruleset_pin_moved`), not a silent overwrite. The check is
 *    all-or-nothing up front; the writes then run one by one and a failed compare-and-set stops the run. Every move that
 *    committed is reported to `onMoved` BEFORE the next one starts, so a later conflict cannot lose the audit event and the
 *    cache expiry of the moves before it.
 *
 * The caller (the route) expires the read cache and writes one audit event per moved target, from `onMoved`.
 */
import { AuthError } from '@/lib/auth/helpers';
import { diffResolved } from '@/lib/ruleset-kit/effective';
import type { ResolvedRules } from '@/lib/ruleset-kit/types';
import type { SessionPlayer } from '@/types/auth';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import {
  getPinTargetStates,
  getRulesetVersion,
  listPinnedTargets,
  listRulesetVersions,
  repinTarget,
  type PinTargetState,
} from '@/lib/supabase/queries/ruleset-definitions';
import type { RulesetActor } from './access';
import type { PinTarget } from './api-schemas';
import { MAX_VERSIONS_PER_RULESET, RulesetStudioError } from './errors';
import { pinTargetCompleted, pinTargetStarted, type MovedPin, type MovePinsOutcome } from './pin-info';

export type { MovedPin, MovePinsOutcome } from './pin-info';
import type { RulesetDefinitionMeta, RulesetPinTarget, RulesetUsage, RulesetVersionSummary } from './library-types';

// ─── Usage ────────────────────────────────────────────────────────────────────

/**
 * Who pins the versions of a definition. `counts` is always filled; `targets` (with names) only for site admins and, for a
 * league-owned ruleset, the admins of that league (`actor.leagueIds`). Everyone else gets counts only.
 */
export async function listUsage(actor: RulesetActor, definition: RulesetDefinitionMeta): Promise<RulesetUsage> {
  const versions = await listRulesetVersions(definition.id, MAX_VERSIONS_PER_RULESET);
  const pinned = await listPinnedTargets(versions.map((v) => v.id));
  const numberOf = new Map(versions.map((v) => [v.id, v.version_no] as const));

  const counts = new Map<number, { seasons: number; tournaments: number }>();
  const bump = (versionId: string, key: 'seasons' | 'tournaments'): void => {
    const versionNo = numberOf.get(versionId);
    if (versionNo === undefined) return;
    const entry = counts.get(versionNo) ?? { seasons: 0, tournaments: 0 };
    entry[key] += 1;
    counts.set(versionNo, entry);
  };
  for (const season of pinned.seasons) bump(season.ruleset_id, 'seasons');
  for (const tournament of pinned.tournaments) bump(tournament.ruleset_id, 'tournaments');

  const mayName = (seasonId: string | null): boolean => actor.isAdmin || (seasonId !== null && actor.leagueIds?.has(seasonId) === true);
  const targets: RulesetPinTarget[] = [
    ...pinned.seasons
      .filter((s) => mayName(s.id))
      .map((s) => ({ kind: 'season' as const, id: s.id, name: s.name, season_id: null, version_id: s.ruleset_id, version_no: numberOf.get(s.ruleset_id) ?? 0, status: s.status })),
    ...pinned.tournaments
      .filter((t) => mayName(t.season_id))
      .map((t) => ({ kind: 'tournament' as const, id: t.id, name: t.name, season_id: t.season_id, version_id: t.ruleset_id, version_no: numberOf.get(t.ruleset_id) ?? 0, status: t.status })),
  ];

  return {
    counts: [...counts.entries()].sort((x, y) => x[0] - y[0]).map(([version_no, c]) => ({ version_no, ...c })),
    targets: actor.isAdmin || targets.length > 0 ? targets : null,
  };
}

// ─── Moving pins ──────────────────────────────────────────────────────────────

export interface MovePinsInput {
  actor: SessionPlayer;
  definition: RulesetDefinitionMeta;
  toVersionNo: number;
  targets: readonly PinTarget[];
  /** Ids of started targets whose move the caller confirmed. */
  confirmStarted: readonly string[];
  /** Called with each move right after it committed, before the next one starts (audit and cache expiry). */
  onMoved?: (moved: MovedPin, to: { version_id: string; version_no: number }) => void;
}


async function assertAdministers(actor: SessionPlayer, target: PinTargetState): Promise<void> {
  if (actor.isAdmin) return;
  const type = target.kind;
  if (!(await isResourceAdminFor(actor.playerId, type, target.id))) {
    throw new AuthError('Admin access required for this league or phase', 403, 'forbidden');
  }
}

// A league is "started" by its status here; the finer start signals (rounds, phases) matter for attaching a format, not for
// the confirmation, which only has to catch a league that is running. The pin card (`pin-info.ts`) uses the same two tests.
const hasStarted = (target: PinTargetState): boolean => pinTargetStarted(target.status);
const isFinished = (target: PinTargetState): boolean => pinTargetCompleted(target.status);

/**
 * The leagues and phases a move (or the impact check of a move, `pin-impact.server.ts`) is asked for, read live and checked one
 * by one in request order; the first failing target throws and nothing is written. Each must exist (`ruleset_not_found`), be
 * administered by the caller (403), pin one of `versions` (the versions of THIS ruleset, `ruleset_pin_mismatch`) now and not be
 * finished (`ruleset_pin_locked`). Returns the states in request order.
 */
export async function loadMoveTargets(
  actor: SessionPlayer,
  targets: readonly PinTarget[],
  versions: readonly Pick<RulesetVersionSummary, 'id'>[],
): Promise<PinTargetState[]> {
  const seasonIds = targets.filter((t) => t.kind === 'season').map((t) => t.id);
  const tournamentIds = targets.filter((t) => t.kind === 'tournament').map((t) => t.id);
  const states = await getPinTargetStates(seasonIds, tournamentIds);
  const byKey = new Map(states.map((s) => [`${s.kind}:${s.id}`, s] as const));
  const ownVersionIds = new Set(versions.map((v) => v.id));

  const checked: PinTargetState[] = [];
  for (const target of targets) {
    const state = byKey.get(`${target.kind}:${target.id}`);
    if (state === undefined) throw new RulesetStudioError('ruleset_not_found');
    await assertAdministers(actor, state);
    if (state.ruleset_id === null || !ownVersionIds.has(state.ruleset_id)) throw new RulesetStudioError('ruleset_pin_mismatch');
    if (isFinished(state)) throw new RulesetStudioError('ruleset_pin_locked');
    checked.push(state);
  }
  return checked;
}

export async function movePins(input: MovePinsInput): Promise<MovePinsOutcome> {
  const { actor, definition } = input;
  const version = await getRulesetVersion(definition.id, input.toVersionNo);
  if (version === null) throw new RulesetStudioError('ruleset_not_found');

  // Versions are immutable: one read of the list serves the ownership check and the version numbers of the sources.
  const versions = await listRulesetVersions(definition.id, MAX_VERSIONS_PER_RULESET);
  const confirmed = new Set(input.confirmStarted);
  const plan: PinTargetState[] = [];
  const needConfirmation: string[] = [];

  for (const state of await loadMoveTargets(actor, input.targets, versions)) {
    if (state.ruleset_id === version.id) continue; // already there: nothing to move
    if (hasStarted(state) && !confirmed.has(state.id)) needConfirmation.push(state.name);
    plan.push(state);
  }
  if (needConfirmation.length > 0) {
    throw new RulesetStudioError('ruleset_pin_confirm_required', { targets: needConfirmation.join(', ') });
  }

  // One read of the rules per distinct source version.
  const numberOf = new Map(versions.map((v) => [v.id, v.version_no] as const));
  const sources = new Map<string, ResolvedRules | null>();
  const sourceRules = async (versionId: string): Promise<ResolvedRules | null> => {
    if (!sources.has(versionId)) {
      const no = numberOf.get(versionId);
      sources.set(versionId, no === undefined ? null : ((await getRulesetVersion(definition.id, no))?.resolved ?? null));
    }
    return sources.get(versionId) ?? null;
  };

  const to = { version_id: version.id, version_no: version.version_no };
  const moved: MovedPin[] = [];
  for (const state of plan) {
    const ok = await repinTarget(state.kind, state.id, state.ruleset_id, version.id);
    if (!ok) throw new RulesetStudioError('ruleset_pin_moved', { target: state.name });
    const from = state.ruleset_id === null ? null : await sourceRules(state.ruleset_id);
    const entry: MovedPin = {
      kind: state.kind,
      id: state.id,
      name: state.name,
      season_id: state.season_id,
      from_version_id: state.ruleset_id,
      started: hasStarted(state),
      difference: from === null ? null : diffResolved(from, version.resolved),
    };
    moved.push(entry);
    input.onMoved?.(entry, to);
  }
  return { ...to, moved };
}

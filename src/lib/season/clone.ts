import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { expireSeasonReads } from '@/lib/revalidation';
import { getSeasonById, deleteSeason } from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  createTournament,
  deleteTournament,
} from '@/lib/supabase/queries/tournaments';
import {
  isResourceAdminFor,
  getResourceAdmins,
  addResourceAdmin,
  removeResourceAdmin,
} from '@/lib/supabase/queries/resource-admins';
import { addSeasonParticipants, listSeasonParticipantIds } from '@/lib/supabase/queries/season-clone';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import type { Season } from '@/types/season';
import type { Tournament, TournamentFormData } from '@/types/tournament';

/**
 * Start a league from an existing one (`POST /api/seasons` with `clone_from`).
 *
 * The new league is created by the route's normal path first; this module
 * then copies the source's phases (and, on request, its roster and league
 * admins) onto it. PostgREST has no multi-statement transaction, so a failure
 * undoes what was created (`rollbackClonedLeague`) instead of rolling back.
 *
 * What is copied is a phase's configuration, never its progress: no rounds,
 * matches, games, participants, seeds, groups or results. Nothing of a
 * point-buy league's own data is read from the source either: no point-buy
 * list, draft pool, token, redraft, evolution or format-rules query is
 * imported here (the destination gets those from the route's normal path).
 */

/** Who runs the clone: the live player of `requireAnyAdmin`, never the session copy. */
export interface CloneActor {
  playerId: string;
  name: string;
  isAdmin: boolean;
}

export interface CloneAllowedOptions {
  sourceId: string;
  copyAdmins: boolean;
}

export interface CloneOptions {
  copyRoster: boolean;
  copyAdmins: boolean;
}

/** What a clone copied; the 201 body carries it as `data.clone`. */
export interface CloneReport {
  source_id: string;
  phases: number;
  participants: number;
  admins: number;
}

/** The step a clone was in, for the failure audit entry. */
export type CloneStep = 'setup' | 'phases_read' | 'roster' | 'phases' | 'enrollment' | 'admins' | 'finish';

/**
 * What a clone has created so far, so a failure can remove exactly that. The
 * route marks `creatorGrant` after it added the creator as league admin;
 * `copyLeagueStructure` records everything it writes.
 */
export interface CloneTracker {
  seasonId: string;
  seasonName: string;
  sourceId: string;
  actor: CloneActor;
  step: CloneStep;
  /** The creator got a league admin row from the route (a non-site-admin creator). */
  creatorGrant: boolean;
  /** New phases, in creation order. */
  phaseIds: string[];
  /** Players the clone made league admins (the copied ones, not the creator). */
  adminGrants: string[];
  /** Roster entries added. */
  participants: number;
}

export function createCloneTracker(init: {
  seasonId: string;
  seasonName: string;
  sourceId: string;
  actor: CloneActor;
}): CloneTracker {
  return { ...init, step: 'setup', creatorGrant: false, phaseIds: [], adminGrants: [], participants: 0 };
}

/**
 * Policy, checked before anything is written (a refusal creates nothing): the
 * source must exist, the caller must be a site admin or admin of that league,
 * and copying the league admins is for site admins only (granting league
 * admin is a site-admin action; a copy must not widen it). The source may be
 * archived or a test league.
 */
export async function assertCloneAllowed(
  actor: CloneActor,
  opts: CloneAllowedOptions,
): Promise<{ source: Season }> {
  const source = await getSeasonById(opts.sourceId);
  if (!source) {
    throw new UserFacingError('League not found', { code: 'SEASON_NOT_FOUND', status: 404 });
  }

  if (!actor.isAdmin && !(await isResourceAdminFor(actor.playerId, 'season', source.id))) {
    throw new UserFacingError('You can only start a league from a league you administer', {
      code: 'SEASON_CLONE_FORBIDDEN',
      status: 403,
    });
  }

  if (opts.copyAdmins && !actor.isAdmin) {
    throw new UserFacingError('Only site admins can copy the league admins', {
      code: 'SEASON_CLONE_ADMINS_FORBIDDEN',
      status: 403,
    });
  }

  return { source };
}

/**
 * The phases to create on the new league, in the source's order and numbered
 * 1..n (a source with a gap in its stage order closes it). Exactly the
 * configuration fields: a phase starts `upcoming` with no rounds, no
 * enrollment and no results, whatever the source phase has.
 */
export function planPhaseCopies(phases: readonly Tournament[], newSeasonId: string): TournamentFormData[] {
  return phases
    .map((phase, index) => ({ phase, index }))
    .sort((a, b) => a.phase.stage_order - b.phase.stage_order || a.index - b.index)
    .map(({ phase }, position) => ({
      name: phase.name,
      description: phase.description,
      bracket_type: phase.bracket_type,
      ruleset_id: phase.ruleset_id,
      best_of_default: phase.best_of_default,
      bo_overrides: { ...phase.bo_overrides },
      is_doubles: phase.is_doubles,
      team_visibility: phase.team_visibility,
      bracket_reset_enabled: phase.bracket_reset_enabled ?? true,
      // As stored on this phase, so its position semantics are preserved.
      advancement_rule: phase.advancement_rule ? { ...phase.advancement_rule } : null,
      season_id: newSeasonId,
      stage_order: position + 1,
    }));
}

/**
 * Copies the source's structure onto the freshly created league. Runs after
 * the route created the league and its format setup; records every write in
 * `tracker` so `rollbackClonedLeague` can undo it.
 */
export async function copyLeagueStructure(
  newSeason: Season,
  source: Season,
  actor: CloneActor,
  opts: CloneOptions,
  tracker: CloneTracker,
): Promise<CloneReport> {
  tracker.step = 'phases_read';
  const sourcePhases = await getStagesBySeasonId(source.id);

  // The roster goes first, so the first phase's enrollment sync enrols it.
  if (opts.copyRoster) {
    tracker.step = 'roster';
    const playerIds = await listSeasonParticipantIds(source.id);
    if (playerIds.length > 0) {
      await addSeasonParticipants(newSeason.id, playerIds);
      tracker.participants = playerIds.length;
    }
  }

  tracker.step = 'phases';
  for (const input of planPhaseCopies(sourcePhases, newSeason.id)) {
    const created = await createTournament(input);
    tracker.phaseIds.push(created.id);
  }

  // As POST /api/seasons/[id]/phases does after creating a phase, in order.
  tracker.step = 'enrollment';
  for (const phaseId of tracker.phaseIds) {
    await syncStandingsEnrollment(newSeason.id, phaseId);
  }

  if (opts.copyAdmins) {
    tracker.step = 'admins';
    const sourceAdmins = await getResourceAdmins('season', source.id);
    // The creator is already (or, as a site admin, needs not be) league admin.
    const skip = new Set<string>([actor.playerId]);
    for (const admin of sourceAdmins) {
      if (skip.has(admin.player_id)) continue;
      skip.add(admin.player_id);
      await addResourceAdmin(admin.player_id, 'season', newSeason.id);
      tracker.adminGrants.push(admin.player_id);
    }
  }

  tracker.step = 'finish';
  expireSeasonReads(newSeason.id, tracker.phaseIds);

  const report: CloneReport = {
    source_id: source.id,
    phases: tracker.phaseIds.length,
    participants: tracker.participants,
    admins: tracker.adminGrants.length,
  };

  logAuditEvent({
    action: 'season.clone',
    actor_id: actor.playerId,
    actor_name: actor.name,
    resource_type: 'season',
    resource_id: newSeason.id,
    resource_name: newSeason.name,
    metadata: {
      source_id: source.id,
      source_name: source.name,
      phases: report.phases,
      participants: report.participants,
      admins: report.admins,
      copy_roster: opts.copyRoster,
      copy_admins: opts.copyAdmins,
    },
  });

  return report;
}

/**
 * Undoes a failed clone and throws the error the caller answers with. Phases
 * go first (their league foreign key has no cascade), then the league admin
 * rows (`resource_admins` has no foreign key to leagues, so deleting the league
 * would orphan them), then the league itself, which cascades its roster and
 * format rules. The shared battle ruleset a point-buy league may have
 * created is a shared row and stays.
 *
 * Neither failure is swallowed: the original error and, if the cleanup fails
 * too, the cleanup error are logged, a `season.clone_failed` audit entry says
 * how far it got, and the thrown `UserFacingError` says what remains.
 */
export async function rollbackClonedLeague(tracker: CloneTracker, cause: unknown): Promise<never> {
  console.error(`[clone] Copying league ${tracker.sourceId} failed at step "${tracker.step}":`, cause);

  let phasesLeft = tracker.phaseIds.length;
  let cleanupError: unknown = null;
  try {
    for (const phaseId of [...tracker.phaseIds].reverse()) {
      await deleteTournament(phaseId);
      phasesLeft -= 1;
    }
    for (const playerId of tracker.adminGrants) {
      await removeResourceAdmin(playerId, 'season', tracker.seasonId);
    }
    if (tracker.creatorGrant) {
      await removeResourceAdmin(tracker.actor.playerId, 'season', tracker.seasonId);
    }
    await deleteSeason(tracker.seasonId);
  } catch (err) {
    cleanupError = err;
    console.error(`[clone] Cleanup of league ${tracker.seasonId} failed; it remains:`, err);
  }

  const cleanupFailed = cleanupError !== null;
  logAuditEvent({
    action: 'season.clone_failed',
    actor_id: tracker.actor.playerId,
    actor_name: tracker.actor.name,
    resource_type: 'season',
    resource_id: tracker.seasonId,
    resource_name: tracker.seasonName,
    metadata: {
      source_id: tracker.sourceId,
      step: tracker.step,
      created: {
        phases: tracker.phaseIds.length,
        participants: tracker.participants,
        admins: tracker.adminGrants.length,
      },
      cleanup: cleanupFailed ? 'failed' : 'complete',
    },
  });

  if (cleanupFailed) {
    throw new UserFacingError(
      `The league could not be created from the source, and it could not be removed again: league ${tracker.seasonId} remains with ${phasesLeft} phases and ${tracker.participants} roster entries. A site admin can delete it.`,
      {
        code: 'SEASON_CLONE_CLEANUP_FAILED',
        status: 500,
        params: { league_id: tracker.seasonId, phases: phasesLeft, participants: tracker.participants },
      },
    );
  }

  throw new UserFacingError('The league could not be created from the source. Nothing was kept.', {
    code: 'SEASON_CLONE_FAILED',
    status: 500,
  });
}

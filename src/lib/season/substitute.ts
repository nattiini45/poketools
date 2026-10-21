import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  getScheduledMatchesForPlayerInTournament,
  repairScheduledMatchPairing,
} from '@/lib/supabase/queries/matches';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import {
  getSeasonById,
  getSeasonParticipantRow,
  swapSeasonParticipant,
} from '@/lib/supabase/queries/seasons';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getSeasonGroupOfPlayer, seasonGroupHasDraftingPool } from '@/lib/supabase/queries/season-groups';
import { DraftRuleError } from '@/lib/draft/errors';
import {
  getParticipants,
  getStagesBySeasonId,
  swapTournamentParticipant,
  type TournamentParticipantSwap,
} from '@/lib/supabase/queries/tournaments';
import {
  getGroupMembershipsInTournament,
  groupSwapWroteBeforeFailure,
  swapGroupMemberInTournament,
  type GroupMemberSwap,
} from '@/lib/supabase/queries/tournament-groups';
import type { ApiError } from '@/types/api';
import type { MatchWithPlayers } from '@/types/match';
import type { ParticipantWithSeed, TournamentStatus } from '@/types/tournament';

export interface SubstituteAffectedMatch {
  match_id: string;
  tournament_id: string;
  tournament_name: string;
  round_id: string;
  player_1_id: string;
  player_2_id: string;
  player_1_name: string;
  player_2_name: string;
}

/**
 * A planned match the apply left as it was: by the time its repair ran, a
 * result was being or had been reported (`has_games`), or it was no longer
 * scheduled between the planned players (`changed`). It stays with the
 * departed player, like any match they played.
 */
export interface SubstituteSkippedMatch extends SubstituteAffectedMatch {
  reason: 'has_games' | 'changed';
}

export interface SubstitutePhaseUpdate {
  phase_id: string;
  phase_name: string;
  seed: number | null;
  /** The group whose slot the incoming player takes; null in an ungrouped phase. */
  group: { id: string; name: string } | null;
}

export interface SubstituteSummary {
  roster_swapped: boolean;
  phases: SubstitutePhaseUpdate[];
  affected_matches: SubstituteAffectedMatch[];
  matches_repaired: number;
  /** Planned matches the apply did not repair (always empty in a dry run). */
  matches_skipped: SubstituteSkippedMatch[];
}

/** The apply step that was running when an apply stopped. */
export type SubstituteApplyStep = 'proposals' | 'match' | 'group' | 'enrollment' | 'roster';

/**
 * What an apply wrote, filled as it runs so the caller can record it after a
 * failure: the steps are not one transaction, the ones before a failure have
 * landed, and a re-run no longer plans them. Only real writes are recorded: a
 * step that ran and changed nothing (no pending proposal to cancel, a group
 * slot already with the incoming player, as a second concurrent apply finds
 * it) is left out, so an apply that wrote nothing logs nothing.
 */
export interface SubstituteApplyLog {
  /** Matches that had pending proposals, now cancelled. */
  proposals_cancelled: string[];
  /** Matches re-paired to the incoming player. */
  matches_repaired: string[];
  /** Planned matches left as they were (see `SubstituteSkippedMatch`). */
  matches_skipped: string[];
  /**
   * Phases whose group step wrote (moved the outgoing player's slot, or
   * deleted stale rows of the incoming player), with the group the incoming
   * player holds there afterwards (null: none). A slot an earlier,
   * interrupted run already moved is not listed again.
   */
  groups_handed_over: Array<{ phase_id: string; group_id: string | null }>;
  /** Phases whose enrollment moved to the incoming player. */
  enrollments_swapped: string[];
  roster_swapped: boolean;
  /**
   * Phases the apply handed anything over in (a repaired match, a group row,
   * the enrollment), in order: the slot moved there, wholly or in part.
   */
  phases_touched: string[];
  /** The step running when the apply stopped; null when none failed. */
  stopped_at: { step: SubstituteApplyStep; phase_id: string | null; match_id: string | null } | null;
}

export function emptySubstituteApplyLog(): SubstituteApplyLog {
  return {
    proposals_cancelled: [],
    matches_repaired: [],
    matches_skipped: [],
    groups_handed_over: [],
    enrollments_swapped: [],
    roster_swapped: false,
    phases_touched: [],
    stopped_at: null,
  };
}

/** True when the apply wrote anything before it stopped. */
export function substituteApplyWrote(log: SubstituteApplyLog): boolean {
  return (
    log.proposals_cancelled.length > 0 ||
    log.matches_repaired.length > 0 ||
    log.groups_handed_over.length > 0 ||
    log.enrollments_swapped.length > 0 ||
    log.roster_swapped
  );
}

/**
 * What a failed apply wrote before it stopped, from its `SubstituteApplyLog`:
 * `written` is the log's write lists (plus `matches_skipped`, the planned
 * matches it left as they were), `phase_ids` its `phases_touched`, and
 * `stopped_at` the step that failed. The substitute route returns it with the
 * error and records the same fields in the partial audit entry.
 */
export interface SubstitutePartialApply {
  written: Omit<SubstituteApplyLog, 'phases_touched' | 'stopped_at'>;
  phase_ids: string[];
  stopped_at: SubstituteApplyLog['stopped_at'];
}

/**
 * The partial signal of a failed apply: null when it wrote nothing (a
 * failure before the first write, or a step that found its work already
 * done), else what it wrote (`SubstitutePartialApply`).
 */
export function substitutePartialApply(log: SubstituteApplyLog): SubstitutePartialApply | null {
  if (!substituteApplyWrote(log)) return null;
  const { phases_touched: phaseIds, stopped_at: stoppedAt, ...written } = log;
  return { written, phase_ids: phaseIds, stopped_at: stoppedAt };
}

/**
 * The error body of a failed apply (`dry_run: false`) that reached the
 * substitution: the usual error and code, plus `partial`, the exact partial
 * signal (null: nothing written). A failure the route rejected before the
 * substitution ran (auth, a malformed body) carries no `partial` field and
 * wrote nothing either.
 */
export interface SubstituteApplyError extends ApiError {
  partial?: SubstitutePartialApply | null;
}

export interface SubstituteInput {
  seasonId: string;
  outPlayerId: string;
  inPlayerId: string;
  scope: 'league' | string;
  dryRun: boolean;
  /** Filled by an apply as it writes (see `SubstituteApplyLog`). */
  log?: SubstituteApplyLog;
}

const ACTIVE_PHASE_STATUSES = new Set<TournamentStatus>(['upcoming', 'active']);

/** Postgres unique violation: the incoming player was enrolled meanwhile. */
const UNIQUE_VIOLATION = '23505';

function isPhaseInScope(phaseId: string, scope: 'league' | string): boolean {
  return scope === 'league' || scope === phaseId;
}

function toAffectedMatch(
  match: MatchWithPlayers,
  tournamentName: string,
): SubstituteAffectedMatch {
  return {
    match_id: match.id,
    tournament_id: match.tournament_id,
    tournament_name: tournamentName,
    round_id: match.round_id,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
    player_1_name: match.player_1_name,
    player_2_name: match.player_2_name,
  };
}

async function resolveTargetPhases(seasonId: string, scope: 'league' | string) {
  const stages = await getStagesBySeasonId(seasonId);
  return stages.filter(
    (stage) =>
      ACTIVE_PHASE_STATUSES.has(stage.status) &&
      isPhaseInScope(stage.id, scope),
  );
}

/**
 * The outgoing player's scheduled matches without games, per phase. The read
 * filters on the server and pages (`getScheduledMatchesForPlayerInTournament`),
 * so a phase with many matches cannot hide some of them; the status and game
 * checks here only restate what it promises.
 */
async function findRepairableMatches(
  phases: Array<{ id: string; name: string }>,
  outPlayerId: string,
): Promise<SubstituteAffectedMatch[]> {
  const affected: SubstituteAffectedMatch[] = [];

  for (const phase of phases) {
    const matches = await getScheduledMatchesForPlayerInTournament(phase.id, outPlayerId);
    for (const match of matches) {
      if (match.status !== 'scheduled') continue;
      if (match.games.length > 0) continue;
      if (match.player_1_id !== outPlayerId && match.player_2_id !== outPlayerId) continue;
      affected.push(toAffectedMatch(match, phase.name));
    }
  }

  return affected;
}

/**
 * Season-level checks before anything else: a completed or archived league
 * keeps the roster and enrollments that played it, so it takes no
 * substitution (409 `SEASON_CLOSED`, the preview included).
 */
async function assertSeasonOpen(seasonId: string): Promise<void> {
  const season = await getSeasonById(seasonId);
  if (!season) {
    throw new UserFacingError('League not found', { code: 'SEASON_NOT_FOUND', status: 404 });
  }
  if (season.status === 'completed' || season.archived) {
    throw new UserFacingError(
      season.archived
        ? 'The league is archived; its roster can no longer be substituted'
        : 'The league is completed; its roster can no longer be substituted',
      { code: 'SEASON_CLOSED', status: 409 },
    );
  }
}

/**
 * League scope moves the roster row, and the league group slot moves with it (the membership's participant key
 * cascades). While the outgoing trainer's group has a pool in submissions (a Redraft) or drafting, that pool keeps the
 * outgoing seat, so the membership trigger refuses that slot change (20261018202000_league_groups_locks.sql). Checked here, before the
 * first write (the preview included), so a refusal writes nothing: 409 `SEASON_GROUP_SUBSTITUTION_LOCKED`. A draft
 * that starts between this check and the roster swap is still refused by the trigger (`swapSeasonParticipant`).
 */
async function assertGroupNotDrafting(seasonId: string, outPlayerId: string): Promise<void> {
  const group = await getSeasonGroupOfPlayer(seasonId, outPlayerId);
  if (group && (await seasonGroupHasDraftingPool(group.id))) {
    throw new DraftRuleError('SEASON_GROUP_SUBSTITUTION_LOCKED', undefined, { season_group_id: group.id });
  }
}

/**
 * A phase whose groups mirror the league groups (`ensurePhaseGroupsFromLeague`) keeps them equal to the league
 * membership: the Standings tab reads the league groups, the Group stage tab and the schedule the phase groups, and
 * the phase group writes are league-managed (`PHASE_GROUPS_LEAGUE_MANAGED`). A phase-scope substitution moves only
 * the phase slot (the roster and the league groups stay), so the incoming trainer must already be in the league group
 * the slot mirrors; otherwise the two tabs would disagree with no repair path. Refused before the first write, the
 * preview included: 409 `SUBSTITUTE_LEAGUE_GROUP_MISMATCH`. A substitute from outside the group (a reserve, a trainer
 * of another group) goes through the league scope, which moves the league group slot with the roster row. League
 * membership is frozen once a phase has a round (`SEASON_GROUPS_SCHEDULED`), and before that the first-round guard
 * re-checks the mirror against the league groups (`PHASE_GROUPS_STALE`), so this read cannot go stale unnoticed.
 */
async function assertIncomingInMirroredGroup(
  seasonId: string,
  inPlayerId: string,
  slot: { group_name: string; season_group_id: string },
  phaseName: string,
): Promise<void> {
  const inGroup = await getSeasonGroupOfPlayer(seasonId, inPlayerId);
  if (inGroup?.id === slot.season_group_id) return;
  throw new UserFacingError(
    `The incoming player is not in league group ${slot.group_name}, which ${phaseName} follows; substitute across the whole league instead`,
    { code: 'SUBSTITUTE_LEAGUE_GROUP_MISMATCH', params: { phase: phaseName, group: slot.group_name }, status: 409 },
  );
}

function enrollmentChanged(phase: SubstitutePhaseUpdate): UserFacingError {
  return new UserFacingError(
    `Outgoing player is no longer enrolled in ${phase.phase_name} (the phase changed during the substitution); check it again`,
    { code: 'ENROLLMENT_CHANGED', params: { phase: phase.phase_name }, status: 409 },
  );
}

/**
 * The enrollment swap, with the conflicts a concurrent change causes mapped
 * to their own 409s. The plan saw the outgoing player enrolled and the
 * incoming one not, so a row that did not move (`swapped: false`: the
 * outgoing player's row is gone) or a primary-key clash means the phase
 * changed between the plan and this write (a second apply, another tab).
 * Whether the row moved comes from `swapped` alone: an unseeded row moves
 * with a null seed, and that is a success.
 */
async function swapEnrollment(
  phase: SubstitutePhaseUpdate,
  outPlayerId: string,
  inPlayerId: string,
): Promise<void> {
  let result: TournamentParticipantSwap;
  try {
    result = await swapTournamentParticipant(phase.phase_id, outPlayerId, inPlayerId);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === UNIQUE_VIOLATION) {
      console.error('[substitute] enrollment swap conflict:', err);
      throw new UserFacingError(
        `Incoming player was enrolled in ${phase.phase_name} during the substitution; check it again`,
        { code: 'IN_ALREADY_IN_PHASE', params: { phase: phase.phase_name }, status: 409 },
      );
    }
    throw err;
  }
  if (!result.swapped) throw enrollmentChanged(phase);
}

export async function substituteParticipant(input: SubstituteInput): Promise<SubstituteSummary> {
  const { seasonId, outPlayerId, inPlayerId, scope, dryRun, log } = input;
  const isLeagueScope = scope === 'league';

  if (outPlayerId === inPlayerId) {
    throw new UserFacingError('Outgoing and incoming players must be different', {
      code: 'substitute_same_player',
    });
  }

  const [, outPlayer, inPlayer] = await Promise.all([
    assertSeasonOpen(seasonId),
    getPlayerById(outPlayerId),
    getPlayerById(inPlayerId),
  ]);

  if (!outPlayer) {
    throw new UserFacingError('Outgoing player not found', { code: 'OUT_PLAYER_NOT_FOUND' });
  }
  if (!inPlayer) {
    throw new UserFacingError('Incoming player not found', { code: 'IN_PLAYER_NOT_FOUND' });
  }

  const targetPhases = await resolveTargetPhases(seasonId, scope);
  /** Each target phase's enrollment, read once. */
  const enrollment = new Map<string, ParticipantWithSeed[]>();

  if (isLeagueScope) {
    // League scope moves the roster row, so both sides are checked on it.
    const [outOnRoster, inOnRoster] = await Promise.all([
      getSeasonParticipantRow(seasonId, outPlayerId),
      getSeasonParticipantRow(seasonId, inPlayerId),
    ]);
    if (!outOnRoster) {
      throw new UserFacingError('Outgoing player is not on the league roster', {
        code: 'OUT_NOT_ON_ROSTER',
      });
    }
    if (inOnRoster) {
      throw new UserFacingError('Incoming player is already on the league roster', {
        code: 'IN_ALREADY_ON_ROSTER',
      });
    }
    await assertGroupNotDrafting(seasonId, outPlayerId);
  } else {
    // Phase scope moves the phase enrollment only (the roster stays as it
    // is), so it checks the enrollment, not the roster: a reserve promoted
    // into the phase earlier is enrolled without being on the roster and can
    // be replaced in turn.
    if (targetPhases.length === 0) {
      throw new UserFacingError('Phase not found or is already completed', {
        code: 'PHASE_NOT_ELIGIBLE',
      });
    }
    const phaseParticipants = await getParticipants(scope);
    enrollment.set(scope, phaseParticipants);
    if (phaseParticipants.some((p) => p.id === inPlayerId)) {
      // `targetPhases` is exactly the scoped phase here (filtered by id).
      throw new UserFacingError('Incoming player is already enrolled in this phase', {
        code: 'IN_ALREADY_IN_PHASE',
        params: { phase: targetPhases[0].name },
      });
    }
    if (!phaseParticipants.some((p) => p.id === outPlayerId)) {
      throw new UserFacingError('Outgoing player is not enrolled in this phase', {
        code: 'OUT_NOT_IN_PHASE',
      });
    }
  }

  const phaseUpdates: SubstitutePhaseUpdate[] = [];
  const enrolledPhases: Array<{ id: string; name: string }> = [];

  for (const phase of targetPhases) {
    const participants = enrollment.get(phase.id) ?? (await getParticipants(phase.id));
    const outEntry = participants.find((p) => p.id === outPlayerId);
    // League scope only: a phase the outgoing player is not (or no longer,
    // after an interrupted run) enrolled in has nothing to move.
    if (!outEntry) continue;
    // League scope checks the roster only, and a reserve promoted by a
    // phase-scope substitution is enrolled without being on it. Rejected here,
    // before any write: the enrollment swap would fail on the primary key
    // after the matches and the group row had already moved.
    if (participants.some((p) => p.id === inPlayerId)) {
      throw new UserFacingError(`Incoming player is already enrolled in ${phase.name}`, {
        code: 'IN_ALREADY_IN_PHASE',
        params: { phase: phase.name },
      });
    }

    // The group the incoming player ends in, as swapGroupMemberInTournament
    // decides it: the outgoing player's slot, else (a re-run after the slot
    // already moved) the row the incoming player holds.
    const memberships = await getGroupMembershipsInTournament(phase.id, [outPlayerId, inPlayerId]);
    const group =
      memberships.find((row) => row.player_id === outPlayerId) ??
      memberships.find((row) => row.player_id === inPlayerId);
    if (!isLeagueScope && group?.season_group_id) {
      const slot = { group_name: group.group_name, season_group_id: group.season_group_id };
      await assertIncomingInMirroredGroup(seasonId, inPlayerId, slot, phase.name);
    }
    phaseUpdates.push({
      phase_id: phase.id,
      phase_name: phase.name,
      seed: outEntry.seed,
      group: group ? { id: group.group_id, name: group.group_name } : null,
    });
    enrolledPhases.push({ id: phase.id, name: phase.name });
  }

  const affectedMatches = await findRepairableMatches(enrolledPhases, outPlayerId);

  const summary: SubstituteSummary = {
    roster_swapped: isLeagueScope,
    phases: phaseUpdates,
    affected_matches: affectedMatches,
    matches_repaired: 0,
    matches_skipped: [],
  };

  if (dryRun) {
    return summary;
  }

  const applyLog = log ?? emptySubstituteApplyLog();
  const at = (step: SubstituteApplyStep, phaseId: string | null, matchId: string | null = null) => {
    applyLog.stopped_at = { step, phase_id: phaseId, match_id: matchId };
  };
  const touch = (phaseId: string) => {
    if (!applyLog.phases_touched.includes(phaseId)) applyLog.phases_touched.push(phaseId);
  };

  // The writes are not one transaction, so they run in an order a re-run can
  // resume from after a failure at any step: the planning above reads the
  // current state, and a step that already ran is not planned again.
  //   - Per phase, each scheduled match first has its pending proposals
  //     cancelled, then its pairing repaired: until the repair lands the
  //     match still names the outgoing player, so a re-run retries both. The
  //     repair is conditional (still scheduled, no games, the planned
  //     players): a match reported meanwhile is skipped and reported, and
  //     stays with the departed player who played it.
  //   - Then the group row is handed over (the incoming player takes the
  //     whole slot, so per-group standings and advancement count their
  //     matches; a re-run keeps a slot that already moved).
  //   - The enrollment swap (one UPDATE: seed and starting bracket stay on
  //     the row) comes last: while the outgoing player is still enrolled, a
  //     re-run plans the phase again.
  //   - The league roster swap runs last of all: until it does, a
  //     league-scope re-run passes the roster checks.
  // A second apply racing this one finds its rows gone and stops with a 409
  // (`ENROLLMENT_CHANGED`, `ROSTER_CHANGED`, `GROUP_SLOT_CHANGED`).
  for (const phase of phaseUpdates) {
    for (const match of affectedMatches.filter((m) => m.tournament_id === phase.phase_id)) {
      const next = {
        player_1_id: match.player_1_id === outPlayerId ? inPlayerId : match.player_1_id,
        player_2_id: match.player_2_id === outPlayerId ? inPlayerId : match.player_2_id,
      };

      at('proposals', phase.phase_id, match.match_id);
      const cancelled = await cancelPendingMatchProposalsForMatch(match.match_id);
      if (cancelled.length > 0) applyLog.proposals_cancelled.push(match.match_id);

      at('match', phase.phase_id, match.match_id);
      const outcome = await repairScheduledMatchPairing(
        match.match_id,
        { player_1_id: match.player_1_id, player_2_id: match.player_2_id },
        next,
      );
      if (outcome === 'repaired') {
        summary.matches_repaired += 1;
        applyLog.matches_repaired.push(match.match_id);
        touch(phase.phase_id);
      } else {
        summary.matches_skipped.push({ ...match, reason: outcome });
        applyLog.matches_skipped.push(match.match_id);
      }
    }

    // Recorded only when the step wrote (the slot moved, or stale rows of the
    // incoming player were deleted), as the step itself reports it; a step
    // that failed after deleting a stale row is recorded too, holding no group.
    at('group', phase.phase_id);
    const handOver = (groupId: string | null) => {
      applyLog.groups_handed_over.push({ phase_id: phase.phase_id, group_id: groupId });
      touch(phase.phase_id);
    };
    let group: GroupMemberSwap;
    try {
      group = await swapGroupMemberInTournament(phase.phase_id, outPlayerId, inPlayerId);
    } catch (err) {
      if (groupSwapWroteBeforeFailure(err)) handOver(null);
      throw err;
    }
    if (group.written) handOver(group.held?.group_id ?? null);

    at('enrollment', phase.phase_id);
    await swapEnrollment(phase, outPlayerId, inPlayerId);
    applyLog.enrollments_swapped.push(phase.phase_id);
    touch(phase.phase_id);
  }

  if (isLeagueScope) {
    at('roster', null);
    await swapSeasonParticipant(seasonId, outPlayerId, inPlayerId);
    applyLog.roster_swapped = true;
  }
  applyLog.stopped_at = null;

  return summary;
}

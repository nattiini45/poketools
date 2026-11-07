/**
 * The cron pass of the format engine: for every running kit league whose stages declare a calendar it fires the time
 * marks that are due and applies the deadline policies whose instant has passed. Server only.
 *
 * Everything the pass does is idempotent, so a run that overlaps another or stops half way loses nothing: a mark is an
 * event keyed `time:<stage>:<mark>` (marks are unique per stage only), a lock event of a policy has its own mark (`deadline:<stage>:<index>`), a check has a
 * dedupe key, a forfeit is a compare-and-set on the status the match was read in, and a random pick is made only for a
 * player without a submission. A league that fails is logged with its original error and the pass goes on with the next.
 *
 * Fairness and time: a run handles at most `FORMAT_CRON_LEAGUE_LIMIT` leagues and stops starting new ones after
 * `FORMAT_CRON_BUDGET_MS` of wall-clock time (the route's `maxDuration` is 300 s). The leagues are taken in a window that
 * moves on with the clock (`cronWindowStart`: consecutive runs take consecutive windows of the sorted league list), so
 * with more leagues than one run handles every league is reached within a few runs instead of the last ones never.
 * Inside a window the order rotates too (`cronOrderOffset`), so the shared backfill budget and the time budget do not
 * always favour the same leagues.
 * Each pass also fires the `action_locked` events a lost cascade or a manual lock left behind (`fireLockedActionEvents`),
 * for every running kit league, calendar or not, backfills `match_completed` for finalized matches whose event never
 * fired (a bounded sweep: `FORMAT_CRON_BACKFILL_LIMIT` per run, `FORMAT_CRON_BACKFILL_PER_LEAGUE` per league), and retries
 * the reverts that never applied (`healPendingReverts`, bounded the same way): a match that left `completed` (reset,
 * reopened, a game deleted or edited) whose current `match_completed` key is still the fired one, because the
 * `onMatchReverted` call of that moment failed and only reported it. Its grants and points would stand for a result that
 * no longer exists. The heal also visits the completed and archived kit leagues (`listKitIdleSeasonIds`), where an admin can
 * still reopen a match: only the heal runs there, never a phase, a deadline or a backfill, in a window of
 * `FORMAT_CRON_IDLE_LEAGUE_LIMIT` leagues per run that moves on with the clock, after the running leagues and within the same
 * revert budget and time budget. The limits of the repair: a match that was completed again before the retry finds the old key fired,
 * so its new completion applied nothing and the old effects stand (an admin sees the failed revert in the logs only), and a
 * match row that has been deleted cannot be reverted from here (the sweep reads matches).
 *
 * Completed rounds whose `round_end` never fired (the hook of the completion failed or was deferred) are fired by a bounded
 * sweep too (`backfillRoundEnds`: `FORMAT_CRON_ROUND_END_LIMIT` per run, `FORMAT_CRON_ROUND_END_PER_LEAGUE` per league), after
 * the match backfill, in running leagues only.
 *
 * Policies (`Stage.calendar.deadlines`):
 * - `match` / `team` on a round past its policy instant, for each match still `scheduled` or `in_progress`:
 *   `forfeit` settles it when exactly one side has no registered team (the match-linked row, else the planned one;
 *   the other side wins), else, and for
 *   `admin_review`, a `deadline_missed` check is opened for an admin.
 * - `action`: `auto_lock` locks the action, `admin_review` opens a check per player who has not submitted, and
 *   `seeded_random_pick` submits a pick drawn from the season seed for each of them (a check when none is valid). These
 *   also run for an `upcoming` phase (an action window before round 1); the other policies wait for an active phase.
 */
import 'server-only';

import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import {
  discardStagedAdminOutcome,
  finalizeMatchCompletion,
  stageAdminOutcome,
  type StagedAdminOutcome,
} from '@/lib/match/finalize';
import { StagedOutcomeBlockedError } from '@/lib/match/staged-outcome';
import { expireSeasonReads, revalidateMatchPages } from '@/lib/revalidation';
import {
  listFinalizedMatches,
  listKitCronPhases,
  listKitIdleSeasonIds,
  listKitSeasonIds,
  listUncompletedMatches,
  type KitCronPhase,
} from '@/lib/supabase/queries/format-cron';
import { FormatActionAlreadySubmittedError, FormatRuntimeError, openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { getMatchById, getMatchesByTournament, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament, listRoundStatusesByTournamentIds } from '@/lib/supabase/queries/rounds';
import { listTeamsByTournament } from '@/lib/supabase/queries/teams';
import { validateTransition } from '@/lib/tournament/match-state';
import type { DeadlinePolicy, Stage, StageCalendar } from '@/lib/format-kit/types';
import type { MatchWithPlayers } from '@/types/match';
import { expireChallenges } from '../challenge-server';
import { submitAction } from './actions-server';
import { actionFlagKey, findAction } from './actions';
import { actionPolicyAt, dueMarks, roundPolicyAt, type CalendarClock } from './calendar';
import {
  planActionCheck,
  planMatchPolicy,
  policyLockMark,
  type DeadlineCheckPlan,
  type ForfeitPlan,
} from './deadline-policy';
import { currentCompletionKeyOf, eventKey, unfiredRoundEnds } from './events';
import { fireEvent, fireLockedActionEvents } from './fire';
import { isFormatContextStale, isStaleOnly, newHookReport } from './stale';
import { onMatchCompleted, onRoundCompleted, revertMatchCompletion } from './hooks';
import { loadFreshKitContext, phaseById, rosterOf, type KitContext, type KitPhaseInfo } from './load';
import { planRandomPicks } from './random-pick';
import { hiddenGiverActions } from './views';
import { own } from './types';

const TAG = 'format-engine/cron';

/** Leagues handled by one run; the rest wait for the next. */
export const FORMAT_CRON_LEAGUE_LIMIT = 100;

/** Wall-clock time after which a run starts no further league (the route allows 300 s). */
export const FORMAT_CRON_BUDGET_MS = 240_000;

/** `match_completed` events one run backfills (see `backfillMatchCompleted`); the rest wait for the next. */
export const FORMAT_CRON_BACKFILL_LIMIT = 25;

/**
 * The share of that budget one league may take. A league whose backfill keeps failing cannot take the whole budget; with
 * several of them the rotation of the league order (`cronOrderOffset`) lets every league reach the front in turn.
 */
export const FORMAT_CRON_BACKFILL_PER_LEAGUE = 10;

/** Pending reverts one run retries; the rest wait for the next. */
export const FORMAT_CRON_REVERT_LIMIT = 25;

/** The share of that budget one league may take (a revert that keeps failing cannot take the run). */
export const FORMAT_CRON_REVERT_PER_LEAGUE = 10;

/** Matches per league and run whose completion key is checked for a pending revert; the window moves on per slot. */
export const FORMAT_CRON_REVERT_SCAN_LIMIT = 500;

/** Completed or archived leagues whose pending reverts one run checks (each costs a context load); the window moves on per slot. */
export const FORMAT_CRON_IDLE_LEAGUE_LIMIT = 10;

/** `round_end` events one run fires for completed rounds that have none (see `backfillRoundEnds`); the rest wait for the next. */
export const FORMAT_CRON_ROUND_END_LIMIT = 25;

/** The share of that budget one league may take (a round whose hook keeps failing cannot take the run). */
export const FORMAT_CRON_ROUND_END_PER_LEAGUE = 10;

/** The runs are 15 minutes apart (vercel.json); the window moves on once per slot of that length. */
const CRON_SLOT_MS = 15 * 60_000;

/**
 * Where in the sorted league list this run starts: slot n takes the window [n * limit, (n + 1) * limit), wrapping around, so
 * consecutive runs cover the list one window after the other.
 */
export function cronWindowStart(now: Date, leagues: number, limit: number = FORMAT_CRON_LEAGUE_LIMIT): number {
  if (leagues <= limit) return 0;
  const slot = Math.floor(now.getTime() / CRON_SLOT_MS);
  return (slot * limit) % leagues;
}

/**
 * Where in the window of a run the leagues are started: slot n starts at league n of the window, wrapping around. The
 * backfill budget is shared by the whole run, so a fixed order would let the first leagues with failing hooks drain it
 * every run; the rotation gives each league its turn at the front.
 */
export function cronOrderOffset(now: Date, windowSize: number): number {
  if (windowSize <= 1) return 0;
  return Math.floor(now.getTime() / CRON_SLOT_MS) % windowSize;
}

export interface FormatCronOptions {
  /** Wall-clock budget in ms; default `FORMAT_CRON_BUDGET_MS`. */
  budgetMs?: number;
  /** Wall clock in ms, for tests; default `Date.now`. */
  clock?: () => number;
}

export interface FormatCronSummary {
  leagues: number;
  /** Leagues the run left for the next one (over `FORMAT_CRON_LEAGUE_LIMIT`, or past the time budget). */
  deferred: number;
  marks: number;
  forfeits: number;
  checks: number;
  locks: number;
  picks: number;
  /** `match_completed` events fired for finalized matches that had none. */
  completions_backfilled: number;
  challenges_expired: number;
  /** Leagues (or the challenge sweep) that threw; each was logged. */
  failures: number;
}

function emptySummary(): FormatCronSummary {
  return { leagues: 0, deferred: 0, marks: 0, forfeits: 0, checks: 0, locks: 0, picks: 0, completions_backfilled: 0, challenges_expired: 0, failures: 0 };
}

interface PhaseJob {
  cron: KitCronPhase;
  phase: KitPhaseInfo;
  calendar: StageCalendar;
  clock: CalendarClock;
}

async function openCheck(seasonId: string, plan: DeadlineCheckPlan, summary: FormatCronSummary): Promise<void> {
  const id = await openFormatCheck({
    seasonId,
    source: plan.source,
    ruleId: plan.rule_id,
    dedupeKey: plan.dedupe_key,
    subject: plan.subject,
  });
  if (id !== null) {
    summary.checks += 1;
    expireSeasonReads(seasonId);
  }
}

/** The calendar marks that are due and have not fired. The context is reloaded after any fire. */
async function fireDueMarks(job: PhaseJob, ctx: KitContext, now: Date, summary: FormatCronSummary): Promise<KitContext> {
  const stage = job.phase.stage.key;
  let current = ctx;
  for (const mark of dueMarks(job.calendar, job.clock, now)) {
    const event = { event: 'time' as const, stage, mark: mark.key };
    if (current.state.firedEventKeys.includes(eventKey(event))) continue;
    const result = await fireEvent(current.seasonId, event, null);
    if (result === null || !result.fired) continue;
    summary.marks += 1;
    for (const issue of result.issues) logger.warn(TAG, 'event effect skipped', { seasonId: current.seasonId, mark: mark.key, ...issue });
    const reloaded = await loadFreshKitContext(current.seasonId);
    if (reloaded === null) return current;
    current = reloaded;
  }
  return current;
}

/** The players an action is for: those with a link of its relation, else the roster of the league. */
function actionActors(ctx: KitContext, via: string | undefined): string[] {
  if (via === undefined) return rosterOf(ctx);
  return [...new Set(ctx.state.links.filter((link) => link.relation === via).map((link) => link.from))].sort();
}

async function applyActionPolicy(
  job: PhaseJob,
  ctx: KitContext,
  policy: DeadlinePolicy,
  index: number,
  now: Date,
  summary: FormatCronSummary,
): Promise<void> {
  const actionId = policy.action;
  const rule = actionId === undefined ? null : findAction(ctx.def, actionId);
  if (actionId === undefined || rule === null) return;
  const at = actionPolicyAt(job.calendar, policy, rule, job.clock);
  if (at === null || at.getTime() > now.getTime()) return;
  const stage = job.phase.stage.key;
  const seasonId = ctx.seasonId;

  if (policy.on_miss === 'auto_lock') {
    const mark = policyLockMark(stage, index);
    if (own(ctx.state.flags, actionFlagKey(actionId)) === 'locked') return;
    if (ctx.state.firedEventKeys.includes(eventKey({ event: 'time', stage, mark }))) return;
    const result = await fireEvent(seasonId, { event: 'time', stage, mark }, null, { context: ctx, ops: [{ op: 'lock_action', action: actionId }] });
    if (result?.fired) summary.locks += 1;
    return;
  }

  const submitted = new Set(
    ctx.state.submissions.filter((s) => s.action === actionId && s.status !== 'draft').map((s) => s.actor),
  );
  const known = new Set(ctx.state.checks.map((check) => check.dedupe_key));
  const waiting = actionActors(ctx, rule.via).filter((player) => !submitted.has(player));

  for (const player of waiting) {
    const reviewPlan = planActionCheck(stage, index, actionId, player);
    if (known.has(reviewPlan.dedupe_key)) continue;
    if (policy.on_miss === 'admin_review') {
      await openCheck(seasonId, reviewPlan, summary);
      continue;
    }
    // A pick is drawn against the state as it is after the picks made before it (exclusive items taken meanwhile).
    const fresh = await loadFreshKitContext(seasonId);
    if (fresh === null) return;
    // The player may have submitted since the pass started (a pick before the close is legal with a negative offset): a
    // draw must never replace a choice the player made, so a player who now has a non-draft submission is left alone.
    if (fresh.state.submissions.some((s) => s.action === actionId && s.actor === player && s.status !== 'draft')) continue;
    const picks = planRandomPicks(fresh.def, actionId, player, fresh.state, rosterOf(fresh), fresh.seed);
    if (picks === null) {
      await openCheck(seasonId, planActionCheck(stage, index, actionId, player, 'no_valid_pick'), summary);
      continue;
    }
    // The draw was validated as the system (planRandomPicks), so the submit must be too: a domain visible to admins only
    // has no pickable entries for a player. `onlyIfUnsubmitted` closes the window the check above leaves: the database
    // refuses to overwrite a pick the player submitted after that read (under the action's lock), and the player is
    // then left alone like one who was seen submitted: no count, no audit entry, no check. A pick that was submitted AND
    // locked (`lock: 'on_submit'`) or an action locked meanwhile answers `action_locked` instead (the function checks the
    // lock first): the same case, the choice stands or the action is closed, so the loop goes on with the other players.
    // The submit carries the revision of the format it validated against, so a draw never lands in a format an admin
    // replaced or amended meanwhile (`format_context_stale`, retried by the next pass).
    let written: Awaited<ReturnType<typeof submitAction>>;
    try {
      written = await submitAction({ seasonId, actionId, actorId: player, picks, audience: 'system', onlyIfUnsubmitted: true });
    } catch (error) {
      if (error instanceof FormatActionAlreadySubmittedError) continue;
      if (error instanceof FormatRuntimeError && error.code === 'action_locked') continue;
      // The format changed (attached again, amended, switched) or a concurrent grant took the last free unit between the
      // draw and the write: the draw was made for a state that no longer exists. The player is still waiting, so the next
      // pass draws again against the new one; nothing is counted or audited now.
      if (error instanceof FormatRuntimeError && (error.code === 'format_context_stale' || error.code === 'resource_capacity_reached')) {
        logger.warn(TAG, 'random pick skipped, the format or the holding changed meanwhile', { seasonId, action: actionId, code: error.code });
        continue;
      }
      throw error;
    }
    if (written.ok) {
      summary.picks += 1;
      // A pick the cron drew is indistinguishable from the player's own in the submission row, so it is recorded here. Like
      // the player's own submit, it names no giver when a relation still hides them (every site admin reads this log).
      const giverHidden = hiddenGiverActions(fresh).has(actionId);
      logAuditEvent({
        actor_id: null,
        actor_name: 'System',
        action: 'season.format.action.auto_pick',
        resource_type: 'season',
        resource_id: seasonId,
        metadata: {
          via: 'seeded_random_pick',
          action_id: actionId,
          pick_count: picks.length,
          ...(giverHidden ? { giver_hidden: true } : { player_id: player }),
        },
      });
      continue;
    }
    logger.warn(TAG, 'random pick refused', { seasonId, action: actionId, issues: written.issues.map((issue) => issue.code) });
    await openCheck(seasonId, planActionCheck(stage, index, actionId, player, written.issues[0]?.code ?? 'pick_refused'), summary);
  }
}

/**
 * The status write did not complete the match: the outcome staged before it describes a forfeit that never happened. It
 * stays when its status is unknown (`current` null: the write may have committed). A match completed by now was
 * completed by another writer: an admin result rewrote the row, a player's confirmation (no admin intent) kept our
 * forfeit row; `staged` identifies our own row so exactly that one goes (and the played row takes its place). Without a
 * handle a completed match's row is left alone. Best effort, logged.
 */
async function unstageForfeit(
  matchId: string,
  current: { status: string } | null,
  staged: StagedAdminOutcome | null
): Promise<void> {
  if (current === null || (current.status === 'completed' && staged === null)) return;
  try {
    await discardStagedAdminOutcome(matchId, staged);
  } catch (error) {
    logger.error(TAG, 'could not remove the staged outcome of a forfeit that did not complete', { matchId, error });
  }
}

/**
 * The forfeit of one match: the loser is the side without a team, the winner the other. The status write is a
 * compare-and-set on the status the match was read in, so a result that landed meanwhile wins.
 */
async function applyForfeit(
  job: PhaseJob,
  plan: ForfeitPlan,
  match: MatchWithPlayers,
  status: 'scheduled' | 'in_progress',
  summary: FormatCronSummary,
): Promise<void> {
  const transition = validateTransition(status, 'completed', {
    actor_id: 'system',
    is_admin: true,
    winner_id: plan.winnerId,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
  });
  if (!transition.valid) {
    logger.warn(TAG, 'forfeit transition refused', { matchId: match.id, error: transition.error });
    return;
  }
  // The system's outcome row goes in BEFORE the status flip: a completed match must never lack the forfeit (the heal
  // would write a played row for it). A failed write leaves the match as it was; the next pass retries it.
  const adminOutcome = { kind: 'forfeit' as const, reason: plan.reason, setBy: null };
  let staged: StagedAdminOutcome | null;
  try {
    staged = (await stageAdminOutcome(match.id, adminOutcome)) ?? null;
  } catch (error) {
    if (error instanceof StagedOutcomeBlockedError) {
      // A replay-tie disputed the match since it was read: its unresolved row is the dispute's, no forfeit happens.
      logger.info(TAG, 'the match was disputed meanwhile; no forfeit', { matchId: match.id });
      return;
    }
    summary.failures += 1;
    logger.error(TAG, 'could not write the forfeit outcome; the match stays as it is', { matchId: match.id, error });
    return;
  }
  let updated: Awaited<ReturnType<typeof updateMatchStatus>>;
  try {
    updated = await updateMatchStatus(match.id, 'completed', plan.winnerId, undefined, undefined, status);
  } catch (error) {
    // The write threw, so it may have committed: a completed match may be this pass's own, whose row stays.
    const current = await getMatchById(match.id).catch(() => null);
    await unstageForfeit(match.id, current, current?.status === 'completed' ? null : staged);
    throw error;
  }
  if (updated === null) {
    // The compare-and-set missed: a result landed meanwhile and owns the row; the forfeit never happened.
    await unstageForfeit(match.id, await getMatchById(match.id).catch(() => null), staged);
    return;
  }
  await revalidateMatchPages(match.tournament_id, match.id);
  logAuditEvent({
    actor_id: null,
    actor_name: 'System',
    action: 'match.admin_result',
    resource_type: 'match',
    resource_id: match.id,
    resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
    changes: { status: { before: status, after: 'completed' }, winner_id: { before: match.winner_id, after: plan.winnerId } },
    metadata: { via: 'deadline_policy', outcome: 'forfeit', tournament_id: match.tournament_id, loser_id: plan.loserId, reason: plan.reason, stage: job.phase.stage.key },
  });
  const finalize = await finalizeMatchCompletion({
    match: { ...match, winner_id: plan.winnerId, status: 'completed' },
    winnerId: plan.winnerId,
    previousStatus: status,
    adminOutcome,
  });
  if (!finalize.finalized || (finalize.failed_steps ?? []).length > 0) {
    logger.error(TAG, 'finalize of a deadline forfeit is incomplete; the auto-confirm heal retries it', {
      matchId: match.id,
      reason: finalize.reason ?? null,
      steps: finalize.failed_steps ?? [],
    });
  }
  summary.forfeits += 1;
}

async function applyRoundPolicy(
  job: PhaseJob,
  ctx: KitContext,
  policy: DeadlinePolicy,
  index: number,
  now: Date,
  summary: FormatCronSummary,
): Promise<void> {
  const rounds = await getRoundsByTournament(job.phase.id);
  const due = rounds.filter((round) => {
    const at = roundPolicyAt(job.calendar, policy, round.round_number, job.clock, round.deadline);
    return at !== null && at.getTime() <= now.getTime();
  });
  if (due.length === 0) return;

  const [matches, teams] = await Promise.all([getMatchesByTournament(job.phase.id), listTeamsByTournament(job.phase.id)]);
  const stage = job.phase.stage.key;
  const known = new Set(ctx.state.checks.map((check) => check.dedupe_key));
  for (const round of due) {
    for (const match of matches) {
      if (match.round_id !== round.id || (match.status !== 'scheduled' && match.status !== 'in_progress')) continue;
      // The team a player brings to a match is the row linked to it, else their planned row (no match): the rule of
      // `getPlayerTeamForMatch`, which the team audit, the broadcast and the cast use. Rows linked to other matches do not count.
      const teamed = new Set(teams.filter((team) => team.match_id === match.id || team.match_id === null).map((team) => team.player_id));
      if (policy.applies === 'team' && teamed.has(match.player_1_id) && teamed.has(match.player_2_id)) continue;
      const plan = planMatchPolicy({
        stage,
        policyIndex: index,
        policy,
        round: round.round_number,
        match: { id: match.id, player_1_id: match.player_1_id, player_2_id: match.player_2_id },
        teamed,
      });
      if (plan.kind === 'check') {
        if (!known.has(plan.check.dedupe_key)) await openCheck(ctx.seasonId, plan.check, summary);
      } else {
        await applyForfeit(job, plan.forfeit, match, match.status, summary);
      }
    }
  }
}

/** How much a pass has changed so far: the context only needs a reload when this moved (or a policy threw). */
const appliedCount = (summary: FormatCronSummary): number => summary.marks + summary.forfeits + summary.checks + summary.locks + summary.picks;

async function runPhase(job: PhaseJob, ctx: KitContext, now: Date, summary: FormatCronSummary): Promise<KitContext> {
  let current = await fireDueMarks(job, ctx, now, summary);
  // An action window can sit before round 1, in a phase that stays `upcoming` until it has a round (a gift phase). Its
  // policies therefore run for an upcoming phase too; match, team and round policies need rounds and wait until the phase
  // is active. The index stays the policy's position in the whole list: it is part of every check and lock key.
  const active = job.cron.status === 'active';
  const policies = job.calendar.deadlines;
  for (let index = 0; index < policies.length; index += 1) {
    const policy = policies[index];
    if (!active && policy.applies !== 'action') continue;
    const before = appliedCount(summary);
    let failed = false;
    try {
      if (policy.applies === 'action') await applyActionPolicy(job, current, policy, index, now, summary);
      else await applyRoundPolicy(job, current, policy, index, now, summary);
    } catch (error) {
      failed = true;
      summary.failures += 1;
      logger.error(TAG, 'deadline policy failed', { seasonId: current.seasonId, stage: job.phase.stage.key, policy: index, error });
    }
    // The next policy reads the state this one may have changed; a policy that applied nothing changed nothing.
    if (!failed && appliedCount(summary) === before) continue;
    const reloaded = await loadFreshKitContext(current.seasonId);
    if (reloaded !== null) current = reloaded;
  }
  return current;
}

/** Matches a pass may still backfill, reverts it may still retry and round ends it may still fire; shared by every league of the pass. */
interface BackfillBudget {
  left: number;
  reverts: number;
  roundEnds: number;
}

/**
 * The finalized matches of a league's phases whose `match_completed` event never fired: the hook ran while the league
 * was not (yet) on the kit engine, or its failure was only logged. `onMatchCompleted` is idempotent by event key, so a
 * match swept twice applies once. At most `FORMAT_CRON_BACKFILL_PER_LEAGUE` matches per league and what is left of the
 * run's budget are handled, oldest finish first (`listFinalizedMatches`). A match whose hook fails stays missing and is
 * tried again by the next run, except for its team audit: once the event fired the match is no longer missing, so the
 * audit's transient failure is retried once right away and then reported as an `audit_unavailable` check (the heal never
 * sees a finalized match). If even opening that check fails (the check RPC is down for both calls), nothing retries the
 * audit: the run counts a failure and logs it, and an admin has to look at the match. Returns whether anything fired (the
 * context is stale then).
 */
async function backfillMatchCompleted(ctx: KitContext, budget: BackfillBudget, summary: FormatCronSummary): Promise<boolean> {
  if (budget.left <= 0 || ctx.phases.length === 0) return false;
  const finalized = await listFinalizedMatches(ctx.phases.map((phase) => phase.id));
  const fired = new Set(ctx.state.firedEventKeys);
  const keyOf = currentCompletionKeyOf(ctx.state.firedEventKeys);
  const missing = finalized.filter((match) => !fired.has(keyOf(match.id))).slice(0, Math.min(budget.left, FORMAT_CRON_BACKFILL_PER_LEAGUE));
  let applied = false;
  for (const match of missing) {
    budget.left -= 1;
    // A league on the kit engine is a custom league (`isKitCandidate`).
    const input = {
      tournament: { id: match.tournament_id, season_id: ctx.seasonId, season_format_type: 'custom' as const },
      matchId: match.id,
      roundId: match.round_id,
      player1Id: match.player_1_id,
      player2Id: match.player_2_id,
      winnerId: match.winner_id,
    };
    // The hook is idempotent by key, so the second call repeats only what failed.
    // A hook refused only because the format changed meanwhile (`format_context_stale`) is not retried at once and not a failure:
    // it wrote nothing and used no key, so the next run backfills the match against the current format.
    const report = newHookReport();
    const ok =
      (await onMatchCompleted({ ...input, auditRetry: 'always', report })) ||
      (!isStaleOnly(report) && (await onMatchCompleted({ ...input, auditRetry: 'never', report })));
    if (ok) {
      summary.completions_backfilled += 1;
      applied = true;
    } else if (isStaleOnly(report)) {
      logger.warn(TAG, 'match_completed backfill skipped, the format changed meanwhile; it is tried again next run', { seasonId: ctx.seasonId, matchId: match.id });
    } else {
      summary.failures += 1;
      // A hook that failed before its event key was logged is tried again by the next run; one that failed after it (a team
      // audit whose check could not even be opened) is no longer missing, so this log is the only trace of it.
      logger.error(TAG, 'match_completed backfill failed; it is tried again next run only while its event has not fired', { seasonId: ctx.seasonId, matchId: match.id });
    }
  }
  return applied;
}

/**
 * The completed rounds of a league whose `round_end` event never fired: the hook of the completion
 * (`PATCH rounds/[rid]`, `onRoundCompleted`) failed, was refused because the format changed meanwhile, or was deferred behind
 * a `match_completed` that had not fired (the match backfill above runs first in the pass, so a deferral is usually settled
 * by the time this sweep looks). `unfiredRoundEnds` picks one round per (stage, round number), earliest first; at most
 * `FORMAT_CRON_ROUND_END_PER_LEAGUE` rounds per league and what is left of the run's budget are handled. The hook is
 * idempotent by key and runs the stage's `end_when` after the event, so a repeat applies nothing twice. A round the hook
 * still defers is not a failure and is looked at again next run. Returns whether anything was handled (the context is
 * stale then).
 */
async function backfillRoundEnds(ctx: KitContext, budget: BackfillBudget, summary: FormatCronSummary): Promise<boolean> {
  if (budget.roundEnds <= 0 || ctx.phases.length === 0) return false;
  const rounds = await listRoundStatusesByTournamentIds(ctx.phases.map((phase) => phase.id));
  const stageOfPhase = new Map(ctx.phases.map((phase) => [phase.id, phase.stage.key]));
  const missing = unfiredRoundEnds(stageOfPhase, rounds, ctx.state.firedEventKeys).slice(0, Math.min(budget.roundEnds, FORMAT_CRON_ROUND_END_PER_LEAGUE));
  let applied = false;
  for (const round of missing) {
    budget.roundEnds -= 1;
    // A league on the kit engine is a custom league (`isKitCandidate`).
    const report = newHookReport();
    const ok = await onRoundCompleted({
      tournament: { id: round.tournament_id, season_id: ctx.seasonId, season_format_type: 'custom' as const },
      roundId: round.id,
      report,
    });
    if (ok) {
      applied = true;
      logger.info(TAG, 'a pending round_end was fired', { seasonId: ctx.seasonId, roundId: round.id });
    } else if (isStaleOnly(report)) {
      logger.warn(TAG, 'round_end backfill skipped, the format changed meanwhile; it is tried again next run', { seasonId: ctx.seasonId, roundId: round.id });
    } else if (report.failed) {
      summary.failures += 1;
      logger.error(TAG, 'round_end backfill failed; it is tried again next run while its event has not fired', { seasonId: ctx.seasonId, roundId: round.id });
    } else {
      logger.info(TAG, 'round_end still deferred behind a match_completed; it is tried again next run', { seasonId: ctx.seasonId, roundId: round.id });
    }
  }
  return applied;
}

/**
 * The matches whose current `match_completed` key (`currentCompletionKeyOf`) has fired: a completion that no revert has taken
 * back. Sorted by id so the scan window is stable between runs.
 */
export function currentlyCompletedMatchIds(firedKeys: readonly string[]): string[] {
  const keyOf = currentCompletionKeyOf(firedKeys);
  const ids = new Set<string>();
  for (const key of firedKeys) {
    const found = /^match_completed:([^:]+)(?::\d+)?$/.exec(key);
    if (found !== null && keyOf(found[1]) === key) ids.add(found[1]);
  }
  return [...ids].sort();
}

/**
 * Retries the reverts that never applied. A match whose current `match_completed` key is fired while the match is not
 * completed is one whose `match_reverted` event is missing (a successful revert advances the generation, so the key it
 * reverted is no longer the current one). `revertMatchCompletion` is idempotent per key, so a call that overlaps the
 * original one, or repeats, applies nothing twice; each match is read again right before it, so one completed again in
 * the meantime is left alone. The scan covers `FORMAT_CRON_REVERT_SCAN_LIMIT` matches per league and run in a window
 * that moves on per slot, and at most `FORMAT_CRON_REVERT_PER_LEAGUE` reverts per league and what is left of the run's
 * budget are made. With `scanAll` (a completed or archived league) every candidate is scanned instead: such a league is
 * visited only every few slots, so its slot parity is fixed and a slot-keyed window could land on the same offset at every
 * visit and never reach part of a large league; the scan is a chunked indexed read and the window of idle leagues is small. A failed revert counts a failure and is tried again by the next run. Returns whether anything was
 * reverted (the context is stale then).
 */
async function healPendingReverts(
  ctx: KitContext,
  now: Date,
  budget: BackfillBudget,
  summary: FormatCronSummary,
  scanAll: boolean = false,
): Promise<boolean> {
  if (budget.reverts <= 0 || ctx.phases.length === 0) return false;
  const candidates = currentlyCompletedMatchIds(ctx.state.firedEventKeys);
  if (candidates.length === 0) return false;
  const start = scanAll ? 0 : cronWindowStart(now, candidates.length, FORMAT_CRON_REVERT_SCAN_LIMIT);
  const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
  const scanned = scanAll ? rotated : rotated.slice(0, FORMAT_CRON_REVERT_SCAN_LIMIT);
  const pending = (await listUncompletedMatches(ctx.phases.map((phase) => phase.id), scanned)).slice(
    0,
    Math.min(budget.reverts, FORMAT_CRON_REVERT_PER_LEAGUE),
  );
  let applied = false;
  for (const row of pending) {
    budget.reverts -= 1;
    const current = await getMatchById(row.id).catch(() => null);
    // Gone, or completed again since the read: the revert of the old completion is no longer this pass's to make.
    if (current === null || current.status === 'completed') continue;
    const report = newHookReport();
    if (await revertMatchCompletion({ tournamentId: row.tournament_id, matchId: row.id, report })) {
      applied = true;
      logger.info(TAG, 'a pending match_reverted was applied', { seasonId: ctx.seasonId, matchId: row.id });
    } else if (isStaleOnly(report)) {
      // The format changed after this pass loaded it: nothing was written, the next run retries. Not a failure.
      logger.warn(TAG, 'match_reverted retry skipped, the format changed meanwhile; it is tried again next run', { seasonId: ctx.seasonId, matchId: row.id });
    } else {
      summary.failures += 1;
      logger.error(TAG, 'match_reverted retry failed; it is tried again next run', { seasonId: ctx.seasonId, matchId: row.id });
    }
  }
  return applied;
}

/**
 * A completed or archived league: nothing runs there but the pending-revert heal (a match reopened after the season closed
 * whose revert failed would otherwise keep its grants and points for ever).
 */
async function runIdleLeague(seasonId: string, now: Date, summary: FormatCronSummary, budget: BackfillBudget): Promise<void> {
  const ctx = await loadFreshKitContext(seasonId);
  if (ctx === null) return;
  await healPendingReverts(ctx, now, budget, summary, true);
}

async function runLeague(
  seasonId: string,
  crons: readonly KitCronPhase[],
  now: Date,
  summary: FormatCronSummary,
  budget: BackfillBudget,
): Promise<void> {
  let ctx = await loadFreshKitContext(seasonId);
  if (ctx === null) return;
  // A lock whose `action_locked` event never fired (crash after the lock, a manual lock whose event failed).
  if ((await fireLockedActionEvents(seasonId, null, { context: ctx })).length > 0) {
    const reloaded = await loadFreshKitContext(seasonId);
    if (reloaded === null) return;
    ctx = reloaded;
  }
  if (await healPendingReverts(ctx, now, budget, summary)) {
    const reloaded = await loadFreshKitContext(seasonId);
    if (reloaded === null) return;
    ctx = reloaded;
  }
  if (await backfillMatchCompleted(ctx, budget, summary)) {
    const reloaded = await loadFreshKitContext(seasonId);
    if (reloaded === null) return;
    ctx = reloaded;
  }
  // After the match backfill: a round whose event was deferred behind a missing `match_completed` is ready now.
  if (await backfillRoundEnds(ctx, budget, summary)) {
    const reloaded = await loadFreshKitContext(seasonId);
    if (reloaded === null) return;
    ctx = reloaded;
  }
  for (const cron of crons) {
    const phase = phaseById(ctx, cron.id);
    const stage: Stage | undefined = phase?.stage;
    if (phase === undefined || stage?.calendar === undefined) continue;
    const job: PhaseJob = { cron, phase, calendar: stage.calendar, clock: { seasonStart: cron.season_start_date } };
    ctx = await runPhase(job, ctx, now, summary);
  }
}

/**
 * One pass over the running kit leagues, plus the expiry of open challenges (which needs no calendar). Never throws: a
 * failure is logged and counted in `failures`.
 */
export async function runFormatCronPass(now: Date = new Date(), options: FormatCronOptions = {}): Promise<FormatCronSummary> {
  const summary = emptySummary();
  const clock = options.clock ?? Date.now;
  const deadline = clock() + (options.budgetMs ?? FORMAT_CRON_BUDGET_MS);
  const bySeason = new Map<string, KitCronPhase[]>();
  try {
    for (const phase of await listKitCronPhases()) bySeason.set(phase.season_id, [...(bySeason.get(phase.season_id) ?? []), phase]);
  } catch (error) {
    summary.failures += 1;
    logger.error(TAG, 'could not list the running leagues', { error });
  }
  try {
    // A league without a calendar has no phase to run, but its lost lock events and completions are repaired too.
    for (const seasonId of await listKitSeasonIds()) if (!bySeason.has(seasonId)) bySeason.set(seasonId, []);
  } catch (error) {
    summary.failures += 1;
    logger.error(TAG, 'could not list the running leagues without a calendar', { error });
  }
  const backfill: BackfillBudget = { left: FORMAT_CRON_BACKFILL_LIMIT, reverts: FORMAT_CRON_REVERT_LIMIT, roundEnds: FORMAT_CRON_ROUND_END_LIMIT };

  const sorted = [...bySeason.keys()].sort();
  const start = cronWindowStart(now, sorted.length);
  const taken = [...sorted.slice(start), ...sorted.slice(0, start)].slice(0, FORMAT_CRON_LEAGUE_LIMIT);
  const offset = cronOrderOffset(now, taken.length);
  const window = [...taken.slice(offset), ...taken.slice(0, offset)];
  summary.deferred = sorted.length - window.length;
  if (summary.deferred > 0) logger.warn(TAG, 'more leagues than one run handles', { leagues: sorted.length, limit: FORMAT_CRON_LEAGUE_LIMIT, start });
  for (const [position, seasonId] of window.entries()) {
    if (clock() >= deadline) {
      summary.deferred += window.length - position;
      logger.warn(TAG, 'time budget used up; the remaining leagues wait for the next run', { handled: summary.leagues, left: window.length - position });
      break;
    }
    summary.leagues += 1;
    try {
      await runLeague(seasonId, bySeason.get(seasonId) ?? [], now, summary, backfill);
    } catch (error) {
      if (isFormatContextStale(error)) {
        // An admin replaced or amended the format after this pass loaded it: the event that was planned for the old one
        // was refused before it was logged, so the next pass plans it again against the current format. Not a failure.
        logger.warn(TAG, 'the format changed during the pass; the league is retried next pass', { seasonId });
      } else {
        summary.failures += 1;
        logger.error(TAG, 'league cron pass failed', { seasonId, error });
      }
    }
  }

  // The completed and archived leagues come last: the heal only, in a small window, while revert budget and time are left.
  let idle: string[] = [];
  try {
    const running = new Set(bySeason.keys());
    idle = (await listKitIdleSeasonIds()).filter((seasonId) => !running.has(seasonId)).sort();
  } catch (error) {
    summary.failures += 1;
    logger.error(TAG, 'could not list the completed or archived leagues', { error });
  }
  const idleStart = cronWindowStart(now, idle.length, FORMAT_CRON_IDLE_LEAGUE_LIMIT);
  const idleWindow = [...idle.slice(idleStart), ...idle.slice(0, idleStart)].slice(0, FORMAT_CRON_IDLE_LEAGUE_LIMIT);
  for (const seasonId of idleWindow) {
    if (backfill.reverts <= 0 || clock() >= deadline) break;
    try {
      await runIdleLeague(seasonId, now, summary, backfill);
    } catch (error) {
      if (isFormatContextStale(error)) {
        logger.warn(TAG, 'the format changed during the pass; the league is retried next pass', { seasonId });
      } else {
        summary.failures += 1;
        logger.error(TAG, 'completed league revert heal failed', { seasonId, error });
      }
    }
  }

  try {
    summary.challenges_expired = await expireChallenges(null);
  } catch (error) {
    summary.failures += 1;
    logger.error(TAG, 'could not expire challenges', { error });
  }
  return summary;
}

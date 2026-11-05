/**
 * The cron pass of the format engine: for every running kit league whose stages declare a calendar it fires the time
 * marks that are due and applies the deadline policies whose instant has passed. Server only.
 *
 * Everything the pass does is idempotent, so a run that overlaps another or stops half way loses nothing: a mark is an
 * event keyed `time:<mark>`, a lock event of a policy has its own mark (`deadline:<stage>:<index>`), a check has a
 * dedupe key, a forfeit is a compare-and-set on the status the match was read in, and a random pick is made only for a
 * player without a submission. A league that fails is logged with its original error and the pass goes on with the next.
 *
 * Policies (`Stage.calendar.deadlines`):
 * - `match` / `team` on a round past its policy instant, for each match still `scheduled` or `in_progress`:
 *   `forfeit` settles it when exactly one side has no registered team (the other side wins), else, and for
 *   `admin_review`, a `deadline_missed` check is opened for an admin.
 * - `action`: `auto_lock` locks the action, `admin_review` opens a check per player who has not submitted, and
 *   `seeded_random_pick` submits a pick drawn from the season seed for each of them (a check when none is valid).
 */
import 'server-only';

import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { expireSeasonReads, revalidateMatchPages } from '@/lib/revalidation';
import { listKitCronPhases, type KitCronPhase } from '@/lib/supabase/queries/format-cron';
import { openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { getMatchesByTournament, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
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
import { eventKey } from './events';
import { fireEvent } from './fire';
import { loadFreshKitContext, phaseById, rosterOf, type KitContext, type KitPhaseInfo } from './load';
import { planRandomPicks } from './random-pick';
import { own } from './types';

const TAG = 'format-engine/cron';

/** Leagues handled by one run; the rest wait for the next. */
export const FORMAT_CRON_LEAGUE_LIMIT = 100;

export interface FormatCronSummary {
  leagues: number;
  /** Leagues the run left for the next one (over `FORMAT_CRON_LEAGUE_LIMIT`). */
  deferred: number;
  marks: number;
  forfeits: number;
  checks: number;
  locks: number;
  picks: number;
  challenges_expired: number;
  /** Leagues (or the challenge sweep) that threw; each was logged. */
  failures: number;
}

function emptySummary(): FormatCronSummary {
  return { leagues: 0, deferred: 0, marks: 0, forfeits: 0, checks: 0, locks: 0, picks: 0, challenges_expired: 0, failures: 0 };
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
    const picks = planRandomPicks(fresh.def, actionId, player, fresh.state, rosterOf(fresh), fresh.seed);
    if (picks === null) {
      await openCheck(seasonId, planActionCheck(stage, index, actionId, player, 'no_valid_pick'), summary);
      continue;
    }
    const written = await submitAction({ seasonId, actionId, actorId: player, picks });
    if (written.ok) {
      summary.picks += 1;
      continue;
    }
    logger.warn(TAG, 'random pick refused', { seasonId, action: actionId, issues: written.issues.map((issue) => issue.code) });
    await openCheck(seasonId, planActionCheck(stage, index, actionId, player, written.issues[0]?.code ?? 'pick_refused'), summary);
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
  const updated = await updateMatchStatus(match.id, 'completed', plan.winnerId, undefined, undefined, status);
  if (updated === null) return;
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
    adminOutcome: { kind: 'forfeit', reason: plan.reason, setBy: null },
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
      const teamed = new Set(teams.filter((team) => team.match_id === match.id).map((team) => team.player_id));
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

async function runPhase(job: PhaseJob, ctx: KitContext, now: Date, summary: FormatCronSummary): Promise<KitContext> {
  let current = await fireDueMarks(job, ctx, now, summary);
  if (job.cron.status !== 'active') return current;
  const policies = job.calendar.deadlines;
  for (let index = 0; index < policies.length; index += 1) {
    const policy = policies[index];
    try {
      if (policy.applies === 'action') await applyActionPolicy(job, current, policy, index, now, summary);
      else await applyRoundPolicy(job, current, policy, index, now, summary);
    } catch (error) {
      summary.failures += 1;
      logger.error(TAG, 'deadline policy failed', { seasonId: current.seasonId, stage: job.phase.stage.key, policy: index, error });
    }
    const reloaded = await loadFreshKitContext(current.seasonId);
    if (reloaded !== null) current = reloaded;
  }
  return current;
}

async function runLeague(seasonId: string, crons: readonly KitCronPhase[], now: Date, summary: FormatCronSummary): Promise<void> {
  let ctx = await loadFreshKitContext(seasonId);
  if (ctx === null) return;
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
export async function runFormatCronPass(now: Date = new Date()): Promise<FormatCronSummary> {
  const summary = emptySummary();
  const bySeason = new Map<string, KitCronPhase[]>();
  try {
    for (const phase of await listKitCronPhases()) bySeason.set(phase.season_id, [...(bySeason.get(phase.season_id) ?? []), phase]);
  } catch (error) {
    summary.failures += 1;
    logger.error(TAG, 'could not list the running leagues', { error });
  }

  const seasons = [...bySeason.keys()].sort();
  summary.deferred = Math.max(0, seasons.length - FORMAT_CRON_LEAGUE_LIMIT);
  if (summary.deferred > 0) logger.warn(TAG, 'more leagues than one run handles', { leagues: seasons.length, limit: FORMAT_CRON_LEAGUE_LIMIT });
  for (const seasonId of seasons.slice(0, FORMAT_CRON_LEAGUE_LIMIT)) {
    summary.leagues += 1;
    try {
      await runLeague(seasonId, bySeason.get(seasonId) ?? [], now, summary);
    } catch (error) {
      summary.failures += 1;
      logger.error(TAG, 'league cron pass failed', { seasonId, error });
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

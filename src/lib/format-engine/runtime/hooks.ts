/**
 * The points where the league's own writes feed the format runtime: a match completes, a round is generated, a phase
 * starts or completes, a replay ends in an engine tie. Every hook is best effort: it does nothing for a league that is
 * not a custom league on the `kit` engine, and a failure is logged with its original error and never throws into the
 * caller, so the write that triggered it always stands. The hooks whose effects must not be lost (`onMatchCompleted`)
 * report whether they applied: the match finalize turns a `false` into a failed step, so the marker stays unset and the
 * auto-confirm heal calls the hook again. Events are idempotent by key, so a retry or a heal that calls a hook again
 * applies nothing twice. Server only.
 */
import 'server-only';

import { logger } from '@/lib/logger';
import { expireSeasonReads } from '@/lib/revalidation';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import type { Json } from '@/types/database';
import type { FormatOp } from '@/lib/supabase/queries/format-runtime';
import type { Tournament } from '@/types/tournament';
import type { KitRuntimeState } from './types';
import { planChecks, type CheckPlan } from './checks';
import { openChecks, resolveCheck } from './checks-server';
import { eventKey } from './events';
import { isKitCandidate, type HookTournament } from '../kit-candidate';
import { fireEvent } from './fire';
import { isFormatContextStale, type HookReport } from './stale';
import { matchContext, playerContext } from './expr-env';
import { envBaseOf, loadFreshKitContext, phaseById, type KitContext, type KitPhaseInfo } from './load';
import { loadStageTable, playerRowsOf } from './stage-table';
import { auditMatchTeams, type AuditRetry } from './team-audit-server';
import { planTrackProgress } from './tracks';

const TAG = 'format-engine/hooks';

export { isKitCandidate, type HookTournament, type HookReport };

/** Runs one hook step; true when it completed, false when it threw (logged with the original error). */
async function guarded(step: string, meta: Record<string, unknown>, run: () => Promise<void>, report?: HookReport): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    // The format was replaced or amended after this hook loaded it: nothing was written, and the caller's heal (or the
    // next hook call) plans the step again against the current format. Not an error of the code.
    if (isFormatContextStale(error)) {
      if (report !== undefined) report.stale = true;
      logger.warn(TAG, `format runtime hook skipped, the format changed meanwhile; it is retried: ${step}`, { ...meta });
      return false;
    }
    if (report !== undefined) report.failed = true;
    logger.error(TAG, `format runtime hook failed: ${step}`, { ...meta, error });
    return false;
  }
}

/**
 * `match_completed` fires once per key, and a result that is reset and played again is a new completion. The key of the
 * n-th completion of a match is `match_completed:<id>` for n = 0 and `match_completed:<id>:<n>` after, where n counts
 * the `match_reverted:<id>:*` events (`onMatchReverted`) fired before it.
 */
function completionGeneration(firedKeys: readonly string[], matchId: string): number {
  const prefix = `match_reverted:${matchId}:`;
  return firedKeys.filter((key) => key.startsWith(prefix)).length;
}

function completionMatchId(matchId: string, generation: number): string {
  return generation === 0 ? matchId : `${matchId}:${generation}`;
}

async function open(seasonId: string, checks: readonly CheckPlan[]): Promise<void> {
  if (checks.length > 0) await openChecks(seasonId, checks);
}

export interface MatchCompletedInput {
  tournament: HookTournament;
  matchId: string;
  roundId: string;
  player1Id: string;
  player2Id: string;
  winnerId: string;
  /**
   * What a transient failure of the team audit does (`AuditRetry`): by default it is retried by the caller's heal while
   * the match is recent. The cron backfill, which the heal never sees, asks for `always` first and `never` on its repeat.
   */
  auditRetry?: AuditRetry;
  /** Filled when the hook resolves false (`HookReport`). */
  report?: HookReport;
}

/**
 * A match completed: fire `match_completed` with the track progress of both players in the same transaction, and open
 * the checks whose expression is true for the match (and an `unresolved_outcome` check if its outcome is unresolved).
 * A match that was completed, reverted (`onMatchReverted`) and completed again fires its event again.
 *
 * Then audit the teams the match was played with (`auditMatchTeams`): a side that broke the stage's team constraints,
 * differs from the replay or could not be audited gets a `team_audit` check. The audit runs apart from the event, so a
 * failure of one does not skip the other (both are idempotent by key), and before the stage can end.
 *
 * Resolves true when the event, the checks, the audit and the stage end (`end_when`) were applied or there was nothing to
 * apply (not a kit league), false when a step failed (logged). The match finalize treats false as a failed step, so the heal calls this again;
 * the audit bounds its own retries (`AUDIT_RETRY_WINDOW_MS`).
 */
export async function onMatchCompleted(input: MatchCompletedInput): Promise<boolean> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return true;
  const loaded: { value: { ctx: KitContext; phase: KitPhaseInfo } | null } = { value: null };
  const applied = await guarded('match completed', { matchId: input.matchId, tournamentId: tournament.id }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
    if (ctx === null || phase === undefined) return;
    loaded.value = { ctx, phase };
    const [round, outcome] = await Promise.all([getRoundById(input.roundId), getMatchOutcome(input.matchId)]);
    const roundNumber = round?.round_number ?? 0;
    const forfeit = outcome?.kind === 'forfeit' || outcome?.kind === 'no_show';
    const base = envBaseOf(ctx, `match:${input.matchId}`);
    const sides = [
      { playerId: input.player1Id, opponent: input.player2Id, dealt: outcome?.p2_faints, taken: outcome?.p1_faints },
      { playerId: input.player2Id, opponent: input.player1Id, dealt: outcome?.p1_faints, taken: outcome?.p2_faints },
    ].map((side) => ({
      playerId: side.playerId,
      ctx: matchContext(base, side.playerId, {
        round: roundNumber,
        won: input.winnerId === side.playerId,
        lost: input.winnerId !== side.playerId,
        forfeit,
        faints_dealt: side.dealt ?? 0,
        faints_taken: side.taken ?? 0,
        opponent: side.opponent,
      }),
    }));

    const tracks = planTrackProgress(ctx.def, { stage: phase.stage.key, players: sides }, ctx.state);
    for (const issue of tracks.issues) logger.warn(TAG, 'track step could not be evaluated', { matchId: input.matchId, ...issue });
    const generation = completionGeneration(ctx.state.firedEventKeys, input.matchId);
    const fired = await fireEvent(
      tournament.season_id,
      {
        event: 'match_completed',
        stage: phase.stage.key,
        round: roundNumber,
        match_id: completionMatchId(input.matchId, generation),
        players: [input.player1Id, input.player2Id],
      },
      null,
      { context: ctx, ops: tracks.ops },
    );
    for (const issue of fired?.issues ?? []) logger.warn(TAG, 'event effect skipped', { matchId: input.matchId, ...issue });

    const checks: CheckPlan[] = [];
    if (outcome?.kind === 'unresolved') {
      checks.push(
        ...planChecks(ctx.def, {
          source: 'unresolved_outcome',
          matchId: input.matchId,
          players: [input.player1Id, input.player2Id],
          generation,
        }).checks,
      );
    }
    const exprChecks = planChecks(ctx.def, {
      source: 'expr',
      of: 'match',
      subjects: sides.map((side) => ({ id: input.matchId, ctx: side.ctx })),
      generation,
    });
    for (const issue of exprChecks.issues) logger.warn(TAG, 'check expression failed', { matchId: input.matchId, ...issue });
    checks.push(...exprChecks.checks);
    await open(tournament.season_id, checks);
  }, input.report);
  const ready = loaded.value;
  let audited = true;
  if (ready !== null) {
    const generation = completionGeneration(ready.ctx.state.firedEventKeys, input.matchId);
    audited = await guarded('team audit', { matchId: input.matchId, tournamentId: tournament.id }, async () => {
      await auditMatchTeams({
        tournament,
        matchId: input.matchId,
        roundId: input.roundId,
        player1Id: input.player1Id,
        player2Id: input.player2Id,
        generation,
        context: ready.ctx,
        retry: input.auditRetry,
      });
    }, input.report);
  }
  // A stage end that failed is a failed step like the others: the phase would stay active with nothing left to re-evaluate
  // `end_when` (the cron does not), while the heal's re-run completes it (`completePhaseAtStageEnd` is compare-and-set). A
  // failure after the phase flipped (the `stage_end` event, the tie checks) is retried the same way: the re-run finds the
  // phase completed and repeats the reaction, which is idempotent by event and check keys.
  let stageEnded = true;
  if (ready !== null && ready.phase.stage.end_when !== undefined) {
    stageEnded = await endStageIfDone(tournament, ready.ctx, ready.phase, input.roundId, input.report);
  }
  return applied && audited && stageEnded;
}

/** The ops that undo logged ops, and the names of the logged ops that cannot be undone. */
export interface InverseOps {
  ops: FormatOp[];
  irreversible: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What undoes the ops an event logged (`format_event_log.ops`): a granted item is revoked, awarded points are taken back
 * with a negative adjustment. Every other op overwrote state whose earlier value is not logged (a flag, an attribute, a
 * relation, an action's state) or only ever moves one way (a track step), so it is listed as irreversible and left as
 * it is: re-firing the event sets it again. Pure.
 */
export function inverseOps(logged: Json | undefined): InverseOps {
  const out: InverseOps = { ops: [], irreversible: [] };
  if (!Array.isArray(logged)) return out;
  for (const entry of logged) {
    if (!isRecord(entry) || typeof entry.op !== 'string') continue;
    if (
      entry.op === 'grant_item' &&
      typeof entry.resource === 'string' &&
      typeof entry.player_id === 'string' &&
      (typeof entry.item_id === 'string' || entry.item_id === null) &&
      typeof entry.amount === 'number'
    ) {
      out.ops.push({ op: 'revoke_item', resource: entry.resource, player_id: entry.player_id, item_id: entry.item_id, amount: entry.amount });
    } else if (
      entry.op === 'adjust_points' &&
      typeof entry.stage === 'string' &&
      typeof entry.player_id === 'string' &&
      typeof entry.points === 'number' &&
      typeof entry.reason === 'string'
    ) {
      out.ops.push({
        op: 'adjust_points',
        stage: entry.stage,
        player_id: entry.player_id,
        points: -entry.points,
        reason: `reverted: ${entry.reason}`.slice(0, 500),
      });
    } else {
      out.irreversible.push(entry.op);
    }
  }
  return out;
}

export interface MatchRevertedInput {
  tournament: HookTournament;
  matchId: string;
  /** Filled when the hook resolves false (`HookReport`). */
  report?: HookReport;
}

/** Whether `check` is a per-match check of the completion `generation` of the match: its team audit, an unresolved outcome or a match-level expression. */
function isMatchCheckOfGeneration(check: KitRuntimeState['checks'][number], matchId: string, generation: number): boolean {
  switch (check.source) {
    case 'team_audit':
      return check.dedupe_key.startsWith(`team_audit:${matchId}:${generation}:`);
    case 'unresolved_outcome':
      return check.dedupe_key === `unresolved:${matchId}:${generation}`;
    case 'expr':
      return check.dedupe_key.endsWith(`:${matchId}:${generation}`);
    default:
      return false;
  }
}

/**
 * Rejects the still-open per-match checks (`team_audit`, `unresolved_outcome`, match-level `expr`) of the completion that
 * is being reverted, so no admin reviews a team, a dispute or a rule hit of a result that no longer exists. A confirmed or
 * rejected check is left alone. Logs each failure; true when all closed.
 */
async function closeMatchChecks(seasonId: string, matchId: string, generation: number, checks: KitRuntimeState['checks']): Promise<boolean> {
  let allClosed = true;
  for (const check of checks) {
    if (check.status !== 'open' || !isMatchCheckOfGeneration(check, matchId, generation)) continue;
    try {
      await resolveCheck({ seasonId, checkId: check.id, status: 'rejected', adminId: null, note: 'match_reset' });
    } catch (error) {
      allClosed = false;
      logger.error(TAG, 'format runtime hook failed: match check close', { matchId, checkId: check.id, source: check.source, error });
    }
  }
  return allClosed;
}

/** Whether the completion `generation` of the match has a per-match check in any state (its key is taken). */
function hasMatchChecks(checks: KitRuntimeState['checks'], matchId: string, generation: number): boolean {
  return checks.some((check) => isMatchCheckOfGeneration(check, matchId, generation));
}

/**
 * A completed match left `completed` (reset, reopened, a game deleted or edited): take back what its `match_completed`
 * event applied (`inverseOps`) and log `match_reverted:<id>:<n>` in the same transaction, which makes the next
 * completion of the match a new event (`onMatchCompleted`). A match that never fired the event has nothing to take back,
 * but when its audit, its unresolved outcome or a match-level expression already opened checks the generation advances
 * all the same (the new completion or dispute opens its checks afresh). The still-open per-match checks of the old
 * generation are rejected first; when one cannot be closed the revert event does not fire (the generation stays, and a
 * retry closes what is left: the close is idempotent). Best effort and logged inside; resolves false when it failed (the
 * callers report it as a failed `format` step). A failed revert is retried by the format cron (`healPendingReverts`) only
 * for a match that completed: the match is not completed while its current `match_completed` key is still fired. A match
 * that never completed (a disputed one that is reopened) has no such key, so the cron never revisits it: its stale open
 * check stays until the call is repeated or an admin resolves the check by hand. This call is idempotent per key, so the
 * cron's call and the original one cannot apply twice.
 */
export async function onMatchReverted(input: MatchRevertedInput): Promise<boolean> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return true;
  const auditsClosed = { value: true };
  const reverted = await guarded('match reverted', { matchId: input.matchId, tournamentId: tournament.id }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    if (ctx === null) return;
    const generation = completionGeneration(ctx.state.firedEventKeys, input.matchId);
    // Before the early return below: the audit can have succeeded while the `match_completed` fire failed. A check that
    // stays open ends the call: advancing the generation would leave it without a retry (the cron heal only looks at
    // matches whose current completion key is still fired, and the next call reads the new generation's keys).
    auditsClosed.value = await closeMatchChecks(tournament.season_id, input.matchId, generation, ctx.state.checks);
    if (!auditsClosed.value) {
      if (input.report !== undefined) input.report.failed = true;
      return;
    }
    const completedKey = eventKey({ event: 'match_completed', match_id: completionMatchId(input.matchId, generation) });
    const { fireFormatEvent, getFormatRuntime } = await import('@/lib/supabase/queries/format-runtime');
    if (!ctx.state.firedEventKeys.includes(completedKey)) {
      // The check keys of this generation exist (closed above, or decided by an admin), and a check opens once per key: the
      // next completion or dispute would be deduplicated against them and never shown. Advance the generation without
      // effects to take back. Without such a check nothing happened that a new completion could collide with.
      if (hasMatchChecks(ctx.state.checks, input.matchId, generation)) {
        await fireFormatEvent({
          seasonId: tournament.season_id,
          eventKey: `match_reverted:${input.matchId}:${generation + 1}`,
          event: 'match_reverted',
          payload: { match_id: input.matchId, reverts: completedKey },
          ops: [],
          firedBy: null,
          revision: ctx.revision,
        });
        expireSeasonReads(tournament.season_id, ctx.phases.map((phase) => phase.id));
      }
      return;
    }
    const runtime = await getFormatRuntime(tournament.season_id);
    const logged = runtime.eventLog.find((row) => row.event_key === completedKey);
    const inverse = inverseOps(logged?.ops);
    await fireFormatEvent({
      seasonId: tournament.season_id,
      eventKey: `match_reverted:${input.matchId}:${generation + 1}`,
      event: 'match_reverted',
      payload: { match_id: input.matchId, reverts: completedKey },
      ops: inverse.ops,
      firedBy: null,
      revision: ctx.revision,
    });
    expireSeasonReads(tournament.season_id, ctx.phases.map((phase) => phase.id));
    if (inverse.irreversible.length > 0) {
      logger.warn(TAG, 'match_completed effects that cannot be taken back stay in place', {
        matchId: input.matchId,
        tournamentId: tournament.id,
        ops: [...new Set(inverse.irreversible)],
      });
    }
  }, input.report);
  return reverted && auditsClosed.value;
}

/**
 * The stage's `end_when`, evaluated when the last open match of a round completes: when it holds, the phase completes
 * through the same sequence as an admin's status change. Loaded on demand, so a stage without `end_when` costs nothing.
 *
 * The facts are read from a context loaded now, after this match's `match_completed` event fired: its points count, and
 * the round's other matches count as open until their own event fired (`StageEndCheck.openInRound`), so the phase never
 * ends while a sibling's `match_completed` effects are still missing. That sibling's own hook (or the heal's re-run of
 * it) evaluates `end_when` again once its event is in.
 */
async function endStageIfDone(
  tournament: HookTournament & { season_id: string },
  stale: KitContext,
  phase: KitPhaseInfo,
  roundId: string,
  report?: HookReport,
): Promise<boolean> {
  return guarded('stage end', { tournamentId: tournament.id }, async () => {
    const { checkStageEnd } = await import('./stage-end-server');
    const ctx = (await loadFreshKitContext(stale.seasonId)) ?? stale;
    const check = await checkStageEnd(ctx, phaseById(ctx, phase.id) ?? phase, roundId);
    if (check === null || check.openInRound > 0) return;
    if (check.issue !== undefined) {
      logger.warn(TAG, 'end_when could not be evaluated', { tournamentId: tournament.id, stage: phase.stage.key, issue: check.issue });
      return;
    }
    if (!check.met) return;
    const { completePhaseAtStageEnd } = await import('./phase-complete');
    const result = await completePhaseAtStageEnd(tournament.id, `end_when:${phase.stage.key}`);
    // The phase is completed but its reaction did not apply: a failed step, so the heal's re-run repeats the reaction.
    if (result === 'reaction_failed') throw new Error('the stage end reaction of the completed phase did not apply');
  }, report);
}

/** A replay ended in an engine tie and the match was disputed: open the `unresolved_outcome` checks. */
export async function onMatchUnresolved(input: { tournament: HookTournament; matchId: string; player1Id: string; player2Id: string }): Promise<void> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return;
  await guarded('match unresolved', { matchId: input.matchId, tournamentId: tournament.id }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    if (ctx === null) return;
    const generation = completionGeneration(ctx.state.firedEventKeys, input.matchId);
    const plan = planChecks(ctx.def, {
      source: 'unresolved_outcome',
      matchId: input.matchId,
      players: [input.player1Id, input.player2Id],
      generation,
    });
    await open(tournament.season_id, plan.checks);
  });
}

export interface RoundGeneratedInput {
  tournament: HookTournament;
  roundNumber: number;
  /** Swiss pairings that repeat an earlier pairing. */
  rematches: number;
  /** The phase was `upcoming` before this round: it starts now. */
  startsPhase: boolean;
}

/**
 * A round was generated: `stage_start` when it opens the phase, then `round_start`, and a rematch check if needed.
 *
 * The first-round gate (`firstRoundGap`) treats a relation as drawn when a `stage_start` effect draws it right after the
 * round, and it never looks again once the round exists, so a `stage_start` that failed would leave the relation undrawn
 * with nothing to retry it. The start is therefore tried twice (the event is idempotent by key); if it still fails, that
 * is logged as an error that names the way out (a manual `draw` adjustment of the relation), and the round goes on.
 */
export async function onRoundGenerated(input: RoundGeneratedInput): Promise<void> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return;
  if (input.startsPhase) {
    const start = { tournament, from: 'upcoming', to: 'active' } as const;
    if (!(await onPhaseStatusChanged(start)) && !(await onPhaseStatusChanged(start))) {
      logger.error(
        TAG,
        'stage_start did not apply for the first round: relations its rules draw stay undrawn until an admin draws them with a manual relation adjustment',
        { tournamentId: tournament.id, seasonId: tournament.season_id },
      );
    }
  }
  await guarded('round generated', { tournamentId: tournament.id, round: input.roundNumber }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
    if (ctx === null || phase === undefined) return;
    const fired = await fireEvent(tournament.season_id, { event: 'round_start', stage: phase.stage.key, round: input.roundNumber }, null, { context: ctx });
    for (const issue of fired?.issues ?? []) logger.warn(TAG, 'event effect skipped', { tournamentId: tournament.id, ...issue });
    if (input.rematches > 0) {
      const plan = planChecks(ctx.def, { source: 'pairing_rematch', stage: phase.stage.key, round: input.roundNumber, rematches: input.rematches });
      await open(tournament.season_id, plan.checks);
    }
  });
}

/** Whether every phase of the stage is completed: always for an ordinary stage, the phase itself being completed. */
async function stageEnded(ctx: KitContext, phase: KitPhaseInfo): Promise<boolean> {
  if (phase.stage.foreach_group === undefined) return true;
  const siblings = ctx.phases.filter((other) => other.stage.key === phase.stage.key && other.id !== phase.id);
  const rows = await Promise.all(siblings.map((sibling) => getTournamentById(sibling.id)));
  return rows.every((row) => row === null || row.status === 'completed');
}

export interface PhaseStatusInput {
  tournament: HookTournament;
  from: string;
  to: string;
}

/**
 * A phase changed status. `upcoming -> active` fires `stage_start`; a move to `completed` fires `stage_end` and opens
 * the standings tie checks (rows still tied behind a decision match) and the expression checks over players.
 * Resolves true when it applied or there was nothing to apply, false when a step failed (logged, never thrown): the
 * stage-end path turns a false into a failed step; the other callers ignore it.
 */
export async function onPhaseStatusChanged(input: PhaseStatusInput): Promise<boolean> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return true;
  const started = input.from === 'upcoming' && input.to === 'active';
  const completed = input.to === 'completed' && input.from !== 'completed';
  if (!started && !completed) return true;
  return guarded('phase status', { tournamentId: tournament.id, from: input.from, to: input.to }, async () => {
    let ctx: KitContext | null = await loadFreshKitContext(tournament.season_id);
    const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
    if (ctx === null || phase === undefined) return;
    const stage = phase.stage.key;
    // A stage that repeats per group ends with its last group phase; its start is the first phase's (the key fires once).
    if (started || (await stageEnded(ctx, phase))) {
      const fired = await fireEvent(tournament.season_id, { event: started ? 'stage_start' : 'stage_end', stage }, null, { context: ctx });
      for (const issue of fired?.issues ?? []) logger.warn(TAG, 'event effect skipped', { tournamentId: tournament.id, ...issue });
    }
    if (!completed) return;

    ctx = await loadFreshKitContext(tournament.season_id);
    if (ctx === null) return;
    const table = await loadStageTable(ctx, tournament.id);
    if (table === null) return;
    const ties = planChecks(ctx.def, { source: 'standings_tie', stage, table });
    const base = envBaseOf(ctx, `stage_end:${stage}`);
    const rows = playerRowsOf(table);
    const players = planChecks(ctx.def, {
      source: 'expr',
      of: 'player',
      subjects: table.map((row) => ({ id: row.player_id, ctx: playerContext(base, row.player_id, rows[row.player_id], table.length) })),
    });
    for (const issue of players.issues) logger.warn(TAG, 'check expression failed', { tournamentId: tournament.id, ...issue });
    await open(tournament.season_id, [...ties.checks, ...players.checks]);
  });
}

/**
 * `onMatchReverted` for a caller that holds the ids only (the reopen route): reads the tournament first. Resolves true
 * when the league runs no kit format or the revert applied, false when a read or the revert failed (logged).
 */
export async function revertMatchCompletion(input: { tournamentId: string; matchId: string; report?: HookReport }): Promise<boolean> {
  let tournament: Tournament | null;
  try {
    tournament = await getTournamentById(input.tournamentId);
  } catch (error) {
    if (input.report !== undefined) input.report.failed = true;
    logger.error(TAG, 'format runtime hook failed: match reverted (tournament read)', { tournamentId: input.tournamentId, matchId: input.matchId, error });
    return false;
  }
  return tournament === null ? true : onMatchReverted({ tournament, matchId: input.matchId, report: input.report });
}

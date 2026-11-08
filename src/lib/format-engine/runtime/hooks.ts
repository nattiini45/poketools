/**
 * The points where the league's own writes feed the format runtime: a match completes, a round is generated, a phase
 * starts, completes or ends a round, a replay ends in an engine tie. Every hook is best effort: it does nothing for a league that is
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
import { getRoundById, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import type { Json } from '@/types/database';
import type { FormatOp } from '@/lib/supabase/queries/format-runtime';
import type { Tournament } from '@/types/tournament';
import type { KitRuntimeState } from './types';
import { planChecks, type CheckPlan } from './checks';
import { openChecks, resolveCheck } from './checks-server';
import { currentCompletionKeyOf, eventKey } from './events';
import { isKitCandidate, type HookTournament } from '../kit-candidate';
import { fireEvent } from './fire';
import { isFormatContextStale, type HookReport } from './stale';
import { matchContext, playerContext } from './expr-env';
import { currentHolder, holderOfLoggedSeat, revokesToCurrentHolders, SEAT_MOVED_EVENT, seatMovesOf } from './seat-succession';
import { envBaseOf, loadFreshKitContext, phaseById, phasesOfStageKey, type KitContext, type KitPhaseInfo } from './load';
import { loadStageTable, playerRowsOf } from './stage-table';
import { auditMatchTeams, type AuditRetry } from './team-audit-server';
import { planTrackProgress } from './tracks';

const TAG = 'format-engine/hooks';

export { isKitCandidate, type HookTournament, type HookReport };

/**
 * Runs one hook step; true when it completed, false when it threw (logged with the original error). `retry` runs the step a
 * second time right away when the first attempt threw (the step loads its own context, so the second attempt plans against
 * the format as it is then): for the steps that nothing repeats later (`stage_start`, `stage_end`, `round_start`, the dispute
 * check, the stage end after a round). A step that has a heal or a cron backfill (`match_completed`, `match_reverted`,
 * `round_end`) leaves the retry to it. Every step is idempotent by event or check key, so a second attempt repeats only
 * what is missing.
 */
async function guarded(
  step: string,
  meta: Record<string, unknown>,
  run: () => Promise<void>,
  report?: HookReport,
  retry: boolean = false,
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await run();
      return true;
    } catch (error) {
      if (retry && attempt === 0) {
        logger.warn(TAG, `format runtime hook step failed, trying once more: ${step}`, { ...meta, stale: isFormatContextStale(error) });
        continue;
      }
      // The format was replaced or amended after this hook loaded it: nothing was written. A hook with a heal or a cron
      // backfill is planned again against the current format by that; the others have just tried twice. Not an error of the code.
      if (isFormatContextStale(error)) {
        if (report !== undefined) report.stale = true;
        logger.warn(TAG, `format runtime hook skipped, the format changed meanwhile: ${step}`, { ...meta });
        return false;
      }
      if (report !== undefined) report.failed = true;
      logger.error(TAG, `format runtime hook failed: ${step}`, { ...meta, error });
      return false;
    }
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

/**
 * The track steps as they were before the earlier completions of this match: a `set_track` those events logged is taken back
 * out of the state when the player stands exactly on the step it set (the step is only ever raised, so a revert cannot lower
 * it, and replaying the same match would otherwise climb one step more from the same win). A player who is on another step
 * got there some other way and is left alone. A seat that moved since is looked up under its current holder. The earlier events are read from the event log (rare: a replayed match only).
 */
async function tracksBeforeEarlierCompletions(
  seasonId: string,
  matchId: string,
  generation: number,
  tracks: KitRuntimeState['tracks'],
): Promise<KitRuntimeState['tracks']> {
  const { getFormatRuntime } = await import('@/lib/supabase/queries/format-runtime');
  const runtime = await getFormatRuntime(seasonId);
  const moves = seatMovesOf(runtime.eventLog);
  const keys = new Set(Array.from({ length: generation }, (_, n) => eventKey({ event: 'match_completed', match_id: completionMatchId(matchId, n) })));
  const out: Record<string, Record<string, number>> = {};
  for (const [player, steps] of Object.entries(tracks)) out[player] = { ...steps };
  for (const row of runtime.eventLog) {
    if (!keys.has(row.event_key) || !Array.isArray(row.ops)) continue;
    for (const entry of row.ops) {
      if (!isRecord(entry) || entry.op !== 'set_track' || typeof entry.player_id !== 'string' || typeof entry.track !== 'string' || typeof entry.step !== 'number') continue;
      // A substitution moved the step to the substitute while the log keeps naming the player who left.
      const held = out[holderOfLoggedSeat(entry.player_id, row, moves)];
      if (held !== undefined && held[entry.track] === entry.step) held[entry.track] = entry.step - 1;
    }
  }
  return out;
}

/** Opens the planned checks under the revision of the context they were planned from (a stale one opens nothing). */
async function open(seasonId: string, checks: readonly CheckPlan[], revision: number): Promise<void> {
  if (checks.length > 0) await openChecks(seasonId, checks, revision);
}

/**
 * The players who hold the seats of `playerIds` now. A substitution leaves a match that has games (or that changed) with the
 * player who left on its row, and the format data of that seat belongs to the substitute (`seat-succession.ts`): when such a
 * match completes, its effects (grants, points, track steps, the player scope of its checks) are planned for the holder, not for
 * a player who has no seat. The event log is read only when it holds a seat move, so a league that never substituted pays nothing.
 * A seat move the log cannot place throws, so the caller reports a failed step and the heal plans it again.
 */
async function seatHoldersNow(seasonId: string, firedKeys: readonly string[], playerIds: readonly string[]): Promise<string[]> {
  if (!firedKeys.some((key) => key.startsWith(`${SEAT_MOVED_EVENT}:`))) return [...playerIds];
  const { getFormatRuntime } = await import('@/lib/supabase/queries/format-runtime');
  const moves = seatMovesOf((await getFormatRuntime(seasonId)).eventLog);
  return playerIds.map((id) => currentHolder(id, 0, moves));
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
    // The sides are the players who hold the seats now (a substitute for a player who left): the match row may still name the
    // one who left. Who won and who lost is read from the row's own ids.
    const [holder1, holder2] = await seatHoldersNow(tournament.season_id, ctx.state.firedEventKeys, [input.player1Id, input.player2Id]);
    const sides = [
      { playerId: holder1, opponent: holder2, won: input.winnerId === input.player1Id, dealt: outcome?.p2_faints, taken: outcome?.p1_faints },
      { playerId: holder2, opponent: holder1, won: input.winnerId === input.player2Id, dealt: outcome?.p1_faints, taken: outcome?.p2_faints },
    ].map((side) => ({
      playerId: side.playerId,
      ctx: matchContext(base, side.playerId, {
        round: roundNumber,
        won: side.won,
        lost: !side.won,
        forfeit,
        faints_dealt: side.dealt ?? 0,
        faints_taken: side.taken ?? 0,
        opponent: side.opponent,
      }),
    }));

    const generation = completionGeneration(ctx.state.firedEventKeys, input.matchId);
    // A replay of a match that completed before must not climb a track a second time for the same match: the earlier
    // completions' steps stay (the database only raises a step), so the steps they set are taken out of the state the plan reads.
    const trackState = generation === 0 ? ctx.state : { tracks: await tracksBeforeEarlierCompletions(tournament.season_id, input.matchId, generation, ctx.state.tracks) };
    const tracks = planTrackProgress(ctx.def, { stage: phase.stage.key, players: sides }, trackState);
    for (const issue of tracks.issues) logger.warn(TAG, 'track step could not be evaluated', { matchId: input.matchId, ...issue });
    const fired = await fireEvent(
      tournament.season_id,
      {
        event: 'match_completed',
        stage: phase.stage.key,
        round: roundNumber,
        match_id: completionMatchId(input.matchId, generation),
        players: [holder1, holder2],
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
          players: [holder1, holder2],
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
    await open(tournament.season_id, checks, ctx.revision);
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

/** Whether `payload.skipped_grants` (the grants `format_fire_event` skipped in a race) lists this grant: it was never applied. */
function wasSkipped(payload: Json | undefined, grant: { resource: string; player_id: string; item_id: string | null }): boolean {
  const skipped = isRecord(payload) ? payload.skipped_grants : undefined;
  return (
    Array.isArray(skipped) &&
    skipped.some((entry) => isRecord(entry) && entry.resource === grant.resource && entry.player_id === grant.player_id && (entry.item_id ?? null) === grant.item_id)
  );
}

/**
 * What undoes the ops an event logged (`format_event_log.ops`): a granted item is revoked, awarded points are taken back
 * with a negative adjustment. A grant the event's own transaction skipped (`payload.skipped_grants`, a concurrent writer took
 * the item or the capacity first) was never applied and is not revoked. A revoke names the grant it undoes (`source`,
 * `source_ref`), so a database that honours them takes back that row rather than another source's. Every other op overwrote
 * state whose earlier value is not logged (a flag, an attribute, a relation, an action's state) or only ever moves one way
 * (a track step: a replay of the same match does not climb it again, see `tracksBeforeEarlierCompletions`), so it is listed as
 * irreversible and left as it is. Pure.
 */
export function inverseOps(logged: Json | undefined, payload?: Json): InverseOps {
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
      if (wasSkipped(payload, { resource: entry.resource, player_id: entry.player_id, item_id: entry.item_id })) continue;
      const revoke = {
        op: 'revoke_item' as const,
        resource: entry.resource,
        player_id: entry.player_id,
        item_id: entry.item_id,
        amount: entry.amount,
        ...(typeof entry.source === 'string' ? { source: entry.source, source_ref: typeof entry.source_ref === 'string' ? entry.source_ref : null } : {}),
      };
      out.ops.push(revoke);
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
 * A league that left the `kit` engine keeps its runtime rows, so a match completed under the kit still has its effects
 * applied when it is reset under another engine, and nothing takes them back (the hook has no kit context). Throws, so the
 * caller reports the failed step, when the format is attached and the current `match_completed` key of the match is fired.
 */
async function assertNoAppliedCompletionOffKit(seasonId: string, matchId: string): Promise<void> {
  const { getSeasonFormat } = await import('@/lib/supabase/queries/season-formats');
  const format = await getSeasonFormat(seasonId);
  if (format === null) return;
  const { getFormatRuntime } = await import('@/lib/supabase/queries/format-runtime');
  const keys = (await getFormatRuntime(seasonId)).eventLog.map((row) => row.event_key);
  const generation = completionGeneration(keys, matchId);
  if (!keys.includes(eventKey({ event: 'match_completed', match_id: completionMatchId(matchId, generation) }))) return;
  throw new Error(
    `the effects of the completion of match ${matchId} are still applied: the league runs the ${format.engine} engine, so they cannot be taken back until it is switched back to kit`,
  );
}

/**
 * A revert that finds the match disputed after a replay tie (an unresolved outcome) opens its dispute check under the new
 * generation: the dispute was opened while the revert was pending, under the generation the revert has just closed.
 */
async function reopenDisputeCheck(seasonId: string, matchId: string, generation: number, ctx: KitContext): Promise<void> {
  try {
    const { getMatchById } = await import('@/lib/supabase/queries/matches');
    const [match, outcome] = await Promise.all([getMatchById(matchId), getMatchOutcome(matchId)]);
    if (match === null || match.status !== 'disputed' || outcome?.kind !== 'unresolved') return;
    const plan = planChecks(ctx.def, {
      source: 'unresolved_outcome',
      matchId,
      players: await seatHoldersNow(seasonId, ctx.state.firedEventKeys, [match.player_1_id, match.player_2_id]),
      generation,
    });
    await open(seasonId, plan.checks, ctx.revision);
  } catch (error) {
    // The revert itself applied; failing it now would send the heal after a generation that has already advanced.
    logger.error(TAG, 'the dispute check of a match reverted while disputed could not be opened again', { seasonId, matchId, error });
  }
}

/**
 * A completed match left `completed` (reset, reopened, a game deleted or edited): take back what its `match_completed`
 * event applied (`inverseOps`) and log `match_reverted:<id>:<n>` in the same transaction, which makes the next
 * completion of the match a new event (`onMatchCompleted`). A match that never fired the event has nothing to take back,
 * but when its audit, its unresolved outcome or a match-level expression already opened checks the generation advances
 * all the same (the new completion or dispute opens its checks afresh). The still-open per-match checks of the old
 * generation are rejected first; when one cannot be closed the revert event does not fire (the generation stays, and a
 * retry closes what is left: the close is idempotent). A substitution since the completion moved the seat's items to the
 * substitute, so the revokes follow the seat to its current holder (`revokesToCurrentHolders`). Best effort and logged inside; resolves false when it failed (the
 * callers report it as a failed `format` step). A failed revert is retried by the format cron (`healPendingReverts`) only
 * for a match that completed: the match is not completed while its current `match_completed` key is still fired. A match
 * that never completed (a disputed one that is reopened) has no such key, so the cron never revisits it: its stale open
 * check stays until the call is repeated or an admin resolves the check by hand. This call is idempotent per key, so the
 * cron's call and the original one cannot apply twice.
 *
 * The revert is not one transaction: the checks are closed first and the generation advances after. Until it does (a failed
 * revert waiting for the heal), a result entered again completes under the OLD generation: its effects do not apply (the key
 * is fired) and its team audit and expression checks meet the closed rows of that generation, so they open nothing. A
 * replay that ends in a tie in that window opens its dispute check under the old generation too, which the heal then closes
 * with the rest: a revert that finds the match disputed with an unresolved outcome therefore opens the dispute check again
 * under the new generation. The league's runtime rows outlive an engine switch, so a league that is not on the `kit` engine
 * any more fails the revert (reported to the caller) when the match's completion is still applied: switch the engine back
 * and reset the match again, or let the cron heal it.
 */
export async function onMatchReverted(input: MatchRevertedInput): Promise<boolean> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return true;
  const auditsClosed = { value: true };
  const reverted = await guarded('match reverted', { matchId: input.matchId, tournamentId: tournament.id }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    if (ctx === null) {
      await assertNoAppliedCompletionOffKit(tournament.season_id, input.matchId);
      return;
    }
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
        await reopenDisputeCheck(tournament.season_id, input.matchId, generation + 1, ctx);
      }
      return;
    }
    const runtime = await getFormatRuntime(tournament.season_id);
    const logged = runtime.eventLog.find((row) => row.event_key === completedKey);
    const inverse = inverseOps(logged?.ops, logged?.payload);
    // A substitution after the completion moved the seat's items to the substitute (`seat-succession.ts`): the revokes land
    // on the player who holds the seat now. A seat move the log cannot place throws, so the caller sees a failed revert.
    const revokes = revokesToCurrentHolders(inverse.ops, logged, seatMovesOf(runtime.eventLog));
    await fireFormatEvent({
      seasonId: tournament.season_id,
      eventKey: `match_reverted:${input.matchId}:${generation + 1}`,
      event: 'match_reverted',
      payload: { match_id: input.matchId, reverts: completedKey },
      ops: revokes,
      firedBy: null,
      revision: ctx.revision,
    });
    expireSeasonReads(tournament.season_id, ctx.phases.map((phase) => phase.id));
    await reopenDisputeCheck(tournament.season_id, input.matchId, generation + 1, ctx);
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
  retry: boolean = false,
): Promise<boolean> {
  return guarded('stage end', { tournamentId: tournament.id }, async () => {
    const { checkStageEnd } = await import('./stage-end-server');
    // A null context means the league left the kit engine (or lost its format) since the hook loaded `stale`: a kit-only
    // `end_when` must not end a phase of a league that no longer runs the kit, so nothing is evaluated from the old context.
    const ctx = await loadFreshKitContext(stale.seasonId);
    if (ctx === null) return;
    const check = await checkStageEnd(ctx, phaseById(ctx, phase.id) ?? phase, roundId);
    if (check === null || check.openInRound > 0) return;
    if (check.issue !== undefined) {
      logger.warn(TAG, 'end_when could not be evaluated', { tournamentId: tournament.id, stage: phase.stage.key, issue: check.issue });
      return;
    }
    if (!check.met) return;
    const { completePhaseAtStageEnd } = await import('./phase-complete');
    const result = await completePhaseAtStageEnd(tournament.id, `end_when:${phase.stage.key}`, check.unfinishedMatchIds);
    // The phase is completed but its reaction did not apply: a failed step, so the heal's re-run repeats the reaction.
    if (result === 'reaction_failed') throw new Error('the stage end reaction of the completed phase did not apply');
  }, report, retry);
}

export interface RoundCompletedInput {
  tournament: HookTournament;
  roundId: string;
  /** Filled when the hook resolves false (`HookReport`). */
  report?: HookReport;
}

/**
 * What stands between a completed round and its `round_end` event, over every phase of the stage (a `foreach_group` stage
 * runs one phase per group under one event key): `waiting` while a peer phase's round of that number is not completed yet
 * (that phase's own completion fires the event), `deferred` while a match of any of those rounds completed with a winner and
 * its `match_completed` event has not fired (the effects of the round's matches must exist first; the finalize heal or the
 * cron backfill fires it, and the cron's round-end sweep comes back), else `ready`. A peer without a round of that number
 * does not hold the event.
 */
async function roundEndReadiness(ctx: KitContext, phase: KitPhaseInfo, round: { id: string; round_number: number }): Promise<'ready' | 'waiting' | 'deferred'> {
  const { getMatchesByTournament } = await import('@/lib/supabase/queries/matches');
  const fired = new Set(ctx.state.firedEventKeys);
  const keyOf = currentCompletionKeyOf(ctx.state.firedEventKeys);
  let waiting = false;
  for (const peer of phasesOfStageKey(ctx, phase.stage.key)) {
    let roundId = round.id;
    if (peer.id !== phase.id) {
      const peerRound = (await getRoundsByTournament(peer.id)).find((entry) => entry.round_number === round.round_number);
      if (peerRound === undefined) continue;
      if (peerRound.status !== 'completed') {
        waiting = true;
        continue;
      }
      roundId = peerRound.id;
    }
    const matches = await getMatchesByTournament(peer.id);
    const awaiting = matches.some((match) => match.round_id === roundId && match.status === 'completed' && match.winner_id !== null && !fired.has(keyOf(match.id)));
    if (awaiting) return 'deferred';
  }
  return waiting ? 'waiting' : 'ready';
}

/**
 * A round was completed (`PATCH /api/tournaments/[id]/rounds/[rid]`, with or without `force`): fire `round_end` for the
 * stage and round number, then evaluate the stage's `end_when`. The event fires once per (stage, round) like every other
 * (`round_end:<stage>:<n>`), after the effects of the round's own matches exist (`roundEndReadiness`), over a context loaded
 * now and revision-checked by `fireEvent`, so a stale format raises before the key is logged and the key stays free for a
 * retry. A round that is no longer completed when the hook runs (a match was reset and `revertRoundIfCompleted` reopened it)
 * fires nothing; a round reopened and completed again does not fire a second time, and the effects of the first stand.
 *
 * Completing a round changes the facts `end_when` reads (`rounds_played` counts a completed round, a force-completed one
 * with its unplayed matches included, and `checkStageEnd` treats that round's leftovers as settled), so the stage end is
 * evaluated here too, after the event: the round's effects (points) exist before the phase completes and advances its
 * players. Without it the last open match of a stage could never be played and no completed match would be left to
 * evaluate the condition.
 *
 * Resolves true when the event and the stage end applied or there was nothing to apply, false when a step failed (logged)
 * or the event is deferred behind a missing `match_completed` (not a failure: nothing is set in `report`). A false is
 * repaired by the format cron (`backfillRoundEnds`): it finds the completed round whose event has not fired and calls this
 * again, which repeats only what is missing. A stage end that failed after the event fired has no such trigger (the key is
 * used up): it is tried twice right away, then logged as an error, and the next completed match or an admin completing the
 * phase by hand settles it. A lock cascade that fails after the event committed does not fail the event (`fireEvent`), so it
 * never skips the stage end.
 */
export async function onRoundCompleted(input: RoundCompletedInput): Promise<boolean> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return true;
  const outcome: { phase: KitPhaseInfo | null; ctx: KitContext | null; deferred: boolean } = { phase: null, ctx: null, deferred: false };
  const applied = await guarded('round completed', { roundId: input.roundId, tournamentId: tournament.id }, async () => {
    const [round, ctx] = await Promise.all([getRoundById(input.roundId), loadFreshKitContext(tournament.season_id)]);
    const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
    if (ctx === null || phase === undefined || round === null || round.tournament_id !== tournament.id || round.status !== 'completed') return;
    const readiness = await roundEndReadiness(ctx, phase, round);
    if (readiness === 'deferred') {
      outcome.deferred = true;
      logger.info(TAG, 'round_end deferred: a completed match of the round has not fired match_completed yet', { roundId: round.id, tournamentId: tournament.id });
      return;
    }
    outcome.phase = phase;
    outcome.ctx = ctx;
    // A peer group's round that is still open fires the event when it completes.
    if (readiness === 'waiting') return;
    const fired = await fireEvent(tournament.season_id, { event: 'round_end', stage: phase.stage.key, round: round.round_number }, null, { context: ctx });
    for (const issue of fired?.issues ?? []) logger.warn(TAG, 'event effect skipped', { roundId: round.id, tournamentId: tournament.id, ...issue });
  }, input.report);
  let stageEnded = true;
  const { phase, ctx } = outcome;
  if (applied && phase !== null && ctx !== null && phase.stage.end_when !== undefined) {
    // Nothing repeats this step later (the event key is used up), so it is tried twice here.
    stageEnded = await endStageIfDone(tournament, ctx, phase, input.roundId, input.report, true);
    if (!stageEnded) {
      logger.error(TAG, 'the stage end after a completed round did not apply: the next completed match or an admin completing the phase settles it', {
        roundId: input.roundId,
        tournamentId: tournament.id,
        stage: phase.stage.key,
      });
    }
  }
  return applied && stageEnded && !outcome.deferred;
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
      players: await seatHoldersNow(tournament.season_id, ctx.state.firedEventKeys, [input.player1Id, input.player2Id]),
      generation,
    });
    await open(tournament.season_id, plan.checks, ctx.revision);
  }, undefined, true);
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
 * round (only while the relation has no link yet), and it never looks again once the round exists, so a `stage_start`
 * that failed would leave the relation undrawn with nothing to retry it. Every step here is therefore tried twice (each
 * loads its own context and is idempotent by key); if one still fails, that is logged as an error (for the start it names
 * the way out, a manual `draw` adjustment of the relation), and the round goes on. The rematch check is a step of its own:
 * a failed `round_start` does not drop it.
 */
export async function onRoundGenerated(input: RoundGeneratedInput): Promise<void> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return;
  if (input.startsPhase) {
    const start = { tournament, from: 'upcoming', to: 'active' } as const;
    if (!(await onPhaseStatusChanged(start))) {
      logger.error(
        TAG,
        'stage_start did not apply for the first round: relations its rules draw stay undrawn until an admin draws them with a manual relation adjustment',
        { tournamentId: tournament.id, seasonId: tournament.season_id },
      );
    }
  }
  await guarded('round start', { tournamentId: tournament.id, round: input.roundNumber }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
    if (ctx === null || phase === undefined) return;
    const fired = await fireEvent(tournament.season_id, { event: 'round_start', stage: phase.stage.key, round: input.roundNumber }, null, { context: ctx });
    for (const issue of fired?.issues ?? []) logger.warn(TAG, 'event effect skipped', { tournamentId: tournament.id, ...issue });
  }, undefined, true);
  if (input.rematches > 0) {
    await guarded('rematch check', { tournamentId: tournament.id, round: input.roundNumber }, async () => {
      const ctx = await loadFreshKitContext(tournament.season_id);
      const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
      if (ctx === null || phase === undefined) return;
      const plan = planChecks(ctx.def, { source: 'pairing_rematch', stage: phase.stage.key, round: input.roundNumber, rematches: input.rematches });
      await open(tournament.season_id, plan.checks, ctx.revision);
    }, undefined, true);
  }
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
    await open(tournament.season_id, [...ties.checks, ...players.checks], ctx.revision);
  }, undefined, true);
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

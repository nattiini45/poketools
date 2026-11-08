/**
 * What the routes that write a round of a custom league's phase share: loading the kit phase, refusing a phase that no
 * generator may pair or that reached its end, and the reactions to a written round (the stage calendar's deadline, the
 * format's `stage_start` / `round_start` events, the pairing filter's check). `generate-round`, `generate-all-rounds`
 * and the manual round editor call the same helpers, so a round reads the same whichever route wrote it. Server only.
 */
import 'server-only';

import type { NextRequest } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { evaluate } from '@/lib/format-kit/expr/eval';
import type { OnEventRule } from '@/lib/format-kit/types';
import { assertSeasonFormatAttached } from '@/lib/format-studio/attach';
import type { Round } from '@/types/round';
import { loadKitPhase, type KitPhase } from './load';
import { isChallengeLadder } from './pairing';
import { openForbiddenPairingCheck } from './pairing-server';
import { fillRoundDeadline } from './runtime/calendar-server';
import { eventKey, eventMatches, type KitEvent } from './runtime/events';
import { eventContext } from './runtime/expr-env';
import { isKitCandidate, type HookTournament } from './kit-candidate';
import { onRoundGenerated } from './runtime/hooks';
import { loadFreshKitContext, rosterOf, type KitContext } from './runtime/load';
import { assertStageNotEnded } from './runtime/stage-end-server';

/**
 * The kit phase a tournament is, or null when it is not a phase of a custom league (or the format does not run it).
 * A custom league without an attached format cannot start: refused before any round is written.
 */
export async function loadKitPhaseOfTournament(tournament: HookTournament): Promise<KitPhase | null> {
  if (!isKitCandidate(tournament)) return null;
  await assertSeasonFormatAttached(tournament.season_id);
  return loadKitPhase(tournament.season_id, tournament.id);
}

/** Whether the phase is paired by the kit engine itself (not the legacy pairing of a shadow or legacy league). */
export function isKitEnginePhase(kitPhase: KitPhase | null): kitPhase is KitPhase & { engine: 'kit' } {
  return kitPhase?.engine === 'kit';
}

/**
 * Refuses a phase whose rounds no generator may write: a manual stage is paired by hand and a challenge ladder takes its
 * matches from accepted challenges, both in the manual round editor (409 `rounds_manual_pairing`,
 * `rounds_challenge_ladder`). A phase that is not on the kit engine passes.
 */
export function assertPhaseGenerates(kitPhase: KitPhase | null): void {
  if (!isKitEnginePhase(kitPhase)) return;
  if (kitPhase.stage.pairing.kind === 'manual') {
    throw new UserFacingError('This phase is paired by hand. Create its rounds in the manual round editor.', {
      code: 'rounds_manual_pairing',
      status: 409,
    });
  }
  if (isChallengeLadder(kitPhase.stage.pairing)) {
    throw new UserFacingError(
      'This phase is a challenge ladder: its matches come from accepted challenges. Create its rounds in the manual round editor.',
      { code: 'rounds_challenge_ladder', status: 409 },
    );
  }
}

/**
 * Refuses another round (409 `rounds_stage_ended`) for a phase whose stage reached its `end_when`. A read, so it can be
 * outdated by the time the round is written: the write refuses a phase that completed meanwhile (`round_write`).
 */
export async function assertPhaseOpenForRounds(tournament: HookTournament & { current_round: number }, kitPhase: KitPhase | null): Promise<void> {
  if (!isKitEnginePhase(kitPhase) || !isKitCandidate(tournament)) return;
  await assertStageNotEnded({
    seasonId: tournament.season_id,
    phaseId: tournament.id,
    stage: kitPhase.stage,
    currentRound: tournament.current_round,
  });
}

/** The round numbers of a phase's open rounds, lowest first: not completed, with a match that is not completed. */
export function openRoundsOf(
  rounds: readonly Pick<Round, 'id' | 'name' | 'round_number' | 'status'>[],
  matches: readonly { round_id: string; status: string }[],
): Pick<Round, 'id' | 'name' | 'round_number'>[] {
  const unfinished = new Set(matches.filter((match) => match.status !== 'completed').map((match) => match.round_id));
  return rounds
    .filter((round) => round.status !== 'completed' && unfinished.has(round.id))
    .sort((a, b) => a.round_number - b.round_number);
}

/**
 * Refuses a new round (409 `rounds_end_when_round_open`, `params.round`) while a round of the phase still has unfinished
 * matches, for a kit stage that ends on an expression. The condition is evaluated when the last open match of a round
 * completes, and a phase it ends completes whatever matches a later round holds: a round written ahead would be
 * stranded. Refusing here means the condition is evaluated before a later round exists, and the admin then generates the
 * next round only if the stage goes on (`assertPhaseOpenForRounds` refuses it once the condition holds). It is the
 * per-round counterpart of `assertBatchMayRunAhead`. A round the admin completed by force does not block: the admin has
 * settled it, and the stage-end completion accepts the unfinished matches it lists. A match of such a round that is played
 * later (after the next round was written) cannot end the phase over the rounds written since: `checkStageEnd` holds the
 * stage end while any other round that was not completed by force has an unfinished match, and the last match of that
 * round evaluates the condition through its own hook. A `rounds` bound needs no guard (the generators stop at it), nor
 * does a phase without `end_when` or one that is not on the kit engine.
 * Pure: `assertNoOpenRoundBeforeNext` reads the matches.
 */
export function assertNoRoundOpenAhead(
  kitPhase: KitPhase | null,
  rounds: readonly Pick<Round, 'id' | 'name' | 'round_number' | 'status'>[],
  matches: readonly { round_id: string; status: string }[],
): void {
  if (!isKitEnginePhase(kitPhase) || kitPhase.stage.end_when?.kind !== 'expr') return;
  const open = openRoundsOf(rounds, matches)[0];
  if (open === undefined) return;
  throw new UserFacingError(
    `This phase ends by a condition that is checked when a round is finished. Finish the open matches of ${open.name} before creating the next round, so the condition can be checked first, or complete ${open.name} anyway with a reason.`,
    { code: 'rounds_end_when_round_open', status: 409, params: { round: open.name } },
  );
}

/**
 * `assertNoRoundOpenAhead` for the routes that write a round (generate-round, rounds/manual and generate-all-rounds, whose
 * batch of one passes `assertBatchMayRunAhead` but must still wait for the rounds written earlier): reads the phase's
 * matches only for a kit stage that ends on an expression, so every other phase costs nothing. Call it with the rounds the
 * route already read, before anything is written and immediately before `assertPhaseOpenForRounds`: that check then reads
 * the state at least as fresh as this guard's, so a match that completes in between is seen by it and a condition that
 * holds on the finished state refuses the round (`rounds_stage_ended`). A completion that lands after both reads is
 * closed by the write itself: the routes write the round and its matches through `createRoundWithMatches` (the database
 * function `round_write`, one transaction with the phase row read FOR SHARE), so the completion either commits first and
 * the write is refused (409 `rounds_phase_completed`, nothing left behind) or waits for the write and finds the new
 * matches (`phase_complete_at_stage_end` answers unsettled and the phase stays active).
 */
export async function assertNoOpenRoundBeforeNext(
  tournamentId: string,
  kitPhase: KitPhase | null,
  rounds: readonly Pick<Round, 'id' | 'name' | 'round_number' | 'status'>[],
): Promise<void> {
  if (!isKitEnginePhase(kitPhase) || kitPhase.stage.end_when?.kind !== 'expr') return;
  if (!rounds.some((round) => round.status !== 'completed')) return;
  // Loaded on demand: the query layer is only needed for this one kind of stage.
  const { getMatchesByTournament } = await import('@/lib/supabase/queries/matches');
  assertNoRoundOpenAhead(kitPhase, rounds, await getMatchesByTournament(tournamentId));
}

/**
 * The highest round number a batch (generate-all-rounds) may write for this phase, or null when nothing caps it. A stage
 * that ends on a `rounds` bound is over once that many rounds are played, so a batch past it would strand scheduled
 * matches in a completed phase. An expression bound has no round number to cap at: see `assertBatchMayRunAhead`.
 */
export function batchRoundCap(kitPhase: KitPhase | null): number | null {
  if (!isKitEnginePhase(kitPhase)) return null;
  const endWhen = kitPhase.stage.end_when;
  return endWhen?.kind === 'rounds' ? endWhen.rounds : null;
}

/**
 * Refuses a batch of two or more rounds for a stage that ends on an expression (409 `rounds_batch_end_when_expression`):
 * the condition is checked after every round and can end the phase early, which would strand the rounds already
 * written ahead of it. Such a stage is generated round by round (`generate-round`). One round passes this guard, but not
 * `assertNoOpenRoundBeforeNext`, which still holds it while an earlier round has unfinished matches. A phase that is not
 * on the kit engine, or has no expression bound, passes.
 */
export function assertBatchMayRunAhead(kitPhase: KitPhase | null, roundsToWrite: number): void {
  if (!isKitEnginePhase(kitPhase) || kitPhase.stage.end_when?.kind !== 'expr' || roundsToWrite <= 1) return;
  throw new UserFacingError(
    'This phase ends by a condition that is checked after every round, so its rounds cannot be generated all at once. Generate them one round at a time.',
    { code: 'rounds_batch_end_when_expression', status: 409 },
  );
}

/**
 * Refuses a kit round robin with more than one leg whose groups mirror league groups (409 `rounds_mirrored_groups_legs`):
 * those groups follow the league week plan (cross-group weeks, placement weeks), which is a single schedule and has no
 * legs or side swap, so the configured legs would be dropped without a word. League groups always win over a stage's own
 * (`ensurePhaseGroupsFromLeague` runs first), so the way out is a single leg or removing the league groups; the stage
 * cannot form its own groups while the league has any. A single leg, a phase that is not a kit round robin and groups of
 * the phase's own pass.
 */
export function assertMirroredGroupsPlayLegs(pairing: { legs: number } | null, mirrored: boolean): void {
  if (pairing === null || !mirrored || pairing.legs <= 1) return;
  throw new UserFacingError(
    'This round robin plays more than one leg, but its groups are managed by the league and follow the league week plan, which has no legs. Use a single leg, or remove the league groups.',
    { code: 'rounds_mirrored_groups_legs', status: 409, params: { legs: pairing.legs } },
  );
}

/** Why a phase is not ready for its first round: the codes `assertPhaseReadyForFirstRound` reports (409 `format_not_ready`). */
export type FirstRoundReason = 'relation_undrawn' | 'action_incomplete';

export interface FirstRoundGap {
  /** In a fixed order: undrawn relations first. Empty when the phase may start. */
  reasons: FirstRoundReason[];
  /** The relations an action runs `via` that have no link yet, or that leave an enrolled player out of every link. */
  undrawn: string[];
  /** Open `deadline_missed` checks of an action policy. */
  openChecks: number;
}

/** The phase that is about to get its first round: the events that follow the written round draw relations for it. */
export interface FirstRoundStart {
  /** The key of the phase's stage. */
  stage: string;
  /** The phase is `upcoming` before the round, so the write fires `stage_start` (once per key). */
  startsPhase: boolean;
}

/**
 * The relations (non-manual) that the events right after the first round's write draw: `stage_start` when the round
 * starts the phase (and it has not fired), and `round_start` of round 1. A `generate_relation` effect of a rule on one
 * of them whose `when` holds draws the relation over the same roster, so the gate does not have to wait for it (only
 * while the relation has no link: `set_relation` skips a relation that has links, see `firstRoundGap`).
 * An event that failed to evaluate counts as not drawing (the gate then stays closed).
 */
function relationsDrawnAfterRound(ctx: Pick<KitContext, 'def' | 'state' | 'seed'>, start: FirstRoundStart): Set<string> {
  const events: KitEvent[] = [{ event: 'round_start', stage: start.stage, round: 1 }];
  if (start.startsPhase) events.unshift({ event: 'stage_start', stage: start.stage });
  const manual = new Set((ctx.def.relations ?? []).filter((relation) => relation.shape === 'manual').map((relation) => relation.key));
  const drawn = new Set<string>();
  for (const event of events) {
    const rules = ctx.def.rules.filter((rule): rule is OnEventRule => rule.kind === 'rule.on_event' && eventMatches(rule.on, event));
    if (rules.length === 0 || ctx.state.firedEventKeys.includes(eventKey(event))) continue;
    const whenCtx = eventContext({ def: ctx.def, state: ctx.state, seed: ctx.seed, scope: `event:${eventKey(event)}` }, event.round);
    for (const rule of rules) {
      if (rule.when !== undefined) {
        const result = evaluate(rule.when, whenCtx, 'boolean');
        if (!result.ok || result.value !== true) continue;
      }
      for (const effect of rule.effects) {
        if (effect.effect === 'generate_relation' && !manual.has(effect.relation)) drawn.add(effect.relation);
      }
    }
  }
  return drawn;
}

/**
 * What stands between a kit league and its first round, read from the format and its runtime state (pure):
 * - `relation_undrawn`: a relation a `player.action` runs `via` has no link while the league has at least two players,
 *   or has links but leaves an enrolled player out of all of them (a player enrolled after the draw). The draw cannot be
 *   redone once links exist and an action reaches only the players it has links for, so a round started before the draw
 *   (or over a roster the draw missed) leaves those players with no recipient and no gifts for good. A relation that a
 *   `generate_relation` effect draws on the events right after the round (`start`: `stage_start`, `round_start` of round
 *   1) is not undrawn while the relation has no link at all: that draw runs over the same roster, before anything can be
 *   played. Once the relation has links the draw is a no-op (the op skips a relation that has links), so a pending draw
 *   does not mask a player the old links miss;
 * - `action_incomplete`: a deadline policy of an action opened a `deadline_missed` check that nobody resolved, which
 *   means a player did not do what the action asks, so their team rules can not be met.
 * A format with no `via` action and no action policy never reports anything.
 */
export function firstRoundGap(ctx: Pick<KitContext, 'def' | 'state' | 'phases' | 'seed'>, start?: FirstRoundStart): FirstRoundGap {
  const undrawn: string[] = [];
  if (rosterOf(ctx).length >= 2) {
    const viaKeys = new Set<string>();
    for (const rule of ctx.def.rules) if (rule.kind === 'player.action' && rule.via !== undefined) viaKeys.add(rule.via);
    const drawnAfter = start === undefined ? new Set<string>() : relationsDrawnAfterRound(ctx, start);
    const roster = rosterOf(ctx);
    for (const relation of [...viaKeys].sort()) {
      const linked = new Set<string>();
      for (const link of ctx.state.links) {
        if (link.relation !== relation) continue;
        linked.add(link.from);
        linked.add(link.to);
      }
      // A pending draw covers only a relation that has no link yet: the set_relation op skips a relation that already has
      // links (an event may fire twice), so over an old draw it would leave a player enrolled since without a recipient.
      if (linked.size === 0 && drawnAfter.has(relation)) continue;
      // No link at all, or a draw that missed a player (enrolled after it): the links can not be redone.
      if (linked.size === 0 || roster.some((player) => !linked.has(player))) undrawn.push(relation);
    }
  }
  const openChecks = ctx.state.checks.filter((check) => {
    if (check.source !== 'deadline_missed' || check.status !== 'open') return false;
    const subject = check.subject;
    return subject !== null && typeof subject === 'object' && !Array.isArray(subject) && subject.applies === 'action';
  }).length;
  const reasons: FirstRoundReason[] = [];
  if (undrawn.length > 0) reasons.push('relation_undrawn');
  if (openChecks > 0) reasons.push('action_incomplete');
  return { reasons, undrawn, openChecks };
}

/**
 * Whether the request asks to start anyway (`?force=true`). A flag in the query, not the body: the generate routes
 * parse a strict body and the manual editor its own, and the flag only matters to this guard.
 */
export function wantsForcedStart(request: Pick<NextRequest, 'url'>): boolean {
  try {
    return new URL(request.url).searchParams.get('force') === 'true';
  } catch {
    return false;
  }
}

export interface FirstRoundOptions {
  /** The caller asked to start anyway (`wantsForcedStart`): audited as `season.format.round.force_start`. */
  force?: boolean;
  /** The admin who calls, for the audit row of a forced start. */
  actor: { id: string | null; name: string };
}

/** What a forced start overrode and who forced it: `announceKitRound` writes the audit row once the round exists. */
export interface ForcedStart {
  tournamentId: string;
  seasonId: string;
  actor: FirstRoundOptions['actor'];
  gap: FirstRoundGap;
}

/**
 * Refuses the first round of a kit phase while the format's own set-up is open (409 `format_not_ready`, `params.reasons`
 * lists the codes, comma separated): see `firstRoundGap`. A league admin may start anyway with `force`; the override is
 * returned, and the route hands it to `announceKitRound` after the round is written, which audits it
 * (`season.format.round.force_start`, with the reasons it overrode). The guard itself writes no audit row, because the
 * route can still refuse the request afterwards (too few players, groups forming, a pairing error) and then no round was
 * forced. A phase that already has a round, a phase that is not on the kit engine and a format with nothing to wait for
 * pass without a force flag being looked at, and return null.
 */
export async function assertPhaseReadyForFirstRound(
  tournament: HookTournament & { current_round: number; status?: string },
  kitPhase: KitPhase | null,
  options: FirstRoundOptions,
): Promise<ForcedStart | null> {
  if (!isKitEnginePhase(kitPhase) || !isKitCandidate(tournament) || tournament.current_round > 0) return null;
  const ctx = await loadFreshKitContext(tournament.season_id);
  if (ctx === null) return null;
  const gap = firstRoundGap(ctx, { stage: kitPhase.stage.key, startsPhase: tournament.status === 'upcoming' });
  if (gap.reasons.length === 0) return null;
  if (options.force !== true) {
    throw new UserFacingError('The league is not ready for the first round of this phase.', {
      code: 'format_not_ready',
      status: 409,
      params: { reasons: gap.reasons.join(','), open_checks: gap.openChecks, undrawn: gap.undrawn.length },
    });
  }
  return { tournamentId: tournament.id, seasonId: tournament.season_id, actor: options.actor, gap };
}

/** The audit row of a forced first round (`season.format.round.force_start`); written only once the round exists. */
export function auditForcedStart(forced: ForcedStart): void {
  logAuditEvent({
    actor_id: forced.actor.id,
    actor_name: forced.actor.name,
    action: 'season.format.round.force_start',
    resource_type: 'tournament',
    resource_id: forced.tournamentId,
    metadata: {
      season_id: forced.seasonId,
      reasons: forced.gap.reasons,
      relations: forced.gap.undrawn,
      open_checks: forced.gap.openChecks,
    },
  });
}

/** A new round of a stage with a calendar gets the calendar's deadline when it has none (best effort, see the calendar). */
export async function fillKitRoundDeadline(tournament: HookTournament, kitPhase: KitPhase | null, round: Round): Promise<Round> {
  if (!isKitEnginePhase(kitPhase) || !isKitCandidate(tournament)) return round;
  return fillRoundDeadline({ seasonId: tournament.season_id, stage: kitPhase.stage, round });
}

export interface AnnouncedRound {
  roundNumber: number;
  /** Swiss pairings that repeat an earlier pairing. */
  rematches?: number;
  /** Pairs the stage's filter rejected that the round could not avoid. */
  forbidden?: number;
}

/**
 * The format reacts to a written round: `stage_start` when it opens the phase (`startsPhase`), `round_start`, a rematch
 * check, and the check for pairs the stage's filter rejected. The hooks are best effort and log their own failures. A
 * phase that is not on the kit engine is left alone. `forcedStart` (what `assertPhaseReadyForFirstRound` returned) is
 * audited first: the round exists now, and the override is recorded even if a hook fails.
 */
export async function announceKitRound(
  tournament: HookTournament,
  kitPhase: KitPhase | null,
  round: AnnouncedRound,
  startsPhase: boolean,
  forcedStart: ForcedStart | null = null,
): Promise<void> {
  if (!isKitEnginePhase(kitPhase) || !isKitCandidate(tournament)) return;
  if (forcedStart !== null) auditForcedStart(forcedStart);
  await onRoundGenerated({ tournament, roundNumber: round.roundNumber, rematches: round.rematches ?? 0, startsPhase });
  if ((round.forbidden ?? 0) > 0) {
    await openForbiddenPairingCheck({
      seasonId: tournament.season_id,
      stageKey: kitPhase.stage.key,
      round: round.roundNumber,
      forbidden: round.forbidden ?? 0,
      revision: kitPhase.revision,
    });
  }
}

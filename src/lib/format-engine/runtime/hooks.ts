/**
 * The points where the league's own writes feed the format runtime: a match completes, a round is generated, a phase
 * starts or completes, a replay ends in an engine tie. Every hook is best effort: it does nothing for a league that is
 * not a custom league on the `kit` engine, and a failure is logged with its original error and never reaches the
 * caller, so the write that triggered it always stands. Events are idempotent by key, so a retry or a heal that
 * calls a hook again applies nothing twice. Server only.
 */
import 'server-only';

import { logger } from '@/lib/logger';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import type { Tournament } from '@/types/tournament';
import { planChecks, type CheckPlan } from './checks';
import { openChecks } from './checks-server';
import { fireEvent } from './fire';
import { matchContext, playerContext } from './expr-env';
import { envBaseOf, loadFreshKitContext, phaseById, type KitContext } from './load';
import { loadStageTable, playerRowsOf } from './stage-table';
import { planTrackProgress } from './tracks';

const TAG = 'format-engine/hooks';

/** The slice of a tournament row the hooks need. */
export type HookTournament = Pick<Tournament, 'id' | 'season_id' | 'season_format_type'>;

/** Whether the tournament is a phase of a custom league: the only leagues that can run a kit format. */
export function isKitCandidate(tournament: HookTournament): tournament is HookTournament & { season_id: string } {
  return tournament.season_id != null && tournament.season_format_type === 'custom';
}

async function guarded(step: string, meta: Record<string, unknown>, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    logger.error(TAG, `format runtime hook failed: ${step}`, { ...meta, error });
  }
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
}

/**
 * A match completed: fire `match_completed` with the track progress of both players in the same transaction, and open
 * the checks whose expression is true for the match (and an `unresolved_outcome` check if its outcome is unresolved).
 */
export async function onMatchCompleted(input: MatchCompletedInput): Promise<void> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return;
  await guarded('match completed', { matchId: input.matchId, tournamentId: tournament.id }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
    if (ctx === null || phase === undefined) return;
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
    const fired = await fireEvent(
      tournament.season_id,
      { event: 'match_completed', stage: phase.stage.key, round: roundNumber, match_id: input.matchId, players: [input.player1Id, input.player2Id] },
      null,
      { context: ctx, ops: tracks.ops },
    );
    for (const issue of fired?.issues ?? []) logger.warn(TAG, 'event effect skipped', { matchId: input.matchId, ...issue });

    const checks: CheckPlan[] = [];
    if (outcome?.kind === 'unresolved') {
      checks.push(...planChecks(ctx.def, { source: 'unresolved_outcome', matchId: input.matchId, players: [input.player1Id, input.player2Id] }).checks);
    }
    const exprChecks = planChecks(ctx.def, {
      source: 'expr',
      of: 'match',
      subjects: sides.map((side) => ({ id: input.matchId, ctx: side.ctx })),
    });
    for (const issue of exprChecks.issues) logger.warn(TAG, 'check expression failed', { matchId: input.matchId, ...issue });
    checks.push(...exprChecks.checks);
    await open(tournament.season_id, checks);
  });
}

/** A replay ended in an engine tie and the match was disputed: open the `unresolved_outcome` checks. */
export async function onMatchUnresolved(input: { tournament: HookTournament; matchId: string; player1Id: string; player2Id: string }): Promise<void> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return;
  await guarded('match unresolved', { matchId: input.matchId, tournamentId: tournament.id }, async () => {
    const ctx = await loadFreshKitContext(tournament.season_id);
    if (ctx === null) return;
    const plan = planChecks(ctx.def, { source: 'unresolved_outcome', matchId: input.matchId, players: [input.player1Id, input.player2Id] });
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

/** A round was generated: `stage_start` when it opens the phase, then `round_start`, and a rematch check if needed. */
export async function onRoundGenerated(input: RoundGeneratedInput): Promise<void> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return;
  if (input.startsPhase) await onPhaseStatusChanged({ tournament, from: 'upcoming', to: 'active' });
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

export interface PhaseStatusInput {
  tournament: HookTournament;
  from: string;
  to: string;
}

/**
 * A phase changed status. `upcoming -> active` fires `stage_start`; a move to `completed` fires `stage_end` and opens
 * the standings tie checks (rows still tied behind a decision match) and the expression checks over players.
 */
export async function onPhaseStatusChanged(input: PhaseStatusInput): Promise<void> {
  const { tournament } = input;
  if (!isKitCandidate(tournament)) return;
  const started = input.from === 'upcoming' && input.to === 'active';
  const completed = input.to === 'completed' && input.from !== 'completed';
  if (!started && !completed) return;
  await guarded('phase status', { tournamentId: tournament.id, from: input.from, to: input.to }, async () => {
    let ctx: KitContext | null = await loadFreshKitContext(tournament.season_id);
    const phase = ctx === null ? undefined : phaseById(ctx, tournament.id);
    if (ctx === null || phase === undefined) return;
    const stage = phase.stage.key;
    const fired = await fireEvent(tournament.season_id, { event: started ? 'stage_start' : 'stage_end', stage }, null, { context: ctx });
    for (const issue of fired?.issues ?? []) logger.warn(TAG, 'event effect skipped', { tournamentId: tournament.id, ...issue });
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

import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { readRounds, readTournamentState } from './golive-reads';
import { startPhaseBody, tidParams } from './schemas';
import { createdSince, idOfOutcome } from './shared';

/**
 * `start_phase`: `POST /api/generate-round/[tid]`, the first round of a phase. The route writes the round, then its matches,
 * then moves the tournament (and a still `upcoming` league) to `active` and `current_round`, and only then starts the round
 * when `start_round` was asked (best effort: a failed start leaves the round `pending`, with the data written). After the
 * writes it fires Discord and social posts (`round_generated`, `tournament_started`) and, when enabled, the AI forecast. This
 * binding changes none of that: it suppresses nothing, duplicates nothing, and its read-back never calls the route again.
 *
 * Read-back: round 1 of the tournament, by the id the route answered with, else the one created since the approval. A
 * tournament whose `current_round` has not moved yet means the route stopped half way (the round, maybe without its matches):
 * `unknown` with `incomplete: true`, never adopted. Otherwise `confirmed` with `{ id: round_id, round_number, started }`;
 * `started` is false when the round is still `pending`, including when `start_round` was asked and its start failed (the data
 * is written, so the step still succeeded).
 */
export const startPhase = defineBinding<VerifyCall>({
  operation: 'start_phase',
  method: 'POST',
  path: '/api/generate-round/[tid]',
  class: 'G',
  phase: 1,
  load: () => import('@/app/api/generate-round/[tid]/route'),
  paramsSchema: tidParams,
  bodySchema: startPhaseBody,
  // The groups the tool declares; the events are the ones the route fires (`emitDiscordEvent` and `emitSocialEvent`).
  outwardEffects: [
    { group: 'round_generated', events: ['round_generated'] },
    { group: 'tournament_started', events: ['tournament_started'] },
    { group: 'league_active', events: [] },
    { group: 'ai_forecast', events: [] },
  ],
  // A started tournament is not un-started.
  reversal: { kind: 'none' },
  async verify(call, outcome, ctx): Promise<VerifyResult> {
    const tournamentId = call.params.tid;
    const rounds = await readRounds(tournamentId);

    const knownId = idOfOutcome(outcome);
    let round = knownId === null ? undefined : rounds.find((candidate) => candidate.id.toLowerCase() === knownId);
    if (knownId === null) {
      if (ctx.approvedAt === undefined) return { status: 'unknown' };
      const approvedAt = ctx.approvedAt;
      const first = rounds.filter((candidate) => candidate.round_number === 1 && createdSince(candidate.created_at, approvedAt));
      if (first.length > 1) return { status: 'unknown', detail: { ambiguous: true, matches: first.length } };
      round = first[0];
    }
    if (round === undefined) return { status: 'absent' };

    // `current_round` moves after the matches are written: a round without it is a start that did not finish.
    const tournament = await readTournamentState(tournamentId);
    if (tournament === null || tournament.current_round < 1) return { status: 'unknown', detail: { id: round.id, round_number: round.round_number, incomplete: true } };
    return { status: 'confirmed', detail: { id: round.id, round_number: round.round_number, started: round.status !== 'pending' } };
  },
});

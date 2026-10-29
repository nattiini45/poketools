import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { readRounds, readTournamentState } from './golive-reads';
import { generateBracketBody, idParams } from './schemas';
import { createdSince } from './shared';

/**
 * `generate_bracket`: `POST /api/tournaments/[id]/generate-bracket`, the full single or double elimination bracket. The
 * bracket engine writes every round, materialises the ready matches, freezes the enrollment and moves the tournament to
 * `active`; the route then activates an `upcoming` league and fires the `round_generated` posts to Discord and social. The
 * binding never sends `start_round` (staging stores `{}`), suppresses no post and duplicates none.
 *
 * Read-back: the bracket's rounds exist and were all created since the approval, and the tournament's `current_round` moved
 * (the engine's last write). Then `confirmed` with `{ id: tournament_id, rounds }`. Rounds that are older than the approval
 * are not this step's (`absent`; mixed ages are `unknown`); rounds without the moved tournament are a bracket that was not
 * finished: `unknown` with `incomplete: true`.
 */
export const generateBracket = defineBinding<VerifyCall>({
  operation: 'generate_bracket',
  method: 'POST',
  path: '/api/tournaments/[id]/generate-bracket',
  class: 'G',
  phase: 1,
  load: () => import('@/app/api/tournaments/[id]/generate-bracket/route'),
  paramsSchema: idParams,
  bodySchema: generateBracketBody,
  outwardEffects: [
    { group: 'round_generated', events: ['round_generated'] },
    { group: 'enrollment_frozen', events: [] },
  ],
  reversal: { kind: 'none' },
  async verify(call, _outcome, ctx): Promise<VerifyResult> {
    const tournamentId = call.params.id;
    const rounds = await readRounds(tournamentId);
    if (rounds.length === 0) return { status: 'absent' };
    if (ctx.approvedAt === undefined) return { status: 'unknown' };
    const approvedAt = ctx.approvedAt;

    const created = rounds.filter((round) => createdSince(round.created_at, approvedAt)).length;
    if (created === 0) return { status: 'absent' };
    if (created !== rounds.length) return { status: 'unknown', detail: { rounds: rounds.length, created } };

    const tournament = await readTournamentState(tournamentId);
    if (tournament === null || tournament.current_round < 1) return { status: 'unknown', detail: { id: tournamentId, rounds: rounds.length, incomplete: true } };
    return { status: 'confirmed', detail: { id: tournamentId, rounds: rounds.length } };
  },
});

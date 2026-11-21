import { z } from 'zod';
import { defineBinding, type VerifyCall } from '@/lib/ai/admin-agent/dispatch';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseBracketMatchRoundIds } from '@/lib/supabase/queries/phase-matches';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { generateBracketBody, phaseParams } from './schemas';
import { createdSince } from './shared';

const receipt = z.strictObject({
  rounds_created: z.int().positive(),
  matches_materialized: z.int().nonnegative(),
});

/** Dormant until explicit owner provenance and native staging are connected. */
export const generatePhaseBracket = defineBinding<VerifyCall>({
  operation: 'generate_phase_bracket',
  method: 'POST',
  path: '/api/seasons/[id]/phases/[phaseId]/generate-bracket',
  class: 'G',
  phase: 1,
  load: () => import('@/app/api/seasons/[id]/phases/[phaseId]/generate-bracket/route'),
  paramsSchema: phaseParams,
  bodySchema: generateBracketBody,
  outwardEffects: [
    { group: 'round_generated', events: ['round_generated'] },
    { group: 'enrollment_frozen', events: [] },
  ],
  reversal: { kind: 'none' },
  async verify(call, outcome, ctx) {
    // A separate operator could have generated the same bracket. State or timestamps alone cannot attribute it.
    if (outcome.kind !== 'ok' || outcome.httpStatus !== 201 || ctx.approvedAt === undefined) return { status: 'unknown' };
    const result = receipt.safeParse(outcome.data);
    const params = phaseParams.safeParse(call.params);
    if (!result.success || !params.success) return { status: 'unknown' };
    const seasonId = params.data.id.toLowerCase();
    const phaseId = params.data.phaseId.toLowerCase();
    const phase = await getPhaseById(phaseId);
    if (phase?.id !== phaseId || phase.season_id !== seasonId || phase.stage_spec !== null || phase.archived
      || phase.status !== 'active' || phase.current_round < 1 || phase.enrollment_source?.frozen !== true
      || (phase.bracket_type !== 'single_elim' && phase.bracket_type !== 'double_elim')) return { status: 'unknown' };

    const [season, rounds, matchRoundIds] = await Promise.all([
      getSeasonById(seasonId), getRoundsByPhase(phaseId), getPhaseBracketMatchRoundIds(phaseId),
    ]);
    const roundIds = new Set(rounds.map((round) => round.id));
    const approvedAt = ctx.approvedAt;
    if (season?.id !== seasonId || season.archived || season.format_type === 'custom' || season.status !== 'active'
      || roundIds.size !== result.data.rounds_created || rounds.length !== roundIds.size
      || matchRoundIds.length !== result.data.matches_materialized
      || !rounds.every((round) => round.phase_id === phaseId && round.bracket_side !== null && round.status === 'pending' && createdSince(round.created_at, approvedAt))
      || rounds[0]?.round_number !== phase.current_round
      || !matchRoundIds.every((roundId) => roundIds.has(roundId))) return { status: 'unknown' };

    return {
      status: 'confirmed',
      detail: { id: phaseId, season_id: seasonId, rounds: rounds.length, matches: matchRoundIds.length },
    };
  },
});

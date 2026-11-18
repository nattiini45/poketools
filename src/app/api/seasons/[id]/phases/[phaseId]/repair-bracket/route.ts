import { NextResponse, type NextRequest } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { requirePlayer } from '@/lib/auth/helpers';
import { planPhaseBracketRepair } from '@/lib/league-phase/bracket-repair';
import { expirePhaseReads } from '@/lib/revalidation';
import { getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getMatchesByPhase } from '@/lib/supabase/queries/phase-matches';
import { getRoundsByPhase, writePhaseBracketRepair } from '@/lib/supabase/queries/phase-rounds';
import type { ApiResult } from '@/types/api';
import { invalidPhaseRoundPath, loadRoundPhase, phaseRoundError, type PhaseParams } from '../rounds/_lib/scope';

export async function POST(_request: NextRequest, { params }: { params: Promise<PhaseParams> }) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { season, phase } = await loadRoundPhase(path, actor);
    if (phase.bracket_type !== 'single_elim' && phase.bracket_type !== 'double_elim') {
      throw new UserFacingError('Bracket repair only applies to elimination formats', { code: 'bracket_repair_elim_only' });
    }
    if (phase.archived) {
      throw new UserFacingError('Archived phase is read-only', { code: 'phase_bracket_archived', status: 409 });
    }
    if (phase.status === 'completed') {
      throw new UserFacingError('Tournament is already completed', { code: 'tournament_already_completed' });
    }
    const [rounds, participants, matches] = await Promise.all([
      getRoundsByPhase(phase.id), getPhaseParticipants(phase.id), getMatchesByPhase(phase.id),
    ]);
    const slots = planPhaseBracketRepair(phase, participants, rounds, matches);
    const result = await writePhaseBracketRepair({
      seasonId: season.id, phaseId: phase.id, updatedAt: phase.updated_at,
      seeds: participants.map(({ id: player_id, name, seed, starting_bracket }) => ({ player_id, name, seed, starting_bracket })),
      rounds: rounds.map(({ id, round_number, bracket_side, status }) => ({ id, round_number, bracket_side, status })),
      matches: matches.map(({ id, updated_at, games }) => ({ id, updated_at, has_games: games.length > 0 })),
      slots,
    });
    if (result.slots_materialized || result.slots_updated) expirePhaseReads(phase.id, season.id);
    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (error) {
    return phaseRoundError(error, 'Failed to repair bracket');
  }
}

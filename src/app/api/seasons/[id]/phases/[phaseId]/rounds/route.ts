import { NextResponse, type NextRequest } from 'next/server';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import type { ApiResult } from '@/types/api';
import type { PhaseRound } from '@/types/league-phase';
import { invalidPhaseRoundPath, loadRoundPhase, phaseRoundError, type PhaseParams } from './_lib/scope';

// Public: no auth required — list rounds for a phase in the requested league.
export async function GET(_request: NextRequest, { params }: { params: Promise<PhaseParams> }) {
  try {
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { phase } = await loadRoundPhase(path);
    return NextResponse.json<ApiResult<PhaseRound[]>>({ success: true, data: await getRoundsByPhase(phase.id) });
  } catch (error) {
    return phaseRoundError(error, 'Failed to fetch rounds');
  }
}

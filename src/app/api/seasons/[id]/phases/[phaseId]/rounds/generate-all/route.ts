import type { NextRequest } from 'next/server';
import { generatePhaseRounds } from '../_lib/generate';
import type { PhaseParams } from '../_lib/scope';

export function POST(request: NextRequest, { params }: { params: Promise<PhaseParams> }) {
  return generatePhaseRounds(request, params, true);
}

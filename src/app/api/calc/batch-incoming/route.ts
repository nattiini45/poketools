import { NextResponse } from 'next/server';
import { getGeneration } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import { buildCalcField } from '@/lib/pkmn/calc-engine';
import {
  batchIncomingRequestSchema,
  buildRequestMon,
  calcMoveResult,
  errorResult,
  listedMoves,
  toFieldSpec,
} from '@/lib/pkmn/calc-request';
import { calcInputRejected, parseCalcBody } from '@/lib/pkmn/calc-route';
import type { BatchIncomingResponse } from '@/types/calc';

// Public: no auth required
//
// Reverse batch: up to 20 attackers → one defender, at most 80 move calcs per
// request. Rate limited per client IP (shared `calc` bucket). An
// unknown name on the defender is a 400; an unknown attacker or move gets
// per-result `error`s.
export async function POST(req: Request) {
  try {
    const gate = await parseCalcBody(req, batchIncomingRequestSchema);
    if (!gate.ok) return gate.response;
    const body = gate.value;

    const gen = getGeneration(body.generation ?? 9);
    const defender = buildRequestMon(gen, body.defender);
    if (!defender.ok) return calcInputRejected('defender', defender.error);

    // Incoming damage: the request's attacker side is the user's side, which defends here.
    const field = buildCalcField(toFieldSpec(body.field, true));

    const results = body.attackers.map((atkData) => {
      const moveNames = listedMoves(atkData);
      const attacker = buildRequestMon(gen, atkData);
      const move_results = attacker.ok
        ? moveNames.map((m) => calcMoveResult(gen, attacker.value, defender.value, m, field))
        : moveNames.map((m) => errorResult(m, attacker.error));
      return { attacker: atkData.species, move_results };
    });

    return NextResponse.json<BatchIncomingResponse>({
      success: true,
      data: { results },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compute batch incoming damage');
  }
}

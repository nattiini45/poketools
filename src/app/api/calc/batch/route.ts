import { NextResponse } from 'next/server';
import { getGeneration } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import { buildCalcField } from '@/lib/pkmn/calc-engine';
import {
  batchCalcRequestSchema,
  buildRequestMon,
  calcMoveResult,
  errorResult,
  listedMoves,
  toFieldSpec,
} from '@/lib/pkmn/calc-request';
import { calcInputRejected, parseCalcBody } from '@/lib/pkmn/calc-route';
import type { BatchCalcResponse } from '@/types/calc';

// Public: no auth required
//
// One attacker → up to 20 defenders, at most 80 move calcs per request.
// Rate limited per client IP (shared `calc` bucket). An unknown name
// on the attacker is a 400; an unknown defender or move gets per-result
// `error`s, so one bad threat does not fail the whole table.
export async function POST(req: Request) {
  try {
    const gate = await parseCalcBody(req, batchCalcRequestSchema);
    if (!gate.ok) return gate.response;
    const body = gate.value;

    const gen = getGeneration(body.generation ?? 9);
    const attacker = buildRequestMon(gen, body.attacker);
    if (!attacker.ok) return calcInputRejected('attacker', attacker.error);

    const field = buildCalcField(toFieldSpec(body.field));
    const moveNames = (body.moves ?? listedMoves(body.attacker)).filter(Boolean);

    const results = body.defenders.map((defData) => {
      const defender = buildRequestMon(gen, defData);
      const move_results = defender.ok
        ? moveNames.map((m) => calcMoveResult(gen, attacker.value, defender.value, m, field))
        : moveNames.map((m) => errorResult(m, defender.error));
      return { defender: defData.species, move_results };
    });

    return NextResponse.json<BatchCalcResponse>({
      success: true,
      data: { results },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compute batch damage');
  }
}

import { NextResponse } from 'next/server';
import { getGeneration } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';
import { buildCalcField } from '@/lib/pkmn/calc-engine';
import {
  buildRequestMon,
  calcMoveResult,
  calcRequestSchema,
  listedMoves,
  toFieldSpec,
} from '@/lib/pkmn/calc-request';
import { calcInputRejected, parseCalcBody } from '@/lib/pkmn/calc-route';
import type { CalcResponse } from '@/types/calc';

// Public: no auth required
//
// One attacker → one defender: `move`, or every listed attacker move with
// `allMoves`. Rate limited per client IP (shared `calc` bucket).
// An unknown move gets a per-result `error`; an unknown name on either mon is
// a 400 (it would make every result wrong).
export async function POST(req: Request) {
  try {
    const gate = await parseCalcBody(req, calcRequestSchema);
    if (!gate.ok) return gate.response;
    const body = gate.value;

    const gen = getGeneration(body.generation ?? 9);
    const attacker = buildRequestMon(gen, body.attacker);
    if (!attacker.ok) return calcInputRejected('attacker', attacker.error);
    const defender = buildRequestMon(gen, body.defender);
    if (!defender.ok) return calcInputRejected('defender', defender.error);

    const field = buildCalcField(toFieldSpec(body.field));
    const moveNames = body.allMoves ? listedMoves(body.attacker) : [body.move ?? ''];

    const results = moveNames.map((m) => calcMoveResult(gen, attacker.value, defender.value, m, field));

    return NextResponse.json<CalcResponse>({
      success: true,
      data: { results },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compute damage');
  }
}

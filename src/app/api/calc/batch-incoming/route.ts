import { NextResponse } from 'next/server';
import { calculate, Pokemon, Move, Field } from '@smogon/calc/dist/adaptable';
import { getGeneration } from '@/lib/pkmn/dex';
import { toKoInfo } from '@/lib/pkmn/i18n/calc-text';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { BatchIncomingRequest, BatchIncomingResponse, CalcResult, CalcPokemon } from '@/types/calc';
import type { ApiResult } from '@/types/api';

function buildPokemon(gen: ReturnType<typeof getGeneration>, mon: CalcPokemon) {
  return new Pokemon(gen, mon.species, {
    item: mon.item as never,
    ability: mon.ability as never,
    nature: mon.nature as never,
    evs: mon.evs,
    ivs: mon.ivs,
    level: mon.level,
    boosts: mon.boosts,
    status: mon.status as never,
    teraType: mon.is_tera ? (mon.tera_type as never) : undefined,
  });
}

function computeResult(
  gen: ReturnType<typeof getGeneration>,
  attacker: InstanceType<typeof Pokemon>,
  defender: InstanceType<typeof Pokemon>,
  moveName: string,
  field?: InstanceType<typeof Field>,
): CalcResult {
  try {
    const move = new Move(gen, moveName);
    const result = calculate(gen, attacker, defender, move, field);
    const range = result.range();
    const maxHP = defender.maxHP();
    const ko = result.kochance();

    return {
      move: moveName,
      damage: {
        min: range[0],
        max: range[1],
        min_pct: maxHP > 0 ? Math.round((range[0] / maxHP) * 1000) / 10 : 0,
        max_pct: maxHP > 0 ? Math.round((range[1] / maxHP) * 1000) / 10 : 0,
      },
      // English text stays (AI agent + golden-set eval parse it); `ko` is the structured, localizable form.
      ko_chance: ko?.text ?? 'N/A',
      ko: toKoInfo(ko),
      description: result.desc(),
      rolls: Array.isArray(result.damage)
        ? (result.damage as number[]).flat()
        : [result.damage as number],
    };
  } catch {
    return {
      move: moveName,
      damage: { min: 0, max: 0, min_pct: 0, max_pct: 0 },
      ko_chance: 'N/A',
      ko: null,
      description: `Could not calculate ${moveName}`,
      rolls: [],
    };
  }
}

const MAX_ATTACKERS = 20;

// Reverse-batch: many attackers → one defender
export async function POST(req: Request) {
  try {
    const body: BatchIncomingRequest = await req.json();

    if (body.attackers.length > MAX_ATTACKERS) {
      const issues = `Max ${MAX_ATTACKERS} attackers per batch`;
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const gen = getGeneration(body.generation);
    const defender = buildPokemon(gen, body.defender);

    const field = body.field
      ? new Field({
          gameType: body.field.gameType || 'Singles',
          weather: body.field.weather as never,
          terrain: body.field.terrain as never,
          // For incoming damage, swap attacker/defender sides
          attackerSide: body.field.defenderSide as never,
          defenderSide: body.field.attackerSide as never,
        })
      : undefined;

    const results = body.attackers.map((atkData) => {
      const attacker = buildPokemon(gen, atkData);
      const moveNames = atkData.moves?.filter(Boolean) ?? [];
      const move_results = moveNames.map((m) =>
        computeResult(gen, attacker, defender, m, field),
      );
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

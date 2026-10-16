import { NextResponse } from 'next/server';
import { calculate, Pokemon, Move, Field } from '@smogon/calc/dist/adaptable';
import { getGeneration } from '@/lib/pkmn/dex';
import { toKoInfo } from '@/lib/pkmn/i18n/calc-text';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { CalcRequest, CalcResult, CalcResponse } from '@/types/calc';

function buildPokemon(gen: ReturnType<typeof getGeneration>, mon: CalcRequest['attacker']) {
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
  field?: InstanceType<typeof Field>
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

export async function POST(req: Request) {
  try {
    const body: CalcRequest = await req.json();
    const gen = getGeneration(body.generation);

    const attacker = buildPokemon(gen, body.attacker);
    const defender = buildPokemon(gen, body.defender);

    const field = body.field
      ? new Field({
          gameType: body.field.gameType || 'Singles',
          weather: body.field.weather as never,
          terrain: body.field.terrain as never,
          isBeadsOfRuin: body.field.isBeadsOfRuin,
          isSwordOfRuin: body.field.isSwordOfRuin,
          isTabletsOfRuin: body.field.isTabletsOfRuin,
          isVesselOfRuin: body.field.isVesselOfRuin,
          attackerSide: body.field.attackerSide as never,
          defenderSide: body.field.defenderSide as never,
        })
      : undefined;

    const moveNames = body.allMoves && body.attacker.moves
      ? body.attacker.moves.filter(Boolean)
      : [body.move];

    const results = moveNames.map((m) => computeResult(gen, attacker, defender, m, field));

    return NextResponse.json<CalcResponse>({
      success: true,
      data: { results },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to compute damage');
  }
}

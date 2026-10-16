/**
 * Damage-calculation agent tool (PRD §5, Layer 1): `calculateDamage`.
 *
 * Wraps `@smogon/calc` (adaptable mode, driven by the @pkmn/data Generation
 * singleton) so the LLM never computes damage itself. Returns min/max damage
 * percentages, the raw damage rolls, and a KO-chance description. Pure data in
 * / pure data out — no HTTP, no formatting.
 */
import { calculate, Pokemon, Move, Field } from '@smogon/calc/dist/adaptable';
import { getGeneration } from '@/lib/pkmn/dex';
import type { CalculateDamageInput } from './schemas';

type Generation = ReturnType<typeof getGeneration>;
type CalcMon = CalculateDamageInput['attacker'];

export interface CalculateDamageResult {
  move: string;
  attacker: string;
  defender: string;
  damage: {
    /** Minimum / maximum raw damage. */
    min: number;
    max: number;
    /** Minimum / maximum damage as a percentage of the defender's max HP. */
    min_pct: number;
    max_pct: number;
  };
  /** Human-readable KO chance, e.g. "guaranteed OHKO". */
  ko_chance: string;
  /** @smogon/calc's full one-line description of the calc. */
  description: string;
  /** Individual damage rolls. */
  rolls: number[];
  /** Set when the move/species could not be calculated. */
  error?: string;
}

function buildPokemon(gen: Generation, mon: CalcMon): InstanceType<typeof Pokemon> {
  return new Pokemon(gen, mon.species, {
    item: mon.item as never,
    ability: mon.ability as never,
    nature: mon.nature as never,
    evs: mon.evs,
    ivs: mon.ivs,
    level: mon.level,
    boosts: mon.boosts,
    status: mon.status as never,
    teraType: mon.isTera ? (mon.teraType as never) : undefined,
  });
}

function buildField(input: CalculateDamageInput): InstanceType<typeof Field> | undefined {
  const f = input.field;
  if (!f) return undefined;
  return new Field({
    gameType: f.gameType ?? 'Singles',
    weather: f.weather as never,
    terrain: f.terrain as never,
    isBeadsOfRuin: f.isBeadsOfRuin,
    isSwordOfRuin: f.isSwordOfRuin,
    isTabletsOfRuin: f.isTabletsOfRuin,
    isVesselOfRuin: f.isVesselOfRuin,
    defenderSide: {
      isSR: f.isStealthRock,
      spikes: f.spikes,
      isReflect: f.isReflect,
      isLightScreen: f.isLightScreen,
    } as never,
  });
}

export function calculateDamage(input: CalculateDamageInput): CalculateDamageResult {
  const gen = getGeneration(input.gen ?? 9);

  try {
    const attacker = buildPokemon(gen, input.attacker);
    const defender = buildPokemon(gen, input.defender);
    const field = buildField(input);
    const move = new Move(gen, input.move);

    const result = calculate(gen, attacker, defender, move, field);
    const range = result.range();
    const maxHP = defender.maxHP();
    const ko = result.kochance();

    return {
      move: input.move,
      attacker: input.attacker.species,
      defender: input.defender.species,
      damage: {
        min: range[0],
        max: range[1],
        min_pct: maxHP > 0 ? Math.round((range[0] / maxHP) * 1000) / 10 : 0,
        max_pct: maxHP > 0 ? Math.round((range[1] / maxHP) * 1000) / 10 : 0,
      },
      ko_chance: ko?.text ?? 'N/A',
      description: result.desc(),
      rolls: Array.isArray(result.damage)
        ? (result.damage as number[]).flat()
        : [result.damage as number],
    };
  } catch (err) {
    return {
      move: input.move,
      attacker: input.attacker.species,
      defender: input.defender.species,
      damage: { min: 0, max: 0, min_pct: 0, max_pct: 0 },
      ko_chance: 'N/A',
      description: `Could not calculate ${input.move}`,
      rolls: [],
      error: err instanceof Error ? err.message : 'calc failed',
    };
  }
}

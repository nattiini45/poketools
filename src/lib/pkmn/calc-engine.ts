/**
 * Shared damage-calculation core (code review H4) for the `/api/calc/*` routes
 * and the AI agent's `calculateDamage` tool.
 *
 * Wraps `@smogon/calc` (adaptable mode over the @pkmn/data Generation) and
 * makes its silent failure modes explicit:
 *   - names are resolved against the dex first: an unknown species, move,
 *     item, ability, nature or Tera type is a typed {@link CalcError}, never a
 *     calc that quietly ignores the field (unknown items and abilities used to
 *     be dropped, unknown moves returned 0 damage);
 *   - a zero-damage result (type immunity, status move) is a real result with
 *     `ko: null`: `kochance()` and, for immunities, `desc()` throw on 0 damage,
 *     so they are not called and the description is built in the calc's own
 *     "A Move vs. B: 0-0 (0 - 0%)" form;
 *   - anything else that throws is logged and reported as `calc_setup_failed`
 *     (building a mon) or `calc_failed` (the calc itself), never
 *     turned into a fabricated `{ min: 0, max: 0 }`.
 *
 * Engine strings (`description`, `koText`) stay English (i18n rule: engine
 * output is translated at display time from the structured fields).
 */
import { calculate, Pokemon, Move, Field } from '@smogon/calc/dist/adaptable';
import { getGeneration } from '@/lib/pkmn/dex';

export type CalcGeneration = ReturnType<typeof getGeneration>;
export type CalcPokemonInstance = InstanceType<typeof Pokemon>;
export type CalcFieldInstance = InstanceType<typeof Field>;
/** The @smogon/calc Pokémon options: their item/ability/nature/teraType are the calc's own name unions. */
type CalcPokemonOptions = NonNullable<ConstructorParameters<typeof Pokemon>[2]>;

/** Per-item calc error codes: keys of the `errors/stats` catalog. */
export const CALC_ERROR_CODES = [
  'unknown_species',
  'unknown_move',
  'unknown_item',
  'unknown_ability',
  'unknown_nature',
  'unknown_tera_type',
  'calc_setup_failed',
  'calc_failed',
] as const;

export type CalcErrorCode = (typeof CALC_ERROR_CODES)[number];

/**
 * A per-item calc failure. `code` and `params` are a key of the `errors/stats`
 * catalog and its placeholders (clients translate by code); `message` is the
 * catalog's English text, filled in.
 */
export interface CalcError {
  code: CalcErrorCode;
  /** English, safe to show (names the offending input, no internals). */
  message: string;
  params: Record<string, string>;
}

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type BoostKey = Exclude<StatKey, 'hp'>;
export type CalcStatus = 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';

/** One combatant, already validated for shape (ranges, lengths) by the caller's schema. */
export interface CalcMonSpec {
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  evs?: Partial<Record<StatKey, number>>;
  ivs?: Partial<Record<StatKey, number>>;
  level?: number;
  boosts?: Partial<Record<BoostKey, number>>;
  status?: CalcStatus;
  /** The Tera type to apply (only when the mon IS terastallized). */
  teraType?: string;
}

/** Side conditions in @smogon/calc's own field names. */
export interface CalcSideSpec {
  spikes?: number;
  isSR?: boolean;
  isReflect?: boolean;
  isLightScreen?: boolean;
  isAuroraVeil?: boolean;
  isTailwind?: boolean;
  isHelpingHand?: boolean;
  isFriendGuard?: boolean;
}

export interface CalcFieldSpec {
  gameType?: 'Singles' | 'Doubles';
  weather?: 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Harsh Sunshine' | 'Heavy Rain';
  terrain?: 'Electric' | 'Grassy' | 'Misty' | 'Psychic';
  isBeadsOfRuin?: boolean;
  isSwordOfRuin?: boolean;
  isTabletsOfRuin?: boolean;
  isVesselOfRuin?: boolean;
  attackerSide?: CalcSideSpec;
  defenderSide?: CalcSideSpec;
}

/** Raw `kochance()` shape (node_modules/@smogon/calc/dist/desc.d.ts). */
export interface RawKoChance {
  chance: number | undefined;
  n: number;
  text: string;
}

export interface DamageCalcSuccess {
  /** Canonical move name from the dex. */
  move: string;
  damage: { min: number; max: number; min_pct: number; max_pct: number };
  /** `kochance()`; null for a zero-damage result. */
  ko: RawKoChance | null;
  /** English KO text (`kochance().text`, empty when no KO); `'N/A'` for a zero-damage result. */
  koText: string;
  /** English one-line description. */
  description: string;
  rolls: number[];
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: CalcError };

/** Usage-stats placeholders that mean "no item" / "no ability". */
const EMPTY_ITEM_IDS = new Set(['', 'nothing', 'none', 'noitem', 'other']);
const EMPTY_ABILITY_IDS = new Set(['', 'none', 'noability', 'other']);

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fail(code: CalcErrorCode, message: string, params: Record<string, string>): { ok: false; error: CalcError } {
  return { ok: false, error: { code, message, params } };
}

/** Resolve every name of `spec` against the dex and build the @smogon/calc Pokémon. */
export function buildCalcPokemon(gen: CalcGeneration, spec: CalcMonSpec): Outcome<CalcPokemonInstance> {
  const species = gen.species.get(spec.species);
  if (!species) return fail('unknown_species', `Unknown species: ${spec.species}`, { pokemon: spec.species });

  let item: CalcPokemonOptions['item'];
  if (spec.item !== undefined && !EMPTY_ITEM_IDS.has(toId(spec.item))) {
    const entity = gen.items.get(spec.item);
    if (!entity) return fail('unknown_item', `Unknown item: ${spec.item}`, { item: spec.item });
    item = entity.name;
  }

  let ability: CalcPokemonOptions['ability'];
  if (spec.ability !== undefined && !EMPTY_ABILITY_IDS.has(toId(spec.ability))) {
    const entity = gen.abilities.get(spec.ability);
    if (!entity) return fail('unknown_ability', `Unknown ability: ${spec.ability}`, { ability: spec.ability });
    ability = entity.name;
  }

  let nature: CalcPokemonOptions['nature'];
  if (spec.nature !== undefined && spec.nature.trim() !== '') {
    const entity = gen.natures.get(spec.nature);
    if (!entity) return fail('unknown_nature', `Unknown nature: ${spec.nature}`, { nature: spec.nature });
    nature = entity.name;
  }

  let teraType: CalcPokemonOptions['teraType'];
  if (spec.teraType !== undefined && spec.teraType.trim() !== '') {
    const entity = gen.types.get(spec.teraType);
    if (!entity) return fail('unknown_tera_type', `Unknown Tera type: ${spec.teraType}`, { type: spec.teraType });
    teraType = entity.name;
  }

  try {
    return {
      ok: true,
      value: new Pokemon(gen, species.name, {
        item,
        ability,
        nature,
        evs: spec.evs,
        ivs: spec.ivs,
        level: spec.level,
        boosts: spec.boosts,
        status: spec.status,
        teraType,
      }),
    };
  } catch (err) {
    console.error(`[calc] building ${species.name} failed:`, err);
    return fail('calc_setup_failed', `Could not set up ${species.name}`, { pokemon: species.name });
  }
}

/** Build the @smogon/calc Field (undefined when there is none). */
export function buildCalcField(spec: CalcFieldSpec | undefined): CalcFieldInstance | undefined {
  if (!spec) return undefined;
  return new Field({
    gameType: spec.gameType ?? 'Singles',
    weather: spec.weather,
    terrain: spec.terrain,
    isBeadsOfRuin: spec.isBeadsOfRuin,
    isSwordOfRuin: spec.isSwordOfRuin,
    isTabletsOfRuin: spec.isTabletsOfRuin,
    isVesselOfRuin: spec.isVesselOfRuin,
    attackerSide: spec.attackerSide,
    defenderSide: spec.defenderSide,
  });
}

function pct(value: number, maxHP: number): number {
  return maxHP > 0 ? Math.round((value / maxHP) * 1000) / 10 : 0;
}

/** One attacker → defender calc for `moveName`. */
export function runDamageCalc(
  gen: CalcGeneration,
  attacker: CalcPokemonInstance,
  defender: CalcPokemonInstance,
  moveName: string,
  field?: CalcFieldInstance,
): Outcome<DamageCalcSuccess> {
  const moveEntity = gen.moves.get(moveName);
  if (!moveEntity) return fail('unknown_move', `Unknown move: ${moveName}`, { move: moveName });

  try {
    const move = new Move(gen, moveEntity.name);
    const result = calculate(gen, attacker, defender, move, field);
    const [min, max] = result.range();
    const maxHP = defender.maxHP();
    const rolls = Array.isArray(result.damage)
      ? (result.damage as Array<number | number[]>).flat()
      : [result.damage as number];
    const damage = { min, max, min_pct: pct(min, maxHP), max_pct: pct(max, maxHP) };

    if (max === 0) {
      // Immunity or status move: no KO chance, and the calc's own text helpers throw.
      return {
        ok: true,
        value: {
          move: moveEntity.name,
          damage,
          ko: null,
          koText: 'N/A',
          description: `${attacker.name} ${moveEntity.name} vs. ${defender.name}: 0-0 (0 - 0%)`,
          rolls,
        },
      };
    }

    const ko = result.kochance();
    return {
      ok: true,
      value: {
        move: moveEntity.name,
        damage,
        ko,
        koText: ko.text,
        description: result.desc(),
        rolls,
      },
    };
  } catch (err) {
    console.error(`[calc] ${attacker.name} ${moveEntity.name} vs. ${defender.name} failed:`, err);
    return fail('calc_failed', `Could not calculate ${moveEntity.name}`, { move: moveEntity.name });
  }
}

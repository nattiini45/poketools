/**
 * Damage-calculation agent tool (PRD §5, Layer 1): `calculateDamage`.
 *
 * Runs the shared calc engine (`src/lib/pkmn/calc-engine.ts`, @smogon/calc in
 * adaptable mode over the @pkmn/data Generation) so the LLM never computes
 * damage itself. Returns min/max damage percentages, the raw damage rolls and
 * a KO-chance description — or, when the input cannot be calculated, an
 * explicit `error` with NO damage numbers (code review H4: never a fabricated
 * `{ min: 0, max: 0 }` the model could present as a real result). A type
 * immunity or a status move is a real result: 0 damage, `ko_chance: 'N/A'`.
 * Pure data in / pure data out — no HTTP, no formatting.
 */
import { getGeneration } from '@/lib/pkmn/dex';
import {
  buildCalcField,
  buildCalcPokemon,
  runDamageCalc,
  type CalcErrorCode,
  type CalcFieldSpec,
  type CalcMonSpec,
} from '@/lib/pkmn/calc-engine';
import type { CalculateDamageInput } from './schemas';

type CalcMon = CalculateDamageInput['attacker'];

export interface CalculateDamageSuccess {
  /** Canonical move name from the dex. */
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
  /** Human-readable KO chance, e.g. "guaranteed OHKO"; 'N/A' for zero damage. */
  ko_chance: string;
  /** @smogon/calc's full one-line description of the calc. */
  description: string;
  /** Individual damage rolls. */
  rolls: number[];
}

export interface CalculateDamageFailure {
  move: string;
  attacker: string;
  defender: string;
  /** What could not be calculated (unknown name, or a logged calc failure). No damage numbers. */
  error: string;
  error_code: CalcErrorCode;
}

export type CalculateDamageResult = CalculateDamageSuccess | CalculateDamageFailure;

function toMonSpec(mon: CalcMon): CalcMonSpec {
  return {
    species: mon.species,
    item: mon.item,
    ability: mon.ability,
    nature: mon.nature,
    evs: mon.evs,
    ivs: mon.ivs,
    level: mon.level,
    boosts: mon.boosts,
    status: mon.status,
    teraType: mon.isTera ? mon.teraType : undefined,
  };
}

function toFieldSpec(input: CalculateDamageInput): CalcFieldSpec | undefined {
  const f = input.field;
  if (!f) return undefined;
  return {
    gameType: f.gameType ?? 'Singles',
    weather: f.weather,
    terrain: f.terrain,
    isBeadsOfRuin: f.isBeadsOfRuin,
    isSwordOfRuin: f.isSwordOfRuin,
    isTabletsOfRuin: f.isTabletsOfRuin,
    isVesselOfRuin: f.isVesselOfRuin,
    defenderSide: {
      isSR: f.isStealthRock,
      spikes: f.spikes,
      isReflect: f.isReflect,
      isLightScreen: f.isLightScreen,
    },
  };
}

export function calculateDamage(input: CalculateDamageInput): CalculateDamageResult {
  const gen = getGeneration(input.gen ?? 9);
  const names = { move: input.move, attacker: input.attacker.species, defender: input.defender.species };

  const attacker = buildCalcPokemon(gen, toMonSpec(input.attacker));
  if (!attacker.ok) {
    return { ...names, error: `attacker: ${attacker.error.message}`, error_code: attacker.error.code };
  }
  const defender = buildCalcPokemon(gen, toMonSpec(input.defender));
  if (!defender.ok) {
    return { ...names, error: `defender: ${defender.error.message}`, error_code: defender.error.code };
  }

  const outcome = runDamageCalc(gen, attacker.value, defender.value, input.move, buildCalcField(toFieldSpec(input)));
  if (!outcome.ok) {
    return { ...names, error: outcome.error.message, error_code: outcome.error.code };
  }

  const r = outcome.value;
  return {
    ...names,
    move: r.move,
    damage: r.damage,
    ko_chance: r.koText || 'N/A',
    description: r.description,
    rolls: r.rolls,
  };
}

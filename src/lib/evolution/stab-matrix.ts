import type { SpeciesTypeInfo } from '@/lib/pkmn/dex';

export type StabMultiplierLabel = '4x' | '2x' | '1x' | '½x' | '¼x' | '0x';

export interface StabCell {
  multiplier: number;
  label: StabMultiplierLabel;
}

const MULTIPLIER_RANK: Record<StabMultiplierLabel, number> = {
  '0x': 0,
  '¼x': 1,
  '½x': 2,
  '1x': 3,
  '2x': 4,
  '4x': 5,
};

/** Best STAB effectiveness of attacker's own types against a defender. */
export function bestStabMultiplier(
  attacker: SpeciesTypeInfo,
  defender: SpeciesTypeInfo,
  typeChart: TypeChart,
): StabCell {
  let bestMult = 0;

  for (const atkType of attacker.types) {
    const mult = effectivenessAgainstDefender(atkType, defender.types, typeChart);
    if (mult > bestMult) bestMult = mult;
  }

  return { multiplier: bestMult, label: multiplierLabel(bestMult) };
}

export interface TypeChart {
  /** Returns damage multiplier for attackType hitting defType (1, 2, 0.5, 0). */
  getMultiplier: (attackType: string, defType: string) => number;
}

/** Build a type chart from SpeciesTypeInfo weakness/resistance/immunity lists. */
export function typeChartFromDefender(defender: SpeciesTypeInfo): TypeChart {
  return {
    getMultiplier(attackType: string, _defType: string) {
      if (defender.immunities.includes(attackType)) return 0;
      if (defender.weaknesses.includes(attackType)) return 2;
      if (defender.resistances.includes(attackType)) return 0.5;
      return 1;
    },
  };
}

/** Combined effectiveness of one attack type against a dual-type defender. */
export function effectivenessAgainstDefender(
  attackType: string,
  defenderTypes: string[],
  chart: TypeChart,
): number {
  let mult = 1;
  for (const defType of defenderTypes) {
    mult *= chart.getMultiplier(attackType, defType);
  }
  return mult;
}

export function multiplierLabel(mult: number): StabMultiplierLabel {
  if (mult === 0) return '0x';
  if (mult <= 0.25) return '¼x';
  if (mult <= 0.5) return '½x';
  if (mult >= 4) return '4x';
  if (mult >= 2) return '2x';
  return '1x';
}

export const STAB_CELL_STYLES: Record<StabMultiplierLabel, string> = {
  '4x': 'bg-emerald-900/50 text-emerald-300 font-bold',
  '2x': 'bg-green-900/40 text-green-400',
  '1x': 'bg-poke-elevated text-poke-text-secondary',
  '½x': 'bg-orange-900/40 text-orange-400',
  '¼x': 'bg-orange-950/50 text-orange-300',
  '0x': 'bg-red-900/40 text-red-400',
};

export function compareStabLabels(a: StabMultiplierLabel, b: StabMultiplierLabel): number {
  return MULTIPLIER_RANK[a] - MULTIPLIER_RANK[b];
}

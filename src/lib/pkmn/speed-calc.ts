import type { NatureEffect, SpeedResult } from '@/types/speed';

/**
 * Calculate effective speed stat at a given level (Gen 3+ formula).
 */
export function calcSpeed(params: {
  baseSpe: number;
  level: number;
  ev: number;
  iv: number;
  nature: NatureEffect;
  item?: string;
  ability?: string;
  status?: string;
  boosts?: number;
  weather?: string;
  terrain?: string;
  generation?: number;
}): SpeedResult {
  const natureMod = params.nature === 'positive' ? 1.1
    : params.nature === 'negative' ? 0.9
    : 1.0;

  const rawStat = Math.floor(
    (Math.floor((2 * params.baseSpe + params.iv + Math.floor(params.ev / 4))
      * params.level / 100) + 5) * natureMod
  );

  // Item modifier
  let itemMod = 1.0;
  const item = params.item?.toLowerCase() ?? '';
  if (item === 'choice scarf') itemMod = 1.5;
  if (item === 'iron ball' || item === 'macho brace') itemMod = 0.5;
  if (item.startsWith('power ')) itemMod = 0.5; // Power Weight etc.
  if (item === 'quick powder') itemMod = 2.0; // Ditto only

  // Ability modifier (weather/terrain dependent)
  let abilityMod = 1.0;
  const ability = params.ability?.toLowerCase() ?? '';
  if (ability === 'chlorophyll' && params.weather === 'Sun') abilityMod = 2.0;
  if (ability === 'sand rush' && params.weather === 'Sand') abilityMod = 2.0;
  if (ability === 'swift swim' && params.weather === 'Rain') abilityMod = 2.0;
  if (ability === 'slush rush' && params.weather === 'Snow') abilityMod = 2.0;
  if (ability === 'surge surfer' && params.terrain === 'Electric') abilityMod = 2.0;
  if (ability === 'unburden') abilityMod = 2.0; // Assumes item consumed
  if (ability === 'quick feet' && params.status) abilityMod = 1.5;
  if (ability === 'slow start') abilityMod = 0.5;

  // Status modifier — Gen 7+ halves speed, Gen 1-6 quarters it
  let statusMod = 1.0;
  if (params.status === 'par') {
    const gen = params.generation ?? 9;
    statusMod = gen >= 7 ? 0.5 : 0.25;
  }

  // Boost stages
  const boosts = params.boosts ?? 0;
  const boostMod = boosts >= 0
    ? (2 + boosts) / 2
    : 2 / (2 - boosts);

  const finalSpeed = Math.floor(rawStat * itemMod * abilityMod * statusMod * boostMod);

  return {
    raw: rawStat,
    withItem: Math.floor(rawStat * itemMod),
    withAbility: Math.floor(rawStat * itemMod * abilityMod),
    final: finalSpeed,
    modifiers: {
      item: params.item && itemMod !== 1.0 ? { name: params.item, mod: itemMod } : null,
      ability: params.ability && abilityMod !== 1.0 ? { name: params.ability, mod: abilityMod } : null,
      status: params.status && statusMod !== 1.0 ? { name: params.status, mod: statusMod } : null,
      boosts,
    },
  };
}

/**
 * Determine if a nature is speed-positive, negative, or neutral.
 */
export function getNatureEffect(nature: string): NatureEffect {
  const POSITIVE = ['Jolly', 'Timid', 'Hasty', 'Naive'];
  const NEGATIVE = ['Brave', 'Relaxed', 'Quiet', 'Sassy'];
  if (POSITIVE.includes(nature)) return 'positive';
  if (NEGATIVE.includes(nature)) return 'negative';
  return 'neutral';
}

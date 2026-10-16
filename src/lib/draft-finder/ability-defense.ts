/**
 * Defensive abilities of the finder's resist / immune filters (draft-frontend §4.5, FR-9). Client-safe, pure.
 *
 * League configuration ids (AGENTS.md "Pokémon Data Rules" exception), validated against `@pkmn/dex` by
 * `__tests__/ability-defense.server.test.ts`. Display names come from `src/lib/pkmn/i18n`.
 *
 * Wind Rider is deliberately absent: it blocks wind moves, not a type, so it cannot be evaluated per type
 * (FR-9). Weakness filters use typing only.
 */
import { getEffectiveness } from '@/lib/pkmn/type-chart';
import type { TypeId } from './index-types';

export const ABILITY_DEFENSE: Readonly<Record<string, { immune?: TypeId[]; halve?: TypeId[] }>> = {
  levitate: { immune: ['Ground'] },
  eartheater: { immune: ['Ground'] },
  flashfire: { immune: ['Fire'] },
  wellbakedbody: { immune: ['Fire'] },
  voltabsorb: { immune: ['Electric'] },
  lightningrod: { immune: ['Electric'] },
  motordrive: { immune: ['Electric'] },
  waterabsorb: { immune: ['Water'] },
  stormdrain: { immune: ['Water'] },
  dryskin: { immune: ['Water'] },
  sapsipper: { immune: ['Grass'] },
  purifyingsalt: { halve: ['Ghost'] },
  thickfat: { halve: ['Fire', 'Ice'] },
  heatproof: { halve: ['Fire'] },
  waterbubble: { halve: ['Fire'] },
}; // Wind Rider deliberately absent (FR-9)

/** Type effectiveness of `atk` against the defending typing (0, 0.25, 0.5, 1, 2, 4). */
export function typingMultiplier(atk: TypeId, defTypes: readonly TypeId[]): number {
  return getEffectiveness(atk, [...defTypes]);
}

/**
 * The multiplier of `atk` against the typing with ability `abilityId`:
 * `typeEff × (immune ∋ atk ? 0 : 1) × (halve ∋ atk ? 0.5 : 1)`. `null` when the ability changes nothing for `atk`.
 */
export function abilityMultiplier(abilityId: string, atk: TypeId, defTypes: readonly TypeId[]): number | null {
  const def = ABILITY_DEFENSE[abilityId];
  if (!def) return null;
  const immune = def.immune?.includes(atk) ?? false;
  const halve = def.halve?.includes(atk) ?? false;
  if (!immune && !halve) return null;
  return typingMultiplier(atk, defTypes) * (immune ? 0 : 1) * (halve ? 0.5 : 1);
}

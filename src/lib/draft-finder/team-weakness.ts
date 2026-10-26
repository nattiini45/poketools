/**
 * Typing arithmetic of the team weakness overview under "My roster" (draft-frontend §5.5). Client-safe, pure.
 *
 * `defensiveProfile` turns a typing into the damage multiplier of each of the 18 attacking types
 * (`TYPES` order); `summarizeTeam` counts, per attacking type, how many profiles of a team are weak to it,
 * resist it or are immune. Typing only: abilities, Tera types and items are not modelled (the finder's
 * weakness filter reads typing only as well). Everything here is factual (multipliers and counts), never a
 * verdict on the team.
 *
 * Empty types (a stage the dex could not resolve, see `build-index.server.ts`) have NO profile: `null`
 * means "no data", never an all-neutral row that would pass for a typing without weaknesses.
 */
import { getEffectiveness, TYPES } from '@/lib/pkmn/type-chart';
import type { TypeId } from './index-types';

/** The multiplier an attacking type deals to a typing, one entry per attacking type in `TYPES` order. */
export type DefensiveProfile = readonly number[];

/** How a multiplier reads: `quad` is a 4× weakness, `weak` a 2× one. */
export type Effect = 'immune' | 'resist' | 'neutral' | 'weak' | 'quad';

/** Per attacking type: how many profiles take more than neutral damage, less than neutral, or none. */
export interface TypeTally {
  weak: number;
  resist: number;
  immune: number;
}

/** The profile of a typing, or null when `types` is empty (no data). */
export function defensiveProfile(types: readonly TypeId[]): DefensiveProfile | null {
  if (types.length === 0) return null;
  const defending = [...types];
  return TYPES.map((attacking) => getEffectiveness(attacking, defending));
}

/** The class of a multiplier (0, ¼, ½, 1, 2, 4). */
export function effectOf(multiplier: number): Effect {
  if (multiplier === 0) return 'immune';
  if (multiplier < 1) return 'resist';
  if (multiplier === 1) return 'neutral';
  return multiplier >= 4 ? 'quad' : 'weak';
}

/** The cell text of a multiplier: '0×', '¼×', '½×', '2×', '4×'; empty for a neutral 1×. */
export function multiplierLabel(multiplier: number): string {
  if (multiplier === 1) return '';
  if (multiplier === 0.25) return '¼×';
  if (multiplier === 0.5) return '½×';
  return `${multiplier}×`;
}

/**
 * The per-attacking-type tally of a team (`TYPES` order). Weak counts 2× and 4×, resist ¼× and ½×, immune 0×;
 * neutral 1× counts nowhere. Profiles without data (`null`) are skipped.
 */
export function summarizeTeam(profiles: readonly (DefensiveProfile | null)[]): TypeTally[] {
  const tallies: TypeTally[] = TYPES.map(() => ({ weak: 0, resist: 0, immune: 0 }));
  for (const profile of profiles) {
    if (!profile) continue;
    profile.forEach((multiplier, i) => {
      const effect = effectOf(multiplier);
      if (effect === 'weak' || effect === 'quad') tallies[i].weak += 1;
      else if (effect === 'resist') tallies[i].resist += 1;
      else if (effect === 'immune') tallies[i].immune += 1;
    });
  }
  return tallies;
}

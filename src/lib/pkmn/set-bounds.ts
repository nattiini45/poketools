/**
 * Keeps a set inside the bounds the team boundaries enforce (`pokemonSetSchema`, `src/lib/validation/schemas.ts`):
 * whole-number EVs 0 to 252 and IVs 0 to 31, a whole-number level 1 to 100, happiness 0 to 255, at most four moves,
 * capped strings. The schema stays strict (a save with a value outside them is a 400); this is the other half, for the
 * code that PRODUCES values: the editor's number inputs and the commands an AI proposal is applied with. A value that
 * is not a number takes the fallback; a decimal is truncated first, then clamped. Pure and client-safe.
 */
import type { PokemonSet, StatSpread } from '@/types/team';

/** A set, a patch of one, or just a spread: any of the members may be absent, and a spread may be partial. */
export type SetLike = Omit<Partial<PokemonSet>, 'evs' | 'ivs'> & { evs?: Partial<StatSpread>; ivs?: Partial<StatSpread> };

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const NAME_MAX = 100;
const LABEL_MAX = 50;

/** `value` as a whole number in `[min, max]`: truncated, then clamped; anything that is not a finite number is `fallback`. */
export function toBoundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

function boundSpread(spread: unknown, max: number, fallback: number): Partial<StatSpread> {
  const out: Partial<StatSpread> = {};
  if (typeof spread !== 'object' || spread === null) return out;
  for (const stat of STATS) {
    const value = (spread as Record<string, unknown>)[stat];
    if (value !== undefined) out[stat] = toBoundedInt(value, 0, max, fallback);
  }
  return out;
}

/**
 * The bounded copy of a (partial) set. Only the members present are touched, so it serves a full set (a proposal) and a
 * patch (`apply_set`, a spread) alike.
 */
export function boundSet<T extends SetLike>(set: T): T {
  const out: SetLike = { ...set };
  if (set.evs !== undefined) out.evs = boundSpread(set.evs, 252, 0);
  if (set.ivs !== undefined) out.ivs = boundSpread(set.ivs, 31, 31);
  if (set.level !== undefined) out.level = toBoundedInt(set.level, 1, 100, 100);
  if (set.happiness !== undefined) out.happiness = toBoundedInt(set.happiness, 0, 255, 255);
  if (set.moves !== undefined) {
    out.moves = (Array.isArray(set.moves) ? set.moves : []).slice(0, 4).map((m) => text(m, NAME_MAX));
  }
  if (set.name !== undefined) out.name = text(set.name, NAME_MAX);
  if (set.species !== undefined) out.species = text(set.species, NAME_MAX);
  if (set.item !== undefined) out.item = text(set.item, NAME_MAX);
  if (set.ability !== undefined) out.ability = text(set.ability, NAME_MAX);
  if (set.nature !== undefined) out.nature = text(set.nature, LABEL_MAX);
  if (set.tera_type !== undefined) out.tera_type = text(set.tera_type, LABEL_MAX);
  if (set.gender !== undefined) out.gender = set.gender === 'M' || set.gender === 'F' || set.gender === 'N' ? set.gender : '';
  return out as T;
}

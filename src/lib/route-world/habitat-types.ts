/**
 * Habitat vocabulary for manifest casting (D35 Pokémon core round, 3B).
 *
 * D18: this is the ONLY table that maps habitats to types, and the ONLY home
 * of the 18-type vocabulary (`attack-moves.ts` imports `POKEMON_TYPES`
 * instead of restating it). The habitat ids are deliberately not type words,
 * so they pass the species/type literal lint (`no-species-literals.test.ts`,
 * which allowlists this file). Types come from the baked manifest (`types`,
 * else `primaryType`, both from @pkmn/dex at bake time), never a species table.
 *
 * Rationale per habitat (the rows of `HABITAT_TYPES`):
 *  - aquatic  — lakes and tarns (floaters, waders, the surfacer, shore sitters):
 *               primary water only, so a secondary-water figure never floats.
 *  - grove    — the sakura bug / grass grove line: primary bug or grass.
 *  - alpine   — rock and scree ledges: primary rock or ground.
 *  - snow     — the mountain snow family: ice by EITHER type once `types` is
 *               baked (lets in dragon/ice lines); primary-only manifests
 *               fall back to primary ice.
 *  - sky-isle — the clouds isles: primary electric / psychic / ghost / flying,
 *               rejecting fighting (a grounded brawler does not float there).
 *  - air      — lane flyers and hovers: flying by either type. On a manifest
 *               without `types` it uses the DISCLOSED over-inclusive
 *               primary-only fallback (flying or dragon): it admits
 *               grounded dragons, so the slot's height band and clip needs
 *               must carry the weight (no animated figure is primary flying).
 *  - street   — the plaza: any type.
 *
 * Pure, no client-only imports, no randomness.
 */
import type { FigureEntry } from './model-manifest';

/** The 18 types, lower-case: the ONE vocabulary (attack-moves.ts imports it). */
export const POKEMON_TYPES = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

const TYPE_SET: ReadonlySet<string> = new Set(POKEMON_TYPES);

/** Normalise a manifest spelling ('Water', ' FIRE ') to a type; null when absent or unknown (NOT 'normal'). */
export function normalizeType(raw: string | null | undefined): PokemonType | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  return TYPE_SET.has(lower) ? (lower as PokemonType) : null;
}

/** The manifest fields types are read from. */
export type TypedEntry = Pick<FigureEntry, 'primaryType' | 'types'>;

/**
 * Every type of an entry, primary first, deduped: the baked `types` when
 * present, else `[primaryType]`, else `[]`. Unknown spellings are dropped.
 */
export function entryTypes(entry: TypedEntry): PokemonType[] {
  const out: PokemonType[] = [];
  const push = (raw: string | null | undefined) => {
    const type = normalizeType(raw);
    if (type && !out.includes(type)) out.push(type);
  };
  if (entry.types && entry.types.length > 0) for (const raw of entry.types) push(raw);
  else push(entry.primaryType);
  return out;
}

/** Does the entry carry baked type data at all (a v2 manifest does not)? */
export function hasTypeData(entry: TypedEntry): boolean {
  return entryTypes(entry).length > 0;
}

/** Semantic habitats a cast slot asks for. Changing this list needs the lead. */
export const HABITATS = ['aquatic', 'grove', 'alpine', 'snow', 'sky-isle', 'air', 'street'] as const;

export type HabitatId = (typeof HABITATS)[number];

export interface HabitatRule {
  /** Accepted when the PRIMARY type is one of these. */
  primary: readonly PokemonType[];
  /** Also accepted when ANY baked type is one of these (needs `types`; ignored on primary-only entries). */
  anyType?: readonly PokemonType[];
  /**
   * Primary list used INSTEAD of `primary` when the entry has no baked
   * `types` (the disclosed fallback of a habitat that really wants `anyType`).
   */
  primaryWithoutTypes?: readonly PokemonType[];
  /** Rejected when any known type is one of these (checked after acceptance). */
  reject?: readonly PokemonType[];
  /** Human rationale, for the header and the debug readout. */
  note: string;
}

/** THE table. Exhaustive: adding a habitat without a rule is a compile error. */
export const HABITAT_TYPES: Readonly<Record<HabitatId, HabitatRule>> = {
  aquatic: { primary: ['water'], note: 'lakes and tarns: primary water only' },
  grove: { primary: ['bug', 'grass'], note: 'grove line: primary bug or grass' },
  alpine: { primary: ['rock', 'ground'], note: 'rock and scree: primary rock or ground' },
  snow: { primary: ['ice'], anyType: ['ice'], note: 'snow family: ice by either type (primary-only without types)' },
  'sky-isle': {
    primary: ['electric', 'psychic', 'ghost', 'flying'],
    reject: ['fighting'],
    note: 'cloud isles: primary electric/psychic/ghost/flying, never fighting',
  },
  air: {
    primary: ['flying'],
    anyType: ['flying'],
    primaryWithoutTypes: ['flying', 'dragon'],
    note: 'flyers: flying by either type; without types a disclosed over-inclusive primary flying/dragon fallback',
  },
  street: { primary: POKEMON_TYPES, note: 'plaza: any type' },
};

/** Does `habitat` accept this entry? False when the entry has no type data. */
export function habitatAccepts(habitat: HabitatId, entry: TypedEntry): boolean {
  const rule = HABITAT_TYPES[habitat];
  const types = entryTypes(entry);
  if (types.length === 0) return false;
  const baked = !!entry.types && entry.types.length > 0;
  const primaryList = !baked && rule.primaryWithoutTypes ? rule.primaryWithoutTypes : rule.primary;
  let accepted = primaryList.includes(types[0]);
  if (!accepted && baked && rule.anyType) accepted = types.some((t) => rule.anyType!.includes(t));
  if (!accepted) return false;
  if (rule.reject && types.some((t) => rule.reject!.includes(t))) return false;
  return true;
}

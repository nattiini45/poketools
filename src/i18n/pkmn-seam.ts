/**
 * Seam to the Pokémon data layer (i18n-core §1.8). Types and constants only:
 * the core never imports the German dex dictionaries. The pkmn layer
 * (`src/lib/pkmn/i18n`) implements the per-kind localizers and reads the
 * viewer's data locale from `useDataLocale()` / `getDataLocale()` /
 * `getRequestDataLocale()`.
 */

export type PkmnNameKind =
  | 'species'
  | 'move'
  | 'item'
  | 'ability'
  | 'type'
  | 'nature'
  | 'stat'
  | 'statShort'
  | 'status'
  | 'weather'
  | 'terrain'
  | 'category';

/** Localizes one canonical English `@pkmn` name (never an id) for display. */
export type PkmnParamLocalizer = (kind: PkmnNameKind, englishNameOrId: string) => string;

/** Error/message params with these names carry an English @pkmn name and are localized for display. */
export const PKMN_PARAM_KINDS = {
  pokemon: 'species',
  species: 'species',
  base: 'species',
  stage2: 'species',
  stage3: 'species',
  move: 'move',
  item: 'item',
  ability: 'ability',
  type: 'type',
  nature: 'nature',
} as const satisfies Record<string, PkmnNameKind>;

export type PkmnParamName = keyof typeof PKMN_PARAM_KINDS;

/**
 * Error/message params whose value is a `separator`-joined list of English
 * @pkmn names (e.g. a core triple `Fire/Water/Grass`). Each element is
 * localized on its own and the list is rejoined with the same separator.
 */
export const PKMN_LIST_PARAM_KINDS = {
  types: { kind: 'type', separator: '/' },
} as const satisfies Record<string, { kind: PkmnNameKind; separator: string }>;

export type PkmnListParamName = keyof typeof PKMN_LIST_PARAM_KINDS;

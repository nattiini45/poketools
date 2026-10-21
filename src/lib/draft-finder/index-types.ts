/**
 * Draft search index payload (draft-backend §3.1, critique S7). Client-safe: types and one constant.
 *
 * The shape is owned by draft-backend; this file declares it verbatim. A shape change is made in the
 * backend design first. The index carries no German strings: display names come from `src/lib/pkmn/i18n`
 * at render time, fed with the canonical English `moveNames` / `abilityNames`.
 */

export const INDEX_SCHEMA_VERSION = 2 as const; // 2 = adds moveNames/abilityNames (v1 never shipped)

export type TypeId =
  | 'Normal'
  | 'Fire'
  | 'Water'
  | 'Electric'
  | 'Grass'
  | 'Ice'
  | 'Fighting'
  | 'Poison'
  | 'Ground'
  | 'Flying'
  | 'Psychic'
  | 'Bug'
  | 'Rock'
  | 'Ghost'
  | 'Dragon'
  | 'Dark'
  | 'Steel'
  | 'Fairy'; // canonical English (= TYPES, src/lib/pkmn/type-chart.ts:7)

export type StatTuple = [hp: number, atk: number, def: number, spa: number, spd: number, spe: number];

export interface DraftSearchIndex {
  v: typeof INDEX_SCHEMA_VERSION;
  listVersionId: string;
  /** @pkmn move ids, sorted ascending; lines reference them by index. */
  moves: string[];
  /** Canonical English move names, moveNames[i] is the name of moves[i] (critique S7). */
  moveNames: string[];
  /** @pkmn ability ids, sorted ascending. */
  abilities: string[];
  /** Canonical English ability names, parallel to abilities. */
  abilityNames: string[];
  /** In list order (line_number). */
  lines: IndexLine[];
}

export interface IndexLine {
  /** Stored point_buy_list_entries.line_id, e.g. 'oshawott--samurotthisui'. */
  lineId: string;
  /** point_buy_list_entries.id */
  entryId: string;
  price: number;
  /** Length 2..3 in list order; never assume 3. */
  stages: IndexStage[];
}

export interface IndexStage {
  stage: 1 | 2 | 3;
  /** @pkmn id, e.g. 'samurotthisui'. */
  speciesId: string;
  /** Canonical Showdown name 'Samurott-Hisui' (sprite key + localization input). */
  name: string;
  types: TypeId[];
  /** Indices into `abilities` (all slots incl. hidden). */
  abilities: number[];
  stats: StatTuple;
  /** Ascending indices into `moves`; FULL Gen 9 learnable set for THIS species (Paldea). */
  moves: number[];
}

const TYPE_IDS: ReadonlySet<string> = new Set<TypeId>([
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
]);

/** Narrows an English type name to `TypeId`. */
export function isTypeId(value: string): value is TypeId {
  return TYPE_IDS.has(value);
}

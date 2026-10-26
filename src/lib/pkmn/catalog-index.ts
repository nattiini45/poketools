/**
 * The wire shapes of the entry catalog the Ruleset Studio pickers read (`GET /api/pkmn/catalog/[kind]`): one row per
 * Pokémon, move, item or ability of a generation, as a short array (not an object) so a 1,400-row National Dex index
 * stays small. Types and decoders only: pure and client-safe (no `@pkmn`, no React). The rows are built on the server
 * (`./catalog-index.server.ts`), where the dex lives.
 *
 * The index carries what filtering, sorting and drawing need (ids, English names, types, tiers, numbers, an icon sheet
 * cell). The descriptions are a second part (`CatalogText`) that loads after the first paint and in the viewer's
 * language. Names are English everywhere; German names come from the name layer (`@/lib/pkmn/i18n/names`).
 *
 * Icon cells: the Showdown icon sheets are one image each. `ic` is the cell number (Pokémon sheet: 12 columns of 40x30,
 * item sheet: 16 columns of 24x24); `null` means the sheet has no art for the entry and the picker draws a fallback.
 */
import { WIKI_ITEM_CATEGORIES, type WikiItemCategory } from '@/lib/wiki/item-category';

export const CATALOG_KINDS = ['species', 'moves', 'items', 'abilities'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const CATALOG_SCOPES = ['standard', 'national'] as const;
export type CatalogScope = (typeof CATALOG_SCOPES)[number];

export function isCatalogKind(value: unknown): value is CatalogKind {
  return typeof value === 'string' && (CATALOG_KINDS as readonly string[]).includes(value);
}

export function isCatalogScope(value: unknown): value is CatalogScope {
  return value === 'standard' || value === 'national';
}

/** Bit flags of a species row. */
export const SPECIES_FLAG = {
  /** Not the base forme of its species (a regional form, a Mega, an alternate forme). */
  FORME: 1,
  /** A Mega Evolution or a Primal reversion. */
  MEGA: 2,
  /** Has an evolution (not fully evolved). */
  NFE: 4,
  /** Only in the National Dex universe: the generation dropped it. */
  PAST: 8,
  /** The dex files it under a later generation (a Champions roster entry the game has not shipped). */
  FUTURE: 16,
  /** Only exists inside a battle (Aegislash-Blade, Mimikyu-Busted): nobody brings it, so pickers hide it unless a ban names it. */
  BATTLE_ONLY: 32,
} as const;

/** The only flag of the other three kinds: the generation dropped the entry. */
export const PAST_FLAG = 1;

/** `[id, name, types, tier, doublesTier, natDexTier, baseSpeciesId | 0, stats, gen, flags, iconCell]`. */
export type SpeciesRow = readonly [
  id: string,
  name: string,
  types: readonly string[],
  tier: string,
  doublesTier: string,
  natDexTier: string,
  baseId: string | 0,
  stats: readonly [number, number, number, number, number, number],
  gen: number,
  flags: number,
  ic: number | null,
];

export const MOVE_CATEGORY_NAMES = ['Physical', 'Special', 'Status'] as const;
export type MoveCategoryName = (typeof MOVE_CATEGORY_NAMES)[number];

/** `[id, name, type, category index, power, accuracy (0 = never misses), pp, gen, flags]`. */
export type MoveRow = readonly [
  id: string,
  name: string,
  type: string,
  category: 0 | 1 | 2,
  power: number,
  accuracy: number,
  pp: number,
  gen: number,
  flags: number,
];

/** `[id, name, category index into WIKI_ITEM_CATEGORIES, gen, iconCell, flags]`. */
export type ItemRow = readonly [id: string, name: string, category: number, gen: number, ic: number | null, flags: number];

/** `[id, name, gen, flags]`. */
export type AbilityRow = readonly [id: string, name: string, gen: number, flags: number];

export interface CatalogRowsByKind {
  species: SpeciesRow;
  moves: MoveRow;
  items: ItemRow;
  abilities: AbilityRow;
}

/** The first part of the catalog response: every entry of a kind in a generation and scope. */
export interface CatalogIndex<K extends CatalogKind = CatalogKind> {
  v: 1;
  kind: K;
  gen: number;
  scope: CatalogScope;
  /** The preset the rows were extended for (a Champions roster), or null. */
  preset: string | null;
  rows: CatalogRowsByKind[K][];
}

/** The second part: one-line descriptions in the viewer's language. */
export interface CatalogText {
  v: 1;
  kind: Exclude<CatalogKind, 'species'>;
  gen: number;
  scope: CatalogScope;
  lang: 'en' | 'de';
  /** Id to description. */
  text: Record<string, string>;
  /** Ids whose text is the English one although German was asked (no German text exists). */
  fallback: string[];
}

// ── Decoded entries ──────────────────────────────────────────────────────────────

interface EntryBase {
  id: string;
  /** Canonical English name. */
  name: string;
  /** The generation that introduced it. */
  gen: number;
  /** Only part of the National Dex universe. */
  past: boolean;
}

export interface SpeciesEntry extends EntryBase {
  kind: 'species';
  types: readonly string[];
  tier: string;
  doublesTier: string;
  natDexTier: string;
  /** The id of the base species when this is a forme of another species. */
  baseId: string | null;
  stats: readonly number[];
  bst: number;
  forme: boolean;
  mega: boolean;
  nfe: boolean;
  future: boolean;
  battleOnly: boolean;
  ic: number | null;
}

export interface MoveEntry extends EntryBase {
  kind: 'moves';
  type: string;
  category: MoveCategoryName;
  power: number;
  /** null: the move never misses. */
  accuracy: number | null;
  pp: number;
}

export interface ItemEntry extends EntryBase {
  kind: 'items';
  category: WikiItemCategory;
  ic: number | null;
}

export interface AbilityEntry extends EntryBase {
  kind: 'abilities';
}

export type CatalogEntry = SpeciesEntry | MoveEntry | ItemEntry | AbilityEntry;

export interface CatalogEntryByKind {
  species: SpeciesEntry;
  moves: MoveEntry;
  items: ItemEntry;
  abilities: AbilityEntry;
}

export function decodeSpecies(row: SpeciesRow): SpeciesEntry {
  const [id, name, types, tier, doublesTier, natDexTier, baseId, stats, gen, flags, ic] = row;
  return {
    kind: 'species',
    id,
    name,
    gen,
    past: (flags & SPECIES_FLAG.PAST) !== 0,
    types,
    tier,
    doublesTier,
    natDexTier,
    baseId: baseId === 0 ? null : baseId,
    stats,
    bst: stats.reduce((sum, value) => sum + value, 0),
    forme: (flags & SPECIES_FLAG.FORME) !== 0,
    mega: (flags & SPECIES_FLAG.MEGA) !== 0,
    nfe: (flags & SPECIES_FLAG.NFE) !== 0,
    future: (flags & SPECIES_FLAG.FUTURE) !== 0,
    battleOnly: (flags & SPECIES_FLAG.BATTLE_ONLY) !== 0,
    ic,
  };
}

export function decodeMove(row: MoveRow): MoveEntry {
  const [id, name, type, category, power, accuracy, pp, gen, flags] = row;
  return {
    kind: 'moves',
    id,
    name,
    gen,
    past: (flags & PAST_FLAG) !== 0,
    type,
    category: MOVE_CATEGORY_NAMES[category] ?? 'Status',
    power,
    accuracy: accuracy === 0 ? null : accuracy,
    pp,
  };
}

export function decodeItem(row: ItemRow): ItemEntry {
  const [id, name, category, gen, ic, flags] = row;
  return { kind: 'items', id, name, gen, past: (flags & PAST_FLAG) !== 0, category: WIKI_ITEM_CATEGORIES[category] ?? 'Other', ic };
}

export function decodeAbility(row: AbilityRow): AbilityEntry {
  const [id, name, gen, flags] = row;
  return { kind: 'abilities', id, name, gen, past: (flags & PAST_FLAG) !== 0 };
}

/** The decoded entries of an index, in row order. */
export function decodeIndex<K extends CatalogKind>(index: CatalogIndex<K>): CatalogEntryByKind[K][] {
  const rows = index.rows as readonly unknown[];
  switch (index.kind) {
    case 'species':
      return (rows as SpeciesRow[]).map(decodeSpecies) as CatalogEntryByKind[K][];
    case 'moves':
      return (rows as MoveRow[]).map(decodeMove) as CatalogEntryByKind[K][];
    case 'items':
      return (rows as ItemRow[]).map(decodeItem) as CatalogEntryByKind[K][];
    default:
      return (rows as AbilityRow[]).map(decodeAbility) as CatalogEntryByKind[K][];
  }
}

// ── Sheet geometry (shared by the server that computes cells and the component that draws them) ──

export const POKEMON_SHEET = { url: 'https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png', columns: 12, cellWidth: 40, cellHeight: 30 } as const;
export const ITEM_SHEET = { url: 'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png', columns: 16, cellWidth: 24, cellHeight: 24 } as const;

export interface SheetGeometry {
  url: string;
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

/** The background offset (negative pixels) of a cell. */
export function sheetOffset(sheet: SheetGeometry, cell: number): { left: number; top: number } {
  return { left: -(cell % sheet.columns) * sheet.cellWidth, top: -Math.floor(cell / sheet.columns) * sheet.cellHeight };
}

/** The cell number of a background offset, the inverse of `sheetOffset`. */
export function sheetCell(sheet: SheetGeometry, left: number, top: number): number {
  return (Math.abs(top) / sheet.cellHeight) * sheet.columns + Math.abs(left) / sheet.cellWidth;
}

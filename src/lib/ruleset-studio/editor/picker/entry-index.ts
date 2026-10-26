/**
 * The client index over a catalog response: the decoded entries in catalog order, an id lookup, the formes of each
 * species and lazily built search keys (English + German + transliteration, from the name layer). Pure and client-safe.
 *
 * Search keys are built on first use per entry and kept: a 1,400-species index is searched thousands of times while the
 * author types, but most entries are never matched against more than once per keystroke.
 */
import { decodeIndex, type CatalogEntry, type CatalogEntryByKind, type CatalogIndex, type CatalogKind, type SpeciesEntry } from '@/lib/pkmn/catalog-index';
import { abilitySearchKeys } from '@/lib/pkmn/i18n/names/abilities';
import { itemSearchKeys } from '@/lib/pkmn/i18n/names/items';
import { moveSearchKeys } from '@/lib/pkmn/i18n/names/moves';
import { speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import type { SearchKeys } from '@/lib/pkmn/i18n/search';

const KEYS_OF: Record<CatalogKind, (englishName: string) => SearchKeys> = {
  species: speciesSearchKeys,
  moves: moveSearchKeys,
  items: itemSearchKeys,
  abilities: abilitySearchKeys,
};

export interface EntryIndex<K extends CatalogKind = CatalogKind> {
  kind: K;
  gen: number;
  /** Catalog order: by English name. */
  entries: readonly CatalogEntryByKind[K][];
  byId: ReadonlyMap<string, CatalogEntryByKind[K]>;
  /** The ids of a species' formes (including Megas), by the id of its base species. */
  formesOf: ReadonlyMap<string, readonly string[]>;
  /** The match keys of an entry, built on first use. */
  searchKeys: (entry: CatalogEntry) => SearchKeys;
}

export function buildEntryIndex<K extends CatalogKind>(index: CatalogIndex<K>): EntryIndex<K> {
  const entries = decodeIndex(index);
  const byId = new Map<string, CatalogEntryByKind[K]>();
  const formes = new Map<string, string[]>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    if (entry.kind === 'species' && entry.baseId !== null) {
      const list = formes.get(entry.baseId);
      if (list === undefined) formes.set(entry.baseId, [entry.id]);
      else list.push(entry.id);
    }
  }
  const cache = new Map<string, SearchKeys>();
  const kind = index.kind;
  return {
    kind,
    gen: index.gen,
    entries,
    byId,
    formesOf: formes,
    searchKeys(entry) {
      let keys = cache.get(entry.id);
      if (keys === undefined) {
        keys = KEYS_OF[kind](entry.name);
        cache.set(entry.id, keys);
      }
      return keys;
    },
  };
}

/** Narrows an index to the Pokémon index. */
export function isSpeciesIndex(index: EntryIndex): index is EntryIndex<'species'> {
  return index.kind === 'species';
}

/** The id of the species a species entry belongs to: its base species, or itself. */
export function rootOf(entry: SpeciesEntry): string {
  return entry.baseId ?? entry.id;
}

/**
 * The ids a "whole species" action covers for the given species ids: each one's base species and every forme of it that
 * the index lists (regional forms, Megas, alternate formes). An id the index does not know stays as it is.
 */
export function wholeSpeciesIds(index: EntryIndex<'species'>, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const entry = index.byId.get(id);
    const root = entry === undefined ? id : rootOf(entry);
    out.add(root);
    for (const forme of index.formesOf.get(root) ?? []) out.add(forme);
  }
  return [...out];
}

import 'server-only';
/**
 * Locale-neutral wiki data, memoized per server instance.
 *
 * The wiki pages render per request (the root layout reads the language cookie), so the heavy `@pkmn/data`
 * walks (every species/move/item/ability across gens 1–9, and the per-entry detail assembly) are built once
 * here and reused. `@pkmn/data` is fixed per deploy, so nothing ever needs invalidating; a module memo is used
 * instead of `cachedRead` (that helper is private to `src/lib/cache/public-reads.ts`).
 *
 * Every value holds ids, English `@pkmn` names, English Showdown descriptions and numbers only. No locale is
 * part of any key or value: pages translate names, descriptions and UI text AFTER the lookup.
 */
import {
  getAbilityNatDex,
  getAllAbilitiesNatDex,
  getAllItemsNatDex,
  getAllMovesNatDex,
  getGeneration,
  getItemNatDex,
  getLegalAbilities,
  getMoveNatDex,
  getSpeciesNatDex,
  getSpeciesTypeInfo,
  listAllSpeciesNatDex,
  type SpeciesTypeInfo,
  type WikiAbilityListRow,
  type WikiItemListRow,
  type WikiMoveListRow,
} from '@/lib/pkmn/dex';
import { toID } from '@/lib/pkmn/i18n/id';
import { TYPES } from '@/lib/pkmn/type-chart';
import { buildWikiAbilityEntry, buildWikiItemEntry, buildWikiMoveEntry } from '@/lib/wiki/entries';
import type { WikiAbilityEntry, WikiItemEntry, WikiMoveEntry } from '@/types/wiki';

export type WikiKind = 'species' | 'moves' | 'items' | 'abilities';

export interface WikiBaseStats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** One row of the `/wiki/pokemon` table. */
export interface WikiSpeciesIndexRow extends WikiBaseStats {
  name: string;
  types: string[];
  bst: number;
  earliestGen: number;
}

export interface WikiIndexRowsByKind {
  species: WikiSpeciesIndexRow;
  moves: WikiMoveListRow;
  items: WikiItemListRow;
  abilities: WikiAbilityListRow;
}

/** Module-level memo (i18n-core §3): one frozen row array per kind; the value type is fixed by `BUILDERS`. */
const rows = new Map<WikiKind, readonly unknown[]>();

function buildSpeciesRows(): WikiSpeciesIndexRow[] {
  return listAllSpeciesNatDex().map((s) => {
    const { hp, atk, def, spa, spd, spe } = s.baseStats;
    return {
      name: s.name,
      types: s.types,
      hp,
      atk,
      def,
      spa,
      spd,
      spe,
      bst: hp + atk + def + spa + spd + spe,
      earliestGen: s.earliestGen,
    };
  });
}

const BUILDERS: { [K in WikiKind]: () => WikiIndexRowsByKind[K][] } = {
  species: buildSpeciesRows,
  moves: getAllMovesNatDex,
  items: getAllItemsNatDex,
  abilities: getAllAbilitiesNatDex,
};

/**
 * The index rows of one wiki list, English-sorted, built once per server instance. The same array instance is
 * returned on every call: never mutate it (map it into a new array to translate).
 */
export function getWikiIndexRows<K extends WikiKind>(kind: K): readonly WikiIndexRowsByKind[K][] {
  const cached = rows.get(kind) as readonly WikiIndexRowsByKind[K][] | undefined;
  if (cached) return cached;
  const build: () => WikiIndexRowsByKind[K][] = BUILDERS[kind];
  const built: readonly WikiIndexRowsByKind[K][] = Object.freeze(build());
  rows.set(kind, built);
  return built;
}

/* ─── Per-entry detail data (bounded memo) ──────────────────────────────── */

export const WIKI_DETAIL_MEMO_MAX = 512;

export interface WikiSpeciesDetail {
  name: string;
  resolvedGen: number;
  types: string[];
  baseStats: WikiBaseStats;
  /** Ability names in slot order 0, 1, H, S (the header line). */
  abilities: string[];
  /** Legal abilities with their slot ('H' = hidden). */
  legalAbilities: { name: string; slot: string }[];
  typeInfo: SpeciesTypeInfo | null;
}

export interface WikiTypeMatchups {
  defensive: { weakTo: string[]; resists: string[]; immuneTo: string[] } | null;
  offensive: { superEffective: string[]; notVeryEffective: string[]; noEffect: string[] };
}

type WikiDetail = WikiMoveEntry | WikiItemEntry | WikiAbilityEntry | WikiSpeciesDetail | WikiTypeMatchups;

const details = new Map<string, WikiDetail>();

/** Insertion-ordered LRU-ish memo: a hit moves the entry to the end; the oldest entry is evicted past the cap. */
function memoDetail<T extends WikiDetail>(key: string, build: () => T | null): T | null {
  const hit = details.get(key);
  if (hit !== undefined) {
    details.delete(key);
    details.set(key, hit);
    return hit as T;
  }
  const value = build();
  // Misses (unknown names from the URL) are not stored, so junk requests cannot evict real entries.
  if (value === null) return null;
  details.set(key, value);
  while (details.size > WIKI_DETAIL_MEMO_MAX) {
    const oldest = details.keys().next().value;
    if (oldest === undefined) break;
    details.delete(oldest);
  }
  return value;
}

function detailKey(kind: string, name: string): string | null {
  const id = toID(name);
  return id ? `${kind}:${id}` : null;
}

export function getWikiMoveDetail(name: string): WikiMoveEntry | null {
  const key = detailKey('move', name);
  if (!key) return null;
  return memoDetail(key, () => {
    const resolved = getMoveNatDex(name);
    return resolved ? buildWikiMoveEntry(resolved.entity, resolved.resolvedGen) : null;
  });
}

export function getWikiItemDetail(name: string): WikiItemEntry | null {
  const key = detailKey('item', name);
  if (!key) return null;
  return memoDetail(key, () => {
    const resolved = getItemNatDex(name);
    return resolved ? buildWikiItemEntry(resolved.entity, resolved.resolvedGen) : null;
  });
}

export function getWikiAbilityDetail(name: string): WikiAbilityEntry | null {
  const key = detailKey('ability', name);
  if (!key) return null;
  return memoDetail(key, () => {
    const resolved = getAbilityNatDex(name);
    return resolved ? buildWikiAbilityEntry(resolved.entity, resolved.resolvedGen) : null;
  });
}

const ABILITY_SLOTS = ['0', '1', 'H', 'S'] as const;

export function getWikiSpeciesDetail(name: string): WikiSpeciesDetail | null {
  const key = detailKey('species', name);
  if (!key) return null;
  return memoDetail(key, () => {
    const resolved = getSpeciesNatDex(name);
    if (!resolved) return null;
    const { entity: species, resolvedGen } = resolved;
    const typeInfo = getSpeciesTypeInfo(species.name, resolvedGen);
    const abilities: string[] = [];
    for (const slot of ABILITY_SLOTS) {
      const abilityName = species.abilities[slot];
      if (abilityName) abilities.push(abilityName);
    }
    const { hp, atk, def, spa, spd, spe } = species.baseStats;
    return {
      name: species.name,
      resolvedGen,
      types: typeInfo?.types ?? [],
      baseStats: { hp, atk, def, spa, spd, spe },
      abilities,
      legalAbilities: getLegalAbilities(species.name, resolvedGen),
      typeInfo,
    };
  });
}

/* ─── Types ─────────────────────────────────────────────────────────────── */

let teraTypes: readonly string[] | undefined;

/**
 * Every gen-9 type a Pokémon can Terastallize into, as English `@pkmn` names: the 18 battle types in game
 * order (`type-chart.ts` `TYPES`), then any further gen-9 type in dex order (Stellar).
 */
export function getWikiTeraTypes(): readonly string[] {
  if (teraTypes) return teraTypes;
  const gen = getGeneration(9);
  const known = new Set<string>(TYPES);
  const ordered: string[] = TYPES.filter((t) => gen.types.get(t) !== undefined);
  for (const type of gen.types) {
    if (!known.has(type.name)) ordered.push(type.name);
  }
  teraTypes = Object.freeze(ordered);
  return teraTypes;
}

/** The canonical English tera type for a URL segment (any case, id or name), or null. */
export function resolveWikiTeraType(raw: string): string | null {
  const id = toID(raw);
  if (!id) return null;
  return getWikiTeraTypes().find((t) => toID(t) === id) ?? null;
}

type DamageTaken = Record<string, number>;

function damageTaken(typeName: string): DamageTaken | null {
  const typeData = getGeneration(9).types.get(typeName);
  if (!typeData) return null;
  return (typeData as unknown as { damageTaken: DamageTaken }).damageTaken;
}

export function getWikiTypeMatchups(typeName: string): WikiTypeMatchups | null {
  const key = detailKey('tera', typeName);
  if (!key) return null;
  return memoDetail(key, () => {
    if (resolveWikiTeraType(typeName) === null) return null;
    let defensive: WikiTypeMatchups['defensive'] = null;
    const dt = damageTaken(typeName);
    if (dt) {
      defensive = { weakTo: [], resists: [], immuneTo: [] };
      for (const [attackType, effectiveness] of Object.entries(dt)) {
        if (effectiveness === 1) defensive.weakTo.push(attackType);
        else if (effectiveness === 2) defensive.resists.push(attackType);
        else if (effectiveness === 3) defensive.immuneTo.push(attackType);
      }
    }
    const offensive: WikiTypeMatchups['offensive'] = { superEffective: [], notVeryEffective: [], noEffect: [] };
    for (const defType of getGeneration(9).types) {
      const effectiveness = (defType as unknown as { damageTaken: DamageTaken }).damageTaken[typeName] ?? 0;
      if (effectiveness === 1) offensive.superEffective.push(defType.name);
      else if (effectiveness === 2) offensive.notVeryEffective.push(defType.name);
      else if (effectiveness === 3) offensive.noEffect.push(defType.name);
    }
    return { defensive, offensive };
  });
}

/** Test hook: drops every memo so a test can measure a cold build. */
export function resetWikiMemoForTests(): void {
  rows.clear();
  details.clear();
  teraTypes = undefined;
}

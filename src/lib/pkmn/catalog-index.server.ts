import 'server-only';
/**
 * Builds the entry catalog the Ruleset Studio pickers read: every Pokémon, move, item and ability of a generation as a
 * short row (`./catalog-index.ts` is the wire shape), plus the one-line descriptions as a second part. Server only: it
 * reads the dex. Memoised per process, because the data is immutable per deploy.
 *
 * The universe follows the ruleset: `standard` is what the generation itself has (the same ids `knownIds` returns, so a
 * picker row and the `unknown_entry` check agree), `national` adds what the generation dropped. Battle-only formes
 * (Aegislash-Blade, Mimikyu-Busted) are left out because nobody brings them to a team, but Mega Evolutions and Primal
 * reversions stay: banning Mega Mewtwo X is the point of a National Dex ban list.
 *
 * A Champions preset also lists the roster entries the dex files under a later generation (the unreleased Megas), with
 * the `FUTURE` flag, so a roster can be edited entry by entry.
 */
import { Dex } from '@pkmn/dex';
import { WIKI_ITEM_CATEGORIES, classifyItem } from '@/lib/wiki/item-category';
import { MOVE_CATEGORY_NAMES, PAST_FLAG, SPECIES_FLAG } from './catalog-index';
import type {
  AbilityRow,
  CatalogIndex,
  CatalogKind,
  CatalogRowsByKind,
  CatalogScope,
  CatalogText,
  ItemRow,
  MoveRow,
  SpeciesRow,
} from './catalog-index';
import { getGeneration, listNationalAbilities, listNationalItems, listNationalMoves, listNationalSpecies } from './dex';
import { getPreset } from './format-catalog';
import { toID } from './i18n/id';
import { localizeDesc, type DescKind } from './i18n/descriptions.server';
import { CHAMPIONS_ROSTER } from './preset-data/champions';
import { PRESET_RULES_VERSION } from './preset-data/pin';
import { itemIconCell, pokemonIconCell } from './sheet-cells.server';

/** The structural slice of a dex entity this module reads (the `@pkmn/data` and `@pkmn/dex` objects both have it). */
interface RawEntity {
  id: string;
  name: string;
  gen: number;
  isNonstandard?: string | null;
}

interface RawSpecies extends RawEntity {
  types: readonly string[];
  tier?: string;
  doublesTier?: string;
  natDexTier?: string;
  baseSpecies: string;
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  evos?: readonly string[];
  battleOnly?: string | readonly string[];
  isMega?: boolean;
  isPrimal?: boolean;
}

interface RawMove extends RawEntity {
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true;
  pp: number;
  shortDesc?: string;
  desc?: string;
}

interface RawText extends RawEntity {
  shortDesc?: string;
  desc?: string;
}

const MAX_GEN = 9;

export function isCatalogGen(gen: number): boolean {
  return Number.isInteger(gen) && gen >= 1 && gen <= MAX_GEN;
}

function nonstandardFlags(entity: RawEntity, past: number, future?: number): number {
  const mark = entity.isNonstandard ?? null;
  if (mark === null) return 0;
  if (mark === 'Future' && future !== undefined) return future;
  return past;
}

function speciesRow(s: RawSpecies): SpeciesRow {
  const forme = s.baseSpecies !== s.name;
  const mega = s.isMega === true || s.isPrimal === true;
  const flags =
    (forme ? SPECIES_FLAG.FORME : 0) |
    (mega ? SPECIES_FLAG.MEGA : 0) |
    ((s.evos?.length ?? 0) > 0 ? SPECIES_FLAG.NFE : 0) |
    (s.battleOnly !== undefined && !mega ? SPECIES_FLAG.BATTLE_ONLY : 0) |
    nonstandardFlags(s, SPECIES_FLAG.PAST, SPECIES_FLAG.FUTURE);
  const { hp, atk, def, spa, spd, spe } = s.baseStats;
  return [
    s.id,
    s.name,
    [...s.types],
    s.tier ?? '',
    s.doublesTier ?? '',
    s.natDexTier ?? '',
    forme ? toID(s.baseSpecies) : 0,
    [hp, atk, def, spa, spd, spe],
    s.gen,
    flags,
    pokemonIconCell(s.name),
  ];
}

function moveRow(m: RawMove): MoveRow {
  const category = Math.max(0, MOVE_CATEGORY_NAMES.indexOf(m.category as (typeof MOVE_CATEGORY_NAMES)[number])) as 0 | 1 | 2;
  return [m.id, m.name, m.type, category, m.basePower, m.accuracy === true ? 0 : m.accuracy, m.pp, m.gen, nonstandardFlags(m, PAST_FLAG, PAST_FLAG)];
}

function itemRow(i: RawEntity): ItemRow {
  return [i.id, i.name, WIKI_ITEM_CATEGORIES.indexOf(classifyItem(i)), i.gen, itemIconCell(i.name), nonstandardFlags(i, PAST_FLAG, PAST_FLAG)];
}

function abilityRow(a: RawEntity): AbilityRow {
  return [a.id, a.name, a.gen, nonstandardFlags(a, PAST_FLAG, PAST_FLAG)];
}

/** The entities of a kind in a generation and universe, as the dex objects. */
function entities(kind: CatalogKind, gen: number, scope: CatalogScope): readonly RawEntity[] {
  const generation = getGeneration(gen);
  if (scope === 'national') {
    switch (kind) {
      case 'species': return listNationalSpecies(gen);
      case 'moves': return listNationalMoves(gen);
      case 'items': return listNationalItems(gen);
      case 'abilities': return listNationalAbilities(gen);
    }
  }
  switch (kind) {
    case 'species': return Array.from(generation.species);
    case 'moves': return Array.from(generation.moves);
    case 'items': return Array.from(generation.items);
    case 'abilities': return Array.from(generation.abilities);
  }
}

const ROSTER_KEY = { species: 'pokemon', moves: 'moves', items: 'items', abilities: 'abilities' } as const;

/** The roster entries of a Champions preset that the base universe does not list, resolved from the full dex of the generation. */
function rosterExtras(kind: CatalogKind, gen: number, have: ReadonlySet<string>): RawEntity[] {
  const dex = Dex.forGen(gen);
  const out: RawEntity[] = [];
  for (const id of CHAMPIONS_ROSTER[ROSTER_KEY[kind]]) {
    if (have.has(id)) continue;
    const found =
      kind === 'species' ? dex.species.get(id) : kind === 'moves' ? dex.moves.get(id) : kind === 'items' ? dex.items.get(id) : dex.abilities.get(id);
    if (found.exists) out.push(found as unknown as RawEntity);
  }
  return out;
}

const indexCache = new Map<string, CatalogIndex>();
const textCache = new Map<string, CatalogText>();

/** The champions preset an index request extends for, or null when `presetId` is absent or does not apply to `gen`. */
export function extendingPreset(presetId: string | null | undefined, gen: number): string | null {
  const preset = getPreset(presetId);
  return preset !== undefined && preset.mod === 'champions' && preset.gen === gen ? preset.id : null;
}

/** Every entry of `kind` in generation `gen` under `scope`, sorted by name (the client re-sorts). */
export function buildCatalogIndex<K extends CatalogKind>(kind: K, gen: number, scope: CatalogScope, preset: string | null = null): CatalogIndex<K> {
  const key = `${kind}:${gen}:${scope}:${preset ?? ''}`;
  const cached = indexCache.get(key);
  if (cached !== undefined) return cached as CatalogIndex<K>;

  let list = entities(kind, gen, scope);
  if (preset !== null) {
    const have = new Set(list.map((entity) => entity.id));
    list = [...list, ...rosterExtras(kind, gen, have)];
  }
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const rows = sorted.map((entity): CatalogRowsByKind[CatalogKind] => {
    switch (kind) {
      case 'species': return speciesRow(entity as RawSpecies);
      case 'moves': return moveRow(entity as RawMove);
      case 'items': return itemRow(entity);
      case 'abilities': return abilityRow(entity);
    }
  });
  const index = { v: 1, kind, gen, scope, preset, rows } as CatalogIndex<K>;
  indexCache.set(key, index as CatalogIndex);
  return index;
}

const DESC_KIND: Record<Exclude<CatalogKind, 'species'>, DescKind> = { moves: 'move', items: 'item', abilities: 'ability' };

/** The one-line descriptions of a kind in the viewer's language; German falls back to the English text per entry. */
export function buildCatalogText(
  kind: Exclude<CatalogKind, 'species'>,
  gen: number,
  scope: CatalogScope,
  lang: 'en' | 'de',
  preset: string | null = null,
): CatalogText {
  const key = `${kind}:${gen}:${scope}:${lang}:${preset ?? ''}`;
  const cached = textCache.get(key);
  if (cached !== undefined) return cached;

  const rows = buildCatalogIndex(kind, gen, scope, preset).rows as readonly (MoveRow | ItemRow | AbilityRow)[];
  const byId = new Map<string, RawText>();
  for (const entity of entities(kind, gen, scope) as readonly RawText[]) byId.set(entity.id, entity);
  const dex = Dex.forGen(gen);
  const text: Record<string, string> = {};
  const fallback: string[] = [];
  for (const row of rows) {
    const id = row[0];
    const raw: RawText | undefined =
      byId.get(id) ?? ((kind === 'moves' ? dex.moves.get(id) : kind === 'items' ? dex.items.get(id) : dex.abilities.get(id)) as unknown as RawText);
    const english = raw.shortDesc || raw.desc || '';
    const localized = localizeDesc(DESC_KIND[kind], row[1], english, lang);
    if (localized.text !== '') text[id] = localized.text;
    if (lang === 'de' && localized.lang === 'en' && english !== '') fallback.push(id);
  }
  const result: CatalogText = { v: 1, kind, gen, scope, lang, text, fallback };
  textCache.set(key, result);
  return result;
}

/** A weak ETag for a catalog response: the data version plus the request. */
export function catalogEtag(parts: readonly (string | number | null)[]): string {
  return `W/"${PRESET_RULES_VERSION}-${parts.map((part) => String(part ?? '')).join('-')}"`;
}

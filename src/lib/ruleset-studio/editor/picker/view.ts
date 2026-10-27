/**
 * The picker's view pipeline: filter, sort and group the entries of one category into the flat list the grid draws. Pure
 * and client-safe, so every rule is tested without a DOM.
 *
 * The pipeline is: text query (ranked, English and German, with a typo-tolerant fallback) -> facets -> sort -> group.
 * A facet narrows; an empty facet means "any". The state facet reads the document (`EntryState` per entry), so "what I
 * banned" and "what the preset bans" are one click. Species have the richest facets (type, tier, stage, forme kind,
 * base stat total); moves filter by type, category, power and accuracy; items by category; abilities by text only.
 */
import type { CatalogEntry, ItemEntry, MoveEntry, SpeciesEntry } from '@/lib/pkmn/catalog-index';
import { NO_MATCH, foldForSearch, matchRank, type SearchKeys } from '@/lib/pkmn/i18n/search';
import { isAuthorState, isLegalState, type EntryState } from '@/lib/ruleset-kit/entry-state';
import type { EntryIndex } from './entry-index';

// ── Filters ──────────────────────────────────────────────────────────────────────

export type StageFacet = 'fully_evolved' | 'not_fully_evolved';
export type FormeFacet = 'base' | 'forme' | 'mega';
export type RangeFacet = readonly [min: number, max: number];

export interface PickerFilters {
  query: string;
  /** Entries in one of these states; empty = any. */
  states: readonly EntryState[];
  /** Only entries the document changed (a ban, an unban). */
  changedByMe: boolean;
  /** Only entries the base preset rules out. */
  fromPreset: boolean;
  /** Only entries that are legal / only entries that are not. null = both. */
  legal: boolean | null;
  /** Introduced in one of these generations; empty = any. */
  gens: readonly number[];
  /** Species and move types; empty = any. */
  types: readonly string[];
  /** A species with two types matches `all` only when it has every chosen type. */
  typeMatch: 'any' | 'all';
  /** Tier groups of a species; empty = any. */
  tiers: readonly string[];
  stages: readonly StageFacet[];
  formes: readonly FormeFacet[];
  bst: RangeFacet | null;
  /** Move categories (Physical, Special, Status) or item categories. */
  categories: readonly string[];
  power: RangeFacet | null;
  accuracy: RangeFacet | null;
}

export const EMPTY_FILTERS: PickerFilters = {
  query: '',
  states: [],
  changedByMe: false,
  fromPreset: false,
  legal: null,
  gens: [],
  types: [],
  typeMatch: 'any',
  tiers: [],
  stages: [],
  formes: [],
  bst: null,
  categories: [],
  power: null,
  accuracy: null,
};

/** How many facets (not counting the text query) narrow the view; the "N filters" badge. */
export function activeFilterCount(filters: PickerFilters): number {
  return (
    (filters.states.length > 0 ? 1 : 0) +
    (filters.changedByMe ? 1 : 0) +
    (filters.fromPreset ? 1 : 0) +
    (filters.legal !== null ? 1 : 0) +
    (filters.gens.length > 0 ? 1 : 0) +
    (filters.types.length > 0 ? 1 : 0) +
    (filters.tiers.length > 0 ? 1 : 0) +
    (filters.stages.length > 0 ? 1 : 0) +
    (filters.formes.length > 0 ? 1 : 0) +
    (filters.bst !== null ? 1 : 0) +
    (filters.categories.length > 0 ? 1 : 0) +
    (filters.power !== null ? 1 : 0) +
    (filters.accuracy !== null ? 1 : 0)
  );
}

export function hasAnyFilter(filters: PickerFilters): boolean {
  return filters.query.trim() !== '' || activeFilterCount(filters) > 0;
}

// ── Typo-tolerant matching ───────────────────────────────────────────────────────

/** Rank of a typo match: worse than every exact, prefix, word and substring match of `matchRank`. */
export const MATCH_TYPO = 4;

/** Whether two strings differ by at most `max` single-character edits or one adjacent swap (restricted Damerau-Levenshtein). */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) rows.push([i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let best = rows[i][0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      best = Math.min(best, value);
    }
    if (best > max) return false;
  }
  return rows[a.length][b.length] <= max;
}

/** Edits a query of this length may be off by: none under 4 characters, one up to 7, two beyond. */
function allowedEdits(length: number): number {
  if (length < 4) return 0;
  return length < 8 ? 1 : 2;
}

/**
 * How well a query matches: `matchRank` first, then (for a query of four characters or more) the closest compact key
 * within the typo budget, either as a whole name or as the leading part of one ("garchmop" finds Garchomp).
 */
export function fuzzyRank(query: string, keys: SearchKeys): number {
  const exact = matchRank(query, keys);
  if (exact !== NO_MATCH) return exact;
  const compact = foldForSearch(query).replace(/ /g, '');
  const edits = allowedEdits(compact.length);
  if (edits === 0) return NO_MATCH;
  for (const key of keys.compact) {
    if (withinEdits(compact, key, edits) || withinEdits(compact, key.slice(0, compact.length), edits)) return MATCH_TYPO;
  }
  return NO_MATCH;
}

// ── Facets ───────────────────────────────────────────────────────────────────────

/** What the pipeline needs to know about the ruleset to read tiers and states. */
export interface ViewContext {
  index: EntryIndex;
  /** Doubles ruleset: species show the doubles tier. */
  doubles: boolean;
  /** National Dex ruleset: species show the National Dex tier (when singles). */
  national: boolean;
  /** The state of an entry under the document. */
  stateOf: (id: string) => EntryState;
}

/** Tier ranking, best (most restricted) first. Tiers not listed rank after these and before "Untiered". */
const TIER_ORDER = [
  'AG', 'Uber', 'DUber', 'OU', 'DOU', 'UUBL', 'DBL', 'UU', 'DUU', 'RUBL', 'RU', 'NUBL', 'NU', 'PUBL', 'PU', 'ZUBL', 'ZU',
  'DPU', 'NFE', 'LC', 'CAP', 'CAP NFE', 'CAP LC',
] as const;

export const UNTIERED = 'Untiered';

/** A raw tier value as the group it is listed under: parenthesised "unused in this tier" tiers collapse to the lowest one. */
export function displayTier(raw: string, doubles: boolean): string {
  if (raw === '' || raw === 'Illegal' || raw === 'Unreleased') return UNTIERED;
  if (raw.startsWith('(') && raw.endsWith(')')) return doubles ? 'DPU' : 'ZU';
  return raw;
}

/** The tier group of a species in this ruleset: the doubles tier, the National Dex tier or the singles tier. */
export function tierOf(entry: SpeciesEntry, doubles: boolean, national: boolean): string {
  const raw = doubles ? entry.doublesTier : national ? entry.natDexTier : entry.tier;
  return displayTier(raw, doubles);
}

/** Sort position of a tier group. */
export function tierRank(tier: string): number {
  if (tier === UNTIERED) return TIER_ORDER.length + 1;
  const index = (TIER_ORDER as readonly string[]).indexOf(tier);
  return index === -1 ? TIER_ORDER.length : index;
}

function inRange(value: number, range: RangeFacet | null): boolean {
  return range === null || (value >= range[0] && value <= range[1]);
}

function speciesPasses(entry: SpeciesEntry, filters: PickerFilters, ctx: ViewContext): boolean {
  // A battle-only forme is nobody's team member: it shows only when the document already names it.
  if (entry.battleOnly && !isAuthorState(ctx.stateOf(entry.id))) return false;
  if (filters.types.length > 0) {
    const has = (type: string) => entry.types.includes(type);
    if (filters.typeMatch === 'all' ? !filters.types.every(has) : !filters.types.some(has)) return false;
  }
  if (filters.tiers.length > 0 && !filters.tiers.includes(tierOf(entry, ctx.doubles, ctx.national))) return false;
  if (filters.stages.length > 0) {
    const stage: StageFacet = entry.nfe ? 'not_fully_evolved' : 'fully_evolved';
    if (!filters.stages.includes(stage)) return false;
  }
  if (filters.formes.length > 0) {
    const kind: FormeFacet = entry.mega ? 'mega' : entry.forme ? 'forme' : 'base';
    if (!filters.formes.includes(kind)) return false;
  }
  return inRange(entry.bst, filters.bst);
}

function movePasses(entry: MoveEntry, filters: PickerFilters): boolean {
  if (filters.types.length > 0 && !filters.types.includes(entry.type)) return false;
  if (filters.categories.length > 0 && !filters.categories.includes(entry.category)) return false;
  if (!inRange(entry.power, filters.power)) return false;
  // A move that never misses counts as 101% so "accuracy 100+" finds it.
  return inRange(entry.accuracy ?? 101, filters.accuracy);
}

function itemPasses(entry: ItemEntry, filters: PickerFilters): boolean {
  return filters.categories.length === 0 || filters.categories.includes(entry.category);
}

function entryPasses(entry: CatalogEntry, filters: PickerFilters, ctx: ViewContext): boolean {
  if (filters.gens.length > 0 && !filters.gens.includes(entry.gen)) return false;
  const state = ctx.stateOf(entry.id);
  if (filters.states.length > 0 && !filters.states.includes(state)) return false;
  if (filters.changedByMe && !isAuthorState(state)) return false;
  if (filters.fromPreset && state !== 'preset_banned') return false;
  if (filters.legal !== null && isLegalState(state) !== filters.legal) return false;
  switch (entry.kind) {
    case 'species': return speciesPasses(entry, filters, ctx);
    case 'moves': return movePasses(entry, filters);
    case 'items': return itemPasses(entry, filters);
    default: return true;
  }
}

// ── Sort and group ───────────────────────────────────────────────────────────────

export type SortKey = 'name' | 'bst' | 'tier' | 'power' | 'type' | 'gen';

export interface SortSpec {
  key: SortKey;
  direction: 'asc' | 'desc';
}

/** The sorts a kind offers, the first being its default. */
export const SORTS_BY_KIND: Record<CatalogEntry['kind'], readonly SortKey[]> = {
  species: ['tier', 'name', 'bst', 'gen'],
  moves: ['type', 'name', 'power', 'gen'],
  items: ['name', 'gen'],
  abilities: ['name', 'gen'],
};

/** Numbers read best-first from the top (highest BST, highest power); names, tiers and types ascend. */
export function defaultDirection(key: SortKey): SortSpec['direction'] {
  return key === 'bst' || key === 'power' ? 'desc' : 'asc';
}

export function defaultSort(kind: CatalogEntry['kind']): SortSpec {
  const key = SORTS_BY_KIND[kind][0];
  return { key, direction: defaultDirection(key) };
}

/** Whether entries are listed under group headers for this sort. */
export function groupKeyOf(entry: CatalogEntry, sort: SortSpec, ctx: Pick<ViewContext, 'doubles' | 'national'>): string | null {
  if (sort.key === 'tier' && entry.kind === 'species') return tierOf(entry, ctx.doubles, ctx.national);
  if (sort.key === 'type' && entry.kind === 'moves') return entry.type;
  if (entry.kind === 'items' && sort.key === 'name') return entry.category;
  return null;
}

function compareNames(a: CatalogEntry, b: CatalogEntry): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
}

function numberKey(entry: CatalogEntry, key: SortKey, ctx: Pick<ViewContext, 'doubles' | 'national'>): number {
  switch (key) {
    case 'bst': return entry.kind === 'species' ? entry.bst : 0;
    case 'power': return entry.kind === 'moves' ? entry.power : 0;
    case 'gen': return entry.gen;
    case 'tier': return entry.kind === 'species' ? tierRank(tierOf(entry, ctx.doubles, ctx.national)) : 0;
    default: return 0;
  }
}

function compareEntries(a: CatalogEntry, b: CatalogEntry, sort: SortSpec, ctx: Pick<ViewContext, 'doubles' | 'national'>): number {
  const sign = sort.direction === 'asc' ? 1 : -1;
  if (sort.key === 'name') {
    // Items sorted by name sit under their category headers, so the category decides first: a group is one block.
    if (a.kind === 'items' && b.kind === 'items') return sign * (a.category.localeCompare(b.category, 'en') || compareNames(a, b));
    return sign * compareNames(a, b);
  }
  if (sort.key === 'type') {
    const typeA = a.kind === 'moves' ? a.type : '';
    const typeB = b.kind === 'moves' ? b.type : '';
    return typeA.localeCompare(typeB, 'en') * sign || compareNames(a, b);
  }
  // Tier sorts best-first by default; BST, power and generation sort high-to-low when descending.
  const diff = numberKey(a, sort.key, ctx) - numberKey(b, sort.key, ctx);
  return diff !== 0 ? sign * diff : compareNames(a, b);
}

// ── The view ─────────────────────────────────────────────────────────────────────

export interface HeaderItem {
  kind: 'header';
  key: string;
  /** The group value (a tier, a type name, an item category). */
  group: string;
  count: number;
}

export interface EntryItem {
  kind: 'entry';
  entry: CatalogEntry;
  state: EntryState;
}

export type ViewItem = HeaderItem | EntryItem;

export interface PickerView {
  /** The filtered, sorted entries in display order (headers excluded). */
  entries: readonly CatalogEntry[];
  /** The same entries interleaved with their group headers. */
  items: readonly ViewItem[];
  /** How many entries the index has before filtering. */
  total: number;
}

/** Filters, sorts and groups the entries of an index. A text query ranks by match quality first and ignores the sort. */
export function buildView(filters: PickerFilters, sort: SortSpec, ctx: ViewContext): PickerView {
  const query = filters.query.trim();
  const ranked: { entry: CatalogEntry; rank: number }[] = [];
  for (const entry of ctx.index.entries) {
    if (!entryPasses(entry, filters, ctx)) continue;
    if (query === '') {
      ranked.push({ entry, rank: 0 });
      continue;
    }
    const rank = fuzzyRank(query, ctx.index.searchKeys(entry));
    if (rank !== NO_MATCH) ranked.push({ entry, rank });
  }

  if (query !== '') {
    ranked.sort((a, b) => a.rank - b.rank || compareEntries(a.entry, b.entry, { key: 'name', direction: 'asc' }, ctx));
  } else {
    ranked.sort((a, b) => compareEntries(a.entry, b.entry, sort, ctx));
  }

  const entries = ranked.map((r) => r.entry);
  const items: ViewItem[] = [];
  if (query !== '') {
    for (const entry of entries) items.push({ kind: 'entry', entry, state: ctx.stateOf(entry.id) });
    return { entries, items, total: ctx.index.entries.length };
  }

  let current: string | null | undefined;
  let header: HeaderItem | null = null;
  for (const entry of entries) {
    const group = groupKeyOf(entry, sort, ctx);
    if (group !== current) {
      current = group;
      header = group === null ? null : { kind: 'header', key: `group:${group}`, group, count: 0 };
      if (header !== null) items.push(header);
    }
    if (header !== null) header.count += 1;
    items.push({ kind: 'entry', entry, state: ctx.stateOf(entry.id) });
  }
  return { entries, items, total: ctx.index.entries.length };
}

/** Whether a query alone decides the order (the sort control is then moot). */
export function queryDecidesOrder(filters: PickerFilters): boolean {
  return filters.query.trim() !== '';
}

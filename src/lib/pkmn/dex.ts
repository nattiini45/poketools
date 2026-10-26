import { Dex } from '@pkmn/dex';
import { Generations } from '@pkmn/data';
import { classifyItem, type WikiItemCategory } from '@/lib/wiki/item-category';
import { pkmnSearchKeys, toID } from './i18n/names';
import { rankedSearch, type SearchKeys } from './i18n/search';
import type { PkmnKind } from './i18n/types';

// Singleton — reuse across all server-side calls
const gens = new Generations(Dex);

type LearnsetRestriction = 'Pentagon' | 'Plus' | 'Galar' | 'Paldea';

function restrictionForGeneration(gen: number): LearnsetRestriction | undefined {
  switch (gen) {
    case 6:
      return 'Pentagon';
    case 7:
      return 'Plus';
    case 8:
      return 'Galar';
    case 9:
      return 'Paldea';
    default:
      return undefined;
  }
}

export function getGeneration(num: number = 9) {
  return gens.get(num);
}

export function getSpecies(name: string, gen: number = 9) {
  return getGeneration(gen).species.get(name);
}

export function getMove(name: string, gen: number = 9) {
  return getGeneration(gen).moves.get(name);
}

export function getItem(name: string, gen: number = 9) {
  return getGeneration(gen).items.get(name);
}

export function getAbility(name: string, gen: number = 9) {
  return getGeneration(gen).abilities.get(name);
}

/* ─── NatDex resolvers ────────────────────────────────────────────────
 *
 * The single-gen getters above only check one generation (default 9).
 * NatDex content (Mega Evolutions, Primals, gen-restricted forms, items
 * or moves that no longer exist in gen 9, etc.) appears in our list
 * pages (which walk gens 1→9) but 404s on the detail pages.
 *
 * These resolvers walk every gen, return the most up-to-date copy of
 * the entity, and also report the earliest gen the entity existed in
 * (useful for a "generation" facet on the list pages).
 */

const NATDEX_MIN_GEN = 1;
const NATDEX_MAX_GEN = 9;

export interface NatDexResolveResult<T> {
  /** Entity from the most recent generation where it exists. */
  entity: T;
  /** Earliest generation the entity is present in (intro gen). */
  earliestGen: number;
  /** Most recent generation we found the entity in (used to source latest data). */
  resolvedGen: number;
}

type SpeciesEntity = NonNullable<ReturnType<typeof getSpecies>>;
type MoveEntity = NonNullable<ReturnType<typeof getMove>>;
type ItemEntity = NonNullable<ReturnType<typeof getItem>>;
type AbilityEntity = NonNullable<ReturnType<typeof getAbility>>;

export function getSpeciesNatDex(
  name: string,
): NatDexResolveResult<SpeciesEntity> | null {
  let earliestGen: number | null = null;
  let mostRecent: SpeciesEntity | null = null;
  let resolvedGen = 0;
  for (let g = NATDEX_MIN_GEN; g <= NATDEX_MAX_GEN; g++) {
    const s = getGeneration(g).species.get(name);
    if (!s || !s.exists || s.battleOnly || s.isNonstandard) continue;
    if (earliestGen === null) earliestGen = g;
    mostRecent = s;
    resolvedGen = g;
  }
  if (!mostRecent || earliestGen === null) return null;
  return { entity: mostRecent, earliestGen, resolvedGen };
}

export function getMoveNatDex(
  name: string,
): NatDexResolveResult<MoveEntity> | null {
  let earliestGen: number | null = null;
  let mostRecent: MoveEntity | null = null;
  let resolvedGen = 0;
  for (let g = NATDEX_MIN_GEN; g <= NATDEX_MAX_GEN; g++) {
    const m = getGeneration(g).moves.get(name);
    if (!m || !m.exists) continue;
    if (earliestGen === null) earliestGen = g;
    mostRecent = m;
    resolvedGen = g;
  }
  if (!mostRecent || earliestGen === null) return null;
  return { entity: mostRecent, earliestGen, resolvedGen };
}

export function getItemNatDex(
  name: string,
): NatDexResolveResult<ItemEntity> | null {
  let earliestGen: number | null = null;
  let mostRecent: ItemEntity | null = null;
  let resolvedGen = 0;
  for (let g = NATDEX_MIN_GEN; g <= NATDEX_MAX_GEN; g++) {
    const it = getGeneration(g).items.get(name);
    if (!it || !it.exists) continue;
    if (earliestGen === null) earliestGen = g;
    mostRecent = it;
    resolvedGen = g;
  }
  if (!mostRecent || earliestGen === null) return null;
  return { entity: mostRecent, earliestGen, resolvedGen };
}

export function getAbilityNatDex(
  name: string,
): NatDexResolveResult<AbilityEntity> | null {
  let earliestGen: number | null = null;
  let mostRecent: AbilityEntity | null = null;
  let resolvedGen = 0;
  for (let g = NATDEX_MIN_GEN; g <= NATDEX_MAX_GEN; g++) {
    const a = getGeneration(g).abilities.get(name);
    if (!a || !a.exists) continue;
    if (earliestGen === null) earliestGen = g;
    mostRecent = a;
    resolvedGen = g;
  }
  if (!mostRecent || earliestGen === null) return null;
  return { entity: mostRecent, earliestGen, resolvedGen };
}

export interface SearchResult {
  name: string;
  id: string;
}

/* ─── Rich search results for enhanced autocomplete ────────────────── */

export interface MoveSearchResult extends SearchResult {
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true; // true = never-miss
  pp: number;
  shortDesc: string;
}

export interface ItemSearchResult extends SearchResult {
  shortDesc: string;
}

export interface AbilitySearchResult extends SearchResult {
  shortDesc: string;
}

export interface SpeciesSearchResult extends SearchResult {
  types: string[];
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

/** List all species in the generation (for full dex listings). Sorted alphabetically. */
export function listAllSpeciesRich(gen: number = 9): SpeciesSearchResult[] {
  const results: SpeciesSearchResult[] = [];
  for (const species of Array.from(getGeneration(gen).species)) {
    // Skip cosmetic forms, totems, etc.
    if (species.battleOnly || species.isNonstandard) continue;
    results.push({
      name: species.name,
      id: species.id,
      types: species.types.slice(),
      baseStats: { ...species.baseStats },
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/* ─── Bilingual name search (design pkmn-l10n.md §4.1) ───────────────
 *
 * Every name search below matches the English name, the official German name and its umlaut transliteration
 * (ä→ae, ö→oe, ü→ue, ß→ss), ignoring case and accents, whatever the viewer's language: "Glurak", "glurak" and
 * "Charizard" all find Charizard. Results are ranked (exact, prefix, word prefix, substring) with the English
 * name as tie-break, and `limit` applies after ranking. Returned rows stay English (`name`, `id`); clients
 * localize them at display time.
 */

interface SearchIndexEntry<T> {
  readonly entity: T;
  readonly keys: SearchKeys;
}

/** Search keys depend only on the English name, so they are shared across generations. */
const searchKeyCache = new Map<string, SearchKeys>();

function searchKeysOf(kind: PkmnKind, englishName: string): SearchKeys {
  const cacheKey = `${kind}:${englishName}`;
  let keys = searchKeyCache.get(cacheKey);
  if (!keys) {
    keys = pkmnSearchKeys(kind, englishName);
    searchKeyCache.set(cacheKey, keys);
  }
  return keys;
}

/** A lazily built, module-scoped `(kind, gen)` index of entities with their search keys. */
function makeSearchIndex<T extends { name: string }>(
  kind: PkmnKind,
  list: (gen: number) => Iterable<T>,
): (gen: number) => readonly SearchIndexEntry<T>[] {
  const byGen = new Map<number, readonly SearchIndexEntry<T>[]>();
  return (gen) => {
    let index = byGen.get(gen);
    if (!index) {
      index = Array.from(list(gen), (entity) => ({ entity, keys: searchKeysOf(kind, entity.name) }));
      byGen.set(gen, index);
    }
    return index;
  };
}

const speciesIndex = makeSearchIndex('species', (gen) => getGeneration(gen).species);
const moveIndex = makeSearchIndex('move', (gen) => getGeneration(gen).moves);
const itemIndex = makeSearchIndex('item', (gen) => getGeneration(gen).items);
const abilityIndex = makeSearchIndex('ability', (gen) => getGeneration(gen).abilities);

const byEnglishName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/** Ranked bilingual search over an index; `limit` undefined = no limit. */
function rankIndex<T extends { name: string }>(
  index: readonly SearchIndexEntry<T>[],
  query: string,
  limit?: number,
): T[] {
  return rankedSearch(index, query, (e) => e.keys, {
    limit,
    tieBreak: (a, b) => byEnglishName(a.entity, b.entity),
  }).map((e) => e.entity);
}

/** Ranked bilingual search over an ad-hoc list (learnable moves, legal abilities). */
function rankList<T extends { name: string }>(
  kind: PkmnKind,
  items: readonly T[],
  query: string,
  opts?: { limit?: number; tieBreak?: (a: T, b: T) => number },
): T[] {
  return rankedSearch(items, query, (item) => searchKeysOf(kind, item.name), opts);
}

function shortDescOf(entity: object): string {
  return (entity as { shortDesc?: string }).shortDesc ?? '';
}

function toMoveResult(move: MoveEntity): MoveSearchResult {
  return {
    name: move.name,
    id: move.id,
    type: move.type,
    category: move.category,
    basePower: move.basePower,
    accuracy: move.accuracy,
    pp: move.pp,
    shortDesc: shortDescOf(move),
  };
}

export function searchSpecies(query: string, gen: number = 9, limit: number = 100): SearchResult[] {
  return rankIndex(speciesIndex(gen), query, limit).map((species) => ({ name: species.name, id: species.id }));
}

export function searchMoves(query: string, gen: number = 9, limit: number = 100): SearchResult[] {
  return rankIndex(moveIndex(gen), query, limit).map((move) => ({ name: move.name, id: move.id }));
}

export function searchItems(query: string, gen: number = 9, limit: number = 100): SearchResult[] {
  return rankIndex(itemIndex(gen), query, limit).map((item) => ({ name: item.name, id: item.id }));
}

export function searchAbilities(query: string, gen: number = 9, limit: number = 100): SearchResult[] {
  return rankIndex(abilityIndex(gen), query, limit).map((ability) => ({ name: ability.name, id: ability.id }));
}

/* ─── Rich search functions (for enhanced teambuilder autocomplete) ── */

// `shortDesc` here is the English Showdown text. German descriptions (`?lang=de`) come from the server-only
// wrappers in `./dex-l10n.server.ts`: this module is reached by client bundles through `formats.ts` → `tiers.ts`,
// so it must not import the server-only description maps.

export function searchMovesRich(query: string, gen: number = 9, limit: number = 100): MoveSearchResult[] {
  return rankIndex(moveIndex(gen), query, limit).map(toMoveResult);
}

export function searchItemsRich(query: string, gen: number = 9, limit: number = 100): ItemSearchResult[] {
  return rankIndex(itemIndex(gen), query, limit).map((item) => ({
    name: item.name,
    id: item.id,
    shortDesc: shortDescOf(item),
  }));
}

export function searchAbilitiesRich(query: string, gen: number = 9, limit: number = 100): AbilitySearchResult[] {
  return rankIndex(abilityIndex(gen), query, limit).map((ability) => ({
    name: ability.name,
    id: ability.id,
    shortDesc: shortDescOf(ability),
  }));
}

export function searchItemsByDescription(query: string, gen: number = 9, limit: number = 100): ItemSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/);
  const results: ItemSearchResult[] = [];
  for (const item of Array.from(getGeneration(gen).items)) {
    const desc = ((item as unknown as { shortDesc?: string }).shortDesc ?? '').toLowerCase();
    const name = item.name.toLowerCase();
    if (terms.every(t => desc.includes(t) || name.includes(t))) {
      results.push({
        name: item.name,
        id: item.id,
        shortDesc: (item as unknown as { shortDesc?: string }).shortDesc ?? '',
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function searchAbilitiesByDescription(query: string, gen: number = 9, limit: number = 100): AbilitySearchResult[] {
  const terms = query.toLowerCase().split(/\s+/);
  const results: AbilitySearchResult[] = [];
  for (const ability of Array.from(getGeneration(gen).abilities)) {
    const desc = ((ability as unknown as { shortDesc?: string }).shortDesc ?? '').toLowerCase();
    const name = ability.name.toLowerCase();
    if (terms.every(t => desc.includes(t) || name.includes(t))) {
      results.push({
        name: ability.name,
        id: ability.id,
        shortDesc: (ability as unknown as { shortDesc?: string }).shortDesc ?? '',
      });
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function searchSpeciesRich(query: string, gen: number = 9, limit: number = 100): SpeciesSearchResult[] {
  return rankIndex(speciesIndex(gen), query, limit).map((species) => ({
    name: species.name,
    id: species.id,
    types: species.types.slice(),
    baseStats: { ...species.baseStats },
  }));
}

/** Search moves filtered to only those a species can learn (bilingual, ranked, then alphabetical). */
export async function searchMovesForSpecies(
  query: string,
  speciesName: string,
  gen: number = 9,
  limit: number = 20,
): Promise<MoveSearchResult[]> {
  const g = getGeneration(gen);
  const species = g.species.get(speciesName);
  if (!species) return searchMovesRich(query, gen, limit);

  // For modern gens, enforce generation-native learnset restriction
  const restriction = restrictionForGeneration(gen);
  const learnable = await g.learnsets.learnable(species.name, restriction);
  if (!learnable) return [];

  const moves = Object.keys(learnable)
    .map((moveId) => g.moves.get(moveId))
    .filter((move): move is NonNullable<typeof move> => !!move);

  return rankList('move', moves, query, { limit, tieBreak: byEnglishName }).map(toMoveResult);
}

/** List ALL learnable moves for a species (including pre-evo moves), sorted alphabetically */
export async function listMovesForSpecies(
  speciesName: string,
  gen: number = 9,
): Promise<MoveSearchResult[]> {
  const g = getGeneration(gen);
  const species = g.species.get(speciesName);
  if (!species) return [];

  // For modern gens, enforce generation-native learnset restriction
  const restriction = restrictionForGeneration(gen);
  const learnable = await g.learnsets.learnable(species.name, restriction);
  if (!learnable) return [];

  const results: MoveSearchResult[] = Object.keys(learnable)
    .map((moveId) => g.moves.get(moveId))
    .filter((move): move is NonNullable<typeof move> => !!move)
    .map(toMoveResult);

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Search abilities filtered to only those a species can have (bilingual, ranked). Equal ranks keep the
 * species' slot order (0, 1, H), which is what the ability picker shows for an empty query.
 */
export function searchAbilitiesForSpecies(
  query: string,
  speciesName: string,
  gen: number = 9,
): AbilitySearchResult[] {
  const legal = getLegalAbilities(speciesName, gen);
  if (legal.length === 0) return searchAbilitiesRich(query, gen);

  return rankList('ability', legal, query).map((a) => {
    const ability = getAbility(a.name, gen);
    return {
      name: a.name,
      // The @pkmn id (toID), not a whitespace-stripped lowercase name: "Mind's Eye" → "mindseye".
      id: toID(a.name),
      shortDesc: ability ? shortDescOf(ability) : '',
    };
  });
}

/** Get base stats for a single species (for stat computation) */
export function getBaseStats(name: string, gen: number = 9) {
  const species = getSpecies(name, gen);
  if (!species) return null;
  return {
    name: species.name,
    types: species.types.slice(),
    baseStats: { ...species.baseStats },
  };
}

/** Batch species info (types + base stats) */
export function getSpeciesInfoBatch(names: string[], gen: number = 9) {
  return names
    .map((n) => getBaseStats(n, gen))
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/* ─── Legality checks (learnset + ability) ─────────────────────────── */

export interface SetLegalityResult {
  species: string;
  abilities: { name: string; slot: string }[];
  moveIssues: { move: string; legal: boolean }[];
  abilityLegal: boolean;
  selectedAbility: string;
}

/** Get all legal abilities for a species */
export function getLegalAbilities(speciesName: string, gen: number = 9): { name: string; slot: string }[] {
  const species = getSpecies(speciesName, gen);
  if (!species) return [];
  const abilities: { name: string; slot: string }[] = [];
  const abilitiesData = species.abilities as unknown as Record<string, string>;
  for (const [slot, name] of Object.entries(abilitiesData)) {
    if (name) abilities.push({ name, slot });
  }
  return abilities;
}

/** Check if a species can learn specific moves (async — learnsets are lazy-loaded) */
export async function checkMoveLegality(
  speciesName: string,
  moves: string[],
  gen: number = 9,
): Promise<{ move: string; legal: boolean }[]> {
  const g = getGeneration(gen);
  const species = g.species.get(speciesName);
  if (!species) return moves.map((m) => ({ move: m, legal: false }));

  // For modern gens, enforce generation-native learnset restriction
  const restriction = restrictionForGeneration(gen);
  const learnable = await g.learnsets.learnable(species.name, restriction);
  const allLearnable = new Set<string>(Object.keys(learnable ?? {}));

  return moves.map((move) => {
    if (!move) return { move, legal: true }; // empty slot is fine
    const moveData = g.moves.get(move);
    if (!moveData) return { move, legal: false };
    return { move, legal: allLearnable.has(moveData.id) };
  });
}

/** Full set legality check (ability + moves) */
export async function validateSetLegality(
  speciesName: string,
  selectedAbility: string,
  moves: string[],
  gen: number = 9,
): Promise<SetLegalityResult> {
  const abilities = getLegalAbilities(speciesName, gen);
  const moveIssues = await checkMoveLegality(speciesName, moves, gen);
  const abilityLegal = !selectedAbility || abilities.some(
    (a) => a.name.toLowerCase() === selectedAbility.toLowerCase(),
  );

  return {
    species: speciesName,
    abilities,
    moveIssues,
    abilityLegal,
    selectedAbility,
  };
}

// ── Stage + legendary classification (constraint engine) ─────────────

/**
 * True when the species has no further evolutions in the given generation.
 * Uses `species.nfe` first (canonical flag in @pkmn/data) and falls back to
 * `species.evos.length === 0` for older data.
 */
export function isFullyEvolved(name: string, gen: number = 9): boolean {
  const species = getSpecies(name, gen);
  if (!species) return false;
  if (typeof species.nfe === 'boolean') return !species.nfe;
  return !species.evos || species.evos.length === 0;
}

/** A "legendary"-class tag from @pkmn/dex. Includes mythicals and sub-legendaries. */
const LEGENDARY_TAGS = new Set([
  'Restricted Legendary',
  'Sub-Legendary',
  'Mythical',
]);

/**
 * True when the species is tagged as Restricted Legendary, Sub-Legendary, or
 * Mythical in @pkmn/dex. Ultra Beasts and Paradox Pokémon are NOT considered
 * legendary by this helper (they're separate tags).
 */
export function isLegendary(name: string, gen: number = 9): boolean {
  const species = getSpecies(name, gen);
  if (!species) return false;
  const tags = (species.tags as string[] | undefined) ?? [];
  return tags.some((t) => LEGENDARY_TAGS.has(t));
}

// ── Evolution Chain Resolution ────────────────────────────────────────

export interface EvoChainResult {
  base: string;
  stage2: string;
  stage3: string;
}

/**
 * Resolve a full 3-stage evolution chain from any Pokémon name.
 * Walks prevo back to base, then evos forward to stage 3.
 * Returns null if the Pokémon doesn't have exactly a 3-stage line,
 * or if the line branches (e.g., Eevee). For branches, caller must
 * specify the exact base form.
 */
export function resolveEvoChain(name: string, gen: number = 9): EvoChainResult | null {
  const g = getGeneration(gen);
  const species = g.species.get(name);
  if (!species) return null;

  // Walk back to the base form
  let base = species;
  while (base.prevo) {
    const prev = g.species.get(base.prevo);
    if (!prev) break;
    base = prev;
  }

  // Walk forward: base → stage2 → stage3
  if (!base.evos || base.evos.length === 0) return null; // no evolutions
  if (base.evos.length > 1) return null; // branching evo (Eevee, Tyrogue, etc.)

  const stage2 = g.species.get(base.evos[0]);
  if (!stage2) return null;

  if (!stage2.evos || stage2.evos.length === 0) return null; // only 2-stage
  if (stage2.evos.length > 1) return null; // branching at stage 2

  const stage3 = g.species.get(stage2.evos[0]);
  if (!stage3) return null;

  return {
    base: base.name,
    stage2: stage2.name,
    stage3: stage3.name,
  };
}

/**
 * Search for Pokémon that are base forms of 3-stage evolution lines.
 * Used by the evo-league tier editor to find eligible Pokémon.
 */
export function searchBaseFormSpecies(query: string, gen: number = 9, limit: number = 100): (SearchResult & { stage2: string; stage3: string })[] {
  const results: (SearchResult & { stage2: string; stage3: string })[] = [];

  // Bilingual and ranked on the base form's name ("Glumanda" finds the Charmander line).
  for (const species of rankIndex(speciesIndex(gen), query)) {
    // Only include if this is a base form (no prevo) with a 3-stage chain
    if (species.prevo) continue;
    const chain = resolveEvoChain(species.name, gen);
    if (!chain) continue;

    results.push({
      name: chain.base,
      id: species.id,
      stage2: chain.stage2,
      stage3: chain.stage3,
    });
    if (results.length >= limit) break;
  }

  return results;
}

// ── Type Analysis ─────────────────────────────────────────────────────

export interface SpeciesTypeInfo {
  species: string;
  types: string[];
  weaknesses: string[];   // 2x or 4x damage taken
  resistances: string[];  // 0.5x or 0.25x damage taken
  immunities: string[];   // 0x damage taken
}

export interface TeamTypeAnalysis {
  pokemon: SpeciesTypeInfo[];
  /** Types that hit 2+ team members super-effectively */
  teamWeaknesses: { type: string; count: number }[];
  /** Types that 2+ team members resist */
  teamResistances: { type: string; count: number }[];
}

/**
 * Get type effectiveness info for a single species.
 * Uses @pkmn/data damageTaken: 0 = normal, 1 = weak (2x), 2 = resist (0.5x), 3 = immune (0x)
 */
export function getSpeciesTypeInfo(name: string, gen: number = 9): SpeciesTypeInfo | null {
  const g = getGeneration(gen);
  const species = g.species.get(name);
  if (!species) return null;

  const types = species.types.slice();
  const weaknesses: string[] = [];
  const resistances: string[] = [];
  const immunities: string[] = [];

  for (const attackType of Array.from(g.types)) {
    let multiplier = 1;
    for (const defType of types) {
      const defTypeData = g.types.get(defType);
      if (!defTypeData) continue;
      const dt = (defTypeData as unknown as { damageTaken: Record<string, number> }).damageTaken;
      const effectiveness = dt[attackType.name] ?? 0;
      if (effectiveness === 1) multiplier *= 2;        // weak to this type
      else if (effectiveness === 2) multiplier *= 0.5;  // resists this type
      else if (effectiveness === 3) multiplier *= 0;    // immune to this type
    }

    if (multiplier === 0) immunities.push(attackType.name);
    else if (multiplier >= 2) weaknesses.push(attackType.name);
    else if (multiplier <= 0.5) resistances.push(attackType.name);
  }

  return { species: species.name, types, weaknesses, resistances, immunities };
}

/**
 * Best type-effectiveness multiplier of the attacker's own types against a
 * defender species (0 / 0.25 / 0.5 / 1 / 2 / 4). Does not apply the 1.5× STAB
 * damage bonus — callers that need STAB must multiply separately.
 */
export function getBestTypeEffectiveness(
  attackerName: string,
  defenderName: string,
  gen: number = 9,
): number | null {
  const attacker = getSpeciesTypeInfo(attackerName, gen);
  const defender = getSpeciesTypeInfo(defenderName, gen);
  if (!attacker || !defender) return null;

  const g = getGeneration(gen);
  let best = 0;

  for (const atkType of attacker.types) {
    let mult = 1;
    for (const defType of defender.types) {
      const defTypeData = g.types.get(defType);
      if (!defTypeData) continue;
      const damageTaken = readDamageTaken(defTypeData, defType);
      if (!damageTaken) return null;
      const atkTypeData = g.types.get(atkType);
      if (!atkTypeData) continue;
      const effectiveness = damageTaken[atkTypeData.name] ?? 0;
      if (effectiveness === 1) mult *= 2;
      else if (effectiveness === 2) mult *= 0.5;
      else if (effectiveness === 3) mult *= 0;
    }
    if (mult > best) best = mult;
  }

  return best;
}

/** @deprecated Prefer {@link getBestTypeEffectiveness} — name never included STAB. */
export function getStabMultiplier(
  attackerName: string,
  defenderName: string,
  gen: number = 9,
): number | null {
  return getBestTypeEffectiveness(attackerName, defenderName, gen);
}

function readDamageTaken(
  defTypeData: object,
  defType: string
): Record<string, number> | null {
  const raw = defTypeData as { damageTaken?: unknown };
  if (
    !raw.damageTaken ||
    typeof raw.damageTaken !== 'object' ||
    Array.isArray(raw.damageTaken)
  ) {
    console.error(`@pkmn type chart missing damageTaken for ${defType}`);
    return null;
  }
  return raw.damageTaken as Record<string, number>;
}

/** Batch type-effectiveness multipliers for matchup matrices. */
export function getBestTypeEffectivenessBatch(
  pairs: { attacker: string; defender: string }[],
  gen: number = 9,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { attacker, defender } of pairs) {
    const key = `${attacker}::${defender}`;
    const mult = getBestTypeEffectiveness(attacker, defender, gen);
    if (mult !== null) out[key] = mult;
  }
  return out;
}

/** @deprecated Prefer {@link getBestTypeEffectivenessBatch}. */
export function getStabMultiplierBatch(
  pairs: { attacker: string; defender: string }[],
  gen: number = 9,
): Record<string, number> {
  return getBestTypeEffectivenessBatch(pairs, gen);
}

/** Analyze team-wide type coverage */
export function getTeamTypeAnalysis(speciesList: string[], gen: number = 9): TeamTypeAnalysis {
  const pokemon: SpeciesTypeInfo[] = [];
  const weakCounts: Record<string, number> = {};
  const resistCounts: Record<string, number> = {};

  for (const name of speciesList) {
    const info = getSpeciesTypeInfo(name, gen);
    if (!info) continue;
    pokemon.push(info);
    for (const t of info.weaknesses) weakCounts[t] = (weakCounts[t] || 0) + 1;
    for (const t of info.resistances) resistCounts[t] = (resistCounts[t] || 0) + 1;
    for (const t of info.immunities) resistCounts[t] = (resistCounts[t] || 0) + 1;
  }

  const teamWeaknesses = Object.entries(weakCounts)
    .filter(([, count]) => count >= 2)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const teamResistances = Object.entries(resistCounts)
    .filter(([, count]) => count >= 2)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { pokemon, teamWeaknesses, teamResistances };
}

// ── Bulk listing helpers (wiki / encyclopedia) ────────────────────────

export function getAllMoves(gen: number = 9): { name: string; type: string; category: string; basePower: number }[] {
  const generation = getGeneration(gen);
  const results: { name: string; type: string; category: string; basePower: number }[] = [];
  for (const move of generation.moves) {
    if (move.exists) {
      results.push({ name: move.name, type: move.type, category: move.category, basePower: move.basePower });
    }
  }
  return results;
}

export function getAllItems(gen: number = 9): { name: string; desc: string }[] {
  const generation = getGeneration(gen);
  const results: { name: string; desc: string }[] = [];
  for (const item of generation.items) {
    if (item.exists) {
      results.push({ name: item.name, desc: (item as unknown as { shortDesc?: string }).shortDesc || (item as unknown as { desc?: string }).desc || '' });
    }
  }
  return results;
}

export function getAllAbilities(gen: number = 9): { name: string; desc: string }[] {
  const generation = getGeneration(gen);
  const results: { name: string; desc: string }[] = [];
  for (const ability of generation.abilities) {
    if (ability.exists) {
      results.push({ name: ability.name, desc: (ability as unknown as { shortDesc?: string }).shortDesc || (ability as unknown as { desc?: string }).desc || '' });
    }
  }
  return results;
}

// ── NatDex helpers: iterate all gens (1–9), deduplicate by name ───────
// Latest gen data wins for each entry. Use for wiki / encyclopedia pages
// that should show the complete historical catalog.

const MAX_GEN = 9;

export interface WikiMoveListRow {
  name: string;
  type: string;
  category: string;
  basePower: number;
  /** null when the move never misses (accuracy === true in dex). */
  accuracy: number | null;
  pp: number;
  /** Earliest generation the move exists in. */
  earliestGen: number;
}

export function getAllMovesNatDex(): WikiMoveListRow[] {
  const earliestSeen = new Map<string, number>();
  const latest = new Map<string, MoveEntity>();
  for (let g = 1; g <= MAX_GEN; g++) {
    for (const move of gens.get(g).moves) {
      if (!move.exists) continue;
      if (!earliestSeen.has(move.name)) earliestSeen.set(move.name, g);
      latest.set(move.name, move);
    }
  }
  const rows: WikiMoveListRow[] = [];
  for (const [name, move] of latest) {
    rows.push({
      name,
      type: move.type,
      category: move.category,
      basePower: move.basePower,
      accuracy: move.accuracy === true ? null : move.accuracy,
      pp: move.pp,
      earliestGen: earliestSeen.get(name) ?? MAX_GEN,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface WikiItemListRow {
  name: string;
  desc: string;
  earliestGen: number;
  /** Coarse category bucket for the list-page facet. */
  category: WikiItemCategory;
}

export function getAllItemsNatDex(): WikiItemListRow[] {
  const earliestSeen = new Map<string, number>();
  const latest = new Map<string, ItemEntity>();
  for (let g = 1; g <= MAX_GEN; g++) {
    for (const item of gens.get(g).items) {
      if (!item.exists) continue;
      if (!earliestSeen.has(item.name)) earliestSeen.set(item.name, g);
      latest.set(item.name, item);
    }
  }
  const rows: WikiItemListRow[] = [];
  for (const [name, item] of latest) {
    const itemData = item as unknown as { shortDesc?: string; desc?: string };
    rows.push({
      name,
      desc: itemData.shortDesc || itemData.desc || '',
      earliestGen: earliestSeen.get(name) ?? MAX_GEN,
      category: classifyItem(item),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface WikiAbilityListRow {
  name: string;
  desc: string;
  /** Smogon competitive rating from @pkmn/data (0 when missing). */
  rating: number;
  earliestGen: number;
}

export function getAllAbilitiesNatDex(): WikiAbilityListRow[] {
  const earliestSeen = new Map<string, number>();
  const latest = new Map<string, AbilityEntity>();
  for (let g = 1; g <= MAX_GEN; g++) {
    for (const ability of gens.get(g).abilities) {
      if (!ability.exists) continue;
      if (!earliestSeen.has(ability.name)) earliestSeen.set(ability.name, g);
      latest.set(ability.name, ability);
    }
  }
  const rows: WikiAbilityListRow[] = [];
  for (const [name, ability] of latest) {
    const abilityData = ability as unknown as { shortDesc?: string; desc?: string; rating?: number };
    rows.push({
      name,
      desc: abilityData.shortDesc || abilityData.desc || '',
      rating: abilityData.rating ?? 0,
      earliestGen: earliestSeen.get(name) ?? MAX_GEN,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface WikiSpeciesListRow extends SpeciesSearchResult {
  earliestGen: number;
}

export function listAllSpeciesNatDex(): WikiSpeciesListRow[] {
  const earliestSeen = new Map<string, number>();
  const latest = new Map<string, WikiSpeciesListRow>();
  for (let g = 1; g <= MAX_GEN; g++) {
    for (const species of gens.get(g).species) {
      if (species.battleOnly || species.isNonstandard) continue;
      if (!species.exists) continue;
      if (!earliestSeen.has(species.name)) earliestSeen.set(species.name, g);
      latest.set(species.name, {
        name: species.name,
        id: species.id,
        types: species.types.slice(),
        baseStats: { ...species.baseStats },
        earliestGen: earliestSeen.get(species.name) ?? g,
      });
    }
  }
  return Array.from(latest.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── National Dex universe ────────────────────────────────────────────

/** The `isNonstandard` values of a species that is part of a generation's National Dex: none, past, unobtainable. */
const NATIONAL_NONSTANDARD: ReadonlySet<string | null> = new Set([null, 'Past', 'Unobtainable']);

/**
 * Every species of a generation's National Dex universe: the generation's own species plus the ones the
 * generation dropped (`isNonstandard: 'Past'`: Mega Evolutions, Primals, regional forms and whole lines that the
 * games removed) and the unobtainable ones. CAP, Future, LGPE and Custom species are not part of it.
 *
 * This reads `Dex.forGen(gen).species.all()` instead of the `Generations` wrapper the rest of the module uses,
 * on purpose and only here: `Generations(gen).species` hides every `Past` species, so a National Dex list built
 * on it misses them (gen 9: 73 of the 102 Uber and AG National Dex species are visible; the other 29, among them
 * Mega Mewtwo X and Y, Primal Groudon and Kyogre, Genesect and Xerneas, only exist in the raw data). `Dex.forGen`
 * is not the forbidden `Dex.forFormat`, and the tier fields (`tier`, `doublesTier`, `natDexTier`) are read from
 * the very objects this returns.
 */
export function listNationalSpecies(gen: number = 9) {
  return Dex.forGen(gen).species.all().filter((s) => s.exists && NATIONAL_NONSTANDARD.has(s.isNonstandard ?? null));
}

/** The moves of a generation's National Dex universe (past moves such as Hidden Power and Pursuit included); same rule as `listNationalSpecies`. */
export function listNationalMoves(gen: number = 9) {
  return Dex.forGen(gen).moves.all().filter((m) => m.exists && NATIONAL_NONSTANDARD.has(m.isNonstandard ?? null));
}

/** The items of a generation's National Dex universe (Z-crystals, Mega stones and the other past items included); same rule as `listNationalSpecies`. */
export function listNationalItems(gen: number = 9) {
  return Dex.forGen(gen).items.all().filter((i) => i.exists && NATIONAL_NONSTANDARD.has(i.isNonstandard ?? null));
}

/** The abilities of a generation's National Dex universe; same rule as `listNationalSpecies`. */
export function listNationalAbilities(gen: number = 9) {
  return Dex.forGen(gen).abilities.all().filter((a) => a.exists && NATIONAL_NONSTANDARD.has(a.isNonstandard ?? null));
}

// ── Single lookups inside a National Dex universe ────────────────────
//
// The twins of `listNational*` for one name: the entity of `gen`'s National Dex (past and unobtainable ones included), or
// `undefined`. The ruleset validator uses them for a ruleset whose universe is `national`, so a Mega Evolution or a past
// move is a legal team member there instead of an unknown one.

/** A species of generation `gen`'s National Dex universe, or `undefined` (CAP, Future, LGPE and Custom species are not part of it). */
export function getNationalSpecies(name: string, gen: number = 9) {
  const species = Dex.forGen(gen).species.get(name);
  return species.exists && NATIONAL_NONSTANDARD.has(species.isNonstandard ?? null) ? species : undefined;
}

/** A move of generation `gen`'s National Dex universe, or `undefined`. */
export function getNationalMove(name: string, gen: number = 9) {
  const move = Dex.forGen(gen).moves.get(name);
  return move.exists && NATIONAL_NONSTANDARD.has(move.isNonstandard ?? null) ? move : undefined;
}

/** An item of generation `gen`'s National Dex universe, or `undefined`. */
export function getNationalItem(name: string, gen: number = 9) {
  const item = Dex.forGen(gen).items.get(name);
  return item.exists && NATIONAL_NONSTANDARD.has(item.isNonstandard ?? null) ? item : undefined;
}

/** An ability of generation `gen`'s National Dex universe, or `undefined`. */
export function getNationalAbility(name: string, gen: number = 9) {
  const ability = Dex.forGen(gen).abilities.get(name);
  return ability.exists && NATIONAL_NONSTANDARD.has(ability.isNonstandard ?? null) ? ability : undefined;
}

// ── Raw lookups ──────────────────────────────────────────────────────

type RawDex = ReturnType<typeof Dex.forGen>;

/** The raw dex entity of each kind (`Dex.forGen`, whatever its `isNonstandard` mark). */
interface RawEntityByKind {
  species: ReturnType<RawDex['species']['get']>;
  moves: ReturnType<RawDex['moves']['get']>;
  items: ReturnType<RawDex['items']['get']>;
  abilities: ReturnType<RawDex['abilities']['get']>;
}

export type RawEntityKind = keyof RawEntityByKind;

/**
 * An entity of generation `gen`'s raw dex by id or name, whatever its `isNonstandard` mark (`Future` entries such as the
 * unreleased Mega Stones included), or `undefined` when the dex has none. Neither the `Generations` wrapper nor the
 * National Dex universe has these, so this is for a caller whose own list names the entry: the Champions roster in the
 * catalog index and in the team validator. Anything that picks from a universe uses `listNational*` / `getNational*`.
 */
export function getRawEntity<K extends RawEntityKind>(kind: K, name: string, gen: number = 9): RawEntityByKind[K] | undefined {
  const dex = Dex.forGen(gen);
  const found = kind === 'species' ? dex.species.get(name) : kind === 'moves' ? dex.moves.get(name) : kind === 'items' ? dex.items.get(name) : dex.abilities.get(name);
  return found.exists ? (found as RawEntityByKind[K]) : undefined;
}

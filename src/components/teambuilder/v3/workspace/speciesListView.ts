import { tierRank, tierGroupLabel } from '@/lib/pkmn/tier-constants';
import { localizeSpecies, speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { compareDisplayNames, rankedSearch } from '@/lib/pkmn/i18n/search';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import type { UsageListItem } from '@/types/usage';

// ── Pure filter / sort / group pipeline for the SpeciesPicker ───────
//
// No React, no @pkmn — fully unit-testable. The picker owns the state and
// rendering; this module owns the list math (legality filter, multi-criteria
// sort, optional tier grouping) so it can be tested in isolation.
//
// Names stay the canonical English `pokemon_name` everywhere (keys, sets);
// the query matches English and German names whatever the locale, and the
// `name` sort key orders by the display name in the given data locale.

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
/** `name` sorts by display name (`asc` = A→Z); every other key is numeric. */
export type SortKey = StatKey | 'bst' | 'pick' | 'tier' | 'name';
export type SortDir = 'desc' | 'asc';

export interface SortCriterion {
  key: SortKey;
  dir: SortDir;
}

/** Max number of stacked sort criteria (primary + 2). */
export const MAX_SORT_CRITERIA = 3;

export interface SpeciesListOptions {
  query: string;
  typeFilters: string[];
  sortCriteria: SortCriterion[];
  groupByTier: boolean;
  /** Hide Pokémon with `legal === false`. Off in draft mode (pool governs availability). */
  applyLegality: boolean;
  /**
   * Ruleset overrides applied on top of base-format legality (lowercased names).
   * `extraBans` hides otherwise-legal mons; `additions` unbans otherwise-illegal
   * mons (a ruleset's "additions.pokemon"). An explicit ban wins over an addition.
   */
  extraBans?: Set<string>;
  additions?: Set<string>;
  /** Draft pool costs (lowercased name → cost). Non-null only in draft mode. */
  poolCosts: Map<string, number | null> | null;
  showTaken: boolean;
  takenSet: Set<string>;
  rosterSet: Set<string>;
  teamSpecies: Set<string>;
}

export interface TierGroup {
  tier: string | null;
  label: string;
  items: UsageListItem[];
}

export interface SpeciesListResult {
  /** Flat render order. items[0] drives Enter-to-select and the empty state. */
  items: UsageListItem[];
  /** Non-null only when groupByTier is on. */
  groups: TierGroup[] | null;
}

const bst = (p: UsageListItem): number =>
  p.base_stats ? Object.values(p.base_stats).reduce((s, v) => s + v, 0) : 0;

/** Numeric value for a sort key (excluding `tier`, handled separately). */
function statValue(
  p: UsageListItem,
  key: Exclude<SortKey, 'tier' | 'name'>,
  poolCosts: Map<string, number | null> | null,
): number {
  if (key === 'pick') {
    return poolCosts ? (poolCosts.get(p.pokemon_name.toLowerCase()) ?? 0) : (p.usage_pct ?? 0);
  }
  if (key === 'bst') return bst(p);
  return p.base_stats?.[key] ?? 0;
}

/**
 * Build a comparator from the sort criteria. Returns null when there are no
 * criteria, so callers can skip sorting entirely and preserve input order.
 *
 * For `tier`, `desc` means best tier first (lowest rank number); untiered sorts
 * last on `desc`. Ties fall through to the next criterion, and a stable sort
 * preserves the merged usage-first order on full ties.
 */
function makeComparator(
  criteria: SortCriterion[],
  poolCosts: Map<string, number | null> | null,
  dataLocale: DataLocale,
): ((a: UsageListItem, b: UsageListItem) => number) | null {
  if (criteria.length === 0) return null;
  const displayNames = new Map<string, string>();
  const displayName = (p: UsageListItem): string => {
    let name = displayNames.get(p.pokemon_name);
    if (name === undefined) {
      name = localizeSpecies(p.pokemon_name, dataLocale);
      displayNames.set(p.pokemon_name, name);
    }
    return name;
  };
  return (a, b) => {
    for (const { key, dir } of criteria) {
      let diff: number;
      if (key === 'tier') {
        // Ascending rank = better tier; desc shows best tier first.
        diff = tierRank(a.tier) - tierRank(b.tier);
      } else if (key === 'name') {
        // Like the numeric keys, `desc` is the reverse of the natural order: asc = A→Z, desc = Z→A.
        diff = compareDisplayNames(displayName(b), displayName(a), dataLocale);
      } else {
        diff = statValue(b, key, poolCosts) - statValue(a, key, poolCosts);
      }
      if (diff !== 0) return dir === 'desc' ? diff : -diff;
    }
    return 0;
  };
}

/**
 * Filter → sort → (optionally) group the merged species list.
 *
 * Filter order mirrors the original picker: draft pool → legality → name query
 * → type filters. When grouped, the same comparator is applied within each tier
 * group and `items` is the concatenation of all groups so Enter-select and the
 * empty state stay correct.
 *
 * The name query is ranked (exact, prefix, word prefix, substring; ties keep
 * input order) over English and German names. `dataLocale` only affects the
 * `name` sort key; it defaults to English.
 */
export function buildSpeciesListView(
  list: UsageListItem[],
  opts: SpeciesListOptions,
  dataLocale: DataLocale = 'en',
): SpeciesListResult {
  let filtered = list;

  // Draft pool constraint (pool membership + taken-status).
  if (opts.poolCosts) {
    const pool = opts.poolCosts;
    filtered = filtered.filter((p) => pool.has(p.pokemon_name.toLowerCase()));
    if (!opts.showTaken) {
      filtered = filtered.filter((p) => {
        const lower = p.pokemon_name.toLowerCase();
        // Hide mons picked by OTHERS; own picks and on-team mons stay visible.
        return (
          !opts.takenSet.has(lower) ||
          opts.rosterSet.has(lower) ||
          opts.teamSpecies.has(lower)
        );
      });
    }
  }

  // Legality (strict hide). Skipped in draft mode (pool governs availability).
  // Ruleset overrides refine the base-format `legal` flag: an explicit extra ban
  // always hides; an addition unbans an otherwise-illegal mon.
  if (opts.applyLegality) {
    filtered = filtered.filter((p) => {
      const lower = p.pokemon_name.toLowerCase();
      if (opts.extraBans?.has(lower)) return false;
      if (opts.additions?.has(lower)) return true;
      return p.legal !== false;
    });
  }

  if (opts.query.trim()) {
    filtered = rankedSearch(filtered, opts.query, (p) => speciesSearchKeys(p.pokemon_name));
  }

  if (opts.typeFilters.length > 0) {
    filtered = filtered.filter((p) => opts.typeFilters.some((t) => p.types?.includes(t)));
  }

  const comparator = makeComparator(opts.sortCriteria, opts.poolCosts, dataLocale);

  if (!opts.groupByTier) {
    const items = comparator ? [...filtered].sort(comparator) : filtered;
    return { items, groups: null };
  }

  // Partition by display tier, ordered by tierRank (untiered last).
  const byTier = new Map<string | null, UsageListItem[]>();
  for (const p of filtered) {
    const tier = p.tier ?? null;
    const bucket = byTier.get(tier);
    if (bucket) bucket.push(p);
    else byTier.set(tier, [p]);
  }

  const groups: TierGroup[] = Array.from(byTier.entries())
    .sort(([a], [b]) => tierRank(a) - tierRank(b))
    .map(([tier, groupItems]) => ({
      tier,
      label: tierGroupLabel(tier),
      items: comparator ? [...groupItems].sort(comparator) : groupItems,
    }));

  return { items: groups.flatMap((g) => g.items), groups };
}

/**
 * Compute the next sort criteria from a header click / sort-chip tap.
 *
 * One unified, shift-free model for desktop and mobile: each click builds the
 * stack. If the key is already a criterion, cycle it in place
 * desc → asc → removed; otherwise append `{ key, desc }` as the next level when
 * under the cap (no-op at the cap). Use a separate "Clear" control to reset.
 * `name` starts ascending (A→Z) instead: asc → desc → removed.
 */
export function applySortClick(
  criteria: SortCriterion[],
  key: SortKey,
): SortCriterion[] {
  const first: SortDir = key === 'name' ? 'asc' : 'desc';
  const idx = criteria.findIndex((c) => c.key === key);

  if (idx !== -1) {
    const current = criteria[idx];
    if (current.dir === first) {
      const next = [...criteria];
      next[idx] = { key, dir: first === 'desc' ? 'asc' : 'desc' };
      return next;
    }
    return criteria.filter((_, i) => i !== idx);
  }

  if (criteria.length >= MAX_SORT_CRITERIA) return criteria;
  return [...criteria, { key, dir: first }];
}

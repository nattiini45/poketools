/**
 * Filter sheet groups (draft-frontend §5.5 `FilterPanel`). Client-safe, pure.
 *
 * Every chip of `buildChips` belongs to exactly one group, so the group counts add up to the chip count
 * (unit-tested): Pokémon = types + maximum price; Moves and abilities; Base stats; Utility = categories
 * plus their picked members; Defensive matchups = relation/type pairs. The search text is no group's.
 */
import type { UtilityKey } from '@/types/draft-queue';
import {
  EMPTY_FILTERS,
  FILTER_GROUP_KEYS,
  type FilterGroupKey,
  type FilterSheetState,
  type FinderFilters,
} from './filter-types';

/** Active filters (= chips) per group. */
export function filterGroupCounts(f: FinderFilters): Record<FilterGroupKey, number> {
  return {
    pokemon: f.types.ids.length + (f.maxPrice === null ? 0 : 1),
    movesAbilities: f.moves.ids.length + f.abilities.ids.length,
    stats: Object.keys(f.stats).length,
    utility: f.utility.reduce((n, u) => n + 1 + u.members.length, 0),
    defense: f.defense.length,
  };
}

/** Active filters across every group (the "Filters (n)" button); equals `buildChips(f).length`. */
export function activeFilterCount(f: FinderFilters): number {
  const counts = filterGroupCounts(f);
  return FILTER_GROUP_KEYS.reduce((n, g) => n + counts[g], 0);
}

/**
 * The open groups. Until the viewer opens or closes a group, the Pokémon group and every group with an
 * active filter are open; afterwards the stored list wins.
 */
export function openFilterGroups(sheet: FilterSheetState, f: FinderFilters): FilterGroupKey[] {
  if (sheet.openGroups !== null) return sheet.openGroups;
  const counts = filterGroupCounts(f);
  return FILTER_GROUP_KEYS.filter((g) => g === 'pokemon' || counts[g] > 0);
}

/** The utility categories whose members are listed: until toggled, those with picked members. */
export function expandedUtility(sheet: FilterSheetState, f: FinderFilters): UtilityKey[] {
  if (sheet.utilityExpanded !== null) return sheet.utilityExpanded;
  return f.utility.filter((u) => u.members.length > 0).map((u) => u.key);
}

/**
 * The filters with one group cleared; the same object when the group has nothing to clear. The "Any /
 * Require all" switches go back to "Any"; the "count abilities" preference stays.
 */
export function resetGroupFilters(f: FinderFilters, group: FilterGroupKey): FinderFilters {
  switch (group) {
    case 'pokemon':
      if (f.types.ids.length === 0 && f.types.match === 'any' && f.maxPrice === null) return f;
      return { ...f, types: EMPTY_FILTERS.types, maxPrice: null };
    case 'movesAbilities':
      if (f.moves.ids.length === 0 && f.moves.match === 'any' && f.abilities.ids.length === 0) return f;
      return { ...f, moves: EMPTY_FILTERS.moves, abilities: EMPTY_FILTERS.abilities };
    case 'stats':
      return Object.keys(f.stats).length === 0 ? f : { ...f, stats: EMPTY_FILTERS.stats };
    case 'utility':
      return f.utility.length === 0 ? f : { ...f, utility: EMPTY_FILTERS.utility };
    case 'defense':
      return f.defense.length === 0 ? f : { ...f, defense: EMPTY_FILTERS.defense };
  }
}

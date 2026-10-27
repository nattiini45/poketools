/**
 * Point-buy price-group display helpers (client-safe, pure): how a stored price group is labelled,
 * coloured, counted and filtered, and how the #roster table narrows and orders its rows. Labels come
 * from the active format pack (`epb.priceGroups`, `epb.priceTabs`); the components render
 * `enums.priceGroup` for the group these return.
 *
 * The #roster price-group pills and the table share one filter value: a canonical group key
 * (`priceGroupFilterOptions`) or `''` for all. `togglePriceGroup` is the pill click,
 * `priceGroupLineCounts` the number on each pill, `filterAndSortRosterEntries` the rows they leave.
 */
import type { PointBuyListEntry, PriceGroup } from '@/types/point-buy';
import { epbPack } from '@/lib/format-pack';
import { speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { foldForSearch } from '@/lib/pkmn/i18n/search';

/**
 * Price range of each price group (`PriceGroup`, `src/types/point-buy.ts`), from the active format pack
 * (`epb.priceGroups`, `@/lib/format-pack`).
 * The group label is the range of its finder tab (`enums.priceGroup`, e.g. '30–27'), so the components render that label alone.
 */
export const PRICE_GROUP_RANGES: Readonly<Record<PriceGroup, readonly [min: number, max: number]>> = epbPack.priceGroups;

/** The slice of a pack's EPB config the price-group grouping reads. */
type PriceGroupConfig = Pick<typeof epbPack, 'priceGroups' | 'priceGroupOrder' | 'priceTabs'>;

/**
 * The finder tab key a stored price group lies in, or null when its range spans no single tab.
 * Groups are labelled by that tab's range (a league ruling), so two groups in one tab read the
 * same ('17–8') and the UI shows them as one group. Pure.
 */
export function priceGroupTabKey(group: string, epb: PriceGroupConfig = epbPack): string | null {
  const range = (epb.priceGroups as Record<string, readonly [number, number]>)[group];
  if (!range) return null;
  const [min, max] = range;
  const tab = epb.priceTabs.find((t) => t.min <= min && max <= t.max);
  return tab ? tab.key : null;
}

/**
 * The canonical filter value of a stored group: the first group (in `priceGroupOrder`) that shares
 * its tab. A group outside every tab, or an unknown value, is its own canonical value. A stored
 * `PriceGroup` therefore always maps to a `PriceGroup`. Pure.
 */
export function canonicalPriceGroup<G extends string>(group: G, epb: PriceGroupConfig = epbPack): G | PriceGroup {
  const tab = priceGroupTabKey(group, epb);
  if (tab === null) return group;
  return epb.priceGroupOrder.find((g) => priceGroupTabKey(g, epb) === tab) ?? group;
}

/** One filter option per displayed group: the canonical groups, in `priceGroupOrder`. Pure. */
export function priceGroupFilterOptions(epb: PriceGroupConfig = epbPack): PriceGroup[] {
  return epb.priceGroupOrder.filter((g) => canonicalPriceGroup(g, epb) === g);
}

/**
 * The group a stored group is shown as: its canonical group (`canonicalPriceGroup`). Chips,
 * legends and report rows key their label AND colour off it, so groups that read the same also
 * look the same (one colour per distinct label). Pure.
 */
export function displayPriceGroup(group: PriceGroup, epb: PriceGroupConfig = epbPack): PriceGroup {
  return canonicalPriceGroup(group, epb);
}

/**
 * Per-group counts folded onto the displayed groups: one row per distinct label
 * (`priceGroupFilterOptions` order), each summing the counts of every stored group shown as it.
 * A missing count is 0. Pure.
 */
export function countsByDisplayGroup(
  counts: Partial<Record<PriceGroup, number>>,
  epb: PriceGroupConfig = epbPack,
): { group: PriceGroup; count: number }[] {
  return priceGroupFilterOptions(epb).map((group) => ({
    group,
    count: epb.priceGroupOrder
      .filter((stored) => displayPriceGroup(stored, epb) === group)
      .reduce((sum, stored) => sum + (counts[stored] ?? 0), 0),
  }));
}

/** True when a line's stored group falls under the selected filter group (same tab, same label). Pure. */
export function priceGroupMatches(
  entryGroup: string,
  selected: string,
  epb: PriceGroupConfig = epbPack,
): boolean {
  return canonicalPriceGroup(entryGroup, epb) === canonicalPriceGroup(selected, epb);
}

/** The #roster price-group filter: a canonical group key (`priceGroupFilterOptions`), or `''` for every group. */
export type PriceGroupFilter = PriceGroup | '';

/**
 * The filter after a click on the pill of `key`: that group, or every group again when it already
 * is the selected one (a second click clears). Pure.
 */
export function togglePriceGroup(
  current: PriceGroupFilter,
  key: PriceGroup,
  epb: PriceGroupConfig = epbPack,
): PriceGroupFilter {
  return current !== '' && priceGroupMatches(current, key, epb) ? '' : key;
}

/**
 * Lines per displayed group (`priceGroupFilterOptions` order): stored groups that share a label
 * count under it, so the numbers on the pills add up to the list. Pure.
 */
export function priceGroupLineCounts(
  entries: readonly Pick<PointBuyListEntry, 'price_group'>[],
  epb: PriceGroupConfig = epbPack,
): { group: PriceGroup; count: number }[] {
  const stored: Partial<Record<PriceGroup, number>> = {};
  for (const { price_group } of entries) stored[price_group] = (stored[price_group] ?? 0) + 1;
  return countsByDisplayGroup(stored, epb);
}

/** How the #roster table orders its rows. */
export type RosterSortKey = 'line' | 'price-asc' | 'price-desc' | 'kills';

/** What narrows and orders the #roster rows. */
export interface RosterRowQuery {
  /** Free text; matched, folded and space-free, against every stage's English and German names. */
  search: string;
  priceGroup: PriceGroupFilter;
  sortKey: RosterSortKey;
}

/**
 * The #roster rows for a query: lines in the selected price group (stored groups that share a
 * label match together) whose base, stage 2 or stage 3 species matches the search, in the chosen
 * order. Returns a new array; `entries` is untouched. Pure.
 */
export function filterAndSortRosterEntries<
  E extends Pick<
    PointBuyListEntry,
    | 'price_group'
    | 'base_pokemon'
    | 'stage2_pokemon'
    | 'stage3_pokemon'
    | 'price'
    | 'kills_to_stage2'
    | 'line_number'
  >,
>(entries: readonly E[], { search, priceGroup, sortKey }: RosterRowQuery, epb: PriceGroupConfig = epbPack): E[] {
  const needle = foldForSearch(search).replace(/ /g, '');
  const rows = entries.filter((entry) => {
    if (priceGroup && !priceGroupMatches(entry.price_group, priceGroup, epb)) return false;
    if (!needle) return true;
    return [entry.base_pokemon, entry.stage2_pokemon, entry.stage3_pokemon]
      .filter((name): name is string => Boolean(name))
      .some((name) => speciesSearchKeys(name).compact.some((key) => key.includes(needle)));
  });

  return rows.sort((a, b) => {
    switch (sortKey) {
      case 'price-asc':
        return a.price - b.price;
      case 'price-desc':
        return b.price - a.price;
      case 'kills':
        return a.kills_to_stage2 - b.kills_to_stage2;
      default:
        return a.line_number - b.line_number;
    }
  });
}

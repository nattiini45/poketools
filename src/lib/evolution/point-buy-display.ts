/**
 * Point-buy price-group display helpers (client-safe, pure): how a stored price group is labelled,
 * coloured and filtered. Labels come from the active format pack (`epb.priceGroups`,
 * `epb.priceTabs`); the components render `enums.priceGroup` for the group these return.
 */
import type { PriceGroup } from '@/types/point-buy';
import { epbPack } from '@/lib/format-pack';

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

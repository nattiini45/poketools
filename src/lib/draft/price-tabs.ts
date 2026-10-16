/**
 * Draft finder price tabs (draft-backend §2.8, critique S9/B5). Client-safe, pure.
 *
 * The tabs are presentation groups from the active format pack (`epb.priceTabs`,
 * `@/lib/format-pack`), NOT the workbook's `price_group` (`src/types/point-buy.ts`):
 * a tab may merge several price groups. Counts are always derived from data.
 */

import { epbPack } from '@/lib/format-pack';

/**
 * The single declaration of PriceTabKey; `draft-queue.ts` and the finder's filter types re-export it.
 * A tab key of the active pack (`epb.priceTabs[].key`) or `'all'`.
 */
export type PriceTabKey = string;

/** A tab key of the active pack (never `'all'`; the pack schema forbids it). */
export type PriceTab = string;

/** The literal "every line" tab. */
export const ALL_PRICE_TAB = 'all' as const;

export const PRICE_TABS: readonly { key: PriceTab; min: number; max: number }[] = epbPack.priceTabs;

/** The tab a price belongs to; `null` means the line appears only under "all". Never logs. */
export function tabOf(price: number): PriceTab | null {
  for (const tab of PRICE_TABS) {
    if (price >= tab.min && price <= tab.max) return tab.key;
  }
  return null;
}

/** Position of a tab in `PRICE_TABS` (0-based; the tab's colour slot), or -1 for `'all'` / unknown keys. */
export function priceTabIndex(key: PriceTabKey): number {
  return PRICE_TABS.findIndex((t) => t.key === key);
}

/** Lines per tab; `all` counts every line, including prices outside every tab. */
export function countByTab(
  lineIds: Iterable<string>,
  priceOf: (id: string) => number,
): Record<PriceTabKey, number> {
  const counts: Record<PriceTabKey, number> = {};
  for (const tab of PRICE_TABS) counts[tab.key] = 0;
  counts[ALL_PRICE_TAB] = 0;
  for (const id of lineIds) {
    counts[ALL_PRICE_TAB] += 1;
    const tab = tabOf(priceOf(id));
    if (tab) counts[tab] += 1;
  }
  return counts;
}

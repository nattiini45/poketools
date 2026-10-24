/**
 * Price tab counts of the finder (draft-frontend §4.6). Client-safe, pure.
 *
 * `PRICE_TABS` and `tabOf` live in `@/lib/draft/price-tabs`; this module adds only
 * the finder's count, which reports (once, outside production) a price that falls outside every tab.
 * Counts are always derived from data; no count is hard-coded (SPEC:47).
 */
import type { LineId } from '@/types/draft-queue';
import { countByTab as countPricesByTab, PRICE_TABS, tabOf, type PriceTab, type PriceTabKey } from '@/lib/draft/price-tabs';

export { PRICE_TABS, tabOf };
export type { PriceTab, PriceTabKey };

/** Every tab key, `all` last (the order of the tab strip). */
export const PRICE_TAB_KEYS: readonly PriceTabKey[] = [...PRICE_TABS.map((t) => t.key), 'all'];

let reportedOutOfTab = false;

/** Lines per tab; a price outside every tab is counted only under `all`. */
export function countByTab(lineIds: Iterable<LineId>, priceOf: (id: LineId) => number): Record<PriceTabKey, number> {
  const ids = [...lineIds];
  if (!reportedOutOfTab && process.env.NODE_ENV !== 'production') {
    const outside = ids.find((id) => tabOf(priceOf(id)) === null);
    if (outside !== undefined) {
      reportedOutOfTab = true;
      console.error(`[draft-finder] price ${priceOf(outside)} of line ${outside} is outside every price tab`);
    }
  }
  return countPricesByTab(ids, priceOf);
}

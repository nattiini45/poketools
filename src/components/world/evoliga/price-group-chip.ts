import type { PriceGroup } from '@/types/point-buy';

/**
 * Price groups are a value ladder, so they are drawn as one: the more a line
 * costs, the more emphatic its chip. All five steps are arena tokens, so the
 * ladder holds its ordering in both the sunlit and moonlit variants, and every
 * step reads at AA against the arena surface in both (premium is the filled
 * step: surface ink on `accent-strong`, 6.7:1 sunlit, because the plain
 * `accent` fill only reaches 4.1:1 there).
 *
 * Each step brings its own border (the budget step a dashed one), so the same
 * classes serve the read-only chip in a table row and the `PriceGroupBar` pill
 * that filters by it, with no further border colour to fight them.
 *
 * Index it with the DISPLAYED group (`displayPriceGroup` in
 * `@/lib/evolution/point-buy-display`), never the stored one: groups that share
 * a label then share a colour, in the table chips and the price-group pills alike.
 */
export const PRICE_GROUP_CHIP: Readonly<Record<PriceGroup, string>> = {
  premium: 'border border-arena-accent-strong bg-arena-accent-strong text-arena-surface',
  hoch: 'border border-arena-accent text-arena-accent-strong',
  mittel: 'border border-arena-border bg-arena-elevated text-arena-ink',
  guenstig: 'border border-arena-border text-arena-ink-secondary',
  budget: 'border border-dashed border-arena-border text-arena-ink-secondary',
};

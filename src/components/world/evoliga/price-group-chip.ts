import type { PriceGroup } from '@/types/point-buy';

/**
 * Price groups are a value ladder, so they are drawn as one: the more a line
 * costs, the more emphatic its chip. All five steps are arena tokens, so the
 * ladder holds its ordering in both the sunlit and moonlit variants.
 *
 * Index it with the DISPLAYED group (`displayPriceGroup` in
 * `@/lib/evolution/point-buy-display`), never the stored one: groups that share
 * a label then share a colour, in the table chips and the #roster legend alike.
 * A plain module (not the client table), so the server-rendered legend reads
 * the real map.
 */
export const PRICE_GROUP_CHIP: Readonly<Record<PriceGroup, string>> = {
  premium: 'bg-arena-accent text-arena-surface',
  hoch: 'border border-arena-accent text-arena-accent-strong',
  mittel: 'border border-arena-border bg-arena-elevated text-arena-ink',
  guenstig: 'border border-arena-border text-arena-ink-secondary',
  budget: 'text-arena-ink-secondary',
};

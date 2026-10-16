/**
 * A draft pool's two setup axes, turn order and pricing (migration 20261013124630).
 * Client-safe and pure: no Supabase, no `next/*`. Labels live in the
 * `draft/legacy/board` namespace under `poolFormat` (keys = the values below).
 */
import type { DraftPickOrder, DraftPool, DraftPricing, DraftType } from '@/types/draft';

/**
 * The turn order a pool gets when the create request names none: what its `draft_type` meant
 * before the split (snake → snake, auction/budget → free), so older clients keep working.
 */
export function defaultPickOrder(draftType: DraftType): DraftPickOrder {
  return draftType === 'snake' ? 'snake' : 'free';
}

/** Turns are enforced for snake and linear order; `free` lets anyone pick any time. */
export function isTurnEnforced(pickOrder: DraftPickOrder): boolean {
  return pickOrder !== 'free';
}

/** An auction records the pick for the winning bidder, so it only works without turns. */
export function isPickOrderAllowed(draftType: DraftType, pickOrder: DraftPickOrder): boolean {
  return draftType !== 'auction' || pickOrder === 'free';
}

/** The pricing a legacy `draft_type` stands for (never `pointBuy`). */
export type LegacyPricing = Exclude<DraftPricing, 'pointBuy'>;

const LEGACY_PRICING: Record<DraftType, LegacyPricing> = { snake: 'none', budget: 'fixed', auction: 'auction' };

export function pricingOfDraftType(draftType: DraftType): LegacyPricing {
  return LEGACY_PRICING[draftType];
}

/**
 * Order and pricing of a pool, for labels. Queue-engine (EvoLiga) pools ignore `pick_order`:
 * they always run in snake order and price from their point-buy list.
 */
export function poolFormat(
  pool: Pick<DraftPool, 'draft_type' | 'pick_order'> & { engine?: DraftPool['engine'] },
): { order: DraftPickOrder; pricing: DraftPricing } {
  if (pool.engine === 'queue') return { order: 'snake', pricing: 'pointBuy' };
  return { order: pool.pick_order, pricing: pricingOfDraftType(pool.draft_type) };
}

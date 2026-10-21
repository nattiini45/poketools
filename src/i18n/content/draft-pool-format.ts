/**
 * A draft pool's turn order and pricing as one label ("Snake · Fixed costs"), from the
 * `draft/legacy/board` namespace's `poolFormat` (keys from `poolFormat()` in
 * `src/lib/draft/pool-format.ts`). Used by the admin league page and the overlay builder.
 */
import type { Translator } from '../core';
import type boardEn from '../messages/draft/legacy/board/en';
import { poolFormat } from '@/lib/draft/pool-format';
import type { DraftPool } from '@/types/draft';

export function draftPoolFormatText(
  t: Translator<typeof boardEn>,
  pool: Pick<DraftPool, 'draft_type' | 'pick_order'> & { engine?: DraftPool['engine'] },
  /** A legacy pool of a point-buy season prices from its list, whatever its `draft_type` says. */
  opts: { pointBuy?: boolean } = {},
): string {
  const { order, pricing: poolPricing } = poolFormat(pool);
  const pricing = opts.pointBuy ? 'pointBuy' : poolPricing;
  return t('poolFormat.label', { order: t(`poolFormat.order.${order}`), pricing: t(`poolFormat.pricing.${pricing}`) });
}

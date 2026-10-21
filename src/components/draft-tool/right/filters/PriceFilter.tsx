'use client';

/**
 * Maximum price (draft-frontend §4.4 `maxPrice`, line-level criterion). The slider spans the list's own
 * price range (from the index, never hard-coded); the top of the range means "any price" (no criterion).
 * It sits in the Pokémon group of the filter sheet. The price tabs above the wall stay the band selector;
 * the hint under the slider says so, so the two never read as the same control.
 */
import { useId, useMemo } from 'react';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { cn } from '@/lib/utils/cn';
import { FOCUS_RING, SECTION_HEADING, type FilterSectionProps } from './types';

/** The lowest and highest line price of the index ({8, 30} for the EvoLiga list). Pure. */
export function priceBounds(ix: PreparedIndex): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const line of ix.raw.lines) {
    if (line.price < min) min = line.price;
    if (line.price > max) max = line.price;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

export default function PriceFilter({ view, dispatch, ix }: FilterSectionProps) {
  const t = useT(draftFinderMessages);
  const heading = t('filters.maxPrice');
  const { min, max } = useMemo(() => priceBounds(ix), [ix]);
  const value = view.filters.maxPrice;
  const hintId = useId();
  if (max <= min) return null;
  return (
    <section aria-label={heading}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className={cn(SECTION_HEADING, 'mb-0')}>{heading}</h4>
        <span className="text-sm font-semibold tabular-nums text-[var(--draft-ink,var(--poke-text-primary))]">
          {value === null ? t('price.any') : t('price.upTo', { n: value })}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value ?? max}
          aria-label={t('price.sliderLabel')}
          aria-describedby={hintId}
          aria-valuetext={value === null ? t('price.any') : t('price.upTo', { n: value })}
          onChange={(e) => {
            const n = Number(e.target.value);
            dispatch({ type: 'setMaxPrice', value: n >= max ? null : n });
          }}
          className={cn('h-11 md:h-6 min-w-0 flex-1 accent-[var(--draft-accent,var(--poke-accent))]', FOCUS_RING)}
        />
        {value !== null && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'setMaxPrice', value: null })}
            className={cn(
              'min-h-[44px] shrink-0 px-1 text-xs text-[var(--draft-accent,var(--poke-accent))] underline-offset-2 hover:underline md:min-h-0',
              FOCUS_RING,
            )}
          >
            {t('price.reset')}
          </button>
        )}
      </div>
      <p id={hintId} className="mt-1.5 text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">{t('price.hint')}</p>
    </section>
  );
}

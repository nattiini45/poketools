'use client';

import PokeballIcon from '@/components/shared/PokeballIcon';
import { RATING_TIER_META, getRatingTier, getRatingTierForDisplay } from '@/lib/rating/tiers';
import { useDataLocale, useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';

interface RatingBadgeProps {
  rating: number;
  rd: number;
  size?: 'sm' | 'md' | 'lg';
  /**
   * - `numeric` (default): ball + numeric rating ± rd. Existing behaviour.
   * - `tier`: ball + tier label (e.g. "Great Ball"). Renders the rating-based
   *   tier even when provisional, with a "Provisional" chip when `rd > 100`.
   *   Hover/title shows the underlying `rating ± rd`.
   */
  variant?: 'numeric' | 'tier';
}

const SIZE_CLASSES: Record<NonNullable<RatingBadgeProps['size']>, string> = {
  sm: 'text-xs px-2 py-1 gap-1',
  md: 'text-sm px-2.5 py-1.5 gap-1.5',
  lg: 'text-base px-3 py-2 gap-2',
};

/**
 * `tier` variant has no frame/background so it works in both light and dark
 * mode — the ball sprite carries the colour. Spacing is tighter than the
 * `numeric` variant since there's no pill outline to fill out.
 */
const TIER_SIZE_CLASSES: Record<NonNullable<RatingBadgeProps['size']>, string> = {
  sm: 'text-xs gap-1',
  md: 'text-sm gap-1.5',
  lg: 'text-base gap-2',
};

const ICON_SIZE: Record<NonNullable<RatingBadgeProps['size']>, number> = {
  sm: 14,
  md: 18,
  lg: 22,
};

const PROVISIONAL_CHIP_SIZE: Record<NonNullable<RatingBadgeProps['size']>, string> = {
  sm: 'text-[10px]',
  md: 'text-[11px]',
  lg: 'text-xs',
};

export default function RatingBadge({
  rating,
  rd,
  size = 'md',
  variant = 'numeric',
}: RatingBadgeProps) {
  const t = useT(gamificationMessages);
  const dl = useDataLocale();
  // Strings, not numbers: a rating reads "1500", never a grouped "1,500".
  const ratingText = String(Math.round(rating));
  const rdText = String(Math.round(rd));
  if (variant === 'tier') {
    const { tier, provisional } = getRatingTierForDisplay(rating, rd);
    const meta = RATING_TIER_META[tier];
    const title = t(provisional ? 'rating.ratingTitleProvisional' : 'rating.ratingTitle', {
      rating: ratingText,
      rd: rdText,
    });

    return (
      <span
        title={title}
        className={`inline-flex items-center font-heading font-bold text-poke-text-primary ${TIER_SIZE_CLASSES[size]}`}
      >
        <PokeballIcon ball={tier} size={ICON_SIZE[size]} />
        {/* The tier names are Poké Ball item names: localized by the pkmn layer. */}
        <span>{localizeItem(meta.label, dl)}</span>
        {provisional && (
          <span
            className={`ml-1 italic font-normal text-poke-text-muted ${PROVISIONAL_CHIP_SIZE[size]}`}
            aria-label={t('rating.provisionalAria')}
          >
            {t('rating.provisional')}
          </span>
        )}
      </span>
    );
  }

  const tier = getRatingTier(rating, rd);
  const meta = RATING_TIER_META[tier];
  const colorClass = `${meta.bg} ${meta.text} ${meta.border}`;

  return (
    <span
      title={localizeItem(meta.label, dl)}
      className={`inline-flex items-center font-heading font-bold rounded-poke-md border ${SIZE_CLASSES[size]} ${colorClass}`}
    >
      <PokeballIcon ball={tier} size={ICON_SIZE[size]} />
      <span>
        {t('rating.ratingTitle', { rating: ratingText, rd: rdText })}
      </span>
    </span>
  );
}

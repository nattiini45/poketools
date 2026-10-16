'use client';

import PokeballIcon from '@/components/shared/PokeballIcon';
import { RATING_TIER_META, getRatingTier } from '@/lib/rating/tiers';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';

interface OverlayRatingBadgeProps {
  rating: { rating: number; rd: number; peak: number } | null;
  rank?: number | null;
  className?: string;
}

/**
 * Glicko-2 rating display for broadcast overlays.
 * Shows current rating, rank position, tier ball, and peak rating indicator.
 */
export default function OverlayRatingBadge({
  rating,
  rank,
  className = '',
}: OverlayRatingBadgeProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  if (!rating) return null;

  const tier = getRatingTier(rating.rating, rating.rd);
  const meta = RATING_TIER_META[tier];
  const isPeak = Math.abs(rating.rating - rating.peak) < 5;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {rank != null && (
        <span
          style={{
            fontSize: '14px',
            fontWeight: 800,
            color: rank <= 3 ? 'var(--broadcast-accent)' : 'var(--broadcast-text-muted)',
          }}
        >
          #{rank}
        </span>
      )}
      <PokeballIcon ball={tier} size={20} />
      <span
        title={localizeItem(meta.label, dl)}
        style={{
          fontSize: '18px',
          fontWeight: 800,
          color: meta.overlayColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {Math.round(rating.rating)}
      </span>
      {isPeak && (
        <span
          style={{
            fontSize: '9px',
            fontWeight: 700,
            color: 'rgb(234,179,8)',
            background: 'rgba(234,179,8,0.15)',
            padding: '1px 5px',
            borderRadius: '9999px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase' as const,
          }}
        >
          {t('rating.peak')}
        </span>
      )}
      {!isPeak && rating.peak > 0 && (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--broadcast-text-muted)',
          }}
        >
          {t('rating.peakValue', { rating: String(Math.round(rating.peak)) })}
        </span>
      )}
    </div>
  );
}

'use client';

import OverlayPokemonSprite from './OverlayPokemonSprite';
import type { BroadcastMoment, BroadcastMomentType } from '@/types/broadcast';
import { useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';

interface OverlayMomentBannerProps {
  moment: BroadcastMoment;
  className?: string;
}

// Labels come from `broadcastOverlaysMessages.moment.<type>`.
const MOMENT_STYLES: Record<BroadcastMomentType, { color: string; bg: string }> = {
  turning_point: { color: 'rgb(217,119,6)', bg: 'rgba(245,158,11,0.15)' },
  big_ko: { color: 'rgb(239,68,68)', bg: 'rgba(239,68,68,0.15)' },
  misplay: { color: 'rgb(168,85,247)', bg: 'rgba(168,85,247,0.15)' },
  clutch: { color: 'rgb(16,185,129)', bg: 'rgba(16,185,129,0.15)' },
  highlight: { color: 'rgb(59,130,246)', bg: 'rgba(59,130,246,0.15)' },
};

/**
 * Lower-third moment notification banner for broadcast overlays.
 * Shows moment type, pokemon sprite (if applicable), and description.
 */
export default function OverlayMomentBanner({
  moment,
  className = '',
}: OverlayMomentBannerProps) {
  const t = useT(broadcastOverlaysMessages);
  const style = MOMENT_STYLES[moment.moment_type];

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 16px',
        borderRadius: '8px',
        background: style.bg,
        borderLeft: `3px solid ${style.color}`,
        animation: 'broadcast-slideInLeft 0.4s ease-out',
      }}
    >
      {/* Type badge */}
      <span
        style={{
          fontSize: '10px',
          fontWeight: 800,
          color: style.color,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap' as const,
        }}
      >
        {t(`moment.${moment.moment_type}`)}
      </span>

      {/* Pokemon sprite if referenced */}
      {moment.pokemon_name && (
        <OverlayPokemonSprite
          pokemon={moment.pokemon_name}
          size={28}
          glowColor={style.color}
        />
      )}

      {/* Description */}
      {moment.description && (
        <span
          style={{
            fontSize: '12px',
            color: 'var(--broadcast-text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' as const,
          }}
        >
          {moment.description}
        </span>
      )}

      {/* Turn number */}
      {moment.turn_number != null && (
        <span
          style={{
            fontSize: '10px',
            color: 'var(--broadcast-text-muted)',
            whiteSpace: 'nowrap' as const,
          }}
        >
          {t('moment.turn', { n: moment.turn_number })}
        </span>
      )}
    </div>
  );
}

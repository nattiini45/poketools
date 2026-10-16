'use client';

import { useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';

interface OverlayScoreDisplayProps {
  /** Pokemon score: surviving pokemon count per player */
  pokemonScore: { p1: number; p2: number };
  /** Series score: games won per player */
  seriesScore?: { player1: number; player2: number };
  /** Whether player 1 is the winner */
  isP1Winner?: boolean;
  className?: string;
}

/**
 * Definitive score display for broadcast overlays.
 * Shows pokemon score (large, primary) and series score (small, secondary).
 * Winner side gets accent coloring.
 */
export default function OverlayScoreDisplay({
  pokemonScore,
  seriesScore,
  isP1Winner,
  className = '',
}: OverlayScoreDisplayProps) {
  const t = useT(broadcastOverlaysMessages);
  const p1Color = isP1Winner === true
    ? 'var(--broadcast-accent)'
    : isP1Winner === false
      ? 'var(--broadcast-text-muted)'
      : 'var(--broadcast-text)';
  const p2Color = isP1Winner === false
    ? 'var(--broadcast-accent)'
    : isP1Winner === true
      ? 'var(--broadcast-text-muted)'
      : 'var(--broadcast-text)';

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      {/* Pokemon score — large */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '12px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span
          style={{
            fontSize: '48px',
            fontWeight: 900,
            color: p1Color,
            lineHeight: 1,
          }}
        >
          {pokemonScore.p1}
        </span>
        <span
          style={{
            fontSize: '24px',
            fontWeight: 600,
            color: 'var(--broadcast-text-muted)',
          }}
        >
          —
        </span>
        <span
          style={{
            fontSize: '48px',
            fontWeight: 900,
            color: p2Color,
            lineHeight: 1,
          }}
        >
          {pokemonScore.p2}
        </span>
      </div>

      {/* Series score — small, secondary */}
      {seriesScore && (
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--broadcast-text-muted)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase' as const,
          }}
        >
          {t('score.series', { p1: seriesScore.player1, p2: seriesScore.player2 })}
        </div>
      )}
    </div>
  );
}

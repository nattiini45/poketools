import PlayerAvatar from '@/components/shared/PlayerAvatar';

interface OverlayPlayerBadgeProps {
  player: {
    name: string;
    avatar_url: string | null;
    record?: string;
  };
  /** Avatar size in pixels. Default: 64. */
  avatarSize?: number;
  /** 'left' places avatar on left, 'right' on right. */
  align?: 'left' | 'right';
  /** Optional Glicko-2 rating to display */
  rating?: { rating: number; peak: number } | null;
  /** Optional rank position (e.g., #2) */
  rank?: number | null;
  /** Active streak text (e.g., "3 Win Streak") */
  streakText?: string | null;
  /** Whether this player is the winner (adds accent ring) */
  isWinner?: boolean;
  className?: string;
}

/**
 * Composite player badge for overlays: avatar + name + optional record/rating/rank/streak.
 * Styled with broadcast surface background and text colors.
 */
export default function OverlayPlayerBadge({
  player,
  avatarSize = 64,
  align = 'left',
  rating,
  rank,
  streakText,
  isWinner,
  className = '',
}: OverlayPlayerBadgeProps) {
  const isRight = align === 'right';

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexDirection: isRight ? 'row-reverse' : 'row',
      }}
    >
      <div style={{ position: 'relative' }}>
        <PlayerAvatar
          avatarUrl={player.avatar_url}
          name={player.name}
          size={avatarSize}
        />
        {isWinner && (
          <div
            style={{
              position: 'absolute',
              inset: '-3px',
              borderRadius: '50%',
              border: '3px solid var(--broadcast-accent)',
              boxShadow: '0 0 12px var(--broadcast-accent)',
            }}
          />
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          textAlign: isRight ? 'right' : 'left',
          gap: '2px',
        }}
      >
        <span
          style={{
            fontSize: '24px',
            fontWeight: 700,
            color: isWinner ? 'var(--broadcast-accent)' : 'var(--broadcast-text)',
            lineHeight: 1.2,
          }}
        >
          {player.name}
        </span>

        {/* Rating + Rank row */}
        {(rating || rank != null) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              justifyContent: isRight ? 'flex-end' : 'flex-start',
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
            {rating && (
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--broadcast-text)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.round(rating.rating)}
              </span>
            )}
          </div>
        )}

        {player.record && (
          <span
            style={{
              fontSize: '14px',
              color: 'var(--broadcast-text-muted)',
              lineHeight: 1.4,
            }}
          >
            {player.record}
          </span>
        )}

        {streakText && (
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'rgb(239,68,68)',
            }}
          >
            {'\u{1F525}'} {streakText}
          </span>
        )}
      </div>
    </div>
  );
}

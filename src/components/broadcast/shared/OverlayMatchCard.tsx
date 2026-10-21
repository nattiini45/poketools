'use client';

import PlayerAvatar from '@/components/shared/PlayerAvatar';
import OverlayTeamStrip from './OverlayTeamStrip';
import type { EnrichedRecapMatch } from '@/types/broadcast';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface OverlayMatchCardProps {
  match: EnrichedRecapMatch;
  /** Show team pokemon strips. Default: true. */
  showTeams?: boolean;
  /** Avatar size in pixels. Default: 40. */
  avatarSize?: number;
  /** Team sprite size. Default: 28. */
  teamSpriteSize?: number;
  className?: string;
}

/**
 * Compact match result card for broadcast overlays.
 * Two players, score, and optional team strips.
 * Used in recap results, attract screen, and match story overlays.
 */
export default function OverlayMatchCard({
  match,
  showTeams = true,
  avatarSize = 40,
  teamSpriteSize = 28,
  className = '',
}: OverlayMatchCardProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const isP1Winner = match.winner_id === match.player1_id;
  const isP2Winner = match.winner_id === match.player2_id;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px 16px',
        borderRadius: '12px',
        background: 'var(--broadcast-surface)',
        border: '1px solid var(--broadcast-border)',
      }}
    >
      {/* Player row: P1 | Score | P2 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        {/* Player 1 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            justifyContent: 'flex-end',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: isP1Winner ? 800 : 600,
              color: isP1Winner ? 'var(--broadcast-text)' : 'var(--broadcast-text-muted)',
              textAlign: 'right' as const,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {match.player1_name}
          </span>
          <div style={{ position: 'relative' }}>
            <PlayerAvatar
              avatarUrl={match.player1_avatar_url}
              name={match.player1_name}
              size={avatarSize}
            />
            {isP1Winner && (
              <div
                style={{
                  position: 'absolute',
                  inset: '-2px',
                  borderRadius: '50%',
                  border: '2px solid var(--broadcast-accent)',
                }}
              />
            )}
          </div>
        </div>

        {/* Score */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minWidth: '60px',
          }}
        >
          <div
            style={{
              fontSize: '20px',
              fontWeight: 900,
              color: 'var(--broadcast-accent)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            {match.pokemon_score}
          </div>
          <div
            style={{
              fontSize: '10px',
              color: 'var(--broadcast-text-muted)',
              marginTop: '2px',
            }}
          >
            ({match.series_score})
          </div>
        </div>

        {/* Player 2 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div style={{ position: 'relative' }}>
            <PlayerAvatar
              avatarUrl={match.player2_avatar_url}
              name={match.player2_name}
              size={avatarSize}
            />
            {isP2Winner && (
              <div
                style={{
                  position: 'absolute',
                  inset: '-2px',
                  borderRadius: '50%',
                  border: '2px solid var(--broadcast-accent)',
                }}
              />
            )}
          </div>
          <span
            style={{
              fontSize: '14px',
              fontWeight: isP2Winner ? 800 : 600,
              color: isP2Winner ? 'var(--broadcast-text)' : 'var(--broadcast-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {match.player2_name}
          </span>
        </div>
      </div>

      {/* Team strips */}
      {showTeams && (match.player1_team.length > 0 || match.player2_team.length > 0) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            {match.player1_team.length > 0 && (
              <OverlayTeamStrip
                pokemon={match.player1_team}
                size={teamSpriteSize}
                showAura
                dimBenched
              />
            )}
          </div>
          <div style={{ minWidth: '60px' }} />
          <div style={{ flex: 1 }}>
            {match.player2_team.length > 0 && (
              <OverlayTeamStrip
                pokemon={match.player2_team}
                size={teamSpriteSize}
                showAura
                dimBenched
              />
            )}
          </div>
        </div>
      )}

      {/* MVP callout */}
      {match.mvp && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            fontSize: '11px',
            color: 'rgb(234,179,8)',
            fontWeight: 700,
          }}
        >
          <span>★</span>
          <span>
            {t('matchCard.mvp', {
              count: match.mvp.kos,
              pokemon: localizeSpecies(match.mvp.pokemon_name, dl),
              player: match.mvp.player_name,
            })}
          </span>
        </div>
      )}
    </div>
  );
}

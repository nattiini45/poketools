'use client';

import OverlayPokemonSprite from './OverlayPokemonSprite';
import type { EnrichedPokemonState } from '@/types/broadcast';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';

interface OverlayPokemonStatCardProps {
  pokemon: EnrichedPokemonState;
  /** Sprite size in pixels. Default: 56. */
  size?: number;
  /** Show moves used list. Default: true. */
  showMoves?: boolean;
  className?: string;
}

function getAuraColor(p: EnrichedPokemonState): string | undefined {
  if (p.is_mvp) return 'rgba(234,179,8,0.6)';
  if (!p.was_brought) return undefined;
  if (p.was_koed) return 'rgba(239,68,68,0.5)';
  return 'rgba(34,197,94,0.5)';
}

/**
 * Single pokemon stat card for broadcast overlays.
 * Shows sprite with aura, name, KO/LEAD/MVP badges, moves list.
 * Broadcast equivalent of MatchHighlightCard's PokemonStatRow.
 */
export default function OverlayPokemonStatCard({
  pokemon: p,
  size = 56,
  showMoves = true,
  className = '',
}: OverlayPokemonStatCardProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const isBenched = !p.was_brought;
  const glowColor = getAuraColor(p);
  const moves = showMoves && p.moves_used.length > 0
    ? p.moves_used.slice(0, 2).map((m) => localizeMove(m, dl)).join(', ')
    : null;
  const extraMoves = p.moves_used.length > 2 ? p.moves_used.length - 2 : 0;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        opacity: isBenched ? 0.4 : 1,
        filter: isBenched ? 'grayscale(1)' : undefined,
      }}
    >
      <OverlayPokemonSprite
        pokemon={p.pokemon_name}
        size={size}
        glowColor={glowColor}
      />

      <div style={{ minWidth: 0, flex: 1 }}>
        {/* Name + turns */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--broadcast-text)',
              lineHeight: 1.2,
            }}
          >
            {localizeSpecies(p.pokemon_name, dl)}
          </span>
          {!isBenched && p.turns_active > 0 && (
            <span
              style={{
                fontSize: '10px',
                color: 'var(--broadcast-text-muted)',
              }}
            >
              {t('statCard.turns', { count: p.turns_active })}
            </span>
          )}
        </div>

        {isBenched ? (
          <div
            style={{
              fontSize: '10px',
              color: 'var(--broadcast-text-muted)',
              fontStyle: 'italic',
              marginTop: '2px',
            }}
          >
            {t('statCard.notUsed')}
          </div>
        ) : (
          <>
            {/* Badges */}
            <div
              style={{
                display: 'flex',
                gap: '4px',
                flexWrap: 'wrap' as const,
                marginTop: '3px',
              }}
            >
              {p.is_mvp && (
                <StatBadge color="rgb(234,179,8)" bg="rgba(234,179,8,0.15)">
                  {t('common.mvpBadge')}
                </StatBadge>
              )}
              {p.kos_dealt > 0 && (
                <StatBadge color="rgb(34,197,94)" bg="rgba(34,197,94,0.15)">
                  {t('common.kos', { count: p.kos_dealt })}
                </StatBadge>
              )}
              {p.was_lead && (
                <StatBadge color="rgb(59,130,246)" bg="rgba(59,130,246,0.15)">
                  {t('statCard.lead')}
                </StatBadge>
              )}
              {p.was_koed && (
                <StatBadge color="rgb(239,68,68)" bg="rgba(239,68,68,0.15)">
                  {t('statCard.koed')}
                </StatBadge>
              )}
            </div>

            {/* Moves */}
            {moves && (
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--broadcast-text-muted)',
                  marginTop: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {moves}{extraMoves > 0 && ` +${extraMoves}`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatBadge({
  children,
  color,
  bg,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      style={{
        fontSize: '9px',
        fontWeight: 700,
        color,
        background: bg,
        padding: '1px 5px',
        borderRadius: '9999px',
        letterSpacing: '0.03em',
        textTransform: 'uppercase' as const,
        lineHeight: '16px',
      }}
    >
      {children}
    </span>
  );
}

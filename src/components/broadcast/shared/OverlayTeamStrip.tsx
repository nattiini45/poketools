'use client';

import OverlayPokemonSprite from './OverlayPokemonSprite';
import type { EnrichedPokemonState } from '@/types/broadcast';

interface OverlayTeamStripProps {
  pokemon: EnrichedPokemonState[];
  /** Sprite size in pixels. Default: 48. */
  size?: number;
  /** Show aura glow: gold=MVP, green=alive, red=KO'd. Default: true. */
  showAura?: boolean;
  /** Show KO/LEAD/MVP text badges below sprites. Default: false. */
  showBadges?: boolean;
  /** Dim benched (not brought) pokemon. Default: true. */
  dimBenched?: boolean;
  /** Stagger animation delay between sprites in ms. 0 = no stagger. */
  staggerDelay?: number;
  className?: string;
}

function getAuraColor(p: EnrichedPokemonState): string | undefined {
  if (p.is_mvp) return 'rgba(234,179,8,0.6)';
  if (!p.was_brought) return undefined;
  if (p.was_koed) return 'rgba(239,68,68,0.5)';
  return 'rgba(34,197,94,0.5)';
}

/**
 * Horizontal row of 6 pokemon sprites for broadcast overlays.
 * Each sprite shows alive/KO'd/MVP/benched status via aura glow and opacity.
 */
export default function OverlayTeamStrip({
  pokemon,
  size = 48,
  showAura = true,
  showBadges = false,
  dimBenched = true,
  staggerDelay = 0,
  className = '',
}: OverlayTeamStripProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${Math.max(4, size * 0.1)}px`,
      }}
    >
      {pokemon.map((p, i) => {
        const isBenched = !p.was_brought;
        const glowColor = showAura ? getAuraColor(p) : undefined;

        return (
          <div
            key={p.pokemon_name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              ...(staggerDelay > 0
                ? {
                    animation: `broadcast-fadeIn 0.3s ease-out ${staggerDelay * i}ms both`,
                  }
                : {}),
            }}
          >
            <OverlayPokemonSprite
              pokemon={p.pokemon_name}
              size={size}
              glowColor={glowColor}
              grayscale={isBenched && dimBenched}
              dimmed={isBenched && dimBenched}
            />
            {showBadges && p.was_brought && (
              <div
                style={{
                  display: 'flex',
                  gap: '2px',
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                }}
              >
                {p.is_mvp && (
                  <span style={{ color: 'rgb(234,179,8)' }}>MVP</span>
                )}
                {p.kos_dealt > 0 && !p.is_mvp && (
                  <span style={{ color: 'rgb(34,197,94)' }}>{p.kos_dealt}KO</span>
                )}
                {p.was_koed && (
                  <span style={{ color: 'rgb(239,68,68)' }}>KO</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

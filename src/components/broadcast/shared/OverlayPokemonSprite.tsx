'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';

interface OverlayPokemonSpriteProps {
  pokemon: string;
  /** Size in pixels. Default: 80 (larger than standard 40px). */
  size?: number;
  /** CSS glow color (e.g., tier color or accent). */
  glowColor?: string;
  /** Grayscale effect (e.g., for KO'd or bench pokemon). */
  grayscale?: boolean;
  /** Reduce opacity (e.g., for bench pokemon not brought). */
  dimmed?: boolean;
  className?: string;
}

/**
 * Stream-sized Pokémon sprite with optional glow/shadow effects.
 * Wraps the existing PokemonSprite with broadcast-specific styling.
 */
export default function OverlayPokemonSprite({
  pokemon,
  size = 80,
  glowColor,
  grayscale = false,
  dimmed = false,
  className = '',
}: OverlayPokemonSpriteProps) {
  const filterParts: string[] = [];
  if (grayscale) filterParts.push('grayscale(1)');
  if (dimmed) filterParts.push('opacity(0.4)');

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: filterParts.length > 0 ? filterParts.join(' ') : undefined,
        transition: 'filter 0.3s ease, box-shadow 0.3s ease',
        ...(glowColor
          ? { filter: `${filterParts.join(' ')} drop-shadow(0 0 8px ${glowColor})`.trim() }
          : {}),
      }}
    >
      <PokemonSprite name={pokemon} size={size} animated />
    </div>
  );
}

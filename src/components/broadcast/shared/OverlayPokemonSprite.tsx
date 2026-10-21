'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { SITE_DEFAULT_SPRITE_STYLE } from '@/lib/pkmn/sprite-styles';

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
 * Overlays are viewerless: the sprite is pinned to the site default style, not
 * the OBS browser's `plc_sprite_style` cookie, and to the `full` variant at
 * every size, because an OBS browser source is often scaled up in the scene
 * (docs/pkmn.md, "Sprite styles"). The filter change (KO, bench) eases only
 * when the viewer allows motion.
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
      className={`inline-flex items-center justify-center motion-safe:transition-[filter,box-shadow] motion-safe:duration-300 motion-safe:ease-in-out ${className}`}
      style={{
        filter: filterParts.length > 0 ? filterParts.join(' ') : undefined,
        ...(glowColor
          ? { filter: `${filterParts.join(' ')} drop-shadow(0 0 8px ${glowColor})`.trim() }
          : {}),
      }}
    >
      <PokemonSprite name={pokemon} size={size} variant="full" spriteStyle={SITE_DEFAULT_SPRITE_STYLE} />
    </div>
  );
}

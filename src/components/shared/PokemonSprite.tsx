'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useDataLocale } from '@/i18n/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { variantForSize, type SpriteStyle, type SpriteVariant } from '@/lib/pkmn/sprite-styles';
import { nextSpriteIndex, useSpriteCandidates } from './SpriteImg';

type AuraColor = 'green' | 'red' | 'gold' | 'none';

interface PokemonSpriteProps {
  /** Canonical English species name; drives the sprite URL. Only the alt text is localized. */
  name: string;
  size?: number;
  /**
   * Kept for call-site compatibility; has no effect. Animation is a viewer
   * choice now (the `animated` sprite style, docs/pkmn.md "Sprite styles").
   */
  animated?: boolean;
  shiny?: boolean;
  /** Default: `full` above 128 px, else the 256 px `thumb`. */
  variant?: SpriteVariant;
  /** Overrides the viewer's sprite style (viewerless or art-directed surfaces only). */
  spriteStyle?: SpriteStyle;
  className?: string;
  showContainer?: boolean;
  /** Colored radial glow behind the sprite. */
  aura?: AuraColor;
}

const AURA_COLORS: Record<Exclude<AuraColor, 'none'>, string> = {
  green: 'rgba(34,197,94,0.45)',
  red: 'rgba(239,68,68,0.45)',
  gold: 'rgba(234,179,8,0.55)',
};

/**
 * A Pokémon sprite in the viewer's sprite style. The URL comes from
 * `src/lib/pkmn/sprite-styles.ts`; a load error steps down the fallback chain
 * (style -> HOME -> base form's HOME -> placeholder) inside the same fixed
 * `size` x `size` box, so a fallback never shifts the layout.
 */
export default function PokemonSprite({
  name,
  size = 40,
  shiny = false,
  variant,
  spriteStyle,
  className = '',
  showContainer = false,
  aura = 'none',
}: PokemonSpriteProps) {
  const resolvedVariant = variant ?? variantForSize(size);
  const { style, candidates } = useSpriteCandidates(name, { style: spriteStyle, shiny, variant: resolvedVariant });
  return (
    <PokemonSpriteInner
      // A new source list (name, style, variant) starts the fallback walk over.
      key={`${name}:${style}:${resolvedVariant}:${shiny ? 's' : 'n'}`}
      name={name}
      candidates={candidates}
      size={size}
      className={className}
      showContainer={showContainer}
      aura={aura}
    />
  );
}

function PokemonSpriteInner({
  name,
  candidates,
  size,
  className,
  showContainer,
  aura,
}: {
  name: string;
  candidates: string[];
  size: number;
  className: string;
  showContainer: boolean;
  aura: AuraColor;
}) {
  const [index, setIndex] = useState(0);
  const dataLocale = useDataLocale();
  const url = candidates[Math.min(index, candidates.length - 1)];

  const handleError = () => {
    setIndex((i) => nextSpriteIndex(i, candidates.length));
  };

  const hasAura = aura !== 'none' && aura in AURA_COLORS;
  const needsWrapper = showContainer || hasAura;

  const image = (
    <Image
      src={url}
      alt={name ? localizeSpecies(name, dataLocale) : 'Pokémon'}
      width={size}
      height={size}
      className={needsWrapper ? '' : className}
      style={{ position: 'relative', zIndex: 1, objectFit: 'contain' }}
      unoptimized
      onError={handleError}
    />
  );

  if (needsWrapper) {
    const auraColor = hasAura ? AURA_COLORS[aura as Exclude<AuraColor, 'none'>] : undefined;

    return (
      <div
        className={`inline-flex items-center justify-center relative ${className}`}
        style={{ width: size, height: size }}
      >
        {/* Radial aura glow */}
        {auraColor && (
          <div
            className="absolute inset-0 rounded-full blur-md"
            style={{
              background: `radial-gradient(circle, ${auraColor} 0%, transparent 70%)`,
              transform: 'scale(1.4)',
            }}
          />
        )}
        {image}
      </div>
    );
  }

  return image;
}

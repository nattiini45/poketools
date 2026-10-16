'use client';

import { useState } from 'react';
import Image from 'next/image';
import { getSpriteUrl, getBaseFormName } from '@/lib/pkmn/sprites';
import { useDataLocale } from '@/i18n/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

type AuraColor = 'green' | 'red' | 'gold' | 'none';

interface PokemonSpriteProps {
  /** Canonical English species name; drives the sprite URL. Only the alt text is localized. */
  name: string;
  size?: number;
  animated?: boolean;
  className?: string;
  showContainer?: boolean;
  /** Colored radial glow behind the sprite. */
  aura?: AuraColor;
}

type FallbackStage = 'original' | 'base' | 'placeholder';

const PLACEHOLDER_URL = 'https://play.pokemonshowdown.com/sprites/gen5/substitute.png';

const AURA_COLORS: Record<Exclude<AuraColor, 'none'>, string> = {
  green: 'rgba(34,197,94,0.45)',
  red: 'rgba(239,68,68,0.45)',
  gold: 'rgba(234,179,8,0.55)',
};

export default function PokemonSprite({
  name,
  size = 40,
  animated = false,
  className = '',
  showContainer = false,
  aura = 'none',
}: PokemonSpriteProps) {
  return (
    <PokemonSpriteInner
      key={`${name}:${animated ? 'animated' : 'static'}`}
      name={name}
      size={size}
      animated={animated}
      className={className}
      showContainer={showContainer}
      aura={aura}
    />
  );
}

function PokemonSpriteInner({
  name,
  size = 40,
  animated = false,
  className = '',
  showContainer = false,
  aura = 'none',
}: PokemonSpriteProps) {
  const [fallbackStage, setFallbackStage] = useState<FallbackStage>('original');
  const dataLocale = useDataLocale();

  let url: string;
  if (!name) {
    url = PLACEHOLDER_URL;
  } else if (fallbackStage === 'original') {
    url = getSpriteUrl(name, { animated });
  } else if (fallbackStage === 'base') {
    const baseName = getBaseFormName(name);
    url = getSpriteUrl(baseName!, { animated });
  } else {
    url = PLACEHOLDER_URL;
  }

  const handleError = () => {
    if (fallbackStage === 'original') {
      const baseName = getBaseFormName(name);
      if (baseName) {
        setFallbackStage('base');
      } else {
        setFallbackStage('placeholder');
      }
    } else if (fallbackStage === 'base') {
      setFallbackStage('placeholder');
    }
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
      style={{ position: 'relative', zIndex: 1 }}
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

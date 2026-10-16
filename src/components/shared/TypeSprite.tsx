'use client';

import Image from 'next/image';
import { useDataLocale, useT } from '@/i18n/client';
import { pkmnMessages } from '@/i18n/messages/pkmn';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';

interface TypeSpriteProps {
  type: string;
  size?: number;
  className?: string;
}

/**
 * Renders a Pokémon type icon sprite from the Showdown CDN.
 * URL format: https://play.pokemonshowdown.com/sprites/types/{Type}.png
 */
export default function TypeSprite({ type, size = 16, className = '' }: TypeSpriteProps) {
  // Showdown expects capital-first (e.g. "Fire", "Water")
  const normalized = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  const src = `https://play.pokemonshowdown.com/sprites/types/${normalized}.png`;
  const t = useT(pkmnMessages);
  const label = localizeType(normalized, useDataLocale());

  return (
    <Image
      src={src}
      alt={t('typeAria', { type: label })}
      width={size * 2}
      height={size}
      className={`inline-block align-middle ${className}`}
      unoptimized
    />
  );
}

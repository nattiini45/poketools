'use client';

import { useDataLocale, useT } from '@/i18n/client';
import { pkmnMessages } from '@/i18n/messages/pkmn';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';

/**
 * Compact inline type indicator — small colored circle for use in lists,
 * tables, and composite display components. For the full pill badge, use TypeBadge.
 * `type` is the English name (the color key); title and aria-label are localized.
 */

const TYPE_COLORS: Record<string, string> = {
  Normal: 'bg-poke-type-normal',
  Fire: 'bg-poke-type-fire',
  Water: 'bg-poke-type-water',
  Electric: 'bg-poke-type-electric',
  Grass: 'bg-poke-type-grass',
  Ice: 'bg-poke-type-ice',
  Fighting: 'bg-poke-type-fighting',
  Poison: 'bg-poke-type-poison',
  Ground: 'bg-poke-type-ground',
  Flying: 'bg-poke-type-flying',
  Psychic: 'bg-poke-type-psychic',
  Bug: 'bg-poke-type-bug',
  Rock: 'bg-poke-type-rock',
  Ghost: 'bg-poke-type-ghost',
  Dragon: 'bg-poke-type-dragon',
  Dark: 'bg-poke-type-dark',
  Steel: 'bg-poke-type-steel',
  Fairy: 'bg-poke-type-fairy',
};

const SIZE_CLASSES: Record<string, string> = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
};

interface TypeIconProps {
  type: string;
  size?: 'sm' | 'md';
}

export default function TypeIcon({ type, size = 'sm' }: TypeIconProps) {
  const color = TYPE_COLORS[type] ?? 'bg-poke-muted';
  const sizeClass = SIZE_CLASSES[size];
  const t = useT(pkmnMessages);
  const label = localizeType(type, useDataLocale());

  return (
    <span
      className={`inline-block rounded-full shrink-0 ${sizeClass} ${color}`}
      title={label}
      role="img"
      aria-label={t('typeAria', { type: label })}
    />
  );
}

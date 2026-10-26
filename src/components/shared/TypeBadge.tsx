'use client';

import { useDataLocale } from '@/i18n/client';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import type { DataLocale } from '@/lib/pkmn/i18n/types';

// Style keys are the English type names the app stores; only the label is localized.
const TYPE_STYLES: Record<string, string> = {
  Normal: 'bg-poke-type-normal text-white',
  Fire: 'bg-poke-type-fire text-white',
  Water: 'bg-poke-type-water text-white',
  Electric: 'bg-poke-type-electric text-poke-text-primary',
  Grass: 'bg-poke-type-grass text-white',
  Ice: 'bg-poke-type-ice text-poke-text-primary',
  Fighting: 'bg-poke-type-fighting text-white',
  Poison: 'bg-poke-type-poison text-white',
  Ground: 'bg-poke-type-ground text-white',
  Flying: 'bg-poke-type-flying text-poke-text-primary',
  Psychic: 'bg-poke-type-psychic text-white',
  Bug: 'bg-poke-type-bug text-white',
  Rock: 'bg-poke-type-rock text-white',
  Ghost: 'bg-poke-type-ghost text-white',
  Dragon: 'bg-poke-type-dragon text-white',
  Dark: 'bg-poke-type-dark text-white',
  Steel: 'bg-poke-type-steel text-white',
  Fairy: 'bg-poke-type-fairy text-poke-text-primary',
};

// Box metrics per size: `compact` is the narrow pill of dense layouts (the team weakness table's column heads).
const SIZE_CLASSES = {
  default: 'min-w-[4.5rem] px-2.5 py-0.5 text-xs tracking-wide',
  compact: 'min-w-0 px-0.5 py-1.5 text-[0.625rem] leading-[1.1] tracking-normal',
} as const;

interface TypeBadgeProps {
  /** English type name ('Fire'); also the style key. */
  type: string;
  className?: string;
  /** `compact` drops the minimum width and tightens padding, type size and line height. */
  size?: keyof typeof SIZE_CLASSES;
  /** Overrides the data locale from the provider (e.g. viewerless output in the league language). */
  locale?: DataLocale;
}

export default function TypeBadge({ type, className = '', size = 'default', locale }: TypeBadgeProps) {
  const providerLocale = useDataLocale();
  const label = localizeType(type, locale ?? providerLocale);
  const styles = TYPE_STYLES[type] ?? 'bg-poke-muted text-poke-text-secondary';

  return (
    <span
      className={`
        relative overflow-hidden group
        inline-block rounded-full
        font-heading font-bold uppercase text-center
        shadow-poke-sm
        ${SIZE_CLASSES[size]} ${styles} ${className}
      `}
    >
      <span
        className="
          absolute inset-0 -translate-x-full
          bg-gradient-to-r from-transparent via-white/25 to-transparent
          group-hover:animate-type-shimmer
        "
        aria-hidden="true"
      />
      <span className="relative">{label}</span>
    </span>
  );
}

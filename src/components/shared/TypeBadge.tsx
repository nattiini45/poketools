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

interface TypeBadgeProps {
  /** English type name ('Fire'); also the style key. */
  type: string;
  className?: string;
  /** Overrides the data locale from the provider (e.g. viewerless output in the league language). */
  locale?: DataLocale;
}

export default function TypeBadge({ type, className = '', locale }: TypeBadgeProps) {
  const providerLocale = useDataLocale();
  const label = localizeType(type, locale ?? providerLocale);
  const styles = TYPE_STYLES[type] ?? 'bg-poke-muted text-poke-text-secondary';

  return (
    <span
      className={`
        relative overflow-hidden group
        inline-block min-w-[4.5rem] px-2.5 py-0.5 rounded-full
        text-xs font-heading font-bold uppercase tracking-wide text-center
        shadow-poke-sm
        ${styles} ${className}
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

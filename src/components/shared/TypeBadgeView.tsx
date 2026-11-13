// Presentational half of TypeBadge, with no hook and no name table: a server component (the shared-team and library
// pages) localizes the label itself and renders this, so the German type and nature names stay out of its chunks.

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
  default: 'min-w-[81px] px-2.5 py-0.5 text-xs',
  compact: 'min-w-0 px-0.5 py-1.5 text-[11.25px] leading-[1.1]',
} as const;

export type TypeBadgeSize = keyof typeof SIZE_CLASSES;

interface TypeBadgeViewProps {
  /** English type name ('Fire'); the style key. */
  type: string;
  /** The already localized label. */
  label: string;
  className?: string;
  size?: TypeBadgeSize;
}

export default function TypeBadgeView({ type, label, className = '', size = 'default' }: TypeBadgeViewProps) {
  const styles = TYPE_STYLES[type] ?? 'bg-poke-muted text-poke-text-secondary';

  return (
    <span
      className={`
        relative overflow-hidden group
        inline-block rounded-full
        font-heading font-bold text-center
        shadow-poke-sm
        ${SIZE_CLASSES[size]} ${styles} ${className}
      `}
    >
      <span
        className="
          absolute inset-0 -translate-x-full
          bg-linear-to-r/srgb from-transparent via-[rgb(255_255_255/0.25)] to-transparent
          group-hover:animate-type-shimmer
        "
        aria-hidden="true"
      />
      <span className="relative">{label}</span>
    </span>
  );
}
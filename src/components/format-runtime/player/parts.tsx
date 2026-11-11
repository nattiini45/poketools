'use client';

import type { ReactNode } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';
import { speciesDisplayName } from './entry-names';

/** The card every block of the player page sits on. */
export const PLAYER_CARD = 'flex flex-col gap-3 rounded-poke-lg border border-hairline bg-surface p-4 sm:p-5';
/** The focus ring of the page's programmatic focus targets (headings, rows, the problem list). */
export const FOCUS_TARGET =
  'focus:outline-2 focus:outline-offset-2 focus:outline-transparent focus-visible:ring-2 focus-visible:ring-ring';

interface PlayerSectionProps {
  title: string;
  /** The section's icon from the approved item-icon map. */
  icon?: ItemIconId;
  children: ReactNode;
}

/** One section of the player page: a pixel title with its item icon over the section's cards. */
export function PlayerSection({ title, icon, children }: PlayerSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {icon && <ItemIcon item={icon} />}
        <h2 className="font-heading text-title text-fg">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** The sprite of a domain entry. Decorative: the entry's name is always written beside it. */
export function EntrySprite({ id, size = 40, className }: { id: string; size?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0', className)}>
      <PokemonSprite name={speciesDisplayName(id, 'en')} size={size} />
    </span>
  );
}

/** A trainer's initial on a small skewed tile (the views carry names, no avatars). Decorative: the name is written beside it. */
export function TrainerTile({ name, own = false }: { name: string; own?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid size-7 shrink-0 place-items-center rounded-[4px] [transform:skewX(var(--skew))]',
        own ? 'bg-tier-1' : 'bg-tier-3-soft',
      )}
    >
      <span className="font-heading text-body text-tier-ink [transform:skewX(calc(var(--skew)*-1))]">{name.trim().charAt(0).toUpperCase()}</span>
    </span>
  );
}

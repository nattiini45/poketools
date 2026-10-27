'use client';

import { Package } from 'lucide-react';
import CategoryIcon from '@/components/shared/CategoryIcon';
import SheetIcon from '@/components/shared/SheetIcon';
import SpriteImg from '@/components/shared/SpriteImg';
import TypeSprite from '@/components/shared/TypeSprite';
import type { CatalogEntry } from '@/lib/pkmn/catalog-index';

export type ArtSize = 'card' | 'row';

interface EntryArtProps {
  entry: CatalogEntry;
  size: ArtSize;
  /** Extra classes on the art wrapper (the state treatment dims or greys it). */
  className?: string;
}

/**
 * The art slot of an entry. Pokémon and items are cells of the Showdown icon sheets (one request for the whole list);
 * a Pokémon the sheet has no cell for falls back to its sprite. A move shows its type and category icons, an ability has
 * no art (the card is a clean text tile). The art is decoration: the option's accessible name carries the entry.
 */
export default function EntryArt({ entry, size, className = '' }: EntryArtProps) {
  const wrap = `flex shrink-0 items-center justify-center ${className}`;
  switch (entry.kind) {
    case 'species': {
      const box = size === 'card' ? 'h-[60px] w-[80px]' : 'h-[30px] w-[40px]';
      return (
        <span className={`${wrap} ${box}`} aria-hidden="true">
          {entry.ic !== null ? (
            <SheetIcon sheet="pokemon" cell={entry.ic} scale={size === 'card' ? 2 : 1} />
          ) : (
            <SpriteImg name={entry.name} alt="" loading="lazy" decoding="async" width={size === 'card' ? 60 : 30} height={size === 'card' ? 60 : 30} className="h-full w-auto" />
          )}
        </span>
      );
    }
    case 'items': {
      const box = size === 'card' ? 'h-[48px] w-[48px]' : 'h-[24px] w-[24px]';
      return (
        <span className={`${wrap} ${box}`} aria-hidden="true">
          {entry.ic !== null ? <SheetIcon sheet="item" cell={entry.ic} scale={size === 'card' ? 2 : 1} /> : <Package className="h-5 w-5 text-poke-text-muted" />}
        </span>
      );
    }
    case 'moves':
      return (
        <span className={`${wrap} flex-col gap-1`} aria-hidden="true">
          <TypeSprite type={entry.type} size={size === 'card' ? 14 : 12} />
          <CategoryIcon category={entry.category} size={size === 'card' ? 16 : 12} />
        </span>
      );
    default:
      return null;
  }
}

/**
 * The favourite star of the draft room (Pokémon HOME look): a gold outline when the line is not a favourite,
 * the same star filled gold when it is. One drawing for every place that shows it (the roster cards and the
 * info box), so they cannot drift apart. Decorative: the caller owns the label (`title`, `aria-label`) and the
 * click target. The gold is the `--draft-star` token of `draft-tool.module.css` (both themes).
 */
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface FavoriteStarProps {
  filled: boolean;
  /** Size and placement; the colours are fixed. */
  className?: string;
}

export default function FavoriteStar({ filled, className }: FavoriteStarProps) {
  return (
    <Star
      aria-hidden="true"
      strokeWidth={1.75}
      data-filled={filled ? 'true' : 'false'}
      className={cn('stroke-[color:var(--draft-star)]', filled ? 'fill-[color:var(--draft-star)]' : 'fill-transparent', className)}
    />
  );
}

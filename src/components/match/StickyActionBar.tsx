import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface StickyActionBarProps {
  children: ReactNode;
  className?: string;
}

/**
 * The action row of a form card. On phones it is the card's footer and sticks to the bottom of the viewport while the
 * form scrolls, so the primary action is always in reach; from `sm` up it is a plain row. It expects to be the last
 * child of a card with `p-4 sm:p-5`.
 */
export default function StickyActionBar({ children, className }: StickyActionBarProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center gap-3 rounded-b-poke-lg border-t border-hairline bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'sm:static sm:m-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

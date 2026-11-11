import type { HTMLAttributes, ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

interface WorkspaceCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'id' | 'className' | 'children' | 'aria-labelledby'> {
  /** The id of the heading; the card is a region labelled by it. */
  headingId: string;
  title: ReactNode;
  /** An approved item icon beside the title (decorative). */
  icon?: ItemIconId;
  /** Right of the title: a count, a chip. */
  aside?: ReactNode;
  /** The id of the card itself, for in-page links. */
  id?: string;
  headingLevel?: 2 | 3;
  className?: string;
  children: ReactNode;
}

/**
 * A card of an admin workspace (redesign A5, direction B's calm end): a surface with a hairline, a pixel-type
 * title with its item icon, and the content below a rule. No hooks, so server and client components both render it.
 */
export default function WorkspaceCard({ headingId, title, icon, aside, id, headingLevel = 2, className, children, ...rest }: WorkspaceCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      {...rest}
      id={id}
      aria-labelledby={headingId}
      className={cn('min-w-0 self-start overflow-hidden rounded-poke-lg border border-hairline bg-surface shadow-poke-card', id && 'scroll-mt-4', className)}
    >
      <div className="flex min-h-14 items-center gap-2.5 border-b border-hairline px-5 py-3">
        {icon && <ItemIcon item={icon} />}
        <Heading id={headingId} className="min-w-0 flex-1 font-heading text-title text-fg">
          {title}
        </Heading>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

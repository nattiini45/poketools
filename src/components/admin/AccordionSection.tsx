import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

interface AccordionSectionProps {
  /** The anchor of the section; its heading is `<id>-title`. */
  id: string;
  icon?: ItemIconId;
  title: string;
  subtitle?: string;
  /** Right of the title, before the chevron: a count or a chip. */
  aside?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * One accordion section of an admin workspace (redesign A8a): a hairline frame whose header is the toggle, an item
 * icon, a pixel-type title, one muted sentence and the body below a rule. A native `<details>`, so it needs no
 * hooks, server and client components both render it, and a closed body stays mounted (a control keeps its state).
 */
export default function AccordionSection({ id, icon, title, subtitle, aside, defaultOpen = false, className, children }: AccordionSectionProps) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className={cn('group min-w-0 scroll-mt-4 overflow-hidden rounded-poke-lg border border-hairline bg-surface shadow-poke-card', className)}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 px-5 py-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)] [&::-webkit-details-marker]:hidden">
        {icon && <ItemIcon item={icon} className="self-start" />}
        <span className="min-w-0 flex-1">
          <span id={`${id}-title`} role="heading" aria-level={2} className="block font-heading text-title text-fg">
            {title}
          </span>
          {subtitle && <span className="mt-1 block max-w-[68ch] text-body font-normal text-fg-muted">{subtitle}</span>}
        </span>
        {aside}
        <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="border-t border-hairline p-5">{children}</div>
    </details>
  );
}

import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';

/**
 * The heading row above an admin table or list that carries no card of its own: the item icon, the title in the
 * pixel face, an optional count plate, and the section's links at the end of the row. It wraps, so a long German
 * title only pushes the links to a second line.
 */
export default function AdminSectionHeading({
  id,
  icon,
  title,
  aside,
  children,
}: {
  /** The id of the heading, for the section's `aria-labelledby`. */
  id: string;
  icon: ItemIconId;
  title: string;
  /** Right after the title: a count plate. */
  aside?: ReactNode;
  /** The end of the row: links and buttons. */
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <ItemIcon item={icon} className="self-center" />
      <h2 id={id} className="font-heading text-title text-fg">
        {title}
      </h2>
      {aside}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';

/**
 * The empty state of an admin table or list: an approved item icon at 48 px (the Poké Doll unless the page names
 * another), one sentence that says what is missing, one that names the next step, and the action when there is one.
 */
export default function AdminEmpty({
  title,
  hint,
  icon = 'poke-doll',
  children,
  ...hooks
}: {
  title: string;
  hint?: string;
  icon?: ItemIconId;
  children?: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-poke-lg border border-dashed border-hairline-strong bg-surface px-4 py-10 text-center"
      {...hooks}
    >
      <ItemIcon item={icon} size={48} />
      <p className="text-subtitle text-fg">{title}</p>
      {hint && <p className="max-w-prose text-body text-fg-muted">{hint}</p>}
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';

interface ProfileEmptyProps {
  children: ReactNode;
  /** The next step, when the viewer can take one (a `PlateLink`). */
  action?: ReactNode;
  icon?: ItemIconId;
}

/** An empty profile section: the approved empty-state doll, one sentence, and the next step when there is one. */
export default function ProfileEmpty({ children, action, icon = 'poke-doll' }: ProfileEmptyProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <ItemIcon item={icon} size={48} />
      <p className="min-w-0 flex-1 basis-44 text-body text-fg-muted">{children}</p>
      {action}
    </div>
  );
}

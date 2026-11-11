import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';

interface ProfileEmptyProps {
  children: ReactNode;
  /** The next step, when the viewer can take one (a `PlateLink`). */
  action?: ReactNode;
  /** Draw the approved empty-state doll beside the sentence; one per page is enough. */
  doll?: boolean;
}

/** An empty profile section: one sentence, the next step when there is one, and the empty-state doll where asked. */
export default function ProfileEmpty({ children, action, doll = false }: ProfileEmptyProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {doll && <ItemIcon item="poke-doll" size={48} />}
      <p className="min-w-0 flex-1 basis-44 text-body text-fg-muted">{children}</p>
      {action}
    </div>
  );
}

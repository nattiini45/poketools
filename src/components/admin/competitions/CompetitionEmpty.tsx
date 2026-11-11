import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';

/**
 * The empty state of a competition list or of the trash: the Pokémon-doll item icon (the approved "empty" icon, 48 px),
 * one sentence that says what is missing, one that names the next step, and the action when there is one.
 */
export default function CompetitionEmpty({
  title,
  hint,
  children,
  ...hooks
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-poke-lg border border-dashed border-hairline-strong bg-surface px-4 py-10 text-center"
      {...hooks}
    >
      <ItemIcon item="poke-doll" size={48} />
      <p className="text-subtitle text-fg">{title}</p>
      {hint && <p className="max-w-prose text-body text-fg-muted">{hint}</p>}
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  icon: ItemIconId;
  /** A short state or badge on the right of the header. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * One section of a player settings page in Direction B: an item icon and a Geist Pixel title over a calm body. The
 * sections of a page share one surface rhythm; a section with unsaved changes reports them to the page's save bar
 * (`settings-save.tsx`).
 */
export default function SettingsSection({ title, description, icon, meta, children, className }: SettingsSectionProps) {
  return (
    <section className={cn('w-full overflow-hidden rounded-poke-lg border border-hairline bg-surface', className)}>
      <div className="flex items-start gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
        <ItemIcon item={icon} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-title text-fg">{title}</h2>
          {description && <p className="mt-0.5 max-w-[70ch] text-body text-fg-muted">{description}</p>}
        </div>
        {meta && <div className="shrink-0">{meta}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

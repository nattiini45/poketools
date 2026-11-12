import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

interface SettingsSectionProps {
  /** The anchor of the section; its heading is `<id>-title`. */
  id: string;
  /** An approved item icon beside the title (decorative). */
  icon: ItemIconId;
  title: string;
  subtitle?: string;
  /** Right of the title: a chip that says how the section saves. */
  aside?: ReactNode;
  /** The danger zone sets its title in the loss ink. */
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/**
 * One section of a settings sheet (redesign A6): a pixel-type title with its item icon, one muted sentence and the
 * controls below. The sheet around it draws the surface and the rules between sections, so a section has no frame
 * of its own. No hooks, so server and client components both render it.
 */
export default function SettingsSection({ id, icon, title, subtitle, aside, tone = 'default', children }: SettingsSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="group/section scroll-mt-20 px-5 py-6 sm:px-6" data-settings-section={id}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <ItemIcon item={icon} className="self-start" />
        <h2 id={`${id}-title`} className={cn('min-w-0 flex-1 font-heading text-title', tone === 'danger' ? 'text-loss' : 'text-fg')}>
          {title}
        </h2>
        {aside}
      </div>
      {subtitle && <p className="mt-1.5 max-w-[68ch] text-body text-fg-muted">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

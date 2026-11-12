import ItemIcon from '@/components/ui/ItemIcon';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

export interface SettingsIndexItem {
  /** The id of the section the entry jumps to. */
  id: string;
  icon: ItemIconId;
  label: string;
  /** The danger zone's entry is set in the loss ink. */
  danger?: boolean;
  /**
   * The section holds the form with a save bar: its entry shows a dot while that form marks unsaved input
   * (`data-unsaved="true"` inside an ancestor with the `group/settings` class). Styling only; the save bar says it in words.
   */
  marksUnsaved?: boolean;
}

interface SettingsIndexProps {
  /** The accessible name of the list ("Settings sections"). */
  label: string;
  items: readonly SettingsIndexItem[];
}

/**
 * The section index beside a settings sheet (redesign A6): one in-page link per section with its item icon.
 * Plain anchors, so it works without script and renders on the server.
 */
export default function SettingsIndex({ label, items }: SettingsIndexProps) {
  return (
    <nav aria-label={label} data-settings-index>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                'flex min-h-9 items-center gap-2.5 rounded-poke-md px-2.5 py-1.5 text-body hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] motion-safe:transition-colors motion-safe:duration-80',
                item.danger ? 'text-loss' : 'text-fg-muted hover:text-fg',
              )}
            >
              <ItemIcon item={item.icon} />
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.marksUnsaved && (
                <span aria-hidden="true" className="hidden size-2 shrink-0 rounded-full bg-accent-fill group-has-[[data-unsaved=true]]/settings:block" />
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

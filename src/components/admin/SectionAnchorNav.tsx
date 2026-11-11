import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import type { ItemIconId } from '@/lib/pkmn/item-icons';

export interface SectionAnchor {
  /** The DOM id of the section the link jumps to (the `Section` carries it as its anchor id). */
  id: string;
  label: string;
  /** An approved item icon, the same one the section's title shows. */
  icon: ItemIconId;
}

interface SectionAnchorNavProps {
  /** Names the `<nav>` landmark. */
  label: string;
  sections: readonly SectionAnchor[];
}

/**
 * The strip of in-page links at the head of a workspace page that is one long column of sections (a league phase,
 * a standalone tournament; redesign A7). It is the league workspace's tab strip with anchors for links: skewed tab
 * plates with the section's item icon, none of them current (the page scrolls, it does not switch views). A phone
 * scrolls the strip sideways inside its own box; from `md` up it wraps. Labels never get a fixed width.
 */
export default function SectionAnchorNav({ label, sections }: SectionAnchorNavProps) {
  return (
    <nav aria-label={label} className="min-w-0 border-b border-hairline">
      <ul className="flex gap-2 overflow-x-auto overscroll-x-contain px-1.5 pb-2 pt-1 md:flex-wrap md:overflow-x-visible">
        {sections.map((section) => (
          <li key={section.id} className="shrink-0">
            <a href={`#${section.id}`} className="group relative inline-flex whitespace-nowrap text-body">
              <SkewPlate
                variant="tab"
                className="min-h-11 py-1.5 pl-2 pr-3.5 text-fg-muted group-hover:text-fg motion-safe:transition-colors motion-safe:duration-80 sm:min-h-0"
              >
                <span className="flex items-center gap-1.5">
                  <ItemIcon item={section.icon} />
                  {section.label}
                </span>
              </SkewPlate>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

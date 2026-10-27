import type { ReactNode } from 'react';
import Badge from '@/components/ui/Badge';
import LibraryCard from './LibraryCard';

export interface LibraryEntry {
  id: string;
  /** Where the card leads (the editor for your own definitions, the read-only page for shared ones). */
  href: string;
  title: string;
  /** Already-translated sentences under the title. */
  lines: readonly string[];
  /** Already-translated state badges (draft, published version, shared, gallery, a warning such as outdated catalog data). */
  badges: readonly { label: string; variant: 'gray' | 'green' | 'blue' | 'accent' | 'yellow' }[];
  /** Already-translated label of the open link. */
  openLabel: string;
}

interface LibraryListProps {
  entries: readonly LibraryEntry[];
  /** A client leaf under each card (a Fork button); it sits beside the card, never inside its link. */
  actions?: (entry: LibraryEntry) => ReactNode;
  /** Shown instead of the list when there are no entries. */
  empty: ReactNode;
}

/**
 * The cards of stored definitions on a studio's gallery page. Hook-free, so a server page renders it with text it has
 * already translated.
 */
export default function LibraryList({ entries, actions, empty }: LibraryListProps) {
  if (entries.length === 0) return <>{empty}</>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {entries.map((entry) => (
        <li key={entry.id} className="min-w-0 space-y-2">
          <LibraryCard
            href={entry.href}
            title={entry.title}
            lines={entry.lines}
            badges={entry.badges.map((badge) => (
              <Badge key={badge.label} variant={badge.variant}>
                {badge.label}
              </Badge>
            ))}
            openLabel={entry.openLabel}
          />
          {actions?.(entry)}
        </li>
      ))}
    </ul>
  );
}

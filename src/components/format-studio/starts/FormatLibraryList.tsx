import type { ReactNode } from 'react';
import FormatCard from '../FormatCard';
import ForkStoredButton from './ForkStoredButton';
import Badge from '@/components/ui/Badge';

export interface LibraryEntry {
  id: string;
  /** Where the card leads (the editor for your own formats, the read-only page for shared ones). */
  href: string;
  title: string;
  /** Already-translated sentences under the title. */
  lines: readonly string[];
  /** Already-translated state badges (draft, published version, shared, gallery). */
  badges: readonly { label: string; variant: 'gray' | 'green' | 'blue' | 'accent' }[];
  /** Already-translated label of the open link. */
  openLabel: string;
}

interface FormatLibraryListProps {
  entries: readonly LibraryEntry[];
  /** Offer a Fork button under each card. */
  fork?: boolean;
  /** Shown instead of the list when there are no entries. */
  empty: ReactNode;
}

/**
 * The cards of stored formats on the gallery page. Hook-free, so a server page renders it with text it has
 * already translated; the Fork button is a client leaf and sits beside the card, never inside its link.
 */
export default function FormatLibraryList({ entries, fork = false, empty }: FormatLibraryListProps) {
  if (entries.length === 0) return <>{empty}</>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {entries.map((entry) => (
        <li key={entry.id} className="min-w-0 space-y-2">
          <FormatCard
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
          {fork && <ForkStoredButton definitionId={entry.id} hint={false} />}
        </li>
      ))}
    </ul>
  );
}

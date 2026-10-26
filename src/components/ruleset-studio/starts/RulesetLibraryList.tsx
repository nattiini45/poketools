import type { ReactNode } from 'react';
import LibraryList, { type LibraryEntry } from '@/components/studio-shell/library/LibraryList';
import ForkStoredButton from './ForkStoredButton';

interface RulesetLibraryListProps {
  entries: readonly LibraryEntry[];
  /** Offer a Fork button under each card. */
  fork?: boolean;
  /** Shown instead of the list when there are no entries. */
  empty: ReactNode;
}

/**
 * The cards of stored rulesets on the gallery page: the shared library list with the Fork button as a client leaf beside
 * each card. Hook-free, so a server page renders it with text it has already translated.
 */
export default function RulesetLibraryList({ entries, fork = false, empty }: RulesetLibraryListProps) {
  return (
    <LibraryList
      entries={entries}
      empty={empty}
      actions={fork ? (entry) => <ForkStoredButton definitionId={entry.id} hint={false} /> : undefined}
    />
  );
}

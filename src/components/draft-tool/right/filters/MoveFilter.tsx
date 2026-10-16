'use client';

/** Move filter: bilingual move search over the index plus "Any" / "Require all" (FR-5, SPEC:269-272). */
import { useMemo } from 'react';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { indexMoveName } from '@/lib/draft-finder/names-port';
import { cn } from '@/lib/utils/cn';
import MatchToggle from './MatchToggle';
import SearchPicker, { type PickerEntry } from './SearchPicker';
import { SECTION_HEADING, type FilterSectionProps } from './types';

export default function MoveFilter({ view, dispatch, ix, names, dl }: FilterSectionProps) {
  const t = useT(draftFinderMessages);
  const heading = t('filters.move');
  const entries = useMemo<PickerEntry[]>(
    () =>
      ix.moveSearch.map(({ idx, keys }) => ({
        id: ix.raw.moves[idx],
        name: indexMoveName(ix.raw, idx, names, dl),
        keys,
      })),
    [ix, names, dl],
  );
  return (
    <section aria-label={heading}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className={cn(SECTION_HEADING, 'mb-0')}>{heading}</h3>
        <MatchToggle
          label={heading}
          value={view.filters.moves.match}
          onChange={(match) => dispatch({ type: 'setMoveMatch', match })}
        />
      </div>
      <SearchPicker
        entries={entries}
        selected={view.filters.moves.ids}
        onToggle={(id) => dispatch({ type: 'toggleMove', id })}
        searchLabel={t('picker.moveSearch')}
        names={names}
        dl={dl}
      />
    </section>
  );
}

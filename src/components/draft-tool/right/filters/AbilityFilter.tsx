'use client';

/** Ability filter: bilingual ability search over the index; picked abilities are ORed (FR-5). */
import { useMemo } from 'react';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { indexAbilityName } from '@/lib/draft-finder/names-port';
import SearchPicker, { type PickerEntry } from './SearchPicker';
import { SECTION_HEADING, type FilterSectionProps } from './types';

export default function AbilityFilter({ view, dispatch, ix, names, dl }: FilterSectionProps) {
  const t = useT(draftFinderMessages);
  const heading = t('filters.ability');
  const entries = useMemo<PickerEntry[]>(
    () =>
      ix.abilitySearch.map(({ idx, keys }) => ({
        id: ix.raw.abilities[idx],
        name: indexAbilityName(ix.raw, idx, names, dl),
        keys,
      })),
    [ix, names, dl],
  );
  return (
    <section aria-label={heading}>
      <h4 className={SECTION_HEADING}>{heading}</h4>
      <SearchPicker
        entries={entries}
        selected={view.filters.abilities.ids}
        onToggle={(id) => dispatch({ type: 'toggleAbility', id })}
        query={view.filterSheet.pickerQuery.ability}
        onQueryChange={(query) => dispatch({ type: 'setPickerQuery', picker: 'ability', query })}
        searchLabel={t('picker.abilitySearch')}
        names={names}
        dl={dl}
      />
    </section>
  );
}

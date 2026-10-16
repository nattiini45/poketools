'use client';

import { useCallback, useMemo } from 'react';
import WikiIndexTable, {
  type WikiIndexColumn,
  type WikiIndexFacet,
} from '@/components/wiki/WikiIndexTable';
import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { abilitySearchKeys, localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { foldForSearch, matchRank, NO_MATCH, type SearchKeys } from '@/lib/pkmn/i18n/search';

/**
 * One row as the server sends it: the English ability name and numbers, plus the description already
 * localized for the viewer (`localizeDesc`, server-only); `descFallback` marks English text in German mode.
 */
export interface AbilityRow {
  name: string;
  desc: string;
  descFallback: boolean;
  rating: number;
  earliestGen: number;
}

const GENERATIONS = ['3', '4', '5', '6', '7', '8', '9'] as const;

interface AbilitySearchEntry {
  keys: SearchKeys;
  desc: string;
}

/**
 * Search entries per row object, built on first search. Keyed by the row, not the name: new rows (a language
 * switch re-localizes the descriptions) get fresh entries, and old ones are collected.
 */
const searchCache = new WeakMap<AbilityRow, AbilitySearchEntry>();

export default function AbilitiesIndexClient({ data }: { data: readonly AbilityRow[] }) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();

  const searchFn = useCallback(
    (row: AbilityRow, q: string) => {
      let entry = searchCache.get(row);
      if (!entry) {
        entry = { keys: abilitySearchKeys(row.name), desc: foldForSearch(row.desc) };
        searchCache.set(row, entry);
      }
      const folded = foldForSearch(q);
      return matchRank(q, entry.keys) !== NO_MATCH || (folded !== '' && entry.desc.includes(folded));
    },
    [],
  );

  const columns = useMemo<WikiIndexColumn<AbilityRow>[]>(
    () => [
      {
        key: 'name',
        header: t('index.name'),
        width: '200px',
        sortable: true,
        sortValue: (row) => localizeAbility(row.name, dl),
        render: (row) => (
          <span className="font-medium text-poke-text-primary">{localizeAbility(row.name, dl)}</span>
        ),
      },
      {
        key: 'rating',
        header: t('index.rating'),
        width: '90px',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.rating,
        render: (row) => (
          <span className="text-poke-text-primary tabular-nums">
            {row.rating > 0
              ? formatter.number(row.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
              : '—'}
          </span>
        ),
      },
      {
        key: 'earliestGen',
        header: t('index.gen'),
        width: '70px',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.earliestGen,
        render: (row) => (
          <span className="text-poke-text-secondary text-xs">{row.earliestGen}</span>
        ),
      },
      {
        key: 'desc',
        header: t('index.description'),
        render: (row) => (
          <span className="text-poke-text-secondary text-sm line-clamp-2">
            {row.desc}
            {row.descFallback && <WikiDescFallbackTag className="ml-1.5" />}
          </span>
        ),
      },
    ],
    [t, dl, formatter],
  );

  const facets = useMemo<WikiIndexFacet<AbilityRow>[]>(
    () => [
      {
        key: 'generation',
        label: t('index.introducedIn'),
        options: GENERATIONS.map((g) => ({ value: g, label: t('index.genOption', { gen: g }) })),
        match: (row, selected) => selected.includes(String(row.earliestGen)),
      },
    ],
    [t],
  );

  return (
    <WikiIndexTable
      data={data}
      columns={columns}
      keyExtractor={(row) => row.name}
      searchPlaceholder={t('index.searchByDescription')}
      searchFn={searchFn}
      hrefFn={(row) => `/wiki/abilities/${encodeURIComponent(row.name)}`}
      facets={facets}
      defaultSort={{ key: 'name', direction: 'asc' }}
      sortColumns={['name', 'generation']}
    />
  );
}

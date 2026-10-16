'use client';

import { useCallback, useMemo } from 'react';
import WikiIndexTable, {
  type WikiIndexColumn,
  type WikiIndexFacet,
} from '@/components/wiki/WikiIndexTable';
import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
import { useDataLocale, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { itemSearchKeys, localizeItem } from '@/lib/pkmn/i18n/names/items';
import { foldForSearch, matchRank, NO_MATCH, type SearchKeys } from '@/lib/pkmn/i18n/search';
import {
  WIKI_ITEM_CATEGORIES,
  WIKI_ITEM_CATEGORY_KEYS,
  type WikiItemCategory,
} from '@/lib/wiki/item-category';

/**
 * One row as the server sends it: the English item name and category, plus the description already
 * localized for the viewer (`localizeDesc`, server-only); `descFallback` marks English text in German mode.
 */
export interface ItemRow {
  name: string;
  desc: string;
  descFallback: boolean;
  earliestGen: number;
  category: WikiItemCategory;
}

const GENERATIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

interface ItemSearchEntry {
  keys: SearchKeys;
  desc: string;
}

/**
 * Search entries per row object, built on first search. Keyed by the row, not the name: new rows (a language
 * switch re-localizes the descriptions) get fresh entries, and old ones are collected.
 */
const searchCache = new WeakMap<ItemRow, ItemSearchEntry>();

export default function ItemsIndexClient({ data }: { data: readonly ItemRow[] }) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();

  const searchFn = useCallback(
    (row: ItemRow, q: string) => {
      let entry = searchCache.get(row);
      if (!entry) {
        entry = { keys: itemSearchKeys(row.name), desc: foldForSearch(row.desc) };
        searchCache.set(row, entry);
      }
      const folded = foldForSearch(q);
      return matchRank(q, entry.keys) !== NO_MATCH || (folded !== '' && entry.desc.includes(folded));
    },
    [],
  );

  const categoryLabel = useCallback(
    (category: WikiItemCategory) => t(`itemCategory.${WIKI_ITEM_CATEGORY_KEYS[category]}`),
    [t],
  );

  const columns = useMemo<WikiIndexColumn<ItemRow>[]>(
    () => [
      {
        key: 'name',
        header: t('index.name'),
        width: '200px',
        sortable: true,
        sortValue: (row) => localizeItem(row.name, dl),
        render: (row) => (
          <span className="font-medium text-poke-text-primary">{localizeItem(row.name, dl)}</span>
        ),
      },
      {
        key: 'category',
        header: t('index.category'),
        width: '130px',
        sortable: true,
        sortValue: (row) => categoryLabel(row.category),
        render: (row) => (
          <span className="text-xs text-poke-text-secondary">{categoryLabel(row.category)}</span>
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
    [t, dl, categoryLabel],
  );

  const facets = useMemo<WikiIndexFacet<ItemRow>[]>(
    () => [
      {
        key: 'category',
        label: t('index.category'),
        options: WIKI_ITEM_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) })),
        match: (row, selected) => selected.includes(row.category),
      },
      {
        key: 'generation',
        label: t('index.generation'),
        options: GENERATIONS.map((g) => ({ value: g, label: t('index.genOption', { gen: g }) })),
        match: (row, selected) => selected.includes(String(row.earliestGen)),
      },
    ],
    [t, categoryLabel],
  );

  return (
    <WikiIndexTable
      data={data}
      columns={columns}
      keyExtractor={(row) => row.name}
      searchPlaceholder={t('index.searchByDescription')}
      searchFn={searchFn}
      hrefFn={(row) => `/wiki/items/${encodeURIComponent(row.name)}`}
      facets={facets}
      defaultSort={{ key: 'name', direction: 'asc' }}
      sortColumns={['name', 'category']}
    />
  );
}

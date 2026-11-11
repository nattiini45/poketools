'use client';

import { useCallback, useMemo } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import WikiIndexTable, {
  type WikiIndexColumn,
  type WikiIndexFacet,
} from '@/components/wiki/WikiIndexTable';
import { useDataLocale, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeStat, typeSearchKeys } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies, speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { matchRank, NO_MATCH, type SearchKeys } from '@/lib/pkmn/i18n/search';
import type { StatKey } from '@/lib/pkmn/i18n/types';
import { TYPES } from '@/lib/pkmn/type-chart';

/** One row as the server sends it: English `@pkmn` names and numbers only (locale-neutral). */
export interface PokemonRow {
  name: string;
  types: string[];
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  bst: number;
  earliestGen: number;
}

const GENERATIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const STAT_COLUMNS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/**
 * Search keys (English + German + transliteration) per species, built on first search, so a page view without
 * a search never folds 1,500 names. Locale-free, so one module cache serves every render.
 */
const keysCache = new Map<string, SearchKeys>();

export default function PokemonIndexClient({ data }: { data: readonly PokemonRow[] }) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();

  const searchFn = useCallback(
    (row: PokemonRow, q: string) => {
      let keys = keysCache.get(row.name);
      if (!keys) {
        keys = speciesSearchKeys(row.name);
        keysCache.set(row.name, keys);
      }
      return (
        matchRank(q, keys) !== NO_MATCH ||
        row.types.some((type) => matchRank(q, typeSearchKeys(type)) !== NO_MATCH)
      );
    },
    [],
  );

  const columns = useMemo<WikiIndexColumn<PokemonRow>[]>(
    () => [
      {
        key: 'name',
        primary: true,
        header: t('index.name'),
        width: '240px',
        sortable: true,
        cardClassName: 'max-md:order-1 max-md:col-span-4',
        sortValue: (row) => localizeSpecies(row.name, dl),
        render: (row) => (
          <span className="inline-flex items-center gap-3 align-middle">
            <PokemonSprite name={row.name} size={40} />
            <span>{localizeSpecies(row.name, dl)}</span>
          </span>
        ),
      },
      {
        key: 'types',
        header: t('index.types'),
        width: '180px',
        cardClassName: 'max-md:order-3 max-md:col-span-6',
        render: (row) => (
          <div className="flex gap-1">
            {row.types.map((type) => (
              <TypeBadge key={type} type={type} />
            ))}
          </div>
        ),
      },
      ...STAT_COLUMNS.map(
        (stat): WikiIndexColumn<PokemonRow> => ({
          key: stat,
          header: localizeStat(stat, dl, 'short'),
          align: 'right',
          width: '64px',
          sortable: true,
          numeric: true,
          cardLabel: 'above',
          cardClassName: 'max-md:order-4 max-md:text-center',
        }),
      ),
      {
        key: 'bst',
        header: t('index.bst'),
        align: 'right',
        width: '72px',
        sortable: true,
        cardLabel: 'inline',
        cardClassName: 'max-md:order-2 max-md:col-span-2 max-md:text-right',
        render: (row) => <span className="font-heading text-body tabular-nums text-fg">{row.bst}</span>,
      },
    ],
    [t, dl],
  );

  const facets = useMemo<WikiIndexFacet<PokemonRow>[]>(
    () => [
      {
        key: 'type',
        label: t('index.type'),
        options: TYPES.map((type) => ({
          value: type,
          render: () => <TypeBadge type={type} />,
        })),
        match: (row, selected) => row.types.some((type) => selected.includes(type)),
      },
      {
        key: 'generation',
        label: t('index.generation'),
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
      searchPlaceholder={t('index.searchPokemon')}
      searchFn={searchFn}
      hrefFn={(row) => `/pokemon/${encodeURIComponent(row.name)}`}
      facets={facets}
      defaultSort={{ key: 'name', direction: 'asc' }}
      sortColumns={['name', 'hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst']}
    />
  );
}

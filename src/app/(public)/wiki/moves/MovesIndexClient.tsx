'use client';

import { useCallback, useMemo } from 'react';
import TypeBadge from '@/components/shared/TypeBadge';
import WikiIndexTable, {
  type WikiIndexColumn,
  type WikiIndexFacet,
} from '@/components/wiki/WikiIndexTable';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeMoveCategory, localizeType, typeSearchKeys } from '@/lib/pkmn/i18n/names/misc';
import { localizeMove, moveSearchKeys } from '@/lib/pkmn/i18n/names/moves';
import { buildSearchKeys, matchRank, NO_MATCH, type SearchKeys } from '@/lib/pkmn/i18n/search';
import type { DataLocale, MoveCategory } from '@/lib/pkmn/i18n/types';
import { TYPES } from '@/lib/pkmn/type-chart';

/** One row as the server sends it: English `@pkmn` names and numbers only (locale-neutral). */
export interface MoveRow {
  name: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | null;
  pp: number;
  earliestGen: number;
}

/** The move categories as English `@pkmn` keys; labels come from the pkmn layer. */
const CATEGORIES: readonly MoveCategory[] = ['Physical', 'Special', 'Status'];

const CATEGORY_COLORS: Record<string, string> = {
  Physical: 'text-orange-400',
  Special: 'text-blue-400',
  Status: 'text-poke-text-secondary',
};

function isMoveCategory(value: string): value is MoveCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

function categoryLabel(category: string, dl: DataLocale): string {
  return isMoveCategory(category) ? localizeMoveCategory(category, dl) : category;
}

/** English + German keys of each category ("Physical" / "Physisch"). */
const CATEGORY_KEYS: ReadonlyMap<string, SearchKeys> = new Map(
  CATEGORIES.map((c) => [c, buildSearchKeys([c, localizeMoveCategory(c, 'de')])]),
);

/** Search keys per move name, built on first search (locale-free, so one module cache serves every render). */
const keysCache = new Map<string, SearchKeys>();

export default function MovesIndexClient({ data }: { data: readonly MoveRow[] }) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();

  const searchFn = useCallback(
    (row: MoveRow, q: string) => {
      let keys = keysCache.get(row.name);
      if (!keys) {
        keys = moveSearchKeys(row.name);
        keysCache.set(row.name, keys);
      }
      const categoryKeys = CATEGORY_KEYS.get(row.category);
      return (
        matchRank(q, keys) !== NO_MATCH ||
        matchRank(q, typeSearchKeys(row.type)) !== NO_MATCH ||
        (categoryKeys !== undefined && matchRank(q, categoryKeys) !== NO_MATCH)
      );
    },
    [],
  );

  const columns = useMemo<WikiIndexColumn<MoveRow>[]>(
    () => [
      {
        key: 'name',
        header: t('index.name'),
        width: '200px',
        sortable: true,
        sortValue: (row) => localizeMove(row.name, dl),
        render: (row) => (
          <span className="font-medium text-poke-text-primary">{localizeMove(row.name, dl)}</span>
        ),
      },
      {
        key: 'type',
        header: t('index.type'),
        width: '120px',
        sortable: true,
        sortValue: (row) => localizeType(row.type, dl),
        render: (row) => <TypeBadge type={row.type} />,
      },
      {
        key: 'category',
        header: t('index.category'),
        width: '100px',
        sortable: true,
        sortValue: (row) => categoryLabel(row.category, dl),
        render: (row) => (
          <span
            className={`font-heading text-xs font-semibold uppercase ${
              CATEGORY_COLORS[row.category] ?? ''
            }`}
          >
            {categoryLabel(row.category, dl)}
          </span>
        ),
      },
      {
        key: 'basePower',
        header: t('index.power'),
        align: 'right',
        width: '70px',
        sortable: true,
        sortValue: (row) => (row.basePower > 0 ? row.basePower : null),
        render: (row) => (
          <span className="text-poke-text-primary">{row.basePower || '—'}</span>
        ),
      },
      {
        key: 'accuracy',
        header: t('index.accuracy'),
        align: 'right',
        width: '70px',
        sortable: true,
        sortValue: (row) => row.accuracy,
        render: (row) => (
          <span className="text-poke-text-primary">
            {row.accuracy == null ? '—' : formatter.percentOf(row.accuracy, 0)}
          </span>
        ),
      },
      {
        key: 'pp',
        header: t('index.pp'),
        align: 'right',
        width: '60px',
        sortable: true,
        sortValue: (row) => row.pp,
        render: (row) => <span className="text-poke-text-primary">{row.pp}</span>,
      },
    ],
    [t, dl, formatter],
  );

  const facets = useMemo<WikiIndexFacet<MoveRow>[]>(
    () => [
      {
        key: 'type',
        label: t('index.type'),
        options: TYPES.map((type) => ({
          value: type,
          render: () => <TypeBadge type={type} />,
        })),
        match: (row, selected) => selected.includes(row.type),
      },
      {
        key: 'category',
        label: t('index.category'),
        options: CATEGORIES.map((c) => ({ value: c, label: localizeMoveCategory(c, dl) })),
        match: (row, selected) => selected.includes(row.category),
      },
    ],
    [t, dl],
  );

  return (
    <WikiIndexTable
      data={data}
      columns={columns}
      keyExtractor={(row) => row.name}
      searchPlaceholder={t('index.searchMoves')}
      searchFn={searchFn}
      hrefFn={(row) => `/wiki/moves/${encodeURIComponent(row.name)}`}
      facets={facets}
      defaultSort={{ key: 'name', direction: 'asc' }}
      sortColumns={['name', 'type', 'category', 'power', 'accuracy', 'pp', 'priority']}
    />
  );
}

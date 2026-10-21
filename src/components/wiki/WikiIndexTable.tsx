'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '@/components/ui/Input';
import Table, { TablePagination, type Column } from '@/components/ui/Table';
import { useDataLocale, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { compareWikiSortValues } from '@/lib/wiki/sort';
import {
  buildSortParam,
  cycleColumnSort,
  DEFAULT_TABLE_PAGE_SIZE,
  paginateArray,
  parseWikiSortParams,
  totalTablePages,
  type ColumnSortState,
  type TablePageSize,
} from '@/lib/ui/table-params';

const URL_WRITE_DEBOUNCE_MS = 150;

/** Sortable column extension over the shared Table column shape. */
export type WikiIndexColumn<T> = Column<T>;

export interface WikiIndexFacetOption {
  value: string;
  label?: string;
  /** Optional custom chip body (e.g. a `<TypeBadge />`). */
  render?: () => ReactNode;
}

export interface WikiIndexFacet<T> {
  /** URL param key (e.g. 'type', 'category', 'generation'). */
  key: string;
  /** Label shown above the chip group. */
  label: string;
  options: WikiIndexFacetOption[];
  /** Returns true if the row matches any of the selected values (OR within facet). */
  match: (row: T, selected: string[]) => boolean;
}

interface WikiIndexTableProps<T extends object> {
  data: readonly T[];
  columns: WikiIndexColumn<T>[];
  keyExtractor: (row: T, index: number) => string;
  /** Already-translated placeholder; defaults to the `wiki` namespace's "Search...". */
  searchPlaceholder?: string;
  /**
   * Row filter for a non-empty query (lower-cased). Pokémon-data names should match both languages: build the
   * keys with the pkmn layer's `pkmnSearchKeys` / `xSearchKeys` and test them with `matchRank`.
   */
  searchFn: (row: T, query: string) => boolean;
  hrefFn: (row: T) => string;
  facets?: WikiIndexFacet<T>[];
  /** Default sort when URL has no sort param (null = unsorted). */
  defaultSort?: ColumnSortState | null;
  /** Valid sort column keys for URL parsing. */
  sortColumns: readonly string[];
}

function parseFacetsFromUrl(
  searchParams: URLSearchParams,
  facets: WikiIndexFacet<unknown>[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of facets) {
    const v = searchParams.get(f.key);
    out[f.key] = v ? v.split(',').filter(Boolean) : [];
  }
  return out;
}

function parseWikiSortFromUrl(
  searchParams: URLSearchParams,
  sortColumns: readonly string[],
  defaultSort: ColumnSortState | null,
): ColumnSortState | null {
  return parseWikiSortParams(
    searchParams.get('sort'),
    searchParams.get('dir'),
    sortColumns,
    defaultSort,
  );
}

export default function WikiIndexTable<T extends object>({
  data,
  columns,
  keyExtractor,
  searchPlaceholder,
  searchFn,
  hrefFn,
  facets = [],
  defaultSort = null,
  sortColumns,
}: WikiIndexTableProps<T>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT(wikiMessages);
  const dataLocale = useDataLocale();

  const facetsForParse = facets as unknown as WikiIndexFacet<unknown>[];

  const [query, setQuery] = useState<string>(() => searchParams.get('q') ?? '');
  const [page, setPage] = useState<number>(() => {
    const raw = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return Number.isFinite(raw) && raw >= 1 ? raw : 1;
  });
  const [perPage, setPerPage] = useState<TablePageSize>(() => {
    const raw = Number.parseInt(searchParams.get('perPage') ?? '', 10);
    return raw === 50 || raw === 100 ? raw : DEFAULT_TABLE_PAGE_SIZE;
  });
  const [sort, setSort] = useState<ColumnSortState | null>(() =>
    parseWikiSortFromUrl(searchParams, sortColumns, defaultSort),
  );
  const [selectedFacets, setSelectedFacets] = useState<Record<string, string[]>>(() =>
    parseFacetsFromUrl(searchParams, facetsForParse),
  );

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
    const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
    setPage(Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1);
    const rawPerPage = Number.parseInt(searchParams.get('perPage') ?? '', 10);
    setPerPage(rawPerPage === 50 || rawPerPage === 100 ? rawPerPage : DEFAULT_TABLE_PAGE_SIZE);
    setSort(parseWikiSortFromUrl(searchParams, sortColumns, defaultSort));
    setSelectedFacets(parseFacetsFromUrl(searchParams, facetsForParse));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const writeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (writeRef.current) clearTimeout(writeRef.current);
    writeRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) params.set('q', query);
      else params.delete('q');
      if (page > 1) params.set('page', String(page));
      else params.delete('page');
      if (perPage !== DEFAULT_TABLE_PAGE_SIZE) params.set('perPage', String(perPage));
      else params.delete('perPage');
      if (sort) params.set('sort', buildSortParam(sort.key, sort.direction));
      else params.delete('sort');
      params.delete('dir');
      for (const f of facets) {
        const vals = selectedFacets[f.key] ?? [];
        if (vals.length > 0) params.set(f.key, vals.join(','));
        else params.delete(f.key);
      }
      const target = params.toString();
      if (target === searchParams.toString()) return;
      router.replace(target ? `?${target}` : '?', { scroll: false });
    }, URL_WRITE_DEBOUNCE_MS);
    return () => {
      if (writeRef.current) clearTimeout(writeRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page, perPage, sort, selectedFacets, router, searchParams]);

  const filtered = useMemo(() => {
    let rows: readonly T[] = data;
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((row) => searchFn(row, q));
    }
    for (const f of facets) {
      const sel = selectedFacets[f.key] ?? [];
      if (sel.length > 0) rows = rows.filter((row) => f.match(row, sel));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const extract =
        col?.sortValue ??
        ((row: T) =>
          (row as Record<string, unknown>)[sort.key] as string | number | null | undefined);
      const direction = sort.direction === 'asc' ? 1 : -1;
      // Strings (display names, localized labels) collate for the viewer's data locale.
      rows = [...rows].sort(
        (a, b) => compareWikiSortValues(extract(a), extract(b), dataLocale) * direction,
      );
    }
    return [...rows];
  }, [data, query, searchFn, facets, selectedFacets, sort, columns, dataLocale]);

  const totalPages = totalTablePages(filtered.length, perPage);
  const safePage = Math.min(page, totalPages);
  const pageData = paginateArray(filtered, safePage, perPage);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  const toggleFacetValue = (facetKey: string, value: string) => {
    setSelectedFacets((prev) => {
      const current = prev[facetKey] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [facetKey]: next };
    });
    setPage(1);
  };

  const handleSort = (colKey: string) => {
    setSort((prev) => cycleColumnSort(prev, colKey));
    setPage(1);
  };

  const hasAnyFacetSelected = facets.some((f) => (selectedFacets[f.key] ?? []).length > 0);
  const isFiltered = Boolean(query) || hasAnyFacetSelected || Boolean(sort);

  const clearAll = () => {
    setQuery('');
    setSelectedFacets(Object.fromEntries(facets.map((f) => [f.key, [] as string[]])));
    setSort(defaultSort);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder={searchPlaceholder ?? t('index.search')}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
          />
        </div>
        {isFiltered && (
          <button
            type="button"
            onClick={clearAll}
            className="self-start sm:self-end text-xs text-poke-text-muted hover:text-poke-text-primary underline"
          >
            {t('index.clearFilters')}
          </button>
        )}
      </div>

      {facets.length > 0 && (
        <div className="space-y-3 rounded-poke-lg border border-poke-border bg-poke-surface p-3">
          {facets.map((facet) => {
            const selected = selectedFacets[facet.key] ?? [];
            return (
              <div key={facet.key}>
                <div className="text-[11px] font-heading font-semibold uppercase text-poke-text-muted mb-1.5">
                  {facet.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {facet.options.map((opt) => {
                    const isSelected = selected.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleFacetValue(facet.key, opt.value)}
                        aria-pressed={isSelected}
                        className={`
                          rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-poke-border-focus
                          ${isSelected ? 'ring-2 ring-poke-accent shadow-poke-sm' : 'opacity-55 hover:opacity-100'}
                        `}
                      >
                        {opt.render ? (
                          opt.render()
                        ) : (
                          <span
                            className={`
                              inline-block px-2.5 py-0.5 text-xs font-heading font-semibold uppercase rounded-full
                              ${isSelected
                                ? 'bg-poke-accent text-poke-surface'
                                : 'bg-poke-elevated text-poke-text-secondary'}
                            `}
                          >
                            {opt.label ?? opt.value}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TablePagination
        page={safePage}
        totalPages={totalPages}
        perPage={perPage}
        totalItems={filtered.length}
        onPageChange={setPage}
        onPerPageChange={(size) => {
          setPerPage(size);
          setPage(1);
        }}
      />

      <Table
        columns={columns}
        data={pageData}
        keyExtractor={keyExtractor}
        emptyMessage={t('index.noMatches')}
        clientEngine={false}
        sort={sort}
        onSort={handleSort}
        hidePagination
        onRowClick={(row) => router.push(hrefFn(row))}
      />

      <TablePagination
        page={safePage}
        totalPages={totalPages}
        perPage={perPage}
        totalItems={filtered.length}
        onPageChange={setPage}
        onPerPageChange={(size) => {
          setPerPage(size);
          setPage(1);
        }}
        className="justify-end"
      />
    </div>
  );
}

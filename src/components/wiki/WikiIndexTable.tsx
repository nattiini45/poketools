'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, SlidersHorizontal } from 'lucide-react';
import BottomSheet from '@/components/shared/BottomSheet';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ItemIcon from '@/components/ui/ItemIcon';
import Select from '@/components/ui/Select';
import SkewChip from '@/components/ui/SkewChip';
import { TablePagination, type Column } from '@/components/ui/Table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/fluid/table';
import { cn } from '@/lib/utils/cn';
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

/**
 * Sortable column extension over the shared Table column shape. The `primary` column (the first one when none is
 * flagged) holds the row's link: its content becomes the anchor text.
 */
export type WikiIndexColumn<T> = Column<T> & {
  primary?: boolean;
  /**
   * Below 768 px a row is a card on a six-column grid: the cell's span, order and alignment there
   * (`max-md:` classes). Without it the cell takes a full line.
   */
  cardClassName?: string;
  /** On the card, show the column header with the value: above it (number columns) or before it. */
  cardLabel?: 'above' | 'inline';
  /** Set the cell in Geist Mono with tabular figures (pure number columns). */
  numeric?: boolean;
};

/** The row's only focusable element; its `::after` covers the row so a click anywhere on it opens the entry. */
const ROW_LINK_CLASS =
  'font-[550] text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0 after:z-10 after:content-[""]';

// `isolate` makes the row its own stacking context: the link's `z-10` then stays inside the row (the sticky header and
// popovers are not covered) and still paints above positioned cell content such as a type badge. Below 768 px the row
// is a card: a six-column grid its cells place themselves on (`cardClassName`).
const ROW_CLASS =
  'isolate border-hairline last:border-b-0 max-md:grid max-md:grid-cols-6 max-md:items-center max-md:gap-x-2 max-md:gap-y-2 max-md:px-4 max-md:py-3';

const ALIGN_CLASS = { left: 'text-left', center: 'md:text-center', right: 'md:text-right' } as const;

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring';

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

  const linkedColumns = useMemo(() => {
    const primaryKey = (columns.find((c) => c.primary) ?? columns[0])?.key;
    return columns.map((col): WikiIndexColumn<T> => {
      if (col.key !== primaryKey) return col;
      return {
        ...col,
        render: (row, index) => (
          <Link href={hrefFn(row)} className={ROW_LINK_CLASS}>
            {col.render ? col.render(row, index) : ((row as Record<string, unknown>)[col.key] as ReactNode)}
          </Link>
        ),
      };
    });
  }, [columns, hrefFn]);

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

  const activeFacetCount = facets.reduce((sum, f) => sum + (selectedFacets[f.key] ?? []).length, 0);
  const sortChanged = sort?.key !== defaultSort?.key || sort?.direction !== defaultSort?.direction;
  const isFiltered = Boolean(query) || activeFacetCount > 0 || sortChanged;
  const [sheetOpen, setSheetOpen] = useState(false);

  const clearAll = () => {
    setQuery('');
    setSelectedFacets(Object.fromEntries(facets.map((f) => [f.key, [] as string[]])));
    setSort(defaultSort);
    setPage(1);
  };

  const sortableColumns = columns.filter((col) => col.sortable);

  const facetGroups = (touch: boolean) =>
    facets.map((facet) => {
      const selected = selectedFacets[facet.key] ?? [];
      return (
        <div
          key={facet.key}
          role="group"
          aria-label={facet.label}
          className={touch ? 'flex flex-col gap-2' : 'grid grid-cols-[7.5rem_1fr] items-start gap-3'}
        >
          <div className={cn('text-caption font-[550] text-fg-muted', !touch && 'pt-1.5')}>{facet.label}</div>
          <div className={cn('flex flex-wrap', touch ? 'gap-x-2 gap-y-1' : 'gap-1.5')}>
            {facet.options.map((opt) => {
              const isSelected = selected.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleFacetValue(facet.key, opt.value)}
                  aria-pressed={isSelected}
                  className={cn(
                    'inline-flex items-center justify-center rounded-full transition-opacity duration-80',
                    FOCUS_RING,
                    touch ? 'min-h-11 min-w-11' : 'min-h-8',
                    opt.render && isSelected && '[&>*]:outline-2 [&>*]:outline-offset-2 [&>*]:outline-accent-ink',
                    opt.render && !isSelected && selected.length > 0 && 'opacity-60 hover:opacity-100',
                  )}
                >
                  {opt.render ? (
                    opt.render()
                  ) : (
                    <SkewChip tone={isSelected ? 'tier-1' : 'neutral'} className="px-3 py-1.5">
                      {opt.label ?? opt.value}
                    </SkewChip>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      );
    });

  const pagination = (className?: string) => (
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
      className={className}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56 md:max-w-sm">
          <Input
            type="search"
            aria-label={searchPlaceholder ?? t('index.search')}
            placeholder={searchPlaceholder ?? t('index.search')}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          className="min-h-11 md:hidden"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {t('index.filters')}
          {activeFacetCount > 0 && (
            <SkewChip tone="tier-1">
              <span aria-hidden="true">{activeFacetCount}</span>
              <span className="sr-only">{t('index.filtersActive', { count: activeFacetCount })}</span>
            </SkewChip>
          )}
        </Button>
        {isFiltered && (
          <Button variant="ghost" className="max-md:min-h-11" onClick={clearAll}>
            {t('index.clearFilters')}
          </Button>
        )}
      </div>

      {facets.length > 0 && (
        <div className="hidden flex-col gap-3 rounded-poke-lg border border-hairline bg-surface p-4 md:flex">
          {facetGroups(false)}
        </div>
      )}

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('index.filters')}>
        <div className="flex flex-col gap-5 p-4">
          {sortableColumns.length > 0 && (
            <Select
              label={t('index.sortBy')}
              value={sort ? buildSortParam(sort.key, sort.direction) : ''}
              onChange={(event) => {
                const [key, direction] = event.target.value.split('-');
                if (direction !== 'asc' && direction !== 'desc') return;
                setSort({ key, direction });
                setPage(1);
              }}
              className="h-11"
            >
              {sortableColumns.flatMap((col) =>
                (['asc', 'desc'] as const).map((direction) => (
                  <option key={col.key + direction} value={buildSortParam(col.key, direction)}>
                    {t(direction === 'asc' ? 'index.sortAsc' : 'index.sortDesc', { column: col.header })}
                  </option>
                )),
              )}
            </Select>
          )}
          {facetGroups(true)}
          <Button className="min-h-11 w-full" onClick={() => setSheetOpen(false)}>
            {t('index.showResults', { count: filtered.length })}
          </Button>
        </div>
      </BottomSheet>

      {pagination()}

      <div className="overflow-hidden rounded-poke-lg border border-hairline bg-surface md:overflow-x-auto">
        <Table className="text-body max-md:block">
          <TableHeader className="max-md:hidden">
            <TableRow className="border-hairline bg-elevated">
              {linkedColumns.map((col) => {
                const align = col.align ?? 'left';
                const isActive = col.sortable && sort?.key === col.key;
                const SortIcon = !isActive ? ArrowUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <TableHead
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={
                      col.sortable ? (isActive ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined
                    }
                    className={cn('py-2.5 text-caption font-[550] text-fg-muted', ALIGN_CLASS[align])}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-poke-sm hover:text-fg',
                          FOCUS_RING,
                          align === 'right' && 'flex-row-reverse',
                          isActive && 'text-accent-ink hover:text-accent-ink',
                        )}
                      >
                        <span>{col.header}</span>
                        <SortIcon className={cn('h-3.5 w-3.5 shrink-0', !isActive && 'opacity-60')} aria-hidden="true" />
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block">
            {pageData.length === 0 ? (
              <tr className="max-md:block">
                <td colSpan={linkedColumns.length} className="max-md:block">
                  <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                    <ItemIcon item="poke-doll" size={72} />
                    <p className="font-heading text-title text-fg">{t('index.noMatches')}</p>
                    <p className="text-body text-fg-muted">{t('index.noMatchesHint')}</p>
                    {isFiltered && (
                      <Button variant="secondary" className="mt-2 max-md:min-h-11" onClick={clearAll}>
                        {t('index.clearFilters')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              pageData.map((row, i) => {
                return (
                  <TableRow key={keyExtractor(row, i)} index={i} className={ROW_CLASS}>
                    {linkedColumns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={cn(
                          'py-2 align-middle max-md:block max-md:p-0',
                          ALIGN_CLASS[col.align ?? 'left'],
                          col.numeric && 'font-mono tabular-nums text-fg',
                          col.cardClassName ?? 'max-md:col-span-6',
                        )}
                      >
                        {col.cardLabel && (
                          <span
                            className={cn(
                              'font-body text-micro text-fg-muted md:hidden',
                              col.cardLabel === 'above' ? 'block' : 'mr-1.5',
                            )}
                          >
                            {col.header}
                          </span>
                        )}
                        {col.render ? col.render(row, i) : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {pagination('justify-end')}
    </div>
  );
}

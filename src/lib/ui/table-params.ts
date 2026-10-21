export const TABLE_PAGE_SIZES = [20, 50, 100] as const;
export type TablePageSize = (typeof TABLE_PAGE_SIZES)[number];
export const DEFAULT_TABLE_PAGE_SIZE: TablePageSize = 20;

export interface ParsedTableParams {
  page: number;
  perPage: TablePageSize;
}

export function parseTableParams(
  params: Record<string, string | undefined>,
): ParsedTableParams {
  const rawPage = Number.parseInt(params.page ?? '', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawPerPage = Number.parseInt(params.perPage ?? '', 10);
  const perPage = TABLE_PAGE_SIZES.includes(rawPerPage as TablePageSize)
    ? (rawPerPage as TablePageSize)
    : DEFAULT_TABLE_PAGE_SIZE;

  return { page, perPage };
}

export function paginateArray<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

export function totalTablePages(totalItems: number, perPage: number): number {
  return Math.max(1, Math.ceil(totalItems / perPage));
}

export type SortDirection = 'asc' | 'desc';

export interface ColumnSortState {
  key: string;
  direction: SortDirection;
}

/** Client-side 3-state sort cycle: asc → desc → none */
export function cycleColumnSort(
  current: ColumnSortState | null,
  columnKey: string,
): ColumnSortState | null {
  if (!current || current.key !== columnKey) {
    return { key: columnKey, direction: 'asc' };
  }
  if (current.direction === 'asc') {
    return { key: columnKey, direction: 'desc' };
  }
  return null;
}

/** Build a sort URL param value like `date-desc` from column + direction. */
export function buildSortParam(column: string, direction: SortDirection): string {
  return `${column}-${direction}`;
}

/** Parse a compound sort param like `date-desc` into column + direction. */
export function parseSortParam(
  value: string | undefined,
  validColumns: readonly string[],
  fallback: { column: string; direction: SortDirection },
): ColumnSortState {
  if (!value) return { key: fallback.column, direction: fallback.direction };
  const match = /^(.+)-(asc|desc)$/.exec(value);
  if (!match) return { key: fallback.column, direction: fallback.direction };
  const [, column, direction] = match;
  if (!validColumns.includes(column)) {
    return { key: fallback.column, direction: fallback.direction };
  }
  return { key: column, direction: direction as SortDirection };
}

/** Compare two sort accessor values for client-side table sorting. */
export function compareSortValues(a: unknown, b: unknown): number {
  const aNullish = a === null || a === undefined;
  const bNullish = b === null || b === undefined;
  if (aNullish && bNullish) return 0;
  if (aNullish) return 1;
  if (bNullish) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    const aFinite = Number.isFinite(a);
    const bFinite = Number.isFinite(b);
    if (!aFinite && !bFinite) return 0;
    if (!aFinite) return 1;
    if (!bFinite) return -1;
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Parse table sort from URL. Accepts `sort=name-asc` and the legacy wiki pair
 * `sort=name&dir=asc`.
 */
export function parseWikiSortParams(
  sort: string | null | undefined,
  dir: string | null | undefined,
  validColumns: readonly string[],
  fallback: ColumnSortState | null,
): ColumnSortState | null {
  if (!sort) return fallback;
  const fallbackColumn = fallback?.key ?? validColumns[0] ?? 'name';
  const fallbackDirection = fallback?.direction ?? 'asc';

  if (validColumns.includes(sort)) {
    const direction: SortDirection =
      dir === 'desc' || dir === 'asc' ? dir : fallbackDirection;
    return { key: sort, direction };
  }

  return parseSortParam(sort, validColumns, {
    column: fallbackColumn,
    direction: fallbackDirection,
  });
}

/** Next sort param in asc → desc → none cycle for server GET links. */
export function nextSortParam(
  current: ColumnSortState | null,
  column: string,
): string | undefined {
  const next = cycleColumnSort(current?.key === column ? current : null, column);
  if (!next) return undefined;
  return buildSortParam(next.key, next.direction);
}

'use client';

import { useMemo, useState } from 'react';
import {
  compareSortValues,
  cycleColumnSort,
  DEFAULT_TABLE_PAGE_SIZE,
  paginateArray,
  totalTablePages,
  type ColumnSortState,
  type TablePageSize,
} from '@/lib/ui/table-params';

export interface ClientTableSortConfig<T> {
  key: string;
  accessor: (row: T) => string | number | null | undefined;
}

export function useClientTable<T>(
  rows: T[],
  sortConfigs: ClientTableSortConfig<T>[],
  defaultSort: ColumnSortState | null = null,
) {
  const [sort, setSort] = useState<ColumnSortState | null>(defaultSort);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<TablePageSize>(DEFAULT_TABLE_PAGE_SIZE);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const config = sortConfigs.find((c) => c.key === sort.key);
    if (!config) return rows;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort(
      (a, b) => compareSortValues(config.accessor(a), config.accessor(b)) * direction,
    );
  }, [rows, sort, sortConfigs]);

  const totalPages = totalTablePages(sortedRows.length, perPage);
  const safePage = Math.min(page, totalPages);
  const pageRows = paginateArray(sortedRows, safePage, perPage);

  function handleSort(column: string) {
    setSort((prev) => cycleColumnSort(prev, column));
    setPage(1);
  }

  function handlePerPageChange(size: TablePageSize) {
    setPerPage(size);
    setPage(1);
  }

  return {
    sort,
    page: safePage,
    perPage,
    totalPages,
    totalItems: sortedRows.length,
    pageRows,
    handleSort,
    setPage,
    handlePerPageChange,
  };
}

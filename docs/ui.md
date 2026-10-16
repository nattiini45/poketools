# UI Tables Module

## Overview
The UI Tables module provides the shared primitives for client-side table sorting and pagination (`src/lib/ui`): pure helpers for parsing/building table URL params and sort state, plus a React hook that wires them into a sortable, paginated client table. Shared so sort/pagination semantics (page sizes, 3-state sort cycle, comparator rules) don't drift between surfaces.

## File Structure
```
src/lib/ui/
├── table-params.ts  # Pure table param/sort helpers (page sizes, sort cycle, comparator)
└── use-client-table.ts  # Client-side sortable + paginated table hook
```

## Core Functions/Classes

### Table Params
- **File**: `table-params.ts`
- **Purpose**: Pure helpers shared by server-rendered and client tables
- **Key Exports**:
  - `TABLE_PAGE_SIZES` (`[20, 50, 100]`) and `DEFAULT_TABLE_PAGE_SIZE` (`20`)
  - `parseTableParams(params)` — clamps `page` to ≥ 1 and `perPage` to the allowed page sizes
  - `paginateArray(items, page, perPage)` / `totalTablePages(totalItems, perPage)` — slicing and page-count math (always ≥ 1 page)
  - `cycleColumnSort(current, columnKey)` — 3-state sort cycle: asc → desc → none; switching columns starts fresh asc
  - `buildSortParam(column, direction)` / `parseSortParam(value, validColumns, fallback)` — compound `date-desc`-style sort URL params with fallback on invalid values
  - `compareSortValues(a, b)` — nullish-safe comparator: nullish last, numbers numeric (non-finite sent to the end without `NaN`), strings locale-aware
  - `parseWikiSortParams(sort, dir, validColumns, fallback)` — accepts the legacy wiki pair `sort=name&dir=asc` alongside compound params
  - `nextSortParam(current, column)` — next sort param in the asc → desc → none cycle for server GET links

### useClientTable
- **File**: `use-client-table.ts`
- **Purpose**: `'use client'` hook composing the table-params helpers into client-side state
- **Signature**: `useClientTable<T>(rows, sortConfigs, defaultSort?)` with `ClientTableSortConfig<T>` = `{ key, accessor }` per sortable column
- **Returns**: `sort`, `page` (safe-clamped to `totalPages`), `perPage`, `totalPages`, `totalItems`, `pageRows`, `handleSort(column)` (resets to page 1), `setPage`, `handlePerPageChange(size)` (resets to page 1)
- **Behavior**: unknown sort keys leave rows unsorted; changing page size or sorting resets to page 1

## Data Flows
- **Input**: Raw rows, sort configs, optional default sort
- **Processing**: Sort via accessors + `compareSortValues`, paginate the sorted array, clamp the active page
- **Output**: Current page rows plus sort/pagination state and handlers

## Dependencies
- **External Libraries**: `react` (`use-client-table.ts` only)
- **Internal Modules**: None — pure module consumed by feature components

## Usage Examples

```typescript
import { useClientTable } from '@/lib/ui/use-client-table';

const table = useClientTable(
  rows,
  [{ key: 'name', accessor: (row) => row.name }],
  { key: 'name', direction: 'asc' },
);
```

## Testing
- **Test Files**: `src/lib/ui/__tests__/table-params.test.ts` — `parseTableParams` defaults/clamping, `cycleColumnSort` 3-state cycle, `parseSortParam`/`buildSortParam`, `nextSortParam` server-link parity, `compareSortValues` nullish/NaN ordering, `paginateArray`, `totalTablePages`; `src/lib/ui/__tests__/use-client-table.test.ts` — the hook's sort-then-paginate composition over the pure helpers (no renderer)
- **Testing Approach**: Unit tests for both files; feature tables (`src/components/ui/Table.tsx`, wiki and replay lists) cover the wiring

## Related Modules
- Consumed by table-bearing features: `src/components/ui/Table.tsx` (`useClientTable`), `src/components/wiki/WikiIndexTable.tsx`, `/replays` and the player dashboard
- [Design](./design.md) — the `src/components/ui/*` primitives
- [Utils](./utils.md) — `cn()` and the other shared helpers

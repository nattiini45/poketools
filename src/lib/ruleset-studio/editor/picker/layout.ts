/**
 * The picker's geometry, as pure functions: how many columns fit, how tall a row is, how the filtered list is cut into
 * visual rows (group headers span the full width, entries are chunked by the column count), and where the arrow keys go
 * in that grid. The virtualizer draws these rows; nothing here touches the DOM.
 */
import type { CatalogKind } from '@/lib/pkmn/catalog-index';
import type { HeaderItem, ViewItem } from './view';

/** `grid`: cards with art; `compact`: one dense line per entry; `table`: the plain paginated table (no virtualization). */
export const DENSITIES = ['grid', 'compact', 'table'] as const;
export type Density = (typeof DENSITIES)[number];

export function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);
}

/** Gap between cards, in pixels. */
export const GAP = 8;

/**
 * Height of a group header row, and of one row of each kind and density, in pixels (the gap is not included). A card is
 * as tall as its content at the app's 18px root size: border, padding, the tallest top block (a 60px icon, or the name,
 * the facts and two description lines) and the footer with the state chip and the 32px toggle. A row any shorter clips
 * the footer of the card instead of fitting it (`EntryOption` is `h-full` and `overflow-hidden`).
 */
export const HEADER_HEIGHT = 36;
const ROW_HEIGHT: Record<Exclude<Density, 'table'>, Record<CatalogKind, number>> = {
  grid: { species: 116, moves: 136, items: 136, abilities: 116 },
  compact: { species: 44, moves: 44, items: 44, abilities: 44 },
};
const MIN_WIDTH: Record<Exclude<Density, 'table'>, Record<CatalogKind, number>> = {
  grid: { species: 232, moves: 280, items: 232, abilities: 240 },
  compact: { species: 280, moves: 300, items: 280, abilities: 280 },
};
const MAX_COLUMNS = 8;

/** The height of an entry row in pixels. The table density has no fixed height (it is not virtualized). */
export function rowHeightFor(kind: CatalogKind, density: Density): number {
  return density === 'table' ? 44 : ROW_HEIGHT[density][kind];
}

/** How many columns fit in `width` pixels (at least one; the table density is always one). */
export function columnsFor(width: number, kind: CatalogKind, density: Density): number {
  if (density === 'table' || !Number.isFinite(width) || width <= 0) return 1;
  const min = MIN_WIDTH[density][kind];
  return Math.min(MAX_COLUMNS, Math.max(1, Math.floor((width + GAP) / (min + GAP))));
}

/** Padding of the list box on each side, and the gap between columns, in pixels (`EntryList` draws them). */
const LIST_PADDING = 8;

/** How much a compact row can show: `tight` only the name and two icons, `cozy` adds the state's words and the button's label, `roomy` also the facts. */
export type Room = 'tight' | 'cozy' | 'roomy';
const COZY_FROM = 360;
const ROOMY_FROM = 560;

/** The width of one cell of the list, from the width of the picker and its column count. */
export function cellWidthOf(width: number, columns: number): number {
  const cols = Math.max(1, Math.floor(columns));
  return Math.max(0, (width - 2 * LIST_PADDING - GAP * (cols - 1)) / cols);
}

/** What a compact row of this width shows. An unmeasured (0) width reads as tight: the row never overflows before it is known. */
export function roomFor(cellWidth: number): Room {
  if (cellWidth >= ROOMY_FROM) return 'roomy';
  return cellWidth >= COZY_FROM ? 'cozy' : 'tight';
}

/** The density a fresh visit starts in: compact on a narrow screen or for a long list, the table when motion/contrast is reduced. */
export function defaultDensity(options: { width: number; resultCount: number; reducedMotion: boolean; moreContrast: boolean }): Density {
  if (options.reducedMotion || options.moreContrast) return 'table';
  if (options.width < 768 || options.resultCount > 400) return 'compact';
  return 'grid';
}

// ── Rows ─────────────────────────────────────────────────────────────────────────

export type GridRow =
  | { kind: 'header'; header: HeaderItem }
  /** `start` is the index of the row's first entry in the flat entry order; `count` how many entries the row holds. */
  | { kind: 'cells'; start: number; count: number };

/** Cuts the view items into visual rows: a header is a row of its own, entries fill rows of `columns` between headers. */
export function buildRows(items: readonly ViewItem[], columns: number): GridRow[] {
  const rows: GridRow[] = [];
  const width = Math.max(1, Math.floor(columns));
  let entryIndex = 0;
  let open: { kind: 'cells'; start: number; count: number } | null = null;
  for (const item of items) {
    if (item.kind === 'header') {
      open = null;
      rows.push({ kind: 'header', header: item });
      continue;
    }
    if (open === null || open.count >= width) {
      open = { kind: 'cells', start: entryIndex, count: 0 };
      rows.push(open);
    }
    open.count += 1;
    entryIndex += 1;
  }
  return rows;
}

/** The row index and column of every entry (by flat index). */
export interface Position {
  row: number;
  col: number;
}

export function positionsOf(rows: readonly GridRow[]): Position[] {
  const out: Position[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.kind !== 'cells') return;
    for (let col = 0; col < row.count; col += 1) out[row.start + col] = { row: rowIndex, col };
  });
  return out;
}

/** The estimated pixel height of a row for the virtualizer (cards plus the gap below). */
export function estimateRowSize(row: GridRow, kind: CatalogKind, density: Density): number {
  return (row.kind === 'header' ? HEADER_HEIGHT : rowHeightFor(kind, density)) + GAP;
}

// ── Arrow-key movement ───────────────────────────────────────────────────────────

export type Move = 'left' | 'right' | 'up' | 'down' | 'page_up' | 'page_down' | 'row_start' | 'row_end' | 'first' | 'last';

/**
 * The entry index an arrow key moves to from `from`. Left and right walk the flat order (they wrap across rows), up and
 * down keep the column (clamped to a shorter row) and step over group headers, a page is `pageRows` rows. The result is
 * always a valid entry index, or -1 when there are no entries.
 */
export function moveIndex(rows: readonly GridRow[], positions: readonly Position[], from: number, move: Move, pageRows: number): number {
  const count = positions.length;
  if (count === 0) return -1;
  const current = Math.min(Math.max(from, 0), count - 1);
  switch (move) {
    case 'first': return 0;
    case 'last': return count - 1;
    case 'left': return Math.max(0, current - 1);
    case 'right': return Math.min(count - 1, current + 1);
    case 'row_start': {
      const row = rows[positions[current].row];
      return row.kind === 'cells' ? row.start : current;
    }
    case 'row_end': {
      const row = rows[positions[current].row];
      return row.kind === 'cells' ? row.start + row.count - 1 : current;
    }
    default: {
      const steps = move === 'up' ? -1 : move === 'down' ? 1 : move === 'page_up' ? -Math.max(1, pageRows) : Math.max(1, pageRows);
      return moveRows(rows, positions, current, steps);
    }
  }
}

/** Moves by `steps` entry rows (headers do not count), keeping the column; stops at the first and last row. */
function moveRows(rows: readonly GridRow[], positions: readonly Position[], current: number, steps: number): number {
  const { row: fromRow, col } = positions[current];
  const direction = steps < 0 ? -1 : 1;
  let remaining = Math.abs(steps);
  let target = fromRow;
  for (let i = fromRow + direction; i >= 0 && i < rows.length && remaining > 0; i += direction) {
    if (rows[i].kind === 'cells') {
      target = i;
      remaining -= 1;
    }
  }
  if (target === fromRow) return current;
  const row = rows[target];
  if (row.kind !== 'cells') return current;
  return row.start + Math.min(col, row.count - 1);
}

// ── Pages (the table density) ───────────────────────────────────────────────────

export const TABLE_PAGE_SIZE = 50;

export function pageCount(total: number, pageSize = TABLE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The slice bounds of a 1-based page, clamped to the existing pages. */
export function pageBounds(total: number, page: number, pageSize = TABLE_PAGE_SIZE): { page: number; start: number; end: number } {
  const clamped = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount(total, pageSize));
  const start = (clamped - 1) * pageSize;
  return { page: clamped, start, end: Math.min(total, start + pageSize) };
}

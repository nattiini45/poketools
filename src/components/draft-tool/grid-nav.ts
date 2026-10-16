/**
 * Two-dimensional keyboard navigation for the roster wall (draft-frontend
 * §5.5, §5.9). Pure: the geometry algorithm of the old arena grid
 * (`FighterGrid.tsx`), extracted so the roving tabindex can be tested
 * without a DOM.
 *
 * Tiles are ordered by their layout position (top, then left). Rows are
 * tiles that share a `top`. Up/Down keep the column within the row, clamped
 * to the neighbouring row's length, which also handles the skewed and
 * ragged last rows of the wall.
 */

export interface GridTile {
  id: string;
  /** Layout position in px (`offsetTop` / `offsetLeft`). */
  top: number;
  left: number;
}

export const GRID_NAV_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

/** Rows whose tops differ by less than this many px count as one row (sub-pixel layout). */
const ROW_TOLERANCE_PX = 2;

function sameRow(a: number, b: number): boolean {
  return Math.abs(a - b) < ROW_TOLERANCE_PX;
}

/**
 * The index (into `tiles`, as passed) of the tile that `key` moves to from
 * `currentId`. Returns -1 when the key is not a navigation key or there are
 * no tiles. An unknown or null `currentId` starts from the first tile in
 * layout order, so a hidden pinned card falls back to the first card.
 * At an edge the current index is returned (no wrap).
 */
export function nextIndexForKey(tiles: readonly GridTile[], currentId: string | null, key: string): number {
  if (!GRID_NAV_KEYS.has(key) || tiles.length === 0) return -1;

  const ordered = tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => (sameRow(a.tile.top, b.tile.top) ? a.tile.left - b.tile.left : a.tile.top - b.tile.top));

  const found = currentId === null ? -1 : ordered.findIndex((o) => o.tile.id === currentId);
  const pos = Math.max(0, found);
  if (found === -1 && key !== 'Home' && key !== 'End') return ordered[0].index;

  switch (key) {
    case 'Home':
      return ordered[0].index;
    case 'End':
      return ordered[ordered.length - 1].index;
    case 'ArrowLeft':
      return ordered[Math.max(0, pos - 1)].index;
    case 'ArrowRight':
      return ordered[Math.min(ordered.length - 1, pos + 1)].index;
    default: {
      const current = ordered[pos].tile;
      const row = ordered.filter((o) => sameRow(o.tile.top, current.top));
      const column = row.findIndex((o) => o.tile.id === current.id);
      const neighbourTop =
        key === 'ArrowUp'
          ? [...ordered].reverse().find((o) => o.tile.top < current.top && !sameRow(o.tile.top, current.top))?.tile.top
          : ordered.find((o) => o.tile.top > current.top && !sameRow(o.tile.top, current.top))?.tile.top;
      if (neighbourTop === undefined) return ordered[pos].index;
      const neighbourRow = ordered.filter((o) => sameRow(o.tile.top, neighbourTop));
      return neighbourRow[Math.min(column, neighbourRow.length - 1)].index;
    }
  }
}

import { describe, expect, it } from 'vitest';
import {
  TABLE_PAGE_SIZE,
  buildRows,
  cellWidthOf,
  columnsFor,
  roomFor,
  defaultDensity,
  moveIndex,
  pageBounds,
  pageCount,
  positionsOf,
  rowHeightFor,
} from '../../../editor/picker/layout';
import {
  EMPTY_SELECTION,
  hiddenCount,
  selectAll,
  selectRange,
  toggleSelected,
} from '../../../editor/picker/selection';
import { clampActive, reduceKey, targetsOf, type KeyInput, type NavContext, type NavState } from '../../../editor/picker/keyboard';
import type { HeaderItem, ViewItem } from '../../../editor/picker/view';
import { speciesIndex } from './fixtures';

const header = (group: string, count: number): HeaderItem => ({ kind: 'header', key: `group:${group}`, group, count });
const entry = (id: string): ViewItem => ({ kind: 'entry', entry: speciesIndex().byId.get(id) ?? speciesIndex().entries[0], state: 'legal' });

// Two groups: 5 entries then 3, in a 3-column grid.
const items: ViewItem[] = [
  header('A', 5),
  ...['charizard', 'charmander', 'garchomp', 'koraidon', 'pikachu'].map(entry),
  header('B', 3),
  ...['rattata', 'rattataalola', 'charizardmegax'].map(entry),
];

describe('columns and rows', () => {
  it('fits as many minimum-width cards as the width allows, at least one, never more than eight', () => {
    expect(columnsFor(0, 'species', 'grid')).toBe(1);
    expect(columnsFor(300, 'species', 'grid')).toBe(1);
    expect(columnsFor(1000, 'species', 'grid')).toBe(4);
    expect(columnsFor(5000, 'species', 'grid')).toBe(8);
    expect(columnsFor(5000, 'species', 'table')).toBe(1);
    expect(columnsFor(Number.NaN, 'species', 'grid')).toBe(1);
  });

  it('tells a compact row how much room its cell has, from the picker width and the column count', () => {
    // 684px of picker, two compact columns: (684 - 16 padding - 8 gap) / 2 = 330px each.
    expect(columnsFor(684, 'species', 'compact')).toBe(2);
    expect(cellWidthOf(684, 2)).toBe(330);
    expect(roomFor(330)).toBe('tight');
    expect(roomFor(360)).toBe('cozy');
    expect(roomFor(559)).toBe('cozy');
    expect(roomFor(560)).toBe('roomy');
    // Not measured yet: the safe, smallest layout.
    expect(roomFor(cellWidthOf(0, 1))).toBe('tight');
    expect(cellWidthOf(100, 0)).toBe(84);
  });

  it('has a row height per kind and density', () => {
    expect(rowHeightFor('species', 'grid')).toBe(116);
    expect(rowHeightFor('moves', 'grid')).toBe(136);
    expect(rowHeightFor('items', 'grid')).toBe(136);
    expect(rowHeightFor('abilities', 'grid')).toBe(116);
    expect(rowHeightFor('species', 'compact')).toBe(44);
  });

  it('starts in the table when motion or contrast is reduced, compact on a phone or for a long list', () => {
    expect(defaultDensity({ width: 1400, resultCount: 100, reducedMotion: true, moreContrast: false })).toBe('table');
    expect(defaultDensity({ width: 1400, resultCount: 100, reducedMotion: false, moreContrast: true })).toBe('table');
    expect(defaultDensity({ width: 400, resultCount: 100, reducedMotion: false, moreContrast: false })).toBe('compact');
    expect(defaultDensity({ width: 1400, resultCount: 901, reducedMotion: false, moreContrast: false })).toBe('compact');
    expect(defaultDensity({ width: 1400, resultCount: 100, reducedMotion: false, moreContrast: false })).toBe('grid');
  });

  it('cuts entries into rows between headers, a header being a row of its own', () => {
    const rows = buildRows(items, 3);
    expect(rows.map((r) => (r.kind === 'header' ? 'H' : `${r.start}+${r.count}`))).toEqual(['H', '0+3', '3+2', 'H', '5+3']);
    expect(positionsOf(rows)[4]).toEqual({ row: 2, col: 1 });
    expect(buildRows([], 3)).toEqual([]);
    expect(buildRows(items, 0).filter((r) => r.kind === 'cells')).toHaveLength(8);
  });
});

describe('moving in the grid', () => {
  const rows = buildRows(items, 3);
  const positions = positionsOf(rows);
  const go = (from: number, move: Parameters<typeof moveIndex>[3], page = 2) => moveIndex(rows, positions, from, move, page);

  it('left and right walk the flat order and stop at the ends', () => {
    expect(go(0, 'left')).toBe(0);
    expect(go(2, 'right')).toBe(3);
    expect(go(7, 'right')).toBe(7);
  });

  it('up and down keep the column, clamp to a shorter row and step over headers', () => {
    expect(go(1, 'down')).toBe(4);
    expect(go(4, 'down')).toBe(6);
    expect(go(4, 'up')).toBe(1);
    expect(go(1, 'up')).toBe(1);
    expect(go(7, 'down')).toBe(7);
  });

  it('home and end go to the row bounds, first and last to the list bounds, a page moves several rows', () => {
    expect(go(4, 'row_start')).toBe(3);
    expect(go(3, 'row_end')).toBe(4);
    expect(go(4, 'first')).toBe(0);
    expect(go(4, 'last')).toBe(7);
    expect(go(0, 'page_down', 1)).toBe(3);
    expect(go(0, 'page_down', 2)).toBe(5);
    expect(go(0, 'page_down', 99)).toBe(5);
    expect(go(6, 'page_up', 99)).toBe(1);
  });

  it('has nowhere to go in an empty list', () => {
    expect(moveIndex([], [], 0, 'down', 3)).toBe(-1);
  });
});

describe('the table pages', () => {
  it('counts and clamps pages', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(TABLE_PAGE_SIZE)).toBe(1);
    expect(pageCount(TABLE_PAGE_SIZE + 1)).toBe(2);
    expect(pageBounds(120, 3)).toEqual({ page: 3, start: 100, end: 120 });
    expect(pageBounds(120, 99)).toEqual({ page: 3, start: 100, end: 120 });
    expect(pageBounds(120, -4)).toEqual({ page: 1, start: 0, end: 50 });
  });
});

describe('selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('toggles an id and makes it the anchor', () => {
    const one = toggleSelected(EMPTY_SELECTION, 'b');
    expect([...one.ids]).toEqual(['b']);
    expect(one.anchor).toBe('b');
    expect(toggleSelected(one, 'b').ids.size).toBe(0);
  });

  it('selects a range from the anchor in either direction, replacing the selection', () => {
    const start = toggleSelected(EMPTY_SELECTION, 'b');
    expect([...selectRange(start, order, 'd').ids]).toEqual(['b', 'c', 'd']);
    expect([...selectRange(start, order, 'a').ids].sort()).toEqual(['a', 'b']);
    const second = selectRange(toggleSelected(start, 'e'), order, 'c');
    expect([...second.ids].sort()).toEqual(['c', 'd', 'e']);
    expect(selectRange(start, order, 'zz')).toBe(start);
    expect([...selectRange(EMPTY_SELECTION, order, 'c').ids]).toEqual(['c']);
  });

  it('selects all, and counts what a filter hides', () => {
    const all = selectAll(order);
    expect(all.ids.size).toBe(5);
    expect(hiddenCount(all, new Set(['a', 'b']))).toBe(3);
  });
});

describe('the key reducer', () => {
  const rows = buildRows(items, 3);
  const order = items.filter((i) => i.kind === 'entry').map((i) => (i.kind === 'entry' ? i.entry.id : ''));
  const ctx: NavContext = { rows, positions: positionsOf(rows), order, pageRows: 2, allowlist: false, hasQuery: false };
  const nav = (active: number, ids: string[] = []): NavState => ({ active, selection: { ids: new Set(ids), anchor: ids[0] ?? null } });
  const key = (k: string, patch: Partial<KeyInput> = {}): KeyInput => ({ key: k, shift: false, ctrl: false, alt: false, ...patch });

  it('moves with the arrows, Home, End and the page keys', () => {
    expect(reduceKey(nav(1), key('ArrowRight'), ctx).nav.active).toBe(2);
    expect(reduceKey(nav(1), key('ArrowDown'), ctx).nav.active).toBe(4);
    expect(reduceKey(nav(4), key('Home'), ctx).nav.active).toBe(3);
    expect(reduceKey(nav(3), key('End'), ctx).nav.active).toBe(4);
    expect(reduceKey(nav(4), key('Home', { ctrl: true }), ctx).nav.active).toBe(0);
    expect(reduceKey(nav(0), key('End', { ctrl: true }), ctx).nav.active).toBe(7);
    expect(reduceKey(nav(0), key('PageDown'), ctx).nav.active).toBe(5);
    expect(reduceKey(nav(0), key('ArrowDown'), ctx).handled).toBe(true);
  });

  it('extends the selection from the anchor with Shift', () => {
    const first = reduceKey(nav(1), key('ArrowRight', { shift: true }), ctx);
    expect([...first.nav.selection.ids]).toEqual(['charmander', 'garchomp']);
    const second = reduceKey(first.nav, key('ArrowRight', { shift: true }), ctx);
    expect([...second.nav.selection.ids]).toEqual(['charmander', 'garchomp', 'koraidon']);
    const back = reduceKey(second.nav, key('ArrowLeft', { shift: true }), ctx);
    expect([...back.nav.selection.ids]).toEqual(['charmander', 'garchomp']);
  });

  it('toggles the active entry with Space and selects everything with Ctrl+A', () => {
    expect([...reduceKey(nav(2), key(' '), ctx).nav.selection.ids]).toEqual(['garchomp']);
    expect(reduceKey(nav(2, ['garchomp']), key(' '), ctx).nav.selection.ids.size).toBe(0);
    expect(reduceKey(nav(2), key('a', { ctrl: true }), ctx).nav.selection.ids.size).toBe(8);
  });

  it('turns Enter and B into a toggle of the selection, or of the active entry when nothing is selected', () => {
    expect(reduceKey(nav(2), key('Enter'), ctx).command).toEqual({ type: 'toggle', ids: ['garchomp'] });
    expect(reduceKey(nav(2, ['charizard', 'koraidon']), key('B'), ctx).command).toEqual({ type: 'toggle', ids: ['charizard', 'koraidon'] });
    expect(reduceKey(nav(2), key('u'), ctx).command).toEqual({ type: 'unban', ids: ['garchomp'] });
    expect(reduceKey(nav(2), key('r'), ctx).command).toEqual({ type: 'reset', ids: ['garchomp'] });
    expect(targetsOf(nav(9), order)).toEqual([]);
  });

  it('acts on the last shown entry when the list shrank below the active index', () => {
    const shrunk = ['a', 'b', 'c'];
    const small: NavContext = { ...ctx, order: shrunk };
    expect(clampActive(50, 3)).toBe(2);
    expect(clampActive(1, 3)).toBe(1);
    expect(clampActive(-1, 3)).toBe(-1);
    expect(clampActive(7, 0)).toBe(-1);
    expect(reduceKey(nav(50), key('Enter'), small).command).toEqual({ type: 'toggle', ids: ['c'] });
    expect(reduceKey(nav(50), key('u'), small).command).toEqual({ type: 'unban', ids: ['c'] });
    expect([...reduceKey(nav(50), key(' '), small).nav.selection.ids]).toEqual(['c']);
  });

  it('A adds to the allowlist only in allowlist mode', () => {
    expect(reduceKey(nav(2), key('a'), ctx).handled).toBe(false);
    expect(reduceKey(nav(2), key('a'), { ...ctx, allowlist: true }).command).toEqual({ type: 'allow', ids: ['garchomp'] });
  });

  it('Escape clears the selection, then the search, then is left alone', () => {
    const cleared = reduceKey(nav(2, ['garchomp']), key('Escape'), { ...ctx, hasQuery: true });
    expect(cleared.nav.selection.ids.size).toBe(0);
    expect(cleared.command).toBeNull();
    expect(reduceKey(nav(2), key('Escape'), { ...ctx, hasQuery: true }).command).toEqual({ type: 'clear_search' });
    const idle = reduceKey(nav(2), key('Escape'), ctx);
    expect(idle.handled).toBe(false);
  });

  it('slash focuses the search, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo', () => {
    expect(reduceKey(nav(0), key('/'), ctx).command).toEqual({ type: 'focus_search' });
    expect(reduceKey(nav(0), key('z', { ctrl: true }), ctx).command).toEqual({ type: 'undo' });
    expect(reduceKey(nav(0), key('Z', { ctrl: true, shift: true }), ctx).command).toEqual({ type: 'redo' });
    expect(reduceKey(nav(0), key('y', { ctrl: true }), ctx).command).toEqual({ type: 'redo' });
  });

  it('never traps the keyboard: Tab, plain letters and Alt combinations are not handled', () => {
    for (const k of [key('Tab'), key('x'), key('ArrowDown', { alt: true }), key('c', { ctrl: true })]) {
      expect(reduceKey(nav(2), k, ctx).handled, k.key).toBe(false);
    }
  });

  it('survives an empty list', () => {
    const empty: NavContext = { ...ctx, rows: [], positions: [], order: [] };
    expect(reduceKey(nav(-1), key('ArrowDown'), empty).nav.active).toBe(-1);
    expect(reduceKey(nav(-1), key('Enter'), empty).command).toBeNull();
    expect(reduceKey(nav(-1), key(' '), empty).handled).toBe(true);
  });
});

/**
 * The picker's keyboard model as one pure reducer: a key press and the current navigation state go in, the next state and
 * (at most) one command for the editor come out. The component only forwards `keydown` and runs the command; every rule
 * below is tested without a DOM.
 *
 * Focus stays on the listbox container and `aria-activedescendant` names the active option, which is the pattern that
 * survives virtualization (the active row may be unmounted while it scrolls). Keys:
 *
 *   Arrows            move the active entry (left and right walk the flat order, up and down keep the column)
 *   Home / End        first / last entry of the row; Ctrl+Home / Ctrl+End: first / last entry of the list
 *   PageUp / PageDown move by a viewport of rows
 *   Shift + movement  extend the selection from the anchor to the new active entry
 *   Space             toggle the active entry in the selection
 *   Ctrl+A            select the whole filtered result
 *   Enter or B        toggle ban on the selection (or the active entry when nothing is selected)
 *   U / R / A         unban, reset to the preset, add to the allowlist (A only in allowlist mode)
 *   Escape            clear the selection; then the search
 *   /                 focus the search box
 *   Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y   undo, redo
 *
 * No key traps focus: Tab always leaves the list and Escape with nothing to clear is not handled, so a dialog around the
 * picker can close on it.
 */
import { moveIndex, type GridRow, type Move, type Position } from './layout';
import { clearSelection, selectAll, selectRange, toggleSelected, type SelectionState } from './selection';

export interface KeyInput {
  key: string;
  shift: boolean;
  /** Ctrl or Cmd. */
  ctrl: boolean;
  alt: boolean;
}

export interface NavState {
  /** Flat index of the active entry; -1 when the list is empty. */
  active: number;
  selection: SelectionState;
}

export interface NavContext {
  rows: readonly GridRow[];
  positions: readonly Position[];
  /** The ids of the entries in display order. */
  order: readonly string[];
  /** Rows per viewport, for PageUp / PageDown. */
  pageRows: number;
  /** The category is an allowlist (A adds to it). */
  allowlist: boolean;
  /** The search box has text (Escape clears it after the selection). */
  hasQuery: boolean;
}

export type PickerCommand =
  | { type: 'toggle'; ids: string[] }
  | { type: 'unban'; ids: string[] }
  | { type: 'reset'; ids: string[] }
  | { type: 'allow'; ids: string[] }
  | { type: 'focus_search' }
  | { type: 'clear_search' }
  | { type: 'undo' }
  | { type: 'redo' };

export interface KeyResult {
  nav: NavState;
  command: PickerCommand | null;
  /** The key was used: the component calls `preventDefault`. */
  handled: boolean;
}

const MOVES: Record<string, Move> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  PageUp: 'page_up',
  PageDown: 'page_down',
  Home: 'row_start',
  End: 'row_end',
};

const unhandled = (nav: NavState): KeyResult => ({ nav, command: null, handled: false });
const handled = (nav: NavState, command: PickerCommand | null = null): KeyResult => ({ nav, command, handled: true });

/**
 * The active index kept inside a list that may have shrunk since it was set (a search narrowed the result): the last
 * entry when it points past the end, -1 for an empty list. The component renders and the reducer acts on the same entry.
 */
export function clampActive(active: number, count: number): number {
  return count === 0 ? -1 : Math.min(active, count - 1);
}

/** The ids a command acts on: the selection when there is one, else the active entry. */
export function targetsOf(nav: NavState, order: readonly string[]): string[] {
  if (nav.selection.ids.size > 0) return [...nav.selection.ids];
  const active = order[nav.active];
  return active === undefined ? [] : [active];
}

export function reduceKey(state: NavState, input: KeyInput, ctx: NavContext): KeyResult {
  const nav: NavState = { ...state, active: clampActive(state.active, ctx.order.length) };
  const { key } = input;
  const letter = key.length === 1 ? key.toLowerCase() : key;

  if (input.ctrl && !input.alt) {
    if (letter === 'a') return handled({ ...nav, selection: selectAll(ctx.order) });
    if (letter === 'z') return handled(nav, { type: input.shift ? 'redo' : 'undo' });
    if (letter === 'y') return handled(nav, { type: 'redo' });
    if (key === 'Home' || key === 'End') {
      const target = moveIndex(ctx.rows, ctx.positions, nav.active, key === 'Home' ? 'first' : 'last', ctx.pageRows);
      return handled(moveTo(nav, target, input.shift, ctx));
    }
    return unhandled(nav);
  }
  if (input.alt) return unhandled(nav);

  const move = MOVES[key];
  if (move !== undefined) {
    if (ctx.order.length === 0) return handled(nav);
    return handled(moveTo(nav, moveIndex(ctx.rows, ctx.positions, nav.active, move, ctx.pageRows), input.shift, ctx));
  }

  if (key === ' ') {
    const id = ctx.order[nav.active];
    return handled(id === undefined ? nav : { ...nav, selection: toggleSelected(nav.selection, id) });
  }
  if (key === 'Enter' || letter === 'b') {
    const ids = targetsOf(nav, ctx.order);
    return ids.length === 0 ? handled(nav) : handled(nav, { type: 'toggle', ids });
  }
  if (letter === 'u') {
    const ids = targetsOf(nav, ctx.order);
    return ids.length === 0 ? handled(nav) : handled(nav, { type: 'unban', ids });
  }
  if (letter === 'r') {
    const ids = targetsOf(nav, ctx.order);
    return ids.length === 0 ? handled(nav) : handled(nav, { type: 'reset', ids });
  }
  if (letter === 'a' && ctx.allowlist) {
    const ids = targetsOf(nav, ctx.order);
    return ids.length === 0 ? handled(nav) : handled(nav, { type: 'allow', ids });
  }
  if (key === 'Escape') {
    if (nav.selection.ids.size > 0) return handled({ ...nav, selection: clearSelection() });
    if (ctx.hasQuery) return handled(nav, { type: 'clear_search' });
    return unhandled(nav);
  }
  if (key === '/') return handled(nav, { type: 'focus_search' });
  return unhandled(nav);
}

/** Moves the active entry; with Shift the selection becomes the range from the anchor to the new entry. */
function moveTo(nav: NavState, target: number, extend: boolean, ctx: NavContext): NavState {
  if (target < 0) return nav;
  if (!extend) return { ...nav, active: target };
  const fromId = ctx.order[nav.active];
  const toId = ctx.order[target];
  if (toId === undefined) return { ...nav, active: target };
  // The first Shift-move pivots on the entry the move starts from.
  const seeded: SelectionState = nav.selection.anchor === null && fromId !== undefined ? { ...nav.selection, anchor: fromId } : nav.selection;
  return { active: target, selection: selectRange(seeded, ctx.order, toId) };
}

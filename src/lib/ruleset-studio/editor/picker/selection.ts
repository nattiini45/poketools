/**
 * The picker's multi-selection: a set of entry ids plus the anchor a Shift range starts from. Pure and immutable.
 *
 * The selection is by id, not by position, so it survives a filter or sort change: the author can select every Fire type,
 * narrow the view to something else, and the earlier selection is still there (the bulk bar says how many are hidden).
 */
export interface SelectionState {
  ids: ReadonlySet<string>;
  /** The entry a Shift range extends from: the last one toggled or clicked. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), anchor: null };

export function isSelected(selection: SelectionState, id: string): boolean {
  return selection.ids.has(id);
}

/** Adds the id if it is not selected, removes it if it is; it becomes the anchor. */
export function toggleSelected(selection: SelectionState, id: string): SelectionState {
  const ids = new Set(selection.ids);
  if (!ids.delete(id)) ids.add(id);
  return { ids, anchor: id };
}

/** Selects only this entry (a plain click on an unselected entry in selection mode). */
export function selectOnly(id: string): SelectionState {
  return { ids: new Set([id]), anchor: id };
}

/**
 * Selects the range between the anchor and `id` in `order` (the visible entries), added to what is selected when `extend`
 * is true (Ctrl+Shift), else replacing it. Without a usable anchor it selects `id` alone. The anchor stays, so the next
 * Shift click pivots on the same entry.
 */
export function selectRange(selection: SelectionState, order: readonly string[], id: string, extend = false): SelectionState {
  const to = order.indexOf(id);
  const from = selection.anchor === null ? -1 : order.indexOf(selection.anchor);
  if (to === -1) return selection;
  if (from === -1) return { ids: new Set(extend ? [...selection.ids, id] : [id]), anchor: id };
  const [low, high] = from <= to ? [from, to] : [to, from];
  const ids = new Set(extend ? selection.ids : []);
  for (let i = low; i <= high; i += 1) ids.add(order[i]);
  return { ids, anchor: selection.anchor };
}

/** Selects every id given (the filtered result). */
export function selectAll(order: readonly string[]): SelectionState {
  return { ids: new Set(order), anchor: order[0] ?? null };
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

/** How many selected ids are not in the current view (a filter hides them). */
export function hiddenCount(selection: SelectionState, visible: ReadonlySet<string>): number {
  let hidden = 0;
  for (const id of selection.ids) if (!visible.has(id)) hidden += 1;
  return hidden;
}

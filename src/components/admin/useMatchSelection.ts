'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  effectiveSelection,
  pageSelectionState,
  toggleMatchSelection,
  togglePageSelection,
} from '@/lib/admin/match-bulk';

const NONE: ReadonlySet<string> = new Set();

interface SelectionState {
  /** The list request the ids were chosen on (every filter, the sort and the page). */
  key: string;
  ids: ReadonlySet<string>;
}

/**
 * The row selection of the admin match list. It belongs to one list request: `selectionKey` is the request's query
 * (it carries every filter, the sort and the page), and a selection made under another key is gone. What the page
 * reports is always derived: the stored ids that are on the current page, in page order. A stale id (a reload that
 * dropped the row, a page still loading) is therefore never selected, and no effect has to reset anything.
 */
export function useMatchSelection({ selectionKey, pageIds }: { selectionKey: string; pageIds: readonly string[] }) {
  const [state, setState] = useState<SelectionState>({ key: selectionKey, ids: NONE });
  // Another request: drop the old ids during render (so A -> B -> A does not bring them back).
  if (state.key !== selectionKey) setState({ key: selectionKey, ids: NONE });

  const stored = state.key === selectionKey ? state.ids : NONE;
  const selected = useMemo(() => effectiveSelection(stored, pageIds), [stored, pageIds]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const pageState = useMemo(() => pageSelectionState(pageIds, selectedSet), [pageIds, selectedSet]);

  // Updates start from what is selected on this page, so ids that are no longer on it are dropped on the first change.
  const toggle = useCallback(
    (id: string) => setState({ key: selectionKey, ids: toggleMatchSelection(selectedSet, id) }),
    [selectionKey, selectedSet],
  );
  const togglePage = useCallback(
    () => setState({ key: selectionKey, ids: togglePageSelection(selectedSet, pageIds) }),
    [selectionKey, selectedSet, pageIds],
  );
  const clear = useCallback(() => setState({ key: selectionKey, ids: NONE }), [selectionKey]);
  /** Keeps just these ids (the ones a bulk action did not finish), drops the rest. */
  const keepOnly = useCallback(
    (ids: readonly string[]) => setState({ key: selectionKey, ids: new Set(ids) }),
    [selectionKey],
  );
  const isSelected = useCallback((id: string) => selectedSet.has(id), [selectedSet]);

  return { selected, count: selected.length, isSelected, toggle, togglePage, pageState, clear, keepOnly };
}

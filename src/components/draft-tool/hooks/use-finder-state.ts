'use client';

/**
 * Finder view state (draft-frontend §5.1, FR-2): a client reducer, no URL
 * sync. Per-viewer preferences (stage mode, sort, show drafted) persist in
 * `localStorage['draft:prefs:v1']`; the pinned line in
 * `sessionStorage['draft:pinned:<pool>']`. Storage is read after mount (the
 * server markup uses the defaults) and every access goes through
 * `storage.ts`, so the screen works without storage.
 */
import { useEffect, useReducer, useRef, type Dispatch } from 'react';
import { initialFinderState, type FinderAction, type FinderViewState, type SortKey, type StageMode } from '@/lib/draft-finder/filter-types';
import { finderReducer } from '@/lib/draft-finder/reducer';
import { readPinned, readPrefs, writePinned, writePrefs } from '@/lib/draft-ui/storage';

const STAGE_MODES: readonly StageMode[] = ['same_stage', 'anywhere'];
const SORTS: readonly SortKey[] = ['default', 'alpha', 'favorites', 'spe', 'atk', 'def', 'spa', 'spd', 'bst'];

export interface StoredPrefs {
  stageMode?: StageMode;
  sort?: SortKey;
  showDrafted?: boolean;
}

/** Validates the stored preference blob; unknown or malformed fields are dropped. */
export function parsePrefs(raw: unknown): StoredPrefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const prefs: StoredPrefs = {};
  if (typeof r.stageMode === 'string' && (STAGE_MODES as readonly string[]).includes(r.stageMode)) {
    prefs.stageMode = r.stageMode as StageMode;
  }
  if (typeof r.sort === 'string' && (SORTS as readonly string[]).includes(r.sort)) prefs.sort = r.sort as SortKey;
  if (typeof r.showDrafted === 'boolean') prefs.showDrafted = r.showDrafted;
  return prefs;
}

export function useFinderState(poolId: string): [FinderViewState, Dispatch<FinderAction>] {
  const [view, dispatch] = useReducer(finderReducer, undefined, () => initialFinderState());
  // false during the mount pass, so the persist effects never write the defaults over stored prefs.
  const hydrated = useRef(false);

  // Restore after mount (hydration-safe).
  useEffect(() => {
    // Also covers StrictMode's second mount pass and a pool change.
    hydrated.current = false;
    const prefs = parsePrefs(readPrefs());
    if (prefs.stageMode) dispatch({ type: 'setStageMode', mode: prefs.stageMode });
    if (prefs.sort) dispatch({ type: 'setSort', sort: prefs.sort });
    if (prefs.showDrafted !== undefined) dispatch({ type: 'setShowDrafted', on: prefs.showDrafted });
    const pinned = readPinned(poolId);
    if (pinned) dispatch({ type: 'pin', lineId: pinned });
  }, [poolId]);

  useEffect(() => {
    if (!hydrated.current) return;
    writePrefs({ stageMode: view.stageMode, sort: view.sort, showDrafted: view.showDrafted });
  }, [view.stageMode, view.sort, view.showDrafted]);

  useEffect(() => {
    if (!hydrated.current) return;
    writePinned(poolId, view.pinnedLineId);
  }, [poolId, view.pinnedLineId]);

  // Declared last: runs after the persist effects of the mount pass.
  useEffect(() => {
    hydrated.current = true;
  }, [poolId]);

  return [view, dispatch];
}

'use client';

/**
 * Finder view state (draft-frontend §5.1, FR-2): a client reducer, no URL
 * sync. Per-viewer preferences (stage mode, sort, sort stage, show drafted, and
 * the weakness overview's stage) persist in `localStorage['draft:prefs:v1']`;
 * the pinned line in `sessionStorage['draft:pinned:<pool>']`. Storage is read
 * after mount (the server markup uses the defaults) and every access goes
 * through `storage.ts`, so the screen works without storage.
 *
 * The weakness stage is a preference of the weakness overview, not part of the
 * finder view (it does not change the wall), so it has its own hook
 * (`use-weakness-stage.ts`). Both merge into the same blob (`updatePrefs`).
 */
import { useEffect, useReducer, useRef, type Dispatch } from 'react';
import {
  initialFinderState,
  SORT_KEYS,
  SORT_STAGES,
  STAGE_MODES,
  type FinderAction,
  type FinderViewState,
  type SortKey,
  type SortStage,
  type StageMode,
} from '@/lib/draft-finder/filter-types';
import { finderReducer } from '@/lib/draft-finder/reducer';
import { readPinned, readPrefs, updatePrefs, writePinned } from '@/lib/draft-ui/storage';

export interface StoredPrefs {
  stageMode?: StageMode;
  sort?: SortKey;
  sortStage?: SortStage;
  showDrafted?: boolean;
  weaknessStage?: SortStage;
}

/** `value` when it is one of the `allowed` strings, else undefined. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' ? allowed.find((a) => a === value) : undefined;
}

/**
 * Validates the stored preference blob; unknown or malformed fields are dropped. A field missing from an
 * older blob stays absent, so the default applies (`sortStage` and `weaknessStage` default to 'final').
 */
export function parsePrefs(raw: unknown): StoredPrefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const prefs: StoredPrefs = {};
  const stageMode = oneOf(STAGE_MODES, r.stageMode);
  if (stageMode) prefs.stageMode = stageMode;
  const sort = oneOf(SORT_KEYS, r.sort);
  if (sort) prefs.sort = sort;
  const sortStage = oneOf(SORT_STAGES, r.sortStage);
  if (sortStage) prefs.sortStage = sortStage;
  if (typeof r.showDrafted === 'boolean') prefs.showDrafted = r.showDrafted;
  const weaknessStage = oneOf(SORT_STAGES, r.weaknessStage);
  if (weaknessStage) prefs.weaknessStage = weaknessStage;
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
    if (prefs.sortStage) dispatch({ type: 'setSortStage', stage: prefs.sortStage });
    if (prefs.showDrafted !== undefined) dispatch({ type: 'setShowDrafted', on: prefs.showDrafted });
    const pinned = readPinned(poolId);
    if (pinned) dispatch({ type: 'pin', lineId: pinned });
  }, [poolId]);

  useEffect(() => {
    if (!hydrated.current) return;
    updatePrefs({ stageMode: view.stageMode, sort: view.sort, sortStage: view.sortStage, showDrafted: view.showDrafted });
  }, [view.stageMode, view.sort, view.sortStage, view.showDrafted]);

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

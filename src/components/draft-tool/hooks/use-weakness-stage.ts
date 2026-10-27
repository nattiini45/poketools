'use client';

/**
 * The stage (`base` or `final`) the team weakness overview reads: a per-viewer preference stored in the shared
 * preference blob (`draft:prefs:v1`, merged by `updatePrefs`, so it never overwrites the finder's own fields).
 *
 * It is an external store: `useSyncExternalStore` renders the default ('final') on the server and while
 * hydrating, then reads the stored choice, so the restore needs no effect. A choice storage refused (blocked or
 * full) still holds for this page view.
 */
import { useSyncExternalStore } from 'react';
import type { SortStage } from '@/lib/draft-finder/filter-types';
import { readPrefs, updatePrefs } from '@/lib/draft-ui/storage';
import { parsePrefs } from './use-finder-state';

export const DEFAULT_WEAKNESS_STAGE: SortStage = 'final';

const listeners = new Set<() => void>();
/** A choice storage could not keep; wins over the stored value until a write succeeds. */
let unsaved: SortStage | null = null;

export function readWeaknessStage(): SortStage {
  return unsaved ?? parsePrefs(readPrefs()).weaknessStage ?? DEFAULT_WEAKNESS_STAGE;
}

export function storeWeaknessStage(stage: SortStage): void {
  unsaved = updatePrefs({ weaknessStage: stage }) ? null : stage;
  for (const listener of listeners) listener();
}

/** Also follows the choice made in another tab (`storage` events fire there only). */
export function subscribeWeaknessStage(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

const serverStage = (): SortStage => DEFAULT_WEAKNESS_STAGE;

/** `[stage, setStage]` for the weakness overview's Base | Final switch. */
export function useWeaknessStage(): [SortStage, (stage: SortStage) => void] {
  return [useSyncExternalStore(subscribeWeaknessStage, readWeaknessStage, serverStage), storeWeaknessStage];
}

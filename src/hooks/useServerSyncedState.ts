'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';

/** The local copy of a server value plus the server value it was last synced from. */
export interface ServerSyncedState<T> {
  /** The server value (prop) the local copy last took over. */
  seen: T;
  /** What the control shows: the server value, or the user's unsaved/optimistic edit. */
  local: T;
}

/**
 * The next state of a control that edits a server value: when the server value
 * (prop) differs from the one last seen and the control is not `hold`ing (a save
 * in flight, a draft open), the local copy takes over the new server value.
 * Returns `state` itself when nothing changes.
 */
export function syncFromServer<T>(state: ServerSyncedState<T>, serverValue: T, hold: boolean): ServerSyncedState<T> {
  if (hold || Object.is(state.seen, serverValue)) return state;
  return { seen: serverValue, local: serverValue };
}

/**
 * `useState` seeded from a server prop that follows the prop afterwards. An admin
 * control keeps an optimistic local copy while it saves, then `router.refresh()`
 * hands it the persisted value as a new prop: without this the control would keep
 * whatever its first render was given (a remount after a collapse showed the old
 * value). While `hold` is true (a save in flight, an open draft) a changed prop
 * waits, and is taken over on the first render after `hold` clears.
 *
 * Uses React's "adjust state while rendering" pattern, not an effect, so the
 * control never paints the stale value first.
 */
export function useServerSyncedState<T>(serverValue: T, hold: boolean): [T, Dispatch<SetStateAction<T>>] {
  const [local, setLocal] = useState<T>(serverValue);
  const [seen, setSeen] = useState<T>(serverValue);
  const next = syncFromServer({ seen, local }, serverValue, hold);
  if (next.seen !== seen) {
    setSeen(next.seen);
    setLocal(next.local);
  }
  return [next.local, setLocal];
}

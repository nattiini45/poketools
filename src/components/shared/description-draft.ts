/**
 * The unsaved draft of an `EditableDescription`, kept in the tab's
 * sessionStorage so it survives the editor unmounting: switching a league
 * admin tab (`?tab=`), collapsing a section, or a refresh. Only a per-viewer
 * convenience, never shared state: every access is wrapped in try/catch and
 * guarded by `typeof window`, and the editor works the same without storage.
 * A storage failure is not silent: it is logged (`console.warn`, once per
 * kind of access, since reads run on every render), and `writeDescriptionDraft`
 * returns false so the editor can tell the viewer the draft is not being kept.
 *
 * Own-tab writes notify the subscribers directly (the `storage` event fires only
 * in other tabs), so `useSyncExternalStore` readers re-render on every change.
 */

export type DescriptionResource = 'season' | 'tournament';

const PREFIX = 'poketools:description-draft:v1';

export function descriptionDraftKey(resourceType: DescriptionResource, resourceId: string): string {
  return `${PREFIX}:${resourceType}:${resourceId}`;
}

const listeners = new Set<() => void>();

type StorageAccess = 'open' | 'read' | 'write' | 'clear';
const warned = new Set<StorageAccess>();

/** Logs a storage failure once per kind of access (reads run on every render). */
function warnStorage(access: StorageAccess, error: unknown): void {
  if (warned.has(access)) return;
  warned.add(access);
  console.warn(`[description-draft] sessionStorage ${access} failed; the unsaved draft is not kept`, error);
}

/** Test-only: forget which failures were already logged. */
export function resetDescriptionDraftWarnings(): void {
  warned.clear();
}

function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch (error) {
    warnStorage('open', error);
    return null;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** The stored draft, or null when there is none or storage is unavailable. */
export function readDescriptionDraft(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch (error) {
    warnStorage('read', error);
    return null;
  }
}

/** Stores the draft. Returns false when it could not be stored (no storage, quota, blocked). */
export function writeDescriptionDraft(key: string, text: string): boolean {
  let written = false;
  try {
    const s = store();
    if (s) {
      s.setItem(key, text);
      written = true;
    }
  } catch (error) {
    warnStorage('write', error);
    written = false;
  }
  notify();
  return written;
}

export function clearDescriptionDraft(key: string): void {
  try {
    store()?.removeItem(key);
  } catch (error) {
    // Nothing could have been stored either; logged, not hidden.
    warnStorage('clear', error);
  }
  notify();
}

/** `useSyncExternalStore` subscribe: own-tab writes plus other tabs' `storage` events. */
export function subscribeDescriptionDrafts(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) onChange();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/**
 * Whether a stored draft should be offered back: it exists and differs from the
 * saved description (a draft equal to it has nothing left to restore).
 */
export function hasRestorableDraft(draft: string | null, saved: string): draft is string {
  return draft !== null && draft !== saved;
}

/**
 * The text "Edit" opens the editor with: an offered draft wins over the saved description, so the first
 * keystroke after "Edit" never overwrites unsaved text (the Resume/Discard notice is hidden while editing).
 */
export function descriptionEditSeed(draft: string | null, saved: string): string {
  return hasRestorableDraft(draft, saved) ? draft : saved;
}

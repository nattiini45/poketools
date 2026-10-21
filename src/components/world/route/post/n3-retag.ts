import { useLayoutEffect } from 'react';

/**
 * D42 N3: the third retag trigger of the exact N8AO transparency pass
 * (`n8ao-exact.ts`). The pass tags once at `onRevealReady` and again on
 * `onFigureSetChanged`; a transparent renderable that mounts AFTER the reveal
 * and is not a director figure (residency does not track it) would otherwise
 * stay untagged, and the exact pass would leave it out of both transparency
 * renders where the stock pass draws it.
 *
 * Such a mount calls `requestN3Retag()` once it is in the scene graph; the
 * pass marks its tags dirty and the next frame runs the one tagging traversal
 * (never per frame). Module-level, like `onFigureSetChanged`: a call with no
 * listener (no AO pass mounted, SSR) is a no-op.
 *
 * The production late mounts today: the no-model ace sprite cards (plaza
 * `AceBillboard`, sakura and mountain `AceShrineCard`), whose transparent
 * sprite plane mounts when `/api/proxy-image` answers, which can be after the
 * reveal arms.
 */

const listeners = new Set<() => void>();

/** Ask the exact AO pass to retag on its next frame (a transparent object mounted late). */
export function requestN3Retag(): void {
  listeners.forEach(notify);
}

function notify(cb: () => void): void {
  cb();
}

/** Subscribe to retag requests; returns unsubscribe. */
export function onN3RetagRequested(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Request a retag after a late renderable has committed: a layout effect runs
 * once the component's own children are in the scene graph. `mounted` is the
 * value that gates the late child (e.g. the loaded texture); a falsy value
 * (nothing mounted yet, or the child left) requests nothing.
 */
export function useN3RetagOnMount(mounted: unknown): void {
  useLayoutEffect(() => {
    if (mounted) requestN3Retag();
  }, [mounted]);
}

import type { Texture, WebGLRenderer } from 'three';
import { routeLive } from './compile-guard';

/**
 * Upload deferral during the load.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

// ── Upload deferral during the load (ENGINE r2) ─────────────────────────────
//
// drei's `useTexture` / `useKTX2` call `gl.initTexture` on EVERY texture they
// load, all at once, in a passive effect — a synchronous batch of uploads and
// mip generations inside one React task. r2 plaza probe: 0.6-0.8 s React
// tasks each froze the compositor (and the CSS ceremony) for the same time.
// While the load warm runs, such calls are DEFERRED: the texture joins the
// warm's own upload queue, which uploads one texture at a time under a
// per-frame budget. The warm's uploads (and anything after the handoff) go
// straight through.

interface UploadDeferral {
  original: (texture: Texture) => void;
  wrapper: (texture: Texture) => void;
  deferred: Set<Texture>;
  active: boolean;
}

const uploadDeferrals = new WeakMap<WebGLRenderer, UploadDeferral>();

/** Start deferring outside `initTexture` calls on `gl` (idempotent); returns the stop. */
export function deferExternalUploads(gl: WebGLRenderer): () => void {
  let entry = uploadDeferrals.get(gl);
  if (!entry) {
    const original = gl.initTexture.bind(gl);
    const created: UploadDeferral = {
      original,
      deferred: new Set(),
      active: true,
      wrapper: (texture: Texture) => {
        if (created.active && !routeLive()) {
          created.deferred.add(texture);
          return;
        }
        original(texture);
      },
    };
    entry = created;
    uploadDeferrals.set(gl, entry);
    gl.initTexture = entry.wrapper;
  }
  const current = entry;
  current.active = true;
  return () => {
    current.active = false;
    // Anything still deferred uploads on its first draw (as before r2).
    current.deferred.clear();
  };
}

/** Upload `texture` now, bypassing the deferral (the warm's own slices). */
export function uploadNow(gl: WebGLRenderer, texture: Texture): void {
  const entry = uploadDeferrals.get(gl);
  if (entry) {
    entry.deferred.delete(texture);
    entry.original(texture);
  } else {
    gl.initTexture(texture);
  }
}

/** Textures an outside caller asked to upload during the load (the warm uploads them). */
export function deferredUploads(gl: WebGLRenderer): Texture[] {
  return [...(uploadDeferrals.get(gl)?.deferred ?? [])];
}

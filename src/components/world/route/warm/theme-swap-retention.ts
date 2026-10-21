import type { Material, Object3D } from 'three';
import { isRenderable, materialsOf } from './compile-guard';

/**
 * Theme-swap program retention.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

// ── Theme-swap program retention (ENGINE-FIX, D32) ─────────────────────────
//
// A day/night swap of a live world re-renders the scene with the new palette,
// and every component that builds its material from the palette builds a NEW
// one and disposes the old. three deletes a program (and forgets a custom
// shader's source id) when its last user is disposed — and the old material
// is disposed in the swap's commit, BEFORE the warm compiles its successor.
// So a successor with the very same program key re-linked it from scratch
// (and a ShaderMaterial got a NEW source id, i.e. a new key: clouds, 8 per
// swap), and the veil held for seconds over links that changed nothing.
//
// The capture runs behind the opaque veil just before the swap commits: every
// material the scene draws with has its `dispose` deferred. Disposals the
// swap's commit asks for are recorded instead, so the old programs and shader
// ids stay alive while the new materials compile against them (three's
// program cache hands them over: no link). Once the new generation's warm
// settled — still behind the veil — `settleThemeSwap` keeps the replaced
// materials as the LEFT palette's set (its programs survive for the way
// back) and really disposes the set kept from the target palette's last
// visit (its programs are now held by the new live materials). At most one
// kept set per palette key: bounded, whatever the number of swaps.

interface SwapCapture {
  fromKey: string;
  /** Materials whose `dispose` is deferred (own-property shadow of the prototype method). */
  patched: Set<Material>;
  /** Of those, the ones a disposal was asked for during the swap. */
  asked: Set<Material>;
}

let swapCapture: SwapCapture | null = null;
const keptSets = new Map<string, Material[]>();

/** Drop the own-property `dispose` shadow (the prototype's method shows through again). */
function dropDisposeShadow(material: Material): void {
  Reflect.deleteProperty(material, 'dispose');
}

function realDispose(material: Material): void {
  dropDisposeShadow(material);
  try {
    material.dispose();
  } catch {
    // A lost context: nothing to release.
  }
}

function unpatch(capture: SwapCapture): void {
  for (const material of capture.patched) dropDisposeShadow(material);
}

/** Every material the scene's renderables draw with (Mesh, Points, Line, Sprite...). */
function sceneMaterials(scene: Object3D): Set<Material> {
  const out = new Set<Material>();
  scene.traverse((object) => {
    if (!isRenderable(object)) return;
    for (const material of materialsOf(object)) out.add(material);
  });
  return out;
}

/**
 * Behind the opaque veil, just before the swap commits (`fromKey` is the
 * palette being left, e.g. `plaza:day`): defer every scene material's
 * disposal. A capture still open (a second flip under the veil) keeps its
 * first `fromKey` and adds the materials of the in-between palette.
 */
export function captureThemeSwap(scene: Object3D, fromKey: string): void {
  const capture = swapCapture ?? { fromKey, patched: new Set<Material>(), asked: new Set<Material>() };
  for (const material of sceneMaterials(scene)) {
    if (capture.patched.has(material)) continue;
    capture.patched.add(material);
    const asked = capture.asked;
    (material as Material & { dispose: () => void }).dispose = () => {
      asked.add(material);
    };
  }
  swapCapture = capture;
}

/** Whether a swap capture is open (trace / tests). */
export function themeSwapCaptured(): boolean {
  return swapCapture !== null;
}

/**
 * The swap's generation is warm (every successor compiled against the kept
 * programs), still behind the veil: close the capture. Returns how many
 * materials were kept for the left palette and how many from an earlier
 * visit of `toKey` were really disposed.
 */
export function settleThemeSwap(scene: Object3D, toKey: string): { kept: number; released: number } {
  const capture = swapCapture;
  if (capture === null) return { kept: 0, released: 0 };
  swapCapture = null;
  unpatch(capture);
  const live = sceneMaterials(scene);
  const replaced: Material[] = [];
  // A disposal asked for a material the scene still draws with (the warm's
  // own variant eviction, or a component re-using it) is dropped: disposing
  // a live material would re-link it on its next draw — after the veil.
  for (const material of capture.asked) if (!live.has(material)) replaced.push(material);
  // The target palette's set from its last visit: its programs are held by
  // the new live materials now.
  let released = 0;
  const previous = keptSets.get(toKey);
  if (previous !== undefined) {
    keptSets.delete(toKey);
    for (const material of previous) {
      if (live.has(material)) continue;
      realDispose(material);
      released += 1;
    }
  }
  // The left palette's replaced materials: kept (undisposed) for the way
  // back; an older kept set of that palette is released (the same programs).
  const older = keptSets.get(capture.fromKey);
  keptSets.set(capture.fromKey, replaced);
  if (older !== undefined) {
    for (const material of older) {
      if (live.has(material)) continue;
      realDispose(material);
      released += 1;
    }
  }
  return { kept: replaced.length, released };
}

/**
 * The world is gone or went Lite: close any capture (honouring the disposals
 * it deferred) and release every kept set.
 */
export function releaseThemeSwapRetention(): void {
  const capture = swapCapture;
  swapCapture = null;
  if (capture !== null) {
    unpatch(capture);
    for (const material of capture.asked) realDispose(material);
  }
  for (const set of keptSets.values()) for (const material of set) realDispose(material);
  keptSets.clear();
}

/** Trace: the kept sets' sizes per palette key. */
export function themeSwapRetention(): { open: boolean; kept: Record<string, number> } {
  const kept: Record<string, number> = {};
  for (const [key, set] of keptSets) kept[key] = set.length;
  return { open: swapCapture !== null, kept };
}

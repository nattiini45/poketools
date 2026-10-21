import type { Camera, Material, Object3D, Texture, WebGLRenderer } from 'three';
import { type ProgramLike, texturesOf, warmers } from './compile-guard';

/**
 * The programs-warm signal, and `markLoadWarmComplete`, which seeds the
 * compile guard's state and feeds that signal when the load warm finishes.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

// ── Programs-warm signal (review r4, the W7 reveal gate's input) ─────────
//
// The r3 loader traces froze the reveal beam for 0.5–1.4 s: ~550 ms after
// `routeSceneLive` the EffectComposer's render hit `onFirstUse` →
// `getProgramInfoLog` on programs that were still linking. The conductor
// driver now opens a warm window on the FIRST frame of every canvas (before
// the reveal can arm), so the whole scene — hidden pre-mounts included — is
// compiled for every render target the frame draws to (the post stack's
// buffer as well as the screen). `programsWarm` then reports when that work
// has landed: a warm scan has run, its compile batch closed, its texture
// queue drained, every program the renderer knows reports ready
// (`isReady`, a non-blocking COMPLETION_STATUS poll) and the program count
// has not changed for PROGRAMS_WARM_STABLE_FRAMES frames. It latches per
// renderer; content that streams in later is the compile guard's business.

/** Frames the renderer's program count must hold still before `programsWarm`. */
export const PROGRAMS_WARM_STABLE_FRAMES = 2;

export interface ProgramsWarmTrack {
  count: number;
  stable: number;
  warm: boolean;
}

export function createProgramsWarmTrack(): ProgramsWarmTrack {
  return { count: -1, stable: 0, warm: false };
}

/**
 * One frame of the programs-warm latch (pure; unit-tested). `count` is the
 * renderer's program count this frame, `allReady` whether every program
 * reports linked, `warmDone` whether the warm pass has scanned and drained.
 */
export function stepProgramsWarm(
  track: ProgramsWarmTrack,
  count: number,
  allReady: boolean,
  warmDone: boolean,
): boolean {
  if (track.warm) return true;
  if (count !== track.count) {
    track.count = count;
    track.stable = 0;
  } else {
    track.stable += 1;
  }
  if (warmDone && allReady && track.stable >= PROGRAMS_WARM_STABLE_FRAMES) track.warm = true;
  return track.warm;
}

let programsTrackGl: WebGLRenderer | null = null;
let programsTrack = createProgramsWarmTrack();
/** The first-frame shadow warm (`warmShadowVariants`) has run for the tracked renderer. */
let programsWarmRendered = false;
const programsListeners = new Set<() => void>();

/** The current renderer's shader programs are compiled and linked (see above). */
export function getProgramsWarm(): boolean {
  return programsTrack.warm;
}

/** Notified when `getProgramsWarm()` changes (latch, or a new renderer). */
export function subscribeProgramsWarm(listener: () => void): () => void {
  programsListeners.add(listener);
  return () => {
    programsListeners.delete(listener);
  };
}

function emitProgramsWarm(): void {
  for (const listener of [...programsListeners]) listener();
}

/**
 * Per frame, from the conductor driver: track the renderer and advance the
 * programs-warm latch (trace only).
 *
 * D23: this no longer ARMS anything. It used to open a warm window on the
 * first frame of every renderer (a whole-scene `compile` on the first render
 * and a whole-scene shadow-variant compile) — exactly the large synchronous
 * batches that stalled the GPU process and froze the ceremony on ANGLE. The
 * load warm ceremony (`stepLoadWarm`, driven by RouteWorldCanvas) now does
 * that work in per-frame slices, and its completion (`markLoadWarmComplete`)
 * is what feeds this latch: the whole warm pass has run, so `warmDone`.
 */
export function noteProgramsFrame(gl: WebGLRenderer, _scene: Object3D, _camera: Camera): void {
  if (programsTrackGl !== gl) {
    const wasWarm = programsTrack.warm;
    programsTrackGl = gl;
    programsTrack = createProgramsWarmTrack();
    programsWarmRendered = false;
    if (wasWarm) emitProgramsWarm();
    return;
  }
  if (programsTrack.warm) return;
  const warmDone = programsWarmRendered;
  const programs = (gl.info as unknown as { programs?: ProgramLike[] | null }).programs ?? [];
  let allReady = true;
  for (const program of programs) {
    if (typeof program.isReady === 'function' && !program.isReady()) {
      allReady = false;
      break;
    }
  }
  if (stepProgramsWarm(programsTrack, programs.length, allReady, warmDone)) emitProgramsWarm();
}

/** Tests only: forget the tracked renderer. */
export function resetProgramsWarmForTests(): void {
  programsTrackGl = null;
  programsTrack = createProgramsWarmTrack();
  programsWarmRendered = false;
}

/**
 * The warm finished for `gl`: seed the station warm state with everything
 * the load compiled and uploaded (so a post-live station change finds
 * nothing "fresh" and the compile guard stays idle), and latch the
 * programs-warm trace.
 */
export function markLoadWarmComplete(gl: WebGLRenderer, scene: Object3D, camera: Camera): void {
  let state = warmers.get(gl);
  if (!state) {
    state = {
      until: 0,
      timer: 0,
      seen: new WeakSet(),
      uploaded: new WeakSet(),
      pending: [],
      scene,
      camera,
      held: new Map(),
      released: new WeakSet(),
      compilePending: false,
      compiledTargets: new Set(),
      compileBatchFrame: -1,
      frame: 0,
      detectedFrame: -1,
      live: false,
      uploadFrame: -1,
      scans: 1,
    };
    warmers.set(gl, state);
  }
  const seeded = state;
  scene.traverse((object) => {
    const material = (object as Object3D & { material?: Material | Material[] }).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      seeded.seen.add(entry);
      const textures: Texture[] = [];
      texturesOf(entry, textures);
      for (const texture of textures) seeded.uploaded.add(texture);
    }
  });
  if (programsTrackGl === gl) programsWarmRendered = true;
}

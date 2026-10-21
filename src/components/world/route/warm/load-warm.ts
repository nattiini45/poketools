import {
  type Camera,
  LinearFilter,
  type Material,
  NearestFilter,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { PROGRAMS_WARM_STABLE_FRAMES } from './programs-warm';

/**
 * The load warm ceremony: its stages and budgets, the IO contract, the state
 * machine and the prepare / post-pass registries.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

// ── Load warm ceremony (D23 "complete at reveal", LOOK-PLAN §2 G3) ─────────
//
// Owner, verbatim: "I don't want anything to stream in after the world
// appears, that's what the pokeball loading animation is for". Every
// program, shadow variant, post pass and texture upload the session can need
// lands during the ceremony, in ONE ordered pass per scene generation:
//
//   1. prepare  — the registered pre-compile hooks (`registerWarmPrepare`:
//                 the plaza's paint sweep, station-0 light / shadow-fit /
//                 calm-rect uniforms), every frame before any compile, so a
//                 material is patched before its first compile;
//   2. compile  — every renderable's program, sliced: proxies (same
//                 geometry, same object kind) compiled against the real
//                 scene's lights into a scratch render target (the composer's
//                 variant: linear output, no tone mapping), a few new
//                 programs per frame, never more than a few links in flight;
//                 repeated for whatever mounts until the content is complete
//                 (assets idle AND residency complete);
//   3. shadows  — every caster's shadow-pass variants at the final map,
//                 sliced by caster (`compileShadowVariants`);
//   4. textures — `initTexture` for every scene texture, sliced under
//                 GUARD_TEXTURE_BUDGET_MS per frame (PMREM is built by the
//                 compile that first sees the environment);
//   5. passes   — every post pass the start rung and the rungs below it can
//                 draw (`registerWarmPostPass`, filtered by
//                 `postPassesFrom`): pre-compiled, then rendered once into a
//                 small target — a governor step later only flips `.enabled`;
//   6. poses    — one offscreen render per frozen station pose at quarter
//                 resolution, one pose per frame (flushes skinning,
//                 instancing and UBO state; first-use of every drawn range);
//   7. frame    — the renderer's first real frame (held until now);
//   8. settle   — the program count holds still for
//                 PROGRAMS_WARM_STABLE_FRAMES frames with nothing linking and
//                 nothing left to upload: warm.
//
// Milestones: `compiled` rises when 2, 3 and 5 are done and linked,
// `uploaded` when 4 and 6 are done; `warm` gates the reveal. The ANGLE box
// freezes even CSS animations on large synchronous compile/upload batches
// (wave-2 residual), so EVERY stage is a per-frame slice: the ceremony keeps
// animating while the work drains. The compile guard stays as the safety net
// and is idle at reveal (the warm seeds its state, `seedStationWarm`).

/** The ordered stages of the load warm (see the section note). */
export const LOAD_WARM_STAGES = ['compile', 'shadows', 'verify', 'textures', 'buffers', 'passes', 'poses', 'frame', 'settle', 'done'] as const;
export type LoadWarmStage = (typeof LOAD_WARM_STAGES)[number];

/**
 * New programs one compile slice may add in a frame (ENGINE r2). Under
 * KHR_parallel_shader_compile the ANGLE / D3D11 links run on GPU-process
 * worker threads (a Chrome trace shows 0.5-1.3 s worker tasks per program),
 * so throughput scales with the links in flight; but a cold burst of many
 * links still starves the compositor (r2 harness: 16 at once froze the
 * screencast 0.8-0.96 s). So the number in flight is an adaptive cap
 * (`stepLinkCap`) under WARM_MAX_LINKS_IN_FLIGHT.
 */
export const WARM_NEW_PROGRAMS_PER_FRAME = 4;
/** Main-thread budget of one compile slice (at least one variant per frame). */
export const WARM_COMPILE_BUDGET_MS = 12;
/** No new compiles are issued while this many programs are still linking. */
export const WARM_MAX_LINKS_IN_FLIGHT = 12;
/** A frame interval this long means the GPU process is busy: issue one program at most. */
export const WARM_FRAME_SLOW_MS = 50;
/** A frame interval this long means it is stalled: issue nothing while links are in flight. */
export const WARM_FRAME_STALLED_MS = 120;

/** The link cap a load starts from (see `stepLinkCap`). */
export const WARM_LINK_CAP_START = 3;
/** A frame interval this short counts as smooth for the link-cap ramp. */
export const WARM_FRAME_SMOOTH_MS = 30;
/** Smooth frames in a row before the link cap grows by 1. */
export const WARM_LINK_CAP_RAMP_FRAMES = 3;

export interface LinkCapState {
  cap: number;
  smooth: number;
}

export function createLinkCap(): LinkCapState {
  return { cap: WARM_LINK_CAP_START, smooth: 0 };
}

/**
 * One frame of the adaptive link cap (pure, additive-increase /
 * multiplicative-decrease). r2 harness traces: 16 programs issued in the
 * first frames froze the screencast 0.96 s, 8 kept it under 0.25 s but
 * compiled the plaza in 5 s. So the cap starts at WARM_LINK_CAP_START, grows
 * by 1 after WARM_LINK_CAP_RAMP_FRAMES smooth frames in a row, up to
 * WARM_MAX_LINKS_IN_FLIGHT, and halves (never below 2) on a slow frame: a
 * device whose GPU process keeps up compiles fast, one that does not keeps
 * its ceremony smooth.
 */
export function stepLinkCap(state: LinkCapState, frameIntervalMs: number): LinkCapState {
  if (frameIntervalMs >= WARM_FRAME_SLOW_MS) return { cap: Math.max(2, Math.ceil(state.cap / 2)), smooth: 0 };
  if (frameIntervalMs >= WARM_FRAME_SMOOTH_MS) return state.smooth === 0 ? state : { cap: state.cap, smooth: 0 };
  const smooth = state.smooth + 1;
  if (smooth < WARM_LINK_CAP_RAMP_FRAMES) return { cap: state.cap, smooth };
  return { cap: Math.min(WARM_MAX_LINKS_IN_FLIGHT, state.cap + 1), smooth: 0 };
}

/**
 * How many NEW programs the warm may issue this frame (pure): at most
 * WARM_NEW_PROGRAMS_PER_FRAME, never past `cap` links in flight (the adaptive
 * cap, `stepLinkCap`), one on a slow frame, and on a stalled frame one only
 * when nothing is linking (the load always moves on).
 */
export function warmLinkBudget(frameIntervalMs: number, inFlight: number, cap: number = WARM_MAX_LINKS_IN_FLIGHT): number {
  const room = Math.min(cap, WARM_MAX_LINKS_IN_FLIGHT) - inFlight;
  if (room <= 0) return 0;
  if (frameIntervalMs >= WARM_FRAME_STALLED_MS) return inFlight === 0 ? 1 : 0;
  if (frameIntervalMs >= WARM_FRAME_SLOW_MS) return 1;
  return Math.min(WARM_NEW_PROGRAMS_PER_FRAME, room);
}
/**
 * ENGINE-FIX (D32): the warm's budgets behind the OPAQUE theme veil. The
 * per-frame slices, the GPU fence and the link cap exist to keep a VISIBLE
 * ceremony smooth (the compositor shares the ANGLE GPU main thread with the
 * warm); under the veil there is nothing to keep smooth — a static sheet in
 * the page colour — and every millisecond is the visitor's wait. So the host
 * runs several warm steps per frame (`frameBudgetMs` of main thread), the
 * fence is not waited on, and more links are issued per step. The fade-in
 * and fade-out themselves are compositor transitions of an idle page: no
 * warm step runs during either.
 */
export const VEILED_WARM = {
  /** Main-thread ms of warm steps per animation frame. */
  frameBudgetMs: 40,
  /** Programs linking at once. */
  maxLinksInFlight: 32,
  /** New programs one step may issue. */
  newProgramsPerStep: 12,
  /** First-drawn executables one `buffers` step may carry (and one draw). */
  freshDrawsPerStep: 8,
  freshPerDraw: 4,
} as const;

/** How many new programs a veiled warm step may issue (pure). */
export function veiledLinkBudget(inFlight: number): number {
  return Math.max(0, Math.min(VEILED_WARM.newProgramsPerStep, VEILED_WARM.maxLinksInFlight - inFlight));
}

/** Casters per shadow-variant slice. */
export const WARM_SHADOW_CASTERS_PER_FRAME = 24;
/** Station pose renders run at this fraction of the drawing buffer (each axis). */
export const WARM_POSE_SCALE = 0.25;
/** Longest one program may be waited on before the warm moves on (bounded). */
export const WARM_LINK_MAX_MS = 5000;
/**
 * Geometry bytes one `buffers` slice may upload. r2 probes: the first pose
 * render uploaded every buffer in view at once, a 0.4-0.66 s task and a
 * 0.28 s compositor stall; slices of this size stay frame-sized (3 MB still
 * showed 0.3-0.4 s periodic-film gaps in the dark harness runs).
 */
export const WARM_BUFFER_BYTES_PER_FRAME = 1.5 * 1024 * 1024;
/**
 * R6: texel bytes one `textures` (or data-face) step may upload. The step was
 * budgeted by main-thread time only (GUARD_TEXTURE_BUDGET_MS), but an
 * ImageBitmap / canvas `texImage2D` costs the main thread almost nothing
 * while the GPU main thread pays the copy and the mip build (the R6 plaza
 * trace: four ~33 ms `WebGL` tasks issued in ONE step, 135 ms back to back —
 * a 150-215 ms compositor and rAF gap in the harness runs). With a byte
 * budget, the GPU fence (`gpuIdle`) spaces the uploads: at least one
 * texture per step, never more than this much behind it.
 */
export const WARM_TEXTURE_BYTES_PER_STEP = 3 * 1024 * 1024;
/**
 * ENGINE-FIX A2 (loading cadence): the texel budget of a step taken while
 * programs are still linking (the compile stage's `uploadWhileLinking`). The
 * GPU main thread then also runs the links' shader translations, so a
 * 3 MiB copy + mip build behind one stacked into a single compositor-starving
 * GPU task; next to a link the step carries at most this much (at least one
 * texture, as ever). Not behind the theme veil (nothing to keep smooth).
 */
export const WARM_TEXTURE_BYTES_WHILE_LINKING = 1024 * 1024;

/**
 * R6: an estimate of the bytes one texture upload moves to the GPU (its
 * base level, plus a third for generated mips): compressed levels as
 * stored, data textures as their typed array, image sources at 4 bytes per
 * texel. Pure; unknown shapes count as 0 (they never block a step).
 */
export function textureUploadBytes(texture: Texture): number {
  const t = texture as Texture & {
    isCompressedTexture?: boolean;
    isRenderTargetTexture?: boolean;
    mipmaps?: { data?: { byteLength?: number } }[];
  };
  if (t.isRenderTargetTexture === true) return 0;
  if (t.isCompressedTexture === true) {
    let bytes = 0;
    for (const level of t.mipmaps ?? []) bytes += level?.data?.byteLength ?? 0;
    return bytes;
  }
  const images: unknown[] = Array.isArray(t.image) ? t.image : [t.image];
  let bytes = 0;
  for (const image of images) {
    const source = image as { width?: number; height?: number; depth?: number; data?: { byteLength?: number } } | null | undefined;
    if (source == null) continue;
    if (source.data !== undefined && typeof source.data.byteLength === 'number') bytes += source.data.byteLength;
    else bytes += Math.max(0, source.width ?? 0) * Math.max(0, source.height ?? 0) * Math.max(1, source.depth ?? 1) * 4;
  }
  const mips = t.generateMipmaps && t.minFilter !== LinearFilter && t.minFilter !== NearestFilter;
  return mips ? Math.round((bytes * 4) / 3) : bytes;
}
/**
 * Materials drawn for the FIRST time into an output that one `buffers`
 * slice may carry (ENGINE r3): each first draw can build D3D executables
 * synchronously in the GPU process (10-35 ms each on the ANGLE box).
 */
export const WARM_BUFFER_NEW_MATERIALS = 1;
/**
 * ENGINE r4: the adaptive first-draw budget's ceiling (steps whose GPU work
 * finished within a frame grow it). D42 N8: 1 → 2 — while the GPU fence is
 * idle (the last step's fence signalled at its first poll and the step was
 * not heavy), a `buffers` step may carry two first-drawn materials; any step
 * that needed more frames halves it back to WARM_BUFFER_NEW_MATERIALS. Each
 * DRAW still carries at most WARM_BUFFER_DRAW_NEW_MATERIALS. Without fences
 * (WebGL1) the budget never grows.
 */
export const WARM_BUFFER_NEW_MATERIALS_MAX = 2;

/**
 * D42 N8: the next adaptive first-draw budget after a fenced step settled.
 * `fencePolls` is how many polls found the fence unsignalled (0: idle at the
 * first poll), `busyMs` fence-to-signal time. Grows by one only on an idle,
 * light step (below WARM_GPU_HEAVY_MS); halves (never below the base) after
 * a step the GPU needed more frames for.
 */
export function nextFreshBudget(current: number, fencePolls: number, busyMs: number): number {
  if (fencePolls === 0 && busyMs < WARM_GPU_HEAVY_MS) return Math.min(WARM_BUFFER_NEW_MATERIALS_MAX, current + 1);
  if (fencePolls === 0) return Math.min(WARM_BUFFER_NEW_MATERIALS_MAX, Math.max(WARM_BUFFER_NEW_MATERIALS, current));
  return Math.max(WARM_BUFFER_NEW_MATERIALS, Math.floor(current / 2));
}
/**
 * ENGINE r4: draws one `buffers` step may carry (at most
 * WARM_BUFFER_NEW_MATERIALS of them with a first-drawn material). With the
 * GPU fence (`gpuIdle`) a step's D3D executable build finishes before the
 * next is issued, so the compositor gets the GPU main thread between them
 * (r3's three per step made 42-55 ms GPU tasks and 150-190 ms ceremony gaps).
 */
export const WARM_BUFFER_DRAWS_PER_STEP = 6;
/** ENGINE r4: first-drawn materials one buffer DRAW may carry (each draw is flushed as its own GPU task). */
export const WARM_BUFFER_DRAW_NEW_MATERIALS = 1;
/** The camera layer the `buffers` slices draw through (unused by the app). */
export const WARM_BUFFER_LAYER = 31;
/** Main-thread budget of one program first-use slice (`primeSlice`; at least one program per frame). */
export const WARM_PRIME_BUDGET_MS = 6;
/** Verification passes before the warm moves on regardless (see `verify`). */
export const WARM_VERIFY_MAX_PASSES = 4;
/** Frames the scene's program state (lights, environment, fog) must hold before compiling. */
export const WARM_SIGNATURE_STABLE_FRAMES = 2;

/**
 * The effectful side of the load warm, one method per stage slice. The
 * machine (`stepLoadWarm`) only sequences them; `createLoadWarmIO` is the
 * three.js implementation and the tests drive fakes.
 */
export interface LoadWarmIO {
  /** Run the registered pre-compile hooks (idempotent; every frame before `done`). */
  prepare(): void;
  /** Queue compile work for variants not seen yet; returns how many were queued now. */
  collect(): number;
  /** Compile queued variants (the start rung's output) within this frame's slice; returns how many remain queued. */
  compileSlice(): number;
  /**
   * ENGINE r3: one slice of the lower rungs' outputs (`WarmOutput`), run in
   * the compile stage once the start rung's output is linked; ends with a
   * verification compile of the whole scene per output. Returns the work
   * remaining (0 = every variant linked and verified). Optional: a
   * single-output IO has none.
   */
  laterSlice?(): number;
  /** Any program still linking (bounded by WARM_LINK_MAX_MS each). */
  linksPending(): boolean;
  /**
   * R6: one byte-budgeted texture-upload step run INSIDE the compile stage,
   * on a frame whose compile slice issued no program (the links in flight
   * are at their cap — the GPU main thread is idle while the workers link).
   * A no-op unless the content is complete and the compile gate is open.
   * The `textures` stage then only uploads what is left. Optional (fakes).
   */
  uploadWhileLinking?(): void;
  /** The content is complete: assets idle AND residency complete. */
  contentComplete(): boolean;
  /** One shadow-variant slice; returns casters remaining. */
  shadowSlice(): number;
  /**
   * One verification pass over the REAL scene (not proxies): a whole-scene
   * compile and every caster's shadow variants against the live lights,
   * environment and fog. Returns how many programs it created — 0 means the
   * proxy compile missed nothing.
   */
  verifySlice(): number;
  /** One texture-upload slice; returns textures remaining. */
  textureSlice(): number;
  /**
   * ENGINE r3: one slice of program first-use work (three's `onFirstUse`:
   * the uniform / attribute tables and, with `checkShaderErrors`, the info
   * logs — synchronous GL queries per program) for linked programs not yet
   * used, under a per-frame budget. Returns the programs still unprimed.
   * r3 probe: the first pose render at an output paid it for ~50 programs
   * in one 0.42 s task. Optional (fakes need none).
   */
  primeSlice?(): number;
  /**
   * One geometry-upload slice: a byte-budgeted chunk of the visible
   * renderables drawn once offscreen (vertex / index / instance buffers,
   * bone and morph textures reach the GPU); returns renderables remaining.
   */
  bufferSlice(): number;
  /** One post-pass step (pre-compile, then render); returns steps remaining. */
  passSlice(): number;
  /** One station pose render; returns poses remaining. */
  poseSlice(): number;
  /** Let the renderer draw its first real frame. */
  requestFrame(): void;
  /** A real frame was drawn since `requestFrame`. */
  frameDrawn(): boolean;
  /** `renderer.info.programs.length`. */
  programCount(): number;
  /**
   * ENGINE r4 (CAR r3: the theme worlds' ceremony dropped to 26-33 compositor
   * fps with 160-190 ms gaps in the buffers stage). The main thread issues a
   * slice every 16.7 ms, but a slice's GPU work (first draws that build D3D
   * executables, uploads, whole-scene pose draws) takes the ANGLE GPU main
   * thread 40-70 ms: without backpressure the command queue backs up and the
   * compositor — which draws on that same thread — waits behind it. The warm
   * inserts a fence after every step that issued GPU work and issues nothing
   * more until the GPU has finished it (a non-blocking poll, bounded by
   * WARM_FENCE_MAX_MS). False = skip this frame. Optional (fakes need none).
   */
  gpuIdle?(): boolean;
  /** Fence the GPU work issued so far (after a step). */
  fenceGpu?(): void;
  /**
   * ENGINE r4 (CAR r3 veto: a plaza-dark reveal with blank LED boards): one
   * slice of the data faces' own residency — every registered face painted,
   * its mesh mounted and visible, and every texture it will sample uploaded
   * (uploading the missing ones under the texture budget). Returns the faces
   * not ready yet. `uploaded` never rises, and the warm never settles, while
   * it is above 0. Optional (a world without faces).
   */
  facesSlice?(): number;
  /**
   * ENGINE r4 (CAR r3: a 100-190 ms compositor gap at the arm in every
   * world): one slice of the post chain's full-size render targets — bound
   * and cleared once each, one per step. The first real frame used to pay
   * their allocation and ANGLE's robust zero-initialisation (tens of MB on
   * the integrated GPU) in one GPU batch right before the arm. Returns the
   * targets left. Optional (fakes and worlds without post need none).
   */
  targetSlice?(): number;
  /**
   * ENGINE r5 (CAR r4: ~30 compositor fps in the theme worlds' loads): GPU
   * time of each step, measured with EXT_disjoint_timer_query_webgl2 where the
   * context has it. `gpuTimerBegin` opens a TIME_ELAPSED query before a step's
   * body and `gpuTimerEnd` closes it after; the result lands a few frames
   * later (polled in `gpuIdle`). Optional (fakes and contexts without the
   * extension measure nothing).
   */
  gpuTimerBegin?(): void;
  gpuTimerEnd?(): void;
}

/** Longest one GPU fence is waited on before the warm moves on regardless (context loss, a driver that never signals). */
export const WARM_FENCE_MAX_MS = 250;
/** ENGINE r4: a warm step whose GPU work outlasted this (ms, fence to signal) is heavy and earns a rest. */
export const WARM_GPU_HEAVY_MS = 24;
/** ENGINE r4: the rest after a heavy step, as a multiple of its GPU time (1 = at most half the GPU main thread). */
export const WARM_GPU_REST_FACTOR = 0;

export interface LoadWarmState {
  stage: LoadWarmStage;
  /** Frames the program count has held still in `settle`. */
  stable: number;
  /** Program count at the previous `settle` frame (−1 before). */
  lastPrograms: number;
  /** Milestone M4 reached (monotone). */
  compiled: boolean;
  /** Milestone M5 reached (monotone). */
  uploaded: boolean;
  /** The warm settled (the reveal-gate input; monotone). */
  warm: boolean;
  frameRequested: boolean;
  /** Frames stepped so far (trace). */
  frames: number;
  /** Verification passes run in the current `verify` stage. */
  verifyPasses: number;
}

export function createLoadWarm(): LoadWarmState {
  return {
    stage: 'compile',
    stable: 0,
    lastPrograms: -1,
    compiled: false,
    uploaded: false,
    warm: false,
    frameRequested: false,
    frames: 0,
    verifyPasses: 0,
  };
}

/**
 * One frame of the load warm (see the section note). Exactly ONE stage's
 * slice runs per frame, so the order is strict and every frame's GPU work
 * stays bounded. Content that mounts after the compile stage (a late
 * population) sends the machine back to `compile`; the milestones already
 * reached stay reached (they are monotone), and `warm` is only ever set by a
 * full settle.
 */
export function stepLoadWarm(prev: LoadWarmState, io: LoadWarmIO): LoadWarmState {
  if (prev.stage === 'done') return prev;
  // ENGINE r4: backpressure — the previous step's GPU work first (`gpuIdle`).
  if (io.gpuIdle !== undefined && !io.gpuIdle()) return { ...prev, frames: prev.frames + 1 };
  io.gpuTimerBegin?.();
  let state: LoadWarmState;
  try {
    state = stepLoadWarmBody({ ...prev, frames: prev.frames + 1 }, io);
  } finally {
    io.gpuTimerEnd?.();
  }
  io.fenceGpu?.();
  return state;
}

function stepLoadWarmBody(state: LoadWarmState, io: LoadWarmIO): LoadWarmState {
  io.prepare();
  const fresh = io.collect();
  if (fresh > 0 && state.stage !== 'compile') {
    state.stage = 'compile';
    state.stable = 0;
    state.lastPrograms = -1;
    state.frameRequested = false;
    state.verifyPasses = 0;
  }
  switch (state.stage) {
    case 'compile': {
      // The start rung's output first, then (ENGINE r3) the lower rungs'
      // outputs — sequential: r3 probes overlapping them with the later
      // stages gained nothing (the links are GPU-process bound, ~15/s) and
      // put 0.3-0.45 s tasks into the buffer draws.
      const remaining = io.compileSlice();
      const later = remaining === 0 ? (io.laterSlice?.() ?? 0) : 1;
      if (remaining === 0 && later === 0 && !io.linksPending() && io.contentComplete()) state.stage = 'shadows';
      // R6: a frame that issued no compile uploads textures while the links run.
      else io.uploadWhileLinking?.();
      break;
    }
    case 'shadows': {
      const remaining = io.shadowSlice();
      if (remaining === 0 && !io.linksPending()) state.stage = 'verify';
      break;
    }
    case 'verify': {
      // Repeats (a frame apart, links landed in between) until a pass over
      // the real scene creates nothing: every program a real frame can link
      // is linked before the first real draw.
      if (io.linksPending()) break;
      state.verifyPasses += 1;
      const created = io.verifySlice();
      // Bounded: content that mints a program on every compile would
      // otherwise hold the warm here forever (the deadline would end it).
      if ((created === 0 && !io.linksPending()) || state.verifyPasses >= WARM_VERIFY_MAX_PASSES) state.stage = 'textures';
      break;
    }
    case 'textures': {
      // Program first use first (its own budget), then the uploads.
      if ((io.primeSlice?.() ?? 0) > 0) break;
      if (io.textureSlice() === 0) state.stage = 'buffers';
      break;
    }
    case 'buffers': {
      if (io.bufferSlice() === 0) state.stage = 'passes';
      break;
    }
    case 'passes': {
      const remaining = io.passSlice();
      if (remaining === 0 && !io.linksPending()) {
        // ENGINE r4: the post chain's full-size targets, one per step.
        if ((io.targetSlice?.() ?? 0) > 0) break;
        state.compiled = true;
        state.stage = 'poses';
      }
      break;
    }
    case 'poses': {
      // The post passes' programs linked since the textures stage.
      if ((io.primeSlice?.() ?? 0) > 0) break;
      if (io.poseSlice() === 0) {
        // ENGINE r4: every data face painted, mounted, visible and uploaded
        // before `uploaded` rises (never on counters alone).
        if ((io.facesSlice?.() ?? 0) > 0) break;
        state.uploaded = true;
        state.stage = 'frame';
      }
      break;
    }
    case 'frame': {
      if (!state.frameRequested) {
        io.requestFrame();
        state.frameRequested = true;
      } else if (io.frameDrawn()) {
        state.stage = 'settle';
      }
      break;
    }
    case 'settle': {
      const count = io.programCount();
      if (count === state.lastPrograms && !io.linksPending()) state.stable += 1;
      else state.stable = 0;
      state.lastPrograms = count;
      if (state.stable >= PROGRAMS_WARM_STABLE_FRAMES && io.textureSlice() === 0 && (io.facesSlice?.() ?? 0) === 0) {
        state.warm = true;
        state.stage = 'done';
      }
      break;
    }
  }
  return state;
}

/** Whether the renderer may draw a real frame in this warm state (held before `frame`). */
export function loadWarmAllowsDraw(state: LoadWarmState): boolean {
  return state.stage === 'frame' ? state.frameRequested : state.stage === 'settle' || state.stage === 'done';
}

// Registries: the warm's contracts with the seats that own the content.

/** A pre-compile hook (LIGHT: `paintSweep(scene)`, then station-0 uniforms). */
export type WarmPrepareHook = (scene: Object3D, camera: Camera, gl: WebGLRenderer) => void;

const prepareHooks: WarmPrepareHook[] = [];

/**
 * Register a hook the load warm runs every frame before it compiles
 * (LOOK-PLAN §2 G3.1–2). Hooks run in registration order; they must be
 * idempotent (the plaza's paint sweep keeps a WeakSet). Returns the release.
 * Worlds that register none are untouched (the blast-radius law).
 */
export function registerWarmPrepare(hook: WarmPrepareHook): () => void {
  prepareHooks.push(hook);
  return () => {
    const index = prepareHooks.indexOf(hook);
    if (index >= 0) prepareHooks.splice(index, 1);
  };
}

/** Run every registered pre-compile hook (a throw never stops the warm). */
export function runWarmPrepare(scene: Object3D, camera: Camera, gl: WebGLRenderer): void {
  for (const hook of [...prepareHooks]) {
    try {
      hook(scene, camera, gl);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.error('[load-warm] prepare hook failed', error);
    }
  }
}

/** Which post pass an entry is (the ladder's `post` / `!post` / `ao`). */
export type WarmPostPassKey = 'rich' | 'lean' | 'ao';

/**
 * A post pass the warm must have linked before the reveal (PostStack
 * registers its passes). `materials()` lists every material the pass draws
 * with (pre-compiled without a draw); `warm()` renders the pass once into a
 * small target with `.enabled` forced on and restored. An entry without
 * `warm` is linked by the warm's first real frame instead (N8AO: its
 * internal targets are sized to the composer, so it is only ever drawn by a
 * real frame — it is enabled at the start rung whenever it is needed).
 */
export interface WarmPostPass {
  key: WarmPostPassKey;
  materials: () => Material[];
  warm?: () => void;
}

const postPasses: WarmPostPass[] = [];

export function registerWarmPostPass(entry: WarmPostPass): () => void {
  postPasses.push(entry);
  return () => {
    const index = postPasses.indexOf(entry);
    if (index >= 0) postPasses.splice(index, 1);
  };
}

/**
 * The registered passes a session starting at `startIndex` must warm: those
 * whose key the start rung or any lower rung draws (`postPassesFrom`, from
 * quality.ts — the governor only steps down). Pure.
 */
export function postPassesToWarm(
  registered: readonly WarmPostPass[],
  needed: { rich: boolean; lean: boolean; ao: boolean },
): WarmPostPass[] {
  return registered.filter((entry) => needed[entry.key]);
}

export function registeredWarmPostPasses(): readonly WarmPostPass[] {
  return postPasses;
}

/** Tests only: drop every registration. */
export function resetLoadWarmRegistriesForTests(): void {
  prepareHooks.length = 0;
  postPasses.length = 0;
}

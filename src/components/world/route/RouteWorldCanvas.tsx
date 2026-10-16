'use client';

import {
  Children,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useStore, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ConductorDriver from './ConductorDriver';
import QualityGovernor from './QualityGovernor';
import FigureDirector, { pinFigureDirector } from './figures/FigureDirector';
import CoreActorProbe from './figures/CoreActorProbe';
import { coreActorsRequested } from './figures/core-actor-probe.data';
import { RouteDataContext } from './RouteDataProvider';
import { useWorldHandoff, useWorldState, WorldHandoffContext, WorldStateContext } from './WorldStateProvider';
import { initialQualityIndex, postPassesFrom, QUALITY_LADDER, resolveDpr } from '@/lib/route-world/quality';
import { buildPoseLedger, createPose, samplePath } from '@/lib/route-world/camera-path';
import { armFigureLoader, failedFigureLoads, meshoptWorkerFallback, vertexPromotionTotals } from './figures/figure-loader';
import FocusController from './focus/FocusController';
import EvidenceBridges from './EvidenceBridges';
import { focusStore } from './focus/focus-store';
import { getPostComposer, publishRouteTelemetry } from './post/post-store';
import {
  currentSceneGeneration,
  getGenerationBegunAt,
  getReadyDeadlineMs,
  markSceneFailed,
  getScenePhase,
  markScenePresented,
  SCENE_PRESENT_SETTLE_MS,
} from './world-readiness';
import { getFrameStats, recordFrame, resetFrameStats, type FrameStats } from './perf/frame-stats';
import { beginStatsFrame, installWarmStatsBridge, noteFrameRender, noteWarmStat, warmStatsOn } from './perf/warm-stats';
import {
  abortBallNow,
  assetLoadsInFlight,
  bindProgramsWarmSource,
  bindResidencySource,
  ceremonyRenderHold,
  getRevealArmedAt,
  noteCanvasMounted,
  noteLoadSignal,
  noteRenderedFrame,
  getBallPhase,
  getSceneProgress,
  hasBallLoader,
  loadStallInjected,
  noteRendererLive,
  noteWarmFrame,
  noteWarmStage,
  recordSceneMilestone,
  recordSceneWarm,
  revokeSceneWarm,
  scheduleAtWallClock,
  trackDefaultLoadingManager,
  type WarmFrameEntry,
} from './scene-progress';
import {
  captureThemeSwap,
  createLoadWarm,
  createLoadWarmIO,
  releaseThemeSwapRetention,
  settleThemeSwap,
  themeSwapRetention,
  VEILED_WARM,
  deferExternalUploads,
  describeDataFace,
  getProgramsWarm,
  LOAD_WARM_STAGES,
  loadWarmAllowsDraw,
  markLoadWarmComplete,
  postPassesToWarm,
  registeredWarmPostPasses,
  renderTargetsOf,
  stepLoadWarm,
  subscribeProgramsWarm,
  warmOutputsFor,
  type LoadWarmStage,
  type WarmPose,
} from './useStationWarmup';
import { outputPathFor } from './post/PostStack';
import { dataFaceEntries, getDataFaceLog, getResidencySnapshot, residencyComplete, subscribeResidency } from './residency-store';
import { completedPaints, facePaintFontLog, paintQueueIdle, subscribePaintQueue } from './paint-queue';
import { bandedUploadLog, verifyBandedUploads } from './content/banded-upload';
import { installPointLightLoop, pointLightCeiling } from './light-loop';
import RouteThemeVeil from './RouteThemeVeil';
import HoverChromePrimer from './HoverChromePrimer';
import { drawFrameRender, installSkeletonGuard, secondaryRendersDisabled } from './secondary-renders';
import {
  clearLeftoverFrames,
  createDrivenClock,
  createFrameCapState,
  driveClock,
  drivenClockSeconds,
  frameCapDuringCeremony,
  frameCapMode,
  frameCapReadout,
  FRAME_CAP_MODES,
  noteFrameCapCredit,
  noteFrameCapDriver,
  noteParkedFrame,
  onDrivenFrameloopChange,
  pinPhaseAdvance,
  requestedFrameCapMode,
  restartDrivenClock,
  setFrameCapMode,
  stepFrameCap,
  uncappedFrameMs,
  type FrameCapMode,
} from './frame-cap';
import { loadWorldManifest } from '@/lib/route-world/model-manifest';
import { hdriRoleFor, hdriUrlFor, type HdriRole } from '@/lib/route-world/world-env';
import { getThemeVeilPhase, registerThemeSwapHook, themeVeilHoldsWorldDraws } from './theme-veil-store';

// ENGINE r3: before any program compiles (the chunk loads with the canvas).
installPointLightLoop();
// ENGINE-A3 fix (D23 headroom): a frame's secondary world renders skip the
// skeleton update (see secondary-renders.ts).
installSkeletonGuard();

/**
 * W7 wobble latency (review r3): M2 (`noteRendererLive`, in `onCreated`)
 * is followed by the renderer's first frame, which compiles every program
 * in one long task (r2: the M2 wobble started 0.8–1.1 s after its rise,
 * while M1's landed within ~50 ms). Holding the first real render until the
 * browser has had one rendering opportunity lets the milestone's wobble
 * commit and start on the compositor first — it then plays through the
 * compile stall instead of after it. Frame callbacks still run while held;
 * only `gl.render` is skipped, for at most two animation frames, with the
 * canvas still at opacity 0 (inert until the handoff). After the hold the
 * wrapper is a counting pass-through (see below).
 */
function holdFirstRender(gl: THREE.WebGLRenderer, root: THREE.Object3D | null = null): void {
  const render = gl.render.bind(gl);
  // ENGINE-A3 fix: read once (dev A/B switch; always false in production).
  const fullSecondaries = secondaryRendersDisabled();
  // ENGINE-A4R: the per-frame work ledger (routeDebug only; perf/warm-stats.ts).
  const stats = warmStatsOn();
  // D23: the load warm's offscreen pose renders bypass the hold and the
  // draw counter (they are not frames).
  rawRenders.set(gl, render);
  // D23: draws start HELD for the load warm (the LoadWarmer releases them at
  // its frame stage, or at the handoff). Without this default the frames
  // between the renderer's creation and the warm's first step drew the whole
  // scene, linking every program synchronously on first use.
  setFrameHold(gl, 'warm', true);
  let held = true;
  // Wave-2 r2: the wrapper STAYS installed as a pass-through that counts real
  // draws (`drawnFrames`, M4's source). Restoring the renderer's own method
  // was also unsafe: a debug hook that wrapped `gl.render` inside the hold
  // window captured the held wrapper as its base and, when it uninstalled,
  // put a permanently held renderer back.
  drawCounts.set(gl, 0);
  gl.render = (scene, camera) => {
    // D23: the load warm's offscreen renders (post-pass warm) pass straight
    // through — not held, not counted as frames.
    if (rawScopes.has(gl)) {
      render(scene, camera);
      return;
    }
    if (held) return;
    // Wave-2 r2: the ceremony hold and the inert-canvas link hold, decided
    // once per frame (`heldFrames`).
    if (frameHeld(gl)) return;
    drawCounts.set(gl, (drawCounts.get(gl) ?? 0) + 1);
    lastDrawAt.set(gl, performance.now());
    // ENGINE-A3 fix (D23 headroom): the composer's repeat renders of the
    // world scene in one frame (N8AO's transparency renders) keep the first
    // render's matrices, shadow maps and bones (secondary-renders.ts).
    if (!stats) {
      drawFrameRender(gl, render, scene, camera, root, fullSecondaries);
      return;
    }
    const target = gl.getRenderTarget();
    const callsBefore = gl.info.render.calls;
    const started = performance.now();
    drawFrameRender(gl, render, scene, camera, root, fullSecondaries);
    const callsAfter = gl.info.render.calls;
    noteFrameRender(
      scene === root ? 'world' : scene.name || scene.type,
      target ? `${target.width}x${target.height}` : 'screen',
      performance.now() - started,
      callsAfter >= callsBefore ? callsAfter - callsBefore : callsAfter,
    );
  };
  const release = () => {
    held = false;
  };
  if (typeof window.requestAnimationFrame !== 'function') {
    release();
    return;
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(release));
  // A hidden or throttled document can starve rAF; the hold is a latency
  // nicety, never a gate, so a timer releases it too.
  window.setTimeout(release, 250);
}

/** Real `gl.render` draws since the renderer was created (see `holdFirstRender`). */
const drawCounts = new WeakMap<THREE.WebGLRenderer, number>();

/** The renderer's own `render`, bound, before the hold wrapper (D23 pose renders). */
const rawRenders = new WeakMap<THREE.WebGLRenderer, (scene: THREE.Object3D, camera: THREE.Camera) => void>();

/** Renderers inside a raw-render scope (`withRawRenders`). */
const rawScopes = new WeakSet<THREE.WebGLRenderer>();

/**
 * Run `fn` with every `gl.render` it makes bypassing the hold wrapper and the
 * draw counter (D23: the post-pass warm renders passes whose own internals
 * call `renderer.render`; they are offscreen warm work, not frames).
 */
function withRawRenders(gl: THREE.WebGLRenderer, fn: () => void): void {
  const nested = rawScopes.has(gl);
  rawScopes.add(gl);
  try {
    fn();
  } finally {
    if (!nested) rawScopes.delete(gl);
  }
}

function drawnFrames(gl: THREE.WebGLRenderer): number {
  return drawCounts.get(gl) ?? 0;
}

/** `performance.now()` of the last real draw per renderer. */
const lastDrawAt = new WeakMap<THREE.WebGLRenderer, number>();

/**
 * Renderers whose draws are held for the CURRENT frame, and why. Decided
 * ONCE per frame, before any other frame callback (`CeremonyRenderGate`, the
 * load warm's link check), so a post-processed frame is drawn whole or not
 * at all — never a composer pass without its screen blit.
 */
const heldFrames = new WeakMap<THREE.WebGLRenderer, { ceremony: boolean; warm: boolean }>();

/**
 * D23: a renderer with no recorded hold is HELD for the load warm — draws are
 * released only by the LoadWarmer (its frame stage, or the handoff). A
 * StrictMode / remount cleanup can drop the entry; the default keeps the
 * frames between that cleanup and the warm's next step from drawing the
 * whole scene (and linking every program synchronously on first use).
 */
function frameHeld(gl: THREE.WebGLRenderer): boolean {
  const held = heldFrames.get(gl);
  return held === undefined || held.ceremony || held.warm;
}

function setFrameHold(gl: THREE.WebGLRenderer, reason: 'ceremony' | 'warm', on: boolean): void {
  const held = heldFrames.get(gl) ?? { ceremony: false, warm: true };
  held[reason] = on;
  heldFrames.set(gl, held);
}

/**
 * D38 frame-cap window (see frame-cap.ts): after the reveal — the ball done
 * (or no ball) and no theme veil up — or, with the dev switch
 * `?routeFrameCapCeremony=1`, from the first frame.
 */
function frameCapWindowOpen(): boolean {
  if (frameCapDuringCeremony()) return true;
  if (getThemeVeilPhase() !== 'idle') return false;
  return !hasBallLoader() || getBallPhase() === 'done';
}

type FrameCapHost = Window & {
  __routeFrameCap?: { readout: () => ReturnType<typeof frameCapReadout>; set: (mode: FrameCapMode) => boolean };
};

/**
 * D38 / D40 frame-cap driver (ENGINE-A4; frame-cap.ts). Mounted unless the page
 * opted out (`?routeFrameCap=off`; D40: `even40` is the default): the canvas
 * then runs r3f's `frameloop="never"` and this rAF advances it — every rAF
 * inside the
 * ceremony, and after the reveal only the frames the mode keeps. A skipped rAF
 * does the cap's bookkeeping and nothing else. The r3f clock is advanced on
 * the rAF timestamp from the driver's start (seconds), so frame deltas and
 * elapsed time stay continuous. Debug / dev: `window.__routeFrameCap`.
 */
function FrameCapDriver({ enabled }: { enabled: boolean }) {
  const get = useThree((state) => state.get);
  /**
   * The driven clock, kept across park / unpark (ENGINE-A4R, verify-a4: a
   * run that restarted at 0 handed r3f a negative delta and rewound every
   * clip mixer). See `driveClock` in frame-cap.ts.
   */
  const [clock] = useState(createDrivenClock);
  const store = useStore();
  /**
   * ENGINE-A5 fix (verify-a5: an unpark handed every mixer a ~29,584 s delta).
   * r3f's own rAF loop must never advance this root under `never`: the
   * listener runs synchronously inside r3f's `setFrameloop` (before any rAF),
   * clears the parked `demand` loop's leftover frames and keeps the clock
   * continuous across park / unpark (`onDrivenFrameloopChange`). Mounted for
   * the canvas's life, parked or not.
   */
  useLayoutEffect(() => {
    clearLeftoverFrames(store.getState());
    return store.subscribe((next, previous) => {
      if (next.frameloop !== previous.frameloop) onDrivenFrameloopChange(clock, next, previous.frameloop, performance.now());
    });
  }, [clock, store]);
  // Parked (`demand`) frames: the clock the unpark resumes from.
  useFrame((root) => {
    if (root.frameloop !== 'never') noteParkedFrame(clock, root.clock.elapsedTime, performance.now());
  });
  useEffect(() => {
    if (!enabled) return;
    const state = createFrameCapState();
    noteFrameCapDriver(true, state, clock);
    clearLeftoverFrames(get());
    restartDrivenClock(clock);
    let raf = 0;
    const tick = (ts: number) => {
      raf = window.requestAnimationFrame(tick);
      const root = get();
      // Every rAF, rendered or skipped: r3f's loop never runs this root under `never`.
      clearLeftoverFrames(root);
      if (!stepFrameCap(state, ts, frameCapMode(), frameCapWindowOpen())) return;
      noteFrameCapCredit(state.creditMs);
      const { seconds, seat } = driveClock(clock, ts, root.clock.elapsedTime);
      if (seat !== null) root.clock.elapsedTime = seat;
      root.advance(seconds, true);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      noteFrameCapDriver(false, null);
    };
  }, [clock, enabled, get]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && new URLSearchParams(window.location.search).get('routeDebug') !== '1') return;
    const host = window as FrameCapHost;
    host.__routeFrameCap = {
      readout: frameCapReadout,
      set: (mode: FrameCapMode) => {
        if (!FRAME_CAP_MODES.includes(mode)) return false;
        setFrameCapMode(mode);
        return true;
      },
    };
    return () => {
      delete host.__routeFrameCap;
    };
  }, []);
  return null;
}

/**
 * ENGINE-A4R (routeDebug only): opens each frame's record in the work ledger
 * (perf/warm-stats.ts) before any other frame callback, and publishes
 * `window.__routeWarmStats` for the capture harness.
 */
function WarmStatsFrames() {
  useEffect(() => installWarmStatsBridge(), []);
  useFrame(() => beginStatsFrame(performance.now()), -100000);
  return null;
}

/**
 * Ceremony render hold (wave-2 r2, W7 compositor-freeze veto — see
 * scene-progress `ceremonyRenderHold`): from the arm until shortly after the
 * ball is done the renderer does not draw, so no upload or program link of
 * content that streamed in late shares the GPU process with the CSS beam.
 * The canvas the ceremony fades in keeps its last drawn frame (the camera is
 * parked on the first station). Never before the renderer has drawn once.
 */
function CeremonyRenderGate() {
  const gl = useThree((state) => state.gl);
  useFrame(() => {
    // ENGINE-FIX (D32): also while the theme veil closes over the world.
    setFrameHold(gl, 'ceremony', drawnFrames(gl) > 0 && (ceremonyRenderHold(performance.now()) || themeVeilHoldsWorldDraws()));
  }, -2000);
  useEffect(
    () => () => {
      // Only the ceremony's own reason: the warm hold belongs to the LoadWarmer.
      setFrameHold(gl, 'ceremony', false);
    },
    [gl],
  );
  return null;
}

function SkyClear() {
  const { palette } = useWorldState();
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    gl.setClearColor(palette.sky, 1);
    gl.setClearAlpha(1);
  }, [gl, palette.sky]);

  return null;
}

/**
 * The readiness handshake's scene side: report `presented` once the renderer
 * has actually painted and the settle window has elapsed.
 *
 * Mounted INSIDE `<Canvas>`, so this only runs while a live renderer exists.
 * Two details matter:
 *
 * - The settle window is WALL CLOCK, not a frame count. A parked tab and the
 *   capture harness's embedded browser both run the frameloop on `demand`,
 *   where frames only happen on invalidate — counting frames there would never
 *   reach a threshold, and the harness records the effective tier from the very
 *   class this gate controls.
 * - The first frame is requested explicitly, for the same reason: in demand
 *   mode nothing would otherwise kick the render that starts the clock.
 *   ENGINE-A5 (D40): under the default `never` loop the request is a no-op
 *   and FrameCapDriver's rAF draws every frame of the ceremony (uncapped).
 *
 * The generation guard is what stops an abandoned scene — a theme switch or a
 * navigation that completed mid-stream — from presenting itself as the new
 * world's first usable frame.
 */
function SceneReadinessReporter() {
  /**
   * The generation this reporter has already vouched for. Read inside a frame
   * callback, NEVER at mount render: the provider begins its generation in a
   * passive effect, which runs after this component's render, so a render-time
   * capture is one generation stale whenever the scene chunk is already
   * resolved (a retry, a cached soft navigation) — the settle callback would
   * refuse `markScenePresented()` forever, `HideHtmlOnRoute` would never
   * commit, and the 10 s deadline would kill a healthy scene (PR #63 review).
   * Frame callbacks run after the full passive-effect flush, so this always
   * sees the provider's bump.
   */
  const presented = useRef<number | null>(null);
  /**
   * The pending settle (generation it was armed for + its cancel). Review
   * wave-2 r2 (clouds never presented): a plain `setTimeout` settle was
   * armed and NEVER fired on clouds-1440 while the frame loop kept ticking at
   * 60 fps for 20 s — the page sat in `loading` until the readiness deadline
   * sent it to Lite. The settle is now `scheduleAtWallClock` (a timeout AND a
   * per-frame wall-clock check, whichever observes the target first — the
   * same bound the reveal gate uses), and the frame callback below re-checks
   * the due time itself, so a starved or lost timer can no longer strand a
   * painted scene.
   */
  const settle = useRef<{ generation: number; dueAt: number; cancel: () => void } | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const gl = useThree((state) => state.gl);

  const present = useCallback((armed: number) => {
    settle.current?.cancel();
    settle.current = null;
    // A theme switch or a retry bumped the generation mid-settle, so this
    // scene is no longer the one on screen and must not vouch for itself.
    // Returning WITHOUT recording the refusal is what keeps the handshake
    // alive: the next painted frame re-arms against the live generation
    // (PR #63 review).
    if (armed !== currentSceneGeneration() || presented.current === armed) return;
    presented.current = armed;
    markScenePresented();
  }, []);

  const armSettle = useCallback(() => {
    const armed = currentSceneGeneration();
    const pending = settle.current;
    if (pending !== null) {
      if (pending.generation === armed) {
        // Frame-clock backstop for the scheduled settle.
        if (performance.now() >= pending.dueAt) present(armed);
        return;
      }
      pending.cancel();
      settle.current = null;
    }
    if (presented.current === armed) return;
    const dueAt = performance.now() + SCENE_PRESENT_SETTLE_MS;
    settle.current = { generation: armed, dueAt, cancel: () => {} };
    const cancel = scheduleAtWallClock(dueAt, () => present(armed));
    if (settle.current !== null && settle.current.generation === armed) settle.current.cancel = cancel;
    else cancel();
  }, [present]);

  useEffect(() => {
    invalidate();
  }, [invalidate]);

  useFrame(() => {
    // M4 for the loader (W7): the first painted frame of THIS generation.
    // Idempotent per generation in the store, and read inside the frame
    // callback for the same staleness reason as `presented` above.
    // Review r5 (wobble alignment): recorded only once the renderer has
    // actually DRAWN a frame — i.e. on the tick after the first render.
    // Wave-2 r2: counted by the render hold's own draw counter
    // (`drawnFrames`), NOT `info.render.frame`: the debug TelemetrySampler
    // used to zero `info.render.frame` every tick, so under `routeDebug=1`
    // this callback always read 0 and M4 only rose through the `presented`
    // fallback. The draw counter stays the source either way.
    if (drawnFrames(gl) > 0) {
      recordSceneMilestone(currentSceneGeneration(), 'firstFrame');
    }
    // Two-phase handoff (W7 r3): the sections hide only after the renderer
    // drew a frame under the fully composited canvas.
    noteRenderedFrame();
    armSettle();
  });

  useEffect(
    () => () => {
      settle.current?.cancel();
      settle.current = null;
    },
    [],
  );

  return null;
}

/**
 * While the warm is done and the canvas is still inert (drawn once, not yet
 * armed, opacity 0 under the page) it draws at most once per this many ms:
 * enough to keep the scene state fresh before the reveal, without a
 * full-rate invisible render competing with the compositor (wave-2 r2).
 */
export const LOAD_INERT_DRAW_MS = 200;

/** ENGINE r4: how often a settled-but-unarmed warm re-checks the scene for work it has not seen. */
export const WARM_RECHECK_MS = 100;
/** ENGINE r4: re-warms for new materials per generation (faces are not capped). */
export const WARM_MAX_REWARMS = 4;

/**
 * The load warm ceremony (D23 "complete at reveal", LOOK-PLAN §2 G3): the
 * frame-driven host of `stepLoadWarm` (useStationWarmup — the ordered stages,
 * their slices and the registries live there). Once per frame, before any
 * other frame callback draws, while the canvas is inert (before the arm):
 *
 * - one slice of the current warm stage runs (compile → shadows → textures →
 *   passes → poses → frame → settle), never a whole-scene batch — on the
 *   ANGLE box a large synchronous compile or upload stalls the GPU process
 *   and freezes even the CSS ceremony;
 * - the milestones rise as the stages land (`compiled`, `uploaded`), the
 *   warm settle is recorded (`recordSceneWarm`, the reveal gate's input),
 *   and every slice reports its progress to the stall detector;
 * - the canvas's real draws are HELD until the warm reaches its `frame`
 *   stage (a draw before then would link programs synchronously on first
 *   use); after the warm, inert draws are paced (`LOAD_INERT_DRAW_MS`).
 *
 * The content it waits for is complete when the assets milestone rose AND
 * the residency relay reports every population resident. From the arm the
 * ceremony hold owns the draws; from the handoff (`world-route-live`) the
 * warm is over for good — the compile guard stays as the (idle) safety net.
 */
type LoadWarmHost = Window & {
  __routeLoadWarm?: () => Record<string, unknown>;
  /**
   * ROLLOUT-PLAN §3.2 E5 (`?routeDebug=1`): programs first linked AFTER this
   * generation's reveal arm (the ball's `opening`). Every program a world
   * draws must be linked by the warm before it: `lateLinks` must be 0.
   */
  __warmAudit?: () => { generation: number; armed: boolean; programsAtArm: number | null; lateLinks: number; late: string[] };
  /** ROLLOUT-PLAN §3.2 E3 (`?routeDebug=1`): the banded face uploads, and a texel-exact readback check. */
  __routeBandedUploads?: { log: () => ReturnType<typeof bandedUploadLog>; verify: () => ReturnType<typeof verifyBandedUploads> };
  /** `?routeDebug=1`: every program's cache key and the warm stage it first appeared in. */
  __routeLoadWarmPrograms?: () => { stage: string; name: string; key: string }[];
};

/**
 * Whether the last veiled warm step moved the load on (its progress counters
 * rose). A step that did not (links still in flight, a face not painted yet)
 * ends the frame's step loop, so a waiting stage never spins.
 */
const veiledProgress = new WeakMap<object, string>();
function veiledStepMoved(io: { report: () => Record<string, unknown>; programCount: () => number }): boolean {
  const r = io.report();
  const mark = [r.compiledVariants, r.uploads, r.poses, r.passes, r.verifyPasses, r.buffers, r.bandSteps, r.faceUploads, r.targetsCleared, io.programCount()].join(',');
  const moved = veiledProgress.get(io) !== mark;
  veiledProgress.set(io, mark);
  return moved;
}

/** HDRI URLs already prefetched this page life (one request each, ever). */
const prefetchedHdris = new Set<string>();

/**
 * ENGINE-FIX (D32 allowance: "prefetching the other theme's HDRI bytes during
 * the load ceremony"). While the FIRST generation loads — never after its
 * reveal arm — the other palette's HDRI file is fetched into the HTTP cache
 * (bytes only: no decode, no texture, no PMREM; those stay behind the veil
 * of a later swap). The swap's own load then revalidates instead of
 * downloading. Once per URL per page life, low priority, errors ignored.
 */
function OtherPaletteHdriPrefetch() {
  const { palette, theme } = useWorldState();
  const role = hdriRoleFor(palette.exposure);
  const format = theme?.hdriFormat ?? 'radiance';
  useEffect(() => {
    if (getRevealArmedAt() !== null) return;
    let cancelled = false;
    const other: HdriRole = role === 'night' ? 'gold' : 'night';
    loadWorldManifest()
      .then((manifest) => {
        if (cancelled || getRevealArmedAt() !== null) return;
        // The palette's own file is loaded by WorldEnvironment: never fetched here.
        prefetchedHdris.add(hdriUrlFor(manifest, role, format));
        const url = hdriUrlFor(manifest, other, format);
        if (prefetchedHdris.has(url)) return;
        prefetchedHdris.add(url);
        return fetch(url, { credentials: 'same-origin', priority: 'low' } as RequestInit)
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .catch(() => null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
    // Once per mount and palette side: the swap's own generation arms later.
  }, [role, format]);
  return null;
}

/** ENGINE-FIX (D32): the longest a veiled swap's compile waits for the environment to return. */
export const VEILED_ENV_WAIT_MS = 5000;

/** The name every pad light carries (ENGINE-FIX, D32). */
export const POINT_LIGHT_PAD_NAME = 'route-point-light-pad';

/** Point lights a draw through `camera` counts (visible, on its layers), pads excluded. */
function realPointLights(scene: THREE.Object3D, camera: THREE.Camera): number {
  let count = 0;
  scene.traverseVisible((object) => {
    const light = object as THREE.PointLight;
    if (light.isPointLight !== true || object.name === POINT_LIGHT_PAD_NAME) return;
    if (!object.layers.test(camera.layers)) return;
    count += 1;
  });
  return count;
}

/**
 * ENGINE-FIX (D32; the plaza lights 20 point lights by day, 27 at night).
 * `NUM_POINT_LIGHTS` is a program key, so a palette swap that changes the
 * count re-links every lit program (the plaza's first day→night swap: ~100
 * links, a 3-4 s veil). From the FIRST load on, dark pads (intensity 0, no
 * shadow, on every layer, far below the world) fill the scene's point-light
 * count up to a stable ceiling (`pointLightCeiling`: the next power of two,
 * never lowered), so both palettes share one set of programs and no swap
 * links a program for its lights. A pad adds exactly zero light and the
 * point-light loop skips it (`POINT_LOOP_SKIP`, light-loop.ts): pixels are
 * unchanged, a pad costs one uniform compare per fragment.
 */
function syncPointLightPad(scene: THREE.Scene, pads: THREE.PointLight[], want: number): void {
  while (pads.length > want) pads.pop()?.removeFromParent();
  while (pads.length < want) {
    const pad = new THREE.PointLight(0x000000, 0, 1, 2);
    pad.name = POINT_LIGHT_PAD_NAME;
    pad.castShadow = false;
    pad.position.set(0, -10_000, 0);
    pad.layers.enableAll();
    pad.matrixAutoUpdate = false;
    pad.updateMatrix();
    scene.add(pad);
    pad.updateMatrixWorld(true);
    pads.push(pad);
  }
}

function LoadWarmer({ startQualityIndex }: { startQualityIndex: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const { theme, mobile, debug } = useWorldState();
  const frameCheck = useRef<(() => void) | null>(null);

  useEffect(() => {
    let stopped = false;
    let generation = currentSceneGeneration();
    let machine = createLoadWarm();
    let lastStage: LoadWarmStage | null = null;
    let compileOpenNoted = false;
    let drawsAtRequest = 0;
    let lastStepMs = 0;
    let lastRecheckAt = 0;
    let rewarms = 0;
    const needed = postPassesFrom(startQualityIndex);
    // ENGINE r3: every output path the start rung and the rungs below it draw
    // (the governor only steps down): the start rung's first.
    const outputs = warmOutputsFor(QUALITY_LADDER.slice(startQualityIndex).map((step) => outputPathFor(step)));
    const stations = theme?.stations ?? [];
    const ledger = stations.length > 0 ? buildPoseLedger(stations, mobile) : null;

    const traceOn = debug || new URLSearchParams(window.location.search).get('routeTrace') === '1';
    // ENGINE-FIX (D32): a day/night swap under the theme veil. The hook runs
    // behind the opaque veil right before the swap commits: the leaving
    // palette's programs are kept alive through the commit (its successors
    // compile from three's cache), and its point-light count (pads included)
    // is a floor for the pad target (`syncPointLightPad`), so the arriving
    // palette keeps every key.
    let swapToKey: string | null = null;
    let swapGeneration: number | null = null;
    let padTarget = 0;
    const pads: THREE.PointLight[] = [];
    const veiled = () => getThemeVeilPhase() !== 'idle';
    // ENGINE-FIX (D32): the swap's environment. drei's <Environment> clears
    // `scene.environment` while the new palette's HDRI loads (its boundary
    // re-suspends; the load is not a tracked asset), so a world that had an
    // environment before the swap compiles nothing until it has one again —
    // an env-less variant compiled in that gap is linked for nothing and,
    // behind the veil (no eviction), kept for the page's life (sakura: +50
    // programs). Bounded: a lost environment never holds the warm past
    // VEILED_ENV_WAIT_MS (the deadline and the stall detector stay in charge).
    let swapEnvSince: number | null = null;
    const swapEnvPending = (): boolean => {
      if (swapEnvSince === null) return false;
      if (scene.environment !== null || performance.now() - swapEnvSince > VEILED_ENV_WAIT_MS) {
        swapEnvSince = null;
        return false;
      }
      return true;
    };
    const stopSwapHook = registerThemeSwapHook(({ fromKey, toKey }) => {
      captureThemeSwap(scene, fromKey ?? 'unknown');
      swapToKey = toKey;
      swapGeneration = null;
      padTarget = Math.max(padTarget, realPointLights(scene, camera) + pads.length);
      swapEnvSince = scene.environment !== null ? performance.now() : null;
    });
    const io = createLoadWarmIO({
      gl,
      scene,
      camera,
      veiled,
      gpuTiming: traceOn,
      contentComplete: () => {
        const progress = getSceneProgress();
        return (
          !swapEnvPending() &&
          worldStaged(gl) &&
          paintQueueIdle() &&
          !assetLoadsInFlight() &&
          progress.generation === currentSceneGeneration() &&
          progress.assets &&
          progress.resident
        );
      },
      // ENGINE r2: the compile starts once the content is complete (assets
      // idle AND every population resident): populations bring lights and the
      // environment, and a program compiled before them is the wrong variant
      // (evicting it costs a GPU-process stall while it is still linking).
      compileReady: () => {
        const progress = getSceneProgress();
        return (
          !swapEnvPending() &&
          worldStaged(gl) &&
          paintQueueIdle() &&
          !assetLoadsInFlight() &&
          progress.generation === currentSceneGeneration() &&
          progress.assets &&
          progress.resident
        );
      },
      poses: () => {
        if (ledger === null) return [];
        const aspect = gl.domElement.width / Math.max(1, gl.domElement.height);
        const poses: WarmPose[] = [];
        for (let index = 0; index < stations.length; index += 1) {
          poses.push(samplePath(ledger, index, aspect, createPose()));
        }
        return poses;
      },
      rawRender: (target, view) => {
        const render = rawRenders.get(gl);
        if (!render) return;
        const started = warmStatsOn() ? performance.now() : 0;
        render(target, view);
        if (started > 0) noteWarmStat('poseRenders', 1, performance.now() - started);
      },
      requestFrame: () => {
        drawsAtRequest = drawnFrames(gl);
      },
      frameDrawn: () => drawnFrames(gl) > drawsAtRequest,
      screenMaterials: () => {
        const composer = getPostComposer() as unknown as {
          passes?: { renderToScreen?: boolean; fullscreenMaterial?: THREE.Material | null }[];
        } | null;
        const out: THREE.Material[] = [];
        for (const pass of composer?.passes ?? []) {
          if (pass.renderToScreen === true && pass.fullscreenMaterial) out.push(pass.fullscreenMaterial);
        }
        return out;
      },
      passes: () =>
        postPassesToWarm(registeredWarmPostPasses(), needed).map((entry) => {
          const warm = entry.warm;
          return warm === undefined ? entry : { ...entry, warm: () => withRawRenders(gl, warm) };
        }),
      signal: (name, value) => noteLoadSignal(currentSceneGeneration(), name, value),
      outputs: () => outputs,
      // ENGINE r4: the composer's full-size targets are allocated and
      // zero-initialised in the warm, one per step, not by the first real frame.
      renderTargets: () => {
        const composer = getPostComposer();
        return composer ? renderTargetsOf(composer) : [];
      },
      // ENGINE r4: the painted data faces are a reveal precondition of their own.
      faces: () =>
        dataFaceEntries().map((entry) => {
          const readout = entry.read();
          return { id: entry.id, painted: readout.painted, object: readout.object, textures: readout.textures };
        }),
    });

    const programList = (): unknown[] => (gl.info as unknown as { programs?: unknown[] | null }).programs ?? [];
    const programCount = (): number => programList().length;
    // ROLLOUT-PLAN §3.2 E5: programs that appear after the reveal arm.
    const lateAudit: { generation: number; programsAtArm: number | null; known: Set<unknown>; seen: number; late: string[] } = {
      generation,
      programsAtArm: null,
      known: new Set(),
      seen: -1,
      late: [],
    };
    const auditLateLinks = () => {
      const list = programList();
      if (lateAudit.generation !== generation) {
        lateAudit.generation = generation;
        lateAudit.programsAtArm = null;
        lateAudit.known = new Set();
        lateAudit.seen = -1;
        lateAudit.late = [];
      }
      if (lateAudit.programsAtArm === null) {
        lateAudit.programsAtArm = list.length;
        lateAudit.known = new Set(list);
        lateAudit.seen = list.length;
        return;
      }
      if (list.length === lateAudit.seen) return;
      lateAudit.seen = list.length;
      for (const program of list) {
        if (lateAudit.known.has(program)) continue;
        lateAudit.known.add(program);
        const named = program as { name?: string; cacheKey?: string };
        if (lateAudit.late.length < 64) lateAudit.late.push(named.name ?? named.cacheKey?.slice(0, 80) ?? 'program');
        else lateAudit.late.push('…');
      }
    };
    // ENGINE r3: every face the paint queue drains is load progress.
    const stopPaintSignal = subscribePaintQueue(() =>
      noteLoadSignal(currentSceneGeneration(), 'paints', completedPaints()),
    );
    // ENGINE r2: outside `initTexture` batches (drei's texture hooks) join
    // the warm's sliced upload queue while the load runs.
    const stopDeferring = deferExternalUploads(gl);

    // `?routeDebug=1` only: the warm's live state for probes and the harness.
    const host = window as LoadWarmHost;
    if (debug) {
      host.__routeLoadWarm = () => ({
        generation,
        stage: machine.stage,
        frames: machine.frames,
        compiled: machine.compiled,
        uploaded: machine.uploaded,
        warm: machine.warm,
        held: frameHeld(gl),
        holds: { ...(heldFrames.get(gl) ?? {}) },
        drawn: drawnFrames(gl),
        stepMs: Math.round(lastStepMs * 10) / 10,
        programs: programCount(),
        rewarms,
        faceLog: getDataFaceLog(),
        swap: { ...themeSwapRetention(), padTarget, pads: pads.length },
        ...io.report(),
      });
      host.__routeLoadWarmPrograms = () => io.programOrigins();
      host.__warmAudit = () => ({
        generation,
        armed: lateAudit.generation === generation && lateAudit.programsAtArm !== null,
        programsAtArm: lateAudit.generation === generation ? lateAudit.programsAtArm : null,
        lateLinks: lateAudit.generation === generation ? lateAudit.late.length : 0,
        late: lateAudit.generation === generation ? [...lateAudit.late] : [],
      });
      host.__routeBandedUploads = { log: bandedUploadLog, verify: () => verifyBandedUploads(gl) };
    }

    frameCheck.current = () => {
      if (stopped) return;
      const current = currentSceneGeneration();
      if (current !== generation) {
        // A new attempt on the same renderer: its own ordered pass (cached
        // programs come back from three's cache at no cost). ENGINE r3: this
        // includes a day/night palette swap AFTER a reveal — the new
        // palette's content is held and warmed like the first load.
        generation = current;
        if (swapToKey !== null) swapGeneration = current;
        machine = createLoadWarm();
        lastStage = null;
        compileOpenNoted = false;
        lastRecheckAt = 0;
        rewarms = 0;
      }
      if (getRevealArmedAt() !== null) {
        if (debug) auditLateLinks();
        // The ceremony, then the live world: the gate only armed a complete
        // world; the ceremony hold owns the draws from the arm, and from the
        // handoff the station warmup and the compile guard own the GPU work.
        // ENGINE r3: not a permanent stop — a later generation (palette
        // swap) re-enters the warm above.
        setFrameHold(gl, 'warm', false);
        return;
      }
      const phase = getScenePhase();
      if (phase !== 'loading' && phase !== 'presented') {
        setFrameHold(gl, 'warm', true);
        return;
      }
      // ENGINE r2: the deadline is checked on the wall clock at every slice.
      // Past it the attempt is going to Lite: no further GPU work competes
      // with the fallback (the provider's own wall-clock check flips it).
      if (performance.now() - getGenerationBegunAt() > getReadyDeadlineMs() || loadStallInjected()) {
        setFrameHold(gl, 'warm', true);
        return;
      }
      if (machine.stage === 'done' && performance.now() - lastRecheckAt >= WARM_RECHECK_MS) {
        // ENGINE r4 (CAR r3 veto): the warm settled, but the arm has not
        // happened yet. Anything that changed since — a data face repainting
        // (its pages back to null, then a new panel material), a population
        // mounting a material the warm never compiled — re-runs the warm, and
        // the generation is not warm until it settles again.
        lastRecheckAt = performance.now();
        const fresh = io.collect();
        const faces = io.facesSlice();
        // Bounded for new materials (a component that re-creates its
        // material on every render would otherwise re-warm forever — the
        // deadline would end it); a face that is not ready always waits.
        if ((fresh > 0 && rewarms < WARM_MAX_REWARMS) || faces > 0) {
          revokeSceneWarm(generation);
          machine = { ...createLoadWarm(), compiled: machine.compiled, uploaded: machine.uploaded };
          lastStage = null;
          rewarms += 1;
          noteWarmStage(generation, `rewarm:${fresh}v/${faces}f`, programCount());
        }
      }
      // ENGINE-FIX (D32): every generation (the first load included) keeps
      // the point-light count at its ceiling — before the warm collects this
      // frame, so the compile never sees an unpadded count.
      const realLights = realPointLights(scene, camera);
      padTarget = Math.max(padTarget, pointLightCeiling(realLights));
      syncPointLightPad(scene, pads, Math.max(0, padTarget - realLights));
      if (machine.stage !== 'done') {
        const stepStarted = performance.now();
        machine = stepLoadWarm(machine, io);
        // ENGINE-FIX (D32): behind the opaque veil several steps per frame
        // (`VEILED_WARM`) — but never while the compile waits for its content
        // (the main thread belongs to the swap's commit and the HDRI decode
        // then), and never through `frame` (a real frame must be drawn).
        if (veiled()) {
          while (
            performance.now() - stepStarted < VEILED_WARM.frameBudgetMs &&
            machine.stage !== 'done' &&
            machine.stage !== 'frame' &&
            machine.stage !== 'settle' &&
            (machine.stage !== 'compile' || io.compileGateOpen())
          ) {
            const before = machine;
            machine = stepLoadWarm(machine, io);
            // A step that moved nothing (links in flight, a gate) ends the frame.
            if (machine.stage === before.stage && !veiledStepMoved(io)) break;
          }
        }
        lastStepMs = performance.now() - stepStarted;
        if (traceOn) {
          const stats = io.frameStats();
          const entry: WarmFrameEntry = {
            t: Math.round(stepStarted),
            stage: machine.stage,
            stepMs: Math.round(lastStepMs * 10) / 10,
            frameMs: stats.frameMs,
            programs: programCount(),
            cap: stats.cap,
          };
          noteWarmFrame(entry);
          // ENGINE r5: the step's GPU time lands on the entry when it resolves.
          io.bindGpuSink(entry);
        }
        if (machine.stage !== lastStage) {
          lastStage = machine.stage;
          noteWarmStage(generation, machine.stage, programCount());
          noteLoadSignal(generation, 'warmStage', LOAD_WARM_STAGES.indexOf(machine.stage) + 1);
        }
        if (!compileOpenNoted && io.compileOpenedAt() !== null) {
          // Trace: when the content turned complete and the compile began.
          compileOpenNoted = true;
          noteWarmStage(generation, 'compile-open', programCount());
        }
        if (machine.compiled) recordSceneMilestone(generation, 'compiled');
        if (machine.uploaded) recordSceneMilestone(generation, 'uploaded');
        if (machine.warm && recordSceneWarm(generation)) markLoadWarmComplete(gl, scene, camera);
      }
      // ENGINE-FIX (D32): the swap's generation is warm — every successor
      // compiled against the kept programs — still behind the veil: close the
      // capture (the left palette's materials are kept for the way back).
      if (machine.warm && swapToKey !== null && swapGeneration === generation) {
        const settled = settleThemeSwap(scene, swapToKey);
        if (traceOn) noteWarmStage(generation, `swap-settle:${settled.kept}k/${settled.released}r`, programCount());
        swapToKey = null;
        swapGeneration = null;
      }
      const sinceDraw = performance.now() - (lastDrawAt.get(gl) ?? -Infinity);
      const paced = machine.stage === 'done' || machine.stage === 'settle';
      const hold = !loadWarmAllowsDraw(machine) || (paced && sinceDraw < LOAD_INERT_DRAW_MS);
      setFrameHold(gl, 'warm', hold);
    };

    return () => {
      stopped = true;
      frameCheck.current = null;
      stopSwapHook();
      releaseThemeSwapRetention();
      for (const pad of pads) pad.removeFromParent();
      pads.length = 0;
      // Not released here: a StrictMode / dependency re-run re-installs the
      // check at once, and an unmounting canvas draws nothing anyway.
      io.dispose();
      stopDeferring();
      stopPaintSignal();
      if (debug) {
        delete host.__routeLoadWarm;
        delete host.__routeLoadWarmPrograms;
        delete host.__warmAudit;
        delete host.__routeBandedUploads;
      }
    };
  }, [gl, scene, camera, theme, mobile, startQualityIndex, debug]);

  useFrame(() => {
    frameCheck.current?.();
  }, -1500);

  return null;
}

/**
 * ENGINE r3 (CAR r2: the ball froze 0.8-1.1 s right after the renderer
 * milestone): the world's scene tree mounts in STAGES, never in the canvas's
 * first commit. R3F renders its children at the default lane, which React
 * never time-slices, so the whole tree's render (every component, every
 * geometry built in a memo) ran as one 0.8 s task on dev, and its passive
 * effects as a second 0.3-0.4 s task. Here the renderer's first commit
 * carries only the engine's own components; the world's top-level children
 * then mount one per transition (`startTransition` renders are time-sliced
 * in R3F's concurrent root, so the render phase yields every few ms), and
 * each child commits and flushes its effects on its own.
 *
 * The load warm treats the content as incomplete until the last child has
 * committed (`worldStaged`), so no compile, warm settle or reveal can happen
 * over a partly mounted tree. Every stage is a stall-detector signal.
 */
const stagedWorlds = new WeakMap<THREE.WebGLRenderer, boolean>();

/** Every top-level world child has committed for this renderer. */
export function worldStaged(gl: THREE.WebGLRenderer): boolean {
  return stagedWorlds.get(gl) === true;
}

function StagedWorld({ children }: { children: ReactNode }) {
  const gl = useThree((state) => state.gl);
  // ENGINE r4 (quiet probe: 51-88 ms governor-step tasks; a 100+ ms task at
  // the arm): `Children.toArray` clones every child to key it, so each
  // re-render of the canvas (the handoff flags at the arm, every governor
  // step) handed React NEW elements for the whole world and it re-rendered
  // every component in it. Memoised on the `children` prop — the world's
  // Scene elements, stable across those re-renders — React bails out and only
  // the context consumers (the handoff, the quality rung) re-render.
  const items = useMemo(() => Children.toArray(children), [children]);
  const total = items.length;
  const [count, setCount] = useState(0);
  useEffect(() => {
    noteLoadSignal(currentSceneGeneration(), 'staged', count + 1);
    if (count >= total) {
      stagedWorlds.set(gl, true);
      return;
    }
    stagedWorlds.set(gl, false);
    startTransition(() => setCount((current) => Math.max(current, count + 1)));
  }, [count, total, gl]);
  useEffect(
    () => () => {
      stagedWorlds.delete(gl);
    },
    [gl],
  );
  return <>{items.slice(0, count)}</>;
}

/**
 * D23: relays seat R's residency store (`residency-store.ts`, scene chunk)
 * into the progress store the provider reads (`bindResidencySource`), for as
 * long as this canvas lives.
 */
function ResidencyBridge() {
  useEffect(
    () =>
      bindResidencySource({
        complete: residencyComplete,
        subscribe: subscribeResidency,
        // Committed populations (a stall-detector progress count; high-water).
        progress: () => {
          const snapshot = getResidencySnapshot();
          return snapshot.registered - snapshot.pending;
        },
      }),
    [],
  );
  return null;
}

/**
 * M3 for the loader (W7): chains THREE's default loading manager for as long
 * as this canvas lives and restores the previous handlers on unmount.
 *
 * A LAYOUT effect on purpose: R3F calls `onCreated` from its root provider's
 * layout effect, which runs after every child's — so the chain is installed
 * before `armFigureLoader` flushes the queued GLB preloads and their
 * `onStart` is observed rather than missed.
 */
function LoadProgressBridge() {
  useLayoutEffect(() => trackDefaultLoadingManager(), []);
  return null;
}

type FrameStatsHost = Window & {
  __routeWorldFrameStats?: () => FrameStats;
};

/**
 * Always-on frame-time recorder for the D1 percentile budgets.
 *
 * Not debug-gated: one ring-buffer write per frame costs far less than the
 * render it measures, and a budget that only exists behind a query param never
 * gets measured on a real device. Published on the same window-bridge
 * convention as `__routeWorldPresent` and `__routeWorldRenderPath`, so a perf
 * trace can read percentiles without driving any UI.
 */
function FrameStatsRecorder() {
  useFrame((_, delta) => {
    // D38: a frame the cap skipped on purpose is not a slow frame.
    recordFrame(uncappedFrameMs(delta * 1000));
  });

  useEffect(() => {
    const host = window as FrameStatsHost;
    host.__routeWorldFrameStats = getFrameStats;
    return () => {
      delete host.__routeWorldFrameStats;
      resetFrameStats();
    };
  }, []);

  return null;
}

type PresentedFrame = {
  width: number;
  height: number;
  dataUrl: string;
};

type PresentHost = Window & {
  __routeWorldPresent?: () => PresentedFrame | null;
};

/**
 * C-045: snapshot of which render path produced a frame — the capture harness
 * stamps this into every pose sidecar (`renderPath` in capture-route.mjs) so a
 * still's build state is provable from the sidecar alone: kit modules vs the
 * procedural writer, and whether the batcher had settled when it was read.
 */
interface RenderPathReport {
  /** Live kit-module InstancedMeshes (the writer path has none). */
  instancedMeshes: number;
  /** Batcher-merged replacement meshes at read time. */
  staticBatches: number;
  /** Authored meshes the batcher is standing in for (hidden originals). */
  hiddenOriginals: number;
  /** Unique material maps generated in-page (procedural writer fallback). */
  proceduralMaps: number;
  /** Unique material maps loaded from files (scanned sets / GLB kit). */
  fileMaps: number;
  /** `kit` when instanced kit modules exist, else the procedural writer. */
  facade: 'kit' | 'procedural';
  /** ms since the counts last changed — small means mid-flight, large settled. */
  settledMs: number;
  /**
   * C-083: the page-lane present gate at read time (additive — the C-045 /
   * C-057 fields above are unchanged). `held` is true while the world is
   * inside the procedural-fallback window, so every sidecar can prove WHICH
   * side of the gate a present (or a held present) landed on.
   */
  presentGate: PresentGateReport;
}

/** C-083: the page-lane present gate state, stamped into every report. */
interface PresentGateReport {
  /** True while `__routeWorldPresent` refuses to paint (returns not-ready). */
  held: boolean;
  /** The gate's own read of the facade — identical to the report's. */
  facade: 'kit' | 'procedural';
  /** The gate's own read of the quiet window at gate-check time. */
  settledMs: number;
}

/** C-045: passive readout bridge the harness polls at present time. */
type RenderPathHost = Window & {
  __routeWorldRenderPath?: () => RenderPathReport;
};

/**
 * C-083: the page-lane present floor — the SAME settled semantics the C-057
 * harness-lane kit-settle wait enforces (`KIT_SETTLE_MIN_MS` in
 * scripts/capture-route.mjs): the render path must report the GLB kit facade
 * AND have held still this long (the bridge resets its quiet window on every
 * batch/map change, so below the floor means mid-flight). Held while
 * procedural or unsettled, `__routeWorldPresent` refuses to paint — no
 * present can land in the procedural-fallback window by construction (the
 * C-062 post-bake harness-vs-live class, PB-323).
 */
const PRESENT_KIT_SETTLE_MIN_MS = 2_000;

/**
 * C-083: the C-045 bridge's live sample, hoisted to module scope so the
 * present gate reads the SAME signals the sidecar stamps (`renderPath.facade`
 * + the quiet window). Single writer: the bridge's 1 s sampler; readers: the
 * `__routeWorldRenderPath` report and the `__routeWorldPresent` gate. Before
 * the first sample the gate fails CLOSED (`settledMs: 0` — a present can
 * never precede the bridge that measures it).
 */
const renderPathSample: {
  key: string;
  changedAt: number;
  maps: Set<string>;
  sampled: boolean;
} = { key: '', changedAt: 0, maps: new Set<string>(), sampled: false };

/**
 * C-083: one read of the render-path sample — the facade and quiet-window
 * values both the sidecar report and the present gate are built from.
 */
function readRenderPathSample(): {
  instancedMeshes: number;
  staticBatches: number;
  hiddenOriginals: number;
  proceduralMaps: number;
  fileMaps: number;
  facade: 'kit' | 'procedural';
  settledMs: number;
} {
  const [instancedMeshes = 0, staticBatches = 0, hiddenOriginals = 0] = renderPathSample.key
    .split('/')
    .map(Number);
  let proceduralMaps = 0;
  let fileMaps = 0;
  for (const entry of renderPathSample.maps) {
    if (entry.startsWith('d:')) proceduralMaps += 1;
    else fileMaps += 1;
  }
  return {
    instancedMeshes,
    staticBatches,
    hiddenOriginals,
    proceduralMaps,
    fileMaps,
    facade: instancedMeshes > 0 ? 'kit' : 'procedural',
    settledMs: renderPathSample.sampled ? Math.round(performance.now() - renderPathSample.changedAt) : 0,
  };
}

/** C-083: the present gate — held while the facade is procedural or unsettled. */
function presentGateState(): PresentGateReport {
  const sample = readRenderPathSample();
  return {
    held: sample.facade !== 'kit' || sample.settledMs < PRESENT_KIT_SETTLE_MIN_MS,
    facade: sample.facade,
    settledMs: sample.settledMs,
  };
}

/**
 * C-052 r2: debug-gated live-scene handle for measurement arms. R3F v9 keeps
 * its store in a module-private WeakMap keyed by the canvas, so a capture-side
 * script cannot reach the scene graph on its own (the C-039 BLOCKER note) —
 * yet delta-isolation arms need to bisect page state (patch one material
 * family to its baseline values, park one candidate batch, then present in
 * the SAME task, so the arm is atomic against the batcher's timers). This
 * bridge hands the live scene to `?routeDebug=1` sessions only; it performs
 * no writes itself, and arms are contract-bound to restore every write (the
 * scratch scripts keep an undo record). Normal browsing is unaffected.
 */
type SceneHandleHost = Window & {
  __routeWorldScene?: () => THREE.Scene;
};

/** C-045 r2: what the extended pin did — quoted by capture sidecars. */
interface PhasePinReport {
  /** A synchronous r3f advance ran the frame subscribers (mover park). */
  advanced: boolean;
  /** useFrame subscribers executed by that advance (movers included). */
  frameSubscribers: number;
}

/** C-045: optional phase-pin hook the capture harness probes (debug sessions). */
type PinPhaseHost = Window & {
  __routeWorldPinPhase?: (uTime: number, elapsedTime: number) => PhasePinReport;
};

/**
 * C-021 r3: present the current makeDefault camera into a GPU render target
 * and encode PNG bytes for the capture harness. Playwright's compositor
 * screenshot is the first-frame plaza, not the authored look-at (PB-027).
 * Does not swap cameras, stamp 2D, hide WebGL, or set preserveDrawingBuffer.
 */
function CaptureFramebuffer() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const get = useThree((state) => state.get);

  useEffect(() => {
    const host = window as PresentHost;
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.generateMipmaps = false;

    host.__routeWorldPresent = () => {
      // C-083 page-lane kit gate: refuse to report/paint while the world is
      // inside the procedural-fallback window — the page-side twin of the
      // C-057 harness-lane kit-settle wait (facade === 'kit' AND the render
      // path quiet >= PRESENT_KIT_SETTLE_MIN_MS, the same signals the sidecar
      // stamps). Not-ready is `null`, the typed present contract; the gate
      // state is sidecar-visible as the additive `renderPath.presentGate`.
      const gate = presentGateState();
      if (gate.held) return null;

      const { camera, size } = get();

      // With the post stack mounted the composer owns the final image; render
      // it synchronously and read the drawing buffer in the same task — no
      // preserveDrawingBuffer needed, and the still carries Bloom / AgX.
      const composer = getPostComposer();
      if (composer) {
        camera.updateMatrixWorld(true);
        composer.render(0);
        return {
          width: gl.domElement.width,
          height: gl.domElement.height,
          dataUrl: gl.domElement.toDataURL('image/png'),
        };
      }

      const width = Math.max(1, Math.round(gl.domElement.clientWidth || size.width));
      const height = Math.max(1, Math.round(gl.domElement.clientHeight || size.height));
      if (target.width !== width || target.height !== height) {
        target.setSize(width, height);
      }

      camera.updateMatrixWorld(true);
      if (camera instanceof THREE.PerspectiveCamera) {
        const aspect = width / height;
        if (Math.abs(camera.aspect - aspect) > 1e-4) {
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
        }
      }

      const previous = gl.getRenderTarget();
      gl.setRenderTarget(target);
      gl.render(scene, camera);

      const pixels = new Uint8Array(width * height * 4);
      gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      gl.setRenderTarget(previous);

      const stride = width * 4;
      const flipped = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        const src = (height - 1 - y) * stride;
        flipped.set(pixels.subarray(src, src + stride), y * stride);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.putImageData(new ImageData(flipped, width, height), 0, 0);
      return { width, height, dataUrl: canvas.toDataURL('image/png') };
    };

    return () => {
      target.dispose();
      if (host.__routeWorldPresent) delete host.__routeWorldPresent;
    };
  }, [get, gl, scene]);

  return null;
}

/**
 * C-045: passive render-path sampler for capture sidecars. Counts the kit /
 * batcher facts once a second (the StaticBatcher already traverses on the same
 * cadences) and exposes `window.__routeWorldRenderPath()` — strictly
 * read-only, no scene writes, no per-frame work, present for every visitor so
 * a sidecar never depends on a debug flag. The counts double as a freshness
 * signal: `settledMs` grows only while the render path holds still, so a still
 * shot mid-suspense or mid-batch-build is detectable from its sidecar.
 */
function RenderPathBridge() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const host = window as RenderPathHost;
    const sample = () => {
      let instancedMeshes = 0;
      let staticBatches = 0;
      let hiddenOriginals = 0;
      const mapKinds = new Set<string>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh & THREE.InstancedMesh;
        if (mesh.userData?.staticBatch) {
          staticBatches += 1;
          return;
        }
        if (!mesh.isMesh) return;
        if (mesh.isInstancedMesh) instancedMeshes += 1;
        else if (!mesh.visible) hiddenOriginals += 1;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const map = (material as THREE.MeshStandardMaterial).map;
        if (map) mapKinds.add(`${map instanceof THREE.DataTexture ? 'd' : 'f'}:${map.uuid}`);
      });
      const key = `${instancedMeshes}/${staticBatches}/${hiddenOriginals}/${[...mapKinds].sort().join(',')}`;
      // C-083: the sample lives in the module-scope store (shared with the
      // present gate), so the first sample also starts the quiet window.
      if (!renderPathSample.sampled || key !== renderPathSample.key) {
        renderPathSample.key = key;
        renderPathSample.changedAt = performance.now();
        renderPathSample.sampled = true;
      }
      renderPathSample.maps = mapKinds;
    };
    sample();
    const timer = setInterval(sample, 1000);
    host.__routeWorldRenderPath = () => ({
      ...readRenderPathSample(),
      presentGate: presentGateState(),
      // ENGINE r4: every data face's state now and its recent events.
      dataFaces: dataFaceEntries().map((entry) => {
        const readout = entry.read();
        return {
          id: entry.id,
          painted: readout.painted,
          mounted: readout.object !== null && readout.object.parent !== null,
          textures: readout.textures.length,
          // ENGINE r5: what the warm's `facesSlice` sees (shown chain, GPU residency).
          ...describeDataFace(gl, readout),
        };
      }),
      dataFaceLog: getDataFaceLog().slice(-24),
      // ENGINE-A5 (routeDebug; empty otherwise): document.fonts at each face paint.
      facePaintFonts: facePaintFontLog(),
      // R6 E4: the vertex formats the GLB load path promoted to Float32 (GPU bytes before / after).
      vertexPromotion: { ...vertexPromotionTotals() },
      // D42: the failed GLB loads (a counter, gated at 0 on every capture) and their URLs.
      failedFigureLoads: failedFigureLoads().count,
      failedFigureLoadUrls: failedFigureLoads().failures,
      // D42 N1-fix: dead meshopt decoder workers abandoned for the main thread (a counter, gated at 0).
      meshoptWorkerFallback: meshoptWorkerFallback().count,
      meshoptWorkerFallbackDetail: meshoptWorkerFallback(),
    });
    return () => {
      clearInterval(timer);
      delete host.__routeWorldRenderPath;
    };
  }, [scene, gl]);

  return null;
}

/** C-052 r2: see `SceneHandleHost` — the debug-gated live-scene handle. */
function SceneHandleBridge() {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const host = window as SceneHandleHost;
    host.__routeWorldScene = () => scene;
    return () => {
      delete host.__routeWorldScene;
    };
  }, [scene]);

  return null;
}

/**
 * C-045: debug-gated animation-phase pin. The capture harness calls
 * `window.__routeWorldPinPhase(uTime, elapsedTime)` synchronously before
 * `__routeWorldPresent`, and this is the canonical page-side write those probes
 * were waiting for (R3F v9 keeps its store in a module-private WeakMap, so a
 * harness script cannot reach the clock or uniforms on its own — C-039 r1
 * BLOCKER note).
 *
 * Canonical writes, nothing more: every material uniform NAMED `uTime` — the
 * only render-loop-advanced uniform family (LedScreen scan/sweep, ChallengeGate
 * strata; `uPhase` is static per-instance identity and is
 * deliberately untouched) — is set to the pinned value, and the r3f clock's
 * `elapsedTime` is written for direct clock readers. There is NO freeze: the
 * next live frame re-advances both, so normal browsing is unchanged, and the
 * bridge only exists in `?routeDebug=1` sessions.
 *
 * C-045 r2 — the pin now also parks NODE-TRANSFORM movers (the ~1.5 % dark
 * #roster A/A residual measured in r1). Those movers (statue breathing
 * `Figure.tsx` scale.y, holo bob `DeskHolo.tsx` position.y — both protected
 * files, pinned FROM here, never edited) read `clock.elapsedTime` inside their
 * `useFrame`, which runs on rAF — a bare clock write lands AFTER their last
 * computation, so the presented frame still renders live-phase transforms. The
 * pin therefore writes the whole clock family the movers' delta comes from —
 * `elapsedTime` AND `oldTime` (so the next `getDelta()` adds ~0, keeping the
 * clock at the pinned instant) — then forces ONE synchronous r3f `advance()`
 * from the store, which runs every `useFrame` subscriber with that canonical
 * clock: each mover recomputes its transform from the pinned instant
 * deterministically. The clock family is re-stamped afterwards (the advance's
 * own `getDelta()` bumps it by a sub-ms delta) so the sidecar's quoted values
 * are exactly what the clock holds, and the exact `uTime` uniform write runs
 * LAST because LedScreen advances `uTime += delta` per frame (C-106 r3:
 * DeskHolo's additive sheets — the family's other advancer — were removed).
 * The next live rAF
 * frame re-advances the clock from the stamp — normal browsing is unchanged;
 * the one-off clock reset only shifts animation phases inside this debug
 * capture session, the same contract the r1 hook already had. Animation-mixer
 * figures are frozen at their live pose by the ~0 delta (not canonical), which
 * measurement showed is not a visible contributor at the pinned stations
 * (ambient 0 empties the walkers; the in-frame statues are clip-less exports
 * on the breathing path).
 *
 * ENGINE-A5 (D40): under the default frame cap (`frameloop="never"`) the
 * advance goes to the pinned phase itself (delta exactly 0) and the r3f clock
 * is re-seated at the continuous driven clock afterwards (`pinPhaseAdvance`),
 * because that loop takes its delta from the advance's timestamp.
 */
function PhasePinBridge() {
  const scene = useThree((state) => state.scene);
  const clock = useThree((state) => state.clock);
  const get = useThree((state) => state.get);

  useEffect(() => {
    const host = window as PinPhaseHost;
    host.__routeWorldPinPhase = (uTime: number, elapsedTime: number) => {
      if (!Number.isFinite(uTime) || !Number.isFinite(elapsedTime)) {
        throw new Error(
          `routeWorldPinPhase: phase must be finite (uTime=${String(uTime)}, elapsedTime=${String(elapsedTime)})`,
        );
      }
      // Canonical clock family: elapsedTime is what movers read; oldTime is
      // what THREE.Clock.getDelta() diffs against, so pinning both makes the
      // forced advance below advance the clock by ~0 instead of wall time.
      const stampClock = () => {
        clock.elapsedTime = elapsedTime;
        clock.oldTime = performance.now();
      };
      const root = get();
      // ENGINE-A5 (D40): under the default frame cap the canvas runs
      // `frameloop="never"`, where r3f takes the advance's delta from the
      // TIMESTAMP (seconds) — `pinPhaseAdvance` (frame-cap.ts) advances to the
      // pinned phase (delta 0) and re-seats the continuous driven clock after.
      const plan = pinPhaseAdvance({
        frameloop: root.frameloop,
        clockSeconds: clock.elapsedTime,
        drivenSeconds: drivenClockSeconds(),
        pinnedElapsed: elapsedTime,
        nowMs: performance.now(),
      });
      stampClock();
      // POKEMON-CORE A1 step 6: every figure / fidget / breath / actor / bus
      // clock to the canonical time, actions re-seated (the advance below then
      // steps the director by ~0 and poses them).
      pinFigureDirector(elapsedTime);
      // One synchronous advance: every useFrame subscriber (node-transform
      // movers included) recomputes from the pinned clock. Global effects are
      // skipped — the movers are frame subscribers, not global effects.
      root.advance(plan.advanceTo, false);
      if (plan.restoreSeconds === null) {
        stampClock();
      } else {
        // `never`: the next driven frame continues the driven clock (one
        // displayed interval), so a still never jumps time or rewinds a mixer.
        clock.elapsedTime = plan.restoreSeconds;
      }
      scene.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        for (const candidate of materials) {
          const uniforms = (candidate as THREE.ShaderMaterial).uniforms;
          if (uniforms && uniforms.uTime) uniforms.uTime.value = uTime;
        }
      });
      return { advanced: true, frameSubscribers: root.internal.subscribers.length };
    };
    return () => {
      delete host.__routeWorldPinPhase;
    };
  }, [scene, clock, get]);

  return null;
}

/** `?routeDebug=1`: the ladder readout and the descend-only force hook (quiet probe). */
type QualityHost = Window & {
  __routeWorldQuality?: () => {
    rung: number;
    pinned: boolean;
    deviceDpr: number;
    rungDpr: number;
    bufferDpr: number | null;
    buffer: { width: number; height: number } | null;
  };
  __routeWorldQualityForce?: (rung: number) => { ok: boolean; reason?: string };
};

interface RouteWorldCanvasProps {
  /** The world's scene graph — stations, lighting, atmosphere. */
  children: ReactNode;
}

/** The pose probe as seen from this module (CameraRig owns the real shape). */
type ProbeHost = Window & {
  __routeWorldProbe?: () => Record<string, unknown>;
};

/**
 * C-032: enrich the CameraRig pose probe with the live pixel ratio so a
 * capture sidecar can prove DPR held constant across a whole run (C-027 visual review
 * finding). Strictly additive — the wrapped function still returns everything
 * the rig published, plus `pixelRatio` from `renderer.getPixelRatio()`.
 *
 * Re-wrapped from `useFrame` rather than a mount effect: the rig reinstalls
 * the probe whenever its `conductor` identity changes, which happens between
 * stations of a capture run — a one-shot wrap would silently fall off by the
 * second sidecar. The per-frame check is a pointer compare; if the probe is
 * absent (rig removed), this is a no-op, never an error.
 */
function ProbeDprBridge() {
  const gl = useThree((state) => state.gl);
  const wrappedRef = useRef<(() => Record<string, unknown>) | null>(null);
  const originalRef = useRef<(() => Record<string, unknown>) | null>(null);

  useFrame(() => {
    const host = window as ProbeHost;
    const current = host.__routeWorldProbe;
    if (!current || current === wrappedRef.current) return;
    originalRef.current = current;
    const original = current;
    const wrapped = (): Record<string, unknown> => ({ ...original(), pixelRatio: gl.getPixelRatio() });
    wrappedRef.current = wrapped;
    host.__routeWorldProbe = wrapped;
  });

  useEffect(
    () => () => {
      // Restore the rig's own function if ours is still installed.
      const host = window as ProbeHost;
      if (wrappedRef.current && host.__routeWorldProbe === wrappedRef.current && originalRef.current) {
        host.__routeWorldProbe = originalRef.current;
      }
    },
    [],
  );

  return null;
}

/**
 * C-032: per-frame render telemetry for the debug overlay — fps, draw calls,
 * triangles, rung, DPR — sampled from `renderer.info` and published to the
 * external store the DOM overlay polls (see `post-store.ts`).
 *
 * Draw-call accounting with a composer needs `autoReset` off: three resets
 * `info.render` after every `render()` call, which under post-processing
 * would leave the readout holding the last fullscreen pass (1 call, 2
 * triangles) instead of the frame. This sampler runs first every frame
 * (priority < 0 keeps automatic rendering), reads the previous frame's
 * accumulated totals, then zeroes just the render counters — memory counters
 * are cumulative and stay untouched.
 */
function TelemetrySampler({ rung }: { rung: number }) {
  // `state.get` (not `state.gl`): the sampler mutates `renderer.info`, and the
  // react-hooks/immutability lint rightly flags writes through hook-returned
  // objects — reaching the renderer through the store accessor keeps the
  // mutation explicit while satisfying the rule.
  const get = useThree((state) => state.get);
  const ema = useRef(0);

  useEffect(() => {
    const gl = get().gl;
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
      gl.info.reset();
    };
  }, [get]);

  useFrame((_, delta) => {
    const gl = get().gl;
    const info = gl.info.render;
    const frameMs = delta * 1000;
    if (delta > 0 && delta < 1) {
      ema.current = ema.current === 0 ? 1 / delta : ema.current * 0.9 + (1 / delta) * 0.1;
    }
    publishRouteTelemetry({
      fps: ema.current,
      frameMs,
      calls: info.calls,
      triangles: info.triangles,
      rung,
      dpr: gl.getPixelRatio(),
    });
    info.calls = 0;
    info.triangles = 0;
    info.points = 0;
    info.lines = 0;
    // Never `info.frame`: three keys its once-per-frame skeleton update on
    // it (`WebGLObjects.update`). Zeroed every tick, the main pass always
    // read 0, so a skinned part the shadow pass skips (C-048's trimmed eyes
    // and mouths) never refreshed its bones and stood frozen in its first
    // pose while the body animated — in every `routeDebug=1` capture.
  }, -1000);

  return null;
}

/** Mesh groups sharing geometry AND material — the instancing candidates. */
interface AuditGroup {
  key: string;
  count: number;
  triangles: number;
  skinned: number;
  inView: number;
  name: string;
  source: string;
}

/** Signature buckets for the C-032 draw-call diagnosis. */
interface AuditSignature {
  sig: string;
  count: number;
  casters: number;
  inView: number;
  triangles: number;
  instancedMeshes: number;
  instancedCount: number;
  /** Largest same-geometry sub-bucket (content hash) inside the family. */
  biggestShape: number;
  shapes: number;
}

type AuditReport = {
  /** Bump on audit-hook changes so measurement scripts can verify fresh compile. */
  auditVersion: number;
  totalCalls: number;
  totalTriangles: number;
  meshes: number;
  instanced: number;
  points: number;
  lines: number;
  casters: number;
  instancedCasters: number;
  skinned: number;
  materials: number;
  staticBatches: number;
  hiddenOriginals: number;
  constructors: Record<string, number>;
  /** Merged batches with screen positions (C-032 diagnosis). */
  batchInventory: {
    x: number;
    y: number;
    tris: number;
    members: number;
    castShadow: boolean;
    instanced: boolean;
    material: string;
  }[];
  signatures: AuditSignature[];
  groups: AuditGroup[];
  /**
   * C-089: per-prop-family triangle accounting at read time — the falsifiable
   * split of the visible-tri budget (ace / ambient / nurse / hero-prop /
   * street-lamp / stone-batch / instanced / authored) so a tri regression can
   * be attributed to the family that owns it without a devtools traverse.
   * Debug-only, same contract as the C-032 audit itself.
   */
  families: {
    family: string;
    meshes: number;
    triangles: number;
    instancedMeshes: number;
    instancedCount: number;
  }[];
  /** Debug-only: freeze/unfreeze shadow-map re-render to split call counts. */
  setShadowFreeze: (frozen: boolean) => void;
  /** Debug-only: what draws under a screen point (NDC x/y in -1..1). */
  raycastAt: (ndcX: number, ndcY: number) => string[];
  /**
   * C-045 debug-only: the light-rig / env / shadow state vector at read time —
   * the levers of the west-wing appearance race (sun path, env response, tone
   * owner) so per-load state is diffable from a probe without devtools.
   */
  sceneState: {
    lights: {
      type: string;
      color: string;
      intensity: number;
      position: [number, number, number];
      castShadow: boolean;
      shadowMapSize: number;
      shadowCamera: [number, number, number, number, number, number];
    }[];
    environment: { present: boolean; cubeUv: boolean };
    toneMapping: number;
    toneMappingExposure: number;
    shadowMap: { enabled: boolean; type: number; autoUpdate: boolean };
    fog: { present: boolean; density: number; color: string } | null;
    background: string;
  };
};

type AuditHost = Window & {
  __routeWorldAudit?: () => AuditReport;
};

/**
 * C-032: read-only scene audit for `?routeDebug=1` sessions — a histogram of
 * draw sources so the performance pass can see WHERE the calls come from
 * (repeated static meshes are the instancing candidates) without a devtools
 * debugger. Same contract as `__routeWorldProbe`: pure inspection, mutation
 * of nothing, deleted on unmount. Never mounted outside debug.
 */
function DebugSceneAudit() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const { theme } = useWorldState();
  // Theme-owned named families (plaza: ace / ambient / hero props …). The
  // prefix list arrives with the theme; the derived family label strips the
  // trailing '-' or '-prop' so report names match the pre-theme audit.
  const propPrefixes = useMemo(() => theme?.propFamilyPrefixes ?? [], [theme]);

  useEffect(() => {
    const host = window as AuditHost;
    /** Material signature — cloned-but-identical materials still cluster. */
    const signatureOf = (mesh: THREE.Mesh): string => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const m = material as THREE.MeshStandardMaterial;
      const colored = material as THREE.Material & { color?: THREE.Color };
      const parts = [
        material.type,
        `#${colored.color?.getHexString() ?? 'none'}`,
        m.map ? m.map.uuid : '-',
        m.roughness ?? '-',
        m.metalness ?? '-',
        material.transparent ? 't' : 'o',
        m.emissive ? `#${m.emissive.getHexString()}` : '-',
      ];
      return parts.join('|');
    };
    /** Family label for a theme prop-family node name (empty = no match). */
    const propFamilyOf = (name: string): string => {
      for (const prefix of propPrefixes) {
        if (!name.startsWith(prefix)) continue;
        return prefix.replace(/-$/, '').replace(/-prop$/, '');
      }
      return '';
    };
    host.__routeWorldAudit = () => {
      const frustum = new THREE.Frustum();
      frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      const buckets = new Map<string, AuditGroup>();
      const signatures = new Map<string, Omit<AuditSignature, 'sig' | 'biggestShape' | 'shapes'>>();
      const materialUuids = new Set<string>();
      const shapeHistograms = new Map<string, Map<string, number>>();
      const families = new Map<
        string,
        { family: string; meshes: number; triangles: number; instancedMeshes: number; instancedCount: number }
      >();
      /**
       * C-089 family attribution: theme prop-family ancestors win (named
       * roots the theme declares in `propFamilyPrefixes`), then the batcher's
       * merged stone replacements, then instanced kit, then the authored
       * procedural remainder.
       */
      const familyOf = (mesh: THREE.Mesh): string => {
        for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
          const family = node.name ? propFamilyOf(node.name) : '';
          if (family) return family;
        }
        if (mesh.userData?.staticBatch) return 'stone-batch';
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) return 'instanced';
        return 'authored';
      };
      const bumpFamily = (family: string, triangles: number, instancedMeshes = 0, instancedCount = 0) => {
        const entry =
          families.get(family) ??
          { family, meshes: 0, triangles: 0, instancedMeshes: 0, instancedCount: 0 };
        entry.meshes += 1;
        entry.triangles += triangles;
        entry.instancedMeshes += instancedMeshes;
        entry.instancedCount += instancedCount;
        families.set(family, entry);
      };
      let meshes = 0;
      let instanced = 0;
      let points = 0;
      let lines = 0;
      let casters = 0;
      let instancedCasters = 0;
      let totalSkinned = 0;
      let staticBatches = 0;
      let hiddenOriginals = 0;
      const constructors: Record<string, number> = {};
      const bump = (sig: string, patch: Partial<Omit<AuditSignature, 'sig' | 'biggestShape' | 'shapes'>>) => {
        const entry =
          signatures.get(sig) ?? { count: 0, casters: 0, inView: 0, triangles: 0, instancedMeshes: 0, instancedCount: 0 };
        entry.count += patch.count ?? 0;
        entry.casters += patch.casters ?? 0;
        entry.inView += patch.inView ?? 0;
        entry.triangles += patch.triangles ?? 0;
        entry.instancedMeshes += patch.instancedMeshes ?? 0;
        entry.instancedCount += patch.instancedCount ?? 0;
        signatures.set(sig, entry);
      };
      scene.traverse((object) => {
        const ctor = object.constructor?.name ?? 'unknown';
        constructors[ctor] = (constructors[ctor] ?? 0) + 1;
        const obj = object as THREE.Points & THREE.Line & THREE.Mesh & THREE.InstancedMesh;
        if (obj.userData?.staticBatch) staticBatches += 1;
        else if (obj.isMesh && !obj.visible) {
          hiddenOriginals += 1;
          return; // hidden originals neither draw nor count as remaining work
        }
        if (obj.isPoints) {
          points += 1;
          return;
        }
        if (obj.isLine) {
          lines += 1;
          return;
        }
        if (!obj.isMesh || !obj.geometry || !obj.material) return;
        const mesh = obj;
        const geometry = mesh.geometry as THREE.BufferGeometry & { attributes: { position?: THREE.BufferAttribute } };
        const verts = geometry.attributes.position?.count ?? 0;
        const index = geometry.index?.count;
        const tris = Math.floor((index ?? verts) / 3);
        const inView = frustum.intersectsObject(mesh);
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        materialUuids.add(material.uuid);
        const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh ? 1 : 0;
        if (mesh.isInstancedMesh) {
          instanced += 1;
          if (mesh.castShadow) instancedCasters += 1;
          bump(signatureOf(mesh), { instancedMeshes: 1, instancedCount: mesh.count, casters: mesh.castShadow ? 1 : 0, triangles: tris * mesh.count });
          bumpFamily(familyOf(mesh), tris * mesh.count, 1, mesh.count);
          return;
        }
        meshes += 1;
        if (mesh.castShadow) casters += 1;
        if (skinned) totalSkinned += 1;
        const sig = signatureOf(mesh);
        const shape = geometryHash(mesh.geometry);
        let histo = shapeHistograms.get(sig);
        if (!histo) {
          histo = new Map();
          shapeHistograms.set(sig, histo);
        }
        histo.set(shape, (histo.get(shape) ?? 0) + 1);
        bump(sig, { count: 1, casters: mesh.castShadow ? 1 : 0, inView: inView ? 1 : 0, triangles: tris });
        bumpFamily(familyOf(mesh), tris);
        const key = `${geometry.uuid}/${material.uuid}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.count += 1;
          existing.skinned += skinned;
          existing.inView += inView ? 1 : 0;
        } else {
          const chain: string[] = [];
          for (let node = mesh.parent; node && node !== scene; node = node.parent) {
            if (node.name) chain.unshift(node.name);
          }
          buckets.set(key, {
            key,
            count: 1,
            triangles: tris,
            skinned,
            inView: inView ? 1 : 0,
            name: mesh.name || '(unnamed)',
            source: chain.slice(-2).join('/') || '(root)',
          });
        }
      });
      const info = gl.info.render;
      const batchInventory: AuditReport['batchInventory'] = [];
      scene.traverse((object) => {
        if (!object.userData?.staticBatch) return;
        const mesh = object as THREE.Mesh & THREE.InstancedMesh;
        mesh.updateWorldMatrix(true, false);
        const sphere = mesh.geometry.boundingSphere;
        if (sphere) {
          const center = sphere.center.clone().applyMatrix4(mesh.matrixWorld);
          const projected = center.project(camera);
          batchInventory.push({
            x: Math.round(((projected.x + 1) / 2) * 100),
            y: Math.round(((1 - projected.y) / 2) * 100),
            tris: mesh.geometry.index
              ? Math.floor(mesh.geometry.index.count / 3)
              : Math.floor((mesh.geometry.attributes.position?.count ?? 0) / 3),
            members: 0,
            castShadow: mesh.castShadow,
            instanced: mesh.isInstancedMesh === true,
            material: `${(() => {
              const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
              return `${m.type}#${m.color?.getHexString() ?? 'none'}`;
            })()}`,
          });
        }
      });
      // C-045: light-rig / env / shadow state vector (see AuditReport.sceneState).
      const lights: AuditReport['sceneState']['lights'] = [];
      scene.traverse((object) => {
        const light = object as THREE.Light & { shadow?: THREE.LightShadow };
        if (!(light as unknown as { isLight?: boolean }).isLight) return;
        const directional = light as THREE.DirectionalLight;
        const shadow = light.shadow;
        const mapSize = shadow?.mapSize ? Math.min(shadow.mapSize.width, shadow.mapSize.height) : 0;
        const camera = shadow?.camera as THREE.OrthographicCamera;
        lights.push({
          type: light.type,
          color: `#${light.color.getHexString()}`,
          intensity: light.intensity,
          position: [light.position.x, light.position.y, light.position.z],
          castShadow: Boolean(directional.castShadow && shadow),
          shadowMapSize: mapSize,
          shadowCamera: camera?.isOrthographicCamera
            ? [camera.near, camera.far, camera.left, camera.right, camera.top, camera.bottom]
            : [0, 0, 0, 0, 0, 0],
        });
      });
      const sceneState: AuditReport['sceneState'] = {
        lights,
        environment: {
          present: scene.environment !== null,
          cubeUv: scene.environment?.isRenderTargetTexture === true,
        },
        toneMapping: gl.toneMapping,
        toneMappingExposure: gl.toneMappingExposure,
        shadowMap: {
          enabled: gl.shadowMap.enabled,
          type: gl.shadowMap.type,
          autoUpdate: gl.shadowMap.autoUpdate,
        },
        fog: scene.fog
          ? {
              present: true,
              density: (scene.fog as THREE.FogExp2).density,
              color: `#${(scene.fog as THREE.FogExp2).color.getHexString()}`,
            }
          : null,
        background:
          scene.background instanceof THREE.Color ? `#${scene.background.getHexString()}` : String(scene.background ?? 'none'),
      };
      const report: AuditReport = {
        auditVersion: 5,
        totalCalls: info.calls,
        totalTriangles: info.triangles,
        meshes,
        instanced,
        points,
        lines,
        casters,
        instancedCasters,
        skinned: totalSkinned,
        materials: materialUuids.size,
        staticBatches,
        hiddenOriginals,
        constructors,
        batchInventory: batchInventory.sort((a, b) => b.tris - a.tris),
        signatures: [...signatures.entries()]
          .map(([sig, s]) => {
            const histo = shapeHistograms.get(sig);
            const shapes = [...(histo?.values() ?? [])].sort((a, b) => b - a);
            return { sig, ...s, biggestShape: shapes[0] ?? 0, shapes: shapes.length };
          })
          .sort((a, b) => b.triangles - a.triangles || b.count - a.count),
        groups: [...buckets.values()].sort((a, b) => b.count - a.count),
        families: [...families.values()].sort((a, b) => b.triangles - a.triangles),
        setShadowFreeze: (frozen: boolean) => {
          gl.shadowMap.autoUpdate = !frozen;
          gl.shadowMap.needsUpdate = !frozen;
        },
        raycastAt: (ndcX: number, ndcY: number) => {
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
          const hits = raycaster.intersectObjects(scene.children, true);
          return hits.slice(0, 3).map((hit) => {
            const object = hit.object as THREE.Mesh;
            const material = (
              Array.isArray(object.material) ? object.material[0] : object.material
            ) as THREE.MeshStandardMaterial;
            return `${hit.object.userData?.staticBatch ? 'BATCH' : 'single'} ${hit.object.constructor.name} ${material.type}#${material.color?.getHexString() ?? 'none'} map=${material.map?.uuid.slice(0, 8) ?? '-'} rough=${material.roughness ?? '-'} metal=${material.metalness ?? '-'} fog=${material.fog} side=${material.side} dist=${hit.distance.toFixed(1)}`;
          });
        },
        sceneState,
      };
      return report;
    };
    return () => {
      gl.shadowMap.autoUpdate = true;
      delete host.__routeWorldAudit;
    };
  }, [camera, gl, propPrefixes, scene]);

  return null;
}

/**
 * `?routeQuality=<rung>` pins the ladder for the capture harness and debug
 * sessions; headless GPUs would otherwise trip the governor mid-capture and
 * evidence would drift between runs. Ignored (null) for every visitor.
 */
/**
 * Whether three's per-program `checkShaderErrors` pass stays on (review
 * r5). Its `getProgramInfoLog` / `getShaderInfoLog` reads on first use force
 * a synchronous wait for the link, which was part of the measured reveal
 * freeze, so it is OFF for every visitor. `?routeDebug=1` keeps three's
 * default (on — shader errors are readable while debugging) unless
 * `?routeShaderCheck=0` opts out, so a debug trace can measure the
 * production-like compile cost.
 */
function readShaderCheck(debug: boolean): boolean {
  if (!debug || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('routeShaderCheck') !== '0';
}

function readPinnedQuality(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('routeQuality');
  if (raw === null || !/^\d$/.test(raw)) return null;
  const rung = Number(raw);
  return rung < QUALITY_LADDER.length ? rung : null;
}

/**
 * `?routeNoBatch=1` parks the whole static batcher for one session (C-032);
 * `=mesh` or `=inst` park one consolidation arm — the capture harness uses
 * these to A/B the batched scene against the authored scene and prove the
 * consolidation is pixel-invisible. Ignored for every visitor.
 */
function readNoBatch(): { mesh: boolean; instanced: boolean } {
  if (typeof window === 'undefined') return { mesh: false, instanced: false };
  const raw = new URLSearchParams(window.location.search).get('routeNoBatch');
  if (raw === '1') return { mesh: true, instanced: true };
  if (raw === 'mesh') return { mesh: true, instanced: false };
  if (raw === 'inst') return { mesh: false, instanced: true };
  return { mesh: false, instanced: false };
}

/**
 * C-032: content hash for a BufferGeometry. The wave's repeated props (plinth
 * courses, railings, lamps) each own a geometry INSTANCE with identical
 * content — `<cylinderGeometry>` inline — so uuid grouping finds nothing. This
 * hash proves content identity: FNV-1a over EVERY attribute's full values
 * plus the index. Position-only hashing was tried first and silently merged
 * the perimeter writer's per-block UV retiles — identical shape, different
 * texture mapping — which showed as a soft 4 % pixel drift in the A/B diff.
 */
function geometryHash(geometry: THREE.BufferGeometry): string {
  const position = geometry.attributes.position;
  if (!position) return 'none';
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const mixArray = (arr: ArrayLike<number>) => {
    for (let i = 0; i < arr.length; i += 1) mix(arr[i]);
  };
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.attributes[name] as THREE.BufferAttribute;
    mix(name.length);
    mix(attribute.itemSize);
    mixArray(attribute.array as ArrayLike<number>);
  }
  if (geometry.index) mixArray(geometry.index.array as ArrayLike<number>);
  return h.toString(36);
}

/**
 * C-052: rebuild a CLONED geometry's attributes as plain float32 storage.
 *
 * KHR_mesh_quantization exports (the Meshy hero props) carry POSITION/NORMAL
 * as NORMALIZED int16, decoded to model units by the GPU, with the decode
 * scale on the node TRS — the mesh renders correctly because the model matrix
 * never enters attribute storage. The mesh-arm bake breaks exactly there:
 * `applyMatrix4(world)` writes world-space floats back into the int16 array,
 * which wraps (mod 2^16), and normalized decoding maps ±32767 back to ±1
 * world unit — the whole family collapses onto the merged mesh's origin (the
 * C-043 plinth/lamp pairs projecting at (50 %,112 %)/(50 %,131 %) instead of
 * their seats; reproduced with a fully live, correct seat matrix in Node —
 * the wrap is a storage defect, not a stale-parent one). Reading every
 * component through the attribute getters (they denormalize, and they are
 * the only correct path through interleaved storage) gives the clone float32
 * attributes the world bake can land in. Touched attributes only — clones of
 * float32 originals pass through unchanged.
 */
function dequantizeToFloat32(geometry: THREE.BufferGeometry): void {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name];
    // Plain float32 storage (the authored-mesh case) passes through untouched.
    // The instanceof discriminates interleaved storage (stride != itemSize)
    // even when its backing array is float32 — and holds for attributes
    // three-stdlib's loader builds, which imports the class from "three".
    if (!(attribute instanceof THREE.InterleavedBufferAttribute) && attribute.array instanceof Float32Array) continue;
    const itemSize = attribute.itemSize;
    const out = new Float32Array(attribute.count * itemSize);
    for (let i = 0, j = 0; i < attribute.count; i += 1) {
      for (let component = 0; component < itemSize; component += 1) {
        out[j] = attribute.getComponent(i, component);
        j += 1;
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, itemSize, false));
  }
}

/** Texture slots whose identity (not just parameters) a merge must respect. */
const MERGE_TEXTURE_SLOTS = [
  'map',
  'metalnessMap',
  'roughnessMap',
  'normalMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'envMap',
] as const;

type MergeableMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

function isMergeableMaterial(material: THREE.Material): material is MergeableMaterial {
  return material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial;
}

/**
 * C-032: visual-equality signature for the merge. Two materials that compare
 * equal here render pixel-identically for the same geometry, so the family can
 * share ONE of them. Every scalar and texture slot that reaches the shader for
 * the mergeable material types is included; anything exotic (ShaderMaterial,
 * Physical clearcoat) is excluded from merging outright by `isMergeableMaterial`.
 *
 * D42 N4: the shader hooks and per-material uniforms are part of the look
 * too. The signature appends the program key (`customProgramCacheKey()`: an
 * `onBeforeCompile` patch changes the program), the painted-light role
 * (`userData.paintRole`, a per-material uniform under one shared key), the
 * window pane's lit flag (`userData.windowLit`: glass and lamp panes share
 * one program and differ only by their `uWinLit` uniform, so a merged family
 * drew every pane in one state after a day/night toggle) and
 * `userData.mergeKey` (any other per-material uniform state, written by the
 * patch that owns the uniforms: the ashlar's course/bay/block values, the
 * window uniform set). Materials that differ in any of them never merge.
 */
export function materialSignature(material: MergeableMaterial): string | null {
  const standard = material instanceof THREE.MeshStandardMaterial ? material : null;
  const fields: unknown[] = [
    material.type,
    `#${material.color?.getHexString() ?? 'none'}`,
    standard?.roughness ?? 0,
    standard?.metalness ?? 0,
    material.opacity,
    material.transparent ? 1 : 0,
    material.alphaTest,
    material.side,
    material.vertexColors ? 1 : 0,
    standard?.flatShading ? 1 : 0,
    material.toneMapped ? 1 : 0,
    material.dithering ? 1 : 0,
    material.fog ? 1 : 0,
    standard?.wireframe ? 1 : 0,
    material.depthWrite ? 1 : 0,
    material.depthTest ? 1 : 0,
    material.blending,
  ];
  if (standard) {
    const physical = material instanceof THREE.MeshPhysicalMaterial ? material : null;
    fields.push(
      `#${standard.emissive?.getHexString() ?? 'none'}`,
      standard.emissiveIntensity,
      standard.envMapIntensity,
      standard.aoMapIntensity,
      standard.normalScale?.x ?? 0,
      standard.normalScale?.y ?? 0,
      physical?.ior ?? 0,
      physical?.transmission ?? 0,
    );
  }
  for (const slot of MERGE_TEXTURE_SLOTS) {
    const texture = (material as unknown as Record<string, THREE.Texture | null>)[slot];
    fields.push(texture ? texture.uuid : '-');
  }
  const userData = material.userData ?? {};
  try {
    fields.push(
      `key:${material.customProgramCacheKey()}`,
      `role:${signaturePart(userData.paintRole)}`,
      `lit:${signaturePart(userData.windowLit)}`,
      `merge:${signaturePart(userData.mergeKey)}`,
    );
    return JSON.stringify(fields);
  } catch {
    return null;
  }
}

/** One `userData` value as a signature token (absent and `undefined` read the same). */
function signaturePart(value: unknown): string {
  if (value === undefined || value === null) return '-';
  return typeof value === 'string' ? `s:${value}` : `j:${JSON.stringify(value)}`;
}

/** ENGINE r5: a data face's material (`userData.dataFace`), which the batcher never merges. */
export function isDataFaceMaterial(material: THREE.Material | THREE.Material[] | null | undefined): boolean {
  if (material == null) return false;
  const list = Array.isArray(material) ? material : [material];
  return list.some((entry) => entry?.userData?.dataFace === true);
}

function sourcesOf(meshes: (THREE.Mesh | THREE.InstancedMesh)[]): BatchRecord['sources'] {
  return meshes.map((mesh) => ({ material: mesh.material, geometry: mesh.geometry }));
}

/**
 * ENGINE-A4: main-thread budget of one StaticBatcher build task. A build is a
 * grouping traversal plus one step per family; steps run until this budget is
 * spent, then the build continues in the next task (see `pumpBuild`).
 */
export const BATCH_BUILD_SLICE_MS = 8;

/** Mutable bookkeeping the StaticBatcher revalidates against the live graph. */
interface BatchRecord {
  /** The merged replacement (one draw for the whole family). */
  merged: THREE.Mesh | THREE.InstancedMesh;
  /** The hidden originals backing it — kept in the graph, `visible=false`. */
  originals: (THREE.Mesh | THREE.InstancedMesh)[];
  /**
   * True when `merged.geometry` was CREATED by the batcher (a mergeGeometries
   * output) and may be disposed at teardown. False for instanced families:
   * their merged mesh deliberately shares the source geometry with the
   * still-mounted originals (PR #63 review — disposing it stripped the GPU
   * buffers out from under the re-shown originals).
   */
  ownsGeometry: boolean;
  /**
   * State captured at build time, parallel to `originals`: the world matrix
   * for a Mesh, the whole instance-matrix block for an InstancedMesh.
   */
  frozen: Float32Array[];
  /**
   * ENGINE r5: each original's material and geometry at build time, parallel
   * to `originals`. React reconciles a `textures ? <mesh …shader> : <mesh …
   * standard>` swap onto the SAME THREE.Mesh, so a mesh batched while it wore
   * a placeholder material stayed hidden once its real one arrived (the board
   * panel after a theme toggle at the floor rung: the warm's face check never
   * cleared and the stall detector dropped the visitor to Lite). A swapped
   * material or geometry tears the batch down like a moved original.
   */
  sources: { material: THREE.Material | THREE.Material[]; geometry: THREE.BufferGeometry }[];
}

/**
 * C-032: delivery-layer static batching. The wave authored the plaza's
 * repeated props as sibling meshes — plinth courses, rails, lamp housings,
 * bollards — most with per-mesh material clones of identical parameters and
 * per-mesh geometry instances of a handful of shapes. Station files are
 * closed, so the consolidation happens HERE, in the canvas that delivers
 * them: each family of visually-identical, provably-still meshes is
 * re-expressed as ONE merged mesh (world-space baked geometry, one of the
 * family's materials), and the kit's per-block InstancedMeshes are folded
 * into one per (material, geometry, shadow flags). A draw call per member
 * disappears from BOTH the colour pass and the sun's shadow pass — the two
 * costs the §9 call budget is spent on (703 -> 330 calls at rung 0, pulse).
 *
 * Known delta, measured and reported (C-032 r1 A/B): the wave layers
 * COINCIDENT stone surfaces (kit modules over the writer's mass wings, writer
 * slot over slot) whose depth fights the React tree order resolves. A merged
 * family draws once and cannot preserve per-member order, so a localized
 * ~4 % tolerant pixel difference remains against `?routeNoBatch=1` on the
 * layered structure left of #pulse (deterministic; every rung equally; the
 * ladder's adjacent-rung degradation is unaffected). Geometry, materials and
 * transforms are provably preserved — the delta is which coincident surface
 * wins its depth fight.
 *
 * Safety gates, in order:
 *  - skinned / morph / transparent / reordered meshes are never touched;
 *  - ShaderMaterial and anything MeshStandard/Basic-shaped code cannot prove
 *    equal for is never merged (`materialSignature` covers every shader-reaching
 *    scalar and texture slot of the mergeable types);
 *  - families require a uniform attribute set and index layout, or the odd
 *    members stay authored;
 *  - quantized-attribute families (KHR_mesh_quantization GLBs — the Meshy
 *    props) are dequantized to float32 inside the clone before the world
 *    bake, and the bake matrix is recomputed from the live parent chain:
 *    normalized int16 storage wraps under `applyMatrix4` and collapsed such
 *    families onto the batch's origin (C-052, the C-043 repro);
 *  - focus proxies are never touched (pointer picking is proxy-only, and
 *    subjects measured their bounds at mount — both unaffected by hiding);
 *  - a mesh only joins a family after its world matrix (or instance block)
 *    has held still for a stability window, so walking figures, orbiting
 *    holos and page-turning boards are excluded by observation, not guesswork;
 *  - every batch is revalidated on a slow tick: any drift (original
 *    unmounted, forced visible, moved) drops THAT batch alone — theme flips,
 *    tier changes and figure populations self-heal without churn.
 *
 * Family bounding spheres grow to the union (usually plaza-wide), so the
 * merged mesh is submitted whenever any member would have been; the families
 * total ~20 k triangles against a 1.2 M budget, making that trade free.
 * Reverts fully on unmount — originals are only ever hidden, never removed.
 */
function StaticBatcher({
  arm,
  propFamilyPrefixes,
}: {
  arm: { mesh: boolean; instanced: boolean };
  propFamilyPrefixes: readonly string[];
}) {
  const scene = useThree((state) => state.scene);
  const { debug } = useWorldState();
  // Primitive captures keep the effect deps exhaustive; the arm is pinned by
  // the parent's useMemo, so these never change for a mounted canvas.
  const noMeshMerge = arm.mesh;
  const noInstancedMerge = arm.instanced;
  const prefixesKey = propFamilyPrefixes.join('|');

  useEffect(() => {
    const stableSince = new WeakMap<THREE.Mesh, Float32Array>();
    const tracked = new Set<THREE.Mesh>();
    const hashCache = new WeakMap<THREE.BufferGeometry, string>();
    const batches: BatchRecord[] = [];
    const batchedOriginals = new Set<THREE.Mesh>();
    let running = true;

    /**
     * C-089: theme-declared prop families (plaza: the Meshy hero-prop GLBs —
     * lamp posts, plinth masses, gate crests, the kiosk) never merge. C-032's
     * trade — one merged draw for a family whose union bounds are plaza-wide
     * — assumed "families total ~20 k triangles"; the Meshy GLB members are
     * 14-20 k EACH and mount 2-8 times, so a merged family was submitted from
     * every station camera at full size (the tri doubling's source, 2.00x the
     * C-032 record). Authored, each instance keeps its own bounds and three's
     * frustum cull drops the instances outside the station frame — the C-032
     * ladder's visibility-culling discipline. Named roots only; the batcher's
     * stone courses and rails are untouched.
     */
    const propPrefixes = prefixesKey.length > 0 ? prefixesKey.split('|') : [];
    const underPropFamily = (object: THREE.Object3D): boolean => {
      for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        const name = node.name;
        if (!name) continue;
        for (const prefix of propPrefixes) {
          if (name.startsWith(prefix)) return true;
        }
      }
      return false;
    };

    const candidate = (object: THREE.Object3D): object is THREE.Mesh => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return false;
      if (!mesh.visible || !mesh.geometry || !mesh.material) return false;
      if (mesh.renderOrder !== 0) return false;
      if (mesh.morphTargetInfluences) return false;
      if (mesh.userData?.focusSubject || mesh.userData?.staticBatch) return false;
      // ENGINE r5: a data face (the keep-out law, data-surfaces.ts) is never
      // merged — not even its placeholder material while its canvas paints.
      if (isDataFaceMaterial(mesh.material)) return false;
      if (underPropFamily(mesh)) return false;
      if (Array.isArray(mesh.material)) return false; // multi-material: never merge
      if (!isMergeableMaterial(mesh.material) || mesh.material.transparent) return false;
      if (!mesh.geometry.attributes.position) return false;
      return true;
    };

    const snapshot = (mesh: THREE.Mesh): Float32Array => {
      // The render loop owns world-matrix updates; re-deriving them here for
      // hundreds of meshes every tick showed up as frame hitches (C-032), so
      // the sampler only ever copies what the renderer last committed.
      const out = new Float32Array(16);
      out.set(mesh.matrixWorld.elements);
      return out;
    };

    const sameMatrix = (a: Float32Array, b: Float32Array): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
      return true;
    };

    const hashOf = (geometry: THREE.BufferGeometry): string => {
      const cached = hashCache.get(geometry);
      if (cached) return cached;
      const hash = geometryHash(geometry);
      hashCache.set(geometry, hash);
      return hash;
    };

    const teardownBatch = (index: number) => {
      const [batch] = batches.splice(index, 1);
      scene.remove(batch.merged);
      if (batch.ownsGeometry) {
        // A mergeGeometries output the batcher created: disposable here.
        batch.merged.geometry.dispose();
      } else if (batch.merged instanceof THREE.InstancedMesh) {
        // An instanced family's merged mesh (the only `ownsGeometry: false`
        // build path). Its GEOMETRY is the source shared with the originals
        // this teardown just re-showed, so that must survive (PR #63 review —
        // disposing it stripped the GPU buffers out from under them). Its
        // instanceMatrix/instanceColor are batcher-allocated, though, and
        // three frees those ONLY on the InstancedMesh 'dispose' event —
        // without this every revalidate rebuild leaks one instance buffer set
        // per family.
        batch.merged.dispose();
      }
      for (const original of batch.originals) {
        original.visible = true;
        batchedOriginals.delete(original);
      }
    };

    const teardown = () => {
      while (batches.length > 0) teardownBatch(0);
    };

    /** One observe tick: stamp movers, keep still meshes' original stamps. */
    const observe = () => {
      if (!running) return;
      const seen = new Set<THREE.Mesh>();
      scene.traverse((object) => {
        const instanced = object as THREE.InstancedMesh;
        if (instanced.isInstancedMesh && instanced.visible && !instanced.userData?.staticBatch) {
          const block = (instanced.instanceMatrix.array as Float32Array).subarray(
            0,
            instanced.count * 16,
          );
          const was = stableSince.get(instanced);
          // Stamp a COPY, never the live `instanceMatrix.array` reference: a
          // reference compares equal to itself on every tick, so the mover
          // guard degenerates to a no-op and animated instanced meshes get
          // frozen into static batches (PR #63 review). Same discipline the
          // build path's `frozen` blocks keep.
          if (!was || !sameMatrix(was, block)) stableSince.set(instanced, block.slice());
          seen.add(instanced);
          tracked.add(instanced);
          return;
        }
        if (!candidate(object)) return;
        const mesh = object as THREE.Mesh;
        seen.add(mesh);
        const now = snapshot(mesh);
        const was = stableSince.get(mesh);
        if (was && sameMatrix(was, now)) return; // still still — stamp stands
        stableSince.set(mesh, now);
        tracked.add(mesh);
      });
      for (const mesh of tracked) {
        if (!seen.has(mesh)) {
          tracked.delete(mesh);
          stableSince.delete(mesh);
        }
      }
    };

    /** Attribute-set key — mergeGeometries needs identical sets per member. */
    const attributeKey = (geometry: THREE.BufferGeometry): string =>
      `${Object.keys(geometry.attributes).sort().join(',')}${geometry.index ? '|i' : ''}`;

    /**
     * ENGINE-A4 (ceremony main thread): the fold is SLICED. One build used to
     * run every family's clone / world bake / merge in one timer task, a
     * 30-56 ms long animation frame under the ball (A3 LoAF). The traversal
     * groups the families in the timer task; each family then merges as its
     * own step, and steps run under BATCH_BUILD_SLICE_MS per task, so no task
     * carries more than one slice. A family that waited for a later task is
     * re-checked member by member first (still mounted, visible, unbatched,
     * same material and geometry, same stamp): a mesh that changed since the
     * grouping stays authored, exactly as if it had failed the grouping.
     */
    let buildWork: (() => void)[] = [];
    let buildSliceTimer: ReturnType<typeof setTimeout> | null = null;
    const pumpBuild = () => {
      buildSliceTimer = null;
      if (!running) {
        buildWork = [];
        return;
      }
      const started = performance.now();
      while (buildWork.length > 0) {
        const step = buildWork.shift();
        step?.();
        if (performance.now() - started >= BATCH_BUILD_SLICE_MS) break;
      }
      if (buildWork.length > 0) buildSliceTimer = setTimeout(pumpBuild, 0);
    };
    const cancelBuild = () => {
      buildWork = [];
      if (buildSliceTimer !== null) clearTimeout(buildSliceTimer);
      buildSliceTimer = null;
    };
    /** The grouping's view of a member, re-checked when its family's step runs. */
    const memberStill = (
      mesh: THREE.Mesh | THREE.InstancedMesh,
      source: { material: THREE.Material | THREE.Material[]; geometry: THREE.BufferGeometry; stamp: Float32Array },
    ): boolean => {
      if (!mesh.parent || !mesh.visible || batchedOriginals.has(mesh)) return false;
      if (mesh.material !== source.material || mesh.geometry !== source.geometry) return false;
      const instanced = mesh as THREE.InstancedMesh;
      const now = instanced.isInstancedMesh
        ? (instanced.instanceMatrix.array as Float32Array).subarray(0, instanced.count * 16)
        : snapshot(mesh);
      return sameMatrix(source.stamp, now);
    };
    const stampOf = (mesh: THREE.Mesh | THREE.InstancedMesh) => {
      const instanced = mesh as THREE.InstancedMesh;
      const stamp = instanced.isInstancedMesh
        ? (instanced.instanceMatrix.array as Float32Array).slice(0, instanced.count * 16)
        : snapshot(mesh);
      return { material: mesh.material, geometry: mesh.geometry, stamp };
    };

    /** Fold newly-settled, visually-identical meshes into merged families. */
    const build = () => {
      // A sliced build still running: the next tick groups what is left.
      if (!running || buildWork.length > 0) return;
      // `arm` carries the routeNoBatch DISABLE flags — a true arm means "do
      // not merge these", so the maps exist only for the enabled arms.
      const groups = noMeshMerge ? null : new Map<string, THREE.Mesh[]>();
      const instancedGroups = noInstancedMerge ? null : new Map<string, THREE.InstancedMesh[]>();
      scene.traverse((object) => {
        const instanced = object as THREE.InstancedMesh;
        if (instanced.isInstancedMesh && instanced.visible && !instanced.userData?.staticBatch) {
          if (!instancedGroups) return;
          if (batchedOriginals.has(instanced)) return;
          const material = instanced.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material) || !isMergeableMaterial(material) || material.transparent) return;
          if (instanced.instanceColor || instanced.morphTargetInfluences) return;
          const since = stableSince.get(instanced);
          // Same count-window `observe` stamps: a count below the constructed
          // capacity is legal in three.js, and comparing the stamp against the
          // full backing array would length-mismatch forever, silently never
          // batching that family (PR #63 review).
          const block = (instanced.instanceMatrix.array as Float32Array).subarray(
            0,
            instanced.count * 16,
          );
          if (!since || !sameMatrix(since, block)) return; // instances still moving
          const signature = materialSignature(material);
          if (!signature) return;
          const key = `${signature}|${hashOf(instanced.geometry)}|${instanced.castShadow ? 1 : 0}|${instanced.receiveShadow ? 1 : 0}`;
          const bucket = instancedGroups.get(key);
          if (bucket) bucket.push(instanced);
          else instancedGroups.set(key, [instanced]);
          return;
        }
        if (!groups || !candidate(object)) return;
        const mesh = object as THREE.Mesh;
        if (batchedOriginals.has(mesh)) return;
        const since = stableSince.get(mesh);
        if (!since || !sameMatrix(since, snapshot(mesh))) return; // mover or unstamped
        const signature = materialSignature(mesh.material as MergeableMaterial);
        if (!signature) return;
        const key = `${signature}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
        const bucket = groups.get(key);
        if (bucket) bucket.push(mesh);
        else groups.set(key, [mesh]);
      });
      for (const grouped of groups?.values() ?? []) {
        if (grouped.length < 2) continue;
        const seen = grouped.map(stampOf);
        buildWork.push(() => mergeMeshFamily(grouped.filter((mesh, i) => memberStill(mesh, seen[i]))));
      }
      for (const grouped of instancedGroups?.values() ?? []) {
        if (grouped.length < 2) continue;
        const seen = grouped.map(stampOf);
        buildWork.push(() => mergeInstancedFamily(grouped.filter((mesh, i) => memberStill(mesh, seen[i]))));
      }
      pumpBuild();
    };

    /** One family of still meshes -> one merged mesh (a build step). */
    const mergeMeshFamily = (meshes: THREE.Mesh[]) => {
      if (!running) return;
      if (meshes.length < 2) return;
      // Only members with a common attribute set can merge; the rest stay.
      const sets = new Map<string, THREE.Mesh[]>();
      for (const mesh of meshes) {
        const attrKey = attributeKey(mesh.geometry);
        const bucket = sets.get(attrKey);
        if (bucket) bucket.push(mesh);
        else sets.set(attrKey, [mesh]);
      }
      for (const members of sets.values()) {
        if (members.length < 2) continue;
        const first = members[0];
        const matrix = new THREE.Matrix4();
        const parts: THREE.BufferGeometry[] = [];
        const frozen: Float32Array[] = [];
        const mergedMembers: THREE.Mesh[] = [];
        const firstIndexed = first.geometry.index !== null;
        for (const mesh of members) {
          // Bake from the LIVE parent chain (the instanced arm's C-034
          // discipline): the committed matrixWorld the sampler reads can
          // predate the object's mount, and a family stamped across that
          // window would bake from a stale parent. Still-mesh values are
          // unchanged — this only recomputes what updateMatrixWorld would.
          mesh.updateWorldMatrix(true, false);
          const world = snapshot(mesh);
          const part = mesh.geometry.clone();
          dequantizeToFloat32(part); // quantized storage cannot hold a world bake (C-052)
          matrix.fromArray(world);
          part.applyMatrix4(matrix);
          // `toNonIndexed` RETURNS the converted geometry — call sites that
          // ignore the return keep the indexed original and the merge dies.
          const ready = firstIndexed ? (part.index ? part : null) : part.toNonIndexed();
          if (!ready) {
            part.dispose();
            continue; // cannot match the family's index layout — stay authored
          }
          parts.push(ready);
          frozen.push(world);
          mergedMembers.push(mesh);
        }
        if (parts.length < 2) {
          for (const part of parts) part.dispose();
          continue;
        }
        const mergedGeometry = mergeGeometries(parts, false);
        for (const part of parts) part.dispose();
        if (!mergedGeometry) continue; // incompatible shapes — leave as authored
        const merged = new THREE.Mesh(mergedGeometry, first.material as THREE.Material);
        merged.castShadow = first.castShadow;
        merged.receiveShadow = first.receiveShadow;
        merged.userData.staticBatch = true;
        merged.frustumCulled = true;
        mergedGeometry.computeBoundingSphere();
        scene.add(merged);
        for (const mesh of mergedMembers) {
          mesh.visible = false;
          batchedOriginals.add(mesh);
        }
        batches.push({ merged, originals: mergedMembers, ownsGeometry: true, frozen, sources: sourcesOf(mergedMembers) });
      }
    };

    /**
     * Instanced families (kit bays across blocks): one InstancedMesh per
     * (material, geometry, shadow flags) instead of one per block (a build step).
     */
    const mergeInstancedFamily = (members: THREE.InstancedMesh[]) => {
      if (!running) return;
      if (members.length < 2) return;
      const first = members[0];
      const count = members.reduce((sum, mesh) => sum + mesh.count, 0);
      const mergedInstanced = new THREE.InstancedMesh(
        first.geometry,
        first.material as THREE.Material,
        count,
      );
      mergedInstanced.castShadow = first.castShadow;
      mergedInstanced.receiveShadow = first.receiveShadow;
      mergedInstanced.userData.staticBatch = true;
      mergedInstanced.frustumCulled = true;
      const frozen: Float32Array[] = [];
      // The merged mesh is added at the SCENE ROOT, so each copied instance
      // must carry its source mesh's full parent chain: pre-multiply the
      // block-local matrices by the source's matrixWorld (C-034). Copying
      // them verbatim collapsed the kit bays to world≈block-local coords —
      // a phantom stone wall across the plaza — and stripped them from the
      // façades (C-031 r2 finding). `frozen` keeps the raw block-local copy:
      // revalidate diffs it against the ORIGINAL's live block, unchanged.
      const parentWorld = new THREE.Matrix4();
      const instance = new THREE.Matrix4();
      const composed = new THREE.Matrix4();
      const target = mergedInstanced.instanceMatrix.array as Float32Array;
      let cursor = 0;
      let overflow = false;
      for (const mesh of members) {
        mesh.updateWorldMatrix(true, false);
        parentWorld.copy(mesh.matrixWorld);
        const block = mesh.instanceMatrix.array as Float32Array;
        for (let i = 0; i < mesh.count; i += 1) {
          instance.fromArray(block, i * 16);
          composed.multiplyMatrices(parentWorld, instance);
          composed.toArray(target, cursor * 16);
          cursor += 1;
        }
        frozen.push(block.slice(0, mesh.count * 16));
        if (cursor > count) overflow = true;
      }
      if (overflow) return; // defensive — count was computed from the same meshes
      mergedInstanced.instanceMatrix.needsUpdate = true;
      mergedInstanced.computeBoundingSphere();
      scene.add(mergedInstanced);
      for (const mesh of members) {
        mesh.visible = false;
        batchedOriginals.add(mesh);
      }
      batches.push({ merged: mergedInstanced, originals: members, ownsGeometry: false, frozen, sources: sourcesOf(members) });
    };

    /**
     * Drift containment: a batch whose originals were unmounted, re-shown or
     * moved is dropped ALONE — its originals return to the candidate flow and
     * are either re-batched or (if they turned out to move) left authored.
     * Tearing everything down for one rotating board's remount churned the
     * whole plaza and showed up as frame hitches (C-032).
     */
    const revalidate = (() => {
      // Pointer checks are O(1) per original and run every tick; the matrix
      // audit walks a slice per tick so every original is re-read within a
      // couple of seconds without a per-tick traversal hitch.
      let cursor = 0;
      return () => {
        if (!running) return;
        for (let b = batches.length - 1; b >= 0; b -= 1) {
          const batch = batches[b];
          if (!batch.merged.parent || !batch.frozen) {
            teardownBatch(b);
            continue;
          }
          for (let i = 0; i < batch.originals.length; i += 1) {
            const original = batch.originals[i];
            const source = batch.sources[i];
            if (!original.parent || original.visible || source === undefined || original.material !== source.material || original.geometry !== source.geometry) {
              teardownBatch(b);
              break;
            }
          }
        }
        for (let n = 0; n < 64 && batches.length > 0; n += 1) {
          const b = cursor % batches.length;
          const i = Math.floor(cursor / batches.length) % batches[b].originals.length;
          const original = batches[b].originals[i];
          const frozen = batches[b].frozen[i];
          const current = (original as THREE.InstancedMesh).isInstancedMesh
            ? ((original as THREE.InstancedMesh).instanceMatrix.array as Float32Array).subarray(
                0,
                (original as THREE.InstancedMesh).count * 16,
              )
            : snapshot(original);
          if (!frozen || !original.parent || original.visible || !sameMatrix(frozen, current)) {
            teardownBatch(b);
            continue;
          }
          cursor += 1;
        }
      };
    })();

    // Pipeline: observe stamps movers and stills alike; build folds everything
    // that has held still across two observe ticks (>= 700 ms); revalidate
    // tears down on any drift so theme/tier/population changes self-heal.
    //
    // The timers run only while the tab is genuinely hidden from the visitor.
    // A hidden tab paints nothing (the canvas is parked on `demand`), so
    // batching for it is pure battery cost — and the 250 ms revalidate tick in
    // particular would keep tearing down and rebuilding batches for a scene
    // nobody can see.
    //
    // Debug is exempt, on the canvas' own existing law: an embedded browser
    // reports `document.hidden` permanently, and the capture harness refuses to
    // present until the batcher has settled — pausing there would stall every
    // capture instead of saving any power.
    const parked = () => document.hidden && !debug;

    let observeTimer: ReturnType<typeof setInterval> | null = null;
    let buildTimer: ReturnType<typeof setInterval> | null = null;
    let checkTimer: ReturnType<typeof setInterval> | null = null;

    const stopTimers = () => {
      cancelBuild();
      if (observeTimer !== null) clearInterval(observeTimer);
      if (buildTimer !== null) clearInterval(buildTimer);
      if (checkTimer !== null) clearInterval(checkTimer);
      observeTimer = null;
      buildTimer = null;
      checkTimer = null;
    };

    const startTimers = () => {
      if (observeTimer !== null) return;
      observeTimer = setInterval(observe, 900);
      buildTimer = setInterval(build, 1800);
      checkTimer = setInterval(revalidate, 250);
    };

    const onVisibilityChange = () => {
      if (parked()) stopTimers();
      else startTimers();
    };

    if (!parked()) startTimers();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      running = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopTimers();
      teardown();
    };
  }, [scene, noMeshMerge, noInstancedMerge, prefixesKey, debug]);

  return null;
}

/**
 * The one canvas. Fixed to the viewport behind all page content.
 *
 * Route tier hides the section paint (`HideHtmlOnRoute`), so the canvas is
 * the page and takes the pointer: taps hit the invisible Focus proxies
 * (ADR-0003), wheel and touch still fall through to the document so page
 * scroll keeps driving the stations. The HUD nav and the docked panels sit
 * above it and keep their own pointer events.
 *
 * Stacking (W7 audit): the wrapper is POSITIONED at z-index 0, so by CSS
 * paint order it lands above the world's ground backdrop (-z-10) AND above
 * the non-positioned sections — from the moment it mounts, not from
 * `presented`. Left alone, the opaque canvas covered the semantic page and
 * swallowed its clicks for the whole load, exposing compile stutter and the
 * half-built scene. `data-route-canvas` is the hook for the W7 rule in
 * globals.css that keeps it at opacity 0 until `html[data-route-handoff]`
 * (and without pointer events until `html.world-route-live`): the renderer
 * keeps rendering and compiling underneath (opacity never parks a WebGL
 * canvas — only `document.hidden` does, below), and the ceremony's
 * compositor-only opacity fade (under the beam) reveals it over the
 * still-painted page (two-phase handoff). Every surface that mounts
 * this canvas must also mount `HideHtmlOnRoute`, or it stays invisible.
 * The renderer parks whenever the tab is hidden, and a lost context degrades
 * the whole surface to Lite rather than leaving a dead rectangle.
 *
 * Lite floor (wave-2 r3): mounted ONLY while the resolved tier is `route`.
 * Under Lite (reduced motion resolves Lite — D12 — as does every failure
 * path) the canvas is never mounted, and a provisional mount unmounts in the
 * same commit the tier flips, so no `[data-route-canvas]` exists under Lite.
 */
export default function RouteWorldCanvas({ children }: RouteWorldCanvasProps) {
  const { tier } = useWorldState();
  return routeCanvasMounts(tier) ? <RouteWorldCanvasLive>{children}</RouteWorldCanvasLive> : null;
}

/** Whether the route canvas may exist at all for this tier (the Lite floor). */
export function routeCanvasMounts(tier: 'route' | 'lite'): boolean {
  return tier === 'route';
}

function RouteWorldCanvasLive({ children }: RouteWorldCanvasProps) {
  const worldState = useWorldState();
  const handoff = useWorldHandoff();
  const routeData = useContext(RouteDataContext);
  const { mobile, degradeToLite, debug, theme } = worldState;
  const propFamilyPrefixes = useMemo(() => theme?.propFamilyPrefixes ?? [], [theme]);
  const pinnedQuality = useMemo(() => readPinnedQuality(), []);
  const noBatch = useMemo(() => readNoBatch(), []);
  const [qualityIndex, setQualityIndex] = useState(
    () => pinnedQuality ?? initialQualityIndex(mobile),
  );
  const [hidden, setHidden] = useState(false);
  /** M2 presence release, armed in `onCreated` (W7 loader). */
  const releaseRenderer = useRef<(() => void) | null>(null);

  // M1 for the loader (W7): the deferred scene chunk resolved — this canvas
  // mounted. Presence, released on unmount (see scene-progress.ts).
  useEffect(() => noteCanvasMounted(), []);

  useEffect(
    () => () => {
      releaseRenderer.current?.();
      releaseRenderer.current = null;
    },
    [],
  );

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // Debug inspection needs a live scene even in an embedded browser, which is
  // where `document.hidden` is permanently true.
  const parked = hidden && !debug;
  // D38 / D40: the frame cap's mode at load. D40 (ENGINE-A5): `even40` is the
  // default, so the canvas runs `frameloop="never"` under FrameCapDriver unless
  // the page opted out with `?routeFrameCap=off` (the pre-D40 `always` loop).
  // Under `never`, r3f's `invalidate()` is a no-op: every render comes from the
  // driver's rAF (uncapped through the ceremony and the theme veil). The
  // audited paths are listed in engine-a5.test.ts.
  const [frameCapDriven] = useState(() => requestedFrameCapMode() !== 'off');

  const stepDown = useCallback(() => {
    if (pinnedQuality !== null) return;
    setQualityIndex((current) => Math.min(current + 1, QUALITY_LADDER.length - 1));
  }, [pinnedQuality]);

  // ENGINE r3 (`?routeDebug=1` only): the ladder readout and the force hook
  // the quiet probe's governor leg drives (`__routeWorldQuality` /
  // `__routeWorldQualityForce`), so a harness steps rungs deterministically
  // instead of inducing slow frames. Descend-only, like the governor.
  const qualityRef = useRef(qualityIndex);
  useLayoutEffect(() => {
    qualityRef.current = qualityIndex;
  }, [qualityIndex]);
  useEffect(() => {
    if (!debug) return;
    const host = window as QualityHost;
    host.__routeWorldQuality = () => {
      // ENGINE r4 (CAR r3: "the 390 @ dpr 2 trace presents at an effective
      // DPR of about 1.35"): that IS the ladder — every rung caps the buffer
      // (`QUALITY_LADDER[r].dpr`: 1.75 / 1.35 / 1.35 / 1 / 1, min'd with the
      // device) and the capture pins rung 1 — so the readout names both.
      const canvas = document.querySelector<HTMLCanvasElement>('[data-route-canvas] canvas');
      const cssWidth = canvas?.clientWidth ?? 0;
      return {
        rung: qualityRef.current,
        pinned: pinnedQuality !== null,
        deviceDpr: window.devicePixelRatio,
        rungDpr: resolveDpr(QUALITY_LADDER[qualityRef.current]),
        bufferDpr: canvas && cssWidth > 0 ? Math.round((canvas.width / cssWidth) * 1000) / 1000 : null,
        buffer: canvas ? { width: canvas.width, height: canvas.height } : null,
      };
    };
    host.__routeWorldQualityForce = (rung: number) => {
      if (!Number.isInteger(rung) || rung < 0 || rung >= QUALITY_LADDER.length) {
        return { ok: false, reason: `rung ${String(rung)} is not on the ladder` };
      }
      if (rung < qualityRef.current) return { ok: false, reason: 'the ladder never climbs' };
      setQualityIndex(rung);
      return { ok: true };
    };
    return () => {
      delete host.__routeWorldQuality;
      delete host.__routeWorldQualityForce;
    };
  }, [debug, pinnedQuality]);

  /**
   * The ladder ran out and the frame rate still could not be held. A pinned
   * quality is a debug/capture instruction — the harness grades one specific
   * rung, so dropping to Lite underneath it would invalidate the run.
   */
  const exhaustQuality = useCallback(() => {
    if (pinnedQuality !== null) return;
    markSceneFailed('sustained-pressure');
    degradeToLite('sustained-pressure');
  }, [pinnedQuality, degradeToLite]);

  // Review r5: R3F's unmount DELIBERATELY loses the context
  // (`forceContextLoss`, ~500 ms after the canvas leaves), which reached the
  // handler below after a readiness timeout had already flipped Lite and
  // reset the phase — it re-marked the scene `failed` and overwrote the true
  // Lite reason (`readiness-timeout` → `context-lost`). An unmounted canvas's
  // loss is not a fault.
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  const handleContextLost = useCallback(
    (event: Event) => {
      if (unmounted.current) return;
      // Prevent the default so the browser does not try to restore a context
      // we are about to stop using; Lite takes over from here.
      event.preventDefault();
      // Review r5: the failure is recorded with its reason (trace), and the
      // ball is aborted INSIDE this handler — committed and published before
      // the Lite flip, whose commit unmounts the whole canvas tree.
      markSceneFailed('context-lost');
      abortBallNow();
      degradeToLite('context-lost');
    },
    [degradeToLite],
  );

  // The load warm's post passes: the governor only steps down, so the start
  // rung and every rung below it (`postPassesFrom`).
  const [startQualityIndex] = useState(qualityIndex);

  // Review r5: relay the renderer's programs-warm latch to the provider's
  // readiness trace (the provider cannot import the scene-chunk module).
  useEffect(
    () => bindProgramsWarmSource({ get: getProgramsWarm, subscribe: subscribeProgramsWarm }),
    [],
  );

  // R3F only reports a miss for clicks that did not travel (≤ 2 px), so an
  // orbit drag that ends on empty plaza never reads as tap-away.
  const handlePointerMissed = useCallback(() => {
    const { phase } = focusStore.get();
    if (phase === 'focused' || phase === 'focusing') focusStore.release();
  }, []);

  return (
    <>
      <div aria-hidden="true" data-route-canvas="" className="pointer-events-auto fixed inset-0 z-0">
        <Canvas
          frameloop={parked ? 'demand' : frameCapDriven ? 'never' : 'always'}
          dpr={resolveDpr(QUALITY_LADDER[qualityIndex])}
          // Shadow maps: the low golden key only reads as a sun once the
          // statues and blocks cast. The ladder's `shadowMapSize` sizes them.
          // "percentage" = PCFShadowMap, the type three ≥0.185 already
          // substitutes for the deprecated PCFSoftShadowMap (R3F maps BOTH
          // `shadows="soft"` and a plain boolean `shadows` onto the deprecated
          // enum, which warns on every canvas creation) — so this pins the
          // shadow type to what actually renders.
          shadows="percentage"
          gl={{
            antialias: true,
            alpha: false,
            stencil: false,
            powerPreference: 'high-performance',
          }}
          onCreated={({ gl, scene }) => {
            // D23 (LOOK-PLAN §2 G4): the ACES post-off branch is gone. The
            // composer is always mounted (PostStack), so every scene program
            // targets its HDR buffer (linear, no tone mapping) and AgX is the
            // only operator at every rung; none here keeps a pre-composer
            // frame from compiling a stray screen variant.
            //
            // ENGINE r3: the START rung's operator, not a blanket none. R3F
            // calls `onCreated` from its root's layout effect, AFTER every
            // child's — so a none here overwrote the ACES PostStack's layout
            // effect had just set for a post-off start rung (2–4): those rungs
            // rendered with no tone mapping at all (clipped highlights, the r2
            // rung-2 luma saturation) and their first real frame linked every
            // scene program again (the r2 rung-2 cold load fell to Lite).
            gl.toneMapping = outputPathFor(QUALITY_LADDER[qualityIndex]).toneMapping;
            // Before the first compile (review r5): see `readShaderCheck`.
            gl.debug.checkShaderErrors = readShaderCheck(debug);
            armFigureLoader(gl);
            // Before M2: the milestone's wobble paints before the compile.
            holdFirstRender(gl, scene);
            releaseRenderer.current?.();
            releaseRenderer.current = noteRendererLive();
            gl.domElement.addEventListener('webglcontextlost', handleContextLost);
          }}
          onPointerMissed={handlePointerMissed}
        >
          <WorldStateContext.Provider value={worldState}>
            <WorldHandoffContext.Provider value={handoff}>
              <RouteDataContext.Provider value={routeData}>
                <SkyClear />
                <CeremonyRenderGate />
                {frameCapDriven ? <FrameCapDriver enabled={!parked} /> : null}
                <ConductorDriver />
                <LoadProgressBridge />
                <SceneReadinessReporter />
                <LoadWarmer startQualityIndex={startQualityIndex} />
                <OtherPaletteHdriPrefetch />
                <ResidencyBridge />
                <FrameStatsRecorder />
                <CaptureFramebuffer />
                <RenderPathBridge />
                <FocusController />
                <QualityGovernor index={qualityIndex} onStepDown={stepDown} onExhausted={exhaustQuality}>
                  <FigureDirector />
                  <StagedWorld>{children}</StagedWorld>
                  {debug && typeof window !== 'undefined' && coreActorsRequested(window.location.search) ? <CoreActorProbe /> : null}
                </QualityGovernor>
                {noBatch.mesh && noBatch.instanced ? null : (
                  <StaticBatcher arm={noBatch} propFamilyPrefixes={propFamilyPrefixes} />
                )}
                <ProbeDprBridge />
                {debug ? <TelemetrySampler rung={qualityIndex} /> : null}
                {debug ? <WarmStatsFrames /> : null}
                {debug ? <PhasePinBridge /> : null}
                {debug ? <SceneHandleBridge /> : null}
                {debug ? <DebugSceneAudit /> : null}
                {debug ? <EvidenceBridges /> : null}
              </RouteDataContext.Provider>
            </WorldHandoffContext.Provider>
          </WorldStateContext.Provider>
        </Canvas>
      </div>
      {/* D32: the theme veil covers the canvas (same z-index, later in DOM
          order) during a day/night swap after the reveal. */}
      <RouteThemeVeil />
      {/* ENGINE-A3 (D23): the focus hover chrome's GPU raster programs, once, under the ball. */}
      <HoverChromePrimer />
    </>
  );
}

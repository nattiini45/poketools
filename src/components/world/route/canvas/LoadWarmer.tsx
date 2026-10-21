'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '../WorldStateProvider';
import { postPassesFrom, QUALITY_LADDER } from '@/lib/route-world/quality';
import { buildPoseLedger, createPose, samplePath } from '@/lib/route-world/camera-path';
import { getPostComposer } from '../post/post-store';
import { currentSceneGeneration, getGenerationBegunAt, getReadyDeadlineMs, getScenePhase } from '../world-readiness';
import { noteWarmStat, warmStatsOn } from '../perf/warm-stats';
import {
  assetLoadsInFlight,
  getRevealArmedAt,
  getSceneProgress,
  loadStallInjected,
  noteLoadSignal,
  noteWarmFrame,
  noteWarmStage,
  recordSceneMilestone,
  recordSceneWarm,
  revokeSceneWarm,
  type WarmFrameEntry,
} from '../scene-progress';
import {
  createLoadWarm,
  LOAD_WARM_STAGES,
  loadWarmAllowsDraw,
  type LoadWarmStage,
  postPassesToWarm,
  registeredWarmPostPasses,
  stepLoadWarm,
  VEILED_WARM,
} from '../warm/load-warm';
import { createLoadWarmIO } from '../warm/load-warm-io';
import { renderTargetsOf, warmOutputsFor } from '../warm/load-warm-io-helpers';
import { markLoadWarmComplete } from '../warm/programs-warm';
import { captureThemeSwap, releaseThemeSwapRetention, settleThemeSwap, themeSwapRetention } from '../warm/theme-swap-retention';
import { deferExternalUploads } from '../warm/upload-deferral';
import type { WarmPose } from '../warm/compile-variants';
import { outputPathFor } from '../post/PostStack';
import { dataFaceEntries, getDataFaceLog } from '../residency-store';
import { completedPaints, paintQueueIdle, subscribePaintQueue } from '../paint-queue';
import { bandedUploadLog, verifyBandedUploads } from '../content/banded-upload';
import { pointLightCeiling } from '../light-loop';
import { getThemeVeilPhase, registerThemeSwapHook } from '../theme-veil-store';
import { drawnFrames, frameHeld, heldFrames, lastDrawAt, rawRenders, setFrameHold, withRawRenders } from './frame-hold';
import { worldStaged } from './StagedWorld';

/**
 * The load warm ceremony's frame-driven host and the point-light pad. The
 * warm's stages, slices and three.js IO live in ../warm/.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

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

export function LoadWarmer({ startQualityIndex }: { startQualityIndex: number }) {
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

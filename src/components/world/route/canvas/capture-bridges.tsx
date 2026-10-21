'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { pinFigureDirector } from '../figures/FigureDirector';
import { failedFigureLoads, meshoptWorkerFallback, vertexPromotionTotals } from '../figures/figure-loader';
import { getPostComposer } from '../post/post-store';
import { describeDataFace } from '../warm/load-warm-io-helpers';
import { dataFaceEntries, getDataFaceLog } from '../residency-store';
import { facePaintFontLog } from '../paint-queue';
import { drivenClockSeconds, pinPhaseAdvance } from '../frame-cap';

/**
 * Capture-harness bridges: the framebuffer present and its kit gate, the
 * render-path sampler, the live-scene handle and the animation-phase pin.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

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
export function CaptureFramebuffer() {
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
export function RenderPathBridge() {
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
export function SceneHandleBridge() {
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
export function PhasePinBridge() {
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

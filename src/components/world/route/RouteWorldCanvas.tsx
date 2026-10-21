'use client';

import { type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import ConductorDriver from './ConductorDriver';
import QualityGovernor from './QualityGovernor';
import FigureDirector from './figures/FigureDirector';
import CoreActorProbe from './figures/CoreActorProbe';
import { coreActorsRequested } from './figures/core-actor-probe.data';
import { RouteDataContext } from './RouteDataProvider';
import { useWorldHandoff, useWorldState, WorldHandoffContext, WorldStateContext } from './WorldStateProvider';
import { initialQualityIndex, QUALITY_LADDER, resolveDpr } from '@/lib/route-world/quality';
import { armFigureLoader } from './figures/figure-loader';
import FocusController from './focus/FocusController';
import EvidenceBridges from './EvidenceBridges';
import { focusStore } from './focus/focus-store';
import { markSceneFailed } from './world-readiness';
import { abortBallNow, bindProgramsWarmSource, noteCanvasMounted, noteRendererLive } from './scene-progress';
import { getProgramsWarm, subscribeProgramsWarm } from './useStationWarmup';
import { outputPathFor } from './post/PostStack';
import { installPointLightLoop } from './light-loop';
import RouteThemeVeil from './RouteThemeVeil';
import HoverChromePrimer from './HoverChromePrimer';
import { installSkeletonGuard } from './secondary-renders';
import { requestedFrameCapMode } from './frame-cap';
import { CaptureFramebuffer, PhasePinBridge, RenderPathBridge, SceneHandleBridge } from './canvas/capture-bridges';
import { DebugSceneAudit } from './canvas/DebugSceneAudit';
import { holdFirstRender } from './canvas/frame-hold';
import { FrameCapDriver } from './canvas/FrameCapDriver';
import { FrameStatsRecorder, LoadProgressBridge, ResidencyBridge } from './canvas/load-bridges';
import { LoadWarmer } from './canvas/LoadWarmer';
import { OtherPaletteHdriPrefetch } from './canvas/OtherPaletteHdriPrefetch';
import { CeremonyRenderGate, SkyClear, WarmStatsFrames } from './canvas/render-gates';
import { SceneReadinessReporter } from './canvas/SceneReadinessReporter';
import { StagedWorld } from './canvas/StagedWorld';
import { StaticBatcher } from './canvas/StaticBatcher';
import { ProbeDprBridge, TelemetrySampler } from './canvas/telemetry-bridges';

// The canvas's parts live in ./canvas/ (one module per concern, see
// docs/modules-index.md); these re-exports keep every import of this path working.
export {
  LOAD_INERT_DRAW_MS,
  POINT_LIGHT_PAD_NAME,
  VEILED_ENV_WAIT_MS,
  WARM_MAX_REWARMS,
  WARM_RECHECK_MS,
} from './canvas/LoadWarmer';
export { worldStaged } from './canvas/StagedWorld';
export { BATCH_BUILD_SLICE_MS, isDataFaceMaterial, materialSignature } from './canvas/batch-merge';

// ENGINE r3: before any program compiles (the chunk loads with the canvas).
installPointLightLoop();
// ENGINE-A3 fix (D23 headroom): a frame's secondary world renders skip the
// skeleton update (see secondary-renders.ts).
installSkeletonGuard();

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

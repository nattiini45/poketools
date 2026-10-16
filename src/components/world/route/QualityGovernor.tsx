'use client';

import { createContext, startTransition, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, DataTexture, Material, type Camera, type Light, type Object3D, type WebGLRenderer } from 'three';
import {
  governorInLoadGrace,
  INITIAL_GOVERNOR_PRESSURE,
  QUALITY_LADDER,
  resolveDpr,
  stepGovernorPressure,
  type QualityStep,
} from '@/lib/route-world/quality';
import { uncappedFrameMs } from './frame-cap';
import { getScenePhase } from './world-readiness';
import { getBallPhase, getBallPhaseSince, getRevealArmedAt, hasBallLoader } from './scene-progress';

/**
 * Ceremony DPR clamp (wave-2 r2, W7 compositor-freeze veto): from the moment
 * the Pokéball docks until `CEREMONY_DPR_RELEASE_MS` after it is done, the
 * drawing buffer runs at the LADDER FLOOR's DPR (the last rung — no value of
 * its own, quality.ts stays the only source). The GPU work of the frames
 * that share the compositor with the CSS beam scales with the buffer's pixel
 * count, and the canvas is inert (opacity 0) for most of that span anyway.
 * The full DPR returns once the ball is gone — one buffer resize, after the
 * ceremony instead of inside it. A no-op wherever the rung's DPR is already
 * at the floor (a DPR-1 desktop).
 */
export const CEREMONY_DPR_RELEASE_MS = 300;

/** Whether the ceremony DPR clamp holds at `nowMs` (read from the loader's published phase). */
export function ceremonyDprClamp(nowMs: number): boolean {
  if (!hasBallLoader()) return false;
  const phase = getBallPhase();
  if (phase === 'loading' || phase === 'opening' || phase === 'releasing') return true;
  return phase === 'done' && nowMs - getBallPhaseSince() < CEREMONY_DPR_RELEASE_MS;
}

const FLOOR_STEP = QUALITY_LADDER[QUALITY_LADDER.length - 1];

/**
 * How a rung's shadow fields drive the renderer (D23, LOOK-PLAN §2 G5). The
 * map size and every light's `castShadow` never change (both are program
 * keys / render-target allocations); the ladder sheds shadow cost through
 * the update cadence and the shadow term's strength only:
 * - `autoUpdate`: three re-renders the map every frame (`always` rungs);
 * - `updateOnMove`: the map re-renders only on frames the camera moved
 *   (`on-move` rungs with a visible shadow);
 * - `zeroIntensity`: the shadow term is scaled to 0 (`LightShadow.intensity`,
 *   a uniform) and the map is never re-rendered — the look of "shadows off"
 *   with the programs and the target untouched.
 */
export interface ShadowRungPlan {
  autoUpdate: boolean;
  updateOnMove: boolean;
  zeroIntensity: boolean;
}

export function shadowRungPlan(step: Pick<QualityStep, 'shadowUpdate' | 'shadowIntensity'>): ShadowRungPlan {
  const zeroIntensity = step.shadowIntensity === 0;
  return {
    autoUpdate: !zeroIntensity && step.shadowUpdate === 'always',
    updateOnMove: !zeroIntensity && step.shadowUpdate === 'on-move',
    zeroIntensity,
  };
}

/** Frames between re-scans of the scene's shadow-casting lights (they mount during load). */
const SHADOW_LIGHT_RESCAN_FRAMES = 60;

type ShadowLight = Light & { shadow?: { intensity: number } };

function castingLights(scene: Object3D): ShadowLight[] {
  const lights: ShadowLight[] = [];
  scene.traverse((object) => {
    const light = object as ShadowLight;
    if (light.isLight === true && light.castShadow && light.shadow) lights.push(light);
  });
  return lights;
}

/**
 * Applies the rung's shadow plan (see `shadowRungPlan`). Cross-world and
 * pixel-neutral on rungs 0–2 (auto update on, intensity untouched). The
 * intensity is only ever WRITTEN on a zero-intensity rung, and the value a
 * light carried is kept on it (`userData.rungShadowIntensity`) — the ladder
 * never climbs, but a remount restoring the rung restores it.
 */
function useShadowRung(step: QualityStep): void {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const track = useRef<{ lights: ShadowLight[]; scanAt: number; frame: number; last: number[] | null }>({
    lights: [],
    scanAt: -Infinity,
    frame: 0,
    last: null,
  });

  useFrame(() => {
    const plan = shadowRungPlan(step);
    const state = track.current;
    applyShadowPlan(gl, plan, plan.updateOnMove && cameraMoved(camera, state));
    state.frame += 1;
    if (plan.zeroIntensity) {
      if (state.frame - state.scanAt >= SHADOW_LIGHT_RESCAN_FRAMES) {
        state.lights = castingLights(scene);
        state.scanAt = state.frame;
      }
      for (const light of state.lights) {
        const shadow = light.shadow;
        if (!shadow || shadow.intensity === 0) continue;
        light.userData.rungShadowIntensity = shadow.intensity;
        shadow.intensity = 0;
      }
    } else if (state.lights.length > 0) {
      for (const light of state.lights) {
        const kept = light.userData.rungShadowIntensity as number | undefined;
        if (light.shadow && typeof kept === 'number' && light.shadow.intensity === 0) light.shadow.intensity = kept;
      }
      state.lights = [];
    }
  }, -900);
}

function applyShadowPlan(gl: WebGLRenderer, plan: ShadowRungPlan, moved: boolean): void {
  if (gl.shadowMap.autoUpdate !== plan.autoUpdate) gl.shadowMap.autoUpdate = plan.autoUpdate;
  if (moved) gl.shadowMap.needsUpdate = true;
}

function cameraMoved(camera: Camera, state: { last: number[] | null }): boolean {
  const elements = camera.matrixWorld.elements;
  const last = state.last;
  let moved = last === null;
  if (last !== null) {
    for (let i = 0; i < 16; i += 1) {
      if (Math.abs(elements[i] - last[i]) > 1e-5) {
        moved = true;
        break;
      }
    }
  }
  if (moved) state.last = Array.from(elements);
  return moved;
}

/**
 * Frame-time governor and the quality context scene actors read.
 *
 * The ladder descends strictly in order — resolution, then scene population,
 * then shadow fidelity, and only last the figure LOD. D23: a step never
 * links a program or re-uploads an asset: post passes only flip `.enabled`
 * (PostStack), shadows only change cadence and strength (`shadowRungPlan`),
 * and DPR is the only lever that reallocates (render targets, reported
 * separately by the quiet probe). Authored landmarks,
 * camera endpoints and interaction meaning are never cut, because a cheaper
 * frame that no longer tells the story is not a cheaper frame, it is a
 * different page.
 *
 * It only ever descends. Climbing back up trades a soft frame for a visible
 * oscillation, which is the worse artifact.
 */

/**
 * Material disposals are HELD from the first governor step (ENGINE r3).
 * Content that rebuilds its material on a rung change (a water or petal
 * `ShaderMaterial` recreated with the SAME source when its detail or density
 * changes) disposed the old one in the step's commit, before the new one
 * compiled: three dropped the shared shader stages and every program the
 * old instance held — including the lower rungs' output variants the load
 * warm linked for it — and the new material linked again (the quiet probe's
 * governor leg: 6-12 links in sakura, mountain and clouds). Held, the old
 * instances keep those programs alive, so every later rung finds its
 * variant in three's cache (identical keys). A step CAPTURES disposals from
 * its request until STEP_DISPOSE_HOLD_FRAMES drawn frames after its commit
 * (the superseded materials dispose in that commit); `Material.dispose` then
 * runs at once again — the patch is page-wide, and left on until the floor
 * it swallowed every disposal on the page (theme-swap releases, other
 * canvases) for the rest of a visit that never reached it (Kilo, PR #65).
 * The captured materials stay undisposed until the ladder's floor (the same
 * frames after the last step) or until the canvas unmounts; they are then
 * disposed in call order.
 * Cost: a few superseded materials stay alive between the first step and
 * the floor (no textures or geometry are held).
 */
export const STEP_DISPOSE_HOLD_FRAMES = 3;

let disposeHold: { original: Material['dispose']; held: Set<Material>; capturing: boolean } | null = null;

/** Start (or re-open) capturing `Material.dispose` calls (idempotent while a capture runs). */
export function holdMaterialDisposals(): void {
  if (disposeHold === null) disposeHold = { original: Material.prototype.dispose, held: new Set<Material>(), capturing: false };
  if (disposeHold.capturing) return;
  const held = disposeHold.held;
  disposeHold.capturing = true;
  Material.prototype.dispose = function heldDispose(this: Material) {
    held.add(this);
  };
}

/** Stop capturing: later disposals run at once; the ones already held stay held until released. */
export function endMaterialDisposalCapture(): void {
  const hold = disposeHold;
  if (hold === null || !hold.capturing) return;
  hold.capturing = false;
  Material.prototype.dispose = hold.original;
}

/** Stop holding and run every held disposal, in call order. */
export function releaseMaterialDisposals(): void {
  const hold = disposeHold;
  if (hold === null) return;
  disposeHold = null;
  Material.prototype.dispose = hold.original;
  for (const material of hold.held) hold.original.call(material);
}

/**
 * ENGINE r4 (CAR r3 quiet probe, governor leg: memory.textures −17 against a
 * render-target net of −16, `dataDeleted` 1). A step that turns a pass or a
 * population off disposed its small DataTextures (N8AO's noise, population
 * data): a GPU deallocation inside the judged window. From the first step
 * those disposals are RETAINED for the canvas's life — the texture stays
 * resident (a few KB), shared by every rung, and is freed with the canvas.
 * Large data textures (an HDR environment of a replaced palette) are never
 * retained: they dispose at once, as before.
 */
export const RETAIN_DATA_TEXTURE_MAX_BYTES = 1024 * 1024;

type RetainedTexture = DataTexture | CanvasTexture;
interface TextureRetain {
  originals: { proto: { dispose: () => void }; dispose: () => void }[];
  held: Set<RetainedTexture>;
}

let textureRetain: TextureRetain | null = null;

/** Bytes the texture's pixels take on the GPU (RGBA8 estimate for a canvas; the array for data). */
function retainedBytes(texture: RetainedTexture): number {
  const image = texture.image as { data?: { byteLength?: number } | null; width?: number; height?: number } | null;
  if (image?.data?.byteLength !== undefined) return image.data.byteLength;
  if (typeof image?.width === 'number' && typeof image?.height === 'number') return image.width * image.height * 4;
  return Number.POSITIVE_INFINITY;
}

/**
 * Start retaining small DataTexture / CanvasTexture disposals (idempotent).
 * ENGINE r4: the sakura / mountain floor step also freed a CanvasTexture
 * (a VFX / billboard sprite), so both texture kinds a population makes for
 * itself are covered; loaded image textures and render targets are not.
 */
export function retainDataTextureDisposals(): void {
  if (textureRetain !== null) return;
  const held = new Set<RetainedTexture>();
  const originals: TextureRetain['originals'] = [];
  for (const proto of [DataTexture.prototype, CanvasTexture.prototype] as { dispose: () => void }[]) {
    const own = Object.prototype.hasOwnProperty.call(proto, 'dispose');
    const original = proto.dispose;
    originals.push({ proto, dispose: own ? original : (undefined as unknown as () => void) });
    proto.dispose = function retainedDispose(this: RetainedTexture) {
      if (retainedBytes(this) <= RETAIN_DATA_TEXTURE_MAX_BYTES) held.add(this);
      else original.call(this);
    };
  }
  textureRetain = { originals, held };
}

/** Stop retaining and free every retained texture (the canvas unmounts). */
export function releaseDataTextureDisposals(): void {
  const retain = textureRetain;
  if (retain === null) return;
  textureRetain = null;
  for (const { proto, dispose } of retain.originals) {
    if (dispose === undefined) delete (proto as { dispose?: () => void }).dispose;
    else proto.dispose = dispose;
  }
  for (const texture of retain.held) texture.dispose();
}

const QualityContext = createContext<QualityStep>(QUALITY_LADDER[0]);

export function useQuality(): QualityStep {
  return useContext(QualityContext);
}

interface QualityGovernorProps {
  /** Index into `QUALITY_LADDER`, owned by the canvas. */
  index: number;
  onStepDown: () => void;
  /**
   * The bottom rung still cannot hold a frame. The ladder is spent, so the
   * choice is between burning battery on an unusable world and handing the
   * visitor the semantic page.
   */
  onExhausted: () => void;
  children: ReactNode;
}

export default function QualityGovernor({
  index,
  onStepDown,
  onExhausted,
  children,
}: QualityGovernorProps) {
  // ENGINE r4 (quiet probe, governor leg: 54-88 ms dev tasks at each step):
  // the rung the WORLD sees (`applied`) follows the requested `index` in a
  // TRANSITION, so every quality consumer's re-render is time-sliced by
  // R3F's concurrent root instead of landing as one task. The disposal holds
  // start in the requested commit's layout phase — before the transition's
  // commit unmounts or rebuilds anything.
  const [applied, setApplied] = useState(index);
  useLayoutEffect(() => {
    if (index === applied) return;
    holdMaterialDisposals();
    retainDataTextureDisposals();
    startTransition(() => setApplied(index));
  }, [index, applied]);
  const step = QUALITY_LADDER[Math.min(applied, QUALITY_LADDER.length - 1)];
  const setDpr = useThree((state) => state.setDpr);
  const pressure = useRef(INITIAL_GOVERNOR_PRESSURE);
  const exhausted = useRef(false);
  const [clamped, setClamped] = useState(() => ceremonyDprClamp(performance.now()));
  useShadowRung(step);

  // ENGINE r3: a step holds material disposals for a few drawn frames (see
  // `STEP_DISPOSE_HOLD_FRAMES`). A layout effect: it runs before the step
  // commit's passive cleanups, which is where the old materials dispose.
  const lastIndex = useRef(applied);
  const holdFrames = useRef(0);
  useLayoutEffect(() => {
    if (applied === lastIndex.current) return;
    lastIndex.current = applied;
    holdMaterialDisposals();
    retainDataTextureDisposals();
    holdFrames.current = STEP_DISPOSE_HOLD_FRAMES;
  }, [applied]);
  useEffect(
    () => () => {
      releaseMaterialDisposals();
      releaseDataTextureDisposals();
    },
    [],
  );
  useFrame(() => {
    if (holdFrames.current <= 0) return;
    holdFrames.current -= 1;
    if (holdFrames.current > 0) return;
    // The step's capture closes. Its materials are disposed only at the
    // floor: until then a later step may still need a variant a superseded
    // material holds.
    if (lastIndex.current >= QUALITY_LADDER.length - 1) releaseMaterialDisposals();
    else endMaterialDisposalCapture();
  });

  // Layout effect, not a passive one: DPR must be settled before the browser
  // paints this commit, never ramped after it (C-027 visual review / C-032). The value
  // comes from `resolveDpr` — the same resolver the canvas' `dpr` prop uses —
  // so re-configures and this pin can never disagree and flip the buffer size.
  useLayoutEffect(() => {
    const dpr = resolveDpr(step);
    setDpr(clamped ? Math.min(dpr, resolveDpr(FLOOR_STEP)) : dpr);
  }, [setDpr, step, clamped]);

  useFrame((_, delta) => {
    // ENGINE r4: DataTexture disposals are retained from the ARM on, not only
    // from the first step — R3F disposes an unmounting object's textures in
    // the step commit's mutation phase, before this component's layout effect
    // (the sakura / mountain governor legs still freed one after r4's first
    // cut). Idempotent; released when the canvas unmounts.
    if (getRevealArmedAt() !== null) retainDataTextureDisposals();
    const clampNow = ceremonyDprClamp(performance.now());
    if (clampNow !== clamped) setClamped(clampNow);
    const atFloor = index >= QUALITY_LADDER.length - 1;
    if (exhausted.current) return;

    // Load grace (W7): compile/upload hitches before and just after the
    // reveal are not evidence that the device cannot hold the rung. D23: the
    // anchor is the reveal's ARM, not `presented` — the whole load warm (the
    // sliced compile / upload / pose-render ceremony) runs between the two,
    // and a step during it would re-size buffers under the ceremony. Read
    // from the module stores at frame time — no re-render needed.
    const armedAt = getScenePhase() === 'presented' ? getRevealArmedAt() : null;
    const msSinceRevealed = armedAt === null ? null : performance.now() - armedAt;
    if (governorInLoadGrace(msSinceRevealed)) {
      pressure.current = INITIAL_GOVERNOR_PRESSURE;
      return;
    }

    // ENGINE r5: spike-proof and wall-clock bounded (`stepGovernorPressure`).
    // D38: time the frame cap skipped on purpose is not a slow frame.
    const next = stepGovernorPressure(pressure.current, uncappedFrameMs(delta * 1000), performance.now());
    pressure.current = next.state;
    if (!next.step) return;
    if (atFloor) {
      // One more full slow-frame run at the bottom rung: give up on the
      // renderer rather than grinding. Fires once — `exhausted` latches so a
      // recovering frame rate cannot re-trigger it into a loop.
      exhausted.current = true;
      onExhausted();
      return;
    }
    onStepDown();
  });

  return <QualityContext.Provider value={step}>{children}</QualityContext.Provider>;
}

'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { AmbientBeatBus, BeatSphere, BeatTicket } from '@/lib/route-world/ambient-beats';
import { hash01, hashText, mix32 } from '@/lib/route-world/clip-phase';
import {
  createBehaviorStepOut,
  initBehaviorState,
  resolveBehavior,
  slotSeed,
  stepBehaviorInto,
  type BehaviorInput,
  type BehaviorSpec,
  type BehaviorState,
  type FloatingSpec,
  type PlayKind,
  type WaterlineSpec,
} from '@/lib/route-world/figure-behavior';
import type { ActorFrame, DirectorStepContext } from '@/lib/route-world/figure-director';
import { figureHeightM, figureUrl, type FigureEntry } from '@/lib/route-world/model-manifest';
import type { FigureLifeLevel } from '@/lib/route-world/quality';
import { createWaterSampleOut } from '@/lib/route-world/water';
import { gaitModelFor, matchGait } from '@/lib/route-world/walk-gait';
import {
  BREACH_LIFT_DEFAULT_M,
  BREACH_LIFT_MIN_M,
  buoyancyStep,
  createBuoyancyState,
  createSurfacerOut,
  draftFracFor,
  fullDiveDepth,
  initSurfacerState,
  maxBreachLift,
  pinSurfacer,
  residentViewSphere,
  stepSurfacer,
  surfacerBeatSphere,
  surfacerHeights,
  surfacerHeightsInto,
  surfacerHoldClip,
  surfacerIdle2S,
  createResidentFlipOut,
  residentFlipInFrustum,
  residentLatchWants,
  waderWet,
  type BuoyancyDims,
  type DriftDisc,
  type SurfacerSpot,
} from '@/lib/route-world/water-resident';
import { registerLatchActor, useDormancy } from '@/components/world/route/residency-store';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { focusStore } from '@/components/world/route/focus/focus-store';
import { useWaterBody, type WaterBodyHandle } from '@/components/world/route/water/WaterEventContext';
import Figure from './Figure';
import { useFigureGLTF } from './figure-loader';
import { ACTOR_PROGRAM_SHARE_DEFAULT, useActorProgramShare, type ActorProgramShare } from './actor-programs';
import { findFigure, registerActor, type FigureRegistration } from './figure-registry';
import { noteCoreActorFlip, type CoreActorDebugRow } from './core-actor-probe.data';

/**
 * A water resident (POKEMON-CORE-PLAN §4 SEAT D step 5; D8, C4–C5, C9–C13,
 * C15): a FLOATER drifting in a keep-out-proven disc on the water field, a
 * WADER walking to the waterline and back, or a SURFACER that waits under
 * the opaque water, asks the beat bus for a `surfacing` hero beat, rises,
 * holds (idle, idle2 once; R31: a relaxed cast holds idle only, or a static
 * pose with no clips) and sinks. R32: its latch flips report its own
 * in-frustum answer (false while its top is under the waterline).
 *
 * One loop (D35 3A): it registers ONE `ActorStep` with the figure director
 * (`registerActor`, the frozen `ActorRegistration`) and never runs its own
 * `useFrame`. Its figure registers with `directorOwnsClip: false` (R18 b):
 * this actor sequences every clip, the director only advances the mixer
 * while the root is shown (a hidden root gets no mixer, R18 c).
 *
 * D23: mounted at load under the probe's `ResidentSuspense` with its GLB;
 * nothing mounts, fetches or compiles after the reveal. Visibility goes
 * through the push latch ONLY (`registerLatchActor`, L7): every root is
 * shown whenever a warm runs (load, D32 veil), and once live the surfacer
 * hides only while its top is under `surfaceY − 0.05` (under the opaque
 * water, so the flip is never seen). Floaters and the wader always want to
 * be shown. No fade, no alphaHash, no clone (L1, D26).
 *
 * R49 K9 (off-screen cost): once live, a floater or the wader also wants to
 * be HIDDEN while its padded view sphere (`residentViewSphere`: the
 * director's R14 gate math, the wader's shadow sweep along the key
 * included) is outside the frame's frustum. The director hands an
 * "everywhere" frustum while the camera moves or a focus is open, so a
 * hide happens only with the camera still. The latch runs before the step,
 * so the step's wish is a frame old when applied; the latch's `wants` also
 * shows the root at once when the camera is about to move THIS frame (the
 * conductor's progress changed since the last step, or a focus is open:
 * `residentLatchWants`, fix D-R2), so the first frame of a scroll, jump or
 * focus never renders it hidden. Flips are logged by the latch hook with
 * the director's real root-box test (K8). A hidden root costs no draw, no
 * shadow draw, no skinning and no mixer (the renderer skips an invisible
 * subtree). Its world matrices are still updated by the scene every frame:
 * fix D-R1 dropped a `matrixWorldAutoUpdate = visible` toggle, which in
 * three 0.185 saves nothing (`updateMatrixWorld` still recurses into the
 * children) and froze the root's own world matrix while hidden, so the
 * show flip's root-box test ran at the stale hidden-time transform.
 *
 * R49 K9 / D26 (programs): the figure's materials go through
 * `adoptSharedPrograms` (`programShare`, see `actor-programs.ts`) in the
 * commit that mounts it, before any frame, so it compiles only program keys
 * the world's figures already compile.
 *
 * C13 / L6: `castShadow=false` for floaters and the surfacer; the wader
 * keeps its shadow (a cache hit on the skinned depth key). C15: the root is
 * named with the theme's prop-family prefix (`<world>-prop-resident-<slot>`)
 * so the StaticBatcher never bakes a moving child.
 *
 * Time (D40, C9): the behaviour, buoyancy and surfacer clocks advance by the
 * director's clamped delta (`ctx.dt`); water heights read the water clock
 * (the shader's `uTime`, so the capture pin freezes them coherently).
 * Per frame: pose, visibility and clip are written imperatively; no React
 * state, no allocation in a steady frame (events allocate their record; the
 * surfacer's heights go into one reused record, `surfacerHeightsInto`).
 *
 * Play (R12): floater play (breach / dive / spin) runs in this step on the
 * existing `figure-behavior` timers, rides the bus's `play` event channel,
 * is held off while the scene is not live, unsettled, loading, focused or
 * hidden (re-armed, never a backlog), and `?beatForce=play@<s>` fires one at
 * that forced second. The wader's waterline crossings go to the ledger
 * (`noteWaterline`, K6).
 */

export type WaterResidentMode = 'floater' | 'wader' | 'surfacer';

interface ResidentCommon {
  /** The cast slot (seeds, debug keys). */
  slotId: string;
  /** Prop-family root name (C15): `<world>-prop-resident-<slot>`. */
  rootName: string;
  entry: FigureEntry;
  /** The water body id (`useWaterBody`). */
  bodyId: string;
  /** The body's rest surface (used until the handle is live). */
  surfaceY: number;
  station: number | null;
  /** Dev-only readout row (the core probe's `__routeWorldCoreActors`). */
  debug?: CoreActorDebugRow;
  /** Program-sharing rules for the figure's materials (default: `ACTOR_PROGRAM_SHARE_DEFAULT`). */
  programShare?: ActorProgramShare;
}

export type WaterResidentProps = ResidentCommon &
  (
    | { mode: 'floater'; disc: DriftDisc; yaw: number; headroomBelowY: number; driftMps: number }
    | { mode: 'wader'; anchor: { x: number; z: number; yaw: number }; edge: readonly [number, number]; speedMps: number }
    | { mode: 'surfacer'; spot: SurfacerSpot; portrait: boolean }
  );

/** Wake strength floor (a drifting body always leaves a readable ring). */
const WAKE_MIN_STRENGTH = 0.35;
/** The clip crossfade (the director's `DIRECTOR_CROSSFADE_S`). */
const CROSSFADE_S = 0.35;
/** A viewport this narrow is portrait (data-surfaces `MOBILE_MAX_WIDTH`). */
const PORTRAIT_MAX_WIDTH = 767;

/** A floater play held off (bus suppression) re-arms instead: the same budget without play. */
function withoutPlay(level: FigureLifeLevel): FigureLifeLevel {
  return level === 'full' ? 'reduced' : level;
}

export default function WaterResident(props: WaterResidentProps) {
  const { rootName, entry, bodyId, station, mode } = props;
  const root = useRef<THREE.Group>(null);
  const isDormant = useDormancy();
  const water = useWaterBody(bodyId);
  const scene = useThree((state) => state.scene);
  // D-R2: the conductor whose damped progress drives the camera rig (read at the step and at the latch).
  const { conductor } = useWorldState();
  const figureName = `${rootName}:figure`;

  // Latest props in a ref (the step closure is registered once).
  const live = useRef({ props, water, isDormant, scene, conductor });
  useEffect(() => {
    live.current = { props, water, isDormant, scene, conductor };
  });

  /** Measured dims (Figure `onMeasure`, once per clone); the manifest height until then. */
  const dims = useRef<BuoyancyDims>({ heightM: figureHeightM(entry), lengthM: 0.6, beamM: 0.6 });
  const onMeasure = useMemo(
    () => (size: readonly [number, number, number]) => {
      dims.current = { heightM: size[1], lengthM: size[2], beamM: size[0] };
    },
    [],
  );

  // A clip-less GLB (no mixer ever poses it) culls its parts per object: its rest spheres are exact.
  // The same cached GLTF the Figure child reads (no second load).
  const gltf = useFigureGLTF(figureUrl(entry));
  useActorProgramShare(root, props.programShare ?? ACTOR_PROGRAM_SHARE_DEFAULT, props.debug, gltf.animations.length === 0);

  useEffect(() => {
    const group = root.current;
    if (group) group.rotation.order = 'YXZ';
    let figure: FigureRegistration | null = null;
    /** Seed of the behaviour / schedule (slot id × the bus seed: `?beatSeed=` reproduces it). */
    let seed = -1;
    let behavior: BehaviorState | null = null;
    let spec: BehaviorSpec | null = null;
    const stepOut = createBehaviorStepOut();
    const input: BehaviorInput = { spec: null as unknown as BehaviorSpec, life: 'full', moverSlot: true, water: false };
    const buoy = createBuoyancyState();
    const surf = createSurfacerOut();
    let surfacer: ReturnType<typeof initSurfacerState> | null = null;
    let ticket: BeatTicket | null = null;
    /** The director's bus the ticket came from (the unmount hands an open ticket back to it). */
    let bus: AmbientBeatBus | null = null;
    const sphere: BeatSphere = { x: 0, y: 0, z: 0, r: 1 };
    const waterOut = createWaterSampleOut();
    const scratch = { clip: null as string | null, timeScale: 1, wants: true, wet: false, forcePlay: false, smooth: Number.NaN };
    const flip = createResidentFlipOut();
    /** The surfacer's heights, recomputed in place each step (a late `onMeasure` flows in; no allocation). */
    const heights = { surfaceY: 0, restTopY: 0, riseTopY: 0 };
    /** The figure height the floater's play clamps were built from (a late `onMeasure` rebuilds them). */
    let specHeightM = Number.NaN;

    const handleNow = (): WaterBodyHandle | null => live.current.water;

    const figureNow = (): FigureRegistration | null => {
      if (figure === null || figure.object.current === null) figure = findFigure(figureName);
      return figure;
    };

    const playClip = (fig: FigureRegistration, clip: string | null, timeScale: number) => {
      if (clip === scratch.clip && timeScale === scratch.timeScale) return;
      const dur = clip !== null ? (fig.durations?.[clip] ?? 1) : 1;
      const phase = clip !== null ? hash01(seed >>> 0, hashText(clip)) * dur : 0;
      fig.play?.(clip, phase, scratch.clip === null ? 0 : CROSSFADE_S, timeScale);
      scratch.clip = clip;
      scratch.timeScale = timeScale;
    };

    /** Build the behaviour spec once the figure (its clips and durations) is known. */
    const ensureBehavior = (fig: FigureRegistration, ctxSeed: number): boolean => {
      const p = live.current.props;
      const nextSeed = mix32(ctxSeed >>> 0, slotSeed(p.slotId)) >>> 0;
      if (seed === nextSeed && ((behavior !== null && spec !== null) || surfacer !== null)) return true;
      seed = nextSeed;
      const clips = fig.clips ?? [];
      const durations = fig.durations;
      const d = dims.current;
      if (p.mode === 'floater') {
        spec = floatingSpecFor(p, clips, durations, d);
        specHeightM = d.heightM;
      } else if (p.mode === 'wader') {
        const gait = matchGait(p.speedMps, durations?.walk ?? null, gaitModelFor(p.entry).walkStrideM);
        const waterline: WaterlineSpec = {
          role: 'waterline',
          anchor: { x: p.anchor.x, z: p.anchor.z, yaw: p.anchor.yaw },
          clips,
          clipDurations: durations,
          edge: p.edge,
          after: 'retreat',
          speedMps: gait.speedMps,
          locomotionTimeScale: gait.timeScale,
        };
        spec = resolveBehavior(waterline).spec;
      } else {
        spec = null;
        surfacer = initSurfacerState(seed, surfacerHeightsInto(p.spot, d.heightM, heights));
        return true;
      }
      behavior = initBehaviorState(spec, seed);
      input.spec = spec;
      return true;
    };

    const publishEvents = (ctx: DirectorStepContext, handle: WaterBodyHandle | null, id: string) => {
      const events = stepOut.events;
      for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        if (event.kind === 'play') {
          ctx.bus.emit({ kind: 'play', actorId: id, play: event.play, t: ctx.awakeS });
          // A latched `beatForce=play@` is spent only by a play that actually fired (R12).
          scratch.forcePlay = false;
          const row = live.current.props.debug;
          if (row) row.plays += 1;
          continue;
        }
        if (handle === null) continue;
        if (event.kind === 'wake') {
          const half = dims.current.lengthM / 2;
          const strength = Math.max(WAKE_MIN_STRENGTH, event.strength);
          if (handle.publishWake(id, event.x + event.dirX * half, event.z + event.dirZ * half, strength) !== null) {
            const row = live.current.props.debug;
            if (row) row.wakes += 1;
          }
        } else if (event.cause === 'splash') {
          handle.publishAt('splash', event.x, event.z, event.strength);
        } else {
          handle.publishAt('step', event.x, event.z, event.strength);
        }
      }
    };

    /** The last step's awake clock (the latch hook logs flips between steps). */
    let awakeS = 0;
    /** R49 K9: the view sphere and, for the wader (a caster), the key light's shadow direction. */
    const view = { x: 0, y: 0, z: 0, r: 0 };
    const key = { light: null as THREE.DirectionalLight | null, wait: 0, dir: { x: 0, y: -1, z: 0 } };
    /** The scene walk's visitor, created once (a retry allocates no closure). */
    const findKeyLight = (object: THREE.Object3D) => {
      const light = object as THREE.DirectionalLight;
      if (key.light === null && light.isDirectionalLight === true && light.castShadow) key.light = light;
    };
    /** The key light's shadow direction (light → target, unit), or null; the scene walk is cached (retried every 600 steps). */
    const shadowDirNow = (): { x: number; y: number; z: number } | null => {
      if (key.light !== null && key.light.parent === null) key.light = null;
      if (key.light === null) {
        if (key.wait > 0) {
          key.wait -= 1;
          return null;
        }
        live.current.scene.traverse(findKeyLight);
        if (key.light === null) {
          key.wait = 600;
          return null;
        }
      }
      const light = key.light;
      if (!light.visible || !light.castShadow) return null;
      const a = light.matrixWorld.elements;
      const b = light.target.matrixWorld.elements;
      const x = b[12] - a[12];
      const y = b[13] - a[13];
      const z = b[14] - a[14];
      const length = Math.sqrt(x * x + y * y + z * z);
      if (!(length > 1e-6)) return null;
      key.dir.x = x / length;
      key.dir.y = y / length;
      key.dir.z = z / length;
      return key.dir;
    };

    /**
     * D-R2: write the step's visibility wish together with the progress it was computed at (the
     * latch shows the root at once when the progress has moved since). Both are written ONLY here:
     * a step that returns early (dormant, not ready) leaves both stale, so after any camera move the
     * latch keeps the root shown instead of re-applying a wish from before the move.
     */
    const noteWish = (wants: boolean) => {
      const progressNow = live.current.conductor.progress.current;
      scratch.smooth = progressNow ? progressNow.smooth : Number.NaN;
      scratch.wants = wants;
    };

    const step = (ctx: DirectorStepContext, frame: ActorFrame) => {
      const group = root.current;
      awakeS = ctx.awakeS;
      const fig = figureNow();
      const p = live.current.props;
      if (group === null || fig === null || !ensureBehavior(fig, ctx.seed)) return;
      const handle = handleNow();
      const d = dims.current;
      const row = p.debug;
      const life: FigureLifeLevel = ctx.motion === 'static' ? 'static' : ctx.life;

      if (p.mode === 'surfacer' && surfacer !== null) {
        surfacerHeightsInto(p.spot, d.heightM, heights);
        const width = typeof window === 'undefined' ? 1440 : window.innerWidth;
        const portraitBlocked = !p.portrait && width <= PORTRAIT_MAX_WIDTH;
        const active = ctx.live && !frame.dormant && ctx.motion === 'full' && life === 'full' && !portraitBlocked;
        const forced = ctx.bus.consumeForce('surfacing', ctx.forceClockS);
        bus = ctx.bus;
        // A pending ticket the bus dropped (a pin, a new generation) is asked for again.
        if (surfacer.mode === 'pending' && (ticket === null || ticket.state === 'released')) {
          ticket = ctx.bus.request('surfacing', rootName, sphere, surfacer.forced ? { forced: true } : undefined);
        }
        // Dormant: nothing advances, except a running sink finishing on the frame delta.
        const dt = frame.dormant && surfacer.mode !== 'sink' ? 0 : ctx.dt;
        // R31: a relaxed cast may lack idle2 (then the hold never asks for it) or every clip.
        const idle2S = surfacerIdle2S(fig.clips, fig.durations);
        stepSurfacer(surfacer, heights, dt, { active, granted: ticket !== null && ticket.state === 'granted', forced, idle2S }, surf);
        surfacerBeatSphere(p.spot, heights, d.beamM, sphere);
        if (surf.request) {
          ticket = ctx.bus.request('surfacing', rootName, sphere, surfacer.forced ? { forced: true } : undefined);
          if (row) row.requests += 1;
        }
        if (surf.release && ticket !== null) {
          ctx.bus.release(ticket);
          ticket = null;
        }
        if (surf.splashBreak) {
          handle?.publishAt('splash', p.spot.x, p.spot.z, 1);
          if (row) row.surfacings += 1;
        }
        if (surf.splashSink) handle?.publishAt('splash', p.spot.x, p.spot.z, 0.8);
        if (surf.stepHold) handle?.publishAt('step', p.spot.x, p.spot.z, 0.5);
        // R31: idle, or the static pose (null) for a clip-less relaxed cast; idle2 only when it exists.
        if (surf.clip !== null) playClip(fig, surfacerHoldClip(surf.clip, fig.clips), 1);
        else if (scratch.clip === null && fig.clips?.includes('idle')) playClip(fig, 'idle', 1);
        // Heave and tilt on the field while emerged; level (and still) under water.
        const emerged = Math.max(0, Math.min(1, (surf.topY - heights.surfaceY) / Math.max(heights.riseTopY - heights.surfaceY, 1e-3)));
        let heave = 0;
        if (handle !== null && emerged > 0) {
          buoyancyStep(buoy, handle.spec, p.spot.x, p.spot.z, p.spot.yaw, handle.now(), d, draftFracFor(d), 0, ctx.dt, heights.surfaceY);
          heave = (handle.sampleInto(p.spot.x, p.spot.z, waterOut).height - heights.surfaceY) * emerged;
        }
        const tilt = emerged > 0 && handle !== null ? 1 : 0;
        group.position.set(p.spot.x, surf.topY - d.heightM + heave, p.spot.z);
        group.rotation.set(-buoy.pitch * tilt, p.spot.yaw, buoy.roll * tilt);
        noteWish(surf.wantsVisible);
        if (row) {
          row.mode = surfacer.mode;
          row.wants = surf.wantsVisible;
          row.x = p.spot.x;
          row.y = surf.topY;
          row.z = p.spot.z;
        }
        return;
      }

      const state = behavior;
      const behaviorSpec = spec;
      if (state === null || behaviorSpec === null) return;
      // Dormant: the pose freezes (still shown; costs its draws, not its motion).
      if (frame.dormant) return;

      input.moverSlot = frame.moverSlot;
      input.water = handle !== null;
      if (p.mode === 'floater') {
        // A late `onMeasure` rebuilds the play clamps (breach lift, dive depth) before the next play
        // starts; the behaviour state is kept (the spec is read afresh each step). Event rate only.
        if (d.heightM !== specHeightM && state.play === '') {
          spec = floatingSpecFor(p, behaviorSpec.clips, fig.durations, d);
          specHeightM = d.heightM;
          input.spec = spec;
        }
        if (ctx.bus.consumeForce('play', ctx.forceClockS)) scratch.forcePlay = true;
        const playOk = ctx.live && ctx.settled && !ctx.loader && !ctx.focusOpen && !ctx.hidden;
        let stepLife = playOk ? life : withoutPlay(life);
        if (scratch.forcePlay && ctx.live && ctx.motion === 'full' && state.play === '') {
          // `beatForce=play@<s>`: this floater's next play is now. The latch clears only when the
          // play event is published (a step that fires none — entering, a guard — keeps it armed).
          state.nextPlayT = state.t;
          stepLife = 'full';
        }
        input.life = stepLife;
      } else {
        input.life = life;
      }
      stepBehaviorInto(state, input, ctx.dt, stepOut);
      publishEvents(ctx, handle, rootName);
      if (stepOut.clip !== null || scratch.clip !== null) playClip(fig, stepOut.clip, stepOut.timeScale);

      const pose = stepOut.pose;
      if (p.mode === 'floater') {
        // The play offset rides on the buoyed height (bobM is 0: the field carries the float).
        const lift = pose.y - p.surfaceY;
        const t = handle !== null ? handle.now() : ctx.awakeS;
        buoyancyStep(buoy, handle !== null ? handle.spec : null, pose.x, pose.z, pose.yaw, t, d, draftFracFor(d), lift, ctx.dt, p.surfaceY);
        group.position.set(pose.x, buoy.y, pose.z);
        group.rotation.set(-buoy.pitch, pose.yaw, buoy.roll);
      } else if (p.mode === 'wader') {
        group.position.set(pose.x, pose.y, pose.z);
        group.rotation.set(0, pose.yaw, 0);
        const wet = waderWet(pose.x, pose.z, p.edge[0], p.edge[1]);
        if (wet !== scratch.wet) {
          scratch.wet = wet;
          ctx.ledger.noteWaterline(rootName, wet);
          if (row) row.waterline += 1;
        }
      }
      // R49 K9: shown while the padded view sphere meets the frustum ("everywhere" while the camera moves).
      const caster = p.mode === 'wader';
      residentViewSphere(group.position.x, group.position.y, group.position.z, d, caster, caster && ctx.live ? shadowDirNow() : null, view);
      const wants = ctx.frustum.intersectsSphere(view.x, view.y, view.z, view.r);
      noteWish(wants);
      if (row) {
        row.mode = state.mode;
        row.wants = wants;
        row.x = group.position.x;
        row.y = group.position.y;
        row.z = group.position.z;
      }
    };

    const pin = () => {
      const p = live.current.props;
      if (behavior !== null && spec !== null) {
        behavior = initBehaviorState(spec, seed);
        scratch.wet = false;
        scratch.forcePlay = false;
      }
      if (surfacer !== null && p.mode === 'surfacer') {
        pinSurfacer(surfacer, surfacerHeightsInto(p.spot, dims.current.heightM, heights), 0);
        ticket = null;
      }
      buoy.primed = false;
      const fig = figureNow();
      scratch.clip = null;
      if (fig && fig.clips?.includes('idle')) playClip(fig, 'idle', 1);
    };

    const releaseActor = registerActor({
      id: rootName,
      kind: 'resident',
      object: root,
      station,
      isDormant: () => live.current.isDormant(),
      mover: mode !== 'surfacer',
      step,
      pin,
      figureId: figureName,
    });
    const releaseLatch = registerLatchActor({
      id: rootName,
      root: () => root.current,
      // D-R2: a floater's or the wader's step wish, or shown at once when the camera is about to move
      // this frame. The surfacer's wish is its beat (hidden only under the opaque water): no view gate.
      wants: () => {
        if (mode === 'surfacer') return scratch.wants;
        const progress = live.current.conductor.progress.current;
        return residentLatchWants(scratch.wants, progress ? progress.smooth : null, scratch.smooth, focusStore.get().subject !== null);
      },
      // Called by the latch on every applied flip (root.visible already flipped), with the director's
      // real root-box frustum test. R32: the surfacer answers itself — false while its top is at or
      // under the waterline (under the opaque water), else the generic test. The probe's flip log is
      // written here, at the flip the render sees (R49: a frame-frustum wish would read "everywhere"
      // while the camera moves).
      inFrustum: (r: THREE.Object3D, generic: (r: THREE.Object3D) => boolean) => {
        residentFlipInFrustum(mode === 'surfacer' && surfacer !== null ? surfacer.topY : null, heights.surfaceY, r, generic, flip);
        const row = live.current.props.debug;
        if (row) noteCoreActorFlip(row, r.visible, flip.inFrustum, awakeS, flip.underWater);
        return flip.inFrustum;
      },
    });
    return () => {
      // The bus never expires a ticket: one left open by an unmount mid-generation would hold every
      // later hero beat `busy` (granted) or be granted to no one (pending) until the next reset.
      if (ticket !== null && bus !== null) bus.release(ticket);
      ticket = null;
      releaseActor();
      releaseLatch();
    };
    // The actor registers once per mount (a re-registration after the reveal is the D23 tripwire).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = startPose(props, figureHeightM(entry));
  return (
    <group ref={root} name={rootName} position={start}>
      <Figure
        entry={entry}
        name={figureName}
        role="resident"
        station={station}
        directorOwnsClip={false}
        castShadow={mode === 'wader'}
        breathe={false}
        onMeasure={onMeasure}
      />
    </group>
  );
}

/** The floater's behaviour spec for the given (measured or manifest) dims: the play clamps follow the height. */
function floatingSpecFor(
  p: Extract<WaterResidentProps, { mode: 'floater' }>,
  clips: readonly string[],
  durations: FigureRegistration['durations'],
  d: BuoyancyDims,
): BehaviorSpec {
  const draft = draftFracFor(d);
  const lift = Math.min(BREACH_LIFT_DEFAULT_M, maxBreachLift(p.headroomBelowY, p.surfaceY, d.heightM, draft));
  const playKinds: PlayKind[] = lift >= BREACH_LIFT_MIN_M ? ['breach', 'dive', 'spin'] : ['dive', 'spin'];
  const floating: FloatingSpec = {
    role: 'floating',
    anchor: { x: p.disc.x, z: p.disc.z, y: p.surfaceY, yaw: p.yaw },
    clips,
    clipDurations: durations,
    radiusM: p.disc.r,
    surfaceY: p.surfaceY,
    // C10: the field carries the float; the null-handle bob is buoyancyStep's own.
    bobM: 0,
    driftMps: p.driftMps,
    playKinds,
    playLiftM: Math.max(0, lift),
    diveDepthM: fullDiveDepth(d.heightM, draft),
    buoyancy: 'field',
  };
  return resolveBehavior(floating).spec;
}

/**
 * The warm pose (C5; plan risk 3): floaters on their disc, the wader at its
 * shore spot, the surfacer at REST — submerged, and shown by the latch
 * while any warm runs (the conservative branch of risk 3: no drop from a
 * hold pose at the arm tick can ever be presented). The first director step
 * re-poses each with its measured height.
 */
function startPose(props: WaterResidentProps, heightM: number): [number, number, number] {
  if (props.mode === 'floater') return [props.disc.x, props.surfaceY, props.disc.z];
  if (props.mode === 'wader') return [props.anchor.x, 0, props.anchor.z];
  const rest = surfacerHeights(props.spot, heightM).restTopY;
  return [props.spot.x, rest - heightM, props.spot.z];
}

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useWorldState } from './WorldStateProvider';
import { focusStore, type FocusPhase } from './focus/focus-store';
import {
  blendPoses,
  buildPoseLedger,
  copyPose,
  createPose,
  samplePath,
  skipWeight,
  stepTurnLimiter,
  type TurnStep,
} from '@/lib/route-world/camera-path';
import {
  clampFocusStep,
  dampToward,
  focusBlendCurve,
  focusBlendRate,
  frameSubject,
  framingOptionsFor,
  orbitPose,
  panelFrameOffset,
  type FocusFraming,
  type FocusOrbit,
  type SubjectBounds,
} from '@/lib/route-world/focus';
import { WORLD_MOTION } from '@/lib/motion/tokens';
import { skipThroughOf, type SampleKind, type SkipEnd } from './useScrollConductor';
import { compileHeldCount, queuedWindowLatches } from './useStationWarmup';
import { createSettleState, stepSettleLatch, type SettleState } from '@/lib/route-world/data-surfaces';

type RouteWorldProbe = {
  smooth: number;
  exact: number;
  index: number;
  activeIndex: number;
  pin: number | null;
  camPos: [number, number, number] | null;
  worldPos: [number, number, number] | null;
  isDefaultPlaza: boolean;
  focus: {
    id: string;
    phase: FocusPhase;
    blend: number;
    orbit: FocusOrbit;
    bounds: SubjectBounds;
  } | null;
  // ── W6 additions (additive; SEAT-INF sweep recorder) ──
  /** Latched travel direction from the conductor (-1 / 0 / +1). */
  direction: -1 | 0 | 1;
  /** Signed conductor rate, station units per second. */
  velocity: number;
  /**
   * Rendered camera heading in radians, `atan2(forward.x, −forward.z)` of the
   * world view vector (the `__routeWorldCamera` convention).
   */
  yaw: number | null;
  /** The same heading before pointer parallax — the authored path alone. */
  pathYaw: number;
  /** The hysteretic nearest station (`progress.nearest`). */
  nearest: number;
  /** Multi-station skip-through state: influence 1 = pose-space blend, 0 = off. */
  skip: { active: boolean; influence: number; from: number; to: number };
  /**
   * Wave 2 (W6 residual 1): the conductor's skip-through as the station
   * windows see it — in flight, past SKIP_APPROACH, how it ended — and the
   * window latches still waiting in the shared stagger queue. The rig's
   * `skip` above is the camera blend, which releases on its own damped clock.
   */
  skipWindows: { active: boolean; approaching: boolean; to: number; end: SkipEnd | null; queued: number };
  /**
   * Wave 2 (2A settle law, read by the 2H settle gate): the latched arrival
   * signal — the same pure `stepSettleLatch` the Station Card's
   * `useStationSettle` runs, stepped here once per rig frame. It can lead or
   * trail the hook by one frame (the hook samples on its own rAF); honest
   * limit — the harness re-seeks once before judging it.
   */
  settled: boolean;
  // ── W6 round 2 (debug-only; the harness logs these on every seek) ──
  /** What the conductor's last sample was (travel / echo / remeasure / sync). */
  lastSampleKind: SampleKind;
  /** Scroll-map version the last sample was read against. */
  mapVersion: number;
  /** scrollY the last sample read (compare with window.scrollY for staleness). */
  sampleScrollY: number;
  /** Radians the turn-rate limiter currently trails the pose it tracks. */
  turnLag: number;
  /**
   * Renderables the compile guard is holding back while their shader
   * programs link (`useStationWarmup`). A still shot while this is > 0 may be
   * missing a newcomer for a few frames — the harness should wait for 0.
   */
  compileHeld: number;
  // ── Review r5 (yawRate.rig) ──
  /**
   * Radians the turn-rate limiter moved the rendered orientation on its last
   * frame (null on a snap frame: first frame, deliberate settle, live focus).
   */
  lastTurnDeltaRad: number | null;
  /** The clamped dt (s) that limiter step used — rate = delta / dt. */
  lastDt: number;
};

/** Blend values beyond which the phase flips to settled / idle. */
const SETTLE_EPS = 0.004;
/**
 * Release rate of a skip-through back to normal conductor tracking. It runs
 * only after the jump has landed (the two poses then coincide) or after the
 * visitor gives input mid-jump — the influence decays from the current
 * pose, so tracking resumes without a snap.
 */
const SKIP_RELEASE_DAMPING = 4.0;
/** `exact` drifting this far off the jump target counts as visitor input. */
const SKIP_INPUT_EPS = 0.02;

type ProbeHost = Window & { __routeWorldProbe?: () => RouteWorldProbe };

const DEFAULT_PLAZA_POS = { x: 0, y: 0, z: 5 };
const DEFAULT_PLAZA_EPS = 0.35;

/**
 * Turn-rate ceiling of the rendered camera (W6 round 2): the judge measured
 * 400–790°/s peaks on the big authored swings (roster → teams ≈ 177°) when
 * a fast fling or a chip click drives `smooth` at up to ~5 stations/s. The
 * path itself now spreads its heading change (camera-path
 * `crossingTurnEase`, ≤ 1.25× the segment average); this caps what the
 * damped channel can still ask of it. A visitor scrolling at a reading pace
 * (≤ ~1 station/s) never reaches it. Past it the orientation trails the path
 * on the shortest arc and catches up at this rate, so endpoints are still
 * reached exactly once the visitor stops. Rendering stalls cannot turn into
 * a jump either: the step is `rate × dt` with the rig's clamped dt.
 */
const MAX_TURN_RATE = THREE.MathUtils.degToRad(200);

/** Parallax is quietest mid-transition, where the occluders have to line up. */
const SEAM_PARALLAX = 0.35;

/** `atan2(forward.x, −forward.z)` of a camera orientation. */
function headingOf(quaternion: THREE.Quaternion, scratch: THREE.Vector3): number {
  scratch.set(0, 0, -1).applyQuaternion(quaternion);
  return Math.atan2(scratch.x, -scratch.z);
}

/**
 * Authored-shot orbit rig.
 *
 * Contract: positionMode authored · upMode world · inputMode orbit-offset
 * (bounded pointer parallax) · handoffOwner conductor.smooth. The route pose
 * comes from `camera-path.ts` (position lerp, orientation slerp between
 * precomputed look quaternions, pullback along the SLERPED view axis — W6).
 * Do not stack a second follow smoother on the same interval.
 *
 * Layers, each continuous in time (bar W6 — no hard cuts):
 * 1. Route: `samplePath(smooth)` — endpoints bit-identical to the frozen
 *    ledger (no-closer-camera).
 * 2. Skip-through: a programmatic jump spanning more than one station (nav
 *    chip, hash, Home/End) blends in pose space from the pose at jump start
 *    straight to the target, on ONE shortest-arc turn, instead of flying
 *    every intermediate crossing (left-right-left whiplash). Its weight is
 *    the conductor's own `smooth` progress through the jump, so it lands
 *    with the world-state channels. Visitor input or landing releases it by
 *    a damped influence from the current pose.
 * 3. Focus (ADR-0003): station ↔ framed subject on one damped smoothstep;
 *    dolly-out retraces dolly-in. A target change while a focus is live
 *    (subject B tapped, subject re-registered with new bounds) cross-blends
 *    from the CURRENT pose; a subject unmounting mid-blend keeps its last
 *    framing while the blend returns to the station.
 * 4. Pointer parallax, faded out as a focus lands.
 *
 * The rig owns its camera. It consumes `smooth`, never `exact` (except to
 * notice input during a skip). Stations come from the resolved route theme
 * (`useWorldState().theme`); without one there is nothing to fly and the rig
 * stays inert.
 */
export default function CameraRig() {
  const { conductor, mobile, theme } = useWorldState();
  const stations = useMemo(() => theme?.stations ?? [], [theme]);
  const size = useThree((state) => state.size);

  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const pointer = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const scratch = useRef({
    route: createPose(),
    stationLayer: createPose(),
    skipFrom: createPose(),
    skipTo: createPose(),
    skipPose: createPose(),
    focusPose: createPose(),
    crossFrom: createPose(),
    blended: createPose(),
    out: createPose(),
    /** The last rendered pose before parallax — the snapshot source. */
    rendered: createPose(),
    focusTarget: new THREE.Vector3(),
    heading: new THREE.Vector3(),
    worldQuat: new THREE.Quaternion(),
    /** The turn-rate-limited orientation actually rendered (before parallax). */
    limited: new THREE.Quaternion(),
    look: new THREE.PerspectiveCamera(),
  });
  // Station ↔ focus blend. Framing is cached per subject + viewport so the
  // Box3 math runs once per focus, not once per frame. `cross` < 1 while a
  // live focus cross-blends from `crossFrom` to a new target.
  const focus = useRef<{
    blend: number;
    framing: FocusFraming | null;
    subjectKey: string;
    viewKey: string;
    hasPose: boolean;
    cross: number;
    /** The step clamp held the camera short of the composed pose last frame. */
    lagging: boolean;
  }>({ blend: 0, framing: null, subjectKey: '', viewKey: '', hasPose: false, cross: 1, lagging: false });
  // Multi-station skip-through (see the layer list above).
  const skip = useRef({
    token: -1,
    active: false,
    releasing: false,
    influence: 0,
    from: 0,
    to: 0,
    startedAt: 0,
  });
  /** performance.now() of the last wheel / touch / key input. */
  const lastInput = useRef(0);
  /** False until a frame has rendered a pose worth snapshotting. */
  const primed = useRef(false);
  /** Last conductor settle token the turn limiter snapped on. */
  const settleSeen = useRef(-1);
  /** The limiter's last step, published on the probe (review r5). */
  const turnStep = useRef<TurnStep>({ deltaRad: null, dt: 0 });
  /** Wave 2: the settle latch published on the probe (see `settled`). */
  const settleLatch = useRef<SettleState>(createSettleState());

  // Piecewise between adjacent stations. A single Catmull-Rom through orbit
  // points does not land on control points at t = i/(n-1), so the desk camera
  // would miss the desk.
  const ledger = useMemo(() => buildPoseLedger(stations, mobile), [stations, mobile]);

  // Visitor input releases a skip-through. Nav activation (Enter, a tap) is
  // input too, but it happens BEFORE the jump it starts, so only input after
  // a skip began releases it.
  useEffect(() => {
    const mark = () => {
      lastInput.current = performance.now();
    };
    const options = { passive: true, capture: true } as const;
    window.addEventListener('wheel', mark, options);
    window.addEventListener('touchstart', mark, options);
    window.addEventListener('keydown', mark, options);
    return () => {
      window.removeEventListener('wheel', mark, options);
      window.removeEventListener('touchstart', mark, options);
      window.removeEventListener('keydown', mark, options);
    };
  }, []);

  // Pointer parallax is a viewport-level input: the canvas itself is inert to
  // the pointer so it can never intercept a click meant for the page.
  useEffect(() => {
    const handle = (event: PointerEvent) => {
      pointer.current.targetX = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.targetY = (event.clientY / window.innerHeight) * 2 - 1;
    };
    const reset = () => {
      pointer.current.targetX = 0;
      pointer.current.targetY = 0;
    };

    window.addEventListener('pointermove', handle, { passive: true });
    window.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('pointermove', handle);
      window.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // C-021 r1: read-only pose probe for capture-route sidecars. Does not
  // present, stamp, or swap cameras (PB-025).
  useEffect(() => {
    const host = window as ProbeHost;
    const world = new THREE.Vector3();
    host.__routeWorldProbe = () => {
      // W6 round 2: sample a scrollTo whose scroll event is still queued
      // (long frame) so the probe never reports the pre-seek progress.
      conductor.sync();
      const camera = cameraRef.current;
      const progress = conductor.progress.current;
      if (camera) camera.getWorldPosition(world);
      const pos = camera?.position;
      const camPos: RouteWorldProbe['camPos'] = pos
        ? [pos.x, pos.y, pos.z]
        : null;
      const worldPos: RouteWorldProbe['worldPos'] = camera
        ? [world.x, world.y, world.z]
        : null;
      const sample = camPos ?? worldPos;
      const isDefaultPlaza =
        !sample ||
        Math.hypot(
          sample[0] - DEFAULT_PLAZA_POS.x,
          sample[1] - DEFAULT_PLAZA_POS.y,
          sample[2] - DEFAULT_PLAZA_POS.z,
        ) < DEFAULT_PLAZA_EPS;
      const focusState = focusStore.get();
      const s = scratch.current;
      const k = skip.current;
      const windowSkip = skipThroughOf(progress);
      let yaw: number | null = null;
      if (camera) {
        camera.getWorldQuaternion(s.worldQuat);
        yaw = headingOf(s.worldQuat, s.heading);
      }
      return {
        direction: progress.direction,
        velocity: progress.velocity,
        yaw,
        pathYaw: headingOf(s.out.quaternion, s.heading),
        lastSampleKind: progress.lastSampleKind,
        mapVersion: progress.mapVersion,
        sampleScrollY: progress.sampleScrollY,
        turnLag: s.limited.angleTo(s.out.quaternion),
        compileHeld: compileHeldCount(),
        lastTurnDeltaRad: turnStep.current.deltaRad,
        lastDt: turnStep.current.dt,
        nearest: progress.nearest,
        skip: { active: k.active, influence: k.influence, from: k.from, to: k.to },
        skipWindows: {
          active: windowSkip.active,
          approaching: windowSkip.approaching,
          to: windowSkip.to,
          end: windowSkip.end,
          queued: queuedWindowLatches(),
        },
        settled: settleLatch.current.settled,
        smooth: progress.smooth,
        exact: progress.exact,
        index: progress.index,
        activeIndex: conductor.activeIndex,
        pin: progress.pin,
        camPos,
        worldPos,
        isDefaultPlaza,
        focus: focusState.subject
          ? {
              id: focusState.subject.id,
              phase: focusState.phase,
              blend: focus.current.blend,
              orbit: focusState.orbit,
              bounds: focusState.subject.bounds,
            }
          : null,
      };
    };
    return () => {
      if (host.__routeWorldProbe) delete host.__routeWorldProbe;
    };
  }, [conductor]);

  useFrame((_, delta) => {
    const camera = cameraRef.current;
    const last = stations.length - 1;
    if (!camera || last < 1) return;

    const progress = conductor.progress.current;
    settleLatch.current = stepSettleLatch(settleLatch.current, {
      smooth: progress.smooth,
      exact: progress.exact,
      nearest: progress.nearest,
      now: performance.now(),
    });
    const dt = Math.min(delta, WORLD_MOTION.maxDelta);
    const aspect = size.width / Math.max(1, size.height);
    const s = scratch.current;

    // ── 1. Route ───────────────────────────────────────────────────────────
    samplePath(ledger, progress.smooth, aspect, s.route);

    // ── 2. Skip-through ────────────────────────────────────────────────────
    const k = skip.current;
    const jump = progress.jump;
    if (jump.token !== k.token) {
      const first = k.token < 0;
      k.token = jump.token;
      // The first frame only adopts the token: a jump that happened before
      // the rig existed has no rendered pose to start from.
      if (!first && primed.current && jump.token > 0) {
        // Start from the station layer as it was last rendered — itself
        // possibly mid-skip — so a second chip click re-aims without a cut.
        copyPose(s.stationLayer, s.skipFrom);
        k.active = true;
        k.releasing = false;
        k.influence = 1;
        k.from = jump.from;
        k.to = jump.to;
        k.startedAt = performance.now();
      }
    }
    if (k.active) {
      if (
        !k.releasing &&
        (lastInput.current > k.startedAt || Math.abs(progress.exact - k.to) > SKIP_INPUT_EPS)
      ) {
        k.releasing = true;
      }
      const weight = skipWeight(k.from, k.to, progress.smooth);
      samplePath(ledger, k.to, aspect, s.skipTo);
      blendPoses(s.skipFrom, s.skipTo, weight, s.skipPose);
      if (!k.releasing && weight > 1 - 1e-4) k.releasing = true;
      if (k.releasing) {
        k.influence = dampToward(k.influence, 0, SKIP_RELEASE_DAMPING, dt);
        if (k.influence < SETTLE_EPS) {
          k.influence = 0;
          k.active = false;
        }
      }
      blendPoses(s.route, s.skipPose, k.influence, s.stationLayer);
    } else {
      copyPose(s.route, s.stationLayer);
    }

    // ── 3. Focus blend (ADR-0003) ──────────────────────────────────────────
    const focusState = focusStore.get();
    const f = focus.current;
    const wantFocus = focusState.phase === 'focusing' || focusState.phase === 'focused';
    const subject = focusState.subject;
    if (subject) {
      const fov = s.stationLayer.fov;
      const subjectKey = `${subject.id}|${subject.bounds.min.join(',')}|${subject.bounds.max.join(',')}`;
      const viewKey = `${aspect.toFixed(3)}|${fov.toFixed(1)}|${mobile}`;
      if (f.subjectKey !== subjectKey || f.viewKey !== viewKey || !f.framing) {
        // A new TARGET while a focus is visibly live (subject B tapped while A
        // is framed, or the subject re-registered with new bounds — a GLB
        // replacing its placeholder) cross-blends from the pose on screen
        // now. A viewport change only re-frames the same subject.
        if (f.subjectKey !== subjectKey && f.hasPose && f.blend > SETTLE_EPS && primed.current) {
          copyPose(s.rendered, s.crossFrom);
          f.cross = 0;
        }
        f.subjectKey = subjectKey;
        f.viewKey = viewKey;
        f.framing = frameSubject(
          subject,
          fov,
          aspect,
          framingOptionsFor(subject.kind, panelFrameOffset(Boolean(subject.panel), mobile)),
        );
      }
      if (f.framing) {
        const pose = orbitPose(f.framing, focusState.orbit);
        s.focusPose.position.set(pose.position[0], pose.position[1], pose.position[2]);
        s.focusTarget.set(pose.target[0], pose.target[1], pose.target[2]);
        s.look.position.copy(s.focusPose.position);
        s.look.lookAt(s.focusTarget);
        s.focusPose.quaternion.copy(s.look.quaternion);
        f.hasPose = true;
      }
    }
    // The focus pose keeps the station's lens.
    s.focusPose.fov = s.stationLayer.fov;

    // W6 round 3: the blend rate scales down with the distance the camera
    // has to travel, so a long portrait approach (15–20 m at 390) glides at
    // ≤ FOCUS_MAX_STEP_M per frame instead of whipping across in 250 ms.
    // Measured after the pose is resolved, so a fresh focus uses its own.
    const focusTravel = f.hasPose ? s.stationLayer.position.distanceTo(s.focusPose.position) : 0;
    f.blend = dampToward(f.blend, wantFocus ? 1 : 0, focusBlendRate(focusTravel), dt);

    if (f.hasPose && f.blend > SETTLE_EPS) {
      // With no subject (it unmounted mid-blend: quality downgrade, theme
      // switch) the last framing stands while the blend returns to the
      // station — no cut back.
      blendPoses(s.stationLayer, s.focusPose, focusBlendCurve(f.blend), s.blended);
    } else {
      copyPose(s.stationLayer, s.blended);
      if (!subject) {
        f.framing = null;
        f.subjectKey = '';
        f.viewKey = '';
        f.hasPose = false;
      }
    }

    if (f.cross < 1) {
      f.cross = dampToward(f.cross, 1, focusBlendRate(s.crossFrom.position.distanceTo(s.blended.position)), dt);
      if (f.cross > 1 - SETTLE_EPS) f.cross = 1;
      blendPoses(s.crossFrom, s.blended, focusBlendCurve(f.cross), s.out);
    } else {
      copyPose(s.blended, s.out);
    }

    // Review r4: the HARD per-frame cap for a live focus blend. The rate
    // heuristic above bounds each blend alone; the cross-blend on top and
    // long frames summed past it (0.76–0.87 m frames at 390). The composed
    // position moves at most FOCUS_MAX_STEP_M per 1/60 s from the last
    // rendered one; the blend state is untouched, so the remainder carries
    // into the next frames until the camera has caught up (`lagging`). A
    // deliberate conductor settle (hidden canvas) still snaps.
    if (
      primed.current &&
      settleSeen.current === progress.settleToken &&
      (f.blend > SETTLE_EPS || f.cross < 1 || f.lagging)
    ) {
      f.lagging = clampFocusStep(s.rendered.position, s.out.position, dt, s.out.position);
    } else {
      f.lagging = false;
    }

    if (
      wantFocus &&
      focusState.phase === 'focusing' &&
      f.blend > 1 - SETTLE_EPS &&
      f.cross >= 1 &&
      !f.lagging
    ) {
      focusStore.settle();
    } else if (focusState.phase === 'releasing' && f.blend < SETTLE_EPS) {
      f.blend = 0;
      focusStore.clear();
    }

    // ── Turn-rate limit (see MAX_TURN_RATE) ────────────────────────────────
    // Snaps instead of turning on the first frame and whenever the conductor
    // settled `smooth` deliberately (first measure, layout flip, deep link —
    // all with the canvas hidden). A live focus owns the camera outright:
    // the visitor's orbit drag must not lag behind their hand.
    // Review r5: every step is published on the probe (lastTurnDeltaRad /
    // lastDt) so the harness reads the limiter's own rate.
    const snapTurn = !primed.current || settleSeen.current !== progress.settleToken || f.blend > SETTLE_EPS;
    stepTurnLimiter(s.limited, s.out.quaternion, MAX_TURN_RATE, dt, snapTurn, turnStep.current);
    if (snapTurn) settleSeen.current = progress.settleToken;

    copyPose(s.out, s.rendered);
    s.rendered.quaternion.copy(s.limited);
    primed.current = true;
    camera.position.copy(s.out.position);
    camera.quaternion.copy(s.limited);

    // ── 4. Pointer parallax ────────────────────────────────────────────────
    // Fades out as the focus lands: a framed subject must hold still under
    // the cursor while the user orbits it deliberately.
    const p = pointer.current;
    const alpha = 1 - Math.exp(-WORLD_MOTION.pointerDamping * dt);
    p.x += (p.targetX - p.x) * alpha;
    p.y += (p.targetY - p.y) * alpha;

    // The seam follows the pose's own channel (`smooth`), not `exact`, so the
    // parallax quiets where the rendered crossing actually is.
    const seamLocal = progress.smooth - Math.floor(progress.smooth);
    const seam = 1 - (1 - SEAM_PARALLAX) * Math.sin(Math.PI * seamLocal);
    const swing = WORLD_MOTION.pointerMaxAngle * seam * (1 - f.blend);
    camera.rotateY(-p.x * swing);
    camera.rotateX(-p.y * swing);

    // ENGINE-A5: exact, no dead band. A 0.01° band left the lens parked up to
    // 0.01° off the station's authored fov (36.0015–36.0096 at rules, set by
    // the approach's last frame outside the band), a sub-pixel zoom that made
    // the high-contrast rules plaques bimodal across stills (0 % vs 1.4–4.4 %
    // over the A/A floor, perfectly correlated with the recorded fov). The
    // projection update is one matrix per frame while the fov moves.
    if (camera.fov !== s.out.fov) {
      camera.fov = s.out.fov;
      camera.updateProjectionMatrix();
    }
  });

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      fov={stations[0]?.camera.fov ?? 45}
      near={0.5}
      far={400}
    />
  );
}

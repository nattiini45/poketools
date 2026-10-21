'use client';

import {
  Suspense,
  createContext,
  createElement,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Object3D, Texture } from 'three';
import { pendingFigureLoads, subscribeFigureLoads } from '@/components/world/route/figures/figure-loader';
import { currentSceneGeneration, subscribeScenePhase } from '@/components/world/route/world-readiness';
import {
  getRevealArmedAt,
  isVeiledGeneration,
  noteWarmStage,
  subscribeSceneProgress,
  VEILED_QUIET_MS,
} from '@/components/world/route/scene-progress';
import { WorldStateContext } from '@/components/world/route/WorldStateProvider';
import { noteLateRegistration, noteLatchWarmError } from '@/components/world/route/perf/warm-stats';
import {
  RESIDENCY_QUIET_MS,
  residencySettled,
  stepPopulationCeiling,
  windowResidency,
  type ResidencyCounts,
} from '@/lib/route-world/residency';

/**
 * The residency-complete signal (D23, LOOK-PLAN §2 seat R item 5).
 *
 * Every world population that loads asynchronously sits under a
 * `<ResidentSuspense>` (a Suspense boundary that registers itself as a
 * PENDING population when it mounts and commits once its content has
 * committed) or holds a `useResidencyHold` while it stages its members in
 * (StatueRow's staggered aces). The figure loader reports its unsettled
 * preloads. Residency is complete when the world has registered at least one
 * population, none is pending, no preload is unsettled, and nothing changed
 * for RESIDENCY_QUIET_MS. ENGINE-GATE consumes it: the reveal waits for
 * `residencyComplete(generation)`.
 *
 * Nested boundaries register inside their parent's commit (React runs a
 * commit's child effects before its parents'), so a parent boundary's commit
 * mark and its children's pending registrations land together: the pending
 * count never drops to zero while nested work remains in the same subtree.
 * The quiet window covers sibling subtrees under other (non-resident)
 * Suspense boundaries that commit a beat later.
 *
 * After reveal nothing should register (D23: nothing mounts after the world
 * appears). A late registration is recorded in `lateRegistrations` and, in
 * dev, logged, so the quiet probe and the console both see it.
 */

interface PopulationToken {
  id: string;
  committed: boolean;
}

const tokens = new Set<PopulationToken>();
const listeners = new Set<() => void>();
let lastChangeAt = 0;
let complete = false;
let completedAt: number | null = null;
let completedGeneration: number | null = null;
let generationSeen: number | null = null;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let lateRegistrations: string[] = [];
let loaderSubscribed = false;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function counts(): ResidencyCounts {
  let pending = 0;
  for (const token of tokens) if (!token.committed) pending += 1;
  return { registered: tokens.size, pending, preloadsPending: pendingFigureLoads() };
}

function notify(): void {
  publishReadout();
  for (const listener of listeners) listener();
}

function publishReadout(): void {
  if (typeof window === 'undefined') return;
  const c = counts();
  const pendingIds: string[] = [];
  for (const token of tokens) if (!token.committed) pendingIds.push(token.id);
  (window as ResidencyHost).__residency = {
    complete,
    generation: completedGeneration,
    completedAtMs: completedAt,
    ...c,
    pendingIds,
    lateRegistrations: [...lateRegistrations],
  };
}

type ResidencyHost = Window & {
  __residency?: ResidencyCounts & {
    complete: boolean;
    generation: number | null;
    completedAtMs: number | null;
    pendingIds: string[];
    lateRegistrations: string[];
  };
};

/** Re-evaluate after a change: drop `complete`, re-arm the quiet timer. */
/**
 * ENGINE-FIX (D32): a veiled palette swap re-renders the resident world in
 * place — its boundaries resolve within a commit of each other, and nothing
 * streams in — so its settle window is the short one (the load's 300 ms
 * guards a cold world whose nested boundaries register over many commits).
 */
function quietMs(): number {
  return isVeiledGeneration() ? VEILED_QUIET_MS : RESIDENCY_QUIET_MS;
}

function changed(): void {
  lastChangeAt = now();
  if (complete) {
    complete = false;
    completedAt = null;
    completedGeneration = null;
  }
  scheduleCheck(quietMs());
  notify();
}

function scheduleCheck(delayMs: number): void {
  if (quietTimer !== null) clearTimeout(quietTimer);
  quietTimer = setTimeout(check, Math.max(0, delayMs));
}

function check(): void {
  quietTimer = null;
  const t = now();
  const c = counts();
  if (residencySettled(c, lastChangeAt, t, quietMs())) {
    if (!complete) {
      complete = true;
      completedAt = t;
      completedGeneration = currentSceneGeneration();
      notify();
    }
    return;
  }
  // Not settled yet: counts still move (their change re-arms the timer), or
  // the quiet window has not elapsed since the last change.
  if (c.registered > 0 && c.pending === 0 && c.preloadsPending === 0) {
    scheduleCheck(quietMs() - (t - lastChangeAt));
  }
}

function ensureSubscriptions(): void {
  if (loaderSubscribed) return;
  loaderSubscribed = true;
  subscribeFigureLoads(changed);
  // A new scene generation (theme toggle, route re-entry) settles afresh:
  // its ceremony must see its own completion, not the previous one's.
  subscribeScenePhase(() => {
    const generation = currentSceneGeneration();
    if (generation === generationSeen) return;
    generationSeen = generation;
    lateRegistrations = [];
    // C5 push latch: a new generation (a load, or the D32 veil's swap) shows
    // every latch actor SYNCHRONOUSLY, before its warm's first slice.
    showLatchActors();
    changed();
  });
  generationSeen = currentSceneGeneration();
}

function register(token: PopulationToken): () => void {
  ensureSubscriptions();
  if (complete && typeof document !== 'undefined' && document.documentElement.classList.contains('world-route-live')) {
    lateRegistrations.push(token.id);
    noteLateRegistration(token.id);
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[residency] population "${token.id}" registered after world-route-live (D23: nothing mounts after reveal)`);
    }
  }
  tokens.add(token);
  changed();
  return () => {
    if (tokens.delete(token)) changed();
  };
}

function commit(token: PopulationToken): void {
  if (token.committed) return;
  token.committed = true;
  if (tokens.has(token)) changed();
}

/**
 * ENGINE r4 (CAR r3 veto: a plaza-dark load revealed with both LED boards
 * blank): a committed hold whose content goes away again (a board whose
 * pages are repainted: its textures return to null until the new set is
 * uploaded) is PENDING again. Before r4 a hold committed once for good, so
 * a repaint after the first commit left residency complete over a blank
 * face and the gate opened on it.
 */
function reopen(token: PopulationToken): void {
  if (!token.committed) return;
  token.committed = false;
  if (!tokens.has(token)) return;
  if (complete && typeof document !== 'undefined' && document.documentElement.classList.contains('world-route-live')) {
    lateRegistrations.push(`${token.id}:reopened`);
    noteLateRegistration(`${token.id}:reopened`);
  }
  changed();
}

/**
 * True once every world population has committed and every queued preload
 * has settled (see the module note). `generation` names the scene generation
 * the caller is gating; a completion recorded under an older generation does
 * not count (a generation change re-arms the settle).
 */
export function residencyComplete(generation: number): boolean {
  ensureSubscriptions();
  return complete && completedGeneration === generation;
}

/** Whether residency is complete for whatever generation is current. */
export function isResidencyComplete(): boolean {
  return residencyComplete(currentSceneGeneration());
}

export interface ResidencySnapshot extends ResidencyCounts {
  complete: boolean;
  generation: number | null;
  completedAtMs: number | null;
}

export function getResidencySnapshot(): ResidencySnapshot {
  return { complete, generation: completedGeneration, completedAtMs: completedAt, ...counts() };
}

/** Fires on every residency change (registration, commit, preload settle, completion). */
export function subscribeResidency(listener: () => void): () => void {
  ensureSubscriptions();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── Reveal ready (D42 commit G; the N3 consumer is ENGINE-P's) ─────────────

/**
 * Whether the current scene generation is "reveal ready": its residency is
 * complete AND its reveal gate has armed. Both are generation-scoped reads,
 * so a stale completion or arm (a previous generation's) never counts.
 */
function revealReadyNow(): boolean {
  return residencyComplete(currentSceneGeneration()) && getRevealArmedAt() !== null;
}

/**
 * Call `cb` once residency is complete and the reveal has armed for the
 * current scene generation: immediately (in a microtask) when that already
 * holds, else at the first residency / scene-progress change that makes it
 * hold. It fires at most ONCE PER SCENE GENERATION: a later generation (a
 * theme swap, a route re-entry) that becomes ready fires it again, so a
 * consumer that tags the resident scene (N3) re-tags the new one. Returns the
 * unsubscribe (which also cancels a pending microtask call).
 *
 * The listeners are the existing residency and scene-progress channels: no
 * timer, no per-frame work.
 */
export function onRevealReady(cb: () => void): () => void {
  let active = true;
  let firedGeneration: number | null = null;
  const fireIfReady = (): void => {
    if (!active || !revealReadyNow()) return;
    const generation = currentSceneGeneration();
    if (firedGeneration === generation) return;
    firedGeneration = generation;
    cb();
  };
  const offResidency = subscribeResidency(fireIfReady);
  const offProgress = subscribeSceneProgress(fireIfReady);
  if (revealReadyNow()) queueMicrotask(fireIfReady);
  return () => {
    active = false;
    offResidency();
    offProgress();
  };
}

/** Test seam: forget every population and timer. */
export function resetResidencyForTests(): void {
  tokens.clear();
  listeners.clear();
  if (quietTimer !== null) clearTimeout(quietTimer);
  quietTimer = null;
  lastChangeAt = 0;
  complete = false;
  completedAt = null;
  completedGeneration = null;
  lateRegistrations = [];
  dataFaces.clear();
  faceLog = [];
  latchActors.clear();
}

/** Imperative registration for non-React callers and tests: returns `commit`, `reopen` and `release`. */
export function registerPopulation(id: string): { commit: () => void; reopen: () => void; release: () => void } {
  const token: PopulationToken = { id, committed: false };
  const release = register(token);
  return { commit: () => commit(token), reopen: () => reopen(token), release };
}

// ── React surface ───────────────────────────────────────────────────────────

/** Marks its token committed when the enclosing Suspense content commits. */
function CommitMark({ token }: { token: PopulationToken }) {
  useEffect(() => {
    commit(token);
  }, [token]);
  return null;
}

/**
 * A Suspense boundary that counts toward residency: pending from its own
 * mount until its content commits. Use it wherever a world population (a GLB
 * seat, a figure group, a manifest-gated layer) may suspend.
 */
export function ResidentSuspense({
  id,
  fallback = null,
  children,
}: {
  id: string;
  fallback?: ReactNode;
  children?: ReactNode;
}) {
  const [token] = useState<PopulationToken>(() => ({ id, committed: false }));
  useEffect(() => register(token), [token]);
  return createElement(Suspense, { fallback }, children, createElement(CommitMark, { token }));
}

/**
 * Hold residency open while `holding` is true (a staggered row still mounting
 * its members, a board whose pages are still painting). Registers on mount;
 * commits whenever `holding` is false and (ENGINE r4) turns pending again
 * whenever `holding` returns to true.
 */
export function useResidencyHold(id: string, holding: boolean): void {
  const [token] = useState<PopulationToken>(() => ({ id, committed: false }));
  useEffect(() => register(token), [token]);
  useEffect(() => {
    if (holding) reopen(token);
    else commit(token);
  }, [holding, token]);
}

// ── Data faces (ENGINE r4, D23 + standing goal 1) ───────────────────────────

/**
 * What a painted DATA FACE (a board, a plaque, a content wall — the surfaces
 * `data-surfaces.ts` declares) reports to the reveal gate: whether its canvas
 * has painted (the current content, the current theme), the mesh that shows
 * it, and every texture that mesh will sample (all of a board's pages, not
 * only the one bound now).
 */
export interface DataFaceReadout {
  painted: boolean;
  object: Object3D | null;
  textures: readonly Texture[];
}

export interface DataFaceEntry {
  id: string;
  read: () => DataFaceReadout;
}

const dataFaces = new Set<DataFaceEntry>();

/** Every data face mounted now (the load warm's `faces` input). */
export function dataFaceEntries(): readonly DataFaceEntry[] {
  return [...dataFaces];
}

/** Imperative registration (tests, non-React callers); returns the release. */
export function registerDataFace(entry: DataFaceEntry): () => void {
  dataFaces.add(entry);
  return () => {
    dataFaces.delete(entry);
  };
}

/** One data-face event, oldest first (trace: `__routeWorldReadiness().dataFaces`). */
export interface DataFaceEvent {
  id: string;
  event: string;
  t: number;
}

const FACE_LOG_MAX = 64;
let faceLog: DataFaceEvent[] = [];

export function noteDataFaceEvent(id: string, event: string): void {
  faceLog.push({ id, event, t: Math.round(now()) });
  if (faceLog.length > FACE_LOG_MAX) faceLog = faceLog.slice(-FACE_LOG_MAX);
  // The abnormal ones reach the loader sidecar through the warm trace.
  if (/error|reset/.test(event)) noteWarmStage(currentSceneGeneration(), `face:${id}:${event}`);
}

export function getDataFaceLog(): DataFaceEvent[] {
  return faceLog.map((entry) => ({ ...entry }));
}

/**
 * A painted data face's residency (ENGINE r4). The face counts as a
 * population that is PENDING until its canvas has painted and its content
 * mesh is mounted — and pending again whenever it repaints — so residency
 * (a live reveal-gate input) is never complete over a blank face. The warm
 * reads the registered readout (`dataFaceEntries`) to upload every texture
 * of the face and to check the mesh is visible before `uploaded` rises.
 */
export function useDataFaceResidency(id: string, readout: DataFaceReadout): void {
  const ready = readout.painted && readout.object !== null;
  useResidencyHold(`face:${id}`, !ready);
  const latest = useRef(readout);
  useLayoutEffect(() => {
    latest.current = readout;
  });
  useEffect(() => {
    noteDataFaceEvent(id, ready ? 'ready' : 'pending');
  }, [id, ready]);
  useEffect(() => registerDataFace({ id, read: () => latest.current }), [id]);
}

// ── Dormancy scope ──────────────────────────────────────────────────────────

/** A stable getter the frame loops call, so a dormancy flip never re-renders a figure. */
export type DormancyReader = () => boolean;

const AWAKE: DormancyReader = () => false;
const DormancyContext = createContext<DormancyReader>(AWAKE);

/**
 * Scope a subtree's dormancy (`useStationWindowState(...).dormant`). Figures
 * under it skip mixer updates and breathing while dormant; they stay mounted
 * and visible, so the warm pass and the shadow map still see them.
 */
export function DormancyScope({ dormant, children }: { dormant: boolean; children?: ReactNode }) {
  const [cell] = useState(() => createDormancyCell(dormant));
  useLayoutEffect(() => {
    cell.set(dormant);
  }, [cell, dormant]);
  return createElement(DormancyContext.Provider, { value: cell.read }, children);
}

/** A tiny mutable cell outside React state: `read` is stable, `set` is called from a layout effect. */
function createDormancyCell(initial: boolean): { read: DormancyReader; set: (value: boolean) => void } {
  let value = initial;
  return {
    read: () => value,
    set: (next) => {
      value = next;
    },
  };
}

/** The nearest dormancy scope's reader (awake when none). Call it inside `useFrame`. */
export function useDormancy(): DormancyReader {
  return useContext(DormancyContext);
}

// ── Window flags (ENGINE r2) ────────────────────────────────────────────────

/** A window's two residency flags (`windowResidency` minus the constant `resident`). */
export interface WindowFlags {
  inWindow: boolean;
  dormant: boolean;
}

/**
 * A station window's flags, re-rendering ONLY when one of them flips.
 *
 * The r1 window hooks held the nearest station itself in state, so every
 * window consumer (and its subtree) re-rendered at every station crossing —
 * including ones that ignore the result (plaza gate and hero props): the r2
 * quiet probe measured 75-90 ms dev tasks at each crossing of a sweep. The
 * conductor's change channel is read here directly; `onRead` (readouts) sees
 * every station change outside React state.
 */
export function useWindowFlags(
  from: number,
  to: number,
  onRead?: (station: number, flags: WindowFlags) => void,
): WindowFlags {
  const conductor = useContext(WorldStateContext)?.conductor ?? null;
  const [flags, setFlags] = useState<WindowFlags>(() => {
    const { inWindow, dormant } = windowResidency(conductor?.progress.current?.nearest ?? 0, from, to);
    return { inWindow, dormant };
  });
  const onReadRef = useRef(onRead);
  useLayoutEffect(() => {
    onReadRef.current = onRead;
  });
  useEffect(() => {
    if (conductor === null) return;
    const read = () => {
      const station = conductor.progress.current?.nearest ?? 0;
      const { inWindow, dormant } = windowResidency(station, from, to);
      onReadRef.current?.(station, { inWindow, dormant });
      setFlags((current) => (current.inWindow === inWindow && current.dormant === dormant ? current : { inWindow, dormant }));
    };
    read();
    return conductor.subscribe(read);
  }, [conductor, from, to]);
  return flags;
}

// ── Population ceiling ──────────────────────────────────────────────────────

/**
 * The governor-driven population count a consumer may mount (plan item 7,
 * `stepPopulationCeiling`): it follows `requested` while the scene loads;
 * from `routeSceneLive` it never rises and falls only while
 * `shrinkAllowedNow` is true (every instance the step removes is off-camera).
 * Pass `false` to freeze the population at reveal.
 */
export function usePopulationCeiling(requested: number, shrinkAllowedNow: boolean): number {
  // ENGINE r4 (a 100 ms dev hitch in the plaza's `opening`): the live flag is
  // READ, not subscribed to. The flip itself never changes the ceiling
  // (`stepPopulationCeiling` returns `requested` either side of it while the
  // request holds still), so subscribing re-rendered every population — the
  // plaza's aces and walkers, the theme figures — at the arm, inside the
  // ceremony, for nothing. The arm (the same commit as `routeSceneLive`) is
  // read from the progress store whenever `requested` re-renders.
  const routeSceneLive = getRevealArmedAt() !== null;
  const [ceiling, setCeiling] = useState<number | null>(null);
  const next = stepPopulationCeiling(ceiling, requested, routeSceneLive, shrinkAllowedNow);
  // Stored during render (React's "state from the previous render" pattern),
  // so the latched value and the returned one never disagree for a commit.
  if (next !== ceiling) setCeiling(next);
  return next;
}

// ── The arm, off the urgent path (ENGINE r4) ────────────────────────────────

/**
 * Whether the reveal has armed for the current generation, delivered as a
 * TRANSITION update (ENGINE r4, CAR r3: 100-190 ms compositor gaps right at
 * the arm in the theme worlds). Their window hooks read `routeSceneLive`
 * from the handoff context, so every group re-rendered in the arm's urgent
 * commit — one long dev task at the start of the ceremony. The flip changes
 * only which off-window groups are shown, and the renderer draws nothing
 * from the arm until the ball is done (the ceremony render hold), so a
 * time-sliced commit a few frames later shows exactly the same frames.
 */
export function useRevealArmedTransition(): boolean {
  const [armed, setArmed] = useState(() => getRevealArmedAt() !== null);
  const current = useRef(armed);
  useEffect(() => {
    const read = () => {
      const next = getRevealArmedAt() !== null;
      if (next === current.current) return;
      current.current = next;
      startTransition(() => setArmed(next));
    };
    read();
    return subscribeSceneProgress(read);
  }, []);
  return armed;
}

// ── Push latch (POKEMON-CORE C5, L7) ────────────────────────────────────────

/**
 * An actor that may be HIDDEN after the reveal (a lane flyer between passes,
 * a submerged surfacer). The warm's buffer pass walks `traverseVisible`, so a
 * hidden actor would pay its first-draw executables and its VBO / bone-texture
 * upload after the reveal (a D23 violation). The latch is the ONLY way an
 * actor may be hidden (L7):
 *  - a new scene generation (the load, a D32 veil swap) shows every
 *    registered root SYNCHRONOUSLY, before that generation's warm runs;
 *  - while the scene is live (the reveal armed for the current generation)
 *    the director applies each actor's `wants()` once per frame
 *    (`applyLatchVisibility`); before that every root stays shown;
 *  - the warm's first buffer slice asserts none is hidden
 *    (`assertLatchVisible`: a warm stage error and the R4 counter otherwise).
 */
export interface LatchActor {
  id: string;
  /** The actor's root (read at every application; null while unmounted). */
  root: () => Object3D | null;
  /** Whether the actor wants to be visible now (read only while live). */
  wants: () => boolean;
  /**
   * R32 (additive, optional): the actor's OWN in-frustum answer for a flip,
   * used instead of the generic root-box test (`generic`, the director's
   * one; a constant false when none was passed) — e.g. a surfacer under the
   * opaque water is not visible whatever the frustum says, so its flips
   * there are never in-frustum appearances (K8). Called only on a flip.
   */
  inFrustum?: (root: Object3D, generic: (root: Object3D) => boolean) => boolean;
}

const latchActors = new Set<LatchActor>();

function showLatchActors(): void {
  for (const actor of latchActors) {
    const root = actor.root();
    if (root && !root.visible) root.visible = true;
  }
}

/** Whether a latch actor may be hidden now: live (the reveal armed for the current generation). */
export function latchHideAllowed(): boolean {
  return getRevealArmedAt() !== null;
}

/**
 * Register a latch actor; returns its release. Registering shows the root at
 * once unless the scene is live (a pre-reveal registration is always shown).
 */
export function registerLatchActor(actor: LatchActor): () => void {
  ensureSubscriptions();
  latchActors.add(actor);
  if (!latchHideAllowed()) {
    const root = actor.root();
    if (root && !root.visible) root.visible = true;
  }
  return () => {
    latchActors.delete(actor);
  };
}

/** Registered latch actors (tests, evidence). */
export function latchActorCount(): number {
  return latchActors.size;
}

/** The generic test when the director passed none (a module constant: no per-frame allocation). */
const NOT_IN_FRUSTUM = (): boolean => false;

/**
 * The director's per-frame application: live → each root's visibility follows
 * `wants()`; otherwise every root is shown. Each flip is reported with the
 * frustum test at that frame (`noteAppearance`, R5 / K8): the actor's own
 * `inFrustum` hook when it has one (R32), else the generic root-box test.
 */
export function applyLatchVisibility(
  inFrustum?: (root: Object3D) => boolean,
  note?: (id: string, visible: boolean, inFrustum: boolean) => void,
): void {
  if (latchActors.size === 0) return;
  const hideAllowed = latchHideAllowed();
  const generic = inFrustum ?? NOT_IN_FRUSTUM;
  for (const actor of latchActors) {
    const root = actor.root();
    if (!root) continue;
    const want = hideAllowed ? actor.wants() : true;
    if (root.visible === want) continue;
    root.visible = want;
    if (note) note(actor.id, want, actor.inFrustum ? actor.inFrustum(root, generic) : generic(root));
  }
}

/**
 * The warm's assertion (A1 step 5, `useStationWarmup` `bufferSlice` start):
 * every registered latch actor is visible before the first buffer slice.
 * A hidden one is a warm stage error (`latch:hidden:<n>` in the warm trace)
 * and counts toward `latchWarmErrors` (R4); it is then shown, so the slice
 * still uploads it. Returns the number found hidden.
 */
export function assertLatchVisible(generation: number = currentSceneGeneration()): number {
  let hidden = 0;
  for (const actor of latchActors) {
    const root = actor.root();
    if (root && !root.visible) {
      hidden += 1;
      root.visible = true;
    }
  }
  if (hidden > 0) {
    noteWarmStage(generation, `latch:hidden:${hidden}`);
    noteLatchWarmError(hidden);
  }
  return hidden;
}

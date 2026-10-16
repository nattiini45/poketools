/**
 * Route-canvas work ledger (ENGINE-A4R; `?routeDebug=1` only).
 *
 * verify-a4 caught 10 long R3F frames (54–119 ms) during a sakura chip jump
 * with no program, texture or fetch behind them. The canvas draws several
 * renders a frame (the composer's world render, N8AO's transparency renders,
 * shadow maps inside them) and the station warm runs scans, compiles and
 * shadow-variant work beside them, so a long frame needs its contents named.
 * This ledger records, per frame, every `gl.render` (target, time, draw
 * calls) and the warm / compile-guard work that ran in it, and publishes
 * `window.__routeWarmStats` so a capture can pull the frames of a leg.
 *
 * Outside a debug session every entry point is one cached boolean read.
 *
 * POKEMON-CORE A1 (R3, R4, R5, R12): each frame also carries the figure
 * director's own main-thread time (`directorMs`, `noteDirectorMs`), and the
 * ledger keeps the station-settle marks (`noteStatsSettle`), the D23
 * tripwires (`noteLateRegistration`, `noteLatchWarmError`) and the actor
 * logs (`noteAppearance`, `noteWaterline`). `window()` returns them with the
 * window's `directorP50` / `directorP95` and a `settled` sub-window that
 * starts at the latest settle mark, so a quiet leg's `warmStats` carries the
 * post-settle busy cost, the director's share of it and the tripwires.
 */

export type WarmStatKind =
  /** Post-live warm: whole-scene scans, nodes they visited, fresh materials they found. */
  | 'scans'
  | 'scanNodes'
  | 'freshMaterials'
  /** Post-live warm: textures `initTexture`d by the warm pass. */
  | 'textureInits'
  /** Post-live warm: one setTimeout tick of the station warm (whole task). */
  | 'warmTicks'
  /** Compile guard: the per-frame fresh-renderable walk, renderables it held. */
  | 'guardWalks'
  | 'guardHeld'
  /** Compile guard: whole-scene `gl.compile` calls (a warm batch, or held renderables). */
  | 'sceneCompiles'
  /** Shadow-variant prepares (`compileShadowVariants`) and the casters they covered. */
  | 'shadowVariantCalls'
  | 'shadowCasters'
  /** Load warm: offscreen pose / buffer renders (they bypass the frame renders). */
  | 'poseRenders';

export interface WarmStatsRender {
  /** `world` (the root scene), else the scene's name or type. */
  scene: string;
  /** `screen`, or the render target's size. */
  target: string;
  ms: number;
  calls: number;
}

export interface WarmStatsFrame {
  /** performance.now() at the frame's first callback. */
  t: number;
  /** Interval since the previous frame's start (ms). */
  interval: number;
  /** From the frame's start to the end of its last render (ms; callbacks + renders). */
  busyMs: number;
  renders: number;
  calls: number;
  renderMs: number;
  /** The frame's renders, in order (the first 12). */
  list: WarmStatsRender[];
  /** POKEMON-CORE A1: the figure director's main-thread time in this frame (ms; absent = 0). */
  directorMs?: number;
  /** POKEMON-CORE A1: of `directorMs`, the time inside mixer updates (clip sampling; ms). */
  directorMixerMs?: number;
  /** Warm / guard work in the frame (and in the tasks right after it, before the next frame). */
  counts: Partial<Record<WarmStatKind, number>>;
  ms: Partial<Record<WarmStatKind, number>>;
}

/** Frames the ledger keeps (~80 s at 60 fps). */
export const WARM_STATS_FRAMES = 5000;

let enabled: boolean | null = null;

export function warmStatsOn(): boolean {
  if (enabled === null) {
    enabled = false;
    if (typeof window !== 'undefined') {
      try {
        enabled = new URLSearchParams(window.location.search).get('routeDebug') === '1';
      } catch {
        enabled = false;
      }
    }
  }
  return enabled;
}

const ring: WarmStatsFrame[] = [];
let current: WarmStatsFrame | null = null;
let lastRenderEnd = 0;

function blank(t: number, interval: number): WarmStatsFrame {
  return { t, interval, busyMs: 0, renders: 0, calls: 0, renderMs: 0, list: [], counts: {}, ms: {}, directorMs: 0 };
}

/* ── POKEMON-CORE A1: director time, settle marks, D23 tripwires, actor logs ── */

/** Settle marks kept (performance.now() of each station settle, oldest first). */
export const WARM_STATS_SETTLE_MARKS = 256;
/** Log entries kept per actor log. */
export const WARM_STATS_ACTOR_LOG = 512;

export interface AppearanceEntry {
  t: number;
  id: string;
  visible: boolean;
  inFrustum: boolean;
}

export interface WaterlineEntry {
  t: number;
  id: string;
  submerged: boolean;
}

const settleMarks: number[] = [];
const lateRegistrations: string[] = [];
let latchWarmErrors = 0;
const appearances: AppearanceEntry[] = [];
const waterline: WaterlineEntry[] = [];

/** The figure director's main-thread time for the running frame (ms), and its mixer-update share. */
export function noteDirectorMs(ms: number, mixerMs: number = 0): void {
  if (!warmStatsOn() || !(ms >= 0)) return;
  const frame = current ?? (current = blank(performance.now(), 0));
  frame.directorMs = Math.round(((frame.directorMs ?? 0) + ms) * 1000) / 1000;
  if (mixerMs > 0) frame.directorMixerMs = Math.round(((frame.directorMixerMs ?? 0) + mixerMs) * 1000) / 1000;
}

/** A station settle (the latched `useStationSettle` signal turned true) at `t` (performance.now()). */
export function noteStatsSettle(t: number = performance.now()): void {
  if (!warmStatsOn()) return;
  settleMarks.push(t);
  if (settleMarks.length > WARM_STATS_SETTLE_MARKS) settleMarks.splice(0, settleMarks.length - WARM_STATS_SETTLE_MARKS);
}

/** D23 tripwire: a population / figure / actor registered after the reveal (R4). */
export function noteLateRegistration(id: string): void {
  if (!warmStatsOn()) return;
  lateRegistrations.push(id);
}

/** D23 tripwire: the warm's first buffer slice found `n` latch actors hidden (R4, C5). */
export function noteLatchWarmError(n: number): void {
  if (!warmStatsOn() || !(n > 0)) return;
  latchWarmErrors += n;
}

/** An actor root's visibility flip and whether it was inside the camera frustum then (R5, K8). */
export function noteAppearance(id: string, visible: boolean, inFrustum: boolean): void {
  if (!warmStatsOn()) return;
  appearances.push({ t: performance.now(), id, visible, inFrustum });
  if (appearances.length > WARM_STATS_ACTOR_LOG) appearances.splice(0, appearances.length - WARM_STATS_ACTOR_LOG);
}

/** A wader's waterline crossing (R12, K6). */
export function noteWaterline(id: string, submerged: boolean): void {
  if (!warmStatsOn()) return;
  waterline.push({ t: performance.now(), id, submerged });
  if (waterline.length > WARM_STATS_ACTOR_LOG) waterline.splice(0, waterline.length - WARM_STATS_ACTOR_LOG);
}

/** Close the running frame and open the next (the canvas's earliest frame callback). */
export function beginStatsFrame(now: number): void {
  if (!warmStatsOn()) return;
  if (current !== null) {
    current.busyMs = Math.max(0, Math.round((lastRenderEnd - current.t) * 10) / 10);
    ring.push(current);
    if (ring.length > WARM_STATS_FRAMES) ring.splice(0, ring.length - WARM_STATS_FRAMES);
  }
  current = blank(now, current === null ? 0 : Math.round((now - current.t) * 10) / 10);
  lastRenderEnd = now;
}

/** One unit of warm / guard work (`ms` of main thread). */
export function noteWarmStat(kind: WarmStatKind, n = 1, ms = 0): void {
  if (!warmStatsOn()) return;
  const frame = current ?? (current = blank(performance.now(), 0));
  frame.counts[kind] = (frame.counts[kind] ?? 0) + n;
  if (ms > 0) frame.ms[kind] = Math.round(((frame.ms[kind] ?? 0) + ms) * 10) / 10;
}

/** One frame render (the canvas's `gl.render`), timed, with its draw calls. */
export function noteFrameRender(scene: string, target: string, ms: number, calls: number): void {
  if (!warmStatsOn()) return;
  const frame = current ?? (current = blank(performance.now(), 0));
  frame.renders += 1;
  frame.calls += calls;
  frame.renderMs = Math.round((frame.renderMs + ms) * 10) / 10;
  if (frame.list.length < 12) frame.list.push({ scene, target, ms: Math.round(ms * 10) / 10, calls });
  lastRenderEnd = performance.now();
}

export interface WarmStatsSettled {
  /** The settle mark the sub-window starts at (performance.now()). */
  from: number;
  frames: number;
  busyP50: number;
  busyP95: number;
  directorP50: number;
  directorP95: number;
  /** The director's own time (directorMs − its mixer updates). */
  directorOwnP50: number;
  directorOwnP95: number;
}

export interface WarmStatsWindow {
  frames: number;
  renders: number;
  calls: number;
  renderMs: number;
  counts: Partial<Record<WarmStatKind, number>>;
  ms: Partial<Record<WarmStatKind, number>>;
  /** Frames whose interval or busy time reached `minMs` (at most 40, in order). */
  slow: WarmStatsFrame[];
  /** Busy-time percentiles of the window's frames (ms). */
  busyP50: number;
  busyP95: number;
  busyMax: number;
  /** POKEMON-CORE A1: the figure director's per-frame time percentiles (ms). */
  directorP50: number;
  directorP95: number;
  /** The director's own time per frame (directorMs − its mixer updates). */
  directorOwnP50: number;
  directorOwnP95: number;
  /** R3: the frames from the latest settle mark inside the window (null: no settle mark at or before `to`). */
  settled: WarmStatsSettled | null;
  /** R4: every late registration since load (cumulative; empty in a healthy run). */
  lateRegistrations: string[];
  /** R4: latch actors found hidden at a warm's first buffer slice, since load (cumulative). */
  latchWarmErrors: number;
  /** R5: actor visibility flips inside the window. */
  appearances: AppearanceEntry[];
  /** R12: waterline crossings inside the window. */
  waterline: WaterlineEntry[];
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
}

/** The ledger between two performance.now() stamps (pure over `frames`). */
export function warmStatsWindow(frames: readonly WarmStatsFrame[], from: number, to: number, minMs = 50): WarmStatsWindow {
  const inWindow = frames.filter((f) => f.t >= from && f.t <= to);
  const counts: Partial<Record<WarmStatKind, number>> = {};
  const ms: Partial<Record<WarmStatKind, number>> = {};
  let renders = 0;
  let calls = 0;
  let renderMs = 0;
  for (const f of inWindow) {
    renders += f.renders;
    calls += f.calls;
    renderMs += f.renderMs;
    for (const [k, v] of Object.entries(f.counts) as [WarmStatKind, number][]) counts[k] = (counts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(f.ms) as [WarmStatKind, number][]) ms[k] = Math.round(((ms[k] ?? 0) + v) * 10) / 10;
  }
  const busy = inWindow.map((f) => f.busyMs).sort((a, b) => a - b);
  const q = (p: number) => percentile(busy, p);
  const director = inWindow.map((f) => f.directorMs ?? 0).sort((a, b) => a - b);
  const own = (f: WarmStatsFrame) => Math.max(0, (f.directorMs ?? 0) - (f.directorMixerMs ?? 0));
  const directorOwn = inWindow.map(own).sort((a, b) => a - b);
  let mark: number | null = null;
  for (const m of settleMarks) if (m <= to) mark = m;
  let settled: WarmStatsSettled | null = null;
  if (mark !== null) {
    const start = Math.max(from, mark);
    const after = inWindow.filter((f) => f.t >= start);
    const busyAfter = after.map((f) => f.busyMs).sort((a, b) => a - b);
    const directorAfter = after.map((f) => f.directorMs ?? 0).sort((a, b) => a - b);
    const ownAfter = after.map(own).sort((a, b) => a - b);
    settled = {
      from: Math.round(start * 10) / 10,
      frames: after.length,
      busyP50: percentile(busyAfter, 0.5),
      busyP95: percentile(busyAfter, 0.95),
      directorP50: percentile(directorAfter, 0.5),
      directorP95: percentile(directorAfter, 0.95),
      directorOwnP50: percentile(ownAfter, 0.5),
      directorOwnP95: percentile(ownAfter, 0.95),
    };
  }
  return {
    frames: inWindow.length,
    renders,
    calls,
    renderMs: Math.round(renderMs),
    counts,
    ms,
    slow: inWindow.filter((f) => f.interval >= minMs || f.busyMs >= minMs).slice(0, 40),
    busyP50: q(0.5),
    busyP95: q(0.95),
    busyMax: busy.length ? busy[busy.length - 1] : 0,
    directorP50: percentile(director, 0.5),
    directorP95: percentile(director, 0.95),
    directorOwnP50: percentile(directorOwn, 0.5),
    directorOwnP95: percentile(directorOwn, 0.95),
    settled,
    lateRegistrations: [...lateRegistrations],
    latchWarmErrors,
    appearances: appearances.filter((entry) => entry.t >= from && entry.t <= to),
    waterline: waterline.filter((entry) => entry.t >= from && entry.t <= to),
  };
}

declare global {
  interface Window {
    /** `?routeDebug=1` only: the route canvas's per-frame work ledger (warm-stats.ts). */
    __routeWarmStats?: { window: (from: number, to: number, minMs?: number) => WarmStatsWindow; frames: () => number };
  }
}

/** Publish the bridge (debug sessions only). */
export function installWarmStatsBridge(): () => void {
  if (!warmStatsOn()) return () => {};
  window.__routeWarmStats = {
    window: (from, to, minMs) => warmStatsWindow(ring, from, to, minMs),
    frames: () => ring.length,
  };
  return () => {
    delete window.__routeWarmStats;
  };
}

/** Tests only. */
export function resetWarmStatsForTests(on: boolean | null = null): void {
  enabled = on;
  ring.length = 0;
  current = null;
  lastRenderEnd = 0;
  settleMarks.length = 0;
  lateRegistrations.length = 0;
  latchWarmErrors = 0;
  appearances.length = 0;
  waterline.length = 0;
}

/** Tests only: the closed frames. */
export function warmStatsFramesForTests(): readonly WarmStatsFrame[] {
  return ring;
}

'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import {
  ambientPeriod,
  ambientRipplesAt,
  createRipplePool,
  createWakeLimiter,
  RIPPLE_CAPACITY,
  sampleInto,
  sampleWater,
  type RippleContact,
  type RippleKind,
  type RipplePool,
  type WakeLimiter,
  type WaterBodySpec,
  type WaterSample,
  type WaterSampleOut,
} from '@/lib/route-world/water';

/**
 * The water-event seam (spec §5.2): one runtime per water body — its spec,
 * its ripple pool and its CLOCK. The clock is the very `{ value }` object the
 * `BoundedWater` material binds as `uTime`, so the capture harness's phase
 * pin (it writes every material's `uTime`) moves the pool's notion of "now"
 * too, and published events age in the same time domain the shader reads.
 *
 * Figure controllers (floating / waterline behaviours, a later wave) call
 * `useWaterBody(id)` to publish contacts and read the surface height. A body
 * is found through the React context first and, failing that, through a
 * module registry — so a figure mounted beside the lake (not under it) still
 * finds the lake without the world's scene root having to hoist a provider.
 */

/** Mutable per-frame state `BoundedWater` writes (rung caps, debug view). */
export interface WaterRuntimeState {
  /** Active ripple slots allowed by the rung (`QualityStep.waterRipples`). */
  rippleCap: number;
  /** Ambient streams live at this rung (0 when ripples are off). */
  ambientStreams: number;
  /** Debug view index (0 = normal) — see `BoundedWater`. */
  debugMode: number;
  /**
   * Debug-only water-phase control (W3 r3, `?routeDebug=1&waterClockOffset=<s>`):
   * every external clock WRITE (the capture phase pin) lands at
   * `written + clockOffset`. 0 outside debug.
   */
  clockOffset: number;
  /** The last external clock write (the phase pin): what it wrote, where it landed. */
  lastPin: { written: number; at: number } | null;
}

export interface WaterBodyRuntime {
  spec: WaterBodySpec;
  pool: RipplePool;
  /** POKEMON-CORE C11: the body's wake gate (drift wakes only; rebuilt with the runtime). */
  wakes: WakeLimiter;
  /**
   * The water clock — shared with the material's `uTime` uniform. A write
   * is a pin (it lands at `written + state.clockOffset`); the frame tick
   * uses `advance`.
   */
  time: { value: number };
  /** Advance the clock by `dt` seconds (the per-frame tick). */
  advance(dt: number): void;
  /** Debug only: set `state.clockOffset`, shifting the clock by the change. */
  setClockOffset(offsetS: number): void;
  state: WaterRuntimeState;
}

/** What a figure controller gets. */
export interface WaterBodyHandle {
  id: string;
  /** The body's spec (POKEMON-CORE C10: the buoyancy samples it with `sampleInto`). Replaced with the runtime on a D32 theme swap: re-read the handle each frame. */
  spec: WaterBodySpec;
  /** Rest height of the surface, world Y. */
  surfaceY: number;
  /**
   * Publish a contact at the current water time. Returns the event id, or
   * null outside the water (or with no strength). The event couples the
   * surface displacement, normal and foam at that point for its lifetime.
   */
  publish(contact: RippleContact): number | null;
  /**
   * POKEMON-CORE C11: a drift wake (`float`) from `sourceId`, through the
   * body's limiter (≤ 4 per water-second per body, ≤ 1 per 1.2 s per
   * source). Returns the event id, or null when refused or off the water.
   * Allocation-free apart from the pooled event itself.
   */
  publishWake(sourceId: string, x: number, z: number, strength: number): number | null;
  /**
   * A contact of `kind` at (x, z) without building a `RippleContact` (the
   * actors' splash / step path). Wakes (`float`) route through the limiter
   * and need `publishWake`.
   */
  publishAt(kind: Exclude<RippleKind, 'float' | 'ambient'>, x: number, z: number, strength: number): number | null;
  /**
   * Surface height at world `(x, z)` now — the wave field only, so a floater
   * does not bob on its own wake. `withRipples` adds live events + ambient.
   */
  heightAt(x: number, z: number, withRipples?: boolean): number;
  /** The full sample (height, normal, crest, shore distance, depth). */
  sample(x: number, z: number, withRipples?: boolean): WaterSample;
  /** POKEMON-CORE C10: the wave field at (x, z) now, without ripples, into `out` (allocation-free). */
  sampleInto(x: number, z: number, out: WaterSampleOut): WaterSampleOut;
  /** The water clock now (s, the shader's `uTime`). */
  now(): number;
}

const WaterBodiesContext = createContext<ReadonlyMap<string, WaterBodyRuntime>>(new Map());

/* Module registry: mounted bodies by id, for consumers outside the provider. */
const registry = new Map<string, WaterBodyRuntime>();
const listeners = new Set<() => void>();
let registryVersion = 0;

function notify(): void {
  registryVersion += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return registryVersion;
}

function getServerVersion(): number {
  return 0;
}

/* Debug bridge (`?routeDebug=1` only): read-only snapshot of every body. */
export interface WaterDebugEvent {
  id: number | null;
  kind: string;
  x: number;
  z: number;
  strength: number;
  spawnTime: number;
  ageS: number;
}

export interface WaterDebugBody {
  id: string;
  uTime: number;
  rippleCap: number;
  ambientStreams: number;
  debugMode: number;
  published: number;
  params: {
    center: readonly [number, number];
    radii: readonly [number, number];
    surfaceY: number;
    depthM: number;
    shoreBandM: number;
    waves: WaterBodySpec['waves'];
    ambientPeriodS: number;
    islands: WaterBodySpec['islands'];
  };
  events: WaterDebugEvent[];
  ambient: WaterDebugEvent[];
  /** The debug water-phase offset in force (0 unless `waterClockOffset`). */
  clockOffsetS: number;
  /**
   * W3 r3: the field as of the last phase-pin write — the presented still's
   * water time (`at` = written uTime + offset) and the events alive in it
   * with their ages, so a sidecar records the ring ages the still shows (the
   * live `uTime`/`ageS` above are read later and have moved on).
   */
  pin: { writtenUTime: number; at: number; events: WaterDebugEvent[]; ambient: WaterDebugEvent[] } | null;
  /**
   * Numeric ripple readout (W3 r2) for capture sidecars: live shader slots,
   * published events/s over the last `RATE_WINDOW_S` of water time (from
   * what the ring still holds), the deterministic ambient rate, and the last
   * published event.
   */
  stats: {
    activeSlots: number;
    ambientLive: number;
    eventsPerS: number;
    ambientPerS: number;
    rateWindowS: number;
    last: { kind: string; x: number; z: number; spawnTime: number; ageS: number } | null;
    /**
     * POKEMON-CORE C11 (K6): live events evicted inside their life per kind
     * (`splash` must stay 0) and newcomers dropped by priority.
     */
    pool: { liveEvicted: Record<string, number>; dropped: number };
    /** POKEMON-CORE C11 (K6): the wake limiter's counts; `maxPerSecond` ≤ 4. */
    wakes: { accepted: number; droppedInterval: number; droppedBucket: number; maxPerSecond: number };
  };
}

/** Window for the published-events rate, water seconds. */
const RATE_WINDOW_S = 5;

interface WaterDebugHost {
  __routeWorldWater?: () => { bodies: WaterDebugBody[] };
}

function snapshot(runtime: WaterBodyRuntime): WaterDebugBody {
  const now = runtime.time.value;
  const { spec, pool, state } = runtime;
  const events = pool.selected(now, state.rippleCap).map((event) => ({ ...event, ageS: now - event.spawnTime }));
  const ambient = ambientRipplesAt(spec, now, state.ambientStreams).map((event) => ({
    ...event,
    id: null,
    ageS: now - event.spawnTime,
  }));
  const last = pool.last;
  const pinned = state.lastPin;
  const pin = pinned
    ? {
        writtenUTime: pinned.written,
        at: pinned.at,
        events: pool.selected(pinned.at, state.rippleCap).map((event) => ({ ...event, ageS: pinned.at - event.spawnTime })),
        ambient: ambientRipplesAt(spec, pinned.at, state.ambientStreams).map((event) => ({
          ...event,
          id: null,
          ageS: pinned.at - event.spawnTime,
        })),
      }
    : null;
  return {
    id: spec.id,
    uTime: now,
    rippleCap: state.rippleCap,
    ambientStreams: state.ambientStreams,
    debugMode: state.debugMode,
    published: pool.published,
    params: {
      center: spec.center,
      radii: spec.radii,
      surfaceY: spec.surfaceY,
      depthM: spec.depthM,
      shoreBandM: spec.shoreBandM,
      waves: spec.waves,
      ambientPeriodS: ambientPeriod(spec),
      islands: spec.islands ?? [],
    },
    // Exactly what the shader receives: the `rippleCap` live events the pack selects (C11 priority).
    events,
    ambient,
    clockOffsetS: state.clockOffset,
    pin,
    stats: {
      activeSlots: events.length,
      ambientLive: ambient.length,
      eventsPerS: pool.rate(now, RATE_WINDOW_S),
      ambientPerS: state.ambientStreams > 0 ? state.ambientStreams / ambientPeriod(spec) : 0,
      rateWindowS: RATE_WINDOW_S,
      last: last
        ? { kind: last.kind, x: last.x, z: last.z, spawnTime: last.spawnTime, ageS: now - last.spawnTime }
        : null,
      pool: { liveEvicted: { ...pool.evictions.liveEvicted }, dropped: pool.evictions.dropped },
      wakes: { ...runtime.wakes.stats },
    },
  };
}

function installDebugBridge(): void {
  (window as WaterDebugHost).__routeWorldWater = () => ({ bodies: [...registry.values()].map(snapshot) });
}

function sampleRuntime(runtime: WaterBodyRuntime, x: number, z: number, withRipples: boolean): WaterSample {
  const now = runtime.time.value;
  if (!withRipples) return sampleWater(runtime.spec, x, z, now);
  const events = runtime.pool.selected(now, runtime.state.rippleCap);
  return sampleWater(runtime.spec, x, z, now, events, runtime.state.ambientStreams);
}

/** A runtime whose clock treats external writes as pins (see `WaterBodyRuntime.time`). */
function createRuntime(spec: WaterBodySpec): WaterBodyRuntime {
  const state: WaterRuntimeState = {
    rippleCap: RIPPLE_CAPACITY,
    ambientStreams: spec.ambient.streams,
    debugMode: 0,
    clockOffset: 0,
    lastPin: null,
  };
  let raw = 0;
  const time = {
    get value(): number {
      return raw;
    },
    set value(written: number) {
      raw = written + state.clockOffset;
      state.lastPin = { written, at: raw };
    },
  };
  return {
    spec,
    pool: createRipplePool(spec, RIPPLE_CAPACITY),
    wakes: createWakeLimiter(),
    time,
    advance: (dt: number) => {
      raw += dt;
    },
    setClockOffset: (offsetS: number) => {
      raw += offsetS - state.clockOffset;
      state.clockOffset = offsetS;
    },
    state,
  };
}

/** `?waterClockOffset=<s>` (debug only): a finite offset, else 0. */
function readClockOffset(): number {
  const raw = new URLSearchParams(window.location.search).get('waterClockOffset');
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Owns one water body's runtime. Rebuilt (pool emptied, clock reset) only
 * when the spec object changes — adapters memoise their spec per palette.
 */
export function WaterBodyProvider({ spec, children }: { spec: WaterBodySpec; children: ReactNode }) {
  const parent = useContext(WaterBodiesContext);
  const { debug } = useWorldState();

  const runtime = useMemo<WaterBodyRuntime>(() => createRuntime(spec), [spec]);

  const value = useMemo(() => {
    const next = new Map(parent);
    next.set(spec.id, runtime);
    return next;
  }, [parent, spec.id, runtime]);

  useEffect(() => {
    registry.set(runtime.spec.id, runtime);
    notify();
    return () => {
      if (registry.get(runtime.spec.id) === runtime) {
        registry.delete(runtime.spec.id);
        notify();
      }
    };
  }, [runtime]);

  // Debug-only water-phase control: shift the clock by the offset once, and
  // every later pin lands offset too. Outside debug the offset is 0.
  useEffect(() => {
    runtime.setClockOffset(debug ? readClockOffset() : 0);
  }, [debug, runtime]);

  useEffect(() => {
    if (!debug) return;
    installDebugBridge();
    return () => {
      if (registry.size === 0) delete (window as WaterDebugHost).__routeWorldWater;
    };
  }, [debug, runtime]);

  return <WaterBodiesContext.Provider value={value}>{children}</WaterBodiesContext.Provider>;
}

/** Internal: the runtime `BoundedWater` binds (context first, then registry). */
export function useWaterBodyRuntime(id: string): WaterBodyRuntime | null {
  const fromContext = useContext(WaterBodiesContext).get(id) ?? null;
  const version = useSyncExternalStore(subscribe, getVersion, getServerVersion);
  return useMemo(() => {
    void version;
    return fromContext ?? registry.get(id) ?? null;
  }, [fromContext, id, version]);
}

/**
 * A water body's handle for figure controllers, or null while the body is
 * not mounted (Lite, another world, or before the scene's first commit).
 */
export function useWaterBody(id: string): WaterBodyHandle | null {
  const runtime = useWaterBodyRuntime(id);
  return useMemo<WaterBodyHandle | null>(() => {
    if (!runtime) return null;
    // One reused contact for the imperative publish paths (the pool copies it).
    const scratch: RippleContact = { x: 0, z: 0, strength: 0, kind: 'float' };
    const publishKind = (kind: RippleKind, x: number, z: number, strength: number) => {
      scratch.x = x;
      scratch.z = z;
      scratch.strength = strength;
      scratch.kind = kind;
      return runtime.pool.publish(scratch, runtime.time.value);
    };
    /**
     * A wake through the limiter: checked first, and the token / interval /
     * `accepted` spent only when the pool took it (a contact off the ellipse
     * or dropped by priority costs nothing, so K6's stats read what the
     * shader saw).
     */
    const gatedWake = (sourceId: string, x: number, z: number, strength: number) => {
      const now = runtime.time.value;
      if (!runtime.wakes.check(sourceId, now, runtime.state.rippleCap)) return null;
      const id = publishKind('float', x, z, strength);
      if (id !== null) runtime.wakes.commit(sourceId, now);
      return id;
    };
    return {
      id: runtime.spec.id,
      spec: runtime.spec,
      surfaceY: runtime.spec.surfaceY,
      // A `float` contact published directly still passes the limiter (source '').
      publish: (contact) => {
        if (contact.kind !== 'float') return runtime.pool.publish(contact, runtime.time.value);
        return gatedWake('', contact.x, contact.z, contact.strength);
      },
      publishWake: (sourceId, x, z, strength) => gatedWake(sourceId, x, z, strength),
      publishAt: (kind, x, z, strength) => publishKind(kind, x, z, strength),
      sampleInto: (x, z, out) => sampleInto(runtime.spec, x, z, runtime.time.value, out),
      now: () => runtime.time.value,
      heightAt: (x, z, withRipples = false) => sampleRuntime(runtime, x, z, withRipples).height,
      sample: (x, z, withRipples = false) => sampleRuntime(runtime, x, z, withRipples),
    };
  }, [runtime]);
}

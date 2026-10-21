/**
 * Shared bounded water — the pure half (spec 2026-09-24 §5.2, fidelity W3).
 *
 * One elliptical water body is described by a `WaterBodySpec` in WORLD
 * metres. Everything the surface does is derived from that one object:
 *
 * - `sampleWater` evaluates the wave field, the ripple events, the shore
 *   distance and the depth on the CPU (floater buoyancy, contact heights,
 *   the debug bridge);
 * - `emitGlsl` writes the SAME constants and the SAME formulas as a GLSL
 *   chunk for the `BoundedWater` shader, so the CPU and the GPU can never
 *   disagree about where the surface is (a floater that hovers or sinks is
 *   the failure this prevents). The water tests pin the parity of the
 *   emitted constants.
 *
 * The wave field is a HEIGHT field (no horizontal Gerstner displacement), so
 * `heightAt(x, z)` is exact with no inversion. Each band is a sharpened sine:
 * `h = A · (2·s^e − 1)` with `s = (sin θ + 1) / 2` and `e = 1 + 2·steepness`,
 * which keeps rounded troughs and narrower crests — a stylised pond read, not
 * an ocean spectrum. Band `speed` is an authored phase speed (m/s), NOT the
 * deep-water dispersion relation: a park lake at physical dispersion either
 * crawls or races, and the art direction wants gentle, readable motion.
 *
 * Ripple events are a fixed-capacity ring buffer. Every event stores its
 * `spawnTime` in the water's `uTime` domain (never an age advanced by delta),
 * so age = uTime − spawnTime is computed identically here and in GLSL, and
 * the capture harness's phase pin (it writes every material's `uTime`)
 * freezes ripples coherently with the waves. The ambient "fish-rise / drip"
 * events are a pure function of time (a seeded table cycled by period), so
 * they are deterministic under the pin with no pool state at all.
 *
 * Deliberately NOT modelled (disclosed, see BoundedWater.tsx): the capillary
 * normal layer is GPU-only fragment detail (sub-centimetre, not part of
 * `sampleWater`), there is no reflection render (no SSR, no planar mirror)
 * and no reconstructed underwater thickness — depth is an analytic bowl
 * derived from the shore distance.
 *
 * Pure data + math: no three.js or React imports, node-testable.
 */

import { seededRandom } from './ambient';

/** `[x, z]` in world metres. */
export type WaterVec2 = readonly [number, number];

/** One sharpened-sine wave train. */
export interface WaveBand {
  /** Travel direction, radians in the XZ plane (0 = +X, π/2 = +Z). */
  dirRad: number;
  /** Crest-to-crest distance, metres. */
  wavelengthM: number;
  /** Half the crest-to-trough height, metres. */
  amplitudeM: number;
  /** Authored phase speed, m/s (stylised — not the dispersion relation). */
  speed: number;
  /** 0 = pure sine, 1 = narrow crests / broad troughs. */
  steepness: number;
}

/** Hex colours (sRGB authored, like every palette role). */
export interface WaterColors {
  /** Body colour at full optical depth. */
  deep: string;
  /** The lit shelf seen through clear shallow water. */
  shallow: string;
  /** The hue that survives absorption along the mid-length optical path. */
  absorb: string;
  /** Crest / ripple / lip foam — authored ≤ ~0.9 linear, under the bloom threshold. */
  foam: string;
  /** Wet rim tint the outermost shore band blends toward (sand, gravel). */
  shore: string;
  /** Reflected sky straight up. */
  skyZenith: string;
  /** Reflected sky at the horizon (grazing view). */
  skyHorizon: string;
}

/** The seeded ambient-event stream (fish rise, dripping branch). */
export interface WaterAmbientSpec {
  /** Mean seconds between events per stream (floored to fit the lifetime). */
  periodS: number;
  /** Concurrent streams (≤ `WATER_AMBIENT_MAX_STREAMS`). */
  streams: number;
  /** Event strength multiplier, 0..1. */
  strength: number;
  /** Seed for the positions / delays table. */
  seed: number;
  /**
   * Optional world `[x, z]` the capture pin favours (W3 r3): the table entry
   * nearest it is the one live at water time 0, aged `AMBIENT_PIN_AGE_S`, so
   * a phase-pinned still shows a young, readable ring in the framed water.
   * Only the stream's phase moves — cadence, positions and strengths are the
   * same table. Default: table entry 0.
   */
  pinNear?: WaterVec2;
}

export interface WaterBodySpec {
  /** Stable body id, e.g. `sakura-lake`, `mountain-tarn`. */
  id: string;
  /** Ellipse centre `[x, z]`, world metres. */
  center: WaterVec2;
  /** Ellipse semi-axes `[rx, rz]`, metres. */
  radii: WaterVec2;
  /** Rest height of the surface, world Y. */
  surfaceY: number;
  /**
   * Highest ground mesh under the water (lawn, shore sand), world Y. Troughs
   * compress smoothly above it — the surface never dips through the floor.
   */
  floorY: number;
  /** Depth at the centre of the bowl, metres (drives absorption colour). */
  depthM: number;
  /** Inner shore band width, metres: wave fade, wet rim and foam lip live here. */
  shoreBandM: number;
  /** Exactly three wave trains (the shader's constant layout). */
  waves: readonly [WaveBand, WaveBand, WaveBand];
  /** GPU-only capillary normal layer: noise cell size (m) and slope strength. */
  capillary: { scaleM: number; strength: number };
  colors: WaterColors;
  ambient: WaterAmbientSpec;
  /**
   * Dry discs inside the body (a shrine islet), at most
   * `WATER_MAX_ISLANDS`. Their edge is a shore like the rim: the wave fade,
   * the wet band and the foam lip wrap them, and contacts on them are
   * rejected. `r` is the radius of the island's outermost dressing (collar).
   */
  islands?: readonly WaterIsland[];
}

export interface WaterIsland {
  x: number;
  z: number;
  r: number;
}

/** Shader constant layout: the island loop is unrolled to this many. */
export const WATER_MAX_ISLANDS = 2;

/**
 * The footprint of a body — what the shore tests (`insideWater`,
 * `shoreDistance`) read. POKEMON-CORE SEAT D: pure authoring data (a probe's
 * drift discs, a surfacer spot) is checked against it without the palette.
 */
export type WaterShape = Pick<WaterBodySpec, 'center' | 'radii' | 'islands'>;

function islandsOf(spec: WaterShape): readonly WaterIsland[] {
  return (spec.islands ?? []).slice(0, WATER_MAX_ISLANDS);
}

/* ------------------------------------------------------------------ */
/* Ripple events                                                        */
/* ------------------------------------------------------------------ */

/** Pool capacity — the size of the shader's `uRipples` vec4 array. */
export const RIPPLE_CAPACITY = 16;

/** Event kinds. The index is packed into the vec4 (see `packRippleW`). */
export const RIPPLE_KINDS = ['step', 'float', 'splash', 'petal', 'ambient'] as const;
export type RippleKind = (typeof RIPPLE_KINDS)[number];

export interface RippleKindParams {
  /** Seconds until the event is fully gone. */
  lifetimeS: number;
  /** Ring wavelength, metres. */
  wavelengthM: number;
  /** Ring front speed, m/s. */
  speedMps: number;
  /** Peak displacement at strength 1, metres. */
  amplitudeM: number;
  /** Foam gain of the ring front at strength 1 (0..1). */
  foamGain: number;
  /** Envelope decay: `env ∝ e^(−decayRate · age/life) · (1 − age/life)`. */
  decayRate: number;
}

/**
 * Per-kind ring shape. A `splash` (breach, dive) is big and slow to fade; a
 * `float` wake is a soft, short ring; a `petal` landing is a faint ring the
 * size of a coin. Kept in one table so GLSL and TS read identical numbers.
 */
export const RIPPLE_KIND_PARAMS: Readonly<Record<RippleKind, RippleKindParams>> = {
  step: { lifetimeS: 2.2, wavelengthM: 0.34, speedMps: 0.9, amplitudeM: 0.018, foamGain: 0.3, decayRate: 2.5 },
  float: { lifetimeS: 1.6, wavelengthM: 0.28, speedMps: 0.7, amplitudeM: 0.011, foamGain: 0.16, decayRate: 2.5 },
  splash: { lifetimeS: 3.2, wavelengthM: 0.55, speedMps: 1.35, amplitudeM: 0.05, foamGain: 0.5, decayRate: 2.5 },
  petal: { lifetimeS: 1.2, wavelengthM: 0.12, speedMps: 0.45, amplitudeM: 0.004, foamGain: 0.06, decayRate: 2.5 },
  // W3 r3: the ambient ring was ≈ 0.3 mm by mid-life and never read in the
  // lit surface. Doubled amplitude and a softer decay keep its slope ≥ 0.04
  // (a visible bend of the sky reflection) through the first ~1.5 s.
  ambient: { lifetimeS: 2.6, wavelengthM: 0.3, speedMps: 0.8, amplitudeM: 0.028, foamGain: 0.14, decayRate: 1.5 },
};

/**
 * POKEMON-CORE C11: pool priority per kind — splash 3 > step 2 > petal =
 * float 1. `ambient` is analytic (never pooled); its entry only keeps the
 * table exhaustive. A full pool evicts the oldest live event of the LOWEST
 * priority that is ≤ the newcomer's, else drops the newcomer, so a splash is
 * never pushed out inside its ring life by wakes; `pack` selects the top
 * `cap` live events by (priority, publish order).
 */
export const RIPPLE_KIND_PRIORITY: Readonly<Record<RippleKind, number>> = {
  splash: 3,
  step: 2,
  petal: 1,
  float: 1,
  ambient: 0,
};

/** A contact a figure (or the ambient stream) publishes. */
export interface RippleContact {
  x: number;
  z: number;
  /** Normalised strength; clamped to (0, 1]. */
  strength: number;
  kind: RippleKind;
}

/** A contact at a moment in the water clock — what the ring waveform needs. */
export interface RippleSource extends RippleContact {
  /** Spawn instant in the water `uTime` domain, seconds. */
  spawnTime: number;
}

/** A pooled event with its stable monotonic id. */
export interface RippleEvent extends RippleSource {
  id: number;
}

/** Pack strength + kind into one float: `strength + kindIndex · 2`. */
export function packRippleW(strength: number, kind: RippleKind): number {
  return strength + RIPPLE_KINDS.indexOf(kind) * 2;
}

/** Inverse of `packRippleW`. */
export function unpackRippleW(w: number): { strength: number; kind: RippleKind } {
  const index = Math.max(0, Math.min(RIPPLE_KINDS.length - 1, Math.floor(w * 0.5)));
  return { strength: w - index * 2, kind: RIPPLE_KINDS[index] };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                     */
/* ------------------------------------------------------------------ */

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Is `(x, z)` on open water: inside the ellipse (rim inclusive), off every island? */
export function insideWater(spec: WaterShape, x: number, z: number): boolean {
  const u = (x - spec.center[0]) / spec.radii[0];
  const v = (z - spec.center[1]) / spec.radii[1];
  if (u * u + v * v > 1) return false;
  return islandsOf(spec).every((island) => Math.hypot(x - island.x, z - island.z) >= island.r);
}

/**
 * Distance from the nearest shore, metres: positive on open water, negative
 * outside the rim or on an island. The rim term is Inigo Quilez's
 * first-order ellipse SDF `f·(f−1)/|∇f|`, exact on the rim and on the axes,
 * within a few percent elsewhere — good enough for a shore band, and it
 * measures in METRES, so the band is equally wide on the long and the short
 * axis (the old unit-circle proxy stretched it 2×). Islands are exact circles.
 */
export function shoreDistance(spec: WaterShape, x: number, z: number): number {
  const [rx, rz] = spec.radii;
  const px = x - spec.center[0];
  const pz = z - spec.center[1];
  const f = Math.hypot(px / rx, pz / rz);
  const g = Math.hypot(px / (rx * rx), pz / (rz * rz));
  let d = g < 1e-6 ? Math.min(rx, rz) : -(f * (f - 1)) / g;
  // Index loop (no `slice`): `sampleInto` calls this every frame per sample.
  const islands = spec.islands;
  if (islands) {
    const n = Math.min(islands.length, WATER_MAX_ISLANDS);
    for (let i = 0; i < n; i += 1) {
      const island = islands[i];
      d = Math.min(d, Math.hypot(x - island.x, z - island.z) - island.r);
    }
  }
  return d;
}

/** Width of the shelf from the rim to full depth, metres. */
export function shelfWidth(spec: WaterBodySpec): number {
  return Math.min(spec.radii[0], spec.radii[1]) * 0.6;
}

/** Analytic bowl depth at a shore distance, metres. */
export function depthAtShoreDistance(spec: WaterBodySpec, shoreDistM: number): number {
  return spec.depthM * smoothstep(0, shelfWidth(spec), shoreDistM);
}

/* ------------------------------------------------------------------ */
/* Wave + ripple field                                                  */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
/** Floor on the sharpened-sine base so `pow(s, e − 1)` never sees 0⁰ on the GPU. */
const SHARPEN_FLOOR = 1e-4;
/** Ring window cut-off; GLSL skips the event below the same value. */
const RING_WINDOW_EPS = 1e-3;

interface FieldAccumulator {
  h: number;
  gx: number;
  gz: number;
  crest: number;
  foam: number;
}

function addBand(acc: FieldAccumulator, band: WaveBand, x: number, z: number, t: number): void {
  const k = TAU / band.wavelengthM;
  const dx = Math.cos(band.dirRad);
  const dz = Math.sin(band.dirRad);
  const e = 1 + 2 * band.steepness;
  const theta = k * (dx * x + dz * z) - k * band.speed * t;
  const sn = Math.sin(theta);
  const s = Math.max(0.5 * (sn + 1), SHARPEN_FLOOR);
  const se1 = Math.pow(s, e - 1);
  acc.h += band.amplitudeM * (2 * se1 * s - 1);
  const slope = band.amplitudeM * e * se1 * Math.cos(theta) * k;
  acc.gx += slope * dx;
  acc.gz += slope * dz;
  acc.crest += band.steepness * Math.pow(s, 6);
}

/**
 * The damped-ring waveform: a wave packet riding the front `r = c·age`,
 * `h = env · w(x) · sin(k·x)` with `x = r − c·age`, a Gaussian window `w`
 * (σ = 0.9 λ), and `env = strength · A · e^(−D·age/life) · (1 − age/life)` (D = the kind's `decayRate`)
 * so it reaches exactly zero at the end of its life. The radial derivative is
 * analytic, so the ring bends the normal where it displaces the surface —
 * the same event drives displacement, normal and foam (never a detached
 * particle).
 */
function addRipple(acc: FieldAccumulator, source: RippleSource, x: number, z: number, t: number): void {
  const params = RIPPLE_KIND_PARAMS[source.kind];
  const age = t - source.spawnTime;
  if (age < 0 || age >= params.lifetimeS || source.strength <= 0) return;
  const ddx = x - source.x;
  const ddz = z - source.z;
  const r = Math.hypot(ddx, ddz);
  const front = r - params.speedMps * age;
  const sigma = 0.9 * params.wavelengthM;
  const w = Math.exp(-(front * front) / (sigma * sigma));
  if (w < RING_WINDOW_EPS) return;
  const life01 = age / params.lifetimeS;
  const env = source.strength * params.amplitudeM * Math.exp(-params.decayRate * life01) * (1 - life01);
  const k = TAU / params.wavelengthM;
  const sn = Math.sin(k * front);
  const cs = Math.cos(k * front);
  acc.h += env * w * sn;
  const dr = env * w * (k * cs - ((2 * front) / (sigma * sigma)) * sn);
  if (r > 1e-4) {
    acc.gx += (dr * ddx) / r;
    acc.gz += (dr * ddz) / r;
  }
  const foamSigma = 0.35 * params.wavelengthM;
  acc.foam +=
    params.foamGain * source.strength * (1 - life01) * Math.exp(-(front * front) / (foamSigma * foamSigma));
}

/* ------------------------------------------------------------------ */
/* Ambient events (fish rise / dripping branch)                         */
/* ------------------------------------------------------------------ */

/** Hard ceiling on concurrent ambient streams (the GLSL loop bound). */
export const WATER_AMBIENT_MAX_STREAMS = 3;
/** Entries in the seeded ambient table the streams cycle through. */
export const WATER_AMBIENT_TABLE_SIZE = 8;
/** The spawn delay inside a period is at most this fraction of it. */
const AMBIENT_MAX_DELAY_FRAC = 0.45;

export interface AmbientEntry {
  x: number;
  z: number;
  /** Spawn delay inside the period, as a fraction of it. */
  delayFrac: number;
  /** 0..1 (already multiplied by the spec's ambient strength). */
  strength: number;
}

/**
 * The effective ambient period: never shorter than the event lifetime over
 * the free part of a period, so one stream never has two live events and the
 * shader only evaluates the current cycle.
 */
export function ambientPeriod(spec: WaterBodySpec): number {
  const life = RIPPLE_KIND_PARAMS.ambient.lifetimeS;
  return Math.max(spec.ambient.periodS, life / (1 - AMBIENT_MAX_DELAY_FRAC) + 0.05);
}

/**
 * The seeded ambient table: positions inside the body, clear of the shore
 * band (a fish rises in open water, not in the foam lip), with varied delays
 * and strengths so the cadence never reads as a metronome.
 */
export function ambientTable(spec: WaterBodySpec): readonly AmbientEntry[] {
  const rand = seededRandom(spec.ambient.seed);
  const entries: AmbientEntry[] = [];
  const margin = spec.shoreBandM + 0.4;
  let guard = 0;
  while (entries.length < WATER_AMBIENT_TABLE_SIZE && guard < 400) {
    guard += 1;
    const angle = rand() * TAU;
    const radius = Math.sqrt(rand()) * 0.85;
    const x = spec.center[0] + Math.cos(angle) * radius * spec.radii[0];
    const z = spec.center[1] + Math.sin(angle) * radius * spec.radii[1];
    const delayFrac = rand() * AMBIENT_MAX_DELAY_FRAC;
    const strength = (0.55 + rand() * 0.45) * spec.ambient.strength;
    if (shoreDistance(spec, x, z) < margin) continue;
    entries.push({ x, z, delayFrac, strength });
  }
  // A body too small for the margin still gets a table (at the centre).
  while (entries.length < WATER_AMBIENT_TABLE_SIZE) {
    entries.push({ x: spec.center[0], z: spec.center[1], delayFrac: 0.2, strength: 0.6 * spec.ambient.strength });
  }
  return entries;
}

/**
 * Age (s) of the pinned ambient ring at water time 0 — the capture phase
 * pin's canonical `uTime` (W3 r3). Inside the 0.3–0.9 s window where a
 * ring is both clearly formed and near full strength in the lit surface.
 */
export const AMBIENT_PIN_AGE_S = 0.6;

/**
 * The ambient stream's phase: `origin` (water seconds) and the table index
 * `shift` stream 0 starts at, chosen so that at `t = 0` stream 0's live
 * event is the pin entry (nearest `ambient.pinNear`, default entry 0) at age
 * `AMBIENT_PIN_AGE_S`. A pure function of the spec.
 */
export function ambientPhase(
  spec: WaterBodySpec,
  table: readonly AmbientEntry[] = ambientTable(spec),
): { origin: number; shift: number } {
  let shift = 0;
  const near = spec.ambient.pinNear;
  if (near) {
    let best = Infinity;
    table.forEach((entry, i) => {
      const d = Math.hypot(entry.x - near[0], entry.z - near[1]);
      if (d < best) {
        best = d;
        shift = i;
      }
    });
  }
  const origin = -AMBIENT_PIN_AGE_S - table[shift].delayFrac * ambientPeriod(spec);
  return { origin, shift };
}

/** Non-negative modulo (GLSL `mod` semantics). */
function modPositive(a: number, n: number): number {
  return a - n * Math.floor(a / n);
}

/**
 * The ambient events alive at water time `t` for `streams` streams (≤ the
 * spec's stream count). A pure function of `t`: the capture pin reproduces
 * it exactly, and the shader evaluates the same cycle arithmetic.
 */
export function ambientRipplesAt(
  spec: WaterBodySpec,
  t: number,
  streams: number = spec.ambient.streams,
  table: readonly AmbientEntry[] = ambientTable(spec),
): RippleSource[] {
  const period = ambientPeriod(spec);
  const total = Math.max(1, Math.min(WATER_AMBIENT_MAX_STREAMS, spec.ambient.streams));
  const active = Math.max(0, Math.min(total, streams));
  const life = RIPPLE_KIND_PARAMS.ambient.lifetimeS;
  const { origin, shift } = ambientPhase(spec, table);
  const out: RippleSource[] = [];
  for (let s = 0; s < active; s += 1) {
    const offset = origin + (s * period) / total;
    const cycle = Math.floor((t - offset) / period);
    const entry = table[modPositive(cycle * total + s + shift, WATER_AMBIENT_TABLE_SIZE)];
    const spawnTime = offset + cycle * period + entry.delayFrac * period;
    const age = t - spawnTime;
    if (age < 0 || age >= life || entry.strength <= 0) continue;
    out.push({ x: entry.x, z: entry.z, strength: Math.min(1, entry.strength), kind: 'ambient', spawnTime });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sampling                                                             */
/* ------------------------------------------------------------------ */

export interface WaterSample {
  /** Surface height, world Y. */
  height: number;
  /** Unit surface normal `[x, y, z]` (no capillary layer — GPU-only). */
  normal: readonly [number, number, number];
  /** Crest intensity 0..1 (the foam driver of the wave field). */
  crest: number;
  /** Distance inward from the rim, metres (negative outside the body). */
  shoreDistM: number;
  /** Analytic bowl depth at this point, metres. */
  depthM: number;
  /** Foam contributed by ripple ring fronts, 0..1. */
  rippleFoam: number;
}

/** Headroom kept between the deepest trough and `floorY`, metres. */
const FLOOR_MARGIN_M = 0.005;

/** The deepest a trough may reach below `surfaceY`, metres. */
export function maxTroughDepth(spec: WaterBodySpec): number {
  return Math.max(0.002, spec.surfaceY - spec.floorY - FLOOR_MARGIN_M);
}

/**
 * Smooth trough compression: crests pass through unchanged, a trough `h < 0`
 * maps to `−T·(1 − e^(h/T))`, which never reaches `−T` and is C¹ at 0, so the
 * water can never dip through the ground mesh it lies over (the lawn / sand
 * a few centimetres below). `slope` is the derivative factor for the normal.
 */
function troughCompression(spec: WaterBodySpec, h: number): { h: number; slope: number } {
  if (h >= 0) return { h, slope: 1 };
  const T = maxTroughDepth(spec);
  const e = Math.exp(h / T);
  return { h: -T * (1 - e), slope: e };
}

/**
 * Evaluate the surface at world `(x, z)` and water time `t`. `ripples` are
 * the pooled events to include (a floater usually passes none, so it does
 * not bob on its own wake); `ambientStreams` adds the ambient stream.
 *
 * Displacement and slope fade to zero across the shore band so the rim sits
 * exactly at `surfaceY` (no gap against the shore dressing). The slope is
 * scaled by the fade without the fade's own derivative — the GPU does the
 * same, so both agree.
 */
export function sampleWater(
  spec: WaterBodySpec,
  x: number,
  z: number,
  t: number,
  ripples: readonly RippleSource[] = [],
  ambientStreams = 0,
): WaterSample {
  const shoreDistM = shoreDistance(spec, x, z);
  const depthM = depthAtShoreDistance(spec, shoreDistM);
  if (shoreDistM < 0) {
    return { height: spec.surfaceY, normal: [0, 1, 0], crest: 0, shoreDistM, depthM: 0, rippleFoam: 0 };
  }
  const acc: FieldAccumulator = { h: 0, gx: 0, gz: 0, crest: 0, foam: 0 };
  for (const band of spec.waves) addBand(acc, band, x, z, t);
  for (const ripple of ripples) addRipple(acc, ripple, x, z, t);
  if (ambientStreams > 0) {
    for (const ripple of ambientRipplesAt(spec, t, ambientStreams)) addRipple(acc, ripple, x, z, t);
  }
  const fade = smoothstep(0, spec.shoreBandM, shoreDistM);
  const trough = troughCompression(spec, acc.h * fade);
  const gx = acc.gx * fade * trough.slope;
  const gz = acc.gz * fade * trough.slope;
  const len = Math.hypot(gx, 1, gz);
  return {
    height: spec.surfaceY + trough.h,
    normal: [-gx / len, 1 / len, -gz / len],
    crest: Math.min(1, Math.max(0, acc.crest)) * fade,
    shoreDistM,
    depthM,
    rippleFoam: Math.min(1, acc.foam) * fade,
  };
}

/**
 * The mutable result of `sampleInto` (POKEMON-CORE C10): the wave-field
 * sample with the normal as three scalars, so a per-frame caller allocates
 * nothing. Create one with `createWaterSampleOut` and reuse it.
 */
export interface WaterSampleOut {
  height: number;
  nx: number;
  ny: number;
  nz: number;
  crest: number;
  shoreDistM: number;
  depthM: number;
}

export function createWaterSampleOut(): WaterSampleOut {
  return { height: 0, nx: 0, ny: 1, nz: 0, crest: 0, shoreDistM: 0, depthM: 0 };
}

/** One accumulator for `sampleInto` (module scratch: the call is synchronous). */
const sampleAcc: FieldAccumulator = { h: 0, gx: 0, gz: 0, crest: 0, foam: 0 };

/**
 * `sampleWater(spec, x, z, t)` — the wave field WITHOUT ripples or ambient
 * events (a resident does not bob on its own wake; disclosed) — written into
 * `out`. Allocation-free; equals `sampleWater` field for field (tested).
 */
export function sampleInto(spec: WaterBodySpec, x: number, z: number, t: number, out: WaterSampleOut): WaterSampleOut {
  const shoreDistM = shoreDistance(spec, x, z);
  out.shoreDistM = shoreDistM;
  if (shoreDistM < 0) {
    out.height = spec.surfaceY;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.crest = 0;
    out.depthM = 0;
    return out;
  }
  out.depthM = depthAtShoreDistance(spec, shoreDistM);
  const acc = sampleAcc;
  acc.h = 0;
  acc.gx = 0;
  acc.gz = 0;
  acc.crest = 0;
  acc.foam = 0;
  for (let i = 0; i < spec.waves.length; i += 1) addBand(acc, spec.waves[i], x, z, t);
  const fade = smoothstep(0, spec.shoreBandM, shoreDistM);
  // troughCompression, inlined (it returns an object).
  let h = acc.h * fade;
  let slope = 1;
  if (h < 0) {
    const T = maxTroughDepth(spec);
    const e = Math.exp(h / T);
    h = -T * (1 - e);
    slope = e;
  }
  const gx = acc.gx * fade * slope;
  const gz = acc.gz * fade * slope;
  const len = Math.hypot(gx, 1, gz);
  out.height = spec.surfaceY + h;
  out.nx = -gx / len;
  out.ny = 1 / len;
  out.nz = -gz / len;
  out.crest = Math.min(1, Math.max(0, acc.crest)) * fade;
  return out;
}

/**
 * Blend two `#rrggbb` colours in sRGB space (authoring helper for adapters
 * deriving a tint, e.g. blossom-tinted shallows, from palette roles).
 */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) throw new Error(`water: not a #rrggbb colour: ${hex}`);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const k = Math.min(1, Math.max(0, t));
  const ca = parse(a);
  const cb = parse(b);
  return `#${ca
    .map((c, i) => Math.round(c + (cb[i] - c) * k).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Scale a `#rrggbb` colour's sRGB value by `k` (0..1 darkens, clamped). */
export function scaleHex(hex: string, k: number): string {
  return mixHex('#000000', hex, Math.min(1, Math.max(0, k)));
}

/**
 * Relative luminance of a `#rrggbb` colour in LINEAR light (sRGB decoded,
 * Rec. 709 weights) — the space the water shader mixes in, so the
 * body/sky contrast the tests pin is the one the fragment actually sees.
 */
export function linearLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`water: not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * Minimum linear-luminance gap between the reflected horizon and the
 * mid-path ABSORB body colour (fidelity W3 r2: with post off the lake read
 * as one flat tint because body and sky shared a value range).
 */
export const WATER_MIN_HORIZON_DELTA = 0.12;
/** The smaller gap kept against the SHALLOW rim colour (rim is a thin band). */
export const WATER_MIN_SHALLOW_DELTA = 0.06;

/**
 * Lift the reflected-horizon colour toward `lift` (a bright sky tint by day,
 * the moon's colour by night) by the smallest sRGB mix that opens the
 * `WATER_MIN_*_DELTA` gaps above the body. The horizon is always pushed
 * LIGHTER than the body — the physical grazing read (sky over water) — never
 * the body darker, so the body keeps the palette's art-directed hue. If even
 * `lift` itself cannot open the gap the full lift is returned (the tests
 * pin that every world palette clears it well before that).
 */
export function withHorizonContrast(colors: WaterColors, lift: string): WaterColors {
  const need = Math.max(
    linearLuminance(colors.absorb) + WATER_MIN_HORIZON_DELTA,
    linearLuminance(colors.shallow) + WATER_MIN_SHALLOW_DELTA,
  );
  if (linearLuminance(colors.skyHorizon) >= need) return colors;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (linearLuminance(mixHex(colors.skyHorizon, lift, mid)) >= need) hi = mid;
    else lo = mid;
  }
  return { ...colors, skyHorizon: mixHex(colors.skyHorizon, lift, hi) };
}

/** Sum of the band amplitudes — the scale the debug height view normalises by. */
export function waveAmplitudeSum(spec: WaterBodySpec): number {
  return spec.waves.reduce((sum, band) => sum + band.amplitudeM, 0);
}

/* ------------------------------------------------------------------ */
/* Ripple pool                                                          */
/* ------------------------------------------------------------------ */

export interface RipplePool {
  readonly capacity: number;
  /**
   * Publish a contact at water time `now`. Returns the event's monotonic id,
   * or null when the contact is outside the ellipse, has no strength, or
   * (POKEMON-CORE C11) the pool is full of live events that all outrank it.
   * A free slot (empty or dead) is used first; otherwise the oldest live
   * event of the lowest priority ≤ the newcomer's is evicted.
   */
  publish(contact: RippleContact, now: number): number | null;
  /** Events alive at `now` (0 ≤ age < lifetime), newest first. */
  active(now: number): RippleEvent[];
  /**
   * The live events `pack(now, maxCount)` selects, newest first (debug and
   * the CPU `withRipples` sample: exactly what the shader receives).
   */
  selected(now: number, maxCount: number): RippleEvent[];
  /**
   * Write up to `maxCount` live events into `out` as
   * `vec4(x, z, spawnTime, strength + kindIndex·2)`; unused slots are zeroed.
   * POKEMON-CORE C11: over the cap, the top `maxCount` by (priority, publish
   * order) are kept; they are written newest first. With every live kind at
   * one priority this is exactly the pre-C11 newest-first pack (tested).
   * Returns the number written. Allocation-free (called every frame).
   */
  pack(now: number, maxCount: number, out: Float32Array): number;
  /** Total events ever published (the next id). */
  readonly published: number;
  /** The most recently published event (live or not), or null. Debug readout. */
  readonly last: RippleEvent | null;
  /**
   * Events published in the last `windowS` seconds of water time, divided by
   * the window (events/s). Counts only what the pool still holds, so it
   * under-reads above `capacity / windowS` — a debug readout, not telemetry.
   */
  rate(now: number, windowS: number): number;
  /**
   * POKEMON-CORE C11 evidence (`__routeWorldWater().bodies[i].stats.pool`):
   * live events evicted before the end of their life, per kind, and
   * newcomers dropped because every live event outranked them.
   * `liveEvicted.splash` stays 0 under wake spam (K6).
   */
  readonly evictions: { readonly liveEvicted: Readonly<Record<RippleKind, number>>; readonly dropped: number };
  clear(): void;
}

function isLive(event: RippleEvent | null, now: number): event is RippleEvent {
  if (!event) return false;
  const age = now - event.spawnTime;
  return age >= 0 && age < RIPPLE_KIND_PARAMS[event.kind].lifetimeS;
}

export interface RipplePoolOptions {
  /** Kind priorities (the tests pass an all-equal table to prove the legacy order). */
  priority?: Readonly<Record<RippleKind, number>>;
}

function zeroKindCounts(): Record<RippleKind, number> {
  return { step: 0, float: 0, splash: 0, petal: 0, ambient: 0 };
}

export function createRipplePool(
  spec: WaterBodySpec,
  capacity: number = RIPPLE_CAPACITY,
  options: RipplePoolOptions = {},
): RipplePool {
  const size = Math.max(1, Math.floor(capacity));
  const priority = options.priority ?? RIPPLE_KIND_PRIORITY;
  const slots: (RippleEvent | null)[] = new Array<RippleEvent | null>(size).fill(null);
  /** Pack scratch: slot indexes of the selected events (no allocation per frame). */
  const order = new Int32Array(size);
  let nextId = 0;
  let last: RippleEvent | null = null;
  const liveEvicted = zeroKindCounts();
  const counters = { dropped: 0 };
  const evictions = {
    liveEvicted,
    get dropped() {
      return counters.dropped;
    },
  };

  /** Does live event `a` outrank live event `b` for the pack (priority, then newer)? */
  const outranks = (a: RippleEvent, b: RippleEvent) => {
    const pa = priority[a.kind];
    const pb = priority[b.kind];
    return pa > pb || (pa === pb && a.id > b.id);
  };

  /**
   * Fill `order` with the slot indexes of the selected live events, newest
   * first; returns the count. A live event is selected when fewer than
   * `limit` live events outrank it (≤ 16² comparisons, allocation-free).
   */
  const select = (now: number, limit: number): number => {
    let count = 0;
    for (let i = 0; i < size; i += 1) {
      const event = slots[i];
      if (!isLive(event, now)) continue;
      let above = 0;
      for (let j = 0; j < size && above < limit; j += 1) {
        const other = slots[j];
        if (j !== i && isLive(other, now) && outranks(other, event)) above += 1;
      }
      if (above >= limit) continue;
      // Insertion by id, newest first.
      let k = count;
      while (k > 0 && (slots[order[k - 1]] as RippleEvent).id < event.id) {
        order[k] = order[k - 1];
        k -= 1;
      }
      order[k] = i;
      count += 1;
    }
    return count;
  };

  return {
    capacity: size,
    get published() {
      return nextId;
    },
    get last() {
      return last;
    },
    evictions,
    rate(now, windowS) {
      const w = Math.max(1e-3, windowS);
      let count = 0;
      for (const event of slots) {
        if (event && event.spawnTime <= now && event.spawnTime > now - w) count += 1;
      }
      return count / w;
    },
    publish(contact, now) {
      if (!Number.isFinite(contact.x) || !Number.isFinite(contact.z) || !Number.isFinite(now)) return null;
      if (!(contact.strength > 0)) return null;
      if (!insideWater(spec, contact.x, contact.z)) return null;
      // A free slot (never used, or its event is dead) first: the one holding
      // the OLDEST publish, so a pool that never fills cycles like the ring.
      let slot = -1;
      for (let i = 0; i < size; i += 1) {
        const event = slots[i];
        if (event === null) {
          slot = i;
          break;
        }
        const eventId = event.id;
        if (!isLive(event, now) && (slot < 0 || (slots[slot] as RippleEvent).id > eventId)) slot = i;
      }
      if (slot < 0) {
        // Full of live events: the oldest of the lowest priority ≤ ours goes.
        const mine = priority[contact.kind];
        let lowest = Infinity;
        for (let i = 0; i < size; i += 1) {
          const event = slots[i] as RippleEvent;
          const p = priority[event.kind];
          if (p > mine) continue;
          if (p < lowest || (p === lowest && event.id < (slots[slot] as RippleEvent).id)) {
            lowest = p;
            slot = i;
          }
        }
        if (slot < 0) {
          counters.dropped += 1;
          return null;
        }
        liveEvicted[(slots[slot] as RippleEvent).kind] += 1;
      }
      const id = nextId;
      nextId += 1;
      const event: RippleEvent = {
        id,
        x: contact.x,
        z: contact.z,
        strength: Math.min(1, contact.strength),
        kind: contact.kind,
        spawnTime: now,
      };
      slots[slot] = event;
      last = event;
      return id;
    },
    active(now) {
      const out: RippleEvent[] = [];
      for (const event of slots) if (isLive(event, now)) out.push(event);
      return out.sort((a, b) => b.id - a.id);
    },
    selected(now, maxCount) {
      const limit = Math.max(0, Math.min(Math.floor(maxCount), size));
      const count = select(now, limit);
      const out: RippleEvent[] = [];
      for (let k = 0; k < count; k += 1) out.push(slots[order[k]] as RippleEvent);
      return out;
    },
    pack(now, maxCount, out) {
      const limit = Math.max(0, Math.min(Math.floor(maxCount), size, Math.floor(out.length / 4)));
      const count = select(now, limit);
      for (let k = 0; k < count; k += 1) {
        const event = slots[order[k]] as RippleEvent;
        const o = k * 4;
        out[o] = event.x;
        out[o + 1] = event.z;
        out[o + 2] = event.spawnTime;
        out[o + 3] = packRippleW(event.strength, event.kind);
      }
      out.fill(0, count * 4);
      return count;
    },
    clear() {
      slots.fill(null);
      last = null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Wake limiter (POKEMON-CORE C11)                                      */
/* ------------------------------------------------------------------ */

/** Token-bucket size (wakes that may fire back to back). */
export const WAKE_BUCKET_TOKENS = 4;
/** Hard ceiling: wakes per body in any 1 s of water time. */
export const WAKE_MAX_PER_S = 4;
/** Per-source minimum interval (s): one floater, at most one wake per 1.2 s. */
export const WAKE_MIN_INTERVAL_S = 1.2;

/** The bucket's refill rate (wakes per water-second) at a rung's ripple cap: `min(4, cap / float lifetime)`. */
export function wakeRefillRate(rippleCap: number): number {
  const cap = Math.max(0, rippleCap);
  return Math.min(WAKE_MAX_PER_S, cap / RIPPLE_KIND_PARAMS.float.lifetimeS);
}

export interface WakeLimiterStats {
  accepted: number;
  /** Refused by the source's 1.2 s interval. */
  droppedInterval: number;
  /** Refused by the body's bucket or its per-second ceiling. */
  droppedBucket: number;
  /** The most wakes accepted inside any 1 s window of water time (K6: ≤ 4). */
  maxPerSecond: number;
}

/**
 * The per-body wake gate for `float` contacts (the drift wakes) only.
 * Splashes and steps bypass it; their priority guards them in the pool.
 */
export interface WakeLimiter {
  /** May `sourceId` publish a wake at water time `now` under ripple cap `rippleCap`? Consumes a token when true. */
  tryWake(sourceId: string, now: number, rippleCap: number): boolean;
  /**
   * The same gate WITHOUT consuming: counts a refusal in the stats and
   * returns false, or returns true and spends nothing. Pair it with
   * `commit` once the pool actually took the wake, so a contact the pool
   * rejects (off the ellipse, dropped by priority) costs no token, no
   * interval and no `accepted` count.
   */
  check(sourceId: string, now: number, rippleCap: number): boolean;
  /** Spend the token and the source's interval for a wake the pool accepted (after a true `check` at the same `now`). */
  commit(sourceId: string, now: number): void;
  readonly stats: Readonly<WakeLimiterStats>;
  reset(): void;
}

/**
 * POKEMON-CORE C11: a token bucket of `WAKE_BUCKET_TOKENS` refilled at
 * `wakeRefillRate(cap)` per water-second, a hard ceiling of `WAKE_MAX_PER_S`
 * in any 1 s window, and `WAKE_MIN_INTERVAL_S` per source. Allocation-free
 * after a source's first wake (one map entry per source). A water clock that
 * runs backwards (the capture pin, a D32 runtime rebuild) resets it; spawn
 * times are never carried across a rewind.
 */
export function createWakeLimiter(): WakeLimiter {
  const lastBySource = new Map<string, number>();
  /** The last accepted wakes' times (ring), for the per-second ceiling. */
  const ring = new Float64Array(WAKE_MAX_PER_S).fill(-Infinity);
  /** Doubles on one object (not closure `let`s): stored in place, never boxed per frame. */
  const clk = { tokens: WAKE_BUCKET_TOKENS, at: Number.NaN, head: 0 };
  const stats: WakeLimiterStats = { accepted: 0, droppedInterval: 0, droppedBucket: 0, maxPerSecond: 0 };

  const reset = () => {
    lastBySource.clear();
    ring.fill(-Infinity);
    clk.head = 0;
    clk.tokens = WAKE_BUCKET_TOKENS;
    clk.at = Number.NaN;
  };

  const check = (sourceId: string, now: number, rippleCap: number): boolean => {
    if (!Number.isFinite(now)) return false;
    if (Number.isFinite(clk.at) && now < clk.at) reset();
    if (Number.isFinite(clk.at)) {
      clk.tokens = Math.min(WAKE_BUCKET_TOKENS, clk.tokens + (now - clk.at) * wakeRefillRate(rippleCap));
    }
    clk.at = now;
    const previous = lastBySource.get(sourceId);
    if (previous !== undefined && now - previous < WAKE_MIN_INTERVAL_S) {
      stats.droppedInterval += 1;
      return false;
    }
    // The oldest of the last WAKE_MAX_PER_S accepted wakes must be ≥ 1 s old.
    if (clk.tokens < 1 || now - ring[clk.head] < 1) {
      stats.droppedBucket += 1;
      return false;
    }
    return true;
  };
  const commit = (sourceId: string, now: number): void => {
    if (!Number.isFinite(now)) return;
    clk.tokens = Math.max(0, clk.tokens - 1);
    ring[clk.head] = now;
    clk.head = (clk.head + 1) % WAKE_MAX_PER_S;
    lastBySource.set(sourceId, now);
    stats.accepted += 1;
    let inWindow = 0;
    for (let i = 0; i < WAKE_MAX_PER_S; i += 1) if (now - ring[i] < 1) inWindow += 1;
    if (inWindow > stats.maxPerSecond) stats.maxPerSecond = inWindow;
  };

  return {
    stats,
    reset,
    check,
    commit,
    tryWake(sourceId, now, rippleCap) {
      if (!check(sourceId, now, rippleCap)) return false;
      commit(sourceId, now);
      return true;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mesh                                                                 */
/* ------------------------------------------------------------------ */

export interface WaterDiscData {
  /** Local `(x, 0, z)` vertex positions relative to the body centre. */
  positions: Float32Array;
  /** Triangle indices, counter-clockwise seen from +Y (normal up). */
  indices: Uint32Array;
}

/**
 * Tessellation per `QualityStep.waterDetail` tier (0..3). Rings are spaced
 * `(j / rings)^0.75`, which puts more rings toward the rim where the shore
 * band, lip and contact ripples live, without starving the centre.
 */
export const WATER_TESSELLATION: readonly { rings: number; segments: number }[] = [
  { rings: 10, segments: 48 },
  { rings: 18, segments: 80 },
  { rings: 28, segments: 128 },
  { rings: 28, segments: 128 },
];

export function waterTessellation(detail: number): { rings: number; segments: number } {
  const tier = Math.max(0, Math.min(WATER_TESSELLATION.length - 1, Math.floor(detail)));
  return WATER_TESSELLATION[tier];
}

/**
 * A polar-grid elliptical disc — unlike `CircleGeometry` (a centre fan with
 * no interior vertices), it has interior vertices for the wave displacement
 * to move. The outer ring lies exactly on the ellipse.
 */
export function buildWaterDisc(radii: WaterVec2, rings: number, segments: number): WaterDiscData {
  const R = Math.max(1, Math.floor(rings));
  const S = Math.max(3, Math.floor(segments));
  const positions = new Float32Array((1 + R * S) * 3);
  // Centre vertex stays at 0.
  for (let j = 1; j <= R; j += 1) {
    const f = Math.pow(j / R, 0.75);
    for (let i = 0; i < S; i += 1) {
      const a = (i / S) * TAU;
      const o = (1 + (j - 1) * S + i) * 3;
      positions[o] = Math.cos(a) * f * radii[0];
      positions[o + 2] = Math.sin(a) * f * radii[1];
    }
  }
  const ring = (j: number, i: number) => 1 + (j - 1) * S + (i % S);
  const indices: number[] = [];
  // Winding: (centre, next, current) gives (next × current).y = sin(Δa) > 0,
  // i.e. the face normal points +Y (the water is seen from above).
  for (let i = 0; i < S; i += 1) indices.push(0, ring(1, i + 1), ring(1, i));
  for (let j = 1; j < R; j += 1) {
    for (let i = 0; i < S; i += 1) {
      const a = ring(j, i);
      const b = ring(j, i + 1);
      const c = ring(j + 1, i);
      const d = ring(j + 1, i + 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices: Uint32Array.from(indices) };
}

/* ------------------------------------------------------------------ */
/* GLSL emission                                                        */
/* ------------------------------------------------------------------ */

/** A GLSL float literal (always with a decimal point, never exponent form). */
export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`water: non-finite GLSL constant ${String(n)}`);
  const fixed = n.toFixed(6);
  return fixed === '-0.000000' ? '0.000000' : fixed;
}

/**
 * The GLSL chunk both water shaders include: body constants, the wave bands,
 * the ripple kind table, the ambient table, and the field functions — the
 * exact mirrors of `addBand`, `addRipple`, `ambientRipplesAt`,
 * `shoreDistance` and `depthAtShoreDistance` above. Generated from the one
 * spec object so CPU buoyancy and GPU displacement never diverge.
 *
 * The chunk declares the event uniforms it reads (`uRipples`,
 * `uRippleCount`, `uAmbientStreams`); the material supplies their values.
 * If-chains instead of const arrays keep it valid GLSL ES 1.0 as well as 3.0.
 */
export function emitGlsl(spec: WaterBodySpec): string {
  const f = glslFloat;
  const lines: string[] = [];
  lines.push(`#define WATER_RIPPLE_CAPACITY ${RIPPLE_CAPACITY}`);
  lines.push(`#define WATER_AMBIENT_MAX_STREAMS ${WATER_AMBIENT_MAX_STREAMS}`);
  lines.push(`const vec2 WATER_CENTER = vec2(${f(spec.center[0])}, ${f(spec.center[1])});`);
  lines.push(`const vec2 WATER_RADII = vec2(${f(spec.radii[0])}, ${f(spec.radii[1])});`);
  lines.push(`const float WATER_SURFACE_Y = ${f(spec.surfaceY)};`);
  lines.push(`const float WATER_MAX_TROUGH = ${f(maxTroughDepth(spec))};`);
  lines.push(`const float WATER_DEPTH_M = ${f(spec.depthM)};`);
  lines.push(`const float WATER_SHORE_BAND_M = ${f(spec.shoreBandM)};`);
  lines.push(`const float WATER_SHELF_M = ${f(shelfWidth(spec))};`);
  lines.push(`const float WATER_AMP_SUM = ${f(Math.max(1e-4, waveAmplitudeSum(spec)))};`);
  lines.push(`const float WATER_CAPILLARY_SCALE = ${f(spec.capillary.scaleM)};`);
  lines.push(`const float WATER_CAPILLARY_STRENGTH = ${f(spec.capillary.strength)};`);
  // Islands as vec3(x, z, r); r = 0 marks an unused slot.
  const islands = islandsOf(spec);
  for (let i = 0; i < WATER_MAX_ISLANDS; i += 1) {
    const island = islands[i];
    const value = island ? `vec3(${f(island.x)}, ${f(island.z)}, ${f(island.r)})` : 'vec3(0.0, 0.0, 0.0)';
    lines.push(`const vec3 WATER_ISLAND${i} = ${value};`);
  }
  spec.waves.forEach((band, i) => {
    const k = TAU / band.wavelengthM;
    lines.push(`// wave band ${i}: dir ${f(band.dirRad)} rad, λ ${f(band.wavelengthM)} m, A ${f(band.amplitudeM)} m, c ${f(band.speed)} m/s, steep ${f(band.steepness)}`);
    lines.push(`const vec2 WAVE${i}_DIR = vec2(${f(Math.cos(band.dirRad))}, ${f(Math.sin(band.dirRad))});`);
    lines.push(`const float WAVE${i}_K = ${f(k)};`);
    lines.push(`const float WAVE${i}_OMEGA = ${f(k * band.speed)};`);
    lines.push(`const float WAVE${i}_AMP = ${f(band.amplitudeM)};`);
    lines.push(`const float WAVE${i}_EXP = ${f(1 + 2 * band.steepness)};`);
    lines.push(`const float WAVE${i}_STEEP = ${f(band.steepness)};`);
  });

  const table = ambientTable(spec);
  const totalStreams = Math.max(1, Math.min(WATER_AMBIENT_MAX_STREAMS, spec.ambient.streams));
  lines.push(`const float WATER_AMBIENT_PERIOD = ${f(ambientPeriod(spec))};`);
  lines.push(`const float WATER_AMBIENT_TOTAL = ${f(totalStreams)};`);
  lines.push(`const float WATER_AMBIENT_TABLE = ${f(WATER_AMBIENT_TABLE_SIZE)};`);
  lines.push(`const float WATER_KIND_AMBIENT = ${f(RIPPLE_KINDS.indexOf('ambient'))};`);
  const phase = ambientPhase(spec, table);
  lines.push(`const float WATER_AMBIENT_ORIGIN = ${f(phase.origin)};`);
  lines.push(`const float WATER_AMBIENT_SHIFT = ${f(phase.shift)};`);

  lines.push(`vec4 waterAmbientEntry(float idx) {`);
  table.forEach((entry, i) => {
    const value = `vec4(${f(entry.x)}, ${f(entry.z)}, ${f(entry.delayFrac)}, ${f(Math.min(1, entry.strength))})`;
    if (i < table.length - 1) lines.push(`  if (idx < ${f(i + 0.5)}) return ${value};`);
    else lines.push(`  return ${value};`);
  });
  lines.push(`}`);

  lines.push(`void waterRippleKind(float kind, out float life, out float lambda, out float speed, out float amp, out float foamGain, out float decay) {`);
  RIPPLE_KINDS.forEach((kind, i) => {
    const p = RIPPLE_KIND_PARAMS[kind];
    const body = `{ life = ${f(p.lifetimeS)}; lambda = ${f(p.wavelengthM)}; speed = ${f(p.speedMps)}; amp = ${f(p.amplitudeM)}; foamGain = ${f(p.foamGain)}; decay = ${f(p.decayRate)}; return; }`;
    if (i < RIPPLE_KINDS.length - 1) lines.push(`  if (kind < ${f(i + 0.5)}) ${body} // ${kind}`);
    else lines.push(`  ${body} // ${kind}`);
  });
  lines.push(`}`);

  lines.push(WATER_GLSL_FUNCTIONS);
  return lines.join('\n');
}

/** The spec-independent field functions (mirrors of the TS above). */
const WATER_GLSL_FUNCTIONS = /* glsl */ `
uniform vec4 uRipples[WATER_RIPPLE_CAPACITY];
uniform int uRippleCount;
uniform float uAmbientStreams;

float waterShoreDist(vec2 p) {
  vec2 q = p - WATER_CENTER;
  float f = length(q / WATER_RADII);
  float g = length(q / (WATER_RADII * WATER_RADII));
  float d = g < 1e-6 ? min(WATER_RADII.x, WATER_RADII.y) : -(f * (f - 1.0)) / g;
  if (WATER_ISLAND0.z > 0.0) d = min(d, length(p - WATER_ISLAND0.xy) - WATER_ISLAND0.z);
  if (WATER_ISLAND1.z > 0.0) d = min(d, length(p - WATER_ISLAND1.xy) - WATER_ISLAND1.z);
  return d;
}

float waterDepth(float shoreDist) {
  return WATER_DEPTH_M * smoothstep(0.0, WATER_SHELF_M, shoreDist);
}

void waterBand(vec2 p, float t, vec2 dir, float k, float omega, float amp, float e, float steep,
               inout float h, inout vec2 g, inout float crest) {
  float th = k * dot(dir, p) - omega * t;
  float sn = sin(th);
  float s = max(0.5 * (sn + 1.0), 1e-4);
  float se1 = pow(s, e - 1.0);
  h += amp * (2.0 * se1 * s - 1.0);
  g += amp * e * se1 * cos(th) * k * dir;
  crest += steep * pow(s, 6.0);
}

void waterRipple(vec2 p, float t, vec4 ev, inout float h, inout vec2 g, inout float foam) {
  float kind = floor(ev.w * 0.5);
  float strength = ev.w - kind * 2.0;
  float life; float lambda; float speed; float amp; float foamGain; float decay;
  waterRippleKind(kind, life, lambda, speed, amp, foamGain, decay);
  float age = t - ev.z;
  if (age < 0.0 || age >= life || strength <= 0.0) return;
  vec2 d = p - ev.xy;
  float r = length(d);
  float front = r - speed * age;
  float sigma = 0.9 * lambda;
  float w = exp(-(front * front) / (sigma * sigma));
  if (w < 1e-3) return;
  float life01 = age / life;
  float env = strength * amp * exp(-decay * life01) * (1.0 - life01);
  float k = 6.283185307 / lambda;
  float sn = sin(k * front);
  float cs = cos(k * front);
  h += env * w * sn;
  float dr = env * w * (k * cs - (2.0 * front / (sigma * sigma)) * sn);
  if (r > 1e-4) g += dr * d / r;
  float foamSigma = 0.35 * lambda;
  foam += foamGain * strength * (1.0 - life01) * exp(-(front * front) / (foamSigma * foamSigma));
}

// Stream sf's current event at time t: vec4(x, z, spawnTime, strength) —
// the mirror of the cycle arithmetic in ambientRipplesAt (incl. the pin phase).
vec4 waterAmbientEvent(float sf, float t) {
  float offset = WATER_AMBIENT_ORIGIN + sf * WATER_AMBIENT_PERIOD / WATER_AMBIENT_TOTAL;
  float cycle = floor((t - offset) / WATER_AMBIENT_PERIOD);
  float idx = mod(cycle * WATER_AMBIENT_TOTAL + sf + WATER_AMBIENT_SHIFT, WATER_AMBIENT_TABLE);
  vec4 e = waterAmbientEntry(idx);
  return vec4(e.x, e.y, offset + cycle * WATER_AMBIENT_PERIOD + e.z * WATER_AMBIENT_PERIOD, e.w);
}

void waterAmbient(vec2 p, float t, float streams, inout float h, inout vec2 g, inout float foam) {
  for (int s = 0; s < WATER_AMBIENT_MAX_STREAMS; s++) {
    float sf = float(s);
    if (sf >= streams || sf >= WATER_AMBIENT_TOTAL) break;
    vec4 e = waterAmbientEvent(sf, t);
    waterRipple(p, t, vec4(e.x, e.y, e.z, e.w + WATER_KIND_AMBIENT * 2.0), h, g, foam);
  }
}

// The whole field at world p = (x, z): h is the displacement over
// WATER_SURFACE_Y (already faded across the shore band), g its gradient,
// crest the wave-crest intensity, foam the ripple ring-front foam.
void waterField(vec2 p, float t, out float h, out vec2 g, out float crest, out float foam, out float shoreDist) {
  h = 0.0; g = vec2(0.0); crest = 0.0; foam = 0.0;
  shoreDist = waterShoreDist(p);
  waterBand(p, t, WAVE0_DIR, WAVE0_K, WAVE0_OMEGA, WAVE0_AMP, WAVE0_EXP, WAVE0_STEEP, h, g, crest);
  waterBand(p, t, WAVE1_DIR, WAVE1_K, WAVE1_OMEGA, WAVE1_AMP, WAVE1_EXP, WAVE1_STEEP, h, g, crest);
  waterBand(p, t, WAVE2_DIR, WAVE2_K, WAVE2_OMEGA, WAVE2_AMP, WAVE2_EXP, WAVE2_STEEP, h, g, crest);
  for (int i = 0; i < WATER_RIPPLE_CAPACITY; i++) {
    if (i >= uRippleCount) break;
    waterRipple(p, t, uRipples[i], h, g, foam);
  }
  if (uAmbientStreams > 0.0) waterAmbient(p, t, uAmbientStreams, h, g, foam);
  float fade = smoothstep(0.0, WATER_SHORE_BAND_M, shoreDist);
  h *= fade;
  g *= fade;
  if (h < 0.0) {
    float e = exp(h / WATER_MAX_TROUGH);
    h = -WATER_MAX_TROUGH * (1.0 - e);
    g *= e;
  }
  crest = clamp(crest, 0.0, 1.0) * fade;
  foam = min(foam, 1.0) * fade;
}
`;

import { describe, expect, it } from 'vitest';
import {
  AMBIENT_PIN_AGE_S,
  ambientPeriod,
  ambientPhase,
  ambientRipplesAt,
  ambientTable,
  buildWaterDisc,
  createRipplePool,
  createWakeLimiter,
  createWaterSampleOut,
  emitGlsl,
  glslFloat,
  insideWater,
  linearLuminance,
  maxTroughDepth,
  mixHex,
  packRippleW,
  RIPPLE_CAPACITY,
  RIPPLE_KIND_PARAMS,
  RIPPLE_KIND_PRIORITY,
  RIPPLE_KINDS,
  sampleInto,
  sampleWater,
  scaleHex,
  shoreDistance,
  unpackRippleW,
  wakeRefillRate,
  waterTessellation,
  WAKE_MIN_INTERVAL_S,
  WATER_MIN_HORIZON_DELTA,
  WATER_MIN_SHALLOW_DELTA,
  withHorizonContrast,
  type RippleKind,
  type WaterBodySpec,
} from '../water';
import { FALLBACK_PALETTE } from '../palette';
import { sakuraPaletteExtension } from '@/components/world/themes/sakura/theme-palette';
import { mountainPaletteExtension } from '@/components/world/themes/mountain/theme-palette';
import { mountainTarnColors, sakuraLakeColors } from '@/components/world/route/water/body-palettes';
import { WATER_FRAGMENT } from '@/components/world/route/water/water-shader';

/**
 * Spec §5.2 / fidelity W3 — the pure bounded-water contract: a finite height
 * field with unit normals, a metric shore distance, a fixed-capacity ripple
 * pool keyed to the water clock (so the capture phase pin freezes it), a
 * pure-of-time ambient stream, and GLSL emitted from the same spec object.
 */

const SPEC: WaterBodySpec = {
  id: 'test-lake',
  center: [0, -8.5],
  radii: [10, 4.8],
  surfaceY: 0.06,
  floorY: 0.012,
  depthM: 1.4,
  shoreBandM: 0.9,
  waves: [
    { dirRad: 0.2, wavelengthM: 6.5, amplitudeM: 0.04, speed: 0.9, steepness: 0.35 },
    { dirRad: 1.9, wavelengthM: 3.4, amplitudeM: 0.028, speed: 0.7, steepness: 0.2 },
    { dirRad: -0.9, wavelengthM: 1.7, amplitudeM: 0.012, speed: 0.55, steepness: 0.1 },
  ],
  capillary: { scaleM: 0.45, strength: 0.08 },
  colors: {
    deep: '#2c6f79',
    shallow: '#79b8b5',
    absorb: '#3f8f8a',
    foam: '#e6eef0',
    shore: '#c9b28d',
    skyZenith: '#8ec8e8',
    skyHorizon: '#f6dfda',
  },
  ambient: { periodS: 5.5, streams: 2, strength: 0.8, seed: 7 },
};

const CENTER_X = SPEC.center[0];
const CENTER_Z = SPEC.center[1];

describe('shore distance', () => {
  it('is zero on the rim, positive inside, negative outside, in metres on both axes', () => {
    expect(shoreDistance(SPEC, CENTER_X + 10, CENTER_Z)).toBeCloseTo(0, 6);
    expect(shoreDistance(SPEC, CENTER_X, CENTER_Z + 4.8)).toBeCloseTo(0, 6);
    // One metre inside the rim along each axis reads as one metre.
    expect(shoreDistance(SPEC, CENTER_X + 9, CENTER_Z)).toBeCloseTo(1, 1);
    expect(shoreDistance(SPEC, CENTER_X, CENTER_Z + 3.8)).toBeCloseTo(1, 1);
    expect(shoreDistance(SPEC, CENTER_X + 11, CENTER_Z)).toBeLessThan(0);
    expect(shoreDistance(SPEC, CENTER_X, CENTER_Z)).toBeCloseTo(4.8, 6);
  });

  it('treats an island edge as shore: fade, rejection and GLSL constants', () => {
    const islanded: WaterBodySpec = { ...SPEC, islands: [{ x: 2.2, z: -9.2, r: 2.55 }] };
    expect(shoreDistance(islanded, 2.2 + 2.55, -9.2)).toBeCloseTo(0, 9);
    expect(shoreDistance(islanded, 2.2 + 3.55, -9.2)).toBeCloseTo(1, 9);
    expect(shoreDistance(islanded, 2.2, -9.2)).toBeLessThan(0);
    expect(insideWater(islanded, 2.2, -9.2)).toBe(false);
    expect(sampleWater(islanded, 2.2 + 2.55, -9.2, 3.3).height).toBeCloseTo(SPEC.surfaceY, 9);
    const pool = createRipplePool(islanded);
    expect(pool.publish({ x: 2.2, z: -9.2, strength: 1, kind: 'splash' }, 0)).toBeNull();
    for (const entry of ambientTable(islanded)) expect(shoreDistance(islanded, entry.x, entry.z)).toBeGreaterThan(SPEC.shoreBandM);
    expect(emitGlsl(islanded)).toContain(`const vec3 WATER_ISLAND0 = vec3(${glslFloat(2.2)}, ${glslFloat(-9.2)}, ${glslFloat(2.55)});`);
    expect(emitGlsl(SPEC)).toContain('const vec3 WATER_ISLAND0 = vec3(0.0, 0.0, 0.0);');
  });

  it('insideWater agrees with the sign of the shore distance', () => {
    for (let i = 0; i < 200; i += 1) {
      const x = CENTER_X + Math.sin(i * 1.7) * 12;
      const z = CENTER_Z + Math.cos(i * 2.3) * 6;
      const d = shoreDistance(SPEC, x, z);
      if (Math.abs(d) < 1e-3) continue;
      expect(insideWater(SPEC, x, z)).toBe(d > 0);
    }
  });
});

describe('sampleWater — the height field', () => {
  it('is finite with unit normals everywhere inside, across time', () => {
    for (let i = 0; i < 400; i += 1) {
      const x = CENTER_X + Math.sin(i * 0.91) * 9.5;
      const z = CENTER_Z + Math.cos(i * 1.37) * 4.5;
      const t = i * 0.37;
      const s = sampleWater(SPEC, x, z, t, [], 2);
      expect(Number.isFinite(s.height)).toBe(true);
      expect(Math.hypot(...s.normal)).toBeCloseTo(1, 6);
      expect(s.normal[1]).toBeGreaterThan(0.8);
      expect(s.crest).toBeGreaterThanOrEqual(0);
      expect(s.crest).toBeLessThanOrEqual(1);
    }
  });

  it('pins the rim at the rest height so the shore never gaps', () => {
    for (let t = 0; t < 10; t += 0.7) {
      expect(sampleWater(SPEC, CENTER_X + 10, CENTER_Z, t).height).toBeCloseTo(SPEC.surfaceY, 9);
      expect(sampleWater(SPEC, CENTER_X - 30, CENTER_Z, t).height).toBe(SPEC.surfaceY);
    }
  });

  it('moves over time and stays inside the amplitude envelope', () => {
    const ampSum = SPEC.waves.reduce((sum, band) => sum + band.amplitudeM, 0);
    const a = sampleWater(SPEC, CENTER_X, CENTER_Z, 0).height;
    const b = sampleWater(SPEC, CENTER_X, CENTER_Z, 1.3).height;
    expect(a).not.toBeCloseTo(b, 5);
    for (let t = 0; t < 20; t += 0.3) {
      const h = sampleWater(SPEC, CENTER_X + 1, CENTER_Z, t).height - SPEC.surfaceY;
      expect(Math.abs(h)).toBeLessThanOrEqual(ampSum + 1e-9);
    }
  });

  it('never dips through the floor, even under a full splash on a trough', () => {
    const floorLimit = SPEC.floorY + 0.004;
    for (let i = 0; i < 300; i += 1) {
      const t = 3 + i * 0.013;
      const x = CENTER_X - 2 + Math.sin(i) * 0.6;
      const z = CENTER_Z + Math.cos(i * 1.3) * 0.6;
      const splash = { x: CENTER_X - 2, z: CENTER_Z, strength: 1, kind: 'splash' as const, spawnTime: 3 };
      expect(sampleWater(SPEC, x, z, t, [splash], 2).height).toBeGreaterThan(floorLimit);
    }
    expect(maxTroughDepth(SPEC)).toBeCloseTo(SPEC.surfaceY - SPEC.floorY - 0.005, 9);
    expect(emitGlsl(SPEC)).toContain(`const float WATER_MAX_TROUGH = ${glslFloat(maxTroughDepth(SPEC))};`);
  });

  it('the normal is the analytic slope of the height (finite-difference check)', () => {
    const x = CENTER_X + 2.3;
    const z = CENTER_Z - 1.1;
    const t = 4.2;
    const eps = 1e-4;
    const hx = (sampleWater(SPEC, x + eps, z, t).height - sampleWater(SPEC, x - eps, z, t).height) / (2 * eps);
    const hz = (sampleWater(SPEC, x, z + eps, t).height - sampleWater(SPEC, x, z - eps, t).height) / (2 * eps);
    const n = sampleWater(SPEC, x, z, t).normal;
    expect(-n[0] / n[1]).toBeCloseTo(hx, 4);
    expect(-n[2] / n[1]).toBeCloseTo(hz, 4);
  });

  it('a ripple couples displacement, normal and foam at the same point', () => {
    const source = { x: CENTER_X + 1, z: CENTER_Z, strength: 1, kind: 'splash' as const, spawnTime: 2 };
    const t = 2.5;
    const front = RIPPLE_KIND_PARAMS.splash.speedMps * 0.5;
    const px = source.x + front + RIPPLE_KIND_PARAMS.splash.wavelengthM * 0.25;
    const calm = sampleWater(SPEC, px, source.z, t);
    const rippled = sampleWater(SPEC, px, source.z, t, [source]);
    expect(rippled.height).not.toBeCloseTo(calm.height, 4);
    expect(rippled.normal[0]).not.toBeCloseTo(calm.normal[0], 4);
    expect(rippled.rippleFoam).toBeGreaterThan(0);
    expect(calm.rippleFoam).toBe(0);
    // Before its spawn and after its lifetime the event contributes nothing.
    expect(sampleWater(SPEC, px, source.z, 1.9, [source]).height).toBeCloseTo(sampleWater(SPEC, px, source.z, 1.9).height, 12);
    const late = 2 + RIPPLE_KIND_PARAMS.splash.lifetimeS + 0.01;
    expect(sampleWater(SPEC, px, source.z, late, [source]).height).toBeCloseTo(sampleWater(SPEC, px, source.z, late).height, 12);
  });

  it('ripple normals are the analytic radial slope (finite-difference check)', () => {
    const source = { x: CENTER_X, z: CENTER_Z, strength: 0.9, kind: 'step' as const, spawnTime: 0 };
    const t = 0.8;
    const x = CENTER_X + 0.62;
    const z = CENTER_Z + 0.2;
    const eps = 1e-5;
    const h = (dx: number, dz: number) => sampleWater(SPEC, x + dx, z + dz, t, [source]).height;
    const hx = (h(eps, 0) - h(-eps, 0)) / (2 * eps);
    const n = sampleWater(SPEC, x, z, t, [source]).normal;
    expect(-n[0] / n[1]).toBeCloseTo(hx, 3);
  });
});

describe('ripple pool', () => {
  it('assigns monotonic ids and rejects contacts outside the ellipse or without strength', () => {
    const pool = createRipplePool(SPEC);
    expect(pool.capacity).toBe(RIPPLE_CAPACITY);
    expect(pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 1, kind: 'step' }, 0)).toBe(0);
    expect(pool.publish({ x: CENTER_X + 1, z: CENTER_Z, strength: 0.5, kind: 'float' }, 0.1)).toBe(1);
    expect(pool.publish({ x: CENTER_X + 20, z: CENTER_Z, strength: 1, kind: 'step' }, 0.2)).toBeNull();
    expect(pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 0, kind: 'step' }, 0.2)).toBeNull();
    expect(pool.publish({ x: Number.NaN, z: CENTER_Z, strength: 1, kind: 'step' }, 0.2)).toBeNull();
    expect(pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 5, kind: 'splash' }, 0.3)).toBe(2);
    expect(pool.active(0.3)[0].strength).toBe(1);
  });

  it('evicts the oldest event when full', () => {
    const pool = createRipplePool(SPEC, 4);
    for (let i = 0; i < 6; i += 1) pool.publish({ x: CENTER_X + i * 0.1, z: CENTER_Z, strength: 1, kind: 'splash' }, i * 0.01);
    const ids = pool.active(0.1).map((event) => event.id);
    expect(ids).toEqual([5, 4, 3, 2]);
  });

  it('ages events by the water clock: a rewound (phase-pinned) clock hides future events', () => {
    const pool = createRipplePool(SPEC);
    pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 1, kind: 'step' }, 10);
    expect(pool.active(10.5)).toHaveLength(1);
    expect(pool.active(9)).toHaveLength(0);
    expect(pool.active(10 + RIPPLE_KIND_PARAMS.step.lifetimeS + 1e-6)).toHaveLength(0);
  });

  it('packs newest-first vec4s, caps the count and zeroes the tail', () => {
    const pool = createRipplePool(SPEC);
    pool.publish({ x: CENTER_X + 1, z: CENTER_Z, strength: 0.4, kind: 'float' }, 1);
    pool.publish({ x: CENTER_X + 2, z: CENTER_Z, strength: 0.7, kind: 'splash' }, 1.2);
    pool.publish({ x: CENTER_X + 3, z: CENTER_Z, strength: 0.9, kind: 'step' }, 1.4);
    const out = new Float32Array(RIPPLE_CAPACITY * 4).fill(9);
    expect(pool.pack(1.5, 2, out)).toBe(2);
    expect(out[0]).toBeCloseTo(CENTER_X + 3, 5);
    expect(out[2]).toBeCloseTo(1.4, 5);
    expect(unpackRippleW(out[3])).toEqual({ strength: expect.closeTo(0.9, 5) as number, kind: 'step' });
    expect(unpackRippleW(out[7]).kind).toBe('splash');
    expect(Array.from(out.slice(8)).every((v) => v === 0)).toBe(true);
  });

  it('round-trips strength + kind packing for every kind', () => {
    for (const kind of RIPPLE_KINDS) {
      for (const strength of [0.01, 0.5, 1]) {
        const unpacked = unpackRippleW(packRippleW(strength, kind));
        expect(unpacked.kind).toBe(kind);
        expect(unpacked.strength).toBeCloseTo(strength, 9);
      }
    }
  });
});

describe('ambient stream (fish rise / drip)', () => {
  it('is a pure function of time — the same t gives the same events', () => {
    expect(ambientRipplesAt(SPEC, 42.7)).toEqual(ambientRipplesAt(SPEC, 42.7));
  });

  it('keeps every entry inside open water, clear of the shore band', () => {
    for (const entry of ambientTable(SPEC)) {
      expect(shoreDistance(SPEC, entry.x, entry.z)).toBeGreaterThan(SPEC.shoreBandM);
    }
  });

  it('fires every few seconds on a varied (non-metronome) cadence, never two per stream', () => {
    const spawns: number[] = [];
    const seen = new Set<string>();
    for (let t = 0; t < 120; t += 0.05) {
      const events = ambientRipplesAt(SPEC, t, 1);
      expect(events.length).toBeLessThanOrEqual(1);
      for (const event of events) {
        const key = event.spawnTime.toFixed(4);
        if (!seen.has(key)) {
          seen.add(key);
          spawns.push(event.spawnTime);
        }
      }
    }
    const gaps = spawns.slice(1).map((s, i) => s - spawns[i]);
    expect(gaps.length).toBeGreaterThan(10);
    expect(Math.min(...gaps)).toBeGreaterThan(ambientPeriod(SPEC) * 0.5);
    expect(Math.max(...gaps)).toBeLessThan(ambientPeriod(SPEC) * 1.5);
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(3);
  });

  it('is off with zero streams (the bottom rung)', () => {
    for (let t = 0; t < 30; t += 0.5) expect(ambientRipplesAt(SPEC, t, 0)).toEqual([]);
  });

  it('W3 r3: the phase pin (water time 0) catches a young ring, on the pinNear entry', () => {
    expect(AMBIENT_PIN_AGE_S).toBeGreaterThanOrEqual(0.3);
    expect(AMBIENT_PIN_AGE_S).toBeLessThanOrEqual(0.9);
    const table = ambientTable(SPEC);
    const [first] = ambientRipplesAt(SPEC, 0, 1);
    expect(first).toBeDefined();
    expect(0 - first.spawnTime).toBeCloseTo(AMBIENT_PIN_AGE_S, 9);
    expect([first.x, first.z]).toEqual([table[0].x, table[0].z]);
    // pinNear picks the nearest table entry; only the phase moves.
    const target = table[5];
    const pinned: WaterBodySpec = { ...SPEC, ambient: { ...SPEC.ambient, pinNear: [target.x + 0.1, target.z - 0.1] } };
    expect(ambientPhase(pinned).shift).toBe(5);
    const [event] = ambientRipplesAt(pinned, 0, 1);
    expect([event.x, event.z]).toEqual([target.x, target.z]);
    expect(0 - event.spawnTime).toBeCloseTo(AMBIENT_PIN_AGE_S, 9);
    expect(emitGlsl(pinned)).toContain(`const float WATER_AMBIENT_SHIFT = ${glslFloat(5)};`);
    expect(emitGlsl(pinned)).toContain(`const float WATER_AMBIENT_ORIGIN = ${glslFloat(ambientPhase(pinned).origin)};`);
  });
});

/**
 * The body with its wave bands stilled: the ring's own slope, measured at
 * rest height. (On a deep trough the smooth trough compression — the floor
 * guard — attenuates every slope there, the ring's included; that is the
 * floor law, not the ring's readability.)
 */
const STILL: WaterBodySpec = {
  ...SPEC,
  waves: [
    { ...SPEC.waves[0], amplitudeM: 0 },
    { ...SPEC.waves[1], amplitudeM: 0 },
    { ...SPEC.waves[2], amplitudeM: 0 },
  ],
};

/** The ambient ring's peak radial slope over a sweep across its front, at a given age. */
function ambientRingPeakSlope(strength: number, ageS: number): number {
  const params = RIPPLE_KIND_PARAMS.ambient;
  const source = { x: CENTER_X - 3, z: CENTER_Z, strength, kind: 'ambient' as const, spawnTime: 10 };
  const t = 10 + ageS;
  const front = params.speedMps * ageS;
  let peak = 0;
  for (let dr = -2 * params.wavelengthM; dr <= 2 * params.wavelengthM; dr += params.wavelengthM / 40) {
    const x = source.x + Math.max(0.02, front + dr);
    const ring = sampleWater(STILL, x, source.z, t, [source]).normal;
    const slope = Math.abs(ring[0] / ring[1]);
    peak = Math.max(peak, slope);
  }
  return peak;
}

describe('W3 r3: ambient rings read in the lit surface and the normals view', () => {
  /** A slope that visibly bends the analytic sky reflection (judge bar). */
  const LIT_SLOPE_MIN = 0.04;
  /** The normals debug view encodes the ripple slope ×25 around 0.5. */
  const NORMALS_VIEW_GAIN = 25;
  /** A channel swing a level-stretched crop shows unambiguously. */
  const NORMALS_VIEW_MIN_SWING = 0.2;
  // The weakest table strength: 0.55 × the tarn's ambient strength 0.55.
  const WEAKEST = 0.55 * 0.55;

  it('the ambient kind is louder and slower to decay than r2', () => {
    expect(RIPPLE_KIND_PARAMS.ambient.amplitudeM).toBeGreaterThanOrEqual(0.025);
    expect(RIPPLE_KIND_PARAMS.ambient.decayRate).toBeLessThan(2.5);
    const glsl = emitGlsl(SPEC);
    for (const kind of RIPPLE_KINDS) {
      expect(glsl).toContain(`decay = ${glslFloat(RIPPLE_KIND_PARAMS[kind].decayRate)};`);
    }
    expect(glsl).toContain('exp(-decay * life01)');
  });

  it('bends the sky reflection by ≥ 0.04 slope at 0.5 s even at the weakest strength', () => {
    expect(ambientRingPeakSlope(WEAKEST, 0.5)).toBeGreaterThanOrEqual(LIT_SLOPE_MIN);
    expect(ambientRingPeakSlope(1, 0.5)).toBeLessThan(0.6); // never a spike
  });

  it('at the pinned capture age the ring clears the normals-view threshold', () => {
    const slope = ambientRingPeakSlope(WEAKEST, AMBIENT_PIN_AGE_S);
    expect(slope).toBeGreaterThanOrEqual(LIT_SLOPE_MIN);
    expect(slope * NORMALS_VIEW_GAIN).toBeGreaterThanOrEqual(NORMALS_VIEW_MIN_SWING);
  });

  it('still reads (≥ 0.02) at 1.5 s, and is gone at the end of its life', () => {
    expect(ambientRingPeakSlope(WEAKEST, 1.5)).toBeGreaterThanOrEqual(0.02);
    expect(ambientRingPeakSlope(1, RIPPLE_KIND_PARAMS.ambient.lifetimeS + 0.01)).toBe(0);
  });
});

describe('mixHex', () => {
  it('blends sRGB hex and clamps t', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#2c6f79', '#f6c3d5', 0)).toBe('#2c6f79');
    expect(mixHex('#2c6f79', '#f6c3d5', 2)).toBe('#f6c3d5');
    expect(() => mixHex('red', '#000000', 0.5)).toThrow();
  });
});

describe('water disc mesh', () => {
  it('lies on the ellipse rim and faces up', () => {
    const { rings, segments } = waterTessellation(3);
    const disc = buildWaterDisc(SPEC.radii, rings, segments);
    expect(disc.positions.length).toBe((1 + rings * segments) * 3);
    const lastRing = 1 + (rings - 1) * segments;
    for (let i = 0; i < segments; i += 1) {
      const o = (lastRing + i) * 3;
      const u = disc.positions[o] / SPEC.radii[0];
      const v = disc.positions[o + 2] / SPEC.radii[1];
      expect(u * u + v * v).toBeCloseTo(1, 5);
    }
    const p = disc.positions;
    for (let t = 0; t < disc.indices.length; t += 3) {
      const [a, b, c] = [disc.indices[t] * 3, disc.indices[t + 1] * 3, disc.indices[t + 2] * 3];
      const e1x = p[b] - p[a];
      const e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a];
      const e2z = p[c + 2] - p[a + 2];
      // (e1 × e2).y
      expect(e1z * e2x - e1x * e2z).toBeGreaterThan(0);
    }
  });

  it('tessellation descends with the rung tier', () => {
    const counts = [0, 1, 2, 3].map((tier) => {
      const t = waterTessellation(tier);
      return t.rings * t.segments;
    });
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBeLessThan(counts[3]);
  });
});

describe('emitGlsl — CPU/GPU parity by construction', () => {
  const glsl = emitGlsl(SPEC);

  it('emits every wave band from the same spec numbers', () => {
    SPEC.waves.forEach((band, i) => {
      const k = (Math.PI * 2) / band.wavelengthM;
      expect(glsl).toContain(`const float WAVE${i}_AMP = ${glslFloat(band.amplitudeM)};`);
      expect(glsl).toContain(`const float WAVE${i}_K = ${glslFloat(k)};`);
      expect(glsl).toContain(`const float WAVE${i}_OMEGA = ${glslFloat(k * band.speed)};`);
      expect(glsl).toContain(`const float WAVE${i}_EXP = ${glslFloat(1 + 2 * band.steepness)};`);
      expect(glsl).toContain(`vec2(${glslFloat(Math.cos(band.dirRad))}, ${glslFloat(Math.sin(band.dirRad))})`);
    });
  });

  it('emits the body, the ripple kind table and the ambient table', () => {
    expect(glsl).toContain(`const vec2 WATER_RADII = vec2(${glslFloat(10)}, ${glslFloat(4.8)});`);
    expect(glsl).toContain(`const float WATER_SHORE_BAND_M = ${glslFloat(SPEC.shoreBandM)};`);
    expect(glsl).toContain(`#define WATER_RIPPLE_CAPACITY ${RIPPLE_CAPACITY}`);
    for (const kind of RIPPLE_KINDS) {
      expect(glsl).toContain(`life = ${glslFloat(RIPPLE_KIND_PARAMS[kind].lifetimeS)};`);
    }
    for (const entry of ambientTable(SPEC)) expect(glsl).toContain(glslFloat(entry.x));
    expect(glsl).toContain(`const float WATER_AMBIENT_PERIOD = ${glslFloat(ambientPeriod(SPEC))};`);
    expect(glsl).toContain('void waterField(');
  });

  it('never emits exponent-form or integer-only float literals', () => {
    expect(glslFloat(3)).toBe('3.000000');
    expect(glslFloat(-0)).toBe('0.000000');
    const constants = glsl.split(/\r?\n/).filter((line) => line.startsWith('const') || line.includes('return vec4('));
    for (const line of constants) expect(line).not.toMatch(/\d[eE][+-]?\d/);
    expect(() => glslFloat(Number.NaN)).toThrow();
  });
});

describe('water body/sky value contrast (W3 r2: the no-post read)', () => {
  const dayCore = FALLBACK_PALETTE;
  const nightCore = { ...FALLBACK_PALETTE, ground: '#0a0a12' };
  const cases = [
    ['sakura day', sakuraLakeColors({ ...dayCore, ...sakuraPaletteExtension(dayCore, false) }, false)],
    ['sakura night', sakuraLakeColors({ ...nightCore, ...sakuraPaletteExtension(nightCore, true) }, true)],
    ['mountain day', mountainTarnColors({ ...dayCore, ...mountainPaletteExtension(dayCore, false) }, false)],
    ['mountain night', mountainTarnColors({ ...nightCore, ...mountainPaletteExtension(nightCore, true) }, true)],
  ] as const;

  it.each(cases)('%s: the reflected horizon clears the body by the minimum linear-luminance gap', (_, colors) => {
    const horizon = linearLuminance(colors.skyHorizon);
    expect(horizon - linearLuminance(colors.absorb)).toBeGreaterThanOrEqual(WATER_MIN_HORIZON_DELTA - 1e-3);
    expect(horizon - linearLuminance(colors.shallow)).toBeGreaterThanOrEqual(WATER_MIN_SHALLOW_DELTA - 1e-3);
    // The bowl still runs light rim → dark centre.
    expect(linearLuminance(colors.shallow)).toBeGreaterThan(linearLuminance(colors.absorb));
    expect(linearLuminance(colors.absorb)).toBeGreaterThan(linearLuminance(colors.deep));
  });

  it('sakura r2 deepens the bowl: deep and absorb are ≥ 15 % darker than the palette mix', () => {
    const ext = sakuraPaletteExtension(dayCore, false);
    const [, day] = cases[0];
    expect(linearLuminance(day.deep)).toBeLessThan(linearLuminance(ext.lakeDeep) * 0.85);
    expect(linearLuminance(day.absorb)).toBeLessThan(
      linearLuminance(mixHex(ext.lakeDeep, ext.lakeShallow, 0.5)) * 0.85,
    );
  });

  it('withHorizonContrast lifts only as far as needed and never touches the body', () => {
    const flat = {
      deep: '#12333f', shallow: '#3d656f', absorb: '#284f57', foam: '#a3b2bb',
      shore: '#7d6f57', skyZenith: '#150e2e', skyHorizon: '#33233f',
    };
    const lifted = withHorizonContrast(flat, '#fdf6ff');
    expect(lifted.absorb).toBe(flat.absorb);
    expect(lifted.shallow).toBe(flat.shallow);
    const gap = linearLuminance(lifted.skyHorizon) - linearLuminance(flat.absorb);
    expect(gap).toBeGreaterThanOrEqual(WATER_MIN_HORIZON_DELTA - 1e-3);
    expect(gap).toBeLessThan(WATER_MIN_HORIZON_DELTA + 0.03);
    const already = { ...flat, skyHorizon: '#f6dfda' };
    expect(withHorizonContrast(already, '#ffffff')).toBe(already);
  });

  it('scaleHex and linearLuminance', () => {
    expect(scaleHex('#808080', 0.5)).toBe('#404040');
    expect(linearLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(linearLuminance('#000000')).toBe(0);
    expect(() => linearLuminance('red')).toThrow();
  });
});

describe('ripple pool debug readout (W3 r2)', () => {
  it('reports the last event and a windowed events/s rate', () => {
    const pool = createRipplePool(SPEC);
    expect(pool.last).toBeNull();
    pool.publish({ x: 0, z: -8.5, strength: 1, kind: 'step' }, 1);
    pool.publish({ x: 1, z: -8.5, strength: 1, kind: 'splash' }, 2);
    expect(pool.last?.kind).toBe('splash');
    expect(pool.last?.x).toBe(1);
    expect(pool.rate(2.5, 5)).toBeCloseTo(2 / 5, 5);
    expect(pool.rate(6.5, 5)).toBeCloseTo(1 / 5, 5);
    expect(pool.rate(20, 5)).toBe(0);
  });
});

describe('water fragment shader (W3 r2 wiring)', () => {
  const frag = WATER_FRAGMENT(emitGlsl(SPEC));
  it('carries the unconditional grazing ramp and the detail-1 macro layer', () => {
    expect(frag).toContain('float graze = 1.0 - smoothstep(0.15, 0.55, v.y);');
    expect(frag).toContain('uniform float uMacro;');
    expect(frag).toContain('if (uMacro > 0.5)');
  });
  it('has a normals debug view and a split ripple/base height view', () => {
    expect(frag).toContain('col = clamp(vec3(0.5 + 2.0 * n.x, n.y * 0.5 + 0.5, 0.5 + 2.0 * n.z), 0.0, 1.0);');
    expect(frag).toContain('float hr = h - hb;');
  });
  it('W3 r3: the normals view splits the ripple slope (×25) from the bands, pre-detail', () => {
    expect(frag).toContain('vec2 gField = g;');
    expect(frag.indexOf('vec2 gField = g;')).toBeLessThan(frag.indexOf('if (uCapillary > 0.5)'));
    expect(frag).toContain('vec2 gr = gField - gb * fade * troughE;');
    expect(frag).toContain('0.5 + gr.x * 25.0');
    expect(frag).toContain('0.5 + gr.y * 25.0');
  });
  it('W3 r3: debug colours are written before tone mapping, colour space and fog', () => {
    const debugAt = frag.indexOf('if (uDebug > 0.5)');
    const tonemapAt = frag.indexOf('#include <tonemapping_fragment>');
    const earlyReturn = frag.indexOf('return;', debugAt);
    expect(debugAt).toBeGreaterThan(0);
    expect(earlyReturn).toBeGreaterThan(debugAt);
    expect(earlyReturn).toBeLessThan(tonemapAt);
    expect(frag.slice(debugAt, earlyReturn)).toContain('gl_FragColor = vec4(col, 1.0);');
  });
  it('W3 r3: the wet rim blends toward a darker, desaturated wet-shore tint', () => {
    expect(frag).toContain('vec3 wetShore =');
    expect(frag).toContain('col = mix(col, wetShore,');
    expect(frag).not.toContain('col = mix(col, uShore,');
  });
});

/* ------------------------------------------------------------------ */
/* POKEMON-CORE SEAT D (C10, C11)                                       */
/* ------------------------------------------------------------------ */

describe('sampleInto (C10: the allocation-free resident sample)', () => {
  it('equals sampleWater (no ripples) field for field, on water, on the island and off the body', () => {
    const islanded: WaterBodySpec = { ...SPEC, islands: [{ x: 2.2, z: -9.2, r: 2.55 }] };
    const out = createWaterSampleOut();
    for (const spec of [SPEC, islanded]) {
      for (const t of [0, 1.37, 12.5, 400.25]) {
        for (let x = -11; x <= 11; x += 1.3) {
          for (let z = -14; z <= -3; z += 0.9) {
            const ref = sampleWater(spec, x, z, t);
            const got = sampleInto(spec, x, z, t, out);
            expect(got.height).toBe(ref.height);
            expect([got.nx, got.ny, got.nz]).toEqual([...ref.normal]);
            expect(got.crest).toBe(ref.crest);
            expect(got.shoreDistM).toBe(ref.shoreDistM);
            expect(got.depthM).toBe(ref.depthM);
          }
        }
      }
    }
  });
});

describe('ripple pool priority (C11)', () => {
  it('pins splash 3 > step 2 > petal = float 1 (ambient is analytic, never pooled)', () => {
    expect(RIPPLE_KIND_PRIORITY.splash).toBeGreaterThan(RIPPLE_KIND_PRIORITY.step);
    expect(RIPPLE_KIND_PRIORITY.step).toBeGreaterThan(RIPPLE_KIND_PRIORITY.float);
    expect(RIPPLE_KIND_PRIORITY.petal).toBe(RIPPLE_KIND_PRIORITY.float);
  });

  for (const cap of [16, 8, 4]) {
    it(`a splash survives its whole life in the pack under wake spam at cap ${cap}`, () => {
      const pool = createRipplePool(SPEC);
      const out = new Float32Array(RIPPLE_CAPACITY * 4);
      const t0 = 5;
      pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 1, kind: 'splash' }, t0);
      let k = 0;
      for (let t = t0 + 0.02; t < t0 + RIPPLE_KIND_PARAMS.splash.lifetimeS - 1e-3; t += 0.02) {
        // Wake spam: a float every 20 ms from all over the body (no limiter here: the pool alone must hold).
        pool.publish({ x: CENTER_X + ((k * 1.7) % 8) - 4, z: CENTER_Z + ((k * 0.9) % 3) - 1.5, strength: 0.8, kind: 'float' }, t);
        k += 1;
        const n = pool.pack(t, cap, out);
        const kinds = Array.from({ length: n }, (_, i) => unpackRippleW(out[i * 4 + 3]).kind);
        expect(kinds, `t=${t.toFixed(2)}`).toContain('splash');
      }
      expect(pool.evictions.liveEvicted.splash).toBe(0);
      expect(pool.evictions.liveEvicted.float).toBeGreaterThan(0);
    });
  }

  it('drops a newcomer that every live event outranks, and counts it', () => {
    const pool = createRipplePool(SPEC, 4);
    for (let i = 0; i < 4; i += 1) pool.publish({ x: CENTER_X + i * 0.2, z: CENTER_Z, strength: 1, kind: 'splash' }, 1 + i * 0.01);
    expect(pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 1, kind: 'float' }, 1.1)).toBeNull();
    expect(pool.evictions.dropped).toBe(1);
    // A splash still evicts the oldest splash (equal priority).
    const id = pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 1, kind: 'splash' }, 1.2);
    expect(id).not.toBeNull();
    expect(pool.active(1.2).map((e) => e.id)).toEqual([id, 3, 2, 1]);
  });

  it('uses a dead slot before evicting a live one', () => {
    const pool = createRipplePool(SPEC, 2);
    pool.publish({ x: CENTER_X, z: CENTER_Z, strength: 1, kind: 'petal' }, 0); // dies at 1.2
    pool.publish({ x: CENTER_X + 1, z: CENTER_Z, strength: 1, kind: 'step' }, 0.5); // lives to 2.7
    pool.publish({ x: CENTER_X + 2, z: CENTER_Z, strength: 1, kind: 'float' }, 1.5);
    expect(pool.active(1.5).map((e) => e.kind)).toEqual(['float', 'step']);
    expect(pool.evictions.liveEvicted.step).toBe(0);
  });

  it('with every kind at one priority, pack is exactly the newest-first pack (the pre-C11 order)', () => {
    const equal: Record<RippleKind, number> = { step: 1, float: 1, splash: 1, petal: 1, ambient: 1 };
    const pool = createRipplePool(SPEC, RIPPLE_CAPACITY, { priority: equal });
    const kinds: RippleKind[] = ['step', 'float', 'splash', 'petal'];
    const got = new Float32Array(RIPPLE_CAPACITY * 4);
    const ref = new Float32Array(RIPPLE_CAPACITY * 4);
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    let t = 0;
    for (let i = 0; i < 400; i += 1) {
      t += rand() * 0.3;
      pool.publish({ x: CENTER_X + rand() * 6 - 3, z: CENTER_Z + rand() * 2 - 1, strength: 0.2 + rand() * 0.8, kind: kinds[i % 4] }, t);
      for (const cap of [16, 12, 8, 4, 0]) {
        const n = pool.pack(t, cap, got);
        // The reference: the live events, newest first, the first `cap` of them.
        const live = pool.active(t).slice(0, cap);
        ref.fill(0);
        live.forEach((event, j) => {
          ref[j * 4] = event.x;
          ref[j * 4 + 1] = event.z;
          ref[j * 4 + 2] = event.spawnTime;
          ref[j * 4 + 3] = packRippleW(event.strength, event.kind);
        });
        expect(n).toBe(live.length);
        expect(Array.from(got)).toEqual(Array.from(ref));
      }
    }
  });

  it('under the cap the default pack is the newest-first pack; over it, the top by priority (the named K10 change)', () => {
    const pool = createRipplePool(SPEC);
    const out = new Float32Array(RIPPLE_CAPACITY * 4);
    const kinds: RippleKind[] = ['float', 'splash', 'step', 'petal', 'float'];
    kinds.forEach((kind, i) => pool.publish({ x: CENTER_X + i * 0.3, z: CENTER_Z, strength: 0.5, kind }, 1 + i * 0.05));
    expect(pool.pack(1.3, 16, out)).toBe(5);
    expect(Array.from({ length: 5 }, (_, i) => unpackRippleW(out[i * 4 + 3]).kind)).toEqual(['float', 'petal', 'step', 'splash', 'float']);
    expect(pool.pack(1.3, 2, out)).toBe(2);
    expect([unpackRippleW(out[3]).kind, unpackRippleW(out[7]).kind]).toEqual(['step', 'splash']);
    expect(pool.selected(1.3, 2).map((e) => e.kind)).toEqual(['step', 'splash']);
  });
});

describe('wake limiter (C11)', () => {
  it('4 floaters over 60 s: at most 4 wakes in any second per body, at most 1 per 1.2 s per floater', () => {
    const limiter = createWakeLimiter();
    const accepted: { id: string; t: number }[] = [];
    const ids = ['f0', 'f1', 'f2', 'f3'];
    // Every floater asks every 30 fps frame (far above the 1.2 s drift cadence): the limiter alone holds.
    for (let frame = 0; frame < 60 * 30; frame += 1) {
      const t = frame / 30;
      for (const id of ids) if (limiter.tryWake(id, t, 16)) accepted.push({ id, t });
    }
    for (const id of ids) {
      const times = accepted.filter((a) => a.id === id).map((a) => a.t);
      expect(times.length).toBeGreaterThan(20);
      for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(WAKE_MIN_INTERVAL_S - 1e-9);
    }
    for (let i = 0; i < accepted.length; i += 1) {
      const inSecond = accepted.filter((a) => a.t >= accepted[i].t && a.t < accepted[i].t + 1).length;
      expect(inSecond).toBeLessThanOrEqual(4);
    }
    expect(limiter.stats.maxPerSecond).toBeLessThanOrEqual(4);
    expect(limiter.stats.accepted).toBe(accepted.length);
  });

  it('refills at min(4, cap / float lifetime): 2.5 per second at cap 4, none at cap 0', () => {
    expect(wakeRefillRate(16)).toBe(4);
    expect(wakeRefillRate(4)).toBeCloseTo(2.5, 9);
    expect(wakeRefillRate(0)).toBe(0);
    const limiter = createWakeLimiter();
    let n = 0;
    // 40 sources, each asking once per frame: only the bucket limits.
    for (let frame = 0; frame < 20 * 60; frame += 1) {
      for (let s = 0; s < 40; s += 1) if (limiter.tryWake(`s${s}`, frame / 60, 4)) n += 1;
    }
    // 4 in the bucket, then at most 2.5 per second for 20 s.
    expect(n).toBeLessThanOrEqual(4 + 2.5 * 20 + 1);
    expect(n).toBeGreaterThan(2.5 * 20 - 2);
    const none = createWakeLimiter();
    let m = 0;
    for (let frame = 0; frame < 600; frame += 1) if (none.tryWake(`s${frame}`, frame / 60, 0)) m += 1;
    expect(m).toBe(4);
  });

  it('a rewound water clock (a pin, a D32 rebuild) resets it', () => {
    const limiter = createWakeLimiter();
    expect(limiter.tryWake('a', 10, 16)).toBe(true);
    expect(limiter.tryWake('a', 10.5, 16)).toBe(false);
    expect(limiter.tryWake('a', 0, 16)).toBe(true);
  });

  it('check spends nothing: a wake the pool rejects costs no token, no interval and no accepted count', () => {
    const limiter = createWakeLimiter();
    // Ten refused publishes (check true, never committed) in the same instant.
    for (let i = 0; i < 10; i += 1) expect(limiter.check('a', 5, 16)).toBe(true);
    expect(limiter.stats.accepted).toBe(0);
    expect(limiter.stats.maxPerSecond).toBe(0);
    // The source's interval was never started, and the bucket is still full.
    expect(limiter.check('a', 5.1, 16)).toBe(true);
    limiter.commit('a', 5.1);
    expect(limiter.stats.accepted).toBe(1);
    // Now the interval holds and a refusal is counted once.
    expect(limiter.check('a', 5.5, 16)).toBe(false);
    expect(limiter.stats.droppedInterval).toBe(1);
    // (Times run forward: a check earlier than the last one is a rewind, which resets the limiter.)
    for (const id of ['b', 'c', 'd']) {
      expect(limiter.check(id, 5.6, 16)).toBe(true);
      limiter.commit(id, 5.6);
    }
    // The per-second ceiling: the fifth wake inside 1 s is refused.
    expect(limiter.check('e', 5.7, 16)).toBe(false);
    expect(limiter.stats.accepted).toBe(4);
    expect(limiter.stats.maxPerSecond).toBe(4);
  });
});

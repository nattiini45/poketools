/**
 * Painted sky + the shared paint-fx material (LOOK-PLAN §2 SEAT K).
 *
 * Two sources live here:
 *
 * 1. **The painted sky dome** (`createSkyMaterial`): created ONCE per mount.
 *    Night, palette, post and the cloud tap count are uniform writes
 *    (`writeSkyUniforms`), `toneMapped` is fixed (the scene always renders
 *    into the composer target, where three resolves tone mapping to none
 *    either way), so a palette toggle or a governor rung step never relinks
 *    the sky. The night branch is the pre-pilot shader VERBATIM; the day
 *    branch is the painted P1 recipe (3-stop gradient, haze, sun / anti-sun
 *    lobes, banded self-shadowed cumulus with a silver lining, cirrus), with
 *    cloud contrast × mix(1, 0.15, calm) behind the padded face rects.
 *
 * 2. **paint-fx** (`createPaintFxMaterial`): ONE ShaderMaterial source for
 *    the skyline ring (`kind: 'skyline'`, alpha-cut, normal blend) and the
 *    rules sun shafts (`kind: 'shaft'`, additive). Same vertex / fragment
 *    source, same flags (instanced, double-sided, fog off, tone map off,
 *    transparent), `uKind` switches the branch — so the skyline and the
 *    shafts share ONE program (+1 over the pre-pilot plaza, LOOK-PLAN §3).
 *    Both MUST render through an `InstancedMesh` (the skyline uses one
 *    identity instance) — a plain Mesh would compile a second program
 *    without `USE_INSTANCING` — on a geometry with no `normal` attribute
 *    (`PAINT_FX_ATTRIBUTES`; three keys programs on `vertexNormals`).
 *
 * The calm rects are SEAT L's shared `PAINT_UNIFORMS.uCalm*`, bound by
 * reference, read through `CALM_GLSL`'s `calmAt(gl_FragCoord.xy)`.
 */

import * as THREE from 'three';
import { CALM_GLSL, PAINT_UNIFORMS } from '@/components/world/route/paint/paint-uniforms';
import type { Vec3Tuple } from '@/lib/route-world/focus';
import type {
  NightSkyPreset,
  PaintedSkyDayColors,
  PaintedSkyGrade,
  PaintedSkyPreset,
  PaintedSkyShape,
  SkylineSpec,
} from '@/lib/route-world/theme-types';
import {
  SKYLINE_BANDS,
  SKYLINE_SEAMS,
  buildSkylineRing,
  SKYLINE_CALM_DELTA_L,
  SKYLINE_INK,
  SKYLINE_RIM,
  SKYLINE_RIM_PROBE_TEXELS,
  SKYLINE_WINDOW,
  type SkylineBand,
  type SkylineBandId,
} from '@/lib/route-world/skyline';
import { PLAZA_SKYLINE_ATLAS, PLAZA_SKYLINE_FILE, skylineLayerHeight } from '@/lib/route-world/world-env';

export type { NightSkyPreset, PaintedSkyDayColors, PaintedSkyGrade, PaintedSkyPreset, PaintedSkyShape, SkylineSpec };

// ── Painted day constants (LOOK-PLAN §1.3 / §2 K.1, sRGB hex) ───────────────

export const PAINTED_SKY_DAY = {
  horizon: '#f2d7ae',
  // LOOK r6 (L5, "the sky gap is a pale void"): a deeper zenith and mid.
  mid: '#9cc0e4',
  zenith: '#4a8fd0',
  /** Sun-side low lobe (pow 1.6). */
  peach: '#ffc890',
  /** Anti-sun low lobe (pow 1.6, 0.18). */
  lilac: '#c7c3e0',
  /** LOOK r6: blue-violet bellies (the cumulus mass reads as a body). */
  cloudBelly: '#8790c8',
  cloudMid: '#e6dce8',
  cloudLit: '#fff3de',
  silver: '#fff0c8',
  /** LOOK r6: the sun-side silver lining turns GOLD — hue only, at the silver's luminance. */
  gold: '#ffc27a',
} as const;

/**
 * LOOK r6 (L5): cumulus coverage leans toward the sun's azimuth and the low
 * band, so the contre-jour gap (rules) holds a cumulus MASS instead of a
 * pale void; the horizon haze inside the gap is 30 % lighter-handed.
 */
// (The brief's sun term was 0.18; at 0.18 the cumulus filled the whole rules
// gap in pale cloud and hid the gap beams — 0.1 keeps a mass, not a lid.)
export const SKY_COVER_BIAS = { sun: 0.1, low: 0.12 } as const;
export const SKY_DAY_HAZE = 0.18;

/** Elevation of the mid stop (LOOK-PLAN §1.3 pulse: mid `#a8c8e6` at elevation 0.10). */
export const SKY_MID_ELEVATION = 0.1;

/** `smoothstep(-0.02, 0.30, e)` — the day zenith ramp. */
export function dayZenithRamp(elev: number): number {
  const x = Math.min(Math.max((elev + 0.02) / 0.32, 0), 1);
  return x * x * (3 - 2 * x);
}

/** Cloud contrast kept inside a calm rect (LOOK-PLAN §0: ≤ 15 %). */
export const CALM_CLOUD_CONTRAST = 0.15;

/**
 * AgX compensation (`uSat` / `uGain`). The post stack's AgX pulls saturated
 * mid-tones toward grey, so the authored sky is pre-saturated and lifted.
 * Post-off rungs (2–4) draw through the renderer's ACES again (LOOK r2,
 * PostStack), where the shipped sky took no compensation: identity there.
 */
/**
 * LOOK r4 (CLARITY: "the painted cumulus and the TV-tower disc highlight
 * behind the schedule board now set outsideP995"): the graded day sky is
 * soft-kneed in linear luminance — above `knee` it compresses toward `peak`
 * — so a lit cumulus never outshines the boards' and plaques' P99.
 */
// LOOK r5: a touch more luminous (0.72 → 0.78) — the brighter, more inviting frame; C-044 re-checked.
export const SKY_DAY_LUMA_CAP = { knee: 0.5, peak: 0.78 } as const;

/**
 * LOOK r4: the day sky's crepuscular fan around the sun (count of rays, falloff pow, strength).
 * LOOK r5 (rules hero: "one shaft at the frame edge"): fewer, broader, higher-contrast rays
 * over a lighter wash, so distinct golden beams cross the sky gap above the gate.
 */
// LOOK r6 (L4a/L5): the pale peach WASH toward the sun is what flattened the
// rules gap (L ≈ 0.75) and crushed the gap beams under AgX — the fan keeps
// its rays over a deeper sky, with a light wash only.
// (r6 capture i9: 21 rays with a wider lit sector washed the rules gap pale — back to 9.)
export const SKY_RAYS = { count: 9, falloff: 1.0, strength: 0.5, wash: 0.08, gain: 1.08, shadow: 0.55 } as const;

/**
 * LOOK r6 (L4a): the crepuscular fan's DARK sectors — between the lit rays
 * the sky deepens toward this cool multiplier (× `SKY_RAYS.shadow` × reach),
 * so the rays read as light AND shadow (the painter's alternation) and the
 * gap beams have contrast behind them; never brighter than the clear sky.
 */
export const SKY_SHADOW_RAY = [0.72, 0.8, 0.94] as const;

/**
 * LOOK r6 (L5, "a cumulus mass that has a gold silver lining"): cumulus seen
 * AGAINST the sun is backlit — its thick body falls toward the blue-violet
 * belly (× `body` at full contre-jour), so the mass reads dark with a lit
 * gold rim, and the gap beams have a mid-value backdrop.
 */
export const SKY_CONTRE_JOUR_CLOUD = { body: 0.35, mu: [0.3, 0.8] as const } as const;

export const SKY_GRADE = {
  day: { gain: 1.22, sat: 1.35 },
  night: { gain: 1.15, sat: 1.35 },
  postOff: { gain: 1, sat: 1 },
} as const;

/** Cirrus streak opacity (the plaza's literal). */
export const SKY_CIRRUS = { opacity: 0.18 } as const;

/**
 * The plaza's painted sky as a preset (ROLLOUT §2.2 d): every value above,
 * moved into one record and not changed. `buildSkyFragment(PLAZA_SKY_PRESET)`
 * is byte-identical to the pilot's sky source (the r6 snapshot test), and the
 * exports above stay as aliases of its fields for the tests of record.
 */
export const PLAZA_SKY_PRESET: PaintedSkyPreset = {
  id: 'plaza',
  day: PAINTED_SKY_DAY,
  shape: {
    coverLo: 0.44,
    coverHi: 0.6,
    coverBias: SKY_COVER_BIAS,
    haze: SKY_DAY_HAZE,
    midElevation: SKY_MID_ELEVATION,
    calmCloudContrast: CALM_CLOUD_CONTRAST,
    lumaCap: SKY_DAY_LUMA_CAP,
    rays: SKY_RAYS,
    shadowRay: SKY_SHADOW_RAY,
    contreJourCloud: SKY_CONTRE_JOUR_CLOUD,
    cirrus: SKY_CIRRUS,
  },
  grade: SKY_GRADE,
  night: { variant: 'plaza' },
};

/**
 * Whether the sky dome is tone-mapped: day yes, night no — the shipped
 * `toneMapped: !night`. Only the post-off (renderer ACES, to-screen) path
 * reads it; inside the composer target three resolves every material to
 * NoToneMapping, so rung 0–1 programs are unaffected.
 */
export function skyToneMapped(night: boolean): boolean {
  return !night;
}

// ── Shared sky uniforms ─────────────────────────────────────────────────────

export interface SkyUniforms {
  /** Palette zenith / horizon (the night branch's tokens, verbatim). */
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uGlow: { value: THREE.Color };
  uSunPos: { value: THREE.Vector3 };
  uNight: { value: number };
  uGain: { value: number };
  uSat: { value: number };
  uDayHorizon: { value: THREE.Color };
  uDayMid: { value: THREE.Color };
  uDayZenith: { value: THREE.Color };
  uPeach: { value: THREE.Color };
  uLilac: { value: THREE.Color };
  uCloudBelly: { value: THREE.Color };
  uCloudMid: { value: THREE.Color };
  uCloudLit: { value: THREE.Color };
  uSilver: { value: THREE.Color };
  /** LOOK r6: the sun-side gold of the silver lining (hue only). */
  uSkyGold: { value: THREE.Color };
  /** Self-shadow taps (`quality.cloudTaps`), a dynamic loop bound — never a define. */
  uCloudTaps: { value: number };
  /** The starfield night preset's dusk band colour (declared only by a starfield sky program). */
  uNightBand: { value: THREE.Color };
  [uniform: string]: THREE.IUniform;
}

export function createSkyUniforms(): SkyUniforms {
  return {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSunPos: { value: new THREE.Vector3() },
    uNight: { value: 0 },
    uGain: { value: SKY_GRADE.day.gain },
    uSat: { value: SKY_GRADE.day.sat },
    uDayHorizon: { value: new THREE.Color(PAINTED_SKY_DAY.horizon) },
    uDayMid: { value: new THREE.Color(PAINTED_SKY_DAY.mid) },
    uDayZenith: { value: new THREE.Color(PAINTED_SKY_DAY.zenith) },
    uPeach: { value: new THREE.Color(PAINTED_SKY_DAY.peach) },
    uLilac: { value: new THREE.Color(PAINTED_SKY_DAY.lilac) },
    uCloudBelly: { value: new THREE.Color(PAINTED_SKY_DAY.cloudBelly) },
    uCloudMid: { value: new THREE.Color(PAINTED_SKY_DAY.cloudMid) },
    uCloudLit: { value: new THREE.Color(PAINTED_SKY_DAY.cloudLit) },
    uSilver: { value: new THREE.Color(PAINTED_SKY_DAY.silver) },
    uSkyGold: { value: new THREE.Color(PAINTED_SKY_DAY.gold) },
    uCloudTaps: { value: 2 },
    uNightBand: { value: new THREE.Color(0, 0, 0) },
  };
}

/**
 * The one sky uniform set the dome and every paint-fx material bind (the
 * skyline mixes toward the SAME clear sky the dome paints behind it).
 */
export const SKY_UNIFORMS: SkyUniforms = createSkyUniforms();

export interface SkyState {
  night: boolean;
  /** Palette sky tokens (sRGB hex). */
  sky: string;
  skyHorizon: string;
  sunColor: string;
  moonColor: string;
  skyBodyPosition: Vec3Tuple;
  cloudTaps: number;
  /** Whether the rung carries post (AgX composer); default true. */
  post?: boolean;
}

/** A preset's day colours into the uniforms (value writes). */
export function writeSkyDayColors(day: PaintedSkyDayColors, uniforms: SkyUniforms = SKY_UNIFORMS): void {
  uniforms.uDayHorizon.value.set(day.horizon);
  uniforms.uDayMid.value.set(day.mid);
  uniforms.uDayZenith.value.set(day.zenith);
  uniforms.uPeach.value.set(day.peach);
  uniforms.uLilac.value.set(day.lilac);
  uniforms.uCloudBelly.value.set(day.cloudBelly);
  uniforms.uCloudMid.value.set(day.cloudMid);
  uniforms.uCloudLit.value.set(day.cloudLit);
  uniforms.uSilver.value.set(day.silver);
  uniforms.uSkyGold.value.set(day.gold);
}

/**
 * Value writes only — never a program change. Idempotent. Writes EVERY field
 * the preset owns on every call (ROLLOUT §6: no "initial value" reliance), so
 * the plaza writes exactly the values it was created with. A starfield night
 * takes its zenith / horizon / band from the preset instead of the palette.
 */
export function writeSkyUniforms(
  state: SkyState,
  uniforms: SkyUniforms = SKY_UNIFORMS,
  preset: PaintedSkyPreset = PLAZA_SKY_PRESET,
): void {
  const starfield = state.night && preset.night.variant === 'starfield' ? preset.night : null;
  uniforms.uZenith.value.set(starfield ? starfield.zenith : state.sky);
  uniforms.uHorizon.value.set(starfield ? starfield.horizon : state.skyHorizon);
  uniforms.uGlow.value.set(state.night ? state.moonColor : state.sunColor);
  uniforms.uSunPos.value.set(state.skyBodyPosition[0], state.skyBodyPosition[1], state.skyBodyPosition[2]);
  uniforms.uNight.value = state.night ? 1 : 0;
  const grade = state.post === false ? preset.grade.postOff : state.night ? preset.grade.night : preset.grade.day;
  uniforms.uGain.value = grade.gain;
  uniforms.uSat.value = grade.sat;
  uniforms.uCloudTaps.value = Math.max(0, Math.min(4, Math.round(state.cloudTaps)));
  writeSkyDayColors(preset.day, uniforms);
  const band = preset.night.variant === 'starfield' ? preset.night.band : undefined;
  if (band) uniforms.uNightBand.value.set(band.color);
  else uniforms.uNightBand.value.setRGB(0, 0, 0);
}

type CopyableValue = { copy: (source: never) => unknown };

/**
 * Hand the shared sky uniforms back at `createSkyUniforms()` values IN PLACE
 * (ROLLOUT §2.2 b, the unmount reset: the day colours return to the plaza
 * preset), keeping every `{ value }` object's identity for bound programs.
 */
export function resetSkyUniforms(uniforms: SkyUniforms = SKY_UNIFORMS): void {
  const fresh = createSkyUniforms();
  for (const name of Object.keys(fresh)) {
    const target = uniforms[name];
    const source = fresh[name].value as unknown;
    if (!target) continue;
    if (source !== null && typeof source === 'object' && typeof (target.value as CopyableValue)?.copy === 'function') {
      (target.value as CopyableValue).copy(source as never);
    } else {
      target.value = source;
    }
  }
}

// ── GLSL ────────────────────────────────────────────────────────────────────

const SKY_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunPos;
  uniform float uNight;
  uniform float uGain;
  uniform float uSat;
  uniform vec3 uDayHorizon;
  uniform vec3 uDayMid;
  uniform vec3 uDayZenith;
  uniform vec3 uPeach;
  uniform vec3 uLilac;
`;

/**
 * The painted day CLEAR sky (no clouds): the value the calm rects hold the
 * sky to, and what the skyline recedes toward. Needs SKY_UNIFORMS_GLSL. The
 * mid stop and the haze are the preset's shape literals.
 */
function skyDayClearGlsl(shape: PaintedSkyShape): string {
  const midT = dayZenithRamp(shape.midElevation);
  return /* glsl */ `
  vec3 skyDayClear(vec3 dir) {
    float elev = dir.y;
    float t = smoothstep(-0.02, 0.30, elev);
    const float MID_T = ${midT.toFixed(6)};
    vec3 col = t < MID_T
      ? mix(uDayHorizon, uDayMid, t / MID_T)
      : mix(uDayMid, uDayZenith, (t - MID_T) / (1.0 - MID_T));
    float haze = exp(-max(elev, 0.0) * 5.0);
    col = mix(col, uDayHorizon, haze * ${shape.haze.toFixed(3)});

    vec3 sunDir = normalize(uSunPos - cameraPosition);
    float mu = max(dot(dir, sunDir), 0.0);
    col += uGlow * (pow(mu, 36.0) * 0.16 + pow(mu, 140.0) * 0.28);
    col += uGlow * pow(mu, 6.0) * 0.14;

    // Low azimuth lobes: peach toward the sun, lilac away from it, so the two
    // board stations differ in sky temperature (pulse warm, schedule cool).
    vec2 sunAz = normalize(sunDir.xz);
    float azLen = length(dir.xz);
    if (azLen > 1e-4) {
      vec2 dirAz = dir.xz / azLen;
      float low = 1.0 - smoothstep(0.02, 0.34, elev);
      float toward = dot(dirAz, sunAz);
      col = mix(col, uPeach, pow(max(toward, 0.0), 1.6) * low * 0.42);
      col = mix(col, uLilac, pow(max(-toward, 0.0), 1.6) * low * 0.18);
    }
    return col;
  }

  /** The night CLEAR sky: the verbatim night gradient, haze and corona (no clouds, no stars). */
  vec3 skyNightClear(vec3 dir) {
    float elev = dir.y;
    float zenithMix = smoothstep(0.12, 0.52, elev);
    vec3 col = mix(uHorizon, uZenith, zenithMix);
    float haze = exp(-max(elev, 0.0) * 3.6);
    col = mix(col, uHorizon, haze * 0.28);
    vec3 sunDir = normalize(uSunPos - cameraPosition);
    float mu = max(dot(dir, sunDir), 0.0);
    col += mix(uHorizon, uGlow, 0.18) * pow(mu, 42.0) * 0.12;
    return col;
  }

  vec3 skyClear(vec3 dir) {
    return uNight > 0.5 ? skyNightClear(dir) : skyDayClear(dir);
  }

  /** AgX compensation (see SKY_GRADE). */
  vec3 skyGrade(vec3 col) {
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(lum), col, uSat) * uGain;
  }
`;
}

/** The plaza's clear-sky GLSL — what every paint-fx program (skyline, shafts) recedes toward. */
const SKY_DAY_CLEAR_GLSL = skyDayClearGlsl(PLAZA_SKY_PRESET.shape);

const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }

  float hash12(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
`;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** The pre-pilot night branch, verbatim (the `plaza` night preset). */
const PLAZA_NIGHT_GLSL = `      // ── NIGHT: the pre-pilot shader, verbatim ─────────────────────────────
      // Pulse-768 sky is elev ~0.32–0.44. Night saturating at 0.16 made σ=0.
      // Top of that band stays near the (7,4,51) anchor; lower band still hazes.
      float zenithMix = smoothstep(
        mix(-0.18, 0.12, uNight),
        mix(0.42, 0.52, uNight),
        elev
      );
      col = mix(uHorizon, uZenith, zenithMix);
      float haze = exp(-max(elev, 0.0) * mix(3.2, 3.6, uNight));
      col = mix(col, uHorizon, haze * mix(0.42, 0.28, uNight));

      vec3 sunDir = normalize(uSunPos - cameraPosition);
      float mu = max(dot(dir, sunDir), 0.0);
      float mie = pow(mu, 36.0);
      float disc = pow(mu, 140.0);
      col += uGlow * (mie * 0.16 + disc * 0.28) * (1.0 - uNight);

      vec2 sunAz = normalize(sunDir.xz);
      vec2 dirAz = dir.xz;
      float azLen = length(dirAz);
      float lobe = azLen > 1e-4
        ? pow(max(dot(dirAz / azLen, sunAz), 0.0), 2.5)
          * (1.0 - smoothstep(0.02, 0.34, elev))
          * (1.0 - uNight)
        : 0.0;
      col = mix(col, mix(uHorizon, uGlow, 0.42), lobe * 0.3);

      // Tight night corona only — wide pow() washed the whole band to mid-slate.
      float corona = pow(mu, 42.0);
      col += mix(uHorizon, uGlow, 0.18) * corona * 0.12 * uNight;

      if (elev > 0.02) {
        vec2 cloudUv = dir.xz / (elev + 0.18) * 0.55 + vec2(3.1, 7.4);
        float field = fbm(cloudUv);
        float cover = smoothstep(0.46, 0.78, field);
        float thick = smoothstep(0.52, 0.92, field);
        float fade = smoothstep(0.02, 0.22, elev);
        vec3 dayCloud = mix(vec3(0.86, 0.90, 0.96), vec3(1.0, 0.99, 0.97), thick);
        dayCloud -= vec3(0.10, 0.08, 0.05) * (1.0 - thick) * cover;
        vec3 nightCloud = mix(uZenith, uHorizon, 0.5) * 1.35;
        vec3 cloud = mix(dayCloud, nightCloud, uNight);
        float amount = cover * fade * mix(0.92, 0.26, uNight);
        col = mix(col, cloud, amount);
      }

      // Point stars: one jittered disc per azimuth/elevation cell, ~1.5 px at
      // 1440, instead of lighting whole 3D hash cells (which read as squares).
      vec2 suv = vec2(atan(dir.z, dir.x) * 28.0, dir.y * 60.0);
      vec2 cell = floor(suv);
      vec2 jitter = vec2(hash13(vec3(cell, 1.0)), hash13(vec3(cell, 2.0))) - 0.5;
      float seed = hash13(vec3(cell, 3.0));
      float d = length(fract(suv) - 0.5 - jitter * 0.6);
      float stars = step(0.93, seed) * (1.0 - smoothstep(0.0, 0.09 + 0.07 * seed, d))
        * smoothstep(0.18, 0.62, elev) * uNight;
      col += vec3(0.72, 0.78, 0.92) * stars * (0.12 + 0.22 * seed);
      col += (hash13(dir * 220.0) - 0.5) * mix(0.006, 0.012, uNight);
`;

/** The starfield dusk band's uniform declaration (a starfield sky with a band only). */
const NIGHT_BAND_PARS = `  uniform vec3 uNightBand;
`;

/** A GLSL float literal (always with a decimal point). */
function glslFloat(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : '0.0';
}

/**
 * The shared STARFIELD night (ROLLOUT §1: sakura's plum sky, mountain's round
 * stars, clouds' teal dusk): a zenith → horizon gradient (uniforms, written
 * from the preset), an optional dusk band (`uNightBand`), a soft Milky Way
 * band, ROUND stars — one jittered disc per cell, cells `cellDeg` square in
 * angle, the azimuth distance scaled by cos(elevation) so a star never
 * stretches into a dash — a small moon disc with a corona at the sky body,
 * and a bounded hash grain. Every shape value is a GLSL literal.
 */
function starfieldNightGlsl(night: Extract<NightSkyPreset, { variant: 'starfield' }>): string {
  const cell = (Math.max(0.05, night.stars.cellDeg) * Math.PI) / 180;
  const size = (Math.max(0.001, night.stars.size) * Math.PI) / 180;
  const band = night.band
    ? `      float nbD = (elev - ${glslFloat(night.band.elevation)}) / ${glslFloat(Math.max(1e-3, night.band.width))};
      col = mix(col, uNightBand, exp(-nbD * nbD) * ${glslFloat(night.band.strength)});
`
    : '';
  return `      // ── NIGHT: the shared starfield preset (ROLLOUT §2.2 d) ────────────────
      col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.55, elev));
${band}      vec3 moonDir = normalize(uSunPos - cameraPosition);
      float moonAng = acos(clamp(dot(dir, moonDir), -1.0, 1.0));
      col += uGlow * exp(-moonAng / ${glslFloat(Math.max(1e-3, night.moon.corona.radius))}) * ${glslFloat(night.moon.corona.strength)};
      vec3 mwN = normalize(vec3(${glslFloat(Math.sin(night.milkyWay.tilt))}, ${glslFloat(Math.cos(night.milkyWay.tilt))}, 0.0));
      float mwD = dot(dir, mwN);
      float mw = exp(-mwD * mwD / 0.03) * (0.6 + 0.4 * vnoise(vec2(atan(dir.z, dir.x) * 5.0, mwD * 18.0)))
        * smoothstep(0.02, 0.3, elev);
      col += mix(uHorizon, vec3(0.85, 0.88, 1.0), 0.5) * mw * ${glslFloat(night.milkyWay.strength)};
      float starEl = asin(clamp(elev, -1.0, 1.0));
      vec2 starUv = vec2(atan(dir.z, dir.x), starEl) / ${glslFloat(cell)};
      vec2 starCell = floor(starUv);
      vec2 starJitter = vec2(hash13(vec3(starCell, 1.0)), hash13(vec3(starCell, 2.0))) - 0.5;
      float starSeed = hash13(vec3(starCell, 3.0));
      vec2 starD = (fract(starUv) - 0.5 - starJitter * 0.6) * ${glslFloat(cell)};
      starD.x *= cos(starEl);
      float starR = ${glslFloat(size)} * (0.6 + 0.4 * starSeed);
      float star = step(${glslFloat(1 - Math.min(1, Math.max(0, night.stars.density)))}, starSeed)
        * (1.0 - smoothstep(starR * 0.35, starR, length(starD))) * smoothstep(0.05, 0.35, elev);
      col += vec3(0.78, 0.84, 1.0) * star * (0.35 + 0.65 * starSeed) * ${glslFloat(night.stars.brightness)};
      col = mix(col, uGlow, 1.0 - smoothstep(${glslFloat(night.moon.disc * 0.8)}, ${glslFloat(Math.max(1e-4, night.moon.disc))}, moonAng));
      col += (hash13(dir * 220.0) - 0.5) * ${glslFloat(Math.max(0, night.grain))};
`;
}

/**
 * The painted sky's fragment source for a preset (ROLLOUT §2.2 d). Shape and
 * night literals are TEMPLATED here as GLSL literals; colours are uniforms.
 * `buildSkyFragment(PLAZA_SKY_PRESET)` is byte-identical to the pilot's sky
 * (the r6 snapshot). A world with its own preset links its own sky program,
 * replacing its old sky — 0 net programs, one world mounted at a time.
 */
export function buildSkyFragment(preset: PaintedSkyPreset): string {
  const shape = preset.shape;
  const nightBranch = preset.night.variant === 'starfield' ? starfieldNightGlsl(preset.night) : PLAZA_NIGHT_GLSL;
  const nightPars = preset.night.variant === 'starfield' && preset.night.band ? NIGHT_BAND_PARS : '';
  return /* glsl */ `
  ${SKY_UNIFORMS_GLSL}
  uniform vec3 uCloudBelly;
  uniform vec3 uCloudMid;
  uniform vec3 uCloudLit;
  uniform vec3 uSilver;
  uniform vec3 uSkyGold;
  uniform float uCloudTaps;
${nightPars}  varying vec3 vWorldPos;
  ${CALM_GLSL}
  ${NOISE_GLSL}

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      v += amp * vnoise(p);
      p = rot * p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }

  // Day cumulus variant (C-038): octave-1 damped (0.3 vs 0.5) so the field's
  // per-slice mean drifts less across the frozen station bands — absolute
  // cover thresholds then hold their meaning at every station.
  float fbmDay(vec2 p) {
    float v = 0.0;
    float amp = 0.3;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
      if (i == 1) amp = 0.4;
      v += amp * vnoise(p);
      p = rot * p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }

  ${skyDayClearGlsl(shape)}

  void main() {
    vec3 dir = normalize(vWorldPos - cameraPosition);
    float elev = dir.y;
    vec3 col;

    if (uNight > 0.5) {
${nightBranch}    } else {
      // ── DAY: the painted sky ──────────────────────────────────────────────
      col = skyDayClear(dir);
      float contrast = mix(1.0, ${shape.calmCloudContrast.toFixed(2)}, calmAt(gl_FragCoord.xy));
      vec3 sunDir = normalize(uSunPos - cameraPosition);
      float mu = max(dot(dir, sunDir), 0.0);

      float cover = 0.0;
      if (elev > 0.015) {
        vec2 cloudUv = dir.xz / (elev + 0.18) * 2.6 + vec2(3.1, 7.4);
        float field = fbmDay(cloudUv);
        // LOOK r6 (L5): more cover toward the sun's azimuth and in the low band.
        vec2 coverAz = normalize(sunDir.xz + vec2(1e-5));
        float coverLen = length(dir.xz);
        float sunAzW = coverLen > 1e-4 ? pow(max(dot(dir.xz / coverLen, coverAz), 0.0), 2.0) : 0.0;
        float lowBand = 1.0 - smoothstep(0.05, 0.3, elev);
        float coverBias = ${shape.coverBias.sun.toFixed(2)} * sunAzW + ${shape.coverBias.low.toFixed(2)} * lowBand;
        cover = smoothstep(${shape.coverLo.toFixed(2)} - coverBias, ${shape.coverHi.toFixed(2)} - coverBias, field);
        if (cover > 0.0) {
          // Self-shadow: density toward the sun in the cloud plane. The tap
          // count is a uniform bound (quality.cloudTaps), one program.
          vec2 toSun = normalize(sunDir.xz + vec2(1e-5)) * 0.09;
          float occ = 0.0;
          float taps = 0.0;
          for (int i = 0; i < 4; i++) {
            if (float(i) >= uCloudTaps) break;
            occ += smoothstep(0.44, 0.70, fbmDay(cloudUv + toSun * float(i + 1)));
            taps += 1.0;
          }
          occ /= max(taps, 1.0);
          float thick = smoothstep(0.52, 0.78, field);
          float light = clamp(1.1 - 0.75 * occ - 0.2 * thick + 0.1 * (1.0 - cover), 0.0, 1.0);

          // LOOK r6 (L5): a cumulus seen against the sun is backlit — its body darkens.
          light *= mix(1.0, ${shape.contreJourCloud.body.toFixed(2)}, smoothstep(${shape.contreJourCloud.mu[0].toFixed(2)}, ${shape.contreJourCloud.mu[1].toFixed(2)}, mu) * thick);
          // Soft 3-band shading: belly → mid → lit.
          float b = light * 2.0;
          float stepped = min(floor(b), 1.0) + smoothstep(0.3, 0.7, b - min(floor(b), 1.0));
          b = mix(b, stepped, 0.7);
          vec3 cloud = b < 1.0 ? mix(uCloudBelly, uCloudMid, b) : mix(uCloudMid, uCloudLit, b - 1.0);

          // Silver lining on thin sun-facing edges — LOOK r6: gold toward the
          // sun, at the silver's own luminance (hue, never more light).
          float edge = cover * (1.0 - smoothstep(0.46 - coverBias, 0.56 - coverBias, field));
          float silverL = dot(uSilver, vec3(0.2126, 0.7152, 0.0722));
          vec3 goldLining = uSkyGold * (silverL / max(dot(uSkyGold, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
          vec3 lining = mix(uSilver, goldLining, smoothstep(0.2, 0.8, pow(mu, 2.0)));
          cloud = mix(cloud, lining, edge * (0.25 + 0.75 * pow(mu, 3.0)) * 0.7);

          float fade = smoothstep(0.015, 0.10, elev);
          col = mix(col, cloud, cover * fade * contrast);
        }
      }

      // Cirrus: thin wind-combed streaks above elevation 0.18, 0.18 opacity.
      if (elev > 0.18) {
        vec2 cuv = dir.xz / (elev + 0.05);
        cuv = mat2(0.94, 0.34, -0.34, 0.94) * cuv * vec2(0.6, 3.2) + vec2(11.3, 4.7);
        float streak = smoothstep(0.52, 0.78, fbm(cuv));
        float ci = smoothstep(0.18, 0.30, elev) * (1.0 - cover);
        col = mix(col, uCloudLit, streak * ci * ${shape.cirrus.opacity.toFixed(2)} * contrast);
      }

      // LOOK r4 (rules contre-jour hero): crepuscular rays fanning from the low
      // sun across the sky gap — static, warm, flattened inside the calm rects.
      {
        vec3 raySun = normalize(uSunPos - cameraPosition);
        vec3 rayX = normalize(cross(raySun, vec3(0.0, 1.0, 0.0)));
        vec3 rayY = cross(rayX, raySun);
        vec3 rayQ = dir - raySun * dot(dir, raySun);
        float rayAng = atan(dot(rayQ, rayY), dot(rayQ, rayX));
        float fan = smoothstep(0.45, 0.95, 0.5 + 0.5 * sin(rayAng * ${shape.rays.count.toFixed(1)} + 1.7 * sin(rayAng * 9.0)));
        float reach = pow(max(dot(dir, raySun), 0.0), ${shape.rays.falloff.toFixed(2)}) * smoothstep(-0.05, 0.2, elev);
        float rayCalm = 1.0 - calmAt(gl_FragCoord.xy);
        float rayAmt = (fan * ${shape.rays.strength.toFixed(3)} + ${shape.rays.wash.toFixed(3)}) * reach * rayCalm;
        // LOOK r6 (L4a): the dark sectors between the rays deepen (cool, never lighter).
        col *= mix(vec3(1.0), vec3(${shape.shadowRay.map((v) => v.toFixed(3)).join(', ')}), (1.0 - fan) * ${shape.rays.shadow.toFixed(3)} * reach * rayCalm);
        col = mix(col, uPeach * ${shape.rays.gain.toFixed(3)}, clamp(rayAmt, 0.0, 1.0));
      }

      col += (hash13(dir * 220.0) - 0.5) * 0.006;
    }

    // AgX compensation (SKY_GRADE): the post stack's operator pulls saturated
    // mid-tones toward grey, so the authored token colours are pre-saturated
    // and lifted to land where they were painted.
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSat) * uGain;
    if (uNight < 0.5) {
      float capL = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float over = max(capL - ${shape.lumaCap.knee.toFixed(3)}, 0.0);
      float capped = capL - over + over / (1.0 + over / ${(shape.lumaCap.peak - shape.lumaCap.knee).toFixed(3)});
      col *= capL > 1e-4 ? capped / capL : 1.0;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;
}

/** The program-relevant fields of a material (what the stability test pins). */
export function programSignature(material: THREE.ShaderMaterial): string {
  return JSON.stringify({
    v: material.vertexShader,
    f: material.fragmentShader,
    defines: material.defines ?? null,
    side: material.side,
    toneMapped: material.toneMapped,
    fog: material.fog,
    transparent: material.transparent,
    blending: material.blending,
    key: material.customProgramCacheKey(),
  });
}

/**
 * The sky dome material — create ONCE per mount; drive it with
 * `writeSkyUniforms` (same preset). Uniforms are the shared SKY_UNIFORMS and
 * the calm slots, bound by reference; the source is `buildSkyFragment(preset)`.
 */
export function createSkyMaterial(
  uniforms: SkyUniforms = SKY_UNIFORMS,
  preset: PaintedSkyPreset = PLAZA_SKY_PRESET,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uCalmRects: PAINT_UNIFORMS.uCalmRects,
      uCalmCount: PAINT_UNIFORMS.uCalmCount,
      uCalmViewport: PAINT_UNIFORMS.uCalmViewport,
      uCalmFeather: PAINT_UNIFORMS.uCalmFeather,
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: buildSkyFragment(preset),
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    // Day: tone-mapped (the shipped `!night`, `skyToneMapped`); Atmosphere
    // re-writes it on a palette flip. Inside the composer target three
    // resolves it to NoToneMapping, so rung 0–1 never re-keys on it.
    toneMapped: skyToneMapped(false),
  });
}

// ── paint-fx: skyline + shafts ──────────────────────────────────────────────

export type PaintFxKind = 'skyline' | 'shaft';

const KIND_VALUE: Record<PaintFxKind, number> = { skyline: 0, shaft: 1 };

const FX_VERTEX = /* glsl */ `
  uniform float uKind;
  attribute float aBand;
  varying vec2 vUv;
  varying float vBand;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vBand = aBand;
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix;
    #else
      mat4 m = modelMatrix;
    #endif
    vec4 world;
    if (uKind < 0.5) {
      world = m * vec4(position, 1.0);
    } else {
      // Axial billboard: the instance's local +Y (scaled) is the shaft axis
      // from its entry (y = 0) to its landing (y = 1); local X scale is the
      // width. The quad turns about the axis to face the camera.
      vec3 origin = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 axis = (m * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
      float width = length((m * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
      vec3 p = origin + axis * position.y;
      vec3 axisN = normalize(axis);
      vec3 side = cross(axisN, normalize(cameraPosition - p));
      float sl = length(side);
      side = sl > 1e-4 ? side / sl : normalize(cross(axisN, vec3(0.0, 0.0, 1.0)));
      world = vec4(p + side * position.x * width, 1.0);
    }
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FX_FRAGMENT = /* glsl */ `
  uniform float uKind;
  ${SKY_UNIFORMS_GLSL}
  // Skyline (kind 0).
  uniform sampler2D uAtlas;
  uniform vec2 uAtlasTexel;
  uniform vec3 uInk[3];
  uniform vec3 uLayerMix;
  uniform vec3 uRimWarm;
  uniform vec3 uWindow;
  uniform float uCalmDL;
  // Shaft (kind 1).
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uCap;
  uniform vec4 uFade;
  uniform float uPhase;
  varying vec2 vUv;
  varying float vBand;
  varying vec3 vWorldPos;
  ${CALM_GLSL}
  ${NOISE_GLSL}
  ${SKY_DAY_CLEAR_GLSL}

  float channelOf(vec4 t, float band) {
    return band < 0.5 ? t.r : (band < 1.5 ? t.g : t.b);
  }

  float lstarOf(float y) {
    y = max(y, 0.0);
    return y > 0.008856 ? 116.0 * pow(y, 1.0 / 3.0) - 16.0 : 903.3 * y;
  }

  float yOfLstar(float l) {
    return l > 8.0 ? pow((l + 16.0) / 116.0, 3.0) : max(l, 0.0) / 903.3;
  }

  void main() {
    float calm = calmAt(gl_FragCoord.xy);
    if (uKind < 0.5) {
      float band = floor(vBand + 0.5);
      vec4 texel = texture2D(uAtlas, vUv);
      float cov = channelOf(texel, band);
      // Cut on the bilinear 0.5 contour with a ~1.5 px screen-space AA ramp.
      float h = clamp(fwidth(cov) * 0.75, 0.02, 0.5);
      float alpha = smoothstep(0.5 - h, 0.5 + h, cov);
      if (alpha < 0.004) discard;

      vec3 dir = normalize(vWorldPos - cameraPosition);
      vec3 sky = skyClear(dir);
      int bi = int(band);
      vec3 ink = bi == 0 ? uInk[0] : (bi == 1 ? uInk[1] : uInk[2]);
      float k = bi == 0 ? uLayerMix.x : (bi == 1 ? uLayerMix.y : uLayerMix.z);
      vec3 col = mix(ink, sky, k);

      // Busy terms (× (1 − calm)): the warm sun-side roofline rim by day and
      // the static near-band night windows.
      float busy = 1.0 - calm;
      float above = channelOf(texture2D(uAtlas, vUv + vec2(0.0, uAtlasTexel.y * ${SKYLINE_RIM_PROBE_TEXELS.toFixed(1)})), band);
      float roof = clamp(cov - above, 0.0, 1.0);
      vec3 sunDir = normalize(uSunPos - cameraPosition);
      vec2 sunAz = normalize(sunDir.xz);
      float azLen = length(dir.xz);
      float sunSide = azLen > 1e-4 ? pow(max(dot(dir.xz / azLen, sunAz), 0.0), 1.5) : 0.0;
      col += uRimWarm * roof * sunSide * (1.0 - uNight) * busy;

      vec3 graded = skyGrade(col);
      vec3 skyGraded = skyGrade(sky);
      // Calm clamp: behind a face the silhouette stays within uCalmDL L* of the local sky.
      float yc = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      float ls = lstarOf(dot(skyGraded, vec3(0.2126, 0.7152, 0.0722)));
      float lt = clamp(lstarOf(yc), ls - uCalmDL, ls + uCalmDL);
      vec3 clamped = graded * (yc > 1e-6 ? yOfLstar(lt) / yc : 1.0);
      graded = mix(graded, clamped, calm);

      float win = bi == 0 ? texel.a * uNight * busy : 0.0;
      graded = mix(graded, uWindow, win);
      gl_FragColor = vec4(graded, alpha);
    } else {
      float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
      float soft = smoothstep(0.0, 1.0, across);
      soft *= soft;
      float along = smoothstep(uFade.x, uFade.y, vUv.y) * (1.0 - smoothstep(uFade.z, uFade.w, vUv.y));
      // Static dust: a fixed phase, so a still at t = 0 reads the same as any other.
      float dust = 0.85 + 0.15 * vnoise(vUv * vec2(6.0, 40.0) + vec2(uPhase, 0.0));
      float amount = min(max(uIntensity, 0.0), uCap) * soft * along * dust * (1.0 - calm);
      gl_FragColor = vec4(uColor * amount, 1.0);
    }
  }
`;

export interface PaintFxOptions {
  /** Skyline atlas (kind skyline). */
  atlas?: THREE.Texture | null;
  /** The world's skyline (kind skyline): atlas texel, inks, mixes and rim are uniforms (default the plaza's). */
  spec?: SkylineSpec;
}

const BAND_IDS: readonly SkylineBandId[] = ['near', 'mid', 'far'];

/**
 * The plaza's skyline as a spec (ROLLOUT §2.2 e): today's `PLAZA_SKYLINE_ATLAS`
 * (the file, 2048 × 512, radii 70 / 100 / 140, tops at 16°), the band mixes,
 * inks, rim and seams of `skyline.ts` — moved into one record, not changed.
 */
export const PLAZA_SKYLINE_SPEC: SkylineSpec = (() => {
  const byIndex = [...SKYLINE_BANDS].sort((a, b) => a.index - b.index);
  const three = <T,>(pick: (band: SkylineBand) => T): [T, T, T] => [pick(byIndex[0]), pick(byIndex[1]), pick(byIndex[2])];
  return {
    file: PLAZA_SKYLINE_FILE,
    atlas: { width: PLAZA_SKYLINE_ATLAS.width, height: PLAZA_SKYLINE_ATLAS.height },
    radii: three((band) => band.radius),
    topElevationDeg: [PLAZA_SKYLINE_ATLAS.topElevationDeg, PLAZA_SKYLINE_ATLAS.topElevationDeg, PLAZA_SKYLINE_ATLAS.topElevationDeg],
    layerMix: { day: three((band) => band.horizonMix.day), night: three((band) => band.horizonMix.night) },
    ink: { day: three((band) => SKYLINE_INK[band.id].day), night: three((band) => SKYLINE_INK[band.id].night) },
    windows: true,
    rimWarm: SKYLINE_RIM.color,
    rimStrength: SKYLINE_RIM.strength,
    seams: three((band) => SKYLINE_SEAMS[band.id]),
  };
})();

/** A spec's three bands (near, mid, far) in the ring builder's shape. */
export function skylineBandsFor(spec: SkylineSpec): SkylineBand[] {
  return BAND_IDS.map((id, index) => ({
    id,
    index,
    radius: spec.radii[index],
    height: skylineLayerHeight(spec.radii[index], spec.topElevationDeg[index]),
    horizonMix: { day: spec.layerMix.day[index], night: spec.layerMix.night[index] },
    seam: spec.seams[index],
  }));
}

/** Linear window colour scaled to its luma target (the ≤ 0.6 board-ink cap). */
export function skylineWindowLinear(out = new THREE.Color()): THREE.Color {
  out.set(SKYLINE_WINDOW.color);
  const l = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
  return l > 0 ? out.multiplyScalar(SKYLINE_WINDOW.luma / l) : out;
}

/** Write the skyline inks and horizon mixes for a palette (value writes only). */
export function writeSkylineUniforms(material: THREE.ShaderMaterial, night: boolean, spec: SkylineSpec = PLAZA_SKYLINE_SPEC): void {
  const u = material.uniforms;
  const inks = u.uInk.value as THREE.Color[];
  const ink = night ? spec.ink.night : spec.ink.day;
  for (let i = 0; i < 3; i += 1) inks[i].set(ink[i]);
  const mix = u.uLayerMix.value as THREE.Vector3;
  const layer = night ? spec.layerMix.night : spec.layerMix.day;
  mix.set(layer[0], layer[1], layer[2]);
}

/**
 * A paint-fx material. Every kind shares the exact vertex / fragment source
 * and program flags; only uniform values and blend state differ, so all
 * paint-fx draws link ONE program. Render through an InstancedMesh.
 */
export function createPaintFxMaterial(kind: PaintFxKind, options: PaintFxOptions = {}): THREE.ShaderMaterial {
  const spec = options.spec ?? PLAZA_SKYLINE_SPEC;
  const rim = new THREE.Color(spec.rimWarm).multiplyScalar(spec.rimStrength);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...SKY_UNIFORMS,
      uKind: { value: KIND_VALUE[kind] },
      uAtlas: { value: options.atlas ?? null },
      uAtlasTexel: { value: new THREE.Vector2(1 / spec.atlas.width, 1 / spec.atlas.height) },
      uInk: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
      uLayerMix: { value: new THREE.Vector3() },
      uRimWarm: { value: rim },
      uWindow: { value: skylineWindowLinear() },
      uCalmDL: { value: SKYLINE_CALM_DELTA_L },
      uColor: { value: new THREE.Color('#ffd9a0') },
      uIntensity: { value: 0 },
      uCap: { value: 0.08 },
      uFade: { value: new THREE.Vector4(0, 0.18, 0.55, 1) },
      uPhase: { value: 0 },
      uCalmRects: PAINT_UNIFORMS.uCalmRects,
      uCalmCount: PAINT_UNIFORMS.uCalmCount,
      uCalmViewport: PAINT_UNIFORMS.uCalmViewport,
      uCalmFeather: PAINT_UNIFORMS.uCalmFeather,
    },
    vertexShader: FX_VERTEX,
    fragmentShader: FX_FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: kind === 'shaft' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.userData.paintExempt = true;
  material.userData.paintFx = kind;
  if (kind === 'skyline') writeSkylineUniforms(material, false, spec);
  return material;
}

/**
 * The attributes a paint-fx geometry may carry. `normal` is deliberately
 * absent: three keys programs on `vertexNormals`, so a geometry with normals
 * would link a SECOND paint-fx program. Tested.
 */
export const PAINT_FX_ATTRIBUTES = ['position', 'uv', 'aBand'] as const;

function stripToPaintFx(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (!(PAINT_FX_ATTRIBUTES as readonly string[]).includes(name)) geometry.deleteAttribute(name);
  }
  return geometry;
}

/**
 * The shaft quad for `kind: 'shaft'`: a unit plane, x ∈ [−0.5, 0.5] across,
 * y ∈ [0, 1] from the entry to the landing (uv matches). Each instance's
 * matrix scales X to the width and maps local +Y onto the full shaft axis.
 */
export function createShaftGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 8);
  geometry.translate(0, 0.5, 0);
  return stripToPaintFx(geometry);
}

/** The merged skyline ring (`skyline.ts`) of a spec as a paint-fx geometry (default the plaza's). */
export function createSkylineGeometry(spec: SkylineSpec = PLAZA_SKYLINE_SPEC): THREE.BufferGeometry {
  const ring = buildSkylineRing(spec === PLAZA_SKYLINE_SPEC ? SKYLINE_BANDS : skylineBandsFor(spec));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(ring.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(ring.uvs, 2));
  geometry.setAttribute('aBand', new THREE.BufferAttribute(ring.bands, 1));
  geometry.setIndex(new THREE.BufferAttribute(ring.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

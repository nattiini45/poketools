/**
 * The shared painted-light rig's pure half (ROLLOUT §2.2 b): the plaza
 * `Lighting.tsx` constants and maths, MOVED here verbatim so any world that
 * opts into the paint system (`theme.paint`) drives the shared uniforms with
 * exactly the plaza's law. `Lighting.tsx` re-exports every name, so its tests
 * keep their import paths.
 *
 * - `paintSetForRung` / `keyColorFor`: the post-off (renderer ACES) rungs'
 *   shade-hue shift and neutral-leaning key.
 * - `contreJourFactor`: the horizontal cosine between the view and the key.
 * - `applyPaintRigPalette` / `paintRigKeyScale`: the palette write the rig
 *   runs in its layout effect (uniforms only, never a program).
 * - `paintRigFrameBase` / `writePaintRigFrame`: the per-frame hemisphere,
 *   shadow fill, form, bounce and air-lift writes, in the plaza's order.
 *
 * Pure: three as maths only, no React.
 */

import * as THREE from 'three';
import type { Vec3Tuple } from '@/lib/route-world/focus';
import type { PaintLightSet, PaintRigTuning, RouteThemePaint } from '@/lib/route-world/theme-types';
import type { StationWorldState } from '@/lib/route-world/chapters';
import type { HdriRole } from '@/lib/route-world/world-env';
import { hdriRoleFor } from '@/lib/route-world/world-env';
import {
  applyPaintSaturation,
  applyPaintSet,
  keyScaleFor,
  PAINT_UNIFORMS,
  unitLumaColor,
  type PaintUniforms,
} from './paint-uniforms';

/**
 * The post-off rungs (renderer ACES, LOOK r2) keep — and push — the
 * saturation AgX pulls down: the warm key turned cream stone salmon there.
 * They take the key half-way to a neutral warm white and no painted chroma
 * boost, so rung 2 reads like rung 0 (lights only; never a data face).
 */
export const POST_OFF_KEY_NEUTRAL = { color: '#fff1e0', mix: 0.55 } as const;

/**
 * LOOK r3/r4 (rung-2 survival): ACES turns the day's violet-blue shade
 * magenta-pink on warm stone (AgX turns it the intended cool violet). The
 * post-off rungs take the shade and IBL hues about half-way toward a warm
 * sand, so the rung-2 frame lands on the before's warm stone instead (r3's
 * cyan shift read "colder and flatter" to the LOOK judge). LOOK r5: the day
 * shade is near-neutral now, so a quarter of the shift is enough (0.55 read
 * sepia-orange under ACES), and the key leans half-way to neutral.
 */
export const POST_OFF_SHADE_SHIFT = { color: '#d0b89c', mix: 0.25 } as const;

/**
 * LOOK r4 (rung-2 survival: "the after is colder and flatter than the
 * before's warm stone"): the post-off rungs keep a little painted chroma.
 * LOOK r5: the r5 key and honey stone are warm enough on their own — ACES
 * over-saturated them to sepia-orange, so rung 2 takes a hair less chroma.
 */
export const POST_OFF_SATURATION = 0.97;

/**
 * LOOK r4 (rules = the hero finale: "warm with cool shade"): looking INTO the
 * low sun (the rules and roster poses) the painted shade takes more of the
 * sunlit ground's warm bounce, the far air glows warmer, and the cool fill
 * steps down a little so the warm accents (golden sky gap, lanterns, rims,
 * shafts, the sun band) carry the frame — the painterly contre-jour. `into`
 * is the horizontal cosine between the view and the sun (0 when the sun is
 * behind or beside the eye). Day only; uniform writes per frame.
 *
 * (A hue shift of the shade itself toward rose/sand was tried in the capture
 * loop and rejected: it turned the whole rules frame pink or grey.)
 */
// LOOK r5: the rules finale takes twice the warm bounce into its (form) shade.
export const CONTRE_JOUR = { bounce: 1.6, lift: 0.35, shade: 0.1 } as const;

/** The rig tuning of record: the plaza's constants above (a world without `paint.rig` takes them). */
export const DEFAULT_RIG_TUNING: PaintRigTuning = {
  contreJour: CONTRE_JOUR,
  postOff: { keyNeutral: POST_OFF_KEY_NEUTRAL, shadeShift: POST_OFF_SHADE_SHIFT, saturation: POST_OFF_SATURATION },
};

/** Horizontal cosine between the view direction and the direction toward the key, clamped at 0. */
export function contreJourFactor(view: { x: number; z: number }, key: readonly [number, number, number]): number {
  const vl = Math.hypot(view.x, view.z);
  const kl = Math.hypot(key[0], key[2]);
  if (vl < 1e-6 || kl < 1e-6) return 0;
  return Math.max(0, (view.x * key[0] + view.z * key[2]) / (vl * kl));
}

/** The light set a rung paints with (post-off: shade hues shifted, see above). */
export function paintSetForRung(set: PaintLightSet, post: boolean, tuning: PaintRigTuning = DEFAULT_RIG_TUNING): PaintLightSet {
  if (post) return set;
  const shadeShift = tuning.postOff.shadeShift;
  const shift = (hex: string) =>
    '#' + new THREE.Color(hex).lerp(new THREE.Color(shadeShift.color), shadeShift.mix).getHexString();
  return {
    ...set,
    // LOOK r5: ACES already keeps the shade's chroma — no painted shade boost.
    shadeSat: 0,
    shadow: {
      ...set.shadow,
      tint: shift(set.shadow.tint),
      form: set.shadow.form ? { ...set.shadow.form, tint: shift(set.shadow.form.tint) } : undefined,
    },
    ibl: set.ibl ? { ...set.ibl, tint: shift(set.ibl.tint) } : set.ibl,
  };
}

/** The key colour for a rung (sRGB hex in, linear `THREE.Color` out). */
export function keyColorFor(
  color: string,
  post: boolean,
  out = new THREE.Color(),
  tuning: PaintRigTuning = DEFAULT_RIG_TUNING,
): THREE.Color {
  out.set(color);
  if (!post) out.lerp(new THREE.Color(tuning.postOff.keyNeutral.color), tuning.postOff.keyNeutral.mix);
  return out;
}

/** The light set of a palette. */
export function paintSetFor(paint: RouteThemePaint, night: boolean): PaintLightSet {
  return night ? paint.night : paint.day;
}

/** The rig tuning of a paint block (its own `rig`, else the plaza's constants). */
export function rigTuningFor(paint: RouteThemePaint): PaintRigTuning {
  return paint.rig ?? DEFAULT_RIG_TUNING;
}

/** WorldEnvironment's intensity law, passed in so this module stays free of the renderer. */
export type EnvironmentIntensityFn = (
  role: HdriRole,
  exposure: number,
  intensities: Record<HdriRole, number> | undefined,
) => number;

/**
 * The painted IBL diffuse and specular scales (art ÷ scene) for a palette:
 * painted materials see `set.ibl.environment` / `.specular` while the scene
 * keeps the theme's shipped IBL for every unpainted material.
 */
export function paintIblScales(
  set: PaintLightSet,
  exposure: number,
  environmentIntensity: Record<HdriRole, number> | undefined,
  intensityFor: EnvironmentIntensityFn,
): readonly [number, number] {
  const role = hdriRoleFor(exposure);
  const scene = intensityFor(role, exposure, environmentIntensity);
  const ratio = (art: number | undefined) => {
    if (art === undefined || scene <= 0) return 1;
    return intensityFor(role, exposure, { gold: art, night: art }) / scene;
  };
  const diffuse = ratio(set.ibl?.environment);
  return [diffuse, set.ibl?.specular === undefined ? diffuse : ratio(set.ibl.specular)] as const;
}

/**
 * The palette write (the rig's layout effect, plaza order): the rung's light
 * set into the shared uniforms, the painted chroma, and the painted
 * hemisphere switched on. Uniform writes only — a palette flip never changes
 * a program.
 */
export function applyPaintRigPalette(
  set: PaintLightSet,
  post: boolean,
  keyDirection: Vec3Tuple,
  iblScale: number,
  iblSpecScale: number,
  tuning: PaintRigTuning = DEFAULT_RIG_TUNING,
  uniforms: PaintUniforms = PAINT_UNIFORMS,
): void {
  applyPaintSet(paintSetForRung(set, post, tuning), keyDirection, uniforms, iblScale, iblSpecScale);
  applyPaintSaturation(post ? (set.saturation ?? 1) : tuning.postOff.saturation, uniforms);
}

/**
 * The painted key as a per-channel multiple of the scene key (`uKeyScale`):
 * `scene` is the SHIPPED scene key as a linear colour × its base intensity
 * (the station key and the exposure multiply both and cancel in the ratio).
 */
export function paintRigKeyScale(
  set: PaintLightSet,
  post: boolean,
  scene: THREE.Color,
  tuning: PaintRigTuning = DEFAULT_RIG_TUNING,
  out: THREE.Color = PAINT_UNIFORMS.uKeyScale.value,
): THREE.Color {
  const art = keyColorFor(set.key.color, post, undefined, tuning).multiplyScalar(set.key.intensity);
  return keyScaleFor(art, scene, out);
}

/** The static scene key (`color` sRGB hex × `intensity`) as the linear colour `paintRigKeyScale` divides by. */
export function sceneKeyColor(key: { color: string; intensity: number }, out = new THREE.Color()): THREE.Color {
  return out.set(key.color).multiplyScalar(key.intensity);
}

/** The per-palette colours the frame writes scale (computed once per palette and rung). */
export interface PaintRigFrameBase {
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  bounce: THREE.Color;
  shadowFill: THREE.Color;
  shadowForm: THREE.Color;
}

export function paintRigFrameBase(set: PaintLightSet, post: boolean, tuning: PaintRigTuning = DEFAULT_RIG_TUNING): PaintRigFrameBase {
  const bounce = new THREE.Color(0, 0, 0);
  if (set.bounce) unitLumaColor(set.bounce.color, set.bounce.strength, bounce);
  const rungSet = paintSetForRung(set, post, tuning);
  const form = rungSet.shadow.form ?? rungSet.shadow;
  return {
    hemiSky: new THREE.Color(set.hemisphere.sky),
    hemiGround: new THREE.Color(set.hemisphere.ground),
    bounce,
    shadowFill: unitLumaColor(rungSet.shadow.tint, rungSet.shadow.lift, new THREE.Color()),
    shadowForm: unitLumaColor(form.tint, form.lift, new THREE.Color()),
  };
}

/** A world-state sample the per-frame writes read (the station channels). */
export type WorldSample = StationWorldState;

/**
 * The per-frame painted writes (plaza order): the painted hemisphere, the
 * shadow fill and form scaled down as the eye turns into the sun, the warm
 * bounce and the air lift scaled up (contre-jour, day only).
 */
export function writePaintRigFrame(
  base: PaintRigFrameBase,
  set: PaintLightSet,
  world: WorldSample,
  exposure: number,
  into: number,
  tuning: PaintRigTuning = DEFAULT_RIG_TUNING,
  uniforms: PaintUniforms = PAINT_UNIFORMS,
): void {
  const contreJour = tuning.contreJour;
  const paintedFill = (set.hemisphere.intensity + set.hemisphere.keyGain * world.key) * exposure;
  const shadeScale = 1 - contreJour.shade * into;
  uniforms.uHemiSky.value.copy(base.hemiSky).multiplyScalar(paintedFill * shadeScale);
  uniforms.uHemiGround.value.copy(base.hemiGround).multiplyScalar(paintedFill * shadeScale);
  uniforms.uShadowFill.value.copy(base.shadowFill).multiplyScalar(shadeScale);
  uniforms.uShadowForm.value.copy(base.shadowForm).multiplyScalar(shadeScale);
  uniforms.uBounce.value.copy(base.bounce).multiplyScalar(1 + contreJour.bounce * into);
  uniforms.uAir.value.w = set.air.lift * (1 + contreJour.lift * into);
}

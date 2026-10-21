/**
 * Shared uniforms of the painterly light model (LOOK-PLAN §2 SEAT L).
 *
 * ONE set of `{ value }` objects, referenced by every patched material's
 * program (the patch assigns these objects, never copies), so the light rig
 * writes a palette or a station once per frame and every painted surface —
 * stone, frames and figures alike — follows. Only `uPaintRole` is per
 * material (see `painted-light.ts`).
 *
 * Values are linear light. Colours go through `THREE.Color` (sRGB hex →
 * linear under three's colour management). Hue-like terms (shadow tint,
 * terminator, air) are normalised to unit luminance here so their strength
 * scalars read as "share of the key" / "share of the pixel", independent of
 * how bright the authored swatch happens to be.
 *
 * The calm-rect slots are shared too: `calm-rects.ts` writes the projected,
 * padded screen rects of the visible data faces and the SKY / MOMENTS seats
 * read them through `CALM_GLSL`.
 */

import * as THREE from 'three';
import type { PaintLightSet, PaintRole, PaintRoleTable } from '@/lib/route-world/theme-types';
import type { Vec3Tuple } from '@/lib/route-world/focus';

/** Face rects the calm uniform carries (active station + neighbours). */
export const CALM_RECT_SLOTS = 4;

/** Feather of a calm rect, as a share of the viewport (LOOK-PLAN §1.3: 3 %). */
export const CALM_FEATHER = 0.03;

/** Rim ceiling in linear light — keeps figures under the day bloom knee. */
export const RIM_CLAMP = 0.9;

/** The rim's fresnel power when a light set names none (the r5 band). */
export const DEFAULT_RIM_POWER = 4.5;

/** Rec. 709 luminance of a linear colour. */
export function linearLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface PaintUniforms {
  /** (wrap w, band lo, band hi) over N·L. */
  uPaintBand: { value: THREE.Vector3 };
  /** Shadow fill hue at unit luminance × lift (share of key luminance). */
  uShadowFill: { value: THREE.Color };
  /** Terminator hue at unit luminance × strength (share of key luminance). */
  uTermWarm: { value: THREE.Color };
  /** Rim colour × strength, absolute linear radiance, clamped per channel. */
  uRim: { value: THREE.Color };
  /** Air hue at unit luminance (the chroma shift target, luminance-preserving). */
  uAirHue: { value: THREE.Color };
  /** (start m, density /m, chroma amount, value-lift max). */
  uAir: { value: THREE.Vector4 };
  /** Metres beyond which the value lift begins. */
  uAirLiftStart: { value: number };
  /** Value-lift colour away from the sun (the air colour, linear). */
  uAirLift: { value: THREE.Color };
  /** Value-lift colour toward the sun. */
  uAirSun: { value: THREE.Color };
  /** Unit world-space direction TOWARD the key (sun / moon). */
  uSunDir: { value: THREE.Vector3 };
  /** IBL irradiance hue at unit luminance × strength (shade colour). */
  uIblTint: { value: THREE.Color };
  /** Saturation of the painted result, before the post stack. */
  uPaintSat: { value: number };
  /**
   * LOOK r3 (data-face purity by construction): the scene's lights stay the
   * shipped ones, so every UNPAINTED material (data faces, plaques, the
   * ledger, standby faces) renders exactly as before. Painted materials turn
   * them into the art-directed set in the shader: the directional key's
   * colour × `uKeyScale` (art ÷ scene, per channel), …
   */
  uKeyScale: { value: THREE.Color };
  /** … the hemisphere swapped for the painted pair (linear, × intensity) while `uHemiOn` = 1, … */
  uHemiSky: { value: THREE.Color };
  uHemiGround: { value: THREE.Color };
  uHemiOn: { value: number };
  /** … and the image-based specular × `uIblSpec` (the irradiance rides `uIblTint`). */
  uIblSpec: { value: number };
  /** LOOK r4: warm bounce hue at unit luminance × strength (share of key luminance, in shade). */
  uBounce: { value: THREE.Color };
  /** LOOK r4: the tint painted materials apply to WARM point lights (identity = white). */
  uPointWarm: { value: THREE.Color };
  /** LOOK r5: FORM-shade fill (surfaces facing away from the key), hue at unit luminance × lift. */
  uShadowForm: { value: THREE.Color };
  /** LOOK r5: extra painted chroma in FORM shade (× the light set's saturation), so shade keeps its albedo's colour. */
  uShadeSat: { value: number };
  /**
   * LOOK r6 (L2): CAST-shade hue at unit luminance (rgb) and its blend at full
   * cast shade (w) — cast shade turns cool at matched luma (w 0 = off).
   */
  uShadeHue: { value: THREE.Vector4 };
  /** LOOK r6 (L6.1): the rim's fresnel power (4.5 by day, wider at night). */
  uRimPow: { value: number };
  /** LOOK r6 (L6.1): moon catch on up-facing ledges, absolute linear radiance (0 = off). */
  uMoonCatch: { value: THREE.Color };
  /** LOOK r6 (L6.4): soft luminance ceiling on the painted diffuse (≤ 0 = off). */
  uLumaCeil: { value: number };
  /**
   * Padded data-face rects in normalised GL screen space (x0, y0, x1, y1),
   * origin bottom-left — compare against `gl_FragCoord.xy / uCalmViewport`.
   */
  uCalmRects: { value: THREE.Vector4[] };
  /** How many `uCalmRects` slots are live this frame (0..CALM_RECT_SLOTS). */
  uCalmCount: { value: number };
  /** Drawing-buffer size in device pixels (for `gl_FragCoord` normalisation). */
  uCalmViewport: { value: THREE.Vector2 };
  /** Feather width as a share of the viewport. */
  uCalmFeather: { value: number };
  [uniform: string]: THREE.IUniform;
}

/**
 * Fresh uniforms at the plaza day values' SHAPE but a neutral light:
 * no fill, no terminator, no rim, no air. A patched material rendered before
 * the rig applies a palette therefore only differs by its wrap/band.
 */
export function createPaintUniforms(): PaintUniforms {
  return {
    uPaintBand: { value: new THREE.Vector3(0.35, -0.05, 0.3) },
    uShadowFill: { value: new THREE.Color(0, 0, 0) },
    uTermWarm: { value: new THREE.Color(0, 0, 0) },
    uRim: { value: new THREE.Color(0, 0, 0) },
    uAirHue: { value: new THREE.Color(1, 1, 1) },
    uAir: { value: new THREE.Vector4(12, 0, 0, 0) },
    uAirLiftStart: { value: 25 },
    uAirLift: { value: new THREE.Color(1, 1, 1) },
    uAirSun: { value: new THREE.Color(1, 1, 1) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uIblTint: { value: new THREE.Color(1, 1, 1) },
    uPaintSat: { value: 1 },
    uKeyScale: { value: new THREE.Color(1, 1, 1) },
    uHemiSky: { value: new THREE.Color(0, 0, 0) },
    uHemiGround: { value: new THREE.Color(0, 0, 0) },
    uHemiOn: { value: 0 },
    uIblSpec: { value: 1 },
    uBounce: { value: new THREE.Color(0, 0, 0) },
    uPointWarm: { value: new THREE.Color(1, 1, 1) },
    uShadowForm: { value: new THREE.Color(0, 0, 0) },
    uShadeSat: { value: 0 },
    uShadeHue: { value: new THREE.Vector4(1, 1, 1, 0) },
    uRimPow: { value: DEFAULT_RIM_POWER },
    uMoonCatch: { value: new THREE.Color(0, 0, 0) },
    uLumaCeil: { value: -1 },
    uCalmRects: { value: Array.from({ length: CALM_RECT_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uCalmCount: { value: 0 },
    uCalmViewport: { value: new THREE.Vector2(1, 1) },
    uCalmFeather: { value: CALM_FEATHER },
  };
}

/** The one shared set every patched program binds. */
export const PAINT_UNIFORMS: PaintUniforms = createPaintUniforms();

/** Default role (env) — what an untagged lit material gets. */
export const DEFAULT_PAINT_ROLE: PaintRole = { k: 1, rimScale: 1, bandMix: 0.55 };

let activeRoles: PaintRoleTable | null = null;

/**
 * Resolve a material's `userData.paintRole` against the active light set's
 * role table. An unknown name — or `snow` in a set that declares none
 * (ROLLOUT §2.2 a) — resolves to `env`.
 */
export function paintRoleFor(name: unknown): PaintRole {
  const roles = activeRoles;
  if (typeof name === 'string' && roles && name in roles) {
    const role = (roles as Partial<Record<string, PaintRole>>)[name];
    if (role) return role;
  }
  if (roles) return roles.env;
  return DEFAULT_PAINT_ROLE;
}

/** Write a role into a material's `uPaintRole` vector (k, rimScale, bandMix, saturation share). */
export function writePaintRole(target: THREE.Vector4, role: PaintRole): THREE.Vector4 {
  return target.set(role.k, role.rimScale, role.bandMix, role.sat ?? 1);
}

const _c = new THREE.Color();

/** `hex` in linear light, scaled to unit luminance, then × `scale`. */
export function unitLumaColor(hex: string, scale: number, out: THREE.Color): THREE.Color {
  out.set(hex);
  const l = linearLuma(out.r, out.g, out.b);
  if (l <= 1e-6) return out.setRGB(0, 0, 0);
  return out.multiplyScalar(scale / l);
}

/**
 * Apply one palette's light set to the shared uniforms. `sunDirection` is
 * the theme's `lights.keyDirection` (toward the key, any length). Pure
 * value writes — never a program change.
 */
export function applyPaintSet(
  set: PaintLightSet,
  sunDirection: Vec3Tuple,
  uniforms: PaintUniforms = PAINT_UNIFORMS,
  iblScale = 1,
  iblSpecScale = iblScale,
): void {
  activeRoles = uniforms === PAINT_UNIFORMS ? set.roles : activeRoles;
  uniforms.uPaintBand.value.set(set.band.wrap, set.band.lo, set.band.hi);
  unitLumaColor(set.shadow.tint, set.shadow.lift, uniforms.uShadowFill.value);
  const form = set.shadow.form ?? set.shadow;
  unitLumaColor(form.tint, form.lift, uniforms.uShadowForm.value);
  uniforms.uShadeSat.value = set.shadeSat ?? 0;
  const hue = set.shadow.hue;
  if (hue && hue.strength > 0) {
    unitLumaColor(hue.color, 1, _c);
    uniforms.uShadeHue.value.set(_c.r, _c.g, _c.b, hue.strength);
  } else {
    uniforms.uShadeHue.value.set(1, 1, 1, 0);
  }
  unitLumaColor(set.terminator.color, set.terminator.strength, uniforms.uTermWarm.value);
  _c.set(set.rim.color).multiplyScalar(set.rim.strength);
  uniforms.uRim.value.setRGB(Math.min(_c.r, RIM_CLAMP), Math.min(_c.g, RIM_CLAMP), Math.min(_c.b, RIM_CLAMP));
  uniforms.uRimPow.value = set.rimPower ?? DEFAULT_RIM_POWER;
  if (set.moonCatch) {
    _c.set(set.moonCatch.color).multiplyScalar(set.moonCatch.strength);
    uniforms.uMoonCatch.value.setRGB(Math.min(_c.r, RIM_CLAMP), Math.min(_c.g, RIM_CLAMP), Math.min(_c.b, RIM_CLAMP));
  } else {
    uniforms.uMoonCatch.value.setRGB(0, 0, 0);
  }
  uniforms.uLumaCeil.value = set.lumaCeil !== undefined && set.lumaCeil > 0 ? set.lumaCeil : -1;
  unitLumaColor(set.air.hue, 1, uniforms.uAirHue.value);
  uniforms.uAir.value.set(set.air.start, set.air.density, set.air.chroma, set.air.lift);
  uniforms.uAirLiftStart.value = set.air.liftStart;
  uniforms.uAirLift.value.set(set.air.hue);
  uniforms.uAirSun.value.set(set.air.sun);
  uniforms.uSunDir.value.set(sunDirection[0], sunDirection[1], sunDirection[2]).normalize();
  const ibl = set.ibl ?? { tint: '#ffffff', strength: 1 };
  unitLumaColor(ibl.tint, ibl.strength * iblScale, uniforms.uIblTint.value);
  uniforms.uIblSpec.value = iblSpecScale;
  uniforms.uPaintSat.value = set.saturation ?? 1;
  if (set.bounce) unitLumaColor(set.bounce.color, set.bounce.strength, uniforms.uBounce.value);
  else uniforms.uBounce.value.setRGB(0, 0, 0);
  if (set.pointWarm) unitLumaColor(set.pointWarm.color, set.pointWarm.strength, uniforms.uPointWarm.value);
  else uniforms.uPointWarm.value.setRGB(1, 1, 1);
}

/**
 * The painted key as a per-channel multiplier of the scene key (LOOK r3).
 * `art` and `scene` are LINEAR colours already × their base intensities
 * (the station key and the exposure multiply both, so they cancel). A scene
 * channel at ~0 takes the luminance ratio instead of dividing by zero.
 */
export function keyScaleFor(art: THREE.Color, scene: THREE.Color, out: THREE.Color): THREE.Color {
  const lumRatio = linearLuma(art.r, art.g, art.b) / Math.max(linearLuma(scene.r, scene.g, scene.b), 1e-6);
  const channel = (a: number, s: number) => (s > 1e-4 ? a / s : lumRatio);
  return out.setRGB(channel(art.r, scene.r), channel(art.g, scene.g), channel(art.b, scene.b));
}

/** Override the painted chroma (the post-off rungs take 1 — no AgX to compensate). */
export function applyPaintSaturation(value: number, uniforms: PaintUniforms = PAINT_UNIFORMS): void {
  uniforms.uPaintSat.value = value;
}

/** Test seam: forget the active role table (module state). */
export function resetPaintRolesForTest(): void {
  activeRoles = null;
}

type CopyableValue = { copy: (source: never) => unknown };

/**
 * Restore the shared uniforms to `createPaintUniforms()` values IN PLACE
 * (ROLLOUT §2.2 b, the unmount reset): every `{ value }` object keeps its
 * identity — compiled programs bind them by reference — and takes the fresh
 * value; the active role table is forgotten. A world that mounts after a
 * painted one starts from the neutral light, never from the last world's.
 */
export function resetPaintUniforms(uniforms: PaintUniforms = PAINT_UNIFORMS): void {
  const fresh = createPaintUniforms();
  for (const name of Object.keys(fresh)) {
    const target = uniforms[name];
    const source = fresh[name].value as unknown;
    if (!target) continue;
    if (Array.isArray(source) && Array.isArray(target.value)) {
      source.forEach((entry: CopyableValue, i: number) => {
        const slot = (target.value as CopyableValue[])[i];
        if (slot) slot.copy(entry as never);
      });
    } else if (source !== null && typeof source === 'object' && typeof (target.value as CopyableValue)?.copy === 'function') {
      (target.value as CopyableValue).copy(source as never);
    } else {
      target.value = source;
    }
  }
  if (uniforms === PAINT_UNIFORMS) activeRoles = null;
}

/**
 * GLSL helper for calm-rect consumers (SKY, MOMENTS): 1 inside any live
 * padded face rect, feathered to 0 over `uCalmFeather` of the viewport.
 * Declare the uniforms by binding `PAINT_UNIFORMS.uCalm*` into the
 * consumer's own uniforms object (by reference, never copied).
 */
export const CALM_GLSL = /* glsl */ `
uniform vec4 uCalmRects[ ${CALM_RECT_SLOTS} ];
uniform float uCalmCount;
uniform vec2 uCalmViewport;
uniform float uCalmFeather;
float calmAt( vec2 fragCoord ) {
  vec2 uv = fragCoord / max( uCalmViewport, vec2( 1.0 ) );
  float calm = 0.0;
  for ( int i = 0; i < ${CALM_RECT_SLOTS}; i ++ ) {
    if ( float( i ) >= uCalmCount ) break;
    vec4 r = uCalmRects[ i ];
    vec2 d = max( r.xy - uv, uv - r.zw );
    float outside = max( d.x, d.y );
    calm = max( calm, 1.0 - smoothstep( 0.0, max( uCalmFeather, 1e-4 ), outside ) );
  }
  return calm;
}
`;

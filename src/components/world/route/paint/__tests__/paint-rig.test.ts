import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyPaintSaturation,
  applyPaintSet,
  createPaintUniforms,
  keyScaleFor,
  PAINT_UNIFORMS,
  paintRoleFor,
  resetPaintRolesForTest,
  unitLumaColor,
  type PaintUniforms,
} from '../paint-uniforms';
import {
  applyPaintRigPalette,
  contreJourFactor,
  DEFAULT_RIG_TUNING,
  paintIblScales,
  paintRigFrameBase,
  paintRigKeyScale,
  paintSetFor,
  rigTuningFor,
  sceneKeyColor,
  writePaintRigFrame,
} from '../paint-rig';
import { resetPaintWorldState } from '../PaintRig';
import { environmentIntensityFor } from '@/components/world/route/env/WorldEnvironment';
import { PAINTED_SKY_DAY, SKY_UNIFORMS, createSkyUniforms, writeSkyUniforms } from '@/components/world/route/env/paint-fx';
import { LEAF_LAMP, LEAF_SIL, LEAF_SSS, LEAF_SSS_LEVELS } from '@/components/world/route/trees/tree-cards';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { hdriRoleFor } from '@/lib/route-world/world-env';
import type { PaintLightSet, RouteThemePaint } from '@/lib/route-world/theme-types';
import { paintFeature } from '@/lib/route-world/theme-types';

// ── The pre-refactor plaza rig, transcribed VERBATIM from
// `evoliga/route/env/Lighting.tsx` (round 6, before ROLLOUT §2.2 b) ─────────

const OLD_POST_OFF_KEY_NEUTRAL = { color: '#fff1e0', mix: 0.55 } as const;
const OLD_POST_OFF_SHADE_SHIFT = { color: '#d0b89c', mix: 0.25 } as const;
const OLD_POST_OFF_SATURATION = 0.97;
const OLD_CONTRE_JOUR = { bounce: 1.6, lift: 0.35, shade: 0.1 } as const;
const OLD_SCENE_KEY_INTENSITY = 3.4;

function oldPaintSetForRung(set: PaintLightSet, post: boolean): PaintLightSet {
  if (post) return set;
  const shift = (hex: string) =>
    '#' + new THREE.Color(hex).lerp(new THREE.Color(OLD_POST_OFF_SHADE_SHIFT.color), OLD_POST_OFF_SHADE_SHIFT.mix).getHexString();
  return {
    ...set,
    shadeSat: 0,
    shadow: {
      ...set.shadow,
      tint: shift(set.shadow.tint),
      form: set.shadow.form ? { ...set.shadow.form, tint: shift(set.shadow.form.tint) } : undefined,
    },
    ibl: set.ibl ? { ...set.ibl, tint: shift(set.ibl.tint) } : set.ibl,
  };
}

function oldKeyColorFor(color: string, post: boolean, out = new THREE.Color()): THREE.Color {
  out.set(color);
  if (!post) out.lerp(new THREE.Color(OLD_POST_OFF_KEY_NEUTRAL.color), OLD_POST_OFF_KEY_NEUTRAL.mix);
  return out;
}

function oldContreJourFactor(view: { x: number; z: number }, key: readonly [number, number, number]): number {
  const vl = Math.hypot(view.x, view.z);
  const kl = Math.hypot(key[0], key[2]);
  if (vl < 1e-6 || kl < 1e-6) return 0;
  return Math.max(0, (view.x * key[0] + view.z * key[2]) / (vl * kl));
}

interface RigInput {
  night: boolean;
  post: boolean;
  exposure: number;
  keyLight: string;
  frames: { key: number; view: THREE.Vector3 }[];
}

/** The old Lighting: its layout effect, then its per-frame painted writes, into `u`. */
function oldRig(input: RigInput, u: PaintUniforms): number[][] {
  const paint = plazaTheme.paint ?? PLAZA_PAINT;
  const set = input.night ? paint.night : paint.day;
  const lights = plazaTheme.lights;
  const role = hdriRoleFor(input.exposure);
  const scene = environmentIntensityFor(role, input.exposure, plazaTheme.environmentIntensity);
  const ratio = (art: number | undefined) => {
    if (art === undefined || scene <= 0) return 1;
    return environmentIntensityFor(role, input.exposure, { gold: art, night: art }) / scene;
  };
  const iblScale = ratio(set.ibl?.environment);
  const iblSpecScale = set.ibl?.specular === undefined ? iblScale : ratio(set.ibl.specular);
  applyPaintSet(oldPaintSetForRung(set, input.post), lights.keyDirection, u, iblScale, iblSpecScale);
  applyPaintSaturation(input.post ? (set.saturation ?? 1) : OLD_POST_OFF_SATURATION, u);
  const art = oldKeyColorFor(set.key.color, input.post).multiplyScalar(set.key.intensity);
  const sceneKey = new THREE.Color(input.keyLight).multiplyScalar(OLD_SCENE_KEY_INTENSITY);
  keyScaleFor(art, sceneKey, u.uKeyScale.value);
  u.uHemiOn.value = 1;
  const hemiSky = new THREE.Color(set.hemisphere.sky);
  const hemiGround = new THREE.Color(set.hemisphere.ground);
  const baseBounce = new THREE.Color(0, 0, 0);
  if (set.bounce) unitLumaColor(set.bounce.color, set.bounce.strength, baseBounce);
  const rungSet = oldPaintSetForRung(set, input.post);
  const form = rungSet.shadow.form ?? rungSet.shadow;
  const baseShadowFill = unitLumaColor(rungSet.shadow.tint, rungSet.shadow.lift, new THREE.Color());
  const baseShadowForm = unitLumaColor(form.tint, form.lift, new THREE.Color());
  const out: number[][] = [snapshot(u)];
  for (const frame of input.frames) {
    const paintedFill = (set.hemisphere.intensity + set.hemisphere.keyGain * frame.key) * input.exposure;
    const into = input.night ? 0 : oldContreJourFactor(frame.view, lights.keyDirection);
    const shadeScale = 1 - OLD_CONTRE_JOUR.shade * into;
    u.uHemiSky.value.copy(hemiSky).multiplyScalar(paintedFill * shadeScale);
    u.uHemiGround.value.copy(hemiGround).multiplyScalar(paintedFill * shadeScale);
    u.uShadowFill.value.copy(baseShadowFill).multiplyScalar(shadeScale);
    u.uShadowForm.value.copy(baseShadowForm).multiplyScalar(shadeScale);
    u.uBounce.value.copy(baseBounce).multiplyScalar(1 + OLD_CONTRE_JOUR.bounce * into);
    u.uAir.value.w = set.air.lift * (1 + OLD_CONTRE_JOUR.lift * into);
    out.push(snapshot(u));
  }
  return out;
}

/** The new shared rig, composed exactly as `usePaintRig` composes it (layout effect, then frames). */
function newRig(input: RigInput, u: PaintUniforms): number[][] {
  const theme = plazaTheme;
  const paint = theme.paint!;
  const set = paintSetFor(paint, input.night);
  const tuning = rigTuningFor(paint);
  const [iblScale, iblSpecScale] = paintIblScales(set, input.exposure, theme.environmentIntensity, environmentIntensityFor);
  applyPaintRigPalette(set, input.post, theme.lights.keyDirection, iblScale, iblSpecScale, tuning, u);
  paintRigKeyScale(set, input.post, sceneKeyColor({ color: input.keyLight, intensity: 3.4 }), tuning, u.uKeyScale.value);
  u.uHemiOn.value = 1;
  const base = paintRigFrameBase(set, input.post, tuning);
  const out: number[][] = [snapshot(u)];
  for (const frame of input.frames) {
    const into = input.night ? 0 : contreJourFactor(frame.view, theme.lights.keyDirection);
    writePaintRigFrame(base, set, { key: frame.key, fog: 0, practicals: 0, particles: 0 }, input.exposure, into, tuning, u);
    out.push(snapshot(u));
  }
  return out;
}

/** Every value of a uniform set, flattened in key order. */
function snapshot(u: PaintUniforms): number[] {
  const values: number[] = [];
  for (const name of Object.keys(u).sort()) {
    const v = u[name].value as unknown;
    if (typeof v === 'number') values.push(v);
    else if (Array.isArray(v)) for (const e of v) values.push(...(e as THREE.Vector4).toArray());
    else if (v && typeof (v as { toArray?: unknown }).toArray === 'function') values.push(...(v as THREE.Vector3).toArray());
  }
  return values;
}

const FRAMES = [
  { key: 1.0, view: new THREE.Vector3(-0.3, -0.05, -1).normalize() }, // pulse: the sun behind the eye
  { key: 0.92, view: new THREE.Vector3(-1, -0.1, -0.05).normalize() }, // roster
  { key: 0.88, view: new THREE.Vector3(1, -0.08, -0.02).normalize() }, // teams
  { key: 0.96, view: new THREE.Vector3(0.3, 0.05, -1).normalize() }, // schedule
  { key: 0.72, view: new THREE.Vector3(0, 0, 1) }, // rules: into the low sun
  { key: 0.8, view: new THREE.Vector3(-0.8, 0.2, 0.6).normalize() }, // a dolly sample, full contre-jour
];

afterEach(() => {
  resetPaintRolesForTest();
});

describe('rig parity (ROLLOUT §2.6): the shared rig writes the pre-refactor plaza values', () => {
  const cases: RigInput[] = [];
  for (const night of [false, true]) {
    for (const post of [true, false]) {
      cases.push({ night, post, exposure: night ? 0.55 : 1.0, keyLight: night ? '#9fb4ff' : '#ffd29a', frames: FRAMES });
    }
  }
  cases.push({ night: false, post: true, exposure: 0.9, keyLight: '#ffe0b0', frames: FRAMES });

  it.each(cases.map((c) => [`night ${c.night}, post ${c.post}, exposure ${c.exposure}`, c] as const))(
    '%s: identical uniforms after the palette write and every scripted frame',
    (_label, input) => {
      const expected = oldRig(input, createPaintUniforms());
      const actual = newRig(input, createPaintUniforms());
      expect(actual).toEqual(expected);
    },
  );

  it('the plaza rig tuning is the constants of record', () => {
    expect(rigTuningFor(plazaTheme.paint!)).toEqual({
      contreJour: OLD_CONTRE_JOUR,
      postOff: { keyNeutral: OLD_POST_OFF_KEY_NEUTRAL, shadeShift: OLD_POST_OFF_SHADE_SHIFT, saturation: OLD_POST_OFF_SATURATION },
    });
    // A paint block without `rig` takes the same constants.
    expect(rigTuningFor({ ...PLAZA_PAINT })).toBe(DEFAULT_RIG_TUNING);
  });
});

describe('paint features (ROLLOUT §2.2 a): every flag defaults to false', () => {
  it('no paint block / no features / an unset flag are all off', () => {
    expect(paintFeature(undefined, 'sweep')).toBe(false);
    expect(paintFeature(PLAZA_PAINT, 'sweep')).toBe(false);
    const partial: RouteThemePaint = { ...PLAZA_PAINT, features: { sweep: true } };
    expect(paintFeature(partial, 'sweep')).toBe(true);
    expect(paintFeature(partial, 'skyline')).toBe(false);
    for (const flag of ['sweep', 'calmRects', 'contactBlobs', 'stationShadow', 'paintedSky', 'skyline', 'lampHalos', 'sunShafts', 'paintedCanopy'] as const) {
      expect(paintFeature(plazaTheme.paint, flag)).toBe(true);
    }
  });

  it('a missing snow role resolves to env (a uniform, no program)', () => {
    applyPaintSet(PLAZA_PAINT.day, plazaTheme.lights.keyDirection);
    expect(paintRoleFor('snow')).toBe(PLAZA_PAINT.day.roles.env);
    const snow = { k: 1, rimScale: 0, bandMix: 0.5, sat: 0.4 };
    applyPaintSet({ ...PLAZA_PAINT.day, roles: { ...PLAZA_PAINT.day.roles, snow } }, plazaTheme.lights.keyDirection);
    expect(paintRoleFor('snow')).toBe(snow);
    applyPaintSet(PLAZA_PAINT.day, plazaTheme.lights.keyDirection);
  });
});

describe('unmount reset (ROLLOUT §2.2 b): no singleton crosses worlds', () => {
  it('resetPaintWorldState hands PAINT_UNIFORMS, LEAF_* and SKY_UNIFORMS back at their defaults, in place', () => {
    const identities = Object.keys(PAINT_UNIFORMS).map((name) => PAINT_UNIFORMS[name].value);
    const skyIdentities = Object.keys(SKY_UNIFORMS).map((name) => SKY_UNIFORMS[name].value);
    // A painted world's session: the plaza's night set, canopy and a foreign sky.
    const set = plazaTheme.paint!.night;
    applyPaintRigPalette(set, true, plazaTheme.lights.keyDirection, 0.5, 0.25);
    paintRigKeyScale(set, true, sceneKeyColor({ color: '#9fb4ff', intensity: 3.4 }));
    PAINT_UNIFORMS.uHemiOn.value = 1;
    PAINT_UNIFORMS.uCalmCount.value = 3;
    PAINT_UNIFORMS.uCalmRects.value[0].set(0.1, 0.2, 0.3, 0.4);
    LEAF_SSS.value = LEAF_SSS_LEVELS.night;
    LEAF_SIL.value = 1;
    LEAF_LAMP.value.setRGB(0.4, 0.3, 0.2);
    writeSkyUniforms(
      { night: true, sky: '#070433', skyHorizon: '#1c3a58', sunColor: '#fff1c4', moonColor: '#fff4ee', skyBodyPosition: [1, 2, 3], cloudTaps: 3 },
      SKY_UNIFORMS,
      {
        ...plazaTheme.paint!.sky!,
        day: { ...PAINTED_SKY_DAY, horizon: '#123456', zenith: '#654321' },
      },
    );

    resetPaintWorldState();

    expect(snapshot(PAINT_UNIFORMS)).toEqual(snapshot(createPaintUniforms()));
    // Every object value keeps its identity (compiled programs bind them by reference).
    for (const [i, name] of Object.keys(PAINT_UNIFORMS).entries()) {
      if (typeof identities[i] === 'object') expect(PAINT_UNIFORMS[name].value, name).toBe(identities[i]);
    }
    // The role table is forgotten: an untagged material takes the neutral default again.
    expect(paintRoleFor('figure')).toEqual({ k: 1, rimScale: 1, bandMix: 0.55 });
    expect(LEAF_SSS.value).toBe(LEAF_SSS_LEVELS.day);
    expect(LEAF_SIL.value).toBe(0);
    expect(LEAF_LAMP.value.toArray()).toEqual([0, 0, 0]);
    const fresh = createSkyUniforms();
    for (const [i, name] of Object.keys(SKY_UNIFORMS).entries()) {
      const value = SKY_UNIFORMS[name].value as unknown;
      if (typeof skyIdentities[i] === 'object') expect(value, name).toBe(skyIdentities[i]);
      const want = fresh[name].value as unknown;
      if (value instanceof THREE.Color || value instanceof THREE.Vector3) expect(value.toArray(), name).toEqual((want as THREE.Color).toArray());
      else expect(value, name).toEqual(want);
    }
    expect(SKY_UNIFORMS.uDayHorizon.value.getHexString()).toBe(new THREE.Color(PAINTED_SKY_DAY.horizon).getHexString());
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WINDOW_LOOK } from '@/components/world/evoliga/route/plaza/HaussmannBlock';
import { UPPER_WINDOW_LIGHT_SHARE } from '@/lib/route-world/haussmann';
import {
  CONTRE_JOUR,
  paintSetForRung,
  POST_OFF_KEY_NEUTRAL,
  POST_OFF_SATURATION,
  POST_OFF_SHADE_SHIFT,
} from '@/components/world/evoliga/route/env/Lighting';
import {
  EDGE_GRIME,
  GROUND_EMISSIVE_GLSL,
  groundMapGlsl,
  MACRO_FIELD,
  MACRO_VALUE,
  MEDALLION_NORTH_MIX,
  MEDALLION_VALUES,
  PAINT_GROUND_KEY,
  WET_SETT_REFLECTION,
} from '@/components/world/evoliga/route/plaza/paint-ground';
import { GATE_DAY_MATERIAL_TONE } from '@/components/world/evoliga/route/plaza/ChallengeGate';
import { NIGHT_CANOPY_TINT } from '@/components/world/evoliga/route/plaza/Trees';
import { GAP_SHAFT_MIN_RUNG_SHAFTS, instanceCount, SHAFT_CAPACITY } from '@/components/world/evoliga/route/env/SunShafts';
import { gapShaftSeats, plazaShaftSeats, SHAFT_MAX } from '@/lib/route-world/light-shafts';
import { QUALITY_LADDER } from '@/lib/route-world/quality';
import {
  CONTACT_BLOB_COLOR,
  CONTACT_BLOB_OPACITY,
} from '@/components/world/route/figures/ContactBlobs';
import { SKY_DAY_LUMA_CAP, SKY_RAYS } from '@/components/world/route/env/paint-fx';
import { CANOPY_PROGRAM_KEY, CANOPY_SSS_GLSL, LEAF_GOLD, leafTranslucency } from '@/components/world/route/trees/tree-cards';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { PAINT_PARS_GLSL, PAINT_PROGRAM_KEY, PAINT_SAT_GLSL } from '../painted-light';
import { applyPaintSet, createPaintUniforms, linearLuma } from '../paint-uniforms';

/**
 * LOOK round 5 (ART DIRECTOR, final round): the global lilac haze is gone
 * (air only beyond 30 m, a small lift), shade is the local albedo darker
 * (cast shade cool, form shade near-neutral, shade chroma kept), a warmer
 * and stronger key, honey stone, the rules gap beams and golden crown rims,
 * a muted medallion inlay, a visible ground field, and a brighter night.
 * Uniform values and GLSL shape only — the look itself is judged in captures.
 */

const day = PLAZA_PAINT.day;
const night = PLAZA_PAINT.night;

describe('LOOK r5: no global haze', () => {
  it('aerial perspective starts beyond 30 m with a small chroma and value lift', () => {
    // LOOK r6 (L5): the CHROMA recession starts at 18 m; the value lift (the
    // haze history) still starts beyond 30 m.
    expect(day.air.start).toBeGreaterThanOrEqual(15);
    expect(day.air.liftStart).toBeGreaterThanOrEqual(30);
    expect(day.air.lift).toBeLessThanOrEqual(0.08);
    // LOOK r6 (L5): chroma-only recession is allowed more pull (never a value lift).
    expect(day.air.chroma).toBeLessThanOrEqual(0.25);
  });

  it('the IBL is near-neutral cool and the fill steps back from the key', () => {
    const ibl = new THREE.Color(day.ibl?.tint ?? '#ffffff');
    expect(ibl.b / ibl.r).toBeLessThan(2.2);
    expect(day.ibl?.environment ?? 1).toBeLessThanOrEqual(0.45);
    expect(day.shadow.lift).toBeLessThanOrEqual(0.2);
    expect(day.shadow.form?.lift ?? 1).toBeLessThanOrEqual(0.25);
  });

  it('the key is warm (R > G > B) and stronger than r4', () => {
    const key = new THREE.Color(day.key.color);
    expect(key.r).toBeGreaterThan(key.g);
    expect(key.g).toBeGreaterThan(key.b * 1.5);
    expect(day.key.intensity).toBeGreaterThan(5);
  });
});

describe('LOOK r5: cast vs form shade, chroma kept', () => {
  it('writes the form fill and the shade saturation into the shared uniforms', () => {
    const u = createPaintUniforms();
    applyPaintSet(day, plazaTheme.lights.keyDirection, u);
    const form = day.shadow.form!;
    expect(linearLuma(u.uShadowForm.value.r, u.uShadowForm.value.g, u.uShadowForm.value.b)).toBeCloseTo(form.lift, 5);
    expect(u.uShadeSat.value).toBe(day.shadeSat);
    // Night has no form set: the form fill falls back to the cast fill.
    applyPaintSet(night, plazaTheme.lights.keyDirection, u);
    expect(u.uShadowForm.value.equals(u.uShadowFill.value)).toBe(true);
    expect(u.uShadeSat.value).toBe(0);
  });

  it('the GLSL splits cast / form shade on N·L and boosts the shade chroma', () => {
    expect(PAINT_PROGRAM_KEY).toBe('paint-v6');
    expect(PAINT_PARS_GLSL).toContain('float paintSunward = smoothstep( - 0.05, 0.3, ndl );');
    expect(PAINT_PARS_GLSL).toContain('mix( uShadowForm, uShadowFill, paintSunward )');
    expect(PAINT_PARS_GLSL).toContain('float paintShade = 0.0;');
    expect(PAINT_SAT_GLSL).toContain('uShadeSat * paintShade');
  });

  it('the post-off rungs take no shade boost, a quarter shade shift and a half-neutral key', () => {
    const post = paintSetForRung(day, true);
    expect(post).toBe(day);
    const off = paintSetForRung(day, false);
    expect(off.shadeSat).toBe(0);
    expect(off.shadow.form?.tint).not.toBe(day.shadow.form?.tint);
    expect(POST_OFF_SHADE_SHIFT.mix).toBeLessThanOrEqual(0.3);
    expect(POST_OFF_KEY_NEUTRAL.mix).toBeGreaterThanOrEqual(0.5);
    expect(POST_OFF_SATURATION).toBeLessThanOrEqual(1);
  });

  it('the rules contre-jour doubles the warm bounce into shade', () => {
    expect(CONTRE_JOUR.bounce).toBeGreaterThanOrEqual(1.6);
  });
});

describe('LOOK r5: rules hero', () => {
  it('gap beams are drawn first from rung lightShafts ≥ 2, within capacity', () => {
    const seats = plazaShaftSeats();
    const gap = gapShaftSeats(plazaTheme.lights.keyDirection);
    expect(SHAFT_CAPACITY).toBe(SHAFT_MAX + gap.length);
    for (const step of QUALITY_LADDER) {
      const n = instanceCount(step.lightShafts, seats, gap);
      expect(n).toBeLessThanOrEqual(SHAFT_CAPACITY);
      if (step.lightShafts >= GAP_SHAFT_MIN_RUNG_SHAFTS) expect(n).toBeGreaterThanOrEqual(gap.length);
      if (step.lightShafts === 0) expect(n).toBe(0);
    }
  });

  it('crown rims transmit a warm gold, stronger at the rim than the core', () => {
    expect(CANOPY_PROGRAM_KEY).toBe('tree-canopy-painted-v4');
    expect(CANOPY_SSS_GLSL).toContain('sssEdge');
    const input = { albedo: [0.2, 0.35, 0.1] as const, light: [1, 1, 1] as const, back: 1, alpha: 1, strength: 1.5 };
    const core = leafTranslucency({ ...input, ao: 0.55 });
    const rim = leafTranslucency({ ...input, ao: 1 });
    // The rim leans warm (red over green rises) against the core's leaf green.
    expect(rim[0] / rim[1]).toBeGreaterThan(core[0] / core[1]);
    expect(LEAF_GOLD.gold[0]).toBeGreaterThan(LEAF_GOLD.gold[1]);
  });

  it('the sky fan is fewer, broader, higher-contrast rays over a lighter wash; the sky cap stays soft', () => {
    expect(SKY_RAYS.strength).toBeGreaterThan(SKY_RAYS.wash);
    expect(SKY_DAY_LUMA_CAP.peak).toBeLessThanOrEqual(0.8);
  });

  it('the day gate material is honey while the frieze sign keeps its painted tone', () => {
    const dressed = new THREE.Color(GATE_DAY_MATERIAL_TONE.dressed);
    expect(dressed.g - dressed.b).toBeGreaterThan(dressed.r - dressed.g);
  });
});

describe('LOOK r5: ground story and medallion', () => {
  it('bumps the ground key; macro ±0.3 plus a procedural field; edge grime outside the plaza core', () => {
    expect(PAINT_GROUND_KEY).toBe('paint-ground-v5');
    expect(MACRO_VALUE).toBeCloseTo(0.3);
    expect(MACRO_FIELD.value).toBeGreaterThan(0);
    expect(EDGE_GRIME.from).toBeGreaterThan(12);
    const glsl = groundMapGlsl();
    expect(glsl).toContain('pgEdge');
    expect(glsl).toContain('pgField');
  });

  it('the medallion reads by its outline: muted halves, a dark ring at the ΔL limit', () => {
    expect(MEDALLION_NORTH_MIX).toBeLessThanOrEqual(0.35);
    expect(MEDALLION_VALUES.light).toBeLessThanOrEqual(1.25);
    expect(MEDALLION_VALUES.dark).toBeLessThan(MEDALLION_VALUES.north);
  });

  it('wet setts carry a share of the practicals’ streaks outside the puddles', () => {
    expect(WET_SETT_REFLECTION).toBeGreaterThan(0);
    expect(GROUND_EMISSIVE_GLSL).toContain(`mix( ${WET_SETT_REFLECTION.toFixed(2)}, 1.0, pgPuddle )`);
  });
});

describe('LOOK r5: figures and night', () => {
  it('contact blobs are firmer and violet', () => {
    expect(CONTACT_BLOB_OPACITY.day).toBeGreaterThanOrEqual(0.45);
    const c = new THREE.Color(CONTACT_BLOB_COLOR);
    expect(c.b).toBeGreaterThan(c.g);
  });

  it('the painted rim is brighter (figures) while stone takes half', () => {
    expect(day.rim.strength).toBeGreaterThanOrEqual(0.8);
    expect(day.roles.env.rimScale).toBeLessThan(day.roles.figure.rimScale);
    // LOOK r6: the fresnel power is a uniform (4.5 by day, 2.6 at night).
    expect(PAINT_PARS_GLSL).toContain('uRimPow');
  });

  it('night: more lit panes, dim warm interiors, warm lamp pools, deep blue-green crowns', () => {
    expect(UPPER_WINDOW_LIGHT_SHARE).toBeGreaterThanOrEqual(0.3);
    expect(UPPER_WINDOW_LIGHT_SHARE).toBeLessThanOrEqual(0.4);
    const interior = new THREE.Color(WINDOW_LOOK.night.interior);
    expect(interior.r).toBeGreaterThan(interior.b);
    expect(WINDOW_LOOK.night.litGain).toBeGreaterThanOrEqual(2.4);
    expect(night.pointWarm?.strength ?? 0).toBeGreaterThan(1.15);
    const leaf = new THREE.Color(NIGHT_CANOPY_TINT);
    expect(leaf.g).toBeGreaterThan(leaf.r);
    expect(leaf.b).toBeGreaterThan(leaf.r);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  blockLotBays,
  blockWeatherFrame,
  FACADE_LOT_BAYS,
  WINDOW_FRAGMENT_PARS,
  WINDOW_PROGRAM_KEY,
  WINDOW_ROOM,
  writeSlotLook,
} from '@/components/world/evoliga/route/plaza/HaussmannBlock';
import {
  ASHLAR_MAP_GLSL,
  ASHLAR_PROGRAM_KEY,
  ASHLAR_WEATHERING,
  ashlarUniforms,
  patchAshlar,
  writeAshlarBlock,
} from '@/components/world/themes/plaza/paint-ashlar';
import {
  PLAZA_BLOCK_TINTS,
  PLAZA_PAINT,
  PLAZA_STONE_TINT_R5,
  plazaBlockTint,
  type PlazaBlockId,
} from '@/components/world/themes/plaza/theme-palette';
import { plazaBlockPlans, blockToWorld, HAUSSMANN } from '@/lib/route-world/haussmann';
import { PLAZA } from '@/lib/route-world/layout';
import { GROUND_PARS_GLSL, PAINT_GROUND_KEY, STREAK, WET_LANE_SLOTS } from '@/components/world/evoliga/route/plaza/paint-ground';
import { instanceCount, SHAFT_FRAGMENT, SHAFT_VERTEX } from '@/components/world/evoliga/route/env/SunShafts';
import {
  GAP_SHAFT_MIN_Z,
  GAP_SHAFT_WIDTH,
  gapShaftSeats,
  plazaShaftSeats,
  SHAFT_CLEARANCE_M,
  SHAFT_MAX_LINEAR,
  SHAFT_TAPER,
  shaftSampleRadius,
} from '@/lib/route-world/light-shafts';
import { QUALITY_LADDER } from '@/lib/route-world/quality';
import {
  CANOPY_PROGRAM_KEY,
  CANOPY_SSS_GLSL,
  LEAF_LAMP,
  LEAF_SIL,
  LEAF_SSS_CLAMP,
  lampProximity,
  leafSilhouette,
  leafTranslucency,
} from '@/components/world/route/trees/tree-cards';
import { NIGHT_CANOPY_TINT, PLAZA_CANOPY_LAMPS, PLAZA_LEAF_LOOK } from '@/components/world/evoliga/route/plaza/Trees';
import { PLAZA_LINDEN_SKIN, PLAZA_PLANE_SKIN } from '@/components/world/evoliga/route/plaza/tree-skin';
import {
  CALM_CLOUD_CONTRAST,
  PAINTED_SKY_DAY,
  SKY_COVER_BIAS,
  SKY_DAY_LUMA_CAP,
  SKY_RAYS,
  SKY_SHADOW_RAY,
} from '@/components/world/route/env/paint-fx';
import {
  clearLampHalos,
  LAMP_HALO,
  plazaLampHaloSeats,
} from '@/lib/route-world/plaza-emitters';
import { plazaLampHalos } from '@/components/world/evoliga/route/plaza/LampHalos';
import { PLAZA_TEAMS_LAMPS } from '@/lib/route-world/teams-formation';
import { PAINT_CEIL_GLSL, PAINT_PARS_GLSL, PAINT_PROGRAM_KEY } from '../painted-light';
import { applyPaintSet, createPaintUniforms, DEFAULT_RIM_POWER, linearLuma } from '../paint-uniforms';

/**
 * LOOK round 6 (D28, R6-BRIEF §1): a palette per building + façade lots (L1),
 * cool CAST shade as hue at matched luma (L2), ashlar v3 weathering, storey
 * bands and reveals (L3), the rules beams and gold backlit canopies (L4),
 * deeper sky and chroma recession (L5), and the night set (L6). Uniform values,
 * pure laws and GLSL shape only — the look itself is judged in captures.
 */

const day = PLAZA_PAINT.day;
const night = PLAZA_PAINT.night;

function srgbLuminance(hex: string): number {
  const c = new THREE.Color(hex);
  return linearLuma(c.r, c.g, c.b);
}

function lab(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  const x = (0.4124 * c.r + 0.3576 * c.g + 0.1805 * c.b) / 0.95047;
  const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const z = (0.0193 * c.r + 0.1192 * c.g + 0.9505 * c.b) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const deltaE = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

const BLOCKS: PlazaBlockId[] = ['north', 'west', 'east', 'south-west', 'south-east'];
const ADJACENT: [PlazaBlockId, PlazaBlockId][] = [
  ['north', 'west'],
  ['north', 'east'],
  ['west', 'south-west'],
  ['east', 'south-east'],
  ['south-west', 'south-east'],
];

describe('LOOK r6 L1: a palette per building', () => {
  it('names every plaza block and keeps each day swatch within −4 % … +6 % of the r5 stone (each backs a face)', () => {
    expect(plazaBlockPlans(PLAZA.half).map((p) => p.id).sort()).toEqual([...BLOCKS].sort());
    const ref = srgbLuminance(PLAZA_STONE_TINT_R5.day.stone);
    for (const id of BLOCKS) {
      const rel = srgbLuminance(PLAZA_BLOCK_TINTS[id].day.stone) / ref - 1;
      expect(rel, id).toBeGreaterThanOrEqual(-0.04);
      expect(rel, id).toBeLessThanOrEqual(0.06);
    }
  });

  it('adjacent blocks differ in the swatch (ΔE76 ≥ 3), and the set spans grey to honey', () => {
    for (const [a, b] of ADJACENT) {
      expect(deltaE(PLAZA_BLOCK_TINTS[a].day.stone, PLAZA_BLOCK_TINTS[b].day.stone), `${a}/${b}`).toBeGreaterThanOrEqual(3);
    }
    const chroma = (hex: string) => {
      const [, a, b] = lab(hex);
      return Math.hypot(a, b);
    };
    expect(chroma(PLAZA_BLOCK_TINTS.east.day.stone)).toBeGreaterThan(chroma(PLAZA_BLOCK_TINTS.west.day.stone) + 10);
  });

  it('shade is darker and cooler than its stone; night ≈ 0.6× with the grey blocks bluer', () => {
    for (const id of BLOCKS) {
      const t = PLAZA_BLOCK_TINTS[id];
      expect(srgbLuminance(t.day.shade)).toBeLessThan(srgbLuminance(t.day.stone));
      const s = new THREE.Color(t.day.stone);
      const sh = new THREE.Color(t.day.shade);
      expect(sh.b / sh.r).toBeGreaterThan(s.b / s.r);
      const ratio = srgbLuminance(t.night.stone) / srgbLuminance(t.day.stone);
      expect(ratio, id).toBeGreaterThan(0.2);
      expect(ratio, id).toBeLessThan(0.45);
    }
    const west = new THREE.Color(PLAZA_BLOCK_TINTS.west.night.stone);
    expect(west.b).toBeGreaterThan(west.r);
  });

  it('an unknown block keeps the r5 pair', () => {
    expect(plazaBlockTint('nowhere', false)).toEqual(PLAZA_STONE_TINT_R5.day);
    expect(plazaBlockTint('west', true)).toEqual(PLAZA_BLOCK_TINTS.west.night);
  });

  it('the self-glow follows the swatch (uniform writes only)', () => {
    const stone = new THREE.MeshStandardMaterial({ emissive: '#d8d0c0' });
    const shade = new THREE.MeshStandardMaterial({ emissive: '#b4a890' });
    const lamp = new THREE.MeshBasicMaterial();
    writeSlotLook({ stone, shade, lamp }, false, true, '#dfdcd0', '#c0c1bc');
    expect(stone.emissive.getHexString()).toBe('dfdcd0');
    expect(shade.emissive.getHexString()).toBe('c0c1bc');
  });

  it('lots step every FACADE_LOT_BAYS bays with the wall direction sign; the GLSL gates them on uAshBay.w', () => {
    for (const plan of plazaBlockPlans(PLAZA.half)) {
      const lots = blockLotBays(plan);
      expect(Math.abs(lots)).toBe(FACADE_LOT_BAYS);
      const a = blockToWorld(plan, 0, 0, 0);
      const b = blockToWorld(plan, 1, 0, 0);
      const along = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]) ? b[0] - a[0] : b[2] - a[2];
      expect(Math.sign(lots)).toBe(Math.sign(along));
    }
    expect(ASHLAR_MAP_GLSL).toContain('abs( uAshBay.w )');
    expect(ASHLAR_WEATHERING.lot.value).toBeLessThanOrEqual(0.16);
  });
});

describe('LOOK r6 L3: ashlar v3 — weathering, storey bands, reveals', () => {
  it('bumps the one shared key and keeps furniture unweathered (uAshBlock.y = 0) until a block writes it', () => {
    expect(ASHLAR_PROGRAM_KEY).toBe('paint-ashlar-v3');
    const plinth = new THREE.MeshStandardMaterial();
    const u = patchAshlar(plinth, { courseOn: 0 });
    expect(u.uAshBlock.value.y).toBe(0);
    expect(u.uAshBay.value.w).toBe(0);
    const facade = new THREE.MeshStandardMaterial();
    patchAshlar(facade, { bayPhase: 1, lotBays: -4 });
    writeAshlarBlock(facade, { top: 6.75, weather: 1.3, cool: 1, axis: 1 });
    expect(ashlarUniforms(facade)?.uAshBlock.value.toArray()).toEqual([6.75, 1.3, 1, 1]);
    expect(ashlarUniforms(facade)?.uAshBay.value.w).toBe(-4);
    // No-op on an unpatched material.
    expect(() => writeAshlarBlock(new THREE.MeshStandardMaterial(), { top: 1, weather: 1, cool: 1, axis: 0 })).not.toThrow();
  });

  it('every r6 term is façade-gated and multiplied by ashKeep (flat inside the calm boxes)', () => {
    expect(ASHLAR_MAP_GLSL).toContain('float ashFac = step( 1e-3, uAshBlock.y );');
    expect(ASHLAR_MAP_GLSL).toContain('mix( vec3( 1.0 ), ashBand, ashKeep )');
    expect(ASHLAR_MAP_GLSL).toContain('ashWeather * ashKeep');
    expect(ASHLAR_MAP_GLSL).toContain('ashJamb * ashKeep');
    // Weathering darkens AND cools; the podium is darker and cooler (≥ 8 % value step).
    const [r, g, b] = ASHLAR_WEATHERING.tint;
    expect(r).toBeLessThan(g);
    expect(g).toBeLessThan(b);
    const podium = 0.2126 * ASHLAR_WEATHERING.podium[0] + 0.7152 * ASHLAR_WEATHERING.podium[1] + 0.0722 * ASHLAR_WEATHERING.podium[2];
    expect((1 + ASHLAR_WEATHERING.nobile) / podium - 1).toBeGreaterThanOrEqual(0.08);
    expect(ASHLAR_WEATHERING.baseM).toBe(2.2);
    expect(ASHLAR_WEATHERING.streak).toBe(1.8);
  });

  it('band edges are feathered over ≥ 0.15 m', () => {
    expect(ASHLAR_MAP_GLSL).toContain('smoothstep( uAshCourse.x - 0.15, uAshCourse.x + 0.15, ashY )');
    expect(ASHLAR_MAP_GLSL).toContain('0.15 / ashLotW');
  });

  it('the weathering frame is the cornice line and the façade axis of each block', () => {
    for (const plan of plazaBlockPlans(PLAZA.half)) {
      const frame = blockWeatherFrame(plan);
      expect(frame.top).toBeCloseTo(HAUSSMANN.podiumHeight + plan.upperFloors * HAUSSMANN.floorHeight, 6);
      expect(frame.axis).toBe(Math.abs(Math.sin(plan.rotationY)) > 0.5 ? 1 : 0);
    }
  });
});

describe('LOOK r6 L2: cool CAST shade as hue at matched luma', () => {
  it('bumps the paint key and writes a unit-luma cool hue by day, none at night', () => {
    expect(PAINT_PROGRAM_KEY).toBe('paint-v6');
    const u = createPaintUniforms();
    applyPaintSet(day, [-26, 12, 18], u);
    const h = u.uShadeHue.value;
    expect(linearLuma(h.x, h.y, h.z)).toBeCloseTo(1, 5);
    expect(h.z).toBeGreaterThan(h.y);
    expect(h.y).toBeGreaterThan(h.x); // G above R: blue + warm stone never mixes to mauve
    expect(h.w).toBeGreaterThan(0.3);
    applyPaintSet(night, [-26, 12, 18], u);
    expect(u.uShadeHue.value.w).toBe(0);
  });

  it('shifts cast shade (sunward, unlit) — direct fill and sky light — and boosts only FORM shade chroma', () => {
    expect(PAINT_PARS_GLSL).toContain('float castT = paintSunward * ( 1.0 - amt );');
    expect(PAINT_PARS_GLSL).toContain('paintShade = max( paintShade, ( 1.0 - amt ) - castT );');
    expect(PAINT_CEIL_GLSL).toContain('paintCast * uShadeHue.w');
  });
});

describe('LOOK r6 L4a: the rules beams', () => {
  it('beams taper from the pool, keep their strength to 82 % of their length and fade down their own axis', () => {
    expect(SHAFT_TAPER.pool).toBeGreaterThan(SHAFT_TAPER.top);
    expect(SHAFT_TAPER.top).toBe(0.7);
    expect(SHAFT_VERTEX).toContain('vAxial');
    expect(SHAFT_FRAGMENT).toContain('1.0 - smoothstep( 0.82, 1.0, vShaft.y )');
    expect(SHAFT_FRAGMENT).toContain('1.0 - smoothstep( 0.75, 0.97, vAxial )');
    expect(SHAFT_MAX_LINEAR).toBe(0.8);
  });

  it('the keep-out radius holds the DRAWN (widest) beam — tightened, never loosened', () => {
    expect(shaftSampleRadius(1)).toBeCloseTo(SHAFT_TAPER.pool / 2 + SHAFT_CLEARANCE_M, 9);
    expect(shaftSampleRadius(1)).toBeGreaterThan(1 / 2 + SHAFT_CLEARANCE_M);
  });

  it('gap beams are 1.2–2.0 m wide, wholly behind the gate plane, spaced ≥ 2 m apart', () => {
    const gap = gapShaftSeats([-26, 12, 18]);
    for (const seat of gap) {
      expect(seat.width).toBeGreaterThanOrEqual(GAP_SHAFT_WIDTH[0]);
      expect(seat.width).toBeLessThanOrEqual(GAP_SHAFT_WIDTH[1]);
      expect(seat.pool[2]).toBeGreaterThanOrEqual(GAP_SHAFT_MIN_Z);
    }
    for (let i = 0; i < gap.length; i += 1) {
      for (let j = i + 1; j < gap.length; j += 1) {
        expect(Math.hypot(gap[i].pool[0] - gap[j].pool[0], gap[i].pool[2] - gap[j].pool[2])).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('rung 2 (one shaft) draws the hero gap beam; rungs 0–1 every gap beam and ground seats', () => {
    const seats = plazaShaftSeats();
    const gap = gapShaftSeats([-26, 12, 18]);
    expect(QUALITY_LADDER.map((s) => s.lightShafts)).toEqual([3, 2, 1, 0, 0]);
    expect(instanceCount(1, seats, gap)).toBe(1);
    expect(gap[0].id).toBe('shaft:gap-hero');
    expect(instanceCount(2, seats, gap)).toBe(gap.length + 2);
    expect(instanceCount(3, seats, gap)).toBe(gap.length + 3);
    expect(instanceCount(0, seats, gap)).toBe(0);
  });
});

describe('LOOK r6 L4b: gold backlit canopies with a dark cool core', () => {
  const albedo = [0.04, 0.12, 0.06] as const;
  const base = { albedo, light: [4, 3.2, 1.8] as const, back: 0.8, alpha: 1, strength: 1.5 };

  it('bumps the canopy key; the silhouette and lamp uniforms default to 0 (sakura, mountain, clouds untouched)', () => {
    expect(CANOPY_PROGRAM_KEY).toBe('tree-canopy-painted-v4');
    expect(LEAF_SIL.value).toBe(0);
    expect(LEAF_LAMP.value.r + LEAF_LAMP.value.g + LEAF_LAMP.value.b).toBe(0);
    expect(CANOPY_SSS_GLSL).toContain('uLeafSil');
    expect(CANOPY_SSS_GLSL).toContain('uLeafLamp * vLeafLamp');
  });

  it('the edge transmits gold (R ≥ G), albedo-independent, and stays under the clamp', () => {
    const edge = leafTranslucency({ ...base, ao: 1, facing: 0 });
    expect(edge[0]).toBeGreaterThanOrEqual(edge[1]);
    for (const c of edge) expect(c).toBeLessThanOrEqual(LEAF_SSS_CLAMP);
    // A bluer leaf transmits the same gold at the edge (the hue no longer follows the albedo).
    const blue = leafTranslucency({ ...base, albedo: [0.03, 0.1, 0.09], ao: 1, facing: 0 });
    expect(blue[0] / blue[1]).toBeCloseTo(edge[0] / edge[1], 1);
  });

  it('the core (facing the eye) is ≥ 25 % darker than the rim, and the silhouette darkens it further', () => {
    const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const rim = leafTranslucency({ ...base, ao: 1, facing: 0 });
    const core = leafTranslucency({ ...base, ao: 1, facing: 1 });
    expect(lum(core)).toBeLessThanOrEqual(0.75 * lum(rim));
    const sil = leafSilhouette({ ao: 1, back: 0.8, sil: 1, facing: 1 });
    expect(sil.indirect).toBeLessThan(sil.direct);
    expect(sil.direct).toBeLessThan(1);
    expect(leafSilhouette({ ao: 1, back: 0.8, sil: 0, facing: 1 })).toEqual({ indirect: 1, direct: 1 });
    // Sun behind the eye: no silhouette.
    expect(leafSilhouette({ ao: 1, back: 0, sil: 1, facing: 1 })).toEqual({ indirect: 1, direct: 1 });
  });

  it('the plaza leaves are blue-green (B above R) with no sage bloom', () => {
    for (const skin of [PLAZA_LINDEN_SKIN, PLAZA_PLANE_SKIN]) {
      for (const leaf of [skin.leafA, skin.leafB]) {
        expect(leaf.base.b).toBeGreaterThan(leaf.base.r);
        if (leaf.bloom) expect(leaf.bloom.r).toBeGreaterThan(leaf.bloom.b + 60); // a warm gold catch, never sage
      }
    }
    expect(PLAZA_LEAF_LOOK.day.sil).toBe(1);
    expect(PLAZA_LEAF_LOOK.night.lamp).toBeGreaterThan(0);
    expect(PLAZA_LEAF_LOOK.day.lamp).toBe(0);
  });
});

describe('LOOK r6 L5: depth — chroma recession and a sky with body', () => {
  it('day air starts at 18 m with chroma 0.2 and the r5 value lift', () => {
    expect(day.air.start).toBe(18);
    expect(day.air.chroma).toBe(0.2);
    expect(day.air.density).toBe(0.035);
    expect(day.air.lift).toBe(0.07);
  });

  it('deepens the zenith, keeps the luma cap and calm contrast, and paints shadow rays between the lit ones', () => {
    expect(PAINTED_SKY_DAY.zenith).toBe('#4a8fd0');
    expect(srgbLuminance(PAINTED_SKY_DAY.zenith)).toBeLessThan(srgbLuminance('#5c9fd8'));
    expect(SKY_DAY_LUMA_CAP).toEqual({ knee: 0.5, peak: 0.78 });
    expect(CALM_CLOUD_CONTRAST).toBe(0.15);
    expect(SKY_COVER_BIAS.sun).toBeGreaterThan(0);
    for (const v of SKY_SHADOW_RAY) expect(v).toBeLessThanOrEqual(1);
    expect(SKY_RAYS.shadow).toBeGreaterThan(0);
  });
});

describe('LOOK r6 L6: night', () => {
  it('a wide cool moon rim and a moon catch at night; the day rim power stays 4.5', () => {
    expect(night.rim).toEqual({ color: '#9fb0ff', strength: 0.6 });
    expect(night.rimPower).toBe(2.6);
    expect(day.rimPower ?? DEFAULT_RIM_POWER).toBe(4.5);
    expect(night.moonCatch?.color).toBe('#9fb0ff');
    expect(night.roles.foliage.rimScale).toBeLessThan(day.roles.foliage.rimScale);
    expect(PAINT_PARS_GLSL).toContain('uMoonCatch');
    expect(PAINT_PARS_GLSL).toContain('rimFlat');
  });

  it('a teal-blue night air and a board-first luma ceiling (off by day)', () => {
    expect(night.air.hue).toBe('#2f5f86');
    expect(night.air.chroma).toBe(0.45);
    expect(night.air.lift).toBe(0);
    expect(night.hemisphere.sky).toBe('#2a4470');
    const u = createPaintUniforms();
    applyPaintSet(night, [-26, 12, 18], u);
    expect(u.uLumaCeil.value).toBeGreaterThan(0);
    applyPaintSet(day, [-26, 12, 18], u);
    expect(u.uLumaCeil.value).toBeLessThan(0);
    expect(NIGHT_CANOPY_TINT).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('lamp halos: radius + pad ≤ 1 m, gain 0 by day, the gate lanterns kept, never the teams lamps', () => {
    expect(LAMP_HALO.radius + LAMP_HALO.pad).toBeLessThanOrEqual(1.0);
    expect(LAMP_HALO.gain.day).toBe(0);
    const halos = plazaLampHalos();
    expect(halos.some((h) => h.id === 'halo:gate-lantern:left')).toBe(true);
    expect(halos.some((h) => h.id === 'halo:gate-lantern:right')).toBe(true);
    for (const seat of PLAZA_TEAMS_LAMPS) {
      expect(plazaLampHaloSeats().some((h) => h.center[0] === seat[0] && h.center[2] === seat[1])).toBe(false);
    }
    // The cull has teeth.
    expect(clearLampHalos(plazaLampHaloSeats(), () => false)).toEqual([]);
  });

  it('streaks are narrow and long toward the source on standing water (puddles, wet lanes)', () => {
    expect(PAINT_GROUND_KEY).toBe('paint-ground-v5');
    expect(STREAK.width).toBeLessThan(0.06);
    expect(STREAK.toward).toBeGreaterThan(STREAK.away);
    expect(GROUND_PARS_GLSL).toContain('streakFar');
    expect(GROUND_PARS_GLSL).toContain('pgLaneWet');
    expect(WET_LANE_SLOTS).toBeGreaterThanOrEqual(2);
  });

  it('canopy lamp under-light is baked against the non-teams lamp heads, 0 far from a lamp', () => {
    expect(PLAZA_CANOPY_LAMPS.length).toBeGreaterThan(0);
    for (const lamp of PLAZA_CANOPY_LAMPS) {
      expect(PLAZA_TEAMS_LAMPS.some((seat) => seat[0] === lamp[0] && seat[1] === lamp[2])).toBe(false);
    }
    const at = lampProximity([[0, 4, 0]], [0, 0, 0], 0);
    expect(at(0, 4, 0)).toBeCloseTo(1, 6);
    expect(at(10, 4, 0)).toBe(0);
    // Tree yaw is applied (three's rotation about +Y).
    const turned = lampProximity([[1, 0, 0]], [0, 0, 0], Math.PI / 2);
    expect(turned(0, 0, 1)).toBeCloseTo(1, 6);
  });

  it('interior-mapped windows: key v2, a room that never outshines the r5 lit pane', () => {
    expect(WINDOW_PROGRAM_KEY).toBe('plaza-window-v2');
    expect(WINDOW_FRAGMENT_PARS).toContain('vec3 winRoom(');
    expect(WINDOW_FRAGMENT_PARS).toContain('min( col * ( 0.6 + 0.5 * hot ), vec3( 1.0 ) )');
    expect(WINDOW_ROOM.box.depth).toBeGreaterThan(1);
  });
});

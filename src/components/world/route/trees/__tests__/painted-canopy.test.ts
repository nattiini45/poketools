import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CANOPY_INDICES_PER_CARD,
  TREE_SKINS,
  applyTreeDensity,
  canopyImportanceOrder,
  canopyModeFor,
  crownSphere,
  growTree,
  paintedCanopyCards,
  paintedCanopyDrawCount,
  planPaintedCanopy,
  treeDensityForRung,
  type TreeSkin,
} from '@/lib/route-world/tree';
import {
  CANOPY_AO,
  CANOPY_ANCHORS,
  CANOPY_PROGRAM_KEY,
  CANOPY_SSS_GLSL,
  LEAF_CARD_SIZE,
  LEAF_SSS,
  LEAF_SSS_CLAMP,
  LEAF_SSS_LEVELS,
  buildCanopyGeometry,
  canopyAtlasTexture,
  createCanopyMaterial,
  leafTranslucency,
  paintLeafCardData,
  patchCanopyShader,
  skinSeed,
} from '../tree-cards';
import {
  PLAZA_LINDEN_SKIN,
  PLAZA_PLANE_SKIN,
  PLAZA_TREE_SEATS,
  PLAZA_SKIN_BY_KEY,
} from '@/components/world/evoliga/route/plaza/tree-skin';
import { SAKURA_CHERRY_SKIN, SAKURA_PARK_SKIN } from '@/components/world/themes/sakura/furniture/tree-skin';
import { MOUNTAIN_ALPINE_SKIN, MOUNTAIN_CONIFER_SKIN } from '@/components/world/themes/mountain/furniture/tree-skin';
import { CLOUDS_GROVE_SKIN, CLOUDS_SKY_GARDEN_SKIN } from '@/components/world/themes/clouds/furniture/tree-skin';
import { acquirePaintScope, applyPaintedLight, PAINT_PROGRAM_KEY, resetPaintScopeForTest } from '@/components/world/route/paint/painted-light';

/**
 * LOOK-PLAN §2 SEAT M item 2 — the plaza's painted canopy: the plaza-only
 * skin gate, draw-range density (a quality step moves a range, never the
 * geometry), the merged geometry's normals / AO / wind attributes, the shader
 * anchors, the paint-sweep chain, and the translucency clamp.
 */

const LINDEN_SPEC = { skin: PLAZA_LINDEN_SKIN, heightM: 3.4, seed: 20260981 };

describe('plaza-only skin gate', () => {
  it('the plaza skins, and only they, select the painted canopy', () => {
    expect(canopyModeFor(PLAZA_LINDEN_SKIN)).toBe('painted');
    expect(canopyModeFor(PLAZA_PLANE_SKIN)).toBe('painted');
    for (const seat of PLAZA_TREE_SEATS) expect(canopyModeFor(PLAZA_SKIN_BY_KEY[seat.skin])).toBe('painted');
  });

  it('sakura, mountain, clouds and the demo skins keep the C-100 card path, with no canopy field at all', () => {
    const others: TreeSkin[] = [
      ...TREE_SKINS,
      SAKURA_CHERRY_SKIN,
      SAKURA_PARK_SKIN,
      MOUNTAIN_CONIFER_SKIN,
      MOUNTAIN_ALPINE_SKIN,
      CLOUDS_SKY_GARDEN_SKIN,
      CLOUDS_GROVE_SKIN,
    ];
    for (const skin of others) {
      expect(canopyModeFor(skin), skin.id).toBe('cards');
      expect('canopy' in skin, skin.id).toBe(false);
    }
  });

  it('an unknown canopy value falls back to cards', () => {
    expect(canopyModeFor({ canopy: undefined })).toBe('cards');
    expect(canopyModeFor({ canopy: 'cards' })).toBe('cards');
  });
});

describe('painted canopy — draw-range density', () => {
  const plan = planPaintedCanopy(LINDEN_SPEC);
  const full = growTree(LINDEN_SPEC);

  it('grows once at rung-0 density: the rung-0 card set, every branch level', () => {
    const rung0 = applyTreeDensity(full, treeDensityForRung(0));
    expect(plan.cards).toHaveLength(rung0.cards.length);
    expect(new Set(plan.cards)).toEqual(new Set(rung0.cards));
    expect(plan.structure.branches).toEqual(full.branches);
    expect(plan.structure.cards).toBe(plan.cards);
  });

  it('draws the C-100 tier count per rung — monotone, ≥ 1, never above rung 0', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let rung = 0; rung <= 4; rung += 1) {
      const n = paintedCanopyCards(plan, rung);
      const tier = applyTreeDensity(full, treeDensityForRung(rung)).cards.length;
      expect(n).toBe(Math.max(1, Math.min(tier, plan.cards.length, previous)));
      expect(n).toBeLessThanOrEqual(previous);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(paintedCanopyDrawCount(plan, rung)).toBe(n * CANOPY_INDICES_PER_CARD);
      previous = n;
    }
    expect(paintedCanopyCards(plan, -3)).toBe(paintedCanopyCards(plan, 0));
    expect(paintedCanopyCards(plan, 99)).toBe(paintedCanopyCards(plan, 4));
    expect(paintedCanopyCards(plan, Number.NaN)).toBe(paintedCanopyCards(plan, 0));
  });

  it('a governor step changes only the draw range: the plan and geometry take no rung and rebuild identically', () => {
    const again = planPaintedCanopy({ ...LINDEN_SPEC });
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
    const crown = crownSphere(plan.structure, PLAZA_LINDEN_SKIN.cardScaleM);
    const geometry = buildCanopyGeometry(plan.cards, PLAZA_LINDEN_SKIN.cardScaleM, crown);
    const snapshot = Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attr]) => [name, Array.from(attr.array as ArrayLike<number>)]),
    );
    const versions = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attr]) => [name, (attr as THREE.BufferAttribute).version]));
    const indexVersion = geometry.index?.version;
    for (let rung = 0; rung <= 4; rung += 1) {
      geometry.setDrawRange(0, paintedCanopyDrawCount(plan, rung));
      expect(geometry.drawRange.count).toBe(paintedCanopyCards(plan, rung) * 6);
    }
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      expect((attr as THREE.BufferAttribute).version, name).toBe(versions[name]);
      expect(Array.from(attr.array as ArrayLike<number>), name).toEqual(snapshot[name]);
    }
    expect(geometry.index?.version).toBe(indexVersion);
    geometry.dispose();
  });

  it('importance order is a round-robin over layers, so every density keeps the full crown height', () => {
    const ordered = canopyImportanceOrder(plan.cards);
    expect(new Set(ordered)).toEqual(new Set(plan.cards));
    const layers = new Set(plan.cards.map((card) => card.layer)).size;
    const head = ordered.slice(0, layers).map((card) => card.layer);
    expect(new Set(head).size).toBe(layers);
  });
});

describe('painted canopy — merged geometry', () => {
  const plan = planPaintedCanopy(LINDEN_SPEC);
  const crown = crownSphere(plan.structure, PLAZA_LINDEN_SKIN.cardScaleM);
  const geometry = buildCanopyGeometry(plan.cards, PLAZA_LINDEN_SKIN.cardScaleM, crown);

  it('is ONE indexed geometry: 4 vertices and 6 indices per card, one group spanning the index', () => {
    const n = plan.cards.length;
    expect(geometry.getAttribute('position').count).toBe(n * 4);
    expect(geometry.index?.count).toBe(n * 6);
    expect(geometry.groups).toEqual([{ start: 0, count: n * 6, materialIndex: 0 }]);
    for (const name of ['position', 'normal', 'uv', 'color', 'aSway', 'aPhase']) expect(geometry.getAttribute(name), name).toBeTruthy();
  });

  it('normals lean outward from the crown centre (spherical), AO runs core → rim', () => {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const col = geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i += 1) {
      const r = new THREE.Vector3(pos.getX(i) - crown.center.x, pos.getY(i) - crown.center.y, pos.getZ(i) - crown.center.z);
      if (r.length() < 0.05) continue;
      const n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i));
      expect(n.length()).toBeCloseTo(1, 4);
      expect(n.dot(r.normalize())).toBeGreaterThan(0.6);
      expect(col.getX(i)).toBeGreaterThanOrEqual(CANOPY_AO.core - 1e-6);
      expect(col.getX(i)).toBeLessThanOrEqual(CANOPY_AO.rim + 1e-6);
    }
  });

  it('uvs address the A half or the B half of the atlas per card set', () => {
    const uv = geometry.getAttribute('uv');
    plan.cards.forEach((card, c) => {
      for (let k = 0; k < 4; k += 1) {
        const v = uv.getY(c * 4 + k);
        if (card.set === 'A') expect(v).toBeLessThanOrEqual(0.5 + 1e-6);
        else expect(v).toBeGreaterThanOrEqual(0.5 - 1e-6);
      }
    });
  });

  it('the atlas stacks A over B at the card size', () => {
    const a = paintLeafCardData(PLAZA_LINDEN_SKIN.leafA, 'A', skinSeed(PLAZA_LINDEN_SKIN.id, 2));
    const b = paintLeafCardData(PLAZA_LINDEN_SKIN.leafB, 'B', skinSeed(PLAZA_LINDEN_SKIN.id, 3));
    const atlas = canopyAtlasTexture(a, b, LEAF_CARD_SIZE);
    expect(atlas.image.width).toBe(LEAF_CARD_SIZE);
    expect(atlas.image.height).toBe(LEAF_CARD_SIZE * 2);
    const data = atlas.image.data as Uint8Array;
    const row = LEAF_CARD_SIZE * 4;
    // Atlas row 0 is A's last painted row (the cardDataTexture flip); row `size` is B's.
    expect(Array.from(data.subarray(0, row))).toEqual(Array.from(a.subarray((LEAF_CARD_SIZE - 1) * row)));
    expect(Array.from(data.subarray(LEAF_CARD_SIZE * row, LEAF_CARD_SIZE * row + row))).toEqual(
      Array.from(b.subarray((LEAF_CARD_SIZE - 1) * row)),
    );
    atlas.dispose();
  });
});

describe('painted canopy — shader', () => {
  const standard = THREE.ShaderLib.standard;

  function descriptor() {
    return {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: standard.vertexShader,
      fragmentShader: standard.fragmentShader,
    };
  }

  it('every anchor exists exactly once in three’s standard shader', () => {
    for (const anchor of CANOPY_ANCHORS.vertex) expect(standard.vertexShader.split(anchor).length - 1, anchor).toBe(1);
    for (const anchor of CANOPY_ANCHORS.fragment) expect(standard.fragmentShader.split(anchor).length - 1, anchor).toBe(1);
    expect(THREE.ShaderChunk.normal_fragment_begin).toContain('normal *= faceDirection;');
  });

  it('patches wind, spherical normals and translucency, binding the shared uniforms by reference', () => {
    const clock = { value: 0 };
    const shader = descriptor();
    patchCanopyShader(shader, clock);
    expect(shader.uniforms.uTime).toBe(clock);
    expect(shader.uniforms.uLeafSSS).toBe(LEAF_SSS);
    expect(shader.vertexShader).toContain('attribute float aSway;');
    expect(shader.vertexShader).toContain('transformed.x += sin(uTime * 1.6 + aPhase) * windAmp;');
    expect(shader.fragmentShader).toContain('uniform float uLeafSSS;');
    expect(shader.fragmentShader).toContain('normal = normalize( vNormal );');
    expect(shader.fragmentShader).toContain(CANOPY_SSS_GLSL);
    expect(shader.fragmentShader.indexOf(CANOPY_SSS_GLSL)).toBeGreaterThan(shader.fragmentShader.indexOf('#include <lights_fragment_end>'));
  });

  it('keys its program stably and chains under the plaza paint sweep', () => {
    resetPaintScopeForTest();
    const release = acquirePaintScope('plaza');
    try {
      const atlas = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      const material = createCanopyMaterial(atlas, { value: 0 });
      expect(material.customProgramCacheKey()).toBe(CANOPY_PROGRAM_KEY);
      expect(material.vertexColors).toBe(true);
      applyPaintedLight(material, 'plaza');
      expect(material.customProgramCacheKey()).toBe(`${CANOPY_PROGRAM_KEY}|${PAINT_PROGRAM_KEY}`);
      const shader = { ...descriptor(), defines: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain(CANOPY_SSS_GLSL);
      expect(shader.fragmentShader).not.toContain('#include <lights_fragment_begin>');
      expect(shader.uniforms.uPaintRole).toBeTruthy();
      material.dispose();
      atlas.dispose();
    } finally {
      release();
      resetPaintScopeForTest();
    }
  });
});

describe('painted canopy — translucency clamp', () => {
  beforeEach(() => {
    LEAF_SSS.value = LEAF_SSS_LEVELS.day;
  });

  it('never exceeds the clamp, even for absurd light and albedo', () => {
    for (const light of [1, 3, 30, 1e4]) {
      for (const albedo of [0.1, 1, 5]) {
        for (const alpha of [0.5, 0.7, 1]) {
          for (const ao of [CANOPY_AO.core, 0.8, CANOPY_AO.rim]) {
            const out = leafTranslucency({ albedo: [albedo, albedo, albedo], light: [light, light, light], back: 1, alpha, ao, strength: 10 });
            for (const c of out) expect(c).toBeLessThanOrEqual(LEAF_SSS_CLAMP);
          }
        }
      }
    }
  });

  it('is zero with the key behind the eye and grows toward contre-jour', () => {
    const base = { albedo: [0.3, 0.5, 0.2] as const, light: [3, 2.2, 1.2] as const, alpha: 0.6, ao: 0.9, strength: LEAF_SSS_LEVELS.day };
    expect(leafTranslucency({ ...base, back: 0 })).toEqual([0, 0, 0]);
    expect(leafTranslucency({ ...base, back: -1 })).toEqual([0, 0, 0]);
    const half = leafTranslucency({ ...base, back: 0.5 })[1];
    const full = leafTranslucency({ ...base, back: 1 })[1];
    expect(full).toBeGreaterThan(half);
    expect(full).toBeGreaterThan(0);
  });

  it('night is far weaker than day; the GLSL carries the same clamp', () => {
    expect(LEAF_SSS_LEVELS.night).toBeLessThan(LEAF_SSS_LEVELS.day);
    // LOOK r2 (art director): softer than the r1 0.9 / 0.15, which with the
    // env rim washed the crowns pale.
    // LOOK r3: the day crowns glow when back-lit (the judged "pale sage" canopy).
    // LOOK r4: stronger, over a broader lobe (the rules crowns sit 40–55° off the sun).
    expect(LEAF_SSS_LEVELS.day).toBeCloseTo(1.5);
    expect(LEAF_SSS_LEVELS.night).toBeCloseTo(0.05);
    expect(LEAF_SSS_CLAMP).toBe(1.2);
    expect(CANOPY_SSS_GLSL).toContain(`vec3( ${LEAF_SSS_CLAMP.toFixed(3)} )`);
    // LOOK r5: the transmitted colour turns warm gold toward the crown rim.
    expect(CANOPY_SSS_GLSL).toMatch(/min\(\s*sssAlb/);
    expect(CANOPY_SSS_GLSL).toContain('sssEdge');
  });
});

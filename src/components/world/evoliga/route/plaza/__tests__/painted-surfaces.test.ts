/**
 * LOOK-PLAN §2 SEAT S — the painted ground and ashlar patches.
 *
 * 1. paint-ground anchors: every string the patch rewrites exists in three
 *    0.185.1 (`texture2D( map, vMapUv )`, both `texture2D( normalMap,
 *    vNormalMapUv )`, `roughnessmap_fragment`, the emissive stage), and the
 *    patched source keeps none of the stock single fetches.
 * 2. Placeholder cache key: the 1×1 placeholder material and the resolved one
 *    compile the SAME program (same key, same defines-bearing slots, same
 *    patched source) — the texture swap links nothing.
 * 3. The ashlar patch: anchors, one shared key, chained under the paint.
 * 4. Medallion ΔL ≤ 15 and no time term anywhere in the ground.
 * 5. Grep: no `useMemo` material rebuild keyed on night or on the rung in the
 *    seat's files.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquirePaintScope,
  applyPaintedLight,
  PAINT_PROGRAM_KEY,
  resetPaintScopeForTest,
} from '@/components/world/route/paint/painted-light';
import {
  ASHLAR_ANCHORS,
  ASHLAR_PROGRAM_KEY,
  ashlarPlaceholderMaps,
  assignAshlarMaps,
  patchAshlar,
  plazaCalmBoxes,
  ASHLAR_SHARED,
} from '@/components/world/themes/plaza/paint-ashlar';
import { MEDALLION } from '@/lib/route-world/plaza-ground';
import {
  createPaintedGround,
  GROUND_ANCHORS,
  GROUND_EMISSIVE_GLSL,
  GROUND_PARS_GLSL,
  GROUND_ROUGHNESS_GLSL,
  groundMapGlsl,
  groundNormalGlsl,
  lightnessOf,
  MEDALLION_VALUES,
  PAINT_GROUND_KEY,
} from '../paint-ground';

type Shader = THREE.WebGLProgramParametersWithUniforms;

function stockShader(): Shader {
  const lib = THREE.ShaderLib.physical;
  return {
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
  } as unknown as Shader;
}

function compile(material: THREE.Material): Shader {
  const shader = stockShader();
  material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
  return shader;
}

/** The material fields three's `getParameters` turns into defines / program keys. */
function programShape(material: THREE.MeshStandardMaterial) {
  const slot = (t: THREE.Texture | null) =>
    t ? { channel: t.channel, isVideo: (t as THREE.VideoTexture).isVideoTexture === true, mapping: t.mapping } : null;
  return {
    key: material.customProgramCacheKey(),
    map: slot(material.map),
    normalMap: slot(material.normalMap),
    normalMapType: material.normalMapType,
    roughnessMap: slot(material.roughnessMap),
    metalnessMap: slot(material.metalnessMap),
    aoMap: slot(material.aoMap),
    emissiveMap: slot(material.emissiveMap),
    transparent: material.transparent,
    vertexColors: material.vertexColors,
    flatShading: material.flatShading,
  };
}

/** A resolved-looking texture: a real (non-data) texture with the tiled() configuration. */
function resolvedTexture(srgb: boolean): THREE.Texture {
  const texture = new THREE.Texture({ width: 1024, height: 1024 } as unknown as HTMLImageElement);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(20, 20);
  texture.anisotropy = 4;
  return texture;
}

afterEach(() => resetPaintScopeForTest());

describe('paint-ground anchors (three 0.185.1)', () => {
  it('finds every rewritten string in three’s chunks and the physical fragment', () => {
    expect(THREE.ShaderChunk.map_fragment).toContain(GROUND_ANCHORS.mapSample);
    expect(THREE.ShaderChunk.normal_fragment_maps.split(GROUND_ANCHORS.normalSample).length - 1).toBe(2);
    const frag = THREE.ShaderLib.physical.fragmentShader;
    for (const anchor of [
      GROUND_ANCHORS.common,
      GROUND_ANCHORS.mapFragment,
      GROUND_ANCHORS.normalMapsFragment,
      GROUND_ANCHORS.roughnessFragment,
      GROUND_ANCHORS.emissiveFragment,
    ]) {
      expect(frag, anchor).toContain(anchor);
    }
  });

  it('rewrites the fetches to the anti-tiled textureGrad pair and keeps the rest of the program', () => {
    const map = groundMapGlsl();
    const normal = groundNormalGlsl();
    expect(map).not.toContain(GROUND_ANCHORS.mapSample);
    expect(map).toContain('textureGrad( map');
    expect(normal).not.toContain(GROUND_ANCHORS.normalSample);
    expect(normal.match(/textureGrad\( normalMap/g)?.length).toBe(2);
    const shader = compile(createPaintedGround().material);
    expect(shader.fragmentShader).not.toContain(GROUND_ANCHORS.mapFragment);
    expect(shader.fragmentShader).not.toContain(GROUND_ANCHORS.normalMapsFragment);
    // The painted light's anchors survive the ground patch (the sweep chains on top).
    for (const anchor of ['#include <lights_fragment_begin>', '#include <lights_physical_pars_fragment>', '#include <fog_fragment>']) {
      expect(shader.fragmentShader).toContain(anchor);
    }
    expect(shader.uniforms.uPgMask).toBeDefined();
    expect(shader.uniforms.uPgEmitA.value.length).toBeGreaterThan(0);
  });

  it('is static: no time uniform, no animation term', () => {
    for (const glsl of [GROUND_PARS_GLSL, groundMapGlsl(), GROUND_ROUGHNESS_GLSL, groundNormalGlsl(), GROUND_EMISSIVE_GLSL]) {
      expect(glsl).not.toMatch(/uTime|time\b/i);
    }
  });
});

describe('placeholder cache key', () => {
  it('the 1×1 placeholder and the resolved set compile one program', () => {
    const ground = createPaintedGround();
    const before = programShape(ground.material);
    const beforeSrc = compile(ground.material).fragmentShader;
    ground.setSurface({ map: resolvedTexture(true), normalMap: resolvedTexture(false) });
    ground.setMask(resolvedTexture(false));
    const after = programShape(ground.material);
    const afterSrc = compile(ground.material).fragmentShader;
    expect(after).toEqual(before);
    expect(afterSrc).toBe(beforeSrc);
    expect(after.key).toBe(PAINT_GROUND_KEY);
    expect(ground.material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(ground.placeholders.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(ground.placeholders.normalMap.colorSpace).toBe(THREE.NoColorSpace);
    ground.setSurface(null);
    ground.setMask(null);
    expect(programShape(ground.material)).toEqual(before);
    expect(ground.uniforms.uPgMask.value).toBe(ground.placeholders.mask);
  });

  it('chains under the painted light as `paint-ground-v1|paint-v1`', () => {
    const release = acquirePaintScope('plaza');
    const ground = createPaintedGround();
    applyPaintedLight(ground.material, 'plaza');
    expect(ground.material.customProgramCacheKey()).toBe(`${PAINT_GROUND_KEY}|${PAINT_PROGRAM_KEY}`);
    const src = compile(ground.material).fragmentShader;
    expect(src).toContain('RE_Direct_Paint');
    expect(src).toContain('pgReflect');
    release();
  });

  it('ashlar furniture on placeholders compiles the façade stone’s program', () => {
    const placeholders = ashlarPlaceholderMaps();
    const furniture = new THREE.MeshStandardMaterial({
      map: placeholders.map,
      normalMap: placeholders.normalMap,
      roughnessMap: placeholders.arm,
      aoMap: placeholders.arm,
    });
    patchAshlar(furniture, { courseOn: 0 });
    const before = programShape(furniture);
    const beforeSrc = compile(furniture).fragmentShader;
    assignAshlarMaps(furniture, { map: resolvedTexture(true), normalMap: resolvedTexture(false), arm: resolvedTexture(false) });
    expect(programShape(furniture)).toEqual(before);
    expect(compile(furniture).fragmentShader).toBe(beforeSrc);
  });
});

describe('ashlar patch', () => {
  it('finds its anchors and shares one key across façade, plinth and kerb roles', () => {
    const frag = THREE.ShaderLib.physical.fragmentShader;
    for (const anchor of Object.values(ASHLAR_ANCHORS)) expect(frag).toContain(anchor);
    const facade = new THREE.MeshStandardMaterial();
    const plinth = new THREE.MeshStandardMaterial();
    const facadeU = patchAshlar(facade, { bayPhase: 1.3 });
    const plinthU = patchAshlar(plinth, { courseOn: 0, detail: 0.8 });
    expect(facade.customProgramCacheKey()).toBe(ASHLAR_PROGRAM_KEY);
    expect(plinth.customProgramCacheKey()).toBe(ASHLAR_PROGRAM_KEY);
    expect(compile(facade).fragmentShader).toBe(compile(plinth).fragmentShader);
    expect(facadeU.uAshCourse.value.w).toBe(1);
    expect(plinthU.uAshCourse.value.w).toBe(0);
    // Idempotent: a second patch only rewrites the uniforms.
    patchAshlar(facade, { bayPhase: 2 });
    expect(compile(facade).fragmentShader.split('uniform vec4 uAshCourse;').length - 1).toBe(1);
  });

  it('binds the plaza calm boxes into the shared uniform', () => {
    const material = new THREE.MeshStandardMaterial();
    patchAshlar(material);
    const shader = compile(material);
    expect(shader.uniforms.uAshCalmCount).toBe(ASHLAR_SHARED.uAshCalmCount);
    expect(ASHLAR_SHARED.uAshCalmCount.value).toBe(plazaCalmBoxes().length);
    expect(shader.fragmentShader).toContain('ashCalmAt( ashW )');
  });

  it('chains under the painted light as `paint-ashlar-v1|paint-v1`', () => {
    const release = acquirePaintScope('plaza');
    const material = new THREE.MeshStandardMaterial();
    patchAshlar(material);
    applyPaintedLight(material, 'plaza');
    expect(material.customProgramCacheKey()).toBe(`${ASHLAR_PROGRAM_KEY}|${PAINT_PROGRAM_KEY}`);
    release();
  });
});

describe('medallion', () => {
  it('keeps every inlay stone within ΔL 15 of the setts across the sett albedo range', () => {
    for (const y of [0.06, 0.1, 0.15, 0.2, 0.3, 0.4]) {
      for (const factor of Object.values(MEDALLION_VALUES)) {
        expect(Math.abs(lightnessOf(y * factor) - lightnessOf(y))).toBeLessThanOrEqual(MEDALLION.maxDeltaL);
      }
    }
  });
});

describe('no night- or rung-keyed rebuilds (grep)', () => {
  const root = join(__dirname, '..');
  const files = [
    join(root, 'PlazaHall.tsx'),
    join(root, 'HaussmannBlock.tsx'),
    join(root, 'Plinth.tsx'),
    join(root, 'paint-ground.ts'),
    join(root, '..', '..', '..', 'themes', 'plaza', 'paint-ashlar.ts'),
  ];

  /** Dependency arrays of every `useMemo(` call in a source file. */
  function memoDeps(source: string): string[] {
    const out: string[] = [];
    let at = source.indexOf('useMemo(');
    while (at >= 0) {
      let depth = 0;
      let end = at + 'useMemo'.length;
      for (; end < source.length; end += 1) {
        const ch = source[end];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const call = source.slice(at, end + 1);
      const deps = call.slice(call.lastIndexOf('['), call.lastIndexOf(']') + 1);
      out.push(deps);
      at = source.indexOf('useMemo(', end);
    }
    return out;
  }

  it('keys no useMemo on night or the rung', () => {
    for (const file of files) {
      const deps = memoDeps(readFileSync(file, 'utf8'));
      for (const d of deps) {
        expect(d, `${file}: ${d}`).not.toMatch(/\b(night|exposure|quality|rung|puddleEmitters|wet)\b/);
      }
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { composerLagsDrawingBuffer } from '@/components/world/route/post/PostStack';
import { refreshGainmapEnvironment, type GainmapDecode } from '@/components/world/route/env/WorldEnvironment';
import { CANOPY_SSS_GLSL } from '@/components/world/route/trees/tree-cards';
import { PAINT_IBL_GLSL, PAINT_PARS_GLSL } from '../painted-light';
import { applyPaintSet, createPaintUniforms, keyScaleFor } from '../paint-uniforms';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { PLAZA_HDRI_FORMAT, PLAZA_PAINTED_ROLES } from '@/lib/route-world/world-env';

/**
 * LOOK round 3 (ART DIRECTOR): the clarity veto (composer resolution), the
 * gain-map HDRI wiring, and data-face purity by construction (the scene keeps
 * the shipped lights; painted materials transform them in the shader).
 */

describe('composer resolution (390 @ dpr 2 clarity veto)', () => {
  it('flags a composer still at the CSS size once the pixel ratio lands', () => {
    // 390 × 844 CSS at dpr 1.75 is a 682 × 1477 drawing buffer.
    expect(composerLagsDrawingBuffer({ width: 390, height: 844 }, { width: 682, height: 1477 })).toBe(true);
    expect(composerLagsDrawingBuffer({ width: 682, height: 1477 }, { width: 682, height: 1477 })).toBe(false);
  });
});

describe('gain-map HDRI (D23 bytes)', () => {
  it('the plaza loads the painted sets and the gain-map pair', () => {
    expect(plazaTheme.hdriFormat).toBe(PLAZA_HDRI_FORMAT);
    expect(plazaTheme.textureRoles).toEqual([...PLAZA_PAINTED_ROLES]);
  });

  function decodeFixture(): { decode: GainmapDecode; render: ReturnType<typeof vi.fn>; texture: THREE.Texture } {
    const texture = new THREE.Texture();
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const render = vi.fn();
    return { decode: { render, renderTarget: { texture } }, render, texture };
  }

  it('re-decodes inside the raw scope, bumps the prefilter version and compiles once', () => {
    const { decode, render, texture } = decodeFixture();
    const scene = new THREE.Scene();
    scene.environment = texture;
    const compile = vi.fn();
    const gl = { compile } as unknown as THREE.WebGLRenderer;
    const before = texture.pmremVersion;
    expect(refreshGainmapEnvironment(gl, scene, new THREE.PerspectiveCamera(), decode)).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(texture.pmremVersion).toBe(before + 1);
    expect(compile).toHaveBeenCalledTimes(1);
    // Idempotent: a second warm (another rung's pass) does nothing.
    expect(refreshGainmapEnvironment(gl, scene, new THREE.PerspectiveCamera(), decode)).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('leaves a scene whose environment is not this decode alone', () => {
    const { decode, render } = decodeFixture();
    const scene = new THREE.Scene();
    scene.environment = new THREE.Texture();
    const compile = vi.fn();
    expect(
      refreshGainmapEnvironment({ compile } as unknown as THREE.WebGLRenderer, scene, new THREE.PerspectiveCamera(), decode),
    ).toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });
});

describe('data-face purity by construction (scene lights stay shipped)', () => {
  it('keyScaleFor is the per-channel art ÷ scene ratio', () => {
    const art = new THREE.Color(2, 1, 0.5);
    const scene = new THREE.Color(1, 1, 1);
    const out = keyScaleFor(art, scene, new THREE.Color());
    expect([out.r, out.g, out.b]).toEqual([2, 1, 0.5]);
    // A scene channel at ~0 takes the luminance ratio instead of dividing by 0.
    const dark = keyScaleFor(new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 0), new THREE.Color());
    expect(Number.isFinite(dark.b)).toBe(true);
    expect(dark.b).toBeGreaterThan(0);
  });

  it('painted materials swap the hemisphere and scale the IBL; the key is scaled in RE_Direct_Paint', () => {
    expect(PAINT_PARS_GLSL).toContain('uniform vec3 uKeyScale;');
    expect(PAINT_PARS_GLSL).toContain('#define PAINT_KEY_SCALE uKeyScale');
    expect(PAINT_IBL_GLSL).toContain('radiance *= uIblSpec;');
    expect(PAINT_IBL_GLSL).toContain('getHemisphereLightIrradiance( hemisphereLights[ 0 ], geometryNormal )');
    expect(PAINT_IBL_GLSL).toContain('uHemiOn');
  });

  it('the canopy translucency follows the painted key only when painted', () => {
    expect(CANOPY_SSS_GLSL).toContain('#ifdef PAINT_KEY_SCALE');
    expect(CANOPY_SSS_GLSL).toContain('sssKey *= PAINT_KEY_SCALE;');
  });

  it('applyPaintSet folds the diffuse and specular IBL scales into the uniforms', () => {
    const uniforms = createPaintUniforms();
    applyPaintSet(PLAZA_PAINT.night, [0, 1, 0], uniforms, 0.1, 0.3);
    expect(uniforms.uIblSpec.value).toBeCloseTo(0.3);
    const luma = 0.2126 * uniforms.uIblTint.value.r + 0.7152 * uniforms.uIblTint.value.g + 0.0722 * uniforms.uIblTint.value.b;
    expect(luma).toBeCloseTo(0.1 * (PLAZA_PAINT.night.ibl?.strength ?? 1), 5);
    // Defaults: the specular follows the diffuse scale.
    applyPaintSet(PLAZA_PAINT.day, [0, 1, 0], uniforms, 0.5);
    expect(uniforms.uIblSpec.value).toBeCloseTo(0.5);
  });

  it('a fresh uniform set is the identity transform (no hemisphere swap, unit key and IBL)', () => {
    const u = createPaintUniforms();
    expect(u.uHemiOn.value).toBe(0);
    expect(u.uIblSpec.value).toBe(1);
    expect([u.uKeyScale.value.r, u.uKeyScale.value.g, u.uKeyScale.value.b]).toEqual([1, 1, 1]);
  });
});

describe('LOOK r3 art direction (uniform values only)', () => {
  it('day: a golden key, a cool blue shade and a sunlit/shade split', () => {
    const key = new THREE.Color(PLAZA_PAINT.day.key.color);
    expect(key.r).toBeGreaterThan(key.b);
    const shade = new THREE.Color(PLAZA_PAINT.day.shadow.tint);
    expect(shade.b).toBeGreaterThan(shade.r);
    const ibl = new THREE.Color(PLAZA_PAINT.day.ibl?.tint ?? '#ffffff');
    expect(ibl.b).toBeGreaterThan(ibl.r);
  });

  it('night: a dark diffuse shade, a reflection that still glints, a moon under the lamps', () => {
    const night = PLAZA_PAINT.night;
    // LOOK r5 ("never gloomier"): the painted night IBL rose to 0.3 — still
    // well under the scene's shipped 0.55, so the shade stays dark while the
    // wet setts keep their reflection.
    expect(night.ibl?.environment ?? 1).toBeLessThanOrEqual(0.3);
    expect(night.ibl?.specular ?? 0).toBeGreaterThan(0);
    expect(night.key.intensity).toBeLessThan(PLAZA_PAINT.day.key.intensity / 4);
  });
});

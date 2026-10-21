import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { needsPmremRefresh, refreshEnvironmentPmrem } from '@/components/world/route/env/WorldEnvironment';
import { applyPaintSaturation, applyPaintSet, createPaintUniforms, linearLuma, writePaintRole } from '../paint-uniforms';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { SETT_CONTRAST_GAIN, SETT_CONTRAST_GAMMA } from '@/components/world/evoliga/route/plaza/paint-ground';
import { keyColorFor } from '@/components/world/evoliga/route/env/Lighting';

/**
 * LOOK r2 (art director): the cross-world IBL repair, the plaza's painted
 * shade/chroma uniforms, the role saturation share and the rung-2 key.
 */

function equirect(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 2), 4, 2);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

describe('environment prefilter refresh (the black-PMREM blast leak)', () => {
  it('only equirect sources are refreshed — never a render-target or cube texture', () => {
    expect(needsPmremRefresh(equirect())).toBe(true);
    const cube = new THREE.CubeTexture();
    expect(needsPmremRefresh(cube)).toBe(false);
    const rt = new THREE.WebGLRenderTarget(4, 4);
    rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    expect(needsPmremRefresh(rt.texture)).toBe(false);
    expect(needsPmremRefresh(null)).toBe(false);
  });

  it('drops the cached prefilter and rebuilds it once, with a throwaway probe material', () => {
    const scene = new THREE.Scene();
    const environment = equirect();
    scene.environment = environment;
    const disposed = vi.fn();
    environment.addEventListener('dispose', disposed);
    const probes: THREE.Scene[] = [];
    const gl = {
      compile: vi.fn((probe: THREE.Scene) => {
        probes.push(probe);
        return new Set<THREE.Material>();
      }),
    } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera();

    expect(refreshEnvironmentPmrem(gl, scene, camera)).toBe(true);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(gl.compile).toHaveBeenCalledTimes(1);
    expect(probes[0].environment).toBe(environment);
    // The probe never joins the world scene.
    expect(scene.children).toHaveLength(0);
    // Idempotent per texture: a later warm step does not rebuild it again.
    expect(refreshEnvironmentPmrem(gl, scene, camera)).toBe(false);
    expect(gl.compile).toHaveBeenCalledTimes(1);
  });

  it('waits for the image (a texture with no data is left for a later step)', () => {
    const scene = new THREE.Scene();
    const texture = new THREE.Texture();
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    const gl = { compile: vi.fn() } as unknown as THREE.WebGLRenderer;
    expect(refreshEnvironmentPmrem(gl, scene, new THREE.PerspectiveCamera())).toBe(false);
    expect(gl.compile).not.toHaveBeenCalled();
  });
});

describe('plaza painted shade and chroma (uniforms only)', () => {
  it('writes the IBL hue at unit luminance and the painted saturation per palette', () => {
    const uniforms = createPaintUniforms();
    applyPaintSet(PLAZA_PAINT.day, plazaTheme.lights.keyDirection, uniforms);
    const tint = uniforms.uIblTint.value;
    expect(linearLuma(tint.r, tint.g, tint.b)).toBeCloseTo(PLAZA_PAINT.day.ibl?.strength ?? 1, 5);
    // Cool shade: blue over red.
    expect(tint.b).toBeGreaterThan(tint.r);
    expect(uniforms.uPaintSat.value).toBe(PLAZA_PAINT.day.saturation);
    applyPaintSet(PLAZA_PAINT.night, plazaTheme.lights.keyDirection, uniforms);
    expect(uniforms.uPaintSat.value).toBe(PLAZA_PAINT.night.saturation);
    applyPaintSaturation(1, uniforms);
    expect(uniforms.uPaintSat.value).toBe(1);
  });

  it('frames take no painted chroma; stone, figures and foliage take all of it', () => {
    const v = new THREE.Vector4();
    expect(writePaintRole(v, PLAZA_PAINT.day.roles.frame).w).toBe(0);
    for (const role of ['env', 'figure', 'foliage'] as const) {
      expect(writePaintRole(v, PLAZA_PAINT.day.roles[role]).w).toBe(1);
    }
    // Foliage keeps only a faint rim (the r1 pale-crown fix).
    expect(PLAZA_PAINT.day.roles.foliage.rimScale).toBeLessThan(PLAZA_PAINT.day.roles.env.rimScale);
  });

  it('daylight stays brighter than the night rig and the night IBL is the dim one', () => {
    expect(PLAZA_PAINT.day.key.intensity).toBeGreaterThan(PLAZA_PAINT.night.key.intensity);
    // LOOK r3: the scene keeps the shipped IBL (no theme override); the
    // painted materials' own IBL is the dim one at night.
    expect(plazaTheme.environmentIntensity).toBeUndefined();
    expect(PLAZA_PAINT.night.ibl?.environment ?? 1).toBeLessThan(PLAZA_PAINT.day.ibl?.environment ?? 0);
  });
});

describe('sett form and the post-off key', () => {
  it('the sett gamma keeps a 0.4 midtone and deepens the grout', () => {
    const f = (x: number) => Math.pow(x, SETT_CONTRAST_GAMMA) * SETT_CONTRAST_GAIN;
    expect(f(0.4)).toBeCloseTo(0.4, 6);
    expect(f(0.1)).toBeLessThan(0.1);
  });

  it('the post-off rungs take a key nearer neutral; post rungs take the authored key', () => {
    const authored = keyColorFor(PLAZA_PAINT.day.key.color, true);
    const postOff = keyColorFor(PLAZA_PAINT.day.key.color, false);
    const chroma = (c: THREE.Color) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(authored.getHexString()).toBe(new THREE.Color(PLAZA_PAINT.day.key.color).getHexString());
    expect(chroma(postOff)).toBeLessThan(chroma(authored));
  });
});

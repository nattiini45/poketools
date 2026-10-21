import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PAINT_FX_ATTRIBUTES,
  SKY_GRADE,
  skyToneMapped,
  createPaintFxMaterial,
  createShaftGeometry,
  createSkyMaterial,
  createSkyUniforms,
  createSkylineGeometry,
  programSignature,
  writeSkyUniforms,
  writeSkylineUniforms,
  type SkyState,
} from '@/components/world/route/env/paint-fx';
import { PAINT_UNIFORMS } from '@/components/world/route/paint/paint-uniforms';
import { plazaTheme } from '@/components/world/themes/plaza/theme';

/**
 * LOOK-PLAN §2 SEAT K: the sky material is created ONCE — night, palette,
 * post and the rung's cloud taps are uniform writes — so a theme toggle or a
 * governor step (the quiet probe's leg c) relinks nothing. The skyline and
 * the shafts share ONE paint-fx program.
 */

const DAY: SkyState = {
  night: false,
  sky: '#6eb4e0',
  skyHorizon: '#efe2c8',
  sunColor: '#fff1c4',
  moonColor: '#fff4ee',
  skyBodyPosition: plazaTheme.lights.skyBodyPosition,
  cloudTaps: 2,
};
const NIGHT: SkyState = { ...DAY, night: true, sky: '#070433', skyHorizon: '#1c3a58' };

describe('Atmosphere sky material identity', () => {
  it('is stable across night, palette, post and cloud-tap changes', () => {
    const uniforms = createSkyUniforms();
    const material = createSkyMaterial(uniforms);
    const signature = programSignature(material);
    const states: SkyState[] = [
      DAY,
      NIGHT,
      { ...DAY, cloudTaps: 1 },
      { ...NIGHT, cloudTaps: 1 },
      { ...DAY, sky: '#123456', skyHorizon: '#abcdef', skyBodyPosition: [1, 2, 3] },
      DAY,
    ];
    for (const state of states) {
      writeSkyUniforms(state, uniforms);
      expect(programSignature(material)).toBe(signature);
      // The material keeps binding the SAME uniform objects (value writes only).
      expect(material.uniforms.uNight).toBe(uniforms.uNight);
      expect(material.uniforms.uNight.value).toBe(state.night ? 1 : 0);
      expect(material.uniforms.uCloudTaps.value).toBe(state.cloudTaps);
    }
  });

  it('binds the shared calm slots by reference; day sky tone-mapped (shipped !night), fog off', () => {
    const material = createSkyMaterial(createSkyUniforms());
    expect(material.uniforms.uCalmRects).toBe(PAINT_UNIFORMS.uCalmRects);
    expect(material.uniforms.uCalmCount).toBe(PAINT_UNIFORMS.uCalmCount);
    expect(material.uniforms.uCalmViewport).toBe(PAINT_UNIFORMS.uCalmViewport);
    // LOOK r2: the post-off rungs draw through renderer ACES again, where the
    // shipped sky was `toneMapped: !night` (inside the composer three ignores it).
    expect(material.toneMapped).toBe(true);
    expect(skyToneMapped(false)).toBe(true);
    expect(skyToneMapped(true)).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.defines ?? {}).toEqual({});
  });

  it('keeps the AgX compensation at its shipped rung-0 values in both palettes', () => {
    const uniforms = createSkyUniforms();
    writeSkyUniforms(DAY, uniforms);
    expect([uniforms.uGain.value, uniforms.uSat.value]).toEqual([SKY_GRADE.day.gain, SKY_GRADE.day.sat]);
    writeSkyUniforms(NIGHT, uniforms);
    expect([uniforms.uGain.value, uniforms.uSat.value]).toEqual([1.15, 1.35]);
    // Post-off rungs (renderer ACES): no AgX compensation, as shipped.
    writeSkyUniforms({ ...DAY, post: false }, uniforms);
    expect([uniforms.uGain.value, uniforms.uSat.value]).toEqual([1, 1]);
  });

  it('keeps the night branch verbatim', () => {
    const f = createSkyMaterial(createSkyUniforms()).fragmentShader;
    for (const line of [
      'vec2 cloudUv = dir.xz / (elev + 0.18) * 0.55 + vec2(3.1, 7.4);',
      'float cover = smoothstep(0.46, 0.78, field);',
      'vec3 nightCloud = mix(uZenith, uHorizon, 0.5) * 1.35;',
      'float amount = cover * fade * mix(0.92, 0.26, uNight);',
      'col += mix(uHorizon, uGlow, 0.18) * corona * 0.12 * uNight;',
      'col += vec3(0.72, 0.78, 0.92) * stars * (0.12 + 0.22 * seed);',
      'col += (hash13(dir * 220.0) - 0.5) * mix(0.006, 0.012, uNight);',
    ]) {
      expect(f).toContain(line);
    }
  });

  it('Atmosphere.tsx builds the material once (no night / palette / post deps)', () => {
    const source = readFileSync(join(__dirname, '..', 'Atmosphere.tsx'), 'utf8');
    // ROLLOUT §2.2 (d): the dome is the shared PaintedSkyDome over the plaza preset.
    expect(source).toMatch(/<PaintedSkyDome/);
    expect(source).not.toMatch(/new THREE\.ShaderMaterial/);
    const dome = readFileSync(join(__dirname, '..', '..', '..', '..', 'route', 'env', 'PaintedSkyDome.tsx'), 'utf8');
    expect(dome).toMatch(/useMemo\(\(\) => createSkyMaterial\(SKY_UNIFORMS, preset\), \[preset\]\)/);
    expect(dome).not.toMatch(/new THREE\.ShaderMaterial/);
    expect(source).toMatch(/const DAY_FOG_SCALE = 0;/);
    // The fog stays mounted: the painted aerial term lives inside USE_FOG.
    expect(source).toMatch(/<fogExp2 ref=\{fogRef\} attach="fog"/);
  });
});

describe('paint-fx: one program for the skyline and the shafts', () => {
  it('shares source and every program flag across kinds', () => {
    const skyline = createPaintFxMaterial('skyline');
    const shaft = createPaintFxMaterial('shaft');
    const strip = (m: THREE.ShaderMaterial) => {
      const sig = JSON.parse(programSignature(m)) as Record<string, unknown>;
      delete sig.blending; // blend state is not a program key; `opaque` is false for both (transparent).
      return sig;
    };
    expect(strip(skyline)).toEqual(strip(shaft));
    expect(skyline.transparent && shaft.transparent).toBe(true);
    expect(shaft.blending).toBe(THREE.AdditiveBlending);
    expect(skyline.uniforms.uKind.value).toBe(0);
    expect(shaft.uniforms.uKind.value).toBe(1);
    expect(skyline.userData.paintExempt).toBe(true);
  });

  it('palette writes on the skyline are value-only', () => {
    const skyline = createPaintFxMaterial('skyline');
    const signature = programSignature(skyline);
    writeSkylineUniforms(skyline, true);
    writeSkylineUniforms(skyline, false);
    expect(programSignature(skyline)).toBe(signature);
  });

  it('paint-fx geometries carry no normal attribute (vertexNormals is a program key)', () => {
    for (const geometry of [createShaftGeometry(), createSkylineGeometry()]) {
      for (const name of Object.keys(geometry.attributes)) {
        expect(PAINT_FX_ATTRIBUTES as readonly string[]).toContain(name);
      }
      expect(geometry.attributes.normal).toBeUndefined();
    }
  });
});

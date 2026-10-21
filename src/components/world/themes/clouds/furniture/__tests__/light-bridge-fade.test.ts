import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CameraEndpoint, Vec3 } from '@/lib/route-world/chapters';
import { landedEndpoint } from '@/lib/route-world/legibility';
import { CLOUDS_STATIONS } from '../../theme';
import { BRIDGES } from '../layout';
import { applyBridgeNearFade, BRIDGE_NEAR_FADE, bridgeNearFade, bridgeSpanPoints } from '../light-bridge-fade';

/**
 * Fidelity W1 r4 — the light-bridges bloomed into near-lens bars at 390 (the
 * landed pullback puts the roster → teams span 8–10 m from the lens) and a
 * slab at the bottom right of the roster 1440 still. Every span is projected
 * from every frozen endpoint: an in-frame piece near the lens must be faded.
 */

/** In-frame pieces closer than this are "near-lens" and must render ≤ `NEAR_LENS_MAX_FADE`. */
const NEAR_LENS_M = 12;
const NEAR_LENS_MAX_FADE = 0.16;
/** NDC slack for the tube's 0.34 m radius and the ring halos. */
const FRAME_SLACK = 0.1;

function project(endpoint: CameraEndpoint, aspect: number, p: Vec3) {
  const f = [0, 1, 2].map((k) => endpoint.target[k] - endpoint.position[k]);
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fw = f.map((v) => v / fl);
  const rl = Math.hypot(fw[0], fw[2]);
  const rw = [-fw[2] / rl, 0, fw[0] / rl];
  const up = [rw[1] * fw[2] - rw[2] * fw[1], rw[2] * fw[0] - rw[0] * fw[2], rw[0] * fw[1] - rw[1] * fw[0]];
  const d = [0, 1, 2].map((k) => p[k] - endpoint.position[k]);
  const depth = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
  const t = Math.tan((endpoint.fov * Math.PI) / 360);
  return {
    depth,
    x: (d[0] * rw[0] + d[1] * rw[1] + d[2] * rw[2]) / depth / (t * aspect),
    y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / depth / t,
    dist: Math.hypot(d[0], d[1], d[2]),
  };
}

function poses(): Array<{ name: string; endpoint: CameraEndpoint; aspect: number }> {
  return CLOUDS_STATIONS.flatMap((station) => [
    { name: `${station.id} landed 390`, endpoint: landedEndpoint(station.cameraMobile), aspect: 390 / 844 },
    { name: `${station.id} authored 390`, endpoint: station.cameraMobile, aspect: 390 / 844 },
    { name: `${station.id} 1440`, endpoint: station.camera, aspect: 1440 / 900 },
  ]);
}

function inFrameSamples(endpoint: CameraEndpoint, aspect: number) {
  return BRIDGES.flatMap((bridge) =>
    bridgeSpanPoints(bridge, 60)
      .map((p) => project(endpoint, aspect, p))
      .filter((q) => q.depth > 0.1 && Math.abs(q.x) <= 1 + FRAME_SLACK && Math.abs(q.y) <= 1 + FRAME_SLACK),
  );
}

describe('light-bridge near-camera fade', () => {
  it('ramps 0 → 1 over the fade band', () => {
    expect(bridgeNearFade(BRIDGE_NEAR_FADE.start - 1)).toBe(0);
    expect(bridgeNearFade(BRIDGE_NEAR_FADE.end + 1)).toBe(1);
    expect(bridgeNearFade((BRIDGE_NEAR_FADE.start + BRIDGE_NEAR_FADE.end) / 2)).toBeCloseTo(0.5, 5);
  });

  it('the unfaded geometry really put a span near the lens (the r3 defect)', () => {
    const nearest = Math.min(
      ...poses()
        .filter((pose) => pose.name.endsWith('landed 390'))
        .flatMap((pose) => inFrameSamples(pose.endpoint, pose.aspect).map((q) => q.dist)),
    );
    expect(nearest).toBeLessThan(NEAR_LENS_M);
  });

  for (const pose of poses()) {
    it(`${pose.name}: every in-frame span piece near the lens is faded (≤ ${NEAR_LENS_MAX_FADE})`, () => {
      for (const q of inFrameSamples(pose.endpoint, pose.aspect)) {
        if (q.dist < NEAR_LENS_M) expect(bridgeNearFade(q.dist)).toBeLessThanOrEqual(NEAR_LENS_MAX_FADE);
      }
    });
  }

  it('the shader patch lands on the standard material chunks', () => {
    const material = new THREE.MeshStandardMaterial();
    applyBridgeNearFade(material);
    expect(material.transparent).toBe(true);
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vBridgeViewDist = length(mvPosition.xyz);');
    expect(shader.fragmentShader).toContain('gl_FragColor.a *= bridgeFade;');
    expect(shader.fragmentShader).toContain('discard;');
    expect(material.customProgramCacheKey()).toContain('light-bridge-near-fade');
  });
});

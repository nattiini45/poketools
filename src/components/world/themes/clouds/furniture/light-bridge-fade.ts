import type * as THREE from 'three';
import { BRIDGES, ISLES, SATELLITE, type Isle } from './layout';

/**
 * The light-bridges' NEAR-CAMERA fade (fidelity W1 r4). The r3 stills showed
 * the beams and emitter rings blooming into huge blown-out bars across the
 * lower third at 390 (the landed pose's 9.75 m pullback puts the roster →
 * teams span 8–10 m from the lens) and a glowing slab at the bottom right of
 * the roster 1440 still (the same span 4.4 m away). They cover no data face,
 * but at that range a 0.34 m emissive tube is the brightest thing in frame.
 *
 * The fix is distance, not placement (the arcs stay where layout.ts sites
 * them): every bridge fragment's alpha ramps 0 → 1 over the view distance
 * `BRIDGE_NEAR_FADE.start` → `.end`, and a fragment under the start is
 * discarded. Far spans — the ones that read as the isles' light paths —
 * render untouched. Pure data + one shader patch; the geometry and its
 * sampling mirror `LightBridges.tsx` exactly (tested against every frozen
 * endpoint in `light-bridge-fade.test.ts`).
 */
export const BRIDGE_NEAR_FADE = { start: 10, end: 18 } as const;

/** The fade factor at a view distance (metres): 0 inside `start`, 1 beyond `end`, smoothstep between. */
export function bridgeNearFade(distanceM: number): number {
  const { start, end } = BRIDGE_NEAR_FADE;
  const t = Math.min(1, Math.max(0, (distanceM - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

/** All isles the bridges can attach to, by name. */
export const BRIDGE_NODES: Record<string, Isle> = { ...ISLES, satellite: SATELLITE };

type Vec3 = [number, number, number];

/**
 * A bridge's quadratic bezier control points — start on the `from` rim,
 * crown-lifted midpoint, end on the `to` rim — exactly as `LightBridges`
 * builds its `QuadraticBezierCurve3`.
 */
export function bridgeControlPoints(bridge: (typeof BRIDGES)[number]): { start: Vec3; mid: Vec3; end: Vec3 } {
  const a = BRIDGE_NODES[bridge.from];
  const b = BRIDGE_NODES[bridge.to];
  const la = Math.hypot(bridge.ctrl[0] - a.x, bridge.ctrl[1] - a.z) || 1;
  const lb = Math.hypot(bridge.ctrl[0] - b.x, bridge.ctrl[1] - b.z) || 1;
  const start: Vec3 = [
    a.x + ((bridge.ctrl[0] - a.x) / la) * (a.r - 0.5),
    a.top - 0.3,
    a.z + ((bridge.ctrl[1] - a.z) / la) * (a.r - 0.5),
  ];
  const end: Vec3 = [
    b.x + ((bridge.ctrl[0] - b.x) / lb) * (b.r - 0.5),
    b.top - 0.3,
    b.z + ((bridge.ctrl[1] - b.z) / lb) * (b.r - 0.5),
  ];
  const mid: Vec3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + bridge.crown, (start[2] + end[2]) / 2];
  return { start, mid, end };
}

/** `samples + 1` points along a bridge's centreline. */
export function bridgeSpanPoints(bridge: (typeof BRIDGES)[number], samples: number = 40): Vec3[] {
  const { start, mid, end } = bridgeControlPoints(bridge);
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const u = 1 - t;
    return [0, 1, 2].map((k) => u * u * start[k] + 2 * u * t * mid[k] + t * t * end[k]) as Vec3;
  });
}

/**
 * Patch a bridge material with the near fade: the vertex stage exports the
 * view distance, the fragment stage scales alpha by the smoothstep and
 * discards the fully faded fragments (so an invisible fragment never writes
 * depth over the sky behind it). The material turns transparent; its
 * program is keyed apart from the theme's other standard materials.
 */
export function applyBridgeNearFade(material: THREE.MeshStandardMaterial): void {
  const { start, end } = BRIDGE_NEAR_FADE;
  material.transparent = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBridgeViewDist;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvBridgeViewDist = length(mvPosition.xyz);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBridgeViewDist;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\nfloat bridgeFade = smoothstep(${start.toFixed(1)}, ${end.toFixed(1)}, vBridgeViewDist);\nif (bridgeFade < 0.004) discard;\ngl_FragColor.a *= bridgeFade;`,
      );
  };
  material.customProgramCacheKey = () => `light-bridge-near-fade-${start}-${end}`;
}

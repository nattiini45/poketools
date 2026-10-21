'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import {
  buildWaterDisc,
  emitGlsl,
  RIPPLE_CAPACITY,
  waterTessellation,
  type WaterBodySpec,
} from '@/lib/route-world/water';
import { useWaterBodyRuntime, type WaterBodyRuntime } from './WaterEventContext';
import { MAX_PRACTICALS, WATER_FRAGMENT, WATER_VERTEX } from './water-shader';

/**
 * Shared bounded water (spec §5.2, fidelity W3) — ONE mesh, ONE
 * ShaderMaterial per body.
 *
 * What it does, all from the one `WaterBodySpec` (`water.ts`):
 * - displaces a polar-grid disc by three sharpened-sine wave bands plus the
 *   ripple-event pool and the ambient stream; the fragment shader evaluates
 *   the same field per pixel for the normal, so displacement and shading
 *   never disagree, and CPU buoyancy (`sampleWater`) agrees with both;
 * - colours the body by optical path length through an analytic depth bowl
 *   (shallow → absorb → deep), wraps the rim and every island in a wet band
 *   plus a thin, lapping foam lip, so the edge is never a hard ellipse cut;
 * - reflects a two-stop sky (zenith / horizon) by a stylised Fresnel and
 *   puts a sun glint on the waves from the theme's key-light direction;
 * - crest foam and ripple ring-front foam come from the same field terms;
 *   foam and glint are capped under the post stack's bloom threshold (1.7
 *   night / 2.0 day), so the water reads the same with post OFF — it
 *   carries its own tone mapping, colour-space and fog chunks (the old lake
 *   wrote raw linear colour, which was wrong on rungs 2–4).
 *
 * Disclosed optical limits (never sold as more):
 * - NO reflection render: the reflection is an analytic sky gradient (plus
 *   an optional authored colour smear toward a landmark). Not SSR, not a
 *   planar mirror — scene objects do not appear in the water.
 * - HEURISTIC refraction: shallow-water lightening by path length and a
 *   bounded procedural caustic band near the shore. No refracted scene
 *   sample, no reconstructed underwater thickness.
 * - The water is opaque and unlit by scene lights (no shadow receipt); the
 *   sun and up to two practicals (night glitter streaks) are shader terms.
 * - The capillary normal layer is fragment-only detail and is not part of
 *   `sampleWater` (sub-centimetre; it never moves a floater).
 * - Sakura's floating petal specks are a procedural surface layer (zero CPU),
 *   not the falling petals landing — they do not publish ripples.
 *
 * Quality: tessellation, the macro slope layer + petal specks (detail ≥ 1)
 * and the capillary layer (detail ≥ 3) follow `QualityStep.waterDetail`;
 * the live ripple slots and the ambient stream follow
 * `QualityStep.waterRipples` (0 = a moving surface with no events). The
 * base read — grazing Fresnel ramp, dark-near body, lifted horizon — is
 * unconditional, so rung 4 (detail 0) is still water, not a flat tint.
 * `?routeDebug=1&waterDebug=height|ripples|foam|depth|normals|normals-full`
 * switches the shader to a diagnostic view (height: green = base bands, red =
 * ripples; normals: red/blue = the ripple slope only, green = the detail
 * layers; normals-full = the whole normal ×4), written untonemapped/unfogged;
 * `?routeDebug=1&waterClockOffset=<s>` shifts the water phase the capture
 * pin lands on (the ambient ring ages in the still — see `WaterEventContext`);
 * `window.__routeWorldWater()` lists live events and a per-body `stats`
 * readout (active slots, events/s, last event).
 */

export interface WaterPractical {
  /** World position of the light source. */
  position: readonly [number, number, number];
  /** 0..1 strength of its night glitter streak. */
  intensity: number;
}

export interface BoundedWaterProps {
  /** Must be the spec the enclosing `WaterBodyProvider` owns (same object). */
  spec: WaterBodySpec;
  /** Direction TOWARD the key light (theme `lights.keyDirection`). */
  sunDirection: readonly [number, number, number];
  /** Key-light colour (palette `keyLight`). */
  sunColor: string;
  night: boolean;
  /** Up to two lights that streak on the water at night. */
  practicals?: readonly WaterPractical[];
  practicalColor?: string;
  /** Sakura: procedural floating petal specks in this colour (null = off). */
  petalColor?: string | null;
  /** Optional authored reflection smear toward a landmark's azimuth. */
  smear?: { color: string; directionXZ: readonly [number, number]; gain: number } | null;
}

const DEBUG_MODES: Readonly<Record<string, number>> = {
  height: 1,
  ripples: 2,
  foam: 3,
  depth: 4,
  normals: 5,
  'normals-full': 6,
};

interface LiveRefs {
  runtime: WaterBodyRuntime;
  uniforms: Record<string, THREE.IUniform>;
  packed: Float32Array;
  cap: number;
  streams: number;
  debugMode: number;
}

interface UniformInputs {
  runtime: WaterBodyRuntime;
  packed: Float32Array;
  sunDirection: readonly [number, number, number];
  sunColor: string;
  night: boolean;
  practicals: readonly WaterPractical[] | undefined;
  practicalColor: string;
  petalColor: string | null;
  smear: BoundedWaterProps['smear'];
  waterDetail: number;
}

function waterUniforms(input: UniformInputs): Record<string, THREE.IUniform> {
  const { colors } = input.runtime.spec;
  const practicals = Array.from({ length: MAX_PRACTICALS }, (_, i) => {
    const practical = input.practicals?.[i];
    return practical
      ? new THREE.Vector4(practical.position[0], practical.position[1], practical.position[2], practical.intensity)
      : new THREE.Vector4(0, 0, 0, 0);
  });
  const [sx, sy, sz] = input.sunDirection;
  return {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    // The SAME object as the runtime clock: the capture phase pin writes
    // `uTime` here and the ripple pool ages by it.
    uTime: input.runtime.time,
    uRipples: { value: input.packed },
    uRippleCount: { value: 0 },
    uAmbientStreams: { value: 0 },
    uDeep: { value: new THREE.Color(colors.deep) },
    uShallow: { value: new THREE.Color(colors.shallow) },
    uAbsorb: { value: new THREE.Color(colors.absorb) },
    uFoam: { value: new THREE.Color(colors.foam) },
    uShore: { value: new THREE.Color(colors.shore) },
    uSkyZenith: { value: new THREE.Color(colors.skyZenith) },
    uSkyHorizon: { value: new THREE.Color(colors.skyHorizon) },
    uSunDir: { value: new THREE.Vector3(sx, sy, sz).normalize() },
    uSunColor: { value: new THREE.Color(input.sunColor) },
    uNight: { value: input.night ? 1 : 0 },
    uSmear: { value: new THREE.Color(input.smear?.color ?? '#000000') },
    uSmearDir: {
      value: input.smear
        ? new THREE.Vector2(input.smear.directionXZ[0], input.smear.directionXZ[1]).normalize()
        : new THREE.Vector2(0, 1),
    },
    uSmearGain: { value: input.smear?.gain ?? 0 },
    uPracticals: { value: practicals },
    uPracticalColor: { value: new THREE.Color(input.practicalColor) },
    // r2: petal specks and the macro slope layer hold down to waterDetail 1
    // (a tiny per-fragment cost and the strongest "this is a surface" cue
    // with post off); only the capillary layer is the first detail cut.
    uPetals: { value: input.petalColor && input.waterDetail >= 1 ? 1 : 0 },
    uPetalColor: { value: new THREE.Color(input.petalColor ?? '#ffffff') },
    uCapillary: { value: input.waterDetail >= 3 ? 1 : 0 },
    uMacro: { value: input.waterDetail >= 1 ? 1 : 0 },
    uDebug: { value: 0 },
  };
}

export default function BoundedWater({
  spec,
  sunDirection,
  sunColor,
  night,
  practicals,
  practicalColor = '#ffc27a',
  petalColor = null,
  smear = null,
}: BoundedWaterProps) {
  const runtime = useWaterBodyRuntime(spec.id);
  if (!runtime) {
    throw new Error(`BoundedWater: no WaterBodyProvider for "${spec.id}"`);
  }
  const { waterDetail, waterRipples } = useQuality();
  const { debug } = useWorldState();

  const glsl = useMemo(() => emitGlsl(runtime.spec), [runtime]);
  const tessellation = waterTessellation(waterDetail);

  const geometry = useMemo(() => {
    const disc = buildWaterDisc(runtime.spec.radii, tessellation.rings, tessellation.segments);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(disc.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(disc.indices, 1));
    // Bounds padded for the displacement so culling never clips a crest.
    geo.computeBoundingSphere();
    if (geo.boundingSphere) geo.boundingSphere.radius += 0.5;
    return geo;
  }, [runtime, tessellation.rings, tessellation.segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const packed = useMemo(() => new Float32Array(RIPPLE_CAPACITY * 4), []);

  // Palette / light / rung inputs are baked into the uniforms at creation.
  // They change only on a day/night flip or a rung step; three reuses the
  // compiled program (identical source), so a rebuild is a uniform upload.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: waterUniforms({
          runtime,
          packed,
          sunDirection,
          sunColor,
          night,
          practicals,
          practicalColor,
          petalColor,
          smear,
          waterDetail,
        }),
        vertexShader: WATER_VERTEX(glsl),
        fragmentShader: WATER_FRAGMENT(glsl),
        fog: true,
      }),
    [glsl, runtime, packed, sunDirection, sunColor, night, practicals, practicalColor, petalColor, smear, waterDetail],
  );
  useEffect(() => () => material.dispose(), [material]);

  const cap = Math.max(0, Math.min(RIPPLE_CAPACITY, Math.floor(waterRipples)));
  const streams = cap > 0 ? runtime.spec.ambient.streams : 0;

  const liveRef = useRef<LiveRefs>({ runtime, uniforms: material.uniforms, packed, cap, streams, debugMode: 0 });
  useEffect(() => {
    // Debug view: read from the URL per debug session (never outside debug).
    const query = debug ? new URLSearchParams(window.location.search).get('waterDebug') : null;
    const debugMode = query ? (DEBUG_MODES[query] ?? 0) : 0;
    liveRef.current = { runtime, uniforms: material.uniforms, packed, cap, streams, debugMode };
  }, [runtime, material, packed, cap, streams, debug]);

  useFrame((_, delta) => {
    const live = liveRef.current;
    // Delta-driven water clock, clamped so a resumed demand frameloop does
    // not jump the waves. The phase pin overwrites it canonically.
    live.runtime.advance(Math.min(Math.max(delta, 0), 0.1));
    const now = live.runtime.time.value;
    live.uniforms.uRippleCount.value = live.runtime.pool.pack(now, live.cap, live.packed);
    live.uniforms.uAmbientStreams.value = live.streams;
    live.uniforms.uDebug.value = live.debugMode;
    // Rung caps + debug view for the handle's sampling and the debug bridge.
    live.runtime.state.rippleCap = live.cap;
    live.runtime.state.ambientStreams = live.streams;
    live.runtime.state.debugMode = live.debugMode;
  });

  return (
    <mesh
      name={spec.id}
      position={[runtime.spec.center[0], runtime.spec.surfaceY, runtime.spec.center[1]]}
      geometry={geometry}
      material={material}
    />
  );
}

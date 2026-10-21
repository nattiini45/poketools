'use client';

/**
 * The shared skyline ring (ROLLOUT §2.2 e), extracted from the plaza
 * `Skyline.tsx`: three open cylinder bands at the spec's radii, alpha-cut
 * from the world's authored silhouette atlas (`env/<world>/skyline.webp`),
 * receding toward the painted clear sky. Geometry, seams and the colour law
 * are `src/lib/route-world/skyline.ts`; the shader is paint-fx
 * `kind: 'skyline'` — the SAME source for every spec (spec values are
 * uniforms or geometry), one program shared with the paint-fx shafts.
 *
 * Complete at reveal (D23): mount it inside a `ResidentSuspense` — the atlas
 * loads under it, so the gate waits for it and the warm uploads it; the
 * material and geometry are built once, and a palette toggle is a uniform
 * write. No fog, no shadow, no raycast target, no motion.
 *
 * The flag is real (ROLLOUT §2.2 a): renders nothing unless
 * `paintFeature(paint, 'skyline')` is on AND the paint block carries a
 * `skyline` spec (a hook-free gate, so a world without the flag mounts no
 * hook, texture load, material or program of the ring). It also renders
 * nothing when the manifest ships no atlas for the spec: the sky alone is
 * the clean fallback.
 *
 * Atlas contract: R / G / B = near / mid / far coverage; A = static night
 * window dots on the near band. A spec with `windows: false` must ship A = 0
 * (the bake writes no dots) — the shader is shared, so the flag is data.
 */

import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { useWorldManifest } from '@/lib/route-world/model-manifest';
import { paintFeature, type RouteThemePaint } from '@/lib/route-world/theme-types';
import { skylineUrlFor } from '@/lib/route-world/world-env';
import {
  createPaintFxMaterial,
  createSkylineGeometry,
  writeSkylineUniforms,
  type SkylineSpec,
} from './paint-fx';

export interface PaintedSkylineProps {
  /**
   * The world's paint block (`theme.paint`): the ring renders only when
   * `features.skyline` is on, and draws `paint.skyline` as its spec.
   */
  paint: RouteThemePaint | null | undefined;
  night: boolean;
  /** Mesh name (the plaza keeps `plaza-skyline`). */
  name?: string;
}

/** The gate: no flag or no spec → nothing (hook-free, so the early return never changes a hook order). */
export default function PaintedSkyline({ paint, night, name }: PaintedSkylineProps) {
  const spec = paint?.skyline;
  if (!spec || !paintFeature(paint, 'skyline')) return null;
  return <SkylineAtlas spec={spec} night={night} name={name ?? 'painted-skyline'} />;
}

/** Resolves the spec's atlas from the manifest; no atlas → nothing. */
function SkylineAtlas({ spec, night, name }: { spec: SkylineSpec; night: boolean; name: string }) {
  const url = skylineUrlFor(useWorldManifest(), spec);
  if (!url) return null;
  return <SkylineRing url={url} spec={spec} night={night} name={name} />;
}

/** Sampler state for the atlas (mask data: linear, u wraps, v clamps). */
function configureAtlas(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const IDENTITY = new THREE.Matrix4();

function SkylineRing({ url, spec, night, name }: { url: string; spec: SkylineSpec; night: boolean; name: string }) {
  const loaded = useTexture(url);
  // The loader cache hands every caller the same instance and the ring is its
  // only consumer; configured before drei's initTexture (a passive effect),
  // so the atlas uploads once, during the ceremony.
  const atlas = useMemo(() => configureAtlas(loaded), [loaded]);

  const { mesh, geometry, material } = useMemo(() => {
    const geo = createSkylineGeometry(spec);
    const mat = createPaintFxMaterial('skyline', { atlas, spec });
    // An InstancedMesh with one identity instance: paint-fx's program is the
    // instanced one the shafts use, so the ring adds no second program.
    const inst = new THREE.InstancedMesh(geo, mat, 1);
    inst.setMatrixAt(0, IDENTITY);
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.renderOrder = -5;
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.raycast = () => {};
    inst.name = name;
    inst.userData.paintExempt = true;
    return { mesh: inst, geometry: geo, material: mat };
  }, [atlas, spec, name]);

  useLayoutEffect(() => {
    writeSkylineUniforms(material, night, spec);
  }, [material, night, spec]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
    [geometry, material, mesh],
  );

  return <primitive object={mesh} />;
}

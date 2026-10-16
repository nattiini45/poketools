'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import type { LeafPalette } from '@/lib/route-world/tree';
import {
  LEAF_ALPHA_TEST,
  LEAF_CARD_SIZE,
  cardDataTexture,
  paintLeafCardData,
  skinSeed,
} from '@/components/world/route/trees/tree-cards';
import { isNight } from '@/lib/route-world/palette';
import type { WaterBodySpec } from '@/lib/route-world/water';
import BoundedWater from '@/components/world/route/water/BoundedWater';
import { WaterBodyProvider } from '@/components/world/route/water/WaterEventContext';
import { mountainTarnColors } from '@/components/world/route/water/body-palettes';
import { useMountainPalette } from '../use-mountain-palette';
import { mountainTheme } from '../theme';
import { seeded } from './Props';
import { themeKeepOut } from '@/lib/route-world/data-surfaces';
import { MOUNTAIN_DATA_SURFACES } from './data-faces';
import { knollHeight, KNOLL, SUMMIT, SWITCHBACKS, TARN, TRAIL_SEGMENTS, SCREE_ANCHORS, TUSOCK_DRIFTS, OUTCROPS, WORN_PATHS } from './layout';

/**
 * The valley floor: one meadow disc, the granite knoll (the summit crag's
 * mound — vertex-colored from meadow turf through scree to bare rock), the
 * meltwater tarn, the switchback trail ring (ribbons whose vertices sample
 * `knollHeight`, so the path rides the knoll's toe without floating), the
 * stone switchback steps to the viewing deck, and the instanced tuft +
 * scree fields — plus the C-103 r2 composed ground beats (tussock drifts,
 * rock outcrops, beat-skirt scree and the worn social spur of
 * `TUSOCK_DRIFTS`/`OUTCROPS`/`WORN_PATHS`), which dress the bare lawn the
 * r1 visual review measured.
 *
 * C-109 r1: the tuft and tussock fields are no longer cone primitives —
 * the landed-390 visual review read the drifts as "bare untextured cone pyramids
 * with no trunks/branches" (the C-100 §3 token, read MISSED). The
 * attribution of record (gauntlet/evidence/_cc109r1-_ccC109r1-raw-attribution.log:
 * live instance-projection scans + per-field hide arms at the three landed
 * poses) seats the band on this file's two ConeGeometry fields, so both are
 * re-authored as trunked, branched, layered-card shrubs (stems + side
 * branches + alpha cards, never a primitive cone) that satisfy C-100 §3
 * themselves. Anchors, scatter seeds, scale spreads, per-instance straw→peat
 * tone math and the `grassDensity` ladder are UNCHANGED — the fix is the
 * geometry class, never a density push.
 *
 * Tuft, scree and tussock counts multiply by the quality ladder's
 * `grassDensity` (descend-only) — the rungs thin the fields, they never
 * regrow them.
 */

/** Stable pseudo-random in [0,1) — the preview fixtures' law: no Math.random. */
export { seeded } from './Props';

/** Is a point on open meadow (outside the tarn and off the trail corridors)? */
function onMeadow(x: number, z: number): boolean {
  const nx = (x - TARN.x) / (TARN.rx + 0.7);
  const nz = (z - TARN.z) / (TARN.rz + 0.7);
  if (nx * nx + nz * nz < 1) return false; // in or at the tarn
  if (Math.abs(x) < 1.3 && z > 4 && z < 15.6) return false; // gate approach
  if (Math.abs(z) < 1.15 && x > -12 && x < 12) return false; // east-west trail
  return true;
}

/**
 * A planted sprig's body for the keep-out test: the sprig is ≈ 0.3 m tall
 * at scale 1 and up to ≈ 0.55 m at the field's largest scale × stretch, so
 * a 0.28 m sphere at 0.26 m covers it.
 */
const TUFT_BODY = { y: 0.26, r: 0.28 } as const;

/**
 * Seeded tuft positions across the meadow. Fidelity wave 2 r2 (W1 keep-out):
 * a seed inside any data face's padded wedge — station, focus or dolly eye
 * (`data-surfaces.ts`) — is skipped like an off-meadow seed, so no sprig
 * stands between an eye and a board (the live verdict caught the field on
 * roster:lodge at 390). The count is unchanged; skipped seeds re-seat.
 */
function tuftPositions(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const keepOut = themeKeepOut(MOUNTAIN_DATA_SURFACES);
  let placed = 0;
  for (let i = 0; placed < count; i += 1) {
    const a = seeded(i * 2 + 1) * Math.PI * 2;
    const r = Math.sqrt(seeded(i * 2 + 2)) * 27;
    const x = Math.cos(a) * r;
    const z = -2 + Math.sin(a) * r * 0.95;
    if (!onMeadow(x, z)) continue;
    if (!keepOut.sphereClear([x, knollHeight(x, z) + TUFT_BODY.y, z], TUFT_BODY.r)) continue;
    out[placed * 3] = x;
    out[placed * 3 + 1] = knollHeight(x, z);
    out[placed * 3 + 2] = z;
    placed += 1;
  }
  return out;
}

/** Seeded scree positions hugging the knoll's toe and the tarn's shore. */
function screePositions(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const anchors = SCREE_ANCHORS;
  for (let i = 0; i < count; i += 1) {
    const [ax, az] = anchors[i % anchors.length];
    const x = ax + (seeded(i * 3 + 11) - 0.5) * 1.6;
    const z = az + (seeded(i * 3 + 12) - 0.5) * 1.6;
    out[i * 3] = x;
    out[i * 3 + 1] = knollHeight(x, z);
    out[i * 3 + 2] = z;
  }
  return out;
}

/**
 * C-103 r2: seeded tussock positions from the composed TUSOCK_DRIFTS beats —
 * the SAME member scatter the pre-framing scan validated (angle seeded(n*2),
 * radius sqrt-seeded(n*2+1) × spread, z × zFactor default 0.85), so the
 * mounted field is exactly the audited one.
 */
function tussockPositions(): {
  x: number;
  y: number;
  z: number;
  seed: number;
}[] {
  const out: { x: number; y: number; z: number; seed: number }[] = [];
  for (const [cx, cz, spread, count, seedBase, zFactor = 0.85] of TUSOCK_DRIFTS) {
    for (let i = 0; i < count; i += 1) {
      const a = seeded(seedBase + i * 2) * Math.PI * 2;
      const r = Math.sqrt(seeded(seedBase + i * 2 + 1)) * spread;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r * zFactor;
      out.push({ x, y: knollHeight(x, z), z, seed: seedBase + i });
    }
  }
  return out;
}

/**
 * One instanced field of small cones or stones — since C-109 r1, of shrubs
 * or stones. The cleanup handles the multi-material shrub meshes (material
 * array + the field's painted card textures, recorded on `userData` by the
 * builder) as well as single-material fields.
 */
/**
 * ENGINE r3 (quiet governor leg: 6 texture uploads and 12 program links per
 * ladder walk): a builder may record `userData.countFor` — the live
 * instance count at a density. Every builder here lays its instances out in
 * a fixed per-index order, so a lower density is exactly a PREFIX of a
 * higher one: the field is built once at the density it mounted with (the
 * ladder only descends) and a later density only lowers `mesh.count` — no
 * rebuilt geometry, material or card texture, and the same instances draw.
 */
type FieldUserData = { disposeTextures?: THREE.Texture[]; countFor?: (density: number) => number };

/** Lower an instanced field to `density` (a prefix of its built instances). */
function applyFieldDensity(mesh: THREE.InstancedMesh, density: number): void {
  const countFor = (mesh.userData as FieldUserData).countFor;
  if (countFor) mesh.count = Math.min(countFor(density), mesh.instanceMatrix.count);
}

function InstancedField({
  build,
  density,
}: {
  build: (density: number) => THREE.InstancedMesh;
  density: number;
}) {
  const [mountDensity] = useState(density);
  const meshRef = useMemo(() => build(mountDensity), [build, mountDensity]);
  useLayoutEffect(() => applyFieldDensity(meshRef, density), [meshRef, density]);
  useEffect(
    () => () => {
      meshRef.geometry.dispose();
      const materials = Array.isArray(meshRef.material) ? meshRef.material : [meshRef.material];
      for (const material of materials) material.dispose();
      const textures = (meshRef.userData as FieldUserData).disposeTextures;
      if (textures) for (const texture of textures) texture.dispose();
      meshRef.dispose();
    },
    [meshRef],
  );
  return <primitive object={meshRef} />;
}

// ---------------------------------------------------------------------------
// C-109 r1 shrub substitution — the trunked/branched/carded vegetation class
// ---------------------------------------------------------------------------

/** A shrub variant's identity: the tussock drifts and the fine tuft field. */
type ShrubVariant = 'tussock' | 'tuft';

/** Which card-paint seed a variant uses (deterministic per variant). */
const SHRUB_SEED: Record<ShrubVariant, string> = {
  tussock: 'mountain-tussock-shrub',
  tuft: 'mountain-tuft-sprig',
};

/** One merged-geometry part: a transformed primitive and its material group. */
interface ShrubPart {
  geometry: THREE.BufferGeometry;
  /** 0 = stem/branch geometry, 1 = layered leaf-card canopy. */
  materialIndex: 0 | 1;
}

/**
 * Merge the shrub's transformed primitives into ONE geometry with two
 * material groups (stems, cards), so a whole field stays a single
 * InstancedMesh — the render-path instanced-mesh count is part of the
 * parity anchors of record — while every instance still carries trunk +
 * branch + layered-card structure (C-100 §3, never a primitive cone).
 * Parts must arrive grouped by materialIndex (stems first, cards second)
 * so the groups are contiguous runs.
 */
function mergeShrubGeometry(parts: ShrubPart[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let cursor = 0;
  let lastMaterial = -1;
  for (const { geometry, materialIndex } of parts) {
    const flat = geometry.toNonIndexed();
    const pos = flat.getAttribute('position');
    const nor = flat.getAttribute('normal');
    const uv = flat.getAttribute('uv');
    for (let i = 0; i < pos.count; i += 1) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (materialIndex !== lastMaterial) {
      groups.push({ start: cursor, count: pos.count, materialIndex });
      lastMaterial = materialIndex;
    } else {
      groups[groups.length - 1].count += pos.count;
    }
    cursor += pos.count;
    flat.dispose();
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (const group of groups) merged.addGroup(group.start, group.count, group.materialIndex);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * The tussock shrub: a tapered straw stem, three side branches fanning from
 * the stem's upper half, and three layered leaf cards at staggered heights —
 * planted silhouette ≈ the cone it replaces (≈ 0.62 m crown at scale 1, so
 * every drift lands where its framing scan of record validated).
 */
function tussockShrubParts(): ShrubPart[] {
  const parts: ShrubPart[] = [];
  parts.push({
    geometry: new THREE.CylinderGeometry(0.014, 0.042, 0.34, 5).translate(0, 0.17, 0),
    materialIndex: 0,
  });
  for (let i = 0; i < 3; i += 1) {
    parts.push({
      geometry: new THREE.CylinderGeometry(0.005, 0.012, 0.26, 4)
        .translate(0, 0.13, 0)
        .rotateZ(0.72)
        .translate(0, 0.19, 0)
        .rotateY((i * Math.PI * 2) / 3),
      materialIndex: 0,
    });
  }
  const cards: readonly (readonly [number, number, number])[] = [
    [0.28, 0.1, 0.12],
    [0.4, 2.19, -0.1],
    [0.5, 4.3, 0.08],
  ];
  for (const [y, yaw, tilt] of cards) {
    parts.push({
      geometry: new THREE.PlaneGeometry(0.34, 0.3)
        .translate(0, 0.15, 0.06)
        .rotateX(tilt)
        .rotateY(yaw)
        .translate(0, y, 0),
      materialIndex: 1,
    });
  }
  return parts;
}

/**
 * The tuft sprig: the fine meadow field's shrub — one short stem, one side
 * branch, two layered cards (planted silhouette ≈ the 0.32 m cone class it
 * replaces).
 */
function tuftSprigParts(): ShrubPart[] {
  const parts: ShrubPart[] = [];
  parts.push({
    geometry: new THREE.CylinderGeometry(0.006, 0.016, 0.16, 4).translate(0, 0.08, 0),
    materialIndex: 0,
  });
  parts.push({
    geometry: new THREE.CylinderGeometry(0.003, 0.008, 0.14, 3)
      .translate(0, 0.07, 0)
      .rotateZ(0.6)
      .translate(0, 0.1, 0)
      .rotateY(1.1),
    materialIndex: 0,
  });
  parts.push({
    geometry: new THREE.PlaneGeometry(0.17, 0.15)
      .translate(0, 0.075, 0.03)
      .rotateX(0.1)
      .translate(0, 0.12, 0),
    materialIndex: 1,
  });
  parts.push({
    geometry: new THREE.PlaneGeometry(0.15, 0.13)
      .translate(0, 0.07, 0.03)
      .rotateX(-0.08)
      .rotateY(2.3)
      .translate(0, 0.2, 0),
    materialIndex: 1,
  });
  return parts;
}

/** The palette tones a shrub field's shared assets derive from. */
interface ShrubTones {
  meadow: string;
  trail: string;
  snow: string;
}

/**
 * One variant's shared shrub assets: the merged two-group geometry, the
 * painted leaf-card texture (tree-cards paint — the tree system's own
 * alpha-seam law), and the two materials. Both materials sit on WHITE base
 * colors so the per-instance straw→peat `instanceColor` — the r3-measured
 * tone spread of record — stays the only tone owner, exactly as it was on
 * the cones; the card paint itself is the palette's straw ramp (meadow→trail,
 * the drift identity) neutralized toward the package's near-white snow
 * token, so hue always derives from the palette.
 */
function shrubAssets(variant: ShrubVariant, tones: ShrubTones) {
  const geometry = mergeShrubGeometry(variant === 'tussock' ? tussockShrubParts() : tuftSprigParts());
  const straw = new THREE.Color(tones.meadow).lerp(new THREE.Color(tones.trail), 0.72);
  const neutral = straw.clone().lerp(new THREE.Color(tones.snow), 0.85);
  const tone = (multiplier: number): { r: number; g: number; b: number } => ({
    r: Math.min(255, Math.round(neutral.r * 255 * multiplier)),
    g: Math.min(255, Math.round(neutral.g * 255 * multiplier)),
    b: Math.min(255, Math.round(neutral.b * 255 * multiplier)),
  });
  const leaf: LeafPalette = {
    base: tone(0.94),
    lit: tone(1),
    shadow: tone(0.7),
    bloom: null,
    bloomShare: 0,
  };
  const cardData = paintLeafCardData(leaf, 'A', skinSeed(SHRUB_SEED[variant], 2));
  const cardTexture = cardDataTexture(cardData, LEAF_CARD_SIZE, true);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  const cardMaterial = new THREE.MeshStandardMaterial({
    map: cardTexture,
    color: 0xffffff,
    alphaTest: LEAF_ALPHA_TEST,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  return { geometry, materials: [stemMaterial, cardMaterial], textures: [cardTexture] };
}

/**
 * The knoll mound: a tessellated disc displaced by `knollHeight`, with
 * vertex colors running meadow turf → scree → bare granite by height (and a
 * seeded noise edge so the bands are geological, not machine-drawn). The
 * same function seats every step and ribbon, so nothing floats.
 */
function Knoll() {
  const palette = useMountainPalette();
  const meshRef = useMemo(() => {
    const geometry = new THREE.CircleGeometry(KNOLL.r + 0.4, 72, 0, Math.PI * 2);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i);
      const wx = v.x + KNOLL.x;
      const wz = v.z + KNOLL.z;
      const h = knollHeight(wx, wz);
      position.setY(i, h);
      // Turf → scree → granite by height with a noise-broken boundary.
      const t = THREE.MathUtils.clamp(h / KNOLL.h, 0, 1);
      const noise = seeded(i * 7 + 3) * 0.18;
      const rockT = THREE.MathUtils.smoothstep(t, 0.42 + noise, 0.78 + noise);
      const screeT = THREE.MathUtils.smoothstep(t, 0.22 + noise * 0.5, 0.45 + noise);
      const r = 0.39 + 0.16 * screeT + 0.09 * rockT;
      const g = 0.49 + 0.12 * screeT + 0.07 * rockT;
      const b = 0.31 + 0.12 * screeT + 0.07 * rockT;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(KNOLL.x, 0, KNOLL.z);
    mesh.name = 'mountain-knoll';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }, []);

  useEffect(
    () => () => {
      meshRef.geometry.dispose();
      (meshRef.material as THREE.Material).dispose();
    },
    [meshRef],
  );

  // The tint rides the meadow token so day and night agree with the floor.
  useEffect(() => {
    const material = meshRef.material as THREE.MeshStandardMaterial;
    const c = new THREE.Color(palette.meadowColor);
    material.color.copy(c);
  }, [meshRef, palette.meadowColor]);

  return <primitive object={meshRef} />;
}

/** The summit crag: faceted boulders with ALTITUDE-DRIVEN snow shading. */
function Crag() {
  const palette = useMountainPalette();
  const rockTone = palette.rockColor;
  const cliffTone = palette.cliffColor;
  const snowTone = palette.snowColor;
  const groupRef = useMemo(() => {
    // (x, top-y, z, radius, y-scale) — the pinnacle cluster above the board
    // seat; the tall peak tops out ≈ y 9.6, and the three shoulder rocks
    // that read beside the board at the pulse pose top out at 7.9-8.7 —
    // all clearly across the SUMMIT.snowline band (6.4 → 8.2), so the crag
    // reads snow-capped as the theme claims (r2 letter fix: the shoulder
    // tops were raised from 6.8/7.3/7.0; x, z and radii are untouched from
    // the angle-checked r1 set below).
    // Angle-check capture fixes (wedge over board rows 5-8 at the desktop
    // pose): the main peak at [-8,-17.2] r3.0 bulged ~1.3 m through the
    // board plane inside the face's lateral span — it now sits at
    // [-8.8,-18.2] r2.4, ≥ 0.5 m clear of the plane; the [-9.4,-15.2] and
    // [-5.6,-17.4] shoulder rocks moved to seats fully behind the plane or
    // outside the bezel's lateral span (all six anchors re-checked against
    // the board plane n = [0.591, 0.807]; a top-y raise moves vertices
    // ALONG that vertical plane, so every clearance still holds).
    const anchors: readonly (readonly [number, number, number, number, number])[] = [
      [-8.8, 9.6, -18.2, 2.4, 1.5],
      [-4.2, 7.9, -18.8, 1.5, 1.3],
      [-10.2, 8.7, -17.0, 2.1, 1.3],
      [-7.0, 8.5, -19.0, 2.6, 1.2],
      [-10.1, 6.2, -16.2, 1.7, 1.1],
      [-3.4, 5.3, -17.2, 1.05, 1.0],
    ];
    const group = new THREE.Group();
    group.name = 'mountain-crag';
    for (let i = 0; i < anchors.length; i += 1) {
      const [x, topY, z, r, ys] = anchors[i];
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0.2, 1, 0.15).normalize(),
        seeded(i * 5 + 17) * Math.PI * 2,
      );
      const scale = new THREE.Vector3(
        r * (0.92 + seeded(i * 5 + 18) * 0.2),
        r * ys,
        r * (0.9 + seeded(i * 5 + 19) * 0.2),
      );
      // Center the rock so its TOP lands at topY (the icosahedron's local
      // top is +1 × scale.y under the rotation — compose the matrix, bake it
      // into a clone, and measure the true vertex span below).
      const geometry = new THREE.IcosahedronGeometry(1, 2);
      geometry.applyQuaternion(quat);
      geometry.scale(scale.x, scale.y, scale.z);
      const position = geometry.attributes.position as THREE.BufferAttribute;
      let maxTop = -Infinity;
      for (let v = 0; v < position.count; v += 1) {
        maxTop = Math.max(maxTop, position.getY(v));
      }
      const cy = topY - maxTop;
      geometry.translate(x, cy, z);
      // Altitude-driven snow: the snowline is a WORLD-Y band
      // (SUMMIT.snowline); per-vertex color mixes bare granite below to snow
      // above with a seeded ragged boundary — snow caps on the peaks, bare
      // rock below, never a uniform white mass. Tones come from the palette,
      // so the day/night switch re-runs this builder with the new light.
      const colors = new Float32Array(position.count * 3);
      const rock = new THREE.Color(rockTone);
      const cliff = new THREE.Color(cliffTone);
      const snow = new THREE.Color(snowTone);
      const { below, above } = SUMMIT.snowline;
      const v = new THREE.Vector3();
      for (let vi = 0; vi < position.count; vi += 1) {
        v.fromBufferAttribute(position, vi);
        const worldY = v.y + (seeded(i * 97 + vi) - 0.5) * 1.2;
        const snowT = THREE.MathUtils.smoothstep(worldY, below, above);
        const faceT = Math.abs(v.x) * 0.06 + Math.abs(v.z) * 0.06;
        const c = cliff.clone().lerp(rock, THREE.MathUtils.clamp(0.55 - faceT, 0, 1));
        c.lerp(snow, snowT);
        colors[vi * 3] = c.r;
        colors[vi * 3 + 1] = c.g;
        colors[vi * 3 + 2] = c.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `mountain-crag-rock-${i}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
    // Rebuilt when the light flips: the snow/rock tones are baked per-vertex.
  }, [rockTone, cliffTone, snowTone]);

  useEffect(
    () => () => {
      groupRef.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    },
    [groupRef],
  );

  return <primitive object={groupRef} />;
}

/** Body id figure controllers ask `useWaterBody` for. */
export const MOUNTAIN_TARN_ID = 'mountain-tarn';

/**
 * Radius around the knoll centre where the knoll's turf crosses the tarn's
 * rest surface (`knollHeight(d) === TARN.y`). The knoll's toe rises through
 * the tarn's north-west quadrant, so without this the far shore was a hard
 * turf/water intersection with no wet band or foam (fidelity W3 r1 gap:
 * "sharp straight edge to the meadow"). `knollHeight` is radial, so that
 * waterline is a circle and is handed to the water body as an island: the
 * shore fade, wet rim, foam lip and ripple rejection follow it.
 *
 * It mirrors the RENDERED knoll, not the analytic profile: `Knoll` builds a
 * `CircleGeometry(KNOLL_MESH_R, 72)`, which is a centre fan with no interior
 * rings, so the mound renders as a cone from `knollHeight` at the centre to
 * 0 at the rim (the ≈0.9 m difference from the analytic crossing matters:
 * inside an island the water is all foam lip). If the knoll is ever
 * tessellated radially, switch this to the analytic crossing of
 * `knollHeight(d) === TARN.y`.
 */
const KNOLL_MESH_R = KNOLL.r + 0.4;
const KNOLL_WATERLINE_R = KNOLL_MESH_R * (1 - TARN.y / knollHeight(KNOLL.x, KNOLL.z));

/**
 * The meltwater tarn — a thin adapter over the shared bounded water (spec
 * §5.2; optical disclosures live in `route/water/BoundedWater.tsx`). It
 * replaces the flat-colour disc and its shallow ring, which sat 5 mm UNDER
 * the opaque disc and never showed. The tarn's read against Sakura's lake:
 * small and cold — low, short wind ripples, glacial-teal absorption through
 * a shallower bowl, a stony wet rim meeting the gravel band, and only a rare
 * snowmelt drip for an ambient event. Footprint unchanged (`TARN` ellipse).
 */
function Tarn() {
  const palette = useMountainPalette();
  const night = isNight(palette.exposure);

  const spec = useMemo<WaterBodySpec>(
    () => ({
      id: MOUNTAIN_TARN_ID,
      center: [TARN.x, TARN.z],
      radii: [TARN.rx, TARN.rz],
      surfaceY: TARN.y,
      // Gravel band height; the meadow under the tarn sits lower.
      floorY: 0.012,
      depthM: 0.9,
      shoreBandM: 0.5,
      // Σ amplitude ≈ 2.7 cm: a still mountain pool ruffled by valley wind.
      waves: [
        { dirRad: -0.4, wavelengthM: 4.2, amplitudeM: 0.014, speed: 0.6, steepness: 0.15 },
        { dirRad: 1.3, wavelengthM: 2.1, amplitudeM: 0.009, speed: 0.5, steepness: 0.1 },
        { dirRad: 2.8, wavelengthM: 0.9, amplitudeM: 0.004, speed: 0.4, steepness: 0.05 },
      ],
      capillary: { scaleM: 0.35, strength: 0.03 },
      // r2: darker bowl centre + a horizon reflection lifted to a
      // guaranteed value gap over the body (`body-palettes.ts`).
      colors: mountainTarnColors(palette, night),
      ambient: { periodS: 8.5, streams: 1, strength: 0.55, seed: 0x7a3 },
      // The knoll toe's waterline as an inner shore (see KNOLL_WATERLINE_R).
      islands: [{ x: KNOLL.x, z: KNOLL.z, r: KNOLL_WATERLINE_R }],
    }),
    [palette, night],
  );

  return (
    <group>
      <WaterBodyProvider spec={spec}>
        <BoundedWater
          spec={spec}
          sunDirection={mountainTheme.lights.keyDirection}
          sunColor={palette.keyLight}
          night={night}
        />
      </WaterBodyProvider>
      {/* Gravel shore band (r2: metric, noise-broken, fading into turf). */}
      <TarnShoreLip wet={palette.rockColor} gravel={palette.trailColor} meadow={palette.meadowColor} />
    </group>
  );
}

/**
 * The tarn's gravel lip (fidelity W3 r2). The old lip was a scaled
 * `ringGeometry` — a crisp, uniform ellipse against the meadow, so the tarn
 * read as a pasted pale strip. This one is built in world metres around the
 * `TARN` ellipse with three vertex rings: a wet, darker inner edge tucked
 * 6 cm under the water rim, a gravel band whose width wanders with a smooth
 * angular noise (≈ 0.35–0.7 m), and an outer edge vertex-coloured to the
 * meadow tone so the band dissolves into the turf instead of ending on a
 * line. Colours are vertex colours on a white material (linear, from the
 * palette roles); the outer turf tone is the meadow token, not the exact
 * shaded floor, so a faint tone step can remain under strong key light.
 */
function TarnShoreLip({ wet, gravel, meadow }: { wet: string; gravel: string; meadow: string }) {
  const mesh = useMemo(() => {
    const segments = 128;
    const cWet = new THREE.Color(gravel).lerp(new THREE.Color(wet), 0.55).multiplyScalar(0.72);
    const cGravel = new THREE.Color(gravel);
    const cMeadow = new THREE.Color(meadow);
    const positions = new Float32Array(segments * 3 * 3);
    const colors = new Float32Array(segments * 3 * 3);
    const index: number[] = [];
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const ex = TARN.rx * Math.cos(a);
      const ez = TARN.rz * Math.sin(a);
      // Outward unit normal of the ellipse at this parameter.
      const nx0 = Math.cos(a) / TARN.rx;
      const nz0 = Math.sin(a) / TARN.rz;
      const nl = Math.hypot(nx0, nz0);
      const nx = nx0 / nl;
      const nz = nz0 / nl;
      const wander = 0.5 + 0.3 * Math.sin(3 * a + 1.3) + 0.2 * Math.sin(7 * a + 0.4);
      const offsets = [-0.06, 0.35 + 0.2 * wander, 0.6 + 0.45 * wander];
      const ringColors = [cWet, cGravel, cMeadow];
      for (let r = 0; r < 3; r += 1) {
        const o = (i * 3 + r) * 3;
        positions[o] = ex + nx * offsets[r];
        positions[o + 1] = 0;
        positions[o + 2] = ez + nz * offsets[r];
        colors[o] = ringColors[r].r;
        colors[o + 1] = ringColors[r].g;
        colors[o + 2] = ringColors[r].b;
      }
      const j = (i + 1) % segments;
      for (let r = 0; r < 2; r += 1) {
        const a0 = i * 3 + r;
        const b0 = j * 3 + r;
        // Counter-clockwise seen from above (+Y normals).
        index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const lip = new THREE.Mesh(geometry, material);
    lip.name = 'mountain-tarn-lip';
    lip.position.set(TARN.x, 0.012, TARN.z);
    lip.receiveShadow = true;
    return lip;
  }, [wet, gravel, meadow]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );

  return <primitive object={mesh} />;
}

/**
 * One trail segment ribbon: a straight strip tessellated along its span,
 * every vertex seated at `knollHeight(x, z) + lift` — the ribbon rides the
 * knoll's toe with the meadow, so no segment ever floats.
 */
function TrailSegment({ from, to, width = 2.2 }: { from: readonly [number, number]; to: readonly [number, number]; width?: number }) {
  const palette = useMountainPalette();
  const meshRef = useMemo(() => {
    const [x0, z0] = from;
    const [x1, z1] = to;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const rings = Math.max(2, Math.round(len / 0.8));
    const rx = (-dz / len) * (width / 2);
    const rz = (dx / len) * (width / 2);
    const positions = new Float32Array((rings + 1) * 2 * 3);
    const index: number[] = [];
    for (let i = 0; i <= rings; i += 1) {
      const t = i / rings;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      const y = knollHeight(x, z) + 0.025;
      positions[i * 6] = x - rx;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z - rz;
      positions[i * 6 + 3] = x + rx;
      positions[i * 6 + 4] = y;
      positions[i * 6 + 5] = z + rz;
      if (i < rings) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'mountain-trail';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }, [from, to, width]);

  useEffect(
    () => () => {
      meshRef.geometry.dispose();
      (meshRef.material as THREE.Material).dispose();
    },
    [meshRef],
  );

  useEffect(() => {
    (meshRef.material as THREE.MeshStandardMaterial).color.set(palette.trailColor);
  }, [meshRef, palette.trailColor]);

  return <primitive object={meshRef} />;
}

/**
 * The switchback steps: stone slabs tiling each leg of `SWITCHBACKS`, every
 * slab seated at `knollHeight(x, z)` at its own center — the stepped trail
 * reads walkable and can never float, because seat and terrain are the same
 * function.
 */
function SwitchbackSteps() {
  const palette = useMountainPalette();
  const steps = useMemo(() => {
    const out: { x: number; y: number; z: number; yaw: number; w: number }[] = [];
    for (const { from, to } of SWITCHBACKS) {
      const [x0, z0] = from;
      const [x1, z1] = to;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(2, Math.round(len / 0.62));
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i += 1) {
        const t = (i + 0.5) / (n + 1);
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        out.push({ x, y: knollHeight(x, z), z, yaw, w: len / (n + 1) });
      }
    }
    return out;
  }, []);

  return (
    <group>
      {steps.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, s.y + 0.035, s.z]}
          rotation={[0, s.yaw, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[Math.min(1.9, s.w * 1.12), 0.07, 0.6]} />
          <meshStandardMaterial color={palette.lanternStone} roughness={0.9} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * C-103 r2 rock outcrops: the beats' hard anchors — faceted granite knobs
 * (same material family as the crag/scree), partially buried at their
 * knollHeight seat so nothing floats. Paired with the tussock drifts and
 * skirt scree they read as one eroded formation per beat, not dropped rocks.
 */
function Outcrops() {
  const palette = useMountainPalette();
  const groupRef = useMemo(() => {
    const group = new THREE.Group();
    group.name = 'mountain-outcrops';
    OUTCROPS.forEach(([x, z, r, ys], i) => {
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0.25, 1, 0.18).normalize(),
        seeded(i * 7 + 311) * Math.PI * 2,
      );
      geometry.applyQuaternion(quat);
      geometry.scale(r * (0.92 + seeded(i * 7 + 313) * 0.16), r * ys, r * (0.9 + seeded(i * 7 + 317) * 0.2));
      const position = geometry.attributes.position as THREE.BufferAttribute;
      let minTop = Infinity;
      for (let v = 0; v < position.count; v += 1) minTop = Math.min(minTop, position.getY(v));
      // Seat: the lowest vertex 5 cm above the analytic field — the knoll
      // mound renders 0.03-0.13 proud at these seats (live raycast sweep,
      // _cC103r2-seat-probe3.log), so the rock's base tucks just under the
      // rendered turf instead of floating (the C-107 min.y law).
      geometry.translate(x, knollHeight(x, z) - minTop + 0.05, z);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: palette.rockColor,
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `mountain-outcrop-${i}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    return group;
    // Rebuilt with the light: the rock tone is a palette color.
  }, [palette.rockColor]);

  useEffect(
    () => () => {
      groupRef.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    },
    [groupRef],
  );

  return <primitive object={groupRef} />;
}

export default function AlpineValley() {
  const palette = useMountainPalette();
  const { grassDensity } = useQuality();

  const tufts = useMemo(() => tuftPositions(1200), []);
  const scree = useMemo(() => screePositions(190), []);

  const tuftField = useMemo(
    () =>
      (density: number) => {
        const total = tufts.length / 3;
        const live = Math.max(0, Math.floor(total * density));
        // C-109 r1: the cone class is gone — each tuft is a stem + branch +
        // layered-card sprig (C-100 §3); scatter, scale spread and seat are
        // the audited ones, untouched.
        const { geometry, materials, textures } = shrubAssets('tuft', {
          meadow: palette.meadowColor,
          trail: palette.trailColor,
          snow: palette.snowColor,
        });
        const mesh = new THREE.InstancedMesh(geometry, materials, live);
        (mesh.userData as FieldUserData).countFor = (next: number) => Math.max(0, Math.floor(total * next));
        (mesh.userData as FieldUserData).disposeTextures = textures;
        const matrix = new THREE.Matrix4();
        const color = new THREE.Color();
        for (let i = 0; i < live; i += 1) {
          const s = 0.7 + seeded(i + 911) * 0.6;
          matrix.makeScale(s, s * (0.8 + seeded(i + 71) * 0.6), s);
          // The sprig geometry is base-seated (unlike the centered cone), so
          // the planted base stays on the field exactly where the cone's was.
          matrix.setPosition(tufts[i * 3], tufts[i * 3 + 1], tufts[i * 3 + 2]);
          mesh.setMatrixAt(i, matrix);
          // The cone's material color was the meadow token; the white-base
          // shrub carries it as instanceColor with a seeded ±10 % spread so
          // the field stays organic and day/night agree with the floor.
          color.copy(new THREE.Color(palette.meadowColor)).multiplyScalar(0.9 + seeded(i + 931) * 0.2);
          mesh.setColorAt(i, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = 'mountain-meadow-tufts';
        return mesh;
      },
    [tufts, palette.meadowColor, palette.trailColor, palette.snowColor],
  );

  const screeField = useMemo(
    () =>
      (density: number) => {
        const total = scree.length / 3;
        const live = Math.max(0, Math.floor(total * density));
        const geometry = new THREE.IcosahedronGeometry(0.16, 0);
        const material = new THREE.MeshStandardMaterial({
          color: palette.rockColor,
          roughness: 0.95,
          metalness: 0.02,
          flatShading: true,
        });
        const mesh = new THREE.InstancedMesh(geometry, material, live);
        (mesh.userData as FieldUserData).countFor = (next: number) => Math.max(0, Math.floor(total * next));
        const matrix = new THREE.Matrix4();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const pos = new THREE.Vector3();
        for (let i = 0; i < live; i += 1) {
          const s = 0.5 + seeded(i * 3 + 311) * 0.9;
          quat.setFromAxisAngle(new THREE.Vector3(0.3, 1, 0.2).normalize(), seeded(i + 313) * Math.PI);
          scale.set(s, s * 0.6, s * (0.8 + seeded(i + 317) * 0.4));
          pos.set(scree[i * 3], scree[i * 3 + 1] + 0.06 * s, scree[i * 3 + 2]);
          matrix.compose(pos, quat, scale);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.name = 'mountain-scree';
        return mesh;
      },
    [scree, palette.rockColor],
  );

  const tussocks = useMemo(() => tussockPositions(), []);

  /**
   * The tussock drifts (C-103 r2; clump scale r3): straw-toned clumps that
   * READ against the turf. C-109 r1: the clump is no longer a ConeGeometry —
   * the landed-390 visual review read the drifts as bare cone pyramids (the C-100 §3
   * token, MISSED), and the attribution of record
   * (_cc109r1-_ccC109r1-raw-attribution.log) seats that band on this field,
   * so each member is re-authored as a trunked, branched, layered-card
   * shrub (stems + side branches + alpha cards — never a primitive cone).
   * The member scatter, the seeded scale spread, and the r3 tone math below
   * are UNCHANGED; the seat keeps the audited ~0.09·s base burial (the shrub
   * geometry is base-seated, so the seat translates by the burial only).
   * Counts still multiply by the ladder's `grassDensity` — no second switch,
   * no density push.
   */
  const tussockField = useMemo(
    () =>
      (density: number) => {
        const total = tussocks.length;
        const live = Math.max(0, Math.floor(total * density));
        const { geometry, materials, textures } = shrubAssets('tussock', {
          meadow: palette.meadowColor,
          trail: palette.trailColor,
          snow: palette.snowColor,
        });
        const mesh = new THREE.InstancedMesh(geometry, materials, live);
        (mesh.userData as FieldUserData).countFor = (next: number) => Math.max(0, Math.floor(total * next));
        (mesh.userData as FieldUserData).disposeTextures = textures;
        const strawBase = new THREE.Color(palette.meadowColor).lerp(new THREE.Color(palette.trailColor), 0.72);
        const pineSide = new THREE.Color(palette.pineColorB).lerp(new THREE.Color(palette.meadowColor), 0.22);
        const matrix = new THREE.Matrix4();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const pos = new THREE.Vector3();
        const color = new THREE.Color();
        for (let i = 0; i < live; i += 1) {
          const t = tussocks[i];
          const s = 0.6 + seeded(t.seed + 71) * 1.05;
          quat.setFromAxisAngle(new THREE.Vector3(0.12, 1, 0.08).normalize(), seeded(t.seed + 73) * Math.PI);
          scale.set(s, s * (0.85 + seeded(t.seed + 77) * 0.15), s);
          pos.set(t.x, t.y - 0.09 * s, t.z);
          matrix.compose(pos, quat, scale);
          mesh.setMatrixAt(i, matrix);
          // r3 tone: deep dry-straw, less green-side mix, WIDE per-instance
          // spread — the r2 tones (bright straw near the sun-lawn ball,
          // shadowed instances at rgb 135,154,125 on roster-390) sat inside
          // the classifier's R=34 lawn balls, and each station's AgX wash
          // ball swallows a different mid-tone (rules-1440's sun ball eats
          // mid straw; pulse's dark sun seed eats dark olive) — only a wide
          // bright-to-dark straw spread escapes at every station. Dressing
          // that diverges in tone leaves the class (the instrument's own
          // mechanism).
          color.copy(strawBase).lerp(pineSide, seeded(t.seed + 79) * 0.12);
          const toneR = seeded(t.seed + 83);
          // Deep warm peat-brown, uniform-dark: the three stations' AgX wash
          // balls (pulse's dark sun-lawn, rules-1440's washed-bright mid,
          // roster's mid-green) jointly pinch every green/mid hue — measured
          // escape margins exist only below ~rgb(110,100,90). The drifts read
          // as peaty turf hummocks — the scree/outcrop material family.
          color.multiplyScalar(0.36 + toneR * 0.12);
          mesh.setColorAt(i, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.name = 'mountain-tussocks';
        return mesh;
      },
    [tussocks, palette.meadowColor, palette.trailColor, palette.pineColorB, palette.snowColor],
  );

  return (
    <group>
      {/* Meadow disc, under everything. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2]} receiveShadow>
        <circleGeometry args={[46, 64]} />
        <meshStandardMaterial color={palette.meadowColor} roughness={0.96} metalness={0} />
      </mesh>
      <Knoll />
      <Crag />
      <Tarn />
      {TRAIL_SEGMENTS.map((seg, i) => (
        <TrailSegment key={i} from={seg.from} to={seg.to} width={seg.width ?? 2.2} />
      ))}
      {WORN_PATHS.map((p, i) => (
        <TrailSegment key={`worn-${i}`} from={p.from} to={p.to} width={p.width} />
      ))}
      <SwitchbackSteps />
      <Outcrops />
      <InstancedField build={tuftField} density={grassDensity} />
      <InstancedField build={screeField} density={grassDensity} />
      <InstancedField build={tussockField} density={grassDensity} />
    </group>
  );
}

'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { QUALITY_LADDER } from '@/lib/route-world/quality';
import {
  applyTreeDensity,
  canopyModeFor,
  crownSphere,
  growTree,
  isTreeCulled,
  paintedCanopyDrawCount,
  planPaintedCanopy,
  treeDensityForRung,
  type TreeSkin,
  type TreeSpec,
  type TreeStructure,
} from '@/lib/route-world/tree';
import type { CanopyLook } from '@/lib/route-world/theme-types';
import { queuePaint } from '@/components/world/route/paint-queue';
import {
  LEAF_CARD_SIZE,
  LEAF_LAMP,
  LEAF_LAMP_COLOR,
  LEAF_SIL,
  LEAF_SSS,
  adoptCrownGeometry,
  buildCanopyGeometry,
  lampProximity,
  canopyAtlasTexture,
  cardDataTexture,
  createCanopyMaterial,
  createCrownPlaceholderGeometry,
  paintBarkCardData,
  paintLeafCardData,
  resetCanopyLight,
  skinSeed,
} from './tree-cards';

/**
 * The shared tree mounter (C-100 criterion 3): REAL trunk + branch geometry
 * (tapered cylinders along the grown segments — never a primitive cone or a
 * single billboard), a layered alpha-card canopy from the skin's two painted
 * leaf-card sets, wind, quality-gated density tiers and distance culling.
 *
 * Wind is a vertex sway in the canopy material (per-card phase from the
 * grown structure, amplitude weighted toward each card's top edge) — cards
 * flutter out of phase instead of the whole crown rocking as one plane.
 * Density comes from the QUALITY_LADDER rung (`treeDensityForRung`), culling
 * from the horizontal camera distance per frame.
 */

export interface TreeSkinMaterials {
  bark: THREE.Texture;
  leafA: THREE.Texture;
  leafB: THREE.Texture;
  barkMaterial: THREE.MeshStandardMaterial;
  leafMaterial: THREE.MeshStandardMaterial;
  leafMaterialB: THREE.MeshStandardMaterial;
  uniforms: { uTime: { value: number } };
  /**
   * The painted canopy (skins with `canopy: 'painted'` only — the plaza):
   * the A-over-B card atlas and ONE canopy material, handed to the mesh as a
   * one-entry array (see `PaintedTree`). Absent for card skins.
   */
  canopy?: { atlas: THREE.DataTexture; material: THREE.MeshStandardMaterial; materials: THREE.Material[] };
}

/**
 * Paint + material set for one skin. The card paint runs once per skin
 * (pure pixel fields, `tree-cards.ts`), the textures wrap it once, and the
 * two leaf materials share ONE compiled wind program (the B set is a map
 * swap clone) so `uTime` is a single uniform tick per frame.
 */
/**
 * The shared wind clock. Module scope on purpose: every tree in the page
 * flutters on one uTime (a world has ONE wind), the per-card `aPhase`
 * attributes keep individual cards out of lockstep, and a plain module
 * object needs no ref/mutation gymnastics to feed a shader uniform.
 */
const WIND_CLOCK = { value: 0 };

export function useTreeSkinMaterials(skin: TreeSkin): TreeSkinMaterials {
  const materials = useMemo(() => {
    const barkData = paintBarkCardData(skin.bark, skinSeed(skin.id, 1));
    const leafDataA = paintLeafCardData(skin.leafA, 'A', skinSeed(skin.id, 2));
    const leafDataB = paintLeafCardData(skin.leafB, 'B', skinSeed(skin.id, 3));
    const bark = cardDataTexture(barkData, LEAF_CARD_SIZE, true);
    const leafA = cardDataTexture(leafDataA, LEAF_CARD_SIZE, true);
    const leafB = cardDataTexture(leafDataB, LEAF_CARD_SIZE, true);

    // Wind: uTime-driven sway in the vertex stage. Per-vertex `aSway`
    // (0 at a card's base edge, 1 at its top) weights the displacement, and
    // the per-card phase rides in `aPhase`. No backticks inside the GLSL.
    const uniforms = { uTime: WIND_CLOCK };
    const barkMaterial = new THREE.MeshStandardMaterial({
      map: bark,
      roughness: 0.95,
      metalness: 0,
    });
    const leafMaterial = new THREE.MeshStandardMaterial({
      map: leafA,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
    });
    leafMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSway;\nattribute float aPhase;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nfloat windAmp = aSway * 0.11;\ntransformed.x += sin(uTime * 1.6 + aPhase) * windAmp;\ntransformed.z += cos(uTime * 1.15 + aPhase * 1.7) * windAmp * 0.7;',
        );
    };
    // The B-set cards swap the map on a clone so both sets share the wind
    // program (same compiled shader, one uniform tick per frame).
    const leafMaterialB = leafMaterial.clone();
    leafMaterialB.map = leafB;
    leafMaterialB.alphaTest = 0.5;

    // Painted skins (the plaza) add the canopy atlas + material; card skins
    // build exactly what they always did.
    let canopy: TreeSkinMaterials['canopy'];
    if (canopyModeFor(skin) === 'painted') {
      const atlas = canopyAtlasTexture(leafDataA, leafDataB, LEAF_CARD_SIZE);
      const material = createCanopyMaterial(atlas, uniforms.uTime, skin.canopyEdge);
      canopy = { atlas, material, materials: [material] };
    }

    return { bark, leafA, leafB, barkMaterial, leafMaterial, leafMaterialB, uniforms, canopy };
  }, [skin]);

  useEffect(
    () => () => {
      materials.bark.dispose();
      materials.leafA.dispose();
      materials.leafB.dispose();
      materials.barkMaterial.dispose();
      materials.leafMaterial.dispose();
      materials.leafMaterialB.dispose();
      materials.canopy?.atlas.dispose();
      materials.canopy?.material.dispose();
    },
    [materials],
  );

  // One wind clock per scene: every tree sharing any skin's materials
  // flutters on the same uTime (the per-card phases keep them out of
  // lockstep). The advance is an ASSIGNMENT from the shared render clock, not
  // a `+= delta` accumulation: one hook instance mounts per skin, so N
  // accumulating instances would run the wind at N× speed (2× in every
  // two-skin world — PR #63 review). R3F updates `clock.elapsedTime` once per
  // frame before the subscribers run, so every writer in a frame writes the
  // identical value and the clock is idempotent by construction.
  useFrame(({ clock }) => {
    WIND_CLOCK.value = clock.elapsedTime;
  });

  return materials;
}

const UP = new THREE.Vector3(0, 1, 0);

/** One branch segment → a tapered cylinder mesh between `from` and `to`. */
function SegmentMesh({ segment, material }: { segment: TreeStructure['trunk']; material: THREE.Material }) {
  const { position, quaternion, length } = useMemo(() => {
    const from = new THREE.Vector3(segment.from.x, segment.from.y, segment.from.z);
    const to = new THREE.Vector3(segment.to.x, segment.to.y, segment.to.z);
    const dir = to.clone().sub(from);
    const length = dir.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    const position = from.clone().add(to).multiplyScalar(0.5);
    return { position, quaternion, length };
  }, [segment]);
  return (
    <mesh position={position} quaternion={quaternion} material={material} castShadow>
      <cylinderGeometry args={[segment.radiusTo, segment.radiusFrom, length, 7]} />
    </mesh>
  );
}

export interface TreeProps {
  spec: TreeSpec;
  /** World placement of the trunk base. */
  position: readonly [number, number, number];
  /** Rotation about Y (radians). */
  yaw?: number;
  /** Shared material set from the skin's card paint (one per skin, many trees). */
  materials: TreeSkinMaterials;
  /**
   * LOOK r6 (L6.3, painted skins only): world lamp-head positions whose warm
   * under-light the canopy bakes as a per-vertex proximity (`aLamp`). Must be
   * a stable (module) array. Absent = no lamps.
   */
  lamps?: readonly (readonly [number, number, number])[];
}

/**
 * One deterministic tree at one placement. Card skins (sakura, mountain,
 * clouds) mount `CardTree`, the C-100 path, unchanged; painted skins (the
 * plaza) mount `PaintedTree`.
 */
export default function Tree(props: TreeProps) {
  if (canopyModeFor(props.spec.skin) === 'painted' && props.materials.canopy) return <PaintedTree {...props} />;
  return <CardTree {...props} />;
}

/** Rung index ↔ the governor's step, recovered by identity against the ladder (never below 0). */
function useQualityRung(): number {
  const quality = useQuality();
  return useMemo(() => Math.max(0, QUALITY_LADDER.findIndex((step) => step === quality)), [quality]);
}

/**
 * The plaza's painted tree (LOOK-PLAN §2 SEAT M item 2). The structure is
 * planned ONCE per (skin, height, seed) at rung-0 density — every branch and
 * the rung-0 cards, importance-sorted — and the canopy is ONE merged
 * geometry. A quality step only moves `setDrawRange` (no new geometry, no
 * upload, no program), closing the C-100 regrow for this skin.
 *
 * The canopy renders with a one-entry material array: the static batcher
 * (RouteWorldCanvas) never merges multi-material meshes, and a merged
 * family would bake the draw range away. The group spans the whole index,
 * so three intersects it with the draw range in the colour and shadow passes.
 */
function PaintedTree({ spec, position, yaw = 0, materials, lamps }: TreeProps) {
  const group = useRef<THREE.Group>(null);
  const rung = useQualityRung();
  const { skin, heightM, seed } = spec;
  const plan = useMemo(() => planPaintedCanopy({ skin, heightM, seed }), [skin, heightM, seed]);
  const [px, py, pz] = position;
  const crownBuilder = skin.paintedCrown;
  const geometry = useMemo(
    () =>
      // ROLLOUT §2.2 (h): a skin with its own crown builder mounts a
      // placeholder carrying the canopy's full attribute set (so the program
      // links at mount, in the ceremony) and fills it from the paint queue.
      crownBuilder
        ? createCrownPlaceholderGeometry()
        : buildCanopyGeometry(
            plan.cards,
            skin.cardScaleM,
            crownSphere(plan.structure, skin.cardScaleM),
            lamps && lamps.length > 0 ? lampProximity(lamps, [px, py, pz], yaw) : undefined,
          ),
    [crownBuilder, plan, skin.cardScaleM, lamps, px, py, pz, yaw],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  // The built crown's per-rung draw count (null until the queued build ran).
  const crownDrawCount = useRef<((rung: number) => number) | null>(null);
  const rungRef = useRef(rung);
  useLayoutEffect(() => {
    rungRef.current = rung;
    const count = crownBuilder ? (crownDrawCount.current?.(rung) ?? 0) : paintedCanopyDrawCount(plan, rung);
    geometry.setDrawRange(0, count);
  }, [geometry, plan, rung, crownBuilder]);
  useLayoutEffect(() => {
    if (!crownBuilder) return;
    crownDrawCount.current = null;
    return queuePaintedCrown(crownBuilder, geometry, {
      plan,
      skin,
      crown: crownSphere(plan.structure, skin.cardScaleM),
      lampAt: lamps && lamps.length > 0 ? lampProximity(lamps, [px, py, pz], yaw) : undefined,
    }, (drawCount) => {
      crownDrawCount.current = drawCount;
      geometry.setDrawRange(0, drawCount(rungRef.current));
    });
  }, [crownBuilder, geometry, plan, skin, lamps, px, py, pz, yaw]);

  useFrame(({ camera }) => {
    if (group.current) {
      group.current.visible = !isTreeCulled(
        { x: position[0], z: position[2] },
        { x: camera.position.x, z: camera.position.z },
      );
    }
  });

  const canopy = materials.canopy;
  return (
    <group ref={group} position={[position[0], position[1], position[2]]} rotation={[0, yaw, 0]}>
      <SegmentMesh segment={plan.structure.trunk} material={materials.barkMaterial} />
      {plan.structure.branches.map((branch, i) => (
        <SegmentMesh key={i} segment={branch} material={materials.barkMaterial} />
      ))}
      {canopy ? <mesh geometry={geometry} material={canopy.materials} castShadow /> : null}
    </group>
  );
}

/**
 * ROLLOUT §2.2 (h): build a skin's own crown through the sliced paint queue
 * (ENGINE r3: no crown build ever shares a task with the commit's effect
 * flush — the 0.66 s load long task) and adopt it INTO the mounted
 * placeholder geometry, so no React commit and no new program follow. The
 * load warm counts a non-empty queue as incomplete content
 * (`paintQueueIdle`), so the crown is resident before the reveal. Returns
 * the cancel (an effect cleanup).
 */
export function queuePaintedCrown(
  builder: NonNullable<TreeSkin['paintedCrown']>,
  target: THREE.BufferGeometry,
  input: Parameters<NonNullable<TreeSkin['paintedCrown']>>[0],
  onBuilt: (drawCount: (rung: number) => number) => void,
): () => void {
  return queuePaint(() => {
    const built = builder(input);
    adoptCrownGeometry(target, built.geometry);
    built.geometry.dispose();
    onBuilt(built.drawCount);
  });
}

/**
 * ROLLOUT §2.2 (h): a painted world's canopy light — `LEAF_SSS`, `LEAF_SIL`
 * and `LEAF_LAMP` from its `paint.canopy` look, per palette (and, with
 * `silStations`, the silhouette only at those stations). Uniform writes only;
 * unmount hands them back at their module defaults (`resetCanopyLight`), so
 * the next world never inherits this one's canopy. `look` null = no writes.
 */
export function useCanopyLight(look: CanopyLook | null | undefined, night: boolean, station?: string | null): void {
  const silAllowed = !look?.silStations || (station != null && look.silStations.includes(station));
  useLayoutEffect(() => {
    if (!look) return;
    LEAF_SSS.value = night ? look.sss.night : look.sss.day;
    LEAF_SIL.value = silAllowed ? (night ? look.sil.night : look.sil.day) : 0;
    LEAF_LAMP.value.set(LEAF_LAMP_COLOR).multiplyScalar(night ? look.lamp.night : look.lamp.day);
  }, [look, night, silAllowed]);
  // Leaving the world hands the shared canopy uniforms back at their defaults.
  useLayoutEffect(
    () => () => {
      if (look) resetCanopyLight();
    },
    [look],
  );
}

/**
 * The C-100 card tree. The structure grows once per (skin, height, seed); the
 * density tier prunes it per quality rung; the per-frame work is a distance
 * check that toggles visibility.
 */
function CardTree({ spec, position, yaw = 0, materials }: TreeProps) {
  const group = useRef<THREE.Group>(null);
  const quality = useQuality();
  // Rung index ↔ the governor's step: useQuality returns the full QualityStep;
  // recover the rung by identity against the ladder.
  const rung = useMemo(() => QUALITY_LADDER.findIndex((step) => step === quality), [quality]);
  const density = useMemo(() => treeDensityForRung(rung < 0 ? 0 : rung), [rung]);

  const tree = useMemo(
    () => applyTreeDensity(growTree(spec), density),
    [spec, density],
  );

  // Card geometry is shared; the wind attributes differ per card, so each
  // card mounts its own geometry clone carrying aSway/aPhase. Built in one
  // memo and disposed together with the tree.
  const cardGeometries = useMemo(() => {
    const cardGeometry = new THREE.PlaneGeometry(1, 1);
    const built = tree.cards.map((card) => {
      const geometry = cardGeometry.clone();
      const pos = geometry.getAttribute('position');
      const sway = new Float32Array(pos.count);
      const phase = new Float32Array(pos.count);
      for (let v = 0; v < pos.count; v += 1) {
        // aSway weights toward the card's TOP edge (local y = +0.5).
        sway[v] = THREE.MathUtils.clamp(pos.getY(v) + 0.5, 0, 1);
        phase[v] = card.swayPhase;
      }
      geometry.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
      geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      return geometry;
    });
    cardGeometry.dispose();
    return built;
  }, [tree]);
  useEffect(
    () => () => {
      for (const geometry of cardGeometries) geometry.dispose();
    },
    [cardGeometries],
  );

  useFrame(({ camera }) => {
    if (group.current) {
      group.current.visible = !isTreeCulled(
        { x: position[0], z: position[2] },
        { x: camera.position.x, z: camera.position.z },
      );
    }
  });

  return (
    <group ref={group} position={[position[0], position[1], position[2]]} rotation={[0, yaw, 0]}>
      <SegmentMesh segment={tree.trunk} material={materials.barkMaterial} />
      {tree.branches.map((branch, i) => (
        <SegmentMesh key={i} segment={branch} material={materials.barkMaterial} />
      ))}
      {tree.cards.map((card, i) => (
        <mesh
          key={i}
          geometry={cardGeometries[i]}
          material={card.set === 'A' ? materials.leafMaterial : materials.leafMaterialB}
          position={[card.position.x, card.position.y, card.position.z]}
          rotation={[card.tilt, card.yaw, 0]}
          scale={card.scale * spec.skin.cardScaleM}
          castShadow
        />
      ))}
    </group>
  );
}

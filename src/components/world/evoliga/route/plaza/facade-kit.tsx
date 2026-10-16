'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { prefetchFigureGLB, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { useWorldManifest, type WorldManifest } from '@/lib/route-world/model-manifest';
import { KIT_BAY_IDS, kitBayPlacements, type BlockPlan, type KitBayId, type KitBayPlacement } from '@/lib/route-world/haussmann';
import { kitBayUrls } from '@/lib/route-world/world-env';

/** Material slots the Blender kit exports; `pane` resolves to lamp or glass per placement. */
type KitSlot = 'stone' | 'iron' | 'glass' | 'pane' | 'zinc';
const KIT_SLOTS: readonly KitSlot[] = ['stone', 'iron', 'glass', 'pane', 'zinc'];

/** Runtime materials a block hands the kit so modules match the writer's walls. */
export interface KitMaterials {
  stone: THREE.Material;
  iron: THREE.Material;
  glass: THREE.Material;
  lamp: THREE.Material;
  zinc: THREE.Material;
}

interface KitPrimitive {
  geometry: THREE.BufferGeometry;
  slot: KitSlot;
  /** Primitive transform inside the module (identity for the Blender export, kept for safety). */
  local: THREE.Matrix4;
}

export type KitModels = Record<KitBayId, KitPrimitive[]>;

function isKitSlot(name: string): name is KitSlot {
  return (KIT_SLOTS as readonly string[]).includes(name);
}

function primitivesOf(scene: THREE.Object3D): KitPrimitive[] {
  scene.updateMatrixWorld(true);
  const out: KitPrimitive[] = [];
  scene.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return;
    const mesh = node as THREE.Mesh;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const slot = material?.name ?? '';
    if (!isKitSlot(slot)) return;
    out.push({ geometry: mesh.geometry, slot, local: mesh.matrixWorld.clone() });
  });
  return out;
}

export function useHasFacadeKit(): boolean {
  const manifest = useWorldManifest();
  return kitBayUrls(manifest) !== null;
}

/**
 * D42 N7a: start every kit module's fetch at once (idempotent, page life).
 * The five `useFigureGLTF` reads below suspend one after another — each
 * fetch used to begin only when the previous one resolved (about 160 ms a
 * step) — and the perimeter first suspends on its slate / stone texture
 * sets. Called where those sets are requested (`PlazaHall` `SourcedPerimeter`)
 * and again here, the kit downloads beside the textures, all five in
 * parallel. The kit carries no textures, so no KTX2 arm is needed; the
 * perimeter's `ResidentSuspense` still holds the reveal for it (D23).
 */
export function prefetchFacadeKit(manifest: WorldManifest): void {
  const urls = kitBayUrls(manifest);
  if (!urls) return;
  for (const bay of KIT_BAY_IDS) prefetchFigureGLB(urls[bay]);
}

/**
 * Suspends until every module is in; call only when `useHasFacadeKit()` is
 * true. The kit is all-or-nothing by design: a manifest that predates
 * `bay-shopfront` (or any module) makes `kitBayUrls` return `null`, and the
 * blocks fall back to the procedural writer — which carries its own authored
 * shopfront — instead of half-rendering a street (card C-029).
 */
export function useFacadeKit(): KitModels {
  const manifest = useWorldManifest();
  const urls = kitBayUrls(manifest);
  if (!urls) throw new Error('[route-world] façade kit missing from manifest');
  // N7a: all five fetches in flight before the first read suspends.
  prefetchFacadeKit(manifest);
  const ground = useFigureGLTF(urls['bay-ground']);
  const shopfront = useFigureGLTF(urls['bay-shopfront']);
  const balcony = useFigureGLTF(urls['bay-balcony']);
  const plain = useFigureGLTF(urls['bay-plain']);
  const dormer = useFigureGLTF(urls['dormer']);
  return useMemo<KitModels>(
    () => ({
      'bay-ground': primitivesOf(ground.scene),
      'bay-shopfront': primitivesOf(shopfront.scene),
      'bay-balcony': primitivesOf(balcony.scene),
      'bay-plain': primitivesOf(plain.scene),
      dormer: primitivesOf(dormer.scene),
    }),
    [ground.scene, shopfront.scene, balcony.scene, plain.scene, dormer.scene],
  );
}

const scratchMatrix = new THREE.Matrix4();
const scratchPlace = new THREE.Matrix4();

function KitInstances({
  primitive,
  placements,
  material,
  shadows,
}: {
  primitive: KitPrimitive;
  placements: KitBayPlacement[];
  material: THREE.Material;
  shadows: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = placements.length;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    placements.forEach((placement, i) => {
      scratchPlace.makeTranslation(placement.x, placement.y, placement.z);
      scratchMatrix.multiplyMatrices(scratchPlace, primitive.local);
      mesh.setMatrixAt(i, scratchMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, primitive]);

  if (count === 0) return null;
  return (
    <instancedMesh
      key={count}
      ref={ref}
      args={[primitive.geometry, material, count]}
      castShadow={shadows}
      receiveShadow={shadows}
    />
  );
}

/**
 * Instanced façade modules for one block (ADR-0001). One InstancedMesh per
 * (module, primitive, lit-state), so a five-storey block is ~20 draw calls
 * regardless of bay count.
 */
export default function KitBays({
  plan,
  kit,
  materials,
}: {
  plan: BlockPlan;
  kit: KitModels;
  materials: KitMaterials;
}) {
  const placements = useMemo(() => kitBayPlacements(plan), [plan]);
  const byBay = useMemo(() => {
    const groups = {} as Record<KitBayId, { lit: KitBayPlacement[]; dark: KitBayPlacement[]; all: KitBayPlacement[] }>;
    for (const bay of KIT_BAY_IDS) groups[bay] = { lit: [], dark: [], all: [] };
    for (const placement of placements) {
      const group = groups[placement.bay];
      group.all.push(placement);
      (placement.lit ? group.lit : group.dark).push(placement);
    }
    return groups;
  }, [placements]);

  return (
    <group>
      {KIT_BAY_IDS.flatMap((bay) =>
        kit[bay].map((primitive, i) => {
          const key = `${plan.id}-${bay}-${i}`;
          if (primitive.slot === 'pane') {
            return [
              <KitInstances
                key={`${key}-lit`}
                primitive={primitive}
                placements={byBay[bay].lit}
                material={materials.lamp}
                shadows={false}
              />,
              <KitInstances
                key={`${key}-dark`}
                primitive={primitive}
                placements={byBay[bay].dark}
                material={materials.glass}
                shadows={false}
              />,
            ];
          }
          const material = materials[primitive.slot];
          return (
            <KitInstances
              key={key}
              primitive={primitive}
              placements={byBay[bay].all}
              material={material}
              shadows={primitive.slot !== 'glass'}
            />
          );
        }),
      )}
    </group>
  );
}

import * as THREE from 'three';

/**
 * The static batcher's helpers: the geometry content hash, dequantization,
 * the material merge signature and the batch record.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * C-032: content hash for a BufferGeometry. The wave's repeated props (plinth
 * courses, railings, lamps) each own a geometry INSTANCE with identical
 * content — `<cylinderGeometry>` inline — so uuid grouping finds nothing. This
 * hash proves content identity: FNV-1a over EVERY attribute's full values
 * plus the index. Position-only hashing was tried first and silently merged
 * the perimeter writer's per-block UV retiles — identical shape, different
 * texture mapping — which showed as a soft 4 % pixel drift in the A/B diff.
 */
export function geometryHash(geometry: THREE.BufferGeometry): string {
  const position = geometry.attributes.position;
  if (!position) return 'none';
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const mixArray = (arr: ArrayLike<number>) => {
    for (let i = 0; i < arr.length; i += 1) mix(arr[i]);
  };
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.attributes[name] as THREE.BufferAttribute;
    mix(name.length);
    mix(attribute.itemSize);
    mixArray(attribute.array as ArrayLike<number>);
  }
  if (geometry.index) mixArray(geometry.index.array as ArrayLike<number>);
  return h.toString(36);
}

/**
 * C-052: rebuild a CLONED geometry's attributes as plain float32 storage.
 *
 * KHR_mesh_quantization exports (the Meshy hero props) carry POSITION/NORMAL
 * as NORMALIZED int16, decoded to model units by the GPU, with the decode
 * scale on the node TRS — the mesh renders correctly because the model matrix
 * never enters attribute storage. The mesh-arm bake breaks exactly there:
 * `applyMatrix4(world)` writes world-space floats back into the int16 array,
 * which wraps (mod 2^16), and normalized decoding maps ±32767 back to ±1
 * world unit — the whole family collapses onto the merged mesh's origin (the
 * C-043 plinth/lamp pairs projecting at (50 %,112 %)/(50 %,131 %) instead of
 * their seats; reproduced with a fully live, correct seat matrix in Node —
 * the wrap is a storage defect, not a stale-parent one). Reading every
 * component through the attribute getters (they denormalize, and they are
 * the only correct path through interleaved storage) gives the clone float32
 * attributes the world bake can land in. Touched attributes only — clones of
 * float32 originals pass through unchanged.
 */
export function dequantizeToFloat32(geometry: THREE.BufferGeometry): void {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name];
    // Plain float32 storage (the authored-mesh case) passes through untouched.
    // The instanceof discriminates interleaved storage (stride != itemSize)
    // even when its backing array is float32 — and holds for attributes
    // three-stdlib's loader builds, which imports the class from "three".
    if (!(attribute instanceof THREE.InterleavedBufferAttribute) && attribute.array instanceof Float32Array) continue;
    const itemSize = attribute.itemSize;
    const out = new Float32Array(attribute.count * itemSize);
    for (let i = 0, j = 0; i < attribute.count; i += 1) {
      for (let component = 0; component < itemSize; component += 1) {
        out[j] = attribute.getComponent(i, component);
        j += 1;
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, itemSize, false));
  }
}

/** Texture slots whose identity (not just parameters) a merge must respect. */
const MERGE_TEXTURE_SLOTS = [
  'map',
  'metalnessMap',
  'roughnessMap',
  'normalMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'envMap',
] as const;

export type MergeableMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

export function isMergeableMaterial(material: THREE.Material): material is MergeableMaterial {
  return material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial;
}

/**
 * C-032: visual-equality signature for the merge. Two materials that compare
 * equal here render pixel-identically for the same geometry, so the family can
 * share ONE of them. Every scalar and texture slot that reaches the shader for
 * the mergeable material types is included; anything exotic (ShaderMaterial,
 * Physical clearcoat) is excluded from merging outright by `isMergeableMaterial`.
 *
 * D42 N4: the shader hooks and per-material uniforms are part of the look
 * too. The signature appends the program key (`customProgramCacheKey()`: an
 * `onBeforeCompile` patch changes the program), the painted-light role
 * (`userData.paintRole`, a per-material uniform under one shared key), the
 * window pane's lit flag (`userData.windowLit`: glass and lamp panes share
 * one program and differ only by their `uWinLit` uniform, so a merged family
 * drew every pane in one state after a day/night toggle) and
 * `userData.mergeKey` (any other per-material uniform state, written by the
 * patch that owns the uniforms: the ashlar's course/bay/block values, the
 * window uniform set). Materials that differ in any of them never merge.
 */
export function materialSignature(material: MergeableMaterial): string | null {
  const standard = material instanceof THREE.MeshStandardMaterial ? material : null;
  const fields: unknown[] = [
    material.type,
    `#${material.color?.getHexString() ?? 'none'}`,
    standard?.roughness ?? 0,
    standard?.metalness ?? 0,
    material.opacity,
    material.transparent ? 1 : 0,
    material.alphaTest,
    material.side,
    material.vertexColors ? 1 : 0,
    standard?.flatShading ? 1 : 0,
    material.toneMapped ? 1 : 0,
    material.dithering ? 1 : 0,
    material.fog ? 1 : 0,
    standard?.wireframe ? 1 : 0,
    material.depthWrite ? 1 : 0,
    material.depthTest ? 1 : 0,
    material.blending,
  ];
  if (standard) {
    const physical = material instanceof THREE.MeshPhysicalMaterial ? material : null;
    fields.push(
      `#${standard.emissive?.getHexString() ?? 'none'}`,
      standard.emissiveIntensity,
      standard.envMapIntensity,
      standard.aoMapIntensity,
      standard.normalScale?.x ?? 0,
      standard.normalScale?.y ?? 0,
      physical?.ior ?? 0,
      physical?.transmission ?? 0,
    );
  }
  for (const slot of MERGE_TEXTURE_SLOTS) {
    const texture = (material as unknown as Record<string, THREE.Texture | null>)[slot];
    fields.push(texture ? texture.uuid : '-');
  }
  const userData = material.userData ?? {};
  try {
    fields.push(
      `key:${material.customProgramCacheKey()}`,
      `role:${signaturePart(userData.paintRole)}`,
      `lit:${signaturePart(userData.windowLit)}`,
      `merge:${signaturePart(userData.mergeKey)}`,
    );
    return JSON.stringify(fields);
  } catch {
    return null;
  }
}

/** One `userData` value as a signature token (absent and `undefined` read the same). */
function signaturePart(value: unknown): string {
  if (value === undefined || value === null) return '-';
  return typeof value === 'string' ? `s:${value}` : `j:${JSON.stringify(value)}`;
}

/** ENGINE r5: a data face's material (`userData.dataFace`), which the batcher never merges. */
export function isDataFaceMaterial(material: THREE.Material | THREE.Material[] | null | undefined): boolean {
  if (material == null) return false;
  const list = Array.isArray(material) ? material : [material];
  return list.some((entry) => entry?.userData?.dataFace === true);
}

export function sourcesOf(meshes: (THREE.Mesh | THREE.InstancedMesh)[]): BatchRecord['sources'] {
  return meshes.map((mesh) => ({ material: mesh.material, geometry: mesh.geometry }));
}

/**
 * ENGINE-A4: main-thread budget of one StaticBatcher build task. A build is a
 * grouping traversal plus one step per family; steps run until this budget is
 * spent, then the build continues in the next task (see `pumpBuild`).
 */
export const BATCH_BUILD_SLICE_MS = 8;

/** Mutable bookkeeping the StaticBatcher revalidates against the live graph. */
export interface BatchRecord {
  /** The merged replacement (one draw for the whole family). */
  merged: THREE.Mesh | THREE.InstancedMesh;
  /** The hidden originals backing it — kept in the graph, `visible=false`. */
  originals: (THREE.Mesh | THREE.InstancedMesh)[];
  /**
   * True when `merged.geometry` was CREATED by the batcher (a mergeGeometries
   * output) and may be disposed at teardown. False for instanced families:
   * their merged mesh deliberately shares the source geometry with the
   * still-mounted originals (PR #63 review — disposing it stripped the GPU
   * buffers out from under the re-shown originals).
   */
  ownsGeometry: boolean;
  /**
   * State captured at build time, parallel to `originals`: the world matrix
   * for a Mesh, the whole instance-matrix block for an InstancedMesh.
   */
  frozen: Float32Array[];
  /**
   * ENGINE r5: each original's material and geometry at build time, parallel
   * to `originals`. React reconciles a `textures ? <mesh …shader> : <mesh …
   * standard>` swap onto the SAME THREE.Mesh, so a mesh batched while it wore
   * a placeholder material stayed hidden once its real one arrived (the board
   * panel after a theme toggle at the floor rung: the warm's face check never
   * cleared and the stall detector dropped the visitor to Lite). A swapped
   * material or geometry tears the batch down like a moved original.
   */
  sources: { material: THREE.Material | THREE.Material[]; geometry: THREE.BufferGeometry }[];
}

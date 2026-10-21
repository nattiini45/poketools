'use client';

import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { figureScale, figureUrl, type FigureEntry } from '@/lib/route-world/model-manifest';
import { hash01, hashText, isLocomotionClip, phaseToClipTime } from '@/lib/route-world/clip-phase';
import { selectClip } from '@/lib/route-world/figure-behavior';
import type { FigureRole } from '@/lib/route-world/figure-director';
import { WorldStateContext } from '@/components/world/route/WorldStateProvider';
import { useDormancy } from '@/components/world/route/residency-store';
import { useFigureGLTF } from './figure-loader';
import { registerFigure, type FigureRegistration } from './figure-registry';
import { relaxTPose } from './rest-pose';
import { shareFigureSkeletons } from './actor-programs';
import { bindSceneEnvironment } from '../env/scene-env-binding';

export type FigureClip = 'idle' | 'idle2' | 'walk' | 'run';

interface FigureProps {
  entry: FigureEntry;
  /**
   * Resting clip, resolved by `selectClip` (the requested clip, else `idle`,
   * else the first non-locomotion clip, else the freeze-and-breath fallback:
   * a stopped figure never loops walk/run in place). POKEMON-CORE A1: with
   * `directorOwnsClip` (the default) this is the INITIAL clip only; the figure
   * director flips clips (fidgets) imperatively and seats every phase.
   */
  clip?: FigureClip;
  /** Playback speed multiplier (initial value under `directorOwnsClip`). */
  timeScale?: number;
  /** What the figure is in its world (the director's registration role). */
  role?: FigureRole;
  /** Participant id for aces (the roll call matches it); null otherwise. */
  subjectId?: string | null;
  /** The station index the figure belongs to (mover ranking); null = anywhere. */
  station?: number | null;
  /**
   * POKEMON-CORE A1 step 7: false keeps `clip` / `timeScale` under prop
   * control (the plaza Walker's `setClip` path until 3C); the director then
   * only advances the mixer and seats its phase for the capture pin.
   */
  directorOwnsClip?: boolean;
  /** The fitted clone's root, once per clone (actors driving a figure read it). */
  onRoot?: (root: THREE.Object3D | null) => void;
  castShadow?: boolean;
  /** Optional name on the root so raycasts (Focus) can identify the subject. */
  name?: string;
  /** Static exports get a subtle breathing swell (default on). */
  breathe?: boolean;
  /**
   * Size of the figure as it actually renders, in metres, once fitted and
   * posed — `[width, height, depth]` in the figure's own frame, grounded at
   * y = 0 and centred on x/z. Fires once per loaded clone. Callers that place
   * a Focus proxy need this: the manifest's rest-pose box is a T-pose, so a
   * relaxed rig is a third narrower than the file claims.
   */
  onMeasure?: (size: readonly [number, number, number]) => void;
}

/**
 * Figures in the painted light model (LOOK-PLAN §1.1, seat L contract): a
 * world whose theme declares a `paint` block runs one light for stone and
 * Pokémon alike, so its figures RECEIVE the key's shadow (a figure under the
 * gate darkens like the setts around it). Other worlds keep the pre-pilot
 * look (no received shadow) until the painterly rollout reaches them — the
 * blast-radius veto. `receiveShadow` is a uniform in three, not a program
 * key, so the flag never splits a program.
 */
function usePaintedFigureLight(): boolean {
  const theme = useContext(WorldStateContext)?.theme ?? null;
  return theme !== null && (theme as { paint?: unknown }).paint != null;
}

/**
 * Tag figure materials for the plaza paint sweep: `userData.paintRole =
 * 'figure'` selects the figure role (rim × 1.8, band 0.70) through a
 * uniform, never a program key. The tag is inert outside a painted world
 * (only the plaza sweep reads it), so tagging the GLTF cache's shared
 * materials is safe.
 */
function tagFigureMaterials(material: THREE.Material | THREE.Material[], clampedMetals?: Set<THREE.MeshStandardMaterial>): void {
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    if (m && m.userData.paintRole === undefined) m.userData.paintRole = 'figure';
    if (m) clampFigureMetal(m);
    if (m && clampedMetals && isClampedFigureMetal(m)) clampedMetals.add(m);
  }
}

/** POKEMON-CORE C14: the metal clamp's thresholds (material values only, never a species). */
export const METAL_CLAMP = { metalnessAbove: 0.5, envMapIntensityMax: 0.55, roughnessMin: 0.28 } as const;

/**
 * The luminance metal clamp (POKEMON-CORE C14, D19): a toon GLB whose
 * material is metallic (> 0.5) mirrors the bright IBL as a chrome blowout.
 * Uniform-only (`envMapIntensity`, `roughness`), idempotent (min / max), keyed
 * on the material's own values, applied to the SHARED GLTF-cache materials at
 * clone time — before the warm — so it adds no program key and no clone.
 */
export function clampFigureMetal(material: THREE.Material): void {
  const standard = material as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial || !(standard.metalness > METAL_CLAMP.metalnessAbove)) return;
  if (standard.envMapIntensity > METAL_CLAMP.envMapIntensityMax) standard.envMapIntensity = METAL_CLAMP.envMapIntensityMax;
  if (standard.roughness < METAL_CLAMP.roughnessMin) standard.roughness = METAL_CLAMP.roughnessMin;
}

/**
 * A material the metal clamp governs (metallic > 0.5 standard). D42 N9: these
 * are bound to the scene environment (`scene-env-binding.ts`) while a figure
 * using them is mounted — under three r185 an unbound material draws at
 * `scene.environmentIntensity`, so the clamp's `envMapIntensity` was inert.
 * Bound, the metal reflects at its clamped intensity (≤ 0.55) whatever the
 * world's IBL level; the program is the unbound one (+0).
 */
export function isClampedFigureMetal(material: THREE.Material): material is THREE.MeshStandardMaterial {
  const standard = material as THREE.MeshStandardMaterial;
  return standard.isMeshStandardMaterial === true && standard.metalness > METAL_CLAMP.metalnessAbove;
}

/** Seconds to blend between clips (idle ↔ walk). */
const CROSSFADE_S = 0.35;

/**
 * A prop-controlled clip's start time (the Walker's idle ↔ walk flips): a
 * seeded phase of (figure, clip), so two figures never start a clip in step.
 */
function propPhaseTime(id: string, clip: string, durationS: number): number {
  return phaseToClipTime(hash01(hashText(id), hashText(clip)), durationS);
}

/**
 * A mesh only owes the plaza a shadow when it is at least this fraction of
 * the figure's largest mesh (C-048). The rung-0 shadow map is 1024 texels
 * across a 60 m orthographic frustum (~17 px/m), so an exporter's eye or claw
 * mesh — 5–10 % of the body — is one to two shadow texels wide: it pays a
 * shadow-pass draw call every frame for a shadow no visitor can resolve.
 * The largest mesh of every figure is always above the fraction, so each
 * figure keeps its grounded silhouette.
 */
const SHADOW_CASTER_MIN_FRACTION = 0.25;

/**
 * A merge-ready copy of one member geometry: every attribute re-read through
 * `getComponent` into a plain, non-normalized buffer and indices rebuilt as
 * Uint32. Interleaved and quantized storage cannot be concatenated directly
 * (`mergeGeometries` rejects interleaved attributes and mixed typed arrays),
 * and `getComponent` is the one access path that denormalizes correctly from
 * every storage kind — the same discipline the world batcher learned as the
 * C-052 quantized-wrap defect. Reading through it makes the copy bit-equal to
 * what the shader would otherwise decode per draw.
 *
 * R6 E4: EVERY attribute is Float32, the bone indices (`skinIndex`)
 * included. They were rebuilt as Uint16 — a non-normalized integer input
 * that ANGLE / D3D11 can only feed a float shader input by converting it in
 * a NEW vertex executable, built synchronously at the program's first draw
 * (see `vertex-formats.ts`); bone indices are exact in float32.
 */
function mergeableGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(source.attributes)) {
    const attribute = source.attributes[name];
    const itemSize = attribute.itemSize;
    const store = new Float32Array(attribute.count * itemSize);
    let k = 0;
    for (let i = 0; i < attribute.count; i += 1) {
      for (let component = 0; component < itemSize; component += 1) {
        store[k] = attribute.getComponent(i, component);
        k += 1;
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(store, itemSize, false));
  }
  const index = source.index;
  if (index) {
    const store = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i += 1) store[i] = index.getX(i);
    out.setIndex(new THREE.BufferAttribute(store, 1, false));
  }
  return out;
}

/**
 * Merge-family key for one mesh of the clone, or `null` when the mesh may
 * never merge. Meshes may only be replaced by ONE mesh when that renders the
 * members bit-identically: same parent node, same local matrix, same single
 * material instance, same attribute names/item sizes and index layout, no
 * morph targets — and for skinned members, skeletons over the SAME bones in
 * the same order ( exporters give every part its own Skeleton instance, but
 * over one shared bone hierarchy) with the same bind matrix and the same bone
 * inverses, because three's skinning shader folds `bindMatrix` into every
 * vertex: two different binds can never collapse into one mesh. Anything the
 * key cannot prove stays authored.
 */
function mergeFamilyKey(mesh: THREE.Mesh): string | null {
  if (mesh.morphTargetInfluences) return null;
  if (Object.keys(mesh.geometry.morphAttributes).length > 0) return null;
  if (Array.isArray(mesh.material) || !mesh.material) return null;
  if (!mesh.geometry.attributes.position) return null;
  mesh.updateMatrix();
  const attributes = Object.keys(mesh.geometry.attributes)
    .map((name) => `${name}:${mesh.geometry.attributes[name].itemSize}`)
    .sort()
    .join(',');
  const parts = [
    mesh.parent ? mesh.parent.uuid : '-',
    mesh.matrix.toArray().map((v) => v.toFixed(5)).join(','),
    mesh.material.uuid,
    attributes,
    mesh.geometry.index ? '|i' : '|n',
  ];
  if (mesh instanceof THREE.SkinnedMesh && mesh.skeleton) {
    parts.push(
      mesh.skeleton.bones.map((bone) => bone.uuid).join(','),
      mesh.skeleton.boneInverses.map((m) => m.elements.map((v) => v.toFixed(5)).join(',')).join(';'),
      mesh.bindMatrix.toArray().map((v) => v.toFixed(5)).join(','),
    );
  }
  return parts.join('||');
}

/**
 * Collapse merge-compatible meshes of a freshly cloned figure into one mesh
 * per family (C-048). The exports draw a species as many skinned meshes —
 * body, limbs, eyes — each one a call in the forward pass AND in every
 * shadow pass, which is how a figure came to cost 13.5 calls on the plaza
 * (the C-047 r2 number of record). The merge is EXACT, not an approximation:
 * a family shares the parent, local matrix, material instance and attribute
 * layout, and skinned families share one bone hierarchy under one bind
 * matrix — the exact state the skinning shader needs to reproduce the
 * members' transforms. Families the key cannot prove stay authored, and any
 * `mergeGeometries` refusal falls back the same way. Returns the geometries
 * the caller now owns and must dispose with the clone (everything else under
 * a clone shares the cached GLTF's buffers and must never be disposed).
 *
 * Exported (D42 commit G) for the asset step's merge-parity check
 * (`scripts/world-assets/d42-parity.mjs` bundles this exact function).
 */
export function consolidateFigureMeshes(root: THREE.Object3D): THREE.BufferGeometry[] {
  const families = new Map<string, THREE.Mesh[]>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const key = mergeFamilyKey(node);
    if (!key) return;
    const bucket = families.get(key);
    if (bucket) bucket.push(node);
    else families.set(key, [node]);
  });
  const owned: THREE.BufferGeometry[] = [];
  for (const members of families.values()) {
    if (members.length < 2) continue;
    const parts = members.map((member) => mergeableGeometry(member.geometry));
    const mergedGeometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!mergedGeometry) continue; // incompatible despite the key — stay authored
    owned.push(mergedGeometry);
    const first = members[0];
    const skinnedFirst = first instanceof THREE.SkinnedMesh ? first : null;
    const merged: THREE.Mesh = skinnedFirst
      ? new THREE.SkinnedMesh(mergedGeometry, first.material)
      : new THREE.Mesh(mergedGeometry, first.material);
    // The family's shared local transform carries its placement in the export
    // (e.g. a −90° X rotation). Frozen rather than decomposed so the merged
    // mesh renders from the exact matrix the members rendered from, with the
    // world-update flag raised for a parent chain that never forces.
    merged.matrixAutoUpdate = false;
    merged.matrix.copy(first.matrix);
    merged.matrixWorldNeedsUpdate = true;
    merged.name = `${first.name || 'figure'}+${members.length - 1}`;
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.frustumCulled = false;
    if (skinnedFirst?.skeleton) {
      (merged as THREE.SkinnedMesh).bind(skinnedFirst.skeleton, skinnedFirst.bindMatrix);
    }
    first.parent?.add(merged);
    for (const member of members) member.parent?.remove(member);
  }
  return owned;
}

/**
 * D42 N2: one Skeleton per bone set on a world figure's clone, and the
 * distinct skeletons the clone keeps (the caller disposes them with it).
 *
 * `SkeletonUtils.clone` gives EVERY SkinnedMesh of the clone its own
 * Skeleton (GLTFLoader shares one per skin), and three updates each distinct
 * skeleton once per frame — every bone's offset matrix — and builds and
 * re-uploads a bone texture for each (the reader count: 880 skinned meshes
 * over 317 skins). `shareFigureSkeletons` (R49 K9, until now the probe
 * actors' only) binds meshes whose skeletons list the same bone objects in
 * the same order under equal inverse binds to one of them: the skinning
 * inputs are identical and each mesh keeps its own `bindMatrix`, so the
 * render is exact. Runs on the fresh clone before any frame — after the
 * merge (whose family key reads each mesh's own skeleton) and before the
 * bounds pass — so the dropped skeletons never build a bone texture. One
 * WeakSet per clone (its idempotence ledger never spans two clones).
 *
 * Disposal: a Skeleton's only GPU resource is its bone texture
 * (`Skeleton.dispose`). The clone's skeletons are its own (`clone` creates
 * them), never the GLTF cache's, so they are disposed with the clone; a
 * StrictMode remount of the same clone simply rebuilds the texture at its
 * next draw (three creates it lazily).
 */
export function shareCloneSkeletons(root: THREE.Object3D): THREE.Skeleton[] {
  shareFigureSkeletons(root, new WeakSet());
  return cloneSkeletons(root);
}

/** The distinct skeletons the skinned meshes under `root` bind, in traversal order. */
export function cloneSkeletons(root: THREE.Object3D): THREE.Skeleton[] {
  const distinct = new Set<THREE.Skeleton>();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh === true && mesh.skeleton) distinct.add(mesh.skeleton);
  });
  return [...distinct];
}

/**
 * Bounds of the figure as it will render. Skinned meshes are measured through
 * the skeleton (`SkinnedMesh.computeBoundingBox` skins every vertex): several
 * exports store the raw geometry on the ground while the file's rest pose
 * holds the body up — a hovering Magnezone — so the geometry box alone would
 * ground the wrong thing. When `meshDims` is given it receives each mesh's
 * largest local dimension in the same pass — the input to the C-048
 * shadow-caster trim, so the skinned (rest-pose) size decides, not the raw
 * geometry box.
 */
export function meshBounds(root: THREE.Object3D, meshDims?: Map<THREE.Object3D, number>): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      node.skeleton.update();
      skinnedRestBounds(node);
      const local = node.boundingBox;
      if (!local || local.isEmpty()) return;
      if (meshDims) meshDims.set(node, Math.max(local.max.x - local.min.x, local.max.y - local.min.y, local.max.z - local.min.z));
      box.union(local.clone().applyMatrix4(node.matrixWorld));
      return;
    }
    if (!(node instanceof THREE.Mesh) || !node.geometry) return;
    node.geometry.computeBoundingBox();
    const local = node.geometry.boundingBox;
    if (!local || local.isEmpty()) return;
    if (meshDims) meshDims.set(node, Math.max(local.max.x - local.min.x, local.max.y - local.min.y, local.max.z - local.min.z));
    box.union(local.clone().applyMatrix4(node.matrixWorld));
  });
  return box;
}

const _restVertex = new THREE.Vector3();

/**
 * POKEMON-CORE A1 fix-2 (R15): three sorts transparent renderables (and
 * breaks opaque ties) by the view depth of each one's bounding-sphere
 * centre. A skinned mesh computes that sphere lazily, at its first render,
 * in whatever pose the mixer has reached by then: a load-order-dependent
 * key, so a figure with several transparent parts (a sakura pool figure's
 * lily pad) drew them in one order or the other from one load to the next.
 *
 * So `meshBounds` fills the sphere at clone time, in the skinning pass it
 * already makes for the box: every vertex once, through the same
 * `getVertexPosition` / `expandByPoint` steps as three's own
 * `computeBoundingBox` and `computeBoundingSphere`, in the same order. The
 * box is unchanged; the sphere is exactly three's, taken at the rest pose
 * (for a clip-less figure, the very sphere three computed before), and three
 * never recomputes a non-null one. Culling never reads it (figure meshes are
 * `frustumCulled = false`); raycasts use it as an early out, as before.
 */
export function skinnedRestBounds(node: THREE.SkinnedMesh): void {
  const box = node.boundingBox ?? new THREE.Box3();
  const sphere = node.boundingSphere ?? new THREE.Sphere();
  box.makeEmpty();
  sphere.makeEmpty();
  const position = node.geometry.getAttribute('position');
  if (position) {
    for (let i = 0; i < position.count; i += 1) {
      node.getVertexPosition(i, _restVertex);
      box.expandByPoint(_restVertex);
      sphere.expandByPoint(_restVertex);
    }
  }
  node.boundingBox = box;
  node.boundingSphere = sphere;
}

/**
 * ENGINE-A4 (ceremony main thread): the bounds after `root.scale.setScalar(scale)`
 * without skinning every vertex a second time. The clone is parentless, so
 * its world matrix is T·R·S; a uniform scale change from `s0` to `scale`
 * maps every world point p to T + k·(p − T) with k = scale / s0, an exact
 * AABB-to-AABB map (skinned meshes included: bones and mesh share the root).
 * The second `meshBounds` pass was half of Figure's mount cost (~185 ms of
 * the plaza ceremony's main thread). A non-uniform or parented root, or a
 * degenerate scale, measures again.
 */
export function scaledBounds(root: THREE.Object3D, raw: THREE.Box3, scale: number): THREE.Box3 {
  const s0 = root.scale.x;
  const uniform = root.scale.y === s0 && root.scale.z === s0;
  root.scale.setScalar(scale);
  if (!uniform || root.parent !== null || !(s0 > 0) || !(scale > 0) || raw.isEmpty()) return meshBounds(root);
  root.updateMatrixWorld(true);
  const k = scale / s0;
  const t = root.position;
  const box = raw.clone();
  box.min.sub(t).multiplyScalar(k).add(t);
  box.max.sub(t).multiplyScalar(k).add(t);
  return box;
}

/**
 * One Pokémon at its Pokédex height, grounded at the group origin and centred
 * on x/z, playing a manifest clip. 1 unit = 1 m (spec §4.1).
 *
 * The GLTF scene is cloned through SkeletonUtils so the same species can stand
 * on two plinths without sharing a skeleton, and bounds are measured on the
 * unscaled clone rather than trusted from the manifest — the manifest's rest
 * pose is right for the scale, but grounding has to account for whatever the
 * exporter did with the root transform.
 */
export default function Figure({
  entry,
  clip = 'idle',
  timeScale = 1,
  castShadow = true,
  name,
  breathe = true,
  onMeasure,
  role = 'wild',
  subjectId = null,
  station = null,
  directorOwnsClip = true,
  onRoot,
}: FigureProps) {
  const gltf = useFigureGLTF(figureUrl(entry));
  const group = useRef<THREE.Group>(null);
  const isDormant = useDormancy();
  const receiveShadow = usePaintedFigureLight();
  const scene = useThree((state) => state.scene);

  // Skinning every vertex to measure is the expensive part of mounting a
  // figure, so the fitted clone and the size it reports come out of one pass.
  const { fitted, size, ownedGeometries, ownedSkeletons, clampedMetals } = useMemo(() => {
    const root = cloneSkeleton(gltf.scene);
    const clampedMetals = new Set<THREE.MeshStandardMaterial>();
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = castShadow;
        node.receiveShadow = receiveShadow;
        node.frustumCulled = false;
        tagFigureMaterials(node.material, clampedMetals);
      }
    });
    // One draw call per material family instead of one per exported part
    // (C-048) — the merge either proves itself exact or leaves the parts
    // authored, so a figure can never mount wrong, only un-merged.
    const ownedGeometries = consolidateFigureMeshes(root);
    // D42 N2: one skeleton per bone set (exact; before the bounds pass and
    // before any frame, so a dropped skeleton never builds a bone texture).
    const ownedSkeletons = shareCloneSkeletons(root);
    // No clip will pose this figure — lower T-posed arms before it stands.
    if (gltf.animations.length === 0) relaxTPose(root);
    // Scale from the posed, skinned height: the manifest's geometry box can be
    // taller than the body actually stands (limbs stored spread out).
    const meshDims = new Map<THREE.Object3D, number>();
    const raw = meshBounds(root, meshDims);
    // Shadow-caster trim (C-048): sub-fraction parts pay a shadow-pass call
    // for a shadow under two texels wide; the largest mesh always stays.
    if (castShadow && !raw.isEmpty()) {
      const span = raw.getSize(new THREE.Vector3());
      const floor =
        SHADOW_CASTER_MIN_FRACTION * Math.max(span.x, span.y, span.z);
      for (const [node, dim] of meshDims) if (dim < floor) node.castShadow = false;
    }
    const rawHeight = raw.isEmpty() ? 0 : raw.max.y - raw.min.y;
    const scale =
      entry.heightm !== null && rawHeight > 1e-3 ? entry.heightm / rawHeight : figureScale(entry);
    const box = scaledBounds(root, raw, scale);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box.min.y, -center.z);
    }
    const extent = box.isEmpty() ? null : box.getSize(new THREE.Vector3());
    return {
      fitted: root,
      size: extent ? ([extent.x, extent.y, extent.z] as const) : null,
      ownedGeometries,
      ownedSkeletons,
      clampedMetals: [...clampedMetals],
    };
  }, [gltf.scene, gltf.animations, entry, castShadow, receiveShadow]);

  // The consolidated geometries are the clone's own — everything else under
  // `fitted` shares the cached GLTF's buffers — so exactly those are disposed
  // with the clone, never the shared cache a sibling figure still renders.
  // D42 N2: the clone's (shared) skeletons go with it: their bone textures.
  useEffect(() => {
    const owned = ownedGeometries;
    const skeletons = ownedSkeletons;
    return () => {
      for (const geometry of owned) geometry.dispose();
      for (const skeleton of skeletons) skeleton.dispose();
    };
  }, [ownedGeometries, ownedSkeletons]);

  // D42 N9: the clamped metals read the scene environment while this clone
  // is mounted (the GLTF cache's shared materials: refcounted per material).
  // A layout effect: bound in the mounting commit, before the warm compiles.
  useLayoutEffect(() => {
    const releases = clampedMetals.map((material) => bindSceneEnvironment(material, scene));
    return () => {
      for (const release of releases) release();
    };
  }, [clampedMetals, scene]);

  // Latest-callback ref (never assigned in render, PB-017) so a parent that
  // re-renders with a fresh arrow does not re-measure and loop back through
  // the caller's state.
  const measure = useRef(onMeasure);
  useEffect(() => {
    measure.current = onMeasure;
  }, [onMeasure]);

  useEffect(() => {
    if (size) measure.current?.(size);
  }, [size]);

  // The mixer is owned by the effect so the actions it hands out are ours to
  // mutate; it is bound to the fitted clone, not the shared GLTF scene. One
  // mixer lives as long as the clone. POKEMON-CORE C16: every present clip's
  // action is created with the mixer, so the first fidget allocates nothing.
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const actions = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const current = useRef<THREE.AnimationAction | null>(null);

  // `selectClip` for a STOPPED figure (rule 6: no usable clip → the freeze pose
  // of `freezeClip` plus the breath; a walk/run-only rig never treadmills).
  const clipNames = useMemo(() => gltf.animations.map((animation) => animation.name), [gltf.animations]);
  const pick = useMemo(
    () => selectClip({ clips: clipNames, role: 'stationary', locomotion: isLocomotionClip(clip) && !directorOwnsClip, requested: clip }),
    [clipNames, clip, directorOwnsClip],
  );
  const lowMotion = pick.clip === null;

  const freezeName = useRef<string | null>(null);
  useEffect(() => {
    freezeName.current = pick.clip === null ? pick.freezeClip : null;
  }, [pick]);

  /** Imperative clip flip (the director's `play`; also the prop path below). */
  const play = useRef((next: string | null, timeS: number, fadeS: number, scale: number): void => {
    const owned = mixer.current;
    if (!owned) return;
    const map = actions.current;
    if (next === null) {
      // Rule 6: hold the first frame of the freeze clip (if any), paused.
      for (const action of map.values()) action.stop();
      const freeze = freezeName.current !== null ? (map.get(freezeName.current) ?? null) : null;
      if (freeze) {
        freeze.reset();
        freeze.time = 0;
        freeze.setEffectiveWeight(1);
        freeze.play();
        freeze.paused = true;
      }
      current.current = freeze;
      return;
    }
    const action = map.get(next);
    if (!action) return;
    const previous = current.current;
    if (fadeS <= 0 || !previous || previous === action) {
      for (const other of map.values()) if (other !== action) other.stop();
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = scale;
      action.time = timeS;
      action.setEffectiveWeight(1);
      action.play();
    } else {
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = scale;
      action.time = timeS;
      action.setEffectiveWeight(1);
      previous.crossFadeTo(action, fadeS, false);
      action.play();
    }
    current.current = action;
  });

  useEffect(() => {
    if (gltf.animations.length === 0) return;
    const owned = new THREE.AnimationMixer(fitted);
    mixer.current = owned;
    const map = new Map<string, THREE.AnimationAction>();
    for (const animation of gltf.animations) map.set(animation.name, owned.clipAction(animation));
    actions.current = map;
    return () => {
      owned.stopAllAction();
      owned.uncacheRoot(fitted);
      mixer.current = null;
      actions.current = new Map();
      current.current = null;
    };
  }, [gltf.animations, fitted]);

  // The initial clip at phase 0 (the director seats the allocated phase at
  // residency-complete, before the warm's poses). Under prop control this is
  // also the clip flip on every `clip` / `timeScale` change (the Walker).
  const started = useRef<THREE.AnimationMixer | null>(null);
  useEffect(() => {
    const owned = mixer.current;
    if (!owned) return;
    const first = started.current !== owned;
    started.current = owned;
    if (!first && directorOwnsClip) return; // the director owns every later flip
    const target = pick.clip;
    const existing = current.current;
    if (target !== null && existing !== null && existing.getClip().name === target) {
      existing.timeScale = timeScale;
      return;
    }
    const timeS = target !== null && !directorOwnsClip ? propPhaseTime(name ?? entry.file, target, actions.current.get(target)?.getClip().duration ?? 1) : 0;
    play.current(target, timeS, first ? 0 : CROSSFADE_S, timeScale);
  }, [gltf.animations, fitted, pick, timeScale, directorOwnsClip, name, entry.file]);

  // POKEMON-CORE A1: one registration per clone. The director advances the
  // mixer (no per-figure frame loop), flips clips, seats phases and breathes
  // the clip-less figures; the debug bridges read the same row.
  const dormancy = useRef(isDormant);
  useEffect(() => {
    dormancy.current = isDormant;
  }, [isDormant]);
  const rootCallback = useRef(onRoot);
  useEffect(() => {
    rootCallback.current = onRoot;
  }, [onRoot]);
  useEffect(() => {
    rootCallback.current?.(fitted);
    return () => rootCallback.current?.(null);
  }, [fitted]);
  // The resting pick can change under prop control (the Walker's idle ↔ walk:
  // a rig without idle freezes at its pauses, rule 6), so `lowMotion` /
  // `baseClip` are written into the LIVE registration, never re-registered
  // (a re-registration after the reveal is the D23 tripwire).
  const registration = useRef<FigureRegistration | null>(null);
  useEffect(() => {
    const live = registration.current;
    if (!live) return;
    live.lowMotion = lowMotion;
    live.baseClip = pick.clip;
  }, [lowMotion, pick]);
  useEffect(() => {
    const durations: Record<string, number> = {};
    for (const animation of gltf.animations) durations[animation.name] = animation.duration;
    const entryRow: FigureRegistration = {
      id: name ?? `figure-${entry.file}`,
      model: entry.file,
      object: group,
      role,
      subjectId,
      station,
      getAction: (clipName?: string) => (clipName === undefined ? current.current : (actions.current.get(clipName) ?? null)),
      lowMotion,
      mixer: mixer.current,
      clips: gltf.animations.map((animation) => animation.name),
      durations,
      isDormant: () => dormancy.current(),
      directorOwnsClip,
      baseClip: pick.clip,
      baseTimeScale: timeScale,
      breathe,
      play: (next, timeS, fadeS, scale) => play.current(next, timeS, fadeS, scale),
      currentClip: () => current.current?.getClip().name ?? null,
      // R14: the rest bounds in the group frame (grounded, centred): the frustum gate's sphere.
      bounds: size ? { radius: 0.5 * Math.hypot(size[0], size[1], size[2]), centerY: size[1] / 2, castsShadow: castShadow } : null,
      // The look offset turns this figure's own group; the caller's parent keeps the heading.
      look: (yawRad) => {
        const node = group.current;
        if (node) node.rotation.y = yawRad;
      },
    };
    registration.current = entryRow;
    const release = registerFigure(entryRow);
    return () => {
      release();
      if (registration.current === entryRow) registration.current = null;
    };
    // `timeScale` / `pick` / `lowMotion` change only under prop control (the
    // Walker): the effect above writes them into the live registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.animations, fitted, size, castShadow, name, entry.file, role, subjectId, station, directorOwnsClip, breathe]);

  return (
    <group ref={group} name={name}>
      <primitive object={fitted} />
    </group>
  );
}

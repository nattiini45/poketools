import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CoreActorDebugRow } from './core-actor-probe.data';

/**
 * Program sharing for the shared actors' figures (POKEMON-CORE R49, seat D
 * K9: D26 "+0 GPU programs"; D23 complete at reveal).
 *
 * A water resident or lane flyer is a cast GLB, so its materials are the
 * export's — and two export habits give it program keys no world figure
 * compiles (the R49 sakura probe: +4 programs, 2 per output colour space):
 *
 *  - TRANSPARENT + DOUBLE-SIDED (`alphaMode BLEND` + `doubleSided`): three
 *    draws such a material in two passes, back faces then front faces, so it
 *    compiles a back-face (`flipSided`) program besides the front one, and it
 *    sets `needsUpdate` twice per draw — the program parameters and the key
 *    string are rebuilt every rendered frame it is visible (garbage and CPU on
 *    the busy path). `transparentSingleSided` renders it front faces only, in
 *    one pass: the key of a single-sided BLEND figure material (the world's
 *    figures compile it). Disclosed look change: the back faces of a
 *    transparent part (an eyelash card seen from behind) are not drawn.
 *  - UNLIT WITHOUT VERTEX COLOURS: an unlit (`MeshBasicMaterial`) export
 *    without `COLOR_0` keys a program apart from an unlit export WITH vertex
 *    colours (`vertexColors` / `vertexAlphas` are key bits).
 *    `unlitVertexColors` gives such a mesh a WHITE RGBA colour (the `COLOR_0`
 *    layout of the exports that carry one: UNSIGNED_BYTE × 4, normalized) and
 *    the material `vertexColors`, so it compiles the vertex-colour unlit
 *    program. Pixel-identical: the colour multiplies by exactly 1. Which
 *    variant a world already compiles is world data, so this flag is the
 *    caller's per-world policy (the probe's, for sakura), never a default.
 *
 * Mechanics: per actor, each affected material is CLONED once (the GLTF
 * cache's shared material, which world figures may draw, is never touched)
 * and each affected geometry is re-wrapped once (a new BufferGeometry over
 * the SAME attribute objects, so no attribute is copied or uploaded twice,
 * plus the white colour). Applied in a layout effect of the actor, i.e. in
 * the commit that mounts the figure, before any frame — so before the load
 * warm compiles or draws it. `restore` puts the originals back and disposes
 * only what was created here (never a shared attribute's GPU buffer).
 *
 * The same layout pass also binds a figure's skinned parts to one skeleton
 * per bone set (`shareFigureSkeletons`) and, for a clip-less figure,
 * re-enables per-part frustum culling (`cullStaticParts`): R49 K9's
 * per-frame cost.
 *
 * No species literal (D18): the rules read material and geometry flags only.
 */

export interface ActorProgramShare {
  /** Draw transparent double-sided materials front faces only, in one pass. */
  readonly transparentSingleSided: boolean;
  /** Give unlit materials without vertex colours a white RGBA vertex colour (per-world policy). */
  readonly unlitVertexColors: boolean;
}

/** The actors' default: the single-pass transparency rule only (vertex colours are a per-world call). */
export const ACTOR_PROGRAM_SHARE_DEFAULT: ActorProgramShare = { transparentSingleSided: true, unlitVertexColors: false };

/** What `adoptSharedPrograms` changed on one actor (evidence; `restore` undoes it). */
export interface ActorProgramAdoption {
  /** Materials cloned single-sided (source material names). */
  singleSided: string[];
  /** Materials cloned with vertex colours (source material names). */
  vertexColored: string[];
  /** Meshes whose geometry gained the white colour. */
  coloredMeshes: number;
  restore: () => void;
}

/** A material three would draw in two passes (back, then front) with a back-face program. */
export function isTwoPassTransparent(material: THREE.Material): boolean {
  return material.transparent === true && material.side === THREE.DoubleSide && material.forceSinglePass === false;
}

/** An unlit material whose mesh has no vertex colour (the no-colour unlit program key). */
export function isUncoloredUnlit(material: THREE.Material, geometry: THREE.BufferGeometry): boolean {
  return (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true && material.vertexColors !== true && geometry.getAttribute('color') === undefined;
}

/** A material paint-sweep has painted (its `paintScope` marker, `paint/paint-sweep.ts`). */
export function isPaintedMaterial(material: THREE.Material): boolean {
  return typeof material.userData?.paintScope === 'string';
}

/** A clone that keeps the key-relevant hooks `Material.copy` does not carry (own `onBeforeCompile` / `customProgramCacheKey`). */
function cloneKeepingHooks(source: THREE.Material): THREE.Material {
  const copy = source.clone();
  if (Object.prototype.hasOwnProperty.call(source, 'onBeforeCompile')) copy.onBeforeCompile = source.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(source, 'customProgramCacheKey')) copy.customProgramCacheKey = source.customProgramCacheKey;
  // GLTFLoader flags a normal-less mesh's material `flatShading` (a key bit) even on a
  // MeshBasicMaterial, whose `copy` does not carry it (R49 dev probe 2: a 1-bit key split).
  const flat = (source as { flatShading?: unknown }).flatShading;
  if (typeof flat === 'boolean') (copy as { flatShading?: boolean }).flatShading = flat;
  return copy;
}

/**
 * A geometry over the SAME attribute and index objects as `source` (three keys
 * GPU buffers by attribute, so nothing is uploaded twice) plus a white
 * RGBA `color` (UNSIGNED_BYTE × 4, normalized: the exports' `COLOR_0` layout).
 */
export function withWhiteVertexColor(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const copy = new THREE.BufferGeometry();
  copy.name = source.name;
  for (const name of Object.keys(source.attributes)) copy.setAttribute(name, source.attributes[name]);
  const morphs = copy.morphAttributes as Record<string, (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[]>;
  const sourceMorphs = source.morphAttributes as Record<string, (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[]>;
  for (const name of Object.keys(sourceMorphs)) morphs[name] = sourceMorphs[name];
  copy.morphTargetsRelative = source.morphTargetsRelative;
  copy.setIndex(source.index);
  for (const group of source.groups) copy.addGroup(group.start, group.count, group.materialIndex);
  copy.setDrawRange(source.drawRange.start, source.drawRange.count);
  copy.boundingBox = source.boundingBox ? source.boundingBox.clone() : null;
  copy.boundingSphere = source.boundingSphere ? source.boundingSphere.clone() : null;
  const count = source.getAttribute('position')?.count ?? 0;
  copy.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(count * 4).fill(255), 4, true));
  return copy;
}

/**
 * Release a `withWhiteVertexColor` geometry without freeing the shared
 * attributes' GPU buffers: three's geometry dispose removes the buffer of
 * every attribute it still lists, so the shared ones are detached first and
 * only the colour buffer goes.
 */
function disposeColorWrapper(copy: THREE.BufferGeometry): void {
  for (const name of Object.keys(copy.attributes)) if (name !== 'color') copy.deleteAttribute(name);
  copy.morphAttributes = {};
  copy.setIndex(null);
  copy.dispose();
}

/**
 * Apply `share` to every mesh under `root` (idempotent per mesh through
 * `seen`). Returns what changed and how to undo it.
 */
export function adoptSharedPrograms(root: THREE.Object3D, share: ActorProgramShare, seen: WeakSet<THREE.Object3D> = new WeakSet()): ActorProgramAdoption {
  const clones = new Map<THREE.Material, THREE.Material>();
  const undo: (() => void)[] = [];
  const result: ActorProgramAdoption = { singleSided: [], vertexColored: [], coloredMeshes: 0, restore: () => undefined };

  const adopt = (material: THREE.Material, geometry: THREE.BufferGeometry): { material: THREE.Material; needsColor: boolean } => {
    // Final review: a PAINTED material (paint-sweep marks userData.paintScope) is left shared. A clone
    // would copy its paint hook while paint-sweep, keyed on the original, paints the clone again:
    // a doubled hook and a world-new program after the reveal (D26).
    if (isPaintedMaterial(material)) return { material, needsColor: false };
    const twoPass = share.transparentSingleSided && isTwoPassTransparent(material);
    const color = share.unlitVertexColors && isUncoloredUnlit(material, geometry);
    if (!twoPass && !color) return { material, needsColor: false };
    let clone = clones.get(material);
    if (clone === undefined) {
      clone = cloneKeepingHooks(material);
      if (twoPass) {
        clone.side = THREE.FrontSide;
        result.singleSided.push(material.name);
      }
      if (color) {
        clone.vertexColors = true;
        result.vertexColored.push(material.name);
      }
      clones.set(material, clone);
    }
    return { material: clone, needsColor: color };
  };

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh !== true || seen.has(mesh) || !mesh.geometry) return;
    seen.add(mesh);
    const originalMaterial = mesh.material;
    const originalGeometry = mesh.geometry;
    let needsColor = false;
    let changed = false;
    let nextMaterial: THREE.Material | THREE.Material[];
    if (Array.isArray(originalMaterial)) {
      nextMaterial = originalMaterial.map((m) => {
        const a = adopt(m, originalGeometry);
        if (a.material !== m) changed = true;
        needsColor = needsColor || a.needsColor;
        return a.material;
      });
    } else {
      const a = adopt(originalMaterial, originalGeometry);
      changed = a.material !== originalMaterial;
      needsColor = a.needsColor;
      nextMaterial = a.material;
    }
    if (!changed) return;
    mesh.material = nextMaterial;
    let wrapper: THREE.BufferGeometry | null = null;
    if (needsColor) {
      wrapper = withWhiteVertexColor(originalGeometry);
      mesh.geometry = wrapper;
      result.coloredMeshes += 1;
    }
    undo.push(() => {
      mesh.material = originalMaterial;
      if (wrapper !== null) {
        mesh.geometry = originalGeometry;
        disposeColorWrapper(wrapper);
      }
      seen.delete(mesh);
    });
  });

  result.restore = () => {
    for (const step of undo.splice(0)) step();
    for (const clone of clones.values()) clone.dispose();
    clones.clear();
  };
  return result;
}

/** What `shareFigureSkeletons` changed on one actor (evidence; `restore` undoes it). */
export interface SkeletonSharing {
  /** Skinned meshes seen. */
  skinnedMeshes: number;
  /** Distinct skeletons they update per frame after sharing. */
  skeletons: number;
  /** Meshes rebound by this call. */
  changed: number;
  restore: () => void;
}

/** The sharing key: the same bone objects in the same order under equal inverse binds. */
function skeletonKey(skeleton: THREE.Skeleton): string {
  const bones = skeleton.bones.map((bone) => bone.uuid).join(',');
  const inverses = skeleton.boneInverses.map((m) => m.elements.map((v) => v.toFixed(6)).join(',')).join(';');
  return `${bones}|${inverses}`;
}

/**
 * R49 K9 (busy): one Skeleton per bone set. `SkeletonUtils.clone` gives
 * EVERY skinned mesh of a figure clone its own Skeleton (GLTFLoader shares
 * one per skin), and three updates each distinct skeleton once per frame —
 * every bone's offset matrix — and re-uploads its bone texture. A figure
 * of five skinned parts over one bone set paid five of each per frame (the
 * R49 dev probe: +11 bone-texture uploads per frame for the three visible
 * probe actors). Meshes whose skeletons list the SAME bone objects in the
 * same order with equal inverse bind matrices are bound to one of them:
 * the skinning inputs are identical, so the render is exact (each mesh keeps
 * its own `bindMatrix`). Applied before any frame (the layout phase), so the
 * dropped skeletons never build a bone texture. Idempotent per mesh
 * through `seen`.
 */
export function shareFigureSkeletons(root: THREE.Object3D, seen: WeakSet<THREE.Object3D> = new WeakSet()): SkeletonSharing {
  const byKey = new Map<string, THREE.Skeleton>();
  const undo: (() => void)[] = [];
  let skinnedMeshes = 0;
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh !== true || !mesh.skeleton) return;
    skinnedMeshes += 1;
    const key = skeletonKey(mesh.skeleton);
    const shared = byKey.get(key);
    if (shared === undefined) {
      byKey.set(key, mesh.skeleton);
      return;
    }
    if (seen.has(mesh) || shared === mesh.skeleton) return;
    seen.add(mesh);
    const original = mesh.skeleton;
    mesh.skeleton = shared;
    undo.push(() => {
      mesh.skeleton = original;
      seen.delete(mesh);
    });
  });
  const distinct = new Set<THREE.Skeleton>();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh === true && mesh.skeleton) distinct.add(mesh.skeleton);
  });
  return {
    skinnedMeshes,
    skeletons: distinct.size,
    changed: undo.length,
    restore: () => {
      for (const step of undo.splice(0)) step();
    },
  };
}

/**
 * R49 K9 ("not on screen costs nothing", per part): a CLIP-LESS figure's
 * skinned parts never move against its root — no mixer poses them, actors
 * do not breathe — so the rest-pose bounding sphere `Figure` stores on
 * every part (`skinnedRestBounds`) is exact, and three's own per-object
 * frustum test can skip a part that is off screen (a floater at the frame's
 * corner). `Figure` turns culling off for every part because an animated
 * pose can leave its rest sphere; this re-enables it only for parts with a
 * stored sphere. The warm's buffer pass draws every object with culling
 * off (it saves and restores the flag), so executables and uploads are
 * still paid before the reveal (D23). Returns the undo.
 */
export function cullStaticParts(root: THREE.Object3D, seen: WeakSet<THREE.Object3D> = new WeakSet()): { parts: number; restore: () => void } {
  const undo: (() => void)[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh !== true || seen.has(mesh) || mesh.frustumCulled) return;
    const sphere = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true ? (mesh as THREE.SkinnedMesh).boundingSphere : mesh.geometry?.boundingSphere;
    if (!sphere || sphere.isEmpty()) return;
    seen.add(mesh);
    mesh.frustumCulled = true;
    undo.push(() => {
      mesh.frustumCulled = false;
      seen.delete(mesh);
    });
  });
  return {
    parts: undo.length,
    restore: () => {
      for (const step of undo.splice(0)) step();
    },
  };
}

/**
 * R49 K9 / D26: run `adoptSharedPrograms` and `shareFigureSkeletons` (and,
 * for a clip-less figure, `cullStaticParts`) over
 * the actor's subtree in every commit's layout phase (idempotent per mesh),
 * i.e. in the commit that mounts the figure and before any frame — so before
 * the load warm compiles or draws it. Undone on unmount. Recorded on the
 * probe's debug row (`programs`, `skeletons`).
 */
export function useActorProgramShare(
  root: { readonly current: THREE.Object3D | null },
  share: ActorProgramShare,
  debug: CoreActorDebugRow | undefined,
  clipless = false,
): void {
  const state = useRef<{ seen: WeakSet<THREE.Object3D>; seenSkins: WeakSet<THREE.Object3D>; seenParts: WeakSet<THREE.Object3D>; undo: (() => void)[] } | null>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (node === null) return;
    if (state.current === null) state.current = { seen: new WeakSet(), seenSkins: new WeakSet(), seenParts: new WeakSet(), undo: [] };
    const held = state.current;
    const adoption = adoptSharedPrograms(node, share, held.seen);
    const skins = shareFigureSkeletons(node, held.seenSkins);
    const parts = clipless ? cullStaticParts(node, held.seenParts) : null;
    // Only a commit that changed something keeps an undo (most commits find every mesh seen).
    if (adoption.singleSided.length > 0 || adoption.vertexColored.length > 0) held.undo.push(adoption.restore);
    if (skins.changed > 0) held.undo.push(skins.restore);
    if (parts !== null && parts.parts > 0) held.undo.push(parts.restore);
    if (!debug) return;
    if (skins.skinnedMeshes > 0) debug.skeletons = { skinnedMeshes: skins.skinnedMeshes, skeletons: skins.skeletons };
    if (adoption.singleSided.length === 0 && adoption.vertexColored.length === 0) return;
    const programs = debug.programs ?? { singleSided: [], vertexColored: [], coloredMeshes: 0 };
    programs.singleSided.push(...adoption.singleSided);
    programs.vertexColored.push(...adoption.vertexColored);
    programs.coloredMeshes += adoption.coloredMeshes;
    debug.programs = programs;
  });
  useLayoutEffect(
    () => () => {
      const held = state.current;
      if (held === null) return;
      // Newest first: the skeleton rebinds, then the material / geometry swaps.
      for (const step of held.undo.splice(0).reverse()) step();
      state.current = null;
      // The readout describes the mounted figure only (a StrictMode remount re-records it).
      if (debug) {
        delete debug.programs;
        delete debug.skeletons;
      }
    },
    // The debug row is created once per probe mount (CoreActorProbe's useMemo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

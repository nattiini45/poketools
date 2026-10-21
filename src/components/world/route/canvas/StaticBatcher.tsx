'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useWorldState } from '../WorldStateProvider';
import {
  BATCH_BUILD_SLICE_MS,
  type BatchRecord,
  dequantizeToFloat32,
  geometryHash,
  isDataFaceMaterial,
  isMergeableMaterial,
  materialSignature,
  type MergeableMaterial,
  sourcesOf,
} from './batch-merge';

/**
 * C-032 delivery-layer static batching (`StaticBatcher`).
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * C-032: delivery-layer static batching. The wave authored the plaza's
 * repeated props as sibling meshes — plinth courses, rails, lamp housings,
 * bollards — most with per-mesh material clones of identical parameters and
 * per-mesh geometry instances of a handful of shapes. Station files are
 * closed, so the consolidation happens HERE, in the canvas that delivers
 * them: each family of visually-identical, provably-still meshes is
 * re-expressed as ONE merged mesh (world-space baked geometry, one of the
 * family's materials), and the kit's per-block InstancedMeshes are folded
 * into one per (material, geometry, shadow flags). A draw call per member
 * disappears from BOTH the colour pass and the sun's shadow pass — the two
 * costs the §9 call budget is spent on (703 -> 330 calls at rung 0, pulse).
 *
 * Known delta, measured and reported (C-032 r1 A/B): the wave layers
 * COINCIDENT stone surfaces (kit modules over the writer's mass wings, writer
 * slot over slot) whose depth fights the React tree order resolves. A merged
 * family draws once and cannot preserve per-member order, so a localized
 * ~4 % tolerant pixel difference remains against `?routeNoBatch=1` on the
 * layered structure left of #pulse (deterministic; every rung equally; the
 * ladder's adjacent-rung degradation is unaffected). Geometry, materials and
 * transforms are provably preserved — the delta is which coincident surface
 * wins its depth fight.
 *
 * Safety gates, in order:
 *  - skinned / morph / transparent / reordered meshes are never touched;
 *  - ShaderMaterial and anything MeshStandard/Basic-shaped code cannot prove
 *    equal for is never merged (`materialSignature` covers every shader-reaching
 *    scalar and texture slot of the mergeable types);
 *  - families require a uniform attribute set and index layout, or the odd
 *    members stay authored;
 *  - quantized-attribute families (KHR_mesh_quantization GLBs — the Meshy
 *    props) are dequantized to float32 inside the clone before the world
 *    bake, and the bake matrix is recomputed from the live parent chain:
 *    normalized int16 storage wraps under `applyMatrix4` and collapsed such
 *    families onto the batch's origin (C-052, the C-043 repro);
 *  - focus proxies are never touched (pointer picking is proxy-only, and
 *    subjects measured their bounds at mount — both unaffected by hiding);
 *  - a mesh only joins a family after its world matrix (or instance block)
 *    has held still for a stability window, so walking figures, orbiting
 *    holos and page-turning boards are excluded by observation, not guesswork;
 *  - every batch is revalidated on a slow tick: any drift (original
 *    unmounted, forced visible, moved) drops THAT batch alone — theme flips,
 *    tier changes and figure populations self-heal without churn.
 *
 * Family bounding spheres grow to the union (usually plaza-wide), so the
 * merged mesh is submitted whenever any member would have been; the families
 * total ~20 k triangles against a 1.2 M budget, making that trade free.
 * Reverts fully on unmount — originals are only ever hidden, never removed.
 */
export function StaticBatcher({
  arm,
  propFamilyPrefixes,
}: {
  arm: { mesh: boolean; instanced: boolean };
  propFamilyPrefixes: readonly string[];
}) {
  const scene = useThree((state) => state.scene);
  const { debug } = useWorldState();
  // Primitive captures keep the effect deps exhaustive; the arm is pinned by
  // the parent's useMemo, so these never change for a mounted canvas.
  const noMeshMerge = arm.mesh;
  const noInstancedMerge = arm.instanced;
  const prefixesKey = propFamilyPrefixes.join('|');

  useEffect(() => {
    const stableSince = new WeakMap<THREE.Mesh, Float32Array>();
    const tracked = new Set<THREE.Mesh>();
    const hashCache = new WeakMap<THREE.BufferGeometry, string>();
    const batches: BatchRecord[] = [];
    const batchedOriginals = new Set<THREE.Mesh>();
    let running = true;

    /**
     * C-089: theme-declared prop families (plaza: the Meshy hero-prop GLBs —
     * lamp posts, plinth masses, gate crests, the kiosk) never merge. C-032's
     * trade — one merged draw for a family whose union bounds are plaza-wide
     * — assumed "families total ~20 k triangles"; the Meshy GLB members are
     * 14-20 k EACH and mount 2-8 times, so a merged family was submitted from
     * every station camera at full size (the tri doubling's source, 2.00x the
     * C-032 record). Authored, each instance keeps its own bounds and three's
     * frustum cull drops the instances outside the station frame — the C-032
     * ladder's visibility-culling discipline. Named roots only; the batcher's
     * stone courses and rails are untouched.
     */
    const propPrefixes = prefixesKey.length > 0 ? prefixesKey.split('|') : [];
    const underPropFamily = (object: THREE.Object3D): boolean => {
      for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        const name = node.name;
        if (!name) continue;
        for (const prefix of propPrefixes) {
          if (name.startsWith(prefix)) return true;
        }
      }
      return false;
    };

    const candidate = (object: THREE.Object3D): object is THREE.Mesh => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return false;
      if (!mesh.visible || !mesh.geometry || !mesh.material) return false;
      if (mesh.renderOrder !== 0) return false;
      if (mesh.morphTargetInfluences) return false;
      if (mesh.userData?.focusSubject || mesh.userData?.staticBatch) return false;
      // ENGINE r5: a data face (the keep-out law, data-surfaces.ts) is never
      // merged — not even its placeholder material while its canvas paints.
      if (isDataFaceMaterial(mesh.material)) return false;
      if (underPropFamily(mesh)) return false;
      if (Array.isArray(mesh.material)) return false; // multi-material: never merge
      if (!isMergeableMaterial(mesh.material) || mesh.material.transparent) return false;
      if (!mesh.geometry.attributes.position) return false;
      return true;
    };

    const snapshot = (mesh: THREE.Mesh): Float32Array => {
      // The render loop owns world-matrix updates; re-deriving them here for
      // hundreds of meshes every tick showed up as frame hitches (C-032), so
      // the sampler only ever copies what the renderer last committed.
      const out = new Float32Array(16);
      out.set(mesh.matrixWorld.elements);
      return out;
    };

    const sameMatrix = (a: Float32Array, b: Float32Array): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
      return true;
    };

    const hashOf = (geometry: THREE.BufferGeometry): string => {
      const cached = hashCache.get(geometry);
      if (cached) return cached;
      const hash = geometryHash(geometry);
      hashCache.set(geometry, hash);
      return hash;
    };

    const teardownBatch = (index: number) => {
      const [batch] = batches.splice(index, 1);
      scene.remove(batch.merged);
      if (batch.ownsGeometry) {
        // A mergeGeometries output the batcher created: disposable here.
        batch.merged.geometry.dispose();
      } else if (batch.merged instanceof THREE.InstancedMesh) {
        // An instanced family's merged mesh (the only `ownsGeometry: false`
        // build path). Its GEOMETRY is the source shared with the originals
        // this teardown just re-showed, so that must survive (PR #63 review —
        // disposing it stripped the GPU buffers out from under them). Its
        // instanceMatrix/instanceColor are batcher-allocated, though, and
        // three frees those ONLY on the InstancedMesh 'dispose' event —
        // without this every revalidate rebuild leaks one instance buffer set
        // per family.
        batch.merged.dispose();
      }
      for (const original of batch.originals) {
        original.visible = true;
        batchedOriginals.delete(original);
      }
    };

    const teardown = () => {
      while (batches.length > 0) teardownBatch(0);
    };

    /** One observe tick: stamp movers, keep still meshes' original stamps. */
    const observe = () => {
      if (!running) return;
      const seen = new Set<THREE.Mesh>();
      scene.traverse((object) => {
        const instanced = object as THREE.InstancedMesh;
        if (instanced.isInstancedMesh && instanced.visible && !instanced.userData?.staticBatch) {
          const block = (instanced.instanceMatrix.array as Float32Array).subarray(
            0,
            instanced.count * 16,
          );
          const was = stableSince.get(instanced);
          // Stamp a COPY, never the live `instanceMatrix.array` reference: a
          // reference compares equal to itself on every tick, so the mover
          // guard degenerates to a no-op and animated instanced meshes get
          // frozen into static batches (PR #63 review). Same discipline the
          // build path's `frozen` blocks keep.
          if (!was || !sameMatrix(was, block)) stableSince.set(instanced, block.slice());
          seen.add(instanced);
          tracked.add(instanced);
          return;
        }
        if (!candidate(object)) return;
        const mesh = object as THREE.Mesh;
        seen.add(mesh);
        const now = snapshot(mesh);
        const was = stableSince.get(mesh);
        if (was && sameMatrix(was, now)) return; // still still — stamp stands
        stableSince.set(mesh, now);
        tracked.add(mesh);
      });
      for (const mesh of tracked) {
        if (!seen.has(mesh)) {
          tracked.delete(mesh);
          stableSince.delete(mesh);
        }
      }
    };

    /** Attribute-set key — mergeGeometries needs identical sets per member. */
    const attributeKey = (geometry: THREE.BufferGeometry): string =>
      `${Object.keys(geometry.attributes).sort().join(',')}${geometry.index ? '|i' : ''}`;

    /**
     * ENGINE-A4 (ceremony main thread): the fold is SLICED. One build used to
     * run every family's clone / world bake / merge in one timer task, a
     * 30-56 ms long animation frame under the ball (A3 LoAF). The traversal
     * groups the families in the timer task; each family then merges as its
     * own step, and steps run under BATCH_BUILD_SLICE_MS per task, so no task
     * carries more than one slice. A family that waited for a later task is
     * re-checked member by member first (still mounted, visible, unbatched,
     * same material and geometry, same stamp): a mesh that changed since the
     * grouping stays authored, exactly as if it had failed the grouping.
     */
    let buildWork: (() => void)[] = [];
    let buildSliceTimer: ReturnType<typeof setTimeout> | null = null;
    const pumpBuild = () => {
      buildSliceTimer = null;
      if (!running) {
        buildWork = [];
        return;
      }
      const started = performance.now();
      while (buildWork.length > 0) {
        const step = buildWork.shift();
        step?.();
        if (performance.now() - started >= BATCH_BUILD_SLICE_MS) break;
      }
      if (buildWork.length > 0) buildSliceTimer = setTimeout(pumpBuild, 0);
    };
    const cancelBuild = () => {
      buildWork = [];
      if (buildSliceTimer !== null) clearTimeout(buildSliceTimer);
      buildSliceTimer = null;
    };
    /** The grouping's view of a member, re-checked when its family's step runs. */
    const memberStill = (
      mesh: THREE.Mesh | THREE.InstancedMesh,
      source: { material: THREE.Material | THREE.Material[]; geometry: THREE.BufferGeometry; stamp: Float32Array },
    ): boolean => {
      if (!mesh.parent || !mesh.visible || batchedOriginals.has(mesh)) return false;
      if (mesh.material !== source.material || mesh.geometry !== source.geometry) return false;
      const instanced = mesh as THREE.InstancedMesh;
      const now = instanced.isInstancedMesh
        ? (instanced.instanceMatrix.array as Float32Array).subarray(0, instanced.count * 16)
        : snapshot(mesh);
      return sameMatrix(source.stamp, now);
    };
    const stampOf = (mesh: THREE.Mesh | THREE.InstancedMesh) => {
      const instanced = mesh as THREE.InstancedMesh;
      const stamp = instanced.isInstancedMesh
        ? (instanced.instanceMatrix.array as Float32Array).slice(0, instanced.count * 16)
        : snapshot(mesh);
      return { material: mesh.material, geometry: mesh.geometry, stamp };
    };

    /** Fold newly-settled, visually-identical meshes into merged families. */
    const build = () => {
      // A sliced build still running: the next tick groups what is left.
      if (!running || buildWork.length > 0) return;
      // `arm` carries the routeNoBatch DISABLE flags — a true arm means "do
      // not merge these", so the maps exist only for the enabled arms.
      const groups = noMeshMerge ? null : new Map<string, THREE.Mesh[]>();
      const instancedGroups = noInstancedMerge ? null : new Map<string, THREE.InstancedMesh[]>();
      scene.traverse((object) => {
        const instanced = object as THREE.InstancedMesh;
        if (instanced.isInstancedMesh && instanced.visible && !instanced.userData?.staticBatch) {
          if (!instancedGroups) return;
          if (batchedOriginals.has(instanced)) return;
          const material = instanced.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material) || !isMergeableMaterial(material) || material.transparent) return;
          if (instanced.instanceColor || instanced.morphTargetInfluences) return;
          const since = stableSince.get(instanced);
          // Same count-window `observe` stamps: a count below the constructed
          // capacity is legal in three.js, and comparing the stamp against the
          // full backing array would length-mismatch forever, silently never
          // batching that family (PR #63 review).
          const block = (instanced.instanceMatrix.array as Float32Array).subarray(
            0,
            instanced.count * 16,
          );
          if (!since || !sameMatrix(since, block)) return; // instances still moving
          const signature = materialSignature(material);
          if (!signature) return;
          const key = `${signature}|${hashOf(instanced.geometry)}|${instanced.castShadow ? 1 : 0}|${instanced.receiveShadow ? 1 : 0}`;
          const bucket = instancedGroups.get(key);
          if (bucket) bucket.push(instanced);
          else instancedGroups.set(key, [instanced]);
          return;
        }
        if (!groups || !candidate(object)) return;
        const mesh = object as THREE.Mesh;
        if (batchedOriginals.has(mesh)) return;
        const since = stableSince.get(mesh);
        if (!since || !sameMatrix(since, snapshot(mesh))) return; // mover or unstamped
        const signature = materialSignature(mesh.material as MergeableMaterial);
        if (!signature) return;
        const key = `${signature}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
        const bucket = groups.get(key);
        if (bucket) bucket.push(mesh);
        else groups.set(key, [mesh]);
      });
      for (const grouped of groups?.values() ?? []) {
        if (grouped.length < 2) continue;
        const seen = grouped.map(stampOf);
        buildWork.push(() => mergeMeshFamily(grouped.filter((mesh, i) => memberStill(mesh, seen[i]))));
      }
      for (const grouped of instancedGroups?.values() ?? []) {
        if (grouped.length < 2) continue;
        const seen = grouped.map(stampOf);
        buildWork.push(() => mergeInstancedFamily(grouped.filter((mesh, i) => memberStill(mesh, seen[i]))));
      }
      pumpBuild();
    };

    /** One family of still meshes -> one merged mesh (a build step). */
    const mergeMeshFamily = (meshes: THREE.Mesh[]) => {
      if (!running) return;
      if (meshes.length < 2) return;
      // Only members with a common attribute set can merge; the rest stay.
      const sets = new Map<string, THREE.Mesh[]>();
      for (const mesh of meshes) {
        const attrKey = attributeKey(mesh.geometry);
        const bucket = sets.get(attrKey);
        if (bucket) bucket.push(mesh);
        else sets.set(attrKey, [mesh]);
      }
      for (const members of sets.values()) {
        if (members.length < 2) continue;
        const first = members[0];
        const matrix = new THREE.Matrix4();
        const parts: THREE.BufferGeometry[] = [];
        const frozen: Float32Array[] = [];
        const mergedMembers: THREE.Mesh[] = [];
        const firstIndexed = first.geometry.index !== null;
        for (const mesh of members) {
          // Bake from the LIVE parent chain (the instanced arm's C-034
          // discipline): the committed matrixWorld the sampler reads can
          // predate the object's mount, and a family stamped across that
          // window would bake from a stale parent. Still-mesh values are
          // unchanged — this only recomputes what updateMatrixWorld would.
          mesh.updateWorldMatrix(true, false);
          const world = snapshot(mesh);
          const part = mesh.geometry.clone();
          dequantizeToFloat32(part); // quantized storage cannot hold a world bake (C-052)
          matrix.fromArray(world);
          part.applyMatrix4(matrix);
          // `toNonIndexed` RETURNS the converted geometry — call sites that
          // ignore the return keep the indexed original and the merge dies.
          const ready = firstIndexed ? (part.index ? part : null) : part.toNonIndexed();
          if (!ready) {
            part.dispose();
            continue; // cannot match the family's index layout — stay authored
          }
          parts.push(ready);
          frozen.push(world);
          mergedMembers.push(mesh);
        }
        if (parts.length < 2) {
          for (const part of parts) part.dispose();
          continue;
        }
        const mergedGeometry = mergeGeometries(parts, false);
        for (const part of parts) part.dispose();
        if (!mergedGeometry) continue; // incompatible shapes — leave as authored
        const merged = new THREE.Mesh(mergedGeometry, first.material as THREE.Material);
        merged.castShadow = first.castShadow;
        merged.receiveShadow = first.receiveShadow;
        merged.userData.staticBatch = true;
        merged.frustumCulled = true;
        mergedGeometry.computeBoundingSphere();
        scene.add(merged);
        for (const mesh of mergedMembers) {
          mesh.visible = false;
          batchedOriginals.add(mesh);
        }
        batches.push({ merged, originals: mergedMembers, ownsGeometry: true, frozen, sources: sourcesOf(mergedMembers) });
      }
    };

    /**
     * Instanced families (kit bays across blocks): one InstancedMesh per
     * (material, geometry, shadow flags) instead of one per block (a build step).
     */
    const mergeInstancedFamily = (members: THREE.InstancedMesh[]) => {
      if (!running) return;
      if (members.length < 2) return;
      const first = members[0];
      const count = members.reduce((sum, mesh) => sum + mesh.count, 0);
      const mergedInstanced = new THREE.InstancedMesh(
        first.geometry,
        first.material as THREE.Material,
        count,
      );
      mergedInstanced.castShadow = first.castShadow;
      mergedInstanced.receiveShadow = first.receiveShadow;
      mergedInstanced.userData.staticBatch = true;
      mergedInstanced.frustumCulled = true;
      const frozen: Float32Array[] = [];
      // The merged mesh is added at the SCENE ROOT, so each copied instance
      // must carry its source mesh's full parent chain: pre-multiply the
      // block-local matrices by the source's matrixWorld (C-034). Copying
      // them verbatim collapsed the kit bays to world≈block-local coords —
      // a phantom stone wall across the plaza — and stripped them from the
      // façades (C-031 r2 finding). `frozen` keeps the raw block-local copy:
      // revalidate diffs it against the ORIGINAL's live block, unchanged.
      const parentWorld = new THREE.Matrix4();
      const instance = new THREE.Matrix4();
      const composed = new THREE.Matrix4();
      const target = mergedInstanced.instanceMatrix.array as Float32Array;
      let cursor = 0;
      let overflow = false;
      for (const mesh of members) {
        mesh.updateWorldMatrix(true, false);
        parentWorld.copy(mesh.matrixWorld);
        const block = mesh.instanceMatrix.array as Float32Array;
        for (let i = 0; i < mesh.count; i += 1) {
          instance.fromArray(block, i * 16);
          composed.multiplyMatrices(parentWorld, instance);
          composed.toArray(target, cursor * 16);
          cursor += 1;
        }
        frozen.push(block.slice(0, mesh.count * 16));
        if (cursor > count) overflow = true;
      }
      if (overflow) return; // defensive — count was computed from the same meshes
      mergedInstanced.instanceMatrix.needsUpdate = true;
      mergedInstanced.computeBoundingSphere();
      scene.add(mergedInstanced);
      for (const mesh of members) {
        mesh.visible = false;
        batchedOriginals.add(mesh);
      }
      batches.push({ merged: mergedInstanced, originals: members, ownsGeometry: false, frozen, sources: sourcesOf(members) });
    };

    /**
     * Drift containment: a batch whose originals were unmounted, re-shown or
     * moved is dropped ALONE — its originals return to the candidate flow and
     * are either re-batched or (if they turned out to move) left authored.
     * Tearing everything down for one rotating board's remount churned the
     * whole plaza and showed up as frame hitches (C-032).
     */
    const revalidate = (() => {
      // Pointer checks are O(1) per original and run every tick; the matrix
      // audit walks a slice per tick so every original is re-read within a
      // couple of seconds without a per-tick traversal hitch.
      let cursor = 0;
      return () => {
        if (!running) return;
        for (let b = batches.length - 1; b >= 0; b -= 1) {
          const batch = batches[b];
          if (!batch.merged.parent || !batch.frozen) {
            teardownBatch(b);
            continue;
          }
          for (let i = 0; i < batch.originals.length; i += 1) {
            const original = batch.originals[i];
            const source = batch.sources[i];
            if (!original.parent || original.visible || source === undefined || original.material !== source.material || original.geometry !== source.geometry) {
              teardownBatch(b);
              break;
            }
          }
        }
        for (let n = 0; n < 64 && batches.length > 0; n += 1) {
          const b = cursor % batches.length;
          const i = Math.floor(cursor / batches.length) % batches[b].originals.length;
          const original = batches[b].originals[i];
          const frozen = batches[b].frozen[i];
          const current = (original as THREE.InstancedMesh).isInstancedMesh
            ? ((original as THREE.InstancedMesh).instanceMatrix.array as Float32Array).subarray(
                0,
                (original as THREE.InstancedMesh).count * 16,
              )
            : snapshot(original);
          if (!frozen || !original.parent || original.visible || !sameMatrix(frozen, current)) {
            teardownBatch(b);
            continue;
          }
          cursor += 1;
        }
      };
    })();

    // Pipeline: observe stamps movers and stills alike; build folds everything
    // that has held still across two observe ticks (>= 700 ms); revalidate
    // tears down on any drift so theme/tier/population changes self-heal.
    //
    // The timers run only while the tab is genuinely hidden from the visitor.
    // A hidden tab paints nothing (the canvas is parked on `demand`), so
    // batching for it is pure battery cost — and the 250 ms revalidate tick in
    // particular would keep tearing down and rebuilding batches for a scene
    // nobody can see.
    //
    // Debug is exempt, on the canvas' own existing law: an embedded browser
    // reports `document.hidden` permanently, and the capture harness refuses to
    // present until the batcher has settled — pausing there would stall every
    // capture instead of saving any power.
    const parked = () => document.hidden && !debug;

    let observeTimer: ReturnType<typeof setInterval> | null = null;
    let buildTimer: ReturnType<typeof setInterval> | null = null;
    let checkTimer: ReturnType<typeof setInterval> | null = null;

    const stopTimers = () => {
      cancelBuild();
      if (observeTimer !== null) clearInterval(observeTimer);
      if (buildTimer !== null) clearInterval(buildTimer);
      if (checkTimer !== null) clearInterval(checkTimer);
      observeTimer = null;
      buildTimer = null;
      checkTimer = null;
    };

    const startTimers = () => {
      if (observeTimer !== null) return;
      observeTimer = setInterval(observe, 900);
      buildTimer = setInterval(build, 1800);
      checkTimer = setInterval(revalidate, 250);
    };

    const onVisibilityChange = () => {
      if (parked()) stopTimers();
      else startTimers();
    };

    if (!parked()) startTimers();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      running = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopTimers();
      teardown();
    };
  }, [scene, noMeshMerge, noInstancedMerge, prefixesKey, debug]);

  return null;
}

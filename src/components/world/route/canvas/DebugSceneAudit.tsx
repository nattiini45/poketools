'use client';

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '../WorldStateProvider';
import { geometryHash } from './batch-merge';

/**
 * The `?routeDebug=1` scene audit (`window.__routeWorldAudit`).
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/** Mesh groups sharing geometry AND material — the instancing candidates. */
interface AuditGroup {
  key: string;
  count: number;
  triangles: number;
  skinned: number;
  inView: number;
  name: string;
  source: string;
}

/** Signature buckets for the C-032 draw-call diagnosis. */
interface AuditSignature {
  sig: string;
  count: number;
  casters: number;
  inView: number;
  triangles: number;
  instancedMeshes: number;
  instancedCount: number;
  /** Largest same-geometry sub-bucket (content hash) inside the family. */
  biggestShape: number;
  shapes: number;
}

type AuditReport = {
  /** Bump on audit-hook changes so measurement scripts can verify fresh compile. */
  auditVersion: number;
  totalCalls: number;
  totalTriangles: number;
  meshes: number;
  instanced: number;
  points: number;
  lines: number;
  casters: number;
  instancedCasters: number;
  skinned: number;
  materials: number;
  staticBatches: number;
  hiddenOriginals: number;
  constructors: Record<string, number>;
  /** Merged batches with screen positions (C-032 diagnosis). */
  batchInventory: {
    x: number;
    y: number;
    tris: number;
    members: number;
    castShadow: boolean;
    instanced: boolean;
    material: string;
  }[];
  signatures: AuditSignature[];
  groups: AuditGroup[];
  /**
   * C-089: per-prop-family triangle accounting at read time — the falsifiable
   * split of the visible-tri budget (ace / ambient / nurse / hero-prop /
   * street-lamp / stone-batch / instanced / authored) so a tri regression can
   * be attributed to the family that owns it without a devtools traverse.
   * Debug-only, same contract as the C-032 audit itself.
   */
  families: {
    family: string;
    meshes: number;
    triangles: number;
    instancedMeshes: number;
    instancedCount: number;
  }[];
  /** Debug-only: freeze/unfreeze shadow-map re-render to split call counts. */
  setShadowFreeze: (frozen: boolean) => void;
  /** Debug-only: what draws under a screen point (NDC x/y in -1..1). */
  raycastAt: (ndcX: number, ndcY: number) => string[];
  /**
   * C-045 debug-only: the light-rig / env / shadow state vector at read time —
   * the levers of the west-wing appearance race (sun path, env response, tone
   * owner) so per-load state is diffable from a probe without devtools.
   */
  sceneState: {
    lights: {
      type: string;
      color: string;
      intensity: number;
      position: [number, number, number];
      castShadow: boolean;
      shadowMapSize: number;
      shadowCamera: [number, number, number, number, number, number];
    }[];
    environment: { present: boolean; cubeUv: boolean };
    toneMapping: number;
    toneMappingExposure: number;
    shadowMap: { enabled: boolean; type: number; autoUpdate: boolean };
    fog: { present: boolean; density: number; color: string } | null;
    background: string;
  };
};

type AuditHost = Window & {
  __routeWorldAudit?: () => AuditReport;
};

/**
 * C-032: read-only scene audit for `?routeDebug=1` sessions — a histogram of
 * draw sources so the performance pass can see WHERE the calls come from
 * (repeated static meshes are the instancing candidates) without a devtools
 * debugger. Same contract as `__routeWorldProbe`: pure inspection, mutation
 * of nothing, deleted on unmount. Never mounted outside debug.
 */
export function DebugSceneAudit() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const { theme } = useWorldState();
  // Theme-owned named families (plaza: ace / ambient / hero props …). The
  // prefix list arrives with the theme; the derived family label strips the
  // trailing '-' or '-prop' so report names match the pre-theme audit.
  const propPrefixes = useMemo(() => theme?.propFamilyPrefixes ?? [], [theme]);

  useEffect(() => {
    const host = window as AuditHost;
    /** Material signature — cloned-but-identical materials still cluster. */
    const signatureOf = (mesh: THREE.Mesh): string => {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const m = material as THREE.MeshStandardMaterial;
      const colored = material as THREE.Material & { color?: THREE.Color };
      const parts = [
        material.type,
        `#${colored.color?.getHexString() ?? 'none'}`,
        m.map ? m.map.uuid : '-',
        m.roughness ?? '-',
        m.metalness ?? '-',
        material.transparent ? 't' : 'o',
        m.emissive ? `#${m.emissive.getHexString()}` : '-',
      ];
      return parts.join('|');
    };
    /** Family label for a theme prop-family node name (empty = no match). */
    const propFamilyOf = (name: string): string => {
      for (const prefix of propPrefixes) {
        if (!name.startsWith(prefix)) continue;
        return prefix.replace(/-$/, '').replace(/-prop$/, '');
      }
      return '';
    };
    host.__routeWorldAudit = () => {
      const frustum = new THREE.Frustum();
      frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      const buckets = new Map<string, AuditGroup>();
      const signatures = new Map<string, Omit<AuditSignature, 'sig' | 'biggestShape' | 'shapes'>>();
      const materialUuids = new Set<string>();
      const shapeHistograms = new Map<string, Map<string, number>>();
      const families = new Map<
        string,
        { family: string; meshes: number; triangles: number; instancedMeshes: number; instancedCount: number }
      >();
      /**
       * C-089 family attribution: theme prop-family ancestors win (named
       * roots the theme declares in `propFamilyPrefixes`), then the batcher's
       * merged stone replacements, then instanced kit, then the authored
       * procedural remainder.
       */
      const familyOf = (mesh: THREE.Mesh): string => {
        for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
          const family = node.name ? propFamilyOf(node.name) : '';
          if (family) return family;
        }
        if (mesh.userData?.staticBatch) return 'stone-batch';
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) return 'instanced';
        return 'authored';
      };
      const bumpFamily = (family: string, triangles: number, instancedMeshes = 0, instancedCount = 0) => {
        const entry =
          families.get(family) ??
          { family, meshes: 0, triangles: 0, instancedMeshes: 0, instancedCount: 0 };
        entry.meshes += 1;
        entry.triangles += triangles;
        entry.instancedMeshes += instancedMeshes;
        entry.instancedCount += instancedCount;
        families.set(family, entry);
      };
      let meshes = 0;
      let instanced = 0;
      let points = 0;
      let lines = 0;
      let casters = 0;
      let instancedCasters = 0;
      let totalSkinned = 0;
      let staticBatches = 0;
      let hiddenOriginals = 0;
      const constructors: Record<string, number> = {};
      const bump = (sig: string, patch: Partial<Omit<AuditSignature, 'sig' | 'biggestShape' | 'shapes'>>) => {
        const entry =
          signatures.get(sig) ?? { count: 0, casters: 0, inView: 0, triangles: 0, instancedMeshes: 0, instancedCount: 0 };
        entry.count += patch.count ?? 0;
        entry.casters += patch.casters ?? 0;
        entry.inView += patch.inView ?? 0;
        entry.triangles += patch.triangles ?? 0;
        entry.instancedMeshes += patch.instancedMeshes ?? 0;
        entry.instancedCount += patch.instancedCount ?? 0;
        signatures.set(sig, entry);
      };
      scene.traverse((object) => {
        const ctor = object.constructor?.name ?? 'unknown';
        constructors[ctor] = (constructors[ctor] ?? 0) + 1;
        const obj = object as THREE.Points & THREE.Line & THREE.Mesh & THREE.InstancedMesh;
        if (obj.userData?.staticBatch) staticBatches += 1;
        else if (obj.isMesh && !obj.visible) {
          hiddenOriginals += 1;
          return; // hidden originals neither draw nor count as remaining work
        }
        if (obj.isPoints) {
          points += 1;
          return;
        }
        if (obj.isLine) {
          lines += 1;
          return;
        }
        if (!obj.isMesh || !obj.geometry || !obj.material) return;
        const mesh = obj;
        const geometry = mesh.geometry as THREE.BufferGeometry & { attributes: { position?: THREE.BufferAttribute } };
        const verts = geometry.attributes.position?.count ?? 0;
        const index = geometry.index?.count;
        const tris = Math.floor((index ?? verts) / 3);
        const inView = frustum.intersectsObject(mesh);
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        materialUuids.add(material.uuid);
        const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh ? 1 : 0;
        if (mesh.isInstancedMesh) {
          instanced += 1;
          if (mesh.castShadow) instancedCasters += 1;
          bump(signatureOf(mesh), { instancedMeshes: 1, instancedCount: mesh.count, casters: mesh.castShadow ? 1 : 0, triangles: tris * mesh.count });
          bumpFamily(familyOf(mesh), tris * mesh.count, 1, mesh.count);
          return;
        }
        meshes += 1;
        if (mesh.castShadow) casters += 1;
        if (skinned) totalSkinned += 1;
        const sig = signatureOf(mesh);
        const shape = geometryHash(mesh.geometry);
        let histo = shapeHistograms.get(sig);
        if (!histo) {
          histo = new Map();
          shapeHistograms.set(sig, histo);
        }
        histo.set(shape, (histo.get(shape) ?? 0) + 1);
        bump(sig, { count: 1, casters: mesh.castShadow ? 1 : 0, inView: inView ? 1 : 0, triangles: tris });
        bumpFamily(familyOf(mesh), tris);
        const key = `${geometry.uuid}/${material.uuid}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.count += 1;
          existing.skinned += skinned;
          existing.inView += inView ? 1 : 0;
        } else {
          const chain: string[] = [];
          for (let node = mesh.parent; node && node !== scene; node = node.parent) {
            if (node.name) chain.unshift(node.name);
          }
          buckets.set(key, {
            key,
            count: 1,
            triangles: tris,
            skinned,
            inView: inView ? 1 : 0,
            name: mesh.name || '(unnamed)',
            source: chain.slice(-2).join('/') || '(root)',
          });
        }
      });
      const info = gl.info.render;
      const batchInventory: AuditReport['batchInventory'] = [];
      scene.traverse((object) => {
        if (!object.userData?.staticBatch) return;
        const mesh = object as THREE.Mesh & THREE.InstancedMesh;
        mesh.updateWorldMatrix(true, false);
        const sphere = mesh.geometry.boundingSphere;
        if (sphere) {
          const center = sphere.center.clone().applyMatrix4(mesh.matrixWorld);
          const projected = center.project(camera);
          batchInventory.push({
            x: Math.round(((projected.x + 1) / 2) * 100),
            y: Math.round(((1 - projected.y) / 2) * 100),
            tris: mesh.geometry.index
              ? Math.floor(mesh.geometry.index.count / 3)
              : Math.floor((mesh.geometry.attributes.position?.count ?? 0) / 3),
            members: 0,
            castShadow: mesh.castShadow,
            instanced: mesh.isInstancedMesh === true,
            material: `${(() => {
              const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
              return `${m.type}#${m.color?.getHexString() ?? 'none'}`;
            })()}`,
          });
        }
      });
      // C-045: light-rig / env / shadow state vector (see AuditReport.sceneState).
      const lights: AuditReport['sceneState']['lights'] = [];
      scene.traverse((object) => {
        const light = object as THREE.Light & { shadow?: THREE.LightShadow };
        if (!(light as unknown as { isLight?: boolean }).isLight) return;
        const directional = light as THREE.DirectionalLight;
        const shadow = light.shadow;
        const mapSize = shadow?.mapSize ? Math.min(shadow.mapSize.width, shadow.mapSize.height) : 0;
        const camera = shadow?.camera as THREE.OrthographicCamera;
        lights.push({
          type: light.type,
          color: `#${light.color.getHexString()}`,
          intensity: light.intensity,
          position: [light.position.x, light.position.y, light.position.z],
          castShadow: Boolean(directional.castShadow && shadow),
          shadowMapSize: mapSize,
          shadowCamera: camera?.isOrthographicCamera
            ? [camera.near, camera.far, camera.left, camera.right, camera.top, camera.bottom]
            : [0, 0, 0, 0, 0, 0],
        });
      });
      const sceneState: AuditReport['sceneState'] = {
        lights,
        environment: {
          present: scene.environment !== null,
          cubeUv: scene.environment?.isRenderTargetTexture === true,
        },
        toneMapping: gl.toneMapping,
        toneMappingExposure: gl.toneMappingExposure,
        shadowMap: {
          enabled: gl.shadowMap.enabled,
          type: gl.shadowMap.type,
          autoUpdate: gl.shadowMap.autoUpdate,
        },
        fog: scene.fog
          ? {
              present: true,
              density: (scene.fog as THREE.FogExp2).density,
              color: `#${(scene.fog as THREE.FogExp2).color.getHexString()}`,
            }
          : null,
        background:
          scene.background instanceof THREE.Color ? `#${scene.background.getHexString()}` : String(scene.background ?? 'none'),
      };
      const report: AuditReport = {
        auditVersion: 5,
        totalCalls: info.calls,
        totalTriangles: info.triangles,
        meshes,
        instanced,
        points,
        lines,
        casters,
        instancedCasters,
        skinned: totalSkinned,
        materials: materialUuids.size,
        staticBatches,
        hiddenOriginals,
        constructors,
        batchInventory: batchInventory.sort((a, b) => b.tris - a.tris),
        signatures: [...signatures.entries()]
          .map(([sig, s]) => {
            const histo = shapeHistograms.get(sig);
            const shapes = [...(histo?.values() ?? [])].sort((a, b) => b - a);
            return { sig, ...s, biggestShape: shapes[0] ?? 0, shapes: shapes.length };
          })
          .sort((a, b) => b.triangles - a.triangles || b.count - a.count),
        groups: [...buckets.values()].sort((a, b) => b.count - a.count),
        families: [...families.values()].sort((a, b) => b.triangles - a.triangles),
        setShadowFreeze: (frozen: boolean) => {
          gl.shadowMap.autoUpdate = !frozen;
          gl.shadowMap.needsUpdate = !frozen;
        },
        raycastAt: (ndcX: number, ndcY: number) => {
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
          const hits = raycaster.intersectObjects(scene.children, true);
          return hits.slice(0, 3).map((hit) => {
            const object = hit.object as THREE.Mesh;
            const material = (
              Array.isArray(object.material) ? object.material[0] : object.material
            ) as THREE.MeshStandardMaterial;
            return `${hit.object.userData?.staticBatch ? 'BATCH' : 'single'} ${hit.object.constructor.name} ${material.type}#${material.color?.getHexString() ?? 'none'} map=${material.map?.uuid.slice(0, 8) ?? '-'} rough=${material.roughness ?? '-'} metal=${material.metalness ?? '-'} fog=${material.fog} side=${material.side} dist=${hit.distance.toFixed(1)}`;
          });
        },
        sceneState,
      };
      return report;
    };
    return () => {
      gl.shadowMap.autoUpdate = true;
      delete host.__routeWorldAudit;
    };
  }, [camera, gl, propPrefixes, scene]);

  return null;
}

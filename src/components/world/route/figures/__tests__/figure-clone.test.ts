import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cloneSkeletons, consolidateFigureMeshes, shareCloneSkeletons } from '../Figure';

/**
 * The figure clone's mount pipeline (`Figure.tsx`), exercised on synthetic
 * exports: no species, no GLB (D18).
 */

function part(count = 3, offset = 0): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  for (let i = 0; i < position.length; i += 1) position[i] = offset + i * 0.1;
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  g.setIndex([...Array(count).keys()]);
  return g;
}

function skinned(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('skinIndex', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
  return g;
}

/** A GLTFLoader-shaped export: one skin (one Skeleton) bound by `parts` primitives of one material. */
function skinnedExport(parts: number): THREE.Group {
  const root = new THREE.Group();
  const hip = new THREE.Bone();
  const knee = new THREE.Bone();
  knee.position.set(0, -0.5, 0);
  hip.add(knee);
  root.add(hip);
  const skeleton = new THREE.Skeleton([hip, knee]);
  const material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < parts; i += 1) {
    const mesh = new THREE.SkinnedMesh(skinned(part(3, i)), material);
    root.add(mesh);
    mesh.bind(skeleton);
  }
  return root;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) out.push(node as THREE.Mesh);
  });
  return out;
}

describe('consolidateFigureMeshes (exported in D42 commit G for the A0 merge-parity check)', () => {
  it('is exported and merges one skinned family into one mesh, returning the geometry the clone owns', () => {
    const clone = cloneSkeleton(skinnedExport(3));
    expect(meshesOf(clone)).toHaveLength(3);
    const owned = consolidateFigureMeshes(clone);
    const after = meshesOf(clone);
    expect(owned).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0].geometry).toBe(owned[0]);
    expect(after[0].geometry.getAttribute('position').count).toBe(9);
    expect((after[0] as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
  });

  it('leaves meshes of different materials authored (nothing owned)', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(part(), new THREE.MeshStandardMaterial()));
    root.add(new THREE.Mesh(part(), new THREE.MeshStandardMaterial()));
    expect(consolidateFigureMeshes(root)).toHaveLength(0);
    expect(meshesOf(root)).toHaveLength(2);
  });
});

/** A two-skin export over ONE bone hierarchy (exporters give each part its skin), `parts` primitives per skin, one material per skin. */
function twoSkinExport(parts: number, equalInverses = true): THREE.Group {
  const root = new THREE.Group();
  const hip = new THREE.Bone();
  const knee = new THREE.Bone();
  knee.position.set(0.1, -0.5, 0.2);
  knee.rotation.set(0.3, 0.1, -0.2);
  hip.add(knee);
  root.add(hip);
  root.updateMatrixWorld(true);
  const skinA = new THREE.Skeleton([hip, knee]);
  const inverses = skinA.boneInverses.map((m) => m.clone());
  if (!equalInverses) inverses[1].makeTranslation(0, 1, 0);
  const skinB = new THREE.Skeleton([hip, knee], inverses);
  for (const [k, skeleton] of [skinA, skinB].entries()) {
    const material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < parts; i += 1) {
      const mesh = new THREE.SkinnedMesh(skinned(part(3, k * 10 + i)), material);
      // Real weights over both bones, so the bone matrices matter.
      const w = mesh.geometry.getAttribute('skinWeight') as THREE.BufferAttribute;
      const j = mesh.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
      for (let v = 0; v < w.count; v += 1) {
        j.setXYZW(v, 0, 1, 0, 0);
        w.setXYZW(v, 0.4, 0.6, 0, 0);
      }
      root.add(mesh);
      // An explicit bind matrix: `bind(skeleton)` alone recomputes the inverses (and would erase the unequal pair).
      mesh.bind(skeleton, new THREE.Matrix4());
    }
  }
  return root;
}

/** Every skinned vertex of every skinned mesh, in traversal order. */
function skinnedVertices(root: THREE.Object3D): number[] {
  const out: number[] = [];
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  const updated = new Set<THREE.Skeleton>();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh !== true) return;
    if (!updated.has(mesh.skeleton)) {
      mesh.skeleton.update();
      updated.add(mesh.skeleton);
    }
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i += 1) {
      mesh.getVertexPosition(i, v);
      out.push(v.x, v.y, v.z);
    }
  });
  return out;
}

describe('shareCloneSkeletons (D42 N2: shareFigureSkeletons for every world figure)', () => {
  it('a SkeletonUtils clone of one skin: one skeleton per bone set, skinning bit-identical', () => {
    const source = skinnedExport(4);
    const shared = cloneSkeleton(source);
    const twin = cloneSkeleton(source);
    expect(cloneSkeletons(shared)).toHaveLength(4);
    const skeletons = shareCloneSkeletons(shared);
    expect(skeletons).toHaveLength(1);
    expect(cloneSkeletons(shared)).toEqual(skeletons);
    // Pose a bone the same way in both clones: the shared clone skins exactly like its unshared twin.
    for (const clone of [shared, twin]) {
      clone.traverse((node) => {
        if ((node as THREE.Bone).isBone && node.parent && (node.parent as THREE.Bone).isBone) node.rotation.set(0.4, -0.2, 0.7);
      });
    }
    expect(skinnedVertices(shared)).toEqual(skinnedVertices(twin));
  });

  it('two skins over one bone set with equal inverse binds share; unequal inverses never do', () => {
    const equal = cloneSkeleton(twoSkinExport(2));
    const equalTwin = cloneSkeleton(twoSkinExport(2));
    expect(shareCloneSkeletons(equal)).toHaveLength(1);
    expect(skinnedVertices(equal)).toEqual(skinnedVertices(equalTwin));
    const unequal = cloneSkeleton(twoSkinExport(2, false));
    expect(shareCloneSkeletons(unequal)).toHaveLength(2);
  });

  it('runs after the merge: a merged family keeps its skeleton, the bounds pass sees the shared skeletons', () => {
    const clone = cloneSkeleton(twoSkinExport(3));
    consolidateFigureMeshes(clone);
    // Two families (one per skin material), each merged into one mesh.
    expect(meshesOf(clone)).toHaveLength(2);
    expect(shareCloneSkeletons(clone)).toHaveLength(1);
  });

  it('each clone keeps its own skeletons (never shared across clones), and dispose frees each bone texture', () => {
    const source = skinnedExport(3);
    const a = shareCloneSkeletons(cloneSkeleton(source));
    const b = shareCloneSkeletons(cloneSkeleton(source));
    expect(a).toHaveLength(1);
    expect(a[0]).not.toBe(b[0]);
    a[0].computeBoneTexture();
    const texture = a[0].boneTexture!;
    let disposed = 0;
    texture.addEventListener('dispose', () => (disposed += 1));
    a[0].dispose();
    expect(disposed).toBe(1);
    expect(a[0].boneTexture).toBeNull();
    // A StrictMode remount of the same clone rebuilds lazily (three: `boneTexture === null` → compute).
    a[0].computeBoneTexture();
    expect(a[0].boneTexture).not.toBeNull();
  });

  it('a static clone (no skin) has nothing to share or dispose', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(part(), new THREE.MeshStandardMaterial()));
    expect(shareCloneSkeletons(root)).toEqual([]);
  });
});

/** Source with comments stripped (the wiring is read from the component itself). */
function figureSource(): string {
  return readFileSync(join(__dirname, '..', 'Figure.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('Figure wiring (D42 N2)', () => {
  it('shares skeletons after consolidateFigureMeshes and before meshBounds, in the clone memo', () => {
    const src = figureSource();
    const merge = src.indexOf('consolidateFigureMeshes(root)');
    const share = src.indexOf('shareCloneSkeletons(root)');
    const bounds = src.indexOf('meshBounds(root, meshDims)');
    expect(merge).toBeGreaterThan(0);
    expect(share).toBeGreaterThan(merge);
    expect(bounds).toBeGreaterThan(share);
  });

  it("disposes the clone's distinct skeletons at unmount with its owned geometries", () => {
    const src = figureSource();
    expect(src).toContain('for (const skeleton of skeletons) skeleton.dispose();');
    expect(src).toContain('[ownedGeometries, ownedSkeletons]');
  });
});

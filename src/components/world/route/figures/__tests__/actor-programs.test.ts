import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  ACTOR_PROGRAM_SHARE_DEFAULT,
  adoptSharedPrograms,
  cullStaticParts,
  isPaintedMaterial,
  isTwoPassTransparent,
  isUncoloredUnlit,
  shareFigureSkeletons,
  withWhiteVertexColor,
  type ActorProgramShare,
} from '../actor-programs';
import { CORE_PROBE_PROGRAM_SHARE } from '../core-actor-probe.data';

/**
 * R49 K9 (D26 "+0 programs"): the shared actors re-key their cast figure's
 * materials onto programs the world's figures already compile — a
 * transparent double-sided part draws front faces in one pass, an unlit part
 * without vertex colours gets a white RGBA colour (per-world policy) — on a
 * per-actor clone, never on the GLTF cache's shared material or attributes.
 */

const BOTH: ActorProgramShare = { transparentSingleSided: true, unlitVertexColors: true };

function geometry(count = 6): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  g.setIndex([0, 1, 2, 3, 4, 5]);
  return g;
}

function transparentDoubleSided(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide, name: 'Body' });
  m.map = new THREE.Texture();
  m.userData.paintRole = 'figure';
  return m;
}

describe('the two key-splitting export habits', () => {
  it('two-pass transparency: transparent + DoubleSide + not forceSinglePass', () => {
    expect(isTwoPassTransparent(transparentDoubleSided())).toBe(true);
    expect(isTwoPassTransparent(new THREE.MeshStandardMaterial({ transparent: true }))).toBe(false);
    expect(isTwoPassTransparent(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }))).toBe(false);
    const single = transparentDoubleSided();
    single.forceSinglePass = true;
    expect(isTwoPassTransparent(single)).toBe(false);
  });

  it('an unlit material without vertex colours on a geometry without a colour attribute', () => {
    const g = geometry();
    expect(isUncoloredUnlit(new THREE.MeshBasicMaterial(), g)).toBe(true);
    expect(isUncoloredUnlit(new THREE.MeshBasicMaterial({ vertexColors: true }), g)).toBe(false);
    expect(isUncoloredUnlit(new THREE.MeshStandardMaterial(), g)).toBe(false);
    const colored = geometry();
    colored.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(6 * 4), 4, true));
    expect(isUncoloredUnlit(new THREE.MeshBasicMaterial(), colored)).toBe(false);
  });
});

describe('withWhiteVertexColor', () => {
  it('wraps the SAME attribute and index objects and adds a white RGBA UNSIGNED_BYTE normalized colour', () => {
    const source = geometry(5);
    source.addGroup(0, 3, 0);
    source.boundingSphere = new THREE.Sphere(new THREE.Vector3(1, 2, 3), 4);
    const copy = withWhiteVertexColor(source);
    expect(copy).not.toBe(source);
    expect(copy.getAttribute('position')).toBe(source.getAttribute('position'));
    expect(copy.getAttribute('uv')).toBe(source.getAttribute('uv'));
    expect(copy.index).toBe(source.index);
    expect(copy.groups).toEqual(source.groups);
    expect(copy.boundingSphere?.equals(source.boundingSphere)).toBe(true);
    const color = copy.getAttribute('color') as THREE.BufferAttribute;
    // The exports' COLOR_0 layout (5121 VEC4 normalized): vertexColors + vertexAlphas, a D3D11-native format.
    expect(color.itemSize).toBe(4);
    expect(color.normalized).toBe(true);
    expect(color.array).toBeInstanceOf(Uint8Array);
    expect(color.count).toBe(5);
    expect([...(color.array as Uint8Array)].every((v) => v === 255)).toBe(true);
    // The source is untouched.
    expect(source.getAttribute('color')).toBeUndefined();
  });
});

describe('adoptSharedPrograms', () => {
  it('a transparent double-sided part: a per-actor FrontSide clone, the shared material untouched', () => {
    const shared = transparentDoubleSided();
    const own = () => 'patched';
    shared.customProgramCacheKey = own;
    const root = new THREE.Group();
    const a = new THREE.Mesh(geometry(), shared);
    const b = new THREE.Mesh(geometry(), shared);
    root.add(a, b);
    const adoption = adoptSharedPrograms(root, ACTOR_PROGRAM_SHARE_DEFAULT);
    expect(adoption.singleSided).toEqual(['Body']);
    expect(adoption.vertexColored).toEqual([]);
    const clone = a.material as THREE.MeshStandardMaterial;
    expect(clone).not.toBe(shared);
    // One clone per source material: both meshes keep sharing one material (and one program).
    expect(b.material).toBe(clone);
    expect(clone.side).toBe(THREE.FrontSide);
    expect(clone.transparent).toBe(true);
    expect(isTwoPassTransparent(clone)).toBe(false);
    // The key-relevant state is carried: the same texture object, the paint tag, the own key hook.
    expect(clone.map).toBe(shared.map);
    expect(clone.userData.paintRole).toBe('figure');
    expect(clone.customProgramCacheKey).toBe(own);
    // The GLTF cache's material (world figures may draw it) is never changed.
    expect(shared.side).toBe(THREE.DoubleSide);
    // The geometry is untouched by the side rule.
    expect(adoption.coloredMeshes).toBe(0);
  });

  it('an unlit part without vertex colours: white colour + vertexColors only under the per-world policy', () => {
    const shared = new THREE.MeshBasicMaterial({ name: 'l_eye' });
    const g = geometry();
    const plain = new THREE.Group();
    const m0 = new THREE.Mesh(g, shared);
    plain.add(m0);
    // The default policy leaves it alone (which unlit variant a world compiles is world data).
    expect(adoptSharedPrograms(plain, ACTOR_PROGRAM_SHARE_DEFAULT).vertexColored).toEqual([]);
    expect(m0.material).toBe(shared);
    expect(m0.geometry).toBe(g);

    const root = new THREE.Group();
    const mesh = new THREE.Mesh(g, shared);
    root.add(mesh);
    const adoption = adoptSharedPrograms(root, BOTH);
    expect(adoption.vertexColored).toEqual(['l_eye']);
    expect(adoption.coloredMeshes).toBe(1);
    const clone = mesh.material as THREE.MeshBasicMaterial;
    expect(clone).not.toBe(shared);
    expect(clone.vertexColors).toBe(true);
    expect(shared.vertexColors).toBe(false);
    expect(mesh.geometry).not.toBe(g);
    expect(mesh.geometry.getAttribute('position')).toBe(g.getAttribute('position'));
    expect((mesh.geometry.getAttribute('color') as THREE.BufferAttribute).itemSize).toBe(4);
    expect(g.getAttribute('color')).toBeUndefined();
  });

  it('carries GLTFLoader\'s ad-hoc flatShading flag on an unlit clone (a key bit MeshBasicMaterial.copy drops; R49 dev probe 2)', () => {
    const shared = new THREE.MeshBasicMaterial({ name: 'l_eye' }) as THREE.MeshBasicMaterial & { flatShading?: boolean };
    // GLTFLoader sets it on the material of a mesh without normals.
    shared.flatShading = true;
    expect((shared.clone() as { flatShading?: boolean }).flatShading).toBeUndefined();
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(geometry(), shared);
    root.add(mesh);
    adoptSharedPrograms(root, BOTH);
    expect((mesh.material as { flatShading?: boolean }).flatShading).toBe(true);
    expect((mesh.material as THREE.Material).vertexColors).toBe(true);
  });

  it('leaves the materials that already key like the world alone', () => {
    const root = new THREE.Group();
    const opaque = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    const blendSingle = new THREE.MeshStandardMaterial({ transparent: true });
    const colored = geometry();
    colored.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(6 * 4), 4, true));
    const unlitColored = new THREE.MeshBasicMaterial({ vertexColors: true });
    const meshes = [new THREE.Mesh(geometry(), opaque), new THREE.Mesh(geometry(), blendSingle), new THREE.Mesh(colored, unlitColored)];
    root.add(...meshes);
    const adoption = adoptSharedPrograms(root, BOTH);
    expect(adoption.singleSided).toEqual([]);
    expect(adoption.vertexColored).toEqual([]);
    expect(meshes.map((m) => m.material)).toEqual([opaque, blendSingle, unlitColored]);
  });

  it('leaves a painted material shared (no clone carrying a paint hook paint-sweep would paint again)', () => {
    const root = new THREE.Group();
    const painted = transparentDoubleSided();
    painted.userData.paintScope = 'plaza';
    painted.onBeforeCompile = () => undefined;
    const unlit = new THREE.MeshBasicMaterial();
    unlit.userData.paintScope = 'plaza';
    const meshes = [new THREE.Mesh(geometry(), painted), new THREE.Mesh(geometry(), unlit)];
    root.add(...meshes);
    const adoption = adoptSharedPrograms(root, BOTH);
    expect(isPaintedMaterial(painted)).toBe(true);
    expect(adoption.singleSided).toEqual([]);
    expect(adoption.vertexColored).toEqual([]);
    expect(adoption.coloredMeshes).toBe(0);
    expect(meshes.map((m) => m.material)).toEqual([painted, unlit]);
    expect(painted.side).toBe(THREE.DoubleSide);
  });

  it('a material array: each member adopted, the geometry coloured once', () => {
    const root = new THREE.Group();
    const g = geometry();
    const unlit = new THREE.MeshBasicMaterial({ name: 'body_a' });
    const blend = transparentDoubleSided();
    const mesh = new THREE.Mesh(g, [unlit, blend]);
    root.add(mesh);
    const adoption = adoptSharedPrograms(root, BOTH);
    const [m0, m1] = mesh.material as THREE.Material[];
    expect(m0.vertexColors).toBe(true);
    expect(m1.side).toBe(THREE.FrontSide);
    expect(adoption.coloredMeshes).toBe(1);
  });

  it('is idempotent per mesh (every commit may run it) and restore puts the originals back without freeing shared buffers', () => {
    const shared = new THREE.MeshBasicMaterial({ name: 'body_b' });
    const blend = transparentDoubleSided();
    const g = geometry();
    let sharedGeometryDisposed = 0;
    g.addEventListener('dispose', () => {
      sharedGeometryDisposed += 1;
    });
    const root = new THREE.Group();
    const unlitMesh = new THREE.Mesh(g, shared);
    const blendMesh = new THREE.Mesh(geometry(), blend);
    root.add(unlitMesh, blendMesh);
    const seen = new WeakSet<THREE.Object3D>();
    const first = adoptSharedPrograms(root, BOTH, seen);
    const wrapper = unlitMesh.geometry;
    const clone = unlitMesh.material as THREE.Material;
    let cloneDisposed = 0;
    clone.addEventListener('dispose', () => {
      cloneDisposed += 1;
    });
    const again = adoptSharedPrograms(root, BOTH, seen);
    expect(again.vertexColored).toEqual([]);
    expect(again.singleSided).toEqual([]);
    expect(unlitMesh.material).toBe(clone);
    first.restore();
    expect(unlitMesh.material).toBe(shared);
    expect(unlitMesh.geometry).toBe(g);
    expect(blendMesh.material).toBe(blend);
    expect(cloneDisposed).toBe(1);
    // The wrapper let go of the shared attributes before its dispose: only its colour buffer is freed.
    expect(Object.keys(wrapper.attributes)).toEqual(['color']);
    expect(wrapper.index).toBeNull();
    expect(sharedGeometryDisposed).toBe(0);
    expect(g.getAttribute('position')).toBeDefined();
    // Restored meshes may be adopted again (a StrictMode remount).
    expect(adoptSharedPrograms(root, BOTH, seen).vertexColored).toEqual(['body_b']);
  });

  it('the probe policy for sakura: both rules on (the world compiles the vertex-colour unlit program)', () => {
    expect(CORE_PROBE_PROGRAM_SHARE).toEqual({ transparentSingleSided: true, unlitVertexColors: true });
    expect(ACTOR_PROGRAM_SHARE_DEFAULT).toEqual({ transparentSingleSided: true, unlitVertexColors: false });
  });
});

describe('shareFigureSkeletons (R49 K9 busy: one skeleton update and one bone-texture upload per bone set)', () => {
  function skinnedFigure(parts: number): { root: THREE.Group; meshes: THREE.SkinnedMesh[] } {
    const root = new THREE.Group();
    const hip = new THREE.Bone();
    const knee = new THREE.Bone();
    knee.position.set(0, -0.5, 0);
    hip.add(knee);
    root.add(hip);
    // GLTFLoader: ONE Skeleton per skin, bound by every primitive of the node.
    const skeleton = new THREE.Skeleton([hip, knee]);
    const meshes: THREE.SkinnedMesh[] = [];
    for (let i = 0; i < parts; i += 1) {
      const g = geometry();
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Float32Array(6 * 4), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(6 * 4).fill(0.25), 4));
      const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
      root.add(mesh);
      mesh.bind(skeleton);
      meshes.push(mesh);
    }
    return { root, meshes };
  }

  it('SkeletonUtils.clone gives every part its own skeleton; sharing binds them back to one, exactly', () => {
    const source = skinnedFigure(3);
    const clone = cloneSkeleton(source.root);
    const parts: THREE.SkinnedMesh[] = [];
    clone.traverse((n) => {
      if ((n as THREE.SkinnedMesh).isSkinnedMesh) parts.push(n as THREE.SkinnedMesh);
    });
    // The clone's per-part skeletons (the cost R49 measured): three distinct ones over the same bones.
    expect(new Set(parts.map((m) => m.skeleton)).size).toBe(3);
    const bindMatrices = parts.map((m) => m.bindMatrix.clone());
    const sharing = shareFigureSkeletons(clone);
    expect(sharing.skinnedMeshes).toBe(3);
    expect(sharing.skeletons).toBe(1);
    expect(new Set(parts.map((m) => m.skeleton)).size).toBe(1);
    // Same bone objects, same inverses, each part's own bind matrix: identical skinning inputs.
    expect(parts[0].skeleton.bones).toEqual(parts[1].skeleton.bones);
    parts.forEach((m, i) => expect(m.bindMatrix.equals(bindMatrices[i])).toBe(true));
    sharing.restore();
    expect(new Set(parts.map((m) => m.skeleton)).size).toBe(3);
  });

  it('never shares across different bone sets or different inverse binds; idempotent', () => {
    const a = skinnedFigure(1);
    const b = skinnedFigure(1);
    const root = new THREE.Group();
    root.add(a.root, b.root);
    // Another bone hierarchy: kept apart.
    expect(shareFigureSkeletons(root).skeletons).toBe(2);
    // Same bones, a different inverse bind: kept apart.
    const c = skinnedFigure(2);
    const [m0, m1] = c.meshes;
    const inverses = m0.skeleton.boneInverses.map((m) => m.clone());
    inverses[1].makeTranslation(0, 1, 0);
    m1.bind(new THREE.Skeleton(m0.skeleton.bones, inverses), m1.bindMatrix);
    expect(shareFigureSkeletons(c.root).skeletons).toBe(2);
    // Equal inverses under separate Skeleton objects: shared, and a second pass changes nothing.
    const d = skinnedFigure(2);
    d.meshes[1].bind(new THREE.Skeleton(d.meshes[0].skeleton.bones, d.meshes[0].skeleton.boneInverses.map((m) => m.clone())), d.meshes[1].bindMatrix);
    const seen = new WeakSet<THREE.Object3D>();
    expect(shareFigureSkeletons(d.root, seen).skeletons).toBe(1);
    const again = shareFigureSkeletons(d.root, seen);
    expect(again.skeletons).toBe(1);
    again.restore();
    expect(d.meshes[1].skeleton).toBe(d.meshes[0].skeleton);
  });

  it('D42 N2: on a figure Figure already shared, the actor pass changes nothing and its restore keeps the sharing', () => {
    const source = skinnedFigure(3);
    const clone = cloneSkeleton(source.root);
    // Figure's clone memo (N2): one fresh WeakSet per clone.
    const figurePass = shareFigureSkeletons(clone, new WeakSet());
    expect(figurePass.changed).toBe(2);
    expect(figurePass.skeletons).toBe(1);
    // The actor's layout pass (useActorProgramShare) over the same subtree, with its own ledger.
    const actorPass = shareFigureSkeletons(clone, new WeakSet());
    expect(actorPass.changed).toBe(0);
    expect(actorPass.skeletons).toBe(1);
    actorPass.restore();
    const parts: THREE.SkinnedMesh[] = [];
    clone.traverse((n) => {
      if ((n as THREE.SkinnedMesh).isSkinnedMesh) parts.push(n as THREE.SkinnedMesh);
    });
    expect(new Set(parts.map((m) => m.skeleton)).size).toBe(1);
  });
});

describe('cullStaticParts (R49 K9: a clip-less figure part off screen costs nothing)', () => {
  it('re-enables per-object culling only for parts with a stored rest sphere; restore turns it off again', () => {
    const root = new THREE.Group();
    const withSphere = new THREE.SkinnedMesh(geometry(), new THREE.MeshStandardMaterial());
    withSphere.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 0.6);
    const noSphere = new THREE.SkinnedMesh(geometry(), new THREE.MeshStandardMaterial());
    (noSphere as unknown as { boundingSphere: THREE.Sphere | null }).boundingSphere = null;
    const plain = new THREE.Mesh(geometry(), new THREE.MeshStandardMaterial());
    plain.geometry.computeBoundingSphere();
    for (const m of [withSphere, noSphere, plain]) {
      m.frustumCulled = false;
      root.add(m);
    }
    const seen = new WeakSet<THREE.Object3D>();
    const culled = cullStaticParts(root, seen);
    expect(culled.parts).toBe(2);
    expect(withSphere.frustumCulled).toBe(true);
    expect(noSphere.frustumCulled).toBe(false);
    expect(plain.frustumCulled).toBe(true);
    // Idempotent: a later commit changes nothing.
    expect(cullStaticParts(root, seen).parts).toBe(0);
    culled.restore();
    expect(withSphere.frustumCulled).toBe(false);
    expect(plain.frustumCulled).toBe(false);
  });

  it('three culls a skinned part by that stored sphere in world space (the off-screen part is skipped)', () => {
    const mesh = new THREE.SkinnedMesh(geometry(), new THREE.MeshStandardMaterial());
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 0.6);
    mesh.frustumCulled = true;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 1, 5);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    mesh.updateMatrixWorld();
    expect(frustum.intersectsObject(mesh)).toBe(true);
    mesh.position.set(30, 0, 0);
    mesh.updateMatrixWorld();
    expect(frustum.intersectsObject(mesh)).toBe(false);
  });
});

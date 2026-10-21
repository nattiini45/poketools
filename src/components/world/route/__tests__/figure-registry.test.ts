import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  figureRegistryVersion,
  findFigure,
  listActors,
  listFigures,
  moduleFigureSource,
  registerActor,
  registerFigure,
} from '../figures/figure-registry';
import { clampFigureMetal, meshBounds, METAL_CLAMP } from '../figures/Figure';
import { advanceFigureMixer } from '@/lib/route-world/residency';

describe('figure-registry', () => {
  it('registers, lists in order and unregisters exactly its own entry', () => {
    const before = listFigures().length;
    const a = registerFigure({ id: 'figure-a', object: { current: new THREE.Group() } });
    const b = registerFigure({ id: 'figure-a', object: { current: new THREE.Group() }, role: 'walker' });
    expect(listFigures().slice(before).map((row) => row.role ?? null)).toEqual([null, 'walker']);
    expect(findFigure('figure-a')?.role).toBe('walker');
    a();
    expect(listFigures().slice(before)).toHaveLength(1);
    expect(listFigures()[before].role).toBe('walker');
    b();
    expect(listFigures()).toHaveLength(before);
    expect(findFigure('figure-a')).toBeNull();
  });

  it('R15: lists figures and actors by id whatever order they registered in (GLB resolution order varies per load)', () => {
    const ids = ['zz-r15-c', 'zz-r15-a', 'zz-r15-b'];
    const orders = [ids, [...ids].reverse(), [ids[1], ids[2], ids[0]]];
    const seen: string[][] = [];
    for (const order of orders) {
      const releases = order.flatMap((id) => [
        registerFigure({ id, object: { current: new THREE.Group() } }),
        registerActor({ id, kind: 'probe', object: { current: null }, step: () => {} }),
      ]);
      const figures = listFigures().map((row) => row.id).filter((id) => id.startsWith('zz-r15-'));
      const actors = listActors().map((row) => row.id).filter((id) => id.startsWith('zz-r15-'));
      expect(actors).toEqual(figures);
      seen.push(figures);
      for (const release of releases) release();
    }
    expect(seen).toEqual([
      ['zz-r15-a', 'zz-r15-b', 'zz-r15-c'],
      ['zz-r15-a', 'zz-r15-b', 'zz-r15-c'],
      ['zz-r15-a', 'zz-r15-b', 'zz-r15-c'],
    ]);
  });

  it('bumps the version on change only, and double unregister is a no-op', () => {
    const v0 = figureRegistryVersion();
    const off = registerFigure({ id: 'x', object: { current: null } });
    expect(figureRegistryVersion()).toBe(v0 + 1);
    off();
    expect(figureRegistryVersion()).toBe(v0 + 2);
    off();
    expect(figureRegistryVersion()).toBe(v0 + 2);
  });

  it('serves the same list until the registry changes (no per-frame copy), and a new one after', () => {
    const first = listFigures();
    expect(listFigures()).toBe(first);
    const actors = listActors();
    expect(listActors()).toBe(actors);
    const off = registerFigure({ id: 'cached', object: { current: null } });
    const second = listFigures();
    expect(second).not.toBe(first);
    expect(second.map((row) => row.id)).toContain('cached');
    expect(first.map((row) => row.id)).not.toContain('cached');
    off();
    expect(listFigures().map((row) => row.id)).not.toContain('cached');
  });

  it('keeps live getters, not copies', () => {
    let state = 'loiter';
    const off = registerFigure({ id: 'live', object: { current: null }, getState: () => state });
    const row = listFigures().find((entry) => entry.id === 'live')!;
    state = 'attack';
    expect(row.getState?.()).toBe('attack');
    off();
  });

  it('lists actors beside figures and serves both as the director source', () => {
    const v0 = moduleFigureSource.version();
    const off = registerActor({ id: 'sakura-prop-resident-a', kind: 'resident', object: { current: null }, step: () => {} });
    expect(moduleFigureSource.version()).toBe(v0 + 1);
    expect(moduleFigureSource.actors().map((a) => a.id)).toContain('sakura-prop-resident-a');
    expect(listActors()).toHaveLength(moduleFigureSource.actors().length);
    off();
    expect(moduleFigureSource.actors().map((a) => a.id)).not.toContain('sakura-prop-resident-a');
  });
});

describe('figure frame step (D23 dormancy, C9 clamp)', () => {
  function mixerWithClip(): { mixer: THREE.AnimationMixer; action: THREE.AnimationAction } {
    const root = new THREE.Object3D();
    root.name = 'root';
    const track = new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]);
    const clip = new THREE.AnimationClip('idle', 1, [track]);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    return { mixer, action };
  }

  it('a dormant mixer does not advance', () => {
    const { mixer, action } = mixerWithClip();
    advanceFigureMixer(mixer, 0.08, false);
    const awakeTime = action.time;
    expect(awakeTime).toBeCloseTo(0.08);
    for (let i = 0; i < 10; i += 1) advanceFigureMixer(mixer, 0.08, true);
    expect(action.time).toBe(awakeTime);
    expect(mixer.time).toBeCloseTo(0.08);
  });

  it('resumes from where it froze when it wakes', () => {
    const { mixer, action } = mixerWithClip();
    advanceFigureMixer(mixer, 0.1, true);
    advanceFigureMixer(mixer, 0.1, false);
    expect(action.time).toBeCloseTo(0.1);
  });

  it('a hitch frame advances the mixer by 0.1 s at most', () => {
    const { mixer, action } = mixerWithClip();
    advanceFigureMixer(mixer, 0.6, false);
    expect(action.time).toBeCloseTo(0.1);
  });
});

describe('the metal clamp (C14)', () => {
  it('clamps metallic materials by their own values, idempotently, uniforms only', () => {
    const chrome = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.05, envMapIntensity: 1 });
    const keyBefore = chrome.customProgramCacheKey();
    const version = chrome.version;
    const defines = JSON.stringify(chrome.defines ?? null);
    clampFigureMetal(chrome);
    expect(chrome.envMapIntensity).toBe(METAL_CLAMP.envMapIntensityMax);
    expect(chrome.roughness).toBe(METAL_CLAMP.roughnessMin);
    clampFigureMetal(chrome);
    expect([chrome.envMapIntensity, chrome.roughness]).toEqual([0.55, 0.28]);
    // No define, no program key, no needsUpdate.
    expect(chrome.customProgramCacheKey()).toBe(keyBefore);
    expect(chrome.version).toBe(version);
    expect(JSON.stringify(chrome.defines ?? null)).toBe(defines);
  });

  it('leaves non-metallic, already-matte and non-standard materials alone', () => {
    const cloth = new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.1, envMapIntensity: 1 });
    clampFigureMetal(cloth);
    expect([cloth.envMapIntensity, cloth.roughness]).toEqual([1, 0.1]);
    const dullMetal = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.6, envMapIntensity: 0.3 });
    clampFigureMetal(dullMetal);
    expect([dullMetal.envMapIntensity, dullMetal.roughness]).toEqual([0.3, 0.6]);
    const basic = new THREE.MeshBasicMaterial();
    expect(() => clampFigureMetal(basic)).not.toThrow();
  });
});

describe('meshBounds seats the skinned sort sphere (R15)', () => {
  function skinnedFigure() {
    const root = new THREE.Group();
    const bone = new THREE.Bone();
    const geometry = new THREE.BoxGeometry(1, 2, 1, 2, 3, 2);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(count).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ transparent: true }));
    mesh.position.set(0.3, 1, 0);
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    root.add(mesh);
    return { root, mesh, bone };
  }

  it("fills three's own sphere at the rest pose, in the box pass, and three never recomputes it", () => {
    const { root, mesh, bone } = skinnedFigure();
    const box = meshBounds(root);
    expect(box.isEmpty()).toBe(false);
    expect(mesh.boundingSphere).not.toBeNull();
    const seated = mesh.boundingSphere!.clone();
    // Exactly what three computes lazily at this pose.
    const reference = skinnedFigure();
    reference.root.updateMatrixWorld(true);
    reference.mesh.computeBoundingSphere();
    expect(seated.center.toArray()).toEqual(reference.mesh.boundingSphere!.center.toArray());
    expect(seated.radius).toBe(reference.mesh.boundingSphere!.radius);
    // And the box is three's too.
    reference.mesh.computeBoundingBox();
    expect(mesh.boundingBox!.min.toArray()).toEqual(reference.mesh.boundingBox!.min.toArray());
    expect(mesh.boundingBox!.max.toArray()).toEqual(reference.mesh.boundingBox!.max.toArray());
    // A later pose never moves the sort key (three only computes a null sphere).
    bone.position.set(0, 5, 0);
    root.updateMatrixWorld(true);
    expect(mesh.boundingSphere!.center.toArray()).toEqual(seated.center.toArray());
  });
});

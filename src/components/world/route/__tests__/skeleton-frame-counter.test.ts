import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import { shareCloneSkeletons } from '../figures/Figure';
import { canvasModules } from './route-sources';

/**
 * three updates each skeleton once per `renderer.info.render.frame`
 * (`WebGLObjects.update`). The debug TelemetrySampler zeroed that counter
 * every tick, so under `routeDebug=1` a skinned part that casts no shadow —
 * the eyes and mouths C-048's shadow trim drops from the shadow pass — never
 * refreshed its bones: Dragonite's eyes and Vaporeon's face stood frozen in
 * their first pose while the body walked on (31 of 83 sakura skeletons).
 */

const ROUTE = join(__dirname, '..');

/** Source with comments stripped, so prose about the counter never matches. */
function code(file: string): string {
  return readFileSync(join(ROUTE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('renderer frame counter', () => {
  it('is never written by the route canvas', () => {
    const source = canvasModules().map(code).join('\n');
    expect(source).not.toMatch(/\.frame\s*=(?!=)/);
    expect(source).not.toMatch(/render\.frame\s*(\+\+|--|[+-]=)/);
  });
});

/**
 * D42 N2: with the clone's skinned parts bound to ONE skeleton, three's
 * once-per-frame skeleton update (`WebGLObjects.update`, keyed on
 * `info.render.frame`) runs once per figure per frame, and a part that
 * casts no shadow (the trimmed eyes) still sees fresh bones whichever pass
 * drew the body first.
 */
describe("a shared skeleton under three's per-frame update (D42 N2)", () => {
  function figureClone(): { clone: THREE.Object3D; body: THREE.SkinnedMesh; eyes: THREE.SkinnedMesh; knee: THREE.Bone } {
    const root = new THREE.Group();
    const hip = new THREE.Bone();
    const knee = new THREE.Bone();
    knee.position.set(0, -0.5, 0);
    hip.add(knee);
    root.add(hip);
    const skeleton = new THREE.Skeleton([hip, knee]);
    const material = new THREE.MeshStandardMaterial();
    for (const name of ['body', 'eyes']) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Float32Array(12), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(12).fill(0.25), 4));
      const mesh = new THREE.SkinnedMesh(g, material);
      mesh.name = name;
      root.add(mesh);
      mesh.bind(skeleton);
    }
    const clone = cloneSkeleton(root);
    const body = clone.getObjectByName('body') as THREE.SkinnedMesh;
    const eyes = clone.getObjectByName('eyes') as THREE.SkinnedMesh;
    const kneeClone = body.skeleton.bones[1];
    return { clone, body, eyes, knee: kneeClone };
  }

  function objects(info: { render: { frame: number } }) {
    const geometries = { get: (_object: unknown, geometry: unknown) => geometry, update: () => {} };
    return new WebGLObjects({} as never, geometries as never, {} as never, {} as never, info as never);
  }

  it('one skeleton update per frame for the whole figure; the non-casting part sees the bones of this frame', () => {
    const { clone, body, eyes, knee } = figureClone();
    expect(shareCloneSkeletons(clone)).toHaveLength(1);
    expect(eyes.skeleton).toBe(body.skeleton);
    let updates = 0;
    const update = body.skeleton.update.bind(body.skeleton);
    body.skeleton.update = () => {
      updates += 1;
      update();
    };
    const info = { render: { frame: 0 } };
    const list = objects(info);
    for (let frame = 1; frame <= 5; frame += 1) {
      info.render.frame = frame;
      knee.rotation.z = frame * 0.1;
      clone.updateMatrixWorld(true);
      list.update(body); // the shadow pass draws the caster first
      list.update(eyes); // the main pass draws both
      list.update(body);
      // The knee's matrix of THIS frame is in the shared bone matrices the eyes sample.
      const expected = new THREE.Matrix4().multiplyMatrices(knee.matrixWorld, body.skeleton.boneInverses[1]);
      expect(Array.from(eyes.skeleton.boneMatrices!.slice(16, 32))).toEqual(Array.from(new Float32Array(expected.elements)));
    }
    expect(updates).toBe(5);
  });

  it('(control) the unshared clone pays one update per part per frame', () => {
    const { body, eyes } = figureClone();
    expect(eyes.skeleton).not.toBe(body.skeleton);
    let updates = 0;
    for (const mesh of [body, eyes]) {
      const update = mesh.skeleton.update.bind(mesh.skeleton);
      mesh.skeleton.update = () => {
        updates += 1;
        update();
      };
    }
    const info = { render: { frame: 0 } };
    const list = objects(info);
    for (let frame = 1; frame <= 5; frame += 1) {
      info.render.frame = frame;
      list.update(body);
      list.update(eyes);
    }
    expect(updates).toBe(10);
  });
});

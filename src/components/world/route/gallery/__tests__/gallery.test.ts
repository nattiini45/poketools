import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { FigureEntry, WorldManifest } from '@/lib/route-world/model-manifest';
import { createGalleryApi, GALLERY_SETTLE_FRAMES, parseGalleryPose, type GalleryBridgeDeps, type GalleryFigureFacts, type GalleryPose } from '../gallery-bridge';
import { boundsSphere, galleryCameraPose, GALLERY_FOV_DEG, orbitDirection } from '../gallery-camera';
import { galleryFigureEntry, parseGalleryFile } from '../gallery-file';
import { galleryTheme } from '../gallery-theme';

/**
 * D42 commit G: the gallery world's pure parts — the file parse, the entry
 * it mounts, the camera framing and the `window.__routeGallery` contract
 * (driven with fakes; the live scene supplies the real dependencies).
 */

describe('gallery file', () => {
  it('accepts a .glb path under the asset base only', () => {
    expect(parseGalleryFile('models/regular/907.glb')).toBe('models/regular/907.glb');
    expect(parseGalleryFile('props/statue-plinth.glb')).toBe('props/statue-plinth.glb');
    expect(parseGalleryFile(' models/hisuian/503.glb ')).toBe('models/hisuian/503.glb');
    for (const bad of [null, undefined, '', '/models/regular/907.glb', '../secret.glb', 'models/../x.glb', 'https://x/y.glb', 'models/regular/907.gltf', 'models\\regular\\907.glb', 'models//907.glb']) {
      expect(parseGalleryFile(bad)).toBeNull();
    }
  });

  const manifest = {
    version: 3,
    generatedAt: '',
    figures: [{ file: 'models/regular/1.glb', heightm: 0.7, bounds: { min: [0, 0, 0], max: [1, 2, 1] }, clips: ['idle'], triangles: 10, kb: 5 } as unknown as FigureEntry],
    props: [{ name: 'p', file: 'props/p.glb', kb: 9, triangles: 30, bounds: { min: [-1, 0, -1], max: [1, 3, 1] } }],
    environment: [],
    missingForms: [],
    pool: null,
  } as WorldManifest;

  it('mounts the manifest row by file, a prop as a height-less row, anything else as a bare row', () => {
    expect(galleryFigureEntry(manifest, 'models/regular/1.glb')).toBe(manifest.figures[0]);
    const prop = galleryFigureEntry(manifest, 'props/p.glb');
    expect(prop).toMatchObject({ file: 'props/p.glb', heightm: null, bounds: manifest.props[0].bounds, triangles: 30, clips: [] });
    const bare = galleryFigureEntry(manifest, 'models/regular/999.glb');
    expect(bare).toMatchObject({ file: 'models/regular/999.glb', heightm: null, clips: [] });
  });

  it('the gallery theme backdrop is the token surface (a theme token, light and dark)', () => {
    const core = { surface: '#101418' } as never;
    expect(galleryTheme.paletteExtension(core, true).sky).toBe('#101418');
    expect(galleryTheme.stations).toHaveLength(1);
  });

  it('names no species (D18: file paths only)', () => {
    for (const name of ['gallery-file.ts', 'gallery-bridge.ts', 'gallery-camera.ts', 'gallery-theme.ts', 'GalleryScene.tsx', 'GalleryWorld.tsx']) {
      const source = readFileSync(join(__dirname, '..', name), 'utf8');
      expect(source, name).not.toMatch(/species:\s*'[A-Za-z]/);
    }
  });
});

describe('gallery camera', () => {
  const bounds = { min: [-0.5, 0, -0.4] as [number, number, number], max: [0.5, 1.8, 0.4] as [number, number, number] };

  /** The sphere's projected diameter in px, through a real three camera at the pose. */
  function projectedDiameterPx(viewportH: number, sizePx: number, azimuthDeg: number, elevationDeg: number): number {
    const pose = galleryCameraPose(bounds, { azimuthDeg, elevationDeg, sizePx }, viewportH);
    const camera = new THREE.PerspectiveCamera(pose.fov, 1, pose.near, pose.far);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld(true);
    const { center, radius } = boundsSphere(bounds);
    const toCam = new THREE.Vector3(...pose.position).sub(new THREE.Vector3(...center));
    const d = toCam.length();
    // The silhouette's top tangent point, in the vertical plane through the view axis.
    const alpha = Math.asin(radius / d);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const dir = toCam.clone().normalize().negate();
    const tangent = dir.clone().applyAxisAngle(new THREE.Vector3().crossVectors(dir, up).normalize(), alpha);
    const point = new THREE.Vector3(...pose.position).add(tangent.multiplyScalar(d));
    const ndc = point.project(camera);
    return Math.abs(ndc.y) * viewportH;
  }

  it('frames the bounds sphere at exactly sizePx (800 and 250 px), from any azimuth and elevation', () => {
    for (const sizePx of [800, 250]) {
      for (const [az, el] of [
        [0, 0],
        [45, 10],
        [105, -10],
        [0, 90],
      ]) {
        expect(projectedDiameterPx(900, sizePx, az, el)).toBeCloseTo(sizePx, 1);
      }
    }
  });

  it('looks at the sphere centre; azimuth 0 stands on +Z, 90 on +X; elevation is clamped off the pole', () => {
    const front = galleryCameraPose(bounds, { azimuthDeg: 0, elevationDeg: 0, sizePx: 800 }, 900);
    expect(front.target).toEqual(boundsSphere(bounds).center);
    expect(front.position[2]).toBeGreaterThan(front.target[2]);
    expect(Math.abs(front.position[0])).toBeLessThan(1e-9);
    const side = orbitDirection(90, 0);
    expect(side[0]).toBeCloseTo(1, 9);
    const top = orbitDirection(0, 90);
    expect(top[1]).toBeLessThan(1);
    expect(top[2]).toBeGreaterThan(0);
    expect(front.fov).toBe(GALLERY_FOV_DEG);
    expect(front.near).toBeGreaterThan(0);
    expect(front.far).toBeGreaterThan(front.near);
  });

  it('the inside-out view stands at the centre and looks out along the orbit direction', () => {
    const pose = galleryCameraPose(bounds, { azimuthDeg: 30, elevationDeg: 0, sizePx: 800, inside: true }, 900);
    const { center } = boundsSphere(bounds);
    expect(pose.position).toEqual(center);
    const look = new THREE.Vector3(...pose.target).sub(new THREE.Vector3(...center)).normalize();
    const dir = orbitDirection(30, 0);
    expect(look.dot(new THREE.Vector3(...dir))).toBeCloseTo(1, 9);
    expect(pose.near).toBeLessThan(0.01);
  });
});

describe('window.__routeGallery contract', () => {
  const facts: GalleryFigureFacts = {
    triangles: 192,
    meshes: 1,
    bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    fittedBounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    clips: ['idle'],
  };
  const pose: GalleryPose = { azimuthDeg: 15, elevationDeg: 0, clipT01: 1 / 3, look: 'raw', sizePx: 250 };

  function harness(overrides: Partial<GalleryBridgeDeps> = {}) {
    let frames = 0;
    let look: string = 'world';
    const queue: (() => void)[] = [];
    const deps: GalleryBridgeDeps = {
      file: 'models/regular/907.glb',
      arm: () => 'd42',
      figure: () => facts,
      failed: () => null,
      worldReady: () => true,
      apply: vi.fn((p: GalleryPose) => {
        look = p.look;
      }),
      settled: (p) => look === p.look,
      renderedFrames: () => frames,
      schedule: (cb) => queue.push(cb),
      now: () => frames * 16,
      ...overrides,
    };
    const api = createGalleryApi(deps);
    /** One rendered frame: the frame counter advances, then the scheduled callbacks run. */
    const frame = () => {
      frames += 1;
      const due = queue.splice(0);
      for (const cb of due) cb();
    };
    return { api, deps, frame };
  }

  it('info() reports the frozen fields (plus fittedBounds and arm)', () => {
    const { api } = harness();
    expect(api.info()).toEqual({
      file: 'models/regular/907.glb',
      triangles: 192,
      meshes: 1,
      bounds: facts.bounds,
      clips: ['idle'],
      failed: null,
      fittedBounds: facts.fittedBounds,
      arm: 'd42',
    });
  });

  it('ready() needs the mounted figure and the revealed world; a failure is ready (fail fast)', () => {
    expect(harness({ figure: () => null }).api.ready()).toBe(false);
    expect(harness({ worldReady: () => false }).api.ready()).toBe(false);
    expect(harness().api.ready()).toBe(true);
    const failed = harness({ figure: () => null, failed: () => 'setMeshoptDecoder must be called' });
    expect(failed.api.ready()).toBe(true);
    expect(failed.api.info().failed).toMatch(/setMeshoptDecoder/);
  });

  it('set() applies the pose, then resolves only after frames have rendered with it', async () => {
    const { api, deps, frame } = harness();
    let resolved = false;
    const done = api.set(pose).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.apply).toHaveBeenCalledWith(pose);
    for (let i = 0; i < GALLERY_SETTLE_FRAMES; i += 1) {
      frame();
      await Promise.resolve();
      expect(resolved).toBe(false);
    }
    frame();
    await done;
    expect(resolved).toBe(true);
  });

  it('set() waits while the frame is not settled (look not mounted, a compile hold)', async () => {
    let settled = false;
    const { api, frame } = harness({ settled: () => settled });
    let resolved = false;
    const done = api.set(pose).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    for (let i = 0; i < 6; i += 1) frame();
    await Promise.resolve();
    expect(resolved).toBe(false);
    settled = true;
    for (let i = 0; i <= GALLERY_SETTLE_FRAMES + 1; i += 1) frame();
    await done;
    expect(resolved).toBe(true);
  });

  it('set() rejects an invalid pose, a failed figure, an unmounted figure, and a timeout', async () => {
    const { api } = harness();
    await expect(api.set({ ...pose, clipT01: 2 })).rejects.toThrow(/clipT01/);
    await expect(api.set({ ...pose, look: 'post' as never })).rejects.toThrow(/look/);
    await expect(harness({ failed: () => 'boom' }).api.set(pose)).rejects.toThrow(/boom/);
    await expect(harness({ figure: () => null }).api.set(pose)).rejects.toThrow(/not mounted/);
    const slow = harness({ settled: () => false, timeoutMs: 50 });
    const pending = slow.api.set(pose);
    await Promise.resolve();
    await Promise.resolve();
    for (let i = 0; i < 10; i += 1) slow.frame();
    await expect(pending).rejects.toThrow(/no settled frame/);
  });

  it('parses the pose fields strictly', () => {
    expect(parseGalleryPose({ ...pose, inside: true })).toEqual({ ...pose, inside: true });
    expect(parseGalleryPose({ ...pose, sizePx: 0 })).toMatch(/sizePx/);
    expect(parseGalleryPose({ ...pose, azimuthDeg: Number.NaN })).toMatch(/azimuthDeg/);
    expect(parseGalleryPose({ ...pose, inside: 'yes' })).toMatch(/inside/);
    expect(parseGalleryPose(null)).toMatch(/object/);
  });
});

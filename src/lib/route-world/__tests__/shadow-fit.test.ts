import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  centroidAt,
  fitStationShadow,
  lightBasis,
  snapToTexel,
  stationReceiverCentroids,
} from '../shadow-fit';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { MAX_PULLBACK } from '../camera-path';
import type { Vec3 } from '../chapters';

const KEY = plazaTheme.lights.keyDirection;
const RIG = { box: PLAZA_PAINT.shadow.box, mapSize: PLAZA_PAINT.shadow.mapSize };
const TEXEL = RIG.box / RIG.mapSize;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe('shadow-fit', () => {
  it('the plaza rig is 1024 texels over 32 m (≈3.1 cm per texel)', () => {
    expect(RIG).toEqual({ box: 32, mapSize: 1024 });
    expect(TEXEL).toBeCloseTo(0.03125, 6);
  });

  it('light basis matches three lookAt for a light on the key direction', () => {
    const basis = lightBasis(KEY);
    const light = new THREE.Object3D();
    light.position.set(KEY[0], KEY[1], KEY[2]);
    light.lookAt(0, 0, 0);
    // A camera (lookAt aims −Z) — the DirectionalLightShadow camera convention.
    const camera = new THREE.OrthographicCamera();
    camera.position.copy(light.position);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    expect(basis.right[0]).toBeCloseTo(e[0], 6);
    expect(basis.right[1]).toBeCloseTo(e[1], 6);
    expect(basis.right[2]).toBeCloseTo(e[2], 6);
    expect(basis.up[0]).toBeCloseTo(e[4], 6);
    expect(basis.up[1]).toBeCloseTo(e[5], 6);
    expect(basis.up[2]).toBeCloseTo(e[6], 6);
    expect(basis.forward[0]).toBeCloseTo(-e[8], 6);
    expect(basis.forward[2]).toBeCloseTo(-e[10], 6);
  });

  it('snaps the centre to whole texels on the light right/up axes and leaves depth free', () => {
    const basis = lightBasis(KEY);
    for (const p of [
      [0.013, 0, -7.777],
      [-3.1, 0.2, 5.55],
      [12.34567, 0, 0.001],
    ] as Vec3[]) {
      const s = snapToTexel(p, basis, TEXEL);
      const r = dot(s, basis.right) / TEXEL;
      const u = dot(s, basis.up) / TEXEL;
      expect(Math.abs(r - Math.round(r))).toBeLessThan(1e-6);
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-6);
      expect(dot(s, basis.forward)).toBeCloseTo(dot(p, basis.forward), 9);
      // Never moves more than half a texel diagonal.
      expect(Math.hypot(s[0] - p[0], s[1] - p[1], s[2] - p[2])).toBeLessThanOrEqual(TEXEL * Math.SQRT1_2 + 1e-9);
    }
  });

  it('never resizes: the half-extent and texel are constant over the whole route', () => {
    const basis = lightBasis(KEY);
    for (const mobile of [false, true]) {
      const centroids = stationReceiverCentroids(plazaTheme.stations, mobile, mobile ? MAX_PULLBACK : 0);
      for (let position = -0.5; position <= 4.5; position += 0.125) {
        const fit = fitStationShadow(centroids, position, basis, RIG);
        expect(fit.halfExtent).toBe(16);
        expect(fit.texel).toBeCloseTo(TEXEL, 12);
      }
    }
  });

  it('lerps the centroid between stations and clamps outside the route', () => {
    const centroids: Vec3[] = [
      [0, 0, 0],
      [10, 0, -4],
      [20, 0, 4],
    ];
    expect(centroidAt(centroids, 0)).toEqual([0, 0, 0]);
    expect(centroidAt(centroids, 0.5)).toEqual([5, 0, -2]);
    expect(centroidAt(centroids, 1.25)).toEqual([12.5, 0, -2]);
    expect(centroidAt(centroids, -3)).toEqual([0, 0, 0]);
    expect(centroidAt(centroids, 9)).toEqual([20, 0, 4]);
    expect(centroidAt([], 1)).toEqual([0, 0, 0]);
  });

  it('receiver centroids sit on the ground between each landed eye and its target', () => {
    const desktop = stationReceiverCentroids(plazaTheme.stations, false);
    plazaTheme.stations.forEach((station, i) => {
      const c = desktop[i];
      expect(c[1]).toBe(0);
      expect(c[0]).toBeCloseTo((station.camera.position[0] + station.camera.target[0]) / 2, 9);
      expect(c[2]).toBeCloseTo((station.camera.position[2] + station.camera.target[2]) / 2, 9);
    });
    // The pullback moves the eye back along target→eye, so the 390 centroid slides toward the camera side.
    const rules = plazaTheme.stations.findIndex((s) => s.id === 'rules');
    const landed = stationReceiverCentroids(plazaTheme.stations, true, MAX_PULLBACK)[rules];
    const base = stationReceiverCentroids(plazaTheme.stations, true, 0)[rules];
    expect(landed[2]).toBeLessThan(base[2]);
  });

  it('the fitted box covers each station centroid (desktop and landed 390)', () => {
    const basis = lightBasis(KEY);
    for (const [mobile, pullback] of [
      [false, 0],
      [true, MAX_PULLBACK],
    ] as const) {
      const centroids = stationReceiverCentroids(plazaTheme.stations, mobile, pullback);
      centroids.forEach((c, i) => {
        const fit = fitStationShadow(centroids, i, basis, RIG);
        const d: Vec3 = [c[0] - fit.center[0], c[1] - fit.center[1], c[2] - fit.center[2]];
        expect(Math.abs(dot(d, basis.right))).toBeLessThan(TEXEL);
        expect(Math.abs(dot(d, basis.up))).toBeLessThan(TEXEL);
      });
    }
  });
});

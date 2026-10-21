import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  cobbleMaps,
  cobblePixelsChunked,
  cobblePlaceholderMaps,
  cobbleWorkerRequest,
  cobbleWorkerSource,
  type CobblePixels,
  type CobbleWorkerRequest,
} from '@/components/world/themes/plaza/stone-maps';
import type { CobblePigment } from '@/components/world/themes/plaza/theme-palette';

/**
 * W7 (review r5): the plaza cobble maps moved off the main thread — a Web
 * Worker running `cobbleJob`'s own source text, an idle-sliced fallback, and
 * the synchronous `cobbleMaps` all step ONE implementation. These hashes were
 * taken from the pre-worker synchronous generator (2026-09-27, before the
 * refactor), so every path is pinned byte-identical to what shipped.
 */

const DAY: CobblePigment = { stone: [201, 188, 160], grout: [120, 110, 96], wetness: 0.1 };
const WET: CobblePigment = { stone: [140, 150, 170], grout: [60, 64, 72], wetness: 0.9 };

/** SHA-256 over albedo ‖ roughness ‖ normal of the pre-refactor generator. */
const ORIGINAL = {
  dayDry: '87b77306dc3fd029ffe712122ebd693df5d27c37d84311df42e97d88f4ccb886',
  dayNight: '825d8f4f6876865b075fbfed768c748f943e77db562331e4fad8dc92ad328156',
  wetDay: '2d0452b723285dd3218ed793fca10295ccc64825439fd5518787c7831c9550e2',
  wetNight: '6aa68d898f2f5ad05bbb813045bd0488d01cfb5edf75e41651836ad75c07215d',
} as const;

function hashPixels(pixels: CobblePixels): string {
  const hash = createHash('sha256');
  hash.update(pixels.albedo);
  hash.update(pixels.roughness);
  hash.update(pixels.normal);
  return hash.digest('hex');
}

function textureBytes(texture: THREE.DataTexture): Uint8Array {
  const data: unknown = texture.image.data;
  if (!(data instanceof Uint8Array)) throw new Error('expected Uint8Array texture data');
  return data;
}

interface WorkerScope {
  onmessage: ((event: { data: CobbleWorkerRequest }) => void) | null;
  postMessage: (message: unknown, transfer?: unknown[]) => void;
}

/**
 * Runs the worker program exactly as a browser worker receives it: the
 * source text evaluated in a scope whose only binding is `self` (no module
 * bindings, so a reference to anything outside `cobbleJob` would throw),
 * one message in, the transferred reply out.
 */
function runWorkerProgram(request: CobbleWorkerRequest): { reply: unknown; transfer: unknown[] } {
  let reply: unknown = null;
  let transfer: unknown[] = [];
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (message, list) => {
      reply = message;
      transfer = list ?? [];
    },
  };
  // eslint-disable-next-line no-new-func -- the worker program is a string by design (blob worker)
  const boot = new Function('self', cobbleWorkerSource()) as (self: WorkerScope) => void;
  boot(scope);
  expect(scope.onmessage).toBeTypeOf('function');
  scope.onmessage?.({ data: request });
  return { reply, transfer };
}

describe('plaza cobble maps — every generation path is byte-identical to the pre-worker generator', () => {
  it('synchronous cobbleMaps (day, dry)', () => {
    const maps = cobbleMaps(false, DAY);
    const hash = hashPixels({
      albedo: textureBytes(maps.color),
      roughness: textureBytes(maps.rough),
      normal: textureBytes(maps.normal),
    });
    expect(hash).toBe(ORIGINAL.dayDry);
    expect(maps.color.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(maps.normal.colorSpace).toBe(THREE.NoColorSpace);
  }, 60_000);

  it('the idle-slice fallback at any row chunking (the pass boundary crossed mid-chunk)', () => {
    expect(hashPixels(cobblePixelsChunked(true, WET, 7))).toBe(ORIGINAL.wetNight);
    expect(hashPixels(cobblePixelsChunked(true, DAY, 2047))).toBe(ORIGINAL.dayNight);
  }, 60_000);

  it('the worker program, evaluated with nothing but `self`, posted the production request', () => {
    const request = cobbleWorkerRequest(false, WET);
    const { reply, transfer } = runWorkerProgram(request);
    const pixels = reply as CobblePixels;
    expect(hashPixels(pixels)).toBe(ORIGINAL.wetDay);
    // Zero-copy: all three buffers are transferred, not cloned.
    expect(transfer).toEqual([pixels.albedo.buffer, pixels.roughness.buffer, pixels.normal.buffer]);
  }, 60_000);
});

describe('cobble placeholders', () => {
  it('share the real maps’ texture configuration, so the swap changes no shader define', () => {
    const stand = cobblePlaceholderMaps(true, WET);
    expect(stand.color.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(stand.rough.colorSpace).toBe(THREE.NoColorSpace);
    expect(stand.normal.colorSpace).toBe(THREE.NoColorSpace);
    for (const texture of [stand.color, stand.rough, stand.normal]) {
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT).toBe(THREE.RepeatWrapping);
      expect(texture.repeat.x).toBe(1);
      expect(texture.image.width).toBe(1);
    }
    expect(Array.from(textureBytes(stand.normal))).toEqual([128, 128, 255, 255]);
    expect(Array.from(textureBytes(stand.color))).toEqual([140, 150, 170, 255]);
  });
});

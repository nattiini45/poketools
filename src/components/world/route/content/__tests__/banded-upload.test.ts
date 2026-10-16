import { describe, expect, it, vi } from 'vitest';
import { LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, Texture } from 'three';
import type { WebGLRenderer } from 'three';
import {
  BAND_MAX_BYTES,
  BAND_MAX_HEIGHT,
  BAND_MAX_WIDTH,
  bandBytes,
  bandDestinationY,
  bandedUploadLog,
  bandedUploadWanted,
  bandsPending,
  markBandedUpload,
  nextBandedStepBytes,
  planUploadBands,
  resetBandedUploadsForTests,
  stepBandedUpload,
} from '../banded-upload';

/**
 * ROLLOUT-PLAN §3.2 E3: the giant painted faces upload in bands of at most
 * 2048 × 256 texels (≤ 2 MiB) per warm step, into storage allocated once,
 * and every band lands before the texture counts as uploaded. The GL side is
 * checked texel-exact in the browser (`verifyBandedUploads`); here the plan,
 * the opt-in and the step machine run against a recording renderer.
 */

/** The face canvases the rollout plan lists (w × h at their ≥ 2× floors). */
const FACES: [number, number][] = [
  [2386, 2710],
  [4096, 1024],
  [2560, 1440],
  [3072, 1280],
  [2560, 1024],
  [640, 1920],
];

function faceTexture(width: number, height: number): Texture {
  // A canvas-shaped source (width / height, no `data`): what the paint path hands three.
  const texture = new Texture({ width, height } as unknown as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

interface Copy {
  region: { x: number; y: number; w: number; h: number };
  dst: { x: number; y: number };
  staging: Texture;
}

function recordingRenderer() {
  const copies: Copy[] = [];
  const pixelStorei = vi.fn();
  const gl = {
    getContext: () => ({ NONE: 0, BROWSER_DEFAULT_WEBGL: 0x9244, UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243 }),
    state: { pixelStorei },
    copyTextureToTexture: (src: Texture, _dst: Texture, region: { min: { x: number; y: number }; max: { x: number; y: number } }, dst: { x: number; y: number }) => {
      copies.push({
        region: { x: region.min.x, y: region.min.y, w: region.max.x - region.min.x, h: region.max.y - region.min.y },
        dst: { x: dst.x, y: dst.y },
        staging: src,
      });
    },
  };
  return { gl: gl as unknown as WebGLRenderer, copies, pixelStorei };
}

describe('planUploadBands', () => {
  for (const [w, h] of FACES) {
    it(`${w}×${h}: bands tile the source exactly once, none above 2048 × 256 or 2 MiB`, () => {
      const bands = planUploadBands(w, h);
      const covered = new Uint8Array(w * h);
      for (const band of bands) {
        expect(band.width).toBeGreaterThan(0);
        expect(band.height).toBeGreaterThan(0);
        expect(band.width).toBeLessThanOrEqual(BAND_MAX_WIDTH);
        expect(band.height).toBeLessThanOrEqual(BAND_MAX_HEIGHT);
        expect(bandBytes(band)).toBeLessThanOrEqual(BAND_MAX_BYTES);
        for (let y = band.y; y < band.y + band.height; y += 1) {
          for (let x = band.x; x < band.x + band.width; x += 1) covered[y * w + x] += 1;
        }
      }
      expect(covered.every((n) => n === 1)).toBe(true);
    });

    it(`${w}×${h}: flipped destination rows tile [0, h) exactly once`, () => {
      const rows = new Uint8Array(h);
      for (const band of planUploadBands(w, h).filter((b) => b.x === 0)) {
        const y0 = bandDestinationY(h, band, true);
        expect(y0).toBeGreaterThanOrEqual(0);
        for (let y = y0; y < y0 + band.height; y += 1) rows[y] += 1;
      }
      expect(rows.every((n) => n === 1)).toBe(true);
    });
  }

  it('without the flip a band keeps its source rows', () => {
    const band = { x: 0, y: 512, width: 100, height: 256 };
    expect(bandDestinationY(1000, band, false)).toBe(512);
    expect(bandDestinationY(1000, band, true)).toBe(1000 - 512 - 256);
  });
});

describe('bandedUploadWanted', () => {
  it('only a marked, unmipped, plain source larger than one band', () => {
    expect(bandedUploadWanted(faceTexture(4096, 1024))).toBe(false); // not marked
    expect(bandedUploadWanted(markBandedUpload(faceTexture(4096, 1024)))).toBe(true);
    expect(bandedUploadWanted(markBandedUpload(faceTexture(640, 1920)))).toBe(true);
    expect(bandedUploadWanted(markBandedUpload(faceTexture(2048, 256)))).toBe(false); // exactly one band
    expect(bandedUploadWanted(markBandedUpload(faceTexture(512, 224)))).toBe(false);
    const mipped = markBandedUpload(faceTexture(4096, 1024));
    mipped.generateMipmaps = true;
    mipped.minFilter = LinearMipmapLinearFilter;
    expect(bandedUploadWanted(mipped)).toBe(false);
    const data = markBandedUpload(new Texture({ width: 4096, height: 1024, data: new Uint8Array(4) } as unknown as HTMLCanvasElement));
    expect(bandedUploadWanted(data)).toBe(false);
  });
});

describe('stepBandedUpload', () => {
  it('allocates once without a transfer, then lands ≤ 2 MiB per step until complete', () => {
    resetBandedUploadsForTests();
    const { gl, copies, pixelStorei } = recordingRenderer();
    const texture = markBandedUpload(faceTexture(2386, 2710));
    const allocations: boolean[] = [];
    const allocate = (t: Texture) => {
      allocations.push(t.source.dataReady);
    };
    expect(bandsPending(texture)).toBe(false); // nothing started
    const total = planUploadBands(2386, 2710).length;
    let steps = 0;
    let bytes = 0;
    for (;;) {
      const planned = nextBandedStepBytes(texture);
      const result = stepBandedUpload(gl, texture, BAND_MAX_BYTES, allocate);
      steps += 1;
      expect(result.bytes).toBe(planned);
      expect(result.bytes).toBeLessThanOrEqual(BAND_MAX_BYTES);
      bytes += result.bytes;
      if (result.done) break;
      expect(bandsPending(texture)).toBe(true);
      expect(steps).toBeLessThan(1000);
    }
    expect(bandsPending(texture)).toBe(false);
    expect(allocations).toEqual([false]); // storage only, exactly once
    expect(texture.source.dataReady).toBe(true); // restored
    expect(copies).toHaveLength(total);
    expect(bytes).toBe(2386 * 2710 * 4);
    // Every copy reads the canvas through a staging texture the renderer never sees.
    expect(new Set(copies.map((c) => c.staging)).size).toBe(1);
    expect(copies[0].staging).not.toBe(texture);
    expect(copies[0].staging.image).toBe(texture.image);
    // flipY (three's default): the canvas top band is the flipped source's
    // last rows and lands on the texture's top rows (same row on both sides).
    expect(copies[0].region).toEqual({ x: 0, y: 2710 - 256, w: 2048, h: 256 });
    expect(copies[0].dst).toEqual({ x: 0, y: 2710 - 256 });
    for (const copy of copies) expect(copy.region.y).toBe(copy.dst.y);
    // The whole upload's colour-space conversion, per band.
    expect(pixelStorei).toHaveBeenCalledWith(0x9243, 0x9244);
    const log = bandedUploadLog();
    expect(log.at(-1)).toMatchObject({ width: 2386, height: 2710, bands: total, steps });
    expect(log.at(-1)?.ms).not.toBeNull();
  });

  it('narrow faces carry several bands per step, never above the budget', () => {
    const { gl, copies } = recordingRenderer();
    const texture = markBandedUpload(faceTexture(640, 1920));
    const result = stepBandedUpload(gl, texture, BAND_MAX_BYTES, () => undefined);
    expect(result.bands).toBe(Math.floor(BAND_MAX_BYTES / (640 * 256 * 4)));
    expect(result.bytes).toBeLessThanOrEqual(BAND_MAX_BYTES);
    expect(copies.every((c) => c.region.w === 640)).toBe(true);
  });

  it('a repaint (version bump) restarts the plan and re-allocates', () => {
    const { gl } = recordingRenderer();
    const texture = markBandedUpload(faceTexture(4096, 1024));
    let allocations = 0;
    const allocate = () => {
      allocations += 1;
    };
    stepBandedUpload(gl, texture, BAND_MAX_BYTES, allocate);
    expect(bandsPending(texture)).toBe(true);
    texture.needsUpdate = true;
    expect(bandsPending(texture)).toBe(false); // stale plan: the warm sees it as not uploaded (version mismatch)
    stepBandedUpload(gl, texture, BAND_MAX_BYTES, allocate);
    expect(allocations).toBe(2);
    expect(bandsPending(texture)).toBe(true);
  });
});

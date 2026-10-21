/**
 * LOOK-PLAN §2 SEAT A — the asset contract `world-env.ts` exposes for the
 * plaza pilot: HDRI formats (the default stays Radiance so sakura, mountain
 * and clouds keep their pixels), the manifest-aware gain-map fallback, the
 * painted texture roles, and the story-mask / skyline atlas URLs and uv law.
 */

import { describe, expect, it } from 'vitest';
import type { WorldManifest } from '../model-manifest';
import {
  envTextureSetUrls,
  hasEnvTextureSet,
  hdriFile,
  hdriUrl,
  hdriUrlFor,
  PLAZA_MASK_FILE,
  PLAZA_PAINTED_ROLES,
  PLAZA_SKYLINE_ATLAS,
  PLAZA_SKYLINE_FILE,
  plazaMaskUrl,
  plazaSkylineUrl,
  skylineLayerHeight,
  skylineWorldPoint,
} from '../world-env';

function manifest(files: string[]): WorldManifest {
  return {
    version: 3,
    generatedAt: '2026-09-27T00:00:00.000Z',
    figures: [],
    props: [],
    environment: files.map((file) => ({ file, kb: 1 })),
    missingForms: [],
    pool: null,
  };
}

describe('HDRI formats', () => {
  it('defaults to the Radiance file every world already loads', () => {
    expect(hdriFile('gold')).toBe('env/hdri/gold.hdr');
    expect(hdriFile('night')).toBe('env/hdri/night.hdr');
    expect(hdriUrl('gold').endsWith('/env/hdri/gold.hdr')).toBe(true);
  });

  it('names the gain map for a theme that opts in', () => {
    expect(hdriFile('gold', 'gainmap')).toBe('env/hdri/gold.jpg');
    expect(hdriUrl('night', 'gainmap').endsWith('/env/hdri/night.jpg')).toBe(true);
  });

  it('falls back to the .hdr when a manifest does not ship the gain map yet', () => {
    const old = manifest(['env/hdri/gold.hdr', 'env/hdri/night.hdr']);
    expect(hdriUrlFor(old, 'gold', 'gainmap').endsWith('/env/hdri/gold.hdr')).toBe(true);
    const current = manifest(['env/hdri/gold.hdr', 'env/hdri/gold.jpg']);
    expect(hdriUrlFor(current, 'gold', 'gainmap').endsWith('/env/hdri/gold.jpg')).toBe(true);
    expect(hdriUrlFor(current, 'gold').endsWith('/env/hdri/gold.hdr')).toBe(true);
  });
});

describe('painted texture roles', () => {
  it('resolves plaza-ground as diff + nor without an ARM pack', () => {
    const m = manifest([
      'env/tex/plaza-ground/diff.webp',
      'env/tex/plaza-ground/nor.webp',
      'env/tex/plaza-ashlar/diff.webp',
      'env/tex/plaza-ashlar/nor.webp',
      'env/tex/plaza-ashlar/arm.webp',
    ]);
    expect(PLAZA_PAINTED_ROLES).toEqual(['plaza-ground', 'plaza-ashlar', 'plaza-slate']);
    expect(hasEnvTextureSet(m, 'plaza-ground')).toBe(true);
    expect(envTextureSetUrls(m, 'plaza-ground').arm).toBeNull();
    expect(envTextureSetUrls(m, 'plaza-ashlar').arm).not.toBeNull();
    expect(hasEnvTextureSet(m, 'plaza-slate')).toBe(false);
  });
});

describe('plaza mask and skyline atlas', () => {
  it('resolves URLs only when the manifest ships the files', () => {
    expect(plazaMaskUrl(manifest([]))).toBeNull();
    expect(plazaSkylineUrl(manifest([]))).toBeNull();
    const m = manifest([PLAZA_MASK_FILE, PLAZA_SKYLINE_FILE]);
    expect(plazaMaskUrl(m)?.endsWith('/env/plaza/mask.webp')).toBe(true);
    expect(plazaSkylineUrl(m)?.endsWith('/env/plaza/skyline.webp')).toBe(true);
  });

  it('puts every band top at the authored elevation inside the r160 sky dome', () => {
    const radii = PLAZA_SKYLINE_ATLAS.layers.map((l) => l.radius);
    expect(radii).toEqual([70, 100, 140]);
    for (const r of radii) {
      expect(r).toBeLessThan(160);
      const top = skylineLayerHeight(r);
      const elevation = (Math.atan2(top, r) * 180) / Math.PI;
      expect(elevation).toBeGreaterThanOrEqual(14);
      expect(elevation).toBeLessThanOrEqual(16);
    }
  });

  it('maps uv to azimuth atan2(z, x) and height', () => {
    const east = skylineWorldPoint(70, 0, 0);
    expect(east[0]).toBeCloseTo(70);
    expect(east[2]).toBeCloseTo(0);
    const south = skylineWorldPoint(70, 0.25, 1);
    expect(south[2]).toBeCloseTo(70);
    expect(south[1]).toBeCloseTo(skylineLayerHeight(70));
    // The Prism Tower (0, −64) sits at u 0.75.
    const north = skylineWorldPoint(70, 0.75, 0);
    expect(north[2]).toBeCloseTo(-70);
  });
});

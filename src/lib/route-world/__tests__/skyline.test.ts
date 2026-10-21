import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { plazaPaletteExtension } from '@/components/world/themes/plaza/theme-palette';
import { faceKeepOutPoses, paddedFaceRect, screenPoint } from '@/lib/route-world/data-surfaces';
import { plazaBlockPlans } from '@/lib/route-world/haussmann';
import { PLAZA } from '@/lib/route-world/layout';
import type { WorldPalette } from '@/lib/route-world/palette';
import {
  SKYLINE_BANDS,
  SKYLINE_CALM_DELTA_L,
  SKYLINE_INK,
  SKYLINE_SEAMS,
  SKYLINE_WINDOW,
  SKYLINE_WINDOW_CAP_SHARE,
  SKY_DOME_RADIUS,
  atlasU,
  bandPoint,
  buildSkylineRing,
  calmClampL,
  luma,
  lstar,
  seamHiddenFrom,
  skylineColor,
  skylineOccluders,
  skylinePoses,
  type Rgb,
} from '@/lib/route-world/skyline';
import { PLAZA_SKYLINE_ATLAS, skylineLayerHeight, skylineWorldPoint } from '@/lib/route-world/world-env';

const POSES = skylinePoses(PLAZA_DATA_SURFACES);
const OCCLUDERS = skylineOccluders(plazaBlockPlans(PLAZA.half));

function srgbToLinear(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}

describe('skyline ring geometry', () => {
  it('judges from every station, focus and dolly pose', () => {
    // 5 stations × 3 viewports + 4 crossings × 3 viewports × 3 samples + 2 focus poses per face.
    expect(POSES.length).toBe(5 * 3 + 4 * 9 + PLAZA_DATA_SURFACES.faces.length * 2);
  });

  it('keeps every band inside the r160 sky dome and inside the camera far plane from every pose', () => {
    const maxEye = Math.max(...POSES.map((p) => Math.hypot(p.camera.position[0], p.camera.position[1], p.camera.position[2])));
    for (const band of SKYLINE_BANDS) {
      // The dome is centred on the plaza origin: the band's top rim (its farthest point) is inside it.
      const rim = Math.hypot(band.radius, band.height);
      expect(rim).toBeLessThan(SKY_DOME_RADIUS);
      // CameraRig far = 400: no band vertex is clipped from any eye.
      expect(rim + maxEye).toBeLessThan(400);
    }
  });

  it('matches the atlas contract: 70 / 100 / 140 m, tops at 16° from the centre', () => {
    expect(SKYLINE_BANDS.map((b) => b.radius)).toEqual([70, 100, 140]);
    for (const band of SKYLINE_BANDS) {
      expect(Math.atan2(band.height, band.radius) * (180 / Math.PI)).toBeCloseTo(PLAZA_SKYLINE_ATLAS.topElevationDeg, 6);
      expect(band.height).toBeCloseTo(skylineLayerHeight(band.radius), 9);
    }
  });

  it('builds one merged ring, far band first, on the SEAT A uv law', () => {
    const ring = buildSkylineRing(SKYLINE_BANDS, 64);
    const columns = 65;
    expect(ring.positions.length).toBe(3 * columns * 2 * 3);
    // Painter's order: the first triangles belong to the far band, the last to the near one.
    expect(ring.bands[ring.indices[0]]).toBe(2);
    expect(ring.bands[ring.indices[ring.indices.length - 1]]).toBe(0);
    for (let vtx = 0; vtx < ring.bands.length; vtx += 7) {
      const band = SKYLINE_BANDS[ring.bands[vtx]];
      const u = ring.uvs[vtx * 2];
      const v = ring.uvs[vtx * 2 + 1];
      const [x, y, z] = skylineWorldPoint(band.radius, u, v);
      expect(ring.positions[vtx * 3]).toBeCloseTo(x, 3);
      expect(ring.positions[vtx * 3 + 1]).toBeCloseTo(y, 3);
      expect(ring.positions[vtx * 3 + 2]).toBeCloseTo(z, 3);
      // u (continuous, wrapped by the sampler) is the atlas u of the vertex azimuth.
      const du = Math.abs(u - Math.floor(u) - atlasU(Math.atan2(z, x)));
      expect(Math.min(du, 1 - du)).toBeLessThan(1e-4);
    }
    // u never jumps between neighbouring columns (no atlas-wrap derivative seam).
    for (let vtx = 2; vtx < ring.bands.length; vtx += 2) {
      if (ring.bands[vtx] !== ring.bands[vtx - 2]) continue;
      expect(Math.abs(ring.uvs[vtx * 2] - ring.uvs[(vtx - 2) * 2])).toBeLessThan(0.02);
    }
  });
});

describe('skyline seams', () => {
  it('sit behind the Haussmann masses from every pose', () => {
    for (const band of SKYLINE_BANDS) {
      const seen = POSES.filter((pose) => !seamHiddenFrom(band, band.seam, pose, OCCLUDERS)).map((p) => p.id);
      expect(seen, `${band.id} seam seen from`).toEqual([]);
      expect(band.seam).toBe(SKYLINE_SEAMS[band.id]);
    }
  });

  it('the solver is not vacuous: an open azimuth is seen (north gap over the boards)', () => {
    const near = SKYLINE_BANDS[0];
    const north = -Math.PI / 2;
    expect(POSES.some((pose) => !seamHiddenFrom(near, north, pose, OCCLUDERS))).toBe(true);
  });
});

const ATLAS_FILE = join(process.cwd(), 'public', 'models', 'world', 'env', 'plaza', 'skyline.webp');

describe('skyline night windows vs padded face rects', () => {
  it.skipIf(!existsSync(ATLAS_FILE))('no lit window falls inside any padded face rect at any keep-out pose', async () => {
    const { data, info } = await sharp(ATLAS_FILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(PLAZA_SKYLINE_ATLAS.width);
    expect(info.height).toBe(PLAZA_SKYLINE_ATLAS.height);
    const near = SKYLINE_BANDS.find((b) => b.id === 'near')!;
    const zones = PLAZA_DATA_SURFACES.faces.flatMap((face) =>
      faceKeepOutPoses(PLAZA_DATA_SURFACES, face)
        .map((pose) => ({ pose, rect: paddedFaceRect(face, pose.camera, pose.viewport) }))
        .filter((zone) => zone.rect !== null),
    );
    expect(zones.length).toBeGreaterThan(40);
    let lit = 0;
    const hits: string[] = [];
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        if (data[i + 3] === 0) continue;
        lit += 1;
        // Windows live on the near silhouette only (A is applied to band 0).
        expect(data[i]).toBe(255);
        // flipY: image row 0 is v = 1.
        const u = (x + 0.5) / info.width;
        const v = 1 - (y + 0.5) / info.height;
        const p = bandPoint(near, u * Math.PI * 2, v);
        for (const { pose, rect } of zones) {
          const s = screenPoint(p, pose.camera, pose.viewport);
          if (s && rect && s.x >= rect.x && s.x <= rect.x + rect.w && s.y >= rect.y && s.y <= rect.y + rect.h) {
            hits.push(`${x},${y}@${pose.id}`);
          }
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(hits.slice(0, 5)).toEqual([]);
  });
});

describe('skyline colour law', () => {
  const skies: Rgb[] = [
    srgbToLinear('#f2d7ae'),
    srgbToLinear('#a8c8e6'),
    srgbToLinear('#c7c3e0'),
    srgbToLinear('#ffc890'),
    srgbToLinear('#1c3a58'),
    srgbToLinear('#070433'),
  ];

  it('stays within ±8 ΔL* of the local sky behind any face (calm = 1)', () => {
    for (const band of SKYLINE_BANDS) {
      for (const night of [false, true]) {
        const ink = srgbToLinear(night ? SKYLINE_INK[band.id].night : SKYLINE_INK[band.id].day);
        const k = night ? band.horizonMix.night : band.horizonMix.day;
        for (const sky of skies) {
          const col = skylineColor(ink, sky, k, 1);
          expect(Math.abs(lstar(luma(col)) - lstar(luma(sky)))).toBeLessThanOrEqual(SKYLINE_CALM_DELTA_L + 1e-6);
        }
      }
    }
    expect(SKYLINE_CALM_DELTA_L).toBeLessThanOrEqual(8);
  });

  it('leaves the silhouette untouched outside the calm rects and keeps hue under the clamp', () => {
    const ink = srgbToLinear(SKYLINE_INK.near.day);
    const sky = skies[0];
    expect(skylineColor(ink, sky, 0.45, 0)).toEqual(calmClampL(ink.map((c, i) => c + (sky[i] - c) * 0.45) as unknown as Rgb, sky, 6, 0));
    const clamped = calmClampL([0.05, 0.1, 0.2], [0.8, 0.8, 0.8], 6, 1);
    expect(clamped[1] / clamped[0]).toBeCloseTo(2, 6);
    expect(clamped[2] / clamped[0]).toBeCloseTo(4, 6);
  });

  it('recedes: each band sits closer to the sky than the one in front of it', () => {
    for (const night of [false, true]) {
      const sky = night ? skies[4] : skies[0];
      const gaps = SKYLINE_BANDS.map((band) => {
        const ink = srgbToLinear(night ? SKYLINE_INK[band.id].night : SKYLINE_INK[band.id].day);
        const col = skylineColor(ink, sky, night ? band.horizonMix.night : band.horizonMix.day, 0);
        return Math.abs(lstar(luma(col)) - lstar(luma(sky)));
      });
      expect(gaps[0]).toBeGreaterThan(gaps[1]);
      expect(gaps[1]).toBeGreaterThan(gaps[2]);
    }
  });

  it('keeps night windows at or under 0.6 × the dimmest board ink luma', () => {
    const nightExt = plazaPaletteExtension({ ground: '#1a1c24' } as unknown as WorldPalette, true);
    const inks = [nightExt.boardPulse, nightExt.boardSchedule].map((hex) => luma(srgbToLinear(hex)));
    expect(SKYLINE_WINDOW.luma).toBeLessThanOrEqual(SKYLINE_WINDOW_CAP_SHARE * Math.min(...inks));
  });
});

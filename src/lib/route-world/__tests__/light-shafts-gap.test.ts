import { describe, expect, it } from 'vitest';
import { stationPose, themeKeepOut, wedgeHitsSphere } from '../data-surfaces';
import { GAP_SHAFT_MIN_Z, gapShaftSeats, shaftAxisSamples, shaftClears, shaftSampleRadius } from '../light-shafts';
import { screenPoint } from '../data-surfaces';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { plazaTheme } from '@/components/world/themes/plaza/theme';

/**
 * LOOK r5 — the rules gap beams (authored, behind the gate): the same
 * keep-out law as the solved ground seats, wholly behind the gate's face
 * plane, climbing toward the key, and seen by the rules desktop eye in the
 * sky gap left and right of the frame centre.
 */

const keepOut = themeKeepOut(PLAZA_DATA_SURFACES);
const KEY = plazaTheme.lights.keyDirection;
const gap = gapShaftSeats(KEY);
const rulesIndex = PLAZA_DATA_SURFACES.stations.findIndex((station) => station.id === 'rules');
const rulesDesktop = stationPose(PLAZA_DATA_SURFACES, rulesIndex, 'desktop');

describe('plaza gap shafts', () => {
  it('ships three beams', () => {
    expect(gap).toHaveLength(3);
  });

  it('no axis sample of a gap beam reaches into any wedge at any pose', () => {
    for (const seat of gap) {
      const r = shaftSampleRadius(seat.width);
      for (const p of shaftAxisSamples(seat)) {
        const hits = keepOut.wedges.filter((w) => wedgeHitsSphere(w, p, r)).map((w) => `${w.faceId}@${w.poseId}`);
        expect(hits, `${seat.id} ${p.map((v) => v.toFixed(2)).join(',')}`).toEqual([]);
      }
      expect(shaftClears(keepOut, seat)).toBe(true);
    }
  });

  it('every beam lies behind the gate face plane and climbs toward the key', () => {
    for (const seat of gap) {
      for (const p of shaftAxisSamples(seat)) expect(p[2]).toBeGreaterThanOrEqual(GAP_SHAFT_MIN_Z);
      expect(seat.top[1]).toBeGreaterThan(seat.pool[1]);
      expect(Math.sign(seat.top[0] - seat.pool[0])).toBe(Math.sign(KEY[0]));
    }
  });

  it('the rules desktop eye sees each beam start inside the frame, one left and one right of centre', () => {
    const xs = gap.map((seat) => {
      const s = screenPoint(seat.pool, rulesDesktop.camera, rulesDesktop.viewport);
      expect(s).not.toBeNull();
      expect(s!.x).toBeGreaterThan(0);
      expect(s!.x).toBeLessThan(rulesDesktop.viewport.width);
      expect(s!.y).toBeGreaterThan(0);
      return s!.x;
    });
    const mid = rulesDesktop.viewport.width / 2;
    expect(xs.some((x) => x < mid)).toBe(true);
    expect(xs.some((x) => x > mid)).toBe(true);
  });
});

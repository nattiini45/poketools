/**
 * LOOK r6 SEAT H8: the look probe. The world-space patch geometry mirrored
 * in scripts/lib/look-probe.mjs is pinned to the plaza plan in src (blocks,
 * LED bays, crowns, lamps, the gate), the projection to the
 * __routeWorldCamera convention, and every metric to a synthetic frame.
 */
import { describe, expect, it } from 'vitest';
import { HAUSSMANN, blockToWorld as planToWorld, ledSpecs, plazaBlockPlans } from '@/lib/route-world/haussmann';
import { FURNITURE, GATE, PLAZA } from '@/lib/route-world/layout';
import { PLAZA_LAMP_SEATS } from '@/lib/route-world/teams-formation';
import { PLAZA_EMITTERS } from '@/lib/route-world/plaza-emitters';
import { plazaCanopies } from '@/components/world/evoliga/route/plaza/tree-skin';
import { MASK } from '../lib/w1-evidence.mjs';
import {
  GROUND_QUADS,
  HAUSSMANN_DIMS,
  LAMP_CORES,
  PLAZA_BLOCKS,
  PLAZA_CROWNS,
  PLAZA_HALF,
  blockToWorld,
  cameraOf,
  circularHue,
  components,
  deltaE76,
  facadePatches,
  lookProbe,
  otsu,
  polygonPixels,
  probeInputsFromSidecar,
  projectPoint,
  projectPolygon,
  rgbToHsv,
  rgbToLab,
  skyGapFlat,
} from '../lib/look-probe.mjs';

// look-after-r5-r0-light-1440-rules-1440 cameraPose.
const RULES_POSE = { camPos: [0, 2.5, -4.6], yawRad: -3.14159, pitchRad: -0.00476, fov: 36.00809 };
const VIEW = { width: 1440, height: 900 };

describe('plaza geometry mirrors the plan in src', () => {
  const plans = plazaBlockPlans(PLAZA.half);
  it('blocks: origin, rotation, bays, depth, floors and reserved spans', () => {
    expect(PLAZA_HALF).toBe(PLAZA.half);
    for (const k of ['bayWidth', 'floorHeight', 'podiumHeight', 'sill', 'windowH']) expect(HAUSSMANN_DIMS[k]).toBe(HAUSSMANN[k]);
    expect(PLAZA_BLOCKS.map((b) => b.id)).toEqual(plans.map((p) => p.id));
    for (const b of PLAZA_BLOCKS) {
      const p = plans.find((x) => x.id === b.id);
      b.origin.forEach((v, i) => expect(v).toBeCloseTo(p.origin[i], 6));
      expect(b.rotationY).toBeCloseTo(p.rotationY, 9);
      expect(b).toMatchObject({ widthBays: p.widthBays, depth: p.depth, upperFloors: p.upperFloors });
      expect(b.reserved).toEqual(p.reserved.map((r) => ({ startBay: r.startBay, endBay: r.endBay })));
      for (const pt of [[0, 0, 0], [3, 4, p.depth / 2], [-7.5, 1, -1]]) {
        blockToWorld(b, ...pt).forEach((v, i) => expect(v).toBeCloseTo(planToWorld(p, ...pt)[i], 9));
      }
    }
  });
  it('LED bay ranges cover ledSpecs', () => {
    for (const b of PLAZA_BLOCKS) {
      const p = plans.find((x) => x.id === b.id);
      const specs = ledSpecs(p);
      expect(b.led.length).toBe(specs.length);
      const halfW = (b.widthBays * HAUSSMANN.bayWidth) / 2;
      specs.forEach((s, i) => {
        const r = b.led[i];
        const x0 = r.startBay * HAUSSMANN.bayWidth - halfW;
        const x1 = r.endBay * HAUSSMANN.bayWidth - halfW;
        expect((x0 + x1) / 2).toBeCloseTo(s.x, 6);
        expect(x1 - x0).toBeGreaterThanOrEqual(s.w);
      });
    }
  });
  it('pier patches sit 3 cm proud of the façade and never border a reserved or LED bay', () => {
    const patches = facadePatches();
    expect(patches.length).toBeGreaterThan(30);
    for (const patch of patches) {
      const b = PLAZA_BLOCKS.find((x) => x.id === patch.block);
      const p = plans.find((x) => x.id === patch.block);
      const front = planToWorld(p, -(b.widthBays * HAUSSMANN.bayWidth) / 2 + patch.bay * HAUSSMANN.bayWidth, (patch.corners[0][1] + patch.corners[2][1]) / 2, p.depth / 2);
      expect(Math.hypot(front[0] - patch.center[0], front[1] - patch.center[1], front[2] - patch.center[2])).toBeCloseTo(0.03, 6);
      for (const bay of [patch.bay - 1, patch.bay]) {
        for (const r of [...b.reserved, ...b.led]) expect(bay >= r.startBay && bay < r.endBay).toBe(false);
      }
    }
    expect(new Set(patches.map((p) => p.block))).toEqual(new Set(PLAZA_BLOCKS.map((b) => b.id)));
  });
  it('crowns follow plazaCanopies() and lamps / lanterns the emitter seats', () => {
    const canopies = plazaCanopies();
    expect(PLAZA_CROWNS.length).toBe(canopies.length);
    PLAZA_CROWNS.forEach((c, i) => {
      expect(Math.hypot(...c.center.map((v, k) => v - canopies[i].center[k]))).toBeLessThan(0.25);
      expect(c.radius / canopies[i].radius).toBeGreaterThan(0.8);
      expect(c.radius / canopies[i].radius).toBeLessThan(1.2);
    });
    const lampXZ = LAMP_CORES.filter((l) => l.id.startsWith('lamp:')).map((l) => [l.center[0], l.center[2]]);
    expect(lampXZ).toEqual(PLAZA_LAMP_SEATS.map(([x, z]) => [x, z]));
    for (const e of PLAZA_EMITTERS.filter((x) => x.kind === 'gate-lamp')) {
      const core = LAMP_CORES.find((l) => l.id === e.id);
      expect(core.center[0]).toBeCloseTo(e.at[0], 6);
      expect(core.center[2]).toBeCloseTo(e.at[1], 6);
      expect(core.center[1]).toBeGreaterThanOrEqual(e.y[0]);
      expect(core.center[1]).toBeLessThanOrEqual(e.y[1]);
    }
    // The forecourt ends at the gate's north face.
    expect(Math.max(...GROUND_QUADS['rules-forecourt'].map((p) => p[2]))).toBeLessThanOrEqual(FURNITURE.gate.z - GATE.depth / 2 + 0.01);
  });
});

describe('projection (the __routeWorldCamera convention)', () => {
  const cam = cameraOf(RULES_POSE, VIEW);
  it('puts the view axis at the centre and the gate lanterns where the r5 rules still shows them', () => {
    const ahead = projectPoint(cam, [0, 2.5 + Math.tan(-0.00476) * 20, -4.6 + 20]);
    expect(ahead.x).toBeCloseTo(720, 0);
    expect(ahead.y).toBeCloseTo(450, 0);
    // The left lantern (x -3.8) is screen-right when looking south; measured at about (980, 118) on the still.
    const left = projectPoint(cam, LAMP_CORES.find((l) => l.id === 'gate-lamp:left').center);
    expect(Math.abs(left.x - 980)).toBeLessThan(15);
    expect(Math.abs(left.y - 118)).toBeLessThan(20);
    expect(projectPoint(cam, [0, 2.5, -10])).toBeNull();
    expect(cameraOf({ camPos: [0, 0, 0] }, VIEW)).toBeNull();
  });
  it('clips a ground quad under the camera at the near plane', () => {
    const poly = projectPolygon(cam, GROUND_QUADS['plaza-floor']);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    expect(poly.every((p) => p.depth >= 0.1 - 1e-9)).toBe(true);
    expect(projectPolygon(cam, [[0, 0, -10], [1, 0, -10], [1, 1, -10]])).toEqual([]);
  });
  it('rasterises a polygon at pixel centres', () => {
    expect(polygonPixels([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], { width: 100, height: 100 })).toHaveLength(100);
    expect(polygonPixels([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], { width: 100, height: 100, scale: 2 })).toHaveLength(400);
    expect(polygonPixels([], { width: 10, height: 10 })).toEqual([]);
  });
});

describe('colour and helpers', () => {
  it('converts sRGB to Lab / HSV and measures ΔE76', () => {
    rgbToLab(255, 255, 255).forEach((v, i) => expect(v).toBeCloseTo([100, 0, 0][i], 1));
    expect(rgbToLab(0, 0, 0)).toEqual([0, 0, 0]);
    expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1]);
    expect(rgbToHsv(0, 0, 255)[0]).toBe(240);
    expect(deltaE76([50, 0, 0], [53, 4, 0])).toBe(5);
    expect(circularHue([350, 10], [1, 1])).toBeCloseTo(0, 5);
    expect(circularHue([0, 180], [1, 1])).toBeNull();
    expect(otsu([...Array(50).fill(20), ...Array(50).fill(80)])).toBeGreaterThan(20);
    expect(otsu([...Array(50).fill(20), ...Array(50).fill(80)])).toBeLessThan(80);
  });
  it('finds connected components', () => {
    const bin = new Uint8Array(10 * 10);
    for (let y = 1; y < 8; y += 1) bin[y * 10 + 2] = 1;
    bin[5 * 10 + 7] = 1;
    const c = components(bin, 10, 10).sort((a, b) => b.area - a.area);
    expect(c[0]).toMatchObject({ x: 2, y: 1, w: 1, h: 7, area: 7 });
    expect(c[1]).toMatchObject({ area: 1 });
  });
});

function frame(width, height, fill) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) data.set(fill, i * 3);
  return { width, height, channels: 3, data };
}

describe('metrics on a synthetic rules frame', () => {
  it('reads two differently painted blocks, the board-first luma and the sky-gap flat area', () => {
    const img = frame(1440, 900, [60, 60, 70]);
    // Screen-left half = the south-east block (x > 0), screen-right = south-west.
    for (let y = 0; y < 900; y += 1) {
      for (let x = 0; x < 1440; x += 1) {
        const o = (y * 1440 + x) * 3;
        if (y < 90) img.data.set([250, 250, 252], o);
        else if (y < 600) img.data.set(x < 720 ? [200, 180, 140] : [170, 170, 170], o);
      }
    }
    // The board: bright.
    for (let y = 320; y < 580; y += 1) for (let x = 560; x < 880; x += 1) img.data.set([235, 235, 235], (y * 1440 + x) * 3);
    const p = lookProbe(img, { pose: RULES_POSE, viewport: VIEW, scale: 1, faceRects: [{ id: 'rules:gate', x: 560, y: 320, w: 320, h: 260 }], frameRects: [{ x: 0, y: 844, w: 1e6, h: 1e6 }], theme: 'light', station: 'rules' });
    expect(p.verdict).toBe('measured');
    expect(p.facades.blocks['south-east'].pier.lab[0]).toBeGreaterThan(p.facades.blocks['south-west'].pier.lab[0]);
    const pair = p.facades.adjacent.find((a) => a.a === 'south-west' && a.b === 'south-east');
    expect(pair.deltaE76).toBeGreaterThan(4);
    expect(pair.valueStepPct).toBeGreaterThan(5);
    expect(pair.meetsBar).toBe(true);
    expect(p.boardVsWorld).toMatchObject({ verdict: 'measured', boardFirst: false });
    expect(p.skyGap.largestRegionShare).toBeGreaterThan(0.08);
    expect(p.skyGap.withinBar).toBe(false);
    expect(p.night.streaks.verdict).toBe('not-applicable');
    expect(p.ground.verdict).toBe('measured');
  });
  it('counts a tall bright streak on the dark forecourt', () => {
    const img = frame(1440, 900, [20, 25, 40]);
    const cam = cameraOf(RULES_POSE, VIEW);
    const poly = projectPolygon(cam, GROUND_QUADS['rules-forecourt']);
    const cx = Math.round(poly.reduce((s, q) => s + q.x, 0) / poly.length);
    const cy = Math.round(poly.reduce((s, q) => s + q.y, 0) / poly.length);
    for (let y = cy - 20; y < cy + 20; y += 1) for (let x = cx; x < cx + 4; x += 1) img.data.set([255, 210, 140], (y * 1440 + x) * 3);
    const p = lookProbe(img, { pose: RULES_POSE, viewport: VIEW, scale: 1, faceRects: [{ id: 'rules:gate', x: 600, y: 200, w: 200, h: 100 }], theme: 'dark', station: 'rules' });
    expect(p.night.streaks.streakCount).toBe(1);
    expect(p.night.streaks.streaks[0]).toMatchObject({ w: 4, h: 40, aspect: 10 });
    expect(p.boardVsWorld.boardFirst).toBe(true);
  });
  it('reports sky-gap tiles only for flat bright world pixels', () => {
    const img = frame(64, 64, [30, 30, 30]);
    const mask = new Uint8Array(64 * 64).fill(MASK.OUTSIDE);
    expect(skyGapFlat(img, mask).flatTiles).toBe(0);
    const white = frame(64, 64, [255, 255, 255]);
    expect(skyGapFlat(white, mask).largestRegionShare).toBe(1);
  });
  it('is unmeasured without a camera, and reads its inputs from a sidecar', () => {
    const img = frame(100, 60, [10, 10, 10]);
    expect(lookProbe(img, { pose: null, viewport: { width: 100, height: 60 } }).verdict).toBe('unmeasured');
    const inputs = probeInputsFromSidecar({ section: 'rules', cameraPose: RULES_POSE, hud: { top: 844 }, stationCard: { framePx: { left: 24, top: 24, width: 360, height: 169 } }, lumaInputs: { frame: { scale: 1, width: 1440, height: 900 }, faces: [{ id: 'rules:gate', x: 1, y: 2, w: 3, h: 4 }], excluded: { chrome: [{ layer: 'x', x: 0, y: 0, w: 5, h: 5 }] } }, invocation: { args: { theme: 'dark' } } }, { viewport: VIEW });
    expect(inputs).toMatchObject({ station: 'rules', theme: 'dark', scale: 1, faceRects: [{ id: 'rules:gate' }], excludeRects: [{ layer: 'x' }] });
    expect(inputs.frameRects).toHaveLength(2);
  });
});

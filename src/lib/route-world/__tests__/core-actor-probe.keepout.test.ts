import { describe, expect, it } from 'vitest';
import {
  dollyPoses,
  faceFocusPoses,
  portraitBands,
  stationPose,
  themeKeepOut,
  VIEWPORTS,
  type KeepOutPose,
} from '../data-surfaces';
import {
  boxNdc,
  buildSkyLane,
  faceNdcRect,
  laneAsKeepOut,
  laneEndpointsOffFrame,
  laneLimits,
  ndcRectDistance,
  ndcRows,
  sphereNdc,
  type NdcRect,
} from '../sky-lanes';
import { insideWater, shoreDistance } from '../water';
import {
  BREACH_LIFT_DEFAULT_M,
  DRAFT_FRAC_TALL,
  discSamples,
  maxBreachLift,
  SURFACER_MIN_RISE_M,
  surfacerBeatSphere,
  surfacerHeights,
} from '../water-resident';
import { SAKURA_DATA_SURFACES } from '@/components/world/themes/sakura/furniture/data-faces';
import {
  CORE_PROBE_FLOATERS,
  CORE_PROBE_LAKE,
  CORE_PROBE_LANE,
  CORE_PROBE_SURFACER,
  CORE_PROBE_WADER,
  coreProbeEnvelopeWarnings,
  coreProbeSlot,
} from '@/components/world/route/figures/core-actor-probe.data';

/**
 * POKEMON-CORE SEAT D: the core actor probe's clarity gate (plan §4 SEAT D
 * tests; K6's static half). It checks ONLY the probe data
 * (`core-actor-probe.data.ts`) against sakura's keep-out
 * (`themeKeepOut`, `data-surfaces.ts`); `data-surface-keepout.test.ts` stays
 * the world's own gate (4S adds its lanes, discs and spots there).
 *
 *  - the lane: yaw rate ≤ 20°/s and bank ≤ 18° (`laneLimits`), `laneClears`,
 *    face NDC ≥ 0.06 at the desktop / 768 (and, when it flies there, 390)
 *    station poses, both ends off frame at every station, focus and dolly
 *    pose, and at landed 390 no sample meets `portraitBands().caption` — or
 *    `portrait: false`, which this test also proves NECESSARY (it fails both
 *    ways: a lane that would clear the caption may not be suppressed);
 *  - the surfacer spot: rise ≥ 0.6 m under the pinned headroom (re-derived),
 *    the held box clear of every wedge, shore distance ≥ beam/2 + 1.0, the
 *    held box ≥ 0.06 NDC from every padded face at the desktop / 768 poses,
 *    and clear of the 390 data and caption bands — or `portrait: false`,
 *    proven necessary the same way;
 *  - the floaters: every drift-disc sample on open water ≥ max(0.8,
 *    beam/2 + 0.3) from any shore, the floated box (breach lift included)
 *    clear of every wedge, the pinned headroom re-derived, and the breach
 *    clamp holding at every sample;
 *  - the wader: a dry anchor, a wet edge, and its walk clear of every wedge.
 *
 * The envelopes are the slots' (`CORE_PROBE_SLOTS`): the tallest and widest
 * figure the slot may cast. Honest limits: the keep-out model's own
 * (analytic faces, sampled dolly corridor); the frame-by-frame truth is K6's
 * `--occlusion on` capture.
 */

const THEME = SAKURA_DATA_SURFACES;
const KEEP_OUT = themeKeepOut(THEME);
const SURFACE_Y = CORE_PROBE_LAKE.surfaceY;
const NDC_MIN = 0.06;
const STATIONS = THEME.stations.map((_, i) => i);

function stationPoses(keys: readonly ('desktop' | 'tablet' | 'mobile')[]): KeepOutPose[] {
  return STATIONS.flatMap((i) => keys.map((key) => stationPose(THEME, i, key)));
}

/** Every pose the rig can take that the keep-out samples: stations × 3 widths, every face's focus poses, the dolly corridor. */
function everyPose(): KeepOutPose[] {
  const out = stationPoses(['desktop', 'tablet', 'mobile']);
  for (const face of THEME.faces) out.push(...faceFocusPoses(THEME, face));
  for (let i = 0; i < THEME.stations.length - 1; i += 1) out.push(...dollyPoses(THEME, i));
  return out;
}

/** The smallest NDC gap from `rectOf(pose)` to any on-screen padded face, over `poses` (Infinity when never on screen). */
function minFaceGap(poses: readonly KeepOutPose[], rectOf: (pose: KeepOutPose) => NdcRect | null): { gap: number; at: string } {
  let gap = Infinity;
  let at = '';
  for (const pose of poses) {
    const rect = rectOf(pose);
    if (rect === null || rect.x1 < -1 || rect.x0 > 1 || rect.y1 < -1 || rect.y0 > 1) continue;
    for (const face of THEME.faces) {
      const faceRect = faceNdcRect(pose, face);
      if (faceRect === null) continue;
      const d = ndcRectDistance(rect, faceRect);
      if (d < gap) {
        gap = d;
        at = `${face.id}@${pose.id}`;
      }
    }
  }
  return { gap, at };
}

/** Station indexes at whose landed-390 pose a rect meets the caption band or the station's data band. */
function portraitBandConflicts(rectOf: (pose: KeepOutPose) => NdcRect | null): string[] {
  const out: string[] = [];
  for (const i of STATIONS) {
    const pose = stationPose(THEME, i, 'mobile');
    const rect = rectOf(pose);
    if (rect === null) continue;
    const rows = ndcRows(rect, pose.viewport);
    if (rows === null) continue;
    const bands = portraitBands(THEME, i, VIEWPORTS.mobile);
    if (rows.top < bands.caption.bottom) out.push(`caption@${pose.id}`);
    if (bands.data && rows.bottom > bands.data.top && rows.top < bands.data.bottom) out.push(`data@${pose.id}`);
  }
  return out;
}

describe('core actor probe: the lane', () => {
  const lane = buildSkyLane(CORE_PROBE_LANE);
  const samples = laneAsKeepOut(lane).points;
  const r = CORE_PROBE_LANE.bodyRadiusM;
  const slot = coreProbeSlot(CORE_PROBE_LANE.slotId);

  it('the body radius covers the slot envelope', () => {
    expect(r).toBeGreaterThanOrEqual(Math.max(slot.height.max, slot.maxWidthM) / 2);
  });

  it('keeps the yaw rate ≤ 20°/s and the bank ≤ 18°', () => {
    const limits = laneLimits(lane);
    expect(limits.maxYawRateDegS).toBeLessThanOrEqual(20);
    expect(limits.maxBankDeg).toBeLessThanOrEqual(18);
  });

  it('clears every keep-out wedge (laneClears)', () => {
    const hits = KEEP_OUT.laneHits(laneAsKeepOut(lane)).map((w) => `${w.faceId}@${w.poseId}`);
    expect(hits).toEqual([]);
  });

  it('keeps ≥ 0.06 NDC from every padded face at the desktop and 768 station poses', () => {
    const poses = stationPoses(['desktop', 'tablet']);
    let worst = { gap: Infinity, at: '' };
    for (const c of samples) {
      const found = minFaceGap(poses, (pose) => sphereNdc(pose.camera, pose.viewport, c, r));
      if (found.gap < worst.gap) worst = found;
    }
    expect(worst.gap, worst.at).toBeGreaterThanOrEqual(NDC_MIN);
  });

  it('enters and leaves off frame at every station, focus and dolly pose (C4)', () => {
    expect(laneEndpointsOffFrame(lane, everyPose())).toEqual([]);
  });

  it('portrait: clears the caption band and faces at landed 390, or is suppressed there — and only when it must be', () => {
    const conflicts = new Set<string>();
    const poses = stationPoses(['mobile']);
    let gap = Infinity;
    for (const c of samples) {
      for (const hit of portraitBandConflicts((pose) => sphereNdc(pose.camera, pose.viewport, c, r))) {
        if (hit.startsWith('caption')) conflicts.add(hit);
      }
      gap = Math.min(gap, minFaceGap(poses, (pose) => sphereNdc(pose.camera, pose.viewport, c, r)).gap);
    }
    const lawful = conflicts.size === 0 && gap >= NDC_MIN;
    if (CORE_PROBE_LANE.portrait === false) expect(lawful, 'portrait:false must be necessary').toBe(false);
    else expect([...conflicts]).toEqual([]);
  });
});

describe('core actor probe: the surfacer spot', () => {
  const { spot, portrait } = CORE_PROBE_SURFACER;
  const slot = coreProbeSlot(CORE_PROBE_SURFACER.slotId);
  const beam = slot.maxWidthM;
  const tallest = slot.height.max;
  const shortest = slot.height.min ?? tallest;
  const ceiling = SURFACE_Y + tallest + 1;

  /** The held pose's VISIBLE box (above the opaque water) for a figure of `heightM`. */
  function heldBox(heightM: number): { center: [number, number, number]; half: [number, number, number] } {
    const top = surfacerHeights(spot, heightM).riseTopY;
    const h = top - SURFACE_Y;
    return { center: [spot.x, SURFACE_Y + h / 2, spot.z], half: [beam / 2, h / 2, beam / 2] };
  }

  it('pins headroomTopY = headroomAt(...).below − 0.3 (re-derived)', () => {
    const headroom = KEEP_OUT.headroomAt(spot.x, spot.z, { floor: SURFACE_Y, ceiling, r: beam / 2 });
    expect(spot.headroomTopY).toBeCloseTo(headroom.below - 0.3, 6);
  });

  it('rises ≥ 0.6 m for every height the slot may cast', () => {
    for (const heightM of [shortest, tallest]) {
      const heights = surfacerHeights(spot, heightM);
      expect(heights.riseTopY - heights.restTopY).toBeGreaterThanOrEqual(SURFACER_MIN_RISE_M);
    }
  });

  it('holds its box clear of every wedge', () => {
    for (const heightM of [shortest, tallest]) {
      const box = heldBox(heightM);
      expect(KEEP_OUT.boxHits({ id: 'surfacer', ...box }).map((w) => `${w.faceId}@${w.poseId}`)).toEqual([]);
    }
  });

  it('sits ≥ beam/2 + 1.0 from every shore (the island included) and on open water', () => {
    expect(insideWater(CORE_PROBE_LAKE, spot.x, spot.z)).toBe(true);
    expect(shoreDistance(CORE_PROBE_LAKE, spot.x, spot.z)).toBeGreaterThanOrEqual(beam / 2 + 1.0);
  });

  it('holds ≥ 0.06 NDC from every padded face at the desktop and 768 station poses', () => {
    const box = heldBox(tallest);
    const found = minFaceGap(stationPoses(['desktop', 'tablet']), (pose) => boxNdc(pose.camera, pose.viewport, box.center, box.half));
    expect(found.gap, found.at).toBeGreaterThanOrEqual(NDC_MIN);
  });

  it('its beat request sphere (what the bus projects) holds ≥ 0.06 NDC too, for every height the slot may cast', () => {
    for (const heightM of [shortest, tallest]) {
      const sphere = surfacerBeatSphere(spot, surfacerHeights(spot, heightM), beam, { x: 0, y: 0, z: 0, r: 0 });
      const found = minFaceGap(stationPoses(['desktop', 'tablet']), (pose) => sphereNdc(pose.camera, pose.viewport, [sphere.x, sphere.y, sphere.z], sphere.r));
      expect(found.gap, found.at).toBeGreaterThanOrEqual(NDC_MIN);
    }
  });

  it('portrait: clear of the 390 data and caption bands, or suppressed there — and only when it must be', () => {
    const box = heldBox(tallest);
    const conflicts = portraitBandConflicts((pose) => boxNdc(pose.camera, pose.viewport, box.center, box.half));
    if (portrait === false) expect(conflicts.length, 'portrait:false must be necessary').toBeGreaterThan(0);
    else expect(conflicts).toEqual([]);
  });
});

describe('core actor probe: the floaters', () => {
  for (const floater of CORE_PROBE_FLOATERS) {
    const slot = coreProbeSlot(floater.slotId);
    const beam = slot.maxWidthM;
    const tallest = slot.height.max;
    const samples = discSamples(floater.disc, 3, 16);
    const ceiling = SURFACE_Y + tallest + 1.5;
    // The highest a floated body reaches: the tall-body draft (the smallest), the default lift cap, a wave crest.
    const lift = Math.min(BREACH_LIFT_DEFAULT_M, Math.max(0, maxBreachLift(floater.headroomBelowY, SURFACE_Y, tallest, DRAFT_FRAC_TALL)));
    const top = SURFACE_Y + (1 - DRAFT_FRAC_TALL) * tallest + lift + 0.06;

    it(`${floater.slotId}: every disc sample is open water ≥ max(0.8, beam/2 + 0.3) from a shore`, () => {
      const need = Math.max(0.8, beam / 2 + 0.3);
      for (const [x, z] of samples) expect(shoreDistance(CORE_PROBE_LAKE, x, z), `${x},${z}`).toBeGreaterThanOrEqual(need);
    });

    it(`${floater.slotId}: pins headroomBelowY = min over the disc of headroomAt(...).below`, () => {
      let below = Infinity;
      for (const [x, z] of samples) below = Math.min(below, KEEP_OUT.headroomAt(x, z, { floor: SURFACE_Y, ceiling, r: beam / 2 }).below);
      expect(floater.headroomBelowY).toBeCloseTo(below, 6);
    });

    it(`${floater.slotId}: the breach clamp holds at every disc sample`, () => {
      for (const [x, z] of samples) {
        const below = KEEP_OUT.headroomAt(x, z, { floor: SURFACE_Y, ceiling, r: beam / 2 }).below;
        // The lifted body's top stays 0.3 m under the headroom.
        expect(SURFACE_Y + (1 - DRAFT_FRAC_TALL) * tallest + lift + 0.3, `${x},${z}`).toBeLessThanOrEqual(below + 1e-9);
      }
    });

    it(`${floater.slotId}: the floated box clears every wedge over the whole disc`, () => {
      for (const [x, z] of samples) {
        const box = { id: floater.slotId, center: [x, (SURFACE_Y + top) / 2, z] as [number, number, number], half: [beam / 2, (top - SURFACE_Y) / 2, beam / 2] as [number, number, number] };
        expect(KEEP_OUT.boxHits(box).map((w) => `${w.faceId}@${w.poseId}`), `${x},${z}`).toEqual([]);
      }
    });
  }

  it('the discs and the surfacer spot never overlap (bodies included)', () => {
    const bodies = [
      ...CORE_PROBE_FLOATERS.map((f) => ({ x: f.disc.x, z: f.disc.z, r: f.disc.r + coreProbeSlot(f.slotId).maxWidthM / 2 })),
      { x: CORE_PROBE_SURFACER.spot.x, z: CORE_PROBE_SURFACER.spot.z, r: coreProbeSlot(CORE_PROBE_SURFACER.slotId).maxWidthM / 2 },
    ];
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        expect(Math.hypot(bodies[i].x - bodies[j].x, bodies[i].z - bodies[j].z)).toBeGreaterThan(bodies[i].r + bodies[j].r);
      }
    }
  });
});

describe('core actor probe: the wader', () => {
  const slot = coreProbeSlot(CORE_PROBE_WADER.slotId);
  const { anchor, edge } = CORE_PROBE_WADER;

  it('rests on dry ground and walks to a wet edge just inside the rim', () => {
    expect(shoreDistance(CORE_PROBE_LAKE, anchor.x, anchor.z)).toBeLessThan(0);
    expect(insideWater(CORE_PROBE_LAKE, edge[0], edge[1])).toBe(true);
    expect(shoreDistance(CORE_PROBE_LAKE, edge[0], edge[1])).toBeLessThan(0.5);
  });

  it('walks clear of every wedge (the envelope box along the whole walk)', () => {
    const steps = Math.ceil(Math.hypot(edge[0] - anchor.x, edge[1] - anchor.z) / 0.1);
    const h = slot.height.max;
    const half = slot.maxWidthM / 2;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = anchor.x + (edge[0] - anchor.x) * t;
      const z = anchor.z + (edge[1] - anchor.z) * t;
      const box = { id: 'wader', center: [x, h / 2, z] as [number, number, number], half: [half, h / 2, half] as [number, number, number] };
      expect(KEEP_OUT.boxHits(box).map((w) => `${w.faceId}@${w.poseId}`), `${x},${z}`).toEqual([]);
    }
  });
});

describe('core actor probe: a coreCastFile pin outside the envelope', () => {
  it('is flagged per role (the keep-out proof covers the slot bands only)', () => {
    const inside = { floater: 1.0, wader: 1.5, surfacer: 2.0, flyer: 2.0 };
    expect(coreProbeEnvelopeWarnings(inside)).toEqual([]);
    expect(coreProbeEnvelopeWarnings({ floater: null, wader: null, surfacer: null, flyer: null })).toEqual([]);
    const outside = coreProbeEnvelopeWarnings({ floater: 1.5, wader: 1.5, surfacer: 1.2, flyer: 2.0 });
    expect(outside.map((w) => w.split(':')[0])).toEqual(['floater', 'surfacer']);
    // R31: a pin over the slot's width is recorded too (a K6 surfacing pin of an in-height, over-wide figure).
    const none = { floater: null, wader: null, surfacer: null, flyer: null };
    const wide = coreProbeEnvelopeWarnings({ ...none, surfacer: 1.8 }, { ...none, surfacer: 1.29, flyer: 2.0 });
    expect(wide).toHaveLength(1);
    expect(wide[0]).toMatch(/^surfacer: width 1\.29 m is over the slot's 1 m/);
    expect(coreProbeEnvelopeWarnings({ ...none, surfacer: 2.0 }, { ...none, surfacer: 1.0 })).toEqual([]);
  });
});

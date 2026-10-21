import { describe, expect, it } from 'vitest';
import {
  DESKTOP_ASPECT,
  figureObstacle,
  figureSamples,
  figureVisibility,
  inFrustum,
  isWasted,
  projectPoint,
  segmentHitsObstacle,
  stationPoses,
  yawedPanel,
  type FigureBox,
  type VisibilityPose,
  type VisibilityResult,
} from '../figure-visibility';
import { auditThemes, MANIFEST_PRESENT, type AuditSlot, type AuditTheme } from './figure-visibility.scenes';
import { KNOWN_OCCLUDED as PLAZA_KNOWN } from './known-occluded/plaza';
import { KNOWN_OCCLUDED as SAKURA_KNOWN } from './known-occluded/sakura';
import { KNOWN_OCCLUDED as MOUNTAIN_KNOWN } from './known-occluded/mountain';
import { KNOWN_OCCLUDED as CLOUDS_KNOWN } from './known-occluded/clouds';

/**
 * W4 — no wasted Pokémon. Every placed wild / pool / statue slot of the four
 * worlds is judged at its station's desktop endpoint and landed 390 pose (a
 * station-less figure — the plaza loiterers — at its best station). A slot is
 * WASTED at a pose when less than half of it is in frame or at least half of
 * the in-frame silhouette is blocked (see figure-visibility.ts for the model
 * and its disclosed limits).
 *
 * KNOWN_OCCLUDED is today's measured failure set (one file per world under
 * `known-occluded/`), each with the reason the Understand pass (and this
 * model) found. The W4 wave empties it. The test
 * fails both ways: a NEW wasted figure is not allowlisted, and an allowlisted
 * figure that became visible must be removed from the list.
 */

type PoseKind = 'desktop' | 'landed390';
const POSE_KINDS: readonly PoseKind[] = ['desktop', 'landed390'];

/** Per-world allowlists (`known-occluded/<world>.ts`). */
const KNOWN_OCCLUDED: Readonly<Record<string, string>> = {
  ...PLAZA_KNOWN,
  ...SAKURA_KNOWN,
  ...MOUNTAIN_KNOWN,
  ...CLOUDS_KNOWN,
};

function posesFor(theme: AuditTheme, slot: AuditSlot, kind: PoseKind): VisibilityPose[] {
  const stations = slot.station === null ? theme.stations : [theme.stations[slot.station]];
  return stations.map((station) => stationPoses(station).find((pose) => pose.id.endsWith(`:${kind}`)) as VisibilityPose);
}

/** Best result over the candidate poses (one pose for station-bound slots). */
function judge(theme: AuditTheme, slot: AuditSlot, kind: PoseKind): VisibilityResult {
  const results = posesFor(theme, slot, kind).map((pose) => figureVisibility(slot.figure, pose, theme.scene, slot.ignore));
  return results.reduce((best, r) => (r.visibleFraction > best.visibleFraction ? r : best));
}

const THEMES = auditThemes();

function currentWasted(): Map<string, VisibilityResult> {
  const wasted = new Map<string, VisibilityResult>();
  for (const theme of THEMES) {
    for (const slot of theme.slots) {
      if (slot.reveal) continue;
      for (const kind of POSE_KINDS) {
        const result = judge(theme, slot, kind);
        if (isWasted(result)) wasted.set(`${theme.id}:${slot.id}:${kind}`, result);
      }
    }
  }
  return wasted;
}

describe.skipIf(!MANIFEST_PRESENT)('W4 figure visibility audit (all four worlds)', () => {
  const wasted = currentWasted();

  it('audits every placed slot of every world', () => {
    const counts = Object.fromEntries(THEMES.map((t) => [t.id, t.slots.length]));
    // plaza: 8 statues + 6 loiter spots; sakura: 14 wilds + 8 grandstand + 8
    // statuary; mountain: 9 wilds + 6 podium + 8 statuary; clouds: 12 wilds + 8 riders.
    expect(counts).toEqual({ plaza: 14, sakura: 30, mountain: 23, clouds: 20 });
  });

  it('finds no NEW wasted figure (fix it, give it a reveal, or — last resort — allowlist it with a reason)', () => {
    const fresh = [...wasted.entries()]
      .filter(([key]) => !(key in KNOWN_OCCLUDED))
      .map(([key, r]) => `${key} on=${r.onScreenFraction.toFixed(2)} occ=${r.occludedFraction.toFixed(2)} [${r.blockers.join(',')}]`);
    expect(fresh).toEqual([]);
  });

  it('has no stale allowlist entry (a fixed figure must leave KNOWN_OCCLUDED)', () => {
    const stale = Object.keys(KNOWN_OCCLUDED).filter((key) => !wasted.has(key));
    expect(stale).toEqual([]);
  });

  it('keeps every allowlist reason written down', () => {
    Object.entries(KNOWN_OCCLUDED).forEach(([key, reason]) => expect(reason.length, key).toBeGreaterThan(5));
  });
});

describe('figure-visibility math', () => {
  const pose: VisibilityPose = { id: 'test', camera: { position: [0, 1.5, 0], target: [0, 1.5, -10], fov: 50 }, aspect: DESKTOP_ASPECT };

  it('projects the look target to the frame centre and rejects points behind the eye', () => {
    const p = projectPoint([0, 1.5, -10], pose.camera, pose.aspect);
    expect(p.ndcX).toBeCloseTo(0);
    expect(p.ndcY).toBeCloseTo(0);
    expect(inFrustum(p)).toBe(true);
    expect(inFrustum(projectPoint([0, 1.5, 5], pose.camera, pose.aspect))).toBe(false);
    // Camera-right is +X for a camera looking down −Z.
    expect(projectPoint([1, 1.5, -10], pose.camera, pose.aspect).ndcX).toBeGreaterThan(0);
  });

  it('blocks a segment through a box but not one passing beside or ending on it', () => {
    const wall = { id: 'wall', center: [0, 1.5, -5] as const, half: [1, 1.5, 0.05] as const };
    expect(segmentHitsObstacle([0, 1.5, 0], [0, 1.5, -10], wall)).toBe(true);
    expect(segmentHitsObstacle([0, 1.5, 0], [3, 1.5, -10], wall)).toBe(false);
    expect(segmentHitsObstacle([0, 1.5, 0], [0, 1.5, -4.95], wall)).toBe(false);
  });

  it('honours a yawed panel (a thin cloth turned 90° no longer spans the view)', () => {
    const facing = yawedPanel('cloth', { x: 0, z: -5, yaw: 0 }, [0, 1.5, 0], [1, 1.5, 0.02]);
    const edgeOn = yawedPanel('cloth', { x: 0, z: -5, yaw: Math.PI / 2 }, [0, 1.5, 0], [1, 1.5, 0.02]);
    expect(segmentHitsObstacle([0.5, 1.5, 0], [0.5, 1.5, -10], facing)).toBe(true);
    expect(segmentHitsObstacle([0.5, 1.5, 0], [0.5, 1.5, -10], edgeOn)).toBe(false);
    // Local offsets rotate with the group (three.js convention).
    const shifted = yawedPanel('p', { x: 0, z: 0, yaw: Math.PI / 2 }, [1, 0, 0], [0.1, 0.1, 0.1]);
    expect(shifted.center[0]).toBeCloseTo(0);
    expect(shifted.center[2]).toBeCloseTo(-1);
  });

  it('scores a clear, a half-hidden and an off-frame figure', () => {
    const figure: FigureBox = { id: 'f', x: 0, z: -10, baseY: 0, heightM: 1.5, widthM: 0.8 };
    const clear = figureVisibility(figure, pose, { obstacles: [] });
    expect(clear).toMatchObject({ onScreenFraction: 1, occludedFraction: 0, visibleFraction: 1, onScreen: true });
    expect(isWasted(clear)).toBe(false);

    const fence = { id: 'fence', center: [0, 0.4, -6] as const, half: [3, 0.4, 0.05] as const };
    const low = figureVisibility(figure, pose, { obstacles: [fence] });
    expect(low.occludedFraction).toBeGreaterThan(0);
    expect(low.occludedFraction).toBeLessThan(1);
    expect(low.blockers).toEqual(['fence']);

    const offFrame = figureVisibility({ ...figure, x: 40 }, pose, { obstacles: [] });
    expect(offFrame.onScreen).toBe(false);
    expect(isWasted(offFrame)).toBe(true);
  });

  it('lets the ground height field hide a figure behind a hill', () => {
    const figure: FigureBox = { id: 'f', x: 0, z: -20, baseY: 0, heightM: 1, widthM: 0.6 };
    const hill = (_x: number, z: number) => (z < -8 && z > -12 ? 3 : 0);
    const r = figureVisibility(figure, pose, { obstacles: [], ground: hill });
    expect(r.blockers).toEqual(['ground']);
    expect(isWasted(r)).toBe(true);
  });

  it('samples a 3 × 3 silhouette grid and shrinks figure occluders', () => {
    const figure: FigureBox = { id: 'f', x: 0, z: -10, baseY: 1, heightM: 2, widthM: 1 };
    const samples = figureSamples(figure, [0, 1.5, 0]);
    expect(samples).toHaveLength(9);
    expect(Math.min(...samples.map((s) => s[1]))).toBeCloseTo(1.3);
    expect(Math.max(...samples.map((s) => s[1]))).toBeCloseTo(2.7);
    const occluder = figureObstacle(figure);
    expect(occluder.half[1] * 2).toBeCloseTo(1.4);
  });

  it('judges each station at its desktop and landed 390 poses', () => {
    const [desktop, landed] = stationPoses({
      id: 's',
      beat: '',
      camera: { position: [0, 2, 0], target: [0, 2, -10], fov: 40 },
      cameraMobile: { position: [0, 2, 0], target: [0, 2, -10], fov: 50 },
      world: { key: 1, fog: 0, practicals: 0, particles: 0 },
      assetGroup: 'critical',
    });
    expect(desktop.id).toBe('s:desktop');
    expect(landed.camera.position[2]).toBeCloseTo(9.75);
    expect(landed.aspect).toBeLessThan(1);
  });
});

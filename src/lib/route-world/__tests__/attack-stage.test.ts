import { describe, expect, it } from 'vitest';
import {
  AIM_SAMPLES,
  aimPath,
  aimPathClears,
  aimPathSamples,
  aimPointAt,
  ATTACK_STAGE_RADIUS_M,
  attackStageKey,
  buildAttackStageTable,
  lookupAim,
  portraitAimOk,
  PORTRAIT_RISE_TOLERANCE_PX,
  STAGE_ZONE_KINDS,
  type AttackStageInput,
  type AttackStageSlot,
  type StageZone,
} from '../attack-stage';
import { ATTACK_TYPES, attackForType } from '../attack-moves';
import { normalizeType } from '../habitat-types';
import { portraitBands, screenPoint, stationPose, themeKeepOut, type KeepOut, type KeepOutPose, type StationBands } from '../data-surfaces';
import type { Vec3 } from '../chapters';
import { SAKURA_DATA_SURFACES } from '@/components/world/themes/sakura/furniture/data-faces';

const theme = SAKURA_DATA_SURFACES;

function bandsFor(pose: KeepOutPose): StationBands {
  const index = theme.stations.findIndex((s) => pose.id.startsWith(`${s.id}:`));
  return portraitBands(theme, index, pose.viewport);
}

describe('attack-stage: contract', () => {
  it('zone kinds are non-type words (lint-safe, pinned)', () => {
    expect([...STAGE_ZONE_KINDS]).toEqual(['turf', 'pool', 'air']);
    for (const kind of STAGE_ZONE_KINDS) expect(normalizeType(kind)).toBeNull();
  });

  it('the sweep radius is the maximum over every type (1.1 m)', () => {
    expect(ATTACK_STAGE_RADIUS_M).toBe(Math.max(...ATTACK_TYPES.map((t) => attackForType(t).radiusM)));
    expect(ATTACK_STAGE_RADIUS_M).toBeCloseTo(1.1);
  });

  it('aimPath passes through source, apex and target; lobs rise over the higher end, air stays direct', () => {
    const from: Vec3 = [0, 1, 0];
    const to: Vec3 = [4, 0, 2];
    const lob = aimPath(from, to, 'turf', 1.5);
    expect(lob.points[1]).toEqual([2, 2.5, 1]);
    const out: [number, number, number] = [0, 0, 0];
    expect(aimPointAt(lob, 0, out)).toEqual([0, 1, 0]);
    expect(aimPointAt(lob, 1, out)).toEqual([4, 0, 2]);
    const mid = aimPointAt(lob, 0.5, out);
    for (let i = 0; i < 3; i += 1) expect(mid[i]).toBeCloseTo(lob.points[1][i]);
    expect(aimPath(from, to, 'pool', 1.5).points[1]).toEqual([2, 2.5, 1]);
    expect(aimPath(from, to, 'air', 1.5).points[1][1]).toBeCloseTo(0.5 + 0.375);
    expect(aimPathSamples(lob)).toHaveLength(AIM_SAMPLES + 1);
  });

  it('aimPathClears checks every chord with the given radius', () => {
    const blocker: Vec3 = [2, 2.4, 1];
    const keepOut: Pick<KeepOut, 'segmentClear'> = {
      segmentClear: (a, b, r = 0) => {
        for (let i = 0; i <= 20; i += 1) {
          const t = i / 20;
          const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          if (Math.hypot(p[0] - blocker[0], p[1] - blocker[1], p[2] - blocker[2]) < 0.2 + r) return false;
        }
        return true;
      },
    };
    const lob = aimPath([0, 1, 0], [4, 0, 2], 'turf', 1.5);
    expect(aimPathClears(lob, keepOut, 0)).toBe(false);
    const low = aimPath([0, 1, 0], [4, 0, 2], 'air', 0);
    expect(aimPathClears(low, keepOut, 0)).toBe(true);
    expect(aimPathClears(low, keepOut, 5)).toBe(false);
  });
});

describe('attack-stage: table on the sakura keep-out', () => {
  const keepOut = themeKeepOut(theme);
  const poses: KeepOutPose[] = [];
  for (let i = 0; i < theme.stations.length; i += 1) {
    poses.push(stationPose(theme, i, 'desktop'), stationPose(theme, i, 'mobile'));
  }
  // A synthetic grid of slot roots and zones per station (no world data: wave 6 commits stage-zones.ts).
  const slots: AttackStageSlot[] = [];
  const zones: StageZone[] = [];
  for (let station = 0; station < theme.stations.length; station += 1) {
    const eye = poses[station * 2].camera.position;
    const target = poses[station * 2].camera.target;
    const fx = target[0] - eye[0];
    const fz = target[2] - eye[2];
    const len = Math.hypot(fx, fz) || 1;
    const [dx, dz] = [fx / len, fz / len];
    for (const [side, depth] of [[-1, 5], [1, 5], [-1, 8], [1, 8]] as const) {
      const x = eye[0] + dx * depth - dz * side * 3;
      const z = eye[2] + dz * depth + dx * side * 3;
      slots.push({ id: `sakura:attack:${station}:${side}:${depth}`, root: [x, 0, z], heightM: 1, station });
    }
    STAGE_ZONE_KINDS.forEach((kind, k) => {
      for (const side of [-1, 1]) {
        const x = eye[0] + dx * 6.5 + dz * side * 1.5;
        const z = eye[2] + dz * 6.5 - dx * side * 1.5;
        zones.push({ id: `sakura:zone:${station}:${kind}:${side}`, world: 'sakura', station, kind, center: [x, k === 2 ? 1.5 : 0, z], radiusM: 1 });
      }
    });
  }
  const input: AttackStageInput = { slots, zones, poses, keepOut, radiusM: ATTACK_STAGE_RADIUS_M, bandsAt: bandsFor, apexM: 0.6 };

  it('is deterministic (same input → identical table, independent of input order)', () => {
    const a = buildAttackStageTable(input);
    const b = buildAttackStageTable({ ...input, slots: [...slots].reverse(), zones: [...zones].reverse() });
    expect(b).toEqual(a);
    expect(JSON.stringify(buildAttackStageTable(input))).toBe(JSON.stringify(a));
  });

  it('every kept entry is clear: segmentClear on every chord, and the 390 rule at portrait poses', () => {
    const table = buildAttackStageTable(input);
    const withBlocked = buildAttackStageTable({ ...input, keepBlocked: true });
    const entries = Object.values(table).flat();
    const all = Object.values(withBlocked).flat();
    // The fixture must exercise both outcomes.
    expect(all.length).toBeGreaterThan(entries.length);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.poseId.endsWith(':desktop'))).toBe(true);
    for (const entry of entries) {
      expect(entry.clear).toBe(true);
      expect(aimPathClears(entry.path, keepOut, ATTACK_STAGE_RADIUS_M)).toBe(true);
      const pose = poses.find((p) => p.id === entry.poseId)!;
      expect(portraitAimOk(entry.path, pose, bandsFor(pose))).toBe(true);
      expect(zones.find((z) => z.id === entry.zoneId)!.station).toBe(slots.find((s) => s.id === entry.slotId)!.station);
    }
    for (const entry of all) if (!entry.clear) expect(entries).not.toContainEqual(entry);
  });

  it('lookupAim returns the ordered list (clear first) or an empty list', () => {
    const table = buildAttackStageTable({ ...input, keepBlocked: true });
    const [key] = Object.keys(table);
    const [poseId, slotId] = key.split('|');
    expect(lookupAim(table, poseId, slotId)).toBe(table[attackStageKey(poseId, slotId)]);
    const list = lookupAim(table, poseId, slotId);
    const firstBlocked = list.findIndex((e) => !e.clear);
    if (firstBlocked >= 0) expect(list.slice(firstBlocked).every((e) => !e.clear)).toBe(true);
    expect(lookupAim(table, 'nope', 'nope')).toEqual([]);
  });

  it('portrait poses reject any path that rises on screen above its source', () => {
    const pose = poses.find((p) => p.kind === 'landed390')!;
    const bands = bandsFor(pose);
    const eye = pose.camera.position;
    const high = aimPath([eye[0], 0.5, eye[2] - 6], [eye[0] + 0.5, 0.5, eye[2] - 7], 'turf', 6);
    expect(portraitAimOk(high, pose, bands)).toBe(false);
    const desktop = poses.find((p) => p.kind === 'desktop')!;
    expect(portraitAimOk(high, desktop, bandsFor(desktop))).toBe(true);
  });

  it('the rise rule alone: a path inside the life band and outside the caption fails only for rising (R35)', () => {
    const pose = poses.find((p) => p.kind === 'landed390')!;
    const bands = bandsFor(pose);
    expect(bands.layout).toBe('portrait');
    const cap = bands.captionRect;
    const { width } = pose.viewport;
    // Every OTHER 390 check holds on every sample (frame, life band, caption).
    const otherChecksHold = (path: ReturnType<typeof aimPath>) =>
      aimPathSamples(path).every((p) => {
        const s = screenPoint(p, pose.camera, pose.viewport);
        if (!s) return false;
        const inCaption = s.x >= cap.x && s.x <= cap.x + cap.w && s.y >= cap.y && s.y <= cap.y + cap.h;
        return s.x >= 0 && s.x <= width && s.y >= bands.life.top && s.y < bands.life.bottom && !inCaption;
      });
    const eye = pose.camera.position;
    const target = pose.camera.target;
    const len = Math.hypot(target[0] - eye[0], target[2] - eye[2]) || 1;
    const [dx, dz] = [(target[0] - eye[0]) / len, (target[2] - eye[2]) / len];
    // A short straight (apex 0) climb in front of the camera: search a small grid for one that
    // stays inside the life band and outside the caption while rising more than the tolerance.
    let found: { up: ReturnType<typeof aimPath>; down: ReturnType<typeof aimPath> } | null = null;
    for (const depth of [4, 5, 6, 7, 8, 10, 12]) {
      for (const lateral of [0, -0.5, 0.5]) {
        for (const baseY of [0, 0.5, 1, 1.5, 2]) {
          const from: Vec3 = [eye[0] + dx * depth - dz * lateral, baseY, eye[2] + dz * depth + dx * lateral];
          const to: Vec3 = [from[0], baseY + 0.3, from[2]];
          const up = aimPath(from, to, 'air', 0);
          const down = aimPath(to, from, 'air', 0);
          const a = screenPoint(from, pose.camera, pose.viewport);
          const b = screenPoint(to, pose.camera, pose.viewport);
          if (!a || !b || a.y - b.y <= PORTRAIT_RISE_TOLERANCE_PX + 1) continue;
          if (otherChecksHold(up) && otherChecksHold(down)) found ??= { up, down };
        }
      }
    }
    expect(found, 'a rising path that passes the band and caption checks').not.toBeNull();
    // Same samples, same bands: only the direction (rise vs fall) differs.
    expect(portraitAimOk(found!.up, pose, bands)).toBe(false);
    expect(portraitAimOk(found!.down, pose, bands)).toBe(true);
  });
});

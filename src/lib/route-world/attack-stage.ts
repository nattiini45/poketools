/**
 * Attack staging contract (D35 Pokémon core round, 3B; wave 6 consumes it).
 *
 * CONTRACT ONLY: no world data lives here. Wave 6 and the staging rounds
 * commit each world's `stage-zones.ts` (zones plus the GENERATED table), and a
 * test re-derives the table and compares it (the allowlist staleness law, C17).
 * So `buildAttackStageTable` runs at test / bake time only: zero runtime CPU,
 * and no geometry at fire time (D23: nothing computed in the ceremony or after
 * reveal).
 *
 * Species- and roster-free: entries are keyed by slot id, and paths are swept
 * with the LARGEST effect radius over every type (`ATTACK_STAGE_RADIUS_M`,
 * 1.1 m), so neither the cast nor the roster invalidates a table.
 *
 * Zone kinds are deliberately NOT type words (`turf | pool | air`), so the
 * committed zone data passes the D18 lint.
 *
 * The 390 rule (portrait poses, `bandsAt(pose).layout === 'portrait'`): every
 * path sample projects inside the life band and the frame width, stays out of
 * the Station Card caption rect, and never rises on screen above its source
 * (paths go down or sideways into the life band, never up across the data).
 */
import { ATTACK_MAX_RADIUS_M } from './attack-moves';
import type { Vec3 } from './chapters';
import { screenPoint, type KeepOut, type KeepOutPose, type StationBands, type WorldId } from './data-surfaces';

export const STAGE_ZONE_KINDS = ['turf', 'pool', 'air'] as const;
export type StageZoneKind = (typeof STAGE_ZONE_KINDS)[number];

export interface StageZone {
  id: string;
  world: WorldId;
  station: number;
  kind: StageZoneKind;
  center: Vec3;
  radiusM: number;
}

/** A quadratic aim path: source, apex (the curve's point at t = 0.5), target. */
export interface AimPath {
  points: readonly [Vec3, Vec3, Vec3];
}

export interface AttackStageEntry {
  slotId: string;
  zoneId: string;
  poseId: string;
  path: AimPath;
  clear: boolean;
}

/** Keyed by `attackStageKey(poseId, slotId)`; each list is ordered, first clear wins. */
export type AttackStageTable = Readonly<Record<string, readonly AttackStageEntry[]>>;

/** Conservative sweep radius: the max over every type's effect radius (1.1 m). */
export const ATTACK_STAGE_RADIUS_M = ATTACK_MAX_RADIUS_M;

/** Chords a path is checked with (segmentClear per chord). */
export const AIM_SAMPLES = 16;

/** Share of the slot's height the effect leaves from (chest height). */
export const AIM_SOURCE_HEIGHT_SHARE = 0.6;

/** An `air` path's apex rises by this share of `apexM` (a flat, direct line). */
export const AIR_APEX_SHARE = 0.25;

/** Screen tolerance of the 390 "never up" rule, CSS px. */
export const PORTRAIT_RISE_TOLERANCE_PX = 1;

export function attackStageKey(poseId: string, slotId: string): string {
  return `${poseId}|${slotId}`;
}

/**
 * Deterministic aim geometry. `turf` and `pool` lob: the apex sits `apexM`
 * above the higher end, over the midpoint. `air` is direct: the apex sits
 * `AIR_APEX_SHARE × apexM` above the midpoint.
 */
export function aimPath(from: Vec3, to: Vec3, kind: StageZoneKind, apexM: number): AimPath {
  const mx = (from[0] + to[0]) / 2;
  const mz = (from[2] + to[2]) / 2;
  const my = kind === 'air' ? (from[1] + to[1]) / 2 + AIR_APEX_SHARE * apexM : Math.max(from[1], to[1]) + apexM;
  return { points: [[from[0], from[1], from[2]], [mx, my, mz], [to[0], to[1], to[2]]] };
}

/**
 * The point at `t ∈ [0, 1]`, written into `out` (no allocation). The curve
 * passes through the apex at t = 0.5: its Bézier control is
 * `2·apex − (source + target)/2`.
 */
export function aimPointAt(path: AimPath, t: number, out: [number, number, number]): [number, number, number] {
  const [a, m, b] = path.points;
  const u = 1 - t;
  for (let i = 0; i < 3; i += 1) {
    const control = 2 * m[i] - (a[i] + b[i]) / 2;
    out[i] = u * u * a[i] + 2 * u * t * control + t * t * b[i];
  }
  return out;
}

/** `samples + 1` points along the path, source to target. */
export function aimPathSamples(path: AimPath, samples = AIM_SAMPLES): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= samples; i += 1) out.push(aimPointAt(path, i / samples, [0, 0, 0]));
  return out;
}

/** Arc length of the sampled path, metres. */
export function aimPathLength(path: AimPath, samples = AIM_SAMPLES): number {
  const pts = aimPathSamples(path, samples);
  let length = 0;
  for (let i = 1; i < pts.length; i += 1) {
    length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  return length;
}

/** Does every chord of the path clear the keep-out with radius `r`? */
export function aimPathClears(path: AimPath, keepOut: Pick<KeepOut, 'segmentClear'>, r: number, samples = AIM_SAMPLES): boolean {
  const pts = aimPathSamples(path, samples);
  for (let i = 1; i < pts.length; i += 1) if (!keepOut.segmentClear(pts[i - 1], pts[i], r)) return false;
  return true;
}

/** The 390 rule at one pose (see the header). Landscape poses always pass. */
export function portraitAimOk(path: AimPath, pose: KeepOutPose, bands: StationBands, samples = AIM_SAMPLES): boolean {
  if (bands.layout !== 'portrait') return true;
  const pts = aimPathSamples(path, samples);
  const source = screenPoint(pts[0], pose.camera, pose.viewport);
  if (!source) return false;
  const cap = bands.captionRect;
  for (const p of pts) {
    const s = screenPoint(p, pose.camera, pose.viewport);
    if (!s) return false;
    if (s.x < 0 || s.x > pose.viewport.width) return false;
    if (s.y < bands.life.top || s.y >= bands.life.bottom) return false;
    if (s.x >= cap.x && s.x <= cap.x + cap.w && s.y >= cap.y && s.y <= cap.y + cap.h) return false;
    if (s.y < source.y - PORTRAIT_RISE_TOLERANCE_PX) return false;
  }
  return true;
}

export interface AttackStageSlot {
  id: string;
  root: Vec3;
  heightM: number;
  station: number;
}

export interface AttackStageInput {
  slots: readonly AttackStageSlot[];
  zones: readonly StageZone[];
  poses: readonly KeepOutPose[];
  keepOut: Pick<KeepOut, 'segmentClear'>;
  /** Conservative effect radius — `ATTACK_STAGE_RADIUS_M` so the table is roster-independent. */
  radiusM: number;
  /** 390 rule: paths only go down or sideways into the life band and clear the Station Card rect. */
  bandsAt: (pose: KeepOutPose) => StationBands;
  /** Lob height of `turf` / `pool` paths, metres (default 1.2). */
  apexM?: number;
  /** Keep blocked candidates (with `clear: false`) for diagnostics. Default false: the table holds clear entries only. */
  keepBlocked?: boolean;
}

/** Default lob height, metres. */
export const DEFAULT_APEX_M = 1.2;

/**
 * Build the per-pose lookup table (TEST / BAKE TIME ONLY). For each pose and
 * slot, every zone of the slot's station is a candidate, ordered by path
 * length then zone id; a candidate is clear when every chord passes
 * `segmentClear(radiusM)` and, at a portrait pose, the 390 rule.
 */
export function buildAttackStageTable(input: AttackStageInput): AttackStageTable {
  const apexM = input.apexM ?? DEFAULT_APEX_M;
  const table: Record<string, AttackStageEntry[]> = {};
  const slots = [...input.slots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const zones = [...input.zones].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const pose of input.poses) {
    const bands = input.bandsAt(pose);
    for (const slot of slots) {
      const source: Vec3 = [slot.root[0], slot.root[1] + AIM_SOURCE_HEIGHT_SHARE * slot.heightM, slot.root[2]];
      const candidates: { entry: AttackStageEntry; length: number }[] = [];
      for (const zone of zones) {
        if (zone.station !== slot.station) continue;
        const path = aimPath(source, zone.center, zone.kind, apexM);
        const clear = aimPathClears(path, input.keepOut, input.radiusM) && portraitAimOk(path, pose, bands);
        if (!clear && !input.keepBlocked) continue;
        candidates.push({ entry: { slotId: slot.id, zoneId: zone.id, poseId: pose.id, path, clear }, length: aimPathLength(path) });
      }
      if (candidates.length === 0) continue;
      candidates.sort(
        (a, b) =>
          Number(b.entry.clear) - Number(a.entry.clear) ||
          a.length - b.length ||
          (a.entry.zoneId < b.entry.zoneId ? -1 : a.entry.zoneId > b.entry.zoneId ? 1 : 0),
      );
      table[attackStageKey(pose.id, slot.id)] = candidates.map((c) => c.entry);
    }
  }
  return table;
}

const NONE: readonly AttackStageEntry[] = [];

/** Ordered candidates (first clear wins; the director tries the next, then skips and logs). */
export function lookupAim(table: AttackStageTable, poseId: string, slotId: string): readonly AttackStageEntry[] {
  return table[attackStageKey(poseId, slotId)] ?? NONE;
}

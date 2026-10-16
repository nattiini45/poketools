/**
 * Stride-matched locomotion (W2 "a walk that is a sliding static model" veto;
 * spec 2026-09-24 §5.1).
 *
 * A walk clip moves the feet a fixed distance per loop. If the figure's root
 * travels faster or slower than that, the feet skate. The fix is to pick
 * speed and clip `timeScale` together so that
 *
 *     speed = timeScale · strideM / clipDurationS
 *
 * The stride comes from ASSET METADATA only — the manifest's rest-pose bounds
 * and Pokédex height — through a body-plan heuristic. Nothing here keys off a
 * species name, type or stat (repo rule).
 *
 * Honesty notes (disclosed, not hidden):
 *  - The stride is a HEURISTIC. Bounds give height and body length, not leg
 *    length; the leg fraction per body plan is a biomechanics rule of thumb
 *    (human leg ≈ 0.45–0.53 H, walk stride ≈ 1.4–1.6 leg per full cycle).
 *    It removes the gross skate; it does not plant feet exactly.
 *  - The model assumes one loop of the `walk` clip is one full gait cycle
 *    (two steps). A rip that loops two cycles reads at half cadence; the
 *    clamp below keeps even that inside a believable range.
 *  - Without a baked clip duration (manifests before v3) there is nothing to
 *    match: `matchGait` reports `matched: false` and keeps timeScale 1.
 *
 * Pure data — no client-only imports.
 */

import type { FigureBounds } from './model-manifest';

export type BodyPlan = 'biped' | 'quadruped' | 'compact';

/** The subset of a manifest entry the gait model reads. */
export interface GaitAsset {
  bounds: FigureBounds;
  /** Pokédex height in metres; `null` → the bounds height, clamped. */
  heightm: number | null;
}

export interface GaitModel {
  bodyPlan: BodyPlan;
  /** Rendered height (m). */
  heightM: number;
  /** Rendered body length along the facing axis (+Z, see `headingYaw`). */
  lengthM: number;
  /** Rendered width (X). */
  widthM: number;
  /** Estimated leg (hip-to-ground) length (m). */
  legM: number;
  /** Ground covered by ONE loop of the walk clip (m). */
  walkStrideM: number;
  /** Ground covered by ONE loop of the run clip (m). */
  runStrideM: number;
}

/** Length/height above which a figure is treated as four-legged. */
export const QUADRUPED_ASPECT = 1.15;
/** Length/height at or below which a figure of `BIPED_MIN_H` or more is upright. */
export const BIPED_ASPECT = 0.8;
export const BIPED_MIN_H = 0.6;

/** Leg length as a fraction of height, per body plan. */
const LEG_FRACTION: Record<BodyPlan, number> = { biped: 0.45, quadruped: 0.55, compact: 0.3 };
/** Walk-cycle stride as a multiple of leg length, per body plan. */
const WALK_STRIDE_PER_LEG: Record<BodyPlan, number> = { biped: 1.45, quadruped: 1.6, compact: 1.3 };
/** A run cycle covers this much more ground than a walk cycle. */
const RUN_STRIDE_FACTOR = 1.7;

export const STRIDE_MIN_M = 0.15;
export const STRIDE_MAX_M = 3.5;

/** Playback-rate window that still reads as the authored gait. */
export const TIME_SCALE_MIN = 0.6;
export const TIME_SCALE_MAX = 1.6;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Classify the body plan from rest-pose proportions (scale-free). */
export function bodyPlanFor(heightM: number, lengthM: number): BodyPlan {
  const aspect = lengthM / Math.max(heightM, 1e-3);
  if (aspect >= QUADRUPED_ASPECT) return 'quadruped';
  if (aspect <= BIPED_ASPECT && heightM >= BIPED_MIN_H) return 'biped';
  return 'compact';
}

/**
 * Gait model from asset metadata. The rendered scale follows
 * `model-manifest.ts` `figureScale` (Pokédex height over bounds height; the
 * bounds height clamped to [0.3, 2] m when the height is unknown).
 */
export function gaitModelFor(asset: GaitAsset): GaitModel {
  const { min, max } = asset.bounds;
  const rawH = Math.max(max[1] - min[1], 1e-3);
  const targetH = asset.heightm ?? clamp(rawH, 0.3, 2);
  const scale = targetH / rawH;
  const heightM = rawH * scale;
  const lengthM = Math.max(max[2] - min[2], 1e-3) * scale;
  const widthM = Math.max(max[0] - min[0], 1e-3) * scale;
  const bodyPlan = bodyPlanFor(heightM, lengthM);
  const legM = heightM * LEG_FRACTION[bodyPlan];
  const walkStrideM = clamp(legM * WALK_STRIDE_PER_LEG[bodyPlan], STRIDE_MIN_M, STRIDE_MAX_M);
  const runStrideM = clamp(walkStrideM * RUN_STRIDE_FACTOR, STRIDE_MIN_M, STRIDE_MAX_M * RUN_STRIDE_FACTOR);
  return { bodyPlan, heightM, lengthM, widthM, legM, walkStrideM, runStrideM };
}

/**
 * The clip timeScale at which a loop of `clipDurationS` covering `strideM`
 * matches `speedMps`, clamped to the believable window. Degenerate inputs
 * (no duration, no stride, standing still) return 1.
 */
export function timeScaleFor(speedMps: number, clipDurationS: number, strideM: number): number {
  if (!(clipDurationS > 0) || !(strideM > 0) || !(speedMps > 0)) return 1;
  return clamp((speedMps * clipDurationS) / strideM, TIME_SCALE_MIN, TIME_SCALE_MAX);
}

export interface GaitMatch {
  /** Root speed to move at (m/s). */
  speedMps: number;
  /** Clip playback rate. */
  timeScale: number;
  /** False when no duration was available and the gait is unmatched. */
  matched: boolean;
}

/**
 * Choose speed and timeScale TOGETHER. The desired speed is pulled into the
 * range the clip can honestly play (`TIME_SCALE_MIN..MAX` × natural speed),
 * so the returned pair always satisfies speed = timeScale · stride / duration
 * — the feet cannot slide, even when the authored speed asked for more.
 */
export function matchGait(desiredSpeedMps: number, clipDurationS: number | null | undefined, strideM: number): GaitMatch {
  const desired = Math.max(desiredSpeedMps, 0);
  if (!clipDurationS || !(clipDurationS > 0) || !(strideM > 0)) {
    return { speedMps: desired, timeScale: 1, matched: false };
  }
  const natural = strideM / clipDurationS;
  const speedMps = clamp(desired, natural * TIME_SCALE_MIN, natural * TIME_SCALE_MAX);
  return { speedMps, timeScale: speedMps / natural, matched: true };
}

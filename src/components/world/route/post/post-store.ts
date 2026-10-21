import type { EffectComposer } from 'postprocessing';

/**
 * The mounted post-processing composer, if any, for consumers outside the
 * React tree — the capture harness presents through it so stills carry the
 * same Bloom / AgX the visitor sees (ADR-0001). `null` while the quality
 * ladder has post switched off, in which case the plain renderer is the truth.
 */
let composer: EffectComposer | null = null;

export function setPostComposer(next: EffectComposer | null): void {
  composer = next;
}

export function getPostComposer(): EffectComposer | null {
  return composer;
}

/**
 * Live render telemetry for the debug overlay (C-032), written by the canvas'
 * frame sampler and read by `RouteDebugOverlay`'s rAF loop. Kept in this
 * module — the one bridge module with no runtime imports — so the overlay can
 * read it without dragging `@react-three/fiber` into the Lite payload.
 */
export interface RouteTelemetry {
  /** Smoothed frames per second (EMA over ~10 frames). */
  fps: number;
  /** Last inter-frame delta in milliseconds (unsmoothed, for hitches). */
  frameMs: number;
  /** Draw calls in the last presented frame (scene + post passes). */
  calls: number;
  /** Triangles submitted in the last presented frame. */
  triangles: number;
  /** Index into `QUALITY_LADDER` currently applied. */
  rung: number;
  /** `renderer.getPixelRatio()` at the last sample. */
  dpr: number;
}

let telemetry: RouteTelemetry | null = null;

export function publishRouteTelemetry(next: RouteTelemetry): void {
  telemetry = next;
}

export function getRouteTelemetry(): RouteTelemetry | null {
  return telemetry;
}

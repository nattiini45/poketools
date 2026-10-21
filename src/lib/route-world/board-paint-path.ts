/**
 * The shared board paint path (C-100 r2, criterion 4) — the ENFORCEMENT the
 * legibility floors require. The bar's clause is "floors enforced in shared
 * paint code, not per-theme": this module IS that shared paint code, and the
 * legibility math in `./legibility` is its only floor source. A theme cannot
 * opt below the floors BY CONSTRUCTION — the allocation is clamped before a
 * canvas exists and the font clamp is derived in the same call.
 *
 * ADOPTION CONTRACT (C-102..105, one line): route every board page through
 * `paintBoardPage({ current: <theme's declared board constants>, station,
 * boardWorldWidthM, paint })` — the canvas is then allocated at the theme's
 * ≥2× floor (or above, if the request already clears it) and every text line
 * painted through `tools.fontPx` is floored at the station's pose-derived
 * minimum. Nothing sub-floor can ship. `onSubFloor: 'reject'` is the strict
 * variant for audit paths: a sub-floor allocation REQUEST throws the named
 * `[route-world] board texture … misses the ≥2× legibility floor` error
 * instead of being raised.
 *
 * Painter coordinate space: painters keep drawing in their DECLARED constants
 * (`current`) — the shared call scales the context up to the floored canvas,
 * so an existing 1024×592 painter ships at 2048×1184 without a single
 * coordinate change. Font px handed to `tools.fontPx` are painter-space px;
 * the clamp converts the shipped-texture floor back through the same scale.
 *
 * Pure planning (`planBoardPaint` / `resolveBoardAllocation` /
 * `applyStationFontFloor`) is node-testable; only `paintBoardPage` touches
 * the DOM.
 */

import type { RouteStation } from './chapters';
import {
  assertBoardTextureFloor,
  boardTextureFloor,
  stationFontFloorPx,
  type TextureSize,
} from './legibility';

/** How a sub-floor allocation REQUEST is handled: raised to the floor, or a named error. */
export type BoardPaintMode = 'clamp' | 'reject';

export interface BoardAllocationPlan {
  /** Actual canvas width in px — never below the floor in clamp mode. */
  width: number;
  /** Actual canvas height in px — never below the floor in clamp mode. */
  height: number;
  /** True when the request was sub-floor and the plan raised it. */
  clamped: boolean;
}

/**
 * The constructive clamp: any allocation request resolves to at least the
 * theme's ≥2× board-texture floor, per axis, and reports whether it had to
 * raise the request. This is the function that makes sub-floor allocation
 * impossible through the shared path — the request never reaches a canvas.
 */
export function resolveBoardAllocation(request: TextureSize, current: TextureSize): BoardAllocationPlan {
  const floor = boardTextureFloor(current);
  const width = Math.max(request.width, floor.width);
  const height = Math.max(request.height, floor.height);
  return { width, height, clamped: width !== request.width || height !== request.height };
}

/**
 * The named rejection: a sub-floor request throws the legibility module's
 * distinct `[route-world] board texture … misses the ≥2× legibility floor`
 * error. At-floor and above requests pass.
 */
export function assertBoardAllocation(request: TextureSize, current: TextureSize): void {
  assertBoardTextureFloor(request.width, request.height, current);
}

export interface BoardFontClamp {
  /** The pose-derived floor in SHIPPED (floored-canvas) texture px. */
  floorTexPx: number;
  /** The same floor in PAINTER-space px (what a painter actually passes). */
  floorPaintPx: number;
  /** Clamp a painter-space requested font size up to the floor. */
  paintPx: (requestedPx: number) => number;
}

/**
 * The font-floor half of the enforcement: derive the station's pose-based
 * minimum (1440 pose AND landed-390 pose, per `stationFontFloorPx`) against
 * the SHIPPED texture width, then convert it back to painter space through
 * the allocation's X scale so a declared-space painter is clamped at the
 * same on-screen size.
 */
export function applyStationFontFloor(
  station: RouteStation,
  board: { texW: number; worldW: number },
  painterScaleX: number,
): BoardFontClamp {
  const floorTexPx = stationFontFloorPx(station, board);
  const floorPaintPx = Math.ceil(floorTexPx / painterScaleX);
  return { floorTexPx, floorPaintPx, paintPx: (n: number) => Math.max(Math.ceil(n), floorPaintPx) };
}

export interface BoardPaintPlan {
  allocation: BoardAllocationPlan;
  fontFloorTexPx: number;
  fontFloorPaintPx: number;
}

export interface PlanBoardPaintParams {
  /** The theme's CURRENT declared board constants (e.g. plaza 1024×592). */
  current: TextureSize;
  /** Explicit allocation request; defaults to the floor itself. */
  request?: TextureSize;
  /** Sub-floor handling (default `'clamp'`); `'reject'` throws the named error. */
  onSubFloor?: BoardPaintMode;
  /** The station whose pose math derives the font floor. */
  station: RouteStation;
  /** Real-world width of the board face in metres. */
  boardWorldWidthM: number;
}

/** The pure core `paintBoardPage` executes — node-testable end to end. */
export function planBoardPaint(params: PlanBoardPaintParams): BoardPaintPlan {
  const requested = params.request ?? boardTextureFloor(params.current);
  if (params.onSubFloor === 'reject') {
    assertBoardAllocation(requested, params.current);
  }
  const allocation = resolveBoardAllocation(requested, params.current);
  const floor = boardTextureFloor(params.current);
  if (allocation.width < floor.width || allocation.height < floor.height) {
    // Defensive invariant of the shared path: a plan's allocation is never
    // sub-floor (resolveBoardAllocation raises; reject mode threw above).
    throw new Error('[route-world] board paint path invariant failed: sub-floor allocation escaped the clamp');
  }
  const font = applyStationFontFloor(
    params.station,
    { texW: allocation.width, worldW: params.boardWorldWidthM },
    allocation.width / params.current.width,
  );
  return { allocation, fontFloorTexPx: font.floorTexPx, fontFloorPaintPx: font.floorPaintPx };
}

export interface BoardPaintTools {
  /** Clamp a painter-space font size up to the station's floor. */
  fontPx: (requestedPx: number) => number;
  /** The floor in painter-space px, for painters that want to display it. */
  fontFloorPx: number;
}

export interface PaintBoardPageParams extends PlanBoardPaintParams {
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) => void;
  /**
   * Repaint into this canvas instead of allocating a new one (a surface
   * painted on a clock, e.g. the plaza ticker). It is resized to the
   * allocation when it differs and cleared before `paint`; its 2D context
   * keeps the attributes it was first created with (a caller that reads the
   * pixels back creates it with `willReadFrequently`).
   */
  canvas?: HTMLCanvasElement;
}

export interface BoardPaintResult {
  canvas: HTMLCanvasElement;
  allocation: BoardAllocationPlan;
  fontFloorTexPx: number;
  fontFloorPaintPx: number;
}

/**
 * THE shared board paint call. Allocates the page canvas through the clamp
 * (or the named rejection), scales the context so `paint` draws in the
 * declared constants' coordinate space, and hands the painter the station's
 * font clamp. Client-only — the render path (Board-style components) calls
 * this where `document` exists.
 */
export function paintBoardPage(params: PaintBoardPageParams): BoardPaintResult {
  if (typeof document === 'undefined') {
    throw new Error('[route-world] paintBoardPage is a client paint path — no document in this environment');
  }
  const { allocation, fontFloorTexPx, fontFloorPaintPx } = planBoardPaint(params);
  const canvas = params.canvas ?? document.createElement('canvas');
  const reused = params.canvas !== undefined && canvas.width === allocation.width && canvas.height === allocation.height;
  if (!reused) {
    canvas.width = allocation.width;
    canvas.height = allocation.height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[route-world] paintBoardPage could not acquire a 2D context');
  }
  if (reused) {
    // A resize resets the context; a reused canvas of the same size is reset here.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  const tools: BoardPaintTools = {
    fontPx: (n: number) => Math.max(Math.ceil(n), fontFloorPaintPx),
    fontFloorPx: fontFloorPaintPx,
  };
  ctx.save();
  try {
    ctx.scale(allocation.width / params.current.width, allocation.height / params.current.height);
    params.paint(ctx, params.current.width, params.current.height, tools);
  } finally {
    // A painter that throws still leaves the context as it found it: a reused canvas
    // (`params.canvas`) would otherwise keep its clip / alpha / scale and an extra saved
    // state into every later repaint — the reset above clears only pixels and the transform.
    ctx.restore();
  }
  return { canvas, allocation, fontFloorTexPx, fontFloorPaintPx };
}

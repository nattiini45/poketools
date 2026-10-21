/**
 * Legibility floors (C-100 criterion 4) — the shared enforcement the theme
 * reworks (C-102..105) consume. Two floors, both derived, never per-theme:
 *
 *  1. Board-texture resolution: a rework's painted board face must be at
 *     least 2× the theme's CURRENT declared texture constants — plaza's
 *     1024×592 (board-painters.ts) floors at 2048×1184; sakura/mountain/
 *     clouds' 1280×720 (each content/paint.ts) floor at 2560×1440.
 *
 *  2. Font px minimums, derived DETERMINISTICALLY from the station's own
 *     pose math (`RouteStation.camera` / `.cameraMobile`): how large a
 *     board-texture pixel line must be painted so the line is still
 *     readable on screen. The critical class is the LANDED 390 pose — the
 *     mobile endpoint pulled straight back by the engine's MAX_PULLBACK
 *     (`endpoint + 9.75 × unit(target→cam)`)
 *     — because authored mobile endpoints sit closer and UNDER-derive:
 *     floors from them ship unreadable-at-landed fonts. 1440 is the other
 *     class (bar: "crop-readable at 1440 and landed 390"); the binding
 *     floor is the max over both.
 *
 * Pure math — no client-only imports, unit-testable in node.
 */

import type { CameraEndpoint, RouteStation } from './chapters';

/** Board faces the reworks paint must be at least this multiple of current. */
export const BOARD_TEXTURE_FLOOR_MULTIPLIER = 2;

/** The engine's mobile pullback (CameraRig MAX_PULLBACK), restated for pose math. */
export const LANDED_PULLBACK_M = 9.75;

/** Capture viewport heights of record (capture-route VIEWPORTS). */
export const VIEWPORT_H_390 = 844;
export const VIEWPORT_H_1440 = 900;

/**
 * Minimum on-screen line height (device px) a board text line must render
 * at to count as crop-readable — the readability threshold the font floor
 * back-solves from.
 */
export const READABLE_LINE_PX = 8;

export interface TextureSize {
  width: number;
  height: number;
}

/**
 * The floor a theme's CURRENT declared board constants imply: ≥2× each axis.
 * `boardTextureFloor({ width: 1024, height: 592 })` is exactly
 * `{ width: 2048, height: 1184 }`; `({ width: 1280, height: 720 })` →
 * `{ width: 2560, height: 1440 }`.
 */
export function boardTextureFloor(current: TextureSize): TextureSize {
  return {
    width: current.width * BOARD_TEXTURE_FLOOR_MULTIPLIER,
    height: current.height * BOARD_TEXTURE_FLOOR_MULTIPLIER,
  };
}

/** Whether a painted board size meets the ≥2× floor for the current constants. */
export function meetsBoardTextureFloor(width: number, height: number, current: TextureSize): boolean {
  const floor = boardTextureFloor(current);
  return width >= floor.width && height >= floor.height;
}

/** Enforcement hook: throws with a distinct message when the floor is missed. */
export function assertBoardTextureFloor(width: number, height: number, current: TextureSize): void {
  if (!meetsBoardTextureFloor(width, height, current)) {
    const floor = boardTextureFloor(current);
    throw new Error(
      `[route-world] board texture ${width}x${height} misses the ≥${BOARD_TEXTURE_FLOOR_MULTIPLIER}× legibility floor ${floor.width}x${floor.height} (current constants ${current.width}x${current.height})`,
    );
  }
}

/** Unit vector from the endpoint's target toward its camera position. */
function unitTargetToCam(endpoint: CameraEndpoint): readonly [number, number, number] {
  const dx = endpoint.position[0] - endpoint.target[0];
  const dy = endpoint.position[1] - endpoint.target[1];
  const dz = endpoint.position[2] - endpoint.target[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return [0, 0, 1];
  return [dx / len, dy / len, dz / len];
}

/**
 * The LANDED camera pose: authored endpoint pulled straight back by the
 * engine's MAX_PULLBACK along unit(target→cam) — the same geometry the rig
 * applies below the mobile breakpoint (the colinear dolly
 * means one endpoint move moves both classes). Target and fov are unchanged.
 */
export function landedEndpoint(endpoint: CameraEndpoint, pullbackM: number = LANDED_PULLBACK_M): CameraEndpoint {
  const [ux, uy, uz] = unitTargetToCam(endpoint);
  return {
    position: [
      endpoint.position[0] + ux * pullbackM,
      endpoint.position[1] + uy * pullbackM,
      endpoint.position[2] + uz * pullbackM,
    ],
    target: endpoint.target,
    fov: endpoint.fov,
  };
}

/** Eye distance from the board target of a camera endpoint. */
export function eyeDistance(endpoint: CameraEndpoint): number {
  return Math.hypot(
    endpoint.position[0] - endpoint.target[0],
    endpoint.position[1] - endpoint.target[1],
    endpoint.position[2] - endpoint.target[2],
  );
}

export interface BoardFaceGeometry {
  /** Painted texture width in px (the constants the board was painted at). */
  texW: number;
  /** Real-world width of the board face in metres. */
  worldW: number;
}

/**
 * Minimum board-texture px height a text line needs so it renders at least
 * `readablePx` screen px from a camera at `distanceM` with vertical `fovDeg`
 * on a `viewportH`-px-tall frame.
 *
 * Screen px per metre = viewportH / (2 · d · tan(fov/2)); a line of
 * `fontPx` texture px spans `fontPx · worldW / texW` metres on the face, so
 * the floor back-solves to
 * `ceil(readablePx · texW / (worldW · pxPerMetre))`.
 */
export function minBoardFontPx(params: {
  board: BoardFaceGeometry;
  distanceM: number;
  fovDeg: number;
  viewportH: number;
  readablePx?: number;
}): number {
  const readable = params.readablePx ?? READABLE_LINE_PX;
  const pxPerMetre = params.viewportH / (2 * params.distanceM * Math.tan((params.fovDeg * Math.PI) / 360));
  const metresPerTexturePx = params.board.worldW / params.board.texW;
  return Math.ceil(readable / (pxPerMetre * metresPerTexturePx));
}

/**
 * The font floor for one station and board face: the MAX of the 1440 pose
 * and the LANDED 390 pose derivations, so a line that passes can never be
 * readable on desktop but unreadable on the landed mobile camera. The 390
 * half always lands through `landedEndpoint` — never the authored endpoint.
 */
export function stationFontFloorPx(
  station: RouteStation,
  board: BoardFaceGeometry,
  opts?: { readablePx?: number; pullbackM?: number },
): number {
  const desktop = minBoardFontPx({
    board,
    distanceM: eyeDistance(station.camera),
    fovDeg: station.camera.fov,
    viewportH: VIEWPORT_H_1440,
    readablePx: opts?.readablePx,
  });
  const landed = landedEndpoint(station.cameraMobile, opts?.pullbackM);
  const mobile = minBoardFontPx({
    board,
    distanceM: eyeDistance(landed),
    fovDeg: landed.fov,
    viewportH: VIEWPORT_H_390,
    readablePx: opts?.readablePx,
  });
  return Math.max(desktop, mobile);
}

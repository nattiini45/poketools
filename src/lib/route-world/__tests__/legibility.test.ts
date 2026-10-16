import { describe, expect, it } from 'vitest';
import type { CameraEndpoint, RouteStation } from '../chapters';
import {
  BOARD_TEXTURE_FLOOR_MULTIPLIER,
  boardTextureFloor,
  assertBoardTextureFloor,
  eyeDistance,
  LANDED_PULLBACK_M,
  landedEndpoint,
  meetsBoardTextureFloor,
  minBoardFontPx,
  stationFontFloorPx,
  VIEWPORT_H_390,
  VIEWPORT_H_1440,
} from '../legibility';

/**
 * C-100 criterion 4 — the shared legibility floors: board textures ≥2× the
 * theme's CURRENT declared constants, and font px floors derived from the
 * station's OWN pose math with the 390 floor taken from the LANDED pose
 * (endpoint + 9.75 × unit(target→cam)) — authored endpoints sit closer and
 * under-derive.
 */

describe('boardTextureFloor — ≥2× the declared constants', () => {
  it('plaza constants 1024×592 (board-painters.ts) floor at exactly 2048×1184', () => {
    expect(boardTextureFloor({ width: 1024, height: 592 })).toEqual({ width: 2048, height: 1184 });
  });

  it('sakura/mountain/clouds constants 1280×720 (content/paint.ts) floor at exactly 2560×1440', () => {
    expect(boardTextureFloor({ width: 1280, height: 720 })).toEqual({ width: 2560, height: 1440 });
  });

  it('meets / assert enforce the floor per axis with a distinct message', () => {
    expect(meetsBoardTextureFloor(2048, 1184, { width: 1024, height: 592 })).toBe(true);
    expect(meetsBoardTextureFloor(2048, 1183, { width: 1024, height: 592 })).toBe(false);
    expect(meetsBoardTextureFloor(2047, 1184, { width: 1024, height: 592 })).toBe(false);
    expect(() => assertBoardTextureFloor(1280, 720, { width: 1280, height: 720 })).toThrow(
      new RegExp(`≥${BOARD_TEXTURE_FLOOR_MULTIPLIER}× legibility floor 2560x1440`),
    );
    expect(() => assertBoardTextureFloor(2560, 1440, { width: 1280, height: 720 })).not.toThrow();
  });
});

/** Clouds pulse mobile literals (theme.ts) — the landed pose of record. */
const PULSE_MOBILE: CameraEndpoint = {
  position: [2.26, 4.16, -2.72],
  target: [-6.5, 4.5, -13.0],
  fov: 52,
};

describe('landedEndpoint — the LANDED 390 pose math', () => {
  it('lands the endpoint + 9.75 × unit(target→cam), computed independently', () => {
    const [ux, uy, uz] = [
      (PULSE_MOBILE.position[0] - PULSE_MOBILE.target[0]) / eyeDistance(PULSE_MOBILE),
      (PULSE_MOBILE.position[1] - PULSE_MOBILE.target[1]) / eyeDistance(PULSE_MOBILE),
      (PULSE_MOBILE.position[2] - PULSE_MOBILE.target[2]) / eyeDistance(PULSE_MOBILE),
    ];
    const landed = landedEndpoint(PULSE_MOBILE);
    expect(landed.position[0]).toBeCloseTo(PULSE_MOBILE.position[0] + ux * LANDED_PULLBACK_M, 12);
    expect(landed.position[1]).toBeCloseTo(PULSE_MOBILE.position[1] + uy * LANDED_PULLBACK_M, 12);
    expect(landed.position[2]).toBeCloseTo(PULSE_MOBILE.position[2] + uz * LANDED_PULLBACK_M, 12);
    expect(landed.target).toBe(PULSE_MOBILE.target);
    expect(landed.fov).toBe(PULSE_MOBILE.fov);
    // Cross-check against the landed pose the clouds theme records in its
    // cameraMobile comment ([8.5818, 3.9146, 4.6987]).
    expect(landed.position[0]).toBeCloseTo(8.5818, 3);
    expect(landed.position[1]).toBeCloseTo(3.9146, 3);
    expect(landed.position[2]).toBeCloseTo(4.6987, 3);
  });

  it('the colinear dolly: landed distance = authored base + 9.75 exactly', () => {
    const landed = landedEndpoint(PULSE_MOBILE);
    expect(eyeDistance(landed)).toBeCloseTo(eyeDistance(PULSE_MOBILE) + LANDED_PULLBACK_M, 9);
  });
});

describe('minBoardFontPx / stationFontFloorPx — pose-derived font floors', () => {
  const station: RouteStation = {
    id: 'pulse',
    beat: 'probe',
    camera: { position: [0, 3.4, -8], target: [0, 1.5, 0], fov: 45 },
    cameraMobile: PULSE_MOBILE,
    world: { key: 1, fog: 0.006, practicals: 0, particles: 0 },
    assetGroup: 'critical',
  };
  const board = { texW: 2048, worldW: 6 };

  it('is deterministic and integral', () => {
    const a = stationFontFloorPx(station, board);
    const b = stationFontFloorPx(station, board);
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
  });

  it('grows with the readability threshold; a wider board face lowers the px floor', () => {
    const floor8 = stationFontFloorPx(station, board);
    const floor12 = stationFontFloorPx(station, board, { readablePx: 12 });
    expect(floor12).toBeGreaterThan(floor8);
    // The same texture spread over more metres → each texture px is larger
    // on screen → fewer texture px needed for readability.
    expect(stationFontFloorPx(station, { texW: 2048, worldW: 12 })).toBeLessThan(floor8);
  });

  it('derives the 390 floor from the LANDED pose — authored endpoints under-derive', () => {
    // The same mobile class evaluated at the AUTHORED endpoint (what a
    // theme authoring from its own endpoint would compute) vs the LANDED
    // pose the rig actually lands (same 390 viewport, same fov, same board):
    const landedFloor = stationFontFloorPx(station, board);
    const authoredFloor = minBoardFontPx({
      board,
      distanceM: eyeDistance(station.cameraMobile),
      fovDeg: station.cameraMobile.fov,
      viewportH: VIEWPORT_H_390,
    });
    expect(eyeDistance(landedEndpoint(station.cameraMobile))).toBeGreaterThan(eyeDistance(station.cameraMobile));
    expect(landedFloor).toBeGreaterThan(authoredFloor);
  });

  it('the desktop 1440 leg runs through the desktop pose', () => {
    const desktopOnly = minBoardFontPx({
      board,
      distanceM: eyeDistance(station.camera),
      fovDeg: station.camera.fov,
      viewportH: VIEWPORT_H_1440,
    });
    // The floor is the max of the two legs, so it can never drop below the
    // desktop derivation.
    expect(stationFontFloorPx(station, board)).toBeGreaterThanOrEqual(desktopOnly);
  });
});

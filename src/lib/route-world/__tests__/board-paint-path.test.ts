import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraEndpoint, RouteStation } from '../chapters';
import {
  boardTextureFloor,
  eyeDistance,
  minBoardFontPx,
  stationFontFloorPx,
  VIEWPORT_H_1440,
} from '../legibility';
import {
  applyStationFontFloor,
  assertBoardAllocation,
  planBoardPaint,
  resolveBoardAllocation,
  paintBoardPage,
  type PlanBoardPaintParams,
} from '../board-paint-path';

/**
 * C-100 r2 criterion 4 — the shared board paint path ENFORCES the
 * legibility floors: a sub-floor allocation request is clamped up by
 * construction (clamp mode) or rejected with the named error (reject
 * mode), and the station's pose-derived font floor is applied in the same
 * shared call. The probe world (ProbeBoard.tsx) consumes this end to end;
 * these tests pin the contract the themes adopt (C-102..105).
 */

/** Plaza-class declared constants (board-painters.ts) — the sub-floor class. */
const PLAZA = { width: 1024, height: 592 };
/** Theme-class declared constants (content/paint.ts). */
const THEME = { width: 1280, height: 720 };

/** The probe pulse station literals (probe-theme.ts) — the pose of record. */
const PULSE: RouteStation = {
  id: 'pulse',
  beat: 'probe',
  camera: { position: [0, 3.4, -8], target: [0, 1.5, 0], fov: 45 },
  cameraMobile: { position: [0.4, 3.3, -6.4], target: [0, 1.5, 0], fov: 52 },
  world: { key: 1, fog: 0.006, practicals: 0, particles: 0 },
  assetGroup: 'critical',
};

const BASE: PlanBoardPaintParams = {
  current: PLAZA,
  station: PULSE,
  boardWorldWidthM: 4,
};

describe('resolveBoardAllocation — the constructive clamp', () => {
  it('raises the plaza-class declared constants to exactly 2048×1184', () => {
    expect(resolveBoardAllocation(PLAZA, PLAZA)).toEqual({ width: 2048, height: 1184, clamped: true });
    expect(boardTextureFloor(PLAZA)).toEqual({ width: 2048, height: 1184 });
  });

  it('raises the theme-class declared constants to exactly 2560×1440', () => {
    expect(resolveBoardAllocation(THEME, THEME)).toEqual({ width: 2560, height: 1440, clamped: true });
  });

  it('is per-axis: a wide-but-short request keeps its width, gains the floor height', () => {
    expect(resolveBoardAllocation({ width: 4096, height: 592 }, PLAZA)).toEqual({
      width: 4096,
      height: 1184,
      clamped: true,
    });
  });

  it('lets an at-or-above-floor request through unclamped', () => {
    expect(resolveBoardAllocation({ width: 2048, height: 1184 }, PLAZA)).toEqual({
      width: 2048,
      height: 1184,
      clamped: false,
    });
    expect(resolveBoardAllocation({ width: 4096, height: 2304 }, PLAZA)).toEqual({
      width: 4096,
      height: 2304,
      clamped: false,
    });
  });
});

describe('assertBoardAllocation / reject mode — the named rejection', () => {
  it('throws the legibility module’s named error on a sub-floor request', () => {
    expect(() => assertBoardAllocation(PLAZA, PLAZA)).toThrow(
      /board texture 1024x592 misses the ≥2× legibility floor 2048x1184/,
    );
    expect(() => assertBoardAllocation({ width: 2048, height: 1184 }, PLAZA)).not.toThrow();
  });

  it('reject-mode plan throws the SAME named error; clamp-mode plan raises instead', () => {
    const rejected = () => planBoardPaint({ ...BASE, request: PLAZA, onSubFloor: 'reject' });
    expect(rejected).toThrowError(/board texture 1024x592 misses the ≥2× legibility floor 2048x1184/);

    const clamped = planBoardPaint({ ...BASE, request: PLAZA });
    expect(clamped.allocation).toEqual({ width: 2048, height: 1184, clamped: true });
  });
});

describe('planBoardPaint — the shared call’s plan', () => {
  it('defaults the request to the floor itself', () => {
    const plan = planBoardPaint(BASE);
    expect(plan.allocation).toEqual({ width: 2048, height: 1184, clamped: false });
  });

  it('derives the font floor at the SHIPPED texture width, in painter space through the scale', () => {
    const plan = planBoardPaint({ ...BASE, request: PLAZA });
    expect(plan.fontFloorTexPx).toBe(stationFontFloorPx(PULSE, { texW: 2048, worldW: 4 }));
    // Painter space is the declared 1024 → the painter-space floor is half.
    expect(plan.fontFloorPaintPx).toBe(Math.ceil(plan.fontFloorTexPx / 2));
  });

  it('the landed-390 leg binds: the floor exceeds the desktop-only derivation', () => {
    const plan = planBoardPaint(BASE);
    const desktopOnly = minBoardFontPx({
      board: { texW: 2048, worldW: 4 },
      distanceM: eyeDistance(PULSE.camera),
      fovDeg: PULSE.camera.fov,
      viewportH: VIEWPORT_H_1440,
    });
    expect(plan.fontFloorTexPx).toBeGreaterThan(desktopOnly);
  });

  it('shipped-texture floor px scale with the allocation; the painter-space floor is invariant', () => {
    const plan2048 = planBoardPaint(BASE);
    const plan4096 = planBoardPaint({ ...BASE, request: { width: 4096, height: 1184 } });
    // 2× the texture width → each texture px is half the metres → 2× px needed.
    expect(plan4096.fontFloorTexPx).toBe(plan2048.fontFloorTexPx * 2);
    // The painter draws the same words in the same declared space — the
    // painter-space floor must not move with the allocation.
    expect(plan4096.fontFloorPaintPx).toBe(plan2048.fontFloorPaintPx);
    expect(plan4096.fontFloorPaintPx).toBe(Math.ceil(plan4096.fontFloorTexPx / 4));
  });
});

describe('applyStationFontFloor — the painter-space clamp', () => {
  it('clamps a sub-floor request up and leaves an above-floor request alone', () => {
    const clamp = applyStationFontFloor(PULSE, { texW: 2048, worldW: 4 }, 2);
    expect(clamp.paintPx(22)).toBe(clamp.floorPaintPx);
    expect(clamp.paintPx(clamp.floorPaintPx + 10)).toBe(clamp.floorPaintPx + 10);
    expect(clamp.paintPx(clamp.floorPaintPx)).toBe(clamp.floorPaintPx);
  });

  it('the clamp is the shipped-texture floor divided by the painter scale, exactly', () => {
    const clamp = applyStationFontFloor(PULSE, { texW: 2048, worldW: 4 }, 2);
    expect(clamp.floorPaintPx).toBe(Math.ceil(clamp.floorTexPx / 2));
    // Painter px × scale = shipped px: the clamped line ships ≥ the floor.
    expect(clamp.paintPx(22) * 2).toBeGreaterThanOrEqual(clamp.floorTexPx);
  });
});

describe('paintBoardPage — the DOM shell guards its environment', () => {
  it('refuses to run without a document (node vitest) with a distinct error', () => {
    // This suite runs in node env: the guard is the client/server boundary.
    expect(() => paintBoardPage({ ...BASE, paint: () => {} })).toThrow(
      /\[route-world\] paintBoardPage is a client paint path/,
    );
  });
});

describe('paintBoardPage — a reused canvas survives a painter that throws (PR #65 review)', () => {
  /** A 2D context that keeps the save / restore stack, a clip flag and globalAlpha like the real one. */
  function fakeCanvas() {
    const clears: string[] = [];
    const state = { clipped: false, globalAlpha: 1 };
    const stack: (typeof state)[] = [];
    const ctx = {
      get globalAlpha() {
        return state.globalAlpha;
      },
      set globalAlpha(value: number) {
        state.globalAlpha = value;
      },
      save: () => {
        stack.push({ ...state });
      },
      restore: () => {
        const top = stack.pop();
        if (top) Object.assign(state, top);
      },
      scale: () => {},
      setTransform: () => {},
      clip: () => {
        state.clipped = true;
      },
      // A real clearRect only clears inside the current clip.
      clearRect: () => {
        clears.push(state.clipped ? 'clipped' : 'full');
      },
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    return { canvas, state, stack, clears };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores the context before the error propagates, so the next repaint clears and paints unclipped', () => {
    const fake = fakeCanvas();
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('the reuse path never allocates');
      },
    });
    // The first paint sizes the canvas (a resize resets a real context: no clear).
    paintBoardPage({ ...BASE, canvas: fake.canvas, paint: () => {} });
    expect(fake.stack).toHaveLength(0);
    expect(() =>
      paintBoardPage({
        ...BASE,
        canvas: fake.canvas,
        paint: (ctx) => {
          ctx.globalAlpha = 0.2;
          ctx.clip();
          throw new Error('painter failed');
        },
      }),
    ).toThrow('painter failed');
    // Restored: no saved state left behind, no clip, full alpha.
    expect(fake.stack).toHaveLength(0);
    expect(fake.state).toEqual({ clipped: false, globalAlpha: 1 });
    const seen: { clipped: boolean; alpha: number }[] = [];
    paintBoardPage({
      ...BASE,
      canvas: fake.canvas,
      paint: (ctx) => {
        seen.push({ clipped: fake.state.clipped, alpha: ctx.globalAlpha });
      },
    });
    expect(fake.clears).toEqual(['full', 'full']);
    expect(seen).toEqual([{ clipped: false, alpha: 1 }]);
  });
});

/** Authored vs landed derivation cross-check (the r1 under-derivation law). */
describe('the shared floor source is the landed pose, not the authored endpoint', () => {
  const authored: CameraEndpoint = PULSE.cameraMobile;
  it('stationFontFloorPx through the plan exceeds the authored-endpoint derivation', () => {
    const plan = planBoardPaint(BASE);
    const authoredFloor = minBoardFontPx({
      board: { texW: 2048, worldW: 4 },
      distanceM: eyeDistance(authored),
      fovDeg: authored.fov,
      viewportH: 844,
    });
    expect(plan.fontFloorTexPx).toBeGreaterThan(authoredFloor);
  });
});

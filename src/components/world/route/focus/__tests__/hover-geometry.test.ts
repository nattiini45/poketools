import { afterEach, describe, expect, it } from 'vitest';
import { focusStore, installFocusBridge, type FocusHost } from '../focus-store';
import {
  BEAM_START_INSET_PX,
  BRACKET_OFFSET_PX,
  DOCK_CORNER_PX,
  EDGE_INSET_PX,
  HEADER_BAND_PX,
  HUD_BAND_PX,
  MIN_PRIMARY_ON_SCREEN,
  SETTLE_HOLD_MS,
  beamStart,
  breatheKey,
  claimBreathe,
  dockPoint,
  expandRect,
  hoverHint,
  multiplyMat4,
  overlapArea,
  pickPrimarySubject,
  placePill,
  projectToViewport,
  stepSettle,
  type FlagStorage,
} from '../hover-geometry';
import type { FocusSubject } from '@/lib/route-world/focus';

/**
 * Wave 2 (2C): the pure geometry behind the hover brackets, the pill side,
 * the touch breathe and the holo beam, plus the store's hover channel and
 * the `__routeWorldFocus.state().hoveredId` bridge field.
 */

const VIEWPORT = { width: 1440, height: 900 };
const PILL = { w: 200, h: 44 };

function inside(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

describe('placePill', () => {
  it('prefers below when it is clear', () => {
    const target = { x: 600, y: 200, w: 240, h: 160 };
    const placement = placePill(target, PILL, [], VIEWPORT);
    expect(placement.side).toBe('below');
    expect(placement.overlap).toBe(0);
    expect(placement.y).toBeGreaterThan(target.y + target.h);
  });

  it('moves off a padded neighbour face', () => {
    const target = { x: 600, y: 200, w: 240, h: 160 };
    const neighbourBelow = { x: 500, y: 370, w: 440, h: 200 };
    const placement = placePill(target, PILL, [neighbourBelow], VIEWPORT);
    expect(placement.side).toBe('above');
    expect(placement.overlap).toBe(0);
  });

  it('never enters the header or the HUD band', () => {
    // A subject hugging the top: "above" would cross the header band.
    const target = { x: 600, y: 70, w: 240, h: 600 };
    const neighbourBelow = { x: 0, y: 680, w: 1440, h: 220 };
    const placement = placePill(target, PILL, [neighbourBelow], VIEWPORT);
    expect(placement.y).toBeGreaterThanOrEqual(HEADER_BAND_PX + EDGE_INSET_PX);
    expect(placement.y + PILL.h).toBeLessThanOrEqual(VIEWPORT.height - HUD_BAND_PX - EDGE_INSET_PX);
    expect(['right', 'left']).toContain(placement.side);
  });

  it('slides along the free axis at the viewport edge instead of clipping', () => {
    const target = { x: 10, y: 300, w: 60, h: 60 };
    const placement = placePill(target, PILL, [], VIEWPORT);
    expect(placement.side).toBe('below');
    expect(placement.x).toBe(EDGE_INSET_PX);
  });

  it('reports the least-overlap compromise when every side is blocked', () => {
    const target = { x: 600, y: 300, w: 200, h: 200 };
    const wall = { x: 0, y: 0, w: 1440, h: 900 };
    const placement = placePill(target, PILL, [wall], VIEWPORT);
    expect(placement.overlap).toBeGreaterThan(0);
  });
});

describe('dockPoint + beamStart', () => {
  const rail = { x: 1000, y: 88, w: 416, h: 700 };
  const sheet = { x: 12, y: 480, w: 366, h: 350 };

  it('lands on the rail left edge, level with the subject, clear of the corners', () => {
    expect(dockPoint(rail, { x: 400, y: 300 }, 'left')).toEqual({ x: 1000, y: 300 });
    expect(dockPoint(rail, { x: 400, y: 20 }, 'left')).toEqual({ x: 1000, y: rail.y + DOCK_CORNER_PX });
  });

  it('lands on the sheet top edge under the subject', () => {
    expect(dockPoint(sheet, { x: 195, y: 200 }, 'top')).toEqual({ x: 195, y: 480 });
    expect(dockPoint(sheet, { x: 2, y: 200 }, 'top').x).toBe(sheet.x + DOCK_CORNER_PX);
  });

  it('starts inside the subject rect, on its edge toward the dock (never across the face)', () => {
    const subject = { x: 200, y: 150, w: 400, h: 300 };
    const end = dockPoint(rail, { x: 400, y: 300 }, 'left');
    const start = beamStart(subject, end);
    expect(inside(start, subject)).toBe(true);
    expect(start.x).toBeCloseTo(subject.x + subject.w - BEAM_START_INSET_PX, 6);
    expect(start.y).toBeCloseTo(300, 6);
  });

  it('390 sheet: the start is inside the subject, the end on the sheet edge', () => {
    const subject = { x: 40, y: 120, w: 310, h: 220 };
    const end = dockPoint(sheet, { x: 195, y: 230 }, 'top');
    const start = beamStart(subject, end);
    expect(inside(start, subject)).toBe(true);
    expect(end.y).toBe(sheet.y);
    expect(start.y).toBeCloseTo(subject.y + subject.h - BEAM_START_INSET_PX, 6);
  });
});

describe('projectToViewport', () => {
  it('multiplies column-major like three', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    expect(multiplyMat4(identity, translate)).toEqual(translate);
    expect(multiplyMat4(translate, translate).slice(12, 15)).toEqual([10, 12, 14]);
  });

  it('offsets the canvas-local rect by the canvas box', () => {
    // Orthographic identity camera: clip = world, w = 1.
    const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    const camera = { projectionMatrix: identity, matrixWorldInverse: identity };
    const projected = projectToViewport(
      { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
      camera,
      { left: 10, top: 20, width: 200, height: 100 },
    );
    expect(projected.rect).toEqual({ x: 60, y: 45, w: 100, h: 50 });
    expect(projected.onScreenFraction).toBe(1);
  });

  it('bracket box hugs the projection within the 8 px acceptance', () => {
    const rect = { x: 100, y: 100, w: 50, h: 50 };
    const box = expandRect(rect, BRACKET_OFFSET_PX);
    expect(BRACKET_OFFSET_PX).toBeLessThanOrEqual(8);
    expect(overlapArea(box, rect)).toBe(rect.w * rect.h);
  });
});

describe('touch breathe', () => {
  it('settles only after the nearest station held still for the hold', () => {
    let step = stepSettle(null, { exact: 2, smooth: 1.9, nearest: 2 }, 0);
    expect(step.settled).toBe(false);
    step = stepSettle(step.track, { exact: 2, smooth: 1.995, nearest: 2 }, 100);
    expect(step.settled).toBe(false);
    step = stepSettle(step.track, { exact: 2, smooth: 1.999, nearest: 2 }, 100 + SETTLE_HOLD_MS - 1);
    expect(step.settled).toBe(false);
    step = stepSettle(step.track, { exact: 2, smooth: 2, nearest: 2 }, 100 + SETTLE_HOLD_MS);
    expect(step.settled).toBe(true);
    // A nearest flip restarts the hold.
    step = stepSettle(step.track, { exact: 3, smooth: 2.99, nearest: 3 }, 400);
    expect(step.settled).toBe(false);
  });

  it('claims the breathe once per key, and never when storage throws', () => {
    const map = new Map<string, string>();
    const storage: FlagStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
    };
    const key = breatheKey('plaza', 1);
    expect(claimBreathe(storage, key)).toBe(true);
    expect(claimBreathe(storage, key)).toBe(false);
    expect(claimBreathe(storage, breatheKey('plaza', 2))).toBe(true);
    const throwing: FlagStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(claimBreathe(throwing, key)).toBe(false);
    expect(claimBreathe(null, key)).toBe(false);
  });

  it('picks the largest mostly-on-screen subject as the primary', () => {
    expect(
      pickPrimarySubject([
        { id: 'board:pulse', rect: { x: 0, y: 0, w: 600, h: 400 }, onScreenFraction: 1 },
        { id: 'board:schedule', rect: { x: 1200, y: 0, w: 900, h: 400 }, onScreenFraction: MIN_PRIMARY_ON_SCREEN - 0.1 },
        { id: 'ace:x', rect: { x: 0, y: 0, w: 100, h: 100 }, onScreenFraction: 1 },
        { id: 'off', rect: null, onScreenFraction: 0 },
      ]),
    ).toBe('board:pulse');
    expect(pickPrimarySubject([])).toBeNull();
  });
});

describe('hover copy', () => {
  it('German on the plaza, English elsewhere', () => {
    expect(hoverHint('de')).toBe('Klicken zum Vergrößern');
    expect(hoverHint('en')).toBe('Click to look closer');
  });
});

describe('focus store hover channel', () => {
  const subject: FocusSubject = {
    id: 'board:pulse',
    kind: 'board',
    label: 'Tabelle',
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    facing: [0, 0, 1],
  };
  let cleanup: Array<() => void> = [];

  afterEach(() => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    focusStore.unhover(subject.id);
    focusStore.unhover('other');
  });

  it('tracks hover and only clears it for the holder', () => {
    let calls = 0;
    cleanup.push(focusStore.subscribeHover(() => (calls += 1)));
    focusStore.hover(subject.id);
    expect(focusStore.hovered()).toBe(subject.id);
    focusStore.unhover('other');
    expect(focusStore.hovered()).toBe(subject.id);
    focusStore.hover('other');
    focusStore.unhover(subject.id); // stale `out` after the next `over`
    expect(focusStore.hovered()).toBe('other');
    expect(calls).toBe(2);
  });

  it('drops the hover when the hovered subject really unmounts', async () => {
    const unregister = focusStore.register(subject);
    focusStore.hover(subject.id);
    unregister();
    await Promise.resolve();
    expect(focusStore.hovered()).toBeNull();
  });

  it('exposes hoveredId on the harness bridge', () => {
    const host = {} as FocusHost;
    (globalThis as { window?: unknown }).window = host;
    cleanup.push(() => {
      delete (globalThis as { window?: unknown }).window;
    });
    cleanup.push(installFocusBridge());
    expect(host.__routeWorldFocus?.state().hoveredId).toBeNull();
    focusStore.hover(subject.id);
    expect(host.__routeWorldFocus?.state().hoveredId).toBe(subject.id);
  });

  it('lends the view only while a source is bound', () => {
    expect(focusStore.view()).toBeNull();
    const fake = { camera: {} as never, canvas: {} as never };
    const unbind = focusStore.bindView(() => fake);
    expect(focusStore.view()).toBe(fake);
    unbind();
    expect(focusStore.view()).toBeNull();
  });
});

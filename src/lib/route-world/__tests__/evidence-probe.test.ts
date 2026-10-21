import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  aabbCorners,
  clipPhase01,
  directionFlips,
  domOverlaps,
  gridSamples,
  loaderGaps,
  occludedShare,
  occlusionVerdict,
  phaseCollisions,
  phaseCollisionShare,
  pixelSpread,
  projectAabbToRect,
  projectPoint,
  rectOverlapShare,
  type DirectionSample,
  type LoaderSample,
} from '../evidence-probe';

const W = 800;
const H = 600;

/** A camera at the origin looking down -Z with a 60° vertical FOV. */
function viewProj(position: [number, number, number] = [0, 0, 0], lookAt: [number, number, number] = [0, 0, -1]) {
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 500);
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...lookAt));
  camera.updateMatrixWorld(true);
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
}

describe('projectPoint / projectAabbToRect', () => {
  it('projects a point on the forward axis to the viewport centre', () => {
    const p = projectPoint(viewProj(), [0, 0, -10], W, H);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(W / 2, 6);
    expect(p!.y).toBeCloseTo(H / 2, 6);
  });

  it('returns null for a point behind the eye', () => {
    expect(projectPoint(viewProj(), [0, 0, 5], W, H)).toBeNull();
  });

  it('frames a centred box symmetrically and fully on screen', () => {
    const r = projectAabbToRect({ min: [-1, -1, -11], max: [1, 1, -9] }, viewProj(), W, H);
    expect(r.behind).toBe(false);
    expect(r.onScreenFraction).toBeCloseTo(1, 6);
    expect(r.rect).not.toBeNull();
    expect(r.rect!.x + r.rect!.w / 2).toBeCloseTo(W / 2, 4);
    expect(r.rect!.y + r.rect!.h / 2).toBeCloseTo(H / 2, 4);
    // The near face (z=-9) sets the extent: tan(30°)*9 = 5.196 m half-height.
    expect(r.rect!.h).toBeCloseTo((1 / (Math.tan(Math.PI / 6) * 9)) * H, 3);
  });

  it('reports a box entirely behind the camera', () => {
    const r = projectAabbToRect({ min: [-1, -1, 5], max: [1, 1, 7] }, viewProj(), W, H);
    expect(r).toEqual({ rect: null, fullRect: null, onScreenFraction: 0, behind: true });
  });

  it('clips a box half off the right edge and reports the on-screen share', () => {
    const vp = viewProj();
    const edge = projectPoint(vp, [0, 0, -10], W, H)!;
    expect(edge.x).toBeCloseTo(W / 2, 6);
    // Half-width of the frustum at z=-10.
    const halfW = Math.tan(Math.PI / 6) * 10 * (W / H);
    const r = projectAabbToRect({ min: [halfW - 1, -0.5, -10], max: [halfW + 1, 0.5, -10] }, vp, W, H);
    expect(r.rect).not.toBeNull();
    expect(r.rect!.x + r.rect!.w).toBeCloseTo(W, 6);
    expect(r.onScreenFraction).toBeCloseTo(0.5, 3);
  });

  it('clips a box straddling the eye plane through its crossing edges', () => {
    // A long wall beside the camera running from behind to in front of it.
    const r = projectAabbToRect({ min: [2, -1, -20], max: [3, 1, 5] }, viewProj(), W, H);
    expect(r.behind).toBe(false);
    expect(r.rect).not.toBeNull();
    // The part next to the eye projects far off-screen right, so the clipped
    // rect runs to the right viewport edge.
    expect(r.rect!.x + r.rect!.w).toBeCloseTo(W, 6);
    expect(r.onScreenFraction).toBeGreaterThan(0);
    expect(r.onScreenFraction).toBeLessThan(1);
  });

  it('aabbCorners enumerates all eight corners', () => {
    const corners = aabbCorners({ min: [0, 0, 0], max: [1, 2, 3] });
    expect(corners).toHaveLength(8);
    expect(new Set(corners.map((c) => c.join(','))).size).toBe(8);
  });
});

describe('gridSamples', () => {
  it('places cell centres and matching NDC', () => {
    const pts = gridSamples({ x: 0, y: 0, w: W, h: H }, 2, 2, W, H);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toMatchObject({ x: W / 4, y: H / 4 });
    expect(pts[0].ndcX).toBeCloseTo(-0.5, 6);
    expect(pts[0].ndcY).toBeCloseTo(0.5, 6);
    expect(pts[3].ndcX).toBeCloseTo(0.5, 6);
    expect(pts[3].ndcY).toBeCloseTo(-0.5, 6);
  });

  it('caps the grid to 1..16 per axis', () => {
    expect(gridSamples({ x: 0, y: 0, w: 10, h: 10 }, 0, 99, W, H)).toHaveLength(16);
  });
});

describe('occlusionVerdict', () => {
  it('uses only on-subject samples as the denominator and ranks occluders', () => {
    const v = occlusionVerdict([
      { onSubject: true, blocked: true, occluder: 'rock' },
      { onSubject: true, blocked: true, occluder: 'rock' },
      { onSubject: true, blocked: true, occluder: 'tree' },
      { onSubject: true, blocked: false, occluder: null },
      { onSubject: false, blocked: false, occluder: null },
    ]);
    expect(v.samples).toBe(5);
    expect(v.considered).toBe(4);
    expect(v.occludedFraction).toBeCloseTo(0.75, 6);
    expect(v.topOccluders[0]).toEqual({ name: 'rock', count: 2, share: 0.5 });
    expect(v.topOccluders[1].name).toBe('tree');
  });

  it('returns null fraction when nothing reached the subject', () => {
    expect(occlusionVerdict([{ onSubject: false, blocked: false, occluder: null }]).occludedFraction).toBeNull();
  });
});

describe('DOM overlap', () => {
  it('measures the share of the subject a layer covers', () => {
    expect(rectOverlapShare({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(0.5, 6);
    expect(rectOverlapShare({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 })).toBe(0);
  });

  it('lists layer-over-subject overlaps above the noise floor', () => {
    const out = domOverlaps(
      [{ layer: '.world-nav-hud', rect: { x: 0, y: 500, w: 800, h: 100 } }],
      [
        { id: 'board:pulse', kind: 'board', rect: { x: 100, y: 450, w: 100, h: 100 } },
        { id: 'far', kind: 'board', rect: { x: 100, y: 10, w: 100, h: 100 } },
        { id: 'off', kind: 'board', rect: null },
      ],
    );
    expect(out).toEqual([{ layer: '.world-nav-hud', id: 'board:pulse', kind: 'board', share: 0.5 }]);
  });
});

describe('W2 phaseCollisions', () => {
  it('normalizes clip phase and rejects degenerate clips', () => {
    expect(clipPhase01(2.5, 2)).toBeCloseTo(0.25, 6);
    expect(clipPhase01(-0.5, 2)).toBeCloseTo(0.75, 6);
    expect(clipPhase01(1, 0)).toBeNull();
  });

  it('flags visible same-clip pairs within eps, across the loop seam', () => {
    const hits = phaseCollisions([
      { id: 'a', clip: 'idle', phase01: 0.99, visible: true, model: 'm1' },
      { id: 'b', clip: 'idle', phase01: 0.01, visible: true, model: 'm1' },
      { id: 'c', clip: 'walk', phase01: 0.99, visible: true },
      { id: 'd', clip: 'idle', phase01: 0.5, visible: true },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ a: 'a', b: 'b', clip: 'idle', lockstep: true, sameModel: true });
    expect(hits[0].delta).toBeCloseTo(0.02, 6);
  });

  it('ignores invisible figures and rows without a clip or phase', () => {
    expect(
      phaseCollisions([
        { id: 'a', clip: 'idle', phase01: 0.1, visible: true },
        { id: 'b', clip: 'idle', phase01: 0.1, visible: false },
        { id: 'c', clip: null, phase01: 0.1, visible: true },
        { id: 'd', clip: 'idle', phase01: null, visible: true },
      ]),
    ).toEqual([]);
  });

  it('marks drifting pairs (different timeScale) as not lockstep', () => {
    const [hit] = phaseCollisions([
      { id: 'a', clip: 'idle', phase01: 0.3, visible: true, timeScale: 1 },
      { id: 'b', clip: 'idle', phase01: 0.31, visible: true, timeScale: 1.2 },
    ]);
    expect(hit.lockstep).toBe(false);
    expect(hit.sameModel).toBeNull();
  });

  it('measures how persistently a pair collides over a trace', () => {
    const locked = (p: number) => [
      { id: 'b', clip: 'idle', phase01: p, visible: true },
      { id: 'a', clip: 'idle', phase01: p + 0.01, visible: true },
    ];
    const snapshots = [locked(0.1), locked(0.4), [{ id: 'a', clip: 'idle', phase01: 0.1, visible: true }], locked(0.7)];
    const [pair] = phaseCollisionShare(snapshots);
    expect(pair).toMatchObject({ a: 'a', b: 'b', hits: 3 });
    expect(pair.share).toBeCloseTo(0.75, 6);
  });
});

describe('W4 occludedShare', () => {
  const timeline = Array.from({ length: 31 }, (_, i) => ({
    t: i * 1000,
    rows: [
      { id: 'hidden', occludedFraction: i < 20 ? 1 : 0.2, onScreen: true },
      { id: 'peek', occludedFraction: i % 3 === 0 ? 0.96 : 0, onScreen: true },
      { id: 'offscreen', occludedFraction: null, onScreen: false },
    ],
  }));

  it('vetoes a figure fully occluded for more than half of the window', () => {
    const report = occludedShare(timeline);
    expect(report.spanMs).toBe(30_000);
    expect(report.coversWindow).toBe(true);
    expect(report.vetoes).toEqual(['hidden']);
    const peek = report.rows.find((row) => row.id === 'peek')!;
    expect(peek.fullyOccluded).toBe(11);
    expect(peek.veto).toBe(false);
  });

  it('counts off-screen time only when asked', () => {
    expect(occludedShare(timeline).rows.find((r) => r.id === 'offscreen')!.veto).toBe(false);
    expect(occludedShare(timeline, { countOffscreen: true }).vetoes).toContain('offscreen');
  });

  it('flags a trace shorter than the bar window', () => {
    expect(occludedShare(timeline.slice(0, 10)).coversWindow).toBe(false);
  });
});

describe('W6 directionFlips', () => {
  const trace = (progress: number[], input: Array<-1 | 0 | 1> | -1 | 1, yaw?: number[]): DirectionSample[] =>
    progress.map((p, i) => ({
      t: i * 16,
      inputSign: Array.isArray(input) ? input[i] : input,
      progress: p,
      yaw: yaw ? yaw[i] : null,
    }));

  it('passes a monotone forward sweep with plateau noise under hysteresis', () => {
    const report = directionFlips(trace([0, 0.1, 0.3, 0.6, 0.995, 1.0, 0.992, 1.0, 1.3, 2], 1));
    expect(report.verdict).toBe('pass');
    expect(report.progressFlips).toEqual([]);
    expect(report.segments).toBe(1);
  });

  it('fails an advance-then-snap-back under constant down input', () => {
    const report = directionFlips(trace([0, 0.2, 0.45, 0.6, 0.5, 0.4, 0.6, 0.9], 1));
    expect(report.verdict).toBe('fail');
    expect(report.progressFlips).toHaveLength(1);
    expect(report.progressFlips[0]).toMatchObject({ channel: 'progress', from: 1, to: -1, inputSign: 1 });
  });

  it('accepts coasting after an input reversal and the reversal itself', () => {
    // Down, then the user reverses: progress coasts forward briefly, then goes back.
    const report = directionFlips(
      trace([0, 0.3, 0.6, 0.7, 0.72, 0.6, 0.4], [1, 1, 1, -1, -1, -1, -1]),
    );
    expect(report.verdict).toBe('pass');
    expect(report.segments).toBe(2);
  });

  it('reports a start against the input', () => {
    const report = directionFlips(trace([2, 1.9, 1.7, 1.5], 1));
    expect(report.againstInput).toHaveLength(1);
    expect(report.verdict).toBe('fail');
  });

  it('ignores samples before any input', () => {
    const report = directionFlips(trace([0, 0.5, 0.2, 0.3, 0.6], [0, 0, 0, 1, 1]));
    expect(report.verdict).toBe('pass');
  });

  it('reports a slow yaw reversal but fails only on whiplash', () => {
    const slow = directionFlips(
      [0, 0.1, 0.2, 0.3, 0.2, 0.1].map((yaw, i) => ({ t: i * 500, inputSign: 1 as const, progress: i * 0.1, yaw })),
    );
    expect(slow.yawFlips).toHaveLength(1);
    expect(slow.verdict).toBe('pass');
    const whip = directionFlips(
      [0, 0.1, 0.2, 0.1, 0.2, 0.1].map((yaw, i) => ({ t: i * 50, inputSign: 1 as const, progress: i * 0.1, yaw })),
    );
    expect(whip.yawOscillations.length).toBeGreaterThan(0);
    expect(whip.verdict).toBe('fail');
  });

  it('attributes a reversal to the input held when the retreat began (sakura jitter 390 excerpt)', () => {
    // Review round 1: input went −1 at the peak (t=20329); the 0.02 deadband
    // only tripped at t=20463, the frame input returned to +1. The reversal
    // answers the −1 input, so it is lag-attributed, not a snap-back veto.
    const frames: Array<[number, -1 | 1, number]> = [
      [20213, 1, 3.0285], [20229, 1, 3.0429], [20246, 1, 3.056], [20279, 1, 3.0681], [20296, 1, 3.0789],
      [20329, -1, 3.0879], [20413, -1, 3.0773], [20446, -1, 3.0696], [20463, 1, 3.0632], [20513, 1, 3.0783],
      [20529, 1, 3.0878], [20546, 1, 3.0963], [20580, 1, 3.1025], [20596, 1, 3.1092],
    ];
    const report = directionFlips(frames.map(([t, inputSign, progress]) => ({ t, inputSign, progress, yaw: null })));
    expect(report.progressFlips).toEqual([]);
    expect(report.lagAttributed).toHaveLength(1);
    expect(report.lagAttributed[0]).toMatchObject({ t: 20463, to: -1, inputSign: 1 });
    expect(report.verdict).toBe('pass');
    // The same progress under constant +1 input is a real snap-back.
    const snap = directionFlips(frames.map(([t, , progress]) => ({ t, inputSign: 1 as const, progress, yaw: null })));
    expect(snap.progressFlips).toHaveLength(1);
    expect(snap.verdict).toBe('fail');
  });

  it('unwraps yaw across ±π so the seam is not a reversal', () => {
    const yaw = [3.0, 3.1, -3.13, -3.05, -2.95];
    const report = directionFlips(yaw.map((y, i) => ({ t: i * 100, inputSign: 1 as const, progress: i * 0.1, yaw: y })));
    expect(report.yawFlips).toEqual([]);
  });
});

describe('W7 loaderGaps', () => {
  const base: LoaderSample = {
    t: 0,
    ballPhase: 'loading',
    ballVisible: true,
    routeLive: false,
    canvasOpacity: 0,
    canvasSpread: null,
    scenePhase: 'loading',
  };
  const at = (t: number, patch: Partial<LoaderSample>): LoaderSample => ({ ...base, t, ...patch });

  it('passes a clean handoff: ball covers until the painted world is visible', () => {
    const report = loaderGaps([
      at(0, {}),
      at(16, {}),
      at(3000, { ballPhase: 'opening', routeLive: true, canvasOpacity: 0.5, canvasSpread: 40 }),
      at(3016, { ballPhase: 'done', ballVisible: false, routeLive: true, canvasOpacity: 1, canvasSpread: 40 }),
    ]);
    expect(report.verdict).toBe('pass');
    expect(report.ballShownAt).toBe(0);
    expect(report.ballDismissedAt).toBe(3016);
    expect(report.worldVisibleAt).toBe(3016);
  });

  it('counts blank frames after dismiss while the world is uniform or faded', () => {
    const report = loaderGaps([
      at(0, {}),
      at(100, { ballVisible: false, routeLive: true, canvasOpacity: 1, canvasSpread: 1 }),
      at(116, { ballVisible: false, routeLive: true, canvasOpacity: 0.4, canvasSpread: 40 }),
      at(132, { ballVisible: false, routeLive: true, canvasOpacity: 1, canvasSpread: 40 }),
    ]);
    expect(report.blankFrames).toBe(2);
    expect(report.gaps).toEqual([{ from: 100, to: 116, frames: 2 }]);
    expect(report.verdict).toBe('fail');
  });

  it('never calls the pre-live semantic page blank', () => {
    const report = loaderGaps([at(0, { ballVisible: false, canvasOpacity: 0 })]);
    expect(report.blankFrames).toBe(0);
  });

  it('treats unreadable pixels as not blank', () => {
    const report = loaderGaps([at(0, { ballVisible: false, routeLive: true, canvasOpacity: 1, canvasSpread: null })]);
    expect(report.blankFrames).toBe(0);
    expect(report.worldVisibleAt).toBe(0);
  });

  it('flags a loader outliving the readiness deadline', () => {
    const report = loaderGaps([at(500, {}), at(9_000, {}), at(10_600, {}), at(11_000, {})]);
    expect(report.deadlineAnchor).toBe(500);
    expect(report.overrun).toEqual({ from: 10_600, to: 11_000, frames: 2 });
    expect(report.verdict).toBe('fail');
  });

  it('anchors the deadline at the first loading sample, not navigation start', () => {
    const late = loaderGaps([
      at(0, { scenePhase: 'idle', ballVisible: false }),
      at(4_000, {}),
      at(12_000, {}),
    ]);
    expect(late.deadlineAnchor).toBe(4_000);
    expect(late.overrun).toBeNull();
  });

  it('flags a loader lingering after the scene failed (blocks Lite)', () => {
    const ok = loaderGaps([at(0, {}), at(100, { scenePhase: 'failed' }), at(250, { scenePhase: 'failed', ballVisible: false })]);
    expect(ok.liteBlock).toBeNull();
    const blocked = loaderGaps([at(0, {}), at(100, { scenePhase: 'failed' }), at(900, { scenePhase: 'failed' })]);
    expect(blocked.liteBlock).toEqual({ from: 900, to: 900, frames: 1 });
    expect(blocked.verdict).toBe('fail');
  });

  it('flags a stutter between dismiss and world paint', () => {
    const report = loaderGaps([
      at(0, {}),
      at(100, { ballVisible: false, routeLive: true, canvasOpacity: 0.5, canvasSpread: 40 }),
      at(400, { ballVisible: false, routeLive: true, canvasOpacity: 1, canvasSpread: 40 }),
    ]);
    expect(report.hitches).toEqual([{ at: 400, gapMs: 300 }]);
  });

  it('round 5: scopes reveal hitches to [first opening, route-live + settle]', () => {
    const live = { routeLive: true, canvasOpacity: 1, canvasSpread: 40 };
    const report = loaderGaps([
      at(0, {}),
      at(2000, {}), // a 2 s loading stall: not a reveal hitch
      at(2016, { ballPhase: 'opening' }),
      at(2300, { ballPhase: 'releasing', ...live }), // 284 ms: inside the window
      at(2316, { ballPhase: 'done', ballVisible: false, ...live }),
      at(4000, { ballPhase: 'done', ballVisible: false, ...live }), // after route-live + 600 ms
    ]);
    expect(report.revealWindow).toEqual({ from: 2016, to: 2900 });
    expect(report.hitches).toEqual([{ at: 2300, gapMs: 284 }]);
    expect(report.otherStalls.map((s) => s.at)).toEqual([2000, 4000]);
    expect(report.failureStalls).toBeNull();
  });

  it('round 5: failure-path stalls are reported separately, never as reveal hitches', () => {
    // context-loss:loading: the route never goes live, so there is no reveal.
    const report = loaderGaps(
      [
        at(0, {}),
        at(3000, {}),
        at(3400, { scenePhase: 'failed', ballPhase: 'aborted', ballVisible: false }),
        at(4400, { scenePhase: 'failed', ballPhase: 'hidden', ballVisible: false }),
      ],
      { failedAt: 3000 },
    );
    expect(report.revealWindow).toBeNull();
    expect(report.hitches).toEqual([]);
    expect(report.failureStalls).toEqual({
      anchor: 3000,
      stallMs: 1000,
      totalMs: 1400,
      stalls: [
        { at: 3400, gapMs: 400 },
        { at: 4400, gapMs: 1000 },
      ],
    });
    expect(report.reasons.some((r) => r.includes('hitch'))).toBe(false);
    // A failure inside the reveal window cuts it at the failure.
    const opening = loaderGaps(
      [
        at(0, {}),
        at(1000, { ballPhase: 'opening', routeLive: true, canvasOpacity: 1, canvasSpread: 40 }),
        at(1016, { ballPhase: 'opening', routeLive: true, canvasOpacity: 1, canvasSpread: 40 }),
        at(1500, { ballPhase: 'aborted', ballVisible: false, scenePhase: 'failed' }),
      ],
      { failedAt: 1100 },
    );
    expect(opening.revealWindow).toEqual({ from: 1000, to: 1100 });
    expect(opening.hitches).toEqual([]);
    expect(opening.failureStalls?.stallMs).toBe(484);
  });
});

describe('pixelSpread', () => {
  it('is zero for a uniform patch and large for a painted one', () => {
    const flat = new Uint8ClampedArray(16 * 4).fill(120);
    expect(pixelSpread(flat).spread).toBe(0);
    const painted = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i += 1) painted.fill(i % 2 ? 250 : 10, i * 4, i * 4 + 4);
    expect(pixelSpread(painted).spread).toBeGreaterThan(100);
    expect(pixelSpread(new Uint8ClampedArray(0))).toEqual({ mean: 0, spread: 0 });
  });
});

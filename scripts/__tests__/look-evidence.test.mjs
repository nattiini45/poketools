import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  assetOriginSummary,
  attemptRecord,
  diffStillFiles,
  dollyQuarterTimes,
  faceRegionsOf,
  filmFrameFor,
  isStallKind,
  pixelDiff,
  poseMatch,
  productFailure,
  quietUnmeasuredBody,
  routeTierLiveVerdict,
  stallInjectMs,
  stallPathVerdict,
} from '../lib/look-evidence.mjs';
import { parseEvidenceFlags, PARAM_RESERVED_KEYS, stripLayout, summarizeLoader } from '../lib/capture-evidence.mjs';
import { buildLumaMask, lumaVerdict, LUMA_SATURATED } from '../lib/w1-evidence.mjs';

/** The r1 sakura shape: presented, then the deadline fault, then a fresh idle generation. */
const sakuraReadiness = {
  phaseTrace: [
    { phase: 'loading', generation: 1, t: 2926.6 },
    { phase: 'presented', generation: 1, t: 6115.7 },
    { phase: 'failed', generation: 1, t: 22950.4 },
    { phase: 'idle', generation: 2, t: 22960.7 },
  ],
  lastFault: { reason: 'readiness-timeout', generation: 1, at: 22950.4 },
  milestones: { generation: 2, count: 0, at: { chunk: null, renderer: null } },
  warmTrace: [
    { generation: 1, stage: 'programs', t: 9000 },
    { generation: 1, stage: 'uploads', t: 10300 },
    { generation: 2, stage: 'programs', t: 23000 },
  ],
};
const sakuraAttempts = {
  1: {
    t: 22940,
    phase: 'presented',
    milestones: { count: 4, at: { chunk: 3155, renderer: 4162, firstFrame: 6116, assets: 10285, compiled: null, uploaded: null } },
    loadSignals: { bytes: 1000, programs: 60 },
    stallAt: 16285,
    lastFault: null,
  },
  2: { t: 23100, phase: 'idle', milestones: { count: 0, at: { chunk: null } }, loadSignals: {}, stallAt: null, lastFault: { reason: 'readiness-timeout', generation: 1 } },
};

describe('LOOK r2 SEAT H: product failure + failed attempt', () => {
  it('reads the failure from the product phase log and keeps the failed attempt', () => {
    expect(productFailure(sakuraReadiness, sakuraAttempts)).toEqual({ t: 22950.4, generation: 1, reason: 'readiness-timeout' });
    expect(productFailure({ phaseTrace: [{ phase: 'presented', t: 1 }] })).toBeNull();
    const attempt = attemptRecord({ readiness: sakuraReadiness, attempts: sakuraAttempts });
    expect(attempt.generation).toBe(1);
    expect(attempt.source).toBe('failed-generation');
    expect(attempt.pending).toEqual(['compiled', 'uploaded']);
    expect(attempt.risen.map((r) => r.milestone)).toEqual(['chunk', 'renderer', 'firstFrame', 'assets']);
    expect(attempt.loadSignals).toEqual({ bytes: 1000, programs: 60 });
    expect(attempt.warmTrace.map((w) => w.stage)).toEqual(['programs', 'uploads']);
    expect(attempt.lastWarmStage).toEqual({ stage: 'uploads', t: 10300 });
    // No failure: the newest generation.
    expect(attemptRecord({ readiness: { phaseTrace: [] }, attempts: sakuraAttempts }).generation).toBe(2);
  });

  it('anchors failurePath on the product log when the rAF samples missed the failed phase', async () => {
    const samples = [];
    for (let t = 2300; t <= 26000; t += 100) {
      const aborted = t >= 22645;
      samples.push({ t, begunAt: 2926.5, deadlineMs: 20000, scenePhase: t < 6100 ? 'loading' : t < 22960 ? 'presented' : 'idle', routeLive: false, ballVisible: !aborted && t >= 3029, ballPhase: aborted ? 'aborted' : 'loading', canvasOpacity: 0 });
    }
    const summary = await summarizeLoader(samples, { readiness: sakuraReadiness, attempts: sakuraAttempts });
    expect(summary.failurePath.verdict).not.toBe('unmeasured');
    expect(summary.failurePath.failureAnchor).toBe('product-phaseTrace');
    expect(summary.failurePath.productFailReason).toBe('readiness-timeout');
    expect(summary.attempt.generation).toBe(1);
    expect(summary.attempt.pending).toContain('compiled');
  });
});

describe('LOOK r2 SEAT H: --fail-inject stall:<ms>', () => {
  it('parses the stall kind with its range and reserves the page key', () => {
    expect(stallInjectMs('stall:4000')).toBe(4000);
    expect(stallInjectMs('timeout')).toBeNull();
    expect(Number.isNaN(stallInjectMs('stall:15000'))).toBe(true);
    expect(isStallKind('stall:15000')).toBe(true);
    const ok = parseEvidenceFlags(['--loader-trace', '--fail-inject', 'stall:4000']);
    expect(ok.errors).toEqual([]);
    expect(ok.flags.failInject).toBe('stall:4000');
    expect(parseEvidenceFlags(['--loader-trace', '--fail-inject', 'stall:15000']).errors.join(' ')).toMatch(/before the 20 s deadline/);
    expect(PARAM_RESERVED_KEYS).toContain('stallInjectMs');
  });

  const stallSamples = ({ failAt, liveAt = null }) => {
    const out = [];
    for (let t = 2000; t <= 16000; t += 50) {
      const failed = t >= failAt;
      out.push({ t, routeLive: liveAt !== null && t >= liveAt && !failed, ballVisible: !failed, ballPhase: failed ? 'aborted' : 'loading', scenePhase: failed ? 'idle' : 'loading' });
    }
    return out;
  };
  const attempt = { milestones: { at: { renderer: 3500 } } };

  it('passes Lite at stall + 6 s and fails a late, wrong or partial one', () => {
    // anchor 3000, inject 2000 -> injected 5000; window opens by max(5000, 3500) -> stall by 11000.
    const pass = stallPathVerdict(stallSamples({ failAt: 10900 }), { injectMs: 2000, anchor: 3000, failure: { t: 10890, reason: 'readiness-stall' }, attempt });
    expect(pass.verdict).toBe('pass');
    expect(pass.stallBy).toBe(11000);
    const late = stallPathVerdict(stallSamples({ failAt: 12000 }), { injectMs: 2000, anchor: 3000, failure: { t: 11990, reason: 'readiness-stall' }, attempt });
    expect(late.verdict).toBe('fail');
    expect(late.reasons.join(' ')).toMatch(/after stall \+ 6 s/);
    const wrong = stallPathVerdict(stallSamples({ failAt: 10900 }), { injectMs: 2000, anchor: 3000, failure: { t: 10890, reason: 'readiness-timeout' }, attempt });
    expect(wrong.reasons.join(' ')).toMatch(/not readiness-stall/);
    const partial = stallPathVerdict(stallSamples({ failAt: 10900, liveAt: 9000 }), { injectMs: 2000, anchor: 3000, failure: { t: 10890, reason: 'readiness-stall' }, attempt });
    expect(partial.reasons.join(' ')).toMatch(/partial reveal/);
    const never = stallPathVerdict(stallSamples({ failAt: 99999 }), { injectMs: 2000, anchor: 3000, failure: null, attempt });
    expect(never.reasons.join(' ')).toMatch(/never failed/);
    // A bound past the deadline is not the detector's to judge.
    expect(stallPathVerdict([], { injectMs: 13000, anchor: 3000, deadlineMs: 18000, attempt }).verdict).toBe('unmeasured');
  });
});

describe('LOOK r2 SEAT H: forced route liveness', () => {
  it('fails a forced route trace that fell to Lite or outlived the deadline', () => {
    const lite = routeTierLiveVerdict({ tier: 'route', timeline: { routeLiveAt: null, ballWithinDeadline: true, deadlineMs: 20000 } });
    expect(lite.verdict).toBe('fail');
    expect(lite.reasons[0]).toMatch(/never set/);
    const late = routeTierLiveVerdict({ tier: 'route', timeline: { routeLiveAt: 9000, ballWithinDeadline: false, ballEndSinceAnchorMs: 20004, deadlineMs: 20000 } });
    expect(late.verdict).toBe('fail');
    expect(routeTierLiveVerdict({ tier: 'route', timeline: { routeLiveAt: 9000, ballWithinDeadline: true } }).verdict).toBe('pass');
    expect(routeTierLiveVerdict({ tier: 'auto', timeline: { routeLiveAt: null } }).verdict).toBe('not-applicable');
    expect(routeTierLiveVerdict({ tier: 'route', faultInjected: true, timeline: { routeLiveAt: null } }).verdict).toBe('not-applicable');
  });
});

describe('LOOK r2 SEAT H: quiet probe unmeasured body', () => {
  it('always carries the four counts (null), the stage and the reason, never a pass', () => {
    const body = quietUnmeasuredBody({ reason: 'reveal gate failed (reveal-gate-aborted)', stage: 'reveal-gate', diagnostic: { sinceNavigation: { programs: 90 } }, relaxed: { readyDeadlineMs: 40000 } });
    expect(body.pass).toBe(false);
    expect(body.verdict).toBe('unmeasured');
    expect(body.counts).toEqual({ worldFetches: null, programs: null, textures: null, longTasks: null });
    expect(body.stage).toBe('reveal-gate');
    expect(body.reason).toMatch(/aborted/);
    expect(body.diagnostic.sinceNavigation.programs).toBe(90);
    expect(body.deadlineRelaxed).toEqual({ readyDeadlineMs: 40000 });
  });
});

describe('LOOK r2 SEAT H: dolly quarter points + film cells', () => {
  it('finds each quarter point of every crossing in both directions', () => {
    const down = [0, 0.2, 0.6, 1, 1.3, 1.8, 2].map((smooth, i) => ({ t: i * 100, smooth }));
    const points = dollyQuarterTimes(down);
    expect(points.map((p) => p.at)).toEqual([0.25, 0.5, 0.75, 1.25, 1.5, 1.75]);
    expect(points[0].t).toBeCloseTo(112.5, 1);
    expect(points.every((p) => p.direction === 'down')).toBe(true);
    const up = dollyQuarterTimes([{ t: 0, smooth: 1 }, { t: 100, smooth: 0 }]);
    expect(up.map((p) => p.at)).toEqual([0.75, 0.5, 0.25]);
    expect(up[0].direction).toBe('up');
    // A frame landing exactly on the point counts once.
    expect(dollyQuarterTimes([{ t: 0, smooth: 0 }, { t: 10, smooth: 0.5 }, { t: 20, smooth: 1 }]).filter((p) => p.at === 0.5)).toHaveLength(1);
  });

  it('picks the film frame showing a time and sizes montage cells to 480 px', () => {
    const times = [0, 40, 80, 400];
    expect(filmFrameFor(times, 50)).toBe(2);
    expect(filmFrameFor(times, 200)).toBe(2); // next frame 200 ms late: the last one before
    expect(filmFrameFor(times, 500)).toBe(3);
    expect(filmFrameFor([], 5)).toBe(-1);
    const layout = stripLayout({ count: 12, frameW: 1440, frameH: 900, thumbW: 480, maxCols: 3 });
    expect(layout.thumbW).toBe(480);
    expect(layout.cols).toBe(3);
  });
});

describe('LOOK r2 SEAT H: still diff + pose', () => {
  const raw = (w, h, fill, patch = null) => {
    const data = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i += 1) data.set(fill, i * 3);
    if (patch) for (let y = patch.y; y < patch.y + patch.h; y += 1) for (let x = patch.x; x < patch.x + patch.w; x += 1) data.set(patch.rgb, (y * w + x) * 3);
    return { data, width: w, height: h, channels: 3 };
  };

  it('reports changed share, share above 8 levels, mean and max', () => {
    const a = raw(10, 10, [100, 100, 100]);
    const b = raw(10, 10, [100, 100, 100], { x: 0, y: 0, w: 5, h: 2, rgb: [104, 100, 100] });
    const c = raw(10, 10, [100, 100, 100], { x: 0, y: 0, w: 1, h: 1, rgb: [100, 150, 100] });
    expect(pixelDiff(a, a)).toMatchObject({ changedPct: 0, overThresholdPct: 0, mean: 0, max: 0 });
    expect(pixelDiff(a, b)).toMatchObject({ changedPct: 10, overThresholdPct: 0, max: 4 });
    expect(pixelDiff(a, c)).toMatchObject({ changedPct: 1, overThresholdPct: 1, mean: 0.5, max: 50 });
    expect(pixelDiff(a, c, { exclude: [{ x: 0, y: 0, w: 1, h: 1 }] }).max).toBe(0);
    expect(pixelDiff(a, c, { rect: { x: 0, y: 0, w: 2, h: 2 } })).toMatchObject({ pixels: 4, changedPct: 25 });
    expect(pixelDiff(a, raw(5, 5, [0, 0, 0])).comparable).toBe(false);
  });

  it('diffs PNG files with per-face regions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'look-diff-'));
    try {
      const make = (patch) => sharp(raw(20, 20, [50, 60, 70], patch).data, { raw: { width: 20, height: 20, channels: 3 } }).png();
      await make(null).toFile(join(dir, 'a.png'));
      await make({ x: 15, y: 15, w: 5, h: 5, rgb: [255, 60, 70] }).toFile(join(dir, 'b.png'));
      const d = await diffStillFiles(join(dir, 'a.png'), join(dir, 'b.png'), { regions: [{ id: 'board:pulse', x: 0, y: 0, w: 10, h: 10 }] });
      expect(d.frame.changedPct).toBe(6.25);
      expect(d.frame.max).toBe(205);
      expect(d.regions[0]).toMatchObject({ id: 'board:pulse', max: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches poses within tolerance and names the axis that differs', () => {
    const a = { cameraPose: { camPos: [2, 4.2, -3], yawRad: -0.2783, pitchRad: 0.0515 } };
    expect(poseMatch(a, a).match).toBe(true);
    const b = { cameraPose: { camPos: [2, 4.2, -3], yawRad: -0.2303, pitchRad: 0.0004 } };
    const m = poseMatch(a, b);
    expect(m.match).toBe(false);
    expect(m.reasons.join(' ')).toMatch(/yaw differs/);
    expect(poseMatch({}, a).match).toBeNull();
    expect(faceRegionsOf({ lumaInputs: { frame: { scale: 2 }, faces: [{ id: 'board:pulse', x: 10, y: 5, w: 20, h: 10 }] } })).toEqual([{ id: 'board:pulse', x: 20, y: 10, w: 40, h: 20 }]);
  });
});

describe('LOOK r2 SEAT H: asset origin', () => {
  it('counts world assets per host and source and checks the page origin', () => {
    const s = assetOriginSummary(
      [
        { url: 'http://localhost:3111/models/world/plaza/kit.glb', bytes: 300 },
        { url: 'http://localhost:3111/models/world/env/gold.jpg', bytes: 100 },
        { url: 'http://localhost:3111/_next/static/chunk.js' },
        { url: 'https://x.supabase.co/storage/v1/object/public/world-assets/a.ktx2' },
      ],
      'http://localhost:3111',
    );
    expect(s.worldAssetRequests).toBe(3);
    expect(s.sources).toEqual({ localMirror: 2, appTextures: 0, bucket: 1 });
    expect(s.allFromPageOrigin).toBe(false);
    expect(s.foreignRequests).toBe(1);
    expect(s.bytes).toBe(400);
    expect(assetOriginSummary([], 'http://localhost:3111').allFromPageOrigin).toBeNull();
  });
});

describe('LOOK r2 SEAT H: luma saturation', () => {
  it('reports saturated (never pass / fail) when face P99 and outside P995 are both clipped', () => {
    const W = 100;
    const H = 60;
    const data = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i += 1) data.set([120, 120, 120], i * 3);
    const paint = (x0, y0, w, h, rgb) => {
      for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) data.set(rgb, (y * W + x) * 3);
    };
    paint(10, 10, 30, 20, [240, 240, 240]);
    paint(10, 10, 30, 3, [255, 255, 255]); // clipped white ink on the face (> 1 %)
    paint(60, 10, 30, 3, [255, 255, 255]); // a clipped sky band outside (> 0.5 %)
    const mask = buildLumaMask({ width: W, height: H, faceRects: [{ id: 'board:pulse', x: 10, y: 10, w: 30, h: 20 }] });
    const l = lumaVerdict({ data, width: W, height: H, channels: 3 }, mask);
    expect(l.activeFaceP99).toBeGreaterThanOrEqual(LUMA_SATURATED);
    expect(l.outsideP995).toBeGreaterThanOrEqual(LUMA_SATURATED);
    expect(l.verdict).toBe('saturated');
    expect(l.exFigures).toBe('saturated');
    expect(l.saturation.faceClipShare).toBeCloseTo(0.15, 2);
    expect(l.saturation.faceUnclippedP99).toBeCloseTo(240, 0);
    expect(l.saturation.outsideUnclippedP995).toBeCloseTo(120, 0);
    expect(l.saturation.unclippedVerdict).toBe('pass');
  });
});

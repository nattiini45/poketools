import { describe, it, expect } from 'vitest';
import {
  anyEvidenceFlag,
  evidenceNeedsDebug,
  expectedPanelEdge,
  mergeLoaderTrace,
  parseEvidenceFlags,
  particleCorridorVerdict,
  stationSettleVerdict,
  summarizeLoader,
} from '../lib/capture-evidence.mjs';
import {
  MASK,
  activeFaceRects,
  buildLumaMask,
  ceremonyAnimationVerdict,
  ceremonyCadence,
  contrastRatio,
  deadlineAnchorOf,
  dockedPanelVerdict,
  drawAuditSummary,
  drawLedgerRow,
  faceContrast,
  classifyContrastTile,
  histogramPercentile,
  lumaVerdict,
  passThroughRecord,
  productPhaseStamps,
  productWobbleVerdict,
  projectDirection,
  relativeLuminance,
  sanitizeZeroReads,
  settledOf,
  skyDiscRect,
} from '../lib/w1-evidence.mjs';

/** A solid RGB frame with painted rects: [{ x, y, w, h, rgb }]. */
function frame(width, height, background, rects = []) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) data.set(background, i * 3);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) data.set(r.rgb, (y * width + x) * 3);
    }
  }
  return { data, width, height, channels: 3 };
}

/** A face: light paper with dark text stripes (2 px ink every 8 px). */
function paperWithText(x, y, w, h, paper, ink) {
  const rects = [{ x, y, w, h, rgb: paper }];
  for (let ty = y + 4; ty < y + h - 2; ty += 8) rects.push({ x: x + 4, y: ty, w: w - 8, h: 2, rgb: ink });
  return rects;
}

/** A face of glyph-like ink: rows of small 'L' marks (2 px strokes) on paper. */
function paperWithGlyphs(x, y, w, h, paper, ink) {
  const rects = [{ x, y, w, h, rgb: paper }];
  for (let gy = y + 3; gy + 8 <= y + h - 2; gy += 10) {
    for (let gx = x + 3; gx + 5 <= x + w - 2; gx += 7) {
      rects.push({ x: gx, y: gy, w: 2, h: 6, rgb: ink });
      rects.push({ x: gx, y: gy + 6, w: 4, h: 2, rgb: ink });
    }
  }
  return rects;
}

describe('wave 2 flags: --luma / --audit', () => {
  it('parses on/off, implies debug, refuses bad values and a sweep', () => {
    const on = parseEvidenceFlags(['--luma', 'on', '--audit', 'on']);
    expect(on.errors).toEqual([]);
    expect(on.flags.luma).toBe(true);
    expect(on.flags.audit).toBe(true);
    expect(anyEvidenceFlag(on.flags)).toBe(true);
    expect(evidenceNeedsDebug(on.flags)).toBe(true);
    const off = parseEvidenceFlags(['--luma', 'off']);
    expect(off.flags.luma).toBeUndefined();
    expect(anyEvidenceFlag(off.flags)).toBe(false);
    expect(parseEvidenceFlags(['--luma', 'yes']).errors.join(' ')).toMatch(/--luma must be on\|off/);
    expect(parseEvidenceFlags(['--audit', '1']).errors.join(' ')).toMatch(/--audit must be on\|off/);
    expect(parseEvidenceFlags(['--sweep', 'down', '--luma', 'on']).errors.join(' ')).toMatch(/--sweep replaces the stills/);
  });
});

describe('luma arm', () => {
  it('projects a direction through a roll-free camera (yaw 0 looks down -Z)', () => {
    const cam = { yaw: 0, pitch: 0, fovDeg: 60, width: 1000, height: 500 };
    const ahead = projectDirection([0, 0, -1], cam);
    expect(ahead.x).toBeCloseTo(500, 6);
    expect(ahead.y).toBeCloseTo(250, 6);
    const right = projectDirection([0.2, 0, -1], cam);
    expect(right.x).toBeGreaterThan(500);
    const up = projectDirection([0, 0.2, -1], cam);
    expect(up.y).toBeLessThan(250);
    expect(projectDirection([0, 0, 1], cam)).toBeNull();
    // Yaw +90° looks down +X.
    const turned = projectDirection([1, 0, 0], { ...cam, yaw: Math.PI / 2 });
    expect(turned.x).toBeCloseTo(500, 6);
  });

  it('puts the sky disc on the sun direction with the 12 degree cone radius', () => {
    const disc = skyDiscRect({ sunPos: [0, 0, -100], camPos: [0, 0, 0], yaw: 0, pitch: 0, fovDeg: 60, width: 1000, height: 500 });
    expect(disc.x).toBeCloseTo(500, 6);
    const focal = 250 / Math.tan(Math.PI / 6);
    expect(disc.r).toBeCloseTo(Math.tan((12 * Math.PI) / 180) * focal, 3);
    expect(skyDiscRect({ sunPos: [0, 0, 100], camPos: [0, 0, 0], yaw: 0, pitch: 0, fovDeg: 60, width: 1000, height: 500 })).toBeNull();
  });

  it('reads histogram percentiles', () => {
    const hist = new Uint32Array(1024);
    hist[400] = 99; // luma 100
    hist[800] = 1; // luma 200
    expect(histogramPercentile(hist, 100, 0.99)).toBeCloseTo(100.1, 1);
    expect(histogramPercentile(hist, 100, 0.995)).toBeCloseTo(200.1, 1);
    expect(histogramPercentile(hist, 0, 0.5)).toBeNull();
  });

  it('passes a board brighter than everything else and fails a hotspot outside it', () => {
    const W = 200;
    const H = 120;
    const face = { id: 'board:pulse', x: 20, y: 20, w: 80, h: 60 };
    const board = paperWithText(20, 20, 80, 60, [235, 235, 230], [30, 30, 30]);
    const clean = frame(W, H, [90, 110, 140], board);
    const mask = buildLumaMask({ width: W, height: H, faceRects: [face] });
    const pass = lumaVerdict(clean, mask);
    expect(pass.verdict).toBe('pass');
    expect(pass.activeFaceP99).toBeGreaterThan(pass.outsideP995);
    expect(pass.topHotspots).toEqual([]);
    // A lamp brighter than the paper, outside the face.
    const hot = frame(W, H, [90, 110, 140], [...board, { x: 150, y: 30, w: 12, h: 12, rgb: [255, 255, 255] }]);
    const fail = lumaVerdict(hot, mask);
    expect(fail.verdict).toBe('fail');
    expect(fail.topHotspots.length).toBe(1);
    const spot = fail.topHotspots[0];
    expect(spot.frame.x).toBeLessThanOrEqual(150);
    expect(spot.frame.x + spot.frame.w).toBeGreaterThanOrEqual(162);
    expect(spot.peakLuma).toBeCloseTo(255, 0);
    // The same lamp under the HUD band (frame px) or a DOM chrome rect is excluded.
    const hudMask = buildLumaMask({ width: W, height: H, faceRects: [face], frameRects: [{ x: 140, y: 20, w: 60, h: 40 }] });
    expect(lumaVerdict(hot, hudMask).verdict).toBe('pass');
    // Inside a figure rect: the inclusive verdict fails, the wave-2 exemption passes.
    const figures = [{ id: 'ace:1', x: 145, y: 25, w: 25, h: 25 }];
    const figMask = buildLumaMask({ width: W, height: H, faceRects: [face], figureRects: figures });
    const exempt = lumaVerdict(hot, figMask, { figureRects: figures });
    expect(exempt.verdict).toBe('fail');
    expect(exempt.exFigures).toBe('pass');
    expect(exempt.topHotspots[0].figures).toEqual(['ace:1']);
  });

  it('excludes the sky-body disc and scales CSS rects to frame px', () => {
    const W = 200;
    const H = 120;
    // Scale 2: CSS rects are half the frame size.
    const board = paperWithText(40, 40, 80, 40, [230, 230, 225], [20, 20, 20]);
    const sun = { x: 160, y: 20, w: 16, h: 16, rgb: [255, 255, 250] };
    const f = frame(W, H, [120, 150, 190], [...board, sun]);
    const face = { id: 'board:pulse', x: 20, y: 20, w: 40, h: 20 };
    const withSun = lumaVerdict(f, buildLumaMask({ width: W, height: H, scale: 2, faceRects: [face] }), { scale: 2 });
    expect(withSun.verdict).toBe('fail');
    const noSun = lumaVerdict(f, buildLumaMask({ width: W, height: H, scale: 2, faceRects: [face], excludeDiscs: [{ x: 84, y: 14, r: 10 }] }), { scale: 2 });
    expect(noSun.verdict).toBe('pass');
    expect(noSun.pixels.excluded).toBeGreaterThan(0);
  });

  it('is unmeasured without an active face, never a pass', () => {
    const f = frame(50, 50, [100, 100, 100]);
    const report = lumaVerdict(f, buildLumaMask({ width: 50, height: 50 }));
    expect(report.verdict).toBe('unmeasured');
  });

  it('picks the station data faces from the subject rows (teams = the ledger, not the aces)', () => {
    const subjects = {
      rows: [
        { id: 'board:pulse', rect: { x: 1, y: 2, w: 30, h: 20 }, onScreenFraction: 1 },
        { id: 'board:schedule', rect: { x: 50, y: 2, w: 30, h: 20 }, onScreenFraction: 0.4 },
        { id: 'ace:7', rect: { x: 5, y: 5, w: 5, h: 5 }, onScreenFraction: 1 },
        { id: 'ledger:teams', rect: { x: 10, y: 50, w: 60, h: 10 }, onScreenFraction: 1 },
        { id: 'board:pulse-off', rect: null, onScreenFraction: 0 },
      ],
    };
    expect(activeFaceRects(subjects, 'pulse').map((f) => f.id)).toEqual(['board:pulse']);
    expect(activeFaceRects(subjects, 'teams').map((f) => f.id)).toEqual(['ledger:teams']);
    expect(activeFaceRects(null, 'pulse')).toEqual([]);
  });
});

describe('rendered-pixel contrast', () => {
  it('uses the WCAG luminance and ratio', () => {
    expect(contrastRatio(relativeLuminance(0, 0, 0), relativeLuminance(255, 255, 255))).toBeCloseTo(21, 5);
    expect(contrastRatio(0.5, 0.5)).toBe(1);
  });

  it('passes black-on-paper text, fails the sakura-light case (grey ink on salmon), skips plain faces', () => {
    const rect = { x: 0, y: 0, w: 96, h: 96 };
    const good = frame(96, 96, [0, 0, 0], paperWithGlyphs(0, 0, 96, 96, [240, 240, 235], [20, 20, 20]));
    const g = faceContrast(good, rect);
    expect(g.verdict).toBe('pass');
    expect(g.minContrast).toBeGreaterThan(10);
    expect(g.worstTile.strokePx).toBe(2);
    // r5: white ink rendered grey on a salmon cloth (~2.5:1).
    const bad = frame(96, 96, [0, 0, 0], paperWithGlyphs(0, 0, 96, 96, [226, 132, 118], [236, 214, 206]));
    const b = faceContrast(bad, rect);
    expect(b.verdict).toBe('fail');
    expect(b.minContrast).toBeLessThan(3);
    expect(b.worstTile.polarity).toBe('light-on-dark');
    const plain = faceContrast(frame(96, 96, [200, 200, 200]), rect);
    expect(plain.verdict).toBe('unmeasured');
    // Excluded pixels (HUD) never count.
    const mask = new Uint8Array(96 * 96).fill(MASK.EXCLUDED);
    expect(faceContrast(good, rect, { mask }).verdict).toBe('unmeasured');
  });

  it('wave 2 r3: scanlines, seams, diagonals and bezel corners are never judged as text', () => {
    const rect = { x: 0, y: 0, w: 96, h: 96 };
    // LED scanlines: a 1 px darker row every 4 px across a lit board (1.3:1).
    const scan = frame(96, 96, [0, 0, 0], [{ x: 0, y: 0, w: 96, h: 96, rgb: [200, 200, 200] }, ...Array.from({ length: 24 }, (_, i) => ({ x: 0, y: i * 4, w: 96, h: 1, rgb: [175, 175, 175] }))]);
    const s = faceContrast(scan, rect);
    expect(s.verdict).toBe('unmeasured');
    expect(s.excludedTiles.seam).toBeGreaterThan(0);
    // A diagonal stripe pattern (1 px wide, every 12 px).
    const diag = frame(96, 96, [200, 200, 200]);
    for (let y = 0; y < 96; y += 1) for (let x = 0; x < 96; x += 1) if ((x + y) % 12 === 0) diag.data.set([160, 160, 160], (y * 96 + x) * 3);
    const d = faceContrast(diag, rect);
    expect(d.verdict).toBe('unmeasured');
    expect(d.excludedTiles.span).toBeGreaterThan(0);
    // A thick bezel corner: an 8 px dark frame around a lit face.
    const bezel = frame(96, 96, [30, 30, 30], [{ x: 8, y: 8, w: 80, h: 80, rgb: [220, 220, 220] }]);
    expect(faceContrast(bezel, rect).verdict).toBe('unmeasured');
    // Real glyphs on a scanlined board still measure (the scanline rows are removed first).
    const both = frame(96, 96, [0, 0, 0], [...paperWithGlyphs(0, 0, 96, 96, [230, 230, 225], [25, 25, 25]), ...Array.from({ length: 12 }, (_, i) => ({ x: 0, y: i * 8 + 1, w: 96, h: 1, rgb: [205, 205, 200] }))]);
    const bt = faceContrast(both, rect);
    expect(bt.verdict).toBe('pass');
    expect(bt.textTiles).toBeGreaterThan(0);
  });

  it('classifyContrastTile names the tile class', () => {
    const tw = 48;
    const lum = new Float32Array(tw * tw).fill(0.8);
    expect(classifyContrastTile(lum, tw, tw).class).toBe('no-ink');
    for (const y of [10, 20, 30]) for (let x = 0; x < tw; x += 1) lum[y * tw + x] = 0.1;
    expect(classifyContrastTile(lum, tw, tw).class).toBe('seam');
  });
});

describe('docked panel', () => {
  const viewport = { w: 768, h: 1024 };
  it('is absent without a panel, passes a 14 px right rail at 768, fails small text or an off-screen box', () => {
    expect(dockedPanelVerdict({ present: false }).verdict).toBe('absent');
    const rail = { present: true, selector: '.world-focus-panel[open]', rect: { x: 336, y: 16, w: 416, h: 992 }, viewport, fontSizePx: 16, minTextFontPx: 14, minTextSample: 'Tabelle', textNodes: 40 };
    const pass = dockedPanelVerdict(rail);
    expect(pass.verdict).toBe('pass');
    expect(pass.inViewport).toBe(true);
    expect(pass.visibleFraction).toBe(1);
    const small = dockedPanelVerdict({ ...rail, minTextFontPx: 12, minTextSample: 'Stand 12.3.' });
    expect(small.verdict).toBe('fail');
    expect(small.reasons.join(' ')).toMatch(/12 px < 14 px/);
    const off = dockedPanelVerdict({ ...rail, rect: { x: 500, y: 16, w: 416, h: 992 } });
    expect(off.verdict).toBe('fail');
    expect(off.inViewport).toBe(false);
    expect(off.visibleFraction).toBeLessThan(1);
  });

  it('768 sanity: the D6 edge is the right rail at 768 and the bottom sheet at 767', () => {
    expect(expectedPanelEdge(768)).toBe('right');
    expect(expectedPanelEdge(767)).toBe('bottom');
    expect(expectedPanelEdge(390)).toBe('bottom');
  });
});

describe('pass-through bridges and the settle signal', () => {
  it('never reports a pass: absent = unmeasured, present = recorded (unjudged)', () => {
    const absent = passThroughRecord('__routeWorldBeats', { present: false });
    expect(absent.status).toBe('unmeasured');
    expect(JSON.stringify(absent)).not.toMatch(/pass/);
    const recorded = passThroughRecord('__routeWorldAttacks', { present: true, value: { rows: [{ id: 'a' }, { id: 'b' }] } });
    expect(recorded).toMatchObject({ status: 'recorded', judged: false, entries: 2 });
    expect(passThroughRecord('__routeWorldBeats', { present: true, value: [1, 2, 3] }).entries).toBe(3);
    expect(passThroughRecord('__routeWorldBeats', { present: true, error: 'boom' }).status).toBe('error');
  });

  it('reads the latched settled flag from the probe body, null when unpublished', () => {
    expect(settledOf({ settled: true })).toBe(true);
    expect(settledOf({ stationSettle: { settled: false } })).toBe(false);
    expect(settledOf({ settle: { settled: true } })).toBe(true);
    expect(settledOf({ smooth: 1 })).toBeNull();
    expect(settledOf(null)).toBeNull();
  });

  it('strict settle gate: activeIndex must equal the target and a published latch must be settled', () => {
    const at = { index: 2, section: 'teams' };
    const good = { nearest: 2, smooth: 2, exact: 2, chipHref: '#teams' };
    expect(stationSettleVerdict(good, at)).toEqual({ ok: true, reasons: [] });
    expect(stationSettleVerdict({ ...good, activeIndex: 1 }, at).reasons).toEqual(['active-index-mismatch']);
    const unsettled = stationSettleVerdict({ ...good, activeIndex: 2, settled: false }, at);
    expect(unsettled.ok).toBe(false);
    expect(unsettled.reasons).toEqual(['station-unsettled']);
    expect(unsettled.settledSignal).toBe('unsettled');
    expect(stationSettleVerdict({ ...good, activeIndex: 2, settled: true }, at)).toEqual({ ok: true, reasons: [], settledSignal: 'settled' });
  });

  it('reports a world without emitters as absent only when the debug bridges are up', () => {
    expect(particleCorridorVerdict(null, { bridgesUp: true }).verdict).toBe('absent');
    expect(particleCorridorVerdict(null).verdict).toBe('unmeasured');
    expect(particleCorridorVerdict(null, { bridgesUp: false }).verdict).toBe('unmeasured');
    expect(particleCorridorVerdict([]).verdict).toBe('pass');
  });
});

describe('draw audit + ledger', () => {
  it('takes the median whole-frame count and refuses a last-pass-only count', () => {
    const reads = [{ calls: 212, triangles: 9e5 }, { calls: 210, triangles: 9e5 }, { calls: 260, triangles: 9.1e5 }, { calls: 211, triangles: 9e5 }, { calls: 211, triangles: 9e5 }];
    const summary = drawAuditSummary(reads, { programs: 58, autoReset: false });
    expect(summary).toMatchObject({ verdict: 'measured', calls: 211, callsMin: 210, callsMax: 260, programs: 58, frames: 5 });
    expect(drawAuditSummary(reads, { autoReset: true }).verdict).toBe('unmeasured');
    expect(drawAuditSummary([{ error: 'x' }]).verdict).toBe('unmeasured');
  });

  it('writes one escaped markdown row', () => {
    const row = drawLedgerRow({
      at: '2026-09-27T06:00:00Z',
      tag: 'fid|w1',
      world: 'sakura',
      theme: 'dark',
      station: 'pulse',
      viewport: '1440',
      rung: '0',
      audit: { verdict: 'measured', calls: 211, callsMin: 210, callsMax: 260, triangles: 900000, programs: 58 },
      sourceStamp: '2026-09-27T05:59:00.000Z',
    });
    expect(row).toBe('| 2026-09-27T06:00:00Z | fid\\|w1 | sakura | dark | pulse | 1440 | 0 | 211 (210–260) | 900000 | 58 | 2026-09-27T05:59:00.000Z |');
    expect(drawLedgerRow({ tag: 't', theme: 'light', station: 'rules', viewport: '390', rung: '0', audit: { verdict: 'unmeasured', reason: 'debug off' } })).toMatch(/\| unmeasured: debug off \|/);
  });
});

describe('W7 trace hygiene', () => {
  it('carries the pixel read time on merged samples', () => {
    const merged = mergeLoaderTrace([{ t: 10, routeLive: true, canvasOpacity: 1 }, { t: 30, routeLive: true, canvasOpacity: 1 }], [{ t: 9, spread: 20 }, { t: 29, spread: 21 }]);
    expect(merged.map((s) => s.pixelT)).toEqual([9, 29]);
  });

  it('demotes unconfirmed zero-spread reads and keeps confirmed ones', () => {
    const merged = [
      { t: 0, canvasOpacity: 1, canvasSpread: 25, pixelT: 0 },
      { t: 16, canvasOpacity: 1, canvasSpread: 0, pixelT: 16 },
      { t: 32, canvasOpacity: 1, canvasSpread: 0, pixelT: 16 }, // the same read carried
      { t: 48, canvasOpacity: 1, canvasSpread: 0, pixelT: 48 },
    ];
    const noConfirm = sanitizeZeroReads(merged);
    expect(noConfirm.demoted).toBe(3);
    expect(noConfirm.merged.slice(1).every((s) => s.canvasSpread === null && s.zeroReadUnconfirmed)).toBe(true);
    // Two distinct zero reads (16, 48) + a blank composited frame near 48.
    const confirmed = sanitizeZeroReads(merged, { confirmFrames: [{ t: 50, spread: 1 }] });
    expect(confirmed.confirmed).toBe(1);
    expect(confirmed.merged[3].canvasSpread).toBe(0);
    // One read carried over two samples is NOT two agreeing reads.
    expect(confirmed.merged[2].canvasSpread).toBeNull();
    // A fading canvas (opacity < 0.98) is left to the probe's own rule.
    expect(sanitizeZeroReads([{ t: 0, canvasOpacity: 0.5, canvasSpread: 0 }]).demoted).toBe(0);
  });

  it('drops the r5 plaza-rm false blank frames from the loader verdict', async () => {
    const samples = [];
    const pixels = [];
    for (let t = 0; t <= 1600; t += 16) {
      const live = t >= 400;
      samples.push({ t, ballVisible: t < 400, ballPhase: t < 400 ? 'loading' : 'done', routeLive: live, canvasOpacity: live ? 1 : 0 });
      if (live) pixels.push({ t, spread: t >= 800 && t < 1000 ? 0 : 30 });
    }
    const report = await summarizeLoader(mergeLoaderTrace(samples, pixels));
    expect(report.blankFrames).toBe(0);
    expect(report.zeroReads.demoted).toBeGreaterThan(0);
  });

  it('uses ONE deadline anchor (generationBegunAt) for overrun and timeline', async () => {
    const samples = [];
    for (let t = 0; t <= 13000; t += 20) {
      const phase = t < 2200 ? 'idle' : t < 12400 ? 'loading' : 'presented';
      samples.push({ t, scenePhase: phase, begunAt: t < 2200 ? 0 : 2605, deadlineMs: 10000, ballVisible: t >= 2200 && t < 12500, ballPhase: t < 12500 ? 'loading' : 'done', routeLive: false, canvasOpacity: 0 });
    }
    const anchor = deadlineAnchorOf(samples);
    expect(anchor).toMatchObject({ anchor: 2605, source: 'generationBegunAt', firstLoadingSampleAt: 2200 });
    expect(anchor.firstLoadingSampleOffsetMs).toBeCloseTo(-405, 5);
    const report = await summarizeLoader(samples);
    // 12500 - 2605 = 9895 ms < 10 000: no overrun on the product clock.
    expect(report.overrun).toBeNull();
    expect(report.reasons.join(' ')).not.toMatch(/past the/);
    expect(report.probeOverrun).not.toBeNull();
    expect(report.deadlineAnchor).toBe(2605);
    expect(report.timeline.anchor).toBe(2605);
    expect(report.timeline.anchorSource).toBe('generationBegunAt');
  });

  it('takes ball / scene phases from the product logs, so a single-commit phase is never missed', () => {
    const readiness = {
      ballTrace: [{ phase: 'loading', t: 100 }, { phase: 'opening', t: 5000 }, { phase: 'releasing', t: 5480 }, { phase: 'done', t: 5490 }],
      phaseTrace: [{ phase: 'loading', generation: 1, t: 90 }, { phase: 'presented', generation: 1, t: 4800 }],
      lastFault: null,
    };
    const stamps = productPhaseStamps(readiness, { ballPhases: [{ t: 100, ballPhase: 'loading' }, { t: 5500, ballPhase: 'done' }] });
    expect(stamps.source).toBe('product-trace');
    expect(stamps.ballSequence).toEqual(['loading', 'opening', 'releasing', 'done']);
    expect(stamps.releasingSeen).toBe(true);
    expect(productPhaseStamps(null, { ballPhases: [] }).source).toBe('rAF-samples');
  });

  it('times wobbles from the rock start, not the late animationstart event', () => {
    const milestones = { at: { chunk: 1000, renderer: 1083, assets: 3000, firstFrame: null } };
    const wobbleTrace = [
      { kind: 'rockStart', shake: 1, startTime: 1010, t: 1030 },
      { kind: 'animationstart', shake: 2, animationName: 'x_wobble_y', t: 1900 }, // dispatched late
      { kind: 'rockStart', shake: 2, startTime: 1095, t: 1900 },
      { kind: 'rockStart', shake: 3, startTime: 3020, t: 3040 },
    ];
    const ok = productWobbleVerdict({ milestones, wobbleTrace });
    expect(ok.verdict).toBe('pass');
    expect(ok.source).toBe('rockStart');
    expect(ok.starts.map((s) => s.nearestRise)).toEqual(['chunk', 'renderer', 'assets']);
    const late = productWobbleVerdict({ milestones, wobbleTrace: [{ kind: 'rockStart', shake: 1, startTime: 2000 }] });
    expect(late.verdict).toBe('fail');
    // Only late events: judged on them, and labelled as event time.
    const events = productWobbleVerdict({ milestones, wobbleTrace: [{ kind: 'animationstart', shake: 1, animationName: 'wobble', t: 1040 }] });
    expect(events.source).toBe('animationstart-event-time');
    expect(productWobbleVerdict({ milestones }).verdict).toBe('unmeasured');
    expect(productWobbleVerdict({ wobbleTrace, milestones: { at: {} } }).verdict).toBe('unmeasured');
  });
});

describe('ceremony compositor evidence', () => {
  it('judges the compositor cadence inside the reveal window', () => {
    const frames = [];
    for (let t = 1000; t <= 1600; t += 16) frames.push({ kind: 'screencast', tEpoch: t, tTimecode: t < 1300 ? t : 1300 });
    const smooth = ceremonyCadence(frames, { start: 1000, end: 1600 });
    expect(smooth.verdict).toBe('pass');
    expect(smooth.compositor.maxGapMs).toBe(16);
    // The main thread froze at 1300 (timecode stuck) while the compositor kept going.
    expect(smooth.mainThread.maxGapMs).toBeLessThanOrEqual(16);
    const gap = ceremonyCadence(frames.filter((f) => f.tEpoch < 1200 || f.tEpoch > 1350), { start: 1000, end: 1600 });
    expect(gap.verdict).toBe('fail');
    expect(gap.compositor.maxGapMs).toBeGreaterThan(100);
    expect(ceremonyCadence(frames.slice(0, 3), { start: 1000, end: 1600 }).verdict).toBe('unmeasured');
    expect(ceremonyCadence(frames, null).verdict).toBe('unmeasured');
    // Periodic screenshots are not compositor frames.
    expect(ceremonyCadence(frames.map((f) => ({ ...f, kind: 'periodic' })), { start: 1000, end: 1600 }).verdict).toBe('unmeasured');
  });

  it('asserts every ceremony animation is CSS on transform / opacity', () => {
    const ok = [
      { kind: 'CSSAnimation', name: 'lidOpen', target: 'div.lid', scope: 'ceremony', properties: ['transform'] },
      { kind: 'CSSAnimation', name: 'route-canvas-release', target: 'div[data-route-canvas]', scope: 'ceremony', properties: ['opacity'] },
      { kind: 'CSSTransition', name: 'opacity', target: 'nav', scope: 'ceremony', properties: ['opacity'] },
      { kind: 'CSSAnimation', name: 'chipPulse', target: 'nav.world-nav-hud', scope: 'other', properties: ['box-shadow'] },
    ];
    const pass = ceremonyAnimationVerdict(ok);
    expect(pass.verdict).toBe('pass');
    expect(pass.animations).toBe(3);
    expect(pass.transitions).toBe(1);
    const bad = ceremonyAnimationVerdict([
      ...ok,
      { kind: 'CSSAnimation', name: 'iris', target: 'div[data-route-canvas]', scope: 'ceremony', properties: ['clipPath'] },
      { kind: 'Animation', name: '(anonymous)', target: 'div.beam', scope: 'ceremony', properties: ['opacity'] },
    ]);
    expect(bad.verdict).toBe('fail');
    expect(bad.violations.map((v) => v.name)).toEqual(['iris', '(anonymous)']);
    expect(ceremonyAnimationVerdict(null).verdict).toBe('unmeasured');
    expect(ceremonyAnimationVerdict([{ kind: 'CSSAnimation', name: 'x', scope: 'other', properties: ['opacity'] }]).verdict).toBe('unmeasured');
  });

  it('allows the id-allowlisted compositor-only life bound, never an unnamed or non-compositor one', () => {
    const bound = { kind: 'Animation', name: 'ball-life-bound', target: 'div[data-ball-loader]', scope: 'ceremony', properties: ['opacity'] };
    const v = ceremonyAnimationVerdict([bound]);
    expect(v.verdict).toBe('pass');
    expect(v.allowed).toEqual([{ name: 'ball-life-bound', target: 'div[data-ball-loader]', kind: 'Animation', properties: ['opacity'], note: 'allowed: life bound' }]);
    const wrongProps = ceremonyAnimationVerdict([{ ...bound, properties: ['opacity', 'filter'] }]);
    expect(wrongProps.verdict).toBe('fail');
    expect(wrongProps.allowed).toEqual([]);
    expect(ceremonyAnimationVerdict([{ ...bound, name: 'other-bound' }]).verdict).toBe('fail');
  });
});

/**
 * LOOK r5 SEAT H: program split by output colour space / tone mapping (D26),
 * rAF main-thread gap windows, harness face-texture read input, the
 * textured-face rect refinement and the V3 reveal median.
 */
import { describe, expect, it } from 'vitest';
import {
  D26_ACTIVE_CAPS,
  faceTextureVerdictInput,
  parseProgramCacheKey,
  programSplit,
  projectBoxRect,
  rafGapWindows,
  refineFaceRows,
  revealMedian,
} from '../lib/look-r5-evidence.mjs';

const TAIL = 'onBeforeCompile( /* shaderobject, renderer */ ) {}';
// Real three r185 keys (headless Chromium, WebGLRenderer toneMapping ACES):
// a MeshStandardMaterial and a ShaderMaterial with a define valued "highp",
// drawn to the canvas (srgb, ACES) and into a render target (srgb-linear, none).
const STD_CANVAS = `physical,STANDARD,,highp,srgb,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,0,0,0,0,0,0,0,0,0,0,1,4,0,0,0,8388608,8519682,srgb,${TAIL}`;
const STD_RT = `physical,STANDARD,,highp,srgb-linear,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,8388608,8519682,srgb,${TAIL}`;
const SHADER_CANVAS = `0,1,FOO,highp,BAR,2,highp,srgb,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,0,0,0,0,0,0,0,0,0,0,1,4,0,0,0,8388608,8519680,srgb,${TAIL}`;
const SHADER_RT = `0,1,FOO,highp,BAR,2,highp,srgb-linear,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,8388608,8519680,srgb,${TAIL}`;
const RAW = `0,1,${TAIL}`;

describe('parseProgramCacheKey (real three r185 keys)', () => {
  it('reads output colour space and tone mapping from the parameter block', () => {
    expect(parseProgramCacheKey(STD_CANVAS)).toMatchObject({ outputColorSpace: 'srgb', toneMapping: 4, toneMappingName: 'aces', raw: false });
    expect(parseProgramCacheKey(STD_RT)).toMatchObject({ outputColorSpace: 'srgb-linear', toneMapping: 0, toneMappingName: 'none', raw: false });
  });
  it('is not fooled by a define whose value is a precision token', () => {
    expect(parseProgramCacheKey(SHADER_CANVAS)).toMatchObject({ outputColorSpace: 'srgb', toneMappingName: 'aces' });
    expect(parseProgramCacheKey(SHADER_RT)).toMatchObject({ outputColorSpace: 'srgb-linear', toneMappingName: 'none' });
  });
  it('marks raw shader programs and garbage', () => {
    expect(parseProgramCacheKey(RAW)).toMatchObject({ raw: true, outputColorSpace: null });
    expect(parseProgramCacheKey(null).raw).toBeNull();
  });
});

describe('programSplit (D26 on the active rung)', () => {
  const inv = (linearDrawn, linearIdle, srgbPrewarm, finalPass = 1) => [
    ...Array.from({ length: linearDrawn }, () => ({ cacheKey: STD_RT, drawn: true })),
    ...Array.from({ length: linearIdle }, () => ({ cacheKey: SHADER_RT, drawn: false })),
    ...Array.from({ length: srgbPrewarm }, () => ({ cacheKey: STD_CANVAS, drawn: false })),
    ...Array.from({ length: finalPass }, () => ({ cacheKey: SHADER_CANVAS, drawn: true })),
  ];
  it('splits the AD-style 80 + 53 inventory and passes the light cap at rung 0', () => {
    const s = programSplit(inv(60, 19, 53), { theme: 'light', rung: 0 });
    expect(s.total).toBe(133);
    expect(s.activeOutput).toBe('srgb-linear');
    expect(s.active.count).toBe(80); // 79 linear + the drawn sRGB final pass
    expect(s.prewarmed.count).toBe(53);
    expect(s.prewarmed.byToneMapping).toEqual({ aces: 53 });
    expect(s.d26).toMatchObject({ verdict: 'pass', cap: D26_ACTIVE_CAPS.light });
    expect(s.byOutputTone['srgb-linear|none']).toBe(79);
  });
  it('fails over the cap, is informational off rung 0, unmeasured with nothing drawn', () => {
    expect(programSplit(inv(80, 10, 5), { theme: 'light', rung: 0 }).d26.verdict).toBe('fail');
    expect(programSplit(inv(80, 10, 5), { theme: 'dark', rung: 0 }).d26.verdict).toBe('pass');
    expect(programSplit(inv(60, 19, 53), { theme: 'light', rung: 1 }).d26.verdict).toBe('informational');
    expect(programSplit(inv(0, 19, 53, 0), { theme: 'light', rung: 0 }).d26.verdict).toBe('unmeasured');
    expect(programSplit([], {}).verdict).toBe('unmeasured');
  });
  it('counts raw programs as active', () => {
    const s = programSplit([...inv(10, 0, 5), { cacheKey: RAW, drawn: false }], { theme: 'light', rung: 0 });
    expect(s.active.byOutput.raw).toBe(1);
    expect(s.active.count).toBe(12);
  });
});

describe('rafGapWindows (main-thread gaps, source named)', () => {
  it('books gaps to preBall / ceremony / after by the earlier sample', () => {
    const t = [0, 16, 316, 332, 1000, 1017, 1134, 1150, 2000, 2400];
    const g = rafGapWindows(t.map((v) => ({ t: v })), { ballShownAt: 900, ballEndAt: 1900 });
    expect(g.preBall.maxGapMs).toBe(668); // 332 -> 1000
    expect(g.ceremony.maxGapMs).toBe(850); // 1150 -> 2000 (earlier sample in the ceremony)
    expect(g.after.maxGapMs).toBe(400);
    expect(g.source).toMatch(/rAF/);
  });
  it('is unsplit without a ball', () => {
    expect(rafGapWindows([{ t: 0 }, { t: 50 }]).unsplit.maxGapMs).toBe(50);
  });
});

describe('faceTextureVerdictInput', () => {
  it('prefers the harness count when the product row only sees .map', () => {
    const r = faceTextureVerdictInput({ visibleRenderables: 2, textured: 0 }, { found: true, texturedMeshes: 1 });
    expect(r).toMatchObject({ textured: 1, texturedProduct: 0, texturedHarness: 1 });
    expect(r.texturedSource).toMatch(/harness/);
    expect(faceTextureVerdictInput({ visibleRenderables: 2, textured: 0 }, { found: true, texturedMeshes: 0 }).textured).toBe(0);
    expect(faceTextureVerdictInput(null, null)).toBeNull();
  });
});

describe('textured-face rect', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  it('projects a box through identity view / orthographic-like projection', () => {
    const r = projectBoxRect({ min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] }, I, I, I, { x: 0, y: 0, w: 200, h: 100 });
    expect(r).toMatchObject({ x: 50, y: 25, w: 100, h: 50, onScreenFraction: 1 });
  });
  it('returns null behind the camera', () => {
    const flip = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1];
    expect(projectBoxRect({ min: [0, 0, 0], max: [1, 1, 1] }, I, I, flip, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });
  it('replaces only the ledger rect and keeps the bounds rect', () => {
    const subjects = { rows: [{ id: 'ledger:teams', rect: { x: 0, y: 500, w: 1000, h: 340 } }, { id: 'board:pulse', rect: { x: 1, y: 1, w: 2, h: 2 } }] };
    const out = refineFaceRows(subjects, { 'ledger:teams': { x: 100, y: 600, w: 800, h: 90, onScreenFraction: 1 } });
    expect(out.rows[0]).toMatchObject({ rect: { x: 100, y: 600, w: 800, h: 90 }, boundsRect: { h: 340 }, rectSource: 'textured-face:teams-ledger-face' });
    expect(out.rows[1]).toBe(subjects.rows[1]);
    expect(refineFaceRows(subjects, {}).rows[0].rectSource).toBe('bounds');
  });
});

describe('revealMedian (V3)', () => {
  const rec = (live, prod = true, vp = '1440') => ({ viewport: vp, invocation: prod ? { prodAttach: { pids: [1] } } : {}, analysis: { verdict: 'pass', routeLiveAt: live, timeline: { routeLiveSinceAnchorMs: live - 2000, ballEndAt: live + 270 } } });
  it('judges the median of 3 prod runs from navigation', () => {
    expect(revealMedian([rec(11000), rec(12500), rec(11800)])).toMatchObject({ verdict: 'pass', medianRouteLiveFromNavMs: 11800, medianRouteLiveSinceAnchorMs: 9800 });
    expect(revealMedian([rec(13000), rec(12500), rec(11800)]).verdict).toBe('fail');
  });
  it('is indicative on dev, unmeasured on too few or mixed runs, and a never-live run is a miss', () => {
    expect(revealMedian([rec(9000, false), rec(9000), rec(9000)]).verdict).toBe('indicative');
    expect(revealMedian([rec(9000), rec(9000)]).verdict).toBe('unmeasured');
    expect(revealMedian([rec(9000), rec(9000, true, '390'), rec(9000)]).verdict).toBe('unmeasured');
    expect(revealMedian([rec(9000), rec(null), rec(null)]).verdict).toBe('fail');
  });
});

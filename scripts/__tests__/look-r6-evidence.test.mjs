/**
 * LOOK r6 SEAT H (D28): the prod timeout inject, station-content keying,
 * the D27 canonical baseline, the quiet file name, the contrast noise band,
 * the saturated-cell fallback, the phase trace, LoAF by phase, the
 * program-key audit, --dolly-at, the throttle profile and the shader-source
 * stability diff.
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_BASELINES,
  SCENE_CHUNK_MARKER,
  baselineIblFlags,
  canonicalBaselinesFor,
  contentBaselineChain,
  contentFallbackVerdict,
  contrastRepeatBand,
  decodeProgramKey,
  dollyPointToken,
  dollyTimesAt,
  framePose,
  fulfilHeaders,
  innerFaceRepeat,
  isNextChunkUrl,
  isSceneChunk,
  isWorldManifestUrl,
  labelContrastDelta,
  loafByPhase,
  manifestFallbackHolds,
  netThrottleConditions,
  parseDollyAt,
  parseNetThrottle,
  parseR6Flags,
  phaseTraceSummary,
  phaseWindowsFromStamps,
  pickContentBaseline,
  programKeyAudit,
  quietFileName,
  r6InvocationArgs,
  resolveCaptureWorld,
  revealFromPhaseRows,
  saturatedCellFallback,
  sceneChunkMatch,
  shaderSourceDiff,
  stationCardMaskOf,
  timeoutRoutePredicate,
  worldFromDataWorld,
} from '../lib/look-r6-evidence.mjs';
import { contentBaselineKey } from '../lib/capture-evidence.mjs';
import { pickDiffCandidate, poseParallaxOnly } from '../lib/look-r3-evidence.mjs';

const PROD_CHUNK = 'http://localhost:3112/_next/static/chunks/0dl47ugl1o-_4.js';

describe('H1: the scene chunk is found by content (prod) or URL (dev)', () => {
  it('matches a hashed production chunk only when its body carries the R3F marker', () => {
    const body = `(()=>{throw new Error("${SCENE_CHUNK_MARKER}! Hooks like useFrame")})()`;
    expect(sceneChunkMatch(PROD_CHUNK, body)).toBe('content');
    expect(isSceneChunk(PROD_CHUNK, Buffer.from(body))).toBe(true);
    expect(isSceneChunk(PROD_CHUNK, 'console.log("app shell")')).toBe(false);
    expect(isSceneChunk(PROD_CHUNK)).toBe(false);
  });
  it('keeps the dev URL fast path and ignores non-chunk requests', () => {
    expect(sceneChunkMatch('http://localhost:3111/_next/static/chunks/node_modules_%40react-three_fiber_dist_abc.js')).toBe('url');
    expect(sceneChunkMatch('http://localhost:3111/_next/static/chunks/[root]/node_modules/@react-three/fiber/x.js')).toBe('url');
    expect(sceneChunkMatch('http://localhost:3112/models/world/manifest.json', SCENE_CHUNK_MARKER)).toBeNull();
    expect(sceneChunkMatch('http://localhost:3112/_next/static/css/app.css', SCENE_CHUNK_MARKER)).toBeNull();
    expect(isNextChunkUrl('http://localhost:3112/_next/static/chunks/app/leagues/page-1.js?dpl=x')).toBe(true);
    expect(isNextChunkUrl('http://localhost:3112/_next/static/media/font.woff2')).toBe(false);
  });
  it('routes chunks and the manifest, and holds the manifest only while no scene chunk is held', () => {
    expect(isWorldManifestUrl('http://localhost:3112/models/world/manifest.json')).toBe(true);
    expect(isWorldManifestUrl('https://x.supabase.co/storage/v1/object/public/world-assets/manifest.json')).toBe(true);
    expect(isWorldManifestUrl('http://localhost:3112/manifest.json')).toBe(false);
    // D42 commit P: the shipped manifest.v3.json (env base and bucket) and an arm's manifest.json
    expect(isWorldManifestUrl('http://localhost:3112/models/world/manifest.v3.json')).toBe(true);
    expect(isWorldManifestUrl('https://x.supabase.co/storage/v1/object/public/world-assets/manifest.v3.json')).toBe(true);
    expect(isWorldManifestUrl('http://localhost:3112/models/world/d42m/manifest.json')).toBe(true);
    expect(isWorldManifestUrl('http://localhost:3112/models/world/manifest.v3.json.bak')).toBe(false);
    expect(timeoutRoutePredicate('http://localhost:3112/models/world/manifest.v3.json')).toBe(true);
    expect(timeoutRoutePredicate(PROD_CHUNK)).toBe(true);
    expect(timeoutRoutePredicate('http://localhost:3112/models/world/manifest.json')).toBe(true);
    expect(timeoutRoutePredicate('http://localhost:3112/models/world/models/regular/2.glb')).toBe(false);
    expect(manifestFallbackHolds([])).toBe(true);
    expect(manifestFallbackHolds([{ by: 'manifest' }])).toBe(true);
    expect(manifestFallbackHolds([{ by: 'content' }])).toBe(false);
  });
  it('drops encoding / length headers when a decoded body is re-sent', () => {
    expect(fulfilHeaders({ 'Content-Encoding': 'br', 'content-length': '10', 'content-type': 'application/javascript', 'Transfer-Encoding': 'chunked' })).toEqual({ 'content-type': 'application/javascript' });
  });
});

describe('H1: the harness-side stall for production builds (stall-hold)', () => {
  it('parses and judges it on the stall path from the attempt begin', async () => {
    const { parseEvidenceFlags, summarizeLoader } = await import('../lib/capture-evidence.mjs');
    const parsed = parseEvidenceFlags(['--loader-trace', '--fail-inject', 'stall-hold']);
    expect(parsed.errors).toEqual([]);
    expect(parsed.flags.failInject).toBe('stall-hold');
    const samples = [];
    for (let t = 0; t <= 9000; t += 50) {
      const lite = t >= 6600;
      samples.push({ t, begunAt: 500, deadlineMs: 20000, scenePhase: lite ? 'failed' : 'loading', routeLive: false, ballVisible: !lite, ballPhase: lite ? 'aborted' : 'loading', canvasOpacity: 0 });
    }
    const readiness = { phaseTrace: [{ phase: 'loading', generation: 1, t: 500 }, { phase: 'failed', generation: 1, t: 6550 }], lastFault: { generation: 1, reason: 'readiness-stall' } };
    const a = await summarizeLoader(samples, { failInject: 'stall-hold', readiness });
    expect(a.stallPath).toMatchObject({ injectMs: 0, anchor: 500, failReason: 'readiness-stall', verdict: 'pass' });
    expect(a.stallPath.liteShownAt).toBe(6600);
  });
});

describe('H2: station-content keying', () => {
  it('takes the world from the DOM token (evoliga -> plaza) over --world', () => {
    expect(worldFromDataWorld('evoliga')).toBe('plaza');
    expect(worldFromDataWorld('sakura')).toBe('sakura');
    expect(worldFromDataWorld('')).toBeNull();
    expect(resolveCaptureWorld({ domNamespace: 'sakura' })).toMatchObject({ world: 'sakura', source: 'dom [data-world]', mismatch: false });
    expect(resolveCaptureWorld({ flagWorld: 'mountain' })).toMatchObject({ world: 'mountain', source: '--world' });
    expect(resolveCaptureWorld({})).toMatchObject({ world: 'plaza', source: 'default (plaza)' });
    expect(resolveCaptureWorld({ flagWorld: 'plaza', domNamespace: 'clouds' }).mismatch).toBe(true);
  });
  it('keys by dpr and rung with a fallback chain to the r4 keys', () => {
    const chain = contentBaselineChain({ world: 'plaza', theme: 'light', station: 'pulse', viewport: '390', dpr: 2, rung: 1 });
    expect(chain.map((l) => l.key)).toEqual(['plaza|light|pulse|390|d2|q1', 'plaza|light|pulse|390|q1', 'plaza|light|pulse|390']);
    expect(chain[0].key).toBe(contentBaselineKey({ world: 'plaza', theme: 'light', station: 'pulse', viewport: '390', dpr: 2, rung: 1 }));
    expect(contentBaselineKey({ world: 'plaza', theme: 'light', station: 'pulse', viewport: '390' })).toBe('plaza|light|pulse|390');
    expect(contentBaselineChain({ world: 'plaza', theme: 'dark', station: 'teams', viewport: '1440', dpr: 1, rung: null }).map((l) => l.key)).toEqual(['plaza|dark|teams|1440|d1', 'plaza|dark|teams|1440']);
  });
  it('downgrades a fail against a baseline of another rung to suspect (the prod 390 case)', () => {
    const entries = { 'plaza|light|pulse|390': { renderables: 70, rung: 0, dpr: 2 } };
    const chain = contentBaselineChain({ world: 'plaza', theme: 'light', station: 'pulse', viewport: '390', dpr: 2, rung: 1 });
    const pick = pickContentBaseline(entries, chain, { dpr: 2, rung: 1 });
    expect(pick).toMatchObject({ key: 'plaza|light|pulse|390', kind: 'legacy', rungMatched: false, dprMatched: true });
    const v = contentFallbackVerdict({ verdict: 'fail', reason: 'station-content-missing', share: 0.771 }, pick, chain[0].key);
    expect(v.verdict).toBe('suspect');
    expect(v.suspectBecause).toMatch(/quality rung/);
    expect(v.suspectBecause).toMatch(/plaza\|light\|pulse\|390\|d2\|q1/);
  });
  it('keeps an exact-key fail a fail, and flags a legacy rung key recorded at another dpr', () => {
    const exact = pickContentBaseline({ 'plaza|light|pulse|390|d2|q1': { renderables: 54 } }, contentBaselineChain({ world: 'plaza', theme: 'light', station: 'pulse', viewport: '390', dpr: 2, rung: 1 }));
    expect(exact.kind).toBe('exact');
    expect(contentFallbackVerdict({ verdict: 'fail' }, exact).verdict).toBe('fail');
    const legacy = pickContentBaseline({ 'plaza|light|pulse|390|q0': { renderables: 70, dpr: 1 } }, contentBaselineChain({ world: 'plaza', theme: 'light', station: 'pulse', viewport: '390', dpr: 2, rung: 0 }), { dpr: 2, rung: 0 });
    expect(legacy).toMatchObject({ kind: 'legacy-rung', dprMatched: false, rungMatched: true });
    expect(contentFallbackVerdict({ verdict: 'fail' }, legacy).verdict).toBe('suspect');
    expect(contentFallbackVerdict({ verdict: 'pass' }, legacy).verdict).toBe('pass');
    expect(pickContentBaseline({}, contentBaselineChain({ world: 'plaza', theme: 'light', station: 'pulse', viewport: '390', dpr: 1, rung: 0 }))).toBeNull();
  });
});

describe('H3: canonical baseline, IBL flags, the Station Card mask', () => {
  it('names the D27 sakura baseline and nothing for the other worlds', () => {
    expect(CANONICAL_BASELINES.sakura).toEqual(['fid-w2c-r2-sakura-light']);
    expect(canonicalBaselinesFor('sakura')).toEqual(['fid-w2c-r2-sakura-light']);
    expect(canonicalBaselinesFor('plaza')).toEqual([]);
  });
  it('flags a before without iblState and a black one', () => {
    expect(baselineIblFlags({})).toEqual(['BASELINE-IBL-UNKNOWN']);
    expect(baselineIblFlags({ iblState: { verdict: 'black' } })).toEqual(['BASELINE-IBL-BLACK']);
    expect(baselineIblFlags({ iblState: { verdict: 'lit' } })).toEqual([]);
    expect(baselineIblFlags(null)).toEqual([]);
  });
  it('masks the composited card in frame px (padded), or its content rect scaled', () => {
    expect(stationCardMaskOf({ stationCard: { framePx: { left: 24, top: 24, width: 360, height: 169 } } })).toEqual([{ id: 'station-card', x: 20, y: 20, w: 368, h: 177 }]);
    expect(stationCardMaskOf({ stationCard: { composite: 'content-box', contentRect: { x: 10, y: 10, w: 100, h: 50 } }, lumaInputs: { frame: { scale: 2 } } }, { padPx: 0 })).toEqual([{ id: 'station-card', x: 20, y: 20, w: 200, h: 100 }]);
    expect(stationCardMaskOf({ stationCard: { present: true, framePx: null } })).toEqual([]);
    expect(stationCardMaskOf({})).toEqual([]);
  });
  it('ranks the canonical parallax-only baseline over a pose-matched luma-divergent before, never over a clean one', () => {
    const parallax = { match: false, dPos: 0, dYaw: 0.018, dPitch: null, reasons: ['yaw differs'] };
    expect(poseParallaxOnly(parallax)).toBe(true);
    expect(poseParallaxOnly({ match: false, dPos: 0.5, dYaw: 0 })).toBe(false);
    expect(poseParallaxOnly({ match: false, dPos: 0, dYaw: 0.2 })).toBe(false);
    const blast = [
      { tag: 'look-before-blast-sakura', exists: true, pose: { match: true }, sidecar: { worldLuma: { mean: 110 } } },
      { tag: 'fid-w2c-r2-sakura-light', exists: true, pose: parallax, sidecar: { worldLuma: { mean: 153.8 } } },
    ];
    const r = pickDiffCandidate(blast, { referenceLuma: { mean: 153.6 }, prefer: ['fid-w2c-r2-sakura-light'] });
    expect(r.pick.tag).toBe('fid-w2c-r2-sakura-light');
    expect(r.poseValid).toBe('parallax');
    expect(r.canonical).toBe(true);
    expect(r.iblUnknown).toBe(true);
    expect(r.why).toMatch(/pointer parallax/);
    // Without the preference the pose-matched before still wins (the r5 behaviour).
    expect(pickDiffCandidate(blast, { referenceLuma: { mean: 153.6 } }).pick.tag).toBe('look-before-blast-sakura');
    // A clean same-pose recapture beats the canonical parallax-only still.
    const withRecapture = [...blast, { tag: 'r6-sakura-base', exists: true, pose: { match: true }, sidecar: { worldLuma: { mean: 150 }, iblState: { verdict: 'lit' } } }];
    expect(pickDiffCandidate(withRecapture, { referenceLuma: { mean: 153.6 }, prefer: ['fid-w2c-r2-sakura-light'] }).pick.tag).toBe('r6-sakura-base');
  });
  it('prefers a recorded lit IBL over an unknown one at equal rank', () => {
    const c = [
      { tag: 'old', exists: true, pose: { match: true }, sidecar: { worldLuma: { mean: 100 } } },
      { tag: 'new', exists: true, pose: { match: true }, sidecar: { worldLuma: { mean: 100 }, iblState: { verdict: 'lit' } } },
    ];
    expect(pickDiffCandidate(c, { referenceLuma: { mean: 100 } }).pick.tag).toBe('new');
  });
});

describe('H4: quiet file name', () => {
  it('carries the theme', () => {
    expect(quietFileName('gate-prod3-quiet', 'dark', '1440')).toBe('gate-prod3-quiet-dark-1440-quiet.json');
  });
});

describe('H5: contrast noise band, saturated fallback, phase trace', () => {
  const faces = (list) => ({ faces: list.map(([id, min, med]) => ({ id, minContrast: min, medianContrast: med })) });
  it('bands each face by the repeat-pose delta (with a floor) and labels a dip within it noise', () => {
    const band = contrastRepeatBand(faces([['board:schedule', 2.58, 5], ['plaque:right', 10.89, 12]]), faces([['board:schedule', 2.5, 5.1], ['plaque:right', 10.87, 12]]));
    expect(band.verdict).toBe('measured');
    expect(band.faces.find((f) => f.id === 'board:schedule')).toMatchObject({ delta: 0.08, band: 0.08, medianDelta: 0.1 });
    expect(band.faces.find((f) => f.id === 'plaque:right').band).toBe(0.05);
    expect(band.bandMax).toBe(0.08);
    expect(labelContrastDelta(2.58, 2.55, 0.08).label).toBe('noise');
    expect(labelContrastDelta(2.58, 2.3, 0.08).label).toBe('regression');
    expect(labelContrastDelta(2.58, 3.0, 0.08).label).toBe('improvement');
    expect(labelContrastDelta(null, 3, 0.1).label).toBe('unmeasured');
    expect(contrastRepeatBand(null, null).verdict).toBe('unmeasured');
  });
  it('reads face-internal luma of both presents', () => {
    const img = (v) => ({ width: 20, height: 20, channels: 3, data: new Uint8Array(20 * 20 * 3).fill(v) });
    const rows = innerFaceRepeat(img(100), img(104), [{ id: 'board:pulse', x: 0, y: 0, w: 20, h: 20 }]);
    expect(rows[0]).toMatchObject({ verdict: 'measured', meanDelta: 4, rect: { x: 5, y: 5, w: 10, h: 10 } });
  });
  it('falls back from saturated luma to contrast, then to the inner-face diff', () => {
    const saturated = { verdict: 'saturated', exFigures: 'saturated' };
    expect(saturatedCellFallback({ luma: { verdict: 'pass' } }).applies).toBe(false);
    expect(saturatedCellFallback({ luma: saturated, contrast: { verdict: 'pass', minContrast: 5.7, face: 'desk-pc' } })).toMatchObject({ source: 'contrast', verdict: 'pass' });
    const diff = { verdict: 'measured', poseValid: true, against: 'before-roster-390.png', faces: [{ id: 'desk-pc', inner: { overThresholdPct: 0.1, mean: 0.2 } }, { id: 'plaque:left', inner: { overThresholdPct: 0.4 } }] };
    expect(saturatedCellFallback({ luma: saturated, contrast: { verdict: 'unmeasured' }, diffAgainst: diff })).toMatchObject({ source: 'inner-face-diff', verdict: 'pass' });
    const changed = { ...diff, faces: [{ id: 'desk-pc', inner: { overThresholdPct: 3.1 } }] };
    const fail = saturatedCellFallback({ luma: saturated, contrast: null, diffAgainst: changed });
    expect(fail).toMatchObject({ source: 'inner-face-diff', verdict: 'fail' });
    expect(fail.reasons[0]).toMatch(/desk-pc inner face 3.1%/);
    expect(saturatedCellFallback({ luma: saturated, diffAgainst: { ...diff, verdict: 'pose-mismatch', poseValid: false } })).toMatchObject({ source: 'none', verdict: 'unmeasured' });
    expect(saturatedCellFallback({ luma: saturated }).reason).toMatch(/--diff-against/);
  });
  it('summarises the phase trace from navigation with the product logs', () => {
    const dom = { rows: [{ t: 50, ball: 'absent', live: false }, { t: 480, ball: 'hidden', live: false }, { t: 600, ball: 'loading', live: false, scene: 'loading' }, { t: 9700, ball: 'opening', live: false, scene: 'presented' }, { t: 10800, ball: 'releasing', live: true }, { t: 11060, ball: 'done', live: true }], stoppedAt: 11100 };
    const s = phaseTraceSummary(dom, { ballTrace: [{ phase: 'loading', t: 597.4 }], phaseTrace: [{ phase: 'presented', generation: 1, t: 1360.1 }] });
    expect(s.ballSequence).toEqual(['absent', 'hidden', 'loading', 'opening', 'releasing', 'done']);
    expect(s.sawLoading).toBe(true);
    expect(s.firstLoadingAt).toBe(600);
    expect(s.routeLiveAt).toBe(10800);
    expect(s.product.ballTrace[0]).toEqual({ phase: 'loading', t: 597.4 });
    expect(phaseTraceSummary(null, null)).toMatchObject({ source: 'none', sawLoading: false });
    expect(revealFromPhaseRows(dom)).toMatchObject({ routeLiveAt: 10800, ballDoneAt: 11060, ballLoadingAt: 600 });
  });
});

describe('H6: LoAF by ball phase, program keys', () => {
  const stamps = {
    ballPhases: [{ t: 50, ballPhase: null }],
    product: {
      ballPhases: [{ t: 479.8, ballPhase: 'hidden' }, { t: 597.4, ballPhase: 'loading' }, { t: 9725.4, ballPhase: 'opening' }, { t: 10247.9, ballPhase: 'releasing' }, { t: 11063.4, ballPhase: 'done' }],
      scenePhases: [{ t: 496.5, scenePhase: 'loading' }, { t: 1360.1, scenePhase: 'presented' }],
    },
  };
  it('cuts the ball-phase windows from the product logs', () => {
    const pw = phaseWindowsFromStamps(stamps);
    expect(pw.source).toMatch(/product/);
    expect(pw.windows.map((w) => w.phase)).toEqual(['preBall', 'loading-before-presented', 'loading-after-presented', 'opening', 'releasing', 'after']);
    expect(pw.windows[1]).toMatchObject({ from: 597.4, to: 1360.1 });
    expect(phaseWindowsFromStamps({}).windows).toEqual([]);
  });
  it('books long animation frames to their window with the top script sources', () => {
    const { windows } = phaseWindowsFromStamps(stamps);
    const rows = [
      { start: 985, duration: 317, blockingDuration: 267, scripts: [{ ms: 290, sourceURL: '_next/static/chunks/0dl.js', sourceFunctionName: 'commitRoot', sourceCharPosition: 1200, invokerType: 'user-callback' }] },
      { start: 1100, duration: 120, blockingDuration: 70, scripts: [{ ms: 100, sourceURL: '_next/static/chunks/0dl.js', sourceFunctionName: 'commitRoot', sourceCharPosition: 1200 }] },
      { start: 5000, duration: 80, scripts: [] },
      { start: 100, duration: 60, scripts: [] },
    ];
    const by = loafByPhase(rows, windows);
    expect(by['loading-before-presented']).toMatchObject({ count: 2, maxMs: 317, maxAt: 985, blockingMs: 337 });
    expect(by['loading-before-presented'].topSources[0]).toMatchObject({ source: '_next/static/chunks/0dl.js#commitRoot@1200', ms: 390, frames: 2 });
    expect(by['loading-after-presented'].count).toBe(1);
    expect(by.preBall.count).toBe(1);
  });
  // Real three r185 keys (see look-r5-evidence.test.mjs): canvas (srgb, ACES) vs render target (srgb-linear, none).
  const TAIL = 'onBeforeCompile( /* shaderobject, renderer */ ) {}';
  const STD_CANVAS = `physical,STANDARD,,highp,srgb,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,0,0,0,0,0,0,0,0,0,0,1,4,0,0,0,8388608,8519682,srgb,${TAIL}`;
  const STD_RT = `physical,STANDARD,,highp,srgb-linear,false,,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,,false,false,0,,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,8388608,8519682,srgb,${TAIL}`;
  it('decodes a key: identity, named parameters, boolean layers, custom tail', () => {
    const d = decodeProgramKey(STD_CANVAS);
    expect(d).toMatchObject({ raw: false, shader: 'physical', identity: 'physical,STANDARD,', rendererOutputColorSpace: 'srgb', custom: TAIL });
    expect(d.params).toMatchObject({ precision: 'highp', outputColorSpace: 'srgb', toneMapping: '4', numDirLights: '1' });
    expect(d.layersA).toEqual(['vertexNormals']);
    expect(d.layersB).toEqual(['useFog', 'opaque', 'hasPositionAttribute']);
    expect(decodeProgramKey(`0,1,${TAIL}`)).toMatchObject({ raw: true });
    expect(decodeProgramKey(null)).toBeNull();
  });
  it('lists near pairs with the fields that split them', () => {
    const audit = programKeyAudit([{ cacheKey: STD_CANVAS, name: 'MeshStandardMaterial', drawn: false }, { cacheKey: STD_RT, name: 'MeshStandardMaterial', drawn: true }, { cacheKey: STD_RT }, { cacheKey: `0,1,${TAIL}` }]);
    expect(audit.total).toBe(4);
    expect(audit.identicalKeys).toBe(1);
    expect(audit.raw).toBe(1);
    expect(audit.groups.physical).toBe(3);
    const pair = audit.nearPairs.find((p) => p.a === 0 && p.b === 1);
    expect(pair.diffs).toEqual(['outputColorSpace: srgb -> srgb-linear', 'toneMapping: 4 -> 0']);
    expect(audit.splitFields.toneMapping).toBe(2);
  });
});

describe('H7: --dolly-at, throttle, shader-source stability', () => {
  it('parses progress points and names their stills', () => {
    expect(parseDollyAt('3.70,3.55,3.6,3.64')).toEqual({ points: [3.55, 3.6, 3.64, 3.7] });
    expect(parseDollyAt('3.55,x').error).toMatch(/--dolly-at/);
    expect(parseDollyAt('5').error).toBeTruthy();
    expect(parseDollyAt('').error).toBeTruthy();
    expect(dollyPointToken(3.55)).toBe('s3p55');
    expect(dollyPointToken(3.6)).toBe('s3p60');
    expect(dollyPointToken(3.645)).toBe('s3p645');
  });
  it('finds the crossing time of each point in either direction', () => {
    const frames = [{ t: 0, smooth: 3.4 }, { t: 100, smooth: 3.6 }, { t: 200, smooth: 3.8 }, { t: 300, smooth: 3.5 }];
    const hits = dollyTimesAt(frames, [3.55, 3.7]);
    expect(hits.map((h) => [h.t, h.at, h.direction])).toEqual([
      [75, 3.55, 'down'],
      [150, 3.7, 'down'],
      [233.3, 3.7, 'up'],
      [283.3, 3.55, 'up'],
    ]);
    expect(framePose({ t: 5, camPos: [1, 2, 3], yaw: 0.5, pitch: -0.1, fov: 42, smooth: 3.6 })).toMatchObject({ camPos: [1, 2, 3], yawRad: 0.5, pitchRad: -0.1, fov: 42 });
    expect(framePose({ t: 5 })).toBeNull();
  });
  it('parses the throttle profile into CDP conditions', () => {
    expect(parseNetThrottle('50,20')).toEqual({ mbps: 50, rttMs: 20 });
    expect(parseNetThrottle('50').error).toMatch(/--net-throttle/);
    expect(netThrottleConditions({ mbps: 50, rttMs: 20 })).toEqual({ offline: false, latency: 20, downloadThroughput: 6250000, uploadThroughput: 6250000 });
  });
  it('diffs shader sources between loads and names the first differing line', () => {
    const log = (entries) => ({ entries: entries.map(([hash, type]) => ({ hash, type })), sources: Object.fromEntries(entries.map(([hash, , src]) => [hash, src])) });
    const a = log([['h1', 'vertex', 'a\nb\nc'], ['h2', 'fragment', 'x\n#define DPR 1.75\ny']]);
    const b = log([['h1', 'vertex', 'a\nb\nc'], ['h3', 'fragment', 'x\n#define DPR 1.35\ny']]);
    const d = shaderSourceDiff(a, b, { labelA: 'vp1440', labelB: 'vp390' });
    expect(d.verdict).toBe('differs');
    expect(d.counts).toMatchObject({ common: 1, only_vp1440: 1, only_vp390: 1 });
    expect(d.pairs[0].firstDifference).toMatchObject({ line: 2, a: '#define DPR 1.75', b: '#define DPR 1.35' });
    expect(shaderSourceDiff(a, a).verdict).toBe('stable');
    expect(shaderSourceDiff(a, { entries: [] }).verdict).toBe('unmeasured');
  });
});

describe('in-page recorders run against stub globals', () => {
  it('installShaderSourceLog hashes, types and dedupes sources without changing the call', async () => {
    const { installShaderSourceLog } = await import('../lib/look-r6-evidence.mjs');
    const calls = [];
    class FakeGL {
      constructor() {
        this.VERTEX_SHADER = 35633;
        this.FRAGMENT_SHADER = 35632;
      }
      createShader(type) {
        return { type };
      }
      shaderSource(sh, src) {
        calls.push([sh, src]);
      }
    }
    const saved = { window: globalThis.window, gl2: globalThis.WebGL2RenderingContext };
    globalThis.window = globalThis;
    globalThis.WebGL2RenderingContext = FakeGL;
    try {
      installShaderSourceLog();
      const gl = new FakeGL();
      const vs = gl.createShader(gl.VERTEX_SHADER);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(vs, 'void main(){}');
      gl.shaderSource(fs, 'precision highp float;\nvoid main(){}');
      gl.shaderSource(vs, 'void main(){}');
      const log = globalThis.__captureShaderLog;
      expect(calls).toHaveLength(3);
      expect(log.calls).toBe(3);
      expect(log.entries.map((e) => e.type)).toEqual(['vertex', 'fragment']);
      expect(log.entries[1]).toMatchObject({ lines: 2, len: 36 });
      expect(log.sources[log.entries[0].hash]).toBe('void main(){}');
    } finally {
      delete globalThis.__captureShaderLog;
      globalThis.window = saved.window;
      globalThis.WebGL2RenderingContext = saved.gl2;
    }
  });
  it('installPhaseTrace records ball / live / scene changes from navigation and stops after the ceremony', async () => {
    const { installPhaseTrace } = await import('../lib/look-r6-evidence.mjs');
    const state = { ball: null, live: false, scene: null };
    const observers = [];
    const saved = { window: globalThis.window, document: globalThis.document, MO: globalThis.MutationObserver };
    globalThis.window = globalThis;
    globalThis.document = {
      documentElement: { classList: { contains: (c) => c === 'world-route-live' && state.live } },
      querySelector: () => (state.ball ? { getAttribute: () => state.ball } : null),
    };
    globalThis.MutationObserver = class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.off = true;
      }
    };
    globalThis.__routeWorldReadiness = () => ({ phase: state.scene, generation: 1 });
    try {
      installPhaseTrace({ pollMs: 5, maxMs: 2000 });
      const fire = () => observers.forEach((o) => !o.off && o.cb([]));
      state.ball = 'loading';
      state.scene = 'loading';
      fire();
      state.scene = 'presented';
      await new Promise((r) => setTimeout(r, 30));
      state.ball = 'done';
      state.live = true;
      fire();
      await new Promise((r) => setTimeout(r, 30));
      const rec = globalThis.__capturePhaseTrace;
      expect(rec.rows.map((r) => r.ball)).toEqual(['absent', 'loading', 'loading', 'done']);
      expect(rec.rows.map((r) => r.scene)).toEqual([null, 'loading', 'presented', 'presented']);
      expect(rec.stoppedAt).not.toBeNull();
      expect(observers.every((o) => o.off)).toBe(true);
    } finally {
      delete globalThis.__capturePhaseTrace;
      delete globalThis.__routeWorldReadiness;
      globalThis.window = saved.window;
      globalThis.document = saved.document;
      globalThis.MutationObserver = saved.MO;
    }
  });
  it('installLoafRecorder reports unsupported where the entry type is missing', async () => {
    const { installLoafRecorder } = await import('../lib/look-r6-evidence.mjs');
    const saved = globalThis.window;
    globalThis.window = globalThis;
    try {
      installLoafRecorder({ minMs: 50 });
      expect(globalThis.__captureLoaf).toMatchObject({ rows: [], dropped: 0 });
      expect(typeof globalThis.__captureLoaf.supported).toBe('boolean');
    } finally {
      delete globalThis.__captureLoaf;
      globalThis.window = saved;
    }
  });
});

describe('flags', () => {
  it('parses the round-6 arms and their dependencies', () => {
    const ok = parseR6Flags(['--gpu-trace', '--program-keys', '--dolly-at', '3.55,3.64', '--net-throttle', '50,20'], { loaderTrace: true, sweepFilm: true });
    expect(ok.errors).toEqual([]);
    expect(ok.flags).toMatchObject({ gpuTrace: true, programKeys: true, dollyAt: [3.55, 3.64], netThrottle: { mbps: 50, rttMs: 20 }, warmCache: false });
    expect(r6InvocationArgs(ok.flags)).toEqual({ gpuTrace: true, programKeys: true, dollyAt: [3.55, 3.64], netThrottle: { mbps: 50, rttMs: 20 } });
    expect(r6InvocationArgs(parseR6Flags([]).flags)).toEqual({});
    const bad = parseR6Flags(['--gpu-trace', '--warm-cache', '--contrast-repeat', '--dolly-at', '3.6'], {});
    expect(bad.errors.join(' ')).toMatch(/--gpu-trace .*--loader-trace/);
    expect(bad.errors.join(' ')).toMatch(/--warm-cache/);
    expect(bad.errors.join(' ')).toMatch(/--contrast-repeat .*--luma on/);
    expect(bad.errors.join(' ')).toMatch(/--sweep-film/);
  });
});

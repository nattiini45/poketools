import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  anyEvidenceFlag,
  ballVisibleFromRead,
  compositeHandoffVerdict,
  consumerChanges,
  crossingHeights,
  ditherVerdict,
  edgeOf,
  evidenceNeedsDebug,
  expectedPanelEdge,
  failurePathVerdict,
  filmCadence,
  liteFloorVerdict,
  liteGateConsistency,
  loaderStamps,
  peakYawRate,
  timeoutPathVerdict,
  warmupEnabled,
  flipVerdict,
  frameGaps,
  keyLightJumps,
  handoffDensity,
  panelEdgeVerdict,
  summarizeJump,
  unwrapYaw,
  wobbleVerdict,
  frameSuffix,
  mergeLoaderTrace,
  parseEvidenceFlags,
  parseParamFlags,
  phaseAt,
  revealGateState,
  selectFilmFrames,
  stationSettleVerdict,
  stripLayout,
  summarizeFilm,
  summarizeFrameTrace,
  summarizeLoader,
  summarizeSubjectOcclusion,
  summarizeSweep,
  sweepEndpoints,
  sweepPlan,
  writeStrip,
  attributeFrameGaps,
  // Round 4.
  RECORDER_ONLY_MIN_DRAWS,
  jumpFrameGapVerdict,
  withJumpFrameGap,
  ballTextVerdict,
  particleCorridorVerdict,
  contentBaselineKey,
  decodeTimecode,
  isLiteFloorRun,
  legHeightExcursion,
  renderedYawRate,
  stationContentVerdict,
  stripLabel,
  subjectBelongsTo,
  subjectPresenceVerdict,
  TIMECODE,
  // Round 5.
  CORRIDOR_LIVE_MIN,
  CORRIDOR_JUDGE_MIN,
  COMPOSITE_MIN_PAGE_FRAMES,
  shaderCheckRecord,
  SWEEP_FILM_FRAMES,
  sweepFilmPicks,
  sweepFilmLabel,
  nearestTelemetry,
  motionWindow,
} from '../lib/capture-evidence.mjs';

const STATIONS = ['pulse', 'roster', 'teams', 'schedule', 'rules'];

describe('parseEvidenceFlags', () => {
  it('defaults every arm off', () => {
    const { flags, errors } = parseEvidenceFlags(['--tag', 't']);
    expect(errors).toEqual([]);
    expect(flags).toEqual({
      frames: 0,
      intervalMs: 1000,
      occlusion: false,
      sweep: null,
      loaderTrace: false,
      reducedMotion: false,
      loaderFilm: false,
      flipProbe: null,
      pagePath: null,
      handoffComposite: false,
    });
    expect(anyEvidenceFlag(flags)).toBe(false);
    expect(evidenceNeedsDebug(flags)).toBe(false);
  });

  it('parses every arm', () => {
    const { flags, errors } = parseEvidenceFlags([
      '--frames', '30', '--interval', '1000', '--occlusion', 'on', '--loader-trace', '--reduced-motion',
    ]);
    expect(errors).toEqual([]);
    expect(flags).toMatchObject({ frames: 30, intervalMs: 1000, occlusion: true, loaderTrace: true, reducedMotion: true });
    expect(evidenceNeedsDebug(flags)).toBe(true);
  });

  // Gauntlet round 1: --loader-trace / --loader-film imply --debug on (the
  // readiness bridge - scene phase, deadline anchor, Lite-block check - is
  // debug-gated). Reduced motion alone still does not.
  it('loader trace and loader film force the debug param; reduced motion alone does not', () => {
    expect(evidenceNeedsDebug(parseEvidenceFlags(['--loader-trace']).flags)).toBe(true);
    const film = parseEvidenceFlags(['--loader-film']).flags;
    expect(film.loaderFilm).toBe(true);
    expect(anyEvidenceFlag(film)).toBe(true);
    expect(evidenceNeedsDebug(film)).toBe(true);
    const reduced = parseEvidenceFlags(['--reduced-motion']).flags;
    expect(anyEvidenceFlag(reduced)).toBe(true);
    expect(evidenceNeedsDebug(reduced)).toBe(false);
  });

  it('rejects bad values with named errors', () => {
    expect(parseEvidenceFlags(['--frames', '0']).errors[0]).toMatch(/--frames/);
    expect(parseEvidenceFlags(['--frames', '999']).errors[0]).toMatch(/--frames/);
    expect(parseEvidenceFlags(['--frames', '3', '--interval', '5']).errors[0]).toMatch(/--interval/);
    expect(parseEvidenceFlags(['--interval', '500']).errors[0]).toMatch(/only valid together with --frames/);
    expect(parseEvidenceFlags(['--occlusion', 'yes']).errors[0]).toMatch(/--occlusion/);
    expect(parseEvidenceFlags(['--sweep', 'sideways']).errors[0]).toMatch(/--sweep/);
    expect(parseEvidenceFlags(['--sweep', 'down', '--frames', '3']).errors[0]).toMatch(/cannot be combined/);
  });

  it('parses the round-2 arms: jump/panel/dither sweeps, flip probe, page path, handoff composite', () => {
    for (const mode of ['jump', 'panel', 'dither']) {
      expect(parseEvidenceFlags(['--sweep', mode]).flags.sweep).toBe(mode);
    }
    const flip = parseEvidenceFlags(['--flip-probe', '3000', '--page-path', '/leagues/abc-123']);
    expect(flip.errors).toEqual([]);
    expect(flip.flags).toMatchObject({ flipProbe: 3000, pagePath: '/leagues/abc-123' });
    expect(evidenceNeedsDebug(flip.flags)).toBe(true);
    expect(parseEvidenceFlags(['--flip-probe', '-5']).errors[0]).toMatch(/--flip-probe/);
    expect(parseEvidenceFlags(['--flip-probe', '10', '--sweep', 'down']).errors[0]).toMatch(/its own run/);
    expect(parseEvidenceFlags(['--page-path', 'leagues/x']).errors[0]).toMatch(/--page-path/);
    expect(parseEvidenceFlags(['--page-path', '/a/../b']).errors[0]).toMatch(/--page-path/);
    expect(parseEvidenceFlags(['--handoff-composite']).errors[0]).toMatch(/only valid together with --loader-trace/);
    expect(parseEvidenceFlags(['--loader-trace', '--handoff-composite']).flags.handoffComposite).toBe(true);
    expect(() => sweepPlan('jump')).toThrow(/unknown sweep mode/);
  });
});

describe('parseParamFlags', () => {
  it('collects repeatable k=v pairs in argv order', () => {
    const { params, errors } = parseParamFlags(['--tag', 't', '--param', 'waterDebug=ripples', '--param', 'x.y=1,2']);
    expect(errors).toEqual([]);
    expect(params).toEqual([
      { key: 'waterDebug', value: 'ripples' },
      { key: 'x.y', value: '1,2' },
    ]);
    expect(parseParamFlags(['--tag', 't']).params).toEqual([]);
  });

  it('accepts the R40 probe recipes: beatForce seconds (@) and coreCastFile paths (/)', () => {
    const { params, errors } = parseParamFlags(['--param', 'beatForce=surfacing@10,flyover@18,play@25', '--param', 'coreCastFile=surfacer:models/regular/730.glb']);
    expect(errors).toEqual([]);
    expect(params.map((p) => p.value)).toEqual(['surfacing@10,flyover@18,play@25', 'surfacer:models/regular/730.glb']);
    expect(parseParamFlags(['--param', 'k=a?b']).errors[0]).toMatch(/--param must be/);
    expect(parseParamFlags(['--param', 'k=a&b=c']).errors[0]).toMatch(/--param must be/);
  });

  it('refuses malformed, reserved and duplicate keys with named errors', () => {
    expect(parseParamFlags(['--param', 'noequals']).errors[0]).toMatch(/--param must be/);
    expect(parseParamFlags(['--param', '=v']).errors[0]).toMatch(/--param must be/);
    expect(parseParamFlags(['--param', 'k=a b']).errors[0]).toMatch(/--param must be/);
    expect(parseParamFlags(['--param']).errors[0]).toMatch(/--param must be/);
    expect(parseParamFlags(['--param', 'tier=route']).errors[0]).toMatch(/set by the harness/);
    expect(parseParamFlags(['--param', 'a=1', '--param', 'a=2']).errors[0]).toMatch(/more than once/);
  });
});

describe('reveal gate + station settle', () => {
  it('passes only when the route is live and the ball is done / hidden / absent', () => {
    expect(revealGateState({ live: true, ballPhase: 'done' })).toBe('revealed');
    expect(revealGateState({ live: true, ballPhase: 'hidden' })).toBe('revealed');
    expect(revealGateState({ live: true, ballPhase: 'absent' })).toBe('revealed');
    expect(revealGateState({ live: true, ballPhase: 'opening' })).toBe('waiting');
    expect(revealGateState({ live: false, ballPhase: 'done' })).toBe('waiting');
    expect(revealGateState({ live: false, ballPhase: 'loading' })).toBe('waiting');
    expect(revealGateState({ live: false, ballPhase: 'aborted' })).toBe('lite');
    expect(revealGateState(null)).toBe('waiting');
    // Round 2: a route that went live after the ball aborted is revealed (asserted), not Lite.
    expect(revealGateState({ live: true, ballPhase: 'aborted' })).toBe('revealed-after-abort');
  });

  it('asserts nearest, the smooth/exact gap and the WorldNav chip with named reasons', () => {
    const ok = { nearest: 2, smooth: 2.004, exact: 2, chipHref: '#teams' };
    const at = { index: 2, section: 'teams' };
    expect(stationSettleVerdict(ok, at)).toEqual({ ok: true, reasons: [] });
    expect(stationSettleVerdict({ ...ok, nearest: 1 }, at).reasons).toEqual(['nearest-mismatch']);
    expect(stationSettleVerdict({ ...ok, smooth: 2.02 }, at).reasons).toEqual(['smooth-exact-gap']);
    expect(stationSettleVerdict({ ...ok, chipHref: '#roster' }, at).reasons).toEqual(['nav-chip-mismatch']);
    expect(stationSettleVerdict(null, at).reasons).toEqual(['probe-missing', 'nav-chip-mismatch']);
  });

  it('fails an off-station landing that nearest hysteresis would pass (clouds teams 390)', () => {
    // Round 1 evidence: stationSettle.ok=true with {nearest:2, smooth:2.3231, exact:2.3231}.
    const at = { index: 2, section: 'teams' };
    const read = { nearest: 2, smooth: 2.323, exact: 2.323, chipHref: '#teams', pin: null };
    expect(stationSettleVerdict(read, at)).toEqual({ ok: false, reasons: ['exact-off-station'] });
    // A hold station whose conductor pin is on the index passes on the pin.
    expect(stationSettleVerdict({ nearest: 3, smooth: 3, exact: 3, pin: 3, chipHref: '#schedule' }, { index: 3, section: 'schedule' }).ok).toBe(true);
    expect(stationSettleVerdict({ ...read, exact: 2.004, smooth: 2.004 }, at).ok).toBe(true);
  });
});

describe('round 2 W6 analyzers', () => {
  const frame = (t, smooth, y, extra = {}) => ({ t, smooth, camPos: [0, y, 0], ...extra });

  it('measures the camera height excursion per crossing and names roster->teams', () => {
    const flat = [frame(0, 1, 4.85), frame(16, 1.3, 4.9), frame(32, 1.7, 4.95), frame(48, 2, 4.86)];
    const ok = crossingHeights(flat);
    expect(ok.verdict).toBe('pass');
    expect(ok.rosterTeams).toMatchObject({ from: 'roster', to: 'teams', k: 1 });
    expect(ok.rosterTeams.excursionM).toBeCloseTo(0.09, 3);
    const hop = crossingHeights([frame(0, 1, 4.85), frame(16, 1.5, 5.4), frame(32, 2, 4.86)]);
    expect(hop.verdict).toBe('fail');
    expect(hop.reasons[0]).toMatch(/roster->teams/);
    expect(crossingHeights([{ t: 0, smooth: 1 }]).verdict).toBe('unmeasured');
  });

  it('counts consumer changes and frame gaps', () => {
    const frames = [
      { t: 0, smooth: 1.4, nearest: 1, chipHref: '#roster', keyLight: { id: 'sun', hash: '1.000' } },
      { t: 16, smooth: 1.6, nearest: 2, chipHref: '#teams', keyLight: { id: 'sun', hash: '1.000' } },
      // Round 2: a key-light flip is an identity change (which light is key,
      // how many are visible), never the continuous intensity interpolation.
      { t: 400, smooth: 1.7, nearest: 2, chipHref: '#teams', keyLight: { id: 'moon', hash: '1.200' } },
    ];
    const c = consumerChanges(frames);
    expect(c.nearest.changes).toBe(1);
    expect(c.chip.changes).toBe(1);
    expect(c.keyLight.changes).toBe(1);
    expect(frameGaps(frames)).toMatchObject({ count: 1, maxGapMs: 384 });
  });

  it('ignores continuous key-light interpolation but catches a one-frame step', () => {
    const ramp = Array.from({ length: 30 }, (_, i) => ({
      t: i * 16,
      smooth: 1.58 + (i % 2) * 0.01,
      nearest: 1,
      chipHref: '#roster',
      keyLight: { id: 'sun', intensity: 2.9 + i * 0.002, hash: `0.297|${(2.9 + i * 0.002).toFixed(3)}` },
    }));
    expect(consumerChanges(ramp).keyLight.changes).toBe(0);
    expect(keyLightJumps(ramp).count).toBe(0);
    expect(ditherVerdict(ramp, { band: [1.35, 1.65] }).verdict).toBe('pass');
    const step = ramp.map((f, i) => (i === 15 ? { ...f, keyLight: { ...f.keyLight, intensity: 3.6 } } : f));
    expect(keyLightJumps(step).count).toBe(2);
    expect(ditherVerdict(step, { band: [1.35, 1.65] }).verdict).toBe('fail');
  });

  it('passes a dither that never flips a consumer and fails one that does', () => {
    const steady = Array.from({ length: 20 }, (_, i) => ({
      t: i * 16,
      smooth: 1.58 + (i % 2) * 0.01,
      nearest: 1,
      chipHref: '#roster',
      keyLight: { id: 'sun', hash: '1' },
    }));
    expect(ditherVerdict(steady, { band: [1.35, 1.65] }).verdict).toBe('pass');
    const flicker = steady.map((f, i) => ({ ...f, nearest: i % 5 === 4 ? 2 : 1 }));
    expect(ditherVerdict(flicker, { band: [1.35, 1.65] }).verdict).toBe('fail');
    expect(ditherVerdict(steady, { band: [1.6, 1.65] }).verdict).toBe('unmeasured');
  });

  it('judges a nav-chip jump: skip seen, one monotone shortest arc, settled landing', () => {
    const settle = { ok: true };
    const yaws = [0, 0.1, 0.3, 0.6, 0.8, 0.9, 0.9];
    const good = yaws.map((pathYaw, i) => ({ t: i * 16, pathYaw, skip: { active: i > 0 && i < 6, influence: 1 } }));
    expect(summarizeJump(good, { settle }).verdict).toBe('pass');
    const whiplash = [0, 0.4, 0.8, 0.3, 0.9].map((pathYaw, i) => ({ t: i * 16, pathYaw, skip: { active: true } }));
    const bad = summarizeJump(whiplash, { settle });
    expect(bad.verdict).toBe('fail');
    expect(bad.reversals).toBeGreaterThan(0);
    const noSkip = good.map((f) => ({ ...f, skip: { active: false } }));
    expect(summarizeJump(noSkip, { settle }).reasons[0]).toMatch(/skip.active/);
    expect(summarizeJump(good, { settle: { ok: false } }).verdict).toBe('fail');
    expect(unwrapYaw([3.1, -3.1])[1]).toBeCloseTo(3.1832, 3);
  });

  it('checks the panel enters and exits on the D6 edge with no camera cut', () => {
    expect(expectedPanelEdge(1440)).toBe('right');
    expect(expectedPanelEdge(390)).toBe('bottom');
    expect(edgeOf(0.5, 0.5)).toBe('none');
    const cycle = (t0, dx) => [
      { t: t0, camPos: [0, 4, 0], yaw: 0, panel: { x: 1000 + dx, y: 0, closing: false } },
      { t: t0 + 16, camPos: [0, 4, 0.05], yaw: 0.01, panel: { x: 1000 + dx / 2, y: 0, closing: false } },
      { t: t0 + 32, camPos: [0, 4, 0.1], yaw: 0.02, panel: { x: 1000, y: 0, closing: false } },
      { t: t0 + 48, camPos: [0, 4, 0.1], yaw: 0.02, panel: { x: 1012, y: 0, closing: true } },
      { t: t0 + 64, camPos: [0, 4, 0.1], yaw: 0.02, panel: null },
    ];
    const right = panelEdgeVerdict([...cycle(0, 24), ...cycle(200, 24)], { expectedEdge: 'right' });
    expect(right.verdict).toBe('pass');
    expect(right.episodes).toHaveLength(2);
    expect(right.alternates).toBe(false);
    const wrong = panelEdgeVerdict(cycle(0, -24), { expectedEdge: 'right' });
    expect(wrong.verdict).toBe('fail');
    expect(wrong.alternates).toBe(true);
    const cut = cycle(0, 24);
    cut[2] = { ...cut[2], camPos: [3, 4, 0.1] };
    expect(panelEdgeVerdict(cut, { expectedEdge: 'right' }).reasons.join(' ')).toMatch(/camera jumped/);
  });

  it('round 5: the panel worst frame is the maxStepM frame, even when a later frame turns more', () => {
    const frames = [
      { t: 0, camPos: [0, 0, 0], yaw: 0, panel: null },
      { t: 16.7, camPos: [0.8, 0, 0], yaw: 0, panel: null }, // the big step
      { t: 33.4, camPos: [0.9, 0, 0], yaw: 0.2, panel: null }, // the big turn, small step
    ];
    const v = panelEdgeVerdict(frames, { expectedEdge: 'right' });
    expect(v.camera.maxStepM).toBeCloseTo(0.8, 4);
    expect(v.camera.worst.stepM).toBe(v.camera.maxStepM);
    expect(v.camera.worst.t).toBe(16.7);
    expect(v.camera.worstTurn.t).toBe(33.4);
    expect(v.camera.worstTurn.turnRad).toBe(v.camera.maxTurnRad);
  });

  it('judges the flip probe only across a real Lite -> route flip', () => {
    const before = { live: false, at: 'teams', hudChip: '#teams', currentLinks: ['#teams'] };
    expect(flipVerdict(before, { ...before, live: true }).verdict).toBe('pass');
    expect(flipVerdict(before, { ...before, live: true, at: 'roster', hudChip: '#roster' }).verdict).toBe('fail');
    expect(flipVerdict({ ...before, live: true }, { ...before, live: true }).verdict).toBe('unmeasured');
  });
});

describe('round 2 W7 analyzers', () => {
  it('reads ball visibility from painted children, never the always-mounted root', () => {
    // Hidden-phase fixture: root mounted, no children painted.
    expect(ballVisibleFromRead({ attr: null, paintedOpacity: 0 })).toBe(false);
    expect(ballVisibleFromRead({ attr: null, paintedOpacity: 1 })).toBe(true);
    expect(ballVisibleFromRead({ attr: true, paintedOpacity: 0 })).toBe(true);
    expect(ballVisibleFromRead(null)).toBe(false);
    const merged = mergeLoaderTrace(
      [{ t: 5, ballPhase: 'hidden', ballVisible: true, ballRead: { attr: null, paintedOpacity: 0 }, routeLive: true }],
      [],
    );
    expect(merged[0].ballVisible).toBe(false);
  });

  it('matches each wobble to a milestone rise within one frame', () => {
    const s = (t, milestones, wobbles) => ({ t, milestones, wobbles });
    const ok = wobbleVerdict([s(0, 0, 0), s(16, 1, 0), s(32, 1, 1), s(48, 2, 1), s(64, 2, 2)]);
    expect(ok.verdict).toBe('pass');
    const timer = wobbleVerdict([s(0, 0, 0), s(16, 0, 0), s(32, 0, 0), s(48, 0, 1)]);
    expect(timer.verdict).toBe('fail');
    expect(wobbleVerdict([{ t: 0 }]).verdict).toBe('unmeasured');
  });

  it('refuses a pass on a sparse handoff window and flags composited blank frames', () => {
    expect(handoffDensity([100, 900], 500).ok).toBe(false);
    const dense = Array.from({ length: 60 }, (_, i) => 280 + i * 16);
    expect(handoffDensity(dense, 500).ok).toBe(true);
    const frames = dense.map((t) => ({ t, spread: 40 }));
    expect(compositeHandoffVerdict(frames, 500).verdict).toBe('pass');
    frames[20] = { t: frames[20].t, spread: 1 };
    expect(compositeHandoffVerdict(frames, 500).verdict).toBe('fail');
    expect(compositeHandoffVerdict([{ t: 500, spread: 40 }], 500).verdict).toBe('insufficient-sampling');
  });

  it('checks the failure path: abort within a frame, Lite by deadline + 150 ms', () => {
    const base = { ballPhase: 'loading', ballVisible: true, routeLive: false, scenePhase: 'loading' };
    const ok = failurePathVerdict([
      { ...base, t: 0 },
      { ...base, t: 10_000, scenePhase: 'failed' },
      { ...base, t: 10_016, scenePhase: 'failed', ballPhase: 'aborted', ballVisible: false },
    ]);
    expect(ok.verdict).toBe('pass');
    const slow = failurePathVerdict([
      { ...base, t: 0 },
      { ...base, t: 10_000, scenePhase: 'failed' },
      { ...base, t: 10_016, scenePhase: 'failed' },
      { ...base, t: 10_400, scenePhase: 'failed', ballPhase: 'aborted', ballVisible: false },
    ]);
    expect(slow.verdict).toBe('fail');
    expect(failurePathVerdict([{ ...base, t: 0 }]).verdict).toBe('unmeasured');
  });

  it('refuses a pass when the DOM trace is sparse around world-route-live', async () => {
    const samples = [
      { t: 0, ballVisible: true, routeLive: false, canvasOpacity: 0 },
      { t: 390, ballVisible: true, routeLive: false, canvasOpacity: 0 },
      { t: 400, ballVisible: false, routeLive: true, canvasOpacity: 1 },
      { t: 1200, ballVisible: false, routeLive: true, canvasOpacity: 1 },
    ];
    const report = await summarizeLoader(mergeLoaderTrace(samples, []));
    expect(report.baseVerdict).toBe('pass');
    // Round 3: under-sampled = unmeasured (never pass, never fail).
    expect(report.verdict).toBe('unmeasured');
    expect(report.unmeasuredReason).toBe('insufficient-sampling');
    expect(report.handoffDensitySource).toBe('none');
    // Round 2: a dense composite of the same window carries the handoff.
    const frames = [];
    for (let t = 200; t <= 1000; t += 50) frames.push({ t, spread: 30 });
    const composite = compositeHandoffVerdict(frames, 400);
    expect(composite.verdict).toBe('pass');
    const withComposite = await summarizeLoader(mergeLoaderTrace(samples, []), { composite });
    expect(withComposite.verdict).toBe('pass');
    expect(withComposite.handoffDensitySource).toBe('composite');
  });
});

describe('loader film helpers', () => {
  const samples = [
    { t: 0, ballPresent: true, ballPhase: 'loading', routeLive: false, scenePhase: 'loading' },
    { t: 1000, ballPresent: true, ballPhase: 'loading', routeLive: false, scenePhase: 'presented' },
    { t: 1050, ballPresent: true, ballPhase: 'opening', routeLive: true, scenePhase: 'presented' },
    { t: 2000, ballPresent: true, ballPhase: 'done', routeLive: true, scenePhase: 'presented' },
  ];

  it('looks up the phase in force at a frame time', () => {
    expect(phaseAt(samples, -1)).toBeNull();
    expect(phaseAt(samples, 1049).scenePhase).toBe('presented');
    expect(phaseAt(samples, 1049).ballPhase).toBe('loading');
    expect(phaseAt(samples, 5000).ballPhase).toBe('done');
  });

  it('spends the montage share inside the reveal window', () => {
    const times = Array.from({ length: 151 }, (_, i) => i * 16); // 0..2400 ms at ~60 fps
    const picked = selectFilmFrames(times, { start: 0, end: 2400, revealStart: 1000, total: 20, revealShare: 0.6 });
    expect(picked.length).toBeGreaterThanOrEqual(16);
    expect(picked.length).toBeLessThanOrEqual(20);
    expect(picked.filter((i) => times[i] >= 1000).length).toBeGreaterThanOrEqual(11);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    // No usable reveal window: even spread across the whole film, both ends included.
    const even = selectFilmFrames(times, { start: 0, end: 2400, revealStart: null, total: 20 });
    expect(even[0]).toBe(0);
    expect(even[even.length - 1]).toBe(150);
    expect(selectFilmFrames([], { start: 0, end: 1 })).toEqual([]);
  });

  it('summarizes the reveal window and judges its fps against the floor', () => {
    const frames = Array.from({ length: 61 }, (_, i) => ({ t: 1000 + (i * 1000) / 60 }));
    const summary = summarizeFilm(frames, samples);
    expect(summary.revealWindow).toEqual({ start: 1000, end: 2000 });
    expect(summary.endPhase).toBe('done');
    expect(summary.revealFps).toBeGreaterThanOrEqual(15);
    expect(summary.fpsFloorMet).toBe(true);
    const sparse = summarizeFilm([{ t: 1000 }, { t: 1500 }, { t: 2000 }], samples);
    expect(sparse.fpsFloorMet).toBe(false);
    expect(sparse.maxGapMs).toBe(500);
    expect(summary.routeLiveAt).toBe(1050);
  });

  it('never writes an inverted reveal window when the ball aborted before present (sakura 1440)', () => {
    const aborted = [
      { t: 0, ballPresent: true, ballPhase: 'loading', routeLive: false, scenePhase: 'loading' },
      { t: 15154.5, ballPresent: true, ballPhase: 'aborted', routeLive: false, scenePhase: 'loading' },
      { t: 16088.6, ballPresent: true, ballPhase: 'aborted', routeLive: true, scenePhase: 'presented' },
    ];
    const summary = summarizeFilm([{ t: 0 }, { t: 16000 }], aborted);
    expect(summary.revealWindow).toBeNull();
    expect(summary.revealFps).toBeNull();
    expect(summary.abortedBeforePresent).toBe(true);
  });
});

describe('planning helpers', () => {
  it('pads frame suffixes to the count width', () => {
    expect(frameSuffix(3, 30)).toBe('-f03');
    expect(frameSuffix(7, 120)).toBe('-f007');
    expect(frameSuffix(0, 1)).toBe('-f00');
  });

  it('plans constant-sign sweeps and a net-forward jitter', () => {
    expect(sweepPlan('down', { maxSteps: 3 }).map((s) => s.dy)).toEqual([100, 100, 100]);
    expect(sweepPlan('up', { maxSteps: 2, stepPx: 50 }).map((s) => s.dy)).toEqual([-50, -50]);
    const jitter = sweepPlan('jitter', { maxSteps: 8 }).map((s) => Math.sign(s.dy));
    expect(jitter).toEqual([1, 1, 1, -1, 1, 1, 1, -1]);
    expect(() => sweepPlan('left')).toThrow(/unknown sweep mode/);
  });

  it('derives sweep endpoints from the section list', () => {
    expect(sweepEndpoints('down', STATIONS, STATIONS)).toMatchObject({ from: 'pulse', to: 'rules', toIndex: 4 });
    expect(sweepEndpoints('up', ['roster', 'schedule'], STATIONS)).toMatchObject({
      from: 'schedule',
      to: 'roster',
      fromIndex: 3,
      toIndex: 1,
    });
  });

  it('lays out a strip grid', () => {
    const layout = stripLayout({ count: 8, frameW: 1440, frameH: 900 });
    expect(layout).toMatchObject({ cols: 6, rows: 2, thumbW: 320, thumbH: 200 });
    expect(layout.cells).toHaveLength(8);
    expect(layout.cells[6]).toEqual({ left: 4, top: 4 + 200 + 18 + 4, labelTop: 4 + 200 + 18 + 4 + 200 });
    expect(layout.width).toBe(4 + 6 * 324);
    expect(stripLayout({ count: 2, frameW: 200, frameH: 100 }).thumbW).toBe(200);
  });
});

describe('trace summaries', () => {
  const figureRow = (id, phase01, extra = {}) => ({ id, clip: 'idle', phase01, visible: true, timeScale: 1, ...extra });
  const occRow = (id, source, occludedFraction, onScreen = true) => ({ id, kind: source === 'focus' ? 'board' : 'figure', source, occludedFraction, onScreen, rect: null });

  it('reports W2 / W4 / W1 verdicts over a frame trace', async () => {
    const samples = Array.from({ length: 31 }, (_, i) => ({
      t: i * 1000,
      figures: { source: 'registry', rows: [figureRow('a', (i * 0.1) % 1), figureRow('b', (i * 0.1 + 0.01) % 1), figureRow('c', 0.5 + i * 0.013)] },
      occlusion: {
        rows: [occRow('board:pulse', 'focus', i === 3 ? 0.1 : 0), occRow('a', 'figure', 1), occRow('c', 'figure', 0)],
      },
    }));
    const summary = await summarizeFrameTrace(samples);
    expect(summary.figureSource).toBe('registry');
    expect(summary.w2.verdict).toBe('fail');
    expect(summary.w2.pairs[0]).toMatchObject({ a: 'a', b: 'b' });
    expect(summary.w4.verdict).toBe('fail');
    expect(summary.w4.vetoes).toEqual(['a']);
    expect(summary.w4.coversWindow).toBe(true);
    expect(summary.w1).toMatchObject({ verdict: 'fail', failing: [{ id: 'board:pulse', maxOccludedFraction: 0.1 }] });
  });

  it('says unmeasured instead of passing when the bridges gave nothing', async () => {
    const samples = [
      { t: 0, figures: { source: 'scene-scan', rows: [{ id: 'x', clip: null, phase01: null, visible: true }] }, occlusion: null },
      { t: 1000, figures: null, occlusion: { error: 'boom' } },
    ];
    const summary = await summarizeFrameTrace(samples);
    expect(summary.figureSource).toBe('scene-scan');
    expect(summary.w2.verdict).toBe('unmeasured');
    expect(summary.w4.verdict).toBe('unmeasured');
    expect(summary.w1.verdict).toBe('unmeasured');
  });

  it('summarizes one still for W1', () => {
    expect(summarizeSubjectOcclusion({ rows: [occRow('board:pulse', 'focus', 0.02)] }).verdict).toBe('pass');
    expect(summarizeSubjectOcclusion({ rows: [occRow('board:pulse', 'focus', 0.25)] }).failing[0].id).toBe('board:pulse');
    expect(summarizeSubjectOcclusion(null).verdict).toBe('unmeasured');
  });

  it('runs the W6 analyzer over recorded sweep frames', async () => {
    const frames = [0, 0.3, 0.6, 0.5, 0.8].map((smooth, i) => ({ t: i * 16, inputSign: 1, smooth, yaw: null }));
    const report = await summarizeSweep(frames);
    expect(report.verdict).toBe('fail');
    expect(report.progressFlips).toHaveLength(1);
    expect(report.yawReadable).toBe(false);
  });

  it('merges pixel reads onto DOM samples by frame time', async () => {
    const merged = mergeLoaderTrace(
      [
        { t: 10, ballVisible: true, routeLive: false, canvasOpacity: 0 },
        { t: 20, ballVisible: false, routeLive: true, canvasOpacity: 1 },
        { t: 30, ballVisible: false, routeLive: true, canvasOpacity: 1 },
      ],
      [
        { t: 20, spread: 0.5 },
        { t: 25, spread: 40 },
      ],
    );
    expect(merged.map((s) => s.canvasSpread)).toEqual([null, 0.5, 40]);
    const report = await summarizeLoader(merged);
    expect(report.blankFrames).toBe(1);
    expect(report.verdict).toBe('fail');
  });
});

describe('writeStrip', () => {
  it('montages frames into one PNG of the laid-out size', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capture-evidence-'));
    try {
      const paths = [];
      for (let i = 0; i < 3; i += 1) {
        const path = join(dir, `f${i}.png`);
        await sharp({ create: { width: 160, height: 100, channels: 3, background: { r: 40 * i, g: 90, b: 140 } } })
          .png()
          .toFile(path);
        paths.push(path);
      }
      const out = join(dir, 'strip.png');
      const layout = await writeStrip(paths, out, ['f00 +0.0s', 'f01 +1.0s', 'f02 <b>']);
      const meta = await sharp(out).metadata();
      expect(meta.width).toBe(layout.width);
      expect(meta.height).toBe(layout.height);
      expect(await writeStrip([], out)).toBeNull();
      // --loader-film passes encoded frame Buffers instead of paths.
      const jpeg = await sharp({ create: { width: 160, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .jpeg()
        .toBuffer();
      const bufLayout = await writeStrip([jpeg, jpeg], out, ['+0ms ball=loading scene=-', '+16ms ball=done scene=presented']);
      expect((await sharp(out).metadata()).width).toBe(bufLayout.width);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('round 2 harness remediation (lead additions)', () => {
  it('parses --relax-deadline / --fail-inject / --chip-jump / --panel-edge / --warmup with named errors', () => {
    const relax = parseEvidenceFlags(['--relax-deadline', '30000']);
    expect(relax.errors).toEqual([]);
    expect(relax.flags.relaxDeadlineMs).toBe(30000);
    expect(evidenceNeedsDebug(relax.flags)).toBe(true);
    expect(parseEvidenceFlags(['--relax-deadline', '5000']).errors[0]).toMatch(/--relax-deadline/);
    // Never for W7 runs.
    for (const w7 of [['--loader-trace'], ['--loader-film'], ['--loader-trace', '--handoff-composite']]) {
      expect(parseEvidenceFlags(['--relax-deadline', '30000', ...w7]).errors.join(' ')).toMatch(/never used for W7/);
    }
    const fault = parseEvidenceFlags(['--loader-trace', '--fail-inject', 'context-loss:opening']);
    expect(fault.errors).toEqual([]);
    expect(fault.flags.failInject).toBe('context-loss:opening');
    expect(parseEvidenceFlags(['--fail-inject', 'timeout']).errors[0]).toMatch(/add --loader-trace/);
    expect(parseEvidenceFlags(['--loader-trace', '--fail-inject', 'meteor']).errors[0]).toMatch(/--fail-inject/);
    const jump = parseEvidenceFlags(['--chip-jump', 'pulse,schedule', '--chip-jump', 'rules,roster']);
    expect(jump.errors).toEqual([]);
    expect(jump.flags.sweep).toBe('jump');
    expect(jump.flags.chipJump).toEqual([
      { from: 'pulse', to: 'schedule' },
      { from: 'rules', to: 'roster' },
    ]);
    expect(parseEvidenceFlags(['--chip-jump', 'pulse,pulse']).errors[0]).toMatch(/--chip-jump/);
    expect(parseEvidenceFlags(['--chip-jump', 'pulse,rules', '--sweep', 'down']).errors[0]).toMatch(/jump sweep/);
    expect(parseEvidenceFlags(['--panel-edge']).flags.sweep).toBe('panel');
    expect(parseEvidenceFlags(['--warmup', 'maybe']).errors[0]).toMatch(/--warmup/);
    // auto warm-up: on for evidence arms, off for plain stills; explicit wins.
    expect(warmupEnabled(parseEvidenceFlags([]).flags)).toBe(false);
    expect(warmupEnabled(parseEvidenceFlags(['--occlusion', 'on']).flags)).toBe(true);
    expect(warmupEnabled(parseEvidenceFlags(['--warmup', 'on']).flags)).toBe(true);
    expect(warmupEnabled(parseEvidenceFlags(['--occlusion', 'on', '--warmup', 'off']).flags)).toBe(false);
    // readyDeadlineMs is harness-owned.
    expect(parseParamFlags(['--param', 'readyDeadlineMs=30000']).errors[0]).toMatch(/set by the harness/);
  });

  it('fails a route-tier sweep on a rAF gap over 250 ms and reports the peak yaw rate', async () => {
    const mk = (t, smooth, yaw) => ({ t, inputSign: 1, smooth, exact: smooth, yaw });
    const smoothTrace = Array.from({ length: 60 }, (_, i) => mk(i * 16.7, 1 + i / 60, 0.001 * i));
    const clean = await summarizeSweep(smoothTrace);
    expect(clean.frameGapVerdict).toBe('pass');
    expect(clean.maxFrameGapMs).toBeLessThanOrEqual(250);
    const gappy = [...smoothTrace.slice(0, 30), ...smoothTrace.slice(30).map((f) => ({ ...f, t: f.t + 400 }))];
    const hitch = await summarizeSweep(gappy);
    expect(hitch.frameGapVerdict).toBe('fail');
    expect(hitch.verdict).toBe('fail');
    expect(hitch.reasons.join(' ')).toMatch(/max frame gap/);
    expect((await summarizeSweep(gappy, { routeTier: false })).frameGapVerdict).toBe('not-judged');
    // 90 deg over 100 ms = 900 deg/s; unwrap keeps a +-pi crossing continuous.
    const turn = [
      { t: 0, yaw: Math.PI - 0.1 },
      { t: 100, yaw: -Math.PI + 0.1 },
      { t: 200, yaw: -Math.PI + 0.1 + Math.PI / 2 },
    ];
    const rate = peakYawRate(turn);
    expect(rate.measured.peakDegS).toBeCloseTo(900, 0);
    expect(rate.path.readable).toBe(false);
  });

  it('adds the walker group to the consumer channels without making it required', () => {
    const frames = [
      { t: 0, smooth: 1.58, nearest: 1, chipHref: '#roster', keyLight: { id: 'k', hash: '1' }, walkers: 'a,b' },
      { t: 16, smooth: 1.59, nearest: 1, chipHref: '#roster', keyLight: { id: 'k', hash: '1' } },
      { t: 200, smooth: 1.6, nearest: 1, chipHref: '#roster', keyLight: { id: 'k', hash: '1' }, walkers: 'a,b,c' },
    ];
    expect(consumerChanges(frames).walkers).toMatchObject({ readable: true, changes: 1 });
    expect(ditherVerdict(frames, { band: [1.35, 1.65] }).verdict).toBe('fail');
    // A world with no figures: walkers unreadable, the dither still judges the rest.
    const noWalkers = frames.map(({ walkers: _w, ...f }) => f);
    expect(ditherVerdict(noWalkers, { band: [1.35, 1.65] }).verdict).toBe('pass');
  });

  it('never counts the ball visible outside a ceremony phase (hidden-phase fixture)', () => {
    expect(ballVisibleFromRead({ attr: null, paintedOpacity: 1, phase: 'hidden' })).toBe(false);
    expect(ballVisibleFromRead({ attr: true, paintedOpacity: 1, phase: 'done' })).toBe(false);
    expect(ballVisibleFromRead({ attr: null, paintedOpacity: 1, phase: 'releasing' })).toBe(true);
    const merged = mergeLoaderTrace(
      [
        { t: 0, ballPhase: 'loading', ballRead: { attr: null, paintedOpacity: 1 } },
        { t: 16, ballPhase: 'done', ballRead: { attr: null, paintedOpacity: 0.5 } },
      ],
      [],
    );
    expect(merged.map((s) => s.ballVisible)).toEqual([true, false]);
  });

  it('stamps phase transitions, milestone rises, wobble starts and the deadline in force', () => {
    const merged = mergeLoaderTrace(
      [
        { t: 0, ballPhase: 'hidden', scenePhase: 'idle', milestones: 0, wobbles: 0 },
        { t: 16, ballPhase: 'loading', scenePhase: 'loading', milestones: 1, wobbles: 0, begunAt: 5, deadlineMs: 10000, deadlineRelaxed: false },
        { t: 33, ballPhase: 'loading', scenePhase: 'loading', milestones: 1, wobbles: 1, begunAt: 5, deadlineMs: 10000, deadlineRelaxed: false },
        { t: 50, ballPhase: 'opening', scenePhase: 'presented', milestones: 2, wobbles: 1, routeLive: true },
      ],
      [],
    );
    const stamps = loaderStamps(merged);
    expect(stamps.ballPhases.map((r) => r.ballPhase)).toEqual(['hidden', 'loading', 'opening']);
    expect(stamps.scenePhases.map((r) => r.scenePhase)).toEqual(['idle', 'loading', 'presented']);
    expect(stamps.milestoneRises).toEqual([
      { t: 16, count: 1 },
      { t: 50, count: 2 },
    ]);
    expect(stamps.wobbleStarts).toEqual([{ t: 33, count: 1 }]);
    expect(stamps).toMatchObject({ routeLiveAt: 50, generationBegunAt: 5, deadlineMs: 10000, deadlineRelaxed: false });
  });

  it('judges the timeout path: Lite by deadline + 150 ms, never a late live route', () => {
    const lite = [];
    for (let t = 0; t <= 12000; t += 50) {
      const loading = t < 10020;
      lite.push({ t, begunAt: 0, scenePhase: 'loading', routeLive: false, ballVisible: loading, ballPhase: loading ? 'loading' : 'aborted' });
    }
    expect(timeoutPathVerdict(lite)).toMatchObject({ verdict: 'pass', liteBy: 10150 });
    const late = lite.map((s) => (s.t >= 11000 ? { ...s, routeLive: true } : s));
    expect(timeoutPathVerdict(late).verdict).toBe('fail');
    const lingering = lite.map((s) => (s.t <= 10500 ? { ...s, ballVisible: true } : s));
    expect(timeoutPathVerdict(lingering).reasons.join(' ')).toMatch(/ball still visible/);
    expect(timeoutPathVerdict([]).verdict).toBe('unmeasured');
  });

  it('judges the Lite floor only when reduced motion really matched', () => {
    const lite = [{ t: 0, routeLive: false, canvasOpacity: 0, ballVisible: false }];
    expect(liteFloorVerdict(lite, { reducedMotionMatched: false }).verdict).toBe('unmeasured');
    expect(liteFloorVerdict(lite, { reducedMotionMatched: true }).verdict).toBe('pass');
    const live = [...lite, { t: 9000, routeLive: true, canvasOpacity: 1 }];
    expect(liteFloorVerdict(live, { reducedMotionMatched: true }).verdict).toBe('fail');
  });

  it('refuses a Lite reveal-gate verdict over a showing canvas or a presented scene', () => {
    expect(liteGateConsistency({ live: false, canvasOpacity: 0, scenePhase: 'failed' }).ok).toBe(true);
    expect(liteGateConsistency({ live: false, canvasOpacity: 0.9, scenePhase: 'loading' }).ok).toBe(false);
    expect(liteGateConsistency({ live: false, canvasOpacity: null, scenePhase: 'presented' }).reasons).toEqual([
      'scene phase is presented',
    ]);
  });

  it('reports the achieved periodic cadence beside the screencast gaps', () => {
    const frames = [
      { t: 0, kind: 'periodic' },
      { t: 40, kind: 'screencast' },
      { t: 100, kind: 'periodic' },
      { t: 200, kind: 'periodic' },
      { t: 2500, kind: 'screencast' },
    ];
    expect(filmCadence(frames)).toEqual({
      periodic: { frames: 3, medianIntervalMs: 100, maxIntervalMs: 100 },
      screencast: { frames: 2, medianIntervalMs: 2460, maxGapMs: 2460 },
    });
  });

  it('anchors an injected context loss at the webglcontextlost dispatch when failed is never sampled', () => {
    const samples = [];
    for (let t = 3000; t <= 9000; t += 50) {
      const aborted = t >= 7800;
      samples.push({ t, scenePhase: aborted ? 'idle' : 'loading', routeLive: false, ballVisible: !aborted, ballPhase: aborted ? 'aborted' : 'loading' });
    }
    expect(failurePathVerdict(samples).verdict).toBe('unmeasured');
    const late = failurePathVerdict(samples, { failedAt: 3790 });
    expect(late).toMatchObject({ verdict: 'fail', failureAnchor: 'explicit' });
    expect(late.reasons.join(' ')).toMatch(/ball aborted \d+ frames after the failure/);
    expect(failurePathVerdict(samples, { failedAt: 7790 }).verdict).toBe('pass');
  });

  it('adds the fault and Lite-floor verdicts to the loader summary', async () => {
    const samples = [];
    for (let t = 0; t <= 12000; t += 50) {
      const loading = t < 10020;
      samples.push({ t, begunAt: 0, deadlineMs: 10000, scenePhase: 'loading', routeLive: false, ballVisible: loading, ballPhase: loading ? 'loading' : 'aborted', canvasOpacity: 0 });
    }
    const timeout = await summarizeLoader(samples, { failInject: 'timeout' });
    expect(timeout.timeoutPath.verdict).toBe('pass');
    expect(timeout.stamps.deadlineMs).toBe(10000);
    const lost = await summarizeLoader(samples, { failInject: 'context-loss:loading' });
    expect(lost.verdict).toBe('fail');
    expect(lost.reasons.join(' ')).toMatch(/never reported failed/);
    const floor = await summarizeLoader(
      samples.map((s) => ({ ...s, ballVisible: false })),
      { liteFloor: { reducedMotionMatched: true } },
    );
    expect(floor.liteFloor.verdict).toBe('pass');
  });
});

describe('round 3 harness remediation', () => {
  const frame = (t, smooth, y, extra = {}) => ({ t, smooth, camPos: [0, y, 0], ...extra });

  it('never judges a crossing against one endpoint: [null, y] and [y, null] are unmeasured', () => {
    // Teams (k = 2) never sampled within 0.01, nothing close enough to interpolate.
    const nullEnd = crossingHeights([frame(0, 1, 4.0), frame(16, 1.5, 4.2), frame(32, 1.7, 4.86)]);
    const c = nullEnd.crossings.find((x) => x.k === 1);
    expect(c.endpointY[1]).toBe(null);
    expect(c.verdict).toBe('unmeasured');
    expect(c.unmeasuredReason).toMatch(/teams/);
    expect(nullEnd.verdict).toBe('unmeasured');
    // [null, y]: the start endpoint missing.
    const nullStart = crossingHeights([frame(0, 1.3, 4.5), frame(16, 1.5, 4.9), frame(32, 2, 4.0)]);
    expect(nullStart.crossings.find((x) => x.k === 1)).toMatchObject({ verdict: 'unmeasured', endpointY: [null, 4.0] });
  });

  it('fills a missing endpoint from the station pose, then from interpolation across the station', () => {
    const descending = [frame(0, 1.5, 5.5), frame(16, 1.9, 4.95), frame(32, 1.985, 4.87), frame(48, 2.02, 4.85), frame(64, 2.1, 4.7)];
    // Round 2 reported a "rise" against the one known end; now teams is interpolated.
    const interp = crossingHeights(descending, { stationY: { 1: 5.6 } });
    const c = interp.crossings.find((x) => x.k === 1);
    expect(c.endpointSource).toEqual(['station-pose', 'interpolated']);
    expect(c.endpointY[1]).toBeCloseTo(4.861, 2);
    expect(c.verdict).toBe('pass');
    const pose = crossingHeights(descending, { stationY: { 1: 5.6, 2: 4.86 } });
    expect(pose.crossings.find((x) => x.k === 1).endpointSource).toEqual(['station-pose', 'station-pose']);
    // A real rise above both ends still fails.
    const hop = crossingHeights([frame(0, 1, 4.85), frame(16, 1.5, 5.6), frame(32, 2, 4.86)]);
    expect(hop.verdict).toBe('fail');
  });

  it('leaves skip-through frames out of the per-crossing check and judges the whole jump leg', () => {
    const jump = [
      frame(0, 0, 4, { skip: { active: false, influence: 0 } }),
      frame(16, 1.5, 9, { skip: { active: true, influence: 1 } }),
      frame(32, 3, 4.2, { skip: { active: false, influence: 0 } }),
    ];
    expect(crossingHeights(jump).crossings.some((x) => x.verdict === 'fail')).toBe(false);
    expect(legHeightExcursion(jump)).toMatchObject({ verdict: 'fail' });
    expect(legHeightExcursion([frame(0, 0, 4), frame(16, 1, 4.3), frame(32, 3, 4.2)]).verdict).toBe('pass');
    expect(legHeightExcursion([frame(0, 0, 4)]).verdict).toBe('unmeasured');
  });

  it('measures the rendered turn rate on the R3F clock, not the rAF sampling', () => {
    // 30 fps rendering: each draw turns 200 deg/s x 33.3 ms = 6.67 deg.
    const step = (200 * Math.PI) / 180 / 30;
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 33.33,
      frame: i + 1,
      clockDtMs: 1000 / 30,
      yaw: i * step,
      pitch: 0,
      angleFromPrevRad: i === 0 ? null : step,
    }));
    const r = renderedYawRate({ samples, dropped: 0, installed: true });
    expect(r.verdict).toBe('pass');
    expect(r.peakDegS).toBeCloseTo(200, 0);
    // The same camera sampled at 60 Hz rAF (every other sample static) reads ~400.
    const raf = [];
    for (let i = 0; i < 38; i += 1) raf.push({ t: i * 16.67, yaw: Math.floor((i + 1) / 2) * step });
    expect(peakYawRate(raf).measured.peakDegS).toBeGreaterThan(350);
    expect(peakYawRate(raf, { render: { samples } }).rendered.peakDegS).toBeCloseTo(200, 0);
    // A limiter running on a doubled dt shows as a fail.
    const fast = samples.map((s, i) => ({ ...s, yaw: i * step * 2, angleFromPrevRad: i === 0 ? null : step * 2 }));
    expect(renderedYawRate({ samples: fast }).verdict).toBe('fail');
    // Skipped frame ids are not divided by a single frame's delta.
    const gap = samples.map((s, i) => (i >= 10 ? { ...s, frame: s.frame + 1 } : s));
    expect(renderedYawRate({ samples: gap }).nonConsecutivePairs).toBe(1);
    expect(renderedYawRate(null).verdict).toBe('unmeasured');
    // The rig's own step when the probe publishes it.
    const rig = peakYawRate([{ t: 0, lastTurnDeltaRad: step, lastDt: 1 / 30 }]).rig;
    expect(rig.peakDegS).toBeCloseTo(200, 0);
  });

  it('attributes rAF gaps to long tasks, recorder-only starvation, or a page-side stall', () => {
    const gaps = frameGaps([{ t: 0 }, { t: 400 }, { t: 416 }, { t: 1000 }, { t: 1016 }, { t: 1600 }]);
    const out = attributeFrameGaps(gaps, {
      longTasks: [{ start: 50, duration: 300 }],
      render: { samples: [{ t: 600 }, { t: 700 }] },
    });
    expect(out.gaps.map((g) => g.attribution)).toEqual(['page-long-task', 'recorder-only', 'page-gpu-or-compositor']);
    expect(out.gaps.map((g) => g.countsAgainstProduct)).toEqual([true, false, true]);
    expect(out.productGapCount).toBe(2);
    expect(out.productMaxGapMs).toBe(584);
    expect(attributeFrameGaps(gaps).gaps[0].attribution).toBe('unattributed');
    // Long tasks only (no render log): the old no-page-long-task hint stays.
    expect(attributeFrameGaps(gaps, { longTasks: [] }).gaps[1].attribution).toBe('no-page-long-task');
  });

  it('round 4: one draw inside a gap is a visible freeze, never recorder-only', () => {
    // The plaza up-1440 case: 333.5 ms gap, the page drew once inside it.
    const gaps = frameGaps([{ t: 1000 }, { t: 1333.5 }]);
    const one = attributeFrameGaps(gaps, { longTasks: [], render: { samples: [{ t: 1200 }] } }).gaps[0];
    expect(one).toMatchObject({ drawsInGap: 1, attribution: 'page-gpu-or-compositor', countsAgainstProduct: true });
    const none = attributeFrameGaps(gaps, { longTasks: [], render: { samples: [] } }).gaps[0];
    expect(none.attribution).toBe('page-gpu-or-compositor');
    const two = attributeFrameGaps(gaps, { longTasks: [], render: { samples: [{ t: 1100 }, { t: 1250 }] } }).gaps[0];
    expect(two).toMatchObject({ drawsInGap: 2, attribution: 'recorder-only', countsAgainstProduct: false });
    expect(RECORDER_ONLY_MIN_DRAWS).toBe(2);
  });

  it('round 4: a jump leg fails on a frame gap above 250 ms', () => {
    // pulse->schedule r3: 767.2 ms gap (a 566.5 ms long task) that still passed.
    const gaps = attributeFrameGaps(frameGaps([{ t: 0 }, { t: 16 }, { t: 783.2 }, { t: 800 }]), {
      longTasks: [{ start: 100, duration: 566.5 }],
      render: { samples: [] },
    });
    const v = jumpFrameGapVerdict(gaps, { frames: 4 });
    expect(v).toMatchObject({ verdict: 'fail', limitMs: 250, maxFrameGapMs: 767.2 });
    expect(v.worst.attribution).toBe('page-long-task');
    const passing = { verdict: 'pass', reasons: [] };
    const folded = withJumpFrameGap(passing, v);
    expect(folded.verdict).toBe('fail');
    expect(folded.frameGapVerdict).toBe('fail');
    expect(folded.reasons[0]).toMatch(/767.2 ms > 250 ms/);
    const smooth = jumpFrameGapVerdict(frameGaps([{ t: 0 }, { t: 16 }, { t: 216 }]), { frames: 3 });
    expect(withJumpFrameGap(passing, smooth)).toMatchObject({ verdict: 'pass', frameGapVerdict: 'pass', maxFrameGapMs: 200 });
    expect(jumpFrameGapVerdict(frameGaps([]), { frames: 0 }).verdict).toBe('unmeasured');
    // An already failing leg keeps its own reasons.
    expect(withJumpFrameGap({ verdict: 'fail', reasons: ['x'] }, smooth)).toMatchObject({ verdict: 'fail', reasons: ['x'] });
  });

  it('round 4: fails the loader trace when the ball covered text before data-revealing', async () => {
    const merged = [
      { t: 100, textHits: 0 },
      { t: 200, textHits: 1 },
      { t: 300, textHits: 1, revealing: true },
    ];
    const hit = { t: 150, phase: 'loading', text: 'Tabelle', ball: [0, 0, 10, 10], rect: [0, 0, 5, 5] };
    expect(ballTextVerdict(merged, [hit])).toMatchObject({ verdict: 'fail', hitsBeforeReveal: 1, revealAt: 300 });
    expect(ballTextVerdict(merged, [{ ...hit, t: 350 }]).verdict).toBe('fail'); // the per-sample count saw it at 200
    const clean = [{ t: 100, textHits: 0 }, { t: 300, textHits: 0, revealing: true }];
    expect(ballTextVerdict(clean, []).verdict).toBe('pass');
    expect(ballTextVerdict([{ t: 1 }], null).verdict).toBe('unmeasured');
    const report = await summarizeLoader(mergeLoaderTrace([{ t: 10, ballPhase: 'loading', textHits: 2 }], []), { ballTextHits: [{ ...hit, t: 5 }] });
    expect(report.ballText.verdict).toBe('fail');
    expect(report.verdict).toBe('fail');
    expect(report.reasons.join(' ')).toMatch(/ball over visible text/);
    // Older callers (no ballTextHits option) are unchanged.
    expect((await summarizeLoader(mergeLoaderTrace([{ t: 10 }], []))).ballText).toBeUndefined();
  });

  it('round 4: a paused handoff frame has no canvas read of its own', () => {
    const merged = mergeLoaderTrace(
      [
        { t: 10, routeLive: false },
        { t: 20, routeLive: true, pixelPaused: true },
        { t: 30, routeLive: true },
      ],
      [{ t: 5, spread: 20 }, { t: 25, spread: 30 }],
    );
    expect(merged.map((s) => s.canvasSpread)).toEqual([20, null, 30]);
    expect(merged[1].pixelPaused).toBe(true);
    expect(merged[0].pixelPaused).toBeUndefined();
  });

  it('round 4: particle corridor verdict and the --dpr flag', () => {
    const row = (station, contains, weight = 1) => ({ station, weight, contains, corridorQuad: [], corridorRect: { x0: 0, y0: 0, x1: 1, y1: 1 }, faceRects: [] });
    expect(particleCorridorVerdict([row('pulse', true), row('teams', false, 0)])).toMatchObject({ verdict: 'pass', liveCorridors: 1 });
    const open = particleCorridorVerdict([row('pulse', false)]);
    expect(open).toMatchObject({ verdict: 'fail', reason: 'particle-corridor-open' });
    expect(open.open[0].station).toBe('pulse');
    expect(particleCorridorVerdict(null).verdict).toBe('unmeasured');
    expect(particleCorridorVerdict([]).verdict).toBe('pass');
    expect(parseEvidenceFlags(['--dpr', '2']).flags.dpr).toBe(2);
    expect(parseEvidenceFlags(['--dpr', '2.625']).flags.dpr).toBe(2.625);
    expect(parseEvidenceFlags(['--dpr', '4']).errors.length).toBe(1);
    expect(parseEvidenceFlags(['--dpr', 'x']).errors.length).toBe(1);
    expect('dpr' in parseEvidenceFlags([]).flags).toBe(false);
    expect(anyEvidenceFlag(parseEvidenceFlags(['--dpr', '2']).flags)).toBe(true);
  });

  it('round 5: corridor residuals below 0.01 never fail a still (clouds roster-390 sidecar numbers)', () => {
    // fid-w1-r4-clouds-dark-roster-390.json: exact = 1.00047 (scrollY 676).
    const rows = [
      {
        station: 'roster',
        weight: 0.9995260663507108,
        corridorRect: { x0: 42.88289800825107, y0: 297.7841492427924, x1: 347.1122859369412, y1: 453.92310565732726 },
        faceRects: [{ x0: 58.27592226729696, y0: 313.0065205261292, x1: 332.1036997718827, y1: 438.2300473952736 }],
        contains: true,
      },
      {
        station: 'teams',
        weight: 0.00047393364928915993,
        corridorRect: { x0: -767.6861683327469, y0: -336.45167606592906, x1: 721.4714896540639, y1: 82.95406380942086 },
        faceRects: [{ x0: -728.9575623526188, y0: -385.84506547133327, x1: -382.2580623774902, y1: -211.28201029963378 }],
        contains: false,
      },
    ];
    const v = particleCorridorVerdict(rows);
    expect(v).toMatchObject({ verdict: 'pass', liveCorridors: 1, judgedCorridors: 1, open: [] });
    expect(v.reason).toBeUndefined();
    expect(v.residual).toEqual([{ station: 'teams', weight: 0.00047393364928915993 }]);
    expect(v.thresholds).toEqual({ liveMin: CORRIDOR_LIVE_MIN, judgeMin: CORRIDOR_JUDGE_MIN });
    expect(CORRIDOR_LIVE_MIN).toBe(0.01);
    expect(CORRIDOR_JUDGE_MIN).toBe(0.5);
    // A live but sub-0.5 corridor is reported as unjudged, not failed.
    const mid = particleCorridorVerdict([{ ...rows[1], weight: 0.3 }]);
    expect(mid).toMatchObject({ verdict: 'pass', liveCorridors: 1, judgedCorridors: 0, unjudged: [{ station: 'teams', weight: 0.3, contains: false }] });
    // The same open corridor at >= 0.5 still fails.
    expect(particleCorridorVerdict([{ ...rows[1], weight: 0.5 }])).toMatchObject({ verdict: 'fail', reason: 'particle-corridor-open' });
    // Exactly at the live cutoff: live, not residual.
    expect(particleCorridorVerdict([{ ...rows[1], weight: 0.01 }]).residual).toEqual([]);
  });

  it('round 5: --sweep-film picks ~12 labelled frames across the gesture windows', () => {
    expect(parseEvidenceFlags(['--sweep', 'down', '--sweep-film']).flags.sweepFilm).toBe(true);
    expect(parseEvidenceFlags(['--chip-jump', 'pulse,schedule', '--sweep-film']).errors).toEqual([]);
    expect(parseEvidenceFlags(['--sweep-film']).errors.length).toBe(1);
    expect('sweepFilm' in parseEvidenceFlags(['--sweep', 'down']).flags).toBe(false);
    // One window, a 60 fps film across it.
    const times = Array.from({ length: 200 }, (_, i) => 1000 + i * 16.7);
    const one = sweepFilmPicks(times, [{ label: 'pulse->rules', from: 1000, to: 4000 }]);
    expect(one.length).toBe(SWEEP_FILM_FRAMES);
    expect(one[0]).toMatchObject({ index: 0, window: 'pulse->rules' });
    expect(one.at(-1).t).toBeLessThanOrEqual(4000);
    expect(one.every((p, i) => i === 0 || p.index > one[i - 1].index)).toBe(true);
    // Two jump legs: shared by duration, at least 2 each.
    const two = sweepFilmPicks(times, [
      { label: 'pulse->schedule', from: 1000, to: 3500 },
      { label: 'rules->roster', from: 3600, to: 3900 },
    ]);
    expect(two.filter((p) => p.window === 'rules->roster').length).toBeGreaterThanOrEqual(2);
    expect(two.length).toBeGreaterThanOrEqual(11);
    expect(sweepFilmPicks([], [{ label: 'a', from: 0, to: 1 }])).toEqual([]);
    expect(sweepFilmPicks(times, [{ label: 'a', from: 5, to: 5 }])).toEqual([]);
    // Labels read the closest telemetry frame.
    const telemetry = [{ t: 1000, smooth: 0, nearest: 0 }, { t: 2000, smooth: 1.52, nearest: 2, skip: { active: true }, panel: { closing: true } }];
    expect(nearestTelemetry(telemetry, 1900).t).toBe(2000);
    expect(sweepFilmLabel({ window: 'pulse->rules', t: 1990 }, 1000, telemetry[1])).toBe('pulse->rules +990ms s=1.52 teams skip panel-closing');
    expect(sweepFilmLabel({ window: 'w', t: 5 }, 0, null)).toBe('w +5ms');
    expect(sweepFilmLabel({ window: 'w', t: -16 }, 0, null)).toBe('w -16ms');
    // The settle tail's rest pose is trimmed from the window.
    const moving = [0, 100, 200, 300].map((t, i) => ({ t, smooth: i * 0.3, camPos: [i, 0, 0] }));
    const rest = [400, 1000, 1500, 1800].map((t) => ({ t, smooth: 0.9, camPos: [3, 0, 0] }));
    expect(motionWindow([...moving, ...rest])).toEqual({ from: 0, to: 550 });
    expect(motionWindow([{ t: 0, smooth: 0 }, { t: 100, smooth: 0 }])).toEqual({ from: 0, to: 100 });
    expect(motionWindow([])).toBe(null);
  });

  it('round 5: --param routeShaderCheck=0 passes through and the trace records whether it was honoured', () => {
    const { params, errors } = parseParamFlags(['--loader-trace', '--param', 'routeShaderCheck=0', '--viewports', '1440']);
    expect(errors).toEqual([]);
    expect(params).toEqual([{ key: 'routeShaderCheck', value: '0' }]);
    expect(evidenceNeedsDebug(parseEvidenceFlags(['--loader-trace', '--param', 'routeShaderCheck=0']).flags)).toBe(true);
    expect(shaderCheckRecord(params, { checkShaderErrors: false, programs: 40 })).toEqual({ requested: '0', checkShaderErrors: false, programs: 40, honoured: true });
    expect(shaderCheckRecord(params, { checkShaderErrors: true, programs: 40 }).honoured).toBe(false);
    expect(shaderCheckRecord(params, null)).toMatchObject({ requested: '0', checkShaderErrors: null, honoured: null });
    expect(shaderCheckRecord([], { checkShaderErrors: true, programs: null })).toMatchObject({ requested: null, checkShaderErrors: true, honoured: null });
  });

  it('checks subject presence per station and never passes occlusion on a missing subject', () => {
    expect(subjectBelongsTo('desk-pc', 'roster')).toBe(true);
    expect(subjectBelongsTo('plaque:left', 'rules')).toBe(true);
    expect(subjectBelongsTo('board:pulse', 'rules')).toBe(false);
    const row = (id, present) => ({ id, present, reasons: present ? [] : ['hidden-ancestor'], visibleRenderables: present ? 4 : 0, onScreenFraction: 1 });
    const blankRoster = subjectPresenceVerdict({ rows: [row('board:pulse', true), row('desk-pc', false)] }, 'roster');
    expect(blankRoster).toMatchObject({ verdict: 'fail', reason: 'subject-missing' });
    expect(subjectPresenceVerdict({ rows: [row('board:pulse', true)] }, 'rules').verdict).toBe('fail');
    expect(subjectPresenceVerdict({ rows: [row('team:player-0001', true), row('team:player-0002', false)] }, 'teams')).toMatchObject({ verdict: 'pass', presentShare: 0.5 });
    // Wave 2: the old ace:* ids are no longer teams subjects; the ledger rail is.
    expect(subjectBelongsTo('ace:1', 'teams')).toBe(false);
    expect(subjectBelongsTo('ledger:teams', 'teams')).toBe(true);
    expect(subjectPresenceVerdict({ rows: [row('ledger:teams', true)] }, 'teams').verdict).toBe('pass');
    expect(subjectPresenceVerdict(null, 'teams').verdict).toBe('unmeasured');
    // Occlusion: the board elsewhere passing does not make the roster station pass.
    const occ = { rows: [{ id: 'board:pulse', source: 'focus', onScreen: true, considered: 24, occludedFraction: 0 }] };
    expect(summarizeSubjectOcclusion(occ).verdict).toBe('pass');
    expect(summarizeSubjectOcclusion(occ, { station: 'roster' }).verdict).toBe('unmeasured');
    expect(summarizeSubjectOcclusion(occ, { station: 'roster', presence: blankRoster })).toMatchObject({ verdict: 'fail', reason: 'subject-missing' });
    const offRays = { rows: [{ id: 'desk-pc', source: 'focus', onScreen: true, considered: 0, occludedFraction: null }] };
    expect(summarizeSubjectOcclusion(offRays, { station: 'roster' }).verdict).toBe('unmeasured');
  });

  it('judges teams aces against the 70 % visibility bar and the ledger against the face bar', () => {
    const r = (id, occ) => ({ id, source: 'focus', onScreen: true, considered: 24, occludedFraction: occ });
    const ok = summarizeSubjectOcclusion({ rows: [r('team:player-0001', 0.2), r('team:player-0002', 0), r('ledger:teams', 0)] }, { station: 'teams' });
    expect(ok.verdict).toBe('pass');
    expect(ok.aceThreshold).toBe(0.3);
    expect(ok.aces).toEqual([
      { id: 'team:player-0001', onScreen: true, occludedFraction: 0.2, visibleFraction: 0.8, verdict: 'pass' },
      { id: 'team:player-0002', onScreen: true, occludedFraction: 0, visibleFraction: 1, verdict: 'pass' },
    ]);
    const bad = summarizeSubjectOcclusion({ rows: [r('team:player-0001', 0.35), r('ledger:teams', 0.06)] }, { station: 'teams' });
    expect(bad.verdict).toBe('fail');
    expect(bad.failing.map((f) => [f.id, f.threshold])).toEqual([
      ['team:player-0001', 0.3],
      ['ledger:teams', 0.05],
    ]);
    expect(summarizeSubjectOcclusion({ rows: [r('board:pulse', 0)] }, { station: 'pulse' }).aces).toBeUndefined();
  });

  it('judges the station content count against its baseline', () => {
    expect(contentBaselineKey({ world: 'sakura', theme: 'dark', station: 'teams', viewport: '390' })).toBe('sakura|dark|teams|390');
    const base = { renderables: 100, instances: 400 };
    expect(stationContentVerdict({ renderables: 95, instances: 390 }, base).verdict).toBe('pass');
    expect(stationContentVerdict({ renderables: 60, instances: 390 }, base)).toMatchObject({ verdict: 'fail', reason: 'station-content-missing' });
    expect(stationContentVerdict({ renderables: 95, instances: 100 }, base).verdict).toBe('fail');
    expect(stationContentVerdict({ renderables: 95 }, null).verdict).toBe('unmeasured');
    expect(stationContentVerdict(null, base).verdict).toBe('unmeasured');
  });

  it('matches wobbles to milestone rises in page milliseconds, sample-interval aware', () => {
    const s = (t, milestones, wobbles) => ({ t, milestones, wobbles });
    // A coarse 200 ms trace: the rise and the wobble land one sample apart,
    // inside touching intervals — matched (round 2 counted frames).
    const coarse = wobbleVerdict([s(0, 0, 0), s(200, 1, 0), s(400, 1, 1), s(600, 1, 1)]);
    expect(coarse.verdict).toBe('pass');
    expect(coarse.wobbles[0].lagMs).toBe(200);
    // A real 0.9 s lag still fails.
    const late = wobbleVerdict([s(0, 0, 0), s(16, 1, 0), s(500, 1, 0), s(916, 1, 1)]);
    expect(late.verdict).toBe('fail');
    expect(late.toleranceMs).toBe(100);
  });

  it('decodes the in-frame timecode, through JPEG, and refuses a frame without it', async () => {
    const width = 200;
    const height = 60;
    const value = 12_345_678 % 2 ** TIMECODE.bits;
    const data = Buffer.alloc(width * height * 3, 90);
    const paint = (x0, y0, on) => {
      for (let y = y0; y < y0 + TIMECODE.block; y += 1) {
        for (let x = x0; x < x0 + TIMECODE.block; x += 1) data.fill(on ? 255 : 0, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
    };
    for (let i = 0; i < TIMECODE.bits; i += 1) {
      const bit = Math.floor(value / 2 ** (TIMECODE.bits - 1 - i)) % 2 === 1;
      paint(i * TIMECODE.block, height - 2 * TIMECODE.block, bit);
      paint(i * TIMECODE.block, height - TIMECODE.block, !bit);
    }
    expect(decodeTimecode({ data, width, height, channels: 3 }, { cssWidth: width })).toBe(value);
    const jpeg = await sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 60 }).toBuffer();
    const back = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(decodeTimecode({ data: back.data, width: back.info.width, height: back.info.height, channels: back.info.channels }, { cssWidth: width })).toBe(value);
    expect(decodeTimecode({ data: Buffer.alloc(width * height * 3, 90), width, height, channels: 3 }, { cssWidth: width })).toBe(null);
  });

  it('judges composite density on capture times and reports a frozen screen as a display stall', () => {
    const frames = [];
    for (let at = -200; at <= 600; at += 50) {
      // The page shows no new frame between 100 and 500 (a stall), then resumes.
      const shown = at > 100 && at < 500 ? 100 : at;
      frames.push({ t: 1000 + shown, tCapture: 1000 + at, spread: 30 });
    }
    const v = compositeHandoffVerdict(frames, 1000);
    expect(v.density.ok).toBe(true);
    expect(v.verdict).toBe('pass');
    expect(v.displayStalls).toEqual([{ fromShownT: 1100, toShownT: 1500, ms: 400 }]);
  });

  it('accepts sparse captures only when every page frame of the window was captured', () => {
    // Captures 300 ms apart; the page painted exactly those frames (a stalled page).
    const shots = [700, 1000, 1300, 1600, 1800].map((t) => ({ t, tCapture: t + 5, spread: 30 }));
    const complete = compositeHandoffVerdict(shots, 1000, { before: 300, after: 850, pageFrames: [700, 1000, 1300, 1600, 1800] });
    expect(complete.density.ok).toBe(false);
    expect(complete).toMatchObject({ verdict: 'pass', completeCoverage: true });
    // One page frame (1150) never captured: under-sampled.
    const missed = compositeHandoffVerdict(shots, 1000, { before: 300, after: 850, pageFrames: [700, 1000, 1150, 1300, 1600, 1800] });
    expect(missed.verdict).toBe('insufficient-sampling');
    expect(missed.coverage).toMatchObject({ missed: 1, firstMissed: [1150] });
  });

  it('round 5: a composite with fewer than 5 page frames in its window is unmeasured, never pass', async () => {
    // sakura-1440 r4: 2 page frames in the window, both captured.
    const shots = [800, 1500].map((t) => ({ t, tCapture: t + 5, spread: 30 }));
    const few = compositeHandoffVerdict(shots, 1000, { before: 300, after: 800, pageFrames: [800, 1500] });
    expect(few).toMatchObject({ verdict: 'unmeasured', unmeasuredReason: 'too-few-page-frames', pageFramesInWindow: 2, minPageFrames: COMPOSITE_MIN_PAGE_FRAMES });
    expect(COMPOSITE_MIN_PAGE_FRAMES).toBe(5);
    // A blank frame still fails, however few frames there are.
    expect(compositeHandoffVerdict([{ t: 800, tCapture: 805, spread: 30 }, { t: 1500, tCapture: 1505, spread: 1 }], 1000, { before: 300, after: 800, pageFrames: [800, 1500] }).verdict).toBe('fail');
    // The loader verdict never passes on it.
    const live = (t) => ({ t, ballPhase: 'done', ballVisible: false, routeLive: true, canvasOpacity: 1, canvasSpread: 40, scenePhase: 'presented' });
    const merged = [{ t: 0, ballPhase: 'loading', ballVisible: true, routeLive: false, canvasOpacity: 0, canvasSpread: null, scenePhase: 'loading' }, live(800), live(1500)];
    const analysis = await summarizeLoader(merged, { composite: few, ballTextHits: [] });
    expect(analysis.verdict).not.toBe('pass');
    expect(analysis.handoffDensitySource).toBe('none');
  });
  it('parses the round-3 flags and keeps the Lite-floor run off ?routeDebug=1', () => {
    const trace = parseEvidenceFlags(['--loader-trace']).flags;
    expect(trace.handoffComposite).toBe(true);
    expect(trace.handoffCompositeImplied).toBe(true);
    expect(parseEvidenceFlags(['--loader-trace', '--no-handoff-composite']).flags.handoffComposite).toBe(false);
    expect(parseEvidenceFlags(['--loader-trace', '--fail-inject', 'timeout']).flags.handoffComposite).toBe(false);
    const floor = parseEvidenceFlags(['--loader-trace', '--reduced-motion']).flags;
    // Wave 2 round 2: reduced-motion traces arm the composite too.
    expect(floor.handoffComposite).toBe(true);
    expect(floor.handoffCompositeImplied).toBe(true);
    expect(isLiteFloorRun(floor, 'auto')).toBe(true);
    expect(evidenceNeedsDebug(floor, { tier: 'auto' })).toBe(false);
    expect(evidenceNeedsDebug(floor, { tier: 'route' })).toBe(true);
    expect(evidenceNeedsDebug(floor)).toBe(true);
    expect(parseEvidenceFlags(['--frames', '12', '--strip-crop', '0,640,1440,260']).flags.stripCrop).toEqual({ x: 0, y: 640, w: 1440, h: 260 });
    expect(parseEvidenceFlags(['--strip-crop', '0,640,1440,260']).errors.join(' ')).toMatch(/--frames/);
    expect(parseEvidenceFlags(['--frames', '2', '--strip-crop', '1,2,3']).errors.length).toBe(1);
    expect(parseEvidenceFlags(['--content-baseline', 'record']).flags.contentBaseline).toBe('record');
    expect(parseEvidenceFlags(['--content-baseline', 'maybe']).errors.length).toBe(1);
    expect(parseEvidenceFlags(['--pin-utime', '1.25']).flags.pinUTime).toBe(1.25);
    expect(parseEvidenceFlags(['--pin-utime', '-1']).errors.length).toBe(1);
    expect(stripLabel(3, 2500, { bodies: [{ uTime: 1.4712 }] })).toBe('f03 +2.5s uT 1.47');
    expect(stripLabel(0, 0)).toBe('f00 +0.0s');
  });
});

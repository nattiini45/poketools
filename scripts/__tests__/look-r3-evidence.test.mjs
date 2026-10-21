import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  baselineSuspicion,
  ceremonyGaps,
  ceremonyWindowOf,
  compareToFloor,
  generationAccount,
  mainThreadGaps,
  parseDiffTags,
  pickDiffCandidate,
  sceneLightingMatch,
  wholeCeremonyCadence,
  wholeCeremonyPhaseOf,
  worldLumaConsistency,
} from '../lib/look-r3-evidence.mjs';
import { faceContrast } from '../lib/w1-evidence.mjs';
import { stillDiff, tagPairDiff } from '../lib/still-diff.mjs';

/** Film rows every `step` ms from `from` to `to`, in one ball / scene phase. */
function rows(from, to, step, ballPhase, scenePhase = 'presented', extra = {}) {
  const out = [];
  for (let t = from; t <= to; t += step) out.push({ t, tEpoch: t, tTimecode: t, ballPhase, scenePhase, ...extra });
  return out;
}

describe('whole-ceremony cadence (CAR r2: the window must start at the first ball-visible frame)', () => {
  it('splits loading at the presented milestone and ignores non-ceremony rows', () => {
    expect(wholeCeremonyPhaseOf({ ballPhase: 'loading', scenePhase: 'loading' })).toBe('loading-before-presented');
    expect(wholeCeremonyPhaseOf({ ballPhase: 'loading', scenePhase: 'presented' })).toBe('loading-after-presented');
    expect(wholeCeremonyPhaseOf({ ballPhase: 'opening' })).toBe('opening');
    expect(wholeCeremonyPhaseOf({ ballPhase: 'done' })).toBeNull();
    expect(wholeCeremonyPhaseOf(null)).toBeNull();
  });

  it('starts the window at the loader-trace ball-visible sample, else the first film ceremony sample', () => {
    const samples = [
      { t: 3000, ballPresent: true, ballPhase: 'loading' },
      { t: 9000, ballPresent: true, ballPhase: 'opening' },
      { t: 12000, ballPresent: true, ballPhase: 'done' },
    ];
    const traced = ceremonyWindowOf({ samples, traceSamples: [{ t: 2000, ballVisible: false }, { t: 3164, ballVisible: true }] });
    expect(traced).toMatchObject({ start: 3164, end: 12000, startSource: 'trace-ballVisible', endSource: 'ball-done' });
    const film = ceremonyWindowOf({ samples });
    expect(film).toMatchObject({ start: 3000, startSource: 'film-ballPhase' });
    expect(ceremonyWindowOf({ samples: [{ t: 1, ballPhase: 'done' }] })).toBeNull();
  });

  it('books a loading-phase freeze the r2 presented-anchored window never saw, and fails it > 250 ms', () => {
    const film = [
      ...rows(3200, 4000, 16, 'loading', 'loading'),
      // 851 ms frozen screen in the loading phase (before presented)
      ...rows(4851, 9000, 16, 'loading', 'loading'),
      ...rows(9016, 10000, 16, 'opening'),
      ...rows(10016, 11000, 16, 'releasing'),
    ];
    const periodic = [];
    for (let t = 3200; t <= 11000; t += 100) if (t < 4000 || t > 4851) periodic.push({ t, kind: 'periodic', ballPhase: 'loading', scenePhase: 'loading' });
    const window = { start: 3164, end: 11000 };
    const c = wholeCeremonyCadence([...film, ...periodic], window);
    expect(c.verdict).toBe('fail');
    expect(c.screencast.byPhase['loading-before-presented'].maxGapMs).toBeGreaterThan(800);
    expect(c.screencast.worst[0].phase).toBe('loading-before-presented');
    expect(c.corroborated).toBe(true);
    expect(c.failsRun).toBe(true);
  });

  it('warns between 100 and 250 ms, passes a smooth ceremony, and never passes an empty window', () => {
    const warn = [...rows(0, 1000, 16, 'loading', 'loading'), ...rows(1180, 2000, 16, 'opening')];
    expect(wholeCeremonyCadence(warn, { start: 0, end: 2000 }).verdict).toBe('warn');
    expect(wholeCeremonyCadence(rows(0, 2000, 16, 'opening'), { start: 0, end: 2000 }).verdict).toBe('pass');
    expect(wholeCeremonyCadence([], { start: 0, end: 2000 }).verdict).toBe('unmeasured');
    expect(wholeCeremonyCadence([], null).verdict).toBe('unmeasured');
  });

  it('does not fail the run on an uncorroborated screencast gap (the screencast can be thinned)', () => {
    const film = [...rows(0, 1000, 16, 'opening'), ...rows(1400, 2000, 16, 'opening')];
    const periodic = [];
    for (let t = 0; t <= 2000; t += 100) periodic.push({ t, kind: 'periodic', ballPhase: 'opening' });
    const c = wholeCeremonyCadence([...film, ...periodic], { start: 0, end: 2000 });
    expect(c.verdict).toBe('fail');
    expect(c.corroborated).toBe(false);
    expect(c.failsRun).toBe(false);
  });

  it('measures main-thread gaps from distinct timecodes and books edge gaps apart', () => {
    const film = [...rows(0, 500, 16, 'loading', 'loading'), ...rows(1300, 2000, 16, 'loading', 'presented')];
    const mt = mainThreadGaps(film, { start: 0, end: 2000 });
    expect(mt.verdict).toBe('fail');
    expect(mt.worst[0]).toMatchObject({ phase: 'loading-before-presented' });
    const g = ceremonyGaps(film, { start: -50, end: 2050 });
    expect(g.edges).toEqual({ leadMs: 50, tailMs: 62 }); // last row 1988
  });
});

describe('generationAccount (CAR r2: "g4 on 3 of 12 runs, no sidecar explains why")', () => {
  it('explains a g4 load whose first three generations ended before the first read', () => {
    const samples = [
      { t: 2100, generation: 4, scenePhase: 'loading' },
      { t: 9000, generation: 4, scenePhase: 'presented' },
    ];
    const a = generationAccount(samples, { generation: 4, generationBegunAt: 1500, phaseTrace: [{ phase: 'loading', generation: 4, t: 1900 }] }, { 2: { lastFault: null }, 3: { lastFault: { reason: 'context-lost' } } });
    expect(a).toMatchObject({ verdict: 'measured', finalGeneration: 4, discardedBefore: 3, unobserved: [1, 2, 3], chainedBegin: true });
    expect(a.faults).toEqual([{ generation: 3, fault: { reason: 'context-lost' } }]);
    expect(a.notes.length).toBe(3);
  });

  it('reports a clean g1 load and an absent bridge', () => {
    expect(generationAccount([{ t: 100, generation: 1 }], { generation: 1 })).toMatchObject({ discardedBefore: 0, notes: [] });
    expect(generationAccount([], null).verdict).toBe('unmeasured');
  });
});

describe('--diff-against candidates and the noise floor', () => {
  it('parses a comma list and picks the first pose-matched still', () => {
    expect(parseDiffTags(' a-retry, a ,a,')).toEqual(['a-retry', 'a']);
    expect(parseDiffTags(null)).toEqual([]);
    const c = [
      { tag: 'a-retry', exists: false },
      { tag: 'a', exists: true, pose: { match: false } },
      { tag: 'b', exists: true, pose: { match: true } },
    ];
    expect(pickDiffCandidate(c)).toMatchObject({ pick: { tag: 'b' }, poseValid: true });
    expect(pickDiffCandidate(c.slice(0, 2))).toMatchObject({ pick: { tag: 'a' }, poseValid: false });
    expect(pickDiffCandidate([{ exists: false }]).pick).toBeNull();
  });

  it('compares an after diff with the before-vs-before floor', () => {
    const floor = { overThresholdPct: 4, mean: 3 };
    expect(compareToFloor({ overThresholdPct: 4.2, mean: 3.1 }, floor).verdict).toBe('within-floor');
    expect(compareToFloor({ overThresholdPct: 12, mean: 3.1 }, floor).verdict).toBe('above-floor');
    expect(compareToFloor(null, floor).verdict).toBe('unmeasured');
  });
});

describe('baseline lighting consistency (r2 floor: black-IBL -retry baselines read as noise)', () => {
  const lit = {
    available: true,
    theme: 'light',
    environment: { present: true, cubeUv: true, imageHeight: 256, intensity: 0.85, rotationY: 1.2 },
    lights: [
      { type: 'DirectionalLight', color: '#fff2e0', intensity: 2.4 },
      { type: 'HemisphereLight', color: '#ddeeff', intensity: 0.6 },
    ],
    fog: { color: '#c8d0d8', density: 0.012, near: null, far: null },
    background: 'none',
  };

  it('flags world-luma divergence above 20 % (the r0 light-390 pair: 138 vs 75)', () => {
    expect(worldLumaConsistency({ mean: 138.34 }, { mean: 75.47 })).toMatchObject({ verdict: 'divergent', rel: 0.4545 });
    expect(worldLumaConsistency({ mean: 100 }, { mean: 90 }).verdict).toBe('consistent');
    expect(worldLumaConsistency({ mean: 100 }, null).verdict).toBe('unmeasured');
  });

  it('matches identical lighting regardless of light order, and names each difference', () => {
    const swapped = { ...lit, lights: [...lit.lights].reverse() };
    expect(sceneLightingMatch(lit, swapped)).toEqual({ match: true, differences: [] });
    const dark = { ...lit, theme: 'dark', environment: { ...lit.environment, present: false }, fog: null };
    const m = sceneLightingMatch(lit, dark);
    expect(m.match).toBe(false);
    expect(m.differences).toEqual(expect.arrayContaining(['theme light vs dark', 'environment.present true vs false', 'fog present vs absent']));
    expect(sceneLightingMatch(lit, { ...lit, lights: [lit.lights[0], { ...lit.lights[1], intensity: 0.3 }] }).match).toBe(false);
    expect(sceneLightingMatch(lit, null).match).toBeNull();
  });

  it('marks a floor pair suspect on pose, lighting or luma, and clean otherwise', () => {
    expect(baselineSuspicion({ pose: { match: true }, lighting: { match: true, differences: [] }, luma: { verdict: 'consistent' } })).toEqual({ suspect: false, reasons: [] });
    const s = baselineSuspicion({ pose: { match: false, reasons: ['yaw differs by 0.05 rad'] }, luma: worldLumaConsistency({ mean: 138 }, { mean: 75 }) });
    expect(s.suspect).toBe(true);
    expect(s.reasons).toHaveLength(2);
  });
});

describe('faceContrast insetTiles (CLARITY r2: minima landed on AABB edge tiles)', () => {
  it('never judges the outer tile ring and reports it under edge', () => {
    const width = 60;
    const height = 60;
    const data = Buffer.alloc(width * height * 3, 200);
    const raw = { data, width, height, channels: 3 };
    const rect = { x: 10, y: 10, w: 40, h: 40 };
    const whole = faceContrast(raw, rect, { tilePx: 10 });
    const inset = faceContrast(raw, rect, { tilePx: 10, insetTiles: 1 });
    expect(whole.tiles).toBe(16);
    expect(whole.edge).toBeUndefined();
    expect(inset.tiles).toBe(4);
    expect(inset.edge).toMatchObject({ insetTiles: 1, applied: { x: 1, y: 1 }, tiles: 12 });
  });

  it('keeps every tile on an axis too thin to inset', () => {
    const raw = { data: Buffer.alloc(60 * 60 * 3, 200), width: 60, height: 60, channels: 3 };
    const thin = faceContrast(raw, { x: 0, y: 0, w: 40, h: 20 }, { tilePx: 10, insetTiles: 1 });
    expect(thin.edge.applied).toEqual({ x: 1, y: 0 });
    expect(thin.tiles).toBe(4);
  });
});

describe('still-diff --tags (offline before-set audit)', () => {
  it('pairs same-suffix stills, skips the longer -retry tag, and flags a luma-divergent pair', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'look-r3-tags-'));
    try {
      const pose = { camPos: [0, 5, -14], yaw: 0.1, pitch: -0.2 };
      const write = async (name, v, luma) => {
        await sharp(Buffer.alloc(8 * 8 * 3, v), { raw: { width: 8, height: 8, channels: 3 } }).png().toFile(join(dir, `${name}.png`));
        writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...pose, worldLuma: { mean: luma, spread: 40 } }));
      };
      await write('b-pulse-1440', 100, 138);
      await write('b-retry-pulse-1440', 60, 75);
      await write('b-rules-1440', 100, 120);
      await write('b-retry-rules-1440', 100, 118);
      const rowsOut = await tagPairDiff(dir, 'b', 'b-retry');
      expect(rowsOut.map((r) => r.suffix)).toEqual(['pulse-1440', 'rules-1440']);
      const pulse = rowsOut.find((r) => r.suffix === 'pulse-1440');
      expect(pulse.baseline.suspect).toBe(true);
      expect(pulse.worldLuma.verdict).toBe('divergent');
      const rules = rowsOut.find((r) => r.suffix === 'rules-1440');
      expect(rules.baseline.suspect).toBe(false);
      expect(rules.frame.max).toBe(0);
      const single = await stillDiff(join(dir, 'b-pulse-1440.png'), join(dir, 'b-retry-pulse-1440.png'));
      expect(single.lighting.match).toBeNull();
      expect(single.pose.match).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

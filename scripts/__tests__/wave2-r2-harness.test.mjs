import { describe, expect, it } from 'vitest';
import {
  cadenceByPhase,
  cardEdgeVerdict,
  skipWindowMountVerdict,
  stationCardVerdict,
  summarizeArrivalBurst,
  summarizeFilm,
  teamsOrderRecord,
} from '../lib/capture-evidence.mjs';

const card = (over = {}) => ({
  present: true,
  hidden: false,
  opacity: 1,
  state: 'enter',
  kicker: '1/5 · Puls',
  cardRect: { x: 24, y: 24, w: 240, h: 180 },
  contentRect: { x: 24, y: 24, w: 240, h: 170 },
  oversized: false,
  ...over,
});

describe('wave 2 round 2 harness verdicts', () => {
  it('judges the Station Card at a settled station pose only', () => {
    expect(stationCardVerdict(card()).verdict).toBe('pass');
    expect(stationCardVerdict({ present: false }).reasons).toEqual(['card-absent']);
    expect(stationCardVerdict(card({ opacity: 0.6 })).verdict).toBe('fail');
    expect(stationCardVerdict(card({ state: 'exit' })).reasons).toContain('card-state-exit');
    const stretched = stationCardVerdict(card({ oversized: true, cardRect: { x: 8, y: 8, w: 374, h: 844 }, contentRect: { x: 8, y: 8, w: 374, h: 150 } }));
    expect(stretched.verdict).toBe('fail');
    expect(stretched.reasons[0]).toMatch(/card-box-oversized \(element 844 px tall, content 150 px\)/);
    expect(stationCardVerdict(card({ opacity: 0 }), { settled: false }).verdict).toBe('not-judged');
    expect(stationCardVerdict(card({ opacity: 0 }), { focus: true }).verdict).toBe('not-judged');
    expect(stationCardVerdict(null).verdict).toBe('unmeasured');
  });

  it('lists the ledger order next to the standings order', () => {
    const rows = [
      { id: 'team:b', rect: { x: 300, y: 0, w: 40, h: 40 }, onScreen: true },
      { id: 'team:a', rect: { x: 100, y: 0, w: 40, h: 40 }, onScreen: true },
      { id: 'ledger:teams', rect: { x: 0, y: 0, w: 900, h: 40 }, onScreen: true },
    ];
    expect(teamsOrderRecord(rows, { rail: ['a', 'b'] })).toMatchObject({ projectedLeftToRight: ['a', 'b'], standingsSource: 'rail', matches: true });
    expect(teamsOrderRecord(rows, { rail: ['b', 'a'] }).matches).toBe(false);
    expect(teamsOrderRecord(rows, { bridgeOrder: ['a', 'x', 'b'] })).toMatchObject({ standingsSource: 'bridge', matches: true });
    expect(teamsOrderRecord(rows).matches).toBeNull();
  });

  it('summarizes an arrival burst: real cadence, settle, card and breathe', () => {
    const s = (t, over = {}) => ({ t, chip: '#pulse', smooth: 0, exact: 0, settled: true, card: null, hover: { mode: 'none', visible: false }, rollCall: null, ...over });
    const samples = [
      s(0),
      s(200),
      s(400, { chip: '#teams', smooth: 1.2, exact: 2, settled: false }),
      s(600, { chip: '#teams', smooth: 2, exact: 2, settled: false }),
      s(800, { chip: '#teams', smooth: 2, exact: 2, settled: true, card: { station: 'teams', state: 'enter', opacity: 0.5 } }),
      s(1000, { chip: '#teams', smooth: 2, exact: 2, settled: true, card: { station: 'teams', state: 'enter', opacity: 1 }, hover: { mode: 'breathe', visible: true, target: 'ledger:teams' } }),
      s(1200, { chip: '#teams', smooth: 2, exact: 2, settled: true, hover: { mode: 'breathe', visible: true, target: 'ledger:teams' }, rollCall: { arrivals: 1, litAt: [1, 2] } }),
    ];
    const r = summarizeArrivalBurst(samples, { clickT: 300, intervalMs: 200, target: 'teams' });
    expect(r.cadence.medianMs).toBe(200);
    expect(r.cadenceOk).toBe(true);
    expect(r.landedAt).toBe(300);
    expect(r.poseReachedAt).toBe(300);
    const gated = summarizeArrivalBurst(
      samples.map((x) => (x.t === 600 ? { ...x, skip: { active: true } } : x.t === 800 ? { ...x, skip: { active: true } } : x)),
      { clickT: 300, intervalMs: 200, target: 'teams' },
    );
    expect(gated.poseReachedAt).toBe(300);
    expect(gated.landedAt).toBe(700);
    expect(r.settledAt).toBe(500);
    expect(r.cardEnterAt).toBe(700);
    expect(r.breathe).toMatchObject({ verdict: 'seen', target: 'ledger:teams', firstAt: 700, spanMs: 200, afterSettleMs: 200 });
    expect(r.rollCall.last).toEqual({ arrivals: 1, litAt: [1, 2] });
    expect(summarizeArrivalBurst([{ t: 0, hover: null }, { t: 4700, hover: null }]).cadenceOk).toBe(false);
    expect(summarizeArrivalBurst([{ t: 0, hover: null }]).breathe.verdict).toBe('unmeasured');
  });

  it('fails a mid-skip mount of a passed-through window, allows the target', () => {
    const f = (t, windows, smooth = 0) => ({ t, smooth, windows });
    const frames = [
      f(0, { '[0,1]': [1, 1, 'free', 0], '[1,2]': [0, 0, 'free', 1], '[2,3]': [0, 0, 'free', 3] }),
      f(100, { '[0,1]': [1, 1, 'free', 0], '[1,2]': [0, 0, 'passed', 1], '[2,3]': [0, 0, 'target', 3] }),
      f(200, { '[0,1]': [1, 1, 'free', 0], '[1,2]': [1, 0, 'passed', 1], '[2,3]': [0, 0, 'target', 3] }, 0.88),
      f(300, { '[0,1]': [1, 1, 'free', 0], '[1,2]': [1, 0, 'passed', 1], '[2,3]': [1, 1, 'target', 3] }, 3),
    ];
    const bad = skipWindowMountVerdict(frames, { clickT: 50, landedT: 300, toIndex: 3 });
    expect(bad.verdict).toBe('fail');
    expect(bad.violations).toEqual([{ key: '[1,2]', field: 'entered', t: 150, station: 1, skipGate: 'passed', smooth: 0.88 }]);
    expect(bad.targetMounts.map((m) => m.field)).toEqual(['entered', 'resident']);
    const clean = skipWindowMountVerdict([frames[0], frames[1], frames[3]].map((x) => ({ ...x, windows: { ...x.windows, '[1,2]': [0, 0, 'passed', 1] } })), { clickT: 50, toIndex: 3 });
    expect(clean.verdict).toBe('pass');
    expect(skipWindowMountVerdict([{ t: 0 }], { clickT: 0, toIndex: 1 }).verdict).toBe('unmeasured');
  });

  it('asserts the Station Card enter / exit edges explicitly', () => {
    const f = (t, station, state, edge, travel = null) => ({ t, caption: { station, state, edge, travel, direction: null } });
    const good = cardEdgeVerdict([f(0, 'pulse', 'enter', 'bottom'), f(10, 'pulse', 'exit', 'top', '1'), f(20, 'roster', 'enter', 'bottom'), f(30, 'roster', 'exit', 'bottom', '-1'), f(40, 'pulse', 'enter', 'top')]);
    expect(good.verdict).toBe('pass');
    expect(good.entries).toHaveLength(2);
    const bad = cardEdgeVerdict([f(0, 'pulse', 'enter', 'bottom'), f(20, 'roster', 'enter', 'top'), f(30, 'roster', 'enter', 'bottom')]);
    expect(bad.verdict).toBe('fail');
    expect(bad.flips).toBe(1);
    expect(cardEdgeVerdict([]).verdict).toBe('unmeasured');
  });

  it('reports the periodic cadence per ball phase and exempts reduced motion from the fps floor', () => {
    const rows = [
      { t: 0, kind: 'periodic', ballPhase: 'loading' },
      { t: 100, kind: 'periodic', ballPhase: 'loading' },
      { t: 2218, kind: 'periodic', ballPhase: 'loading' },
      { t: 2300, kind: 'screencast', ballPhase: 'opening' },
      { t: 2350, kind: 'screencast', ballPhase: 'opening' },
    ];
    const by = cadenceByPhase(rows);
    expect(by.loading.periodic).toEqual({ intervals: 2, medianMs: 2118, maxMs: 2118 });
    expect(by.opening.screencastMaxGapMs).toBe(50);
    const frames = [{ t: 0 }, { t: 500 }, { t: 1000 }];
    const samples = [{ t: 0, scenePhase: 'presented' }, { t: 1000, ballPhase: 'done' }];
    expect(summarizeFilm(frames, samples).fpsFloorMet).toBe(false);
    const rm = summarizeFilm(frames, samples, { reducedMotion: true });
    expect(rm.fpsFloorMet).toBeNull();
    expect(rm.fpsFloorExempt).toMatch(/reduced-motion/);
  });
});

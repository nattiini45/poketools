import { describe, expect, it } from 'vitest';
import {
  attributeFrameGaps,
  ensureCeremonyPicks,
  handoffRecord,
  HANDOFF_TARGET_INTERVAL_MS,
  modelRollCallLight,
  ROLL_CALL_SCHEDULE,
  rollCallVerdict,
} from '../lib/capture-evidence.mjs';
import { cadencePerBallPhase, ceremonyPhaseOf, productWobbleVerdict } from '../lib/w1-evidence.mjs';
import { pngsForRecord, tryPngPathFor } from '../lib/evidence-tries.mjs';

/** Burst samples of an ideal D16 roll call starting at `S`, one every `step` ms. */
function idealCall({ S = 1000, columns = 8, step = 100, from = 900, to = 2800, arrivals = 1, before = 0 } = {}) {
  const rows = [];
  for (let t = from; t <= to; t += step) {
    const started = t >= S;
    rows.push({
      t,
      settled: started,
      rollCall: {
        startedAt: started ? S : null,
        arrivals: started ? arrivals : before,
        columns,
        lights: Array.from({ length: columns }, (_, k) => modelRollCallLight(k, started ? t - S : null)),
      },
    });
  }
  return rows;
}

describe('wave 2 round 3 harness: roll-call verdict (TEAMS)', () => {
  it('models the D16 schedule: rest -> calling -> called, one column per step', () => {
    const { leadMs, stepMs, pulseMs } = ROLL_CALL_SCHEDULE;
    expect(modelRollCallLight(0, null)).toBe('rest');
    expect(modelRollCallLight(0, leadMs - 1)).toBe('rest');
    expect(modelRollCallLight(0, leadMs)).toBe('calling');
    expect(modelRollCallLight(0, leadMs + pulseMs)).toBe('called');
    expect(modelRollCallLight(3, leadMs + 3 * stepMs - 1)).toBe('rest');
    expect(modelRollCallLight(3, leadMs + 3 * stepMs)).toBe('calling');
  });

  it('passes an ideal call sampled densely, with arrivals +1', () => {
    const v = rollCallVerdict(idealCall(), { clickT: 950 });
    expect(v.verdict).toBe('pass');
    expect(v.columns).toBe(8);
    expect(v.windowMs).toBe(1580);
    expect(v.samplesInWindow).toBeGreaterThanOrEqual(8);
    expect(v.leftToRight).toBe(true);
    expect(v.arrivalsBefore).toBe(0);
    expect(v.arrivalsAtCall).toBe(1);
  });

  it('is unmeasured (insufficient sampling) when too few samples fall in the call', () => {
    const v = rollCallVerdict(idealCall({ step: 400 }), { clickT: 950 });
    expect(v.verdict).toBe('unmeasured');
    expect(v.unmeasuredReason).toBe('insufficient-sampling');
  });

  it('fails a light off the model, and an arrivals jump other than +1', () => {
    const off = idealCall();
    off.find((r) => r.t === 1500).rollCall.lights[7] = 'called';
    expect(rollCallVerdict(off, { clickT: 950 }).verdict).toBe('fail');
    const twice = idealCall({ arrivals: 2 });
    const v = rollCallVerdict(twice, { clickT: 950 });
    expect(v.verdict).toBe('fail');
    expect(v.reasons.join(' ')).toMatch(/arrivals 0 -> 2/);
  });

  it('fails a micro-scroll that re-arms the call; holds when it does not', () => {
    const rows = idealCall({ to: 4000 });
    const microScroll = { fromT: 3000, toT: 4000 };
    expect(rollCallVerdict(rows, { clickT: 950, microScroll }).microScroll.arrivalsHeld).toBe(true);
    const rearmed = rows.map((r) => (r.t >= 3200 ? { ...r, rollCall: { ...r.rollCall, startedAt: 3200, arrivals: 2 } } : r));
    const v = rollCallVerdict(rearmed, { clickT: 950, microScroll });
    expect(v.verdict).toBe('fail');
    expect(v.microScroll.newStarts).toBe(1);
  });

  it('no bridge -> unmeasured; settled without a call -> fail', () => {
    expect(rollCallVerdict([{ t: 1 }]).verdict).toBe('unmeasured');
    const noCall = [{ t: 1000, settled: true, rollCall: { startedAt: null, arrivals: 0, columns: 8, lights: Array(8).fill('rest') } }];
    expect(rollCallVerdict(noCall, { clickT: 900 }).verdict).toBe('fail');
  });
});

describe('wave 2 round 3 harness: ceremony montage picks (W7)', () => {
  it('adds the peak-beam frame and at least `min` ceremony frames', () => {
    const times = [0, 100, 200, 300, 400, 500, 600, 700];
    const red = [null, null, null, 0.01, 0.2, 0.05, null, null];
    const { selected, ceremony } = ensureCeremonyPicks([0, 7], times, red, { openingAt: 300, endedAt: 550, min: 3 });
    expect(selected).toContain(4);
    expect(ceremony.peakIndex).toBe(4);
    expect(ceremony.peakRedShare).toBe(0.2);
    expect(ceremony.picked).toBe(3);
    expect(ceremony.reason).toBeNull();
    expect(selected).toEqual([...selected].sort((a, b) => a - b));
  });

  it('reports why when the ceremony was not sampled', () => {
    expect(ensureCeremonyPicks([0], [0, 1], [null, null], {}).ceremony.reason).toBe('no opening phase sampled');
    const short = ensureCeremonyPicks([0], [0, 100, 200], [null, 0.1, null], { openingAt: 90, endedAt: 150, min: 3 });
    expect(short.ceremony.available).toBe(1);
    expect(short.ceremony.reason).toMatch(/only 1 captured frame/);
  });
});

describe('wave 2 round 3 harness: handoff verdict (W7)', () => {
  it('is its own verdict: not-applicable, unmeasured, fail, pass', () => {
    expect(handoffRecord({ routeLiveAt: null, source: 'none' }).verdict).toBe('not-applicable');
    const none = handoffRecord({ routeLiveAt: 1000, density: { maxIntervalMs: 283, reason: 'sparse' }, source: 'none' });
    expect(none.verdict).toBe('unmeasured');
    expect(none.unmeasuredReason).toBe('insufficient-sampling');
    const blank = handoffRecord({ routeLiveAt: 1000, density: { maxIntervalMs: 40 }, source: 'dom-trace', blankGaps: [{ from: 1100, to: 1200 }] });
    expect(blank.verdict).toBe('fail');
    const ok = handoffRecord({ routeLiveAt: 1000, density: { maxIntervalMs: 40 }, source: 'dom-trace', blankGaps: [{ from: 5000, to: 5100 }] });
    expect(ok.verdict).toBe('pass');
    expect(ok.sampling.metTarget).toBe(40 <= HANDOFF_TARGET_INTERVAL_MS);
    const composite = handoffRecord({ routeLiveAt: 1000, composite: { verdict: 'fail', reasons: ['x'], density: { maxIntervalMs: 30 } }, source: 'composite' });
    expect(composite.verdict).toBe('fail');
  });
});

describe('wave 2 round 3 harness: cadence per ball phase (W7)', () => {
  it('classifies the ceremony phase of a film frame', () => {
    expect(ceremonyPhaseOf({ ballPhase: 'loading', scenePhase: 'presented' })).toBe('loading-after-presented');
    expect(ceremonyPhaseOf({ ballPhase: 'loading', scenePhase: 'loading' })).toBeNull();
    expect(ceremonyPhaseOf({ ballPhase: 'opening' })).toBe('opening');
    expect(ceremonyPhaseOf({ ballPhase: 'releasing' })).toBe('releasing');
    expect(ceremonyPhaseOf(null)).toBeNull();
  });

  it('books each interval to the earlier frame phase, per source', () => {
    const frames = [
      { kind: 'screencast', tEpoch: 0, ballPhase: 'loading', scenePhase: 'presented' },
      { kind: 'screencast', tEpoch: 300, ballPhase: 'opening' },
      { kind: 'screencast', tEpoch: 340, ballPhase: 'releasing' },
      { kind: 'screencast', tEpoch: 400, ballPhase: 'done' },
      { kind: 'periodic', t: 0, ballPhase: 'opening' },
      { kind: 'periodic', t: 90, ballPhase: 'opening' },
    ];
    const cast = cadencePerBallPhase(frames);
    expect(cast['loading-after-presented']).toMatchObject({ intervals: 1, maxGapMs: 300, maxGapAt: 0 });
    expect(cast.opening.maxGapMs).toBe(40);
    expect(cast.releasing.maxGapMs).toBe(60);
    const periodic = cadencePerBallPhase(frames, { source: 'periodic' });
    expect(periodic.opening.maxGapMs).toBe(90);
    expect(periodic.releasing.intervals).toBe(0);
  });
});

describe('wave 2 round 3 harness: product wobble exemptions (W7)', () => {
  it('exempts milestones that rise after opening, and flags same-clock self-stamping', () => {
    const v = productWobbleVerdict({
      milestones: { at: { renderer: 100, assets: 400, firstFrame: 900 } },
      wobbleTrace: [
        { kind: 'rockStart', shake: 1, startTime: 100 },
        { kind: 'rockStart', shake: 2, startTime: 400 },
      ],
      ballTrace: [{ phase: 'opening', t: 800 }],
    });
    expect(v.verdict).toBe('pass');
    expect(v.risesWithoutWobble).toEqual([]);
    expect(v.risesAfterOpeningExempt).toEqual(['firstFrame']);
    expect(v.openingAt).toBe(800);
    expect(v.selfStampSuspect).not.toBeNull();
  });
});

describe('wave 2 round 3 harness: LoAF gap sources (W6)', () => {
  it('names the heaviest scripts of the long tasks inside a gap; omits sources otherwise', () => {
    const report = { gaps: [{ t: 1000, gapMs: 400 }, { t: 3000, gapMs: 300 }] };
    const longTasks = [
      {
        start: 650,
        duration: 320,
        loaf: [
          {
            start: 650,
            ms: 330,
            scripts: [
              { ms: 20, type: 'user-callback', fn: 'small', src: 'a.js', at: 1 },
              { ms: 250, type: 'user-callback', fn: 'warmPass', src: 'chunks/w.js', at: 42 },
            ],
          },
        ],
      },
      { start: 2750, duration: 200 },
    ];
    const out = attributeFrameGaps(report, { longTasks });
    expect(out.gaps[0].attribution).toBe('page-long-task');
    expect(out.gaps[0].sources).toEqual(['250ms user-callback:warmPass@chunks/w.js:42', '20ms user-callback:small@a.js:1']);
    expect(out.gaps[1].sources).toBeUndefined();
    expect(attributeFrameGaps(report).gaps[0].sources).toBeUndefined();
  });
});

describe('wave 2 round 3 harness: earlier-try PNGs', () => {
  it('maps each record to its PNGs, never archived tries', () => {
    const listing = [
      'a-teams-1440-trace.json',
      'a-teams-1440-strip.png',
      'a-teams-1440-strip-crop.png',
      'a-teams-1440-f00.png',
      'a-teams-1440-f12.png',
      'a-teams-1440-fx.png',
      'a-teams-1440-f00.try1.png',
      'b-burst.json',
      'b-burst-strip.png',
      'c-sweep.json',
      'c-sweep-film.png',
      'd.json',
      'd.png',
    ];
    expect(pngsForRecord('a-teams-1440-trace.json', listing)).toEqual([
      'a-teams-1440-f00.png',
      'a-teams-1440-f12.png',
      'a-teams-1440-strip-crop.png',
      'a-teams-1440-strip.png',
    ]);
    expect(pngsForRecord('b-burst.json', listing)).toEqual(['b-burst-strip.png']);
    expect(pngsForRecord('c-sweep.json', listing)).toEqual(['c-sweep-film.png']);
    expect(pngsForRecord('d.json', listing)).toEqual(['d.png']);
    expect(pngsForRecord('d.try2.json', listing)).toEqual([]);
    // Regex metacharacters in the stem are literal.
    expect(pngsForRecord('x.y-trace.json', ['x.y-f01.png', 'xzy-f01.png'])).toEqual(['x.y-f01.png']);
    expect(tryPngPathFor('d.png', 3)).toBe('d.try3.png');
  });
});

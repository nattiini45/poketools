/**
 * LOOK r4 SEAT H: black-IBL rejection, blank data-face presence, quiet-probe
 * recorder drops, the at-reveal program count, and the content-baseline seed.
 */
import { describe, expect, it } from 'vitest';
import { boardFaceSignal, boardPresenceVerdict, iblVerdict, programCountAtReveal, recorderDropAccount } from '../lib/look-r4-evidence.mjs';
import { adoptableRow, mergeBaseline } from '../lib/seed-content-baseline.mjs';

const read = (pmrem, extra = {}) => ({ available: true, envIntensity: 1, environmentPresent: true, environmentType: 'texture', pmrem, ...extra });

describe('iblVerdict (a black prefiltered IBL is rejected at capture time)', () => {
  it('reads black, lit, no-ibl and unmeasured', () => {
    expect(iblVerdict(read({ status: 'read', meanRadiance: 0, maxRadiance: 0, faces: new Array(6) }))).toMatchObject({ verdict: 'black', pmremReady: false });
    expect(iblVerdict(read({ status: 'read', meanRadiance: 0.42, maxRadiance: 3.1 }))).toMatchObject({ verdict: 'lit', pmremReady: true });
    expect(iblVerdict(read({ status: 'read', meanRadiance: 0.3, maxRadiance: 1 }, { envIntensity: 0 })).verdict).toBe('zero-intensity');
    expect(iblVerdict({ available: true, environmentPresent: false, pmrem: { status: 'no-environment' } }).verdict).toBe('no-ibl');
    expect(iblVerdict(read({ status: 'unbound', reason: 'no lit material' })).verdict).toBe('unmeasured');
    expect(iblVerdict(null).verdict).toBe('unmeasured');
    expect(iblVerdict({ available: false, reason: 'missing-scene-handle' })).toMatchObject({ verdict: 'unmeasured', reason: 'missing-scene-handle' });
  });
});

/** A width x height RGB buffer; `paint(x, y)` returns a grey level. */
function img(width, height, paint) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const v = paint(x, y);
      data.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  return { data, width, height, channels: 3 };
}

describe('blank data face (CAR r3: presence passed a blank LED board)', () => {
  const rect = { x: 0, y: 0, w: 100, h: 60 };
  it('a smooth glow blob is flat (high std, no edges); text-like stripes are not', () => {
    const glow = img(100, 60, (x, y) => Math.round(30 + 170 * Math.exp(-((x - 50) ** 2 + (y - 30) ** 2) / 6000)));
    const text = img(100, 60, (x, y) => (y % 6 < 2 && x % 7 < 4 ? 230 : 40));
    const g = boardFaceSignal(glow, rect);
    const t = boardFaceSignal(text, rect);
    expect(g.lumaStd).toBeGreaterThan(10);
    expect(g.edgeSharePct).toBeLessThan(1);
    expect(t.edgeSharePct).toBeGreaterThan(10);
    expect(boardPresenceVerdict({ id: 'board:pulse', signal: g }).verdict).toBe('fail');
    expect(boardPresenceVerdict({ id: 'board:pulse', signal: t }).verdict).toBe('pass');
  });

  it('judges renderables against the registered minimum, else frame-only boards', () => {
    expect(boardPresenceVerdict({ id: 'board:pulse', renderables: { visibleRenderables: 1, textured: 0 }, minRenderables: 2 }).verdict).toBe('fail');
    expect(boardPresenceVerdict({ id: 'board:pulse', renderables: { visibleRenderables: 2, textured: 0 }, minRenderables: 2 }).verdict).toBe('pass');
    // No baseline: a plaza board that is its frame only fails; a clouds board
    // (one textured mesh) passes.
    expect(boardPresenceVerdict({ id: 'board:pulse', renderables: { visibleRenderables: 1, textured: 0 } }).verdict).toBe('fail');
    expect(boardPresenceVerdict({ id: 'board:pulse', renderables: { visibleRenderables: 1, textured: 1 } }).verdict).toBe('pass');
    expect(boardPresenceVerdict({ id: 'plaque:left', kind: 'plaque', renderables: { visibleRenderables: 1, textured: 0 } }).verdict).toBe('pass');
    expect(boardPresenceVerdict({ id: 'board:pulse' }).verdict).toBe('unmeasured');
  });
});

describe('recorderDropAccount (CAR r3: dropped 34230)', () => {
  it('vouches only when no judged entry inside the legs was lost', () => {
    expect(recorderDropAccount({ dropped: 0, droppedByKind: {}, evicted: {} }).verdict).toBe('counters-complete');
    expect(recorderDropAccount({ dropped: 34230 }).verdict).toBe('unknown');
    expect(recorderDropAccount({ dropped: 0 }).verdict).toBe('complete');
    expect(recorderDropAccount({ dropped: 0, droppedByKind: {}, evicted: { reuploads: { count: 34230, before: 20_000 } } }, { windowStart: 12_000 }).verdict).toBe('counters-complete');
    expect(recorderDropAccount({ dropped: 0, droppedByKind: {}, evicted: { resources: { count: 10, before: 9_000 } } }, { windowStart: 12_000 }).verdict).toBe('counters-complete');
    expect(recorderDropAccount({ dropped: 0, droppedByKind: {}, evicted: { resources: { count: 10, before: 13_000 } } }, { windowStart: 12_000 }).verdict).toBe('counters-incomplete');
    expect(recorderDropAccount({ dropped: 5, droppedByKind: { links: 5 }, evicted: {} }).verdict).toBe('counters-incomplete');
    expect(recorderDropAccount(null).verdict).toBe('unmeasured');
  });
});

describe('programCountAtReveal (one defined measurement point)', () => {
  it('judges the reveal read and reports later reads beside it', () => {
    const r = programCountAtReveal({ atReveal: 115, startRung: 0, later: [{ leg: 'idle', programs: 115 }, { leg: 'sweep', programs: 119 }, { leg: 'x', programs: null }] });
    expect(r).toMatchObject({ verdict: 'measured', judged: 115, startRung: 0, growthAfterReveal: 4 });
    expect(r.later).toHaveLength(2);
    expect(programCountAtReveal({}).verdict).toBe('unmeasured');
  });
});

describe('seed-content-baseline', () => {
  const sidecar = (quality, renderables, extra = {}) => ({
    invocation: { args: { quality } },
    stationContent: {
      ok: true,
      baselineKey: 'plaza|dark|pulse|1440',
      presence: { verdict: 'pass', present: [{ id: 'board:pulse', visibleRenderables: 2 }] },
      content: { renderables, instances: 400 },
      ...extra,
    },
  });
  it('adopts passing stills per rung and keeps the most content on the rung-less key', () => {
    const r0 = adoptableRow(sidecar('0', 58), 'a.json');
    const r2 = adoptableRow(sidecar('2', 52), 'b.json');
    expect(r0).toMatchObject({ key: 'plaza|dark|pulse|1440', rung: 0, entry: { renderables: 58, faces: { 'board:pulse': 2 } } });
    const { file, written } = mergeBaseline(null, [r2, r0]);
    expect(file.entries['plaza|dark|pulse|1440|q0'].renderables).toBe(58);
    expect(file.entries['plaza|dark|pulse|1440|q2'].renderables).toBe(52);
    expect(file.entries['plaza|dark|pulse|1440'].renderables).toBe(58);
    // LOOK r6 (H2): the exact dpr + rung keys are written beside the r4 keys (dpr 1 when --dpr was absent).
    expect(file.entries['plaza|dark|pulse|1440|d1|q0']).toMatchObject({ renderables: 58, dpr: 1, rung: 0 });
    expect(file.entries['plaza|dark|pulse|1440|d1|q2'].renderables).toBe(52);
    expect(written).toHaveLength(5);
    // An existing rung-less entry is kept unless replace.
    expect(mergeBaseline({ entries: { 'plaza|dark|pulse|1440': { renderables: 1 } } }, [r0]).file.entries['plaza|dark|pulse|1440'].renderables).toBe(1);
  });
  it('skips failing, blank-face and black-IBL stills', () => {
    expect(adoptableRow(sidecar('0', 58, { ok: false }), 'x').skip).toMatch(/ok false/);
    expect(adoptableRow(sidecar('0', 58, { faces: [{ verdict: 'fail' }] }), 'x').skip).toMatch(/data face/);
    expect(adoptableRow({ ...sidecar('0', 58), iblState: { verdict: 'black' } }, 'x').skip).toMatch(/black IBL/);
  });
});

/**
 * R49 (tools seat): the K8 film crash. `__routeWorldPresent()` returns null
 * while the page's C-083 present gate is held (a rung step / focus transition
 * re-arms its 2 s quiet window); --frames presents skip the kit-settle wait,
 * so the harness read that null as "invalid-payload" and died. The helpers
 * classify the failure, allow ONE re-acquire, and record it. The fix round
 * moves the orchestration into presentWithRetry (driven here with stubs),
 * bounds the focus transition, adds the retry verdict, and records the
 * --contrast-repeat present's retry. capture-route.mjs runs at import time,
 * so its wiring is checked on the source text (the gauntlet-harness.test.mjs
 * precedent).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRESENT_GATE_REOPEN_WAIT_MS,
  RUNG_STEP_TRANSITION_FRAMES,
  classifyPresentFailure,
  describePresentPayload,
  presentFailureDetail,
  presentFailureError,
  presentRetryRecord,
  presentRetryVerdict,
  presentTransition,
  presentWithRetry,
  shouldRetryPresent,
  waitForPresentGateOpen,
} from '../lib/present-retry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const source = readFileSync(resolve(repoRoot, 'scripts', 'capture-route.mjs'), 'utf8');
const noSleep = () => Promise.resolve();
const HELD = { held: true, facade: 'kit', settledMs: 640 };
const OPEN = { held: false, facade: 'kit', settledMs: 2100 };

describe('describePresentPayload', () => {
  it('names every bad payload shape and accepts only a PNG data URL', () => {
    expect(describePresentPayload(null)).toBe('null');
    expect(describePresentPayload(undefined)).toBe('undefined');
    expect(describePresentPayload('x')).toBe('string');
    expect(describePresentPayload({ width: 1 })).toBe('no-dataUrl');
    expect(describePresentPayload({ dataUrl: 'data:,' })).toBe('non-png:data:,');
    expect(describePresentPayload({ dataUrl: 'data:image/png;base64,AAAA' })).toBe('png');
  });
});

describe('classifyPresentFailure', () => {
  it('names a null present under a held gate present-gate-held (the K8 / k1 crash)', () => {
    expect(classifyPresentFailure({ ok: false, reason: 'invalid-payload', payloadKind: 'null', gate: HELD })).toBe('present-gate-held');
  });

  it('keeps invalid-payload for a null with an open or unread gate, and for malformed payloads', () => {
    expect(classifyPresentFailure({ ok: false, reason: 'invalid-payload', payloadKind: 'null', gate: OPEN })).toBe('invalid-payload');
    expect(classifyPresentFailure({ ok: false, reason: 'invalid-payload', payloadKind: 'null', gate: null })).toBe('invalid-payload');
    expect(classifyPresentFailure({ ok: false, reason: 'invalid-payload', payloadKind: 'non-png:data:,', gate: HELD })).toBe('invalid-payload');
  });

  it('passes other reasons through and ignores a good result', () => {
    expect(classifyPresentFailure({ ok: false, reason: 'missing-hook' })).toBe('missing-hook');
    expect(classifyPresentFailure({ ok: false, reason: 'patch-material-matched-nothing' })).toBe('patch-material-matched-nothing');
    expect(classifyPresentFailure({ ok: true, dataUrl: 'data:image/png;base64,' })).toBeNull();
  });
});

describe('shouldRetryPresent', () => {
  it('retries a held gate once, with or without a transition', () => {
    expect(shouldRetryPresent('present-gate-held')).toBe(true);
    expect(shouldRetryPresent('present-gate-held', { transition: 'rung-step' })).toBe(true);
    expect(shouldRetryPresent('present-gate-held', { transition: 'focus' })).toBe(true);
    expect(shouldRetryPresent('present-gate-held', { attempt: 1 })).toBe(false);
  });

  it('retries a malformed payload only right after a rung step, never for focus (fix round TOOLS-2)', () => {
    expect(shouldRetryPresent('invalid-payload')).toBe(false);
    expect(shouldRetryPresent('invalid-payload', { transition: 'rung-step' })).toBe(true);
    expect(shouldRetryPresent('invalid-payload', { transition: 'rung-step', attempt: 1 })).toBe(false);
    expect(shouldRetryPresent('invalid-payload', { transition: 'focus' })).toBe(false);
  });

  it('never retries the other present failures (they stay honest and immediate)', () => {
    for (const reason of ['missing-hook', 'missing-scene-handle', 'patch-material-matched-nothing', 'hide-mesh-matched-nothing', 'present-threw']) {
      expect(shouldRetryPresent(reason, { transition: 'rung-step' })).toBe(false);
    }
  });
});

describe('presentTransition', () => {
  const step = { fired: true, frameIndex: 2, atS: 10, rung: 4 };
  it('marks the step frame and the next RUNG_STEP_TRANSITION_FRAMES frames as rung-step', () => {
    expect(RUNG_STEP_TRANSITION_FRAMES).toBe(2);
    expect(presentTransition({ frameIndex: 1, rungStep: step })).toBeNull();
    expect(presentTransition({ frameIndex: 2, rungStep: step })).toBe('rung-step');
    expect(presentTransition({ frameIndex: 3, rungStep: step })).toBe('rung-step');
    expect(presentTransition({ frameIndex: 4, rungStep: step })).toBe('rung-step');
    expect(presentTransition({ frameIndex: 5, rungStep: step })).toBeNull();
  });

  it('bounds focus to the focused still and trace frame 0 (fix round TOOLS-2), null for an unfired step or no context', () => {
    expect(presentTransition({ focus: 'team:player-0001' })).toBe('focus');
    expect(presentTransition({ frameIndex: 0, focus: 'team:player-0001' })).toBe('focus');
    expect(presentTransition({ frameIndex: 1, focus: 'team:player-0001' })).toBeNull();
    expect(presentTransition({ frameIndex: 5, rungStep: step, focus: 'team:player-0001' })).toBeNull();
    expect(presentTransition({ frameIndex: 3, rungStep: step, focus: 'team:player-0001' })).toBe('rung-step');
    expect(presentTransition({ frameIndex: 0, rungStep: { fired: false, atS: 10, rung: 4 } })).toBeNull();
    expect(presentTransition()).toBeNull();
  });
});

describe('waitForPresentGateOpen', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: (ms) => ((t += ms), Promise.resolve()) };
  };

  it('returns as soon as the page gate reports not held', async () => {
    const seq = [HELD, HELD, OPEN];
    const c = clock();
    const out = await waitForPresentGateOpen(async () => seq.shift(), { pollMs: 250, ...c });
    expect(out).toEqual({ reopened: true, waitedMs: 500, polls: 3, gate: OPEN });
  });

  it('gives up at the bound with the last gate reading (fail closed on an absent bridge)', async () => {
    const c = clock();
    const out = await waitForPresentGateOpen(async () => null, { boundMs: 1000, pollMs: 250, ...c });
    expect(out.reopened).toBe(false);
    expect(out.waitedMs).toBe(1000);
    expect(out.gate).toBeNull();
    expect(PRESENT_GATE_REOPEN_WAIT_MS).toBeGreaterThanOrEqual(3000);
  });

  it('survives a throwing read and keeps polling', async () => {
    let n = 0;
    const out = await waitForPresentGateOpen(
      async () => {
        n += 1;
        if (n === 1) throw new Error('Execution context was destroyed');
        return OPEN;
      },
      { sleep: noSleep },
    );
    expect(out.reopened).toBe(true);
    expect(out.polls).toBe(2);
  });
});

describe('presentRetryRecord / presentFailureDetail', () => {
  const first = { ok: false, reason: 'invalid-payload', payloadKind: 'null', gate: HELD };
  const wait = { reopened: true, waitedMs: 1500, polls: 7, gate: OPEN };

  it('records a successful re-acquire', () => {
    expect(presentRetryRecord({ reason: 'present-gate-held', transition: 'rung-step', first, wait, second: { ok: true } })).toEqual({
      reason: 'present-gate-held',
      transition: 'rung-step',
      firstPayload: 'null',
      firstGate: HELD,
      wait,
      retried: true,
      ok: true,
      secondReason: null,
    });
  });

  it('records a second failure with its own class, and the error detail names payload, gate and retry', () => {
    const rec = presentRetryRecord({ reason: 'present-gate-held', first, wait: { ...wait, reopened: false }, second: first });
    expect(rec.ok).toBe(false);
    expect(rec.secondReason).toBe('present-gate-held');
    const detail = presentFailureDetail(first, rec);
    expect(detail).toMatch(/payload=null/);
    expect(detail).toMatch(/gate=\{"held":true/);
    expect(detail).toMatch(/retry=\{"reason":"present-gate-held"/);
    expect(presentFailureDetail({ ok: false, reason: 'missing-hook' }, null)).toBe('');
  });
});

describe('presentWithRetry (fix round TOOLS-3)', () => {
  const PNG = { ok: true, dataUrl: 'data:image/png;base64,AAAA', width: 2, height: 2 };
  const NULL_HELD = { ok: false, reason: 'invalid-payload', payloadKind: 'null', gate: HELD };
  const NULL_OPEN = { ok: false, reason: 'invalid-payload', payloadKind: 'null', gate: OPEN };
  const stub = (...results) => {
    const calls = { n: 0 };
    const fn = async () => results[Math.min(calls.n++, results.length - 1)];
    return { fn, calls };
  };
  const gateSeq =
    (...gates) =>
    async () =>
      gates.shift() ?? OPEN;

  it('presents once and returns a null record on a clean first attempt', async () => {
    const s = stub(PNG);
    const out = await presentWithRetry(s.fn, { readGate: gateSeq(), gateWait: { sleep: noSleep } });
    expect(s.calls.n).toBe(1);
    expect(out).toEqual({ presented: PNG, presentRetry: null });
  });

  it('null + held gate, then a PNG: waits on the gate, presents exactly twice and records it', async () => {
    const s = stub(NULL_HELD, PNG);
    const seen = [];
    const out = await presentWithRetry(s.fn, {
      transition: 'rung-step',
      readGate: gateSeq(HELD, OPEN),
      gateWait: { sleep: noSleep },
      onRetry: (rec) => seen.push(rec),
    });
    expect(s.calls.n).toBe(2);
    expect(out.presented).toBe(PNG);
    expect(out.presentRetry).toMatchObject({ reason: 'present-gate-held', transition: 'rung-step', firstPayload: 'null', ok: true, retried: true });
    expect(out.presentRetry.wait.reopened).toBe(true);
    expect(out.presentRetry.wait.polls).toBe(2);
    expect(seen).toEqual([out.presentRetry]);
    expect(presentRetryVerdict(out.presentRetry).verdict).toBe('recorded');
  });

  it('a second failure throws the classified reason with the retry attached', async () => {
    const s = stub(NULL_HELD, NULL_HELD);
    const err = await presentWithRetry(s.fn, { readGate: gateSeq(OPEN), gateWait: { sleep: noSleep } }).catch((e) => e);
    expect(s.calls.n).toBe(2);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^FBO present failed \(present-gate-held\) — refusing compositor screenshot payload=null/);
    expect(err.presentRetry).toMatchObject({ reason: 'present-gate-held', ok: false, secondReason: 'present-gate-held' });
  });

  it('a null under an OPEN gate after a focus still fails at once (no retry, honest invalid-payload)', async () => {
    const s = stub(NULL_OPEN, PNG);
    const err = await presentWithRetry(s.fn, { transition: 'focus', readGate: gateSeq(), gateWait: { sleep: noSleep } }).catch((e) => e);
    expect(s.calls.n).toBe(1);
    expect(err.message).toMatch(/FBO present failed \(invalid-payload\)/);
    expect(err.presentRetry).toBeNull();
  });

  it('an invalid payload after a rung step waits frames, retries once, and is recorded (verdict inconclusive)', async () => {
    const s = stub(NULL_OPEN, PNG);
    let frames = 0;
    const out = await presentWithRetry(s.fn, {
      transition: 'rung-step',
      waitFrames: async () => {
        frames += 1;
        return { frames: 2, waitedMs: 33 };
      },
    });
    expect(frames).toBe(1);
    expect(s.calls.n).toBe(2);
    expect(out.presentRetry).toMatchObject({ reason: 'invalid-payload', transition: 'rung-step', wait: { frames: 2, waitedMs: 33 }, ok: true });
    expect(presentRetryVerdict([{ i: 3, ...out.presentRetry }])).toEqual({
      verdict: 'inconclusive',
      count: 1,
      inconclusive: [{ i: 3, why: 'reason invalid-payload, gate not seen reopened' }],
    });
  });

  it('a throwing frame wait is recorded, not fatal', async () => {
    const s = stub(NULL_OPEN, PNG);
    const out = await presentWithRetry(s.fn, {
      transition: 'rung-step',
      waitFrames: async () => {
        throw new Error('Execution context was destroyed');
      },
    });
    expect(out.presentRetry.wait).toEqual({ error: 'Execution context was destroyed' });
  });

  it('never retries the other failures, and the error carries the material patch', async () => {
    const s = stub({ ok: false, reason: 'missing-hook' }, PNG);
    const err = await presentWithRetry(s.fn, { transition: 'rung-step' }).catch((e) => e);
    expect(s.calls.n).toBe(1);
    expect(err.message).toBe('FBO present failed (missing-hook) — refusing compositor screenshot');
    expect(presentFailureError({ ok: false, reason: 'patch-material-matched-nothing', materialPatch: { a: 1 } }, null).message).toBe(
      'FBO present failed (patch-material-matched-nothing) — refusing compositor screenshot materialPatch={"a":1}',
    );
  });
});

describe('presentRetryVerdict (fix round TOOLS-2)', () => {
  const ok = { reason: 'present-gate-held', wait: { reopened: true }, ok: true };

  it('is clean with no records, recorded for the diagnosed case only', () => {
    expect(presentRetryVerdict(null)).toEqual({ verdict: 'clean', count: 0, inconclusive: [] });
    expect(presentRetryVerdict([])).toEqual({ verdict: 'clean', count: 0, inconclusive: [] });
    expect(presentRetryVerdict([{ i: 3, ...ok }, { i: 4, ...ok }])).toEqual({ verdict: 'recorded', count: 2, inconclusive: [] });
  });

  it('is inconclusive for a gate not seen reopened or any invalid-payload record', () => {
    expect(presentRetryVerdict({ ...ok, wait: { reopened: false } }).inconclusive).toEqual([{ why: 'gate not seen reopened' }]);
    expect(presentRetryVerdict([{ i: 0, ...ok }, { i: 1, ...ok, reason: 'invalid-payload' }]).verdict).toBe('inconclusive');
  });
});

describe('capture-route wiring (R49 + fix round)', () => {
  it('reports the payload kind and the page gate when present() is not a PNG', () => {
    expect(source).toMatch(/frameResult = \{ ok: false, reason: 'invalid-payload', payloadKind, gate \}/);
    expect(source).toMatch(/read\(\)\.presentGate \?\? null/);
  });

  it('delegates the whole present to presentWithRetry and returns its presentRetry (TOOLS-3a/b)', () => {
    expect(source).toMatch(/const presentOnce = \(\) => page\.evaluate\(/);
    expect(source).toMatch(/const \{ presented, presentRetry \} = await presentWithRetry\(presentOnce, \{\n    transition,/);
    // presentOnce is never called directly: only presentWithRetry (unit-tested above) calls it.
    expect(source.match(/presentOnce\(\)/g)).toBeNull();
    // writePresentedPng's return object carries the record.
    expect(source).toMatch(/return \{\n    \.\.\.presented,\n[\s\S]{0,400}?\n    presentRetry,\n/);
  });

  it('the in-page payloadKind ladder agrees with describePresentPayload (TOOLS-3c)', () => {
    const m = source.match(/const payloadKind =\n([\s\S]*?);\n\s*let gate = null;/);
    expect(m).not.toBeNull();
    const inPage = new Function('frame', `return (${m[1]});`);
    for (const frame of [null, undefined, 0, '', 'x', 7, { width: 1 }, { dataUrl: 3 }, { dataUrl: 'data:,' }, { dataUrl: 'data:image/jpeg;base64,AA' }]) {
      expect(inPage(frame)).toBe(describePresentPayload(frame));
    }
  });

  it('records the retry on trace samples, the trace, the still sidecar and the contrast repeat', () => {
    expect(source).toMatch(/transition: presentTransition\(\{ frameIndex: i, rungStep: rungStepRecord, focus: focusId \}\)/);
    expect(source).toMatch(/presentRetry: framePresented\.presentRetry/);
    // TOOLS-4: the trace's array is presentGateRetries (the sidecar's presentRetries stays the reload count).
    expect(source).toMatch(/presentGateRetries\.push\(\{ i, \.\.\.framePresented\.presentRetry \}\)/);
    expect(source).toMatch(/\n    presentGateRetries,\n    presentGateRetryVerdict: presentRetryVerdict\(presentGateRetries\),\n/);
    expect(source).not.toMatch(/presentRetries\.push|const presentRetries = \[\]/);
    expect(source).toMatch(/presentGateRetry: presented\.presentRetry \?\? null/);
    expect(source).toMatch(/probe\.presentGateRetry = captureExtras\?\.presentGateRetry \?\? null/);
    expect(source).toMatch(/probe\.presentGateRetryVerdict = presentRetryVerdict\(probe\.presentGateRetry\)/);
    // TOOLS-1: the --contrast-repeat present's retry rides on contrastNoise.
    expect(source).toMatch(/const presentGateRetry = second\?\.presentRetry \?\? null;/);
    expect(source).toMatch(/\n      presentGateRetry,\n      presentGateRetryVerdict: presentRetryVerdict\(presentGateRetry\),\n/);
    // Final review TOOLS-R50-1: the failed (unmeasured) repeat branch carries the same verdict field.
    expect(source).toMatch(/const presentGateRetry = err\?\.presentRetry \?\? null;/);
    expect(source.match(/\n      presentGateRetry,\n      presentGateRetryVerdict: presentRetryVerdict\(presentGateRetry\),\n/g)).toHaveLength(2);
    // Exactly three writePresentedPng callers (still, trace frame, contrast repeat), each checked above.
    expect(source.match(/await writePresentedPng\(/g)).toHaveLength(3);
  });

  it('keeps the gate-held class out of the reload-retry list (no silent reloads)', () => {
    expect(source).toMatch(/const PRESENT_RETRYABLE_REASONS = \['present-hook-timeout', 'missing-hook'\];/);
  });
});

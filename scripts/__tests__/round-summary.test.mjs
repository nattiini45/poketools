import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyRecord, newestSrcByWorkstream, srcBelongsTo, summarizeRound, workstreamOfFile } from '../lib/round-summary.mjs';
import { isTryFile, keepPriorTry, nextTryIndex, recordPassed, tryPathFor } from '../lib/evidence-tries.mjs';

describe('round-summary (round 4: the JSON, not the exit code)', () => {
  it('counts insufficient-sampling loader traces and failing sweeps', () => {
    const records = [
      classifyRecord('a-1440-loader.json', { kind: 'loader-trace', viewport: '1440', analysis: { verdict: 'unmeasured', unmeasuredReason: 'insufficient-sampling', composite: { verdict: 'insufficient-sampling' }, reasons: ['x'] } }),
      classifyRecord('a-fail-loader.json', { kind: 'loader-trace', analysis: { verdict: 'fail', composite: { verdict: 'insufficient-sampling' }, reasons: ['wobble'] } }),
      classifyRecord('a-390-loader.json', { kind: 'loader-trace', viewport: '390', analysis: { verdict: 'pass', composite: { verdict: 'pass' }, ballText: { verdict: 'pass' }, reasons: [] } }),
      classifyRecord('a-jump-1440-sweep.json', {
        kind: 'sweep',
        mode: 'jump',
        viewport: '1440',
        pass: false,
        legs: [
          { from: 'pulse', to: 'schedule', analysis: { verdict: 'fail', frameGapVerdict: 'fail', maxFrameGapMs: 767.2 } },
          { from: 'rules', to: 'roster', analysis: { verdict: 'pass', frameGapVerdict: 'pass', maxFrameGapMs: 90 } },
        ],
      }),
      classifyRecord('a-panel-390-sweep.json', { kind: 'sweep', mode: 'panel', viewport: '390', pass: true }),
      classifyRecord('a-pulse-1440.json', { section: 'pulse', stationSettle: { ok: true }, particleCorridor: { verdict: 'fail' }, stationContent: { content: { verdict: 'unmeasured' } } }),
      classifyRecord('a-film.json', { kind: 'loader-film' }),
      classifyRecord('broken.json', null),
    ];
    const s = summarizeRound(records);
    expect(s.insufficientSamplingCount).toBe(2);
    expect(s.insufficientSampling).toEqual(['a-1440-loader.json', 'a-fail-loader.json']);
    expect(s.byKind['sweep-jump']).toMatchObject({ fail: 1 });
    expect(s.byKind['sweep-panel']).toMatchObject({ pass: 1 });
    expect(s.byKind['loader-trace']).toMatchObject({ pass: 1, fail: 1, unmeasured: 1 });
    expect(s.jumpFrameGapFails).toEqual(['a-jump-1440-sweep.json pulse->schedule 767.2 ms']);
    expect(s.stationContentUnmeasuredCount).toBe(1);
    expect(s.failures.map((f) => f.file)).toEqual(['a-fail-loader.json', 'a-jump-1440-sweep.json', 'a-pulse-1440.json', 'broken.json']);
    expect(s.failures[2].reasons).toEqual(['particle-corridor-open']);
    expect(s.ok).toBe(false);
  });

  it('is ok when nothing failed (unmeasured is counted, never failed)', () => {
    const s = summarizeRound([
      classifyRecord('b-loader.json', { kind: 'loader-trace', analysis: { verdict: 'unmeasured', unmeasuredReason: 'insufficient-sampling' } }),
    ]);
    expect(s.ok).toBe(true);
    expect(s.insufficientSamplingCount).toBe(1);
  });
});

describe('round-summary round 5: stale source and earlier tries', () => {
  const at = (iso) => Date.parse(iso);
  const newestByWs = newestSrcByWorkstream([
    { file: 'src/lib/route-world/focus.ts', mtimeMs: at('2026-09-27T01:16:25Z') },
    { file: 'src/lib/route-world/__tests__/focus.test.ts', mtimeMs: at('2026-09-27T05:00:00Z') },
    { file: 'src/lib/route-world/ball-loader-state.ts', mtimeMs: at('2026-09-27T01:00:00Z') },
    { file: 'src/app/page.tsx', mtimeMs: at('2026-09-27T06:00:00Z') },
  ]);

  it('maps files to workstreams and ignores tests and unowned files', () => {
    expect(workstreamOfFile('fid-w6-r4h-mountain-panel-panel-390-sweep.json')).toBe('W6');
    expect(workstreamOfFile('other.json')).toBe(null);
    expect(srcBelongsTo('W6', 'src/components/world/route/CameraRig.tsx')).toBe(true);
    expect(srcBelongsTo('W6', 'src/lib/route-world/__tests__/focus.test.ts')).toBe(false);
    expect(newestByWs.W6).toEqual({ file: 'src/lib/route-world/focus.ts', mtimeMs: at('2026-09-27T01:16:25Z') });
    expect(newestByWs.W7.file).toBe('src/lib/route-world/ball-loader-state.ts');
  });

  it('flags the r4h mountain panel file (stamped 01:13:52, before focus.ts at 01:16:25) as stale', () => {
    const sweep = (stamp, pass) => ({ kind: 'sweep', mode: 'panel', viewport: '390', pass, invocation: { sourceStamp: { newestSrcMtime: stamp } } });
    const staleRec = classifyRecord('fid-w6-r4h-mountain-panel-panel-390-sweep.json', sweep('2026-09-27T01:13:52.088Z', false), { newestByWs });
    expect(staleRec.stale.reason).toMatch(/focus\.ts/);
    const fresh = classifyRecord('fid-w6-r4-clouds-panel-panel-1440-sweep.json', sweep('2026-09-27T01:16:25.500Z', false), { newestByWs });
    expect(fresh.stale).toBeUndefined();
    const unstamped = classifyRecord('fid-w6-r4-x-sweep.json', { kind: 'sweep', mode: 'down', pass: true }, { newestByWs });
    expect(unstamped.stale.reason).toMatch(/unstamped/);
    const s = summarizeRound([staleRec, fresh]);
    expect(s.staleCount).toBe(1);
    expect(s.failures.map((f) => f.file)).toEqual(['fid-w6-r4-clouds-panel-panel-1440-sweep.json']);
    expect(s.staleFailures.map((f) => f.file)).toEqual(['fid-w6-r4h-mountain-panel-panel-390-sweep.json']);
    expect(s.byKind['sweep-panel']).toMatchObject({ fail: 2, stale: 1 });
  });

  it('lists earlier tries apart from the current records', () => {
    const tryRec = classifyRecord('fid-w6-r4-plaza-up-up-1440-sweep.try1.json', { kind: 'sweep', mode: 'up', pass: false });
    const current = classifyRecord('fid-w6-r4-plaza-up-up-1440-sweep.json', { kind: 'sweep', mode: 'up', pass: true });
    expect(tryRec).toMatchObject({ earlierTry: true, currentFile: 'fid-w6-r4-plaza-up-up-1440-sweep.json' });
    const s = summarizeRound([tryRec, current]);
    expect(s.ok).toBe(true);
    expect(s.records).toBe(1);
    expect(s.earlierTries).toEqual([{ file: 'fid-w6-r4-plaza-up-up-1440-sweep.try1.json', currentFile: 'fid-w6-r4-plaza-up-up-1440-sweep.json', status: 'fail', reasons: [] }]);
    expect(s.earlierTriesFailed).toBe(1);
  });

  it('counts a composite unmeasured on too few page frames as a re-shoot', () => {
    const r = classifyRecord('a-loader.json', { kind: 'loader-trace', analysis: { verdict: 'unmeasured', composite: { verdict: 'unmeasured' } } });
    expect(summarizeRound([r]).insufficientSamplingCount).toBe(1);
  });
});

describe('evidence tries (round 5: never only the passing retry)', () => {
  it('names, detects and numbers try files', () => {
    expect(tryPathFor('/e/a-sweep.json', 2)).toBe('/e/a-sweep.try2.json');
    expect(isTryFile('a-sweep.try12.json')).toBe(true);
    expect(isTryFile('a-sweep.json')).toBe(false);
    expect(nextTryIndex('/e/a-sweep.json', ['a-sweep.json', 'a-sweep.try1.json', 'a-sweep.try3.json', 'a-sweep-x.try9.json'])).toBe(4);
    expect(nextTryIndex('/e/b.json', [])).toBe(1);
  });

  it('keeps only non-passing priors', async () => {
    expect(recordPassed({ kind: 'sweep', pass: true })).toBe(true);
    expect(recordPassed({ kind: 'sweep', pass: false })).toBe(false);
    expect(recordPassed({ kind: 'loader-trace', analysis: { verdict: 'unmeasured' } })).toBe(false);
    expect(recordPassed({ section: 'roster', stationSettle: { ok: true }, particleCorridor: { verdict: 'fail' } })).toBe(false);
    expect(recordPassed({ section: 'roster', stationSettle: { ok: true } })).toBe(true);
    expect(recordPassed(null)).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'tries-'));
    try {
      const path = join(dir, 'fid-w6-r5-a-sweep.json');
      expect((await keepPriorTry(path)).kept).toBe(null);
      writeFileSync(path, JSON.stringify({ kind: 'sweep', pass: true }));
      expect((await keepPriorTry(path)).kept).toBe(null);
      writeFileSync(path, JSON.stringify({ kind: 'sweep', pass: false }));
      expect(await keepPriorTry(path)).toEqual({ kept: 'fid-w6-r5-a-sweep.try1.json', n: 1 });
      expect(await keepPriorTry(path)).toEqual({ kept: 'fid-w6-r5-a-sweep.try2.json', n: 2 });
      expect(readdirSync(dir).sort()).toEqual(['fid-w6-r5-a-sweep.json', 'fid-w6-r5-a-sweep.try1.json', 'fid-w6-r5-a-sweep.try2.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

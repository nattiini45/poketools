/**
 * LOOK r6 SEAT H6: the Chromium trace summary (top GPU / main-thread tasks
 * per ball phase, windows from the harness's capture:* user-timing marks).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  captureMarks,
  durationEvents,
  loadTraceFile,
  markWindows,
  presentCadence,
  productWindows,
  slimTraceEvent,
  streamTraceEvents,
  summarizeTrace,
  summaryLines,
  threadClass,
  traceEventsOf,
} from '../lib/trace-summary.mjs';

const us = (ms) => ms * 1000;
const meta = [
  { ph: 'M', name: 'process_name', pid: 1, args: { name: 'Renderer' } },
  { ph: 'M', name: 'process_name', pid: 2, args: { name: 'GPU Process' } },
  { ph: 'M', name: 'thread_name', pid: 1, tid: 11, args: { name: 'CrRendererMain' } },
  { ph: 'M', name: 'thread_name', pid: 2, tid: 21, args: { name: 'CrGpuMain' } },
  { ph: 'M', name: 'thread_name', pid: 2, tid: 22, args: { name: 'VizCompositorThread' } },
];
const mark = (name, ms) => ({ ph: 'R', cat: 'blink.user_timing', name, pid: 1, tid: 11, ts: us(1000 + ms) });
const task = (pid, tid, ms, dur, name = 'ThreadControllerImpl::RunTask') => ({ ph: 'X', cat: 'toplevel', name, pid, tid, ts: us(1000 + ms), dur: us(dur) });
const child = (pid, tid, ms, dur, name, args = null) => ({ ph: 'X', cat: 'gpu', name, pid, tid, ts: us(1000 + ms), dur: us(dur), ...(args ? { args } : {}) });

const events = [
  ...meta,
  mark('capture:init', 0),
  mark('capture:ball:hidden', 400),
  mark('capture:ball:loading', 600),
  mark('capture:scene:presented', 1400),
  mark('capture:ball:opening', 9700),
  mark('capture:ball:releasing', 10200),
  mark('capture:route-live', 10800),
  mark('capture:ball:done', 11000),
  // Loading before presented: a 317 ms renderer task (the post-ball stall) and a GPU compile.
  task(1, 11, 985, 317),
  child(1, 11, 990, 250, 'FunctionCall', { data: { url: 'https://x/_next/static/chunks/0dl.js', functionName: 'commitRoot' } }),
  task(2, 21, 1000, 120),
  child(2, 21, 1005, 110, 'D3D11 vertex executable'),
  // Loading after presented: two GPU links.
  task(2, 21, 2000, 60),
  child(2, 21, 2001, 55, 'ProgramCache::LoadProgram'),
  task(2, 21, 3000, 40),
  child(2, 21, 3001, 38, 'ProgramCache::LoadProgram'),
  // Opening: compositor frames.
  task(2, 22, 9800, 8),
  { ph: 'B', name: 'Graphics.Pipeline', pid: 2, tid: 22, ts: us(1000 + 9801) },
  { ph: 'E', name: 'Graphics.Pipeline', pid: 2, tid: 22, ts: us(1000 + 9806) },
];

describe('trace summary', () => {
  it('classifies threads and reads the event list', () => {
    expect(threadClass('GPU Process', 'CrGpuMain')).toBe('gpu-main');
    expect(threadClass('Renderer', 'CrRendererMain')).toBe('renderer-main');
    expect(threadClass('GPU Process', 'VizCompositorThread')).toBe('viz-compositor');
    expect(threadClass('Renderer', 'Compositor')).toBe('renderer-compositor');
    expect(traceEventsOf({ traceEvents: [1] })).toEqual([1]);
    expect(traceEventsOf([2])).toEqual([2]);
    expect(traceEventsOf(null)).toEqual([]);
  });
  it('cuts the ball-phase windows from the capture marks', () => {
    const marks = captureMarks(events);
    expect(marks.map((m) => m.name)).toContain('capture:ball:loading');
    const w = markWindows(marks, { startMs: 1000, endMs: 13000 });
    expect(w.map((x) => x.phase)).toEqual(['preBall', 'loading-before-presented', 'loading-after-presented', 'opening', 'releasing', 'after']);
    expect(w[1]).toMatchObject({ fromMs: 1600, toMs: 2400 });
  });
  it('pairs B/E events', () => {
    const d = durationEvents(events).find((e) => e.name === 'Graphics.Pipeline');
    expect(d.dur).toBeCloseTo(5, 5);
  });
  it('reports busy time, top names and the longest tasks with children per phase and thread', () => {
    const s = summarizeTrace(events, { top: 5, longTaskMs: 50 });
    expect(s.verdict).toBe('measured');
    expect(s.originMark).toBe('capture:init');
    const lb = s.byPhase['loading-before-presented'];
    expect(lb.fromMs).toBe(600);
    expect(lb.threads['renderer-main'].busyMs).toBe(317);
    expect(lb.threads['renderer-main'].longestTasks[0]).toMatchObject({ at: 985, ms: 317, children: [{ name: 'FunctionCall', ms: 250, detail: 'https://x/_next/static/chunks/0dl.js commitRoot' }] });
    expect(lb.threads['gpu-main'].topNames[0]).toMatchObject({ name: 'D3D11 vertex executable', totalMs: 110 });
    const la = s.byPhase['loading-after-presented'];
    expect(la.threads['gpu-main'].topNames[0]).toMatchObject({ name: 'ProgramCache::LoadProgram', count: 2, totalMs: 93, maxMs: 55 });
    expect(la.threads['gpu-main'].longestTasks.map((t) => t.ms)).toEqual([60]);
    expect(s.byPhase.opening.threads['viz-compositor'].busyMs).toBe(8);
    const lines = summaryLines(s);
    expect(lines.some((l) => l.includes('[loading-before-presented]'))).toBe(true);
    expect(lines.some((l) => l.includes('renderer-main busy 317 ms'))).toBe(true);
  });
  it('ENGINE-A4: times the swap chain per phase (what reached the display)', () => {
    const presents = [0, 16.7, 33.4, 200, 216.7].map((ms) => ({ ph: 'X', name: 'DXGISwapChainImageBacking::Present', pid: 2, tid: 21, ts: us(1000 + 2500 + ms), dur: 300 }));
    const p = presentCadence(presents, [{ phase: 'x', fromMs: 3400, toMs: 3800 }], 1000);
    expect(p).toMatchObject({ verdict: 'measured', source: 'DXGISwapChainImageBacking::Present' });
    expect(p.byPhase.x).toMatchObject({ frames: 5, maxMs: 166.6 });
    expect(p.byPhase.x.gaps).toEqual([{ at: 2533.4, ms: 166.6 }]);
    expect(p.filing).toBe('start');
    expect(presentCadence([], [], 0).verdict).toBe('unmeasured');
    expect(summarizeTrace([...events, ...presents]).presentCadence.verdict).toBe('measured');
  });
  it('ENGINE-A5: files a Present gap under the phase of its START stamp', () => {
    // Presents at 100, 116.7, then 300 (a 183.3 ms gap that STARTS at 116.7 in window a and ENDS at 300 in b), 316.7.
    const presents = [100, 116.7, 300, 316.7].map((ms) => ({ ph: 'X', name: 'DXGISwapChainImageBacking::Present', pid: 2, tid: 21, ts: us(ms), dur: 300 }));
    const p = presentCadence(presents, [{ phase: 'a', fromMs: 0, toMs: 200 }, { phase: 'b', fromMs: 200, toMs: 400 }], 0);
    expect(p.byPhase.a.gaps).toEqual([{ at: 116.7, ms: 183.3 }]);
    expect(p.byPhase.a.maxMs).toBe(183.3);
    expect(p.byPhase.b.gaps).toEqual([]);
    expect(p.byPhase.b.maxMs).toBe(16.7);
    // frames still count the Presents inside each window
    expect([p.byPhase.a.frames, p.byPhase.b.frames]).toEqual([2, 2]);
  });
  it('ENGINE-A5: cuts the windows from the product ballTrace, offset by the opening / releasing / done marks', () => {
    const marks = captureMarks(events);
    // page ms = trace-rel ms + 250; the product's loading ran 70 ms before its (lagging) harness mark.
    const readiness = {
      ballTrace: [
        { phase: 'hidden', t: 650 },
        { phase: 'loading', t: 780 },
        { phase: 'opening', t: 9950 },
        { phase: 'releasing', t: 10450 },
        { phase: 'done', t: 11250 },
      ],
      phaseTrace: [{ phase: 'presented', t: 1640 }],
    };
    const r = productWindows(marks, readiness, { startMs: 1000, endMs: 13000, originMs: 1000 });
    expect(r.timeBase).toMatchObject({ offsetMs: 250, offsetSpreadMs: 0, offsetPhases: 3, loadingMarkLagMs: 70 });
    expect(r.windows.map((w) => [w.phase, w.fromMs])).toEqual([
      ['preBall', 1000],
      ['loading-before-presented', 1530],
      ['loading-after-presented', 2390],
      ['opening', 10700],
      ['releasing', 11200],
      ['after', 12000],
    ]);
    const s = summarizeTrace(events, { readiness });
    expect(s.timeBase.offsetMs).toBe(250);
    expect(s.windows[1]).toEqual({ phase: 'loading-before-presented', fromMs: 530, toMs: 1390 });
    // no ballTrace, or no offset mark: the harness marks cut the windows (pre-A5)
    expect(productWindows(marks, null, { startMs: 1000, endMs: 13000, originMs: 1000 })).toBeNull();
    expect(productWindows(marks, { ballTrace: [{ phase: 'loading', t: 5 }] }, { startMs: 1000, endMs: 13000, originMs: 1000 })).toBeNull();
    expect(summarizeTrace(events).timeBase.offsetMs).toBeNull();
  });
  it('is unmeasured without timed events', () => {
    expect(summarizeTrace(meta).verdict).toBe('unmeasured');
    expect(summaryLines({ verdict: 'unmeasured', reason: 'x' })[0]).toMatch(/unmeasured/);
  });
});

describe("streamed trace reading (ENGINE-A5 fix: traces past V8's string limit)", () => {
  const tricky = [
    ...meta,
    { ph: 'X', cat: 'toplevel', name: 'ThreadControllerImpl::RunTask', pid: 1, tid: 11, ts: us(1010), dur: us(60), args: { src_file: 'a{b}[c]"q"\\.cc', src_func: 'Run', data: { url: 'https://x/é🙂?a=[1]', startTime: 3, blob: { deep: [[{}], '}'] } } } },
    { ph: 'X', cat: 'gpu', name: 'DXGISwapChainImageBacking::Present', pid: 2, tid: 21, ts: us(1020), dur: us(1) },
    { ph: 'X', cat: 'gpu', name: 'DXGISwapChainImageBacking::Present', pid: 2, tid: 21, ts: us(1037), dur: us(1) },
    mark('capture:init', 0),
    { ph: 'B', name: 'weird \\"}{][', pid: 1, tid: 11, ts: us(1040), args: {} },
    { ph: 'E', name: 'weird \\"}{][', pid: 1, tid: 11, ts: us(1045) },
  ];
  const withTmp = async (text, fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'trace-stream-'));
    try {
      const path = join(dir, 'trace.json');
      writeFileSync(path, text, 'utf8');
      return await fn(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('cuts every event out of a Chrome trace object (one event per line, trailing metadata) the same as JSON.parse, across any chunk boundary', async () => {
    const text = `{"traceEvents":[\n${tricky.map((e) => JSON.stringify(e)).join(',\n')}],\n"metadata":{"a":[1,{"traceEvents":[{"x":1}]}],"s":"]}"}}`;
    const expected = traceEventsOf(JSON.parse(text)).map(slimTraceEvent);
    for (const highWaterMark of [1, 3, 7, 64, 1 << 20]) {
      const got = await withTmp(text, (path) => streamTraceEvents(path, { highWaterMark }));
      expect(got).toEqual(expected);
    }
  });

  it('reads a bare-array trace too, and the streamed summary equals the whole-file summary', async () => {
    const text = JSON.stringify(tricky);
    await withTmp(text, async (path) => {
      const streamed = await loadTraceFile(path, { streamAboveBytes: 0, highWaterMark: 5 });
      const whole = await loadTraceFile(path);
      expect(streamed).toEqual(whole.map(slimTraceEvent));
      expect(summarizeTrace(streamed)).toEqual(summarizeTrace(whole));
    });
  });

  it('keeps only the fields the summary reads', () => {
    const e = { ph: 'X', name: 'n', cat: 'c', pid: 1, tid: 2, ts: 3, dur: 4, id: 'x', args: { name: 'm', src_file: 'f', src_func: 'g', huge: 'x'.repeat(1000), data: { url: 'u', functionName: 'fn', frame: 'F', startTime: 5, stack: [1, 2] } } };
    expect(slimTraceEvent(e)).toEqual({ ph: 'X', name: 'n', cat: 'c', pid: 1, tid: 2, ts: 3, dur: 4, args: { name: 'm', src_file: 'f', src_func: 'g', data: { url: 'u', functionName: 'fn', frame: 'F', startTime: 5 } } });
  });
});

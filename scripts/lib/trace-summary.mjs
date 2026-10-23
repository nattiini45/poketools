#!/usr/bin/env node
/**
 * LOOK pilot round 6 (D28), SEAT H6: summarise a Chromium performance trace
 * (the capture-route --gpu-trace leg) into the top GPU / main-thread tasks
 * per ball phase, so ENGINE can attribute the post-ball stall (E3) and the
 * sakura / clouds gaps (E6) without opening the trace by hand.
 *
 *   node scripts/lib/trace-summary.mjs <trace.json> [--top 10] [--long-task-ms 50] [--json <out.json>]
 *
 * Phase windows: preBall, loading-before-presented, loading-after-presented,
 * opening, releasing, after. ENGINE-A5 (D39 follow-up): when the loader
 * trace's `readiness` is passed (the product's own `ballTrace` / `phaseTrace`
 * in page ms), the windows come from the PRODUCT's phase times, mapped into
 * trace time by the offset the `capture:ball:opening|releasing|done` marks
 * measure (`productWindows`). The `capture:ball:loading` mark is not used: it
 * lags the product's phase change by up to ~100 ms when the main thread is
 * busy right after it. Without readiness the harness marks cut the windows
 * (`markWindows`, the pre-A5 source). Times are ms since `capture:init`
 * (about navigation start).
 *
 *   node scripts/lib/trace-summary.mjs <trace.json> [--loader <loader.json>] ...
 * Per window and per thread (GPU main, renderer main, compositor, raster,
 * the viz compositor thread, others): busy time (top-level tasks, clipped to
 * the window), the event names with the most total time, and the longest
 * tasks with their longest child events. Pure functions are exported for
 * scripts/__tests__/trace-summary.test.mjs.
 * Exit 0 = summarised, 2 = usage / unreadable trace.
 */
import { createReadStream } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Top-level task names (one per scheduled task on a thread). */
const TOP_LEVEL_NAMES = new Set(['ThreadControllerImpl::RunTask', 'RunTask', 'TaskQueueManager::ProcessTaskFromWorkQueue', 'ThreadPool_RunTask']);

/** Thread classes by Chromium thread name. */
export function threadClass(processName, threadName) {
  const p = String(processName ?? '');
  const t = String(threadName ?? '');
  if (/GPU/i.test(p) && /CrGpuMain/i.test(t)) return 'gpu-main';
  if (/VizCompositor/i.test(t)) return 'viz-compositor';
  if (/Renderer/i.test(p) && /CrRendererMain/i.test(t)) return 'renderer-main';
  if (/Compositor$/i.test(t) || /^Compositor/i.test(t)) return 'renderer-compositor';
  if (/CompositorTileWorker|Raster/i.test(t)) return 'raster';
  if (/GPU/i.test(p)) return 'gpu-other';
  if (/Browser/i.test(p) && /CrBrowserMain/i.test(t)) return 'browser-main';
  return 'other';
}

/** The trace's event list from a parsed trace file (object or bare array). */
export function traceEventsOf(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.traceEvents)) return parsed.traceEvents;
  return [];
}

/**
 * Harness marks (name starts with `capture:`), deduplicated by name (the
 * first occurrence wins), in trace time (ms).
 */
export function captureMarks(events) {
  const out = new Map();
  for (const e of events) {
    if (!e || typeof e.name !== 'string' || !e.name.startsWith('capture:') || typeof e.ts !== 'number') continue;
    if (!out.has(e.name)) out.set(e.name, e.ts / 1000);
  }
  return [...out.entries()].map(([name, ms]) => ({ name, ms })).sort((a, b) => a.ms - b.ms);
}

/**
 * Ball-phase windows in trace ms from the marks: preBall (trace start ->
 * ball loading), loading-before-presented, loading-after-presented (split at
 * scene presented when marked), opening, releasing, after (ball done or
 * aborted -> trace end). Missing marks collapse their window.
 */
export function markWindows(marks, { startMs, endMs }) {
  const at = (name) => marks.find((m) => m.name === name)?.ms ?? null;
  const loading = at('capture:ball:loading');
  const presented = at('capture:scene:presented');
  const opening = at('capture:ball:opening');
  const releasing = at('capture:ball:releasing');
  const end = at('capture:ball:done') ?? at('capture:ball:aborted');
  const cuts = [['preBall', startMs]];
  if (loading !== null) cuts.push(['loading-before-presented', loading]);
  if (presented !== null && (loading === null || presented > loading)) cuts.push(['loading-after-presented', presented]);
  if (opening !== null) cuts.push(['opening', opening]);
  if (releasing !== null) cuts.push(['releasing', releasing]);
  if (end !== null) cuts.push(['after', end]);
  cuts.sort((a, b) => a[1] - b[1]);
  return cuts.map(([phase, from], i) => ({ phase, fromMs: from, toMs: i + 1 < cuts.length ? cuts[i + 1][1] : endMs })).filter((w) => w.toMs > w.fromMs);
}

/** The ball phases whose harness marks time-align page and trace clocks (not `loading`, which lags). */
export const OFFSET_PHASES = ['opening', 'releasing', 'done'];

/**
 * ENGINE-A5: phase windows in trace ms from the PRODUCT's phase times.
 *
 * `readiness` is the loader trace's `__routeWorldReadiness()` record: its
 * `ballTrace` ([{phase, t}], page `performance.now()` ms; the last entry per
 * phase wins) and `phaseTrace` (the scene's `presented`, else
 * `milestones.at.firstFrame`). The page-to-trace offset is measured on every
 * phase that has both a product time and its `capture:ball:<phase>` mark
 * (OFFSET_PHASES; median, with the spread reported), and `loadingMarkLagMs` is
 * how late the harness's loading mark ran. Null when no offset phase pairs.
 */
export function productWindows(marks, readiness, { startMs, endMs, originMs }) {
  const trace = Array.isArray(readiness?.ballTrace) ? readiness.ballTrace : [];
  if (!trace.length) return null;
  const ball = Object.fromEntries(trace.filter((b) => b && typeof b.t === 'number').map((b) => [b.phase, b.t]));
  const markAt = (name) => marks.find((m) => m.name === name)?.ms ?? null;
  const pairs = OFFSET_PHASES.filter((p) => ball[p] != null && markAt(`capture:ball:${p}`) !== null).map((p) => ball[p] - (markAt(`capture:ball:${p}`) - originMs));
  if (!pairs.length) return null;
  const sorted = [...pairs].sort((a, b) => a - b);
  const offsetMs = sorted[Math.floor(sorted.length / 2)];
  const toTrace = (pageMs) => pageMs - offsetMs + originMs;
  const presentedPage =
    (Array.isArray(readiness?.phaseTrace) ? readiness.phaseTrace.find((p) => p && p.phase === 'presented')?.t : null) ??
    readiness?.milestones?.at?.firstFrame ??
    null;
  const end = ball.done ?? ball.aborted ?? null;
  const cuts = [['preBall', startMs]];
  if (ball.loading != null) cuts.push(['loading-before-presented', toTrace(ball.loading)]);
  if (typeof presentedPage === 'number' && (ball.loading == null || presentedPage > ball.loading)) cuts.push(['loading-after-presented', toTrace(presentedPage)]);
  if (ball.opening != null) cuts.push(['opening', toTrace(ball.opening)]);
  if (ball.releasing != null) cuts.push(['releasing', toTrace(ball.releasing)]);
  if (end !== null) cuts.push(['after', toTrace(end)]);
  cuts.sort((a, b) => a[1] - b[1]);
  const windows = cuts.map(([phase, from], i) => ({ phase, fromMs: from, toMs: i + 1 < cuts.length ? cuts[i + 1][1] : endMs })).filter((w) => w.toMs > w.fromMs);
  const loadingMark = markAt('capture:ball:loading');
  return {
    windows,
    timeBase: {
      source: 'product ballTrace + offset from the capture:ball:opening|releasing|done marks',
      offsetMs: +offsetMs.toFixed(1),
      offsetSpreadMs: +(sorted[sorted.length - 1] - sorted[0]).toFixed(1),
      offsetPhases: pairs.length,
      loadingMarkLagMs: ball.loading != null && loadingMark !== null ? +(offsetMs - (ball.loading - (loadingMark - originMs))).toFixed(1) : null,
    },
  };
}

/** Complete-duration events ('X', and paired 'B'/'E' per thread), in ms. */
export function durationEvents(events) {
  const out = [];
  const open = new Map();
  for (const e of events) {
    if (!e || typeof e.ts !== 'number') continue;
    if (e.ph === 'X' && typeof e.dur === 'number') out.push({ name: e.name, cat: e.cat ?? '', pid: e.pid, tid: e.tid, start: e.ts / 1000, dur: e.dur / 1000, args: e.args ?? null });
    else if (e.ph === 'B') {
      const k = `${e.pid}:${e.tid}`;
      const stack = open.get(k) ?? [];
      stack.push(e);
      open.set(k, stack);
    } else if (e.ph === 'E') {
      const k = `${e.pid}:${e.tid}`;
      const stack = open.get(k);
      const b = stack && stack.pop();
      if (b) out.push({ name: b.name, cat: b.cat ?? '', pid: b.pid, tid: b.tid, start: b.ts / 1000, dur: (e.ts - b.ts) / 1000, args: b.args ?? null });
    }
  }
  return out;
}

function argSummary(args) {
  if (!args || typeof args !== 'object') return null;
  const src = args.src_file ?? args.data?.url ?? args.data?.functionName ?? args.data?.frame ?? null;
  const fn = args.src_func ?? args.data?.functionName ?? null;
  const s = [src, fn].filter(Boolean).join(' ');
  return s ? String(s).slice(0, 160) : null;
}

/**
 * The summary: processes / threads, the marks (ms since capture:init),
 * the windows and, per window and thread class, busy ms, the event names
 * with the most time and the longest top-level tasks (with their three
 * longest child events).
 */
export function summarizeTrace(events, { top = 10, longTaskMs = 50, readiness = null } = {}) {
  const list = Array.isArray(events) ? events : [];
  const procNames = new Map();
  const threadNames = new Map();
  for (const e of list) {
    if (!e || e.ph !== 'M') continue;
    if (e.name === 'process_name') procNames.set(e.pid, e.args?.name ?? null);
    if (e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args?.name ?? null);
  }
  const timed = list.filter((e) => e && typeof e.ts === 'number' && e.ts > 0 && e.ph !== 'M');
  if (!timed.length) return { verdict: 'unmeasured', reason: 'no timed events in the trace' };
  let traceStart = Infinity;
  let traceEnd = -Infinity;
  for (const e of timed) {
    const s = e.ts / 1000;
    const end = s + (typeof e.dur === 'number' ? e.dur / 1000 : 0);
    if (s < traceStart) traceStart = s;
    if (end > traceEnd) traceEnd = end;
  }
  const marks = captureMarks(timed);
  const origin = marks.find((m) => m.name === 'capture:init')?.ms ?? traceStart;
  const product = productWindows(marks, readiness, { startMs: traceStart, endMs: traceEnd, originMs: origin });
  const windows = product?.windows ?? markWindows(marks, { startMs: traceStart, endMs: traceEnd });
  const timeBase = product?.timeBase ?? { source: 'capture:* marks (no product ballTrace)', offsetMs: null, offsetSpreadMs: null, offsetPhases: 0, loadingMarkLagMs: null };
  const dur = durationEvents(timed);
  const classOf = (e) => threadClass(procNames.get(e.pid), threadNames.get(`${e.pid}:${e.tid}`));
  const rel = (ms) => +(ms - origin).toFixed(1);
  const byThread = new Map();
  for (const e of dur) {
    const k = `${e.pid}:${e.tid}`;
    const arr = byThread.get(k) ?? [];
    arr.push(e);
    byThread.set(k, arr);
  }
  for (const arr of byThread.values()) arr.sort((a, b) => a.start - b.start);
  const out = {};
  for (const w of windows) {
    const perClass = {};
    for (const [k, arr] of byThread) {
      const cls = classOf(arr[0]);
      const bucket = (perClass[cls] ??= { threads: new Set(), busyMs: 0, names: new Map(), longest: [] });
      bucket.threads.add(k);
      for (const e of arr) {
        if (e.start < w.fromMs || e.start >= w.toMs) continue;
        const n = bucket.names.get(e.name) ?? { name: e.name, count: 0, totalMs: 0, maxMs: 0 };
        n.count += 1;
        n.totalMs += e.dur;
        if (e.dur > n.maxMs) n.maxMs = e.dur;
        bucket.names.set(e.name, n);
        const topLevel = TOP_LEVEL_NAMES.has(e.name) || String(e.cat).split(',').includes('toplevel');
        if (topLevel) {
          bucket.busyMs += Math.max(0, Math.min(e.start + e.dur, w.toMs) - e.start);
          if (e.dur >= longTaskMs) {
            const children = arr
              .filter((c) => c !== e && c.start >= e.start && c.start + c.dur <= e.start + e.dur + 1e-3 && !TOP_LEVEL_NAMES.has(c.name))
              .sort((a, b) => b.dur - a.dur)
              .slice(0, 3)
              .map((c) => ({ name: c.name, ms: +c.dur.toFixed(1), detail: argSummary(c.args) }));
            bucket.longest.push({ at: rel(e.start), ms: +e.dur.toFixed(1), name: e.name, detail: argSummary(e.args), children });
          }
        }
      }
    }
    out[w.phase] = {
      fromMs: rel(w.fromMs),
      toMs: rel(w.toMs),
      spanMs: +(w.toMs - w.fromMs).toFixed(1),
      threads: Object.fromEntries(
        Object.entries(perClass)
          .map(([cls, b]) => [
            cls,
            {
              threads: b.threads.size,
              busyMs: +b.busyMs.toFixed(1),
              topNames: [...b.names.values()]
                .filter((n) => !TOP_LEVEL_NAMES.has(n.name))
                .sort((x, y) => y.totalMs - x.totalMs)
                .slice(0, top)
                .map((n) => ({ name: n.name, count: n.count, totalMs: +n.totalMs.toFixed(1), maxMs: +n.maxMs.toFixed(1) })),
              longestTasks: b.longest.sort((x, y) => y.ms - x.ms).slice(0, top),
            },
          ])
          .filter(([, v]) => v.busyMs > 0 || v.topNames.length > 0),
      ),
    };
  }
  return {
    verdict: 'measured',
    events: list.length,
    processes: Object.fromEntries([...procNames.entries()].map(([pid, name]) => [String(pid), name])),
    originMark: marks.some((m) => m.name === 'capture:init') ? 'capture:init' : 'trace start (no capture:init mark)',
    marks: marks.map((m) => ({ name: m.name, atMs: rel(m.ms) })),
    windows: windows.map((w) => ({ phase: w.phase, fromMs: rel(w.fromMs), toMs: rel(w.toMs) })),
    timeBase,
    byPhase: out,
    presentCadence: presentCadence(timed, windows, origin),
    notes: [
      `times are ms since the harness mark capture:init (the init script, about navigation start); windows: ${timeBase.source}`,
      'presentCadence files each Present interval under the phase of its START stamp (`at`): the frame the eye sees held; frames / fps count the Presents inside the window',
      `busyMs = top-level task time (RunTask / toplevel category) starting in the window, clipped to it; longestTasks = top-level tasks >= ${longTaskMs} ms with their three longest child events`,
      'thread classes: gpu-main (GPU process CrGpuMain: ANGLE / D3D11 compiles and uploads), renderer-main (CrRendererMain: JS, style, layout, WebGL command encode), renderer-compositor, raster, viz-compositor, browser-main, other',
    ],
  };
}

/**
 * ENGINE-A4: the swap chain's own cadence — what reached the display. The
 * harness's compositor cadence is timed from CDP screencast frames, whose
 * CopyOutput requests queue on CrGpuMain behind WebGL command execution; a
 * busy GPU main thread delays or drops a CAPTURE without delaying the present
 * (plaza probe: screencast max gap 284 ms, Present max 66 ms, same window).
 * Present events per phase window: frames, fps, interval p50 / p95 / max and
 * the gaps >= `gapMs`. ENGINE-A5: an interval belongs to the window its START
 * stamp (the Present the display then held; `at`) falls in, not its end, so a
 * gap that began before the ball appeared is never charged to the ball.
 * Source: DXGISwapChainImageBacking::Present, else
 * SkiaOutputSurfaceImplOnGpu::SwapBuffers, else Display::DrawAndSwap.
 */
export const PRESENT_EVENT_NAMES = ['DXGISwapChainImageBacking::Present', 'SkiaOutputSurfaceImplOnGpu::SwapBuffers', 'Display::DrawAndSwap'];

export function presentCadence(events, windows, originMs, { gapMs = 100 } = {}) {
  const list = Array.isArray(events) ? events : [];
  let source = null;
  let stamps = [];
  for (const name of PRESENT_EVENT_NAMES) {
    stamps = list.filter((e) => e && e.name === name && (e.ph === 'X' || e.ph === 'B') && typeof e.ts === 'number').map((e) => e.ts / 1000);
    if (stamps.length > 1) {
      source = name;
      break;
    }
  }
  if (source === null) return { verdict: 'unmeasured', reason: 'no present / swap events (needs the gpu or viz category)' };
  stamps.sort((a, b) => a - b);
  const rel = (ms) => +(ms - originMs).toFixed(1);
  const byPhase = {};
  for (const w of windows) {
    const intervals = [];
    const gaps = [];
    let frames = 0;
    for (let i = 0; i < stamps.length; i += 1) {
      const inside = stamps[i] >= w.fromMs && stamps[i] < w.toMs;
      if (inside) frames += 1;
      // The interval that STARTS here (ends at the next Present).
      if (!inside || i + 1 >= stamps.length) continue;
      const d = stamps[i + 1] - stamps[i];
      intervals.push(d);
      if (d >= gapMs) gaps.push({ at: rel(stamps[i]), ms: +d.toFixed(1) });
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const q = (p) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1) : null);
    const span = w.toMs - w.fromMs;
    byPhase[w.phase] = {
      frames,
      fps: span > 0 ? +((frames / span) * 1000).toFixed(1) : null,
      p50Ms: q(0.5),
      p95Ms: q(0.95),
      maxMs: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
      gaps: gaps.slice(0, 20),
    };
  }
  return { verdict: 'measured', source, gapMs, filing: 'start', byPhase };
}

/**
 * ENGINE-A5 fix (verify-a5 harness item): traces above this size are stream-
 * parsed. A whole-file `readFile` + `JSON.parse` fails with "Invalid string
 * length" past V8's ~512 MB string limit (verify-a5-car-clouds-5: 737 MB),
 * which left a long run's summary silently 'unmeasured'.
 */
export const TRACE_STREAM_ABOVE_BYTES = 256 * 1024 * 1024;

/**
 * An event reduced to the fields the summary reads (the streaming path keeps
 * a 700 MB trace's events in a bounded heap): name, cat, ph, pid, tid, ts,
 * dur, and from args only the metadata name and the fields `argSummary` reads.
 */
export function slimTraceEvent(e) {
  if (!e || typeof e !== 'object') return e;
  const out = { name: e.name, cat: e.cat, ph: e.ph, pid: e.pid, tid: e.tid, ts: e.ts };
  if (e.dur !== undefined) out.dur = e.dur;
  const a = e.args;
  if (a && typeof a === 'object') {
    const args = {};
    if (a.name !== undefined) args.name = a.name;
    if (a.src_file !== undefined) args.src_file = a.src_file;
    if (a.src_func !== undefined) args.src_func = a.src_func;
    if (a.data && typeof a.data === 'object') {
      const data = {};
      for (const k of ['url', 'functionName', 'frame', 'startTime']) if (a.data[k] !== undefined) data[k] = a.data[k];
      if (Object.keys(data).length) args.data = data;
    }
    out.args = args;
  }
  return out;
}

/**
 * Stream-parse a trace file's events (pure scanner over the text: the
 * `traceEvents` array of a trace object, or a bare top-level array). Each
 * event object is cut out by brace depth outside strings, parsed on its own
 * and slimmed (`slimTraceEvent`), so no single string ever holds the file.
 */
export async function streamTraceEvents(path, { highWaterMark = 8 * 1024 * 1024 } = {}) {
  const events = [];
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark });
  let depth = 0;
  let inString = false;
  let escape = false;
  let top = null; // 'array' | 'object'
  let eventsDepth = -1; // depth inside the events array (an element opens at eventsDepth -> eventsDepth + 1)
  let done = false;
  let lastKey = null;
  let keyParts = null;
  let keyStart = 0;
  let elParts = null;
  let elStart = 0;
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i += 1) {
      const c = chunk.charCodeAt(i);
      if (inString) {
        if (escape) escape = false;
        else if (c === 92) escape = true;
        else if (c === 34) {
          inString = false;
          if (keyParts !== null) {
            keyParts.push(chunk.slice(keyStart, i));
            lastKey = keyParts.join('');
            keyParts = null;
          }
        }
        continue;
      }
      if (c === 34) {
        inString = true;
        if (depth === 1 && top === 'object' && elParts === null) {
          keyParts = [];
          keyStart = i + 1;
        }
      } else if (c === 123 || c === 91) {
        if (depth === 0) {
          top = c === 91 ? 'array' : 'object';
          if (c === 91) eventsDepth = 1;
        } else if (c === 91 && depth === 1 && top === 'object' && eventsDepth < 0 && lastKey === 'traceEvents') {
          eventsDepth = 2;
        }
        depth += 1;
        if (!done && c === 123 && eventsDepth > 0 && depth === eventsDepth + 1 && elParts === null) {
          elParts = [];
          elStart = i;
        }
      } else if (c === 125 || c === 93) {
        depth -= 1;
        if (elParts !== null && depth === eventsDepth) {
          elParts.push(chunk.slice(elStart, i + 1));
          events.push(slimTraceEvent(JSON.parse(elParts.join(''))));
          elParts = null;
        } else if (!done && eventsDepth > 0 && c === 93 && depth === eventsDepth - 1) {
          done = true;
        }
      }
    }
    if (elParts !== null) {
      elParts.push(chunk.slice(elStart));
      elStart = 0;
    }
    if (keyParts !== null) {
      keyParts.push(chunk.slice(keyStart));
      keyStart = 0;
    }
  }
  return events;
}

/**
 * Read and parse a trace file (JSON object with traceEvents, or a bare
 * array): whole-file up to `streamAboveBytes`, stream-parsed above it.
 */
export async function loadTraceFile(path, { streamAboveBytes = TRACE_STREAM_ABOVE_BYTES, highWaterMark } = {}) {
  // Size and whole-file read go through one handle, so the size check covers the bytes read.
  const fh = await open(path, 'r');
  let raw;
  try {
    const { size } = await fh.stat();
    if (size > streamAboveBytes) return await streamTraceEvents(path, highWaterMark ? { highWaterMark } : {});
    raw = await fh.readFile('utf8');
  } finally {
    await fh.close();
  }
  return traceEventsOf(JSON.parse(raw));
}

/** One printable line per phase / thread class (the CLI output). */
export function summaryLines(summary, { top = 3 } = {}) {
  if (!summary || summary.verdict !== 'measured') return [`trace-summary: unmeasured (${summary?.reason ?? 'n/a'})`];
  const lines = [`trace-summary: ${summary.events} events; marks ${summary.marks.map((m) => `${m.name.replace('capture:', '')}@${m.atMs}`).join(' ')}`];
  for (const [phase, w] of Object.entries(summary.byPhase)) {
    lines.push(`trace-summary: [${phase}] ${w.fromMs}..${w.toMs} ms (${w.spanMs} ms)`);
    const present = summary.presentCadence?.byPhase?.[phase];
    if (present) {
      const gaps = present.gaps.map((g) => `${g.ms}@${g.at}`).join(' ');
      lines.push(`trace-summary:   present ${present.frames} frames ${present.fps} fps; interval p50 ${present.p50Ms} p95 ${present.p95Ms} max ${present.maxMs} ms${gaps ? `; gaps ${gaps}` : ''}`);
    }
    for (const cls of ['gpu-main', 'renderer-main', 'viz-compositor', 'renderer-compositor', 'raster']) {
      const t = w.threads[cls];
      if (!t) continue;
      const names = t.topNames.slice(0, top).map((n) => `${n.name} ${n.totalMs}ms/${n.count}x max${n.maxMs}`).join(' | ');
      const longest = t.longestTasks.slice(0, 2).map((l) => `${l.ms}ms@${l.at}${l.children.length ? `(${l.children.map((c) => `${c.name} ${c.ms}`).join(', ')})` : ''}`).join(' ; ');
      lines.push(`trace-summary:   ${cls} busy ${t.busyMs} ms; top: ${names || 'none'}${longest ? `; longest: ${longest}` : ''}`);
    }
  }
  return lines;
}

async function main(argv) {
  const positional = [];
  let top = 10;
  let longTaskMs = 50;
  let jsonOut = null;
  let loaderPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--top') top = Number(argv[++i]);
    else if (argv[i] === '--loader') loaderPath = argv[++i];
    else if (argv[i] === '--long-task-ms') longTaskMs = Number(argv[++i]);
    else if (argv[i] === '--json') jsonOut = argv[++i];
    else positional.push(argv[i]);
  }
  if (positional.length !== 1 || !(top > 0) || !(longTaskMs > 0)) {
    console.error('usage: node scripts/lib/trace-summary.mjs <trace.json> [--loader <loader.json>] [--top 10] [--long-task-ms 50] [--json <out.json>]');
    return 2;
  }
  let events;
  let readiness = null;
  try {
    events = await loadTraceFile(resolve(positional[0]));
    if (loaderPath) readiness = JSON.parse(await readFile(resolve(loaderPath), 'utf8')).readiness ?? null;
  } catch (err) {
    console.error(`trace-summary: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const summary = summarizeTrace(events, { top, longTaskMs, readiness });
  for (const line of summaryLines(summary)) console.log(line);
  if (jsonOut) await writeFile(resolve(jsonOut), `${JSON.stringify({ trace: positional[0], ...summary }, null, 2)}\n`, 'utf8');
  return summary.verdict === 'measured' ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

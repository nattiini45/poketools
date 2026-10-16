/**
 * Load-time paint queue (ENGINE r3, D23 "the ceremony stays smooth").
 *
 * The worlds paint their canvas faces (desk screens, gate plaques, board
 * pages, content walls) in mount effects: 2D draws, then a PNG encode for
 * the loader upload. One commit mounts many of them, and React flushes a
 * commit's passive effects in ONE task, so the plaza's faces summed to a
 * 0.3 s main-thread block under the ball (CAR r2). The queue runs each
 * queued paint in its OWN task, in submission order, so no two paints share
 * a task and the browser gets a rendering opportunity between them.
 *
 * Pixels are unchanged: the same paint runs with the same inputs, only
 * later. The load warm counts a non-empty queue as incomplete content
 * (`paintQueueIdle`), so a queued paint can never land after the reveal.
 */

/**
 * A job may return a continuation (ENGINE-A4): the rest of its work (a
 * function; any other return value is ignored), run as
 * the NEXT job (ahead of everything queued after it) in its own task. A paint
 * that is heavier than one frame splits itself this way, so a single drain
 * stays under a frame's budget (A3 LoAF: `drainOne` held 130-160 ms over
 * three frames, one 57 ms job).
 */
export type PaintJob = () => unknown;

type Job = { run: PaintJob; cancelled: boolean };

const queue: Job[] = [];
let scheduled = false;
let completed = 0;
const listeners = new Set<() => void>();
/** ENGINE-A4 (evidence): the longest single drain so far and how many exceeded a frame. */
const stats = { drains: 0, maxMs: 0, overFrame: 0 };
/** One frame at 60 Hz: a drain longer than this is a dropped frame on its own. */
export const PAINT_DRAIN_FRAME_MS = 16;

let channel: MessageChannel | null = null;

// ── ENGINE-A5 (routeDebug): document.fonts at every face paint ─────────────

/**
 * The font every canvas data face paints with. No face painter uses a web
 * font (engine-a5.test.ts pins that): the stack is system-only, so a paint
 * never races a font download. The readout below proves it per paint.
 */
export const FACE_PAINT_FONT_PROBE = "800 30px system-ui, 'Segoe UI', sans-serif";

/** One drained face paint's font state (routeDebug only). */
export interface FacePaintFontRecord {
  /** Drain ordinal (1-based). */
  n: number;
  /** `performance.now()` at the paint. */
  t: number;
  /** `document.fonts.status` at the paint ('loading' | 'loaded'; null without the API). */
  status: string | null;
  /** `document.fonts.check(FACE_PAINT_FONT_PROBE)`: the face font is usable now. */
  faceFontReady: boolean | null;
  /** The document's web fonts by status at the paint (the page's DOM fonts; no face uses them). */
  webFonts: { loaded: number; loading: number; unloaded: number; error: number } | null;
}

const FONT_LOG_MAX = 256;
const fontLog: FacePaintFontRecord[] = [];
let fontLogOn: boolean | null = null;

function fontLogEnabled(): boolean {
  if (fontLogOn !== null) return fontLogOn;
  fontLogOn = false;
  try {
    fontLogOn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('routeDebug') === '1';
  } catch {
    fontLogOn = false;
  }
  return fontLogOn;
}

function noteFacePaintFonts(n: number): void {
  if (!fontLogEnabled()) return;
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  let webFonts: FacePaintFontRecord['webFonts'] = null;
  let faceFontReady: boolean | null = null;
  if (fonts) {
    webFonts = { loaded: 0, loading: 0, unloaded: 0, error: 0 };
    try {
      fonts.forEach((face) => {
        const key = face.status as keyof NonNullable<FacePaintFontRecord['webFonts']>;
        if (webFonts && key in webFonts) webFonts[key] += 1;
      });
      faceFontReady = fonts.check(FACE_PAINT_FONT_PROBE);
    } catch {
      faceFontReady = null;
    }
  }
  fontLog.push({ n, t: Math.round(performance.now()), status: fonts ? fonts.status : null, faceFontReady, webFonts });
  if (fontLog.length > FONT_LOG_MAX) fontLog.shift();
}

/** ENGINE-A5 (routeDebug): the font state at each face paint (empty outside debug). */
export function facePaintFontLog(): FacePaintFontRecord[] {
  return fontLog.map((entry) => ({ ...entry, webFonts: entry.webFonts ? { ...entry.webFonts } : null }));
}

function post(): void {
  if (scheduled) return;
  scheduled = true;
  if (typeof MessageChannel !== 'undefined') {
    if (channel === null) {
      channel = new MessageChannel();
      channel.port1.onmessage = drainOne;
    }
    channel.port2.postMessage(0);
    return;
  }
  setTimeout(drainOne, 0);
}

function drainOne(): void {
  scheduled = false;
  let job = queue.shift();
  while (job !== undefined && job.cancelled) job = queue.shift();
  if (job !== undefined) {
    const started = performance.now();
    noteFacePaintFonts(stats.drains + 1);
    let rest: unknown = undefined;
    try {
      rest = job.run();
    } catch (error) {
      // Logged in every build (PR #65 review): a failed job never publishes
      // its result, so a face whose residency waits on it stays pending and
      // the D23 stall detector resolves the load to Lite. This line is the
      // production record of why.
      console.error('[paint-queue] paint failed', error);
    }
    const ms = performance.now() - started;
    stats.drains += 1;
    if (ms > stats.maxMs) stats.maxMs = ms;
    if (ms > PAINT_DRAIN_FRAME_MS) stats.overFrame += 1;
    if (typeof rest === 'function') {
      // The continuation keeps the job's place: it runs next, as the same job
      // (its cancel still reaches it), and the job completes only then.
      job.run = rest as PaintJob;
      queue.unshift(job);
    } else {
      completed += 1;
    }
  }
  if (queue.length > 0) post();
  for (const listener of [...listeners]) listener();
}

/**
 * Queue `run` to execute in its own task. Returns the cancel (an effect
 * cleanup): a cancelled job never runs and stops counting as pending.
 */
export function queuePaint(run: PaintJob): () => void {
  const job: Job = { run, cancelled: false };
  queue.push(job);
  post();
  return () => {
    if (job.cancelled) return;
    job.cancelled = true;
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  };
}

/** Paints queued and not yet run. */
export function pendingPaints(): number {
  return queue.length;
}

/** Nothing is waiting to paint (the load warm's content gate). */
export function paintQueueIdle(): boolean {
  return queue.length === 0;
}

/** Paints run so far (monotone; a stall-detector progress count). */
export function completedPaints(): number {
  return completed;
}

/** Called after every drained job. */
export function subscribePaintQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** ENGINE-A4 (evidence): drains run, the longest one (ms), and how many exceeded a 60 Hz frame. */
export function paintQueueStats(): { drains: number; maxMs: number; overFrame: number } {
  return { ...stats, maxMs: Math.round(stats.maxMs * 10) / 10 };
}

// Dev evidence bridge (probes read it; never in production).
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as Window & { __paintQueueStats?: typeof paintQueueStats }).__paintQueueStats = paintQueueStats;
}

/** Tests only. */
export function resetPaintQueueForTests(): void {
  queue.length = 0;
  scheduled = false;
  completed = 0;
  stats.drains = 0;
  stats.maxMs = 0;
  stats.overFrame = 0;
  listeners.clear();
  channel = null;
  fontLog.length = 0;
  fontLogOn = null;
}

/**
 * LOOK pilot round 4, SEAT H: pure helpers for the capture harness.
 *
 * - iblVerdict: the IBL state of a still (a black prefiltered IBL is rejected
 *   at capture time, so a black-IBL still can never become a baseline).
 * - boardFaceSignal / boardPresenceVerdict: a data board that is present in
 *   the scene but paints nothing (visibleRenderables 1, textured 0; a flat
 *   face in the still) fails presence instead of passing it.
 * - recorderDropAccount: whether a quiet-probe recorder that dropped entries
 *   can still vouch for its GL link / texture-upload counters.
 * - programCountAtReveal: the one defined program-count measurement point.
 */

// ---------------------------------------------------------------------------
// IBL state (black-IBL rejection)
// ---------------------------------------------------------------------------

/** Mean / max prefiltered radiance (linear) at or below these reads as a black IBL. */
export const IBL_BLACK_MEAN = 1e-4;
export const IBL_BLACK_MAX = 1e-3;

/**
 * Judge a readIblState record (capture-route). `black` = the environment is
 * set but its prefiltered IBL holds no light (the load race): the still is
 * rejected. `zero-intensity` (an authored 0) and `no-ibl` are recorded
 * only. `lit` = PMREM read and non-black. Anything unreadable is
 * `unmeasured` (never a pass claim, never a rejection).
 */
export function iblVerdict(read, { blackMean = IBL_BLACK_MEAN, blackMax = IBL_BLACK_MAX } = {}) {
  if (!read || read.available !== true) return { ...(read ?? {}), verdict: 'unmeasured', pmremReady: null, reason: read?.reason ?? 'IBL state not read' };
  if (read.environmentPresent === false) return { ...read, verdict: 'no-ibl', pmremReady: null, reason: 'scene.environment is null (no IBL in this world)' };
  // An authored intensity of 0 is a scene choice, not the load race: recorded, never a rejection.
  if (typeof read.envIntensity === 'number' && read.envIntensity <= 0) return { ...read, verdict: 'zero-intensity', pmremReady: null, reason: `environmentIntensity ${read.envIntensity} (IBL switched off by the scene)` };
  const p = read.pmrem ?? {};
  if (p.status !== 'read') return { ...read, verdict: 'unmeasured', pmremReady: null, reason: `PMREM ${p.status ?? 'unknown'}${p.reason ? ` (${p.reason})` : ''}` };
  const mean = typeof p.meanRadiance === 'number' ? p.meanRadiance : null;
  const max = typeof p.maxRadiance === 'number' ? p.maxRadiance : null;
  if (mean === null || max === null) return { ...read, verdict: 'unmeasured', pmremReady: null, reason: 'PMREM samples missing' };
  if (mean <= blackMean && max <= blackMax) {
    return { ...read, verdict: 'black', pmremReady: false, reason: `prefiltered IBL is black (mean radiance ${mean}, max ${max} over ${p.faces?.length ?? 0} LOD-0 faces)` };
  }
  return { ...read, verdict: 'lit', pmremReady: true, reason: `prefiltered IBL holds light (mean radiance ${mean}, max ${max}; intensity ${read.envIntensity})` };
}

// ---------------------------------------------------------------------------
// Blank data face (presence)
// ---------------------------------------------------------------------------

/** |4-neighbour Laplacian| at or above this (luma levels) is an edge; 8-bit quantisation of a smooth glow stays under ~4. */
export const EDGE_LAPLACIAN = 12;

/**
 * Pixel signal of a face rect on a raw RGB(A) buffer (frame px), measured on
 * the INNER rect (inset share per side; the bezel / frame is left out):
 * Rec.709 luma mean / standard deviation, the mean absolute 4-neighbour
 * Laplacian, and edgeSharePct (pixels whose |Laplacian| >= EDGE_LAPLACIAN:
 * glyph strokes, chip edges, row rules). A painted face has a large edge
 * share; a flat, blank or glowing-but-empty panel has almost none.
 */
export function boardFaceSignal(img, rect, { inset = 0.1 } = {}) {
  const c = img.channels ?? 3;
  const x0 = Math.max(1, Math.round(rect.x + rect.w * inset));
  const y0 = Math.max(1, Math.round(rect.y + rect.h * inset));
  const x1 = Math.min(img.width - 1, Math.round(rect.x + rect.w * (1 - inset)));
  const y1 = Math.min(img.height - 1, Math.round(rect.y + rect.h * (1 - inset)));
  if (x1 - x0 < 3 || y1 - y0 < 3) return { pixels: 0, lumaMean: null, lumaStd: null, laplacian: null, edgeSharePct: null };
  const L = (x, y) => {
    const i = (y * img.width + x) * c;
    return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  };
  let n = 0;
  let sum = 0;
  let sq = 0;
  let lap = 0;
  let edges = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const v = L(x, y);
      sum += v;
      sq += v * v;
      const l = Math.abs(4 * v - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1));
      lap += l;
      if (l >= EDGE_LAPLACIAN) edges += 1;
      n += 1;
    }
  }
  const mean = sum / n;
  return {
    pixels: n,
    lumaMean: +mean.toFixed(2),
    lumaStd: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(2),
    laplacian: +(lap / n).toFixed(3),
    edgeSharePct: +((100 * edges) / n).toFixed(3),
  };
}

/**
 * Floor below which a data face reads blank, measured on existing evidence
 * (inner rect, 10% inset per side; edgeSharePct = share of pixels whose
 * |4-neighbour Laplacian| on Rec.709 luma of the final PNG is >= 12 levels):
 * - every data face with --luma rects in gauntlet/evidence (629 faces, all
 *   four worlds, rounds w2 to LOOK r3): painted faces read 2.66% and up
 *   (plaza 2.66 is the desk screen in the black-IBL look-before-r0-dark-390
 *   roster still; the next plaza read is 3.97; sakura >= 7.9, mountain
 *   >= 9.7, clouds >= 19.0; the r3 plaza AFTER faces >= 17.6).
 * - two blank LED boards: look-after-r3-trace-plaza-dark-1440-pulse (CAR r3:
 *   presence passed it with visibleRenderables 1, textured 0) 0.005%, and
 *   fid-w2l-r2c-plaza-light-bp1-schedule 0%. The trace board's luma std is 21 (a smooth
 *   glow blob), so std cannot tell them.
 * - a synthetic 8-bit glow of the same kind: 0% (its mean Laplacian is ~1.0
 *   from quantisation steps alone, which is why the mean is recorded, not
 *   judged).
 * The 1% floor sits 200x above the blank reads and 2.7x below the lowest
 * painted read.
 */
export const BOARD_FACE_FLOORS = { edgeSharePct: 1.0, minVisibleRenderables: 2 };

/**
 * Presence verdict for a data face (kind board / ledger / plaque / desk):
 * fail when a board reports fewer visible renderables than its registered
 * minimum (`minRenderables`, from the content baseline; else a board with
 * < 2 visible renderables and 0 textured is its frame only), or when the
 * still's face rect is flat (edge share under the floor: blank / unpainted).
 * `renderables` = { visibleRenderables, textured } from the stationContent
 * presence row; `signal` = boardFaceSignal on the still.
 */
export function boardPresenceVerdict({ id, kind = 'board', renderables = null, signal = null, minRenderables = null, floors = BOARD_FACE_FLOORS } = {}) {
  const reasons = [];
  const vr = renderables && typeof renderables.visibleRenderables === 'number' ? renderables.visibleRenderables : null;
  const tex = renderables && typeof renderables.textured === 'number' ? renderables.textured : null;
  if (vr !== null && typeof minRenderables === 'number' && vr < minRenderables) {
    reasons.push(`${id}: ${vr} visible renderable(s) < registered minimum ${minRenderables}`);
  } else if (kind === 'board' && minRenderables === null && vr !== null && vr < floors.minVisibleRenderables && tex === 0) {
    reasons.push(`${id}: ${vr} visible renderable(s), 0 textured (frame only, no painted content)`);
  }
  const flat = signal && signal.pixels > 0 && typeof signal.edgeSharePct === 'number' && signal.edgeSharePct < floors.edgeSharePct;
  if (flat) reasons.push(`${id}: face is flat in the still (edge share ${signal.edgeSharePct}% < ${floors.edgeSharePct}%; mean Laplacian ${signal.laplacian}, luma std ${signal.lumaStd}): blank / unpainted`);
  const measured = vr !== null || Boolean(signal && signal.pixels > 0);
  return { id, kind, verdict: !measured ? 'unmeasured' : reasons.length ? 'fail' : 'pass', reasons, renderables, minRenderables, signal, floors };
}

// ---------------------------------------------------------------------------
// Quiet-probe recorder drops
// ---------------------------------------------------------------------------

/**
 * Whether the quiet-probe recorder still vouches for its judged counters
 * after overflowing (CAR r3: `dropped: 34230` with 0/0/0/0 legs).
 * `recorder` = the page status: { dropped, droppedByKind, evicted: { [kind]:
 * { count, before } } }. Links and texture records are only ever dropped
 * NEWEST (at the hard cap): any such drop leaves the program / upload
 * counters incomplete. The other logs evict their OLDEST half; a judged
 * window that starts after `before` is still complete. Reuploads, rbAllocs
 * and long tasks never feed a hard count except longTasks (checked like
 * resources). A record without droppedByKind (pre-r4) is `unknown` when it
 * dropped anything.
 */
export const QUIET_CRITICAL_KINDS = ['links', 'textures', 'resources', 'longTasks'];

export function recorderDropAccount(recorder, { windowStart = null } = {}) {
  if (!recorder || typeof recorder.dropped !== 'number') return { verdict: 'unmeasured', reason: 'no recorder drop count' };
  const byKind = recorder.droppedByKind && typeof recorder.droppedByKind === 'object' ? recorder.droppedByKind : null;
  const evicted = recorder.evicted && typeof recorder.evicted === 'object' ? recorder.evicted : {};
  if (!byKind) {
    return recorder.dropped === 0
      ? { verdict: 'complete', dropped: 0 }
      : { verdict: 'unknown', dropped: recorder.dropped, reason: 'entries were dropped (newest first, pre-r4 recorder) and the record does not say which kinds; the link / upload counters cannot be vouched for' };
  }
  const problems = [];
  for (const [kind, n] of Object.entries(byKind)) if (n > 0 && QUIET_CRITICAL_KINDS.includes(kind)) problems.push(`${kind}: ${n} newest entries dropped`);
  for (const [kind, ev] of Object.entries(evicted)) {
    if (!QUIET_CRITICAL_KINDS.includes(kind) || !ev || !(ev.count > 0)) continue;
    if (typeof windowStart !== 'number' || typeof ev.before !== 'number' || ev.before >= windowStart) {
      problems.push(`${kind}: ${ev.count} oldest entries evicted up to t=${ev.before ?? '?'}${typeof windowStart === 'number' ? ` (judged legs start at ${Math.round(windowStart)})` : ''}`);
    }
  }
  const evictedTotal = Object.values(evicted).reduce((a, ev) => a + (ev && ev.count > 0 ? ev.count : 0), 0);
  if (problems.length) return { verdict: 'counters-incomplete', dropped: recorder.dropped, droppedByKind: byKind, evicted, reason: problems.join('; ') };
  return {
    verdict: 'counters-complete',
    dropped: recorder.dropped,
    droppedByKind: byKind,
    evicted,
    reason: evictedTotal ? `only pre-leg or non-judged entries were evicted (${evictedTotal}); every judged leg window is complete` : 'nothing dropped or evicted',
  };
}

// ---------------------------------------------------------------------------
// Program count: one defined measurement point
// ---------------------------------------------------------------------------

/**
 * The judged program count (CAR r3: 115 / 119 / 136-138 across three
 * reports). Defined point: renderer.info.programs.length at the reveal
 * (the first frame after the ceremony hands off, on the START rung), taken
 * from the loader trace's reveal snapshot. Later reads (landed stills,
 * draw audits after station moves, governor steps) are reported beside it as
 * `later`, never as the judged number.
 */
export function programCountAtReveal({ atReveal = null, startRung = null, later = [] } = {}) {
  const laterRows = (Array.isArray(later) ? later : []).filter((r) => r && typeof r.programs === 'number');
  if (typeof atReveal !== 'number') {
    return { verdict: 'unmeasured', judged: null, point: 'reveal (start rung)', reason: 'no reveal-time program read (needs --loader-trace or --quiet-probe)', later: laterRows };
  }
  return {
    verdict: 'measured',
    judged: atReveal,
    point: 'reveal (start rung)',
    startRung,
    later: laterRows,
    growthAfterReveal: laterRows.length ? Math.max(...laterRows.map((r) => r.programs)) - atReveal : 0,
  };
}

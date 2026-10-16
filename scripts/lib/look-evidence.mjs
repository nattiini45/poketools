/**
 * LOOK pilot round 2, SEAT H — evidence helpers for the capture harness
 * (scripts/capture-route.mjs). Pure functions plus two sharp-backed file
 * helpers (diffStillFiles, readStillSidecar). No browser, no server.
 *
 *  - fail-inject `stall:<ms>` parsing and the stall-path verdict (D23: a
 *    stall injection gives Lite at stall + 6 s, no partial reveal);
 *  - the product failure read from the readiness logs (phaseTrace), and the
 *    failed attempt's last state (milestones, load signals, stall target,
 *    warm trace) from the loader recorder's per-generation reads;
 *  - the forced-route liveness verdict (a --tier route trace that never went
 *    live is a fail, never a pass);
 *  - the post-reveal quiet probe's unmeasured record (always written);
 *  - the dolly quarter points of each station crossing (sweep film stills);
 *  - the per-pixel still diff (the blast-radius check) and the pose match;
 *  - the world-asset origin summary (local mirror check), the bucket guard
 *    that fails a run whose assets came from the Supabase bucket (unless
 *    --allow-bucket), and the env of the dev server the harness boots.
 */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Stall injection (?routeDebug=1&stallInjectMs=N, scene-progress.ts)
// ---------------------------------------------------------------------------

/** READINESS_STALL_MS (world-readiness.ts): the no-progress window. */
export const STALL_WINDOW_MS = 6_000;
/**
 * The stall injection must fire before the 20 s deadline can: N + 6 s < 20 s,
 * with a second of margin, so the stall detector (not the deadline) is what
 * the trace judges.
 */
export const STALL_INJECT_RANGE = { minMs: 0, maxMs: 13_000 };
const STALL_KIND_RE = /^stall:(\d{1,5})$/;

/** `stall:<ms>` -> ms (null for any other kind, NaN for an out-of-range stall). */
export function stallInjectMs(kind) {
  if (typeof kind !== 'string') return null;
  const m = STALL_KIND_RE.exec(kind);
  if (!m) return null;
  const ms = Number(m[1]);
  return ms >= STALL_INJECT_RANGE.minMs && ms <= STALL_INJECT_RANGE.maxMs ? ms : Number.NaN;
}

/** Whether a --fail-inject value names a stall injection (in range or not). */
export function isStallKind(kind) {
  return typeof kind === 'string' && STALL_KIND_RE.test(kind);
}

// ---------------------------------------------------------------------------
// Product failure + the failed attempt
// ---------------------------------------------------------------------------

/**
 * The first `failed` scene phase in the product's own phase log (a
 * single-commit phase the rAF samples can miss), with the fault reason of that
 * generation. Null when the log shows no failure.
 */
export function productFailure(readiness, attempts = null) {
  const trace = Array.isArray(readiness?.phaseTrace) ? readiness.phaseTrace : [];
  const failed = trace.find((p) => p && p.phase === 'failed' && typeof p.t === 'number');
  if (!failed) return null;
  const generation = typeof failed.generation === 'number' ? failed.generation : null;
  const fault = readiness?.lastFault;
  let reason = null;
  if (fault && (generation === null || fault.generation === generation)) reason = fault.reason ?? null;
  else if (attempts && generation !== null && attempts[generation]?.lastFault?.generation === generation) reason = attempts[generation].lastFault.reason ?? null;
  return { t: failed.t, generation, reason };
}

/**
 * The attempt to report: the failed generation when the product logged a
 * failure, else the newest generation the recorder saw. Carries its LAST
 * readiness read (milestones, load signals, stall target, fault) and its
 * warm-stage entries, so a stuck stage is visible from the evidence alone.
 */
export function attemptRecord({ readiness = null, attempts = null } = {}) {
  const gens = attempts ? Object.keys(attempts).map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
  const failure = productFailure(readiness, attempts);
  const generation = failure?.generation ?? (gens.length ? gens[gens.length - 1] : null);
  if (generation === null) return null;
  const last = attempts?.[generation] ?? null;
  const warm = Array.isArray(readiness?.warmTrace) ? readiness.warmTrace.filter((e) => e && e.generation === generation) : null;
  const milestones = last?.milestones ?? null;
  const at = milestones?.at ?? null;
  const risen = at ? Object.entries(at).filter(([, t]) => typeof t === 'number').sort((a, b) => a[1] - b[1]) : [];
  const pending = at ? Object.entries(at).filter(([, t]) => typeof t !== 'number').map(([k]) => k) : [];
  const lastWarm = warm && warm.length ? warm[warm.length - 1] : null;
  return {
    generation,
    source: failure ? 'failed-generation' : 'newest-generation',
    failure,
    lastReadAt: last?.t ?? null,
    phase: last?.phase ?? null,
    milestones,
    risen: risen.map(([k, t]) => ({ milestone: k, t: +t.toFixed(1) })),
    pending,
    loadSignals: last?.loadSignals ?? null,
    stallAt: last?.stallAt ?? null,
    lastFault: last?.lastFault ?? null,
    warmTrace: warm,
    lastWarmStage: lastWarm ? { stage: lastWarm.stage, t: lastWarm.t } : null,
    generations: gens,
  };
}

/**
 * Stall-path verdict (LOOK-PLAN §2 G acceptance: "a stall injection -> Lite at
 * stall + 6 s, no partial reveal"). From the injected generation's begin
 * (`anchor`) the product ignores every load signal after `injectMs`, so its
 * no-progress window opens no later than max(anchor + injectMs, renderer rise)
 * and the detector must fire by that + STALL_WINDOW_MS. Pass needs: a product
 * failure with reason `readiness-stall` at or after the injection and by the
 * bound (+ grace), the Lite page shown by the bound (+ grace), and the route
 * never live before it. `unmeasured` when the bound falls past the deadline
 * (the deadline, not the detector, would decide).
 */
export function stallPathVerdict(samples, { injectMs, anchor, deadlineMs = 20_000, failure = null, attempt = null, stallMs = STALL_WINDOW_MS, graceMs = 250 } = {}) {
  const reasons = [];
  if (typeof injectMs !== 'number' || !Number.isFinite(injectMs)) return { verdict: 'unmeasured', reasons: ['no stall injection'] };
  if (typeof anchor !== 'number') return { verdict: 'unmeasured', reasons: ['no deadline anchor (generationBegunAt) in the trace'] };
  const injectedAt = anchor + injectMs;
  const rendererAt = typeof attempt?.milestones?.at?.renderer === 'number' ? attempt.milestones.at.renderer : null;
  const windowOpensBy = Math.max(injectedAt, rendererAt ?? injectedAt);
  const stallBy = windowOpensBy + stallMs;
  const deadlineAt = anchor + deadlineMs;
  const base = {
    injectMs,
    anchor,
    injectedAt: +injectedAt.toFixed(1),
    rendererAt: rendererAt === null ? null : +rendererAt.toFixed(1),
    stallBy: +stallBy.toFixed(1),
    deadlineAt: +deadlineAt.toFixed(1),
    graceMs,
  };
  if (stallBy + graceMs >= deadlineAt) {
    return { verdict: 'unmeasured', ...base, reasons: [`stall bound ${stallBy.toFixed(0)} ms is not before the deadline ${deadlineAt.toFixed(0)} ms (use a smaller stall:<ms>)`] };
  }
  const failedAt = typeof failure?.t === 'number' ? failure.t : null;
  const list = Array.isArray(samples) ? samples : [];
  const liteAt = failedAt === null ? null : list.find((s) => s.t >= failedAt && !s.routeLive && !s.ballVisible)?.t ?? null;
  const liveBefore = list.find((s) => s.routeLive && (liteAt === null || s.t < liteAt));
  if (failedAt === null) reasons.push('the scene never failed after the stall injection');
  else {
    if (failure.reason !== 'readiness-stall') reasons.push(`failed with ${failure.reason ?? 'no fault reason'}, not readiness-stall`);
    if (failedAt < injectedAt) reasons.push(`failed at ${failedAt.toFixed(0)} ms, before the injection took hold (${injectedAt.toFixed(0)} ms)`);
    if (failedAt > stallBy + graceMs) reasons.push(`stall fired at ${failedAt.toFixed(0)} ms, after stall + ${stallMs / 1000} s (${stallBy.toFixed(0)} ms + ${graceMs} ms grace)`);
    if (liteAt === null) reasons.push('Lite page never shown after the stall');
    else if (liteAt > stallBy + graceMs) reasons.push(`Lite shown at ${liteAt.toFixed(0)} ms, after ${stallBy.toFixed(0)} ms + ${graceMs} ms grace`);
  }
  if (liveBefore) reasons.push(`partial reveal: world-route-live at ${liveBefore.t.toFixed(0)} ms before the Lite page`);
  return {
    verdict: reasons.length ? 'fail' : 'pass',
    ...base,
    failedAt: failedAt === null ? null : +failedAt.toFixed(1),
    failReason: failure?.reason ?? null,
    liteShownAt: liteAt === null ? null : +liteAt.toFixed(1),
    stallAfterInjectMs: failedAt === null ? null : +(failedAt - injectedAt).toFixed(1),
    reasons,
  };
}

/**
 * A forced --tier route trace (no fault injected, not the reduced-motion Lite
 * floor) whose world never went live, or whose ball outlived the deadline, is
 * a FAIL: "complete at reveal" is never reached by not revealing.
 */
export function routeTierLiveVerdict({ tier, faultInjected = false, liteFloor = false, timeline = null } = {}) {
  if (tier !== 'route' || faultInjected || liteFloor) return { verdict: 'not-applicable', reasons: [] };
  if (!timeline) return { verdict: 'unmeasured', reasons: ['no deadline timeline'] };
  const reasons = [];
  if (timeline.routeLiveAt === null || timeline.routeLiveAt === undefined) reasons.push('forced --tier route: world-route-live never set (the load fell to Lite)');
  if (timeline.ballWithinDeadline === false) reasons.push(`forced --tier route: the ball ended ${timeline.ballEndSinceAnchorMs ?? '?'} ms after the anchor, past the ${timeline.deadlineMs ?? '?'} ms deadline`);
  if (timeline.routeLiveAfterDeadline === true) reasons.push(`forced --tier route: world-route-live ${timeline.routeLiveSinceAnchorMs} ms after the anchor, past the deadline`);
  return { verdict: reasons.length ? 'fail' : 'pass', reasons };
}

// ---------------------------------------------------------------------------
// Quiet probe: the record written when the legs cannot run
// ---------------------------------------------------------------------------

/** The four judged counts, in report order (mirrors QUIET_COUNT_KEYS). */
export const QUIET_COUNTS = ['worldFetches', 'programs', 'textures', 'longTasks'];

/**
 * The -quiet.json body when the probe could not measure (reveal gate aborted
 * or timed out, recorder missing, a leg threw). ALWAYS written: verdict
 * `unmeasured` (never a pass), the four counts null (post-reveal counts do
 * not exist without a reveal), the stage that stopped it and the reason.
 * `diagnostic` carries the recorder's since-navigation counts when readable.
 */
export function quietUnmeasuredBody({ reason, stage, revealGate = null, diagnostic = null, relaxed = null } = {}) {
  return {
    pass: false,
    verdict: 'unmeasured',
    stage: stage ?? 'unknown',
    reason: reason ?? 'unknown',
    counts: Object.fromEntries(QUIET_COUNTS.map((k) => [k, null])),
    revealGate,
    ...(relaxed ? { deadlineRelaxed: relaxed } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    notes: [
      'unmeasured is never a pass: the post-reveal counts need a reveal (world-route-live + the ball done)',
      'diagnostic.sinceNavigation = the same four counters over the whole load (navigation start -> this read), informational, never judged',
    ],
  };
}

// ---------------------------------------------------------------------------
// Dolly stills: the quarter points of every station crossing
// ---------------------------------------------------------------------------

/**
 * Times at which the conductor's `smooth` progress crosses k + q (q in
 * `quarters`) between two recorder frames, linearly interpolated, in either
 * direction. Returns [{ t, from, to, q, at }] (from/to = the stations the
 * crossing joins, at = k + q), time-ordered.
 */
export function dollyQuarterTimes(frames, { quarters = [0.25, 0.5, 0.75] } = {}) {
  const timed = (frames ?? []).filter((f) => f && typeof f.t === 'number' && typeof f.smooth === 'number');
  const out = [];
  for (let i = 1; i < timed.length; i += 1) {
    const a = timed[i - 1];
    const b = timed[i];
    if (a.smooth === b.smooth) continue;
    const lo = Math.min(a.smooth, b.smooth);
    const hi = Math.max(a.smooth, b.smooth);
    for (let k = Math.floor(lo); k <= Math.floor(hi); k += 1) {
      for (const q of quarters) {
        const at = k + q;
        // Half-open so a frame landing exactly on the point counts once.
        const crosses = b.smooth > a.smooth ? at > a.smooth && at <= b.smooth : at < a.smooth && at >= b.smooth;
        if (!crosses) continue;
        const f = (at - a.smooth) / (b.smooth - a.smooth);
        out.push({ t: +(a.t + f * (b.t - a.t)).toFixed(1), from: k, to: k + 1, q, at, direction: b.smooth > a.smooth ? 'down' : 'up' });
      }
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/**
 * For each target time, the film frame that shows it: the first frame at or
 * after t within `maxLagMs` (the compositor emits after the render), else the
 * last frame before t. `times` ascending. Returns index or -1.
 */
export function filmFrameFor(times, t, { maxLagMs = 120 } = {}) {
  let before = -1;
  for (let i = 0; i < times.length; i += 1) {
    if (times[i] >= t) return times[i] - t <= maxLagMs ? i : before === -1 ? i : before;
    before = i;
  }
  return before;
}

// ---------------------------------------------------------------------------
// Still diff (blast radius) + pose match
// ---------------------------------------------------------------------------

/** A pixel counts as changed above this per-channel delta in the judged share. */
export const DIFF_THRESHOLD = 8;

/**
 * Per-pixel diff of two raw RGB(A) buffers of the same size: the per-pixel
 * delta is the max |channel difference| over R, G, B. `rect` (frame px)
 * limits the diff to a region; `exclude` rects are skipped. Returns
 * { pixels, changedPct, overThresholdPct, mean, max } (pct = 0..100).
 */
export function pixelDiff(a, b, { threshold = DIFF_THRESHOLD, rect = null, exclude = [] } = {}) {
  if (a.width !== b.width || a.height !== b.height) return { comparable: false, reason: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const ca = a.channels ?? 3;
  const cb = b.channels ?? 3;
  const x0 = rect ? Math.max(0, Math.floor(rect.x)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y)) : 0;
  const x1 = rect ? Math.min(a.width, Math.ceil(rect.x + rect.w)) : a.width;
  const y1 = rect ? Math.min(a.height, Math.ceil(rect.y + rect.h)) : a.height;
  const skip = (x, y) => exclude.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  let pixels = 0;
  let changed = 0;
  let over = 0;
  let sum = 0;
  let max = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (exclude.length && skip(x, y)) continue;
      const i = y * a.width + x;
      const pa = i * ca;
      const pb = i * cb;
      const d = Math.max(Math.abs(a.data[pa] - b.data[pb]), Math.abs(a.data[pa + 1] - b.data[pb + 1]), Math.abs(a.data[pa + 2] - b.data[pb + 2]));
      pixels += 1;
      sum += d;
      if (d > 0) changed += 1;
      if (d > threshold) over += 1;
      if (d > max) max = d;
    }
  }
  const pct = (n) => (pixels ? +((100 * n) / pixels).toFixed(3) : null);
  return { comparable: true, pixels, changedPct: pct(changed), overThresholdPct: pct(over), threshold, mean: pixels ? +(sum / pixels).toFixed(3) : null, max };
}

async function rawOf(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Inset share per side for the inner-face diff (LOOK r4: the judges' inner-25% rect excludes bezel / frame / pier stone). */
export const INNER_FACE_INSET = 0.25;

/** The rect inset by `inset` of its width / height on every side (frame px, rounded). */
export function innerRect(r, inset = INNER_FACE_INSET) {
  return { x: Math.round(r.x + r.w * inset), y: Math.round(r.y + r.h * inset), w: Math.max(0, Math.round(r.w * (1 - 2 * inset))), h: Math.max(0, Math.round(r.h * (1 - 2 * inset))) };
}

/** Mean Rec.709 luma (gamma-encoded 0..255) of a raw buffer inside `rect` (null when empty). */
export function rectLumaMean(img, rect) {
  const c = img.channels ?? 3;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  let n = 0;
  let sum = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * img.width + x) * c;
      sum += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      n += 1;
    }
  }
  return n ? +(sum / n).toFixed(2) : null;
}

/**
 * Diff two PNG stills of the same pose (sharp). `regions` = [{ id, x, y, w, h }]
 * in frame px get their own diff beside the whole frame (e.g. data faces);
 * `exclude` rects are left out of the whole-frame figure (e.g. the HUD band).
 * LOOK r4: each region also carries `inner` (the INNER_FACE_INSET rect: the
 * face copy without bezel / frame) with the mean luma of both sides, and
 * `maskRects` (animated figures / foliage) give a second whole-frame figure,
 * `frameMasked`, with those rects left out too (a measured exclusion).
 */
export async function diffStillFiles(pathA, pathB, { threshold = DIFF_THRESHOLD, regions = [], exclude = [], maskRects = [] } = {}) {
  const [a, b] = await Promise.all([rawOf(pathA), rawOf(pathB)]);
  const frame = pixelDiff(a, b, { threshold, exclude });
  if (!frame.comparable) return { frame, regions: [] };
  const out = {
    frame,
    regions: regions.map((r) => {
      const inner = innerRect(r);
      return {
        id: r.id,
        rect: { x: r.x, y: r.y, w: r.w, h: r.h },
        ...pixelDiff(a, b, { threshold, rect: r }),
        inner: inner.w > 0 && inner.h > 0 ? { rect: inner, inset: INNER_FACE_INSET, ...pixelDiff(a, b, { threshold, rect: inner }), lumaA: rectLumaMean(a, inner), lumaB: rectLumaMean(b, inner) } : null,
      };
    }),
  };
  if (maskRects.length) out.frameMasked = { ...pixelDiff(a, b, { threshold, exclude: [...exclude, ...maskRects] }), maskedRects: maskRects.length };
  return out;
}

/** The landed pose of a still sidecar: camPos + yaw/pitch (cameraPose, else the probe's yaw). */
export function poseOf(sidecar) {
  if (!sidecar || typeof sidecar !== 'object') return null;
  const cp = sidecar.cameraPose ?? null;
  return {
    camPos: Array.isArray(cp?.camPos) ? cp.camPos : Array.isArray(sidecar.camPos) ? sidecar.camPos : null,
    yaw: typeof cp?.yawRad === 'number' ? cp.yawRad : typeof sidecar.yaw === 'number' ? sidecar.yaw : null,
    pitch: typeof cp?.pitchRad === 'number' ? cp.pitchRad : null,
    pathYaw: typeof sidecar.pathYaw === 'number' ? sidecar.pathYaw : null,
  };
}

/** Pose tolerance: camPos (m) and yaw/pitch (rad) a before/after pair must match within. */
export const POSE_TOLERANCE = { posM: 1e-3, angleRad: 2e-3 };

/** Whether two stills share a pose (endpoints frozen: a mismatch makes a pixel diff framing noise). */
export function poseMatch(a, b, tol = POSE_TOLERANCE) {
  const pa = poseOf(a);
  const pb = poseOf(b);
  if (!pa || !pb || !pa.camPos || !pb.camPos) return { match: null, reason: 'pose unreadable in a sidecar' };
  const dPos = Math.hypot(pa.camPos[0] - pb.camPos[0], pa.camPos[1] - pb.camPos[1], pa.camPos[2] - pb.camPos[2]);
  const dYaw = pa.yaw !== null && pb.yaw !== null ? Math.abs(Math.atan2(Math.sin(pa.yaw - pb.yaw), Math.cos(pa.yaw - pb.yaw))) : null;
  const dPitch = pa.pitch !== null && pb.pitch !== null ? Math.abs(pa.pitch - pb.pitch) : null;
  const reasons = [];
  if (dPos > tol.posM) reasons.push(`camPos differs by ${dPos.toFixed(4)} m`);
  if (dYaw !== null && dYaw > tol.angleRad) reasons.push(`yaw differs by ${dYaw.toFixed(4)} rad`);
  if (dPitch !== null && dPitch > tol.angleRad) reasons.push(`pitch differs by ${dPitch.toFixed(4)} rad`);
  return { match: reasons.length === 0, dPos: +dPos.toFixed(5), dYaw: dYaw === null ? null : +dYaw.toFixed(5), dPitch: dPitch === null ? null : +dPitch.toFixed(5), tolerance: tol, reasons };
}

/** Read a still's JSON sidecar (null when missing or unreadable). */
export async function readStillSidecar(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The data-face regions of a sidecar in frame px (--luma inputs; LOOK r4:
 * else the diffRects record every --diff-against still carries), for the
 * face-only diff: a data face must be pixel-identical to its before still.
 */
export function faceRegionsOf(sidecar) {
  const inputs = Array.isArray(sidecar?.lumaInputs?.faces) && sidecar.lumaInputs.faces.length ? sidecar.lumaInputs : sidecar?.diffRects;
  const scale = typeof inputs?.frame?.scale === 'number' ? inputs.frame.scale : 1;
  const faces = Array.isArray(inputs?.faces) ? inputs.faces : [];
  return faces
    .filter((f) => f && typeof f.x === 'number' && typeof f.w === 'number')
    .map((f) => ({ id: f.id, x: Math.round(f.x * scale), y: Math.round(f.y * scale), w: Math.round(f.w * scale), h: Math.round(f.h * scale) }));
}

/** Padding (CSS px) around a figure rect when it is masked out of a diff (limb / sway overhang). */
export const FIGURE_MASK_PAD_PX = 6;

/**
 * LOOK r4: the animated-figure rects of a sidecar's diffRects in frame px,
 * padded, for the figure-masked whole-frame diff. A face rect is never
 * masked: a figure rect that overlaps a data face is clipped out of nothing,
 * it is simply dropped (the face diff stays whole).
 */
export function figureMaskOf(sidecar, { padPx = FIGURE_MASK_PAD_PX } = {}) {
  const rects = sidecar?.diffRects;
  const scale = typeof rects?.frame?.scale === 'number' ? rects.frame.scale : 1;
  const figures = Array.isArray(rects?.figures) ? rects.figures : [];
  const faces = faceRegionsOf(sidecar);
  const overlaps = (r, f) => r.x < f.x + f.w && f.x < r.x + r.w && r.y < f.y + f.h && f.y < r.y + r.h;
  return figures
    .filter((f) => f && typeof f.x === 'number' && typeof f.w === 'number' && f.w > 0 && f.h > 0)
    .map((f) => ({ id: f.id ?? null, x: Math.round((f.x - padPx) * scale), y: Math.round((f.y - padPx) * scale), w: Math.round((f.w + 2 * padPx) * scale), h: Math.round((f.h + 2 * padPx) * scale) }))
    .filter((r) => !faces.some((f) => overlaps(r, f)));
}

// ---------------------------------------------------------------------------
// Asset origin (D22: the dev server serves world assets from /models/world)
// ---------------------------------------------------------------------------

const WORLD_ASSET_PATH_RE = /\/models\/world\/|\/textures\/world\/|\/storage\/v1\/object\/public\/world-assets\//;

/**
 * Summary of the world-asset requests a page made: count per host and per
 * source (local mirror /models/world, app /textures/world, the Supabase
 * bucket), whether every one came from the page's own origin, and the first
 * few paths. `requests` = [{ url, t? }], `pageOrigin` = the captured page's origin.
 */
export function assetOriginSummary(requests, pageOrigin) {
  const hosts = {};
  const sources = { localMirror: 0, appTextures: 0, bucket: 0 };
  const sample = [];
  const list = [];
  let world = 0;
  let foreign = 0;
  let bytes = 0;
  let bytesKnown = 0;
  for (const r of requests ?? []) {
    let u;
    try {
      u = new URL(r.url);
    } catch {
      continue;
    }
    if (!WORLD_ASSET_PATH_RE.test(u.pathname)) continue;
    world += 1;
    hosts[u.host] = (hosts[u.host] ?? 0) + 1;
    if (u.pathname.includes('/storage/v1/object/public/world-assets/')) sources.bucket += 1;
    else if (u.pathname.includes('/textures/world/')) sources.appTextures += 1;
    else sources.localMirror += 1;
    if (pageOrigin && u.origin !== pageOrigin) foreign += 1;
    if (typeof r.bytes === 'number' && r.bytes >= 0) {
      bytes += r.bytes;
      bytesKnown += 1;
    }
    if (sample.length < 6) sample.push(`${u.host}${u.pathname}`);
    // LOOK r3 (CAR judge: "assetOrigin lists only a sample"): every request.
    list.push({ path: `${u.host}${u.pathname}`, bytes: typeof r.bytes === 'number' && r.bytes >= 0 ? r.bytes : null, ...(typeof r.epoch === 'number' ? { epoch: r.epoch } : {}) });
  }
  const t0 = list.reduce((m, r) => (typeof r.epoch === 'number' && (m === null || r.epoch < m) ? r.epoch : m), null);
  if (t0 !== null) for (const r of list) if (typeof r.epoch === 'number') r.dtMs = r.epoch - t0;
  return {
    worldAssetRequests: world,
    hosts,
    sources,
    allFromPageOrigin: world === 0 ? null : foreign === 0,
    foreignRequests: foreign,
    // Response body bytes of the requests that finished (encoded, as fetched).
    bytes: bytesKnown ? bytes : null,
    bytesKnownFor: bytesKnown,
    sample,
    // LOOK r3: the full world-asset request list (path, bytes, ms after the
    // first world-asset request when timed), in request order.
    requests: list.map(({ epoch: _epoch, ...rest }) => rest),
    uniquePaths: new Set(list.map((r) => r.path)).size,
  };
}

// ---------------------------------------------------------------------------
// Bucket guard (DATA-PLAN fix 1): automation never spends the Supabase quota
// ---------------------------------------------------------------------------

/**
 * The local mirror every harness-booted server resolves world assets from.
 * Mirrors `.claude/local-assets.cjs` and `LOCAL_BASE` in model-manifest.ts.
 */
export const LOCAL_WORLD_ASSETS_URL = '/models/world';

/**
 * Env for the `next dev` the capture harness boots itself: the parent env
 * with NEXT_PUBLIC_WORLD_ASSETS_URL pinned to the local mirror. process.env
 * wins over .env.local in Next's env loading, so a bucket URL left in
 * .env.local can no longer reach a capture (the 2026-09-26/27 overage).
 */
export function captureServerEnv(baseEnv = process.env) {
  return { ...baseEnv, NEXT_PUBLIC_WORLD_ASSETS_URL: LOCAL_WORLD_ASSETS_URL };
}

/**
 * The bucket guard's verdict on one load's asset origin (an
 * `assetOriginSummary` result, i.e. a sidecar's `assetOrigin`):
 *  - `pass`: no request reached the `world-assets` bucket;
 *  - `allowed`: bucket requests, but the run was started with --allow-bucket
 *    (a deliberate production check);
 *  - `fail`: bucket requests without --allow-bucket. The run must fail.
 * A missing summary (no page load recorded) passes: there is nothing to judge.
 */
export function bucketGuardVerdict(assetOrigin, { allowBucket = false } = {}) {
  const raw = assetOrigin?.sources?.bucket;
  const bucket = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  if (bucket === 0) return { verdict: 'pass', bucket, allowBucket };
  if (allowBucket) return { verdict: 'allowed', bucket, allowBucket, reason: `${bucket} world-asset request(s) hit the Supabase bucket (allowed by --allow-bucket)` };
  const sample = (assetOrigin?.requests ?? [])
    .map((r) => r?.path)
    .filter((p) => typeof p === 'string' && p.includes('/storage/v1/object/public/world-assets/'))
    .slice(0, 3);
  return {
    verdict: 'fail',
    bucket,
    allowBucket,
    reason: `${bucket} world-asset request(s) hit the Supabase bucket; captures must load /models/world (AGENTS.md: automation never spends the Supabase quota). Pass --allow-bucket only for a deliberate production check.${sample.length ? ` First: ${sample.join(', ')}` : ''}`,
  };
}

/** Thrown by `assertNoBucketEgress`, so the harness's catch fails the run (exit 1) and tears down. */
export class BucketEgressError extends Error {
  constructor(verdict) {
    super(`bucket guard: ${verdict.reason}`);
    this.name = 'BucketEgressError';
    this.verdict = verdict;
  }
}

/** Returns the verdict; throws BucketEgressError when it is `fail`. */
export function assertNoBucketEgress(assetOrigin, { allowBucket = false } = {}) {
  const verdict = bucketGuardVerdict(assetOrigin, { allowBucket });
  if (verdict.verdict === 'fail') throw new BucketEgressError(verdict);
  return verdict;
}

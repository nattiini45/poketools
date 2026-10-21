/**
 * Desktop CAPTURE harness additions (maintainer Pokémon core plan
 * R40), used by scripts/capture-route.mjs:
 *
 *  - `--no-boot` (`attachNoBoot`): attach to the running board server and
 *    never kill or boot one; an unresponsive server fails the run;
 *  - water-body screen rects for the still sidecars (`waterScreenRects`):
 *    each body's surface ellipse (from `__routeWorldWater().bodies[].params`)
 *    projected through the live render camera, so `stills.mjs --mask-water`
 *    can mask the water (R8, K5);
 *  - compact per-frame records for `--frames` traces: the beat bus
 *    (`compactBeats`), the core probe actors (`compactCoreActors`) and the
 *    warm-stats per-frame draw calls (`frameDraws`), so K1/K3 can see the
 *    focus and roll-call windows and K9 can split draws inside and outside a
 *    flyer pass.
 *
 * Same contract as the other scripts/lib evidence modules: PURE helpers
 * (tested in scripts/__tests__/gauntlet-harness.test.mjs) plus self-contained
 * IN-PAGE functions (serialized by Playwright, no closure over module scope).
 */

// ---------------------------------------------------------------------------
// --no-boot
// ---------------------------------------------------------------------------

/** Attempts and per-attempt timeout of the --no-boot attach (a recompiling `next dev` can be slow). */
export const NO_BOOT_ATTEMPTS = 3;
export const NO_BOOT_TIMEOUT_MS = 30_000;

/**
 * --no-boot: probe the server up to `attempts` times. Any HTTP response is a
 * pass. Nothing listening, or a listener that stays silent through every
 * attempt, throws an Error with a message the runner log shows. Never kills
 * and never boots.
 *
 * @param {(url: string, timeoutMs: number) => Promise<{kind: string}>} probeFn  the harness's probe()
 * @param {string} url
 * @param {{ port?: number|string, attempts?: number, timeoutMs?: number, sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {Promise<{ ok: true, attempts: number, kinds: string[] }>}
 */
export async function attachNoBoot(probeFn, url, { port = '?', attempts = NO_BOOT_ATTEMPTS, timeoutMs = NO_BOOT_TIMEOUT_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const kinds = [];
  for (let i = 0; i < attempts; i += 1) {
    let state;
    try {
      state = await probeFn(url, timeoutMs);
    } catch (err) {
      state = { kind: 'error', error: err instanceof Error ? err.message : String(err) };
    }
    kinds.push(state.kind);
    if (state.kind === 'ok') return { ok: true, attempts: i + 1, kinds };
    if (i < attempts - 1) await sleep(state.kind === 'refused' ? 5000 : 1000);
  }
  const last = kinds[kinds.length - 1];
  const why =
    last === 'refused'
      ? `nothing is listening on port ${port}`
      : last === 'wedged'
        ? `port ${port} accepted the connection but sent no HTTP response within ${timeoutMs / 1000} s, ${attempts} times (a wedged or still-compiling server)`
        : `the probe of ${url} failed (${kinds.join(', ')})`;
  throw new Error(
    `--no-boot: ${why}. The harness never kills or boots a server under --no-boot: start the board server (preview_start board-local) or wait for it, warm it (scripts/gauntlet/wait-compile.sh), and re-run this line. Probes: ${kinds.join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// Water-body screen rects (R8 / K5 mask)
// ---------------------------------------------------------------------------

/** Rim samples per ellipse and the vertical margin (m) over the summed wave amplitude. */
export const WATER_RECT_SAMPLES = 64;
export const WATER_RECT_MARGIN_M = 0.1;

const mulVec = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
  m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
];

/**
 * Screen rects (viewport CSS px, like the figure rects) of every water body's
 * surface: the ellipse rim (centre [x, z], semi-axes [rx, rz], axis-aligned)
 * sampled at surfaceY ± (summed wave amplitude + margin), projected through
 * the camera's view and projection matrices (column-major, three.js
 * `elements`) into the canvas box, clamped to the viewport.
 *
 * A body whose rim crosses the camera's eye plane is near-clipped: its rect is
 * widened to the viewport's left / right / bottom edges (the water in front of
 * the eye is below and around the camera), which over-masks rather than
 * under-masks. A body wholly behind the eye has `rect: null`.
 *
 * @param {Array<{ id: string, params?: { center: number[], radii: number[], surfaceY: number, waves?: Array<{ amplitudeM?: number }> } }>} bodies
 * @param {{ view: number[], proj: number[], canvas: { left: number, top: number, width: number, height: number }, viewport?: { width: number, height: number } } | null} cam
 */
export function waterScreenRects(bodies, cam, { samples = WATER_RECT_SAMPLES, marginM = WATER_RECT_MARGIN_M } = {}) {
  const list = Array.isArray(bodies) ? bodies : [];
  if (!cam || !Array.isArray(cam.view) || !Array.isArray(cam.proj) || !cam.canvas) {
    return { source: 'unmeasured', reason: 'no render camera (debug bridges off, or no R3F root)', bodies: list.map((b) => ({ id: b?.id ?? null, rect: null })) };
  }
  const { left, top, width, height } = cam.canvas;
  const vw = cam.viewport?.width ?? left + width;
  const vh = cam.viewport?.height ?? top + height;
  const out = [];
  for (const body of list) {
    const p = body?.params;
    if (!p || !Array.isArray(p.center) || !Array.isArray(p.radii) || typeof p.surfaceY !== 'number') {
      out.push({ id: body?.id ?? null, rect: null, reason: 'no params' });
      continue;
    }
    const amp = (p.waves ?? []).reduce((s, w) => s + Math.abs(w?.amplitudeM ?? 0), 0) + marginM;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let front = 0;
    let behind = 0;
    for (const y of [p.surfaceY - amp, p.surfaceY + amp]) {
      for (let k = 0; k < samples; k += 1) {
        const a = (k / samples) * Math.PI * 2;
        const world = [p.center[0] + p.radii[0] * Math.cos(a), y, p.center[1] + p.radii[1] * Math.sin(a), 1];
        const c = mulVec(cam.proj, mulVec(cam.view, world));
        if (!(c[3] > 1e-6)) {
          behind += 1;
          continue;
        }
        front += 1;
        const sx = left + ((c[0] / c[3] + 1) / 2) * width;
        const sy = top + ((1 - c[1] / c[3]) / 2) * height;
        x0 = Math.min(x0, sx);
        y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx);
        y1 = Math.max(y1, sy);
      }
    }
    if (front === 0) {
      out.push({ id: body.id, rect: null, onScreen: false, nearClipped: true, reason: 'behind the camera' });
      continue;
    }
    if (behind > 0) {
      x0 = 0;
      x1 = vw;
      y1 = vh;
    }
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(vw, Math.ceil(x1));
    const cy1 = Math.min(vh, Math.ceil(y1));
    const onScreen = cx1 > cx0 && cy1 > cy0;
    out.push({
      id: body.id,
      rect: onScreen ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null,
      onScreen,
      nearClipped: behind > 0,
      verticalM: +(2 * amp).toFixed(3),
    });
  }
  return {
    source: '__routeWorldWater params x the R3F render camera',
    viewport: { width: vw, height: vh },
    note: 'surface ellipse rim at surfaceY ± (summed wave amplitude + margin), axis-aligned, projected; near-clipped bodies widen to the viewport left/right/bottom edges',
    bodies: out,
  };
}

/**
 * A camera for `waterScreenRects` rebuilt from a still sidecar's `cameraPose`
 * (camPos, yawRad = atan2(f.x, -f.z), pitchRad = asin(f.y), vertical fov in
 * degrees; no roll, as the CameraRig never rolls), for stills shot before
 * R40's harness recorded `waterRects` (their sidecars carry `water` and
 * `cameraPose`). The canvas is the whole viewport (`width` x `height`, CSS px).
 * null when the pose is incomplete.
 */
export function cameraFromPose(pose, width, height, { near = 0.1, far = 2000 } = {}) {
  if (!pose || !Array.isArray(pose.camPos) || pose.camPos.some((v) => typeof v !== 'number')) return null;
  const { yawRad: yaw, pitchRad: pitch, fov } = pose;
  if (![yaw, pitch, fov, width, height].every((v) => typeof v === 'number' && Number.isFinite(v)) || !(width > 0 && height > 0)) return null;
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const zc = norm([-f[0], -f[1], -f[2]]);
  const xc = norm(cross([0, 1, 0], zc));
  const yc = cross(zc, xc);
  const p = pose.camPos;
  const view = [xc[0], yc[0], zc[0], 0, xc[1], yc[1], zc[1], 0, xc[2], yc[2], zc[2], 0, -dot(xc, p), -dot(yc, p), -dot(zc, p), 1];
  const t = 1 / Math.tan((fov * Math.PI) / 360);
  const aspect = width / height;
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return { view, proj, canvas: { left: 0, top: 0, width, height }, viewport: { width, height } };
}

/**
 * IN-PAGE: the live render camera (the R3F root reached through the debug
 * scene handle) as plain arrays, plus the canvas box and the viewport. null
 * when the scene handle or the root is absent.
 */
export function readRenderCameraInPage() {
  const sceneRead = window.__routeWorldScene;
  if (typeof sceneRead !== 'function') return null;
  let scene = null;
  try {
    scene = sceneRead();
  } catch {
    return null;
  }
  if (!scene) return null;
  const rootOf = (o) => (o && o.__r3f && o.__r3f.root && typeof o.__r3f.root.getState === 'function' ? o.__r3f.root.getState() : null);
  let state = rootOf(scene);
  if (!state) {
    try {
      scene.traverse((o) => {
        if (!state) state = rootOf(o);
      });
    } catch {
      state = null;
    }
  }
  const cam = state && state.camera;
  const canvas = state && state.gl && state.gl.domElement;
  if (!cam || !canvas) return null;
  cam.updateMatrixWorld(true);
  const r = canvas.getBoundingClientRect();
  return {
    view: Array.from(cam.matrixWorldInverse.elements),
    proj: Array.from(cam.projectionMatrix.elements),
    canvas: { left: r.left, top: r.top, width: r.width, height: r.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

// ---------------------------------------------------------------------------
// Per-frame records for --frames traces
// ---------------------------------------------------------------------------

/**
 * The beat bus at one frame, compacted (`__routeWorldBeats()`; null when the
 * bridge is absent). The full log (grants, figureBeats) stays in the
 * end-of-run `bridges.beats`; this carries what changes per frame: the bus
 * clock, quiet mode, the roll call, the granted / pending tickets with their
 * denial reasons, the reading window and the settle clock.
 */
export function compactBeats(report) {
  if (!report || typeof report !== 'object' || report.error) return report && report.error ? { error: report.error } : null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(3) : null);
  return {
    t: num(report.t),
    quiet: report.quiet ? { active: report.quiet.active === true, subjectId: report.quiet.subjectId ?? null } : null,
    rollCall: report.rollCall ? report.rollCall.running === true : null,
    granted: (report.granted ?? []).map((g) => [g.kind, g.actorId, num(g.grantedAtS)]),
    pending: (report.pending ?? []).map((p) => [p.kind, p.actorId, p.deniedReason ?? null]),
    suppression: report.suppression ?? null,
    readingOpen: report.readingWindow ? report.readingWindow.open === true : null,
    sinceSettleS: num(report.readingWindow?.sinceSettleS),
    sinceHeroEndS: num(report.sinceHeroEndS),
    grants: Array.isArray(report.grants) ? report.grants.length : null,
    figureBeats: Array.isArray(report.figureBeats) ? report.figureBeats.length : null,
  };
}

/** The core probe actors at one frame (`__routeWorldCoreActors()`), without the flip logs (they stay in the end-of-run bridge). */
export function compactCoreActors(report) {
  if (!report || typeof report !== 'object' || report.error) return report && report.error ? { error: report.error } : null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(3) : null);
  return {
    actors: (report.actors ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      mode: a.mode,
      wants: a.wants,
      pos: [num(a.x), num(a.y), num(a.z)],
      requests: a.requests,
      surfacings: a.surfacings,
      passes: a.passes,
      plays: a.plays,
      wakes: a.wakes,
      waterline: a.waterline,
      flips: Array.isArray(a.flips) ? a.flips.length : null,
    })),
  };
}

/**
 * Per-frame draw calls from warm-stats windows. `windows` are the
 * `__routeWarmStats.window(a, b, 0)` reads over consecutive slices of the
 * interval since the previous sample (each window lists at most 40 frames, so
 * the page reads ~1 s slices). Returns the per-frame `calls` with min /
 * median / max, or null when no window was readable.
 */
export function frameDraws(windows) {
  const list = (Array.isArray(windows) ? windows : []).filter((w) => w && typeof w === 'object' && !w.error);
  if (!list.length) return null;
  const perFrame = [];
  let frames = 0;
  let truncated = false;
  for (const w of list) {
    frames += typeof w.frames === 'number' ? w.frames : 0;
    const rows = Array.isArray(w.slow) ? w.slow : [];
    if (typeof w.frames === 'number' && rows.length < w.frames) truncated = true;
    for (const f of rows) if (typeof f?.calls === 'number') perFrame.push(f.calls);
  }
  const s = [...perFrame].sort((a, b) => a - b);
  const med = s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : null;
  return { frames, listed: perFrame.length, truncated, min: s.length ? s[0] : null, median: med, max: s.length ? s[s.length - 1] : null, perFrame };
}

/**
 * IN-PAGE: one per-frame extras read for the --frames presented path: the
 * beat bus and core-actor reports (raw; compacted in Node) and the warm-stats
 * frames since `from` (performance.now()), in ~1 s slices.
 */
export function readFrameExtrasInPage(from) {
  const call = (name) => {
    const fn = window[name];
    if (typeof fn !== 'function') return null;
    try {
      return JSON.parse(JSON.stringify(fn() ?? null));
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  };
  const now = performance.now();
  let windows = null;
  const ws = window.__routeWarmStats;
  if (ws && typeof ws.window === 'function' && typeof from === 'number') {
    windows = [];
    for (let a = from; a < now; a += 1000) {
      try {
        const w = ws.window(a, Math.min(now, a + 1000), 0);
        windows.push({ frames: w.frames, calls: w.calls, slow: (w.slow || []).map((f) => ({ t: f.t, calls: f.calls })) });
      } catch (err) {
        windows.push({ error: String((err && err.message) || err) });
      }
    }
  }
  return { perfT: now, beats: call('__routeWorldBeats'), coreActors: call('__routeWorldCoreActors'), windows };
}

// ---------------------------------------------------------------------------
// R41: the beatForce clock zero and the bus clock at quiet-leg boundaries
// ---------------------------------------------------------------------------

/**
 * Whether a run arms the force-clock watch (R41): a debug run that observes beats
 * (`--frames` or `--quiet-probe`) with the probe actors or a `beatForce` page param.
 * Timing runs (the cold car recipe) never arm it.
 */
export function forceClockWatchWanted({ debugOn, tierLite = false, frames = 0, quietProbe = false, paramKeys = [] }) {
  return Boolean(debugOn) && !tierLite && (frames > 0 || Boolean(quietProbe)) && paramKeys.some((k) => k === 'coreActors' || k === 'beatForce');
}

/**
 * Whether one `__routeWorldBeats()` read shows the frame the figure director arms its
 * `beatForce` clock on (R41, figure-director.ts: `firstSettleAt` = the first frame that is
 * settled AND live): live = the bus's suppression is not `not-live` / `hidden` /
 * `reduced-motion` (a frame with no other block reports null), settled = the grant context's
 * `sinceSettleS` is a number; the watch also requires a `not-live` read first (the load) (it is null while unsettled). The bus clock and the director's
 * awake clock advance by the same clamped delta every step, so `t` of that read is the force
 * clock's zero in bus seconds (the clock grants are stamped in).
 */
export function forceZeroRead(b) {
  // Before the bus's first grant there is no grant context (t 0, suppression null).
  if (!b || typeof b !== 'object' || typeof b.t !== 'number' || !(b.t > 0)) return { live: false, settled: false };
  const lastCtx = b.readingWindow && typeof b.readingWindow === 'object';
  const live = lastCtx && b.suppression !== 'not-live' && b.suppression !== 'hidden' && b.suppression !== 'reduced-motion';
  const settled = lastCtx && typeof b.readingWindow.sinceSettleS === 'number';
  return { live: Boolean(live), settled: Boolean(settled) };
}

/**
 * IN-PAGE (addInitScript, before navigation; R41): watch `__routeWorldBeats()` once per
 * animation frame until the first settled live frame, record the bus clock there
 * (`zeroT`, the force clock's zero) and the first live read (`revealT`), then STOP (no
 * per-frame cost after the reveal settles; a run that never arms stops at `maxMs`).
 * `window.__gauntletForceClock()` returns the record. Self-contained: it repeats
 * `forceZeroRead`'s test (Playwright serializes the function; no closure).
 */
export function installForceClockWatch(opts) {
  const maxMs = (opts && opts.maxMs) || 180000;
  const rec = { zeroT: null, zeroSinceSettleS: null, zeroPerfT: null, revealT: null, revealPerfT: null, sawNotLive: false, reads: 0, stoppedBy: null, error: null };
  window.__gauntletForceClock = () => Object.assign({}, rec);
  const t0 = performance.now();
  const tick = () => {
    if (performance.now() - t0 > maxMs) {
      rec.stoppedBy = 'timeout';
      return;
    }
    const fn = window.__routeWorldBeats;
    if (typeof fn === 'function') {
      try {
        const b = fn();
        rec.reads += 1;
        // Before the bus's first grant there is no grant context (t 0, suppression null): skip it.
        const ctx = b && typeof b.t === 'number' && b.t > 0 && b.readingWindow && typeof b.readingWindow === 'object';
        if (ctx && b.suppression === 'not-live') rec.sawNotLive = true;
        const live = ctx && rec.sawNotLive && b.suppression !== 'not-live' && b.suppression !== 'hidden' && b.suppression !== 'reduced-motion';
        if (live && rec.revealT === null) {
          rec.revealT = b.t;
          rec.revealPerfT = Math.round(performance.now());
        }
        if (live && typeof b.readingWindow.sinceSettleS === 'number') {
          rec.zeroT = b.t;
          rec.zeroSinceSettleS = b.readingWindow.sinceSettleS;
          rec.zeroPerfT = Math.round(performance.now());
          rec.stoppedBy = 'armed';
          return;
        }
      } catch (err) {
        rec.error = String((err && err.message) || err);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** IN-PAGE: the force-clock watch record, or null when the watch is not installed. */
export function readForceClockInPage() {
  const fn = window.__gauntletForceClock;
  return typeof fn === 'function' ? fn() : null;
}

/** IN-PAGE: the beat bus clock now (bus awake seconds), or null without the bridge. */
export function readBusClockInPage() {
  try {
    const fn = window.__routeWorldBeats;
    const b = typeof fn === 'function' ? fn() : null;
    return b && typeof b.t === 'number' ? b.t : null;
  } catch {
    return null;
  }
}

/**
 * CHROME seat (D32 theme veil, D33 NavBar reveal) — capture-route helpers.
 *
 * Pure (tested by scripts/__tests__/chrome-probes.test.mjs):
 * - `veilWindows(trace, sinceT)`: the veil's phase times after a toggle;
 * - `veilJudge(...)`: the judged quiet theme leg under D32 — every world
 *   fetch, program link, texture upload / allocation and long task after the
 *   toggle must fall inside the veil-OPAQUE window (opaque → out), and none
 *   before it (the fade-in) or after the fade-out began;
 * - `navRevealVerdict(checks)`.
 *
 * Runners (drive a live Playwright page): `runNavRevealProbe` (--nav-reveal-probe)
 * and `writeVeilFilm` (the veil's screencast frames + a contact sheet).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

/* ── D32: the veil windows and the judged theme leg (pure) ─────────────── */

/**
 * The veil's phase times from its trace (`__routeWorldReadiness().themeVeilTrace`
 * or `__routeThemeVeil().trace`; entries { phase, t } on the page clock),
 * restricted to entries at or after `sinceT` (the toggle).
 */
export function veilWindows(trace, sinceT) {
  const after = (Array.isArray(trace) ? trace : []).filter((e) => e && typeof e.t === 'number' && e.t >= sinceT - 1);
  const first = (phase, from = -Infinity) => after.find((e) => e.phase === phase && e.t >= from)?.t ?? null;
  const inAt = first('in');
  const opaqueAt = first('opaque', inAt ?? -Infinity);
  const commitAt = first('commit', opaqueAt ?? -Infinity);
  // The release after the (last) commit; a cancel-out before the commit is not it.
  const outAt = first('out', commitAt ?? Infinity);
  const idleAt = first('idle', outAt ?? Infinity);
  const aborted = after.some((e) => e.phase === 'abort');
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    inAt: round(inAt),
    opaqueAt: round(opaqueAt),
    commitAt: round(commitAt),
    outAt: round(outAt),
    idleAt: round(idleAt),
    aborted,
    timings: {
      toggleToIn: inAt === null ? null : Math.round(inAt - sinceT),
      fadeInMs: inAt === null || opaqueAt === null ? null : Math.round(opaqueAt - inAt),
      opaqueMs: opaqueAt === null || outAt === null ? null : Math.round(outAt - opaqueAt),
      fadeOutMs: outAt === null || idleAt === null ? null : Math.round(idleAt - outAt),
      totalMs: inAt === null || idleAt === null ? null : Math.round(idleAt - inAt),
    },
  };
}

const JUDGED = ['worldFetches', 'links', 'uploads', 'textureAllocs', 'longTasks'];

function emptyCounts() {
  return { worldFetches: 0, links: 0, uploads: 0, textureAllocs: 0, textureDeletes: 0, longTasks: 0, longTaskList: [], worldFetchUrls: [] };
}

/**
 * Split the theme leg's raw records into the veil's windows and judge them.
 *
 * @param {object} a
 * @param {object} a.raw       window.__quietProbe.window(toggleAt, endT) — { resources[{name,t}], longTasks[{t,d}], links[t], textures[{createdAt, firstDataAt, deletedAt}] }
 * @param {{url:string,t:number}[]} a.requests  the browser request channel on the page clock
 * @param {number} a.toggleAt  the harness's toggle (page clock)
 * @param {number} a.endT      the leg end (after the hold)
 * @param {ReturnType<typeof veilWindows>} a.veil
 * @param {(url: string) => boolean} a.isWorldAssetUrl
 * @param {number} [a.longTaskMs]
 *
 * Windows: `fadeIn` [toggleAt, opaqueAt), `opaque` [opaqueAt, outAt),
 * `after` [outAt, endT]. Judged: world fetches, GL links, texture pixel
 * uploads, texture allocations and long tasks — 0 in `fadeIn` and `after`;
 * `opaque` is where the new theme's work belongs (recorded). Deletes are
 * reported only. No veil (or an aborted one) is a fail; an unreadable veil
 * trace is unmeasured.
 */
export function veilJudge({ raw, requests = [], toggleAt, endT, veil, isWorldAssetUrl, longTaskMs = 50 }) {
  const reasons = [];
  if (!veil || veil.inAt === null) {
    return { verdict: 'fail', reasons: ['no theme veil after the toggle (the world was live: D32 requires the fade)'], windows: null };
  }
  if (veil.aborted) reasons.push('the veil aborted (the swap fell to Lite)');
  if (veil.opaqueAt === null || veil.commitAt === null || veil.outAt === null || veil.idleAt === null) {
    reasons.push(`the veil never completed (in ${veil.inAt}, opaque ${veil.opaqueAt}, commit ${veil.commitAt}, out ${veil.outAt}, idle ${veil.idleAt})`);
    return { verdict: 'fail', reasons, windows: null };
  }
  const bounds = {
    fadeIn: [toggleAt, veil.opaqueAt],
    opaque: [veil.opaqueAt, veil.outAt],
    after: [veil.outAt, endT],
  };
  const windows = { fadeIn: emptyCounts(), opaque: emptyCounts(), after: emptyCounts() };
  const place = (t) => {
    if (typeof t !== 'number' || t < toggleAt || t > endT) return null;
    if (t < veil.opaqueAt) return 'fadeIn';
    if (t < veil.outAt) return 'opaque';
    return 'after';
  };
  const perfWorld = { fadeIn: [], opaque: [], after: [] };
  for (const r of raw?.resources ?? []) {
    const w = place(r.t);
    if (w && isWorldAssetUrl(r.name)) perfWorld[w].push(r.name);
  }
  const reqWorld = { fadeIn: [], opaque: [], after: [] };
  for (const r of requests) {
    const w = place(r.t);
    if (w && isWorldAssetUrl(r.url)) reqWorld[w].push(r.url);
  }
  for (const w of Object.keys(windows)) {
    windows[w].worldFetches = Math.max(perfWorld[w].length, reqWorld[w].length);
    windows[w].worldFetchUrls = [...new Set([...perfWorld[w], ...reqWorld[w]])].slice(0, 8);
  }
  for (const t of raw?.links ?? []) {
    const w = place(t);
    if (w) windows[w].links += 1;
  }
  for (const rec of raw?.textures ?? []) {
    const up = place(rec.firstDataAt);
    if (up) windows[up].uploads += 1;
    const made = place(rec.createdAt);
    if (made) windows[made].textureAllocs += 1;
    const gone = place(rec.deletedAt);
    if (gone) windows[gone].textureDeletes += 1;
  }
  for (const e of raw?.longTasks ?? []) {
    if (!(e.d >= longTaskMs)) continue;
    const w = place(e.t);
    if (w) {
      windows[w].longTasks += 1;
      windows[w].longTaskList.push({ t: Math.round(e.t), d: Math.round(e.d) });
    }
  }
  for (const w of ['fadeIn', 'after']) {
    const c = windows[w];
    const bad = JUDGED.filter((k) => c[k] > 0).map((k) => `${k}=${c[k]}`);
    if (bad.length) {
      reasons.push(
        `${w === 'fadeIn' ? 'before the veil was opaque' : 'after the veil began to fade out'}: ${bad.join(', ')}${c.longTaskList.length ? ` (long tasks ${c.longTaskList.map((e) => `${e.d}ms@${e.t}`).join(', ')})` : ''}${c.worldFetchUrls.length ? ` (${c.worldFetchUrls.map((u) => u.replace(/^https?:\/\/[^/]+/, '')).join(', ')})` : ''}`,
      );
    }
  }
  return {
    verdict: reasons.length ? 'fail' : 'pass',
    reasons,
    bounds: Object.fromEntries(Object.entries(bounds).map(([k, [a, b]]) => [k, [Math.round(a), Math.round(b)]])),
    windows,
  };
}

/* ── D32: the Station Card under the veil (DOM chrome above it) ─────────── */

/**
 * Judge the Station Card's per-frame visibility through one veiled swap
 * (pure). Samples `{ t, present, id, alpha }` (alpha = computed opacity ×
 * filter opacity, 0 when absent or visibility-hidden; `id` changes on a
 * remount). The card is DOM chrome ABOVE the veil, so every change of it is
 * seen: it must never pop (|Δalpha| > `popDelta` between two frames — a
 * mount at full opacity, an unmount while shown, a jump), must be hidden
 * (alpha ≤ `hiddenMax`) the whole time the veil is opaque, and may change
 * state (shown ↔ not shown at alpha 0.5) at most twice from the veil's
 * fade-in to `settleMs` after it cleared: one hide, one show.
 *
 * No card in the window → verdict 'absent' (nothing to judge, recorded).
 *
 * Instant veil (both fades < `instantFadeMs`, or `reducedMotion`): exactly one
 * instant 1→0 inside [inAt − 20, opaqueAt + 50] and one instant 0→1 inside
 * [outAt − 20, idleAt + 50] are recorded as `instants`, not pops. Every other
 * jump, alpha > `hiddenMax` while opaque, and > 2 state changes still fail.
 */
export function cardVeilJudge(samples, veil, { popDelta = 0.4, hiddenMax = 0.02, settleMs = 400, reducedMotion = false, instantFadeMs = 50, instantSlackMs = [20, 50] } = {}) {
  if (!veil || veil.inAt === null || veil.opaqueAt === null || veil.outAt === null || veil.idleAt === null) {
    return { verdict: 'unmeasured', reasons: ['unmeasured: the veil did not complete, so the card has no windows'], samples: 0 };
  }
  // Harness fix (verifier 03 / D32 reduced motion): an INSTANT veil (both
  // fades < 50 ms, or a reduced-motion leg) swaps the card in the same frame
  // as the veil — one instant hide at the veil-in and one instant show at the
  // veil clear are the correct behaviour there, not pops.
  const fadeIn = veil.timings?.fadeInMs ?? (veil.opaqueAt - veil.inAt);
  const fadeOut = veil.timings?.fadeOutMs ?? (veil.idleAt - veil.outAt);
  const instantVeil = reducedMotion === true || (fadeIn < instantFadeMs && fadeOut < instantFadeMs);
  const [slackBefore, slackAfter] = instantSlackMs;
  const hideWindow = [veil.inAt - slackBefore, veil.opaqueAt + slackAfter];
  const showWindow = [veil.outAt - slackBefore, veil.idleAt + slackAfter];
  let hideAllowed = instantVeil;
  let showAllowed = instantVeil;
  const from = veil.inAt - 50;
  const to = veil.idleAt + settleMs;
  const s = (Array.isArray(samples) ? samples : []).filter((e) => e && typeof e.t === 'number' && e.t >= from && e.t <= to).sort((a, b) => a.t - b.t);
  if (s.length === 0) return { verdict: 'unmeasured', reasons: ['unmeasured: no card samples in the veil window'], samples: 0 };
  if (!s.some((e) => e.present)) return { verdict: 'absent', reasons: [], samples: s.length };
  const round = (v) => Math.round(v * 1000) / 1000;
  const pops = [];
  const instants = [];
  let changes = 0;
  let shown = s[0].alpha > 0.5;
  let maxGapMs = 0;
  const within = (t, [a, b]) => t >= a && t <= b;
  for (let i = 1; i < s.length; i += 1) {
    const a = s[i - 1];
    const b = s[i];
    maxGapMs = Math.max(maxGapMs, b.t - a.t);
    const delta = b.alpha - a.alpha;
    if (Math.abs(delta) > popDelta) {
      const kind = a.present && b.present && a.id !== b.id ? 'remount' : !a.present ? 'mount' : !b.present ? 'unmount' : 'jump';
      const row = { t: Math.round(b.t), from: round(a.alpha), to: round(b.alpha), kind, gapMs: Math.round(b.t - a.t) };
      const isHide = a.alpha > 0.5 && b.alpha <= 0.5;
      const isShow = a.alpha <= 0.5 && b.alpha > 0.5;
      if (isHide && hideAllowed && within(b.t, hideWindow)) {
        hideAllowed = false;
        instants.push({ ...row, as: 'instant-hide' });
      } else if (isShow && showAllowed && within(b.t, showWindow)) {
        showAllowed = false;
        instants.push({ ...row, as: 'instant-show' });
      } else {
        pops.push(row);
      }
    }
    const nowShown = b.alpha > 0.5;
    if (nowShown !== shown) {
      changes += 1;
      shown = nowShown;
    }
  }
  const opaque = s.filter((e) => e.t >= veil.opaqueAt + 16 && e.t < veil.outAt);
  const opaqueMax = opaque.reduce((m, e) => Math.max(m, e.alpha), 0);
  const mounts = new Set(s.filter((e) => e.present).map((e) => e.id)).size;
  // The evidence track: only the frames where something changed.
  const track = s
    .filter((e, i) => i === 0 || i === s.length - 1 || e.alpha !== s[i - 1].alpha || e.present !== s[i - 1].present || e.id !== s[i - 1].id || e.state !== s[i - 1].state)
    .slice(0, 400)
    .map((e) => ({ t: Math.round(e.t), a: e.alpha, ...(e.present ? { id: e.id, state: e.state ?? null } : { absent: true }) }));
  const reasons = [];
  if (pops.length) reasons.push(`card popped ${pops.length}x (${pops.slice(0, 4).map((p) => `${p.kind} ${p.from}->${p.to}@${p.t}`).join(', ')})`);
  if (opaqueMax > hiddenMax) reasons.push(`card shown over the opaque veil (max alpha ${round(opaqueMax)})`);
  if (changes > 2) reasons.push(`card changed state ${changes}x in one swap (at most one hide and one show)`);
  return {
    verdict: reasons.length ? 'fail' : 'pass',
    reasons,
    samples: s.length,
    maxGapMs: Math.round(maxGapMs),
    stateChanges: changes,
    mounts,
    opaqueMaxAlpha: round(opaqueMax),
    alphaAtIn: round(s[0].alpha),
    alphaAtEnd: round(s[s.length - 1].alpha),
    instantVeil,
    ...(instantVeil ? { instantWindows: { hide: hideWindow.map(Math.round), show: showWindow.map(Math.round) } } : {}),
    instants,
    pops,
    track,
  };
}

/** In-page: sample the Station Card's effective alpha every frame. */
function installCardSampler() {
  if (window.__chromeCardSampler) window.__chromeCardSampler.stop();
  const samples = [];
  const ids = new WeakMap();
  let next = 1;
  let raf = 0;
  const read = (t) => {
    const el = document.querySelector('[data-station-caption]');
    if (!el) return { t, present: false, id: 0, alpha: 0 };
    if (!ids.has(el)) ids.set(el, next++);
    const cs = getComputedStyle(el);
    let alpha = cs.visibility === 'hidden' || cs.display === 'none' ? 0 : Number(cs.opacity);
    const m = /opacity\(\s*([\d.]+)(%?)\s*\)/.exec(cs.filter || '');
    if (m) alpha *= m[2] ? Number(m[1]) / 100 : Number(m[1]);
    return { t, present: true, id: ids.get(el), alpha: Math.round(alpha * 1000) / 1000, state: el.getAttribute('data-card-state') };
  };
  const loop = () => {
    samples.push(read(performance.now()));
    if (samples.length > 6000) samples.splice(0, 1000);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  window.__chromeCardSampler = {
    stop() {
      cancelAnimationFrame(raf);
      delete window.__chromeCardSampler;
      return samples;
    },
  };
}

/** Start the per-frame card sampler; `stop()` returns the samples. */
export async function startCardSampler(page) {
  await page.evaluate(installCardSampler);
  return {
    stop: () =>
      page.evaluate(() => (window.__chromeCardSampler ? window.__chromeCardSampler.stop() : [])).catch(() => []),
  };
}

/* ── D33: the nav reveal probe ──────────────────────────────────────────── */

/** Every check passes (an unmeasured check is never a pass). */
export function navRevealVerdict(checks) {
  const failing = checks.filter((c) => c.pass !== true).map((c) => `${c.name}: ${c.pass === null ? 'unmeasured' : 'fail'}${c.detail ? ` (${c.detail})` : ''}`);
  return { pass: checks.length > 0 && failing.length === 0, failing };
}

/** rAF gaps + long tasks over [t0, t1] from the in-page recorder (pure). */
export function frameGapSummary(rafTimes, longTasks, t0, t1) {
  const times = (rafTimes ?? []).filter((t) => t >= t0 && t <= t1).sort((a, b) => a - b);
  let maxGap = 0;
  const gaps = [];
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    maxGap = Math.max(maxGap, gap);
    if (gap > 50) gaps.push({ t: Math.round(times[i - 1]), gap: Math.round(gap) });
  }
  const lts = (longTasks ?? []).filter((e) => e.t >= t0 && e.t <= t1 && e.d >= 50).map((e) => ({ t: Math.round(e.t), d: Math.round(e.d) }));
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  return {
    frames: times.length,
    fps: span > 0 ? Math.round(((times.length - 1) / span) * 1000 * 10) / 10 : null,
    maxGapMs: Math.round(maxGap),
    gapsOver50: gaps,
    longTasks: lts,
  };
}

/** In-page recorder: rAF stamps, long tasks, and the nav mark's changes. */
function installNavRecorder() {
  if (window.__navProbe) return;
  const rec = { raf: [], longTasks: [], marks: [] };
  window.__navProbe = rec;
  const loop = (t) => {
    rec.raf.push(t);
    if (rec.raf.length > 20000) rec.raf.splice(0, 10000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) rec.longTasks.push({ t: e.startTime, d: e.duration });
    }).observe({ type: 'longtask' });
  } catch {
    rec.longTaskUnsupported = true;
  }
  new MutationObserver(() => {
    rec.marks.push({ t: performance.now(), nav: document.documentElement.getAttribute('data-route-nav') });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-route-nav'] });
}

/** One read of the reveal state and the conductor's position. */
function readNavState() {
  const nav = document.getElementById('site-nav');
  const r = nav ? nav.getBoundingClientRect() : null;
  const cs = nav ? getComputedStyle(nav) : null;
  const active = document.activeElement;
  const chip = document.querySelector('.world-nav-hud-chip.is-active');
  const menu = document.querySelector('.world-nav-hud-menu');
  const drawer = [...document.querySelectorAll('[data-navbar-drawer]')].some((el) => el.getBoundingClientRect().width > 0);
  return {
    t: performance.now(),
    mark: document.documentElement.getAttribute('data-route-nav'),
    live: document.documentElement.classList.contains('world-route-live'),
    rect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) } : null,
    opacity: cs ? Number(cs.opacity) : null,
    visibility: cs ? cs.visibility : null,
    pointerEvents: cs ? cs.pointerEvents : null,
    scrollY: Math.round(window.scrollY),
    activeChip: chip ? chip.textContent.trim() : null,
    focusInNav: !!(nav && active && nav.contains(active)),
    focus: active && active !== document.body ? `${active.tagName.toLowerCase()}${active.className && typeof active.className === 'string' ? `.${active.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}${active.getAttribute('aria-label') ? `[${active.getAttribute('aria-label')}]` : ''}` : 'body',
    menuChip: menu ? { display: getComputedStyle(menu).display, expanded: menu.getAttribute('aria-expanded') } : null,
    drawerOpen: drawer,
  };
}

/* ── D33 touch: a verified-inert outside tap (harness fix, verifier 03) ── */

/** Hit kinds an outside tap may land on: the route canvas (sky), else the card's non-interactive text. */
const INERT_KINDS = ['canvas', 'card-text'];

/**
 * Pick the outside tap point (pure). `hits` = [{ x, y, kind, hit }] from
 * `classifyTapPoints` in candidate order; `subjectRects` = viewport-px rects
 * { x, y, w, h } of every focus subject / data face / figure (null = the
 * debug bridge was absent: unverified). A point is inert when it hits the
 * route canvas (preferred) or the Station Card's non-interactive text and
 * lies outside every subject rect grown by `pad`. Returns { point, rejected,
 * subjectsVerified }.
 */
export function pickInertTapPoint(hits, subjectRects, { pad = 12 } = {}) {
  const rects = Array.isArray(subjectRects) ? subjectRects.filter((r) => r && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number')) : [];
  const inside = (p, r) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
  const rejected = [];
  const ok = [];
  for (const h of Array.isArray(hits) ? hits : []) {
    if (!INERT_KINDS.includes(h.kind)) {
      rejected.push({ x: h.x, y: h.y, why: `hits ${h.kind} (${h.hit ?? '?'})` });
      continue;
    }
    const over = rects.find((r) => inside(h, r));
    if (over) {
      rejected.push({ x: h.x, y: h.y, why: `projects onto a focus subject${over.id ? ` (${over.id})` : ''}` });
      continue;
    }
    ok.push(h);
  }
  const point = ok.find((h) => h.kind === 'canvas') ?? ok[0] ?? null;
  return { point: point ? { x: point.x, y: point.y, kind: point.kind, hit: point.hit ?? null } : null, rejected, subjectsVerified: Array.isArray(subjectRects) };
}

/** Candidate outside points: the sky under the Station Card first, then a grid (pure). */
export function outsideTapCandidates(vp, card) {
  const w = vp.width;
  const h = vp.height;
  const clampY = (y) => Math.round(Math.min(h - 200, Math.max(110, y)));
  const out = [];
  if (card && typeof card.bottom === 'number') {
    for (const fx of [0.77, 0.23, 0.5, 0.9, 0.1]) out.push({ x: Math.round(w * fx), y: clampY(card.bottom + 40) });
  }
  for (const fy of [0.2, 0.28, 0.36, 0.44, 0.52, 0.6]) {
    for (const fx of [0.77, 0.23, 0.9, 0.1, 0.5]) out.push({ x: Math.round(w * fx), y: clampY(h * fy) });
  }
  const seen = new Set();
  return out.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** In-page: what each point hits (topmost element), plus every focus subject's viewport rect. */
function classifyTapPoints(points) {
  const describe = (el) =>
    el
      ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`
      : 'none';
  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[tabindex]:not([tabindex="-1"]),[onclick]';
  const canvasRoot = document.querySelector('[data-route-canvas]');
  const hits = points.map(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    let kind = 'other';
    if (!el) kind = 'none';
    else if (el.tagName.toLowerCase() === 'nextjs-portal' || el.closest('nextjs-portal')) kind = 'portal';
    else if (el.closest(INTERACTIVE)) kind = 'interactive';
    else if (canvasRoot && (canvasRoot === el || canvasRoot.contains(el))) kind = 'canvas';
    else if (el.closest('[data-station-caption]')) kind = 'card-text';
    return { x, y, kind, hit: describe(el) };
  });
  let subjects = null;
  let source = 'none';
  try {
    if (typeof window.__routeWorldOcclusion === 'function') {
      const rep = window.__routeWorldOcclusion({ nx: 1, ny: 1 });
      subjects = (rep?.rows ?? []).filter((r) => r.rect).map((r) => ({ id: `${r.kind}:${r.id}`, ...r.rect }));
      source = 'occlusion';
    } else if (typeof window.__routeWorldSubjects === 'function') {
      subjects = (window.__routeWorldSubjects()?.rows ?? []).filter((r) => r.rect).map((r) => ({ id: `${r.kind}:${r.id}`, ...r.rect }));
      source = 'subjects';
    }
  } catch (err) {
    subjects = null;
    source = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { hits, subjects, source };
}

/** In-page: focus mode entered? (a board= / ace= / plaque= param, or a mounted focus panel) */
function readFocusState() {
  const q = new URLSearchParams(window.location.search);
  const params = ['board', 'ace', 'plaque'].filter((k) => q.has(k)).map((k) => `${k}=${q.get(k)}`);
  return { params, panel: !!document.querySelector('.world-focus-panel') };
}

/** The bar counts as revealed when its top edge is at the viewport top and it is opaque. */
const isOpen = (s) => s.mark === 'open' && s.rect !== null && s.rect.top >= -1 && s.rect.top <= 1 && s.opacity >= 0.99;
/** Hidden: fully above the viewport (the slot is kept, the paint is off-screen). */
const isHidden = (s) => s.mark === null && s.rect !== null && s.rect.bottom <= 0;

/**
 * --nav-reveal-probe for one viewport (after the reveal gate). Fine pointer:
 * the top-edge dwell (closed at +60 ms, open by +450 ms), a screenshot of the
 * revealed bar, the close ~0.4 s after leaving, a fly-through that must not
 * open, then keyboard Tab from the page start (reveals, no scroll) and Esc
 * (closes, focus leaves the bar). Touch (--touch on): the HUD menu chip
 * reveals it, the NavBar hamburger drawer opens from the revealed bar, a tap
 * outside (a verified-inert point that enters no focus) closes it, Esc
 * closes it, and a station chip closes it; every tap is topmost-checked and
 * time-bounded, and a thrown step is a failing check — the -navreveal.json
 * is always written. Every step checks the
 * conductor (scrollY, active station) did not move; the first reveal's rAF
 * gaps and long tasks are measured.
 */
export async function runNavRevealProbe(page, { key, touch, outDir, tag, theme, writeJson, log = console.log }) {
  const checks = [];
  const shots = {};
  const check = (name, pass, detail = null) => {
    checks.push({ name, pass, ...(detail ? { detail } : {}) });
    log(`capture-route: [nav-reveal] ${key} ${pass === true ? 'PASS' : pass === null ? 'UNMEASURED' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const state = () => page.evaluate(readNavState);
  const shot = async (name) => {
    const file = `${tag}-${theme}-${key}-navreveal-${name}.png`;
    await page.screenshot({ path: resolve(outDir, file), animations: 'allow' });
    shots[name] = file;
  };
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const x = Math.round(vp.width / 2);
  await page.evaluate(installNavRecorder);
  await page.waitForTimeout(600);
  const base = await state();
  check('hidden by default (above the viewport, no mark)', isHidden(base), `rect ${JSON.stringify(base.rect)} mark ${base.mark} opacity ${base.opacity}`);
  check('the NavBar is reachable (not visibility:hidden)', base.visibility === 'visible', `visibility ${base.visibility}`);
  const conductorSame = (s, step) =>
    check(`${step}: conductor unchanged (scrollY, active station)`, s.scrollY === base.scrollY && s.activeChip === base.activeChip, `scrollY ${base.scrollY} -> ${s.scrollY}, station ${base.activeChip} -> ${s.activeChip}`);
  let firstReveal = null;
  const withTimeout = (promise, ms, what) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: timed out after ${ms} ms`)), ms))]);
  /**
   * Tap `locator`'s first element at a point where IT is the topmost element
   * (elementFromPoint; Next's dev <nextjs-portal> badge or a focus panel on
   * top is a named failure, never a 30 s actionability wait). Returns true
   * when tapped; a failure is recorded as a failing check named `name`.
   */
  const safeTap = async (locator, name, { timeoutMs = 3000 } = {}) => {
    try {
      if ((await locator.count()) === 0) {
        check(name, false, 'element absent');
        return false;
      }
      const probe = await locator.first().evaluate(
        (el) => {
          const describe = (n) =>
            n ? `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${typeof n.className === 'string' && n.className.trim() ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}` : 'none';
          const r = el.getBoundingClientRect();
          let intercept = null;
          for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
            const px = r.left + r.width * fx;
            const py = r.top + r.height * fy;
            if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) continue;
            const hit = document.elementFromPoint(px, py);
            if (hit && (hit === el || el.contains(hit))) return { top: true, x: Math.round(px), y: Math.round(py) };
            intercept ??= describe(hit);
          }
          return { top: false, intercept: intercept ?? 'off-screen', rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
        },
        undefined,
        { timeout: timeoutMs },
      );
      if (!probe.top) {
        check(name, false, `not the topmost element: intercepted by ${probe.intercept} (rect ${JSON.stringify(probe.rect)})`);
        return false;
      }
      await withTimeout(page.touchscreen.tap(probe.x, probe.y), timeoutMs, name);
      return true;
    } catch (err) {
      check(name, false, err instanceof Error ? err.message.split('\n')[0] : String(err));
      return false;
    }
  };

  let outsideTap = null;
  try {
    if (!touch) {
      check('menu chip hidden on a fine pointer (desktop HUD unchanged)', base.menuChip?.display === 'none', `display ${base.menuChip?.display ?? 'absent'}`);
      // 1. Dwell at the top edge (the first reveal: measured).
      await page.mouse.move(x, Math.round(vp.height / 2));
      await page.waitForTimeout(300);
      const t0 = await page.evaluate(() => performance.now());
      await page.mouse.move(x, 10, { steps: 6 });
      await page.waitForTimeout(60);
      const early = await state();
      check('no reveal before the dwell (+60 ms)', early.mark === null, `mark ${early.mark}`);
      await page.waitForTimeout(390);
      const open = await state();
      check('pointer at the top edge reveals the bar after the dwell', isOpen(open), `rect ${JSON.stringify(open.rect)} opacity ${open.opacity} mark ${open.mark}`);
      check('the revealed bar takes pointer events', open.pointerEvents === 'auto', `pointer-events ${open.pointerEvents}`);
      conductorSame(open, 'hover reveal');
      await page.waitForTimeout(700);
      const t1 = t0 + 1500;
      const rec = await page.evaluate(() => ({ raf: window.__navProbe.raf, lt: window.__navProbe.longTasks, marks: window.__navProbe.marks }));
      const openedAt = rec.marks.find((m) => m.t >= t0 && m.nav === 'open')?.t ?? null;
      firstReveal = { dwellFromMoveMs: openedAt === null ? null : Math.round(openedAt - t0), ...frameGapSummary(rec.raf, rec.lt, t0, t1) };
      check('first reveal: no long task and no frame gap > 100 ms', firstReveal.longTasks.length === 0 && firstReveal.maxGapMs <= 100, `maxGap ${firstReveal.maxGapMs} ms, long tasks ${firstReveal.longTasks.length}, fps ${firstReveal.fps}`);
      await shot('open');
      // 2. Leave: still open inside the close delay, closed after it.
      await page.mouse.move(x, Math.round(vp.height * 0.6), { steps: 3 });
      await page.waitForTimeout(200);
      const lingering = await state();
      check('stays open inside the ~0.4 s close delay', lingering.mark === 'open', `mark ${lingering.mark}`);
      await page.waitForTimeout(700);
      const closed = await state();
      check('slides away ~0.4 s after the pointer leaves', isHidden(closed), `rect ${JSON.stringify(closed.rect)} mark ${closed.mark}`);
      conductorSame(closed, 'hover close');
      // 3. Fly-through toward the tabs: in and out of the zone inside the dwell.
      await page.mouse.move(x, 300);
      await page.waitForTimeout(100);
      await page.mouse.move(x, 6, { steps: 2 });
      await page.waitForTimeout(30);
      await page.mouse.move(x, 300, { steps: 2 });
      await page.waitForTimeout(400);
      const fly = await state();
      check('a pointer passing through the zone does not open it', fly.mark === null && isHidden(fly), `mark ${fly.mark}`);
      // 4. Keyboard: Tab from the page start, then Esc.
      await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.tabIndex = -1;
        probe.id = '__nav-probe-start';
        document.body.prepend(probe);
        probe.focus({ preventScroll: true });
      });
      await page.keyboard.press('Tab');
      await page.evaluate(() => document.getElementById('__nav-probe-start')?.remove());
      await page.waitForTimeout(450);
      const tabbed = await state();
      check('Tab from the page start reaches the bar and reveals it', tabbed.focusInNav && isOpen(tabbed), `focus ${tabbed.focus}, mark ${tabbed.mark}, rect ${JSON.stringify(tabbed.rect)}`);
      conductorSame(tabbed, 'Tab reveal');
      await shot('focus');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
      const escaped = await state();
      check('Esc closes it and moves focus out of the bar', isHidden(escaped) && !escaped.focusInNav, `focus ${escaped.focus}, mark ${escaped.mark}`);
      conductorSame(escaped, 'Esc');
      // Esc with the pointer resting in the zone: no re-open until it leaves.
      await page.mouse.move(x, 8, { steps: 3 });
      await page.waitForTimeout(450);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const suppressed = await state();
      check('Esc with the pointer at the edge: stays closed until the pointer leaves', suppressed.mark === null, `mark ${suppressed.mark}`);
      await page.mouse.move(x, Math.round(vp.height / 2), { steps: 3 });
      await page.waitForTimeout(500);
    } else {
      // Touch: the HUD menu chip. Every tap goes through safeTap (topmost-
      // element check, short timeout, named failure) so one blocked tap never
      // aborts the run before the -navreveal.json is written.
      check('menu chip shown on a coarse pointer', base.menuChip !== null && base.menuChip.display !== 'none', `display ${base.menuChip?.display ?? 'absent'}`);
      const menuChip = page.locator('.world-nav-hud-menu');
      const t0 = await page.evaluate(() => performance.now());
      const chipTapped = await safeTap(menuChip, 'chip reveal: tap the menu chip');
      await page.waitForTimeout(450);
      const open = await state();
      check('the menu chip reveals the bar (aria-expanded)', chipTapped ? isOpen(open) && open.menuChip?.expanded === 'true' : null, `mark ${open.mark} expanded ${open.menuChip?.expanded} rect ${JSON.stringify(open.rect)}`);
      conductorSame(open, 'chip reveal');
      await page.waitForTimeout(1100);
      const rec = await page.evaluate(() => ({ raf: window.__navProbe.raf, lt: window.__navProbe.longTasks }));
      firstReveal = frameGapSummary(rec.raf, rec.lt, t0, t0 + 1500);
      check('first reveal: no long task and no frame gap > 100 ms', firstReveal.longTasks.length === 0 && firstReveal.maxGapMs <= 100, `maxGap ${firstReveal.maxGapMs} ms, long tasks ${firstReveal.longTasks.length}, fps ${firstReveal.fps}`);
      await shot('chip');
      const hamburger = page.locator('#site-nav button[aria-label="Toggle menu"]');
      if ((await hamburger.count()) > 0 && (await hamburger.first().isVisible())) {
        const opened = await safeTap(hamburger, 'drawer: tap the NavBar hamburger');
        await page.waitForTimeout(600);
        const drawer = await state();
        check('the NavBar hamburger drawer opens from the revealed bar', opened ? drawer.drawerOpen && drawer.mark === 'open' : null, `drawer ${drawer.drawerOpen} mark ${drawer.mark}`);
        if (opened) await shot('drawer');
        const close = page.locator('button[aria-label="Close menu"]');
        const closed = (await close.count()) > 0 ? await safeTap(close, 'drawer: tap Close menu') : false;
        await page.waitForTimeout(600);
        const after = await state();
        check('closing the drawer keeps the bar (a press in the drawer is inside)', closed ? !after.drawerOpen && after.mark === 'open' : null, `drawer ${after.drawerOpen} mark ${after.mark}`);
      } else {
        check('the NavBar hamburger is visible on the revealed bar', null, 'hamburger not visible at this width');
      }
      // A tap OUTSIDE on a verified-inert point: the route canvas (sky) or the
      // card's non-interactive text, never a focus subject / data face (at 390
      // the old centre tap landed on the pulse board and entered board focus).
      const focusBefore = await page.evaluate(readFocusState);
      const card = await page.evaluate(() => {
        const el = document.querySelector('[data-station-caption]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      });
      const classified = await page.evaluate(classifyTapPoints, outsideTapCandidates(vp, card));
      const pick = pickInertTapPoint(classified.hits, classified.subjects);
      outsideTap = { ...pick, subjectSource: classified.source, subjects: classified.subjects?.length ?? null, rejected: pick.rejected.slice(0, 12) };
      check(
        'outside tap point verified inert (route canvas / card text, off every focus subject)',
        pick.point !== null && pick.subjectsVerified,
        pick.point ? `(${pick.point.x}, ${pick.point.y}) hits ${pick.point.kind} ${pick.point.hit}; subjects ${classified.subjects?.length ?? 'unread'} via ${classified.source}` : `no inert point among ${classified.hits.length} candidates (${pick.rejected.slice(0, 3).map((r) => `${r.x},${r.y}: ${r.why}`).join('; ')})`,
      );
      if (pick.point) {
        await withTimeout(page.touchscreen.tap(pick.point.x, pick.point.y), 3000, 'outside tap');
        await page.waitForTimeout(450);
        const outside = await state();
        const focusAfter = await page.evaluate(readFocusState);
        check('a tap outside closes it', isHidden(outside) && outside.menuChip?.expanded === 'false', `mark ${outside.mark} expanded ${outside.menuChip?.expanded}`);
        const newParams = focusAfter.params.filter((p) => !focusBefore.params.includes(p));
        check('the outside tap stayed inert (no board= / ace= / plaque= param, no focus panel)', newParams.length === 0 && (!focusAfter.panel || focusBefore.panel), `params ${focusAfter.params.join('&') || 'none'}, focus panel ${focusAfter.panel}`);
      } else {
        check('a tap outside closes it', null, 'no verified-inert outside point');
      }
      // Esc closes a chip-opened bar too.
      const reopened = await safeTap(menuChip, 'chip Esc: tap the menu chip');
      await page.waitForTimeout(400);
      if (reopened) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(450);
        const esc = await state();
        check('Esc closes a chip-opened bar', isHidden(esc), `mark ${esc.mark}`);
        conductorSame(esc, 'chip Esc');
      } else {
        check('Esc closes a chip-opened bar', null, 'the menu chip could not be tapped');
      }
      // A station chip closes it (the conductor then moves by design).
      const reopened2 = await safeTap(menuChip, 'station chip: tap the menu chip');
      await page.waitForTimeout(400);
      const other = page.locator('.world-nav-hud-track a:not(.is-active)');
      if (reopened2 && (await other.count()) > 0) {
        const chose = await safeTap(other, 'station chip: tap a station chip');
        await page.waitForTimeout(450);
        const station = await state();
        check('choosing a station chip closes it', chose ? isHidden(station) : null, `mark ${station.mark}`);
      } else {
        check('choosing a station chip closes it', null, reopened2 ? 'no inactive station chip' : 'the menu chip could not be tapped');
      }
    }
  } catch (err) {
    check('the probe ran to completion', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
  }
  const verdict = navRevealVerdict(checks);
  const file = `${tag}-${theme}-${key}-navreveal.json`;
  await writeJson(resolve(outDir, file), {
    kind: 'nav-reveal',
    viewport: key,
    theme,
    touch,
    pass: verdict.pass,
    failing: verdict.failing,
    base,
    firstReveal,
    ...(touch ? { outsideTap } : {}),
    checks,
    shots,
    notes: [
      'touch: every tap is checked topmost first (elementFromPoint on the target; an interceptor such as Next\'s dev <nextjs-portal> badge is a named failing check, 3 s bound); the outside tap is a verified-inert point (outsideTap: route canvas or card text, off every __routeWorldOcclusion subject rect) and must add no board= / ace= / plaque= param and no .world-focus-panel',
      'D33: hidden = fully above the viewport with no data-route-nav mark; open = top edge at 0, opacity 1, mark "open"',
      'conductor = window.scrollY and the HUD active station chip, unchanged by every reveal / close / Esc step',
      'firstReveal = rAF gaps and Long Tasks (>= 50 ms) over 1.5 s from the first reveal gesture',
    ],
  });
  log(`capture-route: [nav-reveal] ${key} -> ${file} pass=${verdict.pass}${verdict.failing.length ? ` (failing: ${verdict.failing.join('; ')})` : ''}`);
  return { pass: verdict.pass, file, failing: verdict.failing };
}

/* ── D32: the veil film ────────────────────────────────────────────────── */

/**
 * Write a film's frames (startLoaderFilm's stop() result) as JPEGs under
 * `<dir>/`, with a frame index (page-clock t, epoch) and a contact sheet of
 * up to `sheetFrames` evenly spaced frames. Returns the summary.
 */
export async function writeVeilFilm(film, { outDir, base, timeOrigin, windows, sheetFrames = 16, width = 360 }) {
  const dir = resolve(outDir, `${base}-veilfilm`);
  await mkdir(dir, { recursive: true });
  const frames = film.frames.map((f, i) => ({ i, t: Math.round((f.epochMs - timeOrigin) * 10) / 10, kind: f.kind ?? 'screencast', data: f.data }));
  const index = [];
  for (const f of frames) {
    const name = `${String(f.i).padStart(4, '0')}.jpg`;
    await writeFile(resolve(dir, name), f.data);
    index.push({ file: name, t: f.t, kind: f.kind });
  }
  let maxGap = 0;
  for (let i = 1; i < frames.length; i += 1) maxGap = Math.max(maxGap, frames[i].t - frames[i - 1].t);
  let sheet = null;
  if (frames.length > 0) {
    const pick = [];
    const n = Math.min(sheetFrames, frames.length);
    for (let k = 0; k < n; k += 1) pick.push(frames[Math.round((k * (frames.length - 1)) / Math.max(1, n - 1))]);
    const meta = await sharp(pick[0].data).metadata();
    const h = Math.round((width * (meta.height ?? 9)) / (meta.width ?? 16));
    const cols = 4;
    const rows = Math.ceil(pick.length / cols);
    const tiles = await Promise.all(pick.map((f) => sharp(f.data).resize(width, h).jpeg({ quality: 80 }).toBuffer()));
    const sheetPath = resolve(outDir, `${base}-veilfilm-sheet.jpg`);
    await sharp({ create: { width: cols * width, height: rows * h, channels: 3, background: '#808080' } })
      .composite(tiles.map((input, k) => ({ input, left: (k % cols) * width, top: Math.floor(k / cols) * h })))
      .jpeg({ quality: 82 })
      .toFile(sheetPath);
    sheet = { file: `${base}-veilfilm-sheet.jpg`, frames: pick.map((f) => f.t) };
  }
  const summary = { dir: `${base}-veilfilm`, frames: frames.length, source: film.source, dropped: film.dropped, maxFrameGapMs: Math.round(maxGap), windows, sheet };
  await writeFile(resolve(dir, 'index.json'), JSON.stringify({ ...summary, index }, null, 2));
  return summary;
}

/**
 * LOOK pilot round 6 (D28), SEAT H: helpers for the capture harness
 * (scripts/capture-route.mjs). Pure functions plus a few self-contained
 * in-page recorders (functions handed to page.addInitScript, which must
 * reference nothing outside themselves).
 *
 *  H1  prod timeout inject: the scene chunk is found by CONTENT (the R3F
 *      hook error string), because hashed production chunk URLs never match
 *      the dev URL regex; the world manifest is the fallback hold.
 *  H2  station-content keying: the world comes from the DOM ([data-world],
 *      evoliga -> plaza), the key carries the device pixel ratio and the
 *      quality rung, with a fallback chain to the older keys.
 *  H3  the D27 canonical blast baseline (sakura), BASELINE-IBL-UNKNOWN and
 *      the DOM Station Card rect masked out of a still diff.
 *  H4  the quiet file name carries the theme.
 *  H5  a repeat-pose contrast noise band, the saturated-cell fallback and a
 *      ball / scene phase trace recorded from navigation.
 *  H6  loader-phase long animation frames, GPU-trace phase marks, the GPU
 *      trace categories and a program-key audit (ENGINE E7).
 *  H7  --dolly-at stills, the throttled network profile and the shader-source
 *      stability diff of the warm-cache leg.
 */

// ---------------------------------------------------------------------------
// Flags (capture-route merges these into its flag tables)
// ---------------------------------------------------------------------------

/** Value-less round-6 flags (skipped by the positional collector, never VALUE_FLAGS). */
export const R6_BARE_FLAGS = ['--gpu-trace', '--program-keys', '--warm-cache', '--contrast-repeat', '--look-probe'];
/** Value-taking round-6 flags. */
export const R6_VALUE_FLAGS = ['--dolly-at', '--net-throttle'];

function valueOf(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null;
}

/**
 * Parse the round-6 flags. `context` = the already-parsed evidence arms the
 * dependencies are checked against ({ loaderTrace, sweepFilm, luma }).
 * Returns { flags, errors } (capture-route prints errors and exits 2).
 */
export function parseR6Flags(argv, context = {}) {
  const errors = [];
  const gpuTrace = argv.includes('--gpu-trace');
  const programKeys = argv.includes('--program-keys');
  const warmCache = argv.includes('--warm-cache');
  const contrastRepeat = argv.includes('--contrast-repeat');
  const lookProbe = argv.includes('--look-probe');
  if (gpuTrace && !context.loaderTrace) errors.push('--gpu-trace records the loader window; add --loader-trace');
  if (warmCache && !context.loaderTrace) errors.push('--warm-cache compares with the cold reveal of the same run; add --loader-trace');
  if (contrastRepeat && !context.luma) errors.push('--contrast-repeat repeats the --luma contrast read; add --luma on');
  const dollyRaw = valueOf(argv, '--dolly-at');
  let dollyAt = null;
  if (dollyRaw !== null) {
    const parsed = parseDollyAt(dollyRaw);
    if (parsed.error) errors.push(parsed.error);
    else dollyAt = parsed.points;
    if (!context.sweepFilm) errors.push('--dolly-at takes its frames from the sweep film; add --sweep-film (with --sweep <mode> or --chip-jump)');
  }
  const throttleRaw = valueOf(argv, '--net-throttle');
  let netThrottle = null;
  if (throttleRaw !== null) {
    const parsed = parseNetThrottle(throttleRaw);
    if (parsed.error) errors.push(parsed.error);
    else netThrottle = parsed;
  }
  return {
    flags: {
      gpuTrace,
      programKeys,
      warmCache,
      contrastRepeat,
      lookProbe,
      dollyAt,
      netThrottle,
    },
    errors,
  };
}

/** The invocation record of the round-6 flags (keys present only when on). */
export function r6InvocationArgs(flags) {
  if (!flags) return {};
  return {
    ...(flags.gpuTrace ? { gpuTrace: true } : {}),
    ...(flags.programKeys ? { programKeys: true } : {}),
    ...(flags.warmCache ? { warmCache: true } : {}),
    ...(flags.contrastRepeat ? { contrastRepeat: true } : {}),
    ...(flags.lookProbe ? { lookProbe: true } : {}),
    ...(flags.dollyAt ? { dollyAt: flags.dollyAt } : {}),
    ...(flags.netThrottle ? { netThrottle: flags.netThrottle } : {}),
  };
}

// ---------------------------------------------------------------------------
// H1: the production timeout inject
// ---------------------------------------------------------------------------

/**
 * A stable string the React Three Fiber bundle carries (its hook guard's
 * error). Verified in @react-three/fiber 9.7 dist events-*.js and in exactly
 * one production chunk of the r5 build (.next/static/chunks/0dl47ugl1o-_4.js).
 */
export const SCENE_CHUNK_MARKER = 'R3F: Hooks can only be used within the Canvas component';
/** The dev (Turbopack) chunk URL of the fiber module: the pre-r6 fast path. */
export const DEV_SCENE_CHUNK_RE = /(%40|@)react-three[_/]fiber/;
const NEXT_CHUNK_PATH_RE = /\/_next\/static\/chunks\/.+\.js$/;
// D42 commit P: the shipped manifest is manifest.v3.json (WORLD_MANIFEST_FILE); arm mirrors and older builds read manifest.json.
const WORLD_MANIFEST_PATH_RE = /(\/models\/world\/|\/world-assets\/)(.*\/)?manifest(\.[a-z0-9-]+)*\.json$/;

function pathOf(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

/** A Next.js client chunk (/_next/static/chunks/*.js). */
export function isNextChunkUrl(url) {
  const p = pathOf(url);
  return p !== null && NEXT_CHUNK_PATH_RE.test(p);
}

/** The world asset manifest (local mirror /models/world or the world-assets bucket). */
export function isWorldManifestUrl(url) {
  const p = pathOf(url);
  return p !== null && WORLD_MANIFEST_PATH_RE.test(p);
}

function textOf(body) {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  return null;
}

/**
 * How a request is the lazily loaded scene chunk: 'url' (the dev URL regex),
 * 'content' (a Next chunk whose body carries SCENE_CHUNK_MARKER — the only
 * way to find it among hashed production chunks), or null.
 */
export function sceneChunkMatch(url, body = null) {
  if (typeof url !== 'string') return null;
  if (DEV_SCENE_CHUNK_RE.test(url)) return 'url';
  if (!isNextChunkUrl(url)) return null;
  const text = textOf(body);
  return text !== null && text.includes(SCENE_CHUNK_MARKER) ? 'content' : null;
}

/** True when the request is the scene chunk (by URL in dev, by content in prod). */
export function isSceneChunk(url, body = null) {
  return sceneChunkMatch(url, body) !== null;
}

/** The requests the timeout inject routes: the dev chunk URL, every Next chunk (sniffed) and the manifest. */
export function timeoutRoutePredicate(url) {
  return typeof url === 'string' && (DEV_SCENE_CHUNK_RE.test(url) || isNextChunkUrl(url) || isWorldManifestUrl(url));
}

/**
 * The manifest fallback: the world manifest is held only while no scene
 * chunk has been held (a build whose chunk lacks the marker still reaches
 * the deadline, because the world cannot load its assets).
 */
export function manifestFallbackHolds(held) {
  return !(Array.isArray(held) ? held : []).some((h) => h && (h.by === 'url' || h.by === 'content'));
}

/** Response headers safe to re-send with a decoded body (encoding / length recomputed). */
export function fulfilHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    const lk = k.toLowerCase();
    if (lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') continue;
    out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// H2: station-content keying
// ---------------------------------------------------------------------------

/** WorldShell `data-world` token namespace -> route world id. */
export const WORLD_BY_NAMESPACE = { evoliga: 'plaza', sakura: 'sakura', mountain: 'mountain', clouds: 'clouds' };

/** The route world of a `[data-world]` token (evoliga -> plaza; unknown tokens pass through). */
export function worldFromDataWorld(ns) {
  if (typeof ns !== 'string' || ns.length === 0) return null;
  return WORLD_BY_NAMESPACE[ns] ?? ns;
}

/**
 * The world a still belongs to: the DOM token wins (it is what rendered —
 * a --page-path league page has no --world), then --world, then plaza.
 */
export function resolveCaptureWorld({ flagWorld = null, domNamespace = null } = {}) {
  const dom = worldFromDataWorld(domNamespace);
  const world = dom ?? flagWorld ?? 'plaza';
  return {
    world,
    source: dom ? 'dom [data-world]' : flagWorld ? '--world' : 'default (plaza)',
    domNamespace: domNamespace ?? null,
    flagWorld: flagWorld ?? null,
    mismatch: dom !== null && flagWorld !== null && dom !== flagWorld,
  };
}

/** `d<dpr>` key segment (null for an unusable dpr). */
export function dprToken(dpr) {
  const n = Number(dpr);
  if (dpr === null || dpr === undefined || !Number.isFinite(n) || n <= 0) return null;
  return `d${+n.toFixed(3)}`;
}

/**
 * The baseline keys of one still, most specific first:
 *  - exact        `<world>|<theme>|<station>|<vp>|d<dpr>|q<rung>`
 *  - legacy-rung  `<world>|<theme>|<station>|<vp>|q<rung>` (LOOK r4 key; dpr unknown)
 *  - legacy       `<world>|<theme>|<station>|<vp>` (rung-less; the largest count seen)
 * With no rung read, the exact key is `...|d<dpr>` and there is no rung link.
 */
export function contentBaselineChain({ world, theme, station, viewport, dpr = null, rung = null }) {
  const base = `${world ?? 'plaza'}|${theme ?? 'light'}|${station}|${viewport}`;
  const d = dprToken(dpr);
  const q = Number.isInteger(rung) ? `q${rung}` : null;
  const chain = [];
  if (d && q) chain.push({ key: `${base}|${d}|${q}`, kind: 'exact', dprMatched: true, rungMatched: true });
  else if (d) chain.push({ key: `${base}|${d}`, kind: 'exact', dprMatched: true, rungMatched: null });
  if (q) chain.push({ key: `${base}|${q}`, kind: 'legacy-rung', dprMatched: null, rungMatched: true });
  chain.push({ key: base, kind: 'legacy', dprMatched: null, rungMatched: q ? false : null });
  return chain;
}

/**
 * The first link of the chain with a numeric entry. A legacy entry that
 * records its own dpr / rung (re-keyed or recorded since round 6) is
 * compared with the still's, so a match is only claimed when it holds.
 */
export function pickContentBaseline(entries, chain, { dpr = null, rung = null } = {}) {
  for (const link of Array.isArray(chain) ? chain : []) {
    const entry = entries ? entries[link.key] : null;
    if (!entry || typeof entry.renderables !== 'number') continue;
    let { dprMatched, rungMatched } = link;
    if (dprMatched === null && typeof entry.dpr === 'number' && dpr !== null) dprMatched = dprToken(entry.dpr) === dprToken(dpr);
    if (link.kind === 'legacy' && typeof entry.rung === 'number' && Number.isInteger(rung)) rungMatched = entry.rung === rung;
    return { ...link, dprMatched, rungMatched, entry };
  }
  return null;
}

/**
 * A content verdict against a baseline recorded at another rung or dpr is
 * not a content claim: a `fail` there becomes `suspect` (logged, never an
 * exit), with the key to record. Anything else passes through.
 */
export function contentFallbackVerdict(verdict, pick, exactKey = null) {
  if (!verdict || verdict.verdict !== 'fail' || !pick) return verdict;
  const mismatched = [];
  if (pick.rungMatched === false) mismatched.push('quality rung');
  if (pick.dprMatched === false) mismatched.push('device pixel ratio');
  if (!mismatched.length) return verdict;
  return {
    ...verdict,
    verdict: 'suspect',
    reason: 'below-a-baseline-of-another-rung-or-dpr',
    failedAgainst: pick.key,
    suspectBecause: `the baseline ${pick.key} was recorded at another ${mismatched.join(' and ')}; the count is not comparable${exactKey ? ` (record ${exactKey} with --content-baseline record on an accepted run)` : ''}`,
  };
}

// ---------------------------------------------------------------------------
// H3: canonical baselines, IBL flags, the Station Card mask
// ---------------------------------------------------------------------------

/**
 * D27 (lead, 2026-09-28): the canonical blast baseline per world, as tag
 * prefixes ranked before every other candidate of the same pose rank.
 * Sakura is measured against the pre-pilot fid-w2c-r2 stills (correct IBL);
 * look-before-blast-sakura recorded the black-IBL bug.
 */
export const CANONICAL_BASELINES = { sakura: ['fid-w2c-r2-sakura-light'] };

/** Canonical tag prefixes of a world ([] for none). */
export function canonicalBaselinesFor(world) {
  return CANONICAL_BASELINES[world] ?? [];
}

/** Whether a candidate tag is canonical for the given prefixes. */
export function isCanonicalTag(tag, prefer) {
  return typeof tag === 'string' && (Array.isArray(prefer) ? prefer : []).some((p) => typeof p === 'string' && p.length > 0 && (tag === p || tag.startsWith(`${p}`)));
}

/**
 * Baseline flags from a before still's sidecar: BASELINE-IBL-UNKNOWN when it
 * predates the iblState read (LOOK r4), BASELINE-IBL-BLACK when the capture
 * itself recorded a black prefiltered IBL.
 */
export function baselineIblFlags(sidecar) {
  if (!sidecar) return [];
  if (!sidecar.iblState || typeof sidecar.iblState !== 'object') return ['BASELINE-IBL-UNKNOWN'];
  if (sidecar.iblState.verdict === 'black') return ['BASELINE-IBL-BLACK'];
  if (sidecar.iblState.verdict === 'unmeasured') return ['BASELINE-IBL-UNKNOWN'];
  return [];
}

/** Padding (frame px) around the Station Card when it is masked out of a diff. */
export const CARD_MASK_PAD_PX = 4;

/**
 * The DOM Station Card rect a still composited, in frame px, padded (the
 * card is DOM chrome, like the HUD band: its copy is not a render change).
 * `stationCard.framePx` is the pasted layer; older sidecars fall back to the
 * content rect scaled by the frame scale. [] when no card was composited.
 */
export function stationCardMaskOf(sidecar, { padPx = CARD_MASK_PAD_PX } = {}) {
  const card = sidecar?.stationCard;
  if (!card || card.present === false || card.hidden === true) return [];
  const fp = card.framePx;
  if (fp && fp.width > 0 && fp.height > 0) {
    return [{ id: 'station-card', x: Math.floor(fp.left - padPx), y: Math.floor(fp.top - padPx), w: Math.ceil(fp.width + 2 * padPx), h: Math.ceil(fp.height + 2 * padPx) }];
  }
  if (card.composite !== 'content-box') return [];
  const r = card.contentRect ?? card.cardRect;
  if (!r || !(r.w > 0) || !(r.h > 0)) return [];
  const frame = sidecar?.lumaInputs?.frame ?? sidecar?.diffRects?.frame ?? null;
  const scale = typeof frame?.scale === 'number' ? frame.scale : 1;
  return [{ id: 'station-card', x: Math.floor(r.x * scale - padPx), y: Math.floor(r.y * scale - padPx), w: Math.ceil(r.w * scale + 2 * padPx), h: Math.ceil(r.h * scale + 2 * padPx) }];
}

// ---------------------------------------------------------------------------
// H4: the quiet file name
// ---------------------------------------------------------------------------

/** `<tag>-<theme>-<viewport>-quiet.json` (a dark run never overwrites the light record). */
export function quietFileName(tag, theme, viewportKey) {
  return `${tag}-${theme}-${viewportKey}-quiet.json`;
}

// ---------------------------------------------------------------------------
// H5: contrast noise band, saturated-cell fallback, phase trace from navigation
// ---------------------------------------------------------------------------

/** The smallest band a contrast delta is judged against (WCAG ratio units). */
export const CONTRAST_NOISE_FLOOR = 0.05;

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The repeat-pose noise band: the same pose presented twice in one load,
 * contrast read on each (glyph tiles inside the face, the outer tile ring
 * never judged). Per face: both minimum / median contrasts, their |delta|,
 * and `band` = max(|delta|, floor). A later before/after dip within the band
 * is noise, not a regression (labelContrastDelta).
 */
export function contrastRepeatBand(a, b, { floor = CONTRAST_NOISE_FLOOR } = {}) {
  const byId = (x) => Object.fromEntries((Array.isArray(x?.faces) ? x.faces : []).filter((f) => f && f.id).map((f) => [f.id, f]));
  const fa = byId(a);
  const fb = byId(b);
  const ids = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  const faces = ids.map((id) => {
    const minA = numOrNull(fa[id]?.minContrast);
    const minB = numOrNull(fb[id]?.minContrast);
    const medA = numOrNull(fa[id]?.medianContrast);
    const medB = numOrNull(fb[id]?.medianContrast);
    const delta = minA !== null && minB !== null ? +Math.abs(minA - minB).toFixed(3) : null;
    const medianDelta = medA !== null && medB !== null ? +Math.abs(medA - medB).toFixed(3) : null;
    return { id, minA, minB, delta, medianA: medA, medianB: medB, medianDelta, band: delta === null ? null : +Math.max(delta, floor).toFixed(3) };
  });
  const measured = faces.filter((f) => f.band !== null);
  return {
    verdict: measured.length ? 'measured' : 'unmeasured',
    ...(measured.length ? {} : { reason: 'no face was measured on both presents' }),
    faces,
    bandMax: measured.length ? Math.max(...measured.map((f) => f.band)) : null,
    floor,
    rule: `the same pose presented twice in one load; band = max(|minContrast A - B|, ${floor}); a before -> after dip within the band is noise`,
  };
}

/** Label a before -> after contrast change against a noise band. */
export function labelContrastDelta(before, after, band) {
  if (numOrNull(before) === null || numOrNull(after) === null || numOrNull(band) === null) return { label: 'unmeasured' };
  const delta = +(after - before).toFixed(3);
  return { label: Math.abs(delta) <= band ? 'noise' : delta < 0 ? 'regression' : 'improvement', delta, band };
}

/** Mean / standard deviation of Rec.709 luma inside a frame-px rect (null when empty). */
export function rectLumaStats(img, rect) {
  const c = img.channels ?? 3;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * img.width + x) * c;
      const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      sum += l;
      sq += l * l;
      n += 1;
    }
  }
  if (!n) return null;
  const mean = sum / n;
  return { px: n, mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(2) };
}

/**
 * Face-internal luma of both presents per face (the inner 25%-inset rect):
 * |mean A - mean B| is the pixel noise of the face copy at that pose.
 */
export function innerFaceRepeat(imgA, imgB, faces, { inset = 0.25 } = {}) {
  return (Array.isArray(faces) ? faces : []).map((f) => {
    const r = { x: f.x + f.w * inset, y: f.y + f.h * inset, w: f.w * (1 - 2 * inset), h: f.h * (1 - 2 * inset) };
    if (!(r.w >= 2 && r.h >= 2)) return { id: f.id, verdict: 'unmeasured', reason: 'inner rect too small' };
    const a = rectLumaStats(imgA, r);
    const b = rectLumaStats(imgB, r);
    if (!a || !b) return { id: f.id, verdict: 'unmeasured', reason: 'inner rect off frame' };
    return { id: f.id, verdict: 'measured', rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, a, b, meanDelta: +Math.abs(a.mean - b.mean).toFixed(2), stdDelta: +Math.abs(a.std - b.std).toFixed(2) };
  });
}

/** Inner-face diff share above which a saturated cell's fallback fails (the r6 brief's calm-pixel bar). */
export const INNER_FACE_DIFF_MAX_PCT = 0.5;

/**
 * A saturated luma cell (face P99 and outside P99.5 both clipped, e.g. the
 * rung-2 light cells at 254.88) carries no C-044 information. Fallback order:
 *  1. the rendered-pixel contrast when it measured text tiles;
 *  2. else the inner-face diff against the --diff-against baseline (the face
 *     copy must be pixel-stable: every face's inner share > 8 levels <= 0.5 %);
 *  3. else unmeasured, with what to shoot.
 */
export function saturatedCellFallback({ luma = null, contrast = null, diffAgainst = null, maxInnerPct = INNER_FACE_DIFF_MAX_PCT } = {}) {
  const saturated = Boolean(luma) && (luma.verdict === 'saturated' || luma.exFigures === 'saturated');
  if (!saturated) return { applies: false };
  if (contrast && ['pass', 'marginal', 'fail'].includes(contrast.verdict) && numOrNull(contrast.minContrast) !== null) {
    return { applies: true, source: 'contrast', verdict: contrast.verdict, minContrast: contrast.minContrast, face: contrast.face ?? null };
  }
  const faces = Array.isArray(diffAgainst?.faces) ? diffAgainst.faces.filter((f) => f && f.inner && numOrNull(f.inner.overThresholdPct) !== null) : [];
  if (diffAgainst && diffAgainst.verdict === 'measured' && diffAgainst.poseValid !== false && faces.length) {
    const rows = faces.map((f) => ({ id: f.id, innerOverPct: f.inner.overThresholdPct, innerMean: f.inner.mean ?? null, lumaAfter: f.inner.lumaA ?? null, lumaBefore: f.inner.lumaB ?? null, pass: f.inner.overThresholdPct <= maxInnerPct }));
    const failing = rows.filter((r) => !r.pass);
    return {
      applies: true,
      source: 'inner-face-diff',
      verdict: failing.length ? 'fail' : 'pass',
      against: diffAgainst.against ?? null,
      maxInnerPct,
      faces: rows,
      reasons: failing.map((r) => `${r.id} inner face ${r.innerOverPct}% > ${maxInnerPct}% of pixels changed by > 8 levels`),
    };
  }
  return {
    applies: true,
    source: 'none',
    verdict: 'unmeasured',
    reason: contrast?.verdict === 'unmeasured' || !contrast
      ? `saturated luma and no contrast tiles; ${diffAgainst ? `the diff is ${diffAgainst.verdict ?? 'unmeasured'}${diffAgainst.poseValid === false ? ' (pose mismatch)' : ''}` : 'no --diff-against baseline'} — shoot with --diff-against <pose-matched before>`
      : `contrast ${contrast.verdict}`,
  };
}

/**
 * In-page recorder (addInitScript): every ball phase / world-route-live /
 * scene phase change from navigation start, so a still's record never
 * misses an early `loading` (CLARITY r5: the rung-2 light reveal read only
 * opening > releasing > done). MutationObservers (the ball's
 * data-ball-phase anywhere, the root class) plus a light poll of the
 * debug readiness bridge for the scene phase, stopped once the ceremony
 * ended or after `maxMs`. With `marks`, every change also drops a
 * `performance.mark('capture:<what>:<value>')` (the GPU trace's clock).
 * window.__capturePhaseTrace = { rows, startedAt }.
 */
export function installPhaseTrace(opts) {
  const maxMs = (opts && opts.maxMs) || 45000;
  const pollMs = (opts && opts.pollMs) || 100;
  const marks = Boolean(opts && opts.marks);
  const rows = [];
  const record = { rows, startedAt: performance.now(), marks, stoppedAt: null };
  try {
    Object.defineProperty(window, '__capturePhaseTrace', { value: record, configurable: true });
  } catch {
    return;
  }
  let last = { ball: undefined, live: undefined, scene: undefined, generation: undefined };
  const mark = (name) => {
    if (!marks) return;
    try {
      performance.mark(name);
    } catch {
      /* marks are best-effort */
    }
  };
  if (marks) mark('capture:init');
  const read = () => {
    const ball = document.querySelector('[data-ball-loader]');
    const out = { ball: ball ? ball.getAttribute('data-ball-phase') : 'absent', live: document.documentElement.classList.contains('world-route-live'), scene: null, generation: null };
    try {
      const r = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
      if (r) {
        out.scene = typeof r.phase === 'string' ? r.phase : null;
        out.generation = typeof r.generation === 'number' ? r.generation : null;
      }
    } catch {
      /* bridge threw: scene stays null */
    }
    return out;
  };
  const sample = (source) => {
    const s = read();
    const changed = s.ball !== last.ball || s.live !== last.live || s.scene !== last.scene || s.generation !== last.generation;
    if (!changed) return;
    if (rows.length < 2000) rows.push({ t: +performance.now().toFixed(1), ball: s.ball, live: s.live, scene: s.scene, generation: s.generation, source });
    if (s.ball !== last.ball) mark(`capture:ball:${s.ball}`);
    if (s.live !== last.live && s.live) mark('capture:route-live');
    if (s.scene !== last.scene && s.scene) mark(`capture:scene:${s.scene}`);
    last = s;
  };
  let timer = null;
  const observers = [];
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    for (const o of observers) o.disconnect();
    record.stoppedAt = +performance.now().toFixed(1);
  };
  const start = () => {
    try {
      const ballObs = new MutationObserver(() => sample('mutation'));
      // Attribute changes only (no childList: hydration inserts thousands of
      // nodes); a ball mounted with its phase already set is caught by the
      // poll, and single-commit phases by the product's own ballTrace.
      ballObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ball-phase'], subtree: true });
      observers.push(ballObs);
      const rootObs = new MutationObserver(() => sample('mutation'));
      rootObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      observers.push(rootObs);
    } catch {
      /* no observer: the poll still samples */
    }
    sample('start');
    timer = setInterval(() => {
      sample('poll');
      const done = last.live === true && (last.ball === 'done' || last.ball === 'hidden' || last.ball === 'absent');
      if (done || performance.now() - record.startedAt > maxMs) stop();
    }, pollMs);
  };
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
}

/**
 * The phase record for a sidecar: the harness's own DOM trace from
 * navigation (installPhaseTrace) beside the product's bounded logs
 * (__routeWorldReadiness().ballTrace / phaseTrace).
 */
export function phaseTraceSummary(domTrace, product = null) {
  const rows = Array.isArray(domTrace?.rows) ? domTrace.rows : [];
  const seq = (list, key) => {
    const out = [];
    for (const r of list) {
      const v = r ? r[key] : null;
      if (v === null || v === undefined) continue;
      if (out[out.length - 1] !== v) out.push(v);
    }
    return out;
  };
  const ballSequence = seq(rows, 'ball');
  const productBall = Array.isArray(product?.ballTrace) ? product.ballTrace : [];
  const productScene = Array.isArray(product?.phaseTrace) ? product.phaseTrace : [];
  const firstLoading = rows.find((r) => r.ball === 'loading') ?? null;
  const routeLive = rows.find((r) => r.live === true) ?? null;
  return {
    source: rows.length ? 'harness DOM trace from navigation (installPhaseTrace)' : 'none',
    rows: rows.slice(0, 200),
    ballSequence,
    sceneSequence: seq(rows, 'scene'),
    sawLoading: ballSequence.includes('loading') || productBall.some((e) => e && e.phase === 'loading'),
    firstLoadingAt: firstLoading ? firstLoading.t : null,
    routeLiveAt: routeLive ? routeLive.t : null,
    product: product
      ? {
          ballTrace: productBall.slice(-48).map((e) => ({ phase: e.phase, t: numOrNull(e.t) === null ? null : +e.t.toFixed(1) })),
          phaseTrace: productScene.slice(-32).map((e) => ({ phase: e.phase, generation: e.generation ?? null, t: numOrNull(e.t) === null ? null : +e.t.toFixed(1) })),
        }
      : null,
    stoppedAt: domTrace?.stoppedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// H6: loader LoAF, ball-phase windows, GPU trace categories, program keys
// ---------------------------------------------------------------------------

/** The Chromium trace categories of the --gpu-trace leg (r6 brief H6, plus user timing for the phase marks). */
// ENGINE-A4: + disabled-by-default-gpu.service (command-buffer flushes, link waits, readbacks on CrGpuMain).
export const GPU_TRACE_CATEGORIES = ['gpu', 'gpu.angle', 'disabled-by-default-gpu.service', 'viz', 'devtools.timeline', 'v8.execute', 'blink.user_timing', 'toplevel', '__metadata'];

/**
 * In-page recorder (addInitScript): every long animation frame >= minMs
 * from navigation (buffered), with its script attribution — invoker, type,
 * source URL, function name and char position — so a loader-phase main-thread
 * gap names the code that held it. window.__captureLoaf = { supported, rows, dropped }.
 */
export function installLoafRecorder(opts) {
  const minMs = (opts && opts.minMs) || 50;
  const max = (opts && opts.maxEntries) || 400;
  const record = { supported: false, rows: [], dropped: 0 };
  try {
    Object.defineProperty(window, '__captureLoaf', { value: record, configurable: true });
  } catch {
    return;
  }
  try {
    const types = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes ? PerformanceObserver.supportedEntryTypes : [];
    if (!types.includes('long-animation-frame')) return;
    record.supported = true;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < minMs) continue;
        if (record.rows.length >= max) {
          record.dropped += 1;
          continue;
        }
        const scripts = Array.isArray(e.scripts) ? e.scripts : [];
        record.rows.push({
          start: +e.startTime.toFixed(1),
          duration: +e.duration.toFixed(1),
          blockingDuration: typeof e.blockingDuration === 'number' ? +e.blockingDuration.toFixed(1) : null,
          renderStart: e.renderStart > 0 ? +(e.renderStart - e.startTime).toFixed(1) : null,
          styleAndLayoutStart: e.styleAndLayoutStart > 0 ? +(e.styleAndLayoutStart - e.startTime).toFixed(1) : null,
          scripts: scripts
            .map((s) => ({
              ms: +s.duration.toFixed(1),
              invoker: s.invoker || null,
              invokerType: s.invokerType || null,
              sourceURL: String(s.sourceURL || '').replace(/^.*\/_next\//, '_next/'),
              sourceFunctionName: s.sourceFunctionName || null,
              sourceCharPosition: typeof s.sourceCharPosition === 'number' ? s.sourceCharPosition : null,
              forcedStyleAndLayoutMs: +(s.forcedStyleAndLayoutDuration || 0).toFixed(1),
              pauseMs: +(s.pauseDuration || 0).toFixed(1),
            }))
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 8),
        });
      }
    });
    obs.observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    record.supported = false;
  }
}

/**
 * Ball-phase windows (page clock ms) from a loader trace's analysis.stamps
 * (the product's own ballTrace / phaseTrace when present, else the sampled
 * transitions): preBall, loading-before-presented, loading-after-presented,
 * opening, releasing, after. Missing phases collapse their window.
 */
export function phaseWindowsFromStamps(stamps) {
  const product = stamps && stamps.product && typeof stamps.product === 'object' ? stamps.product : null;
  const ballRows = (Array.isArray(product?.ballPhases) && product.ballPhases.length ? product.ballPhases : Array.isArray(stamps?.ballPhases) ? stamps.ballPhases : []).filter((r) => r && typeof r.t === 'number');
  const sceneRows = (Array.isArray(product?.scenePhases) && product.scenePhases.length ? product.scenePhases : Array.isArray(stamps?.scenePhases) ? stamps.scenePhases : []).filter((r) => r && typeof r.t === 'number');
  const firstBall = (phase, after = -Infinity) => ballRows.find((r) => r.ballPhase === phase && r.t >= after)?.t ?? null;
  const loadingAt = firstBall('loading');
  if (loadingAt === null) return { windows: [], reason: 'no ball `loading` stamp' };
  const presentedAt = sceneRows.find((r) => r.scenePhase === 'presented' && r.t >= loadingAt)?.t ?? null;
  const openingAt = firstBall('opening', loadingAt);
  const releasingAt = firstBall('releasing', openingAt ?? loadingAt);
  const endAt = firstBall('done', loadingAt) ?? firstBall('aborted', loadingAt);
  const cuts = [
    ['preBall', 0],
    ['loading-before-presented', loadingAt],
    ['loading-after-presented', presentedAt],
    ['opening', openingAt],
    ['releasing', releasingAt],
    ['after', endAt],
  ].filter(([, t]) => typeof t === 'number');
  const windows = cuts.map(([phase, from], i) => ({ phase, from, to: i + 1 < cuts.length ? cuts[i + 1][1] : Infinity })).filter((w) => w.to > w.from);
  return { windows, loadingAt, presentedAt, openingAt, releasingAt, endAt, source: product?.ballPhases?.length ? 'product ballTrace / phaseTrace' : 'sampled transitions' };
}

/** The window a page time falls in (by its start), or 'unknown'. */
export function phaseAt(windows, t) {
  const w = (Array.isArray(windows) ? windows : []).find((x) => t >= x.from && t < x.to);
  return w ? w.phase : 'unknown';
}

/**
 * Long animation frames per ball-phase window: count, total / max duration,
 * blocking time and the top script sources (URL + function, summed).
 */
export function loafByPhase(rows, windows, { top = 5 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.start === 'number');
  const out = {};
  for (const r of list) {
    const phase = phaseAt(windows, r.start);
    const b = (out[phase] ??= { count: 0, totalMs: 0, maxMs: 0, maxAt: null, blockingMs: 0, sources: new Map() });
    b.count += 1;
    b.totalMs += r.duration;
    b.blockingMs += typeof r.blockingDuration === 'number' ? r.blockingDuration : 0;
    if (r.duration > b.maxMs) {
      b.maxMs = r.duration;
      b.maxAt = r.start;
    }
    for (const s of Array.isArray(r.scripts) ? r.scripts : []) {
      const key = `${s.sourceURL || '(no url)'}#${s.sourceFunctionName || '(anonymous)'}@${s.sourceCharPosition ?? '?'}`;
      const prev = b.sources.get(key) ?? { source: key, invokerType: s.invokerType ?? null, invoker: s.invoker ?? null, ms: 0, frames: 0 };
      prev.ms += s.ms;
      prev.frames += 1;
      b.sources.set(key, prev);
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([phase, b]) => [
      phase,
      {
        count: b.count,
        totalMs: +b.totalMs.toFixed(1),
        maxMs: +b.maxMs.toFixed(1),
        maxAt: b.maxAt,
        blockingMs: +b.blockingMs.toFixed(1),
        topSources: [...b.sources.values()].sort((x, y) => y.ms - x.ms).slice(0, top).map((s) => ({ ...s, ms: +s.ms.toFixed(1) })),
      },
    ]),
  );
}

/** three r185 getProgramCacheKeyParameters, in key order (precision first). */
export const PROGRAM_PARAM_NAMES = [
  'precision', 'outputColorSpace', 'envMapMode', 'envMapCubeUVHeight', 'mapUv', 'alphaMapUv', 'lightMapUv', 'aoMapUv', 'bumpMapUv', 'normalMapUv',
  'displacementMapUv', 'emissiveMapUv', 'metalnessMapUv', 'roughnessMapUv', 'anisotropyMapUv', 'clearcoatMapUv', 'clearcoatNormalMapUv', 'clearcoatRoughnessMapUv',
  'iridescenceMapUv', 'iridescenceThicknessMapUv', 'sheenColorMapUv', 'sheenRoughnessMapUv', 'specularMapUv', 'specularColorMapUv', 'specularIntensityMapUv',
  'transmissionMapUv', 'thicknessMapUv', 'combine', 'fogExp2', 'sizeAttenuation', 'morphTargetsCount', 'morphAttributeCount', 'numDirLights', 'numPointLights',
  'numSpotLights', 'numSpotLightMaps', 'numHemiLights', 'numRectAreaLights', 'numDirLightShadows', 'numPointLightShadows', 'numSpotLightShadows',
  'numSpotLightShadowsWithMaps', 'numLightProbes', 'shadowMapType', 'toneMapping', 'numClippingPlanes', 'numClipIntersection', 'depthPacking',
];
/** three r185 getProgramCacheKeyBooleans, first mask (bit order). */
export const PROGRAM_LAYERS_A = [
  'instancing', 'instancingColor', 'instancingMorph', 'matcap', 'envMap', 'normalMapObjectSpace', 'normalMapTangentSpace', 'clearcoat', 'iridescence', 'alphaTest',
  'vertexColors', 'vertexAlphas', 'vertexUv1s', 'vertexUv2s', 'vertexUv3s', 'vertexTangents', 'anisotropy', 'alphaHash', 'batching', 'dispersion', 'batchingColor',
  'gradientMap', 'packedNormalMap', 'vertexNormals',
];
/** three r185 getProgramCacheKeyBooleans, second mask (bit order). */
export const PROGRAM_LAYERS_B = [
  'fog', 'useFog', 'flatShading', 'logarithmicDepthBuffer', 'reversedDepthBuffer', 'skinning', 'morphTargets', 'morphNormals', 'morphColors', 'premultipliedAlpha',
  'shadowMapEnabled', 'doubleSided', 'flipSided', 'useDepthPacking', 'dithering', 'transmission', 'sheen', 'opaque', 'pointsUvs', 'decodeVideoTexture',
  'decodeVideoTextureEmissive', 'alphaToCoverage', 'lightProbeGrids', 'hasPositionAttribute',
];
const KEY_COLOR_SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear', 'rec2020', 'rec2020-linear', 'linear-rec2020']);

function bitsOf(mask, names) {
  const n = Number(mask);
  if (!Number.isInteger(n)) return null;
  return names.filter((_, i) => (n & (1 << i)) !== 0);
}

/**
 * Decode one WebGLProgram.cacheKey (three r185): the identity (shader id or
 * custom VS/FS ids, then the defines), the named parameter block, both
 * boolean masks as flag names, the renderer output colour space and the
 * custom key tail. A raw-shader key (no parameter block) is { raw: true }.
 */
export function decodeProgramKey(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  const tokens = key.split(',');
  const n = PROGRAM_PARAM_NAMES.length;
  let p = -1;
  for (let i = 0; i + n + 2 < tokens.length; i += 1) {
    if (!['highp', 'mediump', 'lowp'].includes(tokens[i])) continue;
    if (!KEY_COLOR_SPACES.has(tokens[i + 1])) continue;
    if (!/^[0-7]$/.test(tokens[i + 44])) continue;
    p = i;
    break;
  }
  if (p === -1) return { raw: true, identity: tokens.slice(0, 2).join(','), tokens };
  const params = {};
  PROGRAM_PARAM_NAMES.forEach((name, i) => {
    params[name] = tokens[p + i];
  });
  const layersA = tokens[p + n];
  const layersB = tokens[p + n + 1];
  return {
    raw: false,
    identity: tokens.slice(0, p).join(','),
    shader: tokens[0],
    params,
    layersA: bitsOf(layersA, PROGRAM_LAYERS_A),
    layersB: bitsOf(layersB, PROGRAM_LAYERS_B),
    layersAMask: layersA,
    layersBMask: layersB,
    rendererOutputColorSpace: tokens[p + n + 2] ?? null,
    custom: tokens.slice(p + n + 3).join(','),
    paramStart: p,
    tokens,
  };
}

function keyDiffs(a, b) {
  if (a.raw || b.raw) return null;
  if (a.custom !== b.custom || a.rendererOutputColorSpace !== b.rendererOutputColorSpace) return null;
  const diffs = [];
  if (a.identity !== b.identity) {
    const ta = a.tokens.slice(0, a.paramStart);
    const tb = b.tokens.slice(0, b.paramStart);
    if (ta.length !== tb.length || ta[0] !== tb[0]) return null;
    // Identity tokens: the shader id (or the custom VS / FS ids), then the
    // define name / value pairs; a changed token is named by its predecessor.
    for (let i = 1; i < ta.length; i += 1) if (ta[i] !== tb[i]) diffs.push(`identity[${i}](after ${ta[i - 1]}): ${ta[i]} -> ${tb[i]}`);
  }
  for (const name of PROGRAM_PARAM_NAMES) if (a.params[name] !== b.params[name]) diffs.push(`${name}: ${a.params[name]} -> ${b.params[name]}`);
  const flip = (xs, ys, label) => {
    const sa = new Set(xs ?? []);
    const sb = new Set(ys ?? []);
    for (const f of new Set([...sa, ...sb])) if (sa.has(f) !== sb.has(f)) diffs.push(`${label}.${f}: ${sa.has(f) ? 'on' : 'off'} -> ${sb.has(f) ? 'on' : 'off'}`);
  };
  flip(a.layersA, b.layersA, 'layersA');
  flip(a.layersB, b.layersB, 'layersB');
  return diffs;
}

/**
 * ENGINE E7 program-key audit: every renderer program decoded, grouped by
 * shader, identical keys counted, and the NEAR pairs — same shader, same
 * custom tail, differing in at most `maxDiff` fields — listed with the
 * fields that split them (e.g. `toneMapping: 4 -> 0`,
 * `layersB.shadowMapEnabled: on -> off`). Tallies say which fields split
 * the most programs. `programs` = [{ cacheKey, type?, name?, drawn? }].
 */
export function programKeyAudit(programs, { maxDiff = 2, maxPairs = 200 } = {}) {
  const rows = (Array.isArray(programs) ? programs : []).map((p, i) => ({ i, name: p?.name ?? null, type: p?.type ?? null, drawn: p?.drawn === true, key: typeof p?.cacheKey === 'string' ? p.cacheKey : null }));
  const decoded = rows.map((r) => ({ ...r, d: decodeProgramKey(r.key) }));
  const seen = new Map();
  let identical = 0;
  for (const r of decoded) {
    if (r.key === null) continue;
    if (seen.has(r.key)) identical += 1;
    else seen.set(r.key, r.i);
  }
  const groups = {};
  for (const r of decoded) {
    const g = r.d ? (r.d.raw ? `raw:${r.d.identity}` : r.d.shader) : 'unreadable';
    groups[g] = (groups[g] ?? 0) + 1;
  }
  const nearPairs = [];
  const fieldTally = {};
  const byShader = new Map();
  for (const r of decoded) {
    if (!r.d || r.d.raw) continue;
    const list = byShader.get(r.d.shader) ?? [];
    list.push(r);
    byShader.set(r.d.shader, list);
  }
  for (const list of byShader.values()) {
    for (let x = 0; x < list.length; x += 1) {
      for (let y = x + 1; y < list.length; y += 1) {
        const diffs = keyDiffs(list[x].d, list[y].d);
        if (!diffs || diffs.length === 0 || diffs.length > maxDiff) continue;
        for (const f of diffs) {
          const field = f.split(':')[0];
          fieldTally[field] = (fieldTally[field] ?? 0) + 1;
        }
        if (nearPairs.length < maxPairs) nearPairs.push({ a: list[x].i, b: list[y].i, shader: list[x].d.shader, nameA: list[x].name, nameB: list[y].name, drawnA: list[x].drawn, drawnB: list[y].drawn, diffs });
      }
    }
  }
  return {
    total: rows.length,
    unreadable: decoded.filter((r) => !r.d).length,
    raw: decoded.filter((r) => r.d && r.d.raw).length,
    identicalKeys: identical,
    groups: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1] - a[1])),
    nearPairs,
    nearPairCount: nearPairs.length,
    splitFields: Object.fromEntries(Object.entries(fieldTally).sort((a, b) => b[1] - a[1])),
    rule: `near pair = same shader id and custom key tail, at most ${maxDiff} differing fields (defines, parameter block, boolean layers); a pair split only by a field outside the data faces is a merge candidate (ENGINE E7, ~60 ms per link saved)`,
  };
}

// ---------------------------------------------------------------------------
// H7: --dolly-at, the throttled profile, shader-source stability
// ---------------------------------------------------------------------------

/** --dolly-at bounds: conductor progress 0..4 (5 stations), at most 16 points, <= 3 decimals. */
export const DOLLY_AT_MAX_POINTS = 16;

/** Parse `--dolly-at 3.55,3.60,3.64,3.70` into sorted distinct points. */
export function parseDollyAt(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: '--dolly-at needs a comma list of conductor progress values, e.g. 3.55,3.60,3.64,3.70' };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = parts.filter((p) => !/^\d(\.\d{1,3})?$/.test(p) || Number(p) > 4);
  if (bad.length || parts.length === 0) return { error: `--dolly-at values must be progress 0..4 with at most 3 decimals (got "${raw}")` };
  const points = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  if (points.length > DOLLY_AT_MAX_POINTS) return { error: `--dolly-at takes at most ${DOLLY_AT_MAX_POINTS} points (got ${points.length})` };
  return { points };
}

/**
 * Times at which the conductor's `smooth` progress passes each explicit
 * point between two recorder frames (either direction), linearly
 * interpolated — the --dolly-stills rule with a chosen point list instead
 * of the quarter points. Returns [{ t, at, direction, from, to }], time-ordered.
 */
export function dollyTimesAt(frames, points) {
  const timed = (Array.isArray(frames) ? frames : []).filter((f) => f && typeof f.t === 'number' && typeof f.smooth === 'number');
  const list = Array.isArray(points) ? points.filter((p) => typeof p === 'number' && Number.isFinite(p)) : [];
  const out = [];
  for (let i = 1; i < timed.length; i += 1) {
    const a = timed[i - 1];
    const b = timed[i];
    if (a.smooth === b.smooth) continue;
    for (const at of list) {
      const crosses = b.smooth > a.smooth ? at > a.smooth && at <= b.smooth : at < a.smooth && at >= b.smooth;
      if (!crosses) continue;
      const f = (at - a.smooth) / (b.smooth - a.smooth);
      out.push({ t: +(a.t + f * (b.t - a.t)).toFixed(1), at, direction: b.smooth > a.smooth ? 'down' : 'up', from: Math.floor(at), to: Math.floor(at) + 1 });
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/** File-name segment of a progress point: 3.55 -> `s3p55`, 3.6 -> `s3p60`. */
export function dollyPointToken(at) {
  const fixed = Number(at).toFixed(Math.max(2, (String(at).split('.')[1] ?? '').length));
  return `s${fixed.replace('.', 'p')}`;
}

/** The camera pose of a sweep-recorder frame (for the look probe on a dolly still). */
export function framePose(frame) {
  if (!frame || !Array.isArray(frame.camPos)) return null;
  return {
    camPos: frame.camPos.slice(0, 3),
    yawRad: numOrNull(frame.yaw),
    pitchRad: numOrNull(frame.pitch),
    fov: numOrNull(frame.fov),
    smooth: numOrNull(frame.smooth),
    t: numOrNull(frame.t),
    source: 'sweep recorder frame (__routeWorldCamera)',
  };
}

/** The r6 brief's throttled profile: 50 Mbps down / up, 20 ms RTT. */
export const NET_THROTTLE_DEFAULT = { mbps: 50, rttMs: 20 };

/** Parse `--net-throttle <mbps>,<rttMs>` (e.g. 50,20). */
export function parseNetThrottle(raw) {
  const m = /^(\d{1,4}(?:\.\d{1,2})?),(\d{1,4})$/.exec(String(raw ?? '').trim());
  if (!m) return { error: `--net-throttle must be <mbps>,<rttMs> (e.g. 50,20; got "${raw}")` };
  const mbps = Number(m[1]);
  const rttMs = Number(m[2]);
  if (!(mbps > 0) || mbps > 10000 || rttMs > 2000) return { error: `--net-throttle out of range (mbps 0..10000, rtt 0..2000 ms; got "${raw}")` };
  return { mbps, rttMs };
}

/** CDP Network.emulateNetworkConditions parameters for a throttle profile (bytes / s). */
export function netThrottleConditions({ mbps, rttMs }) {
  const bytesPerSecond = Math.round((mbps * 1e6) / 8);
  return { offline: false, latency: rttMs, downloadThroughput: bytesPerSecond, uploadThroughput: bytesPerSecond };
}

/**
 * In-page recorder (addInitScript): every shader source handed to WebGL,
 * hashed (FNV-1a 32) with its type, deduplicated. The warm-cache leg diffs
 * these between loads and viewports: a GPU program cache only hits when the
 * source is byte-identical. window.__captureShaderLog = { entries, sources }.
 */
export function installShaderSourceLog() {
  const log = { entries: [], sources: {}, calls: 0 };
  try {
    Object.defineProperty(window, '__captureShaderLog', { value: log, configurable: true });
  } catch {
    return;
  }
  const typeOf = new WeakMap();
  const fnv = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const patch = (proto) => {
    if (!proto || proto.__captureShaderLogPatched) return;
    const create = proto.createShader;
    const source = proto.shaderSource;
    proto.createShader = function createShaderSpy(type) {
      const sh = create.call(this, type);
      if (sh) typeOf.set(sh, type === this.VERTEX_SHADER ? 'vertex' : type === this.FRAGMENT_SHADER ? 'fragment' : String(type));
      return sh;
    };
    proto.shaderSource = function shaderSourceSpy(sh, src) {
      try {
        log.calls += 1;
        const text = String(src);
        const hash = `${text.length.toString(16)}-${fnv(text)}`;
        if (!log.sources[hash]) {
          log.sources[hash] = text;
          log.entries.push({ hash, type: typeOf.get(sh) ?? 'unknown', len: text.length, lines: text.split('\n').length });
        }
      } catch {
        /* logging never breaks the page */
      }
      return source.call(this, sh, src);
    };
    Object.defineProperty(proto, '__captureShaderLogPatched', { value: true });
  };
  try {
    if (typeof WebGL2RenderingContext !== 'undefined') patch(WebGL2RenderingContext.prototype);
    if (typeof WebGLRenderingContext !== 'undefined') patch(WebGLRenderingContext.prototype);
  } catch {
    /* no WebGL */
  }
}

function firstDifference(a, b) {
  const la = String(a).split('\n');
  const lb = String(b).split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i += 1) {
    if (la[i] !== lb[i]) return { line: i + 1, a: (la[i] ?? '(end)').slice(0, 160), b: (lb[i] ?? '(end)').slice(0, 160), linesA: la.length, linesB: lb.length };
  }
  return null;
}

function lineOverlap(a, b) {
  const sa = new Set(String(a).split('\n'));
  const lb = String(b).split('\n');
  let hit = 0;
  for (const l of lb) if (sa.has(l)) hit += 1;
  return lb.length ? hit / lb.length : 0;
}

/**
 * Shader-source stability between two logs ({ entries, sources }): common
 * hashes, the sources only one side compiled, and for each unmatched source
 * its closest counterpart (same type, most shared lines) with the first
 * differing line — what makes a GPU program cache miss.
 */
export function shaderSourceDiff(a, b, { maxPairs = 12, labelA = 'a', labelB = 'b' } = {}) {
  const ea = Array.isArray(a?.entries) ? a.entries : [];
  const eb = Array.isArray(b?.entries) ? b.entries : [];
  if (!ea.length || !eb.length) return { verdict: 'unmeasured', reason: `no shader log on ${!ea.length ? labelA : labelB}` };
  const ha = new Set(ea.map((e) => e.hash));
  const hb = new Set(eb.map((e) => e.hash));
  const onlyA = ea.filter((e) => !hb.has(e.hash));
  const onlyB = eb.filter((e) => !ha.has(e.hash));
  const pairs = [];
  for (const e of onlyA.slice(0, maxPairs)) {
    const src = a.sources?.[e.hash];
    let best = null;
    for (const o of onlyB) {
      if (o.type !== e.type) continue;
      const other = b.sources?.[o.hash];
      if (typeof src !== 'string' || typeof other !== 'string') continue;
      const score = lineOverlap(src, other);
      if (!best || score > best.score) best = { o, score, other };
    }
    pairs.push(best ? { [labelA]: e.hash, [labelB]: best.o.hash, type: e.type, sharedLineShare: +best.score.toFixed(3), firstDifference: firstDifference(src, best.other) } : { [labelA]: e.hash, [labelB]: null, type: e.type, note: `no ${labelB} source of that type to compare` });
  }
  return {
    verdict: onlyA.length === 0 && onlyB.length === 0 ? 'stable' : 'differs',
    counts: { [labelA]: ea.length, [labelB]: eb.length, common: ea.length - onlyA.length, [`only_${labelA}`]: onlyA.length, [`only_${labelB}`]: onlyB.length },
    pairs,
    rule: 'a GPU program-cache hit needs byte-identical shader sources; every source only one side compiled is a cache miss there (the first differing line names why)',
  };
}

/** Reveal times (page clock) from an installPhaseTrace record. */
export function revealFromPhaseRows(trace) {
  const rows = Array.isArray(trace?.rows) ? trace.rows : [];
  const live = rows.find((r) => r.live === true) ?? null;
  const done = rows.find((r) => r.ball === 'done') ?? null;
  const loading = rows.find((r) => r.ball === 'loading') ?? null;
  const aborted = rows.find((r) => r.ball === 'aborted') ?? null;
  return { routeLiveAt: live ? live.t : null, ballDoneAt: done ? done.t : null, ballLoadingAt: loading ? loading.t : null, abortedAt: aborted ? aborted.t : null, ballSequence: phaseTraceSummary(trace).ballSequence };
}

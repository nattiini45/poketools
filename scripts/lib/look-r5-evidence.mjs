/**
 * LOOK pilot round 5, SEAT H: pure helpers (plus two page readers) for the
 * capture harness.
 *
 * - parseProgramCacheKey / programSplit / readProgramInventory: renderer
 *   programs split by output colour space and tone mapping, so every loader
 *   and still sidecar says how many programs the ACTIVE rung draws and how
 *   many are pre-warmed other-rung variants — and judges D26 on the active
 *   split (CAR r4: 119 / 133 totals in the sidecars, 80 / 79 only in the AD's
 *   own probe).
 * - rafGapWindows: main-thread gaps from the loader trace's own rAF samples,
 *   split before the ball / inside the ceremony / after it, with the metric
 *   source named (CAR r4: "472-530 ms main-thread gaps" was the film's
 *   whole-recording screencast gap, not a main-thread metric).
 * - faceTextureVerdictInput: the harness's own texture read of a data face
 *   (the product presence row's `textured` only sees `.map`, so the plaza LED
 *   boards read `textured 0` painted or blank).
 * - revealMedian: V3 — the median-of-N reveal time from loader traces, judged
 *   against the 12 s prod desktop target only for --prod-attach runs.
 */

// ---------------------------------------------------------------------------
// Programs by output colour space and tone mapping (D26)
// ---------------------------------------------------------------------------

/** three's ToneMapping constants (r185). */
export const TONE_MAPPING_NAMES = { 0: 'none', 1: 'linear', 2: 'reinhard', 3: 'cineon', 4: 'aces', 5: 'custom', 6: 'agx', 7: 'neutral' };

/** Output colour spaces three writes into a program key (ColorManagement ids). */
const COLOR_SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear', 'rec2020', 'rec2020-linear', 'linear-rec2020']);

/**
 * Offset of `toneMapping` from `precision` in three r185's
 * getProgramCacheKeyParameters (precision, outputColorSpace, envMapMode, …,
 * shadowMapType, toneMapping). Verified against real three r185 program keys
 * in headless Chromium (scripts/__tests__/look-r5-evidence.test.mjs carries
 * the recorded keys).
 */
export const TONE_MAPPING_OFFSET = 44;

/**
 * Parse one WebGLProgram.cacheKey: { outputColorSpace, toneMapping,
 * toneMappingName, raw }. The key is `shaderID | customVS,customFS`, the
 * defines (name,value pairs), then the parameter block starting with
 * precision — so the block is found by its shape (a precision token followed
 * by a known colour space and a tone-mapping integer 0..7 at the fixed
 * offset), not by position. A RawShaderMaterial key has no parameter block:
 * raw true, both null.
 */
export function parseProgramCacheKey(key) {
  if (typeof key !== 'string' || key.length === 0) return { outputColorSpace: null, toneMapping: null, toneMappingName: null, raw: null };
  const tokens = key.split(',');
  for (let i = 0; i < tokens.length - TONE_MAPPING_OFFSET; i += 1) {
    if (tokens[i] !== 'highp' && tokens[i] !== 'mediump' && tokens[i] !== 'lowp') continue;
    if (!COLOR_SPACES.has(tokens[i + 1])) continue;
    const tm = tokens[i + TONE_MAPPING_OFFSET];
    if (!/^[0-7]$/.test(tm)) continue;
    const toneMapping = Number(tm);
    return { outputColorSpace: tokens[i + 1], toneMapping, toneMappingName: TONE_MAPPING_NAMES[toneMapping], raw: false };
  }
  return { outputColorSpace: null, toneMapping: null, toneMappingName: null, raw: true };
}

/** D26 (lead, 2026-09-28): the cap on programs the ACTIVE rung draws, at rung 0. */
export const D26_ACTIVE_CAPS = { light: 87, dark: 109 };
export const D26_RUNG = 0;

/**
 * Split a program inventory. `programs` = [{ cacheKey, type, drawn }] where
 * drawn = the program was bound (gl.useProgram) during the sampled frames.
 * The active output colour space is the one most drawn non-raw programs
 * write (rung 0/1 composer path: scene programs render into the linear
 * target -> srgb-linear; rung 2+ direct: srgb). ACTIVE = every program in
 * the active output colour space, plus every drawn program (the composer's
 * final sRGB pass), plus raw programs (no colour space to split by —
 * counted active, conservatively). PRE-WARMED = the rest (the other-rung
 * variants the engine compiles at load so a governor step links nothing).
 * D26 is judged on `active.count` against the theme cap at rung 0; at any
 * other rung the split is recorded as informational.
 */
export function programSplit(programs, { theme = null, rung = null, caps = D26_ACTIVE_CAPS, capRung = D26_RUNG } = {}) {
  const rows = (Array.isArray(programs) ? programs : []).map((p) => ({ ...parseProgramCacheKey(p?.cacheKey), type: p?.type ?? null, drawn: p?.drawn === true }));
  if (rows.length === 0) return { verdict: 'unmeasured', reason: 'no renderer programs read', total: 0 };
  const tally = (list, keyOf) => {
    const out = {};
    for (const r of list) {
      const k = keyOf(r);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const csKey = (r) => (r.raw ? 'raw' : r.outputColorSpace ?? 'unknown');
  const tmKey = (r) => (r.raw ? 'raw' : r.toneMappingName ?? 'unknown');
  const drawnRows = rows.filter((r) => r.drawn);
  const drawnByOutput = tally(drawnRows.filter((r) => !r.raw && r.outputColorSpace), csKey);
  const ranked = Object.entries(drawnByOutput).sort((a, b) => b[1] - a[1]);
  const activeOutput = ranked.length ? ranked[0][0] : null;
  const isActive = (r) => r.drawn || r.raw || (activeOutput !== null && r.outputColorSpace === activeOutput);
  const active = rows.filter(isActive);
  const prewarmed = rows.filter((r) => !isActive(r));
  const cap = theme && typeof caps[theme] === 'number' ? caps[theme] : null;
  let d26;
  if (activeOutput === null) d26 = { verdict: 'unmeasured', reason: 'no program was bound in the sampled frames (the active rung cannot be told)' };
  else if (typeof rung !== 'number') d26 = { verdict: 'unmeasured', reason: 'quality rung not read' };
  else if (rung !== capRung) d26 = { verdict: 'informational', reason: `rung ${rung}: the D26 cap is defined at rung ${capRung} (shoot --quality ${capRung} to judge it)` };
  else if (cap === null) d26 = { verdict: 'unmeasured', reason: `no D26 cap for theme ${theme ?? 'unknown'}` };
  else d26 = { verdict: active.length <= cap ? 'pass' : 'fail', reason: `${active.length} active-rung programs ${active.length <= cap ? '<=' : '>'} cap ${cap} (${theme}, rung ${rung})` };
  return {
    verdict: 'measured',
    total: rows.length,
    rung,
    theme,
    activeOutput,
    active: {
      count: active.length,
      byOutput: tally(active, csKey),
      byToneMapping: tally(active, tmKey),
    },
    prewarmed: {
      count: prewarmed.length,
      byOutput: tally(prewarmed, csKey),
      byToneMapping: tally(prewarmed, tmKey),
    },
    drawnInFrames: drawnRows.length,
    byOutput: tally(rows, csKey),
    byOutputTone: tally(rows, (r) => (r.raw ? 'raw' : `${r.outputColorSpace ?? 'unknown'}|${r.toneMappingName ?? 'unknown'}`)),
    d26: { ...d26, cap, capRung, rule: 'D26: programs the ACTIVE rung draws <= 87 light / 109 dark at rung 0; pre-warmed other-rung variants are allowed while the reveal target holds' },
    method:
      'renderer.info.programs keyed by each WebGLProgram.cacheKey (outputColorSpace + toneMapping parsed from three r185\'s parameter block); drawn = bound by gl.useProgram over the sampled frames; active = drawn + raw + every program in the most-drawn output colour space; pre-warmed = the rest',
  };
}

/**
 * Page reader: renderer.info.programs with cacheKey / type and whether each
 * program was bound over `frames` rendered frames (gl.useProgram wrapped for
 * the window, then restored; no link, no upload). The renderer comes from
 * the debug scene handle's R3F root (the iblState route). Never throws.
 */
export async function readProgramInventory(page, { frames = 3 } = {}) {
  try {
    return await page.evaluate(async (n) => {
      const sceneRead = window.__routeWorldScene;
      if (typeof sceneRead !== 'function') return { ok: false, reason: 'missing-scene-handle (debug off)' };
      const scene = sceneRead();
      if (!scene) return { ok: false, reason: 'no-scene' };
      const rootOf = (o) => (o && o.__r3f && o.__r3f.root && typeof o.__r3f.root.getState === 'function' ? o.__r3f.root.getState() : null);
      let state = rootOf(scene);
      if (!state) {
        scene.traverse((o) => {
          if (!state) state = rootOf(o);
        });
      }
      const gl = state && state.gl;
      if (!gl || !gl.info || !Array.isArray(gl.info.programs) || typeof gl.getContext !== 'function') return { ok: false, reason: 'no renderer on the scene R3F root' };
      const ctx = gl.getContext();
      const bound = new Set();
      const current = ctx.getParameter(ctx.CURRENT_PROGRAM);
      if (current) bound.add(current);
      const original = ctx.useProgram;
      ctx.useProgram = function useProgramSpy(p) {
        if (p) bound.add(p);
        return original.call(this, p);
      };
      try {
        for (let i = 0; i < n; i += 1) {
          if (typeof state.invalidate === 'function') state.invalidate();
          await new Promise((res) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              setTimeout(res, 0);
            };
            requestAnimationFrame(finish);
            setTimeout(finish, 150);
          });
        }
      } finally {
        ctx.useProgram = original;
      }
      return {
        ok: true,
        frames: n,
        // LOOK r6 (H6): the program name too (three's WebGLProgram.name: shader
        // name / material type), for the ENGINE E7 program-key dump.
        programs: gl.info.programs.map((p) => ({ cacheKey: typeof p.cacheKey === 'string' ? p.cacheKey : null, type: p.type ?? null, name: typeof p.name === 'string' ? p.name : null, usedTimes: typeof p.usedTimes === 'number' ? p.usedTimes : null, drawn: Boolean(p.program && bound.has(p.program)) })),
      };
    }, frames);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** One-line summary for the log. */
export function programSplitLine(split) {
  if (!split || split.verdict !== 'measured') return `programs unmeasured (${split?.reason ?? 'n/a'})`;
  return `programs total=${split.total} active=${split.active.count} (${split.activeOutput}) prewarmed=${split.prewarmed.count} drawn=${split.drawnInFrames} rung=${split.rung ?? '?'} D26=${split.d26.verdict}${split.d26.cap !== null ? `(cap ${split.d26.cap})` : ''}`;
}

// ---------------------------------------------------------------------------
// Main-thread gaps from the loader trace's rAF samples (metric source named)
// ---------------------------------------------------------------------------

/**
 * Gaps between consecutive loader-trace samples (one per in-page rAF, page
 * clock ms since navigation), split into the windows the judges read:
 * preBall (< ballShownAt), ceremony ([ballShownAt, ballEndAt]), after
 * (> ballEndAt). A gap is booked to the window its EARLIER sample falls in.
 * This is the one main-thread metric the harness names as such; the film's
 * `analysis.maxGapMs` is the screencast capture gap over the whole
 * recording (a static screen emits no frames), never a main-thread gap.
 */
export function rafGapWindows(samples, { ballShownAt = null, ballEndAt = null, top = 3 } = {}) {
  const times = (Array.isArray(samples) ? samples : [])
    .map((s) => (s && typeof s.t === 'number' ? s.t : null))
    .filter((t) => t !== null)
    .sort((a, b) => a - b);
  const windowOf = (t) => {
    if (typeof ballShownAt === 'number' && t < ballShownAt) return 'preBall';
    if (typeof ballShownAt === 'number' && (typeof ballEndAt !== 'number' || t <= ballEndAt)) return 'ceremony';
    if (typeof ballShownAt !== 'number') return 'unsplit';
    return 'after';
  };
  const buckets = { preBall: [], ceremony: [], after: [], unsplit: [] };
  for (let i = 1; i < times.length; i += 1) buckets[windowOf(times[i - 1])].push({ at: +times[i - 1].toFixed(1), gapMs: +(times[i] - times[i - 1]).toFixed(1) });
  const stats = (rows) => {
    if (!rows.length) return { intervals: 0, maxGapMs: null, maxGapAt: null, worst: [] };
    const sorted = [...rows].sort((a, b) => b.gapMs - a.gapMs);
    return { intervals: rows.length, maxGapMs: sorted[0].gapMs, maxGapAt: sorted[0].at, worst: sorted.slice(0, top) };
  };
  return {
    source: 'loader-trace rAF samples (in-page requestAnimationFrame timestamps, ms since navigation): a gap is a main-thread stall',
    samples: times.length,
    ballShownAt,
    ballEndAt,
    preBall: stats(buckets.preBall),
    ceremony: stats(buckets.ceremony),
    after: stats(buckets.after),
    ...(buckets.unsplit.length ? { unsplit: stats(buckets.unsplit) } : {}),
    notes: [
      'not the film: -loader-film.json analysis.maxGapMs is the gap between captured screencast frames over the whole recording (navigation on), which a static screen alone can open',
      'not the compositor: compositor cadence is the screencast swap stamps inside the reveal window (-loader-film.json compositor.cadence)',
    ],
  };
}

// ---------------------------------------------------------------------------
// Data-face texture read (harness-side, all texture slots)
// ---------------------------------------------------------------------------

/**
 * Page reader: per data-face subject id, the textures its content actually
 * binds — map, emissiveMap and any ShaderMaterial uniform holding a texture
 * — with their image size and upload version. The content is the group
 * before the subject's proxy (FocusSubject's layout), else the proxy's
 * parent (a rail whose hit plane sits beside its face). Never throws.
 */
export async function readFaceTextures(page, ids) {
  try {
    return await page.evaluate((subjectIds) => {
      const sceneRead = window.__routeWorldScene;
      if (typeof sceneRead !== 'function') return { ok: false, reason: 'missing-scene-handle (debug off)' };
      const scene = sceneRead();
      if (!scene) return { ok: false, reason: 'no-scene' };
      const proxies = new Map();
      scene.traverse((o) => {
        const id = o.userData && o.userData.focusSubject;
        if (typeof id === 'string' && subjectIds.includes(id) && !proxies.has(id)) proxies.set(id, o);
      });
      const visibleUp = (o) => {
        for (let p = o; p; p = p.parent) if (p.visible === false) return false;
        return true;
      };
      const texOf = (t) => {
        if (!t || !t.isTexture) return null;
        const img = t.image;
        const w = img && (img.width ?? img.videoWidth ?? (img.data && img.width));
        const h = img && (img.height ?? img.videoHeight);
        const kind = typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement ? 'canvas' : img && typeof img.videoWidth === 'number' ? 'video' : t.isDataTexture ? 'data' : img ? 'image' : 'none';
        return { kind, w: typeof w === 'number' ? w : null, h: typeof h === 'number' ? h : null, version: typeof t.version === 'number' ? t.version : null };
      };
      const out = {};
      for (const id of subjectIds) {
        const proxy = proxies.get(id);
        if (!proxy) {
          out[id] = { found: false };
          continue;
        }
        let group = null;
        if (proxy.parent) {
          const sib = proxy.parent.children;
          const prev = sib[sib.indexOf(proxy) - 1];
          if (prev && prev.isGroup && !(prev.userData && prev.userData.focusSubject)) group = prev;
        }
        const root = group ?? proxy.parent ?? proxy;
        const textures = [];
        let meshes = 0;
        let texturedMeshes = 0;
        root.traverse((o) => {
          if (!(o.isMesh || o.isSprite || o.isPoints) || o === proxy || !visibleUp(o)) return;
          const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          if (!mats.some((m) => m && m.visible !== false)) return;
          meshes += 1;
          let hit = false;
          for (const m of mats) {
            if (!m) continue;
            for (const slot of ['map', 'emissiveMap', 'alphaMap']) {
              const t = texOf(m[slot]);
              if (t && (t.w ?? 0) > 0) {
                hit = true;
                if (textures.length < 8) textures.push({ mesh: o.name || o.type, slot, ...t });
              }
            }
            if (m.uniforms) {
              for (const [name, u] of Object.entries(m.uniforms)) {
                const t = texOf(u && u.value);
                if (t && (t.w ?? 0) > 0) {
                  hit = true;
                  if (textures.length < 8) textures.push({ mesh: o.name || o.type, slot: `uniform:${name}`, ...t });
                }
              }
            }
          }
          if (hit) texturedMeshes += 1;
        });
        out[id] = { found: true, root: group ? 'content-group' : 'proxy-parent', meshes, texturedMeshes, textures };
      }
      return { ok: true, faces: out };
    }, ids);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The renderables input for boardPresenceVerdict: the product row's
 * `textured` (only `.map` with an image) unless the harness read sees more
 * (emissiveMap / uniform textures). Both are kept.
 */
export function faceTextureVerdictInput(row, harness) {
  if (!row) return null;
  const product = typeof row.textured === 'number' ? row.textured : null;
  const own = harness && harness.found && typeof harness.texturedMeshes === 'number' ? harness.texturedMeshes : null;
  const textured = own !== null && (product === null || own > product) ? own : product;
  return {
    visibleRenderables: row.visibleRenderables,
    textured,
    texturedProduct: product,
    texturedHarness: own,
    texturedSource: textured === own && own !== product ? 'harness (map, emissiveMap, alphaMap, texture uniforms)' : 'product presence row (.map)',
  };
}

// ---------------------------------------------------------------------------
// Textured-face rect (the ledger rect is the printed face, not the plinth)
// ---------------------------------------------------------------------------

/**
 * Data faces whose subject bounds include scene-lit stone (the ledger rail
 * registers the slab + base): the rect judged is the textured face mesh.
 * Map: subject id -> face mesh name.
 */
export const TEXTURED_FACE_MESHES = { 'ledger:teams': 'teams-ledger-face' };

/**
 * Project a mesh's local bounding box through a camera into CSS px.
 * `matrixWorld`, `view` (camera.matrixWorldInverse) and `proj` are
 * column-major 16-arrays; `box` = { min: [x,y,z], max: [x,y,z] };
 * `canvas` = { x, y, w, h } (CSS px). Returns null when any corner is
 * behind the camera. The rect is clipped to the canvas, with the unclipped
 * area's on-screen fraction.
 */
export function projectBoxRect(box, matrixWorld, view, proj, canvas) {
  const mul = (m, v) => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const c = mul(proj, mul(view, mul(matrixWorld, [x, y, z, 1])));
        if (!(c[3] > 1e-6)) return null;
        const sx = canvas.x + ((c[0] / c[3] + 1) / 2) * canvas.w;
        const sy = canvas.y + ((1 - c[1] / c[3]) / 2) * canvas.h;
        x0 = Math.min(x0, sx);
        y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx);
        y1 = Math.max(y1, sy);
      }
    }
  }
  const full = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const cx0 = Math.max(canvas.x, x0);
  const cy0 = Math.max(canvas.y, y0);
  const cx1 = Math.min(canvas.x + canvas.w, x1);
  const cy1 = Math.min(canvas.y + canvas.h, y1);
  const w = Math.max(0, cx1 - cx0);
  const h = Math.max(0, cy1 - cy0);
  return { x: cx0, y: cy0, w, h, onScreenFraction: full > 0 ? +((w * h) / full).toFixed(3) : 0 };
}

/**
 * Replace the rect of every subject row listed in TEXTURED_FACE_MESHES with
 * its textured face's projected rect (`faceRects[id]`), keeping the bounds
 * rect as `boundsRect` and saying so in `rectSource`. Rows without a face
 * read keep their bounds rect (`rectSource: 'bounds'`). Pure.
 */
export function refineFaceRows(subjects, faceRects) {
  if (!subjects || !Array.isArray(subjects.rows)) return subjects;
  const rows = subjects.rows.map((row) => {
    if (!row || !Object.prototype.hasOwnProperty.call(TEXTURED_FACE_MESHES, row.id)) return row;
    const face = faceRects && faceRects[row.id];
    if (!face || !(face.w > 0 && face.h > 0)) return { ...row, rectSource: 'bounds', rectSourceReason: face?.reason ?? 'no textured-face read' };
    // Self-check: the face lies inside its subject's bounds rect (both are
    // projections of the same camera); a face rect mostly outside it means
    // the projection basis is off, so the bounds rect is kept.
    const b = row.rect;
    if (b && b.w > 0 && b.h > 0) {
      const iw = Math.max(0, Math.min(b.x + b.w, face.x + face.w) - Math.max(b.x, face.x));
      const ih = Math.max(0, Math.min(b.y + b.h, face.y + face.h) - Math.max(b.y, face.y));
      const inside = (iw * ih) / (face.w * face.h);
      if (inside < 0.8) return { ...row, rectSource: 'bounds', rectSourceReason: `textured-face rect only ${(inside * 100).toFixed(0)}% inside the bounds rect (projection self-check)`, faceRectRejected: face };
    }
    return { ...row, boundsRect: row.rect ?? null, rect: { x: face.x, y: face.y, w: face.w, h: face.h }, onScreenFraction: face.onScreenFraction, rectSource: `textured-face:${TEXTURED_FACE_MESHES[row.id]}` };
  });
  return { ...subjects, rows };
}

// ---------------------------------------------------------------------------
// V3: median-of-N reveal time
// ---------------------------------------------------------------------------

export const PROD_REVEAL_TARGET_MS = 12000;

/**
 * V3 from loader-trace records (-loader.json bodies). Per run: routeLiveAt
 * and the ball's end, from navigation (the page clock) and since the
 * deadline anchor (generationBegun). The median of the from-navigation
 * reveal is judged against the 12 s desktop target ONLY when every run is
 * a --prod-attach run with the same viewport and at least `minRuns` runs
 * went live; dev runs are `indicative`. A run that never went live counts
 * as a miss (Infinity), never skipped.
 */
export function revealMedian(records, { targetMs = PROD_REVEAL_TARGET_MS, minRuns = 3 } = {}) {
  const runs = (Array.isArray(records) ? records : []).map((r, i) => {
    const a = r?.analysis ?? {};
    const tl = a.timeline ?? {};
    const live = typeof a.routeLiveAt === 'number' ? a.routeLiveAt : typeof tl.routeLiveAt === 'number' ? tl.routeLiveAt : null;
    const ballEnd = typeof tl.ballEndAt === 'number' ? tl.ballEndAt : null;
    const prod = Boolean(r?.invocation?.prodAttach);
    return {
      run: r?.file ?? i,
      viewport: r?.viewport ?? null,
      prodAttach: prod,
      warmup: r?.warmup?.ran ?? null,
      routeLiveFromNavMs: live,
      ballEndFromNavMs: ballEnd,
      routeLiveSinceAnchorMs: typeof tl.routeLiveSinceAnchorMs === 'number' ? tl.routeLiveSinceAnchorMs : null,
      anchorSource: tl.anchorSource ?? null,
      verdict: a.verdict ?? null,
    };
  });
  const median = (vals) => {
    const s = [...vals].sort((x, y) => x - y);
    if (!s.length) return null;
    const m = s[Math.floor((s.length - 1) / 2)];
    const n = s[Math.ceil((s.length - 1) / 2)];
    return Number.isFinite(m) && Number.isFinite(n) ? +((m + n) / 2).toFixed(1) : Infinity;
  };
  const liveVals = runs.map((r) => (typeof r.routeLiveFromNavMs === 'number' ? r.routeLiveFromNavMs : Infinity));
  const med = runs.length ? median(liveVals) : null;
  const sinceAnchor = runs.filter((r) => typeof r.routeLiveSinceAnchorMs === 'number').map((r) => r.routeLiveSinceAnchorMs);
  const viewports = [...new Set(runs.map((r) => r.viewport))];
  const reasons = [];
  let verdict;
  if (runs.length < minRuns) {
    verdict = 'unmeasured';
    reasons.push(`${runs.length} run(s) < ${minRuns}`);
  } else if (viewports.length > 1) {
    verdict = 'unmeasured';
    reasons.push(`mixed viewports ${viewports.join(',')}`);
  } else if (!runs.every((r) => r.prodAttach)) {
    verdict = 'indicative';
    reasons.push(`${runs.filter((r) => !r.prodAttach).length} run(s) are not --prod-attach (next dev): indicative only, V3 is judged on a production build`);
  } else {
    verdict = med !== null && med <= targetMs ? 'pass' : 'fail';
    reasons.push(`median world-route-live ${med === Infinity ? 'never (a run did not go live)' : `${med} ms`} from navigation ${verdict === 'pass' ? '<=' : '>'} ${targetMs} ms`);
  }
  return {
    verdict,
    reasons,
    targetMs,
    medianRouteLiveFromNavMs: med === Infinity ? null : med,
    medianRouteLiveSinceAnchorMs: sinceAnchor.length === runs.length && runs.length ? median(sinceAnchor) : null,
    runs,
    rule: `V3: median of >= ${minRuns} --prod-attach desktop loader traces, world-route-live measured from navigation (page clock 0), <= ${targetMs} ms; the since-generationBegun figure is reported, not judged`,
  };
}

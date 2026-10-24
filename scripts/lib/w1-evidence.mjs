/**
 * Wave-2 evidence arms for scripts/capture-route.mjs (fidelity gauntlet, seat
 * 2H INF — maintainer wave plan §2 "2H", §3 "Gate 2.0 / 2H", plus
 * the harness residual 4 of the wave-1 rounds):
 *
 *  - `--luma on`   per still: `{ activeFaceP99, outsideP995, topHotspots[] }`
 *                  on the FINAL PNG (the world present with the HUD and a
 *                  docked panel stamped on), the sky-body disc, the HUD band
 *                  and the DOM chrome excluded; plus a rendered-pixel
 *                  text-vs-ground contrast estimate on the active face.
 *  - `--audit on`  per station: the frame's draw calls (renderer.info.render
 *                  with the debug TelemetrySampler's autoReset off, so shadow
 *                  and post passes are included) and renderer.info.programs,
 *                  into the sidecar and one row of the draw ledger.
 *  - the docked panel's computed font-size and in-viewport box;
 *  - pass-through readers for `__routeWorldBeats()` / `__routeWorldAttacks()`
 *    (absent = `unmeasured`, never a pass);
 *  - the latched `settled` signal (2A's useStationSettle) as a read-only
 *    consumer of the pose probe;
 *  - W7 trace hygiene: zero-spread canvas reads that nothing confirms are
 *    `unread` (never blank), one deadline anchor (the product's
 *    generationBegunAt), ball / scene phases from the product's own phase
 *    logs (a single-commit phase is never missed), wobble timing from the
 *    rock's real start (`Animation.startTime`) against the product's
 *    milestone stamps, and compositor-smoothness evidence for the ceremony.
 *
 * Same contract as capture-evidence.mjs: PURE helpers (tested in
 * scripts/__tests__/w1-evidence.test.mjs), self-contained IN-PAGE functions
 * (serialized by Playwright — no closure over module scope), and RUNNERS that
 * drive a Playwright page (exercised only by real captures, which the lead
 * serializes on the pinned port).
 *
 * Honesty notes (carried into the sidecars' `notes`):
 *  - luma is the Rec.709 weighting of the gamma-encoded PNG values (0..255),
 *    not scene-linear radiance; it is what the visitor's screen shows;
 *  - the active face is the station's focus-subject rect — a projected world
 *    AABB, so its corners can include a sliver of whatever is behind the
 *    face (the P99 is then slightly generous, never stricter than the board);
 *  - the sky-body mask is a cone of SKY_DISC_MASK_DEG around the shader's
 *    sun direction (pow(mu, 140) > 0.05 — disc plus its tight glow);
 *  - the contrast estimate is glyph-classified tile statistics (wave 2 r3:
 *    ground = the tile's non-ink median, ink = the glyph stroke core; seams,
 *    scanlines, crossing spans and thick blobs are excluded) — still not
 *    OCR: a crest drawn in thin strokes can pass as glyphs, and a face with
 *    no text tile is `unmeasured`.
 */

// LOOK r5: the ledger face rect is its textured face mesh, not the slab + base bounds.
import { TEXTURED_FACE_MESHES, refineFaceRows } from './look-r5-evidence.mjs';

// ---------------------------------------------------------------------------
// Flags (parsed by parseEvidenceFlags in capture-evidence.mjs)
// ---------------------------------------------------------------------------

/** `--luma on|off` and `--audit on|off` (value flags, default off). */
export const W1_VALUE_FLAGS = ['--luma', '--audit'];

// ---------------------------------------------------------------------------
// Luma arm: pure analysis of the final PNG
// ---------------------------------------------------------------------------

/** Rec.709 luma of gamma-encoded 8-bit RGB (0..255). */
export function luma709(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG relative luminance of an 8-bit sRGB colour (0..1). */
export function relativeLuminance(r, g, b) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two relative luminances (>= 1). */
export function contrastRatio(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Histogram resolution: 4 bins per luma unit (0..255 → 1024 bins). */
const LUMA_BINS = 1024;
const LUMA_BIN_SCALE = LUMA_BINS / 256;

function lumaBin(value) {
  return Math.min(LUMA_BINS - 1, Math.max(0, Math.floor(value * LUMA_BIN_SCALE)));
}

/** The p-quantile (0..1) of a luma histogram, in luma units; null when empty. */
export function histogramPercentile(hist, count, p) {
  if (!count) return null;
  const target = Math.min(count - 1, Math.max(0, Math.ceil(p * count) - 1));
  let seen = 0;
  for (let i = 0; i < hist.length; i += 1) {
    seen += hist[i];
    if (seen > target) return +((i + 0.5) / LUMA_BIN_SCALE).toFixed(2);
  }
  return +((hist.length - 0.5) / LUMA_BIN_SCALE).toFixed(2);
}

/** Mask labels. */
export const MASK = { OUTSIDE: 0, FACE: 1, EXCLUDED: 2, FIGURE: 3 };

/**
 * Sky-body mask radius. The atmosphere shaders draw the disc as
 * pow(dot(view, sunDir), 140): it falls below 0.05 at acos(0.05^(1/140)) ≈
 * 11.8°, so a 12° cone holds the disc and its tight glow (the broad Mie halo
 * is left in — it is sky, and a board must still outshine it).
 */
export const SKY_DISC_MASK_DEG = 12;

/**
 * Project a world direction through a roll-free camera (yaw = atan2(fx, -fz),
 * pitch = asin(fy) — the `__routeWorldCamera()` convention) into viewport CSS
 * px. `fovDeg` is the vertical field of view. Returns null when the
 * direction points behind the eye plane.
 */
export function projectDirection(dir, { yaw, pitch, fovDeg, width, height }) {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 0) || !Number.isFinite(yaw) || !Number.isFinite(pitch) || !(fovDeg > 0) || !(width > 0) || !(height > 0)) return null;
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  const cp = Math.cos(pitch);
  const f = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  // right = normalize(f × up) with up = +Y; up' = right × f.
  let r = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (z <= 1e-6) return null;
  const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
  const y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const aspect = width / height;
  const ndcX = x / z / (tanHalf * aspect);
  const ndcY = y / z / tanHalf;
  return { x: ((ndcX + 1) / 2) * width, y: ((1 - ndcY) / 2) * height, depth: z };
}

/**
 * The sky-body exclusion disc (viewport CSS px) from the shader's sun
 * position and the live camera, or null when it is behind the camera or
 * inputs are missing. The radius is the cone's angular radius at the disc's
 * own depth (focal length in px = height / 2 / tan(fov / 2)).
 */
export function skyDiscRect({ sunPos, camPos, yaw, pitch, fovDeg, width, height, maskDeg = SKY_DISC_MASK_DEG }) {
  if (!Array.isArray(sunPos) || !Array.isArray(camPos)) return null;
  const dir = [sunPos[0] - camPos[0], sunPos[1] - camPos[1], sunPos[2] - camPos[2]];
  const centre = projectDirection(dir, { yaw, pitch, fovDeg, width, height });
  if (!centre) return null;
  const focalPx = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const r = (Math.tan((maskDeg * Math.PI) / 180) * focalPx) / Math.max(0.2, centre.depth);
  return { x: centre.x, y: centre.y, r };
}

function clipRect(rect, width, height, scale = 1) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return null;
  const x0 = Math.max(0, Math.floor(rect.x * scale));
  const y0 = Math.max(0, Math.floor(rect.y * scale));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.w) * scale));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.h) * scale));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Label every frame pixel: FACE (the active data face rects), EXCLUDED (the
 * HUD band, DOM chrome, the sky-body disc), FIGURE (figure rects — logged
 * separately, exempt until wave 3's metal clamp) or OUTSIDE. Exclusion wins
 * over the face (a HUD over a face is chrome, not data). Rects are in
 * viewport CSS px (scaled by `scale` = frame px per CSS px) except
 * `frameRects` (already frame px, e.g. the fitted HUD band).
 */
export function buildLumaMask({ width, height, scale = 1, faceRects = [], excludeRects = [], frameRects = [], excludeDiscs = [], figureRects = [] }) {
  const mask = new Uint8Array(width * height);
  const paint = (rect, label, s) => {
    const c = clipRect(rect, width, height, s);
    if (!c) return;
    for (let y = c.y0; y < c.y1; y += 1) mask.fill(label, y * width + c.x0, y * width + c.x1);
  };
  for (const rect of figureRects) paint(rect, MASK.FIGURE, scale);
  for (const rect of faceRects) paint(rect, MASK.FACE, scale);
  for (const rect of excludeRects) paint(rect, MASK.EXCLUDED, scale);
  for (const rect of frameRects) paint(rect, MASK.EXCLUDED, 1);
  for (const disc of excludeDiscs) {
    if (!disc || !(disc.r > 0)) continue;
    const cx = disc.x * scale;
    const cy = disc.y * scale;
    const r = disc.r * scale;
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height, Math.ceil(cy + r));
    for (let y = y0; y < y1; y += 1) {
      const dy = y + 0.5 - cy;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      const x0 = Math.max(0, Math.floor(cx - half));
      const x1 = Math.min(width, Math.ceil(cx + half));
      if (x1 > x0) mask.fill(MASK.EXCLUDED, y * width + x0, y * width + x1);
    }
  }
  return mask;
}

/** Luma verdict thresholds (plan §3: `outsideP995 ≤ activeFaceP99`). */
export const LUMA_FACE_P = 0.99;
export const LUMA_OUTSIDE_P = 0.995;
/** Fewer face pixels than this is no face measurement. */
export const LUMA_MIN_FACE_PX = 64;
/** Hotspot grid cell (frame px at scale 1) and the hot-pixel share that lights a cell. */
export const HOTSPOT_CELL_PX = 8;
export const HOTSPOT_CELL_SHARE = 0.06;
export const HOTSPOT_TOP = 6;

/** LOOK r2: a percentile at or above this luma sits in the clipped top band. */
export const LUMA_SATURATED = 254.5;

/**
 * LOOK r2: the saturation read of one luma verdict (pure). `saturated` when
 * the face P99 AND the outside P995 are both clipped (>= LUMA_SATURATED);
 * `saturatedExFigures` the same with figure rects left out. Always reports
 * the clipped share of each population and the same percentiles over the
 * UNCLIPPED pixels only (the part of the histogram that still carries
 * information), plus their comparison as `unclippedVerdict` (evidence, not
 * the gate).
 */
export function lumaSaturation({ faceHist, facePx, outHist, outPx, outExFigHist, outExFigPx, activeFaceP99, outsideP995, outsideP995ExFigures }) {
  const satBin = lumaBin(LUMA_SATURATED);
  const below = (hist) => {
    const h = hist.slice();
    let clipped = 0;
    for (let i = satBin; i < h.length; i += 1) {
      clipped += h[i];
      h[i] = 0;
    }
    return { h, clipped };
  };
  const face = below(faceHist);
  const out = below(outHist);
  const outEx = below(outExFigHist);
  const share = (n, d) => (d ? +(n / d).toFixed(4) : null);
  const faceUnclippedP99 = histogramPercentile(face.h, facePx - face.clipped, LUMA_FACE_P);
  const outsideUnclippedP995 = histogramPercentile(out.h, outPx - out.clipped, LUMA_OUTSIDE_P);
  const isSat = (v) => typeof v === 'number' && v >= LUMA_SATURATED;
  return {
    threshold: LUMA_SATURATED,
    saturated: isSat(activeFaceP99) && isSat(outsideP995),
    saturatedExFigures: isSat(activeFaceP99) && isSat(outsideP995ExFigures),
    faceClipShare: share(face.clipped, facePx),
    outsideClipShare: share(out.clipped, outPx),
    outsideExFiguresClipShare: share(outEx.clipped, outExFigPx),
    faceUnclippedP99,
    outsideUnclippedP995,
    unclippedVerdict: faceUnclippedP99 === null || outsideUnclippedP995 === null ? 'unmeasured' : outsideUnclippedP995 <= faceUnclippedP99 ? 'pass' : 'fail',
  };
}

/**
 * The --luma verdict over one frame. `raw` = { data, width, height, channels }
 * (sharp raw), `mask` = buildLumaMask output. Returns the two percentiles,
 * the verdict (`outsideP995 ≤ activeFaceP99`), the same comparison with the
 * figure rects left out (`exFigures`, the wave-2 exemption), and the top
 * hotspots: connected cells of OUTSIDE/FIGURE pixels brighter than the
 * face's P99, largest first, each with its frame + CSS rect, peak luma and
 * the figure ids it overlaps.
 */
export function lumaVerdict(raw, mask, { scale = 1, figureRects = [], cellPx = HOTSPOT_CELL_PX, top = HOTSPOT_TOP } = {}) {
  const { data, width, height } = raw;
  const channels = raw.channels ?? 3;
  const faceHist = new Uint32Array(LUMA_BINS);
  const outHist = new Uint32Array(LUMA_BINS);
  const outExFigHist = new Uint32Array(LUMA_BINS);
  let facePx = 0;
  let outPx = 0;
  let outExFigPx = 0;
  let excludedPx = 0;
  const lumas = new Float32Array(width * height);
  for (let i = 0, o = 0; i < width * height; i += 1, o += channels) {
    const l = luma709(data[o], data[o + 1], data[o + 2]);
    lumas[i] = l;
    const label = mask[i];
    if (label === MASK.FACE) {
      faceHist[lumaBin(l)] += 1;
      facePx += 1;
    } else if (label === MASK.EXCLUDED) excludedPx += 1;
    else {
      outHist[lumaBin(l)] += 1;
      outPx += 1;
      if (label === MASK.OUTSIDE) {
        outExFigHist[lumaBin(l)] += 1;
        outExFigPx += 1;
      }
    }
  }
  const activeFaceP99 = histogramPercentile(faceHist, facePx, LUMA_FACE_P);
  const outsideP995 = histogramPercentile(outHist, outPx, LUMA_OUTSIDE_P);
  const outsideP995ExFigures = histogramPercentile(outExFigHist, outExFigPx, LUMA_OUTSIDE_P);
  const base = {
    activeFaceP99,
    outsideP995,
    outsideP995ExFigures,
    pixels: { face: facePx, outside: outPx, outsideExFigures: outExFigPx, excluded: excludedPx, total: width * height },
    thresholds: { faceP: LUMA_FACE_P, outsideP: LUMA_OUTSIDE_P, minFacePx: LUMA_MIN_FACE_PX },
  };
  if (facePx < LUMA_MIN_FACE_PX || activeFaceP99 === null) {
    return { verdict: 'unmeasured', reason: facePx === 0 ? 'no active data face on screen (no station subject rect)' : `active face too small (${facePx} px < ${LUMA_MIN_FACE_PX})`, ...base, topHotspots: [] };
  }
  // Hotspots: grid cells whose OUTSIDE/FIGURE pixels exceed the face P99.
  const cell = Math.max(2, Math.round(cellPx * scale));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hot = new Uint8Array(cols * rows);
  const hotCount = new Uint32Array(cols * rows);
  const peak = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      let eligible = 0;
      let bright = 0;
      let max = 0;
      for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y += 1) {
        for (let x = cx * cell; x < Math.min(width, (cx + 1) * cell); x += 1) {
          const i = y * width + x;
          const label = mask[i];
          if (label !== MASK.OUTSIDE && label !== MASK.FIGURE) continue;
          eligible += 1;
          if (lumas[i] > activeFaceP99) {
            bright += 1;
            if (lumas[i] > max) max = lumas[i];
          }
        }
      }
      const k = cy * cols + cx;
      if (eligible > 0 && bright / eligible >= HOTSPOT_CELL_SHARE) {
        hot[k] = 1;
        hotCount[k] = bright;
        peak[k] = max;
      }
    }
  }
  const seen = new Uint8Array(cols * rows);
  const spots = [];
  for (let k = 0; k < hot.length; k += 1) {
    if (!hot[k] || seen[k]) continue;
    const stack = [k];
    seen[k] = 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let area = 0;
    let pk = 0;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % cols;
      const cy = (c - cx) / cols;
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      area += hotCount[c];
      pk = Math.max(pk, peak[c]);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (hot[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const frame = { x: minX * cell, y: minY * cell, w: Math.min(width, (maxX + 1) * cell) - minX * cell, h: Math.min(height, (maxY + 1) * cell) - minY * cell };
    const css = { x: +(frame.x / scale).toFixed(1), y: +(frame.y / scale).toFixed(1), w: +(frame.w / scale).toFixed(1), h: +(frame.h / scale).toFixed(1) };
    const figures = figureRects
      .filter((f) => f && f.id && css.x < f.x + f.w && f.x < css.x + css.w && css.y < f.y + f.h && f.y < css.y + css.h)
      .map((f) => f.id);
    spots.push({ frame, css, brightPx: area, peakLuma: +pk.toFixed(1), overLumaBy: +(pk - activeFaceP99).toFixed(1), figures });
  }
  spots.sort((a, b) => b.brightPx - a.brightPx);
  // LOOK r2 (CLARITY judge: face P99 = outside P995 = 254.88 at nearly every
  // rung-2 station, so the comparison carried no information): when BOTH
  // percentiles sit in the clipped top band the verdict is `saturated`, never
  // a pass or a fail; the record carries what still has information (the
  // clipped shares and the percentiles of the unclipped pixels) and the
  // caller falls back to the contrast verdict.
  const saturation = lumaSaturation({ faceHist, facePx, outHist, outPx, outExFigHist, outExFigPx, activeFaceP99, outsideP995, outsideP995ExFigures });
  const verdict = saturation.saturated ? 'saturated' : outsideP995 === null || outsideP995 <= activeFaceP99 ? 'pass' : 'fail';
  const exFigures = saturation.saturatedExFigures ? 'saturated' : outsideP995ExFigures === null || outsideP995ExFigures <= activeFaceP99 ? 'pass' : 'fail';
  return {
    verdict,
    ...(verdict === 'fail' ? { reason: `outsideP995 ${outsideP995} > activeFaceP99 ${activeFaceP99}` } : {}),
    ...(verdict === 'saturated' ? { reason: `activeFaceP99 ${activeFaceP99} and outsideP995 ${outsideP995} both clipped (>= ${LUMA_SATURATED}): no information; judge on the contrast verdict` } : {}),
    exFigures,
    saturation,
    ...base,
    hotspotRule: { cellPx: cell, minBrightShare: HOTSPOT_CELL_SHARE, above: 'activeFaceP99' },
    hotspotsTotal: spots.length,
    topHotspots: spots.slice(0, top),
  };
}

/** Contrast lines (WCAG): below FAIL is `fail`, below PASS is `marginal`. */
export const CONTRAST_FAIL = 3;
export const CONTRAST_PASS = 4.5;
/** Tile edge target (frame px) for the text-vs-ground estimate. */
export const CONTRAST_TILE_PX = 48;
/** A tile is text-bearing when at least this share of its pixels sit on the ink side. */
export const CONTRAST_INK_MIN_SHARE = 0.02;
export const CONTRAST_INK_MAX_SHARE = 0.45;

function quantileSorted(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/**
 * Glyph classification (wave 2 round 3, W1 judge: minContrast 1.25 came
 * from scanline and diagonal tiles on correctly lit boards). A tile's ink
 * pixels (past the ground/ink log-luminance midpoint) are split into
 * seam rows / columns (>= GLYPH_SEAM_FILL of a tile row or column on the ink
 * side: LED scanlines, panel seams, frame rails) and 8-connected components.
 * A component is a GLYPH when it is at least GLYPH_MIN_AREA px, spans at most
 * GLYPH_MAX_SPAN of the tile in each axis (a diagonal stripe, bezel corner
 * or rail crosses the tile; a glyph does not at the 48 px tile) and its
 * stroke width (median over its pixels of the shorter of the horizontal and
 * vertical ink run through the pixel) is at most GLYPH_MAX_STROKE of the
 * tile's shorter side (solid pads and bezels are thick). Everything else is
 * classified and reported, never judged.
 */
export const GLYPH_SEAM_FILL = 0.8;
export const GLYPH_MIN_AREA = 3;
export const GLYPH_MAX_SPAN = 0.75;
export const GLYPH_MAX_STROKE = 0.2;
/** A text tile: glyph ink is at least this share of the tile's non-noise ink. */
export const GLYPH_INK_SHARE_MIN = 0.6;
/** Ink core = this quantile of the glyph pixels from the ink side (the stroke core, not its anti-aliased edge). */
export const GLYPH_CORE_Q = 0.1;

/**
 * Classify one tile's luminance grid (`lum`: Float32Array tw*th, NaN =
 * excluded pixel). Pure; exported for tests. `class` is one of text,
 * seam, span, blob, sparse, low-signal, no-ink, excluded.
 */
export function classifyContrastTile(lum, tw, th) {
  const valid = [];
  for (let i = 0; i < lum.length; i += 1) if (!Number.isNaN(lum[i])) valid.push(lum[i]);
  if (valid.length < 16) return { class: 'excluded', validPx: valid.length };
  valid.sort((a, b) => a - b);
  const median = quantileSorted(valid, 0.5);
  const lo = quantileSorted(valid, 0.03);
  const hi = quantileSorted(valid, 0.97);
  const darkInk = contrastRatio(median, lo) >= contrastRatio(median, hi);
  const tail = darkInk ? lo : hi;
  const mid = Math.exp((Math.log(median + 0.05) + Math.log(tail + 0.05)) / 2) - 0.05;
  const isInk = (v) => !Number.isNaN(v) && (darkInk ? v < mid : v > mid);
  const polarity = darkInk ? 'dark-on-light' : 'light-on-dark';
  const tailRatio = contrastRatio(median, tail);
  const ink = new Uint8Array(tw * th);
  let inkPx = 0;
  for (let i = 0; i < lum.length; i += 1) {
    if (isInk(lum[i])) {
      ink[i] = 1;
      inkPx += 1;
    }
  }
  if (inkPx === 0 || tailRatio < 1.05) return { class: 'no-ink', validPx: valid.length, polarity, tailRatio: +tailRatio.toFixed(2) };
  // Seams / scanlines: rows or columns that are ink across the tile.
  const seam = new Uint8Array(tw * th);
  let seamRows = 0;
  let seamCols = 0;
  for (let y = 0; y < th; y += 1) {
    let n = 0;
    let v = 0;
    for (let x = 0; x < tw; x += 1) {
      const i = y * tw + x;
      if (Number.isNaN(lum[i])) continue;
      v += 1;
      if (ink[i]) n += 1;
    }
    if (v >= tw * 0.5 && n >= v * GLYPH_SEAM_FILL) {
      seamRows += 1;
      for (let x = 0; x < tw; x += 1) seam[y * tw + x] = 1;
    }
  }
  for (let x = 0; x < tw; x += 1) {
    let n = 0;
    let v = 0;
    for (let y = 0; y < th; y += 1) {
      const i = y * tw + x;
      if (Number.isNaN(lum[i])) continue;
      v += 1;
      if (ink[i]) n += 1;
    }
    if (v >= th * 0.5 && n >= v * GLYPH_SEAM_FILL) {
      seamCols += 1;
      for (let y = 0; y < th; y += 1) seam[y * tw + x] = 1;
    }
  }
  let seamPx = 0;
  for (let i = 0; i < ink.length; i += 1) {
    if (ink[i] && seam[i]) {
      ink[i] = 0;
      seamPx += 1;
    }
  }
  // Ink run lengths through every remaining ink pixel (the stroke-width basis).
  const hRun = new Uint16Array(tw * th);
  const vRun = new Uint16Array(tw * th);
  for (let y = 0; y < th; y += 1) {
    let x = 0;
    while (x < tw) {
      if (!ink[y * tw + x]) {
        x += 1;
        continue;
      }
      let e = x;
      while (e < tw && ink[y * tw + e]) e += 1;
      for (let k = x; k < e; k += 1) hRun[y * tw + k] = e - x;
      x = e;
    }
  }
  for (let x = 0; x < tw; x += 1) {
    let y = 0;
    while (y < th) {
      if (!ink[y * tw + x]) {
        y += 1;
        continue;
      }
      let e = y;
      while (e < th && ink[e * tw + x]) e += 1;
      for (let k = y; k < e; k += 1) vRun[k * tw + x] = e - y;
      y = e;
    }
  }
  // 8-connected components.
  const seen = new Uint8Array(tw * th);
  const counts = { glyph: 0, noise: 0, span: 0, blob: 0 };
  const px = { glyph: 0, noise: 0, span: 0, blob: 0 };
  const glyphValues = [];
  const strokes = [];
  const maxStroke = Math.max(3, GLYPH_MAX_STROKE * Math.min(tw, th));
  const stack = [];
  for (let start = 0; start < ink.length; start += 1) {
    if (!ink[start] || seen[start]) continue;
    const members = [];
    seen[start] = 1;
    stack.push(start);
    let minX = tw;
    let maxX = -1;
    let minY = th;
    let maxY = -1;
    while (stack.length) {
      const i = stack.pop();
      members.push(i);
      const x = i % tw;
      const y = (i - x) / tw;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
          const j = ny * tw + nx;
          if (ink[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const area = members.length;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    let kind;
    let stroke = null;
    if (area < GLYPH_MIN_AREA) kind = 'noise';
    else if (bw > GLYPH_MAX_SPAN * tw || bh > GLYPH_MAX_SPAN * th) kind = 'span';
    else {
      const mins = members.map((i) => Math.min(hRun[i], vRun[i])).sort((a, b) => a - b);
      stroke = mins[Math.floor(mins.length / 2)];
      kind = stroke > maxStroke ? 'blob' : 'glyph';
    }
    counts[kind] += 1;
    px[kind] += area;
    if (kind === 'glyph') {
      strokes.push(stroke);
      for (const i of members) glyphValues.push(lum[i]);
    }
  }
  const signalInk = px.glyph + px.span + px.blob + seamPx;
  const glyphShareOfInk = signalInk > 0 ? px.glyph / signalInk : 0;
  const glyphShareOfTile = px.glyph / valid.length;
  // Ground = median of the non-ink, non-seam pixels (the paper the glyphs sit on).
  const paper = [];
  for (let i = 0; i < lum.length; i += 1) if (!Number.isNaN(lum[i]) && !isInk(lum[i]) && !seam[i]) paper.push(lum[i]);
  paper.sort((a, b) => a - b);
  const ground = paper.length ? quantileSorted(paper, 0.5) : median;
  glyphValues.sort((a, b) => a - b);
  const core = glyphValues.length ? quantileSorted(glyphValues, darkInk ? GLYPH_CORE_Q : 1 - GLYPH_CORE_Q) : null;
  const ratio = core === null ? null : contrastRatio(ground, core);
  strokes.sort((a, b) => a - b);
  let cls;
  if (counts.glyph === 0) cls = seamRows + seamCols > 0 ? 'seam' : counts.span > 0 ? 'span' : counts.blob > 0 ? 'blob' : 'no-ink';
  else if (glyphShareOfInk < GLYPH_INK_SHARE_MIN) cls = seamPx >= Math.max(px.span, px.blob) ? 'seam' : px.span >= px.blob ? 'span' : 'blob';
  else if (glyphShareOfTile < CONTRAST_INK_MIN_SHARE || glyphShareOfTile > CONTRAST_INK_MAX_SHARE) cls = 'sparse';
  else if (ratio < 1.25) cls = 'low-signal';
  else cls = 'text';
  return {
    class: cls,
    validPx: valid.length,
    polarity,
    ground: +ground.toFixed(4),
    ink: core === null ? null : +core.toFixed(4),
    ratio: ratio === null ? null : +ratio.toFixed(2),
    tailRatio: +tailRatio.toFixed(2),
    inkShare: +glyphShareOfTile.toFixed(3),
    glyphShareOfInk: +glyphShareOfInk.toFixed(3),
    glyphs: counts.glyph,
    strokePx: strokes.length ? strokes[Math.floor(strokes.length / 2)] : null,
    rejected: { seamRows, seamCols, span: counts.span, blob: counts.blob, noise: counts.noise },
  };
}

/**
 * Rendered-pixel text-vs-ground contrast inside one face rect (CSS px) of
 * the FINAL PNG. The rect is cut into ~CONTRAST_TILE_PX tiles and each tile
 * is classified by classifyContrastTile: only `text` tiles (glyph-like ink
 * — thin strokes, compact components, 2..45 % of the tile, glyph ink >= 60 %
 * of the tile's ink, ratio >= 1.25) are judged. The ratio is the ground
 * (median of the non-ink pixels) against the glyph stroke core (the
 * GLYPH_CORE_Q tail of the glyph pixels). Seams / scanlines, crossing spans
 * (diagonal stripes, bezel corners, rails) and thick blobs are counted in
 * `excludedTiles`, never judged. EXCLUDED mask pixels (HUD, chrome) are
 * skipped. Verdict on the worst text tile: < 3 fail, < 4.5 marginal, else
 * pass; no text tile = unmeasured.
 */
export function faceContrast(raw, rect, { scale = 1, mask = null, tilePx = CONTRAST_TILE_PX, insetTiles = 0 } = {}) {
  const { data, width, height } = raw;
  const channels = raw.channels ?? 3;
  const c = clipRect(rect, width, height, scale);
  if (!c) return { verdict: 'unmeasured', reason: 'face rect off frame', tiles: 0, textTiles: 0 };
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  const nx = Math.max(1, Math.min(16, Math.round(w / (tilePx * scale))));
  const ny = Math.max(1, Math.min(16, Math.round(h / (tilePx * scale))));
  const tiles = [];
  const excludedTiles = {};
  // LOOK r3 (CLARITY judge): the face rect is the subject's screen AABB, so
  // its outer ring of tiles holds bezel / frame / cobble pixels. With
  // insetTiles = k the outer k tiles of each axis are never JUDGED (they are
  // reported under `edge`); an axis with <= 2k tiles keeps all its tiles.
  const insetX = insetTiles > 0 && nx > 2 * insetTiles ? insetTiles : 0;
  const insetY = insetTiles > 0 && ny > 2 * insetTiles ? insetTiles : 0;
  const edgeTiles = [];
  for (let ty = 0; ty < ny; ty += 1) {
    for (let tx = 0; tx < nx; tx += 1) {
      const onEdge = tx < insetX || tx >= nx - insetX || ty < insetY || ty >= ny - insetY;
      const x0 = c.x0 + Math.floor((tx * w) / nx);
      const x1 = c.x0 + Math.floor(((tx + 1) * w) / nx);
      const y0 = c.y0 + Math.floor((ty * h) / ny);
      const y1 = c.y0 + Math.floor(((ty + 1) * h) / ny);
      const tw = x1 - x0;
      const th = y1 - y0;
      if (tw <= 0 || th <= 0) continue;
      const lum = new Float32Array(tw * th);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = y * width + x;
          const k = (y - y0) * tw + (x - x0);
          if (mask && mask[i] === MASK.EXCLUDED) {
            lum[k] = NaN;
            continue;
          }
          const o = i * channels;
          lum[k] = relativeLuminance(data[o], data[o + 1], data[o + 2]);
        }
      }
      const t = classifyContrastTile(lum, tw, th);
      if (t.class === 'excluded') continue;
      if (onEdge) {
        edgeTiles.push({ frame: { x: x0, y: y0, w: tw, h: th }, class: t.class, ratio: typeof t.ratio === 'number' ? t.ratio : null });
        continue;
      }
      if (t.class !== 'text') excludedTiles[t.class] = (excludedTiles[t.class] ?? 0) + 1;
      tiles.push({ frame: { x: x0, y: y0, w: tw, h: th }, ...t, text: t.class === 'text' });
    }
  }
  const text = tiles.filter((t) => t.text);
  const edgeText = edgeTiles.filter((t) => t.class === 'text' && typeof t.ratio === 'number');
  const edge =
    insetTiles > 0
      ? {
          insetTiles,
          applied: { x: insetX, y: insetY },
          tiles: edgeTiles.length,
          textTiles: edgeText.length,
          minContrast: edgeText.length ? Math.min(...edgeText.map((t) => t.ratio)) : null,
          note: 'outer tile ring of the face AABB (bezel / frame / cobble pixels): reported, never judged',
        }
      : null;
  if (text.length === 0) return { verdict: 'unmeasured', reason: 'no glyph-bearing text tile on the face', tiles: tiles.length, textTiles: 0, excludedTiles, grid: { nx, ny }, ...(edge ? { edge } : {}) };
  const ratios = text.map((t) => t.ratio).sort((a, b) => a - b);
  const worst = text.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const min = ratios[0];
  return {
    verdict: min < CONTRAST_FAIL ? 'fail' : min < CONTRAST_PASS ? 'marginal' : 'pass',
    minContrast: min,
    medianContrast: ratios[Math.floor(ratios.length / 2)],
    thresholds: { fail: CONTRAST_FAIL, pass: CONTRAST_PASS },
    method: 'glyph-classified tiles (wave 2 r3): seams / scanlines, crossing spans and thick blobs excluded; ratio = paper median vs glyph stroke core',
    tiles: tiles.length,
    textTiles: text.length,
    excludedTiles,
    grid: { nx, ny },
    worstTile: { ...worst, css: { x: +(worst.frame.x / scale).toFixed(1), y: +(worst.frame.y / scale).toFixed(1), w: +(worst.frame.w / scale).toFixed(1), h: +(worst.frame.h / scale).toFixed(1) } },
    lowTiles: text.filter((t) => t.ratio < CONTRAST_PASS).length,
    ...(edge ? { edge } : {}),
  };
}

/**
 * The data faces each station's luma is judged on (focus-subject ids): the
 * pulse / schedule boards, the roster surface, the teams ledger (2G — the
 * aces are figures, not faces) and the rules surface. A station with none
 * on screen is `unmeasured`, never a pass.
 */
export const LUMA_FACE_PATTERNS = {
  pulse: [/^board:pulse$/],
  roster: [/^roster:/, /^desk-pc$/, /^board:roster$/],
  teams: [/^ledger(:|$)/, /^teams?-ledger/, /^board:teams$/],
  schedule: [/^board:schedule$/],
  rules: [/^rules:/, /^plaque:/, /^board:rules$/],
};

export function isLumaFace(id, station) {
  const patterns = LUMA_FACE_PATTERNS[station];
  return Boolean(patterns && typeof id === 'string' && patterns.some((re) => re.test(id)));
}

/** The on-screen active-face rects for `station` from a `__routeWorldSubjects()` report. */
export function activeFaceRects(subjects, station) {
  const rows = Array.isArray(subjects?.rows) ? subjects.rows : [];
  return rows
    .filter((row) => isLumaFace(row.id, station) && row.rect && row.rect.w > 0 && row.rect.h > 0 && (row.onScreenFraction ?? 1) > 0)
    .map((row) => ({ id: row.id, ...row.rect, onScreenFraction: row.onScreenFraction ?? null, ...(row.rectSource ? { rectSource: row.rectSource } : {}) }));
}

// ---------------------------------------------------------------------------
// Docked panel (plan §3: font-size ≥ 14 px and the panel in the viewport)
// ---------------------------------------------------------------------------

export const PANEL_MIN_FONT_PX = 14;

/**
 * `read` = readDockedPanel output: { present, selector, rect, viewport,
 * fontSizePx, minTextFontPx, minTextSample, textNodes, bodyTextNodes }.
 * `absent` when no panel is open (not a pass, not a fail); `fail` when any
 * rendered text inside it is under 14 px, the panel box leaves the viewport,
 * or its BODY (everything but the title bar) renders no text at all.
 *
 * The body check (PR #65 test pass, R4): the route-live section rule hid the
 * <section>s of the docked rulebook, so the panel opened as a bare title bar
 * — the title's 18 px was the smallest visible text and the arm passed.
 * A read without `bodyTextNodes` (an older sidecar) is not judged on it.
 */
export function dockedPanelVerdict(read, { minFontPx = PANEL_MIN_FONT_PX, tolerancePx = 0.5 } = {}) {
  if (!read || read.present !== true) return { verdict: 'absent', reason: 'no docked panel open at this still' };
  const reasons = [];
  if (read.bodyTextNodes === 0) reasons.push('panel body renders no visible text (hidden, content-visibility skipped or zero-size)');
  const { rect, viewport } = read;
  const inViewport = Boolean(
    rect && viewport && rect.x >= -tolerancePx && rect.y >= -tolerancePx && rect.x + rect.w <= viewport.w + tolerancePx && rect.y + rect.h <= viewport.h + tolerancePx,
  );
  let visibleFraction = null;
  if (rect && viewport && rect.w > 0 && rect.h > 0) {
    const w = Math.max(0, Math.min(viewport.w, rect.x + rect.w) - Math.max(0, rect.x));
    const h = Math.max(0, Math.min(viewport.h, rect.y + rect.h) - Math.max(0, rect.y));
    visibleFraction = +((w * h) / (rect.w * rect.h)).toFixed(3);
  }
  if (!inViewport) reasons.push(`panel box leaves the viewport (visible ${visibleFraction})`);
  const smallest = typeof read.minTextFontPx === 'number' ? read.minTextFontPx : read.fontSizePx;
  if (typeof smallest !== 'number') reasons.push('no computed font-size read');
  else if (smallest + 1e-6 < minFontPx) reasons.push(`text at ${smallest} px < ${minFontPx} px${read.minTextSample ? ` ("${read.minTextSample}")` : ''}`);
  return {
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    minFontPx,
    fontSizePx: read.fontSizePx ?? null,
    minTextFontPx: read.minTextFontPx ?? null,
    minTextSample: read.minTextSample ?? null,
    textNodes: read.textNodes ?? null,
    bodyTextNodes: read.bodyTextNodes ?? null,
    selector: read.selector ?? null,
    rect: rect ?? null,
    inViewport,
    visibleFraction,
  };
}

// ---------------------------------------------------------------------------
// Pass-through bridges (future: 3A __routeWorldBeats, 6A __routeWorldAttacks)
// ---------------------------------------------------------------------------

// R40 (desktop CAPTURE): + the core probe actors (K6/K8: plays, surfacings,
// passes, flips) and the water bodies (K6: wakes, pool evictions), read at the
// same points as the beats (sidecar keys `coreActors`, `water`).
export const PASS_THROUGH_BRIDGES = ['__routeWorldBeats', '__routeWorldAttacks', '__routeWorldCoreActors', '__routeWorldWater'];

/**
 * One pass-through record. `read` = { present, value?, error? } from the page.
 * Absent → `unmeasured`; a throwing bridge → `error`; otherwise `recorded`
 * with the raw value (and an entry count when it is a list or carries one).
 * The harness never judges these: there is no `pass` here, by contract —
 * the later waves' analyzers read the recorded value.
 */
export function passThroughRecord(name, read) {
  if (!read || read.present !== true) return { bridge: name, status: 'unmeasured', reason: `window.${name} absent (bridge not mounted yet, or debug off)` };
  if (read.error) return { bridge: name, status: 'error', error: String(read.error) };
  const value = read.value ?? null;
  let entries = null;
  if (Array.isArray(value)) entries = value.length;
  else if (value && typeof value === 'object') {
    for (const key of ['rows', 'entries', 'grants', 'fires', 'events', 'attacks', 'beats', 'actors', 'bodies']) {
      if (Array.isArray(value[key])) {
        entries = value[key].length;
        break;
      }
    }
  }
  return { bridge: name, status: 'recorded', judged: false, entries, value };
}

// ---------------------------------------------------------------------------
// Settle signal (2A useStationSettle, read-only consumer)
// ---------------------------------------------------------------------------

/**
 * The latched `settled` flag from a pose-probe body: `settled` (boolean), or
 * a `stationSettle` / `settle` object carrying `settled`. null = the page
 * does not publish it yet (2A not merged) — recorded as unmeasured, never
 * assumed true.
 */
export function settledOf(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.settled === 'boolean') return body.settled;
  for (const key of ['stationSettle', 'settle']) {
    const nested = body[key];
    if (nested && typeof nested === 'object' && typeof nested.settled === 'boolean') return nested.settled;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Draw audit (--audit on) + DRAW-LEDGER.md
// ---------------------------------------------------------------------------

/**
 * Summarize the per-frame audit reads: { calls, triangles } per read →
 * median / min / max calls, median triangles. `autoReset` (the renderer's
 * info.autoReset at read time) must be false for the calls to be whole
 * frames (the debug TelemetrySampler turns it off); true marks the numbers
 * `last-pass-only`, never a ledger value.
 */
export function drawAuditSummary(reads, { programs = null, autoReset = null } = {}) {
  const calls = reads.map((r) => r?.calls).filter((v) => typeof v === 'number' && v >= 0).sort((a, b) => a - b);
  const tris = reads.map((r) => r?.triangles).filter((v) => typeof v === 'number' && v >= 0).sort((a, b) => a - b);
  if (calls.length === 0) return { verdict: 'unmeasured', reason: 'no audit read carried a draw-call count', reads: reads.length };
  const reliable = autoReset !== true;
  return {
    verdict: reliable ? 'measured' : 'unmeasured',
    ...(reliable ? {} : { reason: 'renderer.info.autoReset is on (TelemetrySampler not mounted): the count is the last render pass, not the frame' }),
    calls: calls[Math.floor(calls.length / 2)],
    callsMin: calls[0],
    callsMax: calls[calls.length - 1],
    triangles: tris.length ? tris[Math.floor(tris.length / 2)] : null,
    programs,
    frames: calls.length,
    autoReset,
  };
}

export const DRAW_LEDGER_ROWS_MARKER = '<!-- capture-route --audit on appends rows below this line -->';
export const DRAW_LEDGER_HEADER = [
  '| When (UTC) | Tag | World | Theme | Station | Viewport | Rung | Draw calls (median; min–max) | Triangles | Programs | Source stamp |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
];

/** One DRAW-LEDGER.md table row (backslashes and pipes in values are escaped). */
export function drawLedgerRow({ at, tag, world, theme, station, viewport, rung, audit, sourceStamp }) {
  const cell = (v) => String(v ?? '—').replace(/[\\|]/g, '\\$&');
  const calls =
    audit && audit.verdict === 'measured'
      ? `${audit.calls} (${audit.callsMin}–${audit.callsMax})`
      : `unmeasured${audit?.reason ? `: ${audit.reason}` : ''}`;
  return `| ${[at, tag, world ?? 'plaza', theme, station, viewport, rung, calls, audit?.triangles, audit?.programs, sourceStamp]
    .map(cell)
    .join(' | ')} |`;
}

// ---------------------------------------------------------------------------
// W7 trace hygiene (harness residual 4)
// ---------------------------------------------------------------------------

/** A composite / film frame within this many ms of a zero read can confirm it. */
export const ZERO_READ_CONFIRM_MS = 60;

/**
 * Canvas readbacks with a spread of EXACTLY 0 at full opacity are a readback
 * artifact far more often than a blank frame (r5: plaza-rm-1440 had 18 such
 * reads while its film showed the painted world). A zero read counts as
 * blank only when the PREVIOUS distinct read is also exactly 0 AND a
 * composited frame (film / composite, `confirmFrames` = [{ t, spread }])
 * within ZERO_READ_CONFIRM_MS shows a blank (spread <= blankSpreadMax);
 * otherwise its `canvasSpread` becomes null (unread, never blank) and it is
 * counted in `demoted`. `merged` samples may carry `pixelT` (the read's own
 * time); without it consecutive samples with the same spread share a read.
 */
export function sanitizeZeroReads(merged, { confirmFrames = null, blankSpreadMax = 3, visibleOpacity = 0.98 } = {}) {
  const out = [];
  let demoted = 0;
  let confirmed = 0;
  // The current distinct read and the one before it. Samples between two
  // reads carry the same read (same pixelT); without pixelT every sample is
  // treated as its own read.
  let curT;
  let curSpread = null;
  let priorSpread = null;
  const frames = Array.isArray(confirmFrames) ? confirmFrames : [];
  for (const s of merged) {
    const readT = typeof s.pixelT === 'number' ? s.pixelT : s.t;
    if (typeof s.canvasSpread === 'number' && readT !== curT) {
      priorSpread = curSpread;
      curSpread = s.canvasSpread;
      curT = readT;
    }
    const zero = s.canvasSpread === 0 && typeof s.canvasOpacity === 'number' && s.canvasOpacity >= visibleOpacity;
    if (!zero) {
      out.push(s);
      continue;
    }
    const twoAgree = priorSpread === 0;
    const confirm = frames.some((f) => typeof f.t === 'number' && typeof f.spread === 'number' && Math.abs(f.t - s.t) <= ZERO_READ_CONFIRM_MS && f.spread <= blankSpreadMax);
    if (twoAgree && confirm) {
      confirmed += 1;
      out.push(s);
    } else {
      demoted += 1;
      out.push({ ...s, canvasSpread: null, zeroReadUnconfirmed: true });
    }
  }
  return { merged: out, demoted, confirmed, rule: `spread === 0 at opacity >= ${visibleOpacity} is unread unless the previous read is also 0 and a composited frame within ${ZERO_READ_CONFIRM_MS} ms shows spread <= ${blankSpreadMax}` };
}

/**
 * THE deadline anchor (one for overrun, timeline and the timeout path): the
 * product's `generationBegunAt` carried by the first `loading` sample (the
 * generation the ceremony belongs to), else the first positive begunAt;
 * only without either does it fall back to the first loading sample's own
 * time, then the first ball frame. The first-loading-sample time is reported
 * beside it as information (r5: the two differed by 385 ms).
 */
export function deadlineAnchorOf(merged) {
  const firstLoading = merged.find((s) => s.scenePhase === 'loading') ?? null;
  const firstBall = merged.find((s) => s.ballVisible) ?? null;
  let anchor = null;
  let source = null;
  if (firstLoading && typeof firstLoading.begunAt === 'number' && firstLoading.begunAt > 0) {
    anchor = firstLoading.begunAt;
    source = 'generationBegunAt';
  } else {
    const begun = merged.find((s) => typeof s.begunAt === 'number' && s.begunAt > 0) ?? null;
    if (begun) {
      anchor = begun.begunAt;
      source = 'generationBegunAt';
    } else if (firstLoading) {
      anchor = firstLoading.t;
      source = 'first-loading-sample';
    } else if (firstBall) {
      anchor = firstBall.t;
      source = 'first-ball-frame';
    }
  }
  return {
    anchor,
    source,
    firstLoadingSampleAt: firstLoading ? firstLoading.t : null,
    firstLoadingSampleOffsetMs: firstLoading && anchor !== null ? +(firstLoading.t - anchor).toFixed(1) : null,
  };
}

/** Ball-visible intervals more than `deadlineMs` after the single anchor. */
export function overrunFromAnchor(merged, anchor, deadlineMs) {
  if (anchor === null || anchor === undefined) return null;
  let open = null;
  for (const s of merged) {
    if (s.ballVisible && s.t - anchor > deadlineMs) {
      if (open) {
        open.to = s.t;
        open.frames += 1;
      } else open = { from: s.t, to: s.t, frames: 1 };
    } else if (open) break;
  }
  return open;
}

/**
 * Phase transitions from the product's own logs (`ballTrace` [{ phase, t }],
 * `phaseTrace` [{ phase, generation, t }]) — every committed change, even
 * one that lived for a single commit between two rAF samples. Falls back to
 * the rAF-sampled transitions when the log is absent.
 */
export function productPhaseStamps(readiness, sampled = null) {
  const log = (list, key) =>
    Array.isArray(list)
      ? list.filter((e) => e && typeof e.t === 'number').map((e) => ({ t: +e.t.toFixed(1), [key]: e.phase ?? null, ...(typeof e.generation === 'number' ? { generation: e.generation } : {}) }))
      : null;
  const ball = log(readiness?.ballTrace, 'ballPhase');
  const scene = log(readiness?.phaseTrace, 'scenePhase');
  const sequence = (list, key) => (list ? list.map((e) => e[key]) : null);
  return {
    source: ball || scene ? 'product-trace' : 'rAF-samples',
    ballPhases: ball ?? sampled?.ballPhases ?? null,
    scenePhases: scene ?? sampled?.scenePhases ?? null,
    ballSequence: sequence(ball, 'ballPhase'),
    releasingSeen: ball ? ball.some((e) => e.ballPhase === 'releasing') : null,
    lastFault: readiness?.lastFault ?? null,
    note: 'ball/scene phases from __routeWorldReadiness().ballTrace / phaseTrace (bounded logs: 48 / 32 newest entries)',
  };
}

/**
 * Wobble truth on the PRODUCT clock (r5: `animationstart` is dispatched late
 * under a main-thread stall — one rock's start and end events landed
 * together 1.8 s after it began). Starts = `rockStart` entries of
 * `__routeWorldReadiness().wobbleTrace` (Animation.startTime, the rock's
 * real start on the document timeline), one per shake; fallback = the
 * `animationstart` entries (event time, flagged) — never the rAF samples.
 * Rises = the product's milestone stamps (`milestones.at`). Every start must
 * lie within `toleranceMs` of a rise (the start may also precede the stamp
 * by up to the tolerance: both clocks are performance.now()). `unmeasured`
 * without a wobble log or milestone stamps.
 */
export function productWobbleVerdict(readiness, { toleranceMs = 100 } = {}) {
  const trace = Array.isArray(readiness?.wobbleTrace) ? readiness.wobbleTrace : null;
  const at = readiness?.milestones?.at;
  const rises = at && typeof at === 'object' ? Object.entries(at).filter(([, t]) => typeof t === 'number').map(([name, t]) => ({ name, t })).sort((a, b) => a.t - b.t) : [];
  if (!trace) return { verdict: 'unmeasured', source: null, reasons: ['__routeWorldReadiness().wobbleTrace absent'] };
  if (rises.length === 0) return { verdict: 'unmeasured', source: null, reasons: ['no milestone stamps (milestones.at) in the readiness trace'] };
  const byShake = new Map();
  let source = 'rockStart';
  for (const e of trace) {
    if (e?.kind === 'rockStart' && typeof e.startTime === 'number' && !byShake.has(e.shake)) byShake.set(e.shake, e.startTime);
  }
  if (byShake.size === 0) {
    source = 'animationstart-event-time';
    for (const e of trace) {
      if (e?.kind === 'animationstart' && /(^|_)wobble($|_)/i.test(String(e.animationName ?? '')) && typeof e.t === 'number' && !byShake.has(e.shake)) byShake.set(e.shake, e.t);
    }
  }
  const starts = [...byShake.entries()].map(([shake, t]) => ({ shake, t })).sort((a, b) => a.t - b.t);
  const rows = starts.map((s) => {
    const nearest = rises.reduce((best, r) => (best === null || Math.abs(r.t - s.t) < Math.abs(best.t - s.t) ? r : best), null);
    const lagMs = nearest ? +(s.t - nearest.t).toFixed(1) : null;
    return { shake: s.shake, t: +s.t.toFixed(1), nearestRise: nearest?.name ?? null, riseT: nearest ? +nearest.t.toFixed(1) : null, lagMs, matched: lagMs !== null && Math.abs(lagMs) <= toleranceMs };
  });
  const unmatched = rows.filter((r) => !r.matched);
  // Wave 2 r3: the ball stops rocking once it opens, so a milestone that
  // rises after the first `opening` needs no wobble (exempt, listed apart).
  const openingAt = Array.isArray(readiness?.ballTrace) ? (readiness.ballTrace.find((e) => e?.phase === 'opening' && typeof e.t === 'number')?.t ?? null) : null;
  const unwobbled = rises.filter((r) => !rows.some((w) => w.nearestRise === r.name && w.matched));
  const exempt = openingAt === null ? [] : unwobbled.filter((r) => r.t >= openingAt);
  // lagMs exactly 0 on most rows means the product stamps the milestone from
  // the rock (or vice versa): same-clock self-stamping, not an independent
  // measurement. Disclosed; the rAF-sampled wobble check is the independent one.
  const zeroLag = rows.filter((r) => r.lagMs === 0).length;
  return {
    verdict: starts.length === 0 ? 'unmeasured' : unmatched.length > 0 ? 'fail' : 'pass',
    source,
    toleranceMs,
    rises: rises.map((r) => ({ name: r.name, t: +r.t.toFixed(1) })),
    starts: rows,
    risesWithoutWobble: unwobbled.filter((r) => !exempt.includes(r)).map((r) => r.name),
    risesAfterOpeningExempt: exempt.map((r) => r.name),
    openingAt: openingAt === null ? null : +openingAt.toFixed(1),
    selfStampSuspect: rows.length > 1 && zeroLag >= rows.length - 1 ? { zeroLagRows: zeroLag, rows: rows.length, note: 'lagMs is exactly 0 on (almost) every rock: the product likely stamps milestone and rock from one call — judge with the independent rAF-sampled analysis.wobble.sampled' } : null,
    reasons: starts.length === 0 ? ['no rock start in the wobble log'] : unmatched.length ? [`${unmatched.length} wobble start(s) more than ${toleranceMs} ms from a milestone stamp (${source})`] : [],
  };
}

/** Longest compositor gap (ms) the ceremony may show inside its reveal window. */
export const COMPOSITOR_GAP_LIMIT_MS = 100;

/**
 * Compositor cadence inside the ceremony's reveal window. Screencast frames
 * carry the compositor's own swap timestamp (`tEpoch`, page clock via
 * timeOrigin) and are emitted on every visual change, so while the CSS
 * ceremony animates, their spacing IS the compositor's cadence — a
 * main-thread stall does not stop a compositor-driven animation, and the
 * in-frame timecode (painted by page JS) would freeze while it continues.
 * Both are reported: `compositor` (tEpoch intervals) and `mainThread` (gaps
 * between distinct timecode values). Verdict on the compositor only: fail
 * when a gap exceeds COMPOSITOR_GAP_LIMIT_MS; unmeasured with < 5 screencast
 * frames in the window. Disclosed: the CDP screencast is acked per frame, so
 * a busy harness can thin it — a fail is re-shot before it is believed.
 */
export function ceremonyCadence(frames, window, { limitMs = COMPOSITOR_GAP_LIMIT_MS, minFrames = 5, source = 'screencast' } = {}) {
  if (!window || typeof window.start !== 'number' || typeof window.end !== 'number' || window.end <= window.start) {
    return { verdict: 'unmeasured', source, reasons: ['no reveal window (the ceremony never reached presented/opening → done)'], byPhase: cadencePerBallPhase(frames, { source }) };
  }
  const periodicOnly = source === 'periodic';
  // Periodic frames are stamped by their capture (t); screencast frames by the compositor swap (tEpoch).
  const stampOf = (f) => (periodicOnly ? f.t : f.tEpoch);
  const pick = (f) => (periodicOnly ? f.kind === 'periodic' : f.kind !== 'periodic');
  const cast = frames.filter((f) => pick(f) && typeof stampOf(f) === 'number' && stampOf(f) >= window.start && stampOf(f) <= window.end).map(stampOf).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < cast.length; i += 1) intervals.push(cast[i] - cast[i - 1]);
  const edgeGaps = cast.length ? [cast[0] - window.start, window.end - cast[cast.length - 1]] : [window.end - window.start];
  const sorted = [...intervals].sort((a, b) => a - b);
  const q = (p) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1) : null);
  const maxGap = sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null;
  const shown = [...new Set(frames.filter((f) => f.kind !== 'periodic' && typeof f.tTimecode === 'number' && typeof f.tEpoch === 'number' && f.tEpoch >= window.start && f.tEpoch <= window.end).map((f) => Math.round(f.tTimecode)))].sort((a, b) => a - b);
  let mainMax = null;
  for (let i = 1; i < shown.length; i += 1) mainMax = Math.max(mainMax ?? 0, shown[i] - shown[i - 1]);
  const reasons = [];
  let verdict = 'pass';
  if (cast.length < minFrames) {
    verdict = 'unmeasured';
    reasons.push(`only ${cast.length} ${source} frame(s) inside the reveal window (< ${minFrames})`);
  } else if (maxGap !== null && maxGap > limitMs) {
    verdict = 'fail';
    reasons.push(`${periodicOnly ? 'periodic-screenshot' : 'compositor'} gap ${maxGap} ms > ${limitMs} ms inside the reveal window`);
  }
  return {
    verdict,
    source,
    reasons,
    window: { start: window.start, end: window.end, ms: +(window.end - window.start).toFixed(1) },
    compositor: { frames: cast.length, medianMs: q(0.5), p95Ms: q(0.95), maxGapMs: maxGap, edgeGapsMs: edgeGaps.map((v) => +v.toFixed(1)), fps: cast.length > 1 ? +(((cast.length - 1) * 1000) / (cast[cast.length - 1] - cast[0])).toFixed(1) : null },
    mainThread: { distinctTimecodes: shown.length, maxGapMs: mainMax === null ? null : +mainMax.toFixed(1) },
    limitMs,
    // Wave 2 r3 (W7 judge): the gaps per ball phase, not only the window max.
    byPhase: cadencePerBallPhase(frames, { source }),
  };
}

/** Reduced motion (wave 2 r3, W7 judge): judged on periodic screenshots only, failing above this interval. */
export const RM_PERIODIC_GAP_LIMIT_MS = 150;

/**
 * The ceremony phase of a film frame (pure): `loading-after-presented`
 * (ball loading while the scene has presented — the warm-stall window),
 * `opening`, `releasing`; null for any other state. Frames carry
 * `ballPhase` / `scenePhase` (the film rows' phase stamps).
 */
export function ceremonyPhaseOf(frame) {
  if (!frame) return null;
  if (frame.ballPhase === 'opening' || frame.ballPhase === 'releasing') return frame.ballPhase;
  if (frame.ballPhase === 'loading' && frame.scenePhase === 'presented') return 'loading-after-presented';
  return null;
}

/**
 * Frame gaps per ceremony phase (pure). An interval is booked to the phase
 * of its EARLIER frame (the state the screen sat in while nothing new came).
 * `source` screencast = compositor stamps (tEpoch, on-change: a gap may be
 * idle); periodic = steady screenshots (t: a gap means no page frame).
 */
export function cadencePerBallPhase(frames, { source = 'screencast' } = {}) {
  const periodicOnly = source === 'periodic';
  const stampOf = (f) => (periodicOnly ? f.t : typeof f.tEpoch === 'number' ? f.tEpoch : f.t);
  const list = (Array.isArray(frames) ? frames : [])
    .filter((f) => (periodicOnly ? f.kind === 'periodic' : f.kind !== 'periodic') && typeof stampOf(f) === 'number')
    .sort((a, b) => stampOf(a) - stampOf(b));
  const out = {};
  for (const phase of ['loading-after-presented', 'opening', 'releasing']) out[phase] = [];
  for (let i = 1; i < list.length; i += 1) {
    const phase = ceremonyPhaseOf(list[i - 1]);
    if (phase) out[phase].push({ gap: stampOf(list[i]) - stampOf(list[i - 1]), at: stampOf(list[i - 1]) });
  }
  return Object.fromEntries(
    Object.entries(out).map(([phase, rows]) => {
      if (rows.length === 0) return [phase, { intervals: 0, medianMs: null, maxGapMs: null, maxGapAt: null }];
      const sorted = [...rows].sort((a, b) => a.gap - b.gap);
      const worst = sorted[sorted.length - 1];
      return [phase, { intervals: rows.length, medianMs: +sorted[Math.floor(sorted.length / 2)].gap.toFixed(1), maxGapMs: +worst.gap.toFixed(1), maxGapAt: +worst.at.toFixed(1) }];
    }),
  );
}

/** Properties a compositor can animate without main-thread work. */
export const COMPOSITOR_PROPERTIES = ['transform', 'opacity', 'translate', 'rotate', 'scale'];

/**
 * Wave 2 round 2 (W7 judge): script-created WAAPI animations the ceremony may
 * run, by `Animation.id`. `ball-life-bound` is BallLoader's deliberate
 * compositor-side life bound (an opacity fade created by element.animate, the
 * only guard that still fires while the main thread is stalled). It is
 * allowed only with that id AND compositor-only keyframes, and is reported
 * under `allowed` ("allowed: life bound"), never as a violation. An unnamed
 * Animation stays a violation.
 */
export const CEREMONY_SCRIPT_ANIMATION_ALLOWLIST = { 'ball-life-bound': 'allowed: life bound' };

/**
 * The ceremony animation audit: every animation the page ran inside the
 * ceremony scope (the ball loader, the route canvas wrapper, the handoff
 * chrome) must be CSS — a CSSAnimation, or a CSSTransition (declarative and
 * compositor-run on these properties; counted separately in `transitions`)
 * — whose keyframes touch only transform / opacity (and the individual
 * transform properties). A script Animation (element.animate), a clip-path /
 * filter / layout property, or an unreadable keyframe set fails. `rows` =
 * installCeremonyAnimationAudit dump rows { kind, name, scope, target,
 * properties[], pseudo }. Violations are named per row; no ceremony row at
 * all is `unmeasured`.
 */
export function ceremonyAnimationVerdict(rows) {
  if (!Array.isArray(rows)) return { verdict: 'unmeasured', reasons: ['ceremony animation audit not armed'] };
  const ceremony = rows.filter((r) => r && r.scope === 'ceremony');
  if (ceremony.length === 0) return { verdict: 'unmeasured', reasons: ['no animation seen in the ceremony scope'], rows: rows.length };
  const violations = [];
  const allowed = [];
  for (const r of ceremony) {
    const why = [];
    const allowNote = r.kind === 'Animation' ? CEREMONY_SCRIPT_ANIMATION_ALLOWLIST[r.name] : undefined;
    if (allowNote) {
      const allowProps = Array.isArray(r.properties) ? r.properties : [];
      if (allowProps.length > 0 && allowProps.every((p) => COMPOSITOR_PROPERTIES.includes(p))) {
        allowed.push({ name: r.name, target: r.target, kind: r.kind, properties: allowProps, note: allowNote });
        continue;
      }
    }
    // CSS transitions are declarative and compositor-run on these properties
    // (the reduced-motion crossfade and the NavBar fade are transitions by
    // design); a script-driven Animation (element.animate) is not CSS unless
    // its id is allowlisted above (and then only on compositor properties).
    if (r.kind !== 'CSSAnimation' && r.kind !== 'CSSTransition') {
      why.push(
        allowNote
          ? `${r.kind} id "${r.name}" is allowlisted only on ${COMPOSITOR_PROPERTIES.join(' / ')}`
          : `${r.kind} (script-driven, not a CSS animation / transition${r.name ? '' : '; a deliberate compositor-side bound needs an Animation.id on the allowlist'})`,
      );
    }
    const props = Array.isArray(r.properties) ? r.properties : [];
    const off = props.filter((p) => !COMPOSITOR_PROPERTIES.includes(p));
    if (off.length) why.push(`animates ${off.join(', ')} (not compositor-only)`);
    if (props.length === 0) why.push('no keyframe properties readable');
    if (why.length) violations.push({ name: r.name, target: r.target, pseudo: r.pseudo ?? null, kind: r.kind, properties: props, why });
  }
  return {
    verdict: violations.length ? 'fail' : 'pass',
    rule: `every ceremony animation is CSS (CSSAnimation or CSSTransition) on ${COMPOSITOR_PROPERTIES.join(' / ')} only; script animations allowed by id: ${Object.keys(CEREMONY_SCRIPT_ANIMATION_ALLOWLIST).join(', ')}`,
    allowed,
    transitions: ceremony.filter((r) => r.kind === 'CSSTransition').length,
    animations: ceremony.length,
    distinct: ceremony.map((r) => `${r.kind}:${r.name}@${r.target}${r.pseudo ? r.pseudo : ''}`),
    violations,
    otherScopeRows: rows.length - ceremony.length,
    reasons: violations.map((v) => `${v.name}@${v.target}: ${v.why.join('; ')}`),
  };
}

// ---------------------------------------------------------------------------
// In-page: ceremony animation audit (self-contained; addInitScript)
// ---------------------------------------------------------------------------

/**
 * Armed before navigation with --loader-trace / --loader-film. Once per
 * animation frame while the ceremony can be running (a ball phase of
 * loading / opening / releasing, `html[data-route-handoff]` without
 * `world-route-live`, or a `[data-revealing]` loader), plus 1.5 s past
 * world-route-live, it walks `document.getAnimations()` and records each
 * distinct animation once: its class (CSSAnimation / CSSTransition /
 * Animation), name (animationName / transitionProperty / id), the keyframe
 * properties it animates, the target (tag#id.class, trimmed), the
 * pseudo-element and the scope (ceremony = inside [data-ball-loader], the
 * [data-route-canvas] wrapper, or `body > nav`; else other).
 */
export function installCeremonyAnimationAudit(opts) {
  const host = window;
  if (host.__captureCeremonyAnimations) return;
  const tailMs = (opts && opts.tailMs) || 1500;
  const maxRows = (opts && opts.maxRows) || 200;
  const rows = [];
  const seen = new WeakSet();
  const seenKeys = new Set();
  let active = true;
  let liveAt = null;
  let frames = 0;
  const describe = (el) => {
    if (!el || el.nodeType !== 1) return 'unknown';
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const data = el.hasAttribute('data-ball-loader') ? '[data-ball-loader]' : el.hasAttribute('data-route-canvas') ? '[data-route-canvas]' : '';
    return `${el.tagName.toLowerCase()}${id}${cls}${data}`.slice(0, 120);
  };
  const scopeOf = (el) => {
    if (!el || el.nodeType !== 1 || !el.closest) return 'other';
    if (el.closest('[data-ball-loader]') || el.closest('[data-route-canvas]')) return 'ceremony';
    // The site NavBar that leaves with the page; the WorldNav HUD pill
    // (also a body-level nav) fading in after the handoff is not the ceremony.
    if (el.matches && el.matches('body > nav') && !el.classList.contains('world-nav-hud')) return 'ceremony';
    return 'other';
  };
  const ceremonyOn = () => {
    const html = document.documentElement;
    const ball = document.querySelector('[data-ball-loader]') || document.querySelector('[data-ball-phase]');
    const phase = ball ? ball.getAttribute('data-ball-phase') : null;
    if (phase === 'loading' || phase === 'opening' || phase === 'releasing') return true;
    if (ball && ball.hasAttribute('data-revealing')) return true;
    return html.hasAttribute('data-route-handoff') && !html.classList.contains('world-route-live');
  };
  const record = (animation) => {
    if (seen.has(animation)) return;
    seen.add(animation);
    const effect = animation.effect;
    const target = effect && effect.target ? effect.target : null;
    const kind = animation.constructor && animation.constructor.name ? animation.constructor.name : 'Animation';
    const name = animation.animationName || animation.transitionProperty || animation.id || '(anonymous)';
    let properties = [];
    try {
      const keyframes = effect && typeof effect.getKeyframes === 'function' ? effect.getKeyframes() : [];
      const skip = new Set(['offset', 'computedOffset', 'easing', 'composite']);
      const set = new Set();
      for (const f of keyframes) for (const key of Object.keys(f)) if (!skip.has(key)) set.add(key);
      properties = [...set];
      if (kind === 'CSSTransition' && properties.length === 0 && animation.transitionProperty) properties = [animation.transitionProperty];
    } catch {
      properties = [];
    }
    const pseudo = effect && effect.pseudoElement ? effect.pseudoElement : null;
    const key = `${kind}|${name}|${describe(target)}|${pseudo}|${properties.join(',')}`;
    if (seenKeys.has(key) || rows.length >= maxRows) return;
    seenKeys.add(key);
    rows.push({ kind, name, target: describe(target), pseudo, scope: scopeOf(target), properties, t: performance.now() });
  };
  const nativeRaf = host.requestAnimationFrame.bind(host);
  const tick = () => {
    if (!active) return;
    frames += 1;
    const live = document.documentElement.classList.contains('world-route-live');
    if (live && liveAt === null) liveAt = performance.now();
    if (ceremonyOn() || (liveAt !== null && performance.now() - liveAt <= tailMs)) {
      try {
        for (const animation of document.getAnimations()) record(animation);
      } catch {
        /* getAnimations unavailable — the dump says so via rows.length 0 */
      }
    }
    if (liveAt !== null && performance.now() - liveAt > tailMs && !ceremonyOn()) active = false;
    else nativeRaf(tick);
  };
  nativeRaf(tick);
  host.__captureCeremonyAnimations = {
    dump: () => ({ rows: rows.slice(), frames, liveAt, active }),
    stop: () => {
      active = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Runners (Playwright page)
// ---------------------------------------------------------------------------

/**
 * One read of everything the luma / contrast analysis needs, at the still's
 * pose: the station subjects' rects, figure rects and the sky-body disc
 * (the first material with a `uSunPos` uniform, via the debug-gated
 * `__routeWorldScene`, projected through `__routeWorldCamera`). The DOM
 * chrome comes from capture-evidence's readDomLayers (a ball loader counts
 * only by its painted children).
 */
export async function readLumaContext(page) {
  const read = await page.evaluate((faceMeshes) => {
    const call = (name, ...args) => {
      const fn = window[name];
      if (typeof fn !== 'function') return null;
      try {
        return fn(...args);
      } catch (err) {
        return { error: String((err && err.message) || err) };
      }
    };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const subjects = call('__routeWorldSubjects');
    const figures = call('__routeWorldFigures');
    const camera = call('__routeWorldCamera');
    let sunPos = null;
    let sunSource = null;
    const scene = call('__routeWorldScene');
    if (scene && typeof scene.traverse === 'function') {
      try {
        scene.traverse((object) => {
          if (sunPos) return;
          const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
          for (const m of materials) {
            const u = m && m.uniforms && m.uniforms.uSunPos && m.uniforms.uSunPos.value;
            if (u && typeof u.x === 'number') {
              sunPos = [u.x, u.y, u.z];
              sunSource = `${m.type}${m.name ? `:${m.name}` : ''} on ${object.name || object.type}`;
              return;
            }
          }
        });
      } catch {
        sunPos = null;
      }
    }
    // LOOK r5 (LOOK r4: the ledger:teams rect is bounds-derived and covers
    // the scene-lit stone plinth): the textured face meshes' own projected
    // rects, through the R3F root's live camera. CSS px like the subjects.
    const faceRects = {};
    if (scene && typeof scene.getObjectByName === 'function') {
      let state = null;
      const rootOf = (o) => (o && o.__r3f && o.__r3f.root && typeof o.__r3f.root.getState === 'function' ? o.__r3f.root.getState() : null);
      state = rootOf(scene);
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
      for (const [id, meshName] of Object.entries(faceMeshes)) {
        try {
          const mesh = scene.getObjectByName(meshName);
          if (!mesh || !mesh.geometry) {
            faceRects[id] = { reason: `mesh ${meshName} not in the scene` };
            continue;
          }
          if (!cam || !canvas) {
            faceRects[id] = { reason: 'no R3F camera / canvas' };
            continue;
          }
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox;
          const cr = canvas.getBoundingClientRect();
          const mw = mesh.matrixWorld.elements;
          const view = cam.matrixWorldInverse.elements;
          const proj = cam.projectionMatrix.elements;
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
          let behind = false;
          for (const x of [bb.min.x, bb.max.x]) {
            for (const y of [bb.min.y, bb.max.y]) {
              for (const z of [bb.min.z, bb.max.z]) {
                const c = mul(proj, mul(view, mul(mw, [x, y, z, 1])));
                if (!(c[3] > 1e-6)) behind = true;
                const sx = cr.left + ((c[0] / c[3] + 1) / 2) * cr.width;
                const sy = cr.top + ((1 - c[1] / c[3]) / 2) * cr.height;
                x0 = Math.min(x0, sx);
                y0 = Math.min(y0, sy);
                x1 = Math.max(x1, sx);
                y1 = Math.max(y1, sy);
              }
            }
          }
          if (behind) {
            faceRects[id] = { reason: 'face corner behind the camera' };
            continue;
          }
          const full = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
          const cx0 = Math.max(cr.left, x0);
          const cy0 = Math.max(cr.top, y0);
          const w = Math.max(0, Math.min(cr.left + cr.width, x1) - cx0);
          const h = Math.max(0, Math.min(cr.top + cr.height, y1) - cy0);
          faceRects[id] = { x: cx0, y: cy0, w, h, onScreenFraction: full > 0 ? +((w * h) / full).toFixed(3) : 0 };
        } catch (err) {
          faceRects[id] = { reason: String((err && err.message) || err) };
        }
      }
    }
    return {
      viewport,
      faceRects,
      subjects: subjects && !subjects.error ? subjects : null,
      figureRows:
        figures && Array.isArray(figures.rows)
          ? figures.rows.filter((row) => row && row.rect && row.visible !== false).map((row) => ({ id: row.id, ...row.rect }))
          : [],
      camera: camera && !camera.error ? { camPos: camera.camPos ?? null, yaw: camera.yaw ?? null, pitch: camera.pitch ?? null, fov: camera.fov ?? null } : null,
      sunPos,
      sunSource,
    };
  }, TEXTURED_FACE_MESHES);
  return { ...read, subjects: read.subjects ? refineFaceRows(read.subjects, read.faceRects) : null };
}

/**
 * The docked panel read: the open `.world-focus-panel[open]` (else an open
 * dialog), its box, the viewport, its computed font-size and the smallest
 * computed font-size over every rendered, visible text node inside it, plus
 * how many of those sit in the panel BODY (outside its title bar: the
 * `.world-focus-panel-head`, else the dialog's first element child).
 * "Visible" also honours `checkVisibility()` where the engine has it, so text
 * under a `content-visibility: hidden` ancestor is not counted.
 */
export async function readDockedPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.world-focus-panel[open]') || document.querySelector('dialog[open]');
    if (!panel) return { present: false };
    const r = panel.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { present: false, reason: 'zero-size panel' };
    const head = panel.querySelector('.world-focus-panel-head') || panel.firstElementChild;
    const size = (el) => Number.parseFloat(getComputedStyle(el).fontSize);
    let min = null;
    let sample = null;
    let textNodes = 0;
    let bodyTextNodes = 0;
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || '').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      // Screen-reader-only text (clipped to 1 px) is not rendered text.
      if (style.position === 'absolute' && (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)')) continue;
      textNodes += 1;
      if (!head || !head.contains(el)) bodyTextNodes += 1;
      const px = size(el);
      if (min === null || px < min) {
        min = px;
        sample = text.slice(0, 60);
      }
    }
    return {
      present: true,
      selector: panel.matches('.world-focus-panel[open]') ? '.world-focus-panel[open]' : 'dialog[open]',
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      fontSizePx: size(panel),
      minTextFontPx: min,
      minTextSample: sample,
      textNodes,
      bodyTextNodes,
    };
  });
}

/** Read the pass-through bridges (raw values, JSON-cloned; never judged). */
export async function readPassThroughBridges(page, names = PASS_THROUGH_BRIDGES) {
  const reads = await page.evaluate((list) => {
    const out = {};
    for (const name of list) {
      const fn = window[name];
      if (typeof fn !== 'function') {
        out[name] = { present: false };
        continue;
      }
      try {
        out[name] = { present: true, value: JSON.parse(JSON.stringify(fn() ?? null)) };
      } catch (err) {
        out[name] = { present: true, error: String((err && err.message) || err) };
      }
    }
    return out;
  }, names);
  const out = {};
  for (const name of names) out[name.replace(/^__routeWorld/, '').replace(/^./, (c) => c.toLowerCase())] = passThroughRecord(name, reads[name]);
  return out;
}

/**
 * --audit on: `frames` whole-frame draw-call reads at the landed pose. Each
 * read kicks a frame (invalidate — a parked canvas runs on demand), waits
 * for its rAF, then reads `__routeWorldAudit().totalCalls` in the task after
 * that frame (the TelemetrySampler zeroes the counters at the START of each
 * R3F frame, so after the frame they hold the whole frame: shadow, scene and
 * post passes). Programs and autoReset come from `__routeWorldGlDebug()`.
 */
export async function readDrawAudit(page, { frames = 5 } = {}) {
  const read = await page.evaluate(async (n) => {
    const audit = window.__routeWorldAudit;
    if (typeof audit !== 'function') return { ok: false, reason: 'window.__routeWorldAudit absent (debug off)' };
    const canvas = document.querySelector('[data-route-canvas] canvas') || document.querySelector('canvas');
    const r3f = canvas && canvas.__r3f;
    const reads = [];
    let last = null;
    for (let i = 0; i < n; i += 1) {
      if (r3f && typeof r3f.invalidate === 'function') r3f.invalidate();
      await new Promise((resolveFrame) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          setTimeout(resolveFrame, 0);
        };
        requestAnimationFrame(finish);
        setTimeout(finish, 100);
      });
      try {
        last = audit();
        reads.push({ calls: last.totalCalls, triangles: last.totalTriangles });
      } catch (err) {
        reads.push({ error: String((err && err.message) || err) });
      }
    }
    let gl = null;
    try {
      gl = typeof window.__routeWorldGlDebug === 'function' ? window.__routeWorldGlDebug() : null;
    } catch {
      gl = null;
    }
    return {
      ok: true,
      reads,
      programs: gl && typeof gl.programs === 'number' ? gl.programs : null,
      autoReset: gl && typeof gl.autoReset === 'boolean' ? gl.autoReset : null,
      scene: last
        ? {
            auditVersion: last.auditVersion,
            meshes: last.meshes,
            instanced: last.instanced,
            points: last.points,
            lines: last.lines,
            casters: last.casters,
            skinned: last.skinned,
            materials: last.materials,
            staticBatches: last.staticBatches,
            families: Array.isArray(last.families) ? last.families.slice(0, 12).map((f) => ({ family: f.family, meshes: f.meshes, triangles: f.triangles, instancedMeshes: f.instancedMeshes })) : null,
          }
        : null,
    };
  }, frames);
  if (!read.ok) return { verdict: 'unmeasured', reason: read.reason };
  return { ...drawAuditSummary(read.reads, { programs: read.programs, autoReset: read.autoReset }), reads: read.reads, scene: read.scene, source: 'renderer.info.render (TelemetrySampler autoReset off: the whole frame incl. shadow + post passes)' };
}

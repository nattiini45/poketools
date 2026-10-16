#!/usr/bin/env node
/**
 * Mechanized content-legibility check (C-105 r1, bar criterion 3) — the
 * crop-readable verification step for the capture discipline. Future rounds
 * run it against their stills; a check that cannot fail is worthless, so the
 * thresholds are calibrated to FAIL on pre-adoption stills (the sakura
 * r2-era mush band is the known-bad input) and PASS on floored ones.
 *
 * For each named crop region of a capture PNG (the board face as framed at
 * that station pose) the check measures THE ARTIFACT, never a copy:
 *
 *   1. text-line band height — horizontal ink projection; every detected
 *      band's vertical extent must be >= READABLE_LINE_PX device px
 *      (imported from the engine's pure legibility.ts — the same threshold
 *      the C-100 font floors back-solve from; never re-derived here);
 *   2. line count — at least `minLines` text bands detected (catches rows
 *      collapsing into mush, where bands merge or vanish);
 *   3. contrast — per band, the 90th-vs-10th percentile luminance spread
 *      must clear MIN_CONTRAST (catches low-alpha washes like the 0.55-alpha
 *      mush band C-097 fixed).
 *
 * sharp `raw()` on these PNGs returns RGBA — the pixel stride is
 * `info.channels` ([C-093 r4] stride law). Exit 0 = every region legible;
 * exit 1 = any region failed (printed with its numbers).
 *
 * NODE REQUIREMENT: this script runtime-`import()`s the engine's
 * `src/lib/route-world/legibility.ts` directly, which needs Node's native
 * TypeScript type stripping — Node >= 23.6 (or the >= 22.18 LTS backport)
 * unflagged, Node 22.6-22.17 with `--experimental-strip-types`; older Nodes
 * die with ERR_UNKNOWN_FILE_EXTENSION. `ci.yml` pins `node-version: 22`
 * (resolves to the latest 22.x, so >= 22.18 in practice) and no workflow
 * invokes this script — it is a LOCAL gauntlet tool; do not assume it in CI.
 * The imported module must stay erasable-syntax-only (no enums/namespaces),
 * which legibility.ts is (types + pure functions).
 *
 * Usage:
 *   node scripts/legibility-check.mjs --tag <pre|post tag> \
 *        [--regions <names>] [--out <summary.json>] [--evidence <dir>]
 * Region names resolve to gauntlet/evidence/<tag>-<station>-<viewport>.png
 * via the built-in region table (world/station/viewport -> crop + minLines).
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

// The engine's pure floors module — CONSUMED, never re-derived (native TS
// type stripping; see the NODE REQUIREMENT note in the header).
const { READABLE_LINE_PX } = await import(
  new URL('../src/lib/route-world/legibility.ts', import.meta.url)
);

/** Minimum 90th-vs-10th percentile luminance spread inside a text band. */
const MIN_CONTRAST = 45;
/** Luma delta over the field median for a pixel to count as ink — 55 keeps
 * anti-aliased glyph fringes out at the landed-390 scale (calibrated on the
 * r1 stills: 40 merges lines into blobs, 55 splits them at the gaps). */
const INK_LUMA_DELTA = 55;
/** Silent gap (px) that separates two text bands. */
const BAND_GAP = 2;

/**
 * Region table: world/station/viewport -> crop rect [x, y, w, h] in device px
 * (the board face interior as framed at that station pose, eye-verified on
 * the r1 pre-adoption stills), the minimum text lines that crop must carry,
 * and the ink-px-per-row floor (12 at 1440 — scene occluders like the
 * flagship's mooring masts add ~8 ink px to every row and must not band; 3
 * at 390 where lines are narrow). Rects hold across pre/post: the rig is
 * identical except the board textures.
 */
const REGIONS = JSON.parse(process.env.LEGIBILITY_REGIONS ?? 'null') ?? {
  'sakura-pulse-1440': { crop: [460, 295, 560, 305], minLines: 4, minRowInk: 12 },
  // C-102 r1 calibration folded (c102r1-legibility-sakura.json): the
  // AgX-graded 390 board measures contrast 20 at the landed pose, so the
  // region gate is the measured c18 (delta 55 / minRowInk 3 unchanged).
  'sakura-pulse-390': { crop: [140, 340, 210, 130], minLines: 3, minRowInk: 3, contrast: 18 },
  // C-106 r1 re-derivation ([C-102 r2] re-derive law): the r1-era crop
  // [36,345,130,140] predates the schedule rework — the cloths' text moved
  // UP, leaving the old rect on blank cloth + hem (deterministic lines=1
  // FAIL across two fresh loads). Delta 30 detects the AgX-washed 390 ink
  // (delta 55 sees nothing).
  // C-106 r1 REPAIR ([C-102 r3] load-variance method): the r1 fold
  // [64,304,92,54] c43 was LOAD-VARIANT — its upper text row (320-322) sits
  // beside per-load cloth-sway ink (rows 325-332) that merges into it on
  // sway loads (merged contrast 31 < 43 -> filtered), so lines flipped 1↔2
  // across healthy loads (the gate's own fresh load failed 1/2). Re-derived
  // on 6 loads — 3 pre-existing + 3 fresh (_ccC106r1rep-rect-rederive.log):
  // the rect now spans the TWO bands that are pixel-identical on all 6
  // loads — the washed small-text row 310-313 (h4, contrast 39-40) and the
  // text row 340-342 (h3, contrast 45-46) — and the gate is the measured
  // 6-load minimum 39 − 2 = 37 (the fold's measured-minus-2 law, no longer
  // zero-margin). The fragile mid row rides along ADDITIVELY: a 3rd band
  // when clean (contrast 47-48), contrast-filtered when sway-merged (31) —
  // so lines land 2-3 on every load, never below the two anchors.
  'sakura-schedule-390': { crop: [64, 308, 92, 40], minLines: 2, minRowInk: 3, delta: 30, contrast: 37 },
  // C-106 r3: the torii gakuzuka plaque face at the rules-1440 seat — the
  // plaque the r2 chief found title-only. The C-106 r3 fix grew the tablet
  // (1.9x1.95 -> 2.6x2.95 m, canvas 1193x1355, floor still 117) and added the
  // compact rules ledger, so the face now carries EIGHT floored lines (title
  // 2 + ruleset 2 + ledger 4; the separator bar rides ADDITIVELY — h1, height-
  // filtered). Rect = scan-derived face interior (paper bbox x[637,803]
  // y[409,595] on the dark frame, border excluded per the [C-104 r2]
  // decorative-rules law; _ccC106r3-raw-derive-rects.log). Gates folded on
  // THREE loads (probe light + matrix light + matrix dark,
  // _cC106r3-calibrate.mjs in the same log): qualifying lines 8/8/8 (h9-12),
  // min contrast 84/84/66 -> gate 64 = measured minus 2 (the [C-106 r1rep]
  // fold law).
  'sakura-rules-1440': { crop: [641, 413, 158, 179], minLines: 8, minRowInk: 3, contrast: 64 },
  // C-103 r1-calibrated rects folded (r3-return / _ccC103r1-raw-legibility.log):
  // the interior rows blocks re-derived in that round replace the C-105-era
  // full-face crops (the original pulse-1440 region passed at exactly 8/8 —
  // zero margin). Both folded rects were validated against load variance:
  // same-tree re-capture diffs sit at the measured <=0.3% changed-px bound
  // (0.2846% on the pulse-1440 rect, 0 false-fails; _ccC103r3-raw-region-diff
  // logs), so the crops sit on stable interior text, not load-noise edges.
  'mountain-pulse-1440': { crop: [450, 385, 540, 210], minLines: 4, minRowInk: 12 },
  'mountain-pulse-390': { crop: [85, 360, 230, 115], minLines: 3, minRowInk: 3 },
  'mountain-schedule-390': { crop: [234, 262, 80, 185], minLines: 2, minRowInk: 2, delta: 50, contrast: 40 },
  // C-104 r3 fold: the self-lit day-board lever (pure #000000 glass + dead
  // specular) fixed the flagship's contrast mechanism, so the C-102-era
  // lowered gates (contrast 20 / 35) are OBSOLETE — replaced by the
  // standard-45 PASS numbers and the REGIONS_JSON crops of record
  // (_ccC104r3-raw-legibility.log line 12; 6/6 PASS deterministic there).
  'clouds-pulse-1440': { crop: [430, 310, 580, 190], minLines: 4, minRowInk: 8, delta: 45, contrast: 45 },
  'clouds-pulse-390': { crop: [65, 320, 260, 140], minLines: 1, minRowInk: 2, delta: 50, contrast: 45 },
  'clouds-roster-1440': { crop: [320, 175, 790, 275], minLines: 4, minRowInk: 12, contrast: 45 },
  'clouds-teams-1440': { crop: [140, 350, 1170, 145], minLines: 1, minRowInk: 12, contrast: 45 },
  'clouds-rules-1440': { crop: [540, 458, 335, 62], minLines: 2, minRowInk: 12, contrast: 45 },
  // C-106 r1 variance fold: the rect tightens to the fixtures rows band
  // ABOVE the footer/ticker — the r3 crop's bottom third carries live
  // per-load content (LED countdown + particle drift: same-tree pair diffs
  // 0.00-0.11% in the kept rows vs 4-8% below), the exact false-fail class
  // the <=0.3% load-variance gate exists for. Measured deterministic 5
  // lines / 54 contrast across three loads (_ccC106r1-raw-rect-variance.log).
  'clouds-schedule-390': { crop: [65, 320, 255, 75], minLines: 3, minRowInk: 2 },
  // C-108 r1 plaza extension (the pulse-only 2/2 gap the C-106 panel verified):
  // rules/teams/schedule folded, multi-load calibrated on THREE fresh loads of
  // the post-rework tree (_ccC108r1-raw-calibration.log: line counts stable
  // [4,4,4]/[1,1,1]/[8,8,8]/[3,3,3]; gates = weakest anchor band's multi-load
  // minimum contrast − 2). Anchor rows here are NOT pixel-identical across
  // loads (0.6–7% anchor-row diff: open-air station — dust motes at the
  // rules/schedule densities and a board-pocket walker can cross a rect) —
  // the r1rep pixel-identity clause is unachievable in the open plaza, so
  // stability is carried by the stable line counts + tops across loads and
  // the min−2 contrast gates; deviation disclosed here per the r1rep law.
  // rules: the new self-lit passage board's four interior rule rows (the
  // brass frame border excluded from the rect — the [C-104 r2] decorative-
  // rules law); passes the STANDARD 45 in both modes with margin (light 100,
  // dark 135 on the zoom pair), so no lowered gate ships.
  'plaza-rules-1440': { crop: [532, 424, 332, 120], minLines: 4, minRowInk: 12, contrast: 98 },
  'plaza-rules-390': { crop: [115, 404, 165, 50], minLines: 4, minRowInk: 3, contrast: 65 },
  // teams: the front-rank plinth plate text block. The plates are C-105
  // tiny faces (a 0.74 m plate at the teams pose floors below
  // READABLE_LINE_PX per-row), so the block measures as ONE band:
  // minLines 1 with the block's own calibrated contrast. The single band
  // still clears the default height gates (44 ink rows at 1440; the 390
  // height floor is 0 by the standard rule).
  'plaza-teams-1440': { crop: [698, 622, 88, 44], minLines: 1, minRowInk: 4, contrast: 131 },
  'plaza-teams-390': { crop: [190, 462, 46, 16], minLines: 1, minRowInk: 3, contrast: 111 },
  // schedule: the Spielplan board's interior rows block — the live
  // "NÄCHSTER ANPFIFF" ticker row is EXCLUDED from the rect (the [C-106 r1]
  // live-content law; the clouds-table entry is the precedent).
  'plaza-schedule-1440': { crop: [380, 395, 570, 215], minLines: 6, minRowInk: 12, contrast: 73 },
  // schedule-390 is the one load-fragile entry: the third row band rides
  // ADDITIVELY ([C-106 r1rep]) — 3 bands when clean, 2 on sway/AA-merge
  // loads (observed 3,2,3,3 across four loads) — so minLines anchors at the
  // multi-load minimum 2 and the contrast gate at the weakest band's
  // measured minimum − 2; the row-ink floor 10 sits between the 8
  // (everything merges) and 6-class floors that collapse the bands.
  'plaza-schedule-390': { crop: [117, 418, 150, 80], minLines: 2, minRowInk: 10, contrast: 125 },
  'plaza-pulse-1440': { crop: [400, 250, 460, 400], minLines: 3, minRowInk: 12 },
  'plaza-pulse-390': { crop: [105, 340, 200, 165], minLines: 2, minRowInk: 3 },
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function lumaAt(data, stride, i) {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** Measure one crop: text bands, their heights, and their contrast spreads. */
function measureRegion(data, info, [cx, cy, cw, ch], minRowInk, inkDelta, contrastGate) {
  const { width, channels } = info;
  const rowInk = [];
  const rowLuma = [];
  for (let y = cy; y < cy + ch; y += 1) {
    let inkCount = 0;
    const lumas = [];
    for (let x = cx; x < cx + cw; x += 1) {
      const luma = lumaAt(data, channels, (y * width + x) * channels);
      lumas.push(luma);
    }
    const sorted = [...lumas].sort((a, b) => a - b);
    const field = percentile(sorted, 50);
    for (const luma of lumas) {
      if (Math.abs(luma - field) > inkDelta) inkCount += 1;
    }
    rowInk.push(inkCount);
    rowLuma.push(lumas);
  }

  // Band detection: consecutive rows carrying enough ink px, split on gaps.
  const bands = [];
  let start = -1;
  let gap = 0;
  for (let r = 0; r < rowInk.length; r += 1) {
    if (rowInk[r] >= minRowInk) {
      if (start === -1) start = r;
      gap = 0;
    } else if (start !== -1) {
      gap += 1;
      if (gap > BAND_GAP) {
        bands.push([start, r - gap]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start !== -1) bands.push([start, rowInk.length - 1 - gap]);

  const results = bands
    .map(([a, b]) => {
      // Height counts INK ROWS only (internal AA gaps excluded) — the honest
      // glyph-height measure; a merged block of spaced lines cannot pass by
      // aggregation.
      let inkRows = 0;
      const lumas = [];
      for (let r = a; r <= b; r += 1) {
        if (rowInk[r] >= minRowInk) inkRows += 1;
        for (const luma of rowLuma[r]) lumas.push(luma);
      }
      const sorted = [...lumas].sort((p, q) => p - q);
      const spread = percentile(sorted, 90) - percentile(sorted, 10);
      return { top: a, height: inkRows, contrast: Math.round(spread) };
    })
    .filter((band) => band.contrast >= contrastGate && band.height >= 3);

  return results;
}

const evidenceDir = resolve(arg('evidence', 'gauntlet/evidence'));
const tag = arg('tag');
if (!tag) {
  console.error('legibility-check: --tag <pre|post tag> is required');
  process.exit(2);
}
const only = arg('regions', null);
const names = Object.keys(REGIONS).filter((n) => !only || n.includes(only));

const report = [];
let failed = 0;
for (const name of names) {
  const png = resolve(evidenceDir, `${tag}-${name}.png`);
  const region = REGIONS[name];
  let entry;
  try {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) {
      throw new Error(`expected RGBA (4 channels), got ${info.channels}`);
    }
    const bands = measureRegion(data, info, region.crop, region.minRowInk ?? 3, region.delta ?? INK_LUMA_DELTA, region.contrast ?? MIN_CONTRAST);
    const minH = bands.length ? Math.min(...bands.map((b) => b.height)) : 0;
    const minC = bands.length ? Math.min(...bands.map((b) => b.contrast)) : 0;
    // Band-height gate: 1440 regions (text big enough to measure a stable
    // ink-row core) gate at READABLE_LINE_PX; landed-390 regions print the
    // value informationally (an 8 px em measures 3-6 strong-ink rows at that
    // scale — the size criterion there is enforced BY CONSTRUCTION by the
    // shared paint path's station font clamp, which this script imports).
    const bandGate = region.minBand ?? (name.endsWith('1440') ? READABLE_LINE_PX : 0);
    const contrastGate = region.contrast ?? MIN_CONTRAST;
    const checks = {
      lines: { value: bands.length, min: region.minLines, pass: bands.length >= region.minLines },
      minBandPx: { value: minH, min: bandGate, pass: minH >= bandGate },
      minContrast: { value: minC, min: contrastGate, pass: minC >= contrastGate },
    };
    const pass = checks.lines.pass && checks.minBandPx.pass && checks.minContrast.pass;
    if (!pass) failed += 1;
    entry = { region: name, png, crop: region.crop, pass, checks, bands: bands.slice(0, 24) };
  } catch (err) {
    failed += 1;
    entry = { region: name, png, pass: false, error: String(err && err.message ? err.message : err) };
  }
  report.push(entry);
  const line = entry.error
    ? `legibility-check: ${name} ERROR ${entry.error}`
    : `legibility-check: ${name} ${entry.pass ? 'PASS' : 'FAIL'} lines=${entry.checks.lines.value}/${entry.checks.lines.min} minBandPx=${entry.checks.minBandPx.value}/${entry.checks.minBandPx.min} minContrast=${entry.checks.minContrast.value}/${entry.checks.minContrast.min}`;
  console.log(line);
}

const out = arg('out', null);
if (out) {
  await writeFile(resolve(out), `${JSON.stringify({ tag, READABLE_LINE_PX, MIN_CONTRAST, report }, null, 2)}\n`);
  console.log(`legibility-check: summary -> ${resolve(out)}`);
}
console.log(`legibility-check: ${report.length - failed}/${report.length} regions legible (threshold ${READABLE_LINE_PX}px = legibility.ts READABLE_LINE_PX)`);
process.exit(failed > 0 ? 1 : 0);

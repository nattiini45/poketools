/**
 * The Roll-Call Ledger's painted face (fidelity wave 2, seat 2G; D16).
 *
 * One canvas for the whole rail — every trainer's column in standings order,
 * each centred under its own statue on screen (`LedgerLayout.columns`,
 * teams-formation.ts). A column carries, top to bottom:
 *  - a gym-band chip holding a chevron (pointing up to the statue) and the
 *    standings rank;
 *  - the trainer's name (≈ 2× the old plinth plate's on-screen size; never
 *    below the 14 px-cap floor at 1440: shrink → condense → only then the
 *    suffix-keeping ellipsis — the board-text fit order);
 *  - "Species · height" from the manifest (German decimal comma on the plaza);
 *    a colossal ace on the back line carries a "hinten" / "set back" tag
 *    beside its chip, so its depth reads as deliberate (wave-2 r3).
 *
 * Wave-2 r3 (TEAMS judge): the columns no longer paint at the layout's
 * equal-rhythm widths. Each line is re-tiled by INK (`planLedgerCells`): one
 * shared name size for every column — the largest that lets every column's
 * name AND full species · height line fit (a sum-constrained fit) — widths
 * proportional to the ink each column needs, boundaries kept so each chip
 * still sits on its own ace. No column silently drops its height or paints
 * its name smaller than its neighbours while the rail has room. A one-line
 * rail too narrow for "species · height" at the floor goes to SPLIT mode:
 * the height rides beside the rank chip (`chipTagText`) and the species line
 * keeps the species alone.
 * The left end cap carries the kicker ("TRAINER" / "TRAINERS"), the right
 * one the rank span ("PLATZ 1–8" / "RANKS 1–8").
 *
 * Roll-call light (`ColumnLight`): `rest` is the full-contrast face; `called`
 * lifts the column's ground a little and draws its band rule; `calling`
 * lifts it further and rings the chip. Every state keeps ink ≥ 4.5:1 on its
 * ground (the style's colours are pinned by the unit test).
 *
 * Pure paint over a 2D context (a real canvas in the scene, a recording fake
 * in the tests) — no three.js, no React.
 */

import { INTL_TAG } from '@/i18n/config';
import { MIN_CONDENSE, autoFit, fitLinesCondensed, type AutoFit, type PaintLocale, type TextMeasurer } from '@/lib/route-world/board-text';
import { paintCaps, paintT } from '@/lib/route-world/paint-copy';
import type { LedgerLayout } from '@/lib/route-world/teams-formation';
import { LEDGER_CHIP_FONT, LEDGER_LINE, ledgerChipFontM, ledgerFontFloorM } from '@/lib/route-world/teams-formation';
import type { ColumnLight } from '@/lib/route-world/roll-call';

/** One trainer's column copy (standings order; `id` matches the layout column). */
export interface LedgerColumnCopy {
  id: string;
  rank: number;
  name: string;
  /** Ace species as the data names it; null when the trainer has no tracked ace. */
  species: string | null;
  /** Real stature from the manifest; null when the species has no model. */
  heightM: number | null;
  /** Gym-band colour (any CSS colour) and the ink that reads on it. */
  band: string;
  bandInk: string;
  /** A colossal ace standing on the back line (teams-formation `colossal`): its line says so. */
  setBack?: boolean;
}

/** A world's ledger palette (hex, so the contrast law can check it). */
export interface LedgerStyle {
  ground: string;
  /** The ground a `called` / `calling` column lifts to. */
  groundCalled: string;
  groundCalling: string;
  ink: string;
  subInk: string;
  kickerInk: string;
  rule: string;
  frame: string;
}

export const LEDGER_FONT = "system-ui, 'Segoe UI', sans-serif";

/** The set-back marker a colossal ace's line carries (`paint.ledger.setBack`, the viewer's locale). */
export function setBackWord(locale: PaintLocale): string {
  return paintT(locale)('ledger.setBack');
}

/**
 * "Species · height" in the world's locale; an unknown ace reads "—". A
 * colossal ace on the back line adds " · hinten" / " · set back".
 */
export function speciesLine(species: string | null, heightM: number | null, locale: PaintLocale, setBack = false): string {
  if (!species) return '—';
  const height = heightText(heightM, locale);
  if (height === null) return species;
  const line = `${species} · ${height}`;
  return setBack ? `${line} · ${setBackWord(locale)}` : line;
}

const HEIGHT_FORMATS = new Map<PaintLocale, Intl.NumberFormat>();

/** One decimal, the locale's own decimal sign (`1,8` / `1.8`), no grouping. */
function heightFormat(locale: PaintLocale): Intl.NumberFormat {
  let format = HEIGHT_FORMATS.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAG[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
    HEIGHT_FORMATS.set(locale, format);
  }
  return format;
}

/** "1,8 m" / "1.8 m" in the viewer's locale; null for an unknown stature. */
export function heightText(heightM: number | null, locale: PaintLocale): string | null {
  if (heightM === null || !Number.isFinite(heightM)) return null;
  return paintT(locale)('ledger.height', { height: heightFormat(locale).format(heightM) });
}

/**
 * The species line's fit order (wave-2 r2, TEAMS judge: a narrow column
 * painted "Ivysaur · 1…." — a clipped number reads as a wrong one): the full
 * "Species · height", then the species alone (the height stays in the
 * `?team=` panel). The painter takes the first that fits whole at the floor;
 * only the species alone may ever take the suffix-keeping ellipsis.
 */
export function speciesLineVariants(
  species: string | null,
  heightM: number | null,
  locale: PaintLocale,
  setBack = false,
): string[] {
  const out = [speciesLine(species, heightM, locale, setBack), speciesLine(species, heightM, locale), species ?? '—'];
  return out.filter((line, i) => out.indexOf(line) === i);
}

export function ledgerKicker(locale: PaintLocale): string {
  return paintCaps(locale, 'ledger.kicker');
}

export function ledgerRankSpan(n: number, locale: PaintLocale): string {
  return paintCaps(locale, 'ledger.rankSpan', { n: String(n) });
}

/** The fitted text of one column, for the guards and the evidence readout. */
export interface LedgerColumnFit {
  id: string;
  name: AutoFit;
  /** 1, or 2 when a long two-word name wrapped at the floor. */
  nameLines: number;
  sub: AutoFit;
  /** The name painted whole (no ellipsis). */
  nameComplete: boolean;
  /** The species line painted in full (species · height). */
  subComplete: boolean;
  /** The colossal ace's "hinten" / "set back" tag was painted beside the chip. */
  setBackTag: boolean;
  /** The text painted beside the chip (the set-back word, or the height in split mode), or null. */
  chipTag: string | null;
  /** The rail painted in split mode (the height beside the chip, the species line species-only). */
  split: boolean;
  /**
   * The painted cell (m along the face's right axis from the face centre).
   * The ink re-tiling moves the column boundaries off the layout's cells, so
   * the rail's click / hover mapping reads these.
   */
  cell: { line: 0 | 1; left: number; right: number };
}

/** What `paintLedger` needs from a context: text measurement plus the paint calls it makes. */
export type LedgerContext = TextMeasurer &
  Pick<
    CanvasRenderingContext2D,
    | 'fillRect'
    | 'strokeRect'
    | 'fillText'
    | 'beginPath'
    | 'moveTo'
    | 'lineTo'
    | 'closePath'
    | 'fill'
    | 'stroke'
    | 'save'
    | 'restore'
    | 'translate'
    | 'rotate'
    | 'scale'
    | 'arc'
  > & {
    font: string;
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    globalAlpha: number;
  };

function roundRect(ctx: LedgerContext, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

/** Paint a fitted line centred on `cx` (autoFit is left-anchored; centre it by its painted width). */
function paintCentred(ctx: LedgerContext, fit: AutoFit, weight: number, cx: number, y: number): void {
  ctx.font = `${weight} ${fit.px}px ${LEDGER_FONT}`;
  const w = ctx.measureText(fit.text).width * fit.squeeze;
  ctx.save();
  ctx.translate(cx - w / 2, y);
  if (fit.squeeze !== 1) ctx.scale(fit.squeeze, 1);
  ctx.fillText(fit.text, 0, 0);
  ctx.restore();
}

/** One column's painted cell and the shared type metrics (canvas px). */
export interface LedgerCellPlan {
  id: string;
  line: 0 | 1;
  /** Cell edges (canvas px; the face's left edge is 0). */
  x0: number;
  x1: number;
  /** The shared name / species sizes and horizontal condense (one of each across the whole rail). */
  namePx: number;
  subPx: number;
  condense: number;
  /** Whether the set-back tags fit (a tag gives way before any height does). */
  marker: boolean;
  /** Split mode: the height rides beside the chip, the species line keeps the species. */
  split: boolean;
}

/** One rung of the shared type ladder (`planLedgerCells`). */
export interface LedgerRung {
  px: number;
  condense: number;
  /** The set-back tags are painted. */
  marker: boolean;
  /** The height moves up beside the chip (the species line keeps the species). */
  split: boolean;
}

/**
 * The text a column paints beside its rank chip at a rung: the height in
 * split mode (a known stature only), else the set-back word for a colossal
 * ace while the tags fit, else nothing.
 */
export function chipTagText(
  c: Pick<LedgerColumnCopy, 'species' | 'heightM' | 'setBack'>,
  rung: Pick<LedgerRung, 'marker' | 'split'>,
  locale: PaintLocale,
): string | null {
  if (rung.split && c.species) {
    const height = heightText(c.heightM, locale);
    if (height !== null) return height;
  }
  if (rung.marker && c.setBack === true) return setBackWord(locale);
  return null;
}

/** Gap (canvas px) between the rank chip and the set-back tag beside it. */
const LEDGER_TAG_GAP = 8;

/** The rank chip's width (canvas px) at `chipFont`: chevron + rank + its padding. */
function ledgerChipWidth(ctx: LedgerContext, chipFont: number, rank: number): number {
  ctx.font = `800 ${chipFont}px ${LEDGER_FONT}`;
  return ctx.measureText(String(rank)).width + chipFont * 0.62 + chipFont * 1.2;
}

/** Inner padding (canvas px) of a column `colW` wide — the painter's text inset. */
function columnPad(colW: number): number {
  return Math.max(4, colW * 0.05);
}

/** Width (canvas px) a column needs so `ink` px of text fits inside `columnPad`. */
function widthFor(ink: number): number {
  return Math.max(ink / 0.9, ink + 8) + 1;
}

/**
 * The ink re-tiling (wave-2 r3). Per line, keeping the line's outer edges
 * (the 1440 fit already placed them inside [24, 1416]):
 *  1. the first rung of ONE shared type ladder — name sizes from the nominal
 *     down to the 14 px-cap floor, then, at the floor, a horizontal condense
 *     down to `MIN_CONDENSE`, then that condense again without the set-back
 *     tags (a tag gives way before any height does) — at which the columns'
 *     needs (the name, the FULL species · height line at its paired size,
 *     the chip row with its set-back tag) sum to at most the line width: a
 *     sum-constrained fit;
 *  2. widths proportional to those needs (the slack shared the same way);
 *  3. each boundary clamped so every chip stays on its own ace's x;
 *  4. the ladder stepped down until every clamped cell holds its need, so
 *     the whole rail paints one name size.
 */
export function planLedgerCells(
  ctx: LedgerContext,
  w: number,
  layout: LedgerLayout,
  copy: readonly LedgerColumnCopy[],
  locale: PaintLocale,
): LedgerCellPlan[] {
  const k = w / layout.width;
  const floorPx = ledgerFontFloorM(layout) * k;
  const nameTop = Math.max(LEDGER_LINE.nameFont * layout.lineScale * k, floorPx);
  const subTop = Math.max(LEDGER_LINE.subFont * layout.lineScale * k, floorPx);
  const subFor = (p: number) => Math.max(Math.ceil(floorPx), Math.ceil((subTop * p) / nameTop));
  const chipFont = ledgerChipFontM(layout) * k;
  const byId = new Map(copy.map((c) => [c.id, c]));
  const measure = (weight: number, px: number, text: string) => {
    ctx.font = `${weight} ${px}px ${LEDGER_FONT}`;
    return ctx.measureText(text).width;
  };
  const chipWOf = new Map(copy.map((c) => [c.id, ledgerChipWidth(ctx, chipFont, c.rank)]));
  const chipHalf = (id: string) => (chipWOf.get(id) ?? 0) / 2 + 2;
  // The shared ladder: sizes first, then the condense at the floor, then the
  // same condense without the set-back tags, then (a rail too narrow for
  // "species · height" at the floor — one-line N = 9 / 10) the SPLIT mode:
  // the height moves up beside the chip, the species line keeps the species.
  const floorRung = Math.ceil(floorPx);
  const ladder: LedgerRung[] = [];
  for (let p = Math.max(floorRung, Math.ceil(nameTop)); p >= floorRung; p -= 1) {
    ladder.push({ px: p, condense: 1, marker: true, split: false });
  }
  for (const [marker, split] of [[true, false], [false, false], [false, true]] as const) {
    for (let step = marker ? 1 : 0; 1 - step * 0.02 >= MIN_CONDENSE - 1e-9; step += 1) {
      ladder.push({ px: floorRung, condense: 1 - step * 0.02, marker, split });
    }
  }

  const cache = new Map<string, number>();
  const measured = (key: string, weight: number, px: number, text: string): number => {
    const full = `${key}\u0000${weight}\u0000${px}\u0000${text}`;
    const hit = cache.get(full);
    if (hit !== undefined) return hit;
    const out = measure(weight, px, text);
    cache.set(full, out);
    return out;
  };
  /** The chip row a column needs: its chip, plus the tag (set-back word or split height) beside it. */
  const chipRow = (c: LedgerColumnCopy, rung: LedgerRung) => {
    const tag = chipTagText(c, rung, locale);
    const chipW = chipWOf.get(c.id) ?? 0;
    return chipW + 8 + (tag ? LEDGER_TAG_GAP + measured('tag', 700, subFor(rung.px), tag) * rung.condense : 0);
  };
  const need = (id: string, rung: LedgerRung): number => {
    const c = byId.get(id);
    if (!c) return 0;
    const sub = rung.split ? (c.species ?? '—') : speciesLine(c.species, c.heightM, locale);
    const ink = Math.max(measured('name', 800, rung.px, c.name), measured('sub', 600, subFor(rung.px), sub));
    return Math.max(widthFor(ink * rung.condense), chipHalf(id) * 2 + 4, chipRow(c, rung));
  };

  const toPx = (m: number) => (m + layout.width / 2) * k;
  const lines = ([0, 1] as const)
    .map((line) => layout.columns.filter((col) => col.line === line && byId.has(col.id)).sort((a, b) => a.across - b.across))
    .filter((cols) => cols.length > 0)
    .map((cols) => {
      const first = cols[0];
      const last = cols[cols.length - 1];
      return { cols, left: toPx(first.cellAcross - first.width / 2), right: toPx(last.cellAcross + last.width / 2) };
    });

  // 1. The first rung every line holds (sum-constrained).
  const lineHolds = (line: (typeof lines)[number], rung: LedgerRung) =>
    line.cols.reduce((sum, col) => sum + need(col.id, rung), 0) <= line.right - line.left;
  let at = ladder.findIndex((rung) => lines.every((line) => lineHolds(line, rung)));
  if (at < 0) at = ladder.length - 1;

  // 2 + 3. Proportional widths; boundaries clamped so each chip stays on its ace.
  const tile = (rung: LedgerRung) =>
    lines.map(({ cols, left, right }) => {
      const needs = cols.map((col) => need(col.id, rung));
      const sum = needs.reduce((a, b) => a + b, 0);
      const total = right - left;
      const bounds = [left];
      needs.forEach((n, i) => bounds.push(bounds[i] + (sum <= total ? n + ((total - sum) * n) / sum : (total * n) / sum)));
      bounds[cols.length] = right;
      for (let j = 1; j < cols.length; j += 1) {
        const prev = toPx(cols[j - 1].across);
        const next = toPx(cols[j].across);
        const lo = prev + chipHalf(cols[j - 1].id);
        const hi = next - chipHalf(cols[j].id);
        bounds[j] = lo <= hi ? Math.min(hi, Math.max(lo, bounds[j])) : (prev + next) / 2;
      }
      return cols.map((col, i) => ({ col, x0: bounds[i], x1: bounds[i + 1] }));
    });

  // 4. Step down until every clamped cell holds its need at the shared rung.
  let cells = tile(ladder[at]);
  while (at < ladder.length - 1 && !cells.every((line) => line.every((c) => c.x1 - c.x0 >= need(c.col.id, ladder[at]) - 1e-6))) {
    at += 1;
    cells = tile(ladder[at]);
  }
  const rung = ladder[at];
  return cells.flat().map(({ col, x0, x1 }) => ({
    id: col.id,
    line: col.line,
    x0,
    x1,
    namePx: rung.px,
    subPx: subFor(rung.px),
    condense: rung.condense,
    marker: rung.marker,
    split: rung.split,
  }));
}

/**
 * Paint the whole face at canvas size `w × h` (the layout's `canvas`).
 * `lights` is per column in layout order; missing entries read `rest`.
 */
export function paintLedger(
  ctx: LedgerContext,
  w: number,
  h: number,
  layout: LedgerLayout,
  copy: readonly LedgerColumnCopy[],
  lights: readonly ColumnLight[],
  style: LedgerStyle,
  locale: PaintLocale,
): LedgerColumnFit[] {
  const k = w / layout.width;
  const kv = h / layout.height;
  const byId = new Map(copy.map((c) => [c.id, c]));
  const floorPx = ledgerFontFloorM(layout) * k;
  // The line metrics (m), scaled for a two-line rail.
  const m = (key: keyof typeof LEDGER_LINE) => LEDGER_LINE[key] * layout.lineScale;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.ground;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = style.frame;
  ctx.lineWidth = Math.max(2, 0.008 * k);
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);

  const lineTop = (line: 0 | 1) => (line === 0 ? 0 : (layout.lineH + 0.02) * kv);
  if (layout.lines === 2) {
    ctx.fillStyle = style.rule;
    ctx.fillRect(layout.endCap * k, (layout.lineH + 0.008) * kv, w - layout.endCap * 2 * k, 0.004 * kv);
  }

  // End caps: kicker on the left, rank span on the right (rotated, reading up).
  const capFont = Math.max(floorPx * 0.8, 0.06 * k);
  const capLabel = (text: string, cx: number) => {
    ctx.save();
    ctx.translate(cx, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `800 ${capFont}px ${LEDGER_FONT}`;
    ctx.fillStyle = style.kickerInk;
    const fit = autoFit(ctx, (px) => {
      ctx.font = `800 ${px}px ${LEDGER_FONT}`;
    }, text, h * 0.9, capFont, capFont * 0.6);
    const tw = ctx.measureText(fit.text).width * fit.squeeze;
    ctx.translate(-tw / 2, fit.px * 0.36);
    if (fit.squeeze !== 1) ctx.scale(fit.squeeze, 1);
    ctx.fillText(fit.text, 0, 0);
    ctx.restore();
  };
  capLabel(ledgerKicker(locale), (layout.endCap / 2) * k);
  capLabel(ledgerRankSpan(copy.length, locale), w - (layout.endCap / 2) * k);

  const plan = new Map(planLedgerCells(ctx, w, layout, copy, locale).map((cell) => [cell.id, cell]));
  const fits: LedgerColumnFit[] = [];
  layout.columns.forEach((column, i) => {
    const c = byId.get(column.id);
    const cell = plan.get(column.id);
    if (!c || !cell) return;
    const light = lights[i] ?? 'rest';
    // The chip + chevron sit on the ace's own x; the text centres in the
    // ink-tiled cell (`planLedgerCells` keeps the ace inside it).
    const ax = (column.across + layout.width / 2) * k;
    const cx = (cell.x0 + cell.x1) / 2;
    const colW = cell.x1 - cell.x0;
    const top = lineTop(column.line);
    const lineH = layout.lineH * kv;
    const x0 = cx - colW / 2;

    // Column ground: rest is the face itself; the call lifts it.
    if (light !== 'rest') {
      ctx.fillStyle = light === 'calling' ? style.groundCalling : style.groundCalled;
      ctx.fillRect(x0 + 2, top + 2, colW - 4, lineH - 4);
    }
    // Hairline between neighbours (left edge), so the columns read as a table.
    if (i > 0) {
      ctx.fillStyle = style.rule;
      ctx.fillRect(x0, top + m('padTop') * kv, Math.max(1, 0.003 * k), lineH - (m('padTop') + m('padBottom')) * kv);
    }

    // Band chip: chevron + rank, in the gym-band colour. Wave-2 r2: the
    // rank's cap is ≥ 14 px at 1440 (`ledgerChipFontM`), so rank and name
    // read as one unit; the chip is centred in its row.
    const chipFont = ledgerChipFontM(layout) * k;
    const chipH = chipFont / LEDGER_CHIP_FONT;
    // Centred on its row; a floored chip may borrow the top pad, never the name row.
    const chipY = Math.max(top + 0.004 * kv, top + (m('padTop') + m('chipRow') / 2) * kv - chipH / 2);
    const rankText = String(c.rank);
    const chev = chipFont * 0.62;
    const chipW = Math.min(colW * 0.9, ledgerChipWidth(ctx, chipFont, c.rank));
    let chipX = Math.min(x0 + colW - chipW - 2, Math.max(x0 + 2, ax - chipW / 2));

    // Wave-2 r3: a colossal ace's "hinten" / "set back" tag rides beside its
    // chip (the chip row has the room the species line does not), so the
    // depth reads as deliberate. The chip keeps its ace's x when the tag fits
    // on either side; otherwise chip + tag centre in the cell as one group.
    // Split mode puts the height there instead (`chipTagText`).
    const tagText = chipTagText(c, cell, locale);
    let tag: { x: number; fit: AutoFit } | null = null;
    if (tagText !== null) {
      const tagPx = cell.subPx;
      const setTag = (px: number) => {
        ctx.font = `700 ${px}px ${LEDGER_FONT}`;
      };
      const room = colW - chipW - LEDGER_TAG_GAP - 8;
      const fit = autoFit(ctx, setTag, tagText, room, tagPx, tagPx);
      if (fit.text === tagText) {
        setTag(fit.px);
        const tagW = ctx.measureText(fit.text).width * fit.squeeze;
        if (chipX + chipW + LEDGER_TAG_GAP + tagW <= x0 + colW - 4) {
          tag = { x: chipX + chipW + LEDGER_TAG_GAP, fit };
        } else if (chipX - LEDGER_TAG_GAP - tagW >= x0 + 4) {
          tag = { x: chipX - LEDGER_TAG_GAP - tagW, fit };
        } else {
          const group = chipW + LEDGER_TAG_GAP + tagW;
          chipX = Math.max(x0 + 4, cx - group / 2);
          tag = { x: chipX + chipW + LEDGER_TAG_GAP, fit };
        }
      }
    }
    ctx.font = `800 ${chipFont}px ${LEDGER_FONT}`;
    if (light === 'calling') {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = c.band;
      roundRect(ctx, chipX - chipH * 0.18, chipY - chipH * 0.18, chipW + chipH * 0.36, chipH * 1.36, chipH);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = c.band;
    roundRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
    ctx.fill();
    ctx.fillStyle = c.bandInk;
    const chevX = chipX + chipFont * 0.5;
    const chevMid = chipY + chipH / 2;
    ctx.beginPath();
    ctx.moveTo(chevX, chevMid + chev * 0.35);
    ctx.lineTo(chevX + chev / 2, chevMid - chev * 0.4);
    ctx.lineTo(chevX + chev, chevMid + chev * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.fillText(rankText, chevX + chev + chipFont * 0.22, chipY + chipH / 2 + chipFont * 0.36);
    if (tag) {
      ctx.fillStyle = style.subInk;
      ctx.font = `700 ${tag.fit.px}px ${LEDGER_FONT}`;
      ctx.save();
      ctx.translate(tag.x, chipY + chipH / 2 + tag.fit.px * 0.36);
      if (tag.fit.squeeze !== 1) ctx.scale(tag.fit.squeeze, 1);
      ctx.fillText(tag.fit.text, 0, 0);
      ctx.restore();
    }

    // Name — at the rail's shared size (`planLedgerCells`, ≥ the 14 px-cap
    // floor): condense, then shrink to the floor, then (a long two-word name in a narrow column) wrap onto two
    // floored lines — only then the suffix-keeping ellipsis. Never a dropped word.
    const pad = columnPad(colW);
    const rowTop = top + (m('padTop') + m('chipRow')) * kv;
    const nameRow = m('nameRow') * kv;
    const maxW = colW - pad * 2;
    const setName = (px: number) => {
      ctx.font = `800 ${px}px ${LEDGER_FONT}`;
    };
    // Wave-2 r3: the rail's shared size first (condensing only as far as this
    // name needs); only a name that would still clip leaves the shared size.
    let nameFit = autoFit(ctx, setName, c.name, maxW, cell.namePx, cell.namePx);
    if (nameFit.text !== c.name) nameFit = autoFit(ctx, setName, c.name, maxW, cell.namePx, floorPx);
    let nameLines = 1;
    ctx.fillStyle = style.ink;
    if (nameFit.text !== c.name && /\s/.test(c.name.trim())) {
      setName(floorPx);
      const wrapped = fitLinesCondensed(ctx, c.name, maxW, 2);
      if (wrapped.complete) {
        nameLines = wrapped.lines.length;
        wrapped.lines.forEach((line, li) => {
          paintCentred(ctx, { px: floorPx, squeeze: wrapped.squeeze[li], text: line }, 800, cx, rowTop + nameRow * (li === 0 ? 0.44 : 0.93));
        });
        nameFit = { px: floorPx, squeeze: Math.min(...wrapped.squeeze), text: wrapped.lines.join(' ') };
      }
    }
    if (nameLines === 1) paintCentred(ctx, nameFit, 800, cx, rowTop + nameRow * 0.74);
    const nameBase = rowTop + nameRow;

    // Species · height.
    const subBase = nameBase + m('subRow') * 0.8 * kv;
    const setSub = (px: number) => {
      ctx.font = `600 ${px}px ${LEDGER_FONT}`;
    };
    const subPx = cell.subPx;
    // Split mode: the height is already beside the chip, so the line is the species alone.
    const splitHeight = cell.split && tag !== null && tagText !== null && tagText === heightText(c.heightM, locale);
    const variants = splitHeight ? [c.species ?? '—'] : speciesLineVariants(c.species, c.heightM, locale);
    // The full line at the shared size first (the plan sized every cell for
    // it); the shorter variants only when even that would clip.
    let subFit = autoFit(ctx, setSub, variants[0], colW - pad * 2, subPx, subPx);
    if (subFit.text !== variants[0]) subFit = autoFit(ctx, setSub, variants[0], colW - pad * 2, subPx, floorPx);
    for (let vi = 1; vi < variants.length && subFit.text !== variants[vi - 1]; vi += 1) {
      subFit = autoFit(ctx, setSub, variants[vi], colW - pad * 2, subPx, floorPx);
    }
    ctx.fillStyle = style.subInk;
    paintCentred(ctx, subFit, 600, cx, subBase);

    // Band rule under a called column.
    if (light !== 'rest') {
      ctx.fillStyle = c.band;
      ctx.fillRect(x0 + colW * 0.2, top + lineH - m('padBottom') * 0.6 * kv, colW * 0.6, Math.max(2, 0.008 * kv));
    }

    fits.push({
      id: c.id,
      name: nameFit,
      nameLines,
      sub: subFit,
      nameComplete: nameFit.text === c.name,
      subComplete: subFit.text === variants[0],
      setBackTag: tag !== null && tagText === setBackWord(locale),
      chipTag: tag !== null ? tagText : null,
      split: cell.split,
      cell: { line: column.line, left: cell.x0 / k - layout.width / 2, right: cell.x1 / k - layout.width / 2 },
    });
  });
  return fits;
}

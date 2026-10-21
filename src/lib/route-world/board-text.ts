/**
 * The shared canvas TEXT law for every painted board (fidelity W1, baseline
 * audit issues 7 + 8). `board-paint-path.ts` owns the allocation and the
 * station font floor; this module owns what happens between the lines once
 * the floor has decided the px: vertical rhythm, the roster index gutter,
 * the board-row schemas (so a stat row can never be painted as a fixture)
 * and the price-band words per locale. Pure — no DOM, no three — so the
 * painters and their tests share one arithmetic.
 *
 * Why a law and not per-painter nudges: the floors (C-105) raised every
 * painted px after the layouts were authored, so hand-placed baselines that
 * were fine at 24 px overprinted at the floored 35–50 px ("01BULBASAUR",
 * the pulse subtitle riding into the table header, the trail-sign date
 * lines stacked at 26 px pitch under 35 px glyphs). Every stacked baseline
 * derived here is a function of the px actually painted.
 */

import type { Locale } from '@/i18n/config';
import { upperForPaint } from '@/i18n/core';
import { READABLE_LINE_PX } from './legibility';
import { paintCaps, paintT } from './paint-copy';

/** Minimum line box as a multiple of the font px (CSS `line-height: 1.2`). */
export const MIN_LEADING = 1.2;

/**
 * The glyph split inside one em the stacking model assumes: a system-ui
 * face puts ≈ 0.8 em above the baseline (ascenders, accents such as Ä Ö Ü)
 * and ≈ 0.2 em below (descenders). Disclosed approximation: the real split
 * varies ±0.05 em by face; `MIN_LEADING`'s half-leading absorbs that.
 */
const ASCENT_EM = 0.8;
const DESCENT_EM = 0.2;
const HALF_LEADING_EM = (MIN_LEADING - 1) / 2;

/** A painted line's CSS box above its baseline at `MIN_LEADING` (ascent + half-leading), in em. */
export const TEXT_BOX_ASCENT_EM = ASCENT_EM + HALF_LEADING_EM;
/** …and below its baseline (descent + half-leading), in em. */
export const TEXT_BOX_DESCENT_EM = DESCENT_EM + HALF_LEADING_EM;

/**
 * Baseline-to-baseline step from a line painted at `abovePx` to the line
 * under it painted at `belowPx`: the two CSS line boxes stacked, each with
 * its half-leading. Same-size lines step exactly `ceil(leading × px)`; a
 * small line under a large masthead steps by the masthead's descent box
 * plus the small line's ascent box — never less than either line needs.
 */
export function stackStep(abovePx: number, belowPx: number, leading: number = MIN_LEADING): number {
  const half = (Math.max(leading, MIN_LEADING) - 1) / 2;
  return Math.ceil(abovePx * (DESCENT_EM + half) + belowPx * (ASCENT_EM + half));
}

/** Pitch between repeated lines of one px (≥ `MIN_LEADING` × px). */
export function lineStep(px: number, leading: number = MIN_LEADING): number {
  return stackStep(px, px, leading);
}

/** Leading actually achieved by a baseline step at a px (for guards and tests). */
export function measuredLeading(stepPx: number, px: number): number {
  return px > 0 ? stepPx / px : Infinity;
}

/** The slice of a 2D context the text law needs (a real context satisfies it). */
export interface TextMeasurer {
  measureText(text: string): { width: number };
}

/**
 * The FIXED index gutter: the x where the text after an index column may
 * start, measured from the widest index label actually painted (the caller
 * sets the index font first). One gutter per face, so every row's text
 * starts on the same column and no index can overprint its name at the
 * floored px (the "01BULBASAUR" defect: a 44 px gutter under a 58 px "01").
 * `minTextX` keeps an authored column when the measured one is narrower.
 */
export function indexGutter(
  ctx: TextMeasurer,
  labels: readonly string[],
  indexX: number,
  gapPx: number,
  minTextX: number = 0,
): number {
  let widest = 0;
  for (const label of labels) widest = Math.max(widest, ctx.measureText(label).width);
  return Math.max(minTextX, Math.ceil(indexX + widest + gapPx));
}

/** One styled run of a kicker line. */
export interface KickerRun {
  readonly text: string;
  /** A full canvas font string, e.g. `800 43px system-ui`. */
  readonly font: string;
  readonly color: string;
}

/**
 * The masthead kicker: `brand · detail` on ONE baseline. The pulse boards
 * used to paint the detail (stage + matchday) on its own line 34 px above
 * the table header at a 43 px floor, so the two rows collided; folding it
 * into the kicker frees a whole line box, which lets every stacked baseline
 * below keep `MIN_LEADING`. When the budget is short (a LIVE pill shares
 * the band) the decorative brand drops first and the data line survives;
 * only a detail that alone overflows is truncated (`fit`, the painter's own
 * ellipsis routine). Returns the texts painted, for guards.
 */
export function paintKickerLine(
  ctx: CanvasRenderingContext2D,
  brand: KickerRun,
  detail: KickerRun,
  x: number,
  y: number,
  maxW: number,
  fit: (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) => void,
): string[] {
  const sep = ' · ';
  ctx.font = brand.font;
  const brandW = ctx.measureText(`${brand.text}${sep}`).width;
  ctx.font = detail.font;
  const detailW = ctx.measureText(detail.text).width;
  if (brandW + detailW <= maxW) {
    ctx.font = brand.font;
    ctx.fillStyle = brand.color;
    ctx.fillText(`${brand.text}${sep}`, x, y);
    ctx.font = detail.font;
    ctx.fillStyle = detail.color;
    ctx.fillText(detail.text, x + brandW, y);
    return [`${brand.text}${sep}`, detail.text];
  }
  // Short of room: the data line alone, in the brand's accent so the band
  // still reads as the masthead.
  ctx.font = brand.font;
  ctx.fillStyle = brand.color;
  fit(ctx, detail.text, x, y, maxW);
  return [detail.text];
}

// ── Board-row schemas (audit issue 7) ─────────────────────────────

/** A fixture: two sides joined by "vs". `kind` may be omitted (legacy rows). */
export interface MatchRow {
  readonly kind?: 'match';
  readonly home: string;
  readonly away: string;
  readonly detail: string;
  readonly accent?: boolean;
  /** A match in progress: painted with the live underline (fidelity W1 r4). */
  readonly live?: boolean;
}

/** A league statistic written whole ("12 TRAINERS", "MATCHDAY 2") — never a pairing. */
export interface StatRow {
  readonly kind: 'stat';
  readonly text: string;
  readonly detail: string;
  readonly accent?: boolean;
}

/** A standings line ("1. WELLS · 4–1") — never a pairing. */
export interface StandingRow {
  readonly kind: 'standing';
  readonly rank: number;
  readonly name: string;
  readonly record: string;
  readonly detail: string;
  readonly accent?: boolean;
}

/** One painted board row. Only a `match` row is ever joined with "vs". */
export type BoardRow = MatchRow | StatRow | StandingRow;

/** The row's headline as painted — the ONE place "vs" is written. */
export function boardRowHeadline(row: BoardRow): string {
  switch (row.kind) {
    case 'stat':
      return row.text;
    case 'standing':
      return `${row.rank}. ${row.name} · ${row.record}`;
    default:
      return `${row.home} vs ${row.away}`;
  }
}

// ── Price-band words (audit issue 8 / W1 locale leak) ─────────────

/** Language of a painted face: the viewer's UI locale (i18n D11). */
export type PaintLocale = Locale;

/**
 * The league stores point-buy price groups as ASCII keys (`guenstig`,
 * `hoch`, `mittel` …). Painting the key upper-cased leaks German into the
 * English worlds ("10 PTS GUENSTIG") and spells German surfaces without
 * their umlaut ("GUENSTIG"). Each locale gets its own word (`paint.priceBand`,
 * lettered with `upperForPaint`); an unknown key passes through upper-cased,
 * never dropped.
 */
export function priceBandLabel(band: string, locale: PaintLocale): string {
  const key = band.toLowerCase();
  const t = paintT(locale);
  const path = `priceBand.${key}`;
  return t.has(path) ? upperForPaint(t.dynamic(path), locale) : upperForPaint(band, locale);
}

// ── Kickoff ticker state (fidelity W1 r3 — stale "NEXT KICKOFF") ──

/** The slice of board content the ticker reads (structural — no component import). */
export interface KickoffTickerSource<K extends { readonly iso: string }> {
  readonly next: K | null;
  readonly live: { readonly home: string; readonly away: string } | null;
  /** Every distinct still-scheduled kickoff, earliest first (`next` is its head). */
  readonly kickoffs?: readonly K[];
}

/** What a board's kickoff line should say at `nowMs`. */
export type KickoffTickerState<K extends { readonly iso: string }> =
  | { readonly kind: 'live'; readonly home: string; readonly away: string }
  | { readonly kind: 'next'; readonly iso: string; readonly kickoff: K }
  | null;

function inFuture(iso: string, nowMs: number): boolean {
  const remaining = Date.parse(iso) - nowMs;
  return Number.isFinite(remaining) && remaining > 0;
}

/**
 * The ONE ordering every board's kickoff line follows (the plaza ticker's
 * r2 rule, now shared by the English isles, whose static stamps kept
 * printing `NEXT KICKOFF · 9/17 18:00` beside the LIVE row for that very
 * kickoff):
 * 1. `next` still in the future → next;
 * 2. a match is live → live (the schedule row's own pairing);
 * 3. the first `kickoffs` entry still in the future → next;
 * 4. otherwise `null` — the caller paints its season line, never a past stamp.
 * `nowMs` is passed in so this stays pure.
 */
export function kickoffTickerState<K extends { readonly iso: string }>(
  source: KickoffTickerSource<K>,
  nowMs: number,
): KickoffTickerState<K> {
  const { next, live } = source;
  if (next && inFuture(next.iso, nowMs)) return { kind: 'next', iso: next.iso, kickoff: next };
  if (live) return { kind: 'live', home: live.home, away: live.away };
  for (const kickoff of source.kickoffs ?? []) {
    if (inFuture(kickoff.iso, nowMs)) return { kind: 'next', iso: kickoff.iso, kickoff };
  }
  return null;
}

/** No-break space: glues a pairing so a wrap never strands its dash. */
export const NBSP = ' ';

/**
 * `SKYE – TIDE` with no-break spaces around the dash: a wrap puts the whole
 * pairing on one line (the r3 mountain capture split `LIVE · BELL –` / `COLE`).
 */
export function livePair(home: string, away: string): string {
  return `${home}${NBSP}–${NBSP}${away}`;
}

/**
 * Kickoff line for the isles' footers and cloth tails, in `locale` (English
 * unless the caller passes the viewer's; `paint.board.kickoffNext`):
 * `LIVE · SKYE – TIDE` or `NEXT KICKOFF · 9/24 18:00`; `null` when neither
 * holds (the caller keeps its season line or drops the tail). The narrow
 * cloths pass `liveMatchPair` (`LIVE · SKYE vs TIDE`, fidelity wave 2).
 */
export function englishKickoffLine<K extends { readonly iso: string; readonly date: string; readonly time: string }>(
  source: KickoffTickerSource<K>,
  nowMs: number,
  pair: (home: string, away: string) => string = livePair,
  locale: PaintLocale = 'en',
): string | null {
  const state = kickoffTickerState(source, nowMs);
  if (!state) return null;
  if (state.kind === 'live') return `${paintCaps(locale, 'common.live')} · ${pair(state.home, state.away)}`;
  return paintCaps(locale, 'board.kickoffNext', { date: state.kickoff.date, time: state.kickoff.time });
}

// ── Separator-aware wrap (fidelity W1 r3 — orphaned " · ") ────────

/** The middle-dot separator the boards join fields with. */
export const FIELD_SEPARATOR = '·';

/**
 * Greedy word wrap in which the field separator never survives a break.
 * The plain word wrap split `MD 2 · 9/17 18:00 · LIVE` into
 * `MD 2 · 9/17 18:00` / `· LIVE` and `4. WARREN · 2–1` into `4. WARREN ·` /
 * `2–1` — a line that starts or ends with a dot reads as a printing fault.
 * Here a break that lands next to a `·` swallows it (the line break IS the
 * separator), so no returned line starts or ends with `·`; everything else
 * is the painters' word wrap (same greedy fill, same `maxLines` cut, a
 * single over-wide word still takes a line of its own).
 */
export function wrapFields(measure: TextMeasurer, text: string, maxW: number, maxLines: number): string[] {
  // Split on ordinary whitespace only — a no-break space (`livePair`) glues.
  // Fidelity W1 r5: short tokens are glued to a neighbour first
  // (`glueShortTokens`) so no line ever starts with a stranded "2".
  const words = glueShortTokens(text.split(/[ \t\r\n]+/).filter(Boolean));
  const lines: string[] = [];
  let line: string[] = [];
  const flush = () => {
    while (line.length > 0 && line[line.length - 1] === FIELD_SEPARATOR) line.pop();
    if (line.length > 0) lines.push(line.join(' '));
    line = [];
  };
  for (const word of words) {
    if (line.length === 0 && word === FIELD_SEPARATOR) continue;
    const next = [...line, word].join(' ');
    if (line.length === 0 || measure.measureText(next).width <= maxW) {
      line.push(word);
      continue;
    }
    flush();
    if (lines.length >= maxLines) break;
    if (word !== FIELD_SEPARATOR) line.push(word);
  }
  flush();
  return lines.slice(0, Math.max(0, maxLines));
}

/** The longest token (in characters) a wrap may never strand on a line of its own start (fidelity W1 r5). */
export const ORPHAN_MAX_CHARS = 2;

/**
 * The no-orphan rule (fidelity W1 r5): the 390 cloths wrapped
 * `MATCHDAY 2` into `MATCHDAY` / `2` — a lone digit reads as a stray
 * mark, not as data. A token of ≤ `ORPHAN_MAX_CHARS` characters is joined
 * to the word AFTER it when one follows (`MD 2`, `1. WELLS`, `vs AY`), and
 * to the word BEFORE it when it ends the text or its field (`MATCHDAY 2`,
 * `PTS ▲1`). The joined unit wraps as one word; a unit wider than the line
 * takes a line of its own and the painter condenses it (`paintDashedLine`)
 * — the wrap never breaks next to the short token. The field separator is
 * never glued.
 */
export function glueShortTokens(words: readonly string[]): string[] {
  const out: string[] = [];
  const isShort = (word: string) => word !== FIELD_SEPARATOR && Array.from(word).length <= ORPHAN_MAX_CHARS;
  let pending: string | null = null;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (pending !== null) {
      // Only set when this word exists and is not a separator (below). A
      // short partner that itself leads a word keeps the chain open, so
      // `AY vs OSMAN` never wraps as `AY vs` / `OSMAN`.
      const joined: string = `${pending} ${word}`;
      const after = words[i + 1];
      if (isShort(word) && after !== undefined && after !== FIELD_SEPARATOR) {
        pending = joined;
        continue;
      }
      out.push(joined);
      pending = null;
      continue;
    }
    if (!isShort(word)) {
      out.push(word);
      continue;
    }
    const next = words[i + 1];
    if (next !== undefined && next !== FIELD_SEPARATOR) {
      pending = word;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev !== undefined && prev !== FIELD_SEPARATOR) out[out.length - 1] = `${prev} ${word}`;
    else out.push(word);
  }
  return out;
}

/**
 * A board row's two texts as painted on a narrow cloth (fidelity W1 r5): a
 * standing whose headline (`1. WELLS · 4–1`) needs two lines stranded its
 * record (`1. WELLS` / `4–1`). Folded, the name keeps the headline and the
 * record LEADS the detail line (`4–1 · 10 PTS ▲1`), so the record never
 * sits alone. Other kinds, and a standing that fits, are unchanged.
 */
export function boardRowTexts(row: BoardRow, headlineFits: boolean): { headline: string; detail: string } {
  if (row.kind === 'standing' && !headlineFits) {
    return {
      headline: `${row.rank}. ${row.name}`,
      detail: row.detail ? `${row.record} ${FIELD_SEPARATOR} ${row.detail}` : row.record,
    };
  }
  return { headline: boardRowHeadline(row), detail: row.detail };
}

// ── Ink contrast (fidelity W1 r3 — the mountain sign kickers) ─────

function channel(hex: string): number {
  const c = parseInt(hex, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rgb` / `#rrggbb` colour (NaN when unparseable). */
export function relativeLuminance(color: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return Number.NaN;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  return 0.2126 * channel(hex.slice(0, 2)) + 0.7152 * channel(hex.slice(2, 4)) + 0.0722 * channel(hex.slice(4, 6));
}

/** WCAG contrast ratio between two opaque colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The candidate ink with the highest contrast against `ground` (first wins ties). */
export function bestInk(ground: string, candidates: readonly string[]): string {
  let best = candidates[0];
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, ground);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

// ── Sign glyphs as geometry (fidelity W1 r4 — 390 sign flips) ─────

/**
 * Minimum on-screen stroke (device px at DPR 1) a painted sign glyph keeps
 * at the binding pose. The r3 390 stills minified the font's own `+` into a
 * `−` (its vertical bar is thinner than one screen px, so the mip chain
 * averaged it into the ground) and dropped the W–L en dash entirely —
 * `3–2 +2` painted, `3 2 −2` read. A 1.5 px stroke survives the box filter.
 */
export const SIGN_STROKE_SCREEN_PX = 1.5;

/**
 * The sign-stroke floor in painter px. `floorPx` is the station's pose-derived
 * font floor (`tools.fontFloorPx`): by construction a line of `floorPx`
 * painter px renders at ≥ `READABLE_LINE_PX` screen px at BOTH poses (the
 * floor is the max of the 1440 and landed-390 derivations), so the screen
 * density is ≥ `READABLE_LINE_PX / floorPx` px per painter px and a stroke of
 * `SIGN_STROKE_SCREEN_PX × floorPx / READABLE_LINE_PX` painter px renders at
 * ≥ 1.5 screen px on the landed 390 camera. Never thinner than a bold
 * weight's own stroke (≈ 0.12 em of the painted px).
 */
export function signStrokePx(fontPx: number, floorPx: number): number {
  return Math.max(Math.ceil(fontPx * 0.12), Math.ceil((SIGN_STROKE_SCREEN_PX * floorPx) / READABLE_LINE_PX));
}

/** Minimum length of the painted en dash, in sign strokes (a bar, never a blob). */
export const EN_DASH_ASPECT = 3;

/** The three sign glyphs the standings paint as rects. */
export type SignGlyph = '+' | '−' | '–';

/** One axis-aligned rect of a sign glyph (painter px). */
export interface GlyphRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The rects of a sign glyph whose left edge is `x`, on the text baseline
 * `baselineY`, sized for a line painted at `px` with stroke `stroke`
 * (`signStrokePx`). Both bars of `+` share ONE stroke and one length, so
 * minification can never keep the horizontal and lose the vertical (the r3
 * flip). The bar sits on the digits' math axis (≈ 0.36 em above baseline).
 * `advance` is the x the next glyph starts at.
 */
export function signGlyphRects(
  glyph: SignGlyph,
  x: number,
  baselineY: number,
  px: number,
  stroke: number,
): { rects: GlyphRect[]; advance: number } {
  const pad = Math.max(1, Math.round(px * 0.06));
  // A sign bar spans ≥ 3.5 strokes, so each arm of `+` reaches ≥ 1.25
  // strokes past the crossing — enough to survive the box filter at the
  // 390 density (tested). The en dash is `EN_DASH_ASPECT` strokes long
  // (fidelity wave 2, W1 residual 2): the r5 2-stroke dash was a 2.5:1 blob
  // — 4 × 1.6 screen px on the landed 390 cloths — that read as `=`
  // (`BELL = COLE`, `4=1`). At ≥ 3:1 it is a bar, and a `12–10` record
  // still fits the W–L column (tested at the pulse floors).
  const len = Math.max(Math.round(px * 0.5), Math.round(stroke * (glyph === '–' ? EN_DASH_ASPECT : 3.5)));
  const axisY = baselineY - px * 0.36;
  const left = x + pad;
  const bar: GlyphRect = { x: left, y: Math.round(axisY - stroke / 2), w: len, h: stroke };
  const rects: GlyphRect[] = [bar];
  if (glyph === '+') {
    rects.push({ x: Math.round(left + len / 2 - stroke / 2), y: Math.round(axisY - len / 2), w: stroke, h: len });
  }
  return { rects, advance: x + pad * 2 + len };
}

/** The slice of a 2D context the glyph painters need (a real context satisfies it). */
export interface GlyphPainter extends TextMeasurer {
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  /** Read and restored around the ground pad / LIVE pill (optional so test recorders may omit it). */
  fillStyle?: string | CanvasGradient | CanvasPattern;
}

/**
 * Optional line dressing shared by the dash painters (fidelity wave 2):
 * - `ground`: the face colour under the line. Each painted dash first clears
 *   a pad of one stroke above and below it to the ground, so a woven thread
 *   band or grain line can never sit beside the bar and minify into a second
 *   stroke (`=`, W1 residual 2).
 * - `pill`: a token painted as a FILLED pill (the LIVE marker — every world's
 *   live datum is a filled pill, never a coloured word alone).
 */
export interface LineDressing {
  readonly ground?: string;
  readonly pill?: LinePill;
}

/** A whole-word token painted on a filled pill. */
export interface LinePill {
  /** The token as it appears in the text (matched as a whole word). */
  readonly word: string;
  readonly fill: string;
  readonly ink: string;
}

/** Horizontal pad inside a line pill, each side (em of the line px). */
export const LINE_PILL_PAD_EM = 0.22;
/** The pill's top above the baseline and bottom below it (em) — inside the 1.2 line box (0.9 / 0.3). */
export const LINE_PILL_TOP_EM = 0.84;
export const LINE_PILL_BOTTOM_EM = 0.2;

/** The extra advance a pill adds over its bare word (both pads). */
export function linePillExtra(px: number): number {
  return 2 * Math.round(px * LINE_PILL_PAD_EM);
}

/** The rect of a line pill starting at `x` (its left pad included) — for painters and tests. */
export function linePillRect(x: number, baselineY: number, wordW: number, px: number): GlyphRect {
  const top = Math.round(baselineY - px * LINE_PILL_TOP_EM);
  return { x, y: top, w: Math.ceil(wordW) + linePillExtra(px), h: Math.round(baselineY + px * LINE_PILL_BOTTOM_EM) - top };
}

function paintGlyph(
  ctx: GlyphPainter,
  glyph: SignGlyph,
  x: number,
  y: number,
  px: number,
  stroke: number,
  ground?: string,
): number {
  const { rects, advance } = signGlyphRects(glyph, x, y, px, stroke);
  if (ground !== undefined && glyph === '–') {
    const ink = ctx.fillStyle;
    ctx.fillStyle = ground;
    for (const r of rects) ctx.fillRect(r.x, r.y - stroke, r.w, r.h + stroke * 2);
    ctx.fillStyle = ink;
  }
  for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
  return advance;
}

/**
 * A standings DIFF cell: `+2` / `−3` / `0`, the sign painted as rects (the
 * digits stay text, in the caller's font and fill). Returns the end x.
 */
export function paintSignedNumber(
  ctx: GlyphPainter,
  value: number,
  x: number,
  y: number,
  px: number,
  stroke: number,
): number {
  let cursor = x;
  if (value > 0) cursor = paintGlyph(ctx, '+', cursor, y, px, stroke);
  else if (value < 0) cursor = paintGlyph(ctx, '−', cursor, y, px, stroke);
  const digits = String(Math.abs(value));
  ctx.fillText(digits, cursor, y);
  return cursor + ctx.measureText(digits).width;
}

/**
 * Two fields joined by an en dash painted as a rect (`4–1`, the `W–L`
 * header): the dash keeps the sign stroke, so the record never reads as
 * two loose numbers. Returns the end x. `ground` pads the dash clear of
 * weave/grain lines (`LineDressing.ground`).
 */
export function paintDashPair(
  ctx: GlyphPainter,
  left: string,
  right: string,
  x: number,
  y: number,
  px: number,
  stroke: number,
  ground?: string,
): number {
  ctx.fillText(left, x, y);
  const afterLeft = x + ctx.measureText(left).width;
  const cursor = paintGlyph(ctx, '–', afterLeft, y, px, stroke, ground);
  ctx.fillText(right, cursor, y);
  return cursor + ctx.measureText(right).width;
}

/** A context that can also condense a line horizontally (a real 2D context satisfies it). */
export interface LinePainter extends GlyphPainter {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
}

/** The en dash every cloth pairing / record carries (painted as a rect). */
const EN_DASH = '–';

/** One run of a dressed line: plain text, a rect-painted en dash, or a pill token. */
type LineRun = { readonly kind: 'text' | 'pill'; readonly text: string } | { readonly kind: 'dash' };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a line into runs: whole-word pill tokens, then en dashes inside the text runs. */
function lineRuns(text: string, pillWord?: string): LineRun[] {
  const pieces: Array<{ kind: 'text' | 'pill'; text: string }> = [];
  if (pillWord) {
    const re = new RegExp(`(^|[\\s\\u00a0])(${escapeRegExp(pillWord)})(?=$|[\\s\\u00a0])`, 'g');
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index + m[1].length;
      if (start > last) pieces.push({ kind: 'text', text: text.slice(last, start) });
      pieces.push({ kind: 'pill', text: m[2] });
      last = start + m[2].length;
    }
    if (last < text.length) pieces.push({ kind: 'text', text: text.slice(last) });
    // The pill IS the separator: a field dot beside it is dropped
    // (`18:00 · LIVE` paints `18:00 [LIVE]`, `LIVE · A vs B` paints `[LIVE] A vs B`).
    for (let i = 0; i < pieces.length; i += 1) {
      if (pieces[i].kind !== 'text') continue;
      let t = pieces[i].text;
      if (pieces[i + 1]?.kind === 'pill') t = t.replace(/[\s ]*·[\s ]*$/, ' ');
      if (pieces[i - 1]?.kind === 'pill') t = t.replace(/^[\s ]*·[\s ]*/, ' ');
      pieces[i] = { kind: 'text', text: t };
    }
  } else {
    pieces.push({ kind: 'text', text });
  }
  const runs: LineRun[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'pill') {
      runs.push(piece);
      continue;
    }
    piece.text.split(EN_DASH).forEach((part, i) => {
      if (i > 0) runs.push({ kind: 'dash' });
      if (part) runs.push({ kind: 'text', text: part });
    });
  }
  return runs;
}

/** Natural width of a line whose en dashes are painted as sign-stroke rects (and `pill` tokens as pills). */
export function dashedLineWidth(ctx: TextMeasurer, text: string, px: number, stroke: number, pill?: LinePill): number {
  const dash = signGlyphRects('–', 0, 0, px, stroke).advance;
  let sum = 0;
  for (const run of lineRuns(text, pill?.word)) {
    if (run.kind === 'dash') sum += dash;
    else sum += ctx.measureText(run.text).width + (run.kind === 'pill' ? linePillExtra(px) : 0);
  }
  return sum;
}

/**
 * Paint one cloth line with every en dash as a rect at the sign-stroke
 * floor (fidelity W1 r5 — `paintDashPair` for whole lines): the 390 PULSE
 * cloth painted `LIVE · WELLS – AY` and the font's dash vanished in the mip
 * chain (`WELLS    AY`). A line wider than `maxW` (a glued no-orphan unit)
 * is condensed horizontally to fit — glyph height stays at the floored px,
 * nothing is clipped. Returns the painted width.
 *
 * Fidelity wave 2: `dressing.ground` pads each dash clear of weave lines,
 * and `dressing.pill` paints its token (LIVE) on a filled pill in the
 * pill's own ink; the line ink is restored after it.
 */
export function paintDashedLine(
  ctx: LinePainter,
  text: string,
  x: number,
  y: number,
  px: number,
  stroke: number,
  maxW: number,
  dressing: LineDressing = {},
): number {
  const natural = dashedLineWidth(ctx, text, px, stroke, dressing.pill);
  const squeeze = natural > maxW && natural > 0 ? maxW / natural : 1;
  const paint = (ox: number, oy: number) => {
    let cursor = ox;
    for (const run of lineRuns(text, dressing.pill?.word)) {
      if (run.kind === 'dash') {
        cursor = paintGlyph(ctx, '–', cursor, oy, px, stroke, dressing.ground);
        continue;
      }
      const width = ctx.measureText(run.text).width;
      if (run.kind === 'pill' && dressing.pill) {
        const ink = ctx.fillStyle;
        const rect = linePillRect(cursor, oy, width, px);
        ctx.fillStyle = dressing.pill.fill;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = dressing.pill.ink;
        ctx.fillText(run.text, cursor + linePillExtra(px) / 2, oy);
        ctx.fillStyle = ink;
        cursor += rect.w;
        continue;
      }
      ctx.fillText(run.text, cursor, oy);
      cursor += width;
    }
  };
  if (squeeze === 1) {
    paint(x, y);
    return natural;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(squeeze, 1);
  paint(0, 0);
  ctx.restore();
  return maxW;
}

// ── Honest multi-line fit (fidelity wave 2 — "SAKURA / PARK") ─────

/** The narrowest horizontal condense a fitted line may take before it wraps further. */
export const MIN_CONDENSE = 0.72;

/** Lines for a fixed-px text block, each with the horizontal squeeze it paints at. */
export interface FittedLines {
  readonly lines: readonly string[];
  /** Per line, ≤ 1 (1 = natural width). */
  readonly squeeze: readonly number[];
  /** False when even `MIN_CONDENSE` needs more than `maxLines` — the caller grows its box; no word is dropped. */
  readonly complete: boolean;
}

function greedyWrap(measure: TextMeasurer, words: readonly string[], budget: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure.measureText(next).width <= budget) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Fit a text at a FIXED px (a floored brand band — it may not shrink below
 * the station floor) into `maxLines` lines of `maxW` WITHOUT dropping a
 * word (fidelity wave 2, W1 residual 2: the 390 cloths wrapped "SAKURA PARK
 * LEAGUE" into three lines, cut to two, and silently lost "LEAGUE"). The
 * wrap budget widens in 4 % condense steps down to `minCondense`; the first
 * budget that holds every word in `maxLines` wins, and each line gets the
 * squeeze that brings it back inside `maxW`. When nothing fits, every word
 * is still returned (`complete: false`) so the caller grows the box
 * honestly.
 */
export function fitLinesCondensed(
  measure: TextMeasurer,
  text: string,
  maxW: number,
  maxLines: number,
  minCondense: number = MIN_CONDENSE,
): FittedLines {
  const words = text.split(/[ \t\r\n]+/).filter(Boolean);
  const squeezeOf = (lines: readonly string[]) =>
    lines.map((line) => {
      const width = measure.measureText(line).width;
      return width > maxW && width > 0 ? maxW / width : 1;
    });
  for (let s = 1; s >= minCondense - 1e-9; s -= 0.04) {
    const lines = greedyWrap(measure, words, maxW / Math.max(s, minCondense));
    if (lines.length <= maxLines) return { lines, squeeze: squeezeOf(lines), complete: true };
  }
  const lines = greedyWrap(measure, words, maxW / minCondense);
  return { lines, squeeze: squeezeOf(lines), complete: lines.length <= maxLines };
}

// ── Auto-fit, then ellipsis (fidelity wave 2) ─────────────────────

/** How a single line was fitted. */
export interface AutoFit {
  /** The px the line paints at (between the floor and the requested px). */
  readonly px: number;
  /** Horizontal condense (1 = natural; never under `MIN_CONDENSE`). */
  readonly squeeze: number;
  /** The text painted — the input, or its suffix-keeping ellipsis. */
  readonly text: string;
}

/**
 * The single-line fit order every painter follows (fidelity wave 2):
 * 1. shrink the requested px toward `minPx` (the station floor — never below);
 * 2. at the floor, condense horizontally down to `MIN_CONDENSE`;
 * 3. only then cut, with the suffix-keeping ellipsis, at that condense.
 * `setFont` applies a px to the measuring context (the painter's own
 * weight/family). The r5 painters ellipsized at the REQUESTED px (a 52 px
 * masthead cut to `…` while 13 px of headroom sat above the 39 px floor),
 * and a floored note lost its count (`… TAP THE WALL FOR A…`).
 */
export function autoFit(
  ctx: TextMeasurer,
  setFont: (px: number) => void,
  text: string,
  maxW: number,
  px: number,
  minPx: number,
): AutoFit {
  const top = Math.ceil(px);
  const floor = Math.min(top, Math.max(1, Math.ceil(minPx)));
  for (let size = top; size >= floor; size -= 1) {
    setFont(size);
    if (ctx.measureText(text).width <= maxW) return { px: size, squeeze: 1, text };
  }
  setFont(floor);
  const natural = ctx.measureText(text).width;
  if (natural * MIN_CONDENSE <= maxW) return { px: floor, squeeze: maxW / natural, text };
  return { px: floor, squeeze: MIN_CONDENSE, text: fitKeepingSuffix(ctx, text, maxW / MIN_CONDENSE) };
}

/** `autoFit` + paint (left-aligned at `x`) on a real 2D context. Returns the fit, for guards. */
export function paintAutoFit(
  ctx: CanvasRenderingContext2D,
  font: (px: number) => string,
  text: string,
  x: number,
  y: number,
  maxW: number,
  px: number,
  minPx: number,
): AutoFit {
  const fit = autoFit(
    ctx,
    (size) => {
      ctx.font = font(size);
    },
    text,
    maxW,
    px,
    minPx,
  );
  if (fit.squeeze === 1) {
    ctx.fillText(fit.text, x, y);
    return fit;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(fit.squeeze, 1);
  ctx.fillText(fit.text, 0, 0);
  ctx.restore();
  return fit;
}

// ── Readable accent ink (fidelity W1 r4 — salmon on tan/cream) ───

/** WCAG AAA: the ceiling an accent-coloured data row is darkened (or lightened) toward. */
export const ACCENT_ROW_TARGET_CONTRAST = 7;

function hexChannels(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function toHex(channels: readonly number[]): string {
  return `#${channels.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The contrast an accent row on `ground` must reach: the AAA ceiling, capped
 * at what the painter's own body `ink` achieves on that ground — an accent
 * row is never LESS readable than the plain rows beside it, and never asked
 * to beat an ink the judges already read.
 */
export function accentRowTarget(ground: string, ink: string): number {
  const inkRatio = contrastRatio(ink, ground);
  return Number.isFinite(inkRatio) ? Math.min(ACCENT_ROW_TARGET_CONTRAST, inkRatio) : ACCENT_ROW_TARGET_CONTRAST;
}

/**
 * An accent ink that READS on its ground (fidelity W1 r4): the light
 * mountain tan and sakura cream grounds carried the salmon/red accent rows
 * (`BELL vs COLE 9/17 18:00 · LIVE`, every RESULTS winner) well under the
 * body ink's contrast — nearly invisible at 390 once lit and tone-mapped.
 * The accent is darkened ALONG ITS HUE (channels scaled toward black; toward
 * white on a dark ground) in 2.5 % steps until it clears `accentRowTarget`,
 * so the row keeps its hue family at the smallest shift that passes. An
 * accent that already passes is returned unchanged; unparseable colours fall
 * back to `ink`, never to an unmeasured accent.
 *
 * Direction (fidelity W1 r5): the shift goes TOWARD THE BODY INK's side of
 * the ground — the ink the painter already reads on that ground. r4 picked
 * the side from the accent's texture-space luminance: the mountain wood
 * (#8a6f4d) is darker than its salmon accent, so the guard lifted the LIVE
 * and winner rows toward cream, and the LIT cloth then rendered far lighter
 * than its hex (≈ rgb 177,148,122), leaving cream on tan at ≈ 1.8:1 — below
 * the plain rows. A dark body ink on a light-to-mid ground always darkens
 * the accent; only a light ink (a dark slate field) lifts it.
 */
export function readableAccent(
  accent: string,
  ground: string,
  ink: string,
  emissions?: readonly number[],
): string {
  const a = hexChannels(accent);
  const groundL = relativeLuminance(ground);
  if (!a || Number.isNaN(groundL)) return ink;
  // Fidelity wave 2 (W1 residual 2): a self-lit face passes its emission
  // intensities and the guard measures the RENDERED pair (`renderedContrast`)
  // — r5's texture-space 7:1 LIVE row rendered 3.1:1 on the lit cream.
  const rendered = emissions !== undefined && emissions.length > 0;
  const ratio = (color: string) => (rendered ? renderedContrast(color, ground, emissions) : contrastRatio(color, ground));
  const target = rendered
    ? Math.min(RENDERED_ACCENT_TARGET, renderedContrast(ink, ground, emissions))
    : accentRowTarget(ground, ink);
  if (ratio(accent) >= target) return accent;
  const inkL = relativeLuminance(ink);
  const towardBlack = Number.isNaN(inkL) ? groundL >= relativeLuminance(accent) : inkL <= groundL;
  for (let step = 1; step <= 40; step += 1) {
    const t = step / 40;
    const shifted = toHex(a.map((c) => (towardBlack ? c * (1 - t) : c + (255 - c) * t)));
    if (ratio(shifted) >= target) return shifted;
  }
  return ink;
}

/**
 * The live row's underline under its last pair line (fidelity W1 r4): the
 * accent hue alone no longer carries "live" once the contrast guard darkens
 * it, so the row also gets a rule at the sign-stroke weight, clear of the
 * next line's ascent box. Returns the rect for the painter (and tests).
 */
export function liveUnderline(
  x: number,
  baselineY: number,
  width: number,
  px: number,
  stroke: number,
): GlyphRect {
  return { x, y: Math.round(baselineY + px * 0.12), w: Math.ceil(width), h: stroke };
}

// ── Suffix-keeping fit (fidelity W1 r4 — "09 GEODUDE-A…") ─────────

/** The ellipsis the painters truncate with. */
export const ELLIPSIS = '…';

/**
 * Fit a name into `maxW`, cutting from the MIDDLE so the distinguishing
 * tail survives. The r3 clouds sail ellipsized `GEODUDE-ALOLA` to
 * `GEODUDE-A…` — exactly the part that told line 09 from line 08's
 * `GEODUDE`. The tail is derived from the data: everything from the last
 * hyphen (a regional/form suffix) is kept whole and the head is shortened
 * (`GEOD…-ALOLA`); a name with no hyphen, or whose tail alone overflows,
 * falls back to the plain end ellipsis. Returns the text to paint (the
 * input unchanged when it fits). Never hardcodes a name.
 */
export function fitKeepingSuffix(measure: TextMeasurer, text: string, maxW: number): string {
  if (measure.measureText(text).width <= maxW) return text;
  const cut = text.lastIndexOf('-');
  if (cut > 0 && cut < text.length - 1) {
    const tail = text.slice(cut);
    const head = text.slice(0, cut);
    for (let end = head.length - 1; end >= 1; end -= 1) {
      const candidate = `${head.slice(0, end)}${ELLIPSIS}${tail}`;
      if (measure.measureText(candidate).width <= maxW) return candidate;
    }
  }
  let end = text.length;
  while (end > 1 && measure.measureText(`${text.slice(0, end)}${ELLIPSIS}`).width > maxW) end -= 1;
  return `${text.slice(0, end)}${ELLIPSIS}`;
}

// ── Rendered-ground contrast (fidelity wave 2 — W1 residual 2) ────

/** WCAG AA for body text — the lint floor every painted data line clears. */
export const MIN_TEXT_CONTRAST = 4.5;

/** WCAG large-text floor (≥ 24 px, or ≥ 18.66 px bold, ON SCREEN) — never the goal, only the veto line. */
export const LARGE_TEXT_CONTRAST = 3;

/**
 * The rendered contrast an accent row is pushed to on a self-lit face: AA
 * plus a 0.5 margin for what the model leaves out (SMAA edge blends, the
 * vignette's falloff), capped at the body ink's own rendered contrast.
 */
export const RENDERED_ACCENT_TARGET = 5;

/**
 * Bloom veil: the scene-linear light the composer's Bloom scatters over a
 * bright face, added to BOTH the ink and the ground (it always lowers the
 * ratio, so the model errs on the unreadable side). Calibrated on the r5
 * still `r5-w1-sakura-light-schedule-1440.png`: the model with this veil
 * puts the white-on-salmon footer at ≈ 2.6:1 against the measured 2.57:1.
 */
export const BLOOM_VEIL = 0.02;

type Rgb = [number, number, number];

/** GLSL `mat3(c0, c1, c2) * v` — the matrices below are written column-major, as in three's shader chunk. */
function mulColumns(c0: Rgb, c1: Rgb, c2: Rgb, v: Rgb): Rgb {
  return [
    c0[0] * v[0] + c1[0] * v[1] + c2[0] * v[2],
    c0[1] * v[0] + c1[1] * v[1] + c2[1] * v[2],
    c0[2] * v[0] + c1[2] * v[1] + c2[2] * v[2],
  ];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

function mapRgb(c: Rgb, f: (x: number) => number): Rgb {
  return [f(c[0]), f(c[1]), f(c[2])];
}

/**
 * three.js `AgXToneMapping` (the shader chunk postprocessing's
 * `ToneMappingMode.AGX` runs in the route's PostStack), ported verbatim:
 * linear sRGB in, linear sRGB out.
 */
function agxToneMap(color: Rgb, exposure: number): Rgb {
  const MIN_EV = -12.47393;
  const MAX_EV = 4.026069;
  let c = mapRgb(color, (x) => x * exposure);
  c = mulColumns([0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956], c);
  c = mulColumns(
    [0.856627153315983, 0.137318972929847, 0.11189821299995],
    [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
    [0.0482516061458583, 0.101439036467562, 0.811302368396859],
    c,
  );
  c = mapRgb(c, (x) => {
    const e = Math.min(1, Math.max(0, (Math.log2(Math.max(x, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV)));
    const e2 = e * e;
    const e4 = e2 * e2;
    return 15.5 * e4 * e2 - 40.14 * e4 * e + 31.96 * e4 - 6.868 * e2 * e + 0.4298 * e2 + 0.1191 * e - 0.00232;
  });
  c = mulColumns(
    [1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
    [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
    [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
    c,
  );
  c = mapRgb(c, (x) => Math.max(0, x) ** 2.2);
  c = mulColumns([1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187], c);
  return mapRgb(c, (x) => Math.min(1, Math.max(0, x)));
}

/**
 * The colour a painted texel of a SELF-LIT data face renders at (fidelity
 * wave 2 — the r4/r5 failed approach was choosing ink in texture space):
 * the face's material is black with `emissiveMap = texture` at
 * `emissiveIntensity = emission`, so its scene-linear radiance is the
 * texel × emission, which the composer's AgX grades to the screen. Pure
 * model — disclosed limits: no Bloom (see `BLOOM_VEIL`), no vignette, no
 * SMAA, no fog (the data faces run `fog: false`), and the post-off rung's
 * ACES path is not modelled (AgX is the darker grade on these inks).
 * Checked against the r5 stills: white × 0.95 → 200 (measured 201).
 */
export function displayColor(color: string, emission: number, exposure: number = 1): string {
  const ch = hexChannels(color);
  if (!ch) return color;
  const lin = mapRgb(ch, (c) => srgbToLinear(c) * emission);
  return toHex(mapRgb(agxToneMap(lin, exposure), linearToSrgb));
}

/**
 * The WORST rendered contrast of `ink` on `ground` over a face's emission
 * intensities (day and night — a painter that cannot see the theme passes
 * both), with the bloom veil on both. An unparseable colour returns 1
 * (never a pass).
 */
export function renderedContrast(
  ink: string,
  ground: string,
  emissions: readonly number[],
  veil: number = BLOOM_VEIL,
): number {
  let worst = Infinity;
  for (const e of emissions) {
    const li = relativeLuminance(displayColor(ink, e));
    const lg = relativeLuminance(displayColor(ground, e));
    if (Number.isNaN(li) || Number.isNaN(lg)) return 1;
    worst = Math.min(worst, (Math.max(li, lg) + veil + 0.05) / (Math.min(li, lg) + veil + 0.05));
  }
  return Number.isFinite(worst) ? worst : 1;
}

/** The candidate with the best worst-case RENDERED contrast on `ground` (first wins ties). */
export function bestRenderedInk(
  ground: string,
  candidates: readonly string[],
  emissions: readonly number[],
): { ink: string; ratio: number } {
  let best = { ink: candidates[0] ?? '#000000', ratio: -1 };
  for (const candidate of candidates) {
    const ratio = renderedContrast(candidate, ground, emissions);
    if (ratio > best.ratio) best = { ink: candidate, ratio };
  }
  return best;
}

/** A band ground and its ink, chosen together on the rendered face. */
export interface RenderedBand {
  readonly band: string;
  readonly ink: string;
  readonly ratio: number;
}

/**
 * A brand band whose word READS once lit and graded (fidelity wave 2, W1
 * residual 2 — the sakura cloth footer: white won in texture space on the
 * salmon band and rendered grey-on-salmon at 2.5:1). First the best ink on
 * the band as authored; if that misses `target` at any emission, the BAND
 * shifts along its hue (toward black, then toward white, in 2.5 % steps,
 * the smaller shift winning) until some ink clears it — the band stays in
 * its colour family and the word is never left under the floor silently.
 * When no shift reaches `target` the best pair found is returned and its
 * ratio says so (the lint test fails on it).
 */
export function readableRenderedBand(
  band: string,
  candidates: readonly string[],
  emissions: readonly number[],
  target: number = MIN_TEXT_CONTRAST,
): RenderedBand {
  const first = bestRenderedInk(band, candidates, emissions);
  let best: RenderedBand = { band, ink: first.ink, ratio: first.ratio };
  if (first.ratio >= target) return best;
  const ch = hexChannels(band);
  if (!ch) return best;
  for (let step = 1; step <= 40; step += 1) {
    const t = step / 40;
    for (const towardBlack of [true, false]) {
      const shifted = toHex(ch.map((c) => (towardBlack ? c * (1 - t) : c + (255 - c) * t)));
      const pick = bestRenderedInk(shifted, candidates, emissions);
      if (pick.ratio >= target) return { band: shifted, ink: pick.ink, ratio: pick.ratio };
      if (pick.ratio > best.ratio) best = { band: shifted, ink: pick.ink, ratio: pick.ratio };
    }
  }
  return best;
}

/**
 * An `rgba(r, g, b, a)` / `#hex` ink flattened over an opaque `ground` (the
 * colour the texel actually holds). Hex inks pass through; an unparseable
 * ink returns itself (and then fails every contrast check).
 */
export function compositeOver(color: string, ground: string): string {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color.trim());
  if (!m) return color;
  const g = hexChannels(ground);
  if (!g) return color;
  const a = m[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(m[4])));
  const src = [Number(m[1]), Number(m[2]), Number(m[3])];
  return toHex(src.map((c, i) => c * a + g[i] * (1 - a)));
}

/**
 * A face GROUND every one of its text inks reads on once rendered
 * (fidelity wave 2 contrast lint): the ground is shifted along its hue away
 * from the inks (toward black under light inks, toward white under dark
 * ones) in 2.5 % steps until the weakest ink — rgba inks flattened over the
 * candidate ground — clears `target` at every emission. The authored ground
 * is kept whenever it already passes. Used on the self-lit faces whose inks
 * the r5 renders put under AA (the mountain wood and register stone, the
 * sakura jumbotron teal).
 */
export function readableGround(
  ground: string,
  inks: readonly string[],
  emissions: readonly number[],
  target: number = MIN_TEXT_CONTRAST,
): string {
  const g = hexChannels(ground);
  if (!g || inks.length === 0) return ground;
  const weakest = (candidate: string) =>
    Math.min(...inks.map((ink) => renderedContrast(compositeOver(ink, candidate), candidate, emissions)));
  if (weakest(ground) >= target) return ground;
  const groundL = relativeLuminance(ground);
  const lightInks = inks.filter((ink) => relativeLuminance(compositeOver(ink, ground)) > groundL).length;
  const towardBlack = lightInks * 2 >= inks.length;
  let best = { ground, ratio: weakest(ground) };
  for (let step = 1; step <= 40; step += 1) {
    const t = step / 40;
    const shifted = toHex(g.map((c) => (towardBlack ? c * (1 - t) : c + (255 - c) * t)));
    const ratio = weakest(shifted);
    if (ratio >= target) return shifted;
    if (ratio > best.ratio) best = { ground: shifted, ratio };
  }
  return best.ground;
}

/** `#rrggbb` + alpha → `rgba(…)` (for inks derived from a resolved hex). */
export function inkAlpha(color: string, alpha: number): string {
  const ch = hexChannels(color);
  if (!ch) return color;
  return `rgba(${ch[0]}, ${ch[1]}, ${ch[2]}, ${alpha})`;
}

/**
 * A self-lit dark LED board's palette resolved against its RENDERED face
 * (fidelity wave 2 contrast lint): the field darkens along its hue until
 * the body ink and every translucent `extraInks` line clear 4.5:1 at all
 * `emissions`, then the accent (used as ink for ranks, kickers, points and
 * as the LIVE pill's fill under field-coloured text) lifts along its hue
 * to `RENDERED_ACCENT_TARGET`. A palette that already passes comes back
 * unchanged, so the night boards keep their authored colours.
 */
export function readableFace<T extends { readonly field: string; readonly accent: string; readonly ink: string }>(
  colors: T,
  extraInks: readonly string[],
  emissions: readonly number[],
): T {
  const field = readableGround(colors.field, [colors.ink, ...extraInks], emissions);
  const accent = readableAccent(colors.accent, field, colors.ink, emissions);
  return { ...colors, field, accent };
}

// ── Umlauts (fidelity wave 2 — ÄÖÜ glyph check) ──────────────────

/**
 * Top of a capital carrying a diaeresis (Ä Ö Ü) above its baseline, in em.
 * Disclosed approximation for system-ui / Segoe UI: cap height ≈ 0.70 em
 * plus the dots ≈ 0.20 em; 0.92 keeps a 0.02 em hairline of margin.
 */
export const UMLAUT_CAP_TOP_EM = 0.92;

/**
 * True when a line painted at `belowPx`, `stepPx` under a line at
 * `abovePx`, keeps its umlaut dots clear of the upper line's descenders
 * (`GÜNSTIG` under `MITTEL`): the step minus the upper descent must hold
 * the dotted cap.
 */
export function umlautClears(stepPx: number, abovePx: number, belowPx: number): boolean {
  return stepPx - abovePx * DESCENT_EM >= belowPx * UMLAUT_CAP_TOP_EM;
}

// ── Pairings and roster notes (fidelity wave 2) ──────────────────

/**
 * `WELLS vs AY` with no-break spaces — the cloth form of a live pairing
 * (fidelity wave 2, W1 residual 2). On the narrow 390 cloths the rect dash
 * between two names read as `=` (`BELL = COLE`); the fixture rows above the
 * footer already say `vs`, so the footer's pairing now matches them. The
 * dashed `livePair` stays for the wide masthead pills.
 */
export function liveMatchPair(home: string, away: string): string {
  return `${home}${NBSP}vs${NBSP}${away}`;
}

/** What surface the visitor taps for the full roster list. */
export type RosterSurface = 'WALL' | 'SAIL';

/**
 * The roster frieze note once the full-list panel exists (`?board=roster`,
 * seat 2D, same merge train): honest about the painted count, and it
 * promises exactly what a tap now opens — every line. In the viewer's
 * language (`paint.rosterNote`): "9 OF 30 LINES · TAP THE WALL FOR ALL 30" /
 * "9 VON 30 · TIPPE FÜR ALLE 30 LINIEN".
 */
export function rosterTapNote(
  shown: number,
  total: number,
  locale: PaintLocale,
  surface: RosterSurface = 'WALL',
): string {
  const counted = total > shown;
  const params = { shown: String(shown), total: String(total) };
  if (surface === 'SAIL') {
    return counted ? paintCaps(locale, 'rosterNote.tapSailCounted', params) : paintCaps(locale, 'rosterNote.tapSail', params);
  }
  return counted ? paintCaps(locale, 'rosterNote.tapWallCounted', params) : paintCaps(locale, 'rosterNote.tapWall', params);
}

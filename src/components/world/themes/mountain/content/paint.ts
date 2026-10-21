import type { BoardContent, BoardFixtureStatus } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { Locale } from '@/i18n/config';
import { upperForPaint } from '@/i18n/core';
import type { FormatRules } from '@/types/format-rules';
import type { RulesCopyContext } from '@/components/world/sections/types';
import type { WorldRosterTile } from '@/lib/worlds/route-data';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  linePillExtra,
  liveMatchPair,
  livePair,
  readableRenderedBand,
  rosterTapNote,
  boardRowHeadline,
  indexGutter,
  lineStep,
  liveUnderline,
  paintDashPair,
  paintDashedLine,
  boardRowTexts,
  dashedLineWidth,
  paintAutoFit,
  paintKickerLine,
  readableFace,
  readableGround,
  paintSignedNumber,
  priceBandLabel,
  readableAccent,
  signStrokePx,
  stackStep,
  TEXT_BOX_ASCENT_EM,
  TEXT_BOX_DESCENT_EM,
  wrapFields,
  type BoardRow,
} from '@/lib/route-world/board-text';
import {
  hasLivePill,
  isLiveFixture,
  kickoffLine,
  leagueStamp,
  livePillWord,
  paintText,
  rosterBandLine,
  rosterTileName,
  stageMatchdayLine,
  standingDetail,
  statusPill,
  themePlaqueCopy,
} from '../../paint-copy';

/**
 * Canvas painters for the Mountain Pass content surfaces — the summit
 * standings board, the trail-sign row, the register lodge roster wall, the
 * pass-gate plaque and the cairn name plates. Pure 2D, no React and no
 * three imports (the furniture mounts the results through
 * `./use-painted-texture.ts`, whose board-page hook routes every page through
 * the engine's shared `paintBoardPage` clamp). Every word painted here
 * follows the viewer (i18n D11): it comes from the `world-themes` namespace
 * through `../../paint-copy` in the `locale` the mount passes (`useLocale()`,
 * read before the texture is built), and the typed board status words are
 * translated at this boundary.
 *
 * C-105 r1 font floors: every painter signature carries the shared path's
 * `tools` and EVERY font px literal routes through `tools.fontPx` — the clamp
 * (station pose-derived, painter-space) decides what ships. Layout was
 * re-spaced to the floored px (summit 43, register 50, cairn plaque 158,
 * trail sign 60, pass plaque 59 painter px); canvas constants are unchanged.
 */

const FONT = "system-ui, 'Segoe UI', sans-serif";

/** Summit board face — 16:9, matches the board's face. */
export const BOARD_TEX_W = 1280;
export const BOARD_TEX_H = 720;

/** One trail sign face — 1:3 portrait board. */
export const SIGN_TEX_W = 320;
export const SIGN_TEX_H = 960;

/** The register wall's roster frieze — 12:5 band on the 6.6 m lodge's 5.6 m
 *  frieze face (friezeW; the lodge itself is the 6.6 m face). */
export const ROSTER_TEX_W = 1536;
export const ROSTER_TEX_H = 640;

/** Pass-gate plaque face — 5:2 landscape board (r4: resized for the 21.4 m
 * station pose — the r3 5:7 portrait card measured ~11 % of the frame width
 * and its text could not read; the plaza arch frieze is the scale reference). */
export const PLAQUE_TEX_W = 1280;
export const PLAQUE_TEX_H = 512;

/** The cairn pedestal's name plate face — 1024:176. C-103 r1: the canvas
 * grew with the PHYSICAL face (Statuary.tsx 0.62 → 1.4 m, the C-102 r2
 * measured fix for this identical teams geometry) — the floor-width law:
 * canvas growth alone raises the painter floor with it; only the face width
 * buys absolute room for the longest real trainer name. */
export const ACE_PLAQUE_TEX_W = 1024;
export const ACE_PLAQUE_TEX_H = 176;

/** The typed status as its painted pill (`OPEN` / `LIVE` / `FT`) — never painted raw. */
export function statusWord(status: BoardFixtureStatus, locale: Locale = 'en'): string {
  return statusPill(status, locale);
}

/**
 * The point-buy price group as painted (fidelity W1 locale leak): the tile's
 * `band` arrives as the league's storage key (`guenstig`, `hoch`, `mittel` …),
 * and the frieze once painted it raw ("10 PTS GUENSTIG"). Translated at this
 * boundary through the shared `priceBandLabel` (board-text.ts — one word
 * table for every world); an unknown key passes through upper-cased.
 */
export function priceBandWord(band: string, locale: Locale = 'en'): string {
  return priceBandLabel(band, locale);
}

/**
 * Footer ticker for the summit board, shaped locally from the content's own
 * fields in the viewer's language. Fidelity W1 r3: the shared ticker order
 * (board-text.ts) — a past `next` beside a LIVE row is never painted as the
 * next kickoff.
 */
export function mountainKickoffStamp(content: BoardContent, nowMs: number = Date.now(), locale: Locale = 'en'): string {
  return leagueStamp(content, nowMs, locale);
}

/**
 * The authored stand-in for a standings screen whose season has no results yet
 * — the pass's boards never go blank, and the copy says what the league is
 * waiting for (the plaza `paintEmptyState` discipline, translated at this
 * boundary like the stamp above). `null` once the table has its first row, so
 * the caller cannot paint a stale placeholder over real standings.
 *
 * The copy is one short line on purpose: at the summit station's 43 px floor a
 * longer sentence ellipsizes inside the placeholder box, and the trainer count
 * it would have carried is already on the footer stamp.
 */
export function standingsEmptyState(
  content: BoardContent,
  locale: Locale = 'en',
): { headline: string; copy: string } | null {
  if (content.table.length > 0) return null;
  return {
    headline: paintText(locale, 'empty.noTable'),
    copy: paintText(locale, 'empty.formsPass'),
  };
}

/** The empty state's box: the table region between masthead and footer band. */
const STANDINGS_EMPTY_BOX = { x: 120, y: 258, h: 300 } as const;

/**
 * Dashed placeholder card + two centred lines, drawn in the table region.
 * Every px goes through `tools.fontPx`, so the pose-derived floor applies to
 * the placeholder exactly as it does to real rows — an empty board is still
 * read from the same station pose.
 */
function paintStandingsEmpty(
  ctx: CanvasRenderingContext2D,
  w: number,
  box: { x: number; y: number; h: number },
  colors: { accent: string; ink: string },
  tools: BoardPaintTools,
  copy: { headline: string; copy: string } | null,
): void {
  if (!copy) return;
  const boxW = w - box.x * 2;

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  roundRect(ctx, box.x, box.y, boxW, box.h, 14);
  ctx.fill();
  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = colors.accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  roundRect(ctx, box.x, box.y, boxW, box.h, 14);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.accent;
  ctx.font = `800 ${tools.fontPx(50)}px ${FONT}`;
  ctx.fillText(copy.headline, w / 2, box.y + 124);
  ctx.fillStyle = colors.ink;
  ctx.font = `600 ${tools.fontPx(34)}px ${FONT}`;
  fillTextFitted(ctx, copy.copy, w / 2, box.y + 212, boxW - 80);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Greedy word-wrap against the clamp-sized font — used by the big-plaque painters. */
function wrapWords(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/** Truncate-to-fit with an ellipsis — the clamp's px leave no room for overlap. */
function fillTextFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
): void {
  if (ctx.measureText(text).width <= maxW) {
    ctx.fillText(text, x, y);
    return;
  }
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxW) end -= 1;
  ctx.fillText(`${text.slice(0, end)}…`, x, y);
}

/** Masthead sizes the ruleset of record steps through before it ellipsizes. */
const RULESET_MASTHEAD_PX = [96, 80, 64] as const;

/**
 * The plaque's ruleset of record on its one masthead line, inside the inner
 * frame (`maxW`): at 96 px when it fits — exactly the old call, so every
 * name that fit paints byte-identically — else at the first smaller step
 * that fits, else ellipsized at the smallest. The old unbounded call cut a
 * 20-odd-character name at both texture edges (PR #65 test pass, 5A-7).
 */
function fillRulesetMasthead(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  tools: BoardPaintTools,
): void {
  for (const px of RULESET_MASTHEAD_PX) {
    ctx.font = `800 ${tools.fontPx(px)}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) {
      ctx.fillText(text, x, y);
      return;
    }
  }
  fillTextFitted(ctx, text, x, y, maxW);
}

/**
 * `Second Half` → `2ND HALF` (the stage word in the summit kicker's short
 * form); German halves read `HINRUNDE` / `RÜCKRUNDE`.
 */
export function shortStageLabel(stage: string, locale: Locale = 'en'): string {
  const trimmed = stage.trim();
  if (/^(first half|hinrunde)$/i.test(trimmed)) return paintText(locale, 'firstHalf');
  if (/^(second half|rückrunde)$/i.test(trimmed)) return paintText(locale, 'secondHalf');
  return upperForPaint(trimmed, locale);
}

/**
 * The summit kicker's two runs (fidelity W1 r2 — the r1 board lost its
 * brand whenever a LIVE pill shared the band). Tiers, first that fits:
 * 1. `SUMMIT STANDINGS · SECOND HALF · MATCHDAY 2`;
 * 2. `SUMMIT STANDINGS · MD 2 · 2ND HALF` (short detail);
 * 3. `STANDINGS · MD 2 · 2ND HALF` (short brand — it still names the board);
 * 4. the full pair, which `paintKickerLine` resolves by dropping the brand
 *    and keeping the data line whole.
 */
export function summitKickerRuns(
  ctx: Pick<CanvasRenderingContext2D, 'measureText' | 'font'>,
  content: Pick<BoardContent, 'stage' | 'round'>,
  brandFont: string,
  detailFont: string,
  maxW: number,
  locale: Locale = 'en',
): { brand: string; detail: string } {
  const full = stageMatchdayLine(content.stage, content.round, locale);
  const short = `${paintText(locale, 'matchdayShort', { n: content.round })} · ${shortStageLabel(content.stage, locale)}`;
  const brand = paintText(locale, 'brand.summit');
  const brandShort = paintText(locale, 'brand.summitShort');
  const tiers: { brand: string; detail: string }[] = [
    { brand, detail: full },
    { brand, detail: short },
    { brand: brandShort, detail: short },
  ];
  for (const tier of tiers) {
    ctx.font = brandFont;
    const brandW = ctx.measureText(`${tier.brand} · `).width;
    ctx.font = detailFont;
    if (brandW + ctx.measureText(tier.detail).width <= maxW) return tier;
  }
  return { brand, detail: full };
}

/**
 * The summit board: a slate field with the league masthead, the
 * top-of-the-table standings rows (rank movement included) and the footer
 * ticker strip. Content comes from `buildBoardContent(data, locale)` —
 * nothing here invents data. Standings live on the summit plaques, the
 * valley's diegetic announcements board. Re-spaced for the pulse station's
 * 43 px painter floor (C-105 r1): the name column moved right of the 43 px
 * movement glyphs and the footer strip grown to carry 43 px text.
 */
/** Painter y below which the sill course occludes the summit face (≈ 44 px of 720). */
export const SUMMIT_SILL_LIP_Y = 676;

/** Clear air under the footer's descenders, above the sill lip, in em (fidelity W1 r4). */
export const SUMMIT_FOOTER_AIR_EM = 0.6;

/**
 * The summit footer band from the px actually painted: the baseline sits so
 * the descent (0.2 em) plus `SUMMIT_FOOTER_AIR_EM` clears the sill lip, and
 * the strip opens one ascent box (+ 4 px) above it.
 */
export function summitFooterLayout(footerPx: number): { baseline: number; stripTop: number } {
  const baseline = Math.floor(SUMMIT_SILL_LIP_Y - footerPx * (0.2 + SUMMIT_FOOTER_AIR_EM));
  const stripTop = Math.floor(baseline - footerPx * TEXT_BOX_ASCENT_EM - 4);
  return { baseline, stripTop };
}

/** The summit masthead's kicker baseline (fidelity W1 r4 moved it 74 → 52). */
export const SUMMIT_KICKER_Y = 52;
/** Clear air between the LIVE pill's rect and the league title's glyph box (painter px). */
export const SUMMIT_PILL_TITLE_GAP = 6;

/** A painter-space rect. */
export interface PaintRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The summit board's emission intensities, day and night — SummitCairn.tsx
 * (`emissiveIntensity={night ? 0.92 : 1.0}`, black base). Kept in step by
 * hand until the mount imports it (hand-off to its owner).
 */
export const SUMMIT_EMISSION: readonly number[] = [0.92, 1.0];

/** The summit board's translucent text inks (kicker detail, header/cells) — linted with the body ink. */
const SUMMIT_TEXT_INKS: readonly string[] = ['rgba(240, 246, 244, 0.75)', 'rgba(240, 246, 244, 0.85)'];

/**
 * The summit masthead from the px actually painted (fidelity W1 r5). The r4
 * stack moved the kicker 74 → 52 and the league floor 138 → 112, but the
 * LIVE pill stayed at its fixed y 20..78 band, so the title's `)` touched
 * the pill at every floor. The pill is now DERIVED from the kicker: its
 * label shares the kicker baseline (one top row: kicker left, pill right)
 * and the rect wraps the label's 0.8/0.2 em glyph box plus `pad`. When the
 * title's glyph box still reaches up into the pill band (a floor above
 * 43 px), the title's width budget stops `gutter` short of the pill (honest
 * end ellipsis) — the two never intersect. Before that, the pill's baseline
 * may lift a few px off the kicker's so the title keeps its full width
 * (43 px floor: 52 → 49). Pure: `labelW` is the measured
 * pill label, and the caller paints.
 */
export function summitMastheadLayout(
  w: number,
  kickerPx: number,
  leaguePx: number,
  labelPx: number,
  labelW: number | null,
): {
  kickerY: number;
  leagueY: number;
  pill: (PaintRect & { baseline: number }) | null;
  titleMaxW: number;
} {
  const kickerY = SUMMIT_KICKER_Y;
  const leagueY = Math.max(112, kickerY + stackStep(kickerPx, leaguePx));
  const fullTitleW = w - 112;
  if (labelW === null) return { kickerY, leagueY, pill: null, titleMaxW: fullTitleW };
  const pad = Math.max(6, Math.round(labelPx * 0.14));
  const pillW = Math.min(Math.max(Math.ceil(labelW) + 36, 304), w - 36);
  const pillX = w - 18 - pillW;
  const titleTop = leagueY - leaguePx * 0.8;
  // The kicker baseline, lifted only as far as the title's glyph box needs
  // (≤ a few px at the 43–48 px floors), never above the frame's top 4 px.
  const cleared = Math.floor(titleTop - SUMMIT_PILL_TITLE_GAP - labelPx * 0.2 - pad);
  const highest = Math.ceil(4 + pad + labelPx * 0.8);
  const baseline = Math.max(highest, Math.min(kickerY, cleared));
  const top = Math.floor(baseline - labelPx * 0.8 - pad);
  const bottom = Math.ceil(baseline + labelPx * 0.2 + pad);
  const pill = { x: pillX, y: top, w: pillW, h: bottom - top, baseline };
  const clearsVertically = bottom + SUMMIT_PILL_TITLE_GAP <= titleTop;
  const titleMaxW = clearsVertically ? fullTitleW : Math.min(fullTitleW, pillX - 24 - 56);
  return { kickerY, leagueY, pill, titleMaxW };
}

export function paintSummitBoard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  content: BoardContent,
  colors: { field: string; accent: string; ink: string },
  tools: BoardPaintTools,
  locale: Locale = 'en',
): void {
  // Fidelity wave 2 contrast lint: the palette is resolved against the
  // RENDERED face (`readableFace` — self-lit black base × {emissions},
  // AgX-graded): the field darkens until every text ink clears 4.5:1 and the
  // accent lifts to 5:1. The r5 renders put the day orange ranks/points at ≈ 3.9:1. A palette that already
  // passes is returned unchanged.
  colors = readableFace(colors, SUMMIT_TEXT_INKS, SUMMIT_EMISSION);
  ctx.fillStyle = colors.field;
  ctx.fillRect(0, 0, w, h);

  // Faint grain — blasted slate, not a poster.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 1);

  // Masthead (fidelity W1, audit issue 8 — measured leading): the stage line
  // used to ride its own baseline (186) 34 px above the table header (220)
  // at the 43 px floor, so the subtitle collided with the header row. It now
  // shares the kicker baseline (`paintKickerLine`), and every baseline below
  // is STACKED from the px actually painted (`stackStep`, ≥ 1.2 line boxes):
  // kicker 74 → league → header → rows. The LIVE pill keeps its top-right
  // band; the kicker's budget stops short of it (the brand drops first).
  const kickerPx = tools.fontPx(30);
  const leaguePx = tools.fontPx(52);
  const headerPx = tools.fontPx(27);
  const rowPx = tools.fontPx(30);
  // Fidelity W1 r4: the stack starts 26 px higher (kicker 74 → 52, league
  // floor 138 → 112) so the footer can sit ≥ 0.6 em above the sill lip —
  // the r3 footer's descenders touched the bezel. At the 43 px floor all
  // eight rows still fit (row 8 at 583, strip from 598, footer at 641).
  const pillPx = tools.fontPx(26);
  const pillLabel = content.live
    ? paintText(locale, 'livePill', { home: content.live.home, away: content.live.away })
    : null;
  ctx.font = `800 ${pillPx}px ${FONT}`;
  // Fidelity W1 r5: kicker, pill and title from ONE layout (`summitMastheadLayout`).
  const masthead = summitMastheadLayout(
    w,
    kickerPx,
    leaguePx,
    pillPx,
    pillLabel === null ? null : ctx.measureText(pillLabel).width,
  );
  const { kickerY, leagueY } = masthead;
  const footerPx = tools.fontPx(26);
  const footer = summitFooterLayout(footerPx);
  const headerY = leagueY + stackStep(leaguePx, headerPx);

  let kickerRight = w - 56;
  if (masthead.pill && pillLabel !== null) {
    // Pill on the kicker's top row, width RE-DERIVED from the MEASURED label
    // at the floored px (the C-102 r3 pill law: the fixed 248 px pill
    // ellipsized every real pair). Its rect and baseline come from the
    // kicker baseline (`summitMastheadLayout`); r4 left it at a fixed
    // y 20..78 after the stack moved up, and the title's ")" touched it.
    const pill = masthead.pill;
    ctx.fillStyle = colors.accent;
    roundRect(ctx, pill.x, pill.y, pill.w, pill.h, 10);
    ctx.fill();
    ctx.fillStyle = colors.field;
    fillTextFitted(ctx, pillLabel, pill.x + 18, pill.baseline, pill.w - 36);
    kickerRight = pill.x - 24;
  }
  // Fidelity W1 r2: the LIVE pill's band left no room for the brand beside
  // the full stage line, so the board lost "SUMMIT STANDINGS". The detail
  // now steps down to its short form ("MD 2 · 2ND HALF"), then the brand to
  // "STANDINGS", before the brand is dropped (`summitKickerRuns`).
  const brandFont = `800 ${kickerPx}px ${FONT}`;
  const detailFont = `600 ${kickerPx}px ${FONT}`;
  const kicker = summitKickerRuns(ctx, content, brandFont, detailFont, kickerRight - 56, locale);
  paintKickerLine(
    ctx,
    { text: kicker.brand, font: brandFont, color: colors.accent },
    {
      text: kicker.detail,
      font: detailFont,
      color: 'rgba(240, 246, 244, 0.75)',
    },
    56,
    kickerY,
    kickerRight - 56,
    fillTextFitted,
  );
  ctx.fillStyle = colors.ink;
  ctx.font = `700 ${leaguePx}px ${FONT}`;
  fillTextFitted(ctx, upperForPaint(content.league, locale), 56, leagueY, masthead.titleMaxW);

  // Table header + rows, stacked from the masthead at ≥ 1.2 line boxes: at
  // the 43 px floor header 167, row 1 219, pitch 52, row 8 583 — clear of the
  // footer strip (598, `summitFooterLayout`), whose text rides ≥ 0.6 em ABOVE
  // the sill's ≈44 px occlusion band at the face's bottom edge. A floor
  // that no longer fits eight rows drops the lowest rows, never the leading.
  const rowH = Math.max(50, lineStep(rowPx));
  const rowStart = headerY + stackStep(headerPx, rowPx);
  const rowLimit = footer.stripTop - Math.ceil(rowPx * TEXT_BOX_DESCENT_EM) - 2;
  const rowCap = Math.max(0, Math.min(8, Math.floor((rowLimit - rowStart) / rowH) + 1));
  const rows = content.table.slice(0, rowCap);
  // Carved rust rule under the header row, like a trail-sign band.
  ctx.fillStyle = 'rgba(232, 134, 46, 0.16)';
  ctx.fillRect(0, headerY + 10, w, 6);
  if (content.table.length === 0) {
    paintStandingsEmpty(ctx, w, STANDINGS_EMPTY_BOX, colors, tools, standingsEmptyState(content, locale));
  } else {
    ctx.font = `800 ${headerPx}px ${FONT}`;
    ctx.fillStyle = 'rgba(240, 246, 244, 0.85)';
    ctx.fillText('#', 56, headerY);
    ctx.fillText(paintText(locale, 'table.trainer'), 176, headerY);
    // Fidelity W1 r4: the dash is a rect at the sign-stroke floor (board-text).
    paintDashPair(
      ctx,
      paintText(locale, 'table.win'),
      paintText(locale, 'table.loss'),
      w - 352,
      headerY,
      headerPx,
      signStrokePx(headerPx, tools.fontFloorPx),
    );
    ctx.fillText(paintText(locale, 'table.diff'), w - 236, headerY);
    ctx.fillText(paintText(locale, 'table.points'), w - 120, headerY);

    rows.forEach((row, i) => {
      const y = rowStart + i * rowH;
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(48, y - 35, w - 96, rowH - 6);
      }
      ctx.fillStyle = i < 4 ? colors.accent : colors.ink;
      ctx.font = `800 ${tools.fontPx(28)}px ${FONT}`;
      ctx.fillText(String(i + 1), 56, y);
      ctx.fillStyle = colors.ink;
      ctx.font = `700 ${tools.fontPx(30)}px ${FONT}`;
      // Name column at 176: the 43 px movement glyphs (▲12 ≈ 74 px from x=96)
      // end at ≈170 — the old 120 px column collided at the floor.
      fillTextFitted(ctx, row.name, 176, y, w - 352 - 176 - 24);
      // Rank movement glyph: ▲▼· — the contract's rankChange, painted.
      if (row.rankChange !== null && row.rankChange !== 0) {
        ctx.fillStyle = row.rankChange > 0 ? '#8fd6a4' : '#f0876f';
        ctx.font = `800 ${tools.fontPx(24)}px ${FONT}`;
        ctx.fillText(row.rankChange > 0 ? `▲${row.rankChange}` : `▼${-row.rankChange}`, 96, y - 4);
      }
      ctx.font = `600 ${tools.fontPx(28)}px ${FONT}`;
      ctx.fillStyle = 'rgba(240, 246, 244, 0.85)';
      // Fidelity W1 r4: the W–L dash and the DIFF sign are painted as rects at
      // the sign-stroke floor — the font's own `+` minified into `−` and its
      // en dash vanished on the 390 stills (`3–2 +2` read `3 2 −2`).
      const cellPx = tools.fontPx(28);
      const signStroke = signStrokePx(cellPx, tools.fontFloorPx);
      paintDashPair(ctx, String(row.wins), String(row.losses), w - 352, y, cellPx, signStroke);
      paintSignedNumber(ctx, row.diff, w - 236, y, cellPx, signStroke);
      ctx.fillStyle = colors.accent;
      ctx.font = `800 ${tools.fontPx(30)}px ${FONT}`;
      ctx.fillText(String(row.points), w - 120, y);
    });
  }

  // Footer ticker strip — the sill course occludes the face's bottom ≈44 px;
  // `summitFooterLayout` seats the floored 43 px line at baseline 641, its
  // descenders 0.6 em above that lip (r3: 662, touching the bezel).
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.fillRect(0, footer.stripTop, w, h - footer.stripTop);
  ctx.fillStyle = colors.ink;
  ctx.font = `700 ${footerPx}px ${FONT}`;
  fillTextFitted(ctx, upperForPaint(mountainKickoffStamp(content, undefined, locale), locale), 56, footer.baseline, w - 112);
}

export interface SignPayload {
  /** Sign heading, e.g. 'FIXTURES' or 'RESULTS'. */
  heading: string;
  /**
   * Rows with a detail line. Only a `match` row (the default kind) paints
   * "vs"; the pulse sign's stats and the table's standings carry their own
   * kinds (board-text.ts) — audit issue 7's "8 vs TRAINERS".
   */
  rows: BoardRow[];
  /** Small footer line under the rows. */
  footer: string | null;
  /**
   * The sign's top-band word. Defaults to `paint.heading.schedule` — the station
   * name the nav chip carries — so a caller that knows a sign's place in the
   * row (e.g. `SCHEDULE · 1/5`) can say so without a painter change.
   */
  band?: string;
}

/**
 * The trail-sign cloth pair (fidelity W1 r5 re-tone): r4's #8a6f4d wood with
 * #3a2c1c ink measured ≈ 3.4:1 in texture space and ≈ 2.6:1 on the lit
 * render, so no accent shift could lift a row past the plain ones. The
 * lighter wood and near-black routed ink clear ≥ 5:1 in texture space; the
 * face is self-lit (TrailSigns.tsx), so the render keeps the painted pair.
 */
export const TRAIL_SIGN_WOOD = '#a5875f';
export const TRAIL_SIGN_INK = '#1e160c';

/**
 * The trail signs' emission intensities, night and day — TrailSigns.tsx's
 * self-lit cloth (`emissiveIntensity={night ? 0.7 : 0.95}` on a black base).
 * Every ink choice on the sign holds at BOTH (fidelity wave 2); kept in step
 * with the mount by hand until the mount imports it (hand-off to its owner).
 */
export const SIGN_EMISSION: readonly number[] = [0.7, 0.95];

/**
 * The trail-sign band — ground and word ink chosen together on the RENDERED
 * sign (fidelity wave 2, the sakura cloth law: r3–r5 chose the ink in
 * texture space, which lighting and the AgX grade do not preserve). The
 * best of ink / white / wood on the accent band; if none reaches 4.5:1 at
 * both emissions the band shifts along its hue (`readableRenderedBand`).
 */
export function signBand(colors: { wood: string; ink: string; accent: string }): { band: string; ink: string } {
  const pick = readableRenderedBand(colors.accent, [colors.ink, '#ffffff', colors.wood], SIGN_EMISSION);
  return { band: pick.band, ink: pick.ink };
}

/** The trail-sign band word's ink (see `signBand`). */
export function signBandInk(colors: { wood: string; ink: string; accent: string }): string {
  return signBand(colors).ink;
}

/**
 * One trail sign: weathered timber ground, routed ink heading, fixture rows
 * in carved strokes. Painted once per sign; data from
 * `buildBoardContent(data, locale)`. C-103 r1 re-space on the GROWN 2.0 m
 * face (TrailSigns.tsx; floor 60 → 35 painter px, the C-102 r2 banner
 * mechanism), MEASURED: the league strip moved to the TOP band — at the
 * floored 35 px "MOUNTAIN PASS LEAGUE" measures 449 px and overflowed the
 * 320 canvas at the bottom band, while "MOUNTAIN PASS" (305) fits — and
 * the bottom band keeps as plain routed wood (its glyphs rode the knoll
 * silhouette cut at the schedule poses). Pair rows wrap to two lines
 * ("WARREN vs" 200 / "HOFFMAN" 177 inside the 264 px budget), detail rows
 * wrap at 24 px→35 ("MD 2 · 9/17" 187 / "18:00 · OPEN" 138... measured at
 * 24 px: 187/138), and the footer wraps ("Second Half ·" / "Matchday 2").
 * Nothing ellipsizes.
 */
export function paintTrailSign(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  payload: SignPayload,
  colors: { wood: string; ink: string; accent: string },
  tools: BoardPaintTools,
  locale: Locale = 'en',
): void {
  // Fidelity wave 2 contrast lint: the routed ink on the lit wood modelled
  // at ≈ 3.9:1 on the RENDERED sign (the r5 judge measured the plain rows
  // at ≈ 4.1:1) — the wood lightens along its hue until the ink clears
  // 4.5:1 at both emissions (`readableGround`); band, pill and dash pads
  // all use the resolved wood.
  colors = { ...colors, wood: readableGround(colors.wood, [colors.ink], SIGN_EMISSION) };
  ctx.fillStyle = colors.wood;
  ctx.fillRect(0, 0, w, h);
  // Grain: quiet horizontal weathering bands.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.045)';
  for (let y = 0; y < h; y += 7) ctx.fillRect(0, y, w, 2);
  // Top league band (routed accent ground, pale carving) and bottom band.
  // Fidelity wave 2: the band ground and its word ink are chosen together
  // on the RENDERED sign (`signBand`).
  const band = signBand(colors);
  ctx.fillStyle = band.band;
  ctx.fillRect(0, 0, w, 56);
  ctx.fillRect(0, h - 84, w, 84);
  // Fidelity W1 r3: the band word paints in whichever ink reads best on
  // the accent ground (≥ 4.5:1 — pinned in signs-summit-r2.test.ts); the
  // r2 wood-on-orange measured ≈ 1.5:1 in the light-theme crops.
  ctx.fillStyle = band.ink;
  ctx.font = `800 ${tools.fontPx(20)}px ${FONT}`;
  ctx.textAlign = 'center';
  fillTextFitted(ctx, payload.band ?? paintText(locale, 'heading.schedule'), w / 2, 40, w - 32);
  ctx.textAlign = 'left';

  ctx.fillStyle = colors.ink;
  ctx.font = `900 ${tools.fontPx(46)}px ${FONT}`;
  fillTextFitted(ctx, payload.heading, 28, 122, w - 56);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(28, 146, 120, 8);

  // Rows (fidelity W1, audit issues 7 + 8): every baseline is stacked from
  // the px actually painted — the C-103 layout stepped 38 px pair lines and
  // 26 px date lines under the 35 px floor, so the date lines overprinted
  // (measured leading 0.74). Now pair → pair, pair → detail and detail →
  // detail all step `lineStep` (42 at the floor), and rows that no longer
  // fit are counted on a "+N MORE" line instead of vanishing silently (the
  // ?board=schedule panel lists every fixture).
  const pairPx = tools.fontPx(34);
  const detailPx = tools.fontPx(24);
  const footerPx = tools.fontPx(24);
  const pairStep = lineStep(pairPx);
  const detailStep = lineStep(detailPx);
  const rowGap = 16;
  const textW = w - 56;
  // Fidelity W1 r4: accent rows (LIVE, results winners) paint in the accent
  // mixed toward ink until it clears 4.5:1 on the wood — the light theme's
  // salmon-on-tan LIVE line was nearly invisible at 390. r5: the shift now
  // always goes toward the dark body ink (never toward cream on the lit tan).
  // Fidelity wave 2: measured on the RENDERED sign at both emissions.
  const rowAccent = readableAccent(colors.accent, colors.wood, colors.ink, SIGN_EMISSION);
  // Fidelity wave 2: LIVE is a filled pill (wood on the readable accent) and
  // every rect dash is padded clear of the grain lines.
  const dressing = { ground: colors.wood, pill: { word: livePillWord(locale), fill: rowAccent, ink: colors.wood } };
  const budgetFor = (text: string, px: number) => (hasLivePill(text, locale) ? textW - linePillExtra(px) : textW);

  ctx.font = `600 ${footerPx}px ${FONT}`;
  const footerLines = payload.footer ? wrapFields(ctx, payload.footer, budgetFor(payload.footer, footerPx), 2) : [];
  const footerStep = lineStep(footerPx);
  // The footer rides just above the plain bottom band (h − 84), 14 px clear.
  const footerY = h - 84 - 14 - Math.max(0, footerLines.length - 1) * footerStep;
  const rowsLimit = footerLines.length > 0 ? footerY - stackStep(detailPx, footerPx) : h - 84 - 14;

  let y = Math.max(208, 122 + stackStep(tools.fontPx(46), pairPx));
  // A sign with no rows still says so — a blank board reads as a carving
  // fault, not as "nothing scheduled".
  if (payload.rows.length === 0) {
    ctx.fillStyle = colors.ink;
    ctx.font = `600 ${pairPx}px ${FONT}`;
    wrapWords(ctx, paintText(locale, 'empty.nothingPosted'), textW, 2).forEach((line, li) => {
      ctx.fillText(line, 28, y + li * pairStep);
    });
  }
  // Room a "+N MORE" line needs after a row: exactly the next row's first baseline.
  const moreStep = stackStep(detailPx, pairPx) + rowGap;
  // Fidelity W1 r5 (the sakura cloth law): en dashes as rects on every line,
  // a wrapping standing folds its record into the detail, no ≤ 2-char orphans.
  const pairStroke = signStrokePx(pairPx, tools.fontFloorPx);
  const detailStroke = signStrokePx(detailPx, tools.fontFloorPx);
  for (let r = 0; r < payload.rows.length; r += 1) {
    const row = payload.rows[r];
    ctx.font = `800 ${pairPx}px ${FONT}`;
    const texts = boardRowTexts(row, wrapFields(ctx, boardRowHeadline(row), textW, 2).length <= 1);
    const pairLines = wrapFields(ctx, texts.headline, textW, 2);
    ctx.font = `600 ${detailPx}px ${FONT}`;
    const detailLines = wrapFields(ctx, texts.detail, budgetFor(texts.detail, detailPx), 2);
    const detailY = y + (pairLines.length - 1) * pairStep + stackStep(pairPx, detailPx);
    const lastY = detailY + Math.max(0, detailLines.length - 1) * detailStep;
    const isLast = r === payload.rows.length - 1;
    if (lastY + (isLast ? 0 : moreStep) > rowsLimit) {
      const hidden = payload.rows.length - r;
      ctx.fillStyle = colors.ink;
      ctx.font = `700 ${detailPx}px ${FONT}`;
      fillTextFitted(ctx, paintText(locale, 'more', { count: hidden }), 28, y, textW);
      break;
    }
    ctx.fillStyle = row.accent ? rowAccent : colors.ink;
    ctx.font = `800 ${pairPx}px ${FONT}`;
    pairLines.forEach((line, li) => paintDashedLine(ctx, line, 28, y + li * pairStep, pairPx, pairStroke, textW, dressing));
    if (row.kind !== 'stat' && row.kind !== 'standing' && row.live) {
      const lastPair = pairLines[pairLines.length - 1] ?? '';
      const lastW = Math.min(textW, dashedLineWidth(ctx, lastPair, pairPx, pairStroke));
      const rule = liveUnderline(28, y + (pairLines.length - 1) * pairStep, lastW, pairPx, pairStroke);
      ctx.fillRect(rule.x, rule.y, rule.w, rule.h);
    }
    ctx.font = `600 ${detailPx}px ${FONT}`;
    ctx.fillStyle = row.accent ? rowAccent : colors.ink;
    detailLines.forEach((line, li) =>
      paintDashedLine(ctx, line, 28, detailY + li * detailStep, detailPx, detailStroke, textW, dressing),
    );
    y = lastY + stackStep(detailPx, pairPx) + rowGap;
  }

  if (footerLines.length > 0) {
    ctx.fillStyle = colors.ink;
    ctx.font = `600 ${footerPx}px ${FONT}`;
    const footerStroke = signStrokePx(footerPx, tools.fontFloorPx);
    footerLines.forEach((line, li) =>
      paintDashedLine(ctx, line, 28, footerY + li * footerStep, footerPx, footerStroke, textW, dressing),
    );
  }
}

/**
 * The five trail-sign payloads, west → east (fixtures, up next, results,
 * pulse, table), built from `buildBoardContent(data, locale)`. Pure, so the
 * copy is testable without the scene.
 *
 * Fidelity W1 r2 — unique top bands: r1 painted the station word
 * "SCHEDULE" on all five bands (the "MOUNTAIN PASS" brand measured 305 px
 * against the band's 288 px budget at the 35 px floor, so it cannot come
 * back whole). Each band now says what only its sign knows: which matchday
 * the fixture signs hold (so their rows drop the repeated "MD n ·"), that
 * the results are the LATEST ones, that the pulse is the SEASON's, and how
 * many places the table shows (TOP 4). Every band stays ≤ 11 glyphs, inside
 * the budget at the floor.
 */
export function buildTrailSignPayloads(
  content: BoardContent,
  nowMs: number = Date.now(),
  locale: Locale = 'en',
): SignPayload[] {
  const matchday = (n: number) => paintText(locale, 'matchday', { n });
  const upcoming: BoardRow[] = content.upcoming.map((f) => ({
    home: f.home,
    away: f.away,
    detail: `${f.date} ${f.time} · ${statusWord(f.status, locale)}`,
    accent: isLiveFixture(f.status),
    live: isLiveFixture(f.status),
  }));
  const later: BoardRow[] = content.later.map((f) => ({
    home: f.home,
    away: f.away,
    detail: `${f.date} ${f.time}`,
  }));
  const results: BoardRow[] = content.results.map((r) => ({
    home: r.home,
    away: r.away,
    detail: `${r.score} · ${r.date}`,
    accent: r.winner === 'home',
  }));
  // Fidelity W1 r1 (audit issue 7): the pulse and table signs are NOT
  // fixtures — they carry their own row kinds (board-text.ts); only a match
  // row is ever joined with "vs".
  const pulse: BoardRow[] = [
    {
      kind: 'stat',
      text: paintText(locale, 'trainers', { count: content.participants }),
      detail: paintText(locale, 'matchesPlayed', { count: content.completed }),
    },
    { kind: 'stat', text: matchday(content.round), detail: upperForPaint(content.stage, locale) },
  ];
  const table: BoardRow[] = content.top.map((row, i) => ({
    kind: 'standing' as const,
    rank: i + 1,
    name: row.name,
    record: `${row.wins}–${row.losses}`,
    detail: standingDetail(row.points, row.rankChange, locale),
  }));
  const currentDay = content.upcoming[0]?.matchday;
  const nextDay = content.later[0]?.matchday;
  return [
    {
      heading: paintText(locale, 'heading.fixtures'),
      band: currentDay !== undefined ? matchday(currentDay) : paintText(locale, 'heading.schedule'),
      rows: upcoming,
      // Fidelity W1 r3: the shared ticker order — never `NEXT 9/17 18:00`
      // under the LIVE row of that same kickoff. Fidelity wave 2: the
      // pairing sign's live tail says `vs` like its rows (`liveMatchPair`
      // — the rect dash between names read as `BELL = COLE` at 390).
      footer: kickoffLine(content, nowMs, locale, liveMatchPair),
    },
    {
      heading: paintText(locale, 'heading.upNext'),
      band: nextDay !== undefined ? matchday(nextDay) : paintText(locale, 'heading.later'),
      rows: later,
      footer: null,
    },
    {
      heading: paintText(locale, 'heading.results'),
      band: paintText(locale, 'heading.latest'),
      rows: results,
      footer: content.lastMatchdayLabel,
    },
    {
      heading: paintText(locale, 'heading.pulse'),
      band: paintText(locale, 'heading.season'),
      rows: pulse,
      // A stat sign: no `vs` (audit issue 7) — the tail keeps the rect
      // dash, now a ≥ 3:1 bar padded clear of the grain (fidelity wave 2).
      footer: content.live
        ? paintText(locale, 'kickoffLive', { pair: livePair(content.live.home, content.live.away) })
        : null,
    },
    {
      heading: paintText(locale, 'heading.table'),
      band:
        table.length > 0
          ? paintText(locale, 'heading.top', { count: table.length })
          : paintText(locale, 'heading.standings'),
      rows: table,
      footer: null,
    },
  ];
}

/**
 * The register frieze's emission intensities — TrailRegister.tsx
 * (`emissiveIntensity={night ? 0.7 : 0.95}`, black base). Kept in step by
 * hand until the mount imports it (hand-off to its owner).
 */
export const REGISTER_EMISSION: readonly number[] = [0.7, 0.95];

/** The roster note / secondary label ink on the stone (the 0.78 roster-note alpha). */
export const REGISTER_LABEL_INK = 'rgba(255, 255, 255, 0.78)';

/**
 * The register frieze's note after the `ROSTER` heading (fidelity W1 r1).
 * The old overflow note said "FULL LIST BELOW" — but on the route tier every
 * semantic section is `visibility: hidden`, so it pointed at nothing. Like
 * sakura's `rosterWallNote`, it now names what a tap delivers today: the
 * wall's focus pose, where the frieze reads up close (design decision D4). It
 * stays honest about the count and never promises the full list — that
 * needs the roster-panel follow-up. Sized to the old note's measured width
 * class (36 glyphs vs the 37-glyph "FIRST 9 OF 30 LINES · FULL LIST BELOW",
 * ≈ 1165 px at the 50 px floor, inside the ≈ 1196 px beside the heading).
 */
export function registerNote(
  shown: number,
  total: number,
  fullListOnTap: boolean = true,
  locale: Locale = 'en',
): string {
  // Fidelity wave 2: the full-list panel (`?board=roster`, seat 2D) opens
  // from the wall in the same merge train, so the note now promises every
  // line (`rosterTapNote` — "9 OF 30 LINES · TAP THE WALL FOR ALL 30",
  // 39 glyphs; the painter auto-fits then condenses, never cuts the count).
  if (fullListOnTap && total > 0) return rosterTapNote(shown, total, locale, 'WALL');
  return total > shown
    ? paintText(locale, 'note.linesUpClose', { shown, total })
    : paintText(locale, 'note.trailRegister');
}

/**
 * The register lodge wall's roster frieze: one carved tile per roster tile,
 * line number, species and the price (EPB) or the gym band (fallback).
 * C-103 r1 re-space at the roster station's 50 px painter floor, MEASURED:
 * the old 248 px tiles held a 174 px name budget while the worst real name
 * measures 431 px ("GEODUDE-ALOLA") and the worst band 439 — everything
 * ellipsized. Tiles grow to 468 px, three per row (budget 18 → 9 — the
 * count trade disclosed on the painted note, the C-102 r2 mechanism; nine
 * is the vertical honest maximum: wrapped name + band needs the full
 * (640−140)/3 = 166 px tile), names wrap at spaces and after hyphens
 * across two 50 px lines (budgets 394/394; every measured chunk fits:
 * "GEODUDE-" 265, "ALOLA" 166, "CHARMANDER" 371), and the band line drops
 * the mid-dot for a space so the worst band fits its 438 px budget
 * ("10 PTS GUENSTIG" 423, "27 PTS PREMIUM" 414, measured).
 */
export function paintRegisterWall(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tiles: readonly WorldRosterTile[],
  colors: { stone: string; ink: string; accent: string },
  tools: BoardPaintTools,
  note: string | null = null,
  locale: Locale = 'en',
  dataLocale: Locale = locale,
): void {
  // Fidelity wave 2 contrast lint: cream ink on the lit stone modelled at
  // ≈ 3.6:1 rendered (the 78 % note ≈ 3.3:1) — the stone deepens along its
  // hue until every text ink clears 4.5:1 at both emissions.
  colors = { ...colors, stone: readableGround(colors.stone, [colors.ink, REGISTER_LABEL_INK], REGISTER_EMISSION) };
  ctx.fillStyle = colors.stone;
  ctx.fillRect(0, 0, w, h);
  // Timber coursing joints — the frieze reads as a carved register board.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 3;
  for (let y = 0; y <= h; y += h / 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // Fidelity W1 heading: the frieze used to carry only the caller's note
  // in 50 % white, so a first-time visitor saw numbered tiles with no title.
  // The top band now LEADS with the station word (accent, heavy — the nav
  // chip's "Roster"), and the caller's note (the wall's name, or the
  // overflow disclosure) follows it at readable ink, fitted to what remains.
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.accent;
  ctx.font = `800 ${tools.fontPx(28)}px ${FONT}`;
  const heading = paintText(locale, 'heading.roster');
  ctx.fillText(heading, 48, 48);
  if (note) {
    const headingW = ctx.measureText(heading).width;
    // The accent/ink split separates heading and note — no separator glyph,
    // so the longest overflow note (`registerNote`, "9 OF 30 LINES · TAP TO
    // READ UP CLOSE" — the width class of the measured ≈ 1165 px C-103 note
    // at the 50 px floor) still fits beside the heading.
    const noteX = 48 + headingW + 24;
    ctx.fillStyle = REGISTER_LABEL_INK;
    // Fidelity wave 2: auto-fit (floor → condense ≥ 0.72) before any
    // ellipsis, so the promised count ("FOR ALL 30") is never the part cut.
    paintAutoFit(ctx, (px) => `700 ${px}px ${FONT}`, note, noteX, 48, w - 48 - noteX, tools.fontPx(26), tools.fontFloorPx);
  }

  if (tiles.length === 0) {
    ctx.fillStyle = colors.ink;
    ctx.font = `700 ${tools.fontPx(36)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(paintText(locale, 'empty.noRosterLines'), w / 2, h / 2 + 12);
    ctx.textAlign = 'left';
    return;
  }

  const tileW = 468;
  const gap = 12;
  const inner = w - 96;
  const perRow = Math.max(1, Math.floor(inner / (tileW + gap)));
  const rowsUsed = Math.ceil(tiles.length / perRow);
  const tileH = Math.max(96, Math.min(166, (h - 140) / Math.max(1, rowsUsed)));

  /** Wrap a roster name at spaces and AFTER HYPHENS (species forms). */
  const wrapName = (text: string, maxW: number): string[] => {
    const words = text.split(/(?<=-)/).flatMap((part) => part.split(/\s+/)).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line}${word}` : word;
      if (ctx.measureText(next).width <= maxW || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
        if (lines.length === 2) return lines;
      }
    }
    if (line && lines.length < 2) lines.push(line);
    return lines;
  };

  // Fixed index gutter (fidelity W1, audit issue 8 — "01BULBASAUR"): the
  // authored name column (x + 62) sat 44 px right of the index, but "01" at
  // the 50 px floor is wider than that, so every index overprinted its name.
  // The column is now MEASURED once per frieze from the widest index label
  // painted (board-text.ts `indexGutter`, 10 px gap) and every name starts
  // on it; the name budget is what remains of the tile (8 px right pad).
  const indexFont = `800 ${tools.fontPx(24)}px ${FONT}`;
  const indexLabels = tiles.map((tile) => String(tile.line).padStart(2, '0'));
  ctx.font = indexFont;
  const nameOffset = indexGutter(ctx, indexLabels, 16, 10, 62);
  const nameBudget = tileW - nameOffset - 8;

  tiles.forEach((tile, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = 48 + col * (tileW + gap);
    const y = 68 + row * (tileH + gap);
    if (y + tileH > h - 24) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    roundRect(ctx, x, y, tileW, tileH, 12);
    ctx.fill();
    ctx.fillStyle = colors.accent;
    ctx.fillRect(x, y, 6, tileH);

    // Line number shares the first 50 px line with the name's first chunk
    // (name on the measured gutter); a wrapped chunk rides the second line,
    // the price/band the last.
    // Fidelity wave 2: the index and band labels read at the roster-note
    // alpha (0.78 — they were 50 % / 62 % white, under 3:1 rendered).
    ctx.fillStyle = REGISTER_LABEL_INK;
    ctx.font = indexFont;
    ctx.fillText(indexLabels[i], x + 16, y + 46);
    ctx.fillStyle = colors.ink;
    ctx.font = `800 ${tools.fontPx(27)}px ${FONT}`;
    const nameLines = wrapName(upperForPaint(rosterTileName(tile, dataLocale), locale), nameBudget);
    nameLines.forEach((line, li) => fillTextFitted(ctx, line, x + nameOffset, y + 46 + li * 50, nameBudget));
    ctx.font = `700 ${tools.fontPx(22)}px ${FONT}`;
    ctx.fillStyle = REGISTER_LABEL_INK;
    const band = rosterBandLine(tile, locale, dataLocale, 'plain');
    fillTextFitted(ctx, band, x + 18, y + 46 + nameLines.length * 50, tileW - 30);
  });
}

/**
 * One cairn pedestal's name plate: bronze-cast ground, cream ink, the
 * trainer's name — and the gym band as a foot rule. C-105 r1 collapsed this
 * layout to a single 158 px line on the 0.62 m face; C-103 r1 grows the
 * PHYSICAL face to 1.4 m (Statuary.tsx, the C-102 r2 measured fix — the
 * teams pose and slot plan are identical to sakura's), so the floor drops
 * to 140 painter px and the name paints at the floor inside a 964 px budget
 * ("Toby Warren" measured 901 px there — COMPLETE, never ellipsized).
 */
export function paintAcePlaque(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  copy: { name: string; ace: string; band: string },
  tools: BoardPaintTools,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#4c4434');
  bg.addColorStop(0.5, '#332c1f');
  bg.addColorStop(1, '#221c12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Hairline border, pale bronze like the lantern boxes' fittings.
  ctx.strokeStyle = 'rgba(222, 204, 156, 0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#f4ecd8';
  ctx.font = `800 ${tools.fontPx(40)}px ${FONT}`;
  fillTextFitted(ctx, copy.name, 30, 130, w - 60);

  ctx.fillStyle = copy.band;
  ctx.fillRect(30, h - 24, w - 60, 7);
}

export interface AcePlaqueCopy {
  name: string;
  ace: string;
  band: string;
}

/**
 * The pass gate's hanging plaque: the ruleset of record plus headline rules.
 * R4 landscape board (1280×512 on this plaque's own 5.6 × 2.24 m face at
 * the 21.4 m station pose): a tracked-caps masthead over the big ruleset
 * name, then the four headline rules as carved columns. Re-spaced for the
 * rules station's 59 px painter floor (C-105 r1): rule labels wrap to two
 * 59 px lines above their value; the note DROPPED (it collided with the
 * floored values and the DOM #rules section carries it).
 */
export function paintPlaque(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  copy: { title: string; rulesetName: string; rows: [string, string][]; note: string | null },
  colors: { ground: string; ink: string; accent: string },
  tools: BoardPaintTools,
  locale: Locale = 'en',
): void {
  ctx.fillStyle = colors.ground;
  ctx.fillRect(0, 0, w, h);
  // Quiet timber weathering, like the trail signs.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
  for (let y = 0; y < h; y += 9) ctx.fillRect(0, y, w, 2);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, w - 80, h - 80);

  // Masthead: title over the ruleset of record.
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.accent;
  ctx.font = `800 ${tools.fontPx(40)}px ${FONT}`;
  const titleWidth =
    ctx.measureText(copy.title).width + (copy.title.length - 1) * 14;
  trackedText(ctx, copy.title, w / 2 - titleWidth / 2, 96, 14);
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.ink;
  fillRulesetMasthead(ctx, upperForPaint(copy.rulesetName, locale), w / 2, 196, w - 120, tools);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(w / 2 - 260, 224, 520, 10);

  // Headline rules: one carved column per row, hairline rules between.
  // Guarded divide — `plaqueCopy` deals four rows on EPB and one or two
  // (format, best-of) on every other format, but this
  // painter is theme-contract surface; an empty list must paint the masthead
  // and no columns, not an Infinity-wide column.
  const cols = copy.rows.length;
  const colW = cols > 0 ? (w - 120) / cols : 0;
  ctx.strokeStyle = 'rgba(43, 47, 38, 0.22)';
  ctx.lineWidth = 2;
  for (let c = 1; c < cols; c += 1) {
    const x = 60 + c * colW;
    ctx.beginPath();
    ctx.moveTo(x, 288);
    ctx.lineTo(x, 456);
    ctx.stroke();
  }
  copy.rows.forEach(([label, value], c) => {
    const cx = 60 + colW * (c + 0.5);
    ctx.fillStyle = colors.accent;
    ctx.font = `700 ${tools.fontPx(32)}px ${FONT}`;
    const lines = wrapWords(ctx, label, colW - 16, 2);
    lines.forEach((line, li) => ctx.fillText(line, cx, 316 + li * 52));
    ctx.fillStyle = colors.ink;
    ctx.font = `800 ${tools.fontPx(52)}px ${FONT}`;
    ctx.fillText(value, cx, 444);
  });

  ctx.textAlign = 'left';
}

/** Tracked capitals, glyph by glyph — `ctx.letterSpacing` is not in every engine. */
function trackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): void {
  let cursor = x;
  for (const glyph of text) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + tracking;
  }
}

/**
 * Plaque copy from the contract's rules fields, in the viewer's language —
 * pure shaping (`themePlaqueCopy`). The format decides the rows (`context`):
 * Evolution Point Buy carves the draft numbers (its row, else the league
 * defaults); every other format carves its format and best-of, with no
 * note, whatever row a format change left behind. C-103 r1: 'Lines per
 * trainer' reads 'Lines each' here — at the floored 59 px its wrap ("per
 * trainer", 295 px measured) overran the 276 px column. `locale` is
 * optional so the function stays a `RulesCopyFn`.
 */
export function plaqueCopy(
  formatRules: FormatRules | null,
  rulesetName: string | null,
  context: RulesCopyContext,
  locale: Locale = 'en',
): { title: string; rulesetName: string; rows: [string, string][]; note: string | null } {
  const copy = themePlaqueCopy(formatRules, rulesetName, context, locale, {
    titleKey: 'rules.titlePass',
    linesLabel: 'linesEach',
  });
  return { title: copy.title, rulesetName: copy.rulesetName, rows: copy.rows, note: copy.note };
}

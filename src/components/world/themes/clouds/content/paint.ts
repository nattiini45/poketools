import type { BoardContent, BoardFixtureStatus } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { Locale } from '@/i18n/config';
import { upperForPaint } from '@/i18n/core';
import type { FormatRules } from '@/types/format-rules';
import type { RulesCopyContext } from '@/components/world/sections/types';
import type { WorldRosterTile } from '@/lib/worlds/route-data';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  fitKeepingSuffix,
  indexGutter,
  TEXT_BOX_ASCENT_EM,
  TEXT_BOX_DESCENT_EM,
  lineStep,
  paintDashPair,
  paintAutoFit,
  bestRenderedInk,
  paintKickerLine,
  readableAccent,
  readableFace,
  readableGround,
  rosterTapNote,
  paintSignedNumber,
  signStrokePx,
  stackStep,
} from '@/lib/route-world/board-text';
import {
  isLiveFixture,
  leagueStamp,
  paintText,
  rosterBandLine,
  rosterTileName,
  stageMatchdayLine,
  statusPill,
  themePlaqueCopy,
  themeT,
} from '../../paint-copy';

/**
 * Canvas painters for the Skyisle content surfaces — the flagship's
 * standings billboard, the register airship's roster sail, the fixtures
 * board airship, the halo gate's hanging plaque and the aces floats' name
 * plaques. Pure 2D, no React and no three imports (the furniture mounts the
 * results through `./use-painted-texture.ts`, whose board-page hook routes
 * every page through the engine's shared `paintBoardPage` clamp). Every word
 * painted here follows the viewer (i18n D11): it comes from the
 * `world-themes` namespace through `../../paint-copy` in the `locale` the
 * mount passes (`useLocale()`, read before the texture is built), and the
 * typed board status words are translated at this boundary.
 *
 * C-105 r1 font floors: every painter signature carries the shared path's
 * `tools` and EVERY font px literal routes through `tools.fontPx` — the clamp
 * (station pose-derived, painter-space) decides what ships. Layout was
 * re-spaced to the floored px (flagship 40, register sail 50, fixtures 41,
 * float plaque 109, halo plaque 58 painter px); canvas constants are
 * unchanged.
 */

const FONT = "system-ui, 'Segoe UI', sans-serif";

/** Flagship + fixtures board face — 16:9, matches the board faces. */
export const BOARD_TEX_W = 1280;
export const BOARD_TEX_H = 720;

/** The register sail's roster frieze — 12:5 band on the 5.6 m sail. */
export const SAIL_TEX_W = 1536;
export const SAIL_TEX_H = 640;

/** Halo-gate plaque face — 5:2 landscape board (the siblings' 21 m pose tier). */
export const PLAQUE_TEX_W = 1280;
export const PLAQUE_TEX_H = 512;

/** One aces float's name plate face — 512:176. */
export const FLOAT_PLAQUE_TEX_W = 512;
export const FLOAT_PLAQUE_TEX_H = 176;

/** The typed status as its painted pill (`OPEN` / `LIVE` / `FT`) — never painted raw. */
export function statusWord(status: BoardFixtureStatus, locale: Locale = 'en'): string {
  return statusPill(status, locale);
}

/**
 * Footer ticker for the flagship board, shaped locally from the content's
 * own fields in the viewer's language. Fidelity W1 r3: the shared ticker
 * order (board-text.ts) — a past `next` beside a LIVE row is never painted
 * as the next kickoff.
 */
export function cloudsKickoffStamp(content: BoardContent, nowMs: number = Date.now(), locale: Locale = 'en'): string {
  return leagueStamp(content, nowMs, locale, 'matchesFlown');
}

/**
 * The authored stand-in for a standings screen whose season has no results yet
 * — the isles' boards never go blank, and the copy says what the league is
 * waiting for (the plaza `paintEmptyState` discipline, translated at this
 * boundary like the stamp above). `null` once the table has its first row, so
 * the caller cannot paint a stale placeholder over real standings.
 *
 * The copy is one short line on purpose: at the flagship station's 40 px floor
 * a longer sentence ellipsizes inside the placeholder box, and the trainer
 * count it would have carried is already on the footer stamp.
 */
export function standingsEmptyState(
  content: BoardContent,
  locale: Locale = 'en',
): { headline: string; copy: string } | null {
  if (content.table.length > 0) return null;
  return {
    headline: paintText(locale, 'empty.noTable'),
    copy: paintText(locale, 'empty.formsIsles'),
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
  ctx.font = `800 ${tools.fontPx(48)}px ${FONT}`;
  ctx.fillText(copy.headline, w / 2, box.y + 124);
  ctx.fillStyle = colors.ink;
  ctx.font = `600 ${tools.fontPx(32)}px ${FONT}`;
  fillTextFitted(ctx, copy.copy, w / 2, box.y + 210, boxW - 80);
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

/** Quiet horizontal canvas weathering shared by the painted surfaces. */
function weave(ctx: CanvasRenderingContext2D, w: number, h: number, step: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
  for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 1);
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
 * The airship faces' emission intensities — Airships.tsx
 * (`emissiveIntensity={night ? 1.9 : pureEmission ? 1.15 : 1.0}`, black
 * base). Kept in step by hand until the mount imports it (hand-off to its
 * owner).
 */
export const AIRSHIP_EMISSION: readonly number[] = [1.0, 1.15, 1.9];

/** Translucent text inks per board, linted with the body ink (`readableFace`). */
const CLOUDS_FLAGSHIP_TEXT_INKS: readonly string[] = ['rgba(238, 246, 255, 0.75)', 'rgba(238, 246, 255, 0.85)'];
const CLOUDS_FIXTURES_TEXT_INKS: readonly string[] = [
  'rgba(238, 246, 255, 0.75)',
  'rgba(238, 246, 255, 0.85)',
  'rgba(238, 246, 255, 0.8)',
  'rgba(238, 246, 255, 0.72)',
];

/**
 * The flagship's standings billboard: a self-lit near-black glass field (the
 * C-104 day-board lever's paint half — the material is already base-black +
 * emission; a dark field keeps its ink contrast under the composer's AgX +
 * day-bloom veil, where the old deep-slate field lifted to within ~21–27
 * luma of its white ink) with the league masthead, the top-of-the-table
 * standings rows (rank movement included) and the footer ticker strip.
 * Content comes from `buildBoardContent(data, locale)` — nothing here invents
 * data. Standings live on the flagship, the chain's diegetic announcements
 * airship. Re-spaced for the pulse station's 40 px painter floor (C-105 r1):
 * the name column moved right of the 40 px movement glyphs and the footer
 * strip grown to carry 40 px text. C-104 r1: the LIVE pill width derives
 * from the MEASURED label at the floored px (width = label + 20, min 304,
 * capped at the masthead's measured end + 8 — the pill law): the
 * real pair "LIVE LOFTY–MISTY" measures 370 px vs the old fixed 280 budget
 * — now whole.
 */
export function paintFlagshipBoard(
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
  // accent lifts to 5:1. The r5 renders put the day orange accent at ≈ 4.0:1. A palette that already
  // passes is returned unchanged.
  colors = readableFace(colors, CLOUDS_FLAGSHIP_TEXT_INKS, AIRSHIP_EMISSION);
  ctx.fillStyle = colors.field;
  ctx.fillRect(0, 0, w, h);
  weave(ctx, w, h, 5);

  // Masthead (fidelity W1 r1, audit issue 8 — measured leading): the stage
  // line used to ride its own baseline (186) 34 px above the table header
  // (220) at the 40 px floor, so the subtitle collided with the header row.
  // It now shares the kicker baseline (`paintKickerLine`), and every
  // baseline below is STACKED from the px actually painted (`stackStep`,
  // ≥ 1.2 line boxes): kicker 74 → league → header → rows.
  const kickerPx = tools.fontPx(30);
  const leaguePx = tools.fontPx(52);
  const headerPx = tools.fontPx(27);
  const rowPx = tools.fontPx(30);
  const kickerY = 74;
  const leagueY = Math.max(138, kickerY + stackStep(kickerPx, leaguePx));
  const headerY = leagueY + stackStep(leaguePx, headerPx);
  paintKickerLine(
    ctx,
    { text: paintText(locale, 'brand.skyisleStandings'), font: `800 ${kickerPx}px ${FONT}`, color: colors.accent },
    {
      text: stageMatchdayLine(content.stage, content.round, locale),
      font: `600 ${kickerPx}px ${FONT}`,
      color: 'rgba(238, 246, 255, 0.75)',
    },
    56,
    kickerY,
    w - 112,
    fillTextFitted,
  );
  ctx.fillStyle = colors.ink;
  ctx.font = `700 ${leaguePx}px ${FONT}`;
  ctx.fillText(upperForPaint(content.league, locale), 56, leagueY);
  if (content.live) {
    // C-104 r1: the pill grows to its MEASURED label at the floored px —
    // never an em estimate (measured-widths law), capped left of
    // the masthead's measured end. The 22 px side paddings are
    // part of the budget: width = label + 44 — a +20 margin leaves the
    // fitted budget (pillW − 44) BELOW the label and re-truncates it.
    ctx.font = `800 ${tools.fontPx(26)}px ${FONT}`;
    const label = paintText(locale, 'livePill', { home: content.live.home, away: content.live.away });
    const labelW = ctx.measureText(label).width;
    // The cap measures the masthead at the px it is PAINTED at (52, the
    // sakura law) — measuring it at the label's floored 26 px
    // underestimates the end and lets the pill cross under the league name.
    ctx.font = `700 ${tools.fontPx(52)}px ${FONT}`;
    const mastheadEnd = 56 + Math.ceil(ctx.measureText(upperForPaint(content.league, locale)).width);
    // The 120 px floor keeps the pill a real rect when a long league name
    // eats the cap (sakura's clamp); the fitted label re-truncates honestly.
    const pillW = Math.max(120, Math.min(Math.max(304, Math.ceil(labelW) + 44), w - 56 - (mastheadEnd + 8)));
    const pillX = w - 56 - pillW;
    ctx.fillStyle = colors.accent;
    roundRect(ctx, pillX, 92, pillW, 58, 10);
    ctx.fill();
    ctx.fillStyle = colors.field;
    ctx.font = `800 ${tools.fontPx(26)}px ${FONT}`;
    fillTextFitted(ctx, label, pillX + 22, 134, pillW - 44);
  }

  // Table header + rows, stacked from the masthead at ≥ 1.2 line boxes: at
  // the 40 px floor header 190, row 1 238, pitch 52, row 8 602 — clear of
  // the footer strip (h − 76 = 644). A floor that no longer fits eight rows
  // drops the lowest rows, never the leading.
  const rowH = Math.max(52, lineStep(rowPx));
  const rowStart = headerY + stackStep(headerPx, rowPx);
  const rowLimit = h - 76 - 30;
  const rowCap = Math.max(0, Math.min(8, Math.floor((rowLimit - rowStart) / rowH) + 1));
  const rows = content.table.slice(0, rowCap);
  // Gold rule under the header row, like the mooring pennant bands.
  ctx.fillStyle = 'rgba(232, 146, 46, 0.16)';
  ctx.fillRect(0, headerY + 10, w, 6);
  if (content.table.length === 0) {
    paintStandingsEmpty(ctx, w, STANDINGS_EMPTY_BOX, colors, tools, standingsEmptyState(content, locale));
  } else {
    ctx.font = `800 ${headerPx}px ${FONT}`;
    ctx.fillStyle = 'rgba(238, 246, 255, 0.85)';
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
        ctx.fillRect(48, y - 34, w - 96, rowH - 6);
      }
      ctx.fillStyle = i < 4 ? colors.accent : colors.ink;
      ctx.font = `800 ${tools.fontPx(28)}px ${FONT}`;
      ctx.fillText(String(i + 1), 56, y);
      ctx.fillStyle = colors.ink;
      ctx.font = `700 ${tools.fontPx(30)}px ${FONT}`;
      // Name column at 176: the 40 px movement glyphs (▲12 ≈ 70 px from x=96)
      // end at ≈166 — the old 120 px column collided at the floor.
      fillTextFitted(ctx, row.name, 176, y, w - 352 - 176 - 24);
      // Rank movement glyph: ▲▼ — the contract's rankChange, painted.
      if (row.rankChange !== null && row.rankChange !== 0) {
        ctx.fillStyle = row.rankChange > 0 ? '#8fd6a4' : '#f0876f';
        ctx.font = `800 ${tools.fontPx(24)}px ${FONT}`;
        ctx.fillText(row.rankChange > 0 ? `▲${row.rankChange}` : `▼${-row.rankChange}`, 96, y - 4);
      }
      ctx.font = `600 ${tools.fontPx(28)}px ${FONT}`;
      ctx.fillStyle = 'rgba(238, 246, 255, 0.85)';
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

  // Footer ticker strip — grown 64 → 76 so the floored 40 px line clears it.
  // On the glass field the band reads as a light frost strip (a black alpha
  // band vanishes on near-black glass).
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(0, h - 76, w, 76);
  ctx.fillStyle = colors.ink;
  ctx.font = `700 ${tools.fontPx(26)}px ${FONT}`;
  fillTextFitted(ctx, upperForPaint(cloudsKickoffStamp(content, undefined, locale), locale), 56, h - 22, w - 112);
}

/**
 * The register airship's roster sail: one sewn tile per roster tile — line
 * number, species and the price (EPB) or the gym band (fallback) — on
 * canvas panels with seam joints. C-104 r1 re-tile (measured-width law):
 * the old 5-column grid's 236 px name budget truncated at the 50 px floor
 * ("GEODUDE-ALOLA" MEASURES 431 px); the sail now shows NINE tiles in a
 * 3×3 grid — 474 px tiles whose 400 px name box carries every roster name
 * whole (hyphenated forms wrap at the hyphen, never ellipsize), with the
 * note re-worded to its measured 1426 px form (budget 1440).
 */
/** The sail's light ink candidate — cream, for a canvas the navy ink cannot read on. */
const SAIL_LIGHT_INK = '#f4efe4';

/**
 * The register sail's note after the `ROSTER` heading (fidelity W1 r1),
 * for the sail's caller (Airships.tsx) to adopt: it names what a tap
 * delivers today (the sail's focus pose) instead of the route-hidden
 * section "BELOW", stays honest about the count, and is short enough to
 * sit beside the heading (the old 1426 px "THE REGISTER · FIRST 9 OF N
 * LINES — FULL ROSTER BELOW" no longer fits the ≈ 1190 px left of it and
 * is ellipsized by the painter until the caller switches).
 */
export function registerSailNote(
  shown: number,
  total: number,
  fullListOnTap: boolean = true,
  locale: Locale = 'en',
): string {
  // Fidelity wave 2: the full-list panel (`?board=roster`, seat 2D) opens
  // from the sail in the same merge train — the note promises every line
  // ("9 OF 30 LINES · TAP THE SAIL FOR ALL 30", `rosterTapNote`).
  if (fullListOnTap && total > 0) return rosterTapNote(shown, total, locale, 'SAIL');
  return total > shown
    ? paintText(locale, 'note.linesUpClose', { shown, total })
    : paintText(locale, 'note.register');
}

export function paintRegisterSail(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tiles: readonly WorldRosterTile[],
  colors: { canvas: string; ink: string; accent: string },
  tools: BoardPaintTools,
  note: string | null = null,
  locale: Locale = 'en',
  dataLocale: Locale = locale,
): void {
  // Fidelity wave 2 contrast lint (rendered, `AIRSHIP_EMISSION`): the night
  // canvas (#42536e) under the fixed navy ink modelled at ≈ 2.5:1 (the 85 %
  // note ≈ 1.9:1) — the ink is now the better of navy / cream on the canvas
  // actually passed, the canvas shifts along its hue until the ink and the
  // note clear 4.5:1, and the heading accent is lifted like every row
  // accent. The day sail keeps its navy ink. The note takes the full ink:
  // at 85 % it modelled 3.8:1 even on the lightest canvas at the 1.9 night
  // emission; the heading's accent/weight carries the hierarchy.
  const ink = bestRenderedInk(colors.canvas, [colors.ink, SAIL_LIGHT_INK], AIRSHIP_EMISSION).ink;
  const noteInk = ink;
  const canvas = readableGround(colors.canvas, [ink, noteInk], AIRSHIP_EMISSION);
  const lightInk = ink !== colors.ink;
  colors = { ...colors, ink, canvas, accent: readableAccent(colors.accent, canvas, ink, AIRSHIP_EMISSION) };
  ctx.fillStyle = colors.canvas;
  ctx.fillRect(0, 0, w, h);
  // Panel seams — the sail reads as sewn canvas, not a printed poster.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
  ctx.lineWidth = 3;
  for (let y = 0; y <= h; y += h / 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  weave(ctx, w, h, 7);
  // Fidelity W1 r1 heading: the sail used to carry only the caller's note,
  // so a first-time visitor saw numbered tiles with no title. The top band
  // now LEADS with the station word (accent, heavy — the nav chip's
  // "Roster", mountain's register-heading treatment) and the note follows at
  // readable ink: 60 % → 85 % of the dark ink on the light canvas (the
  // sail's equivalent of the stone friezes' 50 % → 78 % white step).
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.accent;
  ctx.font = `800 ${tools.fontPx(28)}px ${FONT}`;
  const heading = paintText(locale, 'heading.roster');
  ctx.fillText(heading, 48, 44);
  if (note) {
    const noteX = 48 + ctx.measureText(heading).width + 24;
    ctx.fillStyle = noteInk;
    // Fidelity wave 2: auto-fit (floor → condense ≥ 0.72) before any
    // ellipsis, so the promised count ("FOR ALL 30") is never the part cut.
    paintAutoFit(ctx, (px) => `700 ${px}px ${FONT}`, note, noteX, 44, w - 48 - noteX, tools.fontPx(26), tools.fontFloorPx);
  }

  if (tiles.length === 0) {
    ctx.fillStyle = colors.ink;
    ctx.font = `700 ${tools.fontPx(36)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(paintText(locale, 'empty.noRosterLines'), w / 2, h / 2 + 12);
    ctx.textAlign = 'left';
    return;
  }

  // Fidelity W1 r3 (the stat line read as the NEXT row's): each tile is
  // one text BLOCK — the name line, the stat line stacked directly under it
  // (line boxes touching, `stackStep`), the block centred in its cell — and
  // the cells are separated by a visible 12 px row gap, so the air between
  // tiles is always larger than the air inside one. Names paint on ONE line
  // after the index in the fixed gutter (board-text.ts `indexGutter` —
  // never "01BULBASAUR"); a name wider than its box is cut (middle, r4) instead of
  // wrapping into its own stat (the r2 hyphen wrap put "ALOLA" on the stat;
  // the focus panel carries the whole name). The stat line takes the tile's
  // full width under the block ("30 PTS · PREMIUM" needs ≈ 440 of 450 px).
  const namePx = tools.fontPx(27);
  const statPx = tools.fontPx(22);
  const statStep = stackStep(namePx, statPx);
  const blockTop = Math.ceil(namePx * TEXT_BOX_ASCENT_EM);
  const blockH = blockTop + statStep + Math.ceil(statPx * TEXT_BOX_DESCENT_EM);
  const tileW = 480;
  const tileH = Math.max(166, blockH + 24);
  const colGap = 8;
  const rowGap = 12;
  const inner = w - 80;
  const perRow = Math.max(1, Math.floor((inner + colGap) / (tileW + colGap)));

  const indexFont = `800 ${namePx}px ${FONT}`;
  const indexLabels = tiles.map((tile) => String(tile.line).padStart(2, '0'));
  ctx.font = indexFont;
  const nameOffset = indexGutter(ctx, indexLabels, 18, 10, 62);

  tiles.forEach((tile, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = 40 + col * (tileW + colGap);
    const y = 68 + row * (tileH + rowGap);
    if (y + tileH > h - 24) return;

    // A light tile under navy ink, a darker one under cream (wave 2).
    ctx.fillStyle = lightInk ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.5)';
    roundRect(ctx, x, y, tileW, tileH, 12);
    ctx.fill();
    ctx.fillStyle = colors.accent;
    ctx.fillRect(x, y, 6, tileH);

    const nameY = y + Math.round((tileH - blockH) / 2) + blockTop;
    const statY = nameY + statStep;
    ctx.font = indexFont;
    ctx.fillStyle = colors.ink;
    ctx.fillText(indexLabels[i], x + 18, nameY);
    ctx.font = `800 ${namePx}px ${FONT}`;
    // Fidelity W1 r4: the name is already at the sail's floor px, so it cannot
    // shrink — an over-wide name is cut from the MIDDLE and keeps its form
    // suffix (`GEOD…-ALOLA`, never `GEODUDE-A…` beside line 08's `GEODUDE`).
    ctx.fillText(
      fitKeepingSuffix(ctx, upperForPaint(rosterTileName(tile, dataLocale), locale), tileW - nameOffset - 12),
      x + nameOffset,
      nameY,
    );

    // Stat line in the full ink (r2's 62 % ink sat near 3:1 on the pale tile).
    // Fidelity W1 r1: price-group keys translated at this boundary (shared
    // `priceBandLabel` via `rosterBandLine`), never painted raw ("27 PTS · GUENSTIG").
    const band = rosterBandLine(tile, locale, dataLocale, 'dot');
    ctx.font = `700 ${statPx}px ${FONT}`;
    fillTextFitted(ctx, band, x + 18, statY, tileW - 30);
  });
}

/**
 * The fixtures board airship's face: the current matchday's fixtures with
 * their English status pills and kickoffs, then the next matchday below.
 * Data from `buildBoardContent(data, locale)`. Re-spaced for the schedule
 * station's 41 px painter floor (C-105 r1): the status pills grew, the
 * kickoff column moved right of the 41 px pairings, and the footer strip
 * grew to carry 41 px text.
 */
export function paintFixturesBoard(
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
  // accent lifts to 5:1. The r5 renders put the day orange accent at ≈ 4.0:1. A palette that already
  // passes is returned unchanged.
  colors = readableFace(colors, CLOUDS_FIXTURES_TEXT_INKS, AIRSHIP_EMISSION);
  ctx.fillStyle = colors.field;
  ctx.fillRect(0, 0, w, h);
  weave(ctx, w, h, 5);

  // Masthead (fidelity W1 r2, audit issue 8 carried to this board): the
  // "Second Half · Matchday 2" subtitle used to ride its own baseline (186)
  // on the accent rule, directly above the MATCH / KICKOFF / STATUS header
  // at the 41 px floor. It now shares the kicker baseline
  // (`paintKickerLine`, the flagship's treatment; the SKYISLE FIXTURES brand
  // is kept while it fits and drops first when it does not), and every
  // baseline below is STACKED from the px actually painted (`stackStep`,
  // ≥ 1.2 line boxes): kicker 74 → league → accent rule → header → rows.
  const kickerPx = tools.fontPx(30);
  const leaguePx = tools.fontPx(52);
  const headerPx = tools.fontPx(25);
  const rowPx = tools.fontPx(30);
  const kickerY = 74;
  const leagueY = Math.max(138, kickerY + stackStep(kickerPx, leaguePx));
  paintKickerLine(
    ctx,
    { text: paintText(locale, 'brand.skyisleFixtures'), font: `800 ${kickerPx}px ${FONT}`, color: colors.accent },
    {
      text: stageMatchdayLine(content.stage, content.round, locale),
      font: `600 ${kickerPx}px ${FONT}`,
      color: 'rgba(238, 246, 255, 0.75)',
    },
    56,
    kickerY,
    w - 112,
    fillTextFitted,
  );
  ctx.fillStyle = colors.ink;
  ctx.font = `700 ${leaguePx}px ${FONT}`;
  fillTextFitted(ctx, upperForPaint(content.league, locale), 56, leagueY, w - 112);
  // The accent rule sits under the league name's descent box; the header
  // then clears the rule by its own ascent box plus half-leading.
  const ruleY = leagueY + Math.ceil(leaguePx * 0.2) + 6;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, ruleY, w, 6);
  const headerY = ruleY + 6 + Math.ceil(headerPx * 0.9) + 10;

  const rowH = Math.max(58, lineStep(rowPx));
  const rowStart = headerY + stackStep(headerPx, rowPx);
  // At the 41 px floor: header 208, row 1 258, pitch 58, row 7 606 — its
  // stripe ends 624, clear of the footer strip (h − 72 = 648). A floor that
  // no longer fits seven rows drops the lowest rows, never the leading.
  const rowLimit = h - 72 - 30;
  const rowCap = Math.max(0, Math.min(7, Math.floor((rowLimit - rowStart) / rowH) + 1));
  const rows = [...content.upcoming, ...content.later].slice(0, rowCap);

  ctx.font = `800 ${headerPx}px ${FONT}`;
  ctx.fillStyle = 'rgba(238, 246, 255, 0.85)';
  ctx.fillText(paintText(locale, 'fixturesBoard.match'), 56, headerY);
  ctx.fillText(paintText(locale, 'fixturesBoard.kickoff'), 600, headerY);
  ctx.fillText(paintText(locale, 'fixturesBoard.status'), 1056, headerY);

  rows.forEach((row, i) => {
    const y = rowStart + i * rowH;
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(48, y - 32, w - 96, rowH - 8);
    }
    const live = isLiveFixture(row.status);
    ctx.fillStyle = colors.ink;
    ctx.font = `700 ${tools.fontPx(30)}px ${FONT}`;
    fillTextFitted(ctx, themeT(locale)('paint.versus', { home: row.home, away: row.away }), 56, y, 600 - 56 - 24);
    ctx.font = `600 ${tools.fontPx(26)}px ${FONT}`;
    ctx.fillStyle = 'rgba(238, 246, 255, 0.8)';
    ctx.fillText(`${row.date} · ${row.time}`, 600, y);
    if (live) {
      ctx.fillStyle = colors.accent;
      roundRect(ctx, 1056, y - 26, 180, 52, 10);
      ctx.fill();
      ctx.fillStyle = colors.field;
    } else {
      ctx.fillStyle = 'rgba(238, 246, 255, 0.72)';
    }
    ctx.font = `800 ${tools.fontPx(24)}px ${FONT}`;
    ctx.fillText(statusWord(row.status, locale), 1076, y + 11);
  });

  if (rows.length === 0) {
    ctx.fillStyle = 'rgba(238, 246, 255, 0.72)';
    ctx.font = `600 ${tools.fontPx(30)}px ${FONT}`;
    ctx.fillText(paintText(locale, 'empty.noFixtures'), 56, rowStart);
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.fillRect(0, h - 72, w, 72);
  ctx.fillStyle = colors.ink;
  ctx.font = `700 ${tools.fontPx(26)}px ${FONT}`;
  fillTextFitted(ctx, upperForPaint(cloudsKickoffStamp(content, undefined, locale), locale), 56, h - 20, w - 112);
}

/**
 * One aces float's name plate: brushed sky-bronze ground, cream ink, the
 * trainer's name — the siblings' cast-metal plaque tier translated to the
 * isles' float vocabulary. Pure 2D. Re-spaced for the teams station's 109 px
 * painter floor (C-105 r1): a 0.9 m plate at the landed pose can carry one
 * readable line, so the 'ACE' kicker and the ace line DROPPED (the DOM teams
 * section carries both) and the name alone paints at the floor,
 * truncate-to-fit.
 */
export function paintFloatPlaque(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  copy: { name: string; ace: string; band: string },
  tools: BoardPaintTools,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#3d4a5c');
  bg.addColorStop(0.5, '#283243');
  bg.addColorStop(1, '#1a2230');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Hairline border, pale sky-steel like the bridge fittings.
  ctx.strokeStyle = 'rgba(190, 226, 240, 0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#f2f6fa';
  ctx.font = `800 ${tools.fontPx(40)}px ${FONT}`;
  fillTextFitted(ctx, copy.name, 30, 120, w - 60);

  ctx.fillStyle = copy.band;
  ctx.fillRect(30, h - 24, w - 60, 7);
}

export interface FloatPlaqueCopy {
  name: string;
  ace: string;
  band: string;
}

/**
 * The halo gate's hanging plaque: the ruleset of record plus headline rules.
 * Landscape board (1280×512 on a 5.6 × 2.24 m face at the 21.4 m pose): a
 * tracked-caps masthead over the big ruleset name, then the four headline
 * rules as carved columns — the siblings' wide-band information tier, so the
 * text reads from the station camera instead of dissolving. Re-spaced for
 * the rules station's 58 px painter floor (C-105 r1): rule labels wrap to
 * two 58 px lines above their value; the note DROPPED (it collided with the
 * floored values and the DOM #rules section carries it).
 */
export function paintGatePlaque(
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
  weave(ctx, w, h, 9);
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
  const cols = copy.rows.length;
  const colW = (w - 120) / cols;
  ctx.strokeStyle = 'rgba(238, 246, 255, 0.2)';
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
 * defaults); every other format carves its format and best-of (always at
 * least one column), with no note, whatever row a format change left
 * behind. `locale` is optional so the function stays a `RulesCopyFn`.
 */
export function gatePlaqueCopy(
  formatRules: FormatRules | null,
  rulesetName: string | null,
  context: RulesCopyContext,
  locale: Locale = 'en',
): { title: string; rulesetName: string; rows: [string, string][]; note: string | null } {
  const copy = themePlaqueCopy(formatRules, rulesetName, context, locale, {
    titleKey: 'rules.titleIsles',
    linesLabel: 'linesPerTrainer',
  });
  return { title: copy.title, rulesetName: copy.rulesetName, rows: copy.rows, note: copy.note };
}

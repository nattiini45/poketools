import type { BoardContent, BoardFixtureStatus } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { Locale } from '@/i18n/config';
import { upperForPaint } from '@/i18n/core';
import type { FormatRules } from '@/types/format-rules';
import type { RulesCopyContext } from '@/components/world/sections/types';
import type { WorldRosterTile } from '@/lib/worlds/route-data';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  livePair,
  boardRowHeadline,
  indexGutter,
  lineStep,
  liveUnderline,
  paintDashPair,
  paintDashedLine,
  boardRowTexts,
  dashedLineWidth,
  fitLinesCondensed,
  linePillExtra,
  liveMatchPair,
  paintAutoFit,
  readableRenderedBand,
  paintKickerLine,
  readableFace,
  paintSignedNumber,
  readableAccent,
  signStrokePx,
  stackStep,
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
  type ThemePlaqueCopy,
} from '../../paint-copy';

/**
 * Canvas painters for the sakura park's content surfaces — the jumbotron
 * rock screen, the festival banners, the lantern shrine roster wall and the
 * torii plaque. Pure 2D, no React and no three imports (the furniture mounts
 * the results through `./use-painted-texture.ts`, whose board-page hook routes
 * every page through the engine's shared `paintBoardPage` clamp). Every word
 * painted here follows the viewer (i18n D11): it comes from the
 * `world-themes` namespace through `../../paint-copy` in the `locale` the
 * mount passes (`useLocale()`, read before the texture is built), and the
 * typed board status words are translated at this boundary.
 *
 * C-105 r1 font floors: every painter signature carries the shared path's
 * `tools` and EVERY font px literal routes through `tools.fontPx` — the clamp
 * (station pose-derived, painter-space) decides what ships. Layout was
 * re-spaced to the floored px (pulse floor 39, frieze 40, torii plaque 117
 * painter px — C-102 r3 keeps the plaque's derived floor by growing the
 * declared width WITH the physical face); canvas constants are
 * unchanged — except where C-102 r2
 * WIDENED a face so the floored px hold whole words: the ace plaque canvas
 * doubled (512 → 1024) with its 0.62 → 1.4 m physical face (floor 158 → 140
 * painter px), and the nobori cloth grew 1.15 → 2.0 m at its 1:3 ratio
 * (floor 58 → 33 painter px) with every line re-flowed wrap-to-fit, so the
 * longest real fixture names render COMPLETE (the r1 visual review's criterion-6
 * defect). Widths are measured, not estimated: see
 * gauntlet/evidence/_ccC102r2-raw-measure.log.
 */

const FONT = "system-ui, 'Segoe UI', sans-serif";

/** Screen face of the jumbotron rock — 16:9, matches the rock's face. */
export const BOARD_TEX_W = 1280;
export const BOARD_TEX_H = 720;

/** One festival banner face — 1:3 portrait nobori. */
export const BANNER_TEX_W = 320;
export const BANNER_TEX_H = 960;

/** The lantern shrine wall's roster frieze — 4:1 band. */
export const ROSTER_TEX_W = 2048;
export const ROSTER_TEX_H = 512;

/**
 * Torii plaque face — portrait. C-102 r3: 640 → 872 wide (height unchanged;
 * the physical tablet grew 1.4 → 1.9 m wide with the height kept) so the
 * measured "STANDARD" ruleset line — 670 px at the (unchanged) 117 px rules
 * floor — fits the painter width whole instead of running into the plaque
 * border. Growing the declared width WITH the physical face keeps the derived
 * floor where C-105 put it (floorPaint ∝ declaredW/worldW); growing the
 * declared width alone would have raised the floor and re-clipped (the
 * floor-width law).
 *
 * C-106 r3: 872×896 → 1193×1355 (the tablet grew 1.9×1.95 m → 2.6×2.95 m,
 * both axes proportional to the canvas) so the compact rules summary rows —
 * the body rows the r2 chief found missing at the plaque seat — fit BELOW
 * the title block at the same 117 px floor (both faces grow WITH the
 * declared canvas, so floorTex ∝ worldW/texW is unchanged: still 234 shipped
 * / 117 painter px). Title-scale text crammed onto the old face was the
 * failed approach; these rows are floored ledger lines on new vertical area.
 */
export const PLAQUE_TEX_W = 1193;
export const PLAQUE_TEX_H = 1355;

/** The typed status as its painted pill (`OPEN` / `LIVE` / `FT`) — never painted raw. */
export function statusWord(status: BoardFixtureStatus, locale: Locale = 'en'): string {
  return statusPill(status, locale);
}

/**
 * Footer ticker for the jumbotron rock, shaped locally from the content's
 * own fields in the viewer's language. Fidelity W1 r3: the shared ticker
 * order (board-text.ts) — a past `next` beside a LIVE row is never painted
 * as the next kickoff.
 */
export function sakuraKickoffStamp(content: BoardContent, nowMs: number = Date.now(), locale: Locale = 'en'): string {
  return leagueStamp(content, nowMs, locale);
}

/**
 * The authored stand-in for a standings screen whose season has no results yet
 * — the park's boards never go blank, and the copy says what the league is
 * waiting for (the plaza `paintEmptyState` discipline, translated at this
 * boundary like the stamp above). `null` once the table has its first row, so
 * the caller cannot paint a stale placeholder over real standings.
 *
 * The copy is one short line on purpose: at the pulse station's 39 px floor a
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
    copy: paintText(locale, 'empty.formsPark'),
  };
}

/** The empty state's box: the table region between masthead and footer band. */
const STANDINGS_EMPTY_BOX = { x: 120, y: 258, h: 300 } as const;

/**
 * Dashed placeholder card + two centred lines, drawn in the table region.
 * Every px goes through `tools.fontPx`, so the pose-derived floor applies to
 * the placeholder exactly as it does to real rows — an empty board is still
 * read from the same 21 m pose.
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
  ctx.font = `800 ${tools.fontPx(46)}px ${FONT}`;
  ctx.fillText(copy.headline, w / 2, box.y + 124);
  ctx.fillStyle = colors.ink;
  ctx.font = `600 ${tools.fontPx(30)}px ${FONT}`;
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

/**
 * The jumbotron screen's emission intensities, day and night —
 * JumbotronRock.tsx (`emissiveIntensity={night ? 1.35 : 1.05}`, black base).
 * Kept in step by hand until the mount imports it (hand-off to its owner).
 */
export const JUMBOTRON_EMISSION: readonly number[] = [1.05, 1.35];

/** The jumbotron's translucent text inks (kicker detail, header/cells) — linted with the body ink. */
const JUMBOTRON_TEXT_INKS: readonly string[] = ['rgba(240, 248, 255, 0.75)', 'rgba(240, 248, 255, 0.85)'];

/**
 * The jumbotron rock's screen: a dusk-teal LED field with the league
 * masthead, the top-of-the-table standings rows (rank movement included) and
 * the footer ticker strip. Content comes from `buildBoardContent(data, locale)`
 * — nothing here invents data. Re-spaced for the pulse station's 39 px
 * painter floor (C-105 r1; fidelity W1 r2 moved the stage line onto the
 * kicker baseline and stacked the rest from measured px), the name column moved right of the 39 px movement glyphs, and the footer
 * strip grown to carry 39 px text.
 */
export function paintBoardPage(
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
  // accent lifts to 5:1. The r5 renders put the day teal's body ink at ≈ 4.1:1 and the pink ranks/points at
  // ≈ 2.8:1. A palette that already
  // passes is returned unchanged.
  colors = readableFace(colors, JUMBOTRON_TEXT_INKS, JUMBOTRON_EMISSION);
  ctx.fillStyle = colors.field;
  ctx.fillRect(0, 0, w, h);

  // Faint scanline microstructure — a screen, not a poster.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);

  // Masthead (fidelity W1 r2, audit issue 8 carried to this board — the
  // clouds flagship / mountain summit treatment): the stage line used to
  // ride its own baseline (184) 36 px above the table header (220) at the
  // 39 px floor, so "Second Half · Matchday 2" touched "# TRAINER". It now
  // shares the kicker baseline (`paintKickerLine`: the STANDINGS brand is
  // kept while it fits, and drops first when it does not), and every
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
    { text: paintText(locale, 'heading.standings'), font: `800 ${kickerPx}px ${FONT}`, color: colors.accent },
    {
      text: stageMatchdayLine(content.stage, content.round, locale),
      font: `600 ${kickerPx}px ${FONT}`,
      color: 'rgba(240, 248, 255, 0.75)',
    },
    56,
    kickerY,
    w - 112,
    fillTextFitted,
  );
  ctx.fillStyle = colors.ink;
  // Fidelity wave 2: the masthead auto-fits (52 px down to the floor) before
  // any ellipsis — it used to paint unfitted, so a long league name ran
  // under the LIVE pill.
  const pillReserve = content.live ? 304 + 8 : 0;
  paintAutoFit(
    ctx,
    (px) => `700 ${px}px ${FONT}`,
    upperForPaint(content.league, locale),
    56,
    leagueY,
    w - 112 - pillReserve,
    leaguePx,
    tools.fontFloorPx,
  );
  if (content.live) {
    // C-102 r3: the pill derives its width from the MEASURED label at the
    // floored px (the measured-widths discipline of the floor-width
    // law). The fixed 304/280 pill clipped the real live pair "LIVE WELLS–AY"
    // (296 px measured at the 39 px pulse floor) to "LIVE WELLS…" — the r2
    // visual review's ellipsis on the hero station's largest text surface. The pill
    // grows to label + 20 px of pad, capped so it never crosses the league
    // masthead's measured end (+8 px gap); fillTextFitted remains the honest
    // fitted fallback for out-of-cap data.
    ctx.fillStyle = colors.accent;
    ctx.font = `800 ${tools.fontPx(26)}px ${FONT}`;
    const label = paintText(locale, 'livePill', { home: content.live.home, away: content.live.away });
    const labelW = Math.ceil(ctx.measureText(label).width);
    ctx.font = `700 ${tools.fontPx(52)}px ${FONT}`;
    const mastheadEnd = 56 + Math.ceil(ctx.measureText(upperForPaint(content.league, locale)).width);
    const pillW = Math.max(120, Math.min(Math.max(304, labelW + 20), w - 56 - mastheadEnd - 8));
    const pillX = w - 56 - pillW;
    roundRect(ctx, pillX, 92, pillW, 58, 10);
    ctx.fill();
    ctx.fillStyle = colors.field;
    ctx.font = `800 ${tools.fontPx(26)}px ${FONT}`;
    fillTextFitted(ctx, label, pillX + 10, 134, pillW - 20);
  }

  // Table header + rows, stacked from the masthead at ≥ 1.2 line boxes: at
  // the 39 px floor header 190, row 1 237, pitch 52, row 8 601 — clear of
  // the footer strip (h − 76 = 644). A floor that no longer fits eight rows
  // drops the lowest rows, never the leading.
  const rowH = Math.max(52, lineStep(rowPx));
  const rowStart = headerY + stackStep(headerPx, rowPx);
  const rowLimit = h - 76 - 30;
  const rowCap = Math.max(0, Math.min(8, Math.floor((rowLimit - rowStart) / rowH) + 1));
  const rows = content.table.slice(0, rowCap);
  if (content.table.length === 0) {
    paintStandingsEmpty(ctx, w, STANDINGS_EMPTY_BOX, colors, tools, standingsEmptyState(content, locale));
  } else {
    ctx.font = `800 ${headerPx}px ${FONT}`;
    ctx.fillStyle = 'rgba(240, 248, 255, 0.85)';
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
      // Name column at 176: the 39 px movement glyphs (▲12 ≈ 68 px from x=96)
      // end at ≈164 — the old 120 px column collided at the floor.
      fillTextFitted(ctx, row.name, 176, y, w - 352 - 176 - 24);
      // Rank movement glyph: ▲▼· — the contract's rankChange, painted.
      if (row.rankChange !== null && row.rankChange !== 0) {
        ctx.fillStyle = row.rankChange > 0 ? '#6fd7a8' : '#f0876f';
        ctx.font = `800 ${tools.fontPx(24)}px ${FONT}`;
        ctx.fillText(row.rankChange > 0 ? `▲${row.rankChange}` : `▼${-row.rankChange}`, 96, y - 4);
      }
      ctx.font = `600 ${tools.fontPx(28)}px ${FONT}`;
      ctx.fillStyle = 'rgba(240, 248, 255, 0.85)';
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

  // Footer ticker strip — grown 64 → 76 so the floored 39 px line clears it.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, h - 76, w, 76);
  ctx.fillStyle = colors.ink;
  ctx.font = `700 ${tools.fontPx(26)}px ${FONT}`;
  fillTextFitted(ctx, upperForPaint(sakuraKickoffStamp(content, undefined, locale), locale), 56, h - 22, w - 112);
}

export interface BannerPayload {
  /** Banner heading, e.g. 'FIXTURES' or 'RESULTS'. */
  heading: string;
  /**
   * Rows with a detail line. Only a `match` row (the default kind) paints
   * "vs"; stat and standing rows carry their own kinds (board-text.ts —
   * audit issue 7's "8 vs TRAINERS" / "1. WELLS vs 4–1").
   */
  rows: BoardRow[];
  /** Small footer line under the rows. */
  footer: string | null;
}

/**
 * The five festival-banner payloads (fixtures, up next, results, pulse,
 * table), built from `buildBoardContent(data, locale)`. Pure, so the copy is
 * testable without the scene — the sakura twin of mountain's
 * `buildTrailSignPayloads`.
 *
 * Fidelity W1 r2 (audit issue 7, still live in sakura after r1): the
 * caller built the PULSE and TABLE rows on the home/away fixture schema, so
 * the banners painted "8 vs TRAINERS", "2 vs MATCHDAY" and "1. WELLS vs
 * 4–1". Here the pulse rows are `stat` rows and the table rows `standing`
 * rows (board-text.ts); only a fixture or result is a `match` row, the one
 * kind `boardRowHeadline` joins with "vs". FestivalBanners.tsx adopts this
 * builder (its owner's one-line swap — see the r2 hand-off).
 */
export function buildFestivalBannerPayloads(
  content: BoardContent,
  nowMs: number = Date.now(),
  locale: Locale = 'en',
): BannerPayload[] {
  const upcoming: BoardRow[] = content.upcoming.map((f) => ({
    home: f.home,
    away: f.away,
    detail: `${paintText(locale, 'matchdayShort', { n: f.matchday })} · ${f.date} ${f.time} · ${statusWord(f.status, locale)}`,
    accent: isLiveFixture(f.status),
    live: isLiveFixture(f.status),
  }));
  const later: BoardRow[] = content.later.map((f) => ({
    home: f.home,
    away: f.away,
    detail: `${paintText(locale, 'matchdayShort', { n: f.matchday })} · ${f.date} ${f.time}`,
  }));
  const results: BoardRow[] = content.results.map((r) => ({
    home: r.home,
    away: r.away,
    detail: `${r.score} · ${r.date}`,
    accent: r.winner === 'home',
  }));
  const pulse: BoardRow[] = [
    {
      kind: 'stat',
      text: paintText(locale, 'trainers', { count: content.participants }),
      detail: paintText(locale, 'matchesPlayed', { count: content.completed }),
    },
    {
      kind: 'stat',
      text: paintText(locale, 'matchday', { n: content.round }),
      detail: upperForPaint(content.stage, locale),
    },
  ];
  const table: BoardRow[] = content.top.map((row, i) => ({
    kind: 'standing' as const,
    rank: i + 1,
    name: row.name,
    record: `${row.wins}–${row.losses}`,
    detail: standingDetail(row.points, row.rankChange, locale),
  }));
  return [
    // Fidelity W1 r3: the tail follows the shared ticker order — never
    // `NEXT 9/17 18:00` under the LIVE row of that same kickoff.
    // Fidelity wave 2: cloth footers pair with `vs` (`liveMatchPair`) — the
    // rect dash between two names read as `=` on the 390 cloths.
    { heading: paintText(locale, 'heading.fixtures'), rows: upcoming, footer: kickoffLine(content, nowMs, locale, liveMatchPair) },
    { heading: paintText(locale, 'heading.upNext'), rows: later, footer: null },
    { heading: paintText(locale, 'heading.results'), rows: results, footer: content.lastMatchdayLabel },
    // The PULSE banner is a stat banner: no `vs` on it (audit issue 7) — its
    // live tail keeps the rect dash, now a ≥ 3:1 bar padded clear of the weave.
    {
      heading: paintText(locale, 'heading.pulse'),
      rows: pulse,
      footer: content.live
        ? paintText(locale, 'kickoffLive', { pair: livePair(content.live.home, content.live.away) })
        : null,
    },
    { heading: paintText(locale, 'heading.table'), rows: table, footer: null },
  ];
}

/**
 * The cloths' emission intensities, night and day — FestivalBanners.tsx's
 * self-lit cloth material (`emissiveIntensity={night ? 0.6 : 0.95}` on a
 * black base colour). The painter cannot see the theme, so every ink choice
 * below must hold at BOTH (fidelity wave 2). Kept in step with the mount by
 * hand until the mount imports this constant (hand-off to its owner).
 */
export const BANNER_EMISSION: readonly number[] = [0.6, 0.95];

/**
 * The banner's brand band — its ground AND its word ink, chosen together
 * on the RENDERED cloth (fidelity wave 2, W1 residual 2). r5 picked the ink
 * in texture space (`bestInk` on the accent hex): white won, and lit ×0.95
 * and AgX-graded it rendered grey-on-salmon at 2.57:1 in the light theme
 * (measured on r5-w1-sakura-light-schedule-1440.png). No candidate ink
 * reaches 4.5:1 on the salmon as authored at both emissions, so the band
 * itself shifts along its hue (`readableRenderedBand`): the light theme's
 * band deepens to a brick red under white, the dark theme's lifts to a pale
 * salmon under black — each ≥ 4.5:1 in the model at night AND day.
 */
export function bannerBand(colors: { cloth: string; ink: string; accent: string }): { band: string; ink: string } {
  const pick = readableRenderedBand(colors.accent, [colors.ink, '#ffffff', colors.cloth, '#000000'], BANNER_EMISSION);
  return { band: pick.band, ink: pick.ink };
}

/** The footer band word's ink (see `bannerBand`). */
export function bannerBandInk(colors: { cloth: string; ink: string; accent: string }): string {
  return bannerBand(colors).ink;
}

/**
 * One festival banner: festival-cotton ground, ink heading brush, fixture
 * rows in tally strokes. Painted once per banner; data from
 * `buildBoardContent(data, locale)`. C-102 r2: the r1 single-line row
 * (truncate-to-fit) clipped mid-word at the schedule station's floored px —
 * the cloth now hangs at 2.0 × 6.0 m (1:3, FestivalBanners), which drops the
 * pose-derived floor to 33 painter px, and EVERY line re-flows wrap-to-fit at
 * widths that hold full tokens: pair lines wrap to at most two lines, detail
 * lines to two, the league band wraps to two whole lines. Measured against
 * the real fixture set ("WARREN vs HOFFMAN", "MD 2 · 9/17 18:00 · OPEN",
 * "1. HOFFMAN vs 12–4" — see _ccC102r2-raw-measure.log): all four fixture
 * rows of every banner fit complete, nothing slices, nothing truncates.
 */
export function paintBanner(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  payload: BannerPayload,
  colors: { cloth: string; ink: string; accent: string },
  tools: BoardPaintTools,
  locale: Locale = 'en',
): void {
  ctx.fillStyle = colors.cloth;
  ctx.fillRect(0, 0, w, h);
  // Woven cloth: quiet horizontal thread bands.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
  for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);

  const maxW = w - 56;
  const floor = tools.fontPx(24);
  // Fidelity W1 r4: accent rows (LIVE, results winners) paint in the accent
  // mixed toward ink until it clears the target on the cloth — the light
  // theme's salmon-on-cream LIVE line read under 3:1. Fidelity wave 2: the
  // target is measured on the RENDERED cloth at both emissions (r5's
  // texture-space 7:1 rendered 3.1:1).
  const rowAccent = readableAccent(colors.accent, colors.cloth, colors.ink, BANNER_EMISSION);
  // Fidelity wave 2: LIVE is a filled pill on every cloth line that carries
  // it (the four worlds' shared live marker), in the cloth colour on the
  // readable accent — the pair clears the row target by construction. Each
  // rect dash is padded clear of the weave (`ground`).
  const dressing = { ground: colors.cloth, pill: { word: livePillWord(locale), fill: rowAccent, ink: colors.cloth } };
  const pillRoom = linePillExtra(floor);
  const budgetFor = (text: string) => (hasLivePill(text, locale) ? maxW - pillRoom : maxW);
  // Fidelity W1 r1 (audit issue 8): both pitches come from the shared
  // text law — the detail pitch was 1.1 × floor, under the 1.2 minimum.
  const pairPitch = lineStep(floor, 1.22);
  const detailPitch = lineStep(floor);
  // Bottom band carrying the league name WHOLE. Fidelity wave 2 (W1
  // residual 2): at the 390 cloth's 40 px floor the plain two-line wrap
  // needed three lines and cut "LEAGUE"; `fitLinesCondensed` condenses the
  // lines (≥ 0.72) before it wraps further, and a band that still needs a
  // third line GROWS — no word is ever dropped.
  const band = bannerBand(colors);
  ctx.font = `800 ${floor}px ${FONT}`;
  const brand = fitLinesCondensed(ctx, paintText(locale, 'brand.sakuraBand'), maxW, 2);
  const bandH = pairPitch * Math.max(2, brand.lines.length) + 16;

  // Top and bottom bands, brushed in the (rendered-readable) festival band.
  ctx.fillStyle = band.band;
  ctx.fillRect(0, 0, w, 18);
  ctx.fillRect(0, h - bandH, w, bandH);
  ctx.fillStyle = band.ink;
  ctx.textAlign = 'left';
  brand.lines.forEach((line, i) => {
    const natural = ctx.measureText(line).width;
    const squeeze = brand.squeeze[i] ?? 1;
    ctx.save();
    ctx.translate(w / 2 - (natural * squeeze) / 2, h - bandH + 38 + i * pairPitch);
    ctx.scale(squeeze, 1);
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });

  ctx.fillStyle = colors.ink;
  // Fidelity wave 2: auto-fit (46 px down to the floor), then ellipsis.
  paintAutoFit(ctx, (px) => `900 ${px}px ${FONT}`, payload.heading, 28, 92, maxW, tools.fontPx(46), tools.fontFloorPx);
  ctx.fillStyle = band.band;
  ctx.fillRect(28, 114, 120, 8);

  let y = 160;
  // A banner with no rows still says so — an empty cloth reads as a printing
  // fault, not as "nothing scheduled".
  if (payload.rows.length === 0) {
    ctx.fillStyle = colors.ink;
    ctx.font = `600 ${floor}px ${FONT}`;
    wrapWords(ctx, paintText(locale, 'empty.nothingPosted'), maxW, 2).forEach((line, i) => {
      ctx.fillText(line, 28, y + i * pairPitch);
    });
    y += pairPitch * 2;
  }
  // Fidelity W1 r5: every cloth line paints its en dashes as rects
  // (`paintDashedLine` — the 390 PULSE footer lost `WELLS – AY`'s dash), a
  // standing whose headline would wrap folds its record into the detail
  // (`boardRowTexts` — no `1. WELLS` / `4–1`), and the wrap never strands
  // a ≤ 2-character token (`wrapFields`' no-orphan glue — no `MATCHDAY` / `2`).
  const stroke = signStrokePx(floor, tools.fontFloorPx);
  for (let r = 0; r < payload.rows.length; r += 1) {
    const row = payload.rows[r];
    ctx.font = `800 ${floor}px ${FONT}`;
    const whole = boardRowHeadline(row);
    const texts = boardRowTexts(row, wrapFields(ctx, whole, maxW, 2).length <= 1);
    const pairLines = wrapFields(ctx, texts.headline, maxW, 2);
    ctx.font = `600 ${floor}px ${FONT}`;
    const detailLines = wrapFields(ctx, texts.detail, budgetFor(texts.detail), 2);
    const blockH =
      pairLines.length * pairPitch +
      Math.max(0, detailLines.length - 1) * detailPitch +
      44;
    // Fidelity W1 r4: a row that does not fit is COUNTED, never dropped
    // silently (mountain's trail-sign law) — the mobile cloth's re-derived
    // floor can push the last fixture off the cloth. A non-final row must
    // also leave room for that "+N MORE" line.
    const isLast = r === payload.rows.length - 1;
    if (y + blockH + (isLast ? 0 : detailPitch) > h - bandH - 54) {
      ctx.fillStyle = colors.ink;
      ctx.font = `700 ${floor}px ${FONT}`;
      fillTextFitted(ctx, paintText(locale, 'more', { count: payload.rows.length - r }), 28, y, maxW);
      y += detailPitch;
      break;
    }
    ctx.fillStyle = row.accent ? rowAccent : colors.ink;
    ctx.font = `800 ${floor}px ${FONT}`;
    pairLines.forEach((line, i) => paintDashedLine(ctx, line, 28, y + i * pairPitch, floor, stroke, maxW, dressing));
    if (row.kind !== 'stat' && row.kind !== 'standing' && row.live) {
      const lastPair = pairLines[pairLines.length - 1] ?? '';
      const lastW = Math.min(maxW, dashedLineWidth(ctx, lastPair, floor, stroke));
      const rule = liveUnderline(28, y + (pairLines.length - 1) * pairPitch, lastW, floor, stroke);
      ctx.fillRect(rule.x, rule.y, rule.w, rule.h);
    }
    // Fidelity W1 r3: detail and footer lines paint in the cloth INK —
    // the faded 55–62 % black read near white-on-white in the light theme.
    ctx.fillStyle = row.accent ? rowAccent : colors.ink;
    ctx.font = `600 ${floor}px ${FONT}`;
    detailLines.forEach((line, i) =>
      paintDashedLine(ctx, line, 28, y + pairLines.length * pairPitch + i * detailPitch, floor, stroke, maxW, dressing),
    );
    y += blockH;
  }

  if (payload.footer) {
    ctx.fillStyle = colors.ink;
    ctx.font = `600 ${floor}px ${FONT}`;
    // The footer wraps too — the results banner's footer is the finished
    // matchday's label ("Second Half · Matchday 1"), which does not fit one
    // floored line whole.
    wrapFields(ctx, payload.footer, budgetFor(payload.footer), 2).forEach((line, i) => {
      paintDashedLine(ctx, line, 28, Math.min(h - bandH - 26, y + 8) + i * detailPitch, floor, stroke, maxW, dressing);
    });
  }
}

/** The roster note / secondary label ink on the stone (the 0.78 roster-note alpha). */
export const ROSTER_LABEL_INK = 'rgba(255, 255, 255, 0.78)';

/**
 * The lantern shrine wall's roster frieze: one carved tile per roster tile,
 * line number, species and the price (EPB) or the gym band (fallback).
 * C-102 r2 re-flow at the roster station's 40 px painter floor (unchanged):
 * the r1 236 px tiles held only ~7 name characters and clipped species
 * mid-word ("01BULB…"), and the price/band line ("27 PTS · PREMIUM", 351 px
 * measured) could never fit them — tiles re-flow to 470 px, three rows of
 * four, budget 21 → 12 (the note names the full-roster overflow, the same
 * self-disclosure the visual review accepted). Measured line budgets per tile: the
 * name paints on one line (worst shown species "GEODUDE-ALOLA" paints 345 of
 * the 388 px budget) and the band on one line ("27 PTS · PREMIUM" paints 351
 * of 440). See _ccC102r2-raw-measure.log.
 */
export function paintRosterWall(
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
  ctx.fillStyle = colors.stone;
  ctx.fillRect(0, 0, w, h);
  // Stone coursing joints.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 3;
  for (let y = 0; y <= h; y += h / 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  if (note) {
    // Fidelity W1 r1: 50 % → 78 % white, the mountain frieze's readable ink
    // for the same note class (the 50 % note washed out on the stone).
    ctx.fillStyle = ROSTER_LABEL_INK;
    // Fidelity wave 2: auto-fit (floor → condense ≥ 0.72) before any
    // ellipsis, so the promised count ("FOR ALL 30") is never the part cut.
    paintAutoFit(ctx, (px) => `700 ${px}px ${FONT}`, note, 48, 44, w - 96, tools.fontPx(26), tools.fontFloorPx);
  }

  if (tiles.length === 0) {
    ctx.fillStyle = colors.ink;
    ctx.font = `700 ${tools.fontPx(36)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(paintText(locale, 'empty.noRosterLines'), w / 2, h / 2 + 12);
    ctx.textAlign = 'left';
    return;
  }

  const tileW = 470;
  const gap = 12;
  const inner = w - 96;
  const perRow = Math.max(1, Math.floor(inner / (tileW + gap)));
  const rowsUsed = Math.ceil(tiles.length / perRow);
  const tileH = Math.max(96, Math.min(150, (h - 140) / Math.max(1, rowsUsed)));

  // Fixed index gutter (fidelity W1 r1, board-text.ts `indexGutter`): the
  // name column is MEASURED from the widest index painted, never less than
  // the authored x + 70 — so a wider floor can never overprint "01" into
  // the name ("01BULBASAUR", the defect the mountain/clouds friezes showed).
  const indexFont = `800 ${tools.fontPx(24)}px ${FONT}`;
  const indexLabels = tiles.map((tile) => String(tile.line).padStart(2, '0'));
  ctx.font = indexFont;
  const nameOffset = indexGutter(ctx, indexLabels, 18, 8, 70);

  tiles.forEach((tile, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = 48 + col * (tileW + gap);
    const y = 72 + row * (tileH + gap);
    if (y + tileH > h - 24) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    roundRect(ctx, x, y, tileW, tileH, 12);
    ctx.fill();
    ctx.fillStyle = colors.accent;
    ctx.fillRect(x, y, 6, tileH);

    // Line number and species share the first 40 px line (the measured "01"
    // glyph runs 44 px, so the name starts at x+70 with a 388 px budget to
    // the tile edge); the price/band the second — at the 470 px tile width
    // both hold the longest real fixture strings whole.
    // Fidelity wave 2: the index and band labels read at the roster-note
    // alpha (0.78; they were 50 % / 62 % white on the stone). The frieze is
    // a LIT face (RosterShrine: map + weak emission), which the rendered
    // contrast model does not cover — the alpha law is the guard here.
    ctx.fillStyle = ROSTER_LABEL_INK;
    ctx.font = indexFont;
    ctx.fillText(indexLabels[i], x + 18, y + 48);
    ctx.fillStyle = colors.ink;
    ctx.font = `800 ${tools.fontPx(27)}px ${FONT}`;
    fillTextFitted(ctx, upperForPaint(rosterTileName(tile, dataLocale), locale), x + nameOffset, y + 48, tileW - nameOffset - 12);
    ctx.font = `700 ${tools.fontPx(22)}px ${FONT}`;
    ctx.fillStyle = ROSTER_LABEL_INK;
    // Fidelity W1 r1: the league's price-group keys (`guenstig` …) are
    // translated at this boundary (shared `priceBandLabel` via
    // `rosterBandLine`), never painted raw ("27 PTS · GUENSTIG").
    const band = rosterBandLine(tile, locale, dataLocale, 'dot');
    fillTextFitted(ctx, band, x + 18, y + 98, tileW - 30);
  });
}

/**
 * The statuary pedestal's name plaque face. C-102 r2: 512 → 1024 wide (height
 * unchanged) with the physical face widened 0.62 → 1.4 m (AceStatuary) so the
 * teams station's floored name line — 140 painter px, pose-derived, per
 * `stationFontFloorPx` — holds the longest real trainer name ("Toby Warren",
 * 901 px of the 964 px line budget, measured) COMPLETE instead of clipping to
 * "Ma…"/"Jon…" (the r1 visual review's criterion-6 defect). The font never drops below
 * the floor: the face grows, the derived floor follows the geometry down, and
 * the clamp still enforces it by construction.
 */
export const ACE_PLAQUE_TEX_W = 1024;
export const ACE_PLAQUE_TEX_H = 176;

/**
 * One statuary pedestal's name plaque (C-093 r3 density pass): walnut
 * lacquer ground, cream ink, the trainer's name — and the gym band as a foot
 * rule. A 0.62 m face at the landed pose could carry exactly one readable
 * line, so the 'ACE' kicker and the ace line DROPPED (the DOM teams section
 * carries both) and the name alone paints at the floor, truncate-to-fit —
 * C-102 r2 doubled the canvas and widened the physical face so the floor fits
 * the whole name (see the constants' note above).
 */
export function paintAcePlaque(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  copy: { name: string; ace: string; band: string },
  tools: BoardPaintTools,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#453427');
  bg.addColorStop(0.5, '#2e2118');
  bg.addColorStop(1, '#1d140e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Hairline border, brass-warm like the lantern boxes' fittings.
  ctx.strokeStyle = 'rgba(236, 206, 146, 0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#f6ecd6';
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
 * The torii's hanging plaque: the ruleset of record plus a compact summary
 * of the headline rules. Re-spaced for the rules station's pose-derived
 * painter floor (C-105 r1: 117 px at the 1.4 m tablet; C-102 r3: the tablet
 * grew to 1.9 m WITH its declared width, so the floor stays 117; C-106 r3:
 * 1.9×1.95 m → 2.6×2.95 m with the canvas both axes — floor STILL 117, and
 * the compactRows ledger now fits below the title block at the floored px).
 * Title and ruleset wrap at the floored px (greedy word-wrap, two lines
 * each); the four compact rule rows are label-left/value-right floored
 * ledger lines — the DOM #rules section still carries the full rules
 * verbatim via `plaqueCopy().rows`.
 */
export function paintPlaque(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  copy: {
    title: string;
    rulesetName: string;
    rows: [string, string][];
    compactRows: [string, string][];
    note: string | null;
  },
  colors: { ground: string; ink: string; accent: string },
  tools: BoardPaintTools,
  locale: Locale = 'en',
): void {
  ctx.fillStyle = colors.ground;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(16, 16, w - 32, h - 32);

  const maxW = w - 112;
  let y = 140;
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.accent;
  ctx.font = `800 ${tools.fontPx(38)}px ${FONT}`;
  for (const line of wrapWords(ctx, upperForPaint(copy.title, locale), maxW, 2)) {
    ctx.fillText(line, w / 2, y);
    y += 134;
  }
  ctx.fillStyle = colors.ink;
  ctx.font = `800 ${tools.fontPx(62)}px ${FONT}`;
  for (const line of wrapWords(ctx, upperForPaint(copy.rulesetName, locale), maxW, 2)) {
    ctx.fillText(line, w / 2, y);
    y += 134;
  }
  ctx.fillStyle = colors.accent;
  ctx.fillRect(w / 2 - 110, y - 92, 220, 8);
  ctx.textAlign = 'left';

  // C-106 r3 body rows: the compact rules summary at the SAME floored px as
  // the title (the clamp floors these — nothing sub-floor can ship). Ledger
  // layout: label left in ink, value right in accent. When no rules are
  // configured the note takes the rows' place (centered, wrapped).
  const rowFont = `800 ${tools.fontPx(38)}px ${FONT}`;
  let ry = 700;
  if (copy.note) {
    ctx.font = rowFont;
    ctx.fillStyle = colors.ink;
    ctx.textAlign = 'center';
    for (const line of wrapWords(ctx, upperForPaint(copy.note, locale), maxW, 4)) {
      ctx.fillText(line, w / 2, ry);
      ry += 140;
    }
    ctx.textAlign = 'left';
    return;
  }
  for (const [label, value] of copy.compactRows) {
    ctx.font = rowFont;
    ctx.fillStyle = colors.ink;
    ctx.fillText(upperForPaint(label, locale), 56, ry);
    ctx.fillStyle = colors.accent;
    ctx.textAlign = 'right';
    ctx.fillText(upperForPaint(value, locale), w - 56, ry);
    ctx.textAlign = 'left';
    ry += 140;
  }
}

/**
 * Plaque copy from the contract's rules fields, in the viewer's language —
 * pure shaping (`themePlaqueCopy`). The format decides the rows (`context`):
 * Evolution Point Buy paints the draft numbers (its row, else the league
 * defaults with the defaults note); every other format paints its mode and
 * best-of, with no note, whatever row a format change left behind. C-106 r3:
 * `compactRows` is the plaque's own one-line-per-pair summary (measured at
 * 117 px: longest pair `TERA`+`STAB ONLY` ≈ 973 of the 1081 px painter
 * width). `locale` is optional so the function stays a `RulesCopyFn`.
 */
export function plaqueCopy(
  formatRules: FormatRules | null,
  rulesetName: string | null,
  context: RulesCopyContext,
  locale: Locale = 'en',
): ThemePlaqueCopy {
  return themePlaqueCopy(formatRules, rulesetName, context, locale, {
    titleKey: 'rules.titlePark',
    linesLabel: 'linesPerTrainer',
  });
}

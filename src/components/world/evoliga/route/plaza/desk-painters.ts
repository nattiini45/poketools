/**
 * Canvas painters for the west Poké Center station (`#roster`).
 *
 * One painter module per station, mirroring `board/board-painters.ts`: the
 * kiosk screen, the layered holo sheets, the interior wall behind the glass,
 * the fascia emissive map and the wet apron all draw here, and `CenterDesk` /
 * `DeskHolo` only upload the result. Pure 2D — no React, no three imports —
 * so the surfaces stay testable and the components stay about massing.
 *
 * Roster inputs are format-flexed: tiles arrive either from the point-buy
 * list or — on formats without one — derived from the season participants
 * (`deriveRosterTiles` in `src/lib/worlds/route-data.ts`). Participant tiles
 * carry `price: null` and the gym band as their group, so both paint paths
 * print the band label instead of a price. Every word comes from
 * `paint.desk` in the viewer's `locale` (i18n D11) and every line name from
 * the Pokémon-data layer in `dataLocale`; both arrive before the textures are
 * built. Absent (hand-built test inputs), the faces paint the plaza's
 * historical German chrome and the names as stored.
 */
import type { Locale } from '@/i18n/config';
import type { WorldRosterTile } from '@/lib/worlds/route-data';
import { autoFit, priceBandLabel } from '@/lib/route-world/board-text';
import { paintCaps } from '@/lib/route-world/paint-copy';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

const FONT = "system-ui, 'Segoe UI', sans-serif";

/** Rotom PC screen — portrait, 0.96 : 1.42, matching the kiosk pane aspect. */
export const ROSTER_TEX_W = 692;
export const ROSTER_TEX_H = 1024;
/** Holo board: the wide self-lit back field (C-106 r3: the count/chip
 * sheet canvases were removed with their painters). */
export const HOLO_FIELD_W = 768;
export const HOLO_FIELD_H = 512;
/** Interior back wall behind the black glass. */
export const INTERIOR_TEX_W = 1024;
export const INTERIOR_TEX_H = 512;
/** Fascia band emissive map — panel seams across a red extrusion. */
export const FASCIA_TEX_W = 512;
export const FASCIA_TEX_H = 128;
/** Wet apron slabs (colour + roughness share the size). */
export const APRON_TEX = 512;

/** `#rrggbb` + alpha → `rgba()`. */
export function hexA(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mix two `#rrggbb` colours in sRGB (`t` = share of `toward`) → `#rrggbb`. */
export function mixHex(hex: string, toward: string, t: number): string {
  const a = hex.replace('#', '');
  const b = toward.replace('#', '');
  const k = Math.min(1, Math.max(0, t));
  let out = '#';
  for (let i = 0; i < 6; i += 2) {
    const va = parseInt(a.slice(i, i + 2), 16);
    const vb = parseInt(b.slice(i, i + 2), 16);
    out += Math.round(va + (vb - va) * k)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

/**
 * Kiosk screen ground + inks (fidelity wave 2 r2, W1 contrast). The kiosk
 * face is ≈ 155 × 222 CSS px at 1440 — its 692 px texture lands at ≈ 0.22
 * scale, so every glyph is mip-blended into its ground. Measured on the
 * RENDERED frame (w2 r1 `desk-pc`: min 2.3–2.5, median 3.9 — the teal ground
 * lifted to ≈ 0.10 relative luminance by the × 1.8 emissive), the fix is a
 * near-black ground, a fainter tile fill and light inks (accent and red
 * pulled toward white) instead of saturated mid-luminance accent text.
 */
export const KIOSK_GROUND = ['#021519', '#010c11', '#00060a'] as const;
/** Unselected tile fill — kept faint so the ground under glyphs stays dark. */
export const KIOSK_TILE_FILL = 'rgba(228, 252, 250, 0.035)';
/** Primary kiosk ink (masthead title, tile names). */
export const KIOSK_INK = '#f4fffc';
/** Share of white mixed into accent / red for small secondary text. */
export const KIOSK_SUB_LIFT = 0.45;
/** Ink on the selected (accent-filled) tile — solid, never alpha-thinned. */
export const KIOSK_SELECTED_INK = '#02181c';
/** Phosphor scanline alpha on the kiosk (was 0.15 — at 0.22 scale it only greyed the ink). */
export const KIOSK_SCANLINE_ALPHA = 0.08;

/** Rounded-rect path — never relies on `CanvasRenderingContext2D.roundRect`. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT}`;
}

/** Phosphor scanlines. Alpha stays low so the emissive face keeps its HDR head-room. */
function scanlines(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  ctx.fillStyle = `rgba(4, 12, 18, ${alpha})`;
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}

/** Corner ticks — the shared holo/kiosk frame identity. */
function cornerTicks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string,
  tick: number,
): void {
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  (
    [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ] as const
  ).forEach(([cx, cy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(cx + sx * tick, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * tick);
    ctx.stroke();
  });
}

/** Poké-Ball glyph — the resident placeholder while a sprite is still in flight. */
function ballGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, red: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.fillStyle = hexA(red, 0.55);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI);
  ctx.fillStyle = 'rgba(226, 236, 240, 0.4)';
  ctx.fill();
  ctx.fillStyle = 'rgba(10, 14, 18, 0.75)';
  ctx.fillRect(cx - r, cy - r * 0.11, r * 2, r * 0.22);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 14, 18, 0.75)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(232, 244, 248, 0.85)';
  ctx.fill();
  ctx.restore();
}

// ── Kiosk screen: the live roster grid ──────────────────────────────────────

export interface RosterTile {
  id: string;
  line: number;
  name: string;
  /** Point-buy price; null on participant-derived tiles (band label prints instead). */
  price: number | null;
  group: string;
  /** HOME sprite through `/api/proxy-image`; null until it decodes (PB-078). */
  sprite: CanvasImageSource | null;
}

/**
 * Bridge from the generic contract's roster tiles to the kiosk's paint input:
 * `spriteFor` resolves each tile's species to its loaded sprite (null → the
 * resident Poké-Ball glyph). EPB tiles keep their point-buy price; fallback
 * tiles carry `price: null` and print their band.
 */
export function toRosterTiles(
  tiles: WorldRosterTile[],
  spriteFor: (name: string) => CanvasImageSource | null,
): RosterTile[] {
  return tiles.map((tile) => ({
    id: tile.id,
    line: tile.line,
    name: tile.name,
    price: tile.price,
    group: tile.band,
    sprite: spriteFor(tile.name),
  }));
}

export interface RosterScreen {
  tiles: RosterTile[];
  /** Total live point-buy lines, not the tile count. */
  total: number;
  /** Roster slots still unclaimed — the number the holo card repeats. */
  open: number;
  accent: string;
  red: string;
  /** Index of the tile the kiosk has pre-selected (the `?mon=` panel target). */
  selected: number;
  /** The viewer's UI locale (chrome words). */
  locale: Locale;
  /** The viewer's Pokémon-data locale (line names); absent = names as stored. */
  dataLocale?: Locale;
}

/** A line's name in the viewer's Pokémon-data language. */
function lineName(name: string, dataLocale: Locale | undefined): string {
  return dataLocale ? localizeSpecies(name, dataLocale) : name;
}

/**
 * Paint one line fitted into `maxW` at the current alignment (the shared fit
 * law: shrink toward `floorPx`, condense, then ellipsize). A line that fits
 * paints exactly as a plain `fillText` at `px`.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  weight: number,
  text: string,
  x: number,
  y: number,
  maxW: number,
  px: number,
  floorPx: number,
): void {
  const fit = autoFit(
    ctx,
    (size) => {
      ctx.font = font(weight, size);
    },
    text,
    maxW,
    px,
    floorPx,
  );
  if (fit.squeeze === 1) {
    ctx.fillText(fit.text, x, y);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(fit.squeeze, 1);
  ctx.fillText(fit.text, 0, 0);
  ctx.restore();
}

const GRID_COLS = 3;
const GRID_ROWS = 3;
export const ROSTER_GRID_TILES = GRID_COLS * GRID_ROWS;

/**
 * The Rotom PC face: German masthead, then a 3 × 3 grid of point-buy lines,
 * each tile carrying its HOME sprite, the line name and the price. Drawn
 * opaque — this is an emissive screen, not a holo.
 */
export function paintRosterGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  screen: RosterScreen,
): void {
  const { accent, red, tiles, total, open, selected } = screen;
  const { locale } = screen;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, KIOSK_GROUND[0]);
  bg.addColorStop(0.55, KIOSK_GROUND[1]);
  bg.addColorStop(1, KIOSK_GROUND[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const accentInk = mixHex(accent, '#ffffff', KIOSK_SUB_LIFT);
  const redInk = mixHex(red, '#ffffff', KIOSK_SUB_LIFT);

  // Masthead (left column: brand + title; right column: the two counts).
  const mastheadW = w - 36 - 40 - 170;
  ctx.textAlign = 'left';
  ctx.fillStyle = accentInk;
  fitText(ctx, 700, paintCaps(locale, 'desk.kioskBrand'), 40, 60, mastheadW, 28, 20);
  ctx.fillStyle = KIOSK_INK;
  fitText(ctx, 800, paintCaps(locale, 'desk.rosterTitle'), 36, 130, w - 36 * 2, 66, 40);

  ctx.textAlign = 'right';
  ctx.fillStyle = accentInk;
  fitText(ctx, 800, paintCaps(locale, 'desk.lines', { count: total }), w - 40, 60, 170, 28, 20);
  ctx.fillStyle = redInk;
  fitText(ctx, 800, paintCaps(locale, 'desk.open', { count: open }), w - 40, 98, 170, 28, 20);
  ctx.textAlign = 'left';

  ctx.strokeStyle = hexA(accent, 0.45);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(36, 156);
  ctx.lineTo(w - 36, 156);
  ctx.stroke();

  ctx.fillStyle = accentInk;
  fitText(ctx, 700, paintCaps(locale, 'desk.columns'), 38, 196, w - 38 * 2, 24, 18);

  // Tile grid
  const gap = 20;
  const gridTop = 216;
  const gridLeft = 32;
  const tileW = (w - gridLeft * 2 - gap * (GRID_COLS - 1)) / GRID_COLS;
  const tileH = (h - gridTop - 34 - gap * (GRID_ROWS - 1)) / GRID_ROWS;

  for (let i = 0; i < ROSTER_GRID_TILES; i += 1) {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = gridLeft + col * (tileW + gap);
    const y = gridTop + row * (tileH + gap);
    const tile = tiles[i] ?? null;
    const isSelected = tile !== null && i === selected;

    ctx.fillStyle = isSelected ? hexA(accent, 0.9) : KIOSK_TILE_FILL;
    rr(ctx, x, y, tileW, tileH, 16);
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#f4fffd' : hexA(accent, 0.4);
    ctx.lineWidth = isSelected ? 4 : 2;
    rr(ctx, x, y, tileW, tileH, 16);
    ctx.stroke();

    if (!tile) continue;

    const ink = isSelected ? KIOSK_SELECTED_INK : KIOSK_INK;
    const sub = isSelected ? KIOSK_SELECTED_INK : accentInk;

    // Sprite well
    const wellR = tileH * 0.27;
    const wellX = x + tileW / 2;
    const wellY = y + tileH * 0.36;
    ctx.beginPath();
    ctx.arc(wellX, wellY, wellR, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? 'rgba(4, 37, 43, 0.22)' : 'rgba(3, 26, 34, 0.62)';
    ctx.fill();
    ctx.strokeStyle = isSelected ? 'rgba(4, 37, 43, 0.4)' : hexA(accent, 0.3);
    ctx.lineWidth = 2;
    ctx.stroke();

    if (tile.sprite) {
      const s = wellR * 1.85;
      ctx.drawImage(tile.sprite, wellX - s / 2, wellY - s / 2, s, s);
    } else {
      ballGlyph(ctx, wellX, wellY, wellR * 0.72, red);
    }

    /** Price when the tile has one; the band label (e.g. gym type) otherwise. */
    // Review r2 (W1): the band key is ASCII ('guenstig'); paint the
    // locale's word (GÜNSTIG / VALUE), never the raw transliteration.
    const cost =
      tile.price !== null ? paintCaps(locale, 'desk.price', { price: tile.price }) : priceBandLabel(tile.group, locale);

    ctx.textAlign = 'left';
    ctx.fillStyle = sub;
    ctx.font = font(800, 22);
    ctx.fillText(String(tile.line).padStart(2, '0'), x + 16, y + 30);

    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    ctx.font = font(800, 27);
    ctx.fillText(lineName(tile.name, screen.dataLocale), wellX, y + tileH - 46, tileW - 20);

    ctx.fillStyle = sub;
    ctx.font = font(800, 24);
    ctx.fillText(cost, wellX, y + tileH - 18, tileW - 20);
    ctx.textAlign = 'left';
  }

  cornerTicks(ctx, 16, 16, w - 32, h - 32, hexA(accent, 0.8), 34);
  scanlines(ctx, w, h, KIOSK_SCANLINE_ALPHA);
}

// ── Holo board: the self-lit roster sheet above the counter ─────────────────

export interface HoloRow {
  line: number;
  name: string;
  /** Point-buy price; null on participant-derived rows (the band prints instead). */
  price: number | null;
  /** Band label for price-less rows — the participant's gym band. */
  band?: string;
}

export interface HoloCard {
  rows: HoloRow[];
  total: number;
  open: number;
  accent: string;
  /** The viewer's UI locale (chrome words). */
  locale: Locale;
  /** The viewer's Pokémon-data locale (line names); absent = names as stored. */
  dataLocale?: Locale;
}

/**
 * Back sheet (C-108): the rim, the grid weave and the roster rows on an
 * OPAQUE PURE-#000000 glass field. The old sheet was additive glass whose
 * rows washed out against the sunlit interior behind the window (the C-106
 * panel's ghost-overlay finding); additive blending cannot darken, so no
 * gain could recover the ink. The C-104 zero-emission law is the fix: the
 * field is exactly zero emission — AgX maps it to exactly black at any
 * exposure — and the ink reads by its own emission alone (the same bitmap
 * drives `map` and `emissiveMap` on the mounted pane). C-106 r3: the two
 * additive sheets that used to stack in front (the count sheet and the
 * caption chip — the green ghost layer the r2 chief confirmed) are removed
 * with their painters; this board is the station's one holo surface.
 *
 * Row geometry is the r2 station-sizing of record (33-34 px rows for the
 * ~9 m / 1 m station frame) and is kept verbatim.
 */
export function paintHoloBoard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: HoloCard,
): void {
  const { accent, rows, total } = card;
  const { locale } = card;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = hexA(accent, 0.9);
  ctx.lineWidth = 5;
  rr(ctx, 12, 12, w - 24, h - 24, 26);
  ctx.stroke();

  // Weave — faint emission lines, the pane's glass texture over the black.
  ctx.strokeStyle = hexA(accent, 0.14);
  ctx.lineWidth = 1;
  for (let x = 44; x < w - 32; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 28);
    ctx.lineTo(x, h - 28);
    ctx.stroke();
  }
  for (let y = 44; y < h - 32; y += 32) {
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(w - 28, y);
    ctx.stroke();
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = hexA(accent, 0.95);
  fitText(ctx, 600, paintCaps(locale, 'desk.holoBrand'), 46, 66, w - 46 * 2 - 180, 24, 18);
  ctx.fillStyle = '#f2fffb';
  fitText(ctx, 800, paintCaps(locale, 'desk.rosterTitle'), 42, 128, w - 42 * 2, 58, 36);
  ctx.textAlign = 'right';
  ctx.fillStyle = hexA(accent, 0.9);
  fitText(ctx, 700, paintCaps(locale, 'desk.lines', { count: total }), w - 46, 66, 170, 24, 18);
  ctx.textAlign = 'left';

  rows.slice(0, 5).forEach((row, i) => {
    const y = 158 + i * 66;
    const cost =
      row.price !== null
        ? paintCaps(locale, 'desk.price', { price: row.price })
        : row.band
          ? priceBandLabel(row.band, locale)
          : '';
    ctx.fillStyle = i === 0 ? hexA(accent, 0.62) : 'rgba(236, 254, 252, 0.2)';
    rr(ctx, 42, y, w - 84, 56, 14);
    ctx.fill();
    ctx.fillStyle = i === 0 ? '#04252b' : hexA(accent, 1);
    ctx.font = font(800, 33);
    ctx.fillText(String(row.line).padStart(2, '0'), 58, y + 39);
    ctx.fillStyle = i === 0 ? '#04252b' : '#f4fffc';
    // Long German names ("Paldea-Tauros (Flammenvariante)") condense into the
    // row before the price column instead of running under it.
    ctx.font = font(800, 34);
    ctx.fillText(lineName(row.name, card.dataLocale), 116, y + 39, w - 116 - 220);
    ctx.textAlign = 'right';
    ctx.fillStyle = i === 0 ? '#04252b' : hexA(accent, 1);
    ctx.font = font(800, 33);
    ctx.fillText(cost, w - 60, y + 39);
    ctx.textAlign = 'left';
  });

  cornerTicks(ctx, 26, 26, w - 52, h - 52, hexA(accent, 0.9), 30);
}

// ── Building surfaces ───────────────────────────────────────────────────────

/**
 * Interior back wall seen through the black glass: warm plaster, a shelf
 * bank with stock, a service door. Painted rather than modelled because it
 * is always behind two panes and never reached.
 */
export function paintInteriorWall(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  warm: string,
  locale: Locale,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#3d2418');
  bg.addColorStop(0.6, '#2a1810');
  bg.addColorStop(1, '#1c1009');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Wall panelling
  ctx.fillStyle = 'rgba(255, 226, 190, 0.05)';
  for (let x = 0; x < w; x += 96) ctx.fillRect(x + 4, 0, 88, h);

  // Shelf bank, left third
  for (let row = 0; row < 4; row += 1) {
    const y = 108 + row * 84;
    ctx.fillStyle = '#4a2f1e';
    ctx.fillRect(46, y, 300, 12);
    for (let i = 0; i < 6; i += 1) {
      const bx = 58 + i * 48;
      ctx.fillStyle = hexA(warm, 0.42 + ((row + i) % 3) * 0.16);
      ctx.fillRect(bx, y - 42, 26, 42);
    }
  }

  // Service door, right of centre
  ctx.fillStyle = '#20140c';
  ctx.fillRect(w - 330, 92, 190, h - 92);
  ctx.strokeStyle = hexA(warm, 0.35);
  ctx.lineWidth = 5;
  ctx.strokeRect(w - 330, 92, 190, h - 92);
  ctx.fillStyle = hexA(warm, 0.85);
  ctx.fillRect(w - 330, 92, 190, 10);

  // Wall sign — dimmer than the wall's own warm pool: under the night cans a
  // near-white glyph was the one interior element out-shining the kiosk screen.
  ctx.fillStyle = hexA(warm, 0.16);
  rr(ctx, w / 2 - 130, 96, 260, 96, 18);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2d9ae';
  ctx.font = font(800, 46);
  ctx.fillText(paintCaps(locale, 'desk.healing'), w / 2, 160, 260 - 24);
  ctx.textAlign = 'left';

  // Warm light pooling from the ceiling cans
  const pool = ctx.createLinearGradient(0, 0, 0, h);
  pool.addColorStop(0, hexA(warm, 0.34));
  pool.addColorStop(0.5, hexA(warm, 0.08));
  pool.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Fascia emissive map: the red band is an extruded panel run, so the map
 * carries seams and a top highlight rather than a flat fill. Bloom picks up
 * the seams; the band itself keeps its HDR emissive in the material.
 */
export function paintFasciaBand(ctx: CanvasRenderingContext2D, w: number, h: number, red: string): void {
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, w, h);

  /*
   * The highlight is a *lighter red*, not white. This map multiplies an HDR
   * emissive, so any white in it desaturates the band as the intensity climbs
   * — r1's 34 % white top row is what turned the dark band (255, 248, 242)
   * instead of Poké-Ball red.
   */
  const sheen = ctx.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, 'rgba(255, 150, 140, 0.2)');
  sheen.addColorStop(0.34, 'rgba(255, 150, 140, 0.06)');
  sheen.addColorStop(0.72, 'rgba(0, 0, 0, 0.14)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  // Panel seams
  const seam = 64;
  for (let x = 0; x < w; x += seam) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.fillRect(x, 0, 3, h);
    ctx.fillStyle = 'rgba(255, 168, 158, 0.2)';
    ctx.fillRect(x + 3, 0, 2, h);
  }
  ctx.fillStyle = 'rgba(255, 176, 166, 0.16)';
  ctx.fillRect(0, 0, w, 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.fillRect(0, h - 6, w, 6);
}

/**
 * Desk-owned wet slate apron. `colour` carries the pigment, `rough` the
 * matching roughness so puddles read as puddles under the fascia red rather
 * than as a metalness slider.
 */
export function paintApron(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mode: 'colour' | 'rough',
  slate: string,
): void {
  ctx.fillStyle = mode === 'colour' ? '#39424c' : '#8f8f8f';
  ctx.fillRect(0, 0, w, h);

  const tileW = 74;
  const tileH = 48;
  for (let row = 0; row < h / tileH + 1; row += 1) {
    const offset = row % 2 === 0 ? 0 : tileW / 2;
    for (let col = -1; col < w / tileW + 1; col += 1) {
      const n = (row * 7 + col * 5) % 6;
      const x = col * tileW + offset + 2;
      const y = row * tileH + 2;
      const wet = n === 1 || n === 4;
      if (mode === 'colour') {
        ctx.fillStyle = hexA(slate, 0.86 + n * 0.02);
        ctx.fillRect(x, y, tileW - 6, tileH - 6);
        if (wet) {
          ctx.fillStyle = 'rgba(196, 212, 232, 0.32)';
          ctx.fillRect(x + 6, y + 8, tileW - 20, 12);
        }
      } else {
        ctx.fillStyle = wet ? '#111111' : '#7d7d7d';
        ctx.fillRect(x, y, tileW - 6, tileH - 6);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(x + 8, y + 10, tileW - 24, 7);
      }
    }
  }
}

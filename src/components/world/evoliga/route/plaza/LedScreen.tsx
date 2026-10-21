'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { typeColors } from '@/lib/design/tokens';
import { homeSpriteUrl } from '@/lib/pkmn/sprite-styles';
import type { EvolutionTracker } from '@/types/evolution';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { LeagueStanding } from '@/lib/supabase/queries/league-standings';
import { CREST_BANNER, CREST_RASTER } from '@/lib/route-world/teams-formation';
import { capsFor, paintCaps } from '@/lib/route-world/paint-copy';
import { compareTrackersForDisplay } from '@/lib/draft-ui/progress-display';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useDataLocale, useLocale } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { useEvoligaRouteData } from '../route-data';

interface LedScreenProps {
  /** Flat phosphor mode — small practicals (desk monitors). */
  color?: string;
  /** Content mode — an authored broadcast canvas (jumbotron boards). */
  map?: THREE.Texture | null;
  gain?: number;
  width: number;
  height: number;
  /** Fake bloom: tint of the soft additive halo plane. Omit for no halo. */
  halo?: string;
  haloOpacity?: number;
}

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Flat phosphor only (desk monitors). Jumbotron content does not use this
 * shader — r2's always-sample `uMap` + DataTexture bind stayed a teal slab.
 */
const PHOSPHOR_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uGain;
  varying vec2 vUv;

  void main() {
    vec3 col = uColor;
    float scan = 1.0 - 0.09 * (0.5 + 0.5 * sin(vUv.y * 220.0 * 6.28318 + uTime * 2.4));
    vec2 cabinet = fract(vUv * vec2(8.0, 4.0));
    float seam = mix(0.78, 1.0, smoothstep(0.0, 0.008, min(cabinet.x, cabinet.y)));
    float sweep = 0.05 * (0.5 + 0.5 * sin(vUv.y * 2.5 - uTime * 0.9));
    float vig = 1.0 - 0.25 * pow(length(vUv - 0.5) * 1.35, 2.2);
    vec3 outCol = col * uGain * scan * seam * vig + col * sweep;
    gl_FragColor = vec4(outCol, 1.0);
  }
`;

/** Soft radial glow texture for the fake-bloom halo plane. */
function useHaloTexture(): THREE.Texture | null {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.3)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

function HaloPlane({
  color,
  width,
  height,
  opacity,
}: {
  color: string;
  width: number;
  height: number;
  opacity: number;
}) {
  const texture = useHaloTexture();
  if (!texture) return null;

  return (
    <mesh position={[0, 0, -0.08]} renderOrder={0}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Desk-monitor phosphor only. Jumbotron faces live on a map-only plane in
 * PlazaHall — r2 DataTexture+uMap and r3 CanvasTexture+initTexture stay unused.
 */
export default function LedScreen({
  color = '#334155',
  map = null,
  gain = 2.4,
  width,
  height,
  halo,
  haloOpacity = 0.25,
}: LedScreenProps) {
  const phosphor = useMemo(() => {
    if (map) return null;
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
        uGain: { value: gain },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: PHOSPHOR_FRAGMENT,
      toneMapped: false,
    });
  }, [color, gain, map]);

  const uniformsRef = useRef(phosphor?.uniforms);

  useEffect(() => {
    if (!phosphor) return;
    uniformsRef.current = phosphor.uniforms;
    uniformsRef.current.uColor.value.set(color);
    uniformsRef.current.uGain.value = gain;
  }, [color, gain, phosphor]);

  useEffect(() => () => phosphor?.dispose(), [phosphor]);

  useFrame((_, delta) => {
    const uniforms = uniformsRef.current;
    if (uniforms) uniforms.uTime.value += delta;
  });

  return (
    <group>
      {halo && !map ? (
        <HaloPlane color={halo} width={width * 1.18} height={height * 1.18} opacity={haloOpacity} />
      ) : null}
      <mesh>
        <planeGeometry args={[width, height]} />
        {phosphor ? <primitive object={phosphor} attach="material" /> : null}
      </mesh>
    </group>
  );
}

/* ── The teams LED wall: ace-crest carousel (fidelity wave 2, seat 2F) ───── */

/**
 * WAVE-PLAN §1 (plaza teams): "the LED wall shows ace crests instead of the
 * black '?'". The east façade's LED advert (HaussmannBlock `PictorialLed`,
 * before this carousel) painted a mascot SILHOUETTE — a black
 * creature shape with a warm rim, which read as a "who's that Pokémon?" mark
 * and was the teams frame's strongest focal point (audit issue 16, PL/PD).
 * This carousel replaces that imagery with the league's own trainers, from
 * the page-loaded route data (no fetch of its own besides the sprites the
 * statue row already proxies):
 *
 *  - one slide per trainer, in STANDINGS order (then any participant the
 *    table does not list yet), each a crest: a hexagon in the trainer's gym
 *    colour carrying the ace's HOME sprite, the trainer's name, the ace and
 *    the table place — German copy (the plaza's language);
 *  - no participants → the EvoLiga mark (crest + word-mark), never an empty
 *    or black panel;
 *  - 40 % emission (`CREST_EMISSIVE`): a lit façade screen, far under the
 *    boards' paper white — the wall is chrome, not data (§5.10);
 *  - slides CUT (an LED wall's own grammar) every `CREST_HOLD_S`; the next
 *    slide is painted off the render loop (a timer) into the same pixel
 *    buffer, so a change is one texture upload and zero allocations;
 *    reduced motion pins slide 0.
 *
 * Honest limits:
 *  - the ace is the statue row's rule (most evolved line, ties by KOs);
 *    a trainer with no tracker gets a crest without a sprite (their
 *    initial), never a stand-in species;
 *  - a sprite still loading when its slide paints is simply absent from
 *    that pass; the next pass of that slide has it;
 *  - MOUNT (wave 2 r2): HaussmannBlock's `PictorialLed` mounts this plane in
 *    the silhouette's seat (same w/h) on both façade LEDs, with its wash
 *    light scaled to the 40 % emission. The block still paints the
 *    silhouette map (unused) until its writer drops it.
 */

/** Seconds a crest holds before the cut to the next one. */
export const CREST_HOLD_S = 7;
/** Emission of the crest wall: 40 % (WAVE-PLAN 2F) — chrome, under the boards. */
export const CREST_EMISSIVE = 0.4;
/** Painted canvas of one slide (the pictorial LED's own 16:10 raster; teams-formation `CREST_RASTER`). */
export const CREST_TEX_W = CREST_RASTER.w;
export const CREST_TEX_H = CREST_RASTER.h;
const CREST_FACE = "system-ui, 'Segoe UI', sans-serif";
/** Gym colour for a trainer with no (or an unknown) gym type — the Normal pigment. */
const NEUTRAL_PIGMENT = typeColors.Normal.bg;

export interface CrestSlide {
  /** Participant id (stable key). */
  id: string;
  name: string;
  /** Gym-type pigment (tokens `typeColors`), neutral when unassigned. */
  pigment: string;
  /** The ace's species as the data names it; null when the trainer has no tracker. */
  ace: string | null;
  /** 1-based table place; null when the standings do not list the trainer yet. */
  place: number | null;
}

/**
 * The statue row's ace rule: the first tracker in display order
 * (`compareTrackersForDisplay`, draft-frontend §8.3: stage, then self-earned
 * KOs = `real_kills`, then total progress — never the merged total alone).
 */
function aceOf(trackers: readonly EvolutionTracker[], playerId: string): string | null {
  const own = trackers.filter((t) => t.player_id === playerId);
  if (own.length === 0) return null;
  const best = [...own].sort(compareTrackersForDisplay)[0];
  return best.current_form || best.base_pokemon || null;
}

/**
 * The carousel's slides, in standings order (the table's own order — §5.9:
 * never a teams order that is not the data order), then participants the
 * table does not list yet in their data order. Pure.
 */
export function crestSlides(
  participants: readonly PublicParticipant[],
  trackers: readonly EvolutionTracker[],
  standings: readonly LeagueStanding[],
): CrestSlide[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const ordered: { player: PublicParticipant; place: number | null }[] = [];
  const seen = new Set<string>();
  for (const row of standings) {
    const player = byId.get(row.player_id);
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    ordered.push({ player, place: ordered.length + 1 });
  }
  for (const player of participants) {
    if (!seen.has(player.id)) ordered.push({ player, place: null });
  }
  return ordered.map(({ player, place }) => ({
    id: player.id,
    name: player.name,
    pigment: (player.gym_type ? typeColors[player.gym_type]?.bg : undefined) ?? NEUTRAL_PIGMENT,
    ace: aceOf(trackers, player.id),
    place,
  }));
}

/** The words a crest slide letters: the viewer's locale and Pokémon-data locale (absent = names as stored). */
export interface CrestCopy {
  locale: Locale;
  dataLocale?: Locale;
}

/** "TRAINER 3/8 · PLATZ 1" — the slide kicker (`paint.crest`). */
export function crestKicker(slide: CrestSlide, index: number, total: number, copy: CrestCopy): string {
  const locale = copy.locale;
  const params = { index: String(index + 1), total: String(total) };
  return slide.place !== null
    ? paintCaps(locale, 'crest.kickerPlace', { ...params, place: String(slide.place) })
    : paintCaps(locale, 'crest.kicker', params);
}

/** The ace line beside the kicker (`ASS · GLURAK`), or null when the trainer has none yet. */
export function crestAceLine(slide: CrestSlide, copy: CrestCopy): string | null {
  if (!slide.ace) return null;
  const locale = copy.locale;
  const ace = copy.dataLocale ? localizeSpecies(slide.ace, copy.dataLocale) : slide.ace;
  return paintCaps(locale, 'crest.ace', { ace: capsFor(ace, locale) });
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Shrink the font until `text` fits `maxW`, down to `floorPx` (the boxes are sized for whole names). */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  startPx: number,
  floorPx: number,
  maxW: number,
): number {
  let px = startPx;
  ctx.font = `${weight} ${px}px ${CREST_FACE}`;
  while (ctx.measureText(text).width > maxW && px > floorPx) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${CREST_FACE}`;
  }
  return px;
}

/** LED cell grout + scanline (the pictorial LED's phosphor microstructure). */
function paintLedGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 16; x < w; x += 16) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 16; y < h; y += 16) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

/* ── Crest slide layout (LOOK r6, C2: the top banner) ───────────────────── */

/**
 * The wall stands BEHIND the teams rows, so the rear-rank crowns cover its
 * middle on screen: at r5 the rank-8 plinth cut the name to 'MARA FE…KAMP'.
 * The words now live in the top banner the frozen #teams poses leave clear
 * (`CREST_BANNER`, teams-formation.ts — the formation test projects it at
 * 1440 and 390): the kicker, then the trainer's name, left-aligned in
 * `[left, right]`, the name's baseline on the banner's bottom edge. The ace
 * line sits right-aligned on the kicker's baseline when it fits beside it
 * (it is the ledger's data too, and the hexagon carries the ace's sprite);
 * the decorative hexagon moves down (`CREST_HEX.cy` 0.62 h), under the
 * banner, where the rows stand in front of it anyway.
 */

/** Cap height of the crest face (system-ui / Segoe UI ≈ 0.7 em; 0.72 keeps the box law conservative). */
export const CREST_CAP_EM = 0.72;
/** Kicker ("TRAINER 1/8 · PLATZ 1"): start / floor px — cap ≈ 23 raster px (≈ 15 px on screen at 1440). */
export const CREST_KICKER_PX = { start: 32, floor: 22 } as const;
/** The trainer's name: start / floor px — cap ≈ 33 raster px at the start (≈ 21 px on screen at 1440, ≈ 8 css px at 390). */
export const CREST_NAME_PX = { start: 46, floor: 28 } as const;
/** The ace line beside the kicker: start / floor px. */
export const CREST_ACE_PX = { start: 28, floor: 20 } as const;
/** Gap kept between the kicker's end and the right-aligned ace line (raster px). */
export const CREST_ACE_GAP = 32;
/** Right margin of the ace line (raster px). */
export const CREST_ACE_RIGHT = 40;
/** The decorative hexagon (raster px): moved down under the banner (C2). */
export const CREST_HEX = { cx: 300, cy: Math.round(CREST_RASTER.h * 0.62), r: 214, inner: 186 } as const;

/** Width of `text` set in `font` (the painter passes `ctx.measureText`; tests pass a model). */
export type CrestMeasure = (text: string, font: string) => number;

export interface CrestTextLine {
  text: string;
  /** Canvas font shorthand. */
  font: string;
  px: number;
  /** Anchor x (left edge for `left`, right edge for `right`) and alphabetic baseline y. */
  x: number;
  baseline: number;
  align: 'left' | 'right';
  /** Painted advance width: the measured width, capped at `maxWidth`. */
  width: number;
  /**
   * The line's box width: `fillText`'s maxWidth, which condenses a line that
   * still overflows at its floor size instead of letting it leave the banner.
   */
  maxWidth: number;
}

export interface CrestSlideLayout {
  kicker: CrestTextLine;
  name: CrestTextLine;
  /** Null when no ace is known, or it does not fit beside the kicker. */
  ace: CrestTextLine | null;
  hex: { cx: number; cy: number; r: number; inner: number };
}

function crestFont(weight: number, px: number): string {
  return `${weight} ${px}px ${CREST_FACE}`;
}

/** Largest px in [floor, start] (2 px steps) whose advance fits `maxW`; the floor when none does. */
function fitPx(measure: CrestMeasure, text: string, weight: number, start: number, floor: number, maxW: number): number {
  let px = start;
  while (px > floor && measure(text, crestFont(weight, px)) > maxW) px -= 2;
  return Math.max(px, floor);
}

function crestLine(
  measure: CrestMeasure,
  text: string,
  weight: number,
  px: number,
  x: number,
  baseline: number,
  align: 'left' | 'right',
  maxWidth: number,
): CrestTextLine {
  const font = crestFont(weight, px);
  return { text, font, px, x, baseline, align, width: Math.min(measure(text, font), maxWidth), maxWidth };
}

/**
 * Where a trainer slide's words and hexagon go (raster px). Pure: the painter
 * and the tests share it. Kicker and name fit `CREST_BANNER`'s width by
 * shrinking (never below their floors); the ace line only appears when it
 * fits right-aligned beside the kicker.
 */
export function crestSlideLayout(
  slide: CrestSlide,
  index: number,
  total: number,
  measure: CrestMeasure,
  copy: CrestCopy,
): CrestSlideLayout {
  const { left, right, top, bottom } = CREST_BANNER;
  const maxW = right - left;
  const kickerText = crestKicker(slide, index, total, copy);
  const kickerPx = fitPx(measure, kickerText, 700, CREST_KICKER_PX.start, CREST_KICKER_PX.floor, maxW);
  const kicker = crestLine(measure, kickerText, 700, kickerPx, left, Math.ceil(top + kickerPx * CREST_CAP_EM), 'left', maxW);
  const nameText = capsFor(slide.name, copy.locale);
  const namePx = fitPx(measure, nameText, 800, CREST_NAME_PX.start, CREST_NAME_PX.floor, maxW);
  const name = crestLine(measure, nameText, 800, namePx, left, bottom, 'left', maxW);

  let ace: CrestTextLine | null = null;
  const aceText = crestAceLine(slide, copy);
  if (aceText) {
    const edge = CREST_RASTER.w - CREST_ACE_RIGHT;
    const room = edge - (left + kicker.width + CREST_ACE_GAP);
    const acePx = fitPx(measure, aceText, 600, CREST_ACE_PX.start, CREST_ACE_PX.floor, room);
    const line = crestLine(measure, aceText, 600, acePx, edge, kicker.baseline, 'right', Number.POSITIVE_INFINITY);
    // Beside the kicker only when it fits at its floor size (never condensed).
    if (room > 0 && line.width <= room) ace = { ...line, maxWidth: room };
  }
  return { kicker, name, ace, hex: { ...CREST_HEX } };
}

/**
 * One trainer crest: kicker and name in the top banner, gym-colour hexagon
 * with the ace sprite below. `words` false (fix r7, the south-west wall)
 * paints the same slide without any words — no banner, ace line or
 * word-mark.
 */
export function paintCrestSlide(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  slide: CrestSlide,
  index: number,
  total: number,
  sprite: HTMLImageElement | null,
  words = true,
  copy: CrestCopy,
): void {
  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(0, 0, w, h);
  // A wash of the gym colour from the crest side, so each slide reads as that trainer's.
  const wash = ctx.createLinearGradient(0, 0, w, 0);
  wash.addColorStop(0, slide.pigment);
  wash.addColorStop(0.55, 'rgba(13, 15, 20, 0)');
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  const measure: CrestMeasure = (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const layout = crestSlideLayout(slide, index, total, measure, copy);

  const { cx, cy, r, inner } = layout.hex;
  hexPath(ctx, cx, cy, r);
  ctx.fillStyle = slide.pigment;
  ctx.fill();
  hexPath(ctx, cx, cy, inner);
  ctx.fillStyle = '#12151c';
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#f6efe0';
  hexPath(ctx, cx, cy, r);
  ctx.stroke();
  if (sprite && sprite.naturalWidth > 0) {
    const side = 300;
    ctx.drawImage(sprite, cx - side / 2, cy - side / 2, side, side);
  } else {
    ctx.fillStyle = '#f6efe0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 170px ${CREST_FACE}`;
    ctx.fillText(capsFor([...slide.name][0] ?? '', copy.locale), cx, cy + 8);
  }

  ctx.textBaseline = 'alphabetic';
  const left = 572;
  if (!words) {
    // The gym-colour bar only (decorative, no word-mark).
    ctx.fillStyle = slide.pigment;
    ctx.fillRect(left, 420, Math.min(w - left - 40, 260), 10);
    paintLedGrain(ctx, w, h);
    return;
  }
  const draw = (line: CrestTextLine, fill: string) => {
    ctx.fillStyle = fill;
    ctx.font = line.font;
    ctx.textAlign = line.align;
    ctx.fillText(line.text, line.x, line.baseline, line.maxWidth);
  };
  draw(layout.kicker, 'rgba(246, 239, 224, 0.9)');
  draw(layout.name, '#f6efe0');
  if (layout.ace) draw(layout.ace, 'rgba(246, 239, 224, 0.9)');

  // Gym-colour bar and word-mark, bottom right (decorative; the rows stand before them).
  ctx.textAlign = 'left';
  ctx.fillStyle = slide.pigment;
  ctx.fillRect(left, 420, Math.min(w - left - 40, 260), 10);
  ctx.fillStyle = 'rgba(246, 239, 224, 0.75)';
  ctx.font = `700 30px ${CREST_FACE}`;
  ctx.fillText('EVOLIGA', left, 486);
  paintLedGrain(ctx, w, h);
}

/** The no-data slide: the league crest and word-mark (never a black panel); `words` false keeps the crest only. */
export function paintLeagueMark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  words = true,
  copy: CrestCopy,
): void {
  ctx.fillStyle = '#0d0f14';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#f0b35a';
  hexPath(ctx, cx, 210, 96);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 44, 248);
  ctx.lineTo(cx + 44, 172);
  ctx.stroke();
  if (!words) {
    paintLedGrain(ctx, w, h);
    return;
  }
  ctx.fillStyle = '#f6efe0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'EVOLIGA', 800, 132, 64, w - 160);
  ctx.fillText('EVOLIGA', cx, 410);
  ctx.fillStyle = 'rgba(246, 239, 224, 0.9)';
  const tagline = paintCaps(copy.locale, 'crest.tagline');
  fitFont(ctx, tagline, 600, 36, 24, w - 160);
  ctx.fillText(tagline, cx, 500);
  paintLedGrain(ctx, w, h);
}

function spriteProxyUrl(species: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(homeSpriteUrl(species))}`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

interface CrestTarget {
  texture: THREE.DataTexture;
  /** Copy a painted RGBA raster into the texture's own buffer and flag the upload. */
  upload: (image: Uint8ClampedArray) => void;
}

function createCrestTarget(): CrestTarget {
  const pixels = new Uint8Array(CREST_TEX_W * CREST_TEX_H * 4);
  const texture = new THREE.DataTexture(pixels, CREST_TEX_W, CREST_TEX_H);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  const row = CREST_TEX_W * 4;
  return {
    texture,
    upload: (image) => {
      // Rows reversed: a DataTexture samples v = 0 at row 0, the plane's v = 0 is its bottom.
      for (let y = 0; y < CREST_TEX_H; y += 1) {
        const src = (CREST_TEX_H - 1 - y) * row;
        pixels.set(image.subarray(src, src + row), y * row);
      }
      texture.needsUpdate = true;
    },
  };
}

/**
 * The crest wall's content plane: `width × height`, centred at the group
 * origin, facing +Z (the silhouette plane's own seat in `PictorialLed`).
 *
 * `words` (fix r7, D31 #3): only the TEAMS wall (the east façade, the
 * `teams-formation` seat) carries the banner words. The south-west façade
 * LED is no station's face: its only camera is the RULES pose, where it sits
 * cropped at the frame's right edge (x ≈ 1274–1569 at 1440) behind the
 * right-hand linden, and at rung 2 the sparse canopy let its
 * 'TRAINER 1/8 · PLATZ 1 / MARA FELDKAMP' read through mid-word (§5.10). It
 * shows the same crests, colours and aces without words. Same material,
 * program, texture and upload cadence — nothing new after the reveal (D23).
 */
export function LedCrestWall({
  width,
  height,
  night,
  words = true,
}: {
  width: number;
  height: number;
  night: boolean;
  words?: boolean;
}) {
  const { participants, trackers, standings } = useEvoligaRouteData();
  const slides = useMemo(() => crestSlides(participants, trackers, standings), [participants, trackers, standings]);
  // i18n D11: the slides letter in the viewer's language (aces in the
  // viewer's Pokémon-data language), known before the first raster.
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const copy = useMemo<CrestCopy>(() => ({ locale, dataLocale }), [locale, dataLocale]);

  // One pixel buffer + DataTexture for the wall's life (PB-003: the canvas is
  // never handed to the GPU; a slide change re-uploads this same buffer).
  const target = useMemo(() => createCrestTarget(), []);
  useEffect(() => () => target.texture.dispose(), [target]);

  // Ace sprites, fetched once per species through the proxy the statue row
  // uses (`connect-src` blocks the sprite CDN).
  const sprites = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    for (const slide of slides) {
      if (!slide.ace || sprites.current.has(slide.ace)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = spriteProxyUrl(slide.ace);
      sprites.current.set(slide.ace, img);
    }
  }, [slides]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = CREST_TEX_W;
    canvas.height = CREST_TEX_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    let index = 0;
    const raster = (at: number): Uint8ClampedArray => {
      if (slides.length === 0) {
        paintLeagueMark(ctx, CREST_TEX_W, CREST_TEX_H, words, copy);
      } else {
        const slideAt = at % slides.length;
        const slide = slides[slideAt];
        const img = slide.ace ? (sprites.current.get(slide.ace) ?? null) : null;
        paintCrestSlide(ctx, CREST_TEX_W, CREST_TEX_H, slide, slideAt, slides.length, img?.complete ? img : null, words, copy);
      }
      return ctx.getImageData(0, 0, CREST_TEX_W, CREST_TEX_H).data;
    };
    target.upload(raster(index));
    if (slides.length < 2 || prefersReducedMotion()) return undefined;
    // ENGINE r5 (CAR r4 quiet probe: an unexplained 60-70 ms task in the
    // sweep): the cut's 2D paint (one per façade wall, the two timers firing
    // together: 23 + 12 ms in one task) no longer runs on the cut. The NEXT
    // slide is painted ahead in an idle period; the cut only copies its
    // pixels into the texture's buffer. Same slides, order and cadence.
    const idle = window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let ahead: { at: number; pixels: Uint8ClampedArray } | null = null;
    let pending: number | null = null;
    const prepare = () => {
      pending = null;
      ahead = { at: index + 1, pixels: raster(index + 1) };
    };
    const schedule = () => {
      if (pending !== null) return;
      pending =
        typeof idle.requestIdleCallback === 'function'
          ? idle.requestIdleCallback(prepare, { timeout: (CREST_HOLD_S * 1000) / 2 })
          : window.setTimeout(prepare, 250);
    };
    const cancel = () => {
      if (pending === null) return;
      if (typeof idle.cancelIdleCallback === 'function') idle.cancelIdleCallback(pending);
      else window.clearTimeout(pending);
      pending = null;
    };
    schedule();
    const timer = window.setInterval(() => {
      index += 1;
      const next = ahead !== null && ahead.at === index ? ahead.pixels : raster(index);
      ahead = null;
      target.upload(next);
      cancel();
      schedule();
    }, CREST_HOLD_S * 1000);
    return () => {
      window.clearInterval(timer);
      cancel();
    };
  }, [slides, target, words, copy]);

  return (
    <mesh renderOrder={2}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={target.texture}
        color="#ffffff"
        emissive="#ffffff"
        emissiveMap={target.texture}
        emissiveIntensity={CREST_EMISSIVE}
        roughness={night ? 0.34 : 0.28}
        metalness={0.04}
        toneMapped={false}
      />
    </mesh>
  );
}

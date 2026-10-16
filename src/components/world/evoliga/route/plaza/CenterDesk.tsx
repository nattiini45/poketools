'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { queuePaint } from '@/components/world/route/paint-queue';
import { useResidencyHold } from '@/components/world/route/residency-store';
import { useFrame } from '@react-three/fiber';
import Figure from '@/components/world/route/figures/Figure';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import { STANDBY_EMISSIVE_DROP, useStandbyDim } from '@/components/world/route/useStandbyDim';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import { DESK, FURNITURE } from '@/lib/route-world/layout';
import { useFigureIndex } from '@/lib/route-world/model-manifest';
import { getSpriteUrl } from '@/lib/pkmn/sprites';
import { useEvoligaRouteData } from '../route-data';
import { useDataLocale, useLocale } from '@/i18n/client';
import { routeT } from '@/lib/route-world/paint-copy';
import {
  APRON_TEX,
  FASCIA_TEX_H,
  FASCIA_TEX_W,
  INTERIOR_TEX_H,
  INTERIOR_TEX_W,
  ROSTER_GRID_TILES,
  ROSTER_TEX_H,
  ROSTER_TEX_W,
  paintApron,
  paintFasciaBand,
  paintInteriorWall,
  paintRosterGrid,
  type RosterTile,
} from './desk-painters';
import type { SubjectBounds, SubjectPanel } from '@/lib/route-world/focus';
import type { PlazaWorldPalette } from '@/components/world/themes/plaza/theme-palette';
import { PLAZA_DATA_SURFACES } from './data-faces';

/**
 * West Poké Center — mass grammar in metres, local to `FURNITURE.desk`
 * (+X east, toward the plaza and the `#roster` camera at world x = −5.2).
 *
 *   pavilion  5.5 m wide shopfront projecting from the west perimeter — ≈ 59 %
 *             of the frozen 1440 frame; corner pylons, glazed bays, an opening
 *   fascia    red Poké-Ball band over the opening, wrapping both corner pylons
 *   counter   arc of a 5 m circle bowing east, lacquer body / wood top / red band
 *   nurse     on a dais behind the counter so head and shoulders clear the top
 *   kiosk     Rotom PC at the north end — black glass, bezel, live roster grid
 *   interior  lit room behind the glass: back wall, ceiling cans, shelf bank
 */
const BAY_HALF = 2.76;
const GLASS_HALF = 2.32;
const OPEN_HALF = 1.76;
const FRONT_X = -1.32;
const WALL_X = -1.62;
const ROOM_BACK = -4.6;
const OPEN_H = 3.42;
const FASCIA_H = 0.88;
const FASCIA_D = 0.7;
/**
 * The corner pylons carry the band 0.65 m further east than the opening run.
 * From the frozen roster pose the camera stands *inside* the pavilion's z
 * span, so a return that runs west hides behind the band's own front face —
 * only a pylon that projects toward the plaza shows its return (PB-069).
 */
const PYLON_D = 1.35;
const PYLON_HALF = (BAY_HALF - GLASS_HALF) / 2;
const PYLON_Z = (GLASS_HALF + BAY_HALF) / 2;
/** Shadow reveal under the band — the soffit line that dates the roof edge. */
const SOFFIT_H = 0.09;
const SOFFIT_LIP = 0.07;
/** Side faces sit this far under the front plate so the wrap reads as a corner. */
const RETURN_DIM = 0.42;
const PARAPET_H = 0.34;
const FASCIA_Y = OPEN_H + FASCIA_H / 2;
const PARAPET_Y = OPEN_H + FASCIA_H + PARAPET_H / 2;

/** Counter arc: radius, half-chord and the easternmost point of the bow. */
const COUNTER_R = 5;
const COUNTER_HALF = 1.35;
const COUNTER_Z = 0.1;
const COUNTER_FRONT_X = 0.55;
const COUNTER_CX = COUNTER_FRONT_X - COUNTER_R;
const COUNTER_SWEEP = 2 * Math.asin(COUNTER_HALF / COUNTER_R);
const COUNTER_THETA = Math.PI / 2 - COUNTER_SWEEP / 2;
const COUNTER_BACK_R = COUNTER_R - 0.78;

/** Kiosk: north end of the opening, screen facing the plaza. */
const KIOSK_Z = -1.78;
const KIOSK_X = 0.2;
const KIOSK_BODY_D = 0.5;
const KIOSK_BODY_W = 0.9;
const KIOSK_TOP = 2.46;
/** Kiosk-local: bezel face at 0.37, screen 5 mm proud of it. */
const KIOSK_BEZEL_X = 0.31;
const KIOSK_SCREEN_X = 0.375;
/**
 * Glass at 0.96 : 1.42, matching `ROSTER_TEX_*`, inside a 5 cm bezel border.
 * Taller than 3:4 on purpose: the framer's `along/2` depth penalty scales with
 * the subject's width, so at a frozen fill 0.72 / off-axis 14° a 0.96 m pane
 * buys its frame share through height — 1.42 m is the tallest clean fit under
 * the crown (bezel top 2.16 < body top 2.21 < crown 2.24).
 */
const KIOSK_SCREEN_W = 0.96;
const KIOSK_SCREEN_H = 1.42;
const KIOSK_BEZEL_BORDER = 0.1;
const KIOSK_SCREEN_Y = 1.4;
/** The kiosk's data-face id (data-faces.ts) — the standby dim's key. */
const KIOSK_FACE_IDS = ['roster:kiosk'] as const;

const NURSE_DAIS_H = 0.5;
const NURSE_Z = 0.25;
const NURSE_X = -1.05;

const CHARCOAL = '#14161b';
const STONE = '#3a3a42';

/**
 * ENGINE r6 (E2): the painted canvas IS the texture's image — no synchronous
 * PNG encode (`toDataURL`) and no image decode on upload. GPU state is the
 * old loader path's, field for field (a plain `Texture`: flipY, straight
 * alpha; the caller's colour space and wrap, linear, no mips), so every desk
 * face samples the same pixels. A plain `Texture`, not `CanvasTexture`:
 * QualityGovernor's `retainDataTextureDisposals` patches
 * `CanvasTexture.prototype.dispose`, and a repainted face must still free its
 * old upload (the fascia and apron maps are small enough to be retained).
 * Each paint allocates its own canvas, so no snapshot (`createImageBitmap`)
 * is needed.
 */
export function deskCanvasTexture(
  canvas: HTMLCanvasElement,
  wrap: THREE.Wrapping,
  colorSpace: THREE.ColorSpace,
): THREE.Texture {
  const tex = new THREE.Texture(canvas);
  tex.colorSpace = colorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.needsUpdate = true;
  return tex;
}

/** Paint into a fresh detached canvas and wrap it (null: no 2D context — logged, the surface stays unmapped and pending). */
function paintCanvasTexture(
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
  wrap: THREE.Wrapping,
  colorSpace: THREE.ColorSpace,
): THREE.Texture | null {
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  const ctx = source.getContext('2d');
  if (!ctx) {
    console.error('[center-desk] canvas 2d unavailable');
    return null;
  }
  paint(ctx, w, h);
  return deskCanvasTexture(source, wrap, colorSpace);
}

/**
 * Paint once into a detached canvas and upload that canvas. The texture is
 * created INSIDE the queued paint job, once per effect run, and disposed by
 * that run's cleanup — never a memoized `CanvasTexture`, so Strict Mode's
 * double mount cannot dispose a live GPU upload (PB-003).
 */
function usePaintedTexture(
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
  wrap: THREE.Wrapping,
  key: string,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): THREE.Texture | null {
  // ENGINE r4 (D23): residency stays pending until the paint for the
  // CURRENT inputs has landed (a repaint re-opens it), so no face can
  // reveal blank or finish uploading after the world appears.
  const run = useMemo(() => ({ paint, w, h, wrap, key, colorSpace }), [paint, w, h, wrap, key, colorSpace]);
  const [painted, setPainted] = useState<{ texture: THREE.Texture; run: object } | null>(null);
  useResidencyHold('paint:plaza-desk', painted?.run !== run);

  useEffect(() => {
    let texture: THREE.Texture | null = null;
    // ENGINE r3 (load long task): the paint runs in its own task through the
    // engine's paint queue, never in the commit's effect flush beside every
    // other face. ENGINE r6 (E2): the texture is made in that same task from
    // the painted canvas (no PNG encode). A cancelled job never runs, so no
    // texture outlives its run. Same paint, same pixels.
    const cancelPaint = queuePaint(() => {
      texture = paintCanvasTexture(paint, w, h, wrap, colorSpace);
      if (texture) setPainted({ texture, run });
    });
    return () => {
      cancelPaint();
      texture?.dispose();
    };
  }, [paint, w, h, wrap, key, colorSpace, run]);

  return painted?.texture ?? null;
}

/**
 * HOME sprites for the kiosk tiles. `TextureLoader` on the CDN is blocked by
 * `connect-src`, so every sprite comes through `/api/proxy-image` (PB-078) and
 * the grid paints a resident Poké-Ball glyph until they decode.
 */
function useSpriteImages(names: readonly string[]): Map<string, HTMLImageElement> {
  const key = names.join('|');
  const [settled, setSettled] = useState<{ key: string; images: Map<string, HTMLImageElement> }>(() => ({
    key: '',
    images: new Map(),
  }));
  // ENGINE r4 (D23): the kiosk repaints once its sprites decode, so the
  // sprites are part of the desk's residency — pending until every one of
  // them has settled (loaded or failed), never a repaint after the reveal.
  useResidencyHold('plaza:desk-sprites', key.length > 0 && settled.key !== key);

  useEffect(() => {
    if (key.length === 0) return;
    let cancelled = false;
    const wanted = key.split('|');
    const loaded = new Map<string, HTMLImageElement>();
    let pending = wanted.length;
    const settle = () => {
      pending -= 1;
      if (pending === 0 && !cancelled) setSettled({ key, images: loaded });
    };
    for (const name of wanted) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loaded.set(name, img);
        settle();
      };
      img.onerror = settle;
      img.src = `/api/proxy-image?url=${encodeURIComponent(getSpriteUrl(name))}`;
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  return settled.images;
}

/** Poké Center staff: Chansey, else Audino, else Blissey (lib.mjs NURSE_SPECIES). */
const NURSE_SPECIES = ['Chansey', 'Audino', 'Blissey'] as const;

/**
 * The nurse behind the counter, facing east across it. `Figure` scales her
 * from `heightm` — never a manual scale — so the dais is the only lever that
 * lifts her head and shoulders over the 1.12 m counter top.
 */
function Nurse() {
  const index = useFigureIndex();
  // C-089 r2: the nurse stays EAGER. The r1 roster-window gate here was the
  // round-2 veto: her GLB unmounted at schedule/rules, but she still paints
  // there (posed skinned mesh — the audit hook's inView is unreliable for
  // skinning — plus her shadow), so the schedule still lost fixture pixels
  // and fileMaps fell to 79 vs control 82. Her window contained the pulse
  // basis station anyway, so gating her never saved a wire byte.
  const entry = useMemo(() => {
    for (const species of NURSE_SPECIES) {
      const found = index.find(species);
      if (found) return found;
    }
    return null;
  }, [index]);
  if (!entry) return null;
  return (
    <group position={[NURSE_X, NURSE_DAIS_H, NURSE_Z]} rotation={[0, Math.PI / 2, 0]}>
      <Figure entry={entry} clip="idle" role="staff" name="nurse" />
    </group>
  );
}

/**
 * The fascia red. One material graph for the whole band, with `glow` the only
 * variable: front plates take the full value, the corner returns a fraction of
 * it, so the wrap shows a shading break instead of one flat slab. Kept under
 * clip on purpose — the red that lands on the paving comes from the practicals,
 * not from driving the band's own emissive white (PB-069, r1 dark still).
 */
function FasciaSkin({
  red,
  map,
  glow,
}: {
  red: string;
  map: THREE.Texture | null;
  glow: number;
}) {
  return (
    <meshStandardMaterial
      color={red}
      map={map ?? undefined}
      emissive={red}
      emissiveMap={map ?? undefined}
      emissiveIntensity={glow}
      roughness={0.48}
      metalness={0.1}
      toneMapped={false}
    />
  );
}

/** Poké-Ball disc on the fascia — the band's only ornament, front-facing. */
function BallMotif({
  position,
  red,
  night,
  radius,
}: {
  position: [number, number, number];
  red: string;
  night: boolean;
  radius: number;
}) {
  // Matched to the band: a disc hotter than the fascia it sits on was the
  // last red pixel over the 250 ceiling in dark.
  const glow = night ? 0.9 : 0.72;
  // Group turned so local +Z is world +X: the disc faces the plaza.
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      {/*
        Off-white, not white: the disc sits inside the fascia's practicals, and
        a #eef2f5 half clipped to (255, 245, 232) there — the one thing left
        reading white on the band.
      */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, 0.16, 40]} />
        <meshStandardMaterial color="#c8d2d9" roughness={0.46} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0, 0.085]}>
        <circleGeometry args={[radius * 0.98, 40, 0, Math.PI]} />
        <meshStandardMaterial
          color={red}
          emissive={red}
          emissiveIntensity={glow}
          roughness={0.3}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.085]}>
        <circleGeometry args={[radius * 0.98, 40, Math.PI, Math.PI]} />
        <meshStandardMaterial color="#ccd6dd" roughness={0.48} metalness={0.06} />
      </mesh>
      <mesh position={[0, 0, 0.092]}>
        <planeGeometry args={[radius * 1.96, radius * 0.22]} />
        <meshStandardMaterial color={CHARCOAL} roughness={0.42} metalness={0.24} />
      </mesh>
      <mesh position={[0, 0, 0.098]}>
        <circleGeometry args={[radius * 0.3, 24]} />
        <meshStandardMaterial color={CHARCOAL} roughness={0.42} metalness={0.24} />
      </mesh>
      <mesh position={[0, 0, 0.104]}>
        <circleGeometry args={[radius * 0.17, 20]} />
        <meshStandardMaterial
          color="#dde6ea"
          emissive="#dde6ea"
          emissiveIntensity={night ? 0.8 : 0.5}
          roughness={0.3}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Recessed ceiling can + its practical, the interior's only light source. */
function CeilingCan({ at, warm, night }: { at: [number, number]; warm: string; night: boolean }) {
  return (
    <group position={[at[0], OPEN_H - 0.06, at[1]]}>
      <mesh>
        <cylinderGeometry args={[0.19, 0.22, 0.1, 18]} />
        <meshStandardMaterial color="#2a2119" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, -0.055, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.16, 18]} />
        {/*
          Night 0.32 put the can discs at (250, 233, 212) — a broad near-white
          cluster above the kiosk screen, which has to own the station's local
          peak. The room still reads lit through the practicals' point lights.
        */}
        <meshStandardMaterial
          color={warm}
          emissive={warm}
          emissiveIntensity={night ? 0.22 : 0.9}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        position={[0, -0.4, 0]}
        color={warm}
        intensity={night ? 3.3 : 8}
        distance={7}
        decay={2}
      />
    </group>
  );
}

/**
 * LOOK r6 (C3, roster C-044 light): the stock's DAY radiance at ≈ 0.4× (albedo
 * #c9a978 → #856f4d in linear terms, emissive 0.35 → 0.14). The r5 roster
 * light stills put the outside-ex-figures P995 over the kiosk face P99
 * (223.63 > 217.88 at 1440, 216.38 > 212.13 at 390); binning the pixels over
 * the face P99 found these stock boxes (≈ 1,280 of 2,991 at 1440, ≈ 2,270 of
 * 2,361 at 390) and the ceiling-can discs (≈ 1,150 at 1440) — the counter
 * lacquer peaks at 209.8 and sits inside the excluded figure band, so its
 * albedo does not move the metric. Under the cans' 8-cd practicals ~0.6 m
 * away the old stock reached (255, 233, 199). Rung 0 tone-maps the whole
 * frame (AgX), so a cut buys less than its linear ratio: modelled through
 * the AgX curve on the r5 pixels, 0.55× left the stock's p99 at 220 (over
 * the face) while 0.4× lands it ≈ 210 and the over-P99 count at ≈ 1,790 of
 * the 2,287 the P995 allows (1440) / ≈ 300 of 1,409 (390). The boxes still
 * read as warm-lit stock (median ≈ 156 → ≈ 133). Night is untouched (it
 * passes, and the warm interior is the night read).
 */
const STOCK_DAY = { color: '#856f4d', emissive: 0.14 } as const;
const STOCK_NIGHT = { color: '#c9a978', emissive: 0.2 } as const;

/** Shelf bank inside the Center — stock volumes, warm-lit, seen through glass. */
function InteriorShelf({ at, warm, night }: { at: [number, number]; warm: string; night: boolean }) {
  const stock = night ? STOCK_NIGHT : STOCK_DAY;
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.55, 1.24, 1.7]} />
        <meshStandardMaterial color="#4a2f1e" roughness={0.68} />
      </mesh>
      {[1.42, 1.94, 2.46].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <mesh>
            <boxGeometry args={[0.55, 0.07, 1.7]} />
            <meshStandardMaterial color="#3a2618" roughness={0.6} />
          </mesh>
          {/*
            Stock albedo is a dimmed cream, not the full `warm` pigment: under
            the ceiling cans a 255-red albedo clipped the shelves brighter than
            the kiosk screen, inverting the station's HDR hierarchy. The warmth
            comes from the practicals, so the boxes still read as lit stock.
          */}
          {[-0.58, -0.19, 0.2, 0.59].map((z) => (
            <mesh key={z} position={[0.04, 0.19, z]}>
              <boxGeometry args={[0.2, 0.32, 0.16]} />
              <meshStandardMaterial
                color={stock.color}
                emissive={warm}
                emissiveIntensity={stock.emissive}
                roughness={0.42}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export default function CenterDesk({
  palette,
  night,
}: {
  palette: PlazaWorldPalette;
  night: boolean;
}) {
  const { desk } = FURNITURE;
  const { centerRed, deskKiosk, deskWarm, deskApron, deskRosterLive, deskRosterAccent } = palette;

  const { entries, trackers } = useEvoligaRouteData();
  // i18n D11: the kiosk letters in the viewer's language and names the lines
  // in the viewer's Pokémon-data language, both known before the paint.
  const locale = useLocale();
  const dataLocale = useDataLocale();

  const tileEntries = useMemo(() => entries.slice(0, ROSTER_GRID_TILES), [entries]);
  const spriteNames = useMemo(
    () => tileEntries.map((entry) => entry.base_pokemon),
    [tileEntries],
  );
  const sprites = useSpriteImages(spriteNames);

  const tiles = useMemo<RosterTile[]>(
    () =>
      tileEntries.map((entry) => ({
        id: entry.id,
        line: entry.line_number,
        name: entry.base_pokemon,
        price: entry.price,
        group: entry.price_group,
        sprite: sprites.get(entry.base_pokemon) ?? null,
      })),
    [tileEntries, sprites],
  );

  const openSlots = Math.max(0, entries.length - trackers.length);

  // Wave-2 r3 (LUMA): the kiosk screen is a data face — it stands by away
  // from the roster station (see useStandbyDim), its glyphs are held under
  // the data luminance ceiling (no halo), and its screen-wash light fades
  // with it so a standby kiosk cannot lift the frame around the active face.
  const standby = useStandbyDim({ surfaces: PLAZA_DATA_SURFACES, subjectId: 'desk-pc', faceIds: KIOSK_FACE_IDS });
  const kioskLightRef = useRef<THREE.PointLight | null>(null);
  const kioskLightBase = night ? 7 : 4;
  useFrame(() => {
    const light = kioskLightRef.current;
    if (light) light.intensity = kioskLightBase * (1 - STANDBY_EMISSIVE_DROP * standby.uniforms.uStandby.value);
  });

  const paintScreen = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number) =>
      paintRosterGrid(ctx, w, h, {
        tiles,
        total: entries.length,
        open: openSlots,
        accent: deskRosterLive,
        red: centerRed,
        selected: 0,
        locale,
        dataLocale,
      }),
    [tiles, entries.length, openSlots, deskRosterLive, centerRed, locale, dataLocale],
  );
  const paintInterior = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number) =>
      paintInteriorWall(ctx, w, h, deskWarm, locale),
    [deskWarm, locale],
  );
  const paintFascia = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number) =>
      paintFasciaBand(ctx, w, h, centerRed),
    [centerRed],
  );
  const paintApronColour = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number) =>
      paintApron(ctx, w, h, 'colour', deskApron),
    [deskApron],
  );
  const paintApronRough = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number) =>
      paintApron(ctx, w, h, 'rough', deskApron),
    [deskApron],
  );

  const screenMap = usePaintedTexture(
    paintScreen,
    ROSTER_TEX_W,
    ROSTER_TEX_H,
    THREE.ClampToEdgeWrapping,
    `roster-${tiles.length}-${sprites.size}-${deskRosterLive}-${openSlots}`,
  );
  const interiorMap = usePaintedTexture(
    paintInterior,
    INTERIOR_TEX_W,
    INTERIOR_TEX_H,
    THREE.ClampToEdgeWrapping,
    `interior-${deskWarm}`,
  );
  const fasciaMap = usePaintedTexture(
    paintFascia,
    FASCIA_TEX_W,
    FASCIA_TEX_H,
    THREE.RepeatWrapping,
    `fascia-${centerRed}`,
  );
  const apronColourMap = usePaintedTexture(
    paintApronColour,
    APRON_TEX,
    APRON_TEX,
    THREE.RepeatWrapping,
    `apron-c-${deskApron}`,
  );
  const apronRoughMap = usePaintedTexture(
    paintApronRough,
    APRON_TEX,
    APRON_TEX,
    THREE.RepeatWrapping,
    `apron-r-${deskApron}`,
    THREE.NoColorSpace,
  );

  useEffect(() => {
    if (fasciaMap) fasciaMap.repeat.set(4, 1);
    if (apronColourMap) apronColourMap.repeat.set(2, 5);
    if (apronRoughMap) apronRoughMap.repeat.set(2, 5);
  }, [fasciaMap, apronColourMap, apronRoughMap]);

  /**
   * Under AgX a saturated red saturates its own channel around 1.0 scene-linear
   * — r1's 3.4 did not read "brighter red", it read white (255, 248, 242). The
   * band is authored just under that knee so the peak stays Poké-Ball red, and
   * the glow the bar asks for comes from the practicals on the paving.
   */
  const fasciaGlow = night ? 0.78 : 0.7;

  /**
   * World AABB of the glass face alone — not the bezel, not the pedestal, and
   * thin in x: the framer's distance picks up half the bounds' depth extent
   * (`along/2` in `frameSubject`), so every centimetre of slack in front of
   * or behind the pane is paid for in screen fill. Bezel-to-crown bounds put
   * the screen at 54 % of frame height in r1; the bare glass plane reaches
   * ≈ 68 % (70 % needs a wider pane, which the frozen off-axis swing turns
   * straight back into depth penalty).
   */
  const kioskBounds = useMemo<SubjectBounds>(
    () => ({
      min: [
        desk.x + KIOSK_X + KIOSK_SCREEN_X - 0.002,
        KIOSK_SCREEN_Y - KIOSK_SCREEN_H / 2,
        desk.z + KIOSK_Z - KIOSK_SCREEN_W / 2,
      ],
      max: [
        desk.x + KIOSK_X + KIOSK_SCREEN_X + 0.002,
        KIOSK_SCREEN_Y + KIOSK_SCREEN_H / 2,
        desk.z + KIOSK_Z + KIOSK_SCREEN_W / 2,
      ],
    }),
    [desk.x, desk.z],
  );
  /**
   * Fidelity wave 2 (2D): the kiosk opens the WHOLE Kaderliste
   * (`?board=roster`, EvoligaOverlays' RosterListPanel) — it used to open the
   * first line's `?mon=` panel, which answered "what is line 1", not "what
   * is on this screen". The panel is always registered (German empty state
   * when no list is bound), so the tap never dead-ends.
   */
  const kioskPanel = useMemo<SubjectPanel>(() => ({ param: 'board', value: ROSTER_BOARD_VALUE }), []);

  return (
    <group position={[desk.x, 0, desk.z]}>
      {/* ── Interior: the room the glass and the opening look into ───────── */}
      <mesh position={[(FRONT_X + ROOM_BACK) / 2, 0.02, 0]} receiveShadow>
        <boxGeometry args={[FRONT_X - ROOM_BACK, 0.04, GLASS_HALF * 2]} />
        <meshStandardMaterial color="#3a2c22" roughness={0.66} metalness={0.04} />
      </mesh>
      <mesh position={[ROOM_BACK, OPEN_H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[GLASS_HALF * 2, OPEN_H]} />
        <meshStandardMaterial
          map={interiorMap ?? undefined}
          color={interiorMap ? '#ffffff' : '#2a1810'}
          emissive={deskWarm}
          emissiveMap={interiorMap ?? undefined}
          emissiveIntensity={night ? 0.38 : 0.35}
          roughness={0.84}
          metalness={0.02}
        />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`room-side-${side}`}
          position={[(FRONT_X + ROOM_BACK) / 2, OPEN_H / 2, side * GLASS_HALF]}
        >
          <boxGeometry args={[FRONT_X - ROOM_BACK, OPEN_H, 0.12]} />
          <meshStandardMaterial color="#33241a" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[(FRONT_X + ROOM_BACK) / 2, OPEN_H + 0.06, 0]}>
        <boxGeometry args={[FRONT_X - ROOM_BACK, 0.12, GLASS_HALF * 2]} />
        <meshStandardMaterial color="#241a13" roughness={0.7} />
      </mesh>
      {/* Illuminated back-bar panel — the lit room plane behind the glass. */}
      {/*
        Night 0.85 read (250, 233, 212) across the panel's full width — the
        single hottest broad surface in the station, above the kiosk screen.
        0.52 keeps it a clearly lit room plane that still sits under the screen.
      */}
      <mesh position={[ROOM_BACK + 0.08, 2.52, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[3.4, 0.62]} />
        <meshStandardMaterial
          color={deskWarm}
          emissive={deskWarm}
          emissiveIntensity={night ? 0.52 : 0.95}
          toneMapped={false}
        />
      </mesh>
      {([-1.4, 1.4] as const).map((z) => (
        <InteriorShelf key={`shelf-${z}`} at={[ROOM_BACK + 0.5, z]} warm={deskWarm} night={night} />
      ))}
      {([
        [-2.1, -1.5],
        [-2.1, 1.5],
        [-3.6, -1.5],
        [-3.6, 1.5],
      ] as const).map(([x, z]) => (
        <CeilingCan key={`can-${x}-${z}`} at={[x, z]} warm={deskWarm} night={night} />
      ))}

      {/* ── Shopfront: corner pylons, glazing, service opening ───────────── */}
      {/*
        The pylons carry the glazing line 1.65 m forward of the wall, so the
        shopfront is a recess between two masses rather than a flat elevation —
        and the band that caps them has somewhere to turn.
      */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`pier-${side}`}
          position={[(WALL_X + FRONT_X + PYLON_D) / 2, OPEN_H / 2, side * PYLON_Z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[FRONT_X + PYLON_D - WALL_X, OPEN_H, PYLON_HALF * 2]} />
          <meshStandardMaterial color={STONE} roughness={0.62} metalness={0.14} />
        </mesh>
      ))}
      {/* Side walls of the pavilion, behind the pylons. */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`return-${side}`}
          position={[(WALL_X + ROOM_BACK) / 2, (OPEN_H + FASCIA_H) / 2, side * (BAY_HALF - 0.15)]}
          castShadow
        >
          <boxGeometry args={[WALL_X - ROOM_BACK, OPEN_H + FASCIA_H, 0.3]} />
          <meshStandardMaterial color={STONE} roughness={0.66} metalness={0.12} />
        </mesh>
      ))}
      {/* Structural header over the service opening, behind the red band. */}
      <mesh position={[(WALL_X + FRONT_X) / 2 + 0.15, OPEN_H + FASCIA_H / 2, 0]} castShadow>
        <boxGeometry args={[0.6, FASCIA_H, GLASS_HALF * 2]} />
        <meshStandardMaterial color={CHARCOAL} roughness={0.5} metalness={0.28} />
      </mesh>

      {/* Black glass bays flanking the opening. */}
      {([-1, 1] as const).map((side) => (
        <group key={`bay-${side}`}>
          <mesh position={[FRONT_X, 0.07, side * ((OPEN_HALF + GLASS_HALF) / 2)]}>
            <boxGeometry args={[0.22, 0.14, GLASS_HALF - OPEN_HALF]} />
            <meshStandardMaterial color={CHARCOAL} roughness={0.44} metalness={0.4} />
          </mesh>
          <mesh
            position={[FRONT_X, (OPEN_H + 0.14) / 2, side * ((OPEN_HALF + GLASS_HALF) / 2)]}
            rotation={[0, Math.PI / 2, 0]}
            renderOrder={3}
          >
            <planeGeometry args={[GLASS_HALF - OPEN_HALF, OPEN_H - 0.14]} />
            {/*
              Satin, not mirror: a glossy pane keeps handing the directional
              moon a migratory near-white specular (measured (255,254,246) at
              three gloss settings, each time a few px from the last). The bay
              keeps a broad clearcoat sheen for glass identity but no compact
              specular the screen has to compete with.
            */}
            <meshPhysicalMaterial
              color="#0a1016"
              transparent
              opacity={night ? 0.5 : 0.62}
              roughness={0.5}
              metalness={0}
              clearcoat={0.3}
              clearcoatRoughness={1}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Mullions and transom — the glazing reads as joinery, not a sheet. */}
          {/*
            Die-cast, not polished: at metalness 0.42 / roughness 0.4 the
            south mullion returned the directional moon as a warm-white
            streak (255, 252, 244) beside the fascia — joinery keeps a soft
            sheen only.
          */}
          {([OPEN_HALF, GLASS_HALF] as const).map((z) => (
            <mesh key={`mullion-${side}-${z}`} position={[FRONT_X, OPEN_H / 2, side * z]}>
              <boxGeometry args={[0.26, OPEN_H, 0.12]} />
              <meshStandardMaterial color={CHARCOAL} roughness={0.55} metalness={0.24} />
            </mesh>
          ))}
          <mesh position={[FRONT_X, 2.42, side * ((OPEN_HALF + GLASS_HALF) / 2)]}>
            <boxGeometry args={[0.24, 0.09, GLASS_HALF - OPEN_HALF]} />
            <meshStandardMaterial color={CHARCOAL} roughness={0.55} metalness={0.24} />
          </mesh>
        </group>
      ))}

      {/* ── Red Poké-Ball fascia: band, corner wraps, two discs ──────────── */}
      {/* Band over the opening, 0.7 m deep so it has a soffit to show. */}
      <mesh position={[FRONT_X + FASCIA_D / 2, FASCIA_Y, 0]} castShadow>
        <boxGeometry args={[FASCIA_D, FASCIA_H, GLASS_HALF * 2]} />
        <FasciaSkin red={centerRed} map={fasciaMap} glow={fasciaGlow} />
      </mesh>
      {/*
        Corner wraps. The pylon block carries the dimmed skin, so the face it
        turns toward the opening — the only return this camera can see — sits a
        stop under the front plate laid 2 mm proud of it. Unmapped: the band's
        seam repeat is authored for a 4.6 m run and would stripe a 0.44 m
        return (PB-069).
      */}
      {([-1, 1] as const).map((side) => (
        <group key={`fascia-wrap-${side}`}>
          <mesh position={[FRONT_X + PYLON_D / 2, FASCIA_Y, side * PYLON_Z]} castShadow>
            <boxGeometry args={[PYLON_D, FASCIA_H, PYLON_HALF * 2]} />
            <FasciaSkin red={centerRed} map={null} glow={fasciaGlow * RETURN_DIM} />
          </mesh>
          <mesh
            position={[FRONT_X + PYLON_D + 0.002, FASCIA_Y, side * PYLON_Z]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[PYLON_HALF * 2, FASCIA_H]} />
            <FasciaSkin red={centerRed} map={null} glow={fasciaGlow} />
          </mesh>
          {/* Soffit reveal under the wrap. */}
          <mesh
            position={[FRONT_X + (PYLON_D + SOFFIT_LIP) / 2, OPEN_H - SOFFIT_H / 2, side * PYLON_Z]}
          >
            <boxGeometry args={[PYLON_D + SOFFIT_LIP, SOFFIT_H, PYLON_HALF * 2]} />
            <meshStandardMaterial color={CHARCOAL} roughness={0.52} metalness={0.26} />
          </mesh>
          {/* Cornice cap, stepped forward over the pylon. */}
          <mesh
            position={[(WALL_X - 0.1 + FRONT_X + PYLON_D + 0.06) / 2, PARAPET_Y, side * PYLON_Z]}
            castShadow
          >
            <boxGeometry
              args={[FRONT_X + PYLON_D + 0.16 - WALL_X, PARAPET_H, PYLON_HALF * 2 + 0.08]}
            />
            <meshStandardMaterial color={STONE} roughness={0.6} metalness={0.16} />
          </mesh>
        </group>
      ))}
      {/*
        Soffit line across the opening: a charcoal lip 7 cm proud of the band,
        read from below at the frozen pose — the shadow gap that separates the
        red roof edge from the glazing.
      */}
      <mesh position={[FRONT_X + (FASCIA_D + SOFFIT_LIP) / 2, OPEN_H - SOFFIT_H / 2, 0]}>
        <boxGeometry args={[FASCIA_D + SOFFIT_LIP, SOFFIT_H, GLASS_HALF * 2]} />
        <meshStandardMaterial color={CHARCOAL} roughness={0.52} metalness={0.26} />
      </mesh>
      {([-1.62, 1.62] as const).map((z) => (
        <BallMotif
          key={`ball-${z}`}
          position={[FRONT_X + FASCIA_D + 0.05, FASCIA_Y, z]}
          red={centerRed}
          night={night}
          radius={0.33}
        />
      ))}
      {/* Cornice cap oversailing the band. */}
      <mesh position={[FRONT_X + 0.16, PARAPET_Y, 0]} castShadow>
        <boxGeometry args={[1.14, PARAPET_H, GLASS_HALF * 2]} />
        <meshStandardMaterial color={STONE} roughness={0.6} metalness={0.16} />
      </mesh>

      {/* ── Counter: curved lacquer body, wood top, red accent band ───────── */}
      <group position={[COUNTER_CX, 0, COUNTER_Z]}>
        <mesh position={[0, 0.07, 0]}>
          <cylinderGeometry
            args={[COUNTER_R - 0.05, COUNTER_R - 0.05, 0.14, 48, 1, true, COUNTER_THETA, COUNTER_SWEEP]}
          />
          <meshStandardMaterial color={CHARCOAL} roughness={0.5} metalness={0.2} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.58, 0]} castShadow>
          <cylinderGeometry
            args={[COUNTER_R, COUNTER_R, 0.88, 48, 1, true, COUNTER_THETA, COUNTER_SWEEP]}
          />
          {/*
            Lacquer, not a mirror: at roughness 0.22 the two red practicals in
            front of the desk threw a specular streak that peaked (255,180,164)
            — brighter than the kiosk screen, which owns the local peak.
          */}
          <meshStandardMaterial
            color="#dde3e9"
            roughness={0.36}
            metalness={0.06}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0.96, 0]}>
          <cylinderGeometry
            args={[COUNTER_R + 0.015, COUNTER_R + 0.015, 0.12, 48, 1, true, COUNTER_THETA, COUNTER_SWEEP]}
          />
          <meshStandardMaterial
            color={centerRed}
            emissive={centerRed}
            emissiveIntensity={night ? 0.6 : 0.7}
            roughness={0.42}
            metalness={0.14}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 1.06, 0]}>
          <cylinderGeometry
            args={[COUNTER_R + 0.05, COUNTER_R + 0.05, 0.08, 48, 1, true, COUNTER_THETA, COUNTER_SWEEP]}
          />
          <meshStandardMaterial color="#c9a273" roughness={0.48} metalness={0.05} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, DESK.height, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <ringGeometry
            args={[COUNTER_BACK_R, COUNTER_R + 0.05, 48, 1, -COUNTER_SWEEP / 2, COUNTER_SWEEP]}
          />
          <meshStandardMaterial
            color="#c9a273"
            roughness={0.46}
            metalness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, DESK.height / 2, 0]}>
          <cylinderGeometry
            args={[COUNTER_BACK_R, COUNTER_BACK_R, DESK.height, 48, 1, true, COUNTER_THETA, COUNTER_SWEEP]}
          />
          <meshStandardMaterial color="#2a2d33" roughness={0.6} metalness={0.12} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Nurse on her dais, behind the counter. */}
      <mesh position={[NURSE_X, NURSE_DAIS_H / 2, NURSE_Z]} receiveShadow castShadow>
        <boxGeometry args={[1.5, NURSE_DAIS_H, 1.9]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.56} metalness={0.12} />
      </mesh>
      <Suspense fallback={null}>
        <Nurse />
      </Suspense>

      {/* ── Rotom PC kiosk — the `desk-pc` Subject ────────────────────────── */}
      <FocusSubject
        id="desk-pc"
        kind="desk-pc"
        label={routeT(locale)('subject.kiosk')}
        facing={[1, 0, 0]}
        panel={kioskPanel}
        bounds={kioskBounds}
      >
        <group position={[KIOSK_X, 0, KIOSK_Z]}>
          <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.72, 0.16, 1.06]} />
            <meshStandardMaterial color="#1a1d22" roughness={0.44} metalness={0.5} />
          </mesh>
          <mesh position={[0.02, 0.19, 0]}>
            <boxGeometry args={[0.66, 0.04, 1]} />
            <meshStandardMaterial
              color={deskRosterAccent}
              emissive={deskRosterAccent}
              emissiveIntensity={night ? 1.5 : 1.1}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 1.2, 0]} castShadow>
            <boxGeometry args={[KIOSK_BODY_D, 2.02, KIOSK_BODY_W]} />
            <meshPhysicalMaterial
              color="#080b10"
              roughness={0.12}
              metalness={0.35}
              clearcoat={1}
              clearcoatRoughness={0.05}
            />
          </mesh>
          <mesh position={[0, KIOSK_TOP - 0.11, 0]} castShadow>
            <boxGeometry args={[KIOSK_BODY_D + 0.06, 0.22, KIOSK_BODY_W + 0.08]} />
            <meshStandardMaterial color={deskKiosk} roughness={0.3} metalness={0.42} />
          </mesh>
          {/* Bezel frame — a 5 cm border, so the glass owns the kiosk face. */}
          <mesh position={[KIOSK_BEZEL_X, KIOSK_SCREEN_Y, 0]} castShadow>
            <boxGeometry
              args={[0.12, KIOSK_SCREEN_H + KIOSK_BEZEL_BORDER, KIOSK_SCREEN_W + KIOSK_BEZEL_BORDER]}
            />
            <meshStandardMaterial color="#101318" roughness={0.34} metalness={0.46} />
          </mesh>
          <mesh position={[0.36, KIOSK_SCREEN_Y + (KIOSK_SCREEN_H + KIOSK_BEZEL_BORDER) / 2 + 0.03, 0]}>
            <boxGeometry args={[0.05, 0.05, KIOSK_SCREEN_W + 0.06]} />
            <meshStandardMaterial
              color={deskRosterAccent}
              emissive={deskRosterAccent}
              emissiveIntensity={night ? 1.7 : 1.3}
              toneMapped={false}
            />
          </mesh>
          {/*
            Live roster grid. The station's one HDR surface: the band, the cans
            and the kiosk trim all sit under clip so the screen is the local
            peak and Bloom only spreads past *this* bezel.
          */}
          <mesh position={[KIOSK_SCREEN_X, KIOSK_SCREEN_Y, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[KIOSK_SCREEN_W, KIOSK_SCREEN_H]} />
            <meshStandardMaterial
              color="#04161c"
              emissive={screenMap ? '#ffffff' : '#052a30'}
              emissiveMap={screenMap ?? undefined}
              emissiveIntensity={night ? 3.4 : 1.8}
              roughness={0.92}
              metalness={0}
              toneMapped={false}
              {...standby.materialProps}
            />
          </mesh>
          {([-0.19, 0.19] as const).map((z) => (
            <mesh key={`eye-${z}`} position={[0.28, KIOSK_TOP - 0.11, z]}>
              <sphereGeometry args={[0.052, 14, 10]} />
              <meshStandardMaterial
                color={deskRosterAccent}
                emissive={deskRosterAccent}
                emissiveIntensity={night ? 2 : 1.6}
                toneMapped={false}
              />
            </mesh>
          ))}
          <pointLight
            ref={kioskLightRef}
            position={[1.55, KIOSK_SCREEN_Y - 0.35, 0]}
            color={deskRosterLive}
            intensity={kioskLightBase}
            distance={4.5}
            decay={2}
          />
        </group>
      </FocusSubject>

      {/* ── Wet threshold band under the shopfront ────────────────────────── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.75, 0.012, 0]} receiveShadow>
        <planeGeometry args={[2.5, BAY_HALF * 2]} />
        {/*
          Transparent on purpose: an opaque slate slab replaces the plaza
          paving with a blue mat. At 0.4 the band only wets the cobbles that
          are already there, and the fascia red lands on top of them.
        */}
        <meshPhysicalMaterial
          color={deskApron}
          map={apronColourMap ?? undefined}
          roughnessMap={apronRoughMap ?? undefined}
          transparent
          opacity={0.4}
          roughness={0.4}
          metalness={0.04}
          clearcoat={0.7}
          clearcoatRoughness={0.18}
          depthWrite={false}
        />
      </mesh>

      {/*
        ── Practicals: the fascia red has to land on the stone ─────────────
        Stood off the band on purpose. At 0.4 m this light was a 1/d² hot spot
        that blew the band's centre white in *both* themes (r1: (255,184,169)
        in sun) while the corners read a clean red; from 2 m out the falloff
        across the 4.6 m run is gentle and the spill still reaches the paving.
      */}
      <pointLight
        position={[FRONT_X + 2.3, OPEN_H - 0.75, 0]}
        color={centerRed}
        intensity={night ? 8 : 2.6}
        distance={14}
        decay={2}
      />
      {/*
        Paving spill. At x=1.5 these stood ~1 m off the counter's front face and
        washed all 700 px of it to 255 in red — a broad clipped surface, not a
        specular pinpoint, and brighter than the kiosk screen. Standing them
        1.1 m further out cuts the counter's irradiance ~3x (1/d²) while the
        cobbles, which are much closer to directly beneath, keep their red.
        Range then buys the paving back: three.js windows the falloff by
        (1-(d/distance)^4)^2, so 8 -> 11 lifts the far cobbles ~45 % and the
        near counter ~0.5 %.
      */}
      {([-2.1, 2.1] as const).map((z) => (
        <pointLight
          key={`spill-${z}`}
          position={[2.6, 0.9, z]}
          color={centerRed}
          intensity={night ? 12 : 3.5}
          distance={11}
          decay={2}
        />
      ))}
      {/*
        Counter wash. Night 7 peaked the lacquer at 251-255; at 4.5 the red
        accent band still brushed 250 on R — one notch over the ceiling the
        screen owns. 4.0 keeps every counter channel under 250 in dark while
        daylight keeps 6 (the sun dominates there anyway).
      */}
      <pointLight
        position={[0.4, 2.5, COUNTER_Z]}
        color={deskWarm}
        intensity={night ? 4 : 6}
        distance={7}
        decay={2}
      />
    </group>
  );
}

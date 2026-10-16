'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import { noteDataFaceEvent, useDataFaceResidency } from '@/components/world/route/residency-store';
import { queuePaint } from '@/components/world/route/paint-queue';
import { JUMBOTRON } from '@/lib/route-world/layout';
import type { LandmarkAnchor } from '@/lib/route-world/layout';
import { paintBoardPage, type BoardPaintTools } from '@/lib/route-world/board-paint-path';
import { routeT } from '@/lib/route-world/paint-copy';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import {
  DATA_EMISSIVE_CEILING,
  DATA_EMISSIVE_CEILING_DAY,
  STANDBY_EMISSIVE_DROP,
  STANDBY_GLSL_DECLARE,
  standbyShaderParameters,
  useStandbyDim,
  type StandbyUniforms,
} from '@/components/world/route/useStandbyDim';
import { PLAZA_DATA_SURFACES } from '../data-faces';
import { nextKickoffTicker, type BoardContent } from './board-content';
import {
  BOARD_TEX_H,
  BOARD_TEX_W,
  boardPages,
  paintPagePips,
  paintScanlines,
  paintTickerStrip,
  TICKER_STRIP_H,
  type BoardKind,
  type BoardPage,
  type BoardTheme,
} from './board-painters';

/** Seconds a page holds before the wipe to the next one. */
const PAGE_HOLD_S = 9;
const PAGE_WIPE_S = 0.8;
/**
 * Where each board's page clock starts. The schedule board comes in half a hold
 * ahead of the pulse board so the two never wipe on the same frame
 * (`look-sheet-schedule.md`).
 */
const PAGE_OFFSET_S: Record<BoardKind, number> = { pulse: 0, schedule: PAGE_HOLD_S / 2 };
/** Cadence of the footer countdown — never once per frame. */
const TICKER_TICK_S = 1;
/**
 * Linear-light gain on the panel (its paper white). Fidelity wave 2 (2F
 * LUMA): the night gain sat at 1.9 so the glyphs crossed the 1.7 bloom
 * threshold ON PURPOSE — and the blur haloed every line of text. Data faces
 * now stay under the bloom threshold: the night gain is authored AT the
 * data luminance ceiling (1.6) and the shader clamps the wipe seam to it.
 */
const GAIN_NIGHT = DATA_EMISSIVE_CEILING;
/**
 * Day gain. Wave 2 r2 (W1 luma budget: the light-theme sky and tower out-read
 * the active face, P99 207.6 vs outside 211.9 at pulse 1440): the day panel is
 * authored AT the day data ceiling (under the 2.0 day bloom threshold) — the
 * active face's emissive floor. The neighbour still stands by to 0.3 of it.
 */
const GAIN_DAY = DATA_EMISSIVE_CEILING_DAY;
/**
 * The cabinet's own practicals (the two flood housings over the hood and the
 * accent stripe under the plate) at night: the board's lamps, so they may
 * not outshine its paper white (§5.10). Authored 6 / 2.4 bloomed over the
 * masthead row; now at the data ceiling. Day values are unchanged (≤ 1.1).
 */
const FLOOD_NIGHT = DATA_EMISSIVE_CEILING;
/** The board's accent point light (the pane's wash on the forecourt) at full, lit board. */
const BOARD_LIGHT_NIGHT = 16;
const BOARD_LIGHT_DAY = 9;
const STRIPE_NIGHT = DATA_EMISSIVE_CEILING;

interface LedCanvasGlobals {
  __LED_CANVAS_MEASURE?: Record<string, string>;
  __LED_CANVAS?: Record<string, HTMLCanvasElement>;
}

/**
 * `?boardPage=<n>` pins the rotation for headless captures (evidence must not
 * depend on when the frame was taken). `prefers-reduced-motion` pins page 0.
 * Ignored (null) for every other visitor.
 */
function readPinnedPage(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('boardPage');
  if (raw !== null && /^\d$/.test(raw)) return Number(raw);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  return null;
}

function hexAt(data: Uint8ClampedArray, w: number, x: number, y: number): string {
  const i = (y * w + x) * 4;
  const ch = (v: number) => v.toString(16).padStart(2, '0');
  return `#${ch(data[i])}${ch(data[i + 1])}${ch(data[i + 2])}`;
}

function lumaAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/** The corner `measureBoardCanvas` samples (its reads stay inside x < 520, y < 160). */
const MEASURE_W = 522;
const MEASURE_H = 162;

/**
 * ENGINE-A4 (ceremony main thread): the PB-009 glyph probe below reads back a
 * GPU-backed 2048-px page (drawImage + getImageData, ~57 ms: the longest
 * paint-queue task of the plaza ceremony, one long animation frame under the
 * ball). Nothing consumes its note but the console, so it runs only on
 * request: `?routeDebug=1&routeLedMeasure=1`, never in production.
 */
function ledMeasureRequested(): boolean {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('routeDebug') === '1' && params.get('routeLedMeasure') === '1';
  } catch {
    return false;
  }
}

/** CPU-canvas sample before any GPU upload — evidence that glyphs were painted (PB-009). */
function measureBoardCanvas(source: HTMLCanvasElement, kind: BoardKind): void {
  // ENGINE r3 (load long task): only the corner the probe reads (x < 522,
  // y < 162) is copied and read back, not the whole 2048-px page; every
  // sample below lies inside it, so the note is unchanged.
  const measure = document.createElement('canvas');
  measure.width = Math.min(source.width, MEASURE_W);
  measure.height = Math.min(source.height, MEASURE_H);
  const ctx = measure.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
  const w = measure.width;
  const { data } = ctx.getImageData(0, 0, w, measure.height);
  const bg = hexAt(data, w, 16, 16);
  const glyph = hexAt(data, w, 140, 118);
  const contrast = Math.abs(lumaAt(data, w, 140, 118) - lumaAt(data, w, 16, 16));
  let bright = 0;
  for (let y = 70; y < 160; y += 2) {
    for (let x = 50; x < 520; x += 2) {
      if (lumaAt(data, w, x, y) > 180) bright += 1;
    }
  }
  const verdict = bright > 40 && contrast > 80 ? 'glyphs' : 'slab';
  const note =
    verdict === 'glyphs'
      ? `canvas has glyphs ${kind} bg=${bg} glyph=${glyph} contrast=${contrast.toFixed(0)} bright=${bright}`
      : `canvas is already a slab ${kind} dominant=${bg} glyph=${glyph} contrast=${contrast.toFixed(0)} bright=${bright}`;
  const store = window as Window & LedCanvasGlobals;
  store.__LED_CANVAS_MEASURE = store.__LED_CANVAS_MEASURE ?? {};
  store.__LED_CANVAS_MEASURE[kind] = note;
  store.__LED_CANVAS = store.__LED_CANVAS ?? {};
  store.__LED_CANVAS[kind] = source;
  console.info(`[led-canvas] ${note}`);
}

/**
 * ENGINE r6 (E2): a painted page canvas IS its texture's image — no
 * synchronous PNG encode (`toDataURL`, 50–150 ms per 2048-px page) and no
 * image decode on upload. GPU state is the old loader path's, field for field
 * (a plain `Texture`: flipY, straight alpha; sRGB, linear, no mips, clamp,
 * anisotropy 4), so the panel samples the same pixels. A plain `Texture`, not
 * `CanvasTexture`: QualityGovernor's `retainDataTextureDisposals` patches
 * `CanvasTexture.prototype.dispose`, and a repainted page set must still free
 * its old uploads. `paintBoardPage` allocates a fresh canvas per page, so no
 * canvas is ever repainted under a live upload and no snapshot
 * (`createImageBitmap`) is needed.
 */
export function boardPageTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.Texture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Paints every page once (page canvas → texture, made in the page's own paint
 * task) and publishes them together so the rotation never shows a half-painted
 * set. C-105 r1: every page is allocated and font-floored through the engine's
 * shared `paintBoardPage` (pulse station, 7.6 m jumbotron face) — the declared
 * 1024×592 constants floor to 2048×1184, and the scanline pass is folded INTO
 * the same paint callback (same canvas), as are the page pips that tell the
 * visitor which of N pages is showing.
 */
function useBoardPageTextures(
  pages: BoardPage[],
  content: BoardContent,
  theme: BoardTheme,
  faceId: string,
): THREE.Texture[] | null {
  const [textures, setTextures] = useState<THREE.Texture[] | null>(null);
  // ENGINE r3 (D23): the pages paint one per task (below). ENGINE r4: the
  // board's residency is its DATA FACE's (`useDataFaceResidency` in Board):
  // pending until the set is painted and its panel mounted, and pending again
  // whenever the set is repainted.

  useEffect(() => {
    let cancelPaint: (() => void) | null = null;
    // This run's page textures, in page order; the cleanup disposes every one
    // made so far (a set interrupted mid-chain included) — never memoized.
    const painted: THREE.Texture[] = [];
    noteDataFaceEvent(faceId, `paint:${pages.length}`);
    // ENGINE r3 (load long task, 0.3 s on dev in one effect): one page per
    // task through the engine's paint queue — paint, scanlines and (ENGINE r6,
    // E2) the page's texture over its own canvas is the unit; the PNG encode
    // is gone — so the ceremony's main thread never carries the whole set at
    // once. Same paint calls in the same order: the pixels are unchanged. The
    // set publishes in the task that paints its last page (an empty set: in
    // one queued task). A cancelled job never runs.
    const paintPage = (i: number) => {
      cancelPaint = null;
      if (i < pages.length) {
        const page = pages[i];
        try {
          const result = paintBoardPage({
            current: { width: BOARD_TEX_W, height: BOARD_TEX_H },
            station: PLAZA_STATIONS[0],
            boardWorldWidthM: JUMBOTRON.width,
            paint: (ctx, w, h, tools: BoardPaintTools) => {
              page.paint(ctx, w, h, content, theme, tools);
              // Fidelity W1: "1/2 ●○" in the masthead corner — static per page.
              paintPagePips(ctx, i, pages.length, theme, tools);
              paintScanlines(ctx, w, h);
            },
          });
          if (i === 0 && ledMeasureRequested()) measureBoardCanvas(result.canvas, theme.kind);
          painted.push(boardPageTexture(result.canvas));
        } catch (error) {
          // ENGINE r4: recorded (trace + console), then the chain stops — the
          // face stays pending, so the gate never opens over it.
          noteDataFaceEvent(faceId, `paint-error:${i}`);
          throw error;
        }
        if (i + 1 < pages.length) {
          cancelPaint = queuePaint(() => paintPage(i + 1));
          return;
        }
      }
      noteDataFaceEvent(faceId, `loaded:${painted.length}`);
      setTextures(painted);
    };
    cancelPaint = queuePaint(() => paintPage(0));

    return () => {
      cancelPaint?.();
      painted.forEach((tex) => tex.dispose());
      noteDataFaceEvent(faceId, 'reset');
      setTextures(null);
    };
  }, [pages, content, theme, faceId]);

  return textures;
}

/**
 * The panel's own standby depth (wave 2 r2, W1: "the neighbour at the standby
 * dim, ≤ 0.6 of the active face's P99"). The shared 0.7 drop + 35 % fog mix
 * left the neighbour at 0.77–0.82 of the active P99 in light (AgX compresses
 * the top, and a 35 % mix toward a bright day fog LIFTS a dark panel to
 * beige). A self-lit panel recedes by losing light, so it drops further and
 * takes less of the air: measured on the rendered PNG (gamma luma).
 */
const PANEL_STANDBY_DROP = 0.93;
const PANEL_STANDBY_FOG_MIX = 0.08;

const PANEL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Two-page crossfade as a left→right wipe with an accent seam, then the live
 * footer strip laid over the baked ticker band; output is linear light × gain
 * so AgX sees a real emitter. Fidelity wave 2 (2F): the standby dim (emission
 * × (1 − PANEL_STANDBY_DROP s), then PANEL_STANDBY_FOG_MIX × s toward the fog
 * colour — the panel is unlit, so its output stands in for the albedo) and the
 * data luminance ceiling, which
 * keeps even the accent seam under the bloom threshold.
 */
const PANEL_FRAGMENT = /* glsl */ `
  ${STANDBY_GLSL_DECLARE}
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform sampler2D uTicker;
  uniform float uMix;
  uniform float uTickerMix;
  uniform float uGain;
  uniform vec3 uAccent;
  varying vec2 vUv;
  const float TICKER_H = ${TICKER_STRIP_H}.0 / ${BOARD_TEX_H}.0;
  void main() {
    vec3 a = texture2D(uFrom, vUv).rgb;
    vec3 b = texture2D(uTo, vUv).rgb;
    float front = uMix * 1.2 - 0.1;
    float t = 1.0 - smoothstep(front - 0.06, front + 0.06, vUv.x);
    vec3 color = mix(a, b, t);
    // Strip texture has no flipY, so its first row is the band's top edge.
    vec3 ticker = texture2D(uTicker, vec2(vUv.x, 1.0 - vUv.y / TICKER_H)).rgb;
    color = mix(color, ticker, step(vUv.y, TICKER_H) * uTickerMix);
    float live = step(0.001, uMix) * step(uMix, 0.999);
    float seam = exp(-abs(vUv.x - front) * 36.0) * live;
    color += uAccent * seam * 1.6;
    vec3 lit = standbyCeiling(color * uGain * (1.0 - ${PANEL_STANDBY_DROP.toFixed(2)} * uStandby));
    lit = mix(lit, uStandbyFog, ${PANEL_STANDBY_FOG_MIX.toFixed(2)} * uStandby);
    gl_FragColor = vec4(lit, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface PanelUniforms extends StandbyUniforms {
  uFrom: { value: THREE.Texture | null };
  uTo: { value: THREE.Texture | null };
  uTicker: { value: THREE.Texture | null };
  uMix: { value: number };
  uTickerMix: { value: number };
  uGain: { value: number };
  uAccent: { value: THREE.Color };
  [uniform: string]: THREE.IUniform;
}

/** The panel's uniforms, created once WITH the standby set (never added lazily — §5.13). */
function createPanelUniforms(standby: StandbyUniforms): PanelUniforms {
  return {
    ...standby,
    uFrom: { value: null },
    uTo: { value: null },
    uTicker: { value: null },
    uMix: { value: 0 },
    uTickerMix: { value: 0 },
    uGain: { value: 1 },
    uAccent: { value: new THREE.Color() },
  };
}

/**
 * The footer countdown as its own strip. Kept off the page textures on
 * purpose: those are whole 2048-px pages painted and uploaded once, far too
 * expensive to redo for a clock. A DataTexture takes the pixels straight from
 * a 2D canvas once every `TICKER_TICK_S`. C-105 r1:
 * the strip is a TEXT content surface too — every repaint allocates through
 * the shared `paintBoardPage`, so the declared 1024×56 constants floor to
 * 2048×112 and the ticker line carries the pulse-station font floor.
 */
const TICKER_TEX_W = BOARD_TEX_W * 2;
const TICKER_TEX_H = TICKER_STRIP_H * 2;

interface TickerStrip {
  texture: THREE.DataTexture;
  repaint: (nowMs: number) => void;
}

function createTickerStrip(content: BoardContent, theme: BoardTheme): TickerStrip | null {
  if (typeof document === 'undefined') return null;

  const pixels = new Uint8Array(TICKER_TEX_W * TICKER_TEX_H * 4);
  const texture = new THREE.DataTexture(pixels, TICKER_TEX_W, TICKER_TEX_H);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  // ENGINE-A3 fix (D23 headroom): ONE canvas, created CPU-backed
  // (`willReadFrequently`) before any other context request. The strip used
  // to paint a fresh GPU-backed canvas every tick and read it back with
  // `getImageData` — a synchronous GPU readback that waited on the world's
  // frame: ~22 ms on the main thread every second after the reveal (the
  // plaza's 1 Hz 50–80 ms long tasks in the quiet sweep / veil-after
  // windows). A software canvas reads back with a copy.
  const canvas = document.createElement('canvas');
  canvas.getContext('2d', { willReadFrequently: true });
  let painted: string | null = null;
  const repaint = (nowMs: number) => {
    const text = nextKickoffTicker(content, nowMs);
    // The live and season lines are static between data changes.
    if (text === painted) return;
    painted = text;
    const result = paintBoardPage({
      current: { width: BOARD_TEX_W, height: TICKER_STRIP_H },
      station: PLAZA_STATIONS[0],
      boardWorldWidthM: JUMBOTRON.width,
      canvas,
      paint: (ctx, w, _h, tools) => {
        paintTickerStrip(ctx, w, theme, text, tools);
      },
    });
    const ctx = result.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    pixels.set(ctx.getImageData(0, 0, TICKER_TEX_W, TICKER_TEX_H).data);
    texture.needsUpdate = true;
  };
  repaint(Date.now());
  return { texture, repaint };
}

function useTickerStrip(content: BoardContent, theme: BoardTheme, active: boolean): THREE.DataTexture | null {
  const strip = useMemo(() => (active ? createTickerStrip(content, theme) : null), [content, theme, active]);
  const sinceRef = useRef(0);

  // Freeing the GPU copy is safe here: the DataTexture keeps its pixel buffer,
  // so the next repaint re-uploads it instead of leaving a dead upload (PB-003).
  useEffect(() => () => strip?.texture.dispose(), [strip]);

  useFrame((_, delta) => {
    if (!strip) return;
    sinceRef.current += delta;
    if (sinceRef.current < TICKER_TICK_S) return;
    sinceRef.current = 0;
    strip.repaint(Date.now());
  });

  return strip?.texture ?? null;
}

/**
 * Rotates pages on the panel material through its ref (uniforms are driven
 * per frame, never during render); static when pinned or single-page.
 */
function usePageRotation(
  materialRef: React.RefObject<THREE.ShaderMaterial | null>,
  textures: THREE.Texture[] | null,
  clockOffsetS: number,
): void {
  const pinned = useMemo(() => readPinnedPage(), []);
  const state = useRef({ index: 0, clock: 0, wiping: false, armed: false });

  useEffect(() => {
    const s = state.current;
    s.index = pinned !== null && textures ? Math.min(pinned, textures.length - 1) : 0;
    s.clock = clockOffsetS;
    s.wiping = false;
    s.armed = false;
  }, [textures, pinned, clockOffsetS]);

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (!material || !textures || textures.length === 0) return;
    const s = state.current;
    const u = material.uniforms as PanelUniforms;
    const count = textures.length;
    if (!s.armed) {
      u.uFrom.value = textures[s.index];
      u.uTo.value = textures[(s.index + 1) % count];
      u.uMix.value = 0;
      s.armed = true;
    }
    if (pinned !== null || count < 2) return;

    s.clock += Math.min(delta, 0.1);
    if (!s.wiping) {
      if (s.clock >= PAGE_HOLD_S) {
        s.wiping = true;
        s.clock = 0;
      }
      return;
    }
    const k = Math.min(1, s.clock / PAGE_WIPE_S);
    u.uMix.value = k * k * (3 - 2 * k);
    if (k >= 1) {
      s.index = (s.index + 1) % count;
      u.uFrom.value = textures[s.index];
      u.uTo.value = textures[(s.index + 1) % count];
      u.uMix.value = 0;
      s.wiping = false;
      s.clock = 0;
    }
  });
}

/**
 * LOOK-PLAN §2 SEAT L: every cabinet, bezel, strut and lamp material is
 * `paintRole: 'frame'` (painted band and cool shadow, never a rim); the face
 * itself is `dataFace` and is never painted.
 */
function Cabinet({ accent, night }: { accent: string; night: boolean }) {
  const { width, height, bezel } = JUMBOTRON;
  const bodyW = width + bezel * 2 + 0.3;
  const bodyH = height + bezel * 2 + 0.3;
  const louvres = useMemo(() => Array.from({ length: 7 }, (_, i) => -bodyH / 2 + 0.5 + i * ((bodyH - 1) / 6)), [bodyH]);

  return (
    <group>
      {/* Mount arms and cross-struts back to the façade */}
      {([-1, 1] as const).map((side) => (
        <group key={side}>
          <mesh position={[side * (width / 2 - 0.8), -0.2, -1.0]} castShadow>
            <boxGeometry args={[0.18, 0.18, 1.7]} />
            <meshStandardMaterial userData-paintRole="frame" color="#15161a" roughness={0.5} metalness={0.6} />
          </mesh>
          <mesh position={[side * (width / 2 - 0.8), 0.9, -1.0]} rotation={[0.62, 0, 0]}>
            <boxGeometry args={[0.1, 0.1, 2.4]} />
            <meshStandardMaterial userData-paintRole="frame" color="#15161a" roughness={0.5} metalness={0.6} />
          </mesh>
        </group>
      ))}
      {/* Cabinet body */}
      <mesh position={[0, 0, -0.16]} castShadow>
        <boxGeometry args={[bodyW, bodyH, 0.34]} />
        <meshStandardMaterial userData-paintRole="frame" color="#0b0c10" roughness={0.38} metalness={0.45} />
      </mesh>
      {/* Side vent louvres */}
      {([-1, 1] as const).map((side) =>
        louvres.map((y) => (
          <mesh key={`${side}-${y}`} position={[side * (bodyW / 2 + 0.01), y, -0.16]}>
            <boxGeometry args={[0.03, 0.05, 0.26]} />
            <meshStandardMaterial userData-paintRole="frame" color="#2a2c33" roughness={0.6} metalness={0.5} />
          </mesh>
        )),
      )}
      {/* Bezel frame — four bars stepping in front of the cabinet face */}
      {(
        [
          ['top', 0, height / 2 + bezel / 2, width + bezel * 2, bezel],
          ['bottom', 0, -height / 2 - bezel / 2, width + bezel * 2, bezel],
          ['left', -(width + bezel) / 2, 0, bezel, height],
          ['right', (width + bezel) / 2, 0, bezel, height],
        ] as const
      ).map(([key, x, y, barW, barH]) => (
        <mesh key={key} position={[x, y, 0.02]}>
          <boxGeometry args={[barW, barH, 0.12]} />
          <meshStandardMaterial userData-paintRole="frame" color="#08090c" roughness={0.5} metalness={0.35} />
        </mesh>
      ))}
      {/* Rain hood with two stadium flood housings */}
      <mesh position={[0, height / 2 + bezel + 0.28, 0.14]} rotation={[0.38, 0, 0]} castShadow>
        <boxGeometry args={[width + 0.5, 0.08, 0.6]} />
        <meshStandardMaterial userData-paintRole="frame" color="#101216" roughness={0.42} metalness={0.5} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * (width / 2 - 1.2), height / 2 + bezel + 0.42, 0.3]}>
          <mesh rotation={[0.9, 0, 0]}>
            <boxGeometry args={[0.42, 0.24, 0.22]} />
            <meshStandardMaterial userData-paintRole="frame" color="#1a1c22" roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0, -0.1, 0.11]} rotation={[0.9, 0, 0]}>
            <planeGeometry args={[0.34, 0.16]} />
            <meshStandardMaterial
              userData-paintRole="frame"
              color="#fff4dc"
              emissive="#fff4dc"
              emissiveIntensity={night ? FLOOD_NIGHT : 0.6}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      {/* Under-mount league plate with accent stripe */}
      <mesh position={[0, -height / 2 - bezel - 0.26, 0.02]}>
        <boxGeometry args={[2.4, 0.36, 0.1]} />
        <meshStandardMaterial userData-paintRole="frame" color="#0b0c10" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -height / 2 - bezel - 0.26, 0.075]}>
        <planeGeometry args={[2.1, 0.06]} />
        <meshStandardMaterial userData-paintRole="frame" color={accent} emissive={accent} emissiveIntensity={night ? STRIPE_NIGHT : 1.1} />
      </mesh>
    </group>
  );
}

export interface BoardProps {
  kind: BoardKind;
  at: LandmarkAnchor;
  content: BoardContent;
  theme: Omit<BoardTheme, 'kind'>;
  night: boolean;
}

/**
 * One plaza board: a physical cabinet on the north façade carrying the
 * rotating stadium pages for its kind. Registers as a Focus Subject whose
 * panel is `?board=<kind>` (ADR-0003).
 */
export default function Board({ kind, at, content, theme, night }: BoardProps) {
  const { width, height, bezel } = JUMBOTRON;
  const fullTheme = useMemo<BoardTheme>(() => ({ kind, ...theme }), [kind, theme]);
  const pages = useMemo(() => boardPages(kind, content), [kind, content]);
  const faceId = `board:${kind}`;
  const textures = useBoardPageTextures(pages, content, fullTheme, faceId);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  // ENGINE r4 (CAR r3 veto): the face's content mesh, as a state ref, so the
  // face reports ready only once the panel is really mounted.
  const [panel, setPanel] = useState<THREE.Mesh | null>(null);
  // Fidelity wave 2 (2F): the neighbour board stands by (see useStandbyDim).
  const faceIds = useMemo(() => [`${kind}:board`], [kind]);
  const standby = useStandbyDim({ surfaces: PLAZA_DATA_SURFACES, subjectId: `board:${kind}`, faceIds });
  // Wave 2 r2: the uniforms go through the ShaderMaterial CONSTRUCTOR (`args`),
  // never the `uniforms` prop — R3F copies each uniform on that path and the
  // standby level froze at mount (see `standbyShaderParameters`).
  const panelParams = useMemo(
    () => standbyShaderParameters(createPanelUniforms(standby.uniforms), PANEL_VERTEX, PANEL_FRAGMENT),
    [standby.uniforms],
  );
  const lightRef = useRef<THREE.PointLight | null>(null);
  const lightBase = night ? BOARD_LIGHT_NIGHT : BOARD_LIGHT_DAY;
  // The board's accent wash stands by with its face: a neighbour board's
  // light spill must not lift the frame around the active one (§5.10).
  useFrame(() => {
    const light = lightRef.current;
    if (light) light.intensity = lightBase * (1 - STANDBY_EMISSIVE_DROP * standby.uniforms.uStandby.value);
  });
  const accentColor = useMemo(() => new THREE.Color(theme.accent), [theme.accent]);
  const ticker = useTickerStrip(content, fullTheme, kind === 'schedule');
  usePageRotation(materialRef, textures, PAGE_OFFSET_S[kind]);
  // ENGINE r4: every page (not only the one bound now) and the ticker strip
  // are uploaded during the ceremony — a page wipe after the reveal never
  // uploads (D23).
  const faceTextures = useMemo(
    () => (textures === null ? [] : ticker === null ? textures : [...textures, ticker]),
    [textures, ticker],
  );
  useDataFaceResidency(faceId, { painted: textures !== null, object: textures === null ? null : panel, textures: faceTextures });

  // Focus proxy = the lit pane plus its bezel, in world space (ADR-0003).
  const focusBounds = useMemo(
    () => ({
      min: [at.x - width / 2 - bezel, at.y - height / 2 - bezel, at.z - 0.2] as const,
      max: [at.x + width / 2 + bezel, at.y + height / 2 + bezel, at.z + 0.2] as const,
    }),
    [at.x, at.y, at.z, width, height, bezel],
  );

  return (
    <FocusSubject
      id={`board:${kind}`}
      kind="board"
      label={routeT(content.locale)(kind === 'pulse' ? 'subject.pulseBoard' : 'subject.scheduleBoard')}
      facing={[0, 0, 1]}
      panel={{ param: 'board', value: kind }}
      bounds={focusBounds}
    >
      <group position={[at.x, at.y, at.z]}>
        <Cabinet accent={theme.accent} night={night} />
        {textures ? (
          <mesh ref={setPanel} position={[0, 0, 0.14]} renderOrder={2}>
            <planeGeometry args={[width, height]} />
            <shaderMaterial
              ref={materialRef}
              args={[panelParams]}
              uniforms-uGain-value={night ? GAIN_NIGHT : GAIN_DAY}
              uniforms-uDataCeiling-value={night ? DATA_EMISSIVE_CEILING : DATA_EMISSIVE_CEILING_DAY}
              uniforms-uAccent-value={accentColor}
              uniforms-uTicker-value={ticker}
              uniforms-uTickerMix-value={ticker ? 1 : 0}
              side={THREE.DoubleSide}
              depthWrite
              userData-dataFace
            />
          </mesh>
        ) : (
          <mesh position={[0, 0, 0.14]}>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial color="#05070c" roughness={0.3} metalness={0.2} userData-dataFace />
          </mesh>
        )}
        <pointLight ref={lightRef} position={[0, 0, 2.2]} color={theme.accent} intensity={lightBase} distance={24} />
      </group>
    </FocusSubject>
  );
}

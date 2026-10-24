'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { propUrl, useWorldManifest, type PropEntry } from '@/lib/route-world/model-manifest';
import { HERO_PROPS, type HeroPropSeat } from '@/lib/route-world/layout';
import { preloadFigure, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { usePlazaPalette } from '@/components/world/themes/plaza/use-plaza-palette';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import { useStationWindow } from '../useStationWindow';
import { useLocale } from '@/i18n/client';
import { KIOSK_SCREEN_GLYPHS, kioskScreenLines } from './kiosk-screen';

/**
 * C-053 — the kiosk's authored night screen emissive.
 *
 * The `led-board-cabinet` GLB ships a solid-black emissive map (PB-198: the
 * prop is effectively non-emissive), so at night its dark screen face reads
 * as a dead cabinet. Instead of re-baking the asset or floating a bloom
 * plane over it, the screen is authored INTO the material at mount: the
 * glass-panel triangles are located from the prop's own geometry (a
 * bounds-fraction band between the header band and the plinth base, plus a
 * ±z face-normal test — the classifier was validated against the baked
 * mesh) cross-checked against the baked base colour (the screen is the dark
 * glass; header, bezels and base are bright), painted as UV triangles into
 * a mask canvas, and mounted as the `emissiveMap` of a per-seat material
 * clone. Same mesh, same draw count — the glow is a material identity
 * established before Bloom, not a post-hoc pass. The day branch never
 * touches the cached material, so the light theme stays byte-identical by
 * construction.
 *
 * C-064 — the mask carries authored wayfinding copy, in the viewer's language
 * since i18n D11 (`kiosk-screen.ts`; route content;
 * static on purpose — a painted-but-frozen countdown would be dead live
 * data, so live tickers stay on the boards). The glass's UV islands are
 * scattered across the whole atlas (PB-274) and only ~119 faces classify as
 * glass, so neither a canvas-rect text nor per-face-centroid rasterization
 * can resolve glyphs; instead the copy is authored as a 5×7 dot-matrix on a
 * screen-space content canvas (aspect-true over the classified rect) and
 * every glass face draws its own affine slice of that canvas into its UV
 * island — texture resolution, not triangle resolution, at station-LED dot
 * pitch (2048 mask ⇒ ~1 dot ≈ 1 texel per patch).
 */
/** Screen band as fractions of the recorded bounds half-extents per axis. */
const KIOSK_SCREEN_BAND = { x: 0.86, yLow: -0.35, yHigh: 0.85, z: 0.12 } as const;
/** Base-colour luma (0–255) under which an in-band texel counts as glass. */
const KIOSK_SCREEN_TEXEL_LUMA = 45;
/** Mask canvas resolution — the UV islands are scattered, so paint per-face.
 * 2048 because the copy must survive per-patch minification: the glass's
 * median UV island edge is ~0.0034 of the atlas (measured on the GLB), so a
 * 2048 mask gives each patch ~7 texels across — one dot-matrix dot ≈ one
 * texel. At 512 the same patches resolve ~1.7 texels and glyphs turn to mush. */
const KIOSK_SCREEN_MASK_PX = 2048;
/*
 * The kiosk's wayfinding copy (C-064) and its 5×7 dot-matrix glyphs live in
 * `kiosk-screen.ts` (i18n D11: the lines follow the viewer's language,
 * `kioskScreenLines(locale)`). Pointing only where feet must go — the
 * jumbotrons tower over the plaza, so the live-pages line carries no arrow.
 */
/**
 * Body ground shade (0–255 emissive factor) under the text rows. Dimmer than
 * C-053's 0.82 because AgX compresses small factor deltas into ~2 % rendered
 * luma (0.82→~138 vs 1.0→~142, PB-276) — glyphs on that ground would be
 * unreadable; 0.28 keeps the panel glowing (~3× the dead-cabinet floor)
 * while the glyph rows carry it.
 */
const KIOSK_SCREEN_BODY = 72;
/** Content-canvas width in px; the height follows the classified glass aspect. */
const KIOSK_SCREEN_CONTENT_PX = 768;
/**
 * The wayfinding row that carries the bold emphasis (C-084): C-064's visual review
 * measured the rules line's 1-dot strokes (the ↓ stem, the Ü umlaut dots) at
 * ~1 effective pixel at the 768 station pose — present in the mask but
 * minified into a blob. Rows 1-2 read there; the third row gets the largest
 * pitch its band allows plus real-LED bold (dots double-struck wider), the
 * station-LED idiom for exactly this. Copy itself is frozen.
 */
const KIOSK_SCREEN_EMPHASIS_ROW = 2;
/** Bold dilate per side, in fractions of the emphasized row's dot pitch. */
const KIOSK_SCREEN_EMPHASIS_GROW = 0.2;
/** Content overscan beyond the classified rect, so edge faces stay painted. */
const KIOSK_SCREEN_OVERSCAN = 0.06;
/** Emissive intensity class of a secondary practical: the big boards' panels
 * (linear gain 1.9 + tone-mapped-:false floodlights at 6) stay the plaza's
 * brightest things at night; the kiosk LED reads under them (measured
 * hierarchy pass: glass luma ~2/3 of the schedule panel's bright rows). */
const KIOSK_SCREEN_EMISSIVE = 0.5;

/**
 * Paint the kiosk's screen-face emissive mask from the mesh itself. Returns
 * null when anything needed is missing (no map image, no 2D context) — the
 * prop then simply renders as before, never blank.
 */
function kioskScreenMask(mesh: THREE.Mesh, entry: PropEntry, lines: readonly string[]): THREE.CanvasTexture | null {
  const material = mesh.material;
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) return null;
  // Texture.image is untyped in @types/three; the loader hands the decoder an
  // ImageBitmap/HTMLImageElement, both valid 2D-canvas sources.
  const image = material.map?.image as HTMLImageElement | ImageBitmap | undefined;
  if (!image || image.width === 0 || image.height === 0) return null;
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const index = mesh.geometry.index;
  if (!position || !uv) return null;

  // Sample the baked base colour at 128² — the classifier's ground truth.
  const sample = document.createElement('canvas');
  sample.width = 128;
  sample.height = 128;
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(image, 0, 0, 128, 128);
  const pixels = sctx.getImageData(0, 0, 128, 128).data;
  const lumaAt = (u: number, v: number): number => {
    const x = Math.min(127, Math.max(0, Math.round(u * 127)));
    const y = Math.min(127, Math.max(0, Math.round(v * 127)));
    const i = (y * 128 + x) * 4;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };

  // Positions in bounds-fraction space: the quantized export denormalizes to
  // ±1 = ±half-extent and a float re-bake would carry model units, so both
  // converge once divided by the recorded half-extents (PB-166 bounds idiom).
  const half = [
    Math.max(Math.abs(entry.bounds.min[0]), Math.abs(entry.bounds.max[0])),
    Math.max(Math.abs(entry.bounds.min[1]), Math.abs(entry.bounds.max[1])),
    Math.max(Math.abs(entry.bounds.min[2]), Math.abs(entry.bounds.max[2])),
  ];
  const faceCount = Math.floor((index?.count ?? position.count) / 3);
  const faces: { vs: { p: [number, number]; uv: [number, number] }[]; cy: number; front: boolean }[] = [];
  let xLowSeen = 1;
  let xHighSeen = -1;
  let yLowSeen = 1;
  let yHighSeen = -1;
  const vertexAt = (corner: number): { p: [number, number, number]; uv: [number, number] } => {
    const vi = index ? index.getX(corner) : corner;
    return {
      p: [
        position.getComponent(vi, 0) / half[0],
        position.getComponent(vi, 1) / half[1],
        position.getComponent(vi, 2) / half[2],
      ],
      uv: [uv.getComponent(vi, 0), uv.getComponent(vi, 1)],
    };
  };
  for (let face = 0; face < faceCount; face += 1) {
    const a = vertexAt(face * 3);
    const b = vertexAt(face * 3 + 1);
    const c = vertexAt(face * 3 + 2);
    const cx = (a.p[0] + b.p[0] + c.p[0]) / 3;
    const cy = (a.p[1] + b.p[1] + c.p[1]) / 3;
    const cz = (a.p[2] + b.p[2] + c.p[2]) / 3;
    if (Math.abs(cx) > KIOSK_SCREEN_BAND.x) continue;
    if (cy < KIOSK_SCREEN_BAND.yLow || cy > KIOSK_SCREEN_BAND.yHigh) continue;
    if (Math.abs(cz) < KIOSK_SCREEN_BAND.z) continue;
    const ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1], uz = b.p[2] - a.p[2];
    const vx = c.p[0] - a.p[0], vy = c.p[1] - a.p[1], vz = c.p[2] - a.p[2];
    const nz = ux * vy - uy * vx;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    if (Math.abs(nz) < Math.abs(nx) || Math.abs(nz) < Math.abs(ny) || Math.abs(nz) < 0.5 * Math.hypot(nx, ny, nz)) continue;
    const cu = (a.uv[0] + b.uv[0] + c.uv[0]) / 3;
    const cv = (a.uv[1] + b.uv[1] + c.uv[1]) / 3;
    if (lumaAt(cu, cv) >= KIOSK_SCREEN_TEXEL_LUMA) continue;
    xLowSeen = Math.min(xLowSeen, cx);
    xHighSeen = Math.max(xHighSeen, cx);
    yLowSeen = Math.min(yLowSeen, cy);
    yHighSeen = Math.max(yHighSeen, cy);
    faces.push({ vs: [{ p: [a.p[0], a.p[1]], uv: a.uv }, { p: [b.p[0], b.p[1]], uv: b.uv }, { p: [c.p[0], c.p[1]], uv: c.uv }], cy, front: nz > 0 });
  }
  if (faces.length === 0) return null;

  // Authored screen content (C-053 structure + C-064 copy): the bright
  // header line across the top fifth of the glass (kiosk UI idiom), then the
  // wayfinding rows on a dim body ground — a plain uniform slab is the
  // anti-bar's "unauthored neon".
  // Degenerate classification (a future re-bake collapsing the rect) still
  // glows: stretch the rect to a 2:1 pane rather than return a dead cabinet.
  if (xHighSeen - xLowSeen < 1e-3 || yHighSeen - yLowSeen < 1e-3) {
    xLowSeen -= 0.5;
    xHighSeen += 0.5;
    yLowSeen -= 0.25;
    yHighSeen += 0.25;
  }
  const wUnits = (xHighSeen - xLowSeen) * half[0];
  const hUnits = (yHighSeen - yLowSeen) * half[1];
  const canvas = document.createElement('canvas');
  canvas.width = KIOSK_SCREEN_MASK_PX;
  canvas.height = KIOSK_SCREEN_MASK_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Content canvas: aspect-true over the classified rect, with the overscan
  // bands replicating the rect edges (header above, body elsewhere).
  const cw = KIOSK_SCREEN_CONTENT_PX;
  const ch = Math.max(2, Math.round((cw * hUnits) / wUnits));
  const pad = Math.round(cw * KIOSK_SCREEN_OVERSCAN);
  const content = document.createElement('canvas');
  content.width = cw + pad * 2;
  content.height = ch + pad * 2;
  const cctx = content.getContext('2d');
  if (!cctx) return null;
  cctx.fillStyle = `rgb(${KIOSK_SCREEN_BODY},${KIOSK_SCREEN_BODY},${KIOSK_SCREEN_BODY})`;
  cctx.fillRect(0, 0, content.width, content.height);
  cctx.fillStyle = 'rgb(255,255,255)';
  cctx.fillRect(0, 0, content.width, pad + Math.round(ch * 0.22));
  const bodyTop = pad + ch * 0.22;
  const rowH = (ch * 0.78) / lines.length;
  // Dot-matrix layout: 5-dot glyphs, 1-dot tracking, hard block dots sized to
  // the largest pitch where the longest line still fits the classified rect
  // (the longer language sets the pitch; nothing is ever cut).
  const dotsWide = (line: string): number => line.length * 6 - 1;
  const widest = Math.max(...lines.map(dotsWide));
  const dot = Math.min((rowH * 0.62) / 7, (cw * 0.89) / widest);
  // C-084 emphasis: the shortest line has width to spare, so its pitch grows
  // toward the row-band height cap (0.72) and the clear-glass width (0.80 —
  // the full 0.89 budget lands the final D on the right bevel at the 768
  // pose) and its dots dilate HORIZONTALLY (KIOSK_SCREEN_EMPHASIS_GROW per
  // side): vertical stems are the features that die at ~1.5 px/dot, and
  // vertical dilate would fuse the Ü umlaut into its U and the glyph bottoms
  // into the lower bezel. The shared-pitch rows keep the exact geometry below
  // (d === dot, grow === 0 ⇒ byte-identical paint).
  const lineDot = (line: number): number =>
    line === KIOSK_SCREEN_EMPHASIS_ROW
      ? Math.min((rowH * 0.72) / 7, (cw * 0.8) / dotsWide(lines[line]))
      : dot;
  const lineGrow = (line: number): number =>
    line === KIOSK_SCREEN_EMPHASIS_ROW ? Math.max(1, Math.round(lineDot(line) * KIOSK_SCREEN_EMPHASIS_GROW)) : 0;
  cctx.fillStyle = 'rgb(255,255,255)';
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line];
    const d = lineDot(line);
    const grow = lineGrow(line);
    const x0 = pad + Math.round(cw * 0.055);
    const y0 = Math.round(bodyTop + rowH * (line + 0.5) - (d * 7) / 2);
    for (let i = 0; i < text.length; i += 1) {
      const rows = KIOSK_SCREEN_GLYPHS[text[i]];
      if (!rows) continue;
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 5; c += 1) {
          if (rows[r][c] !== '1') continue;
          cctx.fillRect(
            Math.round(x0 + (i * 6 + c) * d) - grow,
            Math.round(y0 + r * d),
            Math.ceil(d) + grow * 2,
            Math.ceil(d),
          );
        }
      }
    }
  }

  for (const f of faces) {
    // glTF UVs (v down) + flipY=false map canvas pixels directly.
    const px = f.vs.map((v) => v.uv[0] * KIOSK_SCREEN_MASK_PX);
    const py = f.vs.map((v) => v.uv[1] * KIOSK_SCREEN_MASK_PX);
    ctx.save();
    ctx.beginPath();
    // Inflate ~0.75 mask-px from the centroid: the content is continuous
    // across shared edges, so overlapping slices close the AA seams.
    const uc = (px[0] + px[1] + px[2]) / 3;
    const vc = (py[0] + py[1] + py[2]) / 3;
    for (let i = 0; i < 3; i += 1) {
      const dx = px[i] - uc;
      const dy = py[i] - vc;
      const k = (Math.hypot(dx, dy) + 0.75) / Math.max(Math.hypot(dx, dy), 1e-4);
      const X = uc + dx * k;
      const Y = vc + dy * k;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.clip();
    // Affine screen→UV slice: back faces (nz<0) read the mirrored screen so
    // the copy reads true from behind. Non-square: nx/ny are rect-normalized.
    const sx = f.front ? 1 : -1;
    const mid = xLowSeen + xHighSeen;
    const spanX = xHighSeen - xLowSeen;
    const spanY = yHighSeen - yLowSeen;
    const nx = f.vs.map((v) => ((sx > 0 ? v.p[0] : mid - v.p[0]) - xLowSeen) / spanX);
    const ny = f.vs.map((v) => (yHighSeen - v.p[1]) / spanY);
    const det = (nx[1] - nx[2]) * (ny[0] - ny[2]) - (nx[0] - nx[2]) * (ny[1] - ny[2]);
    if (Math.abs(det) < 1e-8) {
      // Screen-degenerate sliver: hold the body ground so the island stays lit.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgb(${KIOSK_SCREEN_BODY},${KIOSK_SCREEN_BODY},${KIOSK_SCREEN_BODY})`;
      ctx.fill();
      ctx.restore();
      continue;
    }
    const affine = (s: number[]): [number, number] => [
      ((s[1] - s[2]) * (ny[0] - ny[2]) - (s[0] - s[2]) * (ny[1] - ny[2])) / det,
      ((s[0] - s[2]) * (nx[1] - nx[2]) - (s[1] - s[2]) * (nx[0] - nx[2])) / det,
    ];
    const [au, av] = affine([px[0] / KIOSK_SCREEN_MASK_PX, px[1] / KIOSK_SCREEN_MASK_PX, px[2] / KIOSK_SCREEN_MASK_PX]);
    const [bu, bv] = affine([py[0] / KIOSK_SCREEN_MASK_PX, py[1] / KIOSK_SCREEN_MASK_PX, py[2] / KIOSK_SCREEN_MASK_PX]);
    const gu = px[0] / KIOSK_SCREEN_MASK_PX - (au * nx[0] + av * ny[0]);
    const gv = py[0] / KIOSK_SCREEN_MASK_PX - (bu * nx[0] + bv * ny[0]);
    // drawImage(content, -pad, -pad) under this transform puts content px
    // (nx·cw, ny·ch) at mask px 512·(u, v) — the affine slice, seam-free.
    ctx.setTransform(
      (au * KIOSK_SCREEN_MASK_PX) / cw,
      (bu * KIOSK_SCREEN_MASK_PX) / cw,
      (av * KIOSK_SCREEN_MASK_PX) / ch,
      (bv * KIOSK_SCREEN_MASK_PX) / ch,
      gu * KIOSK_SCREEN_MASK_PX,
      gv * KIOSK_SCREEN_MASK_PX,
    );
    ctx.drawImage(content, -pad, -pad);
    ctx.restore();
  }
  const mask = new THREE.CanvasTexture(canvas);
  mask.flipY = false;
  mask.colorSpace = THREE.NoColorSpace;
  mask.name = 'kiosk-screen-emissive';
  return mask;
}

/**
 * World box of a mounted prop scene. Static exports only — no skinning to
 * relax — so the geometry boxes are exact; the union still runs through each
 * node's world matrix because exporters park scales on inner nodes.
 */
function meshBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.geometry) return;
    node.geometry.computeBoundingBox();
    const local = node.geometry.boundingBox;
    if (!local || local.isEmpty()) return;
    box.union(local.clone().applyMatrix4(node.matrixWorld));
  });
  return box;
}

/**
 * Uniform scale putting `sizeM` real-world metres along the seat's axis of the
 * prop's RECORDED bounds. Meshy normalizes every generation to its own ~1.9
 * unit box, so the model unit is meaningless — only the bounds-extent ratio
 * is (PB-166).
 */
function propScale(entry: PropEntry, seat: HeroPropSeat): number {
  const { min, max } = entry.bounds;
  const extent = seat.axis === 'x' ? max[0] - min[0] : max[1] - min[1];
  return seat.sizeM / Math.max(extent, 1e-3);
}

/**
 * One Meshy prop at its plaza seat: scaled from its recorded bounds, grounded
 * (or, for the crest, based) at the seat origin and centred on x/z so the yaw
 * spins it in place. The clone shares geometry and materials with the cached
 * GLTF scene, so repeated seats of one prop stay one upload. No renderOrder
 * opt-out: the canvas' mesh-merge bakes these quantized primitive-mounted
 * clones from dequantized float32 copies and live matrices (C-052), so
 * identical pairs consolidate to one draw.
 */
function PropModel({
  entry,
  seat,
  night,
  phosphor,
}: {
  entry: PropEntry;
  seat: HeroPropSeat;
  night: boolean;
  /** Night screen phosphor (the SPIELPLAN board's — the kiosk is its satellite). */
  phosphor: string;
}) {
  const gltf = useFigureGLTF(propUrl(entry));
  // i18n D11: the kiosk's wayfinding lines in the viewer's language.
  const locale = useLocale();
  const kioskLines = useMemo(() => kioskScreenLines(locale), [locale]);

  const fitted = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    root.scale.setScalar(propScale(entry, seat));
    const box = meshBounds(root);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box.min.y, -center.z);
    }
    return root;
  }, [gltf.scene, entry, seat]);

  // C-053: swap the kiosk's cached material for the screen-emissive clone at
  // night, restore the original on unmount or day. The cache itself is never
  // mutated, and the day branch leaves it untouched entirely.
  useEffect(() => {
    if (seat.prop !== 'led-board-cabinet' || !night) return;
    const swaps: { mesh: THREE.Mesh; source: THREE.MeshStandardMaterial; clone: THREE.MeshStandardMaterial; mask: THREE.CanvasTexture }[] = [];
    fitted.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const mask = kioskScreenMask(node, entry, kioskLines);
      if (!mask) return;
      const source = node.material;
      if (Array.isArray(source) || !(source instanceof THREE.MeshStandardMaterial)) {
        mask.dispose();
        return;
      }
      const clone = source.clone();
      clone.emissiveMap = mask;
      clone.emissive = new THREE.Color(phosphor);
      clone.emissiveIntensity = KIOSK_SCREEN_EMISSIVE;
      node.material = clone;
      swaps.push({ mesh: node, source, clone, mask });
    });
    if (swaps.length === 0) return;
    return () => {
      for (const { mesh, source, clone, mask } of swaps) {
        mesh.material = source;
        mask.dispose();
        clone.dispose();
      }
    };
  }, [fitted, night, seat.prop, entry, phosphor, kioskLines]);

  return (
    <group
      position={[seat.at.x, seat.at.y, seat.at.z]}
      rotation={[0, seat.yaw, 0]}
      name={`hero-prop-${seat.prop}`}
    >
      <primitive object={fitted} />
      {/* The lamp seats' lantern pools are NOT here: they mount at load
          outside the GLB boundary (`HeroLampLights`), so the scene's point
          light count never changes when a GLB resolves. */}
      {/* C-053 grounding note: no dedicated kiosk pool — a close-range light
          over-lights the cabinet's bright base paint into a second source
          that competes with the screen and the boards. The kiosk reads via
          its own emissive screen plus the schedule board's pool spill
          (intensity 16 at ~5 m), the same way PB-198's plinth pair reads via
          the lamp spill. */}
    </group>
  );
}

/** One lantern pool of a lamp-post seat (world position, palette intensity). */
export interface HeroLampLight {
  key: string;
  position: readonly [number, number, number];
  intensity: number;
}

/** Height of the lamp-post lantern pool above the seat base (metres). */
const LAMP_POOL_Y = 3.6;
/** Night intensity of a lamp-post pool; 0 by day (the light stays mounted). */
const LAMP_POOL_NIGHT = 14;

/**
 * The lamp seats' lantern pools (D23, seat R item 6). They were mounted
 * inside each lamp GLB's seat, night-only: the scene's point-light count
 * then changed whenever a lamp resolved (and at every palette read), and
 * `NUM_POINT_LIGHTS` is a program key — every lit program re-linked. Now
 * one light per lamp seat, in BOTH palettes, mounted at load and gated by
 * intensity, so the count is constant for the session.
 */
export function heroLampLights(seats: readonly HeroPropSeat[], night: boolean): HeroLampLight[] {
  return seats
    .filter((seat) => seat.prop === 'haussmann-lamp-post')
    .map((seat) => ({
      key: `${seat.at.x.toFixed(1)},${seat.at.z.toFixed(1)}`,
      position: [seat.at.x, seat.at.y + LAMP_POOL_Y, seat.at.z] as const,
      intensity: night ? LAMP_POOL_NIGHT : 0,
    }));
}

/** Lantern pools in the StreetLamps' warm idiom; unshadowed (the rung's `shadowedLights` budget is untouched). */
function HeroLampLights({ night }: { night: boolean }) {
  const lights = useMemo(() => heroLampLights(HERO_PROPS, night), [night]);
  return (
    <>
      {lights.map((light) => (
        <pointLight
          key={light.key}
          position={[light.position[0], light.position[1], light.position[2]]}
          color="#ffd9a0"
          intensity={light.intensity}
          distance={11}
          decay={2}
          castShadow={false}
        />
      ))}
    </>
  );
}

function HeroPropSeats() {
  const manifest = useWorldManifest();
  const palette = usePlazaPalette();
  const night = palette.exposure < 0.75;
  // D23: the kiosk is SCHEDULE-station look, but residency no longer waits
  // for the schedule window — the seats mount at load and stay (the C-089
  // window [2,4] now only feeds the parity readout; props have no per-frame
  // work to pause).
  useStationWindow(2, 4);
  const seats = useMemo(
    () =>
      HERO_PROPS.map((seat) => ({
        seat,
        entry: manifest.props.find((prop) => prop.name === seat.prop) ?? null,
      })),
    [manifest],
  );

  // Kick every prop's GLB at once, at load, before any boundary commits
  // (PB-100): without this the mounts fetch in render order. This component
  // COMMITS as soon as the manifest resolves because every GLB suspends
  // inside its own seat boundary below. `preloadFigure` queues until the
  // canvas has armed the KTX2 transcoder, exactly like the statue row, and
  // reports settlement to the residency store.
  useEffect(() => {
    for (const { entry } of seats) {
      if (entry) preloadFigure(propUrl(entry));
    }
  }, [seats]);

  return (
    <>
      {seats.map(({ seat, entry }) =>
        entry ? (
          <ResidentSuspense key={`${seat.prop}@${seat.at.x.toFixed(1)},${seat.at.z.toFixed(1)}`} id={`plaza:hero-prop:${seat.prop}`}>
            <PropModel entry={entry} seat={seat} night={night} phosphor={palette.boardSchedule} />
          </ResidentSuspense>
        ) : null,
      )}
    </>
  );
}

/** The lamp pools read the palette outside the manifest boundary, so they mount with the first commit. */
function HeroLamps() {
  const palette = usePlazaPalette();
  return <HeroLampLights night={palette.exposure < 0.75} />;
}

/**
 * The four Meshy hero props from the world manifest as standalone plaza
 * furniture: a plinth pair flanking the gate walkway, a
 * lamp-post pair in the gate forecourt, an LED wayfinding kiosk beside the
 * east board and a crest cartouche above the gate — placements live in
 * `HERO_PROPS` (`src/lib/route-world/layout.ts`). The outer boundary only
 * ever covers the manifest fetch; every GLB then suspends under its own
 * seat boundary with a null fallback, so no still catches a placeholder. A
 * prop missing from the manifest simply does not render (a re-bake gap never
 * blanks the plaza).
 */
export default function HeroProps() {
  return (
    <>
      <HeroLamps />
      <ResidentSuspense id="plaza:hero-props">
        <HeroPropSeats />
      </ResidentSuspense>
    </>
  );
}

'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { queuePaint } from '@/components/world/route/paint-queue';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import { preloadFigure, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { FURNITURE, GATE } from '@/lib/route-world/layout';
import { propUrl, useWorldManifest, type PropEntry } from '@/lib/route-world/model-manifest';
import { disposeStoneMaps, stoneMaps } from '@/components/world/themes/plaza/stone-maps';
import { useEvoligaRouteData } from '../route-data';
import { rulesCopyContext } from '@/components/world/sections/rules-context';
import { useDataLocale, useLocale } from '@/i18n/client';
import { capsFor, routeT } from '@/lib/route-world/paint-copy';
import { ResidentSuspense, useResidencyHold } from '@/components/world/route/residency-store';
import { useStationWindow } from '../useStationWindow';
import { useStandbyDim } from '@/components/world/route/useStandbyDim';
import { PLAZA_DATA_SURFACES } from './data-faces';
import {
  CTA_TEX_H,
  CTA_TEX_W,
  FIELD_TEX_H,
  FIELD_TEX_W,
  FRIEZE_TEX_H,
  FRIEZE_TEX_W,
  PLAQUE_TEX_H,
  PLAQUE_TEX_W,
  ctaText,
  fieldBoardPage,
  paintCta,
  paintFieldBoard,
  paintFrieze,
  paintFriezeHeight,
  paintPlaque,
  plaquePages,
  resolveRuleSet,
  type PlaquePage,
  type RuleRow,
  type RuleSide,
} from './gate-painters';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * Vertical stack in gate-local metres, plinth to cyma. It sums to
 * `GATE.height`, so the wave-1 envelope still holds and `layout.ts` stays
 * untouched — this module only reads it.
 */
const Y = {
  plinth: [0, 0.3],
  base: [0.3, 0.46],
  base2: [0.46, 0.58],
  shaft: [0.58, 4.34],
  neck: [4.34, 4.5],
  cap: [4.5, 4.84],
  crown: [4.84, 4.96],
  fascia1: [4.96, 5.1],
  fascia2: [5.1, 5.24],
  fascia3: [5.24, 5.34],
  frieze: [5.34, 5.92],
  bed: [5.92, 6.06],
  cornice: [6.06, 6.34],
  cyma: [6.34, 6.4],
} as const;

type Band = readonly [number, number];

function mid(band: Band): number {
  return (band[0] + band[1]) / 2;
}

function span(band: Band): number {
  return band[1] - band[0];
}

/**
 * Pier centres and the profile widths. The cornice is the widest element, so
 * `ENTAB_W` is what the frame actually measures: 10.0 m reads at 46 % of the
 * 1440 frame (21.8 m across at the frozen pose) and still clears `doorW`.
 */
const PIER_X = 3.8;

const W = {
  plinth: 2.36,
  base: 2.24,
  base2: 2.1,
  shaft: 2.0,
  neck: 2.14,
  cap: 2.4,
  crown: 2.2,
} as const;

const ENTAB_W = 2 * (PIER_X + W.cap / 2);
const OPENING_HALF = PIER_X - W.shaft / 2;
const PIER_FACE_Z = -GATE.depth / 2;

const D = {
  plinth: GATE.depth + 0.48,
  base: GATE.depth + 0.28,
  base2: GATE.depth + 0.14,
  shaft: GATE.depth,
  neck: GATE.depth + 0.14,
  cap: GATE.depth + 0.48,
  crown: GATE.depth + 0.28,
  fascia1: GATE.depth + 0.06,
  fascia2: GATE.depth + 0.1,
  fascia3: GATE.depth + 0.14,
  frieze: GATE.depth - 0.02,
  bed: GATE.depth + 0.18,
  cornice: GATE.depth + 0.62,
  cyma: GATE.depth + 0.4,
} as const;

/** Plaque face on the pier shaft; the height follows the texture so glyphs never stretch. */
const PLAQUE_W = GATE.plaqueW * 0.56;
const PLAQUE_H = (PLAQUE_W * PLAQUE_TEX_H) / PLAQUE_TEX_W;
const PLAQUE_Y = 1.8;
const PLAQUE_GLASS_Z = PIER_FACE_Z - 0.03;
const PLAQUE_FRAME_Z = PIER_FACE_Z - 0.06;

const CREST_Y = 3.55;
/**
 * C-054: the pier-face crest is now the manifest's Meshy
 * `gate-crest-ornament` (20,534 tris) — the deep station replacement C-043's
 * roofline stand-in deferred. The relief GLB replaces the canvas medallion at
 * the SAME authored seat (pier face, centred on `CREST_Y`) and at the
 * medallion's own face width (torus outer Ø ≈ 1.28 m), so the pier's composed
 * footprint is unchanged. No dedicated night pool: the pier lanterns' warm
 * class and the keystone accent wash it (PB-198 grounding idiom; PB-277 warns
 * a close pool would over-light it instead).
 */
const CREST_PROP = 'gate-crest-ornament';
const CREST_W = 1.28;

/**
 * World box of a mounted prop scene (HeroProps' C-043 idiom, read and reused).
 * Static exports only — no skinning to relax — so the geometry boxes are exact;
 * the union still runs through each node's world matrix because exporters park
 * scales on inner nodes.
 */
function propMeshBounds(root: THREE.Object3D): THREE.Box3 {
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
 * Uniform scale putting `sizeM` real-world metres along one axis of the prop's
 * RECORDED bounds (PB-166 — Meshy normalizes to its own ~1.9-unit box).
 */
function propScale(entry: PropEntry, sizeM: number, axis: 'x' | 'y'): number {
  const { min, max } = entry.bounds;
  const extent = axis === 'x' ? max[0] - min[0] : max[1] - min[1];
  return sizeM / Math.max(extent, 1e-3);
}

/** The crest ornament centred on one pier's face, relief to the plaza (−Z). */
function CrestOrnament({ entry, side }: { entry: PropEntry; side: -1 | 1 }) {
  const gltf = useFigureGLTF(propUrl(entry));

  const { fitted, halfDepth } = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    root.scale.setScalar(propScale(entry, CREST_W, 'x'));
    const box = propMeshBounds(root);
    let depth = 0.08;
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      // Centre on every axis: the seat pins the crest's mid-height to CREST_Y
      // and its back face just proud of the stone.
      root.position.set(-center.x, -center.y, -center.z);
      depth = size.z;
    }
    return { fitted: root, halfDepth: depth / 2 };
  }, [gltf.scene, entry]);

  return (
    <group
      position={[side * PIER_X, CREST_Y, PIER_FACE_Z - halfDepth - 0.01]}
      name="gate-crest-prop"
    >
      <primitive object={fitted} />
    </group>
  );
}

/**
 * Both pier crests from the manifest. The manifest fetch suspends under the
 * boundary `ChallengeGate` wraps around this component; each GLB then suspends
 * under its own seat boundary with a null fallback, and the preload effect
 * commits as soon as the manifest resolves (PB-194). A manifest without the
 * prop renders no crest — the pier face stays stone, never blank geometry.
 */
function CrestSeats() {
  const manifest = useWorldManifest();
  // D23: the crest cartouches are RULES-station content, but residency no
  // longer waits for the rules window — both GLBs load, compile and upload in
  // the ceremony and stay. The C-089 window [2,4] only feeds the parity
  // readout (static props have no per-frame work to pause).
  useStationWindow(2, 4);
  const entry = manifest.props.find((prop) => prop.name === CREST_PROP) ?? null;

  useEffect(() => {
    if (entry) preloadFigure(propUrl(entry));
  }, [entry]);

  if (!entry) return null;
  return (
    <>
      {([-1, 1] as const).map((side) => (
        <ResidentSuspense key={side} id={`plaza:gate-crest:${side}`}>
          <CrestOrnament entry={entry} side={side} />
        </ResidentSuspense>
      ))}
    </>
  );
}

/**
 * Threshold sill: a dressed block under the passage only. It stops flush with
 * the pier faces so the plaza sett runs right up to the gate and the lantern
 * pools land on cobbles, not on more of the gate's own stone.
 */
const SILL_TOP = 0.26;
const SILL_Z = 0.05;
const SILL_D = GATE.depth + 0.1;
const SILL_FRONT_Z = SILL_Z - SILL_D / 2;

const DENTIL_COUNT = 26;
/** Coursing density on the shaft: ~0.85 m blocks in ~0.42 m courses. */
const COURSE_U = 0.38;
const COURSE_V = 0.78;

/** Fixed teal aperture identity — never the theme `live` colour (PB-079). */
const FIELD_TINT = '#4ade80';
const LANTERN_GLOW = '#ffcb87';

/** Pool light on the threshold sett (judge-set 30 / 8 cd). */
const LANTERN_LIGHT = { night: 30, day: 8 } as const;

/** A lit material tagged with the painted light's `frame` role. */
function frameMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  material.userData.paintRole = 'frame';
  return material;
}

/** Face plane of the passage board: `GATE.doorW` wide, 4.4 m tall. */
const FIELD_FACE_H = 4.4;

// ── Texture plumbing ──────────────────────────────────────────────

function paintPixels(
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): Uint8ClampedArray | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx, w, h);
  const src = ctx.getImageData(0, 0, w, h).data;
  // `DataTexture` never flips, so the rows are written bottom-up here and the
  // albedo and its normal partner end up on the same footing.
  const out = new Uint8ClampedArray(src.length);
  const stride = w * 4;
  for (let y = 0; y < h; y += 1) {
    out.set(src.subarray(y * stride, y * stride + stride), (h - 1 - y) * stride);
  }
  return out;
}

function dataTexture(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  colorSpace: THREE.ColorSpace,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(pixels), w, h);
  tex.colorSpace = colorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Height field → tangent-space normal, so a relief reads under raking light. */
function normalTexture(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  strength: number,
): THREE.DataTexture {
  const out = new Uint8Array(w * h * 4);
  const at = (x: number, y: number) =>
    pixels[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const du = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dv = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(du, dv, 1);
      const i = (y * w + x) * 4;
      out[i] = Math.round(((du / len) * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(((dv / len) * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((1 / len) * 255);
      out[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, w, h);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

interface ReliefMaps {
  color: THREE.DataTexture;
  normal: THREE.DataTexture;
}

function buildRelief(
  albedo: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  height: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
  strength: number,
): ReliefMaps | null {
  const colorPixels = paintPixels(albedo, w, h);
  const heightPixels = paintPixels(height, w, h);
  if (!colorPixels || !heightPixels) return null;
  return {
    color: dataTexture(colorPixels, w, h, THREE.SRGBColorSpace),
    normal: normalTexture(heightPixels, w, h, strength),
  };
}

/**
 * ENGINE r6 (E2): the painted canvas IS the texture's image — no synchronous
 * PNG encode (`toDataURL`) and no image decode on upload. GPU state is the
 * old loader path's, field for field (a plain `Texture`: flipY, straight
 * alpha; sRGB, linear, no mips, clamp), so the field, plaques and CTA sample
 * the same pixels. A plain `Texture`, not `CanvasTexture`: QualityGovernor's
 * `retainDataTextureDisposals` patches `CanvasTexture.prototype.dispose`, and
 * a repainted face must still free its old upload (the CTA plate is small
 * enough to be retained). Each paint allocates its own canvas, so no snapshot
 * (`createImageBitmap`) is needed.
 */
export function gateCanvasTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.Texture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Paint into a fresh detached canvas and wrap it (null: no 2D context — logged, the face stays pending). */
function paintCanvasTexture(
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): THREE.Texture | null {
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  const ctx = source.getContext('2d');
  if (!ctx) {
    console.error('[challenge-gate] canvas 2d unavailable');
    return null;
  }
  paint(ctx, w, h);
  return gateCanvasTexture(source);
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
): THREE.Texture | null {
  // ENGINE r4 (D23): residency stays pending until the paint for the
  // CURRENT inputs has landed (a repaint re-opens it), so no face can
  // reveal blank or finish uploading after the world appears.
  const run = useMemo(() => ({ paint, w, h }), [paint, w, h]);
  const [painted, setPainted] = useState<{ texture: THREE.Texture; run: object } | null>(null);
  useResidencyHold('paint:plaza-gate', painted?.run !== run);

  useEffect(() => {
    let texture: THREE.Texture | null = null;
    // ENGINE r3 (load long task): the paint runs in its own task through the
    // engine's paint queue, never in the commit's effect flush beside every
    // other face. ENGINE r6 (E2): the texture is made in that same task from
    // the painted canvas (no PNG encode). A cancelled job never runs, so no
    // texture outlives its run. Same paint, same pixels.
    const cancelPaint = queuePaint(() => {
      texture = paintCanvasTexture(paint, w, h);
      if (texture) setPainted({ texture, run });
    });
    return () => {
      cancelPaint();
      texture?.dispose();
    };
  }, [paint, w, h, run]);

  return painted?.texture ?? null;
}

// ── Materials ─────────────────────────────────────────────────────

export interface GateTone {
  stone: string;
  dressed: string;
  shade: string;
  brass: string;
  cavity: string;
}

export function toneFor(night: boolean): GateTone {
  return night
    ? { stone: '#8d8680', dressed: '#9a938b', shade: '#6f6961', brass: '#a8823f', cavity: '#04070a' }
    : { stone: '#d9cbb6', dressed: '#e6dac4', shade: '#b8a992', brass: '#c99a45', cavity: '#080d13' };
}

interface GateMaterials {
  ashlar: THREE.MeshStandardMaterial;
  dressed: THREE.MeshStandardMaterial;
  shade: THREE.MeshStandardMaterial;
  cavity: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
}

/**
 * LOOK r5 (lead: "stone stays warm cream/honey"; LOOK: "the gate is
 * lilac-white"): the day gate's MATERIAL stone is honey. The frieze sign (a
 * data surface) keeps painting on `toneFor(false).dressed`, so its pixels
 * are unchanged.
 */
export const GATE_DAY_MATERIAL_TONE = { stone: '#dcc8a6', dressed: '#e9d6b2', shade: '#bea688' } as const;

/** One day material tone per paint tone, so the material memo below keys on a stable object. */
const dayMaterialTones = new WeakMap<GateTone, GateTone>();

/**
 * The gate's MATERIAL tone: the paint tone at night, the honey day stone by
 * day. Identity-stable per `tone` (PR #65 test pass, R18d): the day branch
 * used to spread a NEW object on every call, so `useGateMaterials`' memo
 * (keyed on it) rebuilt all seven gate materials on every ChallengeGate
 * render. After the reveal the paint sweep no longer patches, so each
 * re-render (a Tafel panel opening or closing) left four new unpainted lit
 * materials in the scene (ashlar, dressed, shade, cavity; the three frames
 * are exempt) — new program links after reveal, and the audit's
 * "[paint] 4 lit material(s) unpatched after world-route-live" every second.
 */
export function materialTone(night: boolean, tone: GateTone): GateTone {
  if (night) return tone;
  let day = dayMaterialTones.get(tone);
  if (!day) {
    day = { ...tone, ...GATE_DAY_MATERIAL_TONE };
    dayMaterialTones.set(tone, day);
  }
  return day;
}

function useGateMaterials(night: boolean, paintTone: GateTone): GateMaterials {
  const tone = materialTone(night, paintTone);
  const maps = useMemo(() => {
    const set = stoneMaps(night, 1);
    set.color.repeat.set(COURSE_U, COURSE_V);
    set.rough.repeat.set(COURSE_U, COURSE_V);
    set.normal.repeat.set(COURSE_U, COURSE_V);
    return set;
  }, [night]);
  useEffect(() => () => disposeStoneMaps(maps), [maps]);

  const materials = useMemo<GateMaterials>(
    () => ({
      ashlar: new THREE.MeshStandardMaterial({
        map: maps.color,
        roughnessMap: maps.rough,
        normalMap: maps.normal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        color: tone.stone,
        roughness: 1,
        metalness: 0.03,
      }),
      dressed: new THREE.MeshStandardMaterial({ color: tone.dressed, roughness: 0.72, metalness: 0.04 }),
      shade: new THREE.MeshStandardMaterial({ color: tone.shade, roughness: 0.86, metalness: 0.03 }),
      cavity: new THREE.MeshStandardMaterial({ color: tone.cavity, roughness: 0.95, metalness: 0 }),
      // LOOK r2: the metal and glass around the plaques and the REGELWERK
      // board are frames — the painted band and cool shade, never a rim or
      // the painted chroma (a uniform role the plaza paint sweep reads).
      brass: frameMaterial({ color: tone.brass, roughness: 0.34, metalness: 0.86 }),
      glass: frameMaterial({ color: '#0a141b', roughness: 0.12, metalness: 0.05 }),
      iron: frameMaterial({ color: '#1c2226', roughness: 0.44, metalness: 0.72 }),
    }),
    [maps, tone],
  );

  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose());
    },
    [materials],
  );

  return materials;
}

// ── Parts ─────────────────────────────────────────────────────────

function Course({
  band,
  width,
  depth,
  material,
  cast = false,
  receive = false,
}: {
  band: Band;
  width: number;
  depth: number;
  material: THREE.Material;
  cast?: boolean;
  receive?: boolean;
}) {
  return (
    <mesh position={[0, mid(band), 0]} material={material} castShadow={cast} receiveShadow={receive}>
      <boxGeometry args={[width, span(band), depth]} />
    </mesh>
  );
}

/**
 * Standing lantern on the cyma above each pier (wave-2 r2, W1 keep-out).
 * The earlier bracket lanterns hung from the piers' inner cheeks, in front
 * of the REGELWERK passage board (they clipped its kicker and rows at 768),
 * and an outer-cheek bracket still sat inside the plaques' padded wedges.
 * Above the cornice they sit higher than every rules eye (desktop 2.5 m,
 * landed 390 4.68 m), so no board, plaque or crest is behind them from any
 * station, focus or dolly pose. `data-faces.ts` restates this box
 * (`gate-lantern:*`) and the keep-out test holds it clear of every face.
 */
const LANTERN_BASE_Y = Y.cyma[1];
/** Glass centre: base plinth 0.16 + post 0.37 + sill 0.10 + half the 0.46 glass. */
const LANTERN_GLASS_Y = LANTERN_BASE_Y + 0.86;
/** Set back from the pier face onto the cyma top (the cyma spans ±D.cyma/2). */
const LANTERN_Z = PIER_FACE_Z + 0.15;

/**
 * LOOK r4 (lead: "RULES = THE HERO FINALE … restore the gate-top lanterns
 * OUTBOARD of the padded face rect, with warm glass"): the standing lanterns
 * are back on the cyma over each pier centre, built inside the declared
 * `gate-lantern:*` keep-out box (data-faces.ts: base plinth to finial
 * 6.40–7.99, 0.6 m square) — above every rules eye, above the frieze and
 * clear of the REGELWERK field's padded rect. Bronze body, warm glass (a
 * practical: never painted), and the warm pool light at the glass.
 */
const LANTERN_PARTS = {
  plinth: { w: 0.34, h: 0.16 },
  post: { r: 0.055, h: 0.37 },
  sill: { w: 0.42, h: 0.1 },
  glass: { rTop: 0.2, rBottom: 0.15, h: 0.46 },
  hood: { rBottom: 0.29, rTop: 0.09, h: 0.24 },
  finial: { r: 0.055, spike: 0.12 },
} as const;
/**
 * Lantern glass: an UNLIT warm pane (its own pool light sits 0.4 m in front
 * and would blow a lit glass to white). Bounded so a lantern never outshines a
 * face (CLARITY C-044: dark rules plaques P99 ≈ 210): a warm cream by day, a
 * deeper amber at night.
 */
const LANTERN_GLASS_COLOR = { day: '#f2d4a0', night: '#e0a05c' } as const;

/** Palette look of the lantern glass (a colour write only). */
function writeLanternGlass(glass: THREE.MeshBasicMaterial, night: boolean): void {
  glass.color.set(night ? LANTERN_GLASS_COLOR.night : LANTERN_GLASS_COLOR.day);
}

function Lantern({ night, materials }: { night: boolean; materials: GateMaterials }) {
  const glass = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({ color: LANTERN_GLASS_COLOR.day });
    material.userData.paintExempt = true;
    return material;
  }, []);
  useEffect(() => () => glass.dispose(), [glass]);
  useEffect(() => writeLanternGlass(glass, night), [glass, night]);
  const p = LANTERN_PARTS;
  const y0 = LANTERN_BASE_Y;
  const y1 = y0 + p.plinth.h;
  const y2 = y1 + p.post.h;
  const y3 = y2 + p.sill.h;
  const y4 = y3 + p.glass.h;
  const y5 = y4 + p.hood.h;
  const z = LANTERN_Z;
  return (
    <group name="gate-lantern">
      <mesh position={[0, (y0 + y1) / 2, z]} material={materials.brass} castShadow>
        <boxGeometry args={[p.plinth.w, p.plinth.h, p.plinth.w]} />
      </mesh>
      <mesh position={[0, (y1 + y2) / 2, z]} material={materials.iron} castShadow>
        <cylinderGeometry args={[p.post.r * 0.8, p.post.r, p.post.h, 10]} />
      </mesh>
      <mesh position={[0, (y2 + y3) / 2, z]} rotation={[0, Math.PI / 4, 0]} material={materials.brass} castShadow>
        <cylinderGeometry args={[p.sill.w / 2, p.sill.w / 2.6, p.sill.h, 4]} />
      </mesh>
      <mesh position={[0, (y3 + y4) / 2, z]} rotation={[0, Math.PI / 4, 0]} material={glass}>
        <cylinderGeometry args={[p.glass.rTop, p.glass.rBottom, p.glass.h, 4]} />
      </mesh>
      <mesh position={[0, (y4 + y5) / 2, z]} rotation={[0, Math.PI / 4, 0]} material={materials.brass} castShadow>
        <cylinderGeometry args={[p.hood.rTop, p.hood.rBottom, p.hood.h, 4]} />
      </mesh>
      <mesh position={[0, y5 + p.finial.r, z]} material={materials.brass}>
        <sphereGeometry args={[p.finial.r, 10, 8]} />
      </mesh>
      <mesh position={[0, y5 + p.finial.r * 2 + p.finial.spike / 2, z]} material={materials.brass}>
        <coneGeometry args={[0.02, p.finial.spike, 6]} />
      </mesh>
      <pointLight
        position={[0, LANTERN_GLASS_Y, LANTERN_Z - 0.4]}
        color={LANTERN_GLOW}
        intensity={night ? LANTERN_LIGHT.night : LANTERN_LIGHT.day}
        distance={night ? 20 : 14}
        decay={2}
        castShadow={false}
      />
    </group>
  );
}

function GatePier({
  side,
  materials,
  night,
  children,
}: {
  side: -1 | 1;
  materials: GateMaterials;
  night: boolean;
  children?: ReactNode;
}) {
  return (
    <group position={[side * PIER_X, 0, 0]}>
      <Course band={Y.plinth} width={W.plinth} depth={D.plinth} material={materials.dressed} cast receive />
      <Course band={Y.base} width={W.base} depth={D.base} material={materials.shade} />
      <Course band={Y.base2} width={W.base2} depth={D.base2} material={materials.dressed} />
      <Course band={Y.shaft} width={W.shaft} depth={D.shaft} material={materials.ashlar} cast receive />
      <Course band={Y.neck} width={W.neck} depth={D.neck} material={materials.shade} />
      <Course band={Y.cap} width={W.cap} depth={D.cap} material={materials.dressed} cast />
      <Course band={Y.crown} width={W.crown} depth={D.crown} material={materials.shade} />
      <Lantern night={night} materials={materials} />
      {children}
    </group>
  );
}

/** Profiled entablature: three architrave fasciae, lettered frieze, dentils, cornice. */
function Entablature({ materials, frieze }: { materials: GateMaterials; frieze: ReliefMaps | null }) {
  const dentils = useMemo(() => {
    const usable = ENTAB_W - 1.0;
    const pitch = usable / (DENTIL_COUNT - 1);
    return Array.from({ length: DENTIL_COUNT }, (_, i) => -usable / 2 + i * pitch);
  }, []);

  return (
    <group>
      <Course band={Y.fascia1} width={ENTAB_W - 0.58} depth={D.fascia1} material={materials.dressed} cast />
      <Course band={Y.fascia2} width={ENTAB_W - 0.42} depth={D.fascia2} material={materials.dressed} />
      <Course band={Y.fascia3} width={ENTAB_W - 0.28} depth={D.fascia3} material={materials.shade} />
      <Course band={Y.frieze} width={ENTAB_W - 0.68} depth={D.frieze} material={materials.dressed} />
      {frieze ? (
        <mesh position={[0, mid(Y.frieze), -D.frieze / 2 - 0.006]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[ENTAB_W - 1.08, span(Y.frieze) - 0.08]} />
          <meshStandardMaterial
            map={frieze.color}
            normalMap={frieze.normal}
            normalScale={[2.6, 2.6]}
            roughness={0.74}
            metalness={0.04}
            // The headline sign is a data surface: never painted (LOOK-PLAN §1.3 rules).
            userData-dataFace
          />
        </mesh>
      ) : null}
      <Course band={Y.bed} width={ENTAB_W - 0.5} depth={D.bed} material={materials.shade} />
      {dentils.map((x) => (
        <mesh key={x} position={[x, mid(Y.bed), -D.cornice / 2 + 0.17]} material={materials.dressed}>
          <boxGeometry args={[0.18, span(Y.bed) - 0.02, 0.26]} />
        </mesh>
      ))}
      <Course band={Y.cornice} width={ENTAB_W} depth={D.cornice} material={materials.dressed} cast />
      <Course band={Y.cyma} width={ENTAB_W - 0.44} depth={D.cyma} material={materials.shade} />
      {/* Central console dropping into the head, plus the haunch corbels */}
      <mesh position={[0, 4.72, PIER_FACE_Z - 0.08]} material={materials.dressed} castShadow>
        <boxGeometry args={[0.64, 0.74, 0.94]} />
      </mesh>
      <mesh position={[0, 4.6, PIER_FACE_Z - 0.02]} material={materials.brass}>
        <boxGeometry args={[0.4, 0.1, 0.98]} />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <mesh
          key={side}
          position={[side * (OPENING_HALF - 0.24), 4.73, PIER_FACE_Z + 0.36]}
          material={materials.shade}
          castShadow
        >
          <boxGeometry args={[0.44, 0.46, 1.1]} />
        </mesh>
      ))}
    </group>
  );
}

/** Coffered soffit, dark cavity and the stepped sill the field climbs out of. */
function Passage({
  materials,
  cta,
  night,
}: {
  materials: GateMaterials;
  cta: THREE.Texture | null;
  night: boolean;
}) {
  return (
    <group>
      <mesh position={[0, 2.6, 0.72]} material={materials.cavity} receiveShadow>
        <boxGeometry args={[OPENING_HALF * 2 + 0.3, 5.2, 0.34]} />
      </mesh>
      <mesh position={[0, Y.fascia1[0] - 0.05, 0.05]} material={materials.shade}>
        <boxGeometry args={[OPENING_HALF * 2, 0.1, GATE.depth - 0.1]} />
      </mesh>
      {[-0.73, -0.26, 0.26, 0.73].map((f) => f * OPENING_HALF).map((x) => (
        <mesh key={x} position={[x, Y.fascia1[0] - 0.17, 0.05]} material={materials.dressed}>
          <boxGeometry args={[0.16, 0.16, GATE.depth - 0.12]} />
        </mesh>
      ))}
      <mesh position={[0, SILL_TOP / 2, SILL_Z]} material={materials.dressed} receiveShadow castShadow>
        <boxGeometry args={[OPENING_HALF * 2 + 0.5, SILL_TOP, SILL_D]} />
      </mesh>
      {/* Inlaid threshold line on the tread — where the field leaves the stone */}
      <mesh position={[0, SILL_TOP + 0.006, SILL_FRONT_Z + 0.14]}>
        <boxGeometry args={[OPENING_HALF * 2 - 0.5, 0.012, 0.09]} />
        <meshStandardMaterial
          color={FIELD_TINT}
          emissive={FIELD_TINT}
          emissiveIntensity={night ? 4.2 : 1.6}
          roughness={0.4}
          metalness={0}
          toneMapped={false}
          userData-paintExempt
        />
      </mesh>
      {/* Bronze plate bolted to the riser: a real object, not a floating CTA */}
      <mesh position={[0, 0.13, SILL_FRONT_Z - 0.015]} material={materials.brass} castShadow>
        <boxGeometry args={[2.06, 0.22, 0.04]} />
      </mesh>
      {cta ? (
        <mesh position={[0, 0.13, SILL_FRONT_Z - 0.037]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[2.0, (2.0 * CTA_TEX_H) / CTA_TEX_W]} />
          <meshStandardMaterial
            map={cta}
            emissiveMap={cta}
            emissive="#ffffff"
            emissiveIntensity={night ? 1.1 : 0.35}
            roughness={0.38}
            metalness={0.55}
            toneMapped={false}
            userData-dataFace
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * The passage's center board (C-108) — the run's founding anti-bar surface.
 * The old threshold field was an animated band shader whose additive glow
 * verified as an unreadable green smear at the station poses in BOTH modes
 * (the C-106 panel's blocker). The board replaces it at the same seat with
 * the clouds self-lit day-board lever, the run's proven pattern (74/45
 * measured): the paint's field is PURE #000000 and the specular family is
 * dead (roughness 1, envMapIntensity 0) — the composer's AgX grades the
 * whole frame at a heavy exposure and `toneMapped={false}` cannot exempt a
 * fragment, so any non-zero field lifts toward the same pastel; exactly
 * zero emission maps to exactly black at any exposure and the rule rows
 * read by their own emission alone, day and night.
 */
function FieldBoard({
  night,
  kicker,
  title,
  rows,
  lead,
  footer,
  brass,
  materials,
}: {
  night: boolean;
  kicker: string;
  title: string;
  rows: RuleRow[];
  lead: string;
  footer: string;
  brass: string;
  materials: GateMaterials;
}) {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  const paint = useMemo(
    () => paintFieldBoard(kicker, title, rows, lead, footer, brass),
    [kicker, title, rows, lead, footer, brass],
  );
  const texture = usePaintedTexture(paint, FIELD_TEX_W, FIELD_TEX_H);

  return (
    <group position={[0, SILL_TOP + 2.2, 0.3]}>
      {/* Recessed iron tray behind the face, so the board reads as a mounted
          fixture in the passage opening rather than a floating decal. */}
      <mesh position={[0, 0, 0.12]} material={materials.iron} castShadow>
        <boxGeometry args={[GATE.doorW - 0.2, FIELD_FACE_H - 0.2, 0.1]} />
      </mesh>
      {texture ? (
        <mesh rotation={[0, Math.PI, 0]} renderOrder={4}>
          <planeGeometry args={[GATE.doorW, FIELD_FACE_H]} />
          <meshStandardMaterial
            map={texture}
            color="#000000"
            emissiveMap={texture}
            emissive="#ffffff"
            // The clouds flagship tier: brighter at night (1.9) than the day
            // board (1.15) while the ink-on-black contrast survives the bloom
            // (the black field barely lifts).
            emissiveIntensity={night ? 1.9 : 1.15}
            roughness={1.0}
            metalness={0.04}
            ref={bindEnv}
            envMapIntensity={0}
            toneMapped={false}
            userData-dataFace
          />
        </mesh>
      ) : null}
    </group>
  );
}

function RulePlaque({
  side,
  page,
  texture,
  materials,
  night,
}: {
  side: RuleSide;
  page: PlaquePage;
  texture: THREE.Texture | null;
  materials: GateMaterials;
  night: boolean;
}) {
  const { gate } = FURNITURE;
  const x = (side === 'left' ? -1 : 1) * PIER_X;
  // World AABB the focus pose frames: the plaque, its frame and shelf, and the
  // crest's lower rim. Kept tight so the plaque itself fills ~60 % of frame
  // height at the focus pose — the bar's legibility test.
  const bounds = useMemo(
    () => ({
      min: [gate.x + x - PLAQUE_W / 2 - 0.16, PLAQUE_Y - PLAQUE_H / 2 - 0.44, gate.z + PIER_FACE_Z - 0.16] as const,
      max: [gate.x + x + PLAQUE_W / 2 + 0.16, PLAQUE_Y + PLAQUE_H / 2 + 0.44, gate.z + PIER_FACE_Z + 0.06] as const,
    }),
    [gate.x, gate.z, x],
  );
  const panel = useMemo(() => ({ param: 'rules' as const, value: side }), [side]);
  // Fidelity wave 2 r2 (2F LUMA): the plaque stands by away from the rules
  // station (and while another subject is focused); its night emission is
  // held under the data ceiling by the same patch (see useStandbyDim).
  const faceIds = useMemo(() => [`rules:plaque:${side}`], [side]);
  const standby = useStandbyDim({ surfaces: PLAZA_DATA_SURFACES, subjectId: `plaque:${side}`, faceIds });
  const locale = useLocale();
  const bars:[number, number, number, number][] = [
    [0, (PLAQUE_H + 0.14) / 2, PLAQUE_W + 0.28, 0.14],
    [0, -(PLAQUE_H + 0.14) / 2, PLAQUE_W + 0.28, 0.14],
    [-(PLAQUE_W + 0.14) / 2, 0, 0.14, PLAQUE_H],
    [(PLAQUE_W + 0.14) / 2, 0, 0.14, PLAQUE_H],
  ];

  return (
    <FocusSubject
      id={`plaque:${side}`}
      kind="plaque"
      label={routeT(locale)('subject.rulesPlaque', { title: page.title })}
      facing={[0, 0, -1]}
      bounds={bounds}
      panel={panel}
    >
      <group position={[x, PLAQUE_Y, 0]}>
        {bars.map(([bx, by, bw, bh]) => (
          <mesh key={`${bx}-${by}`} position={[bx, by, PLAQUE_FRAME_Z]} material={materials.brass} castShadow>
            <boxGeometry args={[bw, bh, 0.12]} />
          </mesh>
        ))}
        <mesh position={[0, 0, PLAQUE_GLASS_Z]} material={materials.glass}>
          <boxGeometry args={[PLAQUE_W, PLAQUE_H, 0.06]} />
        </mesh>
        {texture ? (
          <mesh position={[0, 0, PLAQUE_GLASS_Z - 0.034]} rotation={[0, Math.PI, 0]} renderOrder={3}>
            <planeGeometry args={[PLAQUE_W - 0.02, PLAQUE_H - 0.02]} />
            <meshStandardMaterial
              map={texture}
              emissiveMap={texture}
              emissive="#ffffff"
              emissiveIntensity={night ? 2.6 : 1.0}
              roughness={0.2}
              metalness={0.1}
              toneMapped={false}
              {...standby.materialProps}
            />
          </mesh>
        ) : null}
        <mesh position={[0, -(PLAQUE_H / 2) - 0.2, PIER_FACE_Z - 0.05]} material={materials.shade}>
          <boxGeometry args={[PLAQUE_W + 0.44, 0.1, 0.1]} />
        </mesh>
      </group>
    </FocusSubject>
  );
}

/**
 * South challenge gate: two profiled stone piers with crest medallions and
 * brass rule plaques, a lettered entablature over a coffered passage, two
 * lantern practicals on the threshold, and the aperture field between them.
 */
export default function ChallengeGate({ night, live }: { night: boolean; live: string }) {
  const { gate } = FURNITURE;
  const { formatRules, league, stages } = useEvoligaRouteData();
  const tone = useMemo(() => toneFor(night), [night]);
  const materials = useGateMaterials(night, tone);

  // The contract's stage-fallback-aware name (C-093): the season's
  // ruleset, else the first stage's, else null. The evoliga provider view
  // carries league + stages but not the contract's precomputed field, so
  // the same derivation runs in place.
  const rulesetName = league.ruleset_name ?? stages[0]?.ruleset_name ?? null;
  // The league's format picks the plaques' shaping, never the row (only EPB
  // seasons have one; a format change can leave a stale one). Memoized on the
  // two primitives, so the painted textures stay put across renders.
  const { format, bestOf } = rulesCopyContext({ league, stages });
  // i18n D11: the plaques letter in the viewer's language (and the banned
  // names in the viewer's Pokémon-data language), known before the textures
  // are built — a language switch is a full reload, nothing repaints later.
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const ruleSet = useMemo(
    () => resolveRuleSet(formatRules, rulesetName, { format, bestOf }, locale, dataLocale),
    [formatRules, rulesetName, format, bestOf, locale, dataLocale],
  );
  const pages = useMemo(() => plaquePages(ruleSet, locale), [ruleSet, locale]);

  // The board's rows must keep a STABLE identity: FieldBoard memoizes its
  // paint closure on `rows`, and an inline spread re-created the array on
  // every render — defeating the memo, re-running `usePaintedTexture`'s
  // effect and disposing + re-uploading the texture each time. `pages` is
  // memoized above, so the board page built off it stays byte-stable per ruleSet.
  const board = useMemo(() => fieldBoardPage(ruleSet, pages, locale), [ruleSet, pages, locale]);

  const paintLeft = useMemo(() => paintPlaque(pages.left, tone.brass), [pages.left, tone.brass]);
  const paintRight = useMemo(() => paintPlaque(pages.right, tone.brass), [pages.right, tone.brass]);
  const paintPlate = useMemo(() => paintCta(live, ctaText(format, locale)), [live, format, locale]);
  const leftTex = usePaintedTexture(paintLeft, PLAQUE_TEX_W, PLAQUE_TEX_H);
  const rightTex = usePaintedTexture(paintRight, PLAQUE_TEX_W, PLAQUE_TEX_H);
  const ctaTex = usePaintedTexture(paintPlate, CTA_TEX_W, CTA_TEX_H);

  const friezeLabel = useMemo(() => capsFor(league.name ?? 'EvoLiga', locale), [league.name, locale]);
  const frieze = useMemo(
    () =>
      buildRelief(
        paintFrieze(friezeLabel, tone.dressed, night ? '#f4ecd8' : '#fffaf0'),
        paintFriezeHeight(friezeLabel),
        FRIEZE_TEX_W,
        FRIEZE_TEX_H,
        2.6,
      ),
    [friezeLabel, night, tone.dressed],
  );

  useEffect(
    () => () => {
      frieze?.color.dispose();
      frieze?.normal.dispose();
    },
    [frieze],
  );

  return (
    <group position={[gate.x, 0, gate.z]}>
      <GatePier side={-1} materials={materials} night={night} />
      <GatePier side={1} materials={materials} night={night} />
      {/* C-054: the pier-face crests are the manifest GLB; the boundary covers
          only the manifest fetch, each GLB suspends per seat (PB-194). */}
      <ResidentSuspense id="plaza:gate-crests">
        <CrestSeats />
      </ResidentSuspense>
      <Entablature materials={materials} frieze={frieze} />
      <Passage materials={materials} cta={ctaTex} night={night} />
      <FieldBoard
        night={night}
        kicker={board.kicker}
        title={board.title}
        rows={board.rows}
        lead={board.lead}
        footer={board.footer}
        brass={tone.brass}
        materials={materials}
      />
      <RulePlaque side="left" page={pages.left} texture={leftTex} materials={materials} night={night} />
      <RulePlaque side="right" page={pages.right} texture={rightTex} materials={materials} night={night} />
    </group>
  );
}

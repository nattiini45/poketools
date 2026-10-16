'use client';

import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  ashlarPlaceholderMaps,
  assignAshlarMaps,
  disposeAshlarMaps,
  patchAshlar,
  publishedAshlarMaps,
  subscribeAshlarMaps,
  type AshlarMaps,
} from '@/components/world/themes/plaza/paint-ashlar';
import { useLocale } from '@/i18n/client';
import { paintCaps } from '@/lib/route-world/paint-copy';

/**
 * Course heights of the plinth, cobbles upward. Footing and base give the
 * block a foot on the pavement, the shaft is battered (narrower at the top),
 * the cavetto flares back out under the cap, and the cap overhangs both. The
 * cap's top face is `PLINTH_H` — aces stand there.
 */
const FOOT_H = 0.1;
const BASE_H = 0.1;
const SHAFT_H = 0.6;
const CAVETTO_H = 0.08;
const BAND_H = 0.05;
const CAP_H = 0.1;

export const PLINTH_H = FOOT_H + BASE_H + SHAFT_H + CAVETTO_H + BAND_H + CAP_H;

/** Half-widths, bottom to top. The batter is what keeps it from reading as a box. */
const FOOT_HALF = 0.54;
const BASE_HALF = 0.48;
const SHAFT_HALF_BOTTOM = 0.445;
const SHAFT_HALF_TOP = 0.4;
const CAP_HALF = 0.52;

/** Drum insert that lifts a sub-0.5 m ace to the camera's eye line. */
export const PEDESTAL_H = 0.42;

const PLATE_W = 0.74;
const PLATE_H = 0.255;
const PLATE_TEX_W = 512;
const PLATE_TEX_H = 176;

const FONT = "system-ui, 'Segoe UI', sans-serif";

function canvas2d(w: number, h: number): CanvasRenderingContext2D | null {
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  return source.getContext('2d');
}

interface PlateCopy {
  kicker: string;
  label: string;
  sublabel: string;
}

/** Tracked capitals, drawn glyph by glyph — `ctx.letterSpacing` is not in every engine. */
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

/** Bronze name plate: German kicker, trainer, ace and its real height. */
function paintPlate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  copy: PlateCopy,
  band: string,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#3b3226');
  bg.addColorStop(0.5, '#241d15');
  bg.addColorStop(1, '#181209');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(236, 206, 146, 0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.fillStyle = band;
  ctx.fillRect(10, h - 20, w - 20, 6);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = band;
  ctx.font = `700 22px ${FONT}`;
  trackedText(ctx, copy.kicker, 30, 48, 5);

  ctx.fillStyle = '#f6ecd6';
  ctx.font = `800 42px ${FONT}`;
  ctx.fillText(copy.label, 30, 100);

  ctx.fillStyle = 'rgba(233, 219, 190, 0.78)';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(copy.sublabel, 30, 138);
}

function texFromPaint(
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
  colorSpace: THREE.ColorSpace,
): THREE.CanvasTexture | null {
  const ctx = canvas2d(w, h);
  if (!ctx) return null;
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export interface PlinthStone {
  body: THREE.MeshStandardMaterial;
  cap: THREE.MeshStandardMaterial;
}

/** A day / night tint pair for an ashlar furniture material pair. */
export interface AshlarPairTints {
  day: { body: string; cap: string };
  night: { body: string; cap: string };
}

/** Plinth stone look per palette: the painted ashlar under a limestone tint. */
const PLINTH_TINT: AshlarPairTints = {
  day: { body: '#e2d5bc', cap: '#f4ecda' },
  night: { body: '#8f887e', cap: '#a09a90' },
};

function furnitureMaterial(maps: AshlarMaps, roughness: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: maps.arm,
    aoMap: maps.arm,
    aoMapIntensity: 0.7,
    roughness,
    metalness: 0.03,
  });
  // Stone furniture carries its courses in geometry: no procedural coursing,
  // but the façades' grain, grime and calm (LOOK-PLAN §2 S.4).
  patchAshlar(material, { courseOn: 0, detail: 0.8 });
  return material;
}

/**
 * A painted-ashlar material pair (body, cap) in the façades' stone family —
 * plinths, the teams terrace, planters. Built ONCE on 1×1 placeholders with
 * the painted set's configuration, so it links the façade stone's program;
 * the perimeter's loaded set is swapped in on publish (texture assignment,
 * no relink). Night is a colour write, never a rebuild.
 */
export function useAshlarPair(night: boolean, tints: AshlarPairTints): PlinthStone {
  const stone = useMemo(() => {
    const placeholders = ashlarPlaceholderMaps();
    return {
      placeholders,
      pair: { body: furnitureMaterial(placeholders, 0.86), cap: furnitureMaterial(placeholders, 0.74) } as PlinthStone,
    };
  }, []);

  useLayoutEffect(() => {
    const apply = () => {
      const maps = publishedAshlarMaps() ?? stone.placeholders;
      assignAshlarMaps(stone.pair.body, maps);
      assignAshlarMaps(stone.pair.cap, maps);
    };
    apply();
    return subscribeAshlarMaps(apply);
  }, [stone]);

  const tint = night ? tints.night : tints.day;
  useLayoutEffect(() => {
    stone.pair.body.color.set(tint.body);
    stone.pair.cap.color.set(tint.cap);
  }, [stone, tint.body, tint.cap]);

  useEffect(
    () => () => {
      stone.pair.body.dispose();
      stone.pair.cap.dispose();
      disposeAshlarMaps(stone.placeholders);
    },
    [stone],
  );

  return stone.pair;
}

/**
 * The statue row's stone (plinths and terrace): one painted-ashlar pair for
 * the whole row (LOOK-PLAN §2 S.4 — the canvas-painted limestone is gone).
 */
export function usePlinthStone(night: boolean): PlinthStone {
  return useAshlarPair(night, PLINTH_TINT);
}

/**
 * Square-plan block with a batter: a four-sided cylinder turned an eighth turn
 * so its flats face the axes. `halfBottom` > `halfTop` gives the taper, and
 * the diagonal edges are the chamfer the bar asks for.
 */
function Block({
  halfBottom,
  halfTop,
  height,
  y,
  material,
  receiveShadow = false,
}: {
  halfBottom: number;
  halfTop: number;
  height: number;
  y: number;
  material: THREE.Material;
  receiveShadow?: boolean;
}) {
  return (
    <mesh
      position={[0, y + height / 2, 0]}
      rotation={[0, Math.PI / 4, 0]}
      material={material}
      castShadow
      receiveShadow={receiveShadow}
    >
      <cylinderGeometry
        args={[halfTop * Math.SQRT2, halfBottom * Math.SQRT2, height, 4, 1]}
      />
    </mesh>
  );
}

interface PlinthProps {
  /** Trainer name on the plate. */
  label: string;
  /** Ace and its real height, e.g. `Ivysaur · 1,0 m`. */
  sublabel: string;
  /** Kicker above the name; absent = `paint.plinth.kicker` in the viewer's language ("ASS" / "ACE"). */
  kicker?: string;
  /** Team colour: the band under the cap and the plate's rule. */
  band: string;
  /** Lift a tiny ace on a drum so its eye line meets the camera. */
  pedestal?: boolean;
  night: boolean;
  stone: PlinthStone;
}

/**
 * One authored statue plinth: footing, base course, battered and chamfered
 * shaft, cavetto, team-colour band and an overhanging cap the ace's shadow
 * falls on. The bronze name plate sits on local +Z, which the row's −90°
 * turn points back at the `#teams` camera.
 */
export default function Plinth({
  label,
  sublabel,
  kicker: kickerProp,
  band,
  pedestal = false,
  night,
  stone,
}: PlinthProps) {
  const locale = useLocale();
  const kicker = kickerProp ?? paintCaps(locale, 'plinth.kicker');
  const plate = useMemo(
    () =>
      texFromPaint(
        (ctx, w, h) => paintPlate(ctx, w, h, { kicker, label, sublabel }, band),
        PLATE_TEX_W,
        PLATE_TEX_H,
        THREE.SRGBColorSpace,
      ),
    [kicker, label, sublabel, band],
  );
  useEffect(() => () => plate?.dispose(), [plate]);

  const shaftY = FOOT_H + BASE_H;
  const cavettoY = shaftY + SHAFT_H;
  const bandY = cavettoY + CAVETTO_H;
  const capY = bandY + BAND_H;
  // The shaft is battered, so the plate stands proud of the face it is bolted to.
  const plateZ = SHAFT_HALF_BOTTOM - 0.015;

  return (
    <group>
      <Block halfBottom={FOOT_HALF} halfTop={FOOT_HALF - 0.03} height={FOOT_H} y={0} material={stone.body} receiveShadow />
      <Block halfBottom={BASE_HALF} halfTop={BASE_HALF - 0.035} height={BASE_H} y={FOOT_H} material={stone.body} receiveShadow />
      <Block
        halfBottom={SHAFT_HALF_BOTTOM}
        halfTop={SHAFT_HALF_TOP}
        height={SHAFT_H}
        y={shaftY}
        material={stone.body}
      />
      <Block
        halfBottom={SHAFT_HALF_TOP}
        halfTop={CAP_HALF - 0.05}
        height={CAVETTO_H}
        y={cavettoY}
        material={stone.cap}
      />
      <mesh position={[0, bandY + BAND_H / 2, 0]} castShadow>
        <boxGeometry args={[(CAP_HALF - 0.045) * 2, BAND_H, (CAP_HALF - 0.045) * 2]} />
        <meshStandardMaterial
          color={band}
          emissive={band}
          emissiveIntensity={night ? 0.85 : 0.22}
          roughness={0.34}
          metalness={0.3}
        />
      </mesh>
      {/* Cap: the ace stands and drops its shadow here. */}
      <Block
        halfBottom={CAP_HALF}
        halfTop={CAP_HALF - 0.012}
        height={CAP_H}
        y={capY}
        material={stone.cap}
        receiveShadow
      />

      {/* Bronze plate, bezel first so the panel reads as recessed metal. */}
      <mesh position={[0, shaftY + SHAFT_H * 0.44, plateZ]} castShadow>
        <boxGeometry args={[PLATE_W + 0.045, PLATE_H + 0.045, 0.022]} />
        <meshStandardMaterial color="#4c3f2c" roughness={0.42} metalness={0.55} />
      </mesh>
      {plate ? (
          <mesh position={[0, shaftY + SHAFT_H * 0.44, plateZ + 0.014]}>
          <planeGeometry args={[PLATE_W, PLATE_H]} />
          {/* A data face: never painted, graded or rimmed (data-surfaces.ts law). */}
          <meshStandardMaterial
            userData-dataFace
            map={plate}
            emissiveMap={plate}
            emissive="#ffffff"
            emissiveIntensity={night ? 1.6 : 0.16}
            roughness={0.46}
            metalness={0.24}
          />
        </mesh>
      ) : null}

      {pedestal ? (
        <group position={[0, PLINTH_H, 0]}>
          <mesh position={[0, PEDESTAL_H / 2, 0]} castShadow receiveShadow material={stone.cap}>
            <cylinderGeometry args={[0.3, 0.36, PEDESTAL_H, 20]} />
          </mesh>
          <mesh position={[0, PEDESTAL_H - 0.018, 0]} castShadow receiveShadow material={stone.cap}>
            <cylinderGeometry args={[0.34, 0.3, 0.036, 20]} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

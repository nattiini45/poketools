'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { queuePaint } from '@/components/world/route/paint-queue';
import { useResidencyHold } from '@/components/world/route/residency-store';
import { DESK, FURNITURE } from '@/lib/route-world/layout';
import { useEvoligaRouteData } from '../route-data';
import { useDataLocale, useLocale } from '@/i18n/client';
import {
  HOLO_FIELD_H,
  HOLO_FIELD_W,
  paintHoloBoard,
  type HoloCard,
  type HoloRow,
} from './desk-painters';
import type { PlazaWorldPalette } from '@/components/world/themes/plaza/theme-palette';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The roster holo above the Poké Center counter: one SELF-LIT board of rows
 * (C-108: the field pane reads by its own emission, the C-104 zero-emission
 * law), projected from an emitter puck on the counter top.
 *
 * C-106 r3 ghost removal: the C-108 rework replaced the old additive back
 * board with this FieldPane but left the two additive front sheets mounted
 * (the count sheet and the caption chip). With the rows now legible on the
 * self-lit pane they were dead duplicates — the translucent green "92/20"
 * count and the "Bulbasaur" chip the r2 chief confirmed floating between the
 * two clean panes — so the render path no longer produces them: the sheets,
 * their painters and their shader are removed (not hidden).
 */

/**
 * ENGINE r6 (E2): the painted canvas IS the texture's image — no synchronous
 * PNG encode (`toDataURL`) and no image decode on upload. GPU state is the
 * old loader path's, field for field (a plain `Texture`: flipY, straight
 * alpha; sRGB, linear, no mips, clamp), so the field samples the same pixels.
 * A plain `Texture`, not `CanvasTexture`: QualityGovernor's
 * `retainDataTextureDisposals` patches `CanvasTexture.prototype.dispose`, and
 * a repainted field must still free its old upload. Each paint allocates its
 * own canvas, so no snapshot (`createImageBitmap`) is needed.
 */
export function holoCanvasTexture(canvas: HTMLCanvasElement): THREE.Texture {
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

/** Paint into a fresh detached canvas and wrap it (null: no 2D context — logged, the sheet stays unmapped and pending). */
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
    console.error('[desk-holo] canvas 2d unavailable');
    return null;
  }
  paint(ctx, w, h);
  return holoCanvasTexture(source);
}

function usePaintedTexture(
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
  key: string,
): THREE.Texture | null {
  // ENGINE r4 (D23): residency stays pending until the paint for the
  // CURRENT inputs has landed (a repaint re-opens it), so no face can
  // reveal blank or finish uploading after the world appears.
  const run = useMemo(() => ({ paint, w, h, key }), [paint, w, h, key]);
  const [painted, setPainted] = useState<{ texture: THREE.Texture; run: object } | null>(null);
  useResidencyHold('paint:plaza-holo', painted?.run !== run);

  useEffect(() => {
    let texture: THREE.Texture | null = null;
    // ENGINE r3 (load long task): the paint runs in its own task through the
    // engine's paint queue, never in the commit's effect flush beside every
    // other face. ENGINE r6 (E2): the texture is made in that same task from
    // the painted canvas, once per effect run, and this run's cleanup disposes
    // it (PB-003: never memoized). A cancelled job never runs. Same paint,
    // same pixels.
    const cancelPaint = queuePaint(() => {
      texture = paintCanvasTexture(paint, w, h);
      if (texture) setPainted({ texture, run });
    });
    return () => {
      cancelPaint();
      texture?.dispose();
    };
  }, [paint, w, h, key, run]);

  return painted?.texture ?? null;
}

/**
 * The back pane as a SELF-LIT sheet (C-108): the additive glass wash lost to
 * the sunlit interior behind the window and the roster rows ghosted out (the
 * C-106 panel finding). The pane mounts the clouds flagship lever instead —
 * pure #000000 base + dead specular (roughness 1, envMapIntensity 0) over the
 * painted board, `toneMapped={false}`: the field is exactly zero emission, so
 * AgX maps it to exactly black at any exposure and the rows read by their own
 * emission alone. It keeps the stack's slow suspension drift.
 */
function FieldPane({
  map,
  width,
  height,
  position,
  tilt,
  night,
}: {
  map: THREE.Texture | null;
  width: number;
  height: number;
  position: [number, number, number];
  tilt: number;
  night: boolean;
}) {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  const group = useRef<THREE.Group>(null);

  // Same slow suspension drift as the glass sheets, one phase.
  useFrame(({ clock }) => {
    const node = group.current;
    if (node) node.position.y = position[1] + Math.sin(clock.elapsedTime * 0.6 + 0) * 0.018;
  });

  if (!map) return null;

  return (
    <group ref={group} position={position} rotation={[0, Math.PI / 2, tilt]}>
      <mesh renderOrder={6}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={map}
          color="#000000"
          emissiveMap={map}
          emissive="#ffffff"
          emissiveIntensity={night ? 1.9 : 1.15}
          roughness={1.0}
          metalness={0.04}
          ref={bindEnv}
          envMapIntensity={0}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export default function DeskHolo({
  palette,
  night,
}: {
  palette: PlazaWorldPalette;
  night: boolean;
}) {
  const { desk } = FURNITURE;
  const { deskRosterLive, deskKiosk } = palette;
  const accent = deskRosterLive;

  const { entries, trackers } = useEvoligaRouteData();

  const rows = useMemo<HoloRow[]>(
    () =>
      entries.slice(0, 5).map((entry) => ({
        line: entry.line_number,
        name: entry.base_pokemon,
        price: entry.price,
      })),
    [entries],
  );

  // i18n D11: chrome in the viewer's language, line names in the viewer's
  // Pokémon-data language — both known before the paint.
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const card = useMemo<HoloCard>(
    () => ({
      rows,
      total: entries.length,
      open: Math.max(0, entries.length - trackers.length),
      accent,
      locale,
      dataLocale,
    }),
    [rows, entries.length, trackers.length, accent, locale, dataLocale],
  );

  const paintField = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number) => paintHoloBoard(ctx, w, h, card),
    [card],
  );

  const cardKey = `${card.total}-${card.open}-${accent}-${rows[0]?.name ?? ''}-${locale}-${dataLocale}`;
  const fieldMap = usePaintedTexture(paintField, HOLO_FIELD_W, HOLO_FIELD_H, `field-${cardKey}`);

  return (
    <group position={[desk.x, 0, desk.z]}>
      {/* Emitter puck on the counter top — the card has a source. */}
      <group position={[0.06, DESK.height + 0.02, 1.2]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.11, 0.14, 0.05, 20]} />
          <meshStandardMaterial color={deskKiosk} roughness={0.32} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.05, 0.085, 20]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={night ? 2.6 : 2.2}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        {/*
          Lifted off the puck. Sitting 2 cm above the lacquer, this light was a
          1/d² hot spot that clipped the counter top to (247, 255, 248) —
          the emitter should tint the counter, not burn a hole in it.
        */}
        <pointLight
          position={[0.1, 0.34, 0]}
          color={accent}
          intensity={night ? 1.4 : 1.2}
          distance={3.4}
          decay={2}
        />
      </group>

      {/*
        The self-lit board floats over the counter's south half — clear of
        the nurse (she occupies z ≈ −0.5…0.75) and short of the south corner
        pylon at z = 2.32. (C-106 r3: the additive count and chip sheets that
        used to stack in front of it are removed — see the file note.)
      */}
      <FieldPane
        map={fieldMap}
        width={1.5}
        height={1}
        position={[0.35, 2.24, 1.36]}
        tilt={0.035}
        night={night}
      />
    </group>
  );
}

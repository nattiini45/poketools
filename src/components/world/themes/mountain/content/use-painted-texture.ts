'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { queuePaint } from '@/components/world/route/paint-queue';
import { markBandedUpload } from '@/components/world/route/content/banded-upload';
import { useResidencyHold } from '@/components/world/route/residency-store';
// C-105 r1 adoption: the ENGINE paint path is consumed under an alias — the
// mountain painters keep their own names, nothing collides, and the alias
// documents which module owns the floors.
import {
  paintBoardPage as paintBoardPageShared,
  type BoardPaintTools,
} from '@/lib/route-world/board-paint-path';
import type { RouteStation } from '@/lib/route-world/chapters';

/**
 * ENGINE r6 (E2): the painted canvas IS the texture's image — no synchronous
 * PNG encode (`toDataURL`) and no image decode on upload. GPU state is the
 * old loader path's, field for field (a plain `Texture`: flipY, straight
 * alpha; sRGB, linear, no mips, clamp), so every face samples the same
 * pixels. A plain `Texture` over the canvas, not the `CanvasTexture`
 * subclass: `retainDataTextureDisposals` (QualityGovernor) patches
 * `CanvasTexture.prototype.dispose`, and a repainted face must still free its
 * old upload exactly as the loaded texture did. Each paint allocates its own
 * canvas, so no snapshot (`createImageBitmap`) is needed.
 */
export function paintedCanvasTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.Texture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  // ROLLOUT-PLAN §3.2 E3: a face canvas larger than one band (2048 × 256)
  // reaches the GPU in bands during the ceremony, texel-identical; the
  // canvas keeps its ≥ 2× floor size (clarity outranks CAR).
  return markBandedUpload(tex);
}

/**
 * Paint once into a detached canvas and upload that canvas. The texture is
 * created INSIDE the queued paint job, once per effect run, and disposed by
 * that run's cleanup — never a memoized `CanvasTexture`, so Strict Mode's
 * double mount cannot dispose a live GPU upload (the plaza's PB-003 law,
 * restated for the mountain content walls). The generic hook stays for
 * non-text painted impostors (the ridge silhouette ring) — text content
 * surfaces go through `usePaintedBoardTexture`.
 */
export function usePaintedTexture(
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): THREE.Texture | null {
  // ENGINE r4 (D23): residency stays pending until the paint for the
  // CURRENT inputs has landed (a repaint re-opens it), so no face can
  // reveal blank or finish uploading after the world appears.
  const run = useMemo(() => ({ paint, w, h }), [paint, w, h]);
  const [painted, setPainted] = useState<{ texture: THREE.Texture; run: object } | null>(null);
  useResidencyHold('paint:mountain', painted?.run !== run);

  useEffect(() => {
    let texture: THREE.Texture | null = null;
    // ENGINE r3 (load long task): the paint runs in its own task through the
    // engine's paint queue, not in the commit's effect flush beside every
    // other face. ENGINE r6 (E2): the texture is made in that same task from
    // the painted canvas (no PNG encode). A cancelled job never runs, so no
    // texture outlives its run. Same paint, same pixels.
    const cancelPaint = queuePaint(() => {
      const source = document.createElement('canvas');
      source.width = w;
      source.height = h;
      const ctx = source.getContext('2d');
      // No 2D context (e.g. canvas memory exhausted): logged, and the face
      // stays pending (D23: never revealed blank; the stall detector resolves
      // the load to Lite).
      if (!ctx) {
        console.error('[mountain] canvas 2d unavailable');
        return;
      }
      paint(ctx, w, h);
      texture = paintedCanvasTexture(source);
      setPainted({ texture, run });
    });
    return () => {
      cancelPaint();
      texture?.dispose();
    };
  }, [paint, w, h, run]);

  return painted?.texture ?? null;
}

/** A board-page painter: declared-space draw whose font px go through the clamp. */
export type BoardPagePainter = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tools: BoardPaintTools,
) => void;

/**
 * The C-105 r1 shared paint path for the pass's board pages: the canvas is
 * allocated through `paintBoardPage` (never below the theme's ≥2× floor) and
 * the painter receives the station's pose-derived font clamp, so nothing
 * sub-floor can ship (bar criterion 2 — enforcement in shared paint code, not
 * per-theme). Declared constants stay: `paint` still draws in w×h.
 */
export function usePaintedBoardTexture(
  paint: BoardPagePainter,
  w: number,
  h: number,
  station: RouteStation,
  faceWidthM: number,
): THREE.Texture | null {
  // ENGINE r4 (D23): residency stays pending until the paint for the
  // CURRENT inputs has landed (a repaint re-opens it), so no face can
  // reveal blank or finish uploading after the world appears.
  const run = useMemo(() => ({ paint, w, h, station, faceWidthM }), [paint, w, h, station, faceWidthM]);
  const [painted, setPainted] = useState<{ texture: THREE.Texture; run: object } | null>(null);
  useResidencyHold('paint:mountain', painted?.run !== run);

  useEffect(() => {
    let texture: THREE.Texture | null = null;
    // ENGINE r3 (load long task): the paint runs in its own task through the
    // engine's paint queue, not in the commit's effect flush beside every
    // other face. ENGINE r6 (E2): the texture is made in that same task from
    // the page canvas (fresh per paint; no PNG encode). Same paint, same
    // pixels.
    const cancelPaint = queuePaint(() => {
      const result = paintBoardPageShared({
        current: { width: w, height: h },
        station,
        boardWorldWidthM: faceWidthM,
        paint,
      });
      texture = paintedCanvasTexture(result.canvas);
      setPainted({ texture, run });
    });
    return () => {
      cancelPaint();
      texture?.dispose();
    };
  }, [paint, w, h, station, faceWidthM, run]);

  return painted?.texture ?? null;
}

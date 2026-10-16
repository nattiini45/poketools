/**
 * Calm rects (LOOK-PLAN §2 SEAT L item 6): the padded screen rects of the
 * data faces the viewer can currently see, published every frame into the
 * shared `uCalmRects[4]` uniform (`paint-uniforms.ts`). The SKY and MOMENTS
 * seats read it to flatten their busy terms — cloud contrast, silver lining,
 * skyline windows, shafts — behind a face. The aerial value lift is NOT
 * masked (LOOK-PLAN §0: no calm halo on the air).
 *
 * Faces: the active station's plus its neighbours' (by the conductor's
 * smooth position), up to `CALM_RECT_SLOTS`, active first. Each is projected
 * from the camera the frame is rendered with, padded by the keep-out law's
 * `KEEP_OUT_PAD` (0.3 m in the world, then `viewport` 4 % on screen) — the
 * same rect the clarity audit holds decorations out of.
 */

import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CameraEndpoint, Vec3 } from '@/lib/route-world/chapters';
import {
  KEEP_OUT_PAD,
  paddedFaceRect,
  type DataFace,
  type DataSurfaceTheme,
  type KeepOutPad,
  type Viewport,
} from '@/lib/route-world/data-surfaces';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { CALM_RECT_SLOTS, PAINT_UNIFORMS, type PaintUniforms } from './paint-uniforms';

/**
 * The faces worth a calm slot at conductor `position`: stations within one
 * step of it, nearest station first (stable by face order inside a station),
 * capped at `slots`.
 */
export function selectCalmFaces(
  surfaces: DataSurfaceTheme,
  position: number,
  slots: number = CALM_RECT_SLOTS,
): DataFace[] {
  const index = new Map(surfaces.stations.map((station, i) => [station.id, i]));
  return surfaces.faces
    .map((face, order) => ({ face, order, gap: Math.abs((index.get(face.station) ?? Infinity) - position) }))
    .filter((entry) => entry.gap <= 1.5)
    .sort((a, b) => a.gap - b.gap || a.order - b.order)
    .slice(0, slots)
    .map((entry) => entry.face);
}

/**
 * ROLLOUT §2.2 (j): the calm SLOTS at conductor `position` — like
 * `selectCalmFaces`, but the members of a `calmUnions` entry share one slot
 * (their rects merge into one union rect, `calmRectsForGroups`). The keep-out
 * law never sees this: it keeps every face on its own. A theme without unions
 * gets one single-face group per `selectCalmFaces` entry, in the same order.
 */
export function selectCalmGroups(
  surfaces: DataSurfaceTheme,
  position: number,
  slots: number = CALM_RECT_SLOTS,
): DataFace[][] {
  const index = new Map(surfaces.stations.map((station, i) => [station.id, i]));
  const unionOf = new Map<string, string>();
  for (const union of surfaces.calmUnions ?? []) for (const member of union.members) unionOf.set(member, union.id);
  const groups = new Map<string, { faces: DataFace[]; order: number; gap: number }>();
  surfaces.faces.forEach((face, order) => {
    const gap = Math.abs((index.get(face.station) ?? Infinity) - position);
    if (gap > 1.5) return;
    const key = unionOf.has(face.id) ? `union:${unionOf.get(face.id)}` : `face:${face.id}:${order}`;
    const group = groups.get(key);
    if (group) {
      group.faces.push(face);
      group.gap = Math.min(group.gap, gap);
      group.order = Math.min(group.order, order);
    } else {
      groups.set(key, { faces: [face], order, gap });
    }
  });
  return [...groups.values()]
    .sort((a, b) => a.gap - b.gap || a.order - b.order)
    .slice(0, slots)
    .map((group) => group.faces);
}

/** A calm rect in normalised GL screen space (origin bottom-left): x0, y0, x1, y1. */
export type CalmRect = readonly [number, number, number, number];

/**
 * Padded GL-space rects of the given faces seen from `camera` in `viewport`
 * (CSS px). Faces entirely off screen are skipped, so the result may be
 * shorter than the input.
 */
export function calmRectsFor(
  faces: readonly DataFace[],
  camera: CameraEndpoint,
  viewport: Viewport,
  pad: KeepOutPad = KEEP_OUT_PAD,
): CalmRect[] {
  const out: CalmRect[] = [];
  for (const face of faces) {
    const rect = paddedFaceRect(face, camera, viewport, pad);
    if (!rect) continue;
    out.push([
      rect.x / viewport.width,
      1 - (rect.y + rect.h) / viewport.height,
      (rect.x + rect.w) / viewport.width,
      1 - rect.y / viewport.height,
    ]);
  }
  return out;
}

/**
 * One rect per calm group: a single face's padded rect, or the union
 * (bounding) rect of a group's on-screen members. Groups entirely off screen
 * are skipped.
 */
export function calmRectsForGroups(
  groups: readonly (readonly DataFace[])[],
  camera: CameraEndpoint,
  viewport: Viewport,
  pad: KeepOutPad = KEEP_OUT_PAD,
): CalmRect[] {
  const out: CalmRect[] = [];
  for (const group of groups) {
    const rects = calmRectsFor(group, camera, viewport, pad);
    if (rects.length === 0) continue;
    if (rects.length === 1) {
      out.push(rects[0]);
      continue;
    }
    out.push([
      Math.min(...rects.map((r) => r[0])),
      Math.min(...rects.map((r) => r[1])),
      Math.max(...rects.map((r) => r[2])),
      Math.max(...rects.map((r) => r[3])),
    ]);
  }
  return out;
}

/** Write rects into the shared uniform slots; unused slots are zeroed. */
export function writeCalmRects(rects: readonly CalmRect[], uniforms: PaintUniforms = PAINT_UNIFORMS): number {
  const slots = uniforms.uCalmRects.value;
  const count = Math.min(rects.length, slots.length);
  for (let i = 0; i < slots.length; i += 1) {
    const r = i < count ? rects[i] : null;
    if (r) slots[i].set(r[0], r[1], r[2], r[3]);
    else slots[i].set(0, 0, 0, 0);
  }
  uniforms.uCalmCount.value = count;
  return count;
}

const _dir = new THREE.Vector3();

/** The live camera as the keep-out law's endpoint (position, a target 1 m ahead, vertical fov). */
export function endpointOfCamera(camera: THREE.Camera): CameraEndpoint | null {
  const perspective = camera as THREE.PerspectiveCamera;
  if (!perspective.isPerspectiveCamera) return null;
  camera.getWorldDirection(_dir);
  const p = camera.getWorldPosition(new THREE.Vector3());
  const position: Vec3 = [p.x, p.y, p.z];
  const target: Vec3 = [p.x + _dir.x, p.y + _dir.y, p.z + _dir.z];
  return { position, target, fov: perspective.fov };
}

/**
 * Per-frame publisher. Mount inside the canvas AFTER the camera rig (same
 * frame priority, later subscription), so the rects come from the camera
 * sample this frame renders.
 */
export function CalmRects({ surfaces }: { surfaces: DataSurfaceTheme }): null {
  const { conductor } = useWorldState();
  useFrame(({ camera, size, gl }) => {
    const endpoint = endpointOfCamera(camera);
    if (!endpoint || size.width <= 0 || size.height <= 0) {
      writeCalmRects([]);
      return;
    }
    const groups = selectCalmGroups(surfaces, conductor.progress.current.smooth);
    writeCalmRects(calmRectsForGroups(groups, endpoint, { width: size.width, height: size.height }));
    gl.getDrawingBufferSize(PAINT_UNIFORMS.uCalmViewport.value);
  });
  return null;
}

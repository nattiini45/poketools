'use client';

/**
 * The shared painted-light rig (ROLLOUT §2.2 b): what the plaza `Lighting`
 * did for the plaza alone, as a hook any world's own light rig calls with
 * its theme. A world opts in through data — `theme.paint` and its
 * `features` — never through a code path of its own:
 *
 * - `usePaintRig(opts)`: the layout-effect palette write (light set, painted
 *   chroma, `uKeyScale`, the painted hemisphere), the per-frame hemisphere,
 *   shadow fill / form, bounce and air-lift writes with the contre-jour
 *   factor, and — with `features.stationShadow` — the station-fitted shadow
 *   box and the shadow ladder on the world's key light. Exactly the plaza's
 *   maths and order (`paint-rig.ts`); uniform writes only, never a program.
 * - `<PaintRigMounts/>`: per flag, `PaintSweep scope={theme.id}` +
 *   `PaintAudit` (`sweep`), `CalmRects` (`calmRects`), `ContactBlobs`
 *   (`contactBlobs`).
 * - The unmount reset: each shared singleton is handed back at its module
 *   default by the writer that owns it (`resetPaintUniforms` here,
 *   `useCanopyLight` for `LEAF_*`, `PaintedSkyDome` for `SKY_UNIFORMS`), so a
 *   plaza → clouds SPA session never inherits the plaza's light, canopy or
 *   sky. `resetPaintWorldState()` runs all three at once.
 *
 * A world WITHOUT a paint block (sakura, mountain and clouds today) calls
 * none of this; if it did, every write is skipped (`theme.paint` absent).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { environmentIntensityFor } from '@/components/world/route/env/WorldEnvironment';
import { resetSkyUniforms } from '@/components/world/route/env/paint-fx';
import { resetCanopyLight } from '@/components/world/route/trees/tree-cards';
import ContactBlobs, { type GroundHeightFn } from '@/components/world/route/figures/ContactBlobs';
import { pullbackForAspect } from '@/lib/route-world/camera-path';
import type { DataSurfaceTheme } from '@/lib/route-world/data-surfaces';
import { fitStationShadow, lightBasis, stationReceiverCentroids } from '@/lib/route-world/shadow-fit';
import { paintFeature, type RouteThemeDefinition } from '@/lib/route-world/theme-types';
import { CalmRects } from './calm-rects';
import PaintAudit from './PaintAudit';
import { PaintSweep } from './paint-sweep';
import { PAINT_UNIFORMS, keyScaleFor, resetPaintUniforms } from './paint-uniforms';
import {
  applyPaintRigPalette,
  contreJourFactor,
  keyColorFor,
  paintIblScales,
  paintRigFrameBase,
  paintRigKeyScale,
  paintSetFor,
  rigTuningFor,
  sceneKeyColor,
  writePaintRigFrame,
  type WorldSample,
} from './paint-rig';

/** A static scene key: `uKeyScale` is computed once per palette (the plaza path). */
export interface StaticSceneKey {
  color: string;
  intensity: number;
}

/**
 * A per-frame scene key (mountain / clouds station keys): write the SHIPPED
 * scene key at this conductor position into `out` as a linear colour × its
 * base intensity, and return `out`. `uKeyScale` is then recomputed every
 * frame — a uniform write, not a program change.
 */
export type SceneKeyFn = (out: THREE.Color, world: WorldSample, position: number) => THREE.Color;

export interface PaintRigOptions {
  /** The world's theme: `id` = paint scope; `.paint`, `.lights`, `.stations`, `.environmentIntensity`. */
  theme: RouteThemeDefinition<unknown>;
  night: boolean;
  exposure: number;
  /** The SHIPPED scene key (unpainted materials keep it); see `StaticSceneKey` / `SceneKeyFn`. */
  sceneKey: StaticSceneKey | SceneKeyFn;
  /**
   * The world's key light. With a static `sceneKey` the rig writes its
   * intensity (`sceneKey.intensity × world.key × exposure`); with
   * `features.stationShadow` it fits the shadow box to the station (via the
   * light's `target`) and runs the shadow ladder.
   */
  keyLight?: RefObject<THREE.DirectionalLight | null>;
}

/** GATE's ladder fields (LOOK-PLAN §2 SEAT G item 5), read structurally until they land. */
interface ShadowLadderFields {
  shadowUpdate?: 'always' | 'on-move';
  shadowIntensity?: 0 | 1;
}

type ShadowMode = 'always' | 'on-move' | 'frozen';

/** Hand every shared paint singleton back at its module default (uniforms, canopy, sky). */
export function resetPaintWorldState(): void {
  resetPaintUniforms();
  resetCanopyLight();
  resetSkyUniforms();
}

/** The shadow ladder's per-mount memory (the last mode and the last fitted centre). */
interface ShadowLadderState {
  mode: ShadowMode;
  lastCenter: string;
}

/**
 * The per-frame key-light writes (plaza order): the scene key intensity (a
 * static scene key only), then — with a station fit — the shadow strength,
 * the fitted box (light and target), and the shadow ladder's map cadence.
 */
function driveKeyLight(
  key: THREE.DirectionalLight,
  gl: THREE.WebGLRenderer,
  frame: {
    intensity: number | null;
    fit: readonly [number, number, number] | null;
    keyPosition: readonly [number, number, number];
    shadowIntensity: number;
    shadowMode: ShadowMode;
    state: ShadowLadderState;
  },
): void {
  if (frame.intensity !== null) key.intensity = frame.intensity;
  if (!frame.fit) return;
  key.shadow.intensity = frame.shadowIntensity;
  const [cx, cy, cz] = frame.fit;
  key.position.set(cx + frame.keyPosition[0], cy + frame.keyPosition[1], cz + frame.keyPosition[2]);
  const target = key.target;
  if (target) {
    target.position.set(cx, cy, cz);
    target.updateMatrixWorld();
  }
  const centerKey = `${cx.toFixed(4)},${cy.toFixed(4)},${cz.toFixed(4)}`;
  const moved = centerKey !== frame.state.lastCenter;
  frame.state.lastCenter = centerKey;
  if (frame.state.mode !== frame.shadowMode) {
    gl.shadowMap.autoUpdate = frame.shadowMode === 'always';
    gl.shadowMap.needsUpdate = frame.shadowMode !== 'frozen';
    frame.state.mode = frame.shadowMode;
  } else if (frame.shadowMode === 'on-move' && moved) {
    gl.shadowMap.needsUpdate = true;
  }
}

export function usePaintRig({ theme, night, exposure, sceneKey, keyLight }: PaintRigOptions): void {
  const { conductor, sampleWorldState, mobile } = useWorldState();
  const quality = useQuality();
  const getThree = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  const paint = theme.paint ?? null;
  const set = paint ? paintSetFor(paint, night) : null;
  const tuning = paint ? rigTuningFor(paint) : null;
  const lights = theme.lights;
  const stationShadow = paintFeature(paint, 'stationShadow');
  const post = quality.post;

  const environmentIntensity = theme.environmentIntensity;
  const keyFn = typeof sceneKey === 'function' ? sceneKey : null;
  const staticColor = typeof sceneKey === 'function' ? null : sceneKey.color;
  const staticIntensity = typeof sceneKey === 'function' ? null : sceneKey.intensity;

  // The palette write (plaza order). Uniform writes only.
  useLayoutEffect(() => {
    if (!set || !tuning) return;
    const [iblScale, iblSpecScale] = paintIblScales(set, exposure, environmentIntensity, environmentIntensityFor);
    applyPaintRigPalette(set, post, lights.keyDirection, iblScale, iblSpecScale, tuning);
    if (staticColor !== null && staticIntensity !== null) {
      paintRigKeyScale(set, post, sceneKeyColor({ color: staticColor, intensity: staticIntensity }), tuning);
    }
    PAINT_UNIFORMS.uHemiOn.value = 1;
  }, [set, tuning, lights.keyDirection, post, exposure, environmentIntensity, staticColor, staticIntensity]);

  // ROLLOUT §2.2 b: leaving the world hands the shared light back at its defaults.
  useLayoutEffect(
    () => () => {
      if (paint) resetPaintUniforms();
    },
    [paint],
  );

  const base = useMemo(() => (set && tuning ? paintRigFrameBase(set, post, tuning) : null), [set, post, tuning]);
  // Per-frame key scale (function form only): the art key per palette and rung.
  const artKey = useMemo(
    () => (set && tuning && keyFn ? keyColorFor(set.key.color, post, undefined, tuning).multiplyScalar(set.key.intensity) : null),
    [set, tuning, keyFn, post],
  );
  const sceneKeyScratch = useMemo(() => new THREE.Color(), []);
  const viewDir = useMemo(() => new THREE.Vector3(), []);

  // Station-fitted shadow: a constant light-space box whose centre lerps
  // between the stations' receiver centroids (LOOK-PLAN §1.2).
  const basis = useMemo(() => lightBasis(lights.keyDirection), [lights.keyDirection]);
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const pullback = pullbackForAspect(aspect);
  const centroids = useMemo(
    () => stationReceiverCentroids(theme.stations, mobile, pullback),
    [theme.stations, mobile, pullback],
  );
  const shadowBox = paint?.shadow.box ?? 0;
  const shadowMapSize = paint?.shadow.mapSize ?? 0;
  const rig = useMemo(() => ({ box: shadowBox, mapSize: shadowMapSize }), [shadowBox, shadowMapSize]);

  // Rung 3 updates the map on camera travel only; rung 4 keeps the caster set
  // (same programs) but zeroes the shadow and stops rendering the map.
  const ladder = quality as typeof quality & ShadowLadderFields;
  const shadowIntensity = ladder.shadowIntensity ?? (quality.shadowedLights > 0 && quality.shadowMapSize > 0 ? 1 : 0);
  const shadowMode: ShadowMode = shadowIntensity === 0 ? 'frozen' : (ladder.shadowUpdate ?? 'always');
  const shadowState = useRef<ShadowLadderState>({ mode: 'always', lastCenter: '' });

  // Hand the map back to per-frame updates when the rig unmounts.
  useEffect(() => {
    if (!stationShadow) return;
    return () => {
      getThree().gl.shadowMap.autoUpdate = true;
    };
  }, [getThree, stationShadow]);

  useFrame(({ gl, camera }) => {
    if (!set || !tuning || !base) return;
    const position = conductor.progress.current.smooth;
    const world = sampleWorldState(position);
    const key = keyLight?.current ?? null;
    if (key) {
      driveKeyLight(key, gl, {
        intensity: staticIntensity === null ? null : staticIntensity * world.key * exposure,
        fit: stationShadow ? fitStationShadow(centroids, position, basis, rig).center : null,
        keyPosition: lights.keyPosition,
        shadowIntensity,
        shadowMode,
        state: shadowState.current,
      });
    }
    if (keyFn && artKey) {
      keyScaleFor(artKey, keyFn(sceneKeyScratch, world, position), PAINT_UNIFORMS.uKeyScale.value);
    }
    // Contre-jour (LOOK r4): warm bounce and sunward air grow as the eye turns
    // into the sun, and the cool fill steps down so the warm accents carry.
    camera.getWorldDirection(viewDir);
    const into = night ? 0 : contreJourFactor(viewDir, lights.keyDirection);
    writePaintRigFrame(base, set, world, exposure, into, tuning);
  });
}

export interface PaintRigMountsProps {
  theme: RouteThemeDefinition<unknown>;
  /** The world's data surfaces (the calm rects publish their padded rects). */
  surfaces?: DataSurfaceTheme;
  night: boolean;
  /** Ground height under a figure (ContactBlobs; default the y = 0 plane). */
  groundHeight?: GroundHeightFn;
}

/** The per-flag paint mounts of a world (renders nothing for a world without a paint block). */
export function PaintRigMounts({ theme, surfaces, night, groundHeight }: PaintRigMountsProps) {
  const paint = theme.paint;
  const sweep = paintFeature(paint, 'sweep');
  return (
    <>
      {sweep ? <PaintSweep scope={theme.id} /> : null}
      {sweep ? <PaintAudit /> : null}
      {paintFeature(paint, 'calmRects') && surfaces ? <CalmRects surfaces={surfaces} /> : null}
      {paintFeature(paint, 'contactBlobs') ? (
        <ContactBlobs keyDirection={theme.lights.keyDirection} night={night} groundHeight={groundHeight} />
      ) : null}
    </>
  );
}

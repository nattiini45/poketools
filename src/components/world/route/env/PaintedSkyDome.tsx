'use client';

/**
 * The shared painted sky dome (ROLLOUT §2.2 d): the dome-plus-uniform-writer
 * body extracted from the plaza `Atmosphere.tsx`, for any world whose theme
 * sets `paint.features.paintedSky` with its `paint.sky` preset.
 *
 * - The flag is real: the dome renders nothing (no material, no program)
 *   unless `paintFeature(paint, 'paintedSky')` is on AND the paint block
 *   carries a `sky` preset. The gate is a hook-free outer component, so a
 *   world without the flag mounts no hook, memo or effect of the dome.
 * - The material is created ONCE per mount from the preset
 *   (`createSkyMaterial(SKY_UNIFORMS, preset)`, `buildSkyFragment`): night,
 *   palette, post and the rung's cloud taps are uniform writes, so a theme
 *   toggle or a governor step never relinks it.
 * - `writeSkyUniforms(state, SKY_UNIFORMS, preset)` writes every field the
 *   preset owns on every change (no "initial value" reliance).
 * - The shipped `toneMapped: !night` is re-applied on a palette flip (read
 *   only on the post-off ACES path).
 * - Unmount hands `SKY_UNIFORMS` back at its defaults (the plaza preset's
 *   day colours), so the next world never inherits this one's sky.
 *
 * Fog is NOT here: each world keeps its own FogExp2 (the aerial term lives in
 * three's USE_FOG branch) and sets its own day fog to 0 when it adopts the
 * aerial term.
 */

import { useEffect, useLayoutEffect, useMemo } from 'react';
import type * as THREE from 'three';
import type { Vec3Tuple } from '@/lib/route-world/focus';
import { SKY_DOME_RADIUS } from '@/lib/route-world/skyline';
import { paintFeature, type RouteThemePaint } from '@/lib/route-world/theme-types';
import {
  createSkyMaterial,
  resetSkyUniforms,
  SKY_UNIFORMS,
  skyToneMapped,
  writeSkyUniforms,
  type PaintedSkyPreset,
} from './paint-fx';

/** The palette tokens the sky reads (sRGB hex). */
export interface SkyPalette {
  sky: string;
  skyHorizon: string;
  sunColor: string;
  moonColor: string;
}

export interface PaintedSkyDomeProps {
  /**
   * The world's paint block (`theme.paint`): the dome renders only when
   * `features.paintedSky` is on, and draws `paint.sky` as its preset.
   */
  paint: RouteThemePaint | null | undefined;
  palette: SkyPalette;
  night: boolean;
  /** Whether the rung carries post (the AgX composer). */
  post: boolean;
  /** Self-shadow taps (`quality.cloudTaps`). */
  cloudTaps: number;
  /** The theme's `lights.skyBodyPosition` (sun / moon). */
  skyBodyPosition: Vec3Tuple;
}

/** The shipped `toneMapped: !night` on the dome (read only on the post-off ACES path). */
function applySkyToneMapped(sky: THREE.ShaderMaterial, night: boolean): void {
  const mapped = skyToneMapped(night);
  if (sky.toneMapped === mapped) return;
  sky.toneMapped = mapped;
  sky.needsUpdate = true;
}

/**
 * The gate (ROLLOUT §2.2 a): no flag or no preset → nothing. Hook-free, so
 * the early return never changes a hook order.
 */
export default function PaintedSkyDome({ paint, ...props }: PaintedSkyDomeProps) {
  const preset = paint?.sky;
  if (!preset || !paintFeature(paint, 'paintedSky')) return null;
  return <SkyDome preset={preset} {...props} />;
}

interface SkyDomeProps extends Omit<PaintedSkyDomeProps, 'paint'> {
  preset: PaintedSkyPreset;
}

function SkyDome({ preset, palette, night, post, cloudTaps, skyBodyPosition }: SkyDomeProps) {
  // Created once per mount (and per preset) — never keyed on night, palette or post.
  const sky = useMemo(() => createSkyMaterial(SKY_UNIFORMS, preset), [preset]);

  // Value writes before the first frame and on every change.
  useLayoutEffect(() => {
    writeSkyUniforms(
      {
        night,
        sky: palette.sky,
        skyHorizon: palette.skyHorizon,
        sunColor: palette.sunColor,
        moonColor: palette.moonColor,
        skyBodyPosition,
        cloudTaps,
        post,
      },
      SKY_UNIFORMS,
      preset,
    );
  }, [night, palette.sky, palette.skyHorizon, palette.sunColor, palette.moonColor, skyBodyPosition, cloudTaps, post, preset]);

  // The shipped `toneMapped: !night` (read only on the post-off ACES path).
  useLayoutEffect(() => applySkyToneMapped(sky, night), [sky, night]);

  useEffect(
    () => () => {
      sky.dispose();
    },
    [sky],
  );

  // ROLLOUT §2.2 b: leaving the world hands the shared sky back at its defaults.
  useLayoutEffect(() => () => resetSkyUniforms(), []);

  return (
    <mesh renderOrder={-10} frustumCulled={false} material={sky}>
      <sphereGeometry args={[SKY_DOME_RADIUS, 48, 32]} />
    </mesh>
  );
}

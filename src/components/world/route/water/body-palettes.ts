/**
 * Per-body water colour builders — pure (no React, no three), so the unit
 * tests pin the SAME colours the adapters (`sakura/furniture/Lake.tsx`,
 * `mountain/furniture/AlpineValley.tsx` Tarn) hand to `BoundedWater`.
 *
 * Fidelity W3 r2: with post off (rungs 2–4) both bodies read as one flat
 * tint because body and reflected horizon shared a value range. Every
 * builder therefore finishes with `withHorizonContrast`, which lifts the
 * reflected horizon (day: toward white haze, night: toward the moon) until
 * it clears the body by `WATER_MIN_HORIZON_DELTA` linear luminance. The
 * horizon lift is a WATER-only reflection colour; the sky dome and fog keep
 * the palette's own `skyHorizon`.
 */

import { mixHex, scaleHex, withHorizonContrast, type WaterColors } from '@/lib/route-world/water';

/** The sakura palette roles the lake reads (a structural subset). */
export interface SakuraLakeRoles {
  lakeDeep: string;
  lakeShallow: string;
  blossomColorA: string;
  pathColor: string;
  sky: string;
  skyHorizon: string;
  moonColor: string;
}

/**
 * Sakura lake. r2: the bowl centre separates from the rim — deep and absorb
 * are ~17–18 % darker in value and the absorb hue leans toward jade, so the
 * near/mid lake shows a darker absorbing body against the lighter,
 * blossom-tinted shallows and the lifted horizon band on the far water.
 */
export function sakuraLakeColors(p: SakuraLakeRoles, night: boolean): WaterColors {
  const jade = night ? '#1b5a4b' : '#2f9c7e';
  const base: WaterColors = {
    deep: scaleHex(p.lakeDeep, 0.82),
    shallow: mixHex(p.lakeShallow, p.blossomColorA, 0.18),
    absorb: scaleHex(mixHex(mixHex(p.lakeDeep, p.lakeShallow, 0.5), jade, 0.22), 0.83),
    foam: night ? '#a3b2bb' : '#eef2f0',
    shore: p.pathColor,
    skyZenith: p.sky,
    skyHorizon: p.skyHorizon,
  };
  return withHorizonContrast(base, night ? p.moonColor : '#ffffff');
}

/** The mountain palette roles the tarn reads (a structural subset). */
export interface MountainTarnRoles {
  tarnDeep: string;
  tarnShallow: string;
  trailColor: string;
  rockColor: string;
  sky: string;
  skyHorizon: string;
  moonColor: string;
}

/**
 * Mountain tarn: glacial teal. r2: deep is 15 % darker in value so the
 * small bowl shows a depth ramp from the pale gravel shelf to its centre
 * instead of one flat light-blue band.
 */
export function mountainTarnColors(p: MountainTarnRoles, night: boolean): WaterColors {
  const base: WaterColors = {
    deep: scaleHex(p.tarnDeep, 0.85),
    shallow: p.tarnShallow,
    absorb: mixHex(p.tarnDeep, night ? '#1f5458' : '#46a9a3', 0.55),
    foam: night ? '#93a4ae' : '#e4ecef',
    shore: mixHex(p.trailColor, p.rockColor, 0.35),
    skyZenith: p.sky,
    skyHorizon: p.skyHorizon,
  };
  return withHorizonContrast(base, night ? p.moonColor : '#ffffff');
}

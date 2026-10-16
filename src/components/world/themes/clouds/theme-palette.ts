/**
 * Skyisle theme palette — the sky-island chain's scene-furniture colors.
 *
 * These roles are clouds art direction, not engine vocabulary: the cloud sea
 * and the high-altitude sky, sky-meadow islands and their rock/soil
 * undersides, the light-bridge glow, airship canvas and mooring timber, the
 * wind-streak and shard tints, the billboard field and the sun/moon
 * literals. They arrive through `cloudsTheme.paletteExtension` and are merged
 * over the generic core palette (`src/lib/route-world/palette.ts`) by the
 * `WorldStateProvider`; clouds scene code reads the merged object through
 * `useCloudsPalette()` (`./use-clouds-palette.ts`).
 *
 * Pure module — no hooks, no client-only imports; `theme.ts` and the unit
 * tests import it directly.
 */

import { luminance, type WorldPalette } from '@/lib/route-world/palette';

/** Furniture + sky roles the sky isles own on top of the core palette. */
export interface CloudsPaletteExt {
  /** Canvas clear / sky-dome zenith. Day is a high-altitude azure; night is luminous dusk indigo. */
  sky: string;
  /** Horizon haze and fog — cloud-bank milk by day, dusk band by night. */
  skyHorizon: string;
  /** Visible sun disc and Mie glow (light theme — thin-air high sun). */
  sunColor: string;
  /** Visible moon disc and rim glow (dark theme). */
  moonColor: string;
  /** Cloud sea's sunlit crest tone. */
  cloudTop: string;
  /** Cloud sea's shaded body tone. */
  cloudBase: string;
  /** Sky-meadow turf on an isle's top disc. */
  meadowColor: string;
  /** Isle rim rock — sun-worn limestone. */
  rockColor: string;
  /** Isle underside — the inverted soil cone's earth tone. */
  soilColor: string;
  /** Airship hull canvas (sails and envelope panels). */
  sailCanvas: string;
  /** Airship trim — painted band on the envelope. */
  sailTrim: string;
  /** Mooring timber (posts, dock planks, railings). */
  timberColor: string;
  /** Mooring spire / dock stone. */
  stoneColor: string;
  /** Light-bridge beam emission — the isles' condensed-light paths. */
  bridgeGlow: string;
  /** Bridge pier ring emission (a step quieter than the beam). */
  bridgeRing: string;
  /** Mooring lantern practical glow. */
  lanternGlow: string;
  /** Billboard field — the deep sky-slate painted ground. */
  boardField: string;
  /** Billboard accent — sun-gold. */
  boardAccent: string;
  /** Wind-streak particle tint. */
  windStreak: string;
  /** Floating sky-shard crystal. */
  shardColor: string;
}

/** Core palette as the clouds scene sees it. */
export type CloudsWorldPalette = WorldPalette & CloudsPaletteExt;

/**
 * Clouds furniture literals. Branches on the ground token's luminance
 * (> 0.35 = day), the same frozen branch the plaza/sakura/mountain
 * extensions use so all themes key day/night off the same visible signal.
 */
export function cloudsPaletteExtension(core: WorldPalette, _night: boolean): CloudsPaletteExt {
  const day = luminance(core.ground) > 0.35;
  return {
    // High-altitude day: a deeper azure than the valley's (thin air), held
    // off pure blue so AgX's lift keeps it sky rather than cobalt.
    sky: day ? '#4f97d2' : '#0b1230',
    // Horizon is the cloud bank the sea dissolves into.
    skyHorizon: day ? '#e3ebe8' : '#2a3654',
    sunColor: '#fff3d0',
    moonColor: '#f4f2ff',
    // The sea reads white-gold where the sun strikes, blue-slate in its body.
    cloudTop: day ? '#fdfdfb' : '#aebdd8',
    cloudBase: day ? '#b7c8d8' : '#2c3a58',
    meadowColor: day ? '#7cb465' : '#3d5a49',
    rockColor: day ? '#9a917f' : '#565264',
    soilColor: day ? '#7c5f47' : '#453530',
    sailCanvas: day ? '#f1e9d6' : '#42536e',
    sailTrim: day ? '#c96f1e' : '#f2a95c',
    timberColor: day ? '#7d6248' : '#4c3d3a',
    stoneColor: day ? '#a49c8c' : '#5f5c68',
    // Condensed-light paths: pale sky-cyan that stays luminous at dusk.
    bridgeGlow: day ? '#8fd8e8' : '#aeeaff',
    bridgeRing: day ? '#bceaf2' : '#d6f2ff',
    lanternGlow: day ? '#ffd27a' : '#ffc478',
    boardField: day ? '#1d3040' : '#152636',
    boardAccent: day ? '#e8922e' : '#f5b45e',
    windStreak: day ? '#eaf6ff' : '#cfe4ff',
    shardColor: day ? '#a8d8f0' : '#7ea6cc',
  };
}

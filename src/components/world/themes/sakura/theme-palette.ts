/**
 * Sakura Park theme palette — the lakeside scene-furniture colors.
 *
 * These roles are sakura art direction, not engine vocabulary: the lake's
 * water body, torii vermilion, lantern stone and glow, banner cloth, the
 * jumbotron rock's LED field and the sky/horizon/sun/moon literals. They
 * arrive through `sakuraTheme.paletteExtension` and are merged over the
 * generic core palette (`src/lib/route-world/palette.ts`) by the
 * `WorldStateProvider`; sakura scene code reads the merged object through
 * `useSakuraPalette()` (`./use-sakura-palette.ts`).
 *
 * Pure module — no hooks, no client-only imports; `theme.ts` and the unit
 * tests import it directly.
 */

import { luminance, type WorldPalette } from '@/lib/route-world/palette';

/** Furniture + sky roles the sakura park owns on top of the core palette. */
export interface SakuraPaletteExt {
  /** Canvas clear / sky-dome zenith. Day is a spring blue; night is deep plum. */
  sky: string;
  /** Horizon haze and fog — blossom-tinted aerial perspective over the lake. */
  skyHorizon: string;
  /** Visible sun disc and Mie glow (light theme — soft morning sun). */
  sunColor: string;
  /** Visible moon disc and Mie glow (dark theme). */
  moonColor: string;
  /** Torii gate and bridge rail vermilion — cinnabar, one step hotter at night. */
  toriiRed: string;
  /** Weathered granite of the lanterns and the jumbotron rock. */
  lanternStone: string;
  /** Lantern light-box emission — paper-warm; the park's practical at night. */
  lanternGlow: string;
  /** Bridge deck planking — aged cedar. */
  bridgeWood: string;
  /** Festival banner cloth — unbleached cotton, front-lit by day. */
  bannerCloth: string;
  /** Banner ink for painted fixtures and headings. */
  bannerInk: string;
  /** Jumbotron rock LED field — dusk teal that survives daylight wrap. */
  boardField: string;
  /** LED phosphor on the rock's standings page (blossom-rose accent). */
  boardAccent: string;
  /** Deep water body of the lake, away from the shore. */
  lakeDeep: string;
  /** Shallow shore water, where the sand shelf reads through. */
  lakeShallow: string;
  /** Petal fall — the particle field's shared tint. */
  petalColor: string;
  /** Park lawn pigment (the ground disc is grass, not stone). */
  lawnColor: string;
  /** Sand path / shore band pigment. */
  pathColor: string;
  /** Cherry bark (instanced trunks). */
  barkColor: string;
  /** Blossom canopy — two tones, mixed per instance for depth. */
  blossomColorA: string;
  /** Blossom canopy, the deeper tone. */
  blossomColorB: string;
}

/** Core palette as the sakura scene sees it. */
export type SakuraWorldPalette = WorldPalette & SakuraPaletteExt;

/**
 * Sakura furniture literals. Branches on the ground token's luminance
 * (> 0.35 = day), the same frozen branch the plaza extension uses so both
 * themes key day/night off the same visible signal; the `night` parameter
 * stays part of the theme contract for themes that want the exposure
 * switch instead.
 */
export function sakuraPaletteExtension(core: WorldPalette, _night: boolean): SakuraPaletteExt {
  const day = luminance(core.ground) > 0.35;
  return {
    sky: day ? '#8ec8e8' : '#150e2e',
    skyHorizon: day ? '#f6dfda' : '#33233f',
    sunColor: '#fff3d2',
    moonColor: '#fdf6ff',
    toriiRed: day ? '#c0392b' : '#e04b38',
    lanternStone: day ? '#9a938c' : '#6f6963',
    lanternGlow: day ? '#ffd9a8' : '#ffc27a',
    bridgeWood: day ? '#8a6a4f' : '#5d4634',
    bannerCloth: day ? '#f6ede2' : '#cbb9ad',
    bannerInk: day ? '#4a2c34' : '#2e1a20',
    boardField: day ? '#134b52' : '#0c3840',
    boardAccent: day ? '#f472b6' : '#f9a8d4',
    lakeDeep: day ? '#2c6f79' : '#12333f',
    lakeShallow: day ? '#79b8b5' : '#3d656f',
    petalColor: day ? '#f6b8ce' : '#e8a0bc',
    lawnColor: day ? '#7da86b' : '#3c5a42',
    pathColor: day ? '#cdb694' : '#7d6f57',
    barkColor: day ? '#5d4a42' : '#3d312c',
    blossomColorA: day ? '#f6c3d5' : '#b07893',
    blossomColorB: day ? '#ec9db9' : '#8f5f7a',
  };
}

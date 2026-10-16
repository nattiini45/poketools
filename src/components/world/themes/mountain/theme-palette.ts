/**
 * Mountain Pass theme palette — the alpine valley's scene-furniture colors.
 *
 * These roles are mountain art direction, not engine vocabulary: granite and
 * snow, meadow and trail gravel, lodge timber, storm-lantern glow, the
 * summit board's slate field, the tarn's meltwater and the sky/horizon/sun/
 * moon literals. They arrive through `mountainTheme.paletteExtension` and
 * are merged over the generic core palette (`src/lib/route-world/palette.ts`)
 * by the `WorldStateProvider`; mountain scene code reads the merged object
 * through `useMountainPalette()` (`./use-mountain-palette.ts`).
 *
 * Pure module — no hooks, no client-only imports; `theme.ts` and the unit
 * tests import it directly.
 */

import { luminance, type WorldPalette } from '@/lib/route-world/palette';

/** Furniture + sky roles the mountain valley owns on top of the core palette. */
export interface MountainPaletteExt {
  /** Canvas clear / sky-dome zenith. Day is a crisp alpine blue; night is deep starfield indigo. */
  sky: string;
  /** Horizon haze and fog — valley milk by day, cold indigo by night. */
  skyHorizon: string;
  /** Visible sun disc and Mie glow (light theme — high thin-air sun). */
  sunColor: string;
  /** Visible moon disc and rim glow (dark theme). */
  moonColor: string;
  /** Sunlit granite of the crag, terraces and gate pillars. */
  rockColor: string;
  /** Shadowed cliff faces — a step darker and cooler than the granite. */
  cliffColor: string;
  /** Snow cap and patch pigment — never pure white, a cold blue-tinged snow. */
  snowColor: string;
  /** Valley meadow pigment (the ground disc is alpine grass, not stone). */
  meadowColor: string;
  /** Trail gravel / scree sand pigment (the switchback ring). */
  trailColor: string;
  /** Lodge and gate timber — aged larch. */
  timberColor: string;
  /** Pine foliage (instanced canopy tiers), two tones mixed per instance. */
  pineColorA: string;
  /** Pine foliage, the deeper tone. */
  pineColorB: string;
  /** Pine trunk bark. */
  barkColor: string;
  /** Storm-lantern light-box emission — the valley's practical at night. */
  lanternGlow: string;
  /** Lantern and gate-post stone (weathered, lighter than the crag granite). */
  lanternStone: string;
  /** Summit board slate field — the painted standings ground. */
  boardField: string;
  /** Summit board accent — trail-sign rust. */
  boardAccent: string;
  /** Deep water body of the tarn, away from the shore. */
  tarnDeep: string;
  /** Shallow meltwater at the tarn's gravel shore. */
  tarnShallow: string;
  /** Snowfall — the particle field's shared tint. */
  snowfallColor: string;
}

/** Core palette as the mountain scene sees it. */
export type MountainWorldPalette = WorldPalette & MountainPaletteExt;

/**
 * Mountain furniture literals. Branches on the ground token's luminance
 * (> 0.35 = day), the same frozen branch the plaza and sakura extensions use
 * so all themes key day/night off the same visible signal; the `night`
 * parameter stays part of the theme contract for themes that want the
 * exposure switch instead.
 */
export function mountainPaletteExtension(core: WorldPalette, _night: boolean): MountainPaletteExt {
  const day = luminance(core.ground) > 0.35;
  return {
    sky: day ? '#79b7e4' : '#0a0f26',
    // Day horizon held a step off pure white so the haze keeps a green-grey
    // valley tone (the first authoring read washed out in stills).
    skyHorizon: day ? '#e2e9e4' : '#243250',
    sunColor: '#fff2cc',
    moonColor: '#f6f4ff',
    rockColor: day ? '#8a8478' : '#4e4a52',
    cliffColor: day ? '#6b675c' : '#38353e',
    snowColor: day ? '#f2f6fa' : '#c3d2e8',
    meadowColor: day ? '#749b5c' : '#39543f',
    trailColor: day ? '#c9b28d' : '#71634d',
    timberColor: day ? '#7a5c42' : '#4e3b2c',
    pineColorA: day ? '#3c6b4a' : '#28463a',
    pineColorB: day ? '#2d5540' : '#1f3830',
    barkColor: day ? '#5d4a3c' : '#3c312a',
    lanternGlow: day ? '#ffd9a0' : '#ffc478',
    lanternStone: day ? '#9a948a' : '#67625e',
    boardField: day ? '#22303a' : '#18242e',
    boardAccent: day ? '#e8862e' : '#f0a452',
    tarnDeep: day ? '#3a707c' : '#15323e',
    tarnShallow: day ? '#8fbfb4' : '#3a5f66',
    snowfallColor: day ? '#f4f8fc' : '#e6edf8',
  };
}

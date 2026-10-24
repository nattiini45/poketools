/**
 * Plaza theme palette — the EvoLiga scene-furniture colors.
 *
 * These roles are plaza art direction, not engine vocabulary: jumbotron
 * phosphors, kiosk housing, interior spill, the pictorial LED advert field
 * and the sky/horizon/sun/moon literals. They arrive through
 * `plazaTheme.paletteExtension` and are merged over the generic core palette
 * (`src/lib/route-world/palette.ts`) by the `WorldStateProvider`; plaza scene
 * code reads the merged object through `usePlazaPalette()`
 * (`./use-plaza-palette.ts`).
 *
 * Pure module — no hooks, no client-only imports; `theme.ts` and the unit
 * tests import it directly.
 */

import { luminance, parseColor, type WorldPalette } from '@/lib/route-world/palette';
import type { CanopyLook, PaintFeatures, PaintLightSet, PaintRoleTable, RouteThemePaint } from '@/lib/route-world/theme-types';

/**
 * Painterly role responses (LOOK-PLAN §1.2), identical in both palettes:
 * environment stone, figures (stronger rim, firmer band) and frames — the
 * bezels, cabinets and trusses around data faces, which take the band and
 * the cool shadow but never a rim.
 */
const PLAZA_PAINT_ROLES: PaintRoleTable = {
  // LOOK r5: the rim is brighter and tighter (figures), so stone takes half.
  env: { k: 1, rimScale: 0.5, bandMix: 0.55 },
  figure: { k: 1, rimScale: 1.8, bandMix: 0.7 },
  frame: { k: 1, rimScale: 0, bandMix: 0.3, sat: 0 },
  // LOOK r2: a canopy is a soft mass of cards with radial normals — the env
  // fresnel rim lit every crown edge and washed the trees pale (the r1
  // "cream blossom" canopy). A faint rim only; the leaf translucency carries
  // the contre-jour glow.
  foliage: { k: 1, rimScale: 0.2, bandMix: 0.45 },
};

/**
 * LOOK r6 (L6.3, night: "the canopies go muddy grey-blue"): at night the
 * foliage takes a larger share of the painted chroma (≈ 1.25× instead of
 * 1.15×), so the deep teal-green crowns read green, not slate. Every other
 * role is the day's.
 */
const PLAZA_PAINT_ROLES_NIGHT: PaintRoleTable = {
  ...PLAZA_PAINT_ROLES,
  // The wide moon rim (pow 2.6) on the crowns' radial normals turned every
  // canopy a pale blue-white ghost (r6 capture i4): foliage takes almost none.
  foliage: { ...PLAZA_PAINT_ROLES.foliage, rimScale: 0.03, sat: 1.65 },
};

/**
 * Golden-hour light set (LOOK-PLAN §1.2, "Day").
 *
 * LOOK r5 (lead: "kill the global haze; shade is not a lilac overlay"): the
 * warm key carries the frame and the ambient steps back — cast shade takes
 * the cool sky-blue dapple (the r4 teams frame), form shade stays the local
 * albedo darker with a slight cool shift (`shadow.form`, `shadeSat`), the
 * IBL is near-neutral and aerial perspective starts beyond 30 m.
 */
const PLAZA_PAINT_DAY: PaintLightSet = {
  key: { color: '#ffd688', intensity: 6.2 },
  hemisphere: { sky: '#aebfe6', ground: '#c8a47e', intensity: 0.26, keyGain: 0.08 },
  band: { wrap: 0.35, lo: -0.05, hi: 0.3 },
  // LOOK r6 (L2, "no cool raking shadows"): the cool fill × honey albedo was
  // grey — cast shade now also turns toward a cool sky-blue HUE at matched
  // luma, on the direct fill AND the sky light into it. (#8f9fd6 at 0.45
  // landed MAUVE, h ≈ 330°, on the red-leaning setts — blue + orange mixes to
  // violet — so the target leans cyan to keep G above R: h ≈ 215–240°.)
  shadow: {
    tint: '#b2bee0',
    lift: 0.2,
    form: { tint: '#bcc8d2', lift: 0.22 },
    hue: { color: '#78b0d8', strength: 0.45 },
  },
  shadeSat: 0.4,
  terminator: { color: '#ff9a5c', strength: 0.16 },
  rim: { color: '#ffe6b0', strength: 0.8 },
  rimPower: 4.5,
  roles: PLAZA_PAINT_ROLES,
  // LOOK r6 (L5, depth: "nothing recedes"): chroma-only recession from 18 m
  // (≈ 14 % pull at 50 m) toward a cooler air; the value lift is unchanged
  // (the C-044 / r4 haze history) and still starts beyond 32 m.
  air: { start: 18, density: 0.035, hue: '#b4c4dc', chroma: 0.2, lift: 0.07, liftStart: 32, sun: '#ffc98a' },
  ibl: { tint: '#b0bcd8', strength: 1, environment: 0.45 },
  saturation: 1.12,
  // LOOK r4: the sunlit setts' warm light returned into the shade of walls and soffits.
  bounce: { color: '#ffb877', strength: 0.07 },
};

/**
 * Rainy-night light set (LOOK-PLAN §1.2, "Night"): the moon key keeps its
 * intensity and the hemisphere its historical 0.22 fill; no terminator, no
 * value lift (chroma-only air).
 */
const PLAZA_PAINT_NIGHT: PaintLightSet = {
  // LOOK r5 (lead: "never gloomier"): a touch more moon and sky fill.
  key: { color: '#a8b8f0', intensity: 1.1 },
  // LOOK r6 (L6.4): a bluer sky fill (teal-blue night, not slate).
  hemisphere: { sky: '#2a4470', ground: '#4a3424', intensity: 0.18, keyGain: 0.06 },
  band: { wrap: 0.35, lo: -0.05, hi: 0.3 },
  shadow: { tint: '#2b3570', lift: 0.06 },
  terminator: { color: '#ff9a5c', strength: 0 },
  // LOOK r6 (L6.1, night: "no clear moon rim on figures or façades"): a cool
  // moon rim, wider (fresnel pow 2.6) so it reads at 390, and a moon catch on
  // the up-facing ledges (cornices, sills, zinc, heads).
  rim: { color: '#9fb0ff', strength: 0.6 },
  rimPower: 2.6,
  moonCatch: { color: '#9fb0ff', strength: 0.18 },
  // LOOK r6 (L6.4): the board-first ceiling — the painted diffuse soft-knees
  // below the boards' P50 (linear), before emissive and reflections join.
  lumaCeil: 0.9,
  roles: PLAZA_PAINT_ROLES_NIGHT,
  // LOOK r6 (L6.4): a teal-blue night air (was #3b5a8a at 0.3), chroma only.
  air: { start: 8, density: 0.022, hue: '#2f5f86', chroma: 0.45, lift: 0, liftStart: 25, sun: '#ffd7a0' },
  // LOOK r3: a dark diffuse shade, but the full scene reflection — the wet
  // setts glint with the night sky and the lamp pools, as they shipped.
  ibl: { tint: '#8a98d8', strength: 1, environment: 0.3, specular: 0.15 },
  saturation: 1.15,
  // LOOK r4: lamp pools read warm on setts, stone and leaves (painted materials only).
  pointWarm: { color: '#ffc890', strength: 2.2 },
};

/**
 * The plaza's painterly light model (D19). Consumed only by the plaza light
 * rig through `plazaTheme.paint`; the station-fitted shadow is one constant
 * 1024 map over a 32 × 32 m light-space box (3.1 cm/texel) at every rung.
 */
export const PLAZA_PAINT: RouteThemePaint = {
  day: PLAZA_PAINT_DAY,
  night: PLAZA_PAINT_NIGHT,
  shadow: { mapSize: 1024, box: 32, radius: 3, bias: -0.0005, normalBias: 0.03 },
};

/** ROLLOUT §2.2 (a): the plaza opts into every skin flag (the pilot's full painted skin). */
export const PLAZA_PAINT_FEATURES: PaintFeatures = {
  sweep: true,
  calmRects: true,
  contactBlobs: true,
  stationShadow: true,
  paintedSky: true,
  skyline: true,
  lampHalos: true,
  sunShafts: true,
  paintedCanopy: true,
};

/**
 * ROLLOUT §2.2 (h): the plaza canopy light — today's literals, moved and not
 * changed: translucency `LEAF_SSS_LEVELS` (1.5 day / 0.05 night), the LOOK r6
 * contre-jour silhouette by day (L4b) and the warm lamp under-light at night
 * (L6.3). The silhouette applies at every station.
 */
export const PLAZA_CANOPY_LOOK: CanopyLook = {
  sss: { day: 1.5, night: 0.05 },
  sil: { day: 1, night: 0 },
  lamp: { day: 0, night: 0.5 },
};

/** ROLLOUT §2.2 (k): the plaza's vignette darkness (LOOK-PLAN §2 G4; every other world keeps 0.46). */
export const PLAZA_VIGNETTE_DARKNESS = 0.3;

/** The five Haussmann blocks of the plaza perimeter (`plazaBlockPlans` ids). */
export type PlazaBlockId = 'north' | 'west' | 'east' | 'south-west' | 'south-east';

/** One block's stone pair: the main stone slot and the reveal / cheek (shade) slot. */
export interface PlazaBlockTint {
  stone: string;
  shade: string;
}

/**
 * LOOK r6 (L1, LOOK r5: "the plaza reads as one monotone honey material"):
 * a hand-picked limestone swatch per building, the Townscaper indexed-palette
 * idea as a per-block colour uniform (each block already owns its slot
 * materials, so this is a uniform write — 0 programs, 0 bytes).
 *
 * - north: ivory, a touch desaturated (the far backdrop of both boards);
 * - west: cool grey limestone (behind the roster kiosk, which reads warm red);
 * - east: honey (the teams wall: warm stone under blue dapple, the r4 target);
 * - south-west: cream; south-east: a warmer grey limestone — the rules pair
 *   reads as two buildings, cream on one side of the gate, grey on the other.
 *
 * Shade is each swatch ≈ 13 % darker and ≈ 3 % cooler. Night is ≈ 0.62× the
 * value, the grey blocks nudged blue (moonlit limestone). Every day swatch
 * stays within −4 % .. +6 % relative luminance of the r5 stone (`#e4dbb6`):
 * each block backs a data face somewhere (north the boards, west the kiosk,
 * east the crest wall, south the gate), and per-block tints are NOT gated by
 * the calm boxes, so the value may not fall more than 4 % behind any face.
 */
export const PLAZA_BLOCK_TINTS: Readonly<Record<PlazaBlockId, { day: PlazaBlockTint; night: PlazaBlockTint }>> = {
  north: { day: { stone: '#e6dcbc', shade: '#c6c1aa' }, night: { stone: '#908882', shade: '#6e6c6b' } },
  west: { day: { stone: '#dfdcd0', shade: '#c0c1bc' }, night: { stone: '#868a96', shade: '#686c7a' } },
  east: { day: { stone: '#ecd9a8', shade: '#cbbe98' }, night: { stone: '#948774', shade: '#716a60' } },
  'south-west': { day: { stone: '#eddfc3', shade: '#ccc3b0' }, night: { stone: '#948a87', shade: '#716d6f' } },
  'south-east': { day: { stone: '#dcdccf', shade: '#bdc0ba' }, night: { stone: '#84898f', shade: '#666b75' } },
};

/** The r5 stone pair every block wore (the fallback for an unknown block id, and the −4 % reference). */
export const PLAZA_STONE_TINT_R5 = {
  day: { stone: '#e4dbb6', shade: '#c8bd9c' },
  night: { stone: '#8f887e', shade: '#6f6a62' },
} as const;

/** A block's stone pair for a palette (unknown ids keep the r5 pair). */
export function plazaBlockTint(id: string, night: boolean): PlazaBlockTint {
  const entry = (PLAZA_BLOCK_TINTS as Record<string, { day: PlazaBlockTint; night: PlazaBlockTint } | undefined>)[id];
  const time = night ? 'night' : 'day';
  return entry ? entry[time] : PLAZA_STONE_TINT_R5[time];
}

/** Furniture + sky roles the plaza owns on top of the core palette. */
export interface PlazaPaletteExt {
  /** Canvas clear / sky-dome zenith. Day is Lumiose blue; night is living indigo. */
  sky: string;
  /** Horizon haze and fog — aerial perspective behind the tower. */
  skyHorizon: string;
  /** Visible sun disc and Mie glow (light theme). */
  sunColor: string;
  /** Visible moon disc and Mie glow (dark theme). */
  moonColor: string;
  /** Pokémon Center signage red — franchise-true, not the arena accent. */
  centerRed: string;
  /** Black kiosk housing — charcoal, a step cooler at night. */
  deskKiosk: string;
  /** Warm interior spill from Center ceiling cans. */
  deskWarm: string;
  /** Interior brick pigment behind the desk. */
  deskBrick: string;
  /** Desk-owned wet apron — dark slate, not plaza cream stone. */
  deskApron: string;
  /** Desk KADER phosphor — teal that survives wrap-red wash in sun. */
  deskRosterLive: string;
  /** Desk LINIEN phosphor — amber/brown rows, distinct from KADER. */
  deskRosterAccent: string;
  /** PULS jumbotron phosphor — sky cyan in sun, teal under moonlight. */
  boardPulse: string;
  /** SPIELPLAN jumbotron phosphor — amber, a step hotter at night. */
  boardSchedule: string;
  /**
   * Pictorial LED advert (east + south-west façades). The painted type-colour
   * field is static from here — the silhouetted Pokémon's primary type would
   * need a server-side `@pkmn/data` hop that the client-side texture paint
   * cannot make, so the palette owns the identity instead.
   */
  pictorialLedField: string;
  /** Warm end of the advert's gradient field (ember / arena accent family). */
  pictorialLedEmber: string;
  /** Ticker band + league-mark accent on the advert. */
  pictorialLedTicker: string;
}

/** Core palette as the plaza scene sees it. */
export type PlazaWorldPalette = WorldPalette & PlazaPaletteExt;

/**
 * Plaza furniture literals.
 *
 * Branches on the ground token's luminance (> 0.35 = day), NOT on the
 * engine's `night` exposure switch — byte-identical to the pre-theme
 * `withIlluminants` branch the plaza shipped with (the two thresholds only
 * diverge in a luminance band no EvoLiga theme reaches; frozen for A/B
 * parity). The `night` parameter stays part of the contract for future
 * themes that want the exposure switch instead.
 */
export function plazaPaletteExtension(core: WorldPalette, _night: boolean): PlazaPaletteExt {
  const day = luminance(core.ground) > 0.35;
  return {
    sky: day ? '#6eb4e0' : '#070433',
    skyHorizon: day ? '#efe2c8' : '#1c3a58',
    sunColor: '#fff1c4',
    moonColor: '#fff4ee',
    centerRed: day ? '#e23b3b' : '#ff2a3a',
    deskKiosk: day ? '#161418' : '#0a090c',
    deskWarm: day ? '#ffc27a' : '#ffb060',
    deskBrick: day ? '#8a4538' : '#623028',
    deskApron: day ? '#6a7584' : '#546070',
    deskRosterLive: day ? '#2ee6a4' : '#4ADE80',
    deskRosterAccent: day ? '#f0a040' : '#F5B84B',
    boardPulse: day ? '#38bdf8' : '#5eead4',
    boardSchedule: day ? '#f59e0b' : '#fbbf24',
    pictorialLedField: day ? '#123a5e' : '#0d2c4a',
    pictorialLedEmber: day ? '#e8862e' : '#f0983c',
    pictorialLedTicker: day ? '#d8443e' : '#ff5a4e',
  };
}

/** Plaza cobble pigment — dry worn sett vs wet film, from ground + exposure. */
export interface CobblePigment {
  stone: [number, number, number];
  grout: [number, number, number];
  /** 0 dry … 1 water film. Derived from exposure, never a metalness slider. */
  wetness: number;
}

function u8Channel(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/**
 * Causal cobble colors. Night wetness darkens and cools the sett so a water
 * film can pick up practicals; it does not turn the floor into metal.
 */
export function cobblePigment(palette: WorldPalette): CobblePigment {
  const wetness = Math.max(0, Math.min(1, (0.72 - palette.exposure) / 0.35));
  const ground = parseColor(palette.ground);
  const [r, g, b] = ground ?? [0.91, 0.85, 0.71];

  if (wetness > 0.35) {
    const k = 0.55 + wetness * 0.08;
    return {
      stone: [
        u8Channel(r * 255 * k + 82),
        u8Channel(g * 255 * k + 86),
        u8Channel(b * 255 * k + 96),
      ],
      grout: [
        u8Channel(r * 255 * k * 0.42 + 34),
        u8Channel(g * 255 * k * 0.42 + 36),
        u8Channel(b * 255 * k * 0.42 + 40),
      ],
      wetness,
    };
  }

  return {
    stone: [
      u8Channel(r * 255 * 0.7 + 40),
      u8Channel(g * 255 * 0.66 + 36),
      u8Channel(b * 255 * 0.56 + 30),
    ],
    grout: [
      u8Channel(r * 255 * 0.46 + 26),
      u8Channel(g * 255 * 0.42 + 22),
      u8Channel(b * 255 * 0.36 + 18),
    ],
    wetness,
  };
}

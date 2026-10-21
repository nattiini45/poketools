/**
 * Route-world theme contract.
 *
 * The 3D route engine (`src/components/world/route/*` + the generic parts of
 * `src/lib/route-world/*`) is theme-agnostic: everything a specific world
 * owns — its stations, camera endpoints, scroll holds, furniture palette,
 * light rig geometry, prop families, texture/HDRI tuning and focus
 * vocabulary — arrives through a `RouteThemeDefinition`. A new 3D theme is a
 * new definition plus scene components; no engine edit.
 *
 * Pure types — no client-only imports, safe on both sides of the RSC
 * boundary (the theme OBJECT itself only ever crosses via client modules;
 * server components pass the theme `id` and the client registry resolves it).
 */

import type { RouteStation } from './chapters';
import type { Vec3Tuple } from './focus';
import type { WorldPalette } from './palette';
import type { HdriFormat, HdriRole } from './world-env';

/**
 * The one fact a Station Card shows at 390 (fidelity wave 2, D15). Each kind
 * names a pure selector in `station-digest.ts` over the SAME page-loaded
 * rows the station's board paints — the card never states a fact the world
 * does not show. `teamChips` is the Teams roll-call rail (a chip per
 * trainer, standings order) instead of a sentence.
 */
export type StationDigestKind =
  | 'standingsTop'
  | 'liveMatch'
  | 'nextKickoff'
  | 'rosterCount'
  | 'rulesHeadline'
  | 'teamChips';

/**
 * The card's single call to action: a real link to a docked panel the
 * world's OverlaySwitch maps already answer (`?board=pulse`, `?board=roster`,
 * `?rules=gate`, …) — FocusUrlSync turns it into a focus, so the CTA and a
 * tap on the board open the same panel.
 */
export interface StationCardCta {
  /** A search param from the theme's `focusVocabulary.panelParams`. */
  param: string;
  value: string;
}

/**
 * A resolved CTA: the target plus its label. Labels are never authored per
 * theme — `resolveStationCta` (station-digest.ts) derives them from ONE
 * table keyed by what the link opens, in the viewer's locale (wave-2 r3: the
 * isles' roster CTA read "Open the table" and Teams opened the standings).
 */
export interface ResolvedStationCta extends StationCardCta {
  label: string;
}

/** Station Card copy for one station (the kicker title, CTA and digest kind). */
export interface StationCardCopy {
  /** Short station name for the kicker `n/5 · TITLE` (the nav label). */
  title: string;
  /**
   * The fallback target. Teams (`teamChips`) resolves to the rank-1 team's
   * panel when trainers exist; every label comes from the shared table.
   */
  cta: StationCardCta;
  /** Which single fact the 390 card shows; absent → no digest line. */
  digest?: StationDigestKind;
}

/**
 * A theme station: the engine's `RouteStation` plus the Station Card copy.
 * `card` is optional so engine probes (route-preview) and hand-built test
 * ledgers stay valid; a station without it simply gets no card.
 */
export type RouteThemeStation = RouteStation & { card?: StationCardCopy };

/**
 * Everything a route theme supplies to the engine.
 *
 * `PaletteExt` is the theme's own scene-furniture palette: the engine merges
 * the object returned by `paletteExtension` into the token-derived core
 * palette (extension keys win) and hands the result to the scene as
 * `WorldPalette`. Theme code recovers the concrete type via its own typed
 * helper (plaza: `usePlazaPalette()`); engine code only ever reads the core.
 */
export interface RouteThemeDefinition<PaletteExt = unknown> {
  /** Stable theme id — `SeasonWorld.routeThemeId` and the registry key. */
  id: string;
  /**
   * Stations in scroll order; ids MUST match the world's section manifest.
   * Each may carry its Station Card copy (`card`, wave 2).
   */
  stations: readonly RouteThemeStation[];
  /**
   * Station ids pinned at their integer endpoint while start-aligned
   * (capture stills use `scrollIntoView({block:'start'})` — PB-013).
   */
  holdIds: readonly string[];
  /**
   * Theme furniture colors for the current light. `tokens` is the resolved
   * core palette (token colors + illuminants); `night` mirrors the engine's
   * `isNight(exposure)` switch. The returned object is merged over the core,
   * so an extension may also override core keys (plaza re-states the sky
   * literals to keep one authored source for them).
   */
  paletteExtension: (core: WorldPalette, night: boolean) => PaletteExt;
  /** Key-light rig geometry (unit direction + metre placements). */
  lights: {
    keyDirection: Vec3Tuple;
    keyPosition: Vec3Tuple;
    skyBodyPosition: Vec3Tuple;
  };
  /** Named prop families the static batcher must never merge (C-089). */
  propFamilyPrefixes: readonly string[];
  /** PBR texture-set roles the theme's asset pipeline provides. */
  textureRoles: readonly string[];
  /** Per-HDRI yaw so the env sun/moon agrees with the authored sky body. */
  hdriYaw: Record<HdriRole, number>;
  /**
   * Per-HDRI image-based-lighting intensity (LOOK-PLAN §1.2). The `gold`
   * value is multiplied by the palette exposure, `night` is used as is.
   * Optional: a theme without it keeps the engine's historical 0.72 / 0.55,
   * so declaring it on one theme is pixel-neutral for every other world.
   */
  environmentIntensity?: Record<HdriRole, number>;
  /**
   * HDRI encoding the theme loads (LOOK-PLAN §5.1): `'gainmap'` = the
   * UltraHDR `.jpg` pair, falling back to the `.hdr` when the manifest does
   * not ship it. Optional: a theme without it loads the `.hdr` URL it always
   * did (string-identical), so declaring it on one theme is pixel-neutral
   * for every other world.
   */
  hdriFormat?: HdriFormat;
  /**
   * The painterly light model's art direction (LOOK-PLAN §1.2, D19), per
   * palette, plus the skin flags a world opts into (ROLLOUT §2.2:
   * `paint.features`). Optional: a world without it mounts no paint skin and
   * every shared module keeps its unpainted path. Read by the shared rig
   * (`route/paint/PaintRig.tsx`) that a world's own light rig calls.
   */
  paint?: RouteThemePaint;
  /** Focus subject kinds and docked-panel search params the theme uses. */
  focusVocabulary: {
    kinds: readonly string[];
    panelParams: readonly string[];
  };
}

/** The four roles every painted light set declares. */
export type PaintCoreRoleName = 'env' | 'figure' | 'frame' | 'foliage';

/**
 * Material roles of the painterly light model (`userData.paintRole`).
 * ROLLOUT §2.2 (a): `snow` is optional per light set (mountain: no rim, no
 * warm terminator on snow); a set without it resolves `snow` to `env`. Roles
 * are uniform values, never program keys, so a role adds 0 programs.
 */
export type PaintRoleName = PaintCoreRoleName | 'snow';

/** A light set's role table: the four core roles, plus an optional `snow`. */
export type PaintRoleTable = Record<PaintCoreRoleName, PaintRole> & Partial<Record<'snow', PaintRole>>;

/**
 * One role's light response: `k` blends physical (0) → painted (1),
 * `rimScale` scales the rim term, `bandMix` blends wrapped diffuse (0) →
 * the soft value band (1). Uniform values, never program keys.
 */
export interface PaintRole {
  k: number;
  rimScale: number;
  bandMix: number;
  /**
   * Share of the light set's painted `saturation` this role takes (LOOK r2):
   * 1 for stone, foliage and figures; 0 for frames around data faces, which
   * keep their authored colour. Optional (1).
   */
  sat?: number;
}

/** A colour plus a scalar strength (hex colour, linear-light strength). */
export interface PaintTint {
  color: string;
  strength: number;
}

/** The light set of one palette (LOOK-PLAN §1.2 columns). */
export interface PaintLightSet {
  /** Directional key colour and base intensity (× station key × exposure). */
  key: { color: string; intensity: number };
  /** Hemisphere fill: intensity is `(intensity + keyGain · world.key) × exposure`. */
  hemisphere: { sky: string; ground: string; intensity: number; keyGain: number };
  /** Wrapped diffuse `wrap`, and the soft value band's `lo`/`hi` edges over N·L. */
  band: { wrap: number; lo: number; hi: number };
  /**
   * Cool shadow fill (the P3 shadow floor): hue, and the share of key
   * luminance. LOOK r5: `tint`/`lift` are the CAST-shade fill (a sun-facing
   * surface under a caster — the sky-blue dapple); `form` is the FORM-shade
   * fill (surfaces facing away from the key), near-neutral so a backlit
   * frame keeps its albedo. Optional (= `tint`/`lift`).
   */
  shadow: {
    tint: string;
    lift: number;
    form?: { tint: string; lift: number };
    /**
     * LOOK r6 (L2): CAST shade turns toward this hue at MATCHED luminance
     * (hue, not value — the golden-hour colour script): `color` is taken at
     * unit luminance, `strength` is the blend at full cast shade (0 = none).
     * Form shade is untouched. Optional (none).
     */
    hue?: PaintTint;
  };
  /**
   * LOOK r5: extra painted chroma in shade, as a share of `saturation`
   * (0 = none): shade is the local albedo darker, saturation kept. LOOK r6:
   * FORM shade only (cast shade takes `shadow.hue`). Optional (0).
   */
  shadeSat?: number;
  /** Warm terminator: hue and share of key luminance at the half-lit band. */
  terminator: PaintTint;
  /** Key-side / contre-jour rim: absolute linear radiance, clamped ≤ 0.9. */
  rim: PaintTint;
  /**
   * LOOK r6 (L6.1): the rim's fresnel power — lower is a wider band (the
   * night moon rim must read at 390). Optional (4.5).
   */
  rimPower?: number;
  /**
   * LOOK r6 (L6.1): moon catch — an up-facing ledge term (cornices, sills,
   * zinc, heads) in absolute linear radiance, so the big façade planes read
   * moonlit. Optional (none).
   */
  moonCatch?: PaintTint;
  /**
   * LOOK r6 (L6.4): a soft luminance ceiling (linear) on the painted DIFFUSE,
   * applied before the emissive and reflection terms, so every painted world
   * pixel outside the lamp cores stays below the boards' P50 at night.
   * Optional (none; ≤ 0 = off).
   */
  lumaCeil?: number;
  /** Per-role response (the same core roles in every palette; `snow` optional, else `env`). */
  roles: PaintRoleTable;
  /**
   * Aerial perspective. `start`/`density` drive the luminance-preserving
   * chroma shift toward `hue` (amount `chroma`); beyond `liftStart` metres the
   * value lifts toward mix(`hue`, `sun`) by at most `lift` (0 = chroma only).
   */
  air: {
    start: number;
    density: number;
    hue: string;
    chroma: number;
    lift: number;
    liftStart: number;
    sun: string;
  };
  /**
   * Image-based light hue (LOOK r2): the IBL irradiance of painted materials
   * is multiplied by `tint` scaled to unit luminance × `strength`, so shade —
   * lit only by the sky — turns the palette's cool lilac instead of the
   * HDRI's neutral grey. Specular reflections keep the HDRI. Optional (white, 1).
   */
  ibl?: {
    tint: string;
    strength: number;
    /**
     * LOOK r3: the image-based light intensity PAINTED materials see, in
     * WorldEnvironment's units (`gold` × exposure, `night` flat). The scene
     * keeps the engine's shipped intensity (0.72 / 0.55) so every unpainted
     * material — data faces, plaques, the ledger — renders as before; the
     * painted shader scales its IBL by this ÷ the scene's. Optional (= scene).
     */
    environment?: number;
    /**
     * The image-based SPECULAR intensity painted materials see (same units);
     * optional, defaults to `environment`. Night keeps the full scene
     * reflection so wet setts glint while the diffuse shade stays dark.
     */
    specular?: number;
  };
  /**
   * Painted chroma (LOOK r2): saturation of a painted material's final colour
   * before the post stack's AgX, which pulls mid-tones toward grey. 1 = none.
   * Never reaches data faces (they are never painted). Optional (1).
   */
  saturation?: number;
  /**
   * Warm bounce (LOOK r4): the sunlit ground's light returned into the shade
   * of painted materials — hue and share of key luminance, weighted by how far
   * the surface faces down (walls ½, soffits 1, the ground itself 0). Keeps
   * shaded stone painted-violet with a warm underside instead of flat
   * concrete. Optional (none).
   */
  bounce?: PaintTint;
  /**
   * Warm practicals (LOOK r4 night): painted materials see every WARM point
   * light (orange-leaning: r > g > b) × this hue at unit luminance ×
   * `strength` — the lamp pools on setts, stone and leaves read warm, while
   * data faces (never painted) keep the scene's shipped lamps. Optional (identity).
   */
  pointWarm?: PaintTint;
}

/**
 * The painterly skin a world opts into (ROLLOUT §2.2 a). Every flag defaults
 * to false: a world without a `paint` block — or with a flag unset — mounts
 * nothing of that skin and every shared module keeps its unpainted path.
 */
export interface PaintFeatures {
  /** `<PaintSweep scope={theme.id}/>` + `PaintAudit`: the world's lit materials take the painted light. */
  sweep: boolean;
  /** `<CalmRects surfaces/>`: the padded face rects published to the calm uniform. */
  calmRects: boolean;
  /** `<ContactBlobs/>`: the soft footprint under every grounded figure. */
  contactBlobs: boolean;
  /** The constant shadow map with the station-fitted box (`fitStationShadow`) and the shadow ladder. */
  stationShadow: boolean;
  /** The shared painted sky dome (`PaintedSkyDome`) with `paint.sky`. */
  paintedSky: boolean;
  /** The paint-fx skyline ring (`PaintedSkyline`) with `paint.skyline`. */
  skyline: boolean;
  /** The instanced lamp fog halos (`route/env/LampHalos`). */
  lampHalos: boolean;
  /** The instanced contre-jour shafts (`route/env/SunShafts`). */
  sunShafts: boolean;
  /** The canopy uniforms (`LEAF_SSS` / `LEAF_SIL` / `LEAF_LAMP`) from `paint.canopy`; skins still opt in per skin. */
  paintedCanopy: boolean;
}

/** The painted day sky's colours (sRGB hex) — uniforms, written on every `writeSkyUniforms`. */
export interface PaintedSkyDayColors {
  horizon: string;
  mid: string;
  zenith: string;
  /** Sun-side low lobe. */
  peach: string;
  /** Anti-sun low lobe. */
  lilac: string;
  cloudBelly: string;
  cloudMid: string;
  cloudLit: string;
  silver: string;
  /** The sun-side gold of the silver lining (hue only). */
  gold: string;
}

/**
 * The painted day sky's SHAPE — GLSL literals templated by
 * `buildSkyFragment(preset)` (never uniforms: a literal → uniform swap can
 * move GPU constant folding by an ULP and break the plaza's identity).
 */
export interface PaintedSkyShape {
  /** Cumulus cover smoothstep edges over the fbm field (before the bias). */
  coverLo: number;
  coverHi: number;
  /** Extra cover toward the sun's azimuth and in the low band. */
  coverBias: { sun: number; low: number };
  /** Horizon haze share of the clear sky. */
  haze: number;
  /** Elevation of the mid colour stop. */
  midElevation: number;
  /** Cloud contrast kept inside a calm rect. */
  calmCloudContrast: number;
  /** Soft luminance knee of the graded day sky (linear). */
  lumaCap: { knee: number; peak: number };
  /** The crepuscular fan (count of rays, falloff pow, strength, wash, gain, shadow). */
  rays: { count: number; falloff: number; strength: number; wash: number; gain: number; shadow: number };
  /** The fan's dark-sector multiplier (linear rgb). */
  shadowRay: readonly [number, number, number];
  /** Cumulus seen against the sun: body multiplier at full contre-jour over `mu` edges. */
  contreJourCloud: { body: number; mu: readonly [number, number] };
  /** Cirrus streak opacity above elevation 0.18. */
  cirrus: { opacity: number };
}

/** AgX compensation of the sky (`uGain` / `uSat`) per palette and for the post-off (ACES) rungs. */
export interface PaintedSkyGrade {
  day: { gain: number; sat: number };
  night: { gain: number; sat: number };
  postOff: { gain: number; sat: number };
}

/**
 * The night sky of a painted world. `plaza`: the pre-pilot night shader,
 * verbatim, over the palette's sky tokens. `starfield`: the shared starfield
 * preset (round stars in angle-square cells, a Milky Way band, a small moon
 * disc with a corona, an optional dusk band) — its zenith / horizon / band
 * colours are uniforms, its shape literals are GLSL.
 */
export type NightSkyPreset =
  | { variant: 'plaza' }
  | {
      variant: 'starfield';
      /** sRGB hex, written into `uZenith` / `uHorizon` at night. */
      zenith: string;
      horizon: string;
      /** Clouds' teal dusk: a gaussian band of `color` at `elevation` (dir.y), half-width `width`, blend `strength`. */
      band?: { color: string; elevation: number; width: number; strength: number };
      /** Star cells are `cellDeg` square in angle; `density` = share of lit cells, `size` = radius in degrees. */
      stars: { density: number; size: number; cellDeg: number; brightness: number };
      /** A soft band along a great circle tilted `tilt` radians from the zenith. */
      milkyWay: { strength: number; tilt: number };
      /** Hash grain amplitude (≤ 0.006 by the rollout plan). */
      grain: number;
      /** Moon disc radius (radians) and corona (radians of falloff, strength). */
      moon: { disc: number; corona: { radius: number; strength: number } };
    };

/** A world's painted sky (ROLLOUT §2.2 d). */
export interface PaintedSkyPreset {
  id: string;
  day: PaintedSkyDayColors;
  shape: PaintedSkyShape;
  grade: PaintedSkyGrade;
  night: NightSkyPreset;
}

/**
 * A world's skyline ring (ROLLOUT §2.2 e): the atlas file under
 * `env/<world>/`, three band radii and their top elevations (degrees from the
 * world centre at ground level), the horizon mixes per palette, whether the
 * near band carries the atlas's night windows (alpha), the warm rim, and the
 * layer inks.
 */
export interface SkylineSpec {
  /** Manifest-relative atlas path, e.g. `env/plaza/skyline.webp`. */
  file: string;
  /** Atlas size in texels (the rim probe steps one texel row). */
  atlas: { width: number; height: number };
  radii: readonly [number, number, number];
  topElevationDeg: readonly [number, number, number];
  /** Share of the local clear sky over each band's ink (near, mid, far). */
  layerMix: { day: readonly [number, number, number]; night: readonly [number, number, number] };
  /** Layer inks (sRGB hex; near, mid, far). */
  ink: { day: readonly [string, string, string]; night: readonly [string, string, string] };
  /** Apply the atlas alpha (night windows) to the near band. */
  windows: boolean;
  /** Warm sun-side roofline rim (sRGB hex) and its linear strength. */
  rimWarm: string;
  rimStrength: number;
  /** Azimuth (radians, atan2(z, x)) of each band's geometric seam. */
  seams: readonly [number, number, number];
}

/** A painted world's canopy light (ROLLOUT §2.2 h): translucency, contre-jour silhouette and lamp under-light. */
export interface CanopyLook {
  sss: { day: number; night: number };
  sil: { day: number; night: number };
  lamp: { day: number; night: number };
  /** Stations the silhouette applies at (absent = every station). */
  silStations?: readonly string[];
}

/** The rig's contre-jour and post-off (renderer ACES rungs) tuning (ROLLOUT §2.2 b). */
export interface PaintRigTuning {
  contreJour: { bounce: number; lift: number; shade: number };
  postOff: {
    keyNeutral: { color: string; mix: number };
    shadeShift: { color: string; mix: number };
    saturation: number;
  };
}

/** The painterly light model of a theme: one light set per palette plus the shadow rig. */
export interface RouteThemePaint {
  day: PaintLightSet;
  night: PaintLightSet;
  /**
   * Station-fitted shadow (LOOK-PLAN §1.2): a fixed `box` × `box` metre
   * light-space square at a constant `mapSize`, PCF `radius`. Never resized.
   */
  shadow: { mapSize: number; box: number; radius: number; bias: number; normalBias: number };
  /** The skin flags this world opts into (every flag defaults to false; the plaza: all true). */
  features?: Partial<PaintFeatures>;
  /** The painted sky (`features.paintedSky`). */
  sky?: PaintedSkyPreset;
  /** The skyline ring (`features.skyline`). */
  skyline?: SkylineSpec;
  /** The canopy light (`features.paintedCanopy`). */
  canopy?: CanopyLook;
  /** Contre-jour and post-off tuning of the rig (absent = the plaza's constants). */
  rig?: PaintRigTuning;
  /** PostStack vignette darkness (absent = the engine's 0.46). */
  vignette?: number;
}

/** Whether a theme's paint block opts into a skin flag (false when there is no paint block). */
export function paintFeature(paint: RouteThemePaint | undefined | null, feature: keyof PaintFeatures): boolean {
  return paint?.features?.[feature] === true;
}

/**
 * Screen-reader status lines for the Pokéball loader and the retry control,
 * in one language. Filled from `world-themes.loader` by locale
 * (`themeLoaderCopy`, `src/components/world/themes/station-copy.ts`).
 */
export interface RouteLoaderCopy {
  /** Polite status while the 3D world loads — the page is already usable. */
  loading: string;
  /** Polite status once the world has been handed the page. */
  ready: string;
  /** One-line reason shown beside the retry after a recoverable failure. */
  failed: string;
  /** The retry button label. */
  retry: string;
}

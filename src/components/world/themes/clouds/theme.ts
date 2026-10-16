/**
 * The Skyisle theme ("clouds") — the sky-island route world (card C-095),
 * the third new world on the generalized engine.
 *
 * A sky-island chain adrift above a shader-driven cloud sea:
 * five station isles orbit the same section ids as every world manifest
 * (pulse/roster/teams/schedule/rules — the capture harness hardcodes those
 * ids); the camera drifts through the sky and reads each beat's furniture:
 * the flagship airship's standings billboard moored above the summit isle
 * (pulse), the register airship's broadside roster sail (roster), the aces
 * float row on the east isle (teams), the fixtures board airship on the NE
 * isle (schedule), and the great halo gate with its rules plaque at the
 * south entrance (rules). Light-bridge arcs chain the isles together; the
 * cloud sea runs below them all. Pure data — no client-only imports;
 * consumed through `src/components/world/themes/index.ts`.
 */

import type { RouteThemeDefinition, RouteThemeStation } from '@/lib/route-world/theme-types';
import { themeStationTexts } from '../station-copy';
import { PLAZA_HDRI_FORMAT } from '@/lib/route-world/world-env';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import { cloudsPaletteExtension, type CloudsPaletteExt } from './theme-palette';

/**
 * Authored station beats (English source copy from
 * `world-themes.stations.clouds`). Engine surfaces re-localize them to the
 * viewer with `localizeThemeStations` (i18n D11); themes carry no language.
 */
const COPY = themeStationTexts('clouds', 'en');

/**
 * Five station beats, scroll order matching the world registry's clouds
 * manifest. No-closer-camera (CONFIG): every endpoint's eye→hero distance is
 * at least the plaza's same-station distance — legibility is Focus and the
 * board-face budget, never a closer stand. Quoted numbers (computed exactly
 * from the endpoints below):
 *
 *  - #pulse  eye→face 13.13 m (plaza 11.66) — flagship billboard ≈ 43 % of
 *    the 1440 frame; 71.8 % still-measured at the landed 390 pose (cap 75 %).
 *  - #roster eye→sail  8.38 m (plaza 8.37, the siblings' pinned authoring
 *    geometry) — frieze 57.4 % of the 1440 frame (cap 60 %).
 *  - #teams  eye→row   8.35 m (plaza 8.35, identical authoring geometry).
 *  - #schedule eye→board 11.85 m (plaza 11.66) — fixtures board ≈ 50 % of
 *    the 1440 frame; 65.4 % at the landed 390 pose (c095r2 still-measured,
 *    caps 60/75 %).
 *  - #rules  eye→gate 21.40 m (plaza 21.00).
 */
export const CLOUDS_STATIONS: readonly RouteThemeStation[] = [
  {
    id: 'pulse',
    beat: COPY.pulse.beat,
    camera: { position: [2.0, 4.2, -3.0], target: [-6.5, 4.5, -13.0], fov: 42 },
    // Landed [8.5818, 3.9146, 4.6987] = endpoint + 9.75 × unit(target→cam)
    // ([0.6484, −0.0252, 0.7609], base distance 13.5104 m) after the rig's
    // mobile pullback — billboard 71.8 % of the 390 frame (c095r2
    // still-measured), so the flagship reads whole on a tall screen. The
    // pullback runs straight back over open sky east of the chain: the cloud
    // sea (y −7) and the far scatter isles are the only things below the
    // sight ray.
    cameraMobile: { position: [2.26, 4.16, -2.72], target: [-6.5, 4.5, -13.0], fov: 52 },
    world: { key: 1.0, fog: 0.006, practicals: 1.0, particles: 0.3 },
    assetGroup: 'critical',
    // Station Card (wave 2, D15): kicker title, one CTA to the panel the
    // board opens, and the 390 digest fact (copy: world-themes.stations.clouds).
    card: { title: COPY.pulse.title, cta: { param: 'board', value: 'pulse' }, digest: 'standingsTop' },
  },
  {
    id: 'roster',
    beat: COPY.roster.beat,
    camera: { position: [-5.2, 2.45, 0.4], target: [-13.5, 1.45, 0], fov: 40 },
    cameraMobile: { position: [-2.82, 3.17, 0.41], target: [-13.5, 1.3, 0], fov: 50 },
    world: { key: 0.92, fog: 0.008, practicals: 0.75, particles: 0.18 },
    assetGroup: 'route',
    card: {
      title: COPY.roster.title,
      cta: { param: 'board', value: ROSTER_BOARD_VALUE },
      digest: 'rosterCount',
    },
  },
  {
    id: 'teams',
    beat: COPY.teams.beat,
    camera: { position: [5.2, 2.55, 0.2], target: [13.5, 1.7, 0], fov: 42 },
    cameraMobile: { position: [2.8, 3.27, 0.21], target: [13.5, 1.5, 0], fov: 52 },
    world: { key: 0.88, fog: 0.008, practicals: 0.55, particles: 0.2 },
    assetGroup: 'gyms',
    // At 390 the digest slot becomes the roll-call rail (a chip per trainer).
    card: { title: COPY.teams.title, cta: { param: 'board', value: 'pulse' }, digest: 'teamChips' },
  },
  {
    id: 'schedule',
    beat: COPY.schedule.beat,
    camera: { position: [1.2, 3.6, -3.2], target: [6.0, 2.8, -14.0], fov: 42 },
    // C-095 r2 pull-back: the r1 endpoint [1.0, 3.55, -2.9] (base 12.20 m /
    // landed 21.95 m) stood closer than plaza's schedule mobile class
    // (12.4438 / landed 22.1938). Landed [-3.23, 4.18, 6.47] = endpoint +
    // 9.75 × unit(target→cam) ([-0.4102, 0.0612, 0.9099] — straight back over
    // the open western sky), base distance 12.75 m — fixtures board
    // 65.4 % of the 390 frame (c095r2 still-measured, cap 75 %).
    cameraMobile: { position: [0.77, 3.58, -2.4], target: [6.0, 2.8, -14.0], fov: 52 },
    world: { key: 0.96, fog: 0.006, practicals: 1.0, particles: 0.25 },
    assetGroup: 'stadium',
    card: {
      title: COPY.schedule.title,
      cta: { param: 'board', value: 'schedule' },
      digest: 'nextKickoff',
    },
  },
  {
    id: 'rules',
    beat: COPY.rules.beat,
    camera: { position: [0, 2.7, -5.8], target: [0, 4.6, 15.6], fov: 36 },
    // Landed [0, 5.97, −15.83] = endpoint + 9.75 × unit(target→cam)
    // ([0, 0.0884, −0.9961]) after the rig's mobile pullback, base distance
    // 21.49 m — halo gate ≈ 67 % of the 390 frame with its margins kept.
    cameraMobile: { position: [0, 5.0, -6.1], target: [0, 4.4, 15.6], fov: 46 },
    world: { key: 0.72, fog: 0.012, practicals: 0.85, particles: 0.15 },
    assetGroup: 'hall',
    card: { title: COPY.rules.title, cta: { param: 'rules', value: 'gate' }, digest: 'rulesHeadline' },
  },
] as const;

export const CLOUDS_STATION_IDS: readonly string[] = CLOUDS_STATIONS.map(
  (station) => station.id,
);

/**
 * Direction the key light comes from — east-south-east, ≈ 34° up: the
 * high thin-air sun of a sky world, so the isles' tops take the light and
 * every cloud-sea crest has a sun to catch. `keyPosition` and
 * `skyBodyPosition` are both scaled from it so the visible disc and the
 * shadows always agree.
 */
const KEY_LIGHT_DIRECTION = [18, 16, 8] as const;

/** Directional key placement (metres), far enough for a flat shadow frustum. */
const KEY_LIGHT_POSITION = [18 * 1.4, 16 * 1.4, 8 * 1.4] as const;

/** Visible sun/moon practical, on the key axis above the chain. */
const SKY_BODY_POSITION = [18 * 0.78, 16 * 0.78 + 1.2, 8 * 0.78] as const;

/**
 * The clouds theme definition. The world registry's clouds entry
 * (`routeThemeId: 'clouds'`) resolves to this via `resolveRouteTheme`.
 */
export const cloudsTheme: RouteThemeDefinition<CloudsPaletteExt> = {
  id: 'clouds',
  stations: CLOUDS_STATIONS,
  // Capture stills start-align sections while the conductor may already be in
  // the next interval (PB-013) — the two content-wall stations pin at their
  // integer endpoint while start-aligned, the plaza's discipline.
  holdIds: ['pulse', 'schedule'],
  paletteExtension: cloudsPaletteExtension,
  lights: {
    keyDirection: KEY_LIGHT_DIRECTION,
    keyPosition: KEY_LIGHT_POSITION,
    skyBodyPosition: SKY_BODY_POSITION,
  },
  // GLB prop families in clouds: the C-107 Blender seats (the register's
  // clouds-airship-hull body + the clouds-halo-gate crown, PropMounts) root
  // under the `clouds-prop-` prefix, so the static batcher spares the named
  // prop roots and frustum culling stays per seat. (C-104 r1
  // flipped the C-095-era empty declaration when the first GLB props landed.)
  propFamilyPrefixes: ['clouds-prop-'],
  // Procedural-first: the isles consume NO bucket texture set — meadow, rock
  // and canvas surfaces are authored in-page (vertex colors and painted
  // canvases). Zero binary asset bytes expected.
  textureRoles: [],
  // Yaws aim each HDRI's sun/moon toward the authored east-south-east sky
  // body. Calibrated by interpolating the siblings' calibration pairs
  // (mountain: key azimuth 19° → yaw 0.2π; sakura: azimuth 108° → yaw
  // −0.38π; clouds interpolates to azimuth 66°) — the HDRI only carries
  // ambient/specular response, and re-yawing without a dedicated
  // env-isolation arm would be guesswork (disclosed, not hidden).
  // ROLLOUT-PLAN §3.2 E4: the UltraHDR gain-map pair the plaza ships (22 KB
  // day / 165 KB night instead of 1206 / 1683 KB radiance; probe-sphere ΔE76
  // ≤ 1.68, sun / moon centroid unmoved, so the yaws below carry over).
  hdriFormat: PLAZA_HDRI_FORMAT,
  hdriYaw: {
    gold: -Math.PI * 0.1,
    night: -Math.PI * 0.08,
  },
  // C2: the DOM overlay stack answers these params (ThemeOverlays); the
  // subject kinds name what the station furniture registers. Roster subjects
  // carry no panel — the painted sail IS the content — so no `roster` param.
  focusVocabulary: {
    kinds: ['ace', 'board', 'roster', 'rules'],
    panelParams: ['team', 'mon', 'board', 'rules'],
  },
};

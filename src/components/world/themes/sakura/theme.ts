/**
 * The Sakura Park theme ("sakura") — the first new route world on the
 * generalized engine.
 *
 * A cherry-blossom lakeside park ring. Five stations orbit
 * the same section ids as every world manifest (pulse/roster/teams/schedule/
 * rules — the capture harness hardcodes those ids); the camera stands in the
 * park's south lawn and looks at the furniture of each beat: the jumbotron
 * rock across the lake (pulse), the west lantern shrine wall (roster), the
 * east lantern line with the aces enshrined on the caps (teams), the festival
 * banner row on the north-east shore (schedule), and the great torii gate at
 * the south entrance (rules). Pure data — no client-only imports; consumed
 * through `src/components/world/themes/index.ts`.
 */

import type { RouteThemeDefinition, RouteThemeStation } from '@/lib/route-world/theme-types';
import { themeStationTexts } from '../station-copy';
import { PLAZA_HDRI_FORMAT } from '@/lib/route-world/world-env';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import { sakuraPaletteExtension, type SakuraPaletteExt } from './theme-palette';

/**
 * Authored station beats (English source copy from
 * `world-themes.stations.sakura`). Engine surfaces re-localize them to the
 * viewer with `localizeThemeStations` (i18n D11); themes carry no language.
 */
const COPY = themeStationTexts('sakura', 'en');

/**
 * Five station beats, scroll order matching the world registry's sakura
 * manifest. No-closer-camera (CONFIG): every endpoint's eye→hero distance is
 * at least the plaza's same-station distance — legibility is Focus and the
 * board-face budget, never a closer stand. Quoted numbers:
 *
 *  - #pulse  eye→board 12.30 m (plaza 11.67) — rock screen ≈ 46 % of the
 *    1440 frame, ≈ 57 % still-measured at the landed 390 pose (cap 75 %).
 *  - #roster eye→wall  8.37 m (plaza 8.37, identical authoring geometry).
 *  - #teams  eye→row   8.35 m (plaza 8.35, identical authoring geometry).
 *  - #schedule eye→banners 11.91 m (plaza 11.67) — banner wall ≈ 49 % of
 *    the 1440 frame (r3 still); at the landed 390 pose the banner-row cloth
 *    bbox measures ≈ 12 % of the frame (r4 still-measured, cap 75 %).
 *  - #rules  eye→torii 21.41 m (plaza 21.00).
 */
export const SAKURA_STATIONS: readonly RouteThemeStation[] = [
  {
    id: 'pulse',
    beat: COPY.pulse.beat,
    camera: { position: [2.4, 3.4, -2.6], target: [-5.0, 2.7, -12.4], fov: 42 },
    // Lands [16.7059, 5.775, -7.3353] = endpoint + 9.75 × unit(target→cam)
    // ([0.9647, 0.1367, 0.2251] — straight back over the south lawn) after
    // the rig's mobile pullback, 22.50 m off the rock on the desktop eye
    // axis. C-099: the C-093 endpoint [7.0, 4.4, -9.6] stood 12.4391 m off
    // the rock (landed 22.1891) — under plaza's same-station 12.7481/22.4981
    // on mobile-base and landed; pulled back along the sight axis to base
    // 12.75 / landed 22.50, clearing both classes. Rock screen ≈ 57 % of the
    // 390 frame, still-measured at the landed pose (c099 stills, 57.9 % on
    // the C-093 pose; the ledger's nominal-face formula says 69 % — cap
    // 75 %), so the rock reads whole on a tall screen.
    cameraMobile: { position: [7.3, 4.4425, -9.53], target: [-5.0, 2.7, -12.4], fov: 52 },
    world: { key: 1.0, fog: 0.006, practicals: 1.0, particles: 0.3 },
    assetGroup: 'critical',
    // Station Card (wave 2, D15): kicker title, one CTA to the panel the
    // board opens, and the 390 digest fact (copy: world-themes.stations.sakura).
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
    camera: { position: [1.2, 3.4, -3.4], target: [5.2, 2.7, -14.6], fov: 42 },
    // Lands [-2.26, 4.0, 6.27] = endpoint + 9.75 × unit(target→cam)
    // ([-0.336, 0.059, 0.940] — straight back over the south lawn) after the
    // rig's mobile pullback, 22.20 m off the banners on the desktop eye axis.
    // C-093 r4: the r3 endpoint's pullback ran unit(target→cam) ≈ [-0.84,
    // 0.14, 0.53], landing [-13.18, 5.76, -3.07] behind the west tree line
    // (0.62 m off the shrine wall, 2.7 m in front of the [-11.5,-5.5] shore
    // accent) — the banners were unframed at 390. The landed pose here
    // angle-checks clean (no frustum occluder nearer than the banner plane)
    // and stays far outside the no-closer floor (22.20 m vs plaza 11.67).
    cameraMobile: { position: [1.02, 3.43, -2.9], target: [5.2, 2.7, -14.6], fov: 52 },
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
    camera: { position: [0, 2.6, -5.8], target: [0, 3.1, 15.6], fov: 36 },
    cameraMobile: { position: [0, 4.9, -6.2], target: [0, 2.9, 15.6], fov: 46 },
    world: { key: 0.72, fog: 0.012, practicals: 0.85, particles: 0.15 },
    assetGroup: 'hall',
    card: { title: COPY.rules.title, cta: { param: 'rules', value: 'gate' }, digest: 'rulesHeadline' },
  },
] as const;

export const SAKURA_STATION_IDS: readonly string[] = SAKURA_STATIONS.map((station) => station.id);

/**
 * Direction the key light comes from — east-north-east, ≈ 26° up: soft
 * morning light across the lake toward the south lawn, so the torii and the
 * banner row take the lit side from the schedule camera and the lake's
 * reflection fake has a sun to smear. `keyPosition` and `skyBodyPosition`
 * are both scaled from it so the visible disc and the shadows always agree.
 */
const KEY_LIGHT_DIRECTION = [24, 13, -8] as const;

/** Directional key placement (metres), far enough for a flat shadow frustum. */
const KEY_LIGHT_POSITION = [24 * 1.4, 13 * 1.4, -8 * 1.4] as const;

/** Visible sun/moon practical, on the key axis over the north-east shore. */
const SKY_BODY_POSITION = [24 * 0.78, 13 * 0.78 + 1.2, -8 * 0.78] as const;

/**
 * The sakura theme definition. The world registry's sakura entry
 * (`routeThemeId: 'sakura'`) resolves to this via `resolveRouteTheme`.
 */
export const sakuraTheme: RouteThemeDefinition<SakuraPaletteExt> = {
  id: 'sakura',
  stations: SAKURA_STATIONS,
  // Capture stills start-align sections while the conductor may already be in
  // the next interval (PB-013) — the two content-wall stations pin at their
  // integer endpoint while start-aligned, the plaza's discipline.
  holdIds: ['pulse', 'schedule'],
  paletteExtension: sakuraPaletteExtension,
  lights: {
    keyDirection: KEY_LIGHT_DIRECTION,
    keyPosition: KEY_LIGHT_POSITION,
    skyBodyPosition: SKY_BODY_POSITION,
  },
  // C-102: the park mounts the C-107 GLB props (torii hero + stone-lantern
  // practicals, furniture/PropMounts.tsx) on `sakura-prop-`-named roots —
  // the family the static batcher must never merge, so each seat
  // keeps its own bounds and frustum culls outside its station frame.
  propFamilyPrefixes: ['sakura-prop-'],
  // W1 textureRoles contract: sakura consumes NO bucket texture set — the
  // park is procedural-first (lawn, stone and water maps are painted
  // in-page). The RESIDUALS row of the asset pipeline stays accepted.
  textureRoles: [],
  // Yaws aim each HDRI's sun/moon toward the authored east-north-east sky
  // body (the plaza values put its HDRI sun over a west-south-west body, so
  // the sakura yaws swing the base azimuth around to the east shore).
  // ROLLOUT-PLAN §3.2 E4: the UltraHDR gain-map pair the plaza ships (22 KB
  // day / 165 KB night instead of 1206 / 1683 KB radiance; probe-sphere ΔE76
  // ≤ 1.68, sun / moon centroid unmoved, so the yaws below carry over).
  hdriFormat: PLAZA_HDRI_FORMAT,
  hdriYaw: {
    gold: -Math.PI * 0.38,
    night: -Math.PI * 0.34,
  },
  // C2: the DOM overlay stack answers these params (ThemeOverlays); the
  // subject kinds name what the station furniture registers. Roster subjects
  // carry no panel — the painted frieze IS the content — so no `roster` param.
  focusVocabulary: {
    kinds: ['ace', 'board', 'roster', 'rules'],
    panelParams: ['team', 'mon', 'board', 'rules'],
  },
};

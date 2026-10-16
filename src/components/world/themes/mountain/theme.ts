/**
 * The Mountain Pass theme ("mountain") — the alpine valley route world
 * (card C-094), the second new world on the generalized engine.
 *
 * An alpine valley: five stations orbit the same section ids
 * as every world manifest (pulse/roster/teams/schedule/rules — the capture
 * harness hardcodes those ids); the camera stands on the valley floor and
 * looks at the furniture of each beat: the summit standings board on the
 * snow-capped crag (pulse), the trail register lodge wall (roster), the east
 * cairn terrace with the aces enshrined on the caps (teams), the trail-sign
 * meadow (schedule), and the great mountain-pass gate at the south entrance
 * (rules). Pure data — no client-only imports; consumed through
 * `src/components/world/themes/index.ts`.
 */

import type { RouteThemeDefinition, RouteThemeStation } from '@/lib/route-world/theme-types';
import { themeStationTexts } from '../station-copy';
import { PLAZA_HDRI_FORMAT } from '@/lib/route-world/world-env';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import { mountainPaletteExtension, type MountainPaletteExt } from './theme-palette';

/**
 * Authored station beats (English source copy from
 * `world-themes.stations.mountain`). Engine surfaces re-localize them to the
 * viewer with `localizeThemeStations` (i18n D11); themes carry no language.
 */
const COPY = themeStationTexts('mountain', 'en');

/**
 * Five station beats, scroll order matching the world registry's mountain
 * manifest. No-closer-camera (CONFIG): every endpoint's eye→hero distance is
 * at least the plaza's same-station distance — legibility is Focus and the
 * board-face budget, never a closer stand. Quoted numbers (computed exactly
 * by gauntlet/evidence/c094-mountain-geometry.mjs, not approximated):
 *
 *  - #pulse  eye→board 15.03 m (plaza 11.66) — summit board ≈ 38 % of the
 *    1440 frame; the landed 390 pose measures ≈ 62 % (cap 75 %).
 *  - #roster eye→wall   8.37 m (plaza 8.37, identical authoring geometry).
 *  - #teams  eye→row    8.35 m (plaza 8.35, identical authoring geometry).
 *  - #schedule eye→signs 12.66 m (plaza 11.66) to the row seat (the
 *    arced centre cloth hangs 0.3 m nearer). Fidelity W1 r1 re-measure
 *    (cloth corners, w1-painted-clarity test; the old "≈ 46 % / ≈ 69 %"
 *    quoted the pre-C-103 1.15 m cloths): the arced five-cloth row spans
 *    ndcX ±0.656 at 1440 (≈ 66 % of the frame width) and ±0.985 at the
 *    landed 390 pose (≈ 98 % — every cloth in frame, but ABOVE the 75 %
 *    cap; chapters.test pins the cap on a 7.15 m nominal stand-in, not
 *    on the cloths — a design decision, recorded rather than hidden).
 *  - #rules  eye→gate  21.41 m (plaza 21.00).
 */
export const MOUNTAIN_STATIONS: readonly RouteThemeStation[] = [
  {
    id: 'pulse',
    beat: COPY.pulse.beat,
    camera: { position: [0.8, 3.9, -2.6], target: [-8.0, 6.0, -14.6], fov: 42 },
    // Landed ≈ [6.79, 2.47, 5.56] after the rig's 9.75 m mobile pullback
    // (endpoint + 9.75 × unit(target→cam), unit [0.58549, −0.13973, 0.79842],
    // base distance 15.51 m) — board ≈ 62 % of the 390 frame, so the summit
    // board reads whole on a tall screen. The pullback runs straight back
    // along the desktop axis, out over the open south-east meadow: the
    // eye→board axis crosses the tarn (water at y 0) and the knoll toe
    // (h ≤ 2.4 in front of the board) only — no frustum occluder nearer than
    // the board plane.
    cameraMobile: { position: [1.08, 3.83, -2.22], target: [-8.0, 6.0, -14.6], fov: 52 },
    world: { key: 1.0, fog: 0.006, practicals: 1.0, particles: 0.3 },
    assetGroup: 'critical',
    // Station Card (wave 2, D15): kicker title, one CTA to the panel the
    // board opens, and the 390 digest fact (copy: world-themes.stations.mountain).
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
    camera: { position: [0.6, 3.5, -2.2], target: [5.6, 2.6, -13.8], fov: 42 },
    // Landed [−3.50, 4.25, 7.32] = endpoint + 9.75 × unit(target→cam)
    // ([−0.39494, 0.07108, 0.91628] — straight back over the south meadow)
    // after the rig's mobile pullback, base distance 13.31 m off the signs on
    // the desktop eye axis. The landed corridor grazes clear of the knoll
    // (closest approach 13.6 m vs radius 10.5) and crosses only the tarn's
    // water plane (y 0) and open meadow — no frustum occluder nearer than the
    // sign plane.
    cameraMobile: { position: [0.35, 3.55, -1.61], target: [5.6, 2.6, -13.8], fov: 52 },
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
    camera: { position: [0, 2.7, -5.6], target: [0, 3.4, 15.8], fov: 36 },
    // Landed [0, 6.09, −15.71] = endpoint + 9.75 × unit(target→cam)
    // ([0, 0.09137, −0.99582]) after the rig's mobile pullback, base distance
    // 21.89 m — gate ≈ 68 % of the 390 frame with its margins kept.
    cameraMobile: { position: [0, 5.2, -6.0], target: [0, 3.2, 15.8], fov: 46 },
    world: { key: 0.72, fog: 0.012, practicals: 0.85, particles: 0.15 },
    assetGroup: 'hall',
    card: { title: COPY.rules.title, cta: { param: 'rules', value: 'gate' }, digest: 'rulesHeadline' },
  },
] as const;

export const MOUNTAIN_STATION_IDS: readonly string[] = MOUNTAIN_STATIONS.map(
  (station) => station.id,
);

/**
 * Direction the key light comes from — south-south-east, ≈ 14° up: low
 * crisp alpine morning light down the throat of the pass (the valley's
 * "afternoon sinking toward the pass" reading), so the summit crag's south
 * face and the gate both take the lit side, and the tarn has a sun to
 * glint. `keyPosition` and `skyBodyPosition` are both scaled from it so the
 * visible disc and the shadows always agree. r2 re-site: the rig moved from
 * east-south-east [18, 12, 14] so the sky body lands INSIDE the #rules
 * frustum (≈ 14° right of the desktop axis, ≈ 5° up; ≈ 10° right in the
 * landed 390 pose) — the dark rules still gains its identifiable moon rim,
 * which the ESE body left off every camera axis. r3: BY DAY the key seat
 * drops/warms in `env/Lighting.tsx` (DAY_KEY_POSITION — same azimuth, so
 * shadows still agree with the disc in direction); the night rig below is
 * untouched.
 */
const KEY_LIGHT_DIRECTION = [7, 5.2, 20] as const;

/** Directional key placement (metres), far enough for a flat shadow frustum. */
const KEY_LIGHT_POSITION = [7 * 1.4, 5.2 * 1.4, 20 * 1.4] as const;

/** Visible sun/moon practical, on the key axis above the pass. */
const SKY_BODY_POSITION = [7 * 0.78, 5.2 * 0.78 + 1.2, 20 * 0.78] as const;

/**
 * The mountain theme definition. The world registry's mountain entry
 * (`routeThemeId: 'mountain'`) resolves to this via `resolveRouteTheme`.
 */
export const mountainTheme: RouteThemeDefinition<MountainPaletteExt> = {
  id: 'mountain',
  stations: MOUNTAIN_STATIONS,
  // Capture stills start-align sections while the conductor may already be in
  // the next interval (PB-013) — the two content-wall stations pin at their
  // integer endpoint while start-aligned, the plaza's discipline.
  holdIds: ['pulse', 'schedule'],
  paletteExtension: mountainPaletteExtension,
  lights: {
    keyDirection: KEY_LIGHT_DIRECTION,
    keyPosition: KEY_LIGHT_POSITION,
    skyBodyPosition: SKY_BODY_POSITION,
  },
  // C-103: the pass mounts the C-107 GLB props (ridge-arch hero + the cairn
  // trio, furniture/PropMounts.tsx) on `mountain-prop-`-named roots — the
  // family the static batcher must never merge, so each seat keeps
  // its own bounds and frustum culls outside its station frame. The instanced
  // tufts/scree remain static kit, not named prop roots.
  propFamilyPrefixes: ['mountain-prop-'],
  // Procedural-first: the valley consumes NO bucket texture set — meadow,
  // granite and trail surfaces are authored in-page (vertex colors and
  // painted canvases). Zero binary asset bytes expected.
  textureRoles: [],
  // Yaws aim each HDRI's sun/moon toward the authored sky body. Calibrated
  // against the r1 east-south-east rig (interpolated from the plaza's
  // west-south-west and sakura's east-north-east); the r2 re-site to
  // south-south-east leaves them — the HDRI only carries ambient/specular
  // response, and re-yawing without a dedicated env-isolation arm would be
  // guesswork (disclosed, not hidden).
  // ROLLOUT-PLAN §3.2 E4: the UltraHDR gain-map pair the plaza ships (22 KB
  // day / 165 KB night instead of 1206 / 1683 KB radiance; probe-sphere ΔE76
  // ≤ 1.68, sun / moon centroid unmoved, so the yaws below carry over).
  hdriFormat: PLAZA_HDRI_FORMAT,
  hdriYaw: {
    gold: Math.PI * 0.2,
    night: Math.PI * 0.16,
  },
  // C2: the DOM overlay stack answers these params (ThemeOverlays); the
  // subject kinds name what the station furniture registers. Roster subjects
  // carry no panel — the painted frieze IS the content — so no `roster` param.
  focusVocabulary: {
    kinds: ['ace', 'board', 'roster', 'rules'],
    panelParams: ['team', 'mon', 'board', 'rules'],
  },
};

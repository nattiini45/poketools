/**
 * The League Challenge plaza theme ("plaza") — EvoLiga's route world.
 *
 * Every plaza-specific value the engine used to hardcode lives here: the
 * five station beats and camera endpoints, the capture hold stations, the
 * scene-furniture palette extension, the key-light rig geometry, the
 * never-merge prop families, texture/HDRI tuning and the focus vocabulary.
 * Pure data — no client-only imports; consumed through
 * `src/components/world/themes/index.ts`.
 */

import type { RouteThemeDefinition, RouteThemeStation } from '@/lib/route-world/theme-types';
import { themeStationTexts } from '../station-copy';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import { PLAZA_HDRI_FORMAT, PLAZA_PAINTED_ROLES } from '@/lib/route-world/world-env';
import { PLAZA_SKY_PRESET, PLAZA_SKYLINE_SPEC } from '@/components/world/route/env/paint-fx';
import { DEFAULT_RIG_TUNING } from '@/components/world/route/paint/paint-rig';
import {
  PLAZA_CANOPY_LOOK,
  PLAZA_PAINT,
  PLAZA_PAINT_FEATURES,
  PLAZA_VIGNETTE_DARKNESS,
  plazaPaletteExtension,
  type PlazaPaletteExt,
} from './theme-palette';

/**
 * Authored station beats (German source copy from
 * `world-themes.stations.plaza`). Engine surfaces re-localize them to the
 * viewer with `localizeThemeStations` (i18n D11); themes carry no language.
 */
const COPY = themeStationTexts('plaza', 'de');

/**
 * Five equal orbit sectors. Scroll order matches the world registry: pulse,
 * roster, teams, schedule, rules. The camera stands in the plaza and looks at
 * the furniture of that beat. Layout anchors: `@/lib/route-world/layout`.
 */
export const PLAZA_STATIONS: readonly RouteThemeStation[] = [
  // Spec §5.1 (A): plaza-framed — ≈ 11.7 m off the board, 3.2 m east of its
  // axis so the right board and the north façade share the frame. Board ≈ 52 %
  // of the frame width at 1440×900; the full Tabelle lives in Focus.
  //
  // `cameraMobile` is authored against the POST-pullback pose (C-031): the rig
  // dollies every endpoint back MAX_PULLBACK (9.75 m) along its view axis on a
  // tall screen, so `cameraMobile + 9.75 m` is the pose that actually lands at
  // 390. Bases stay outward of the desktop eye (never closer — CONFIG
  // `no-closer-camera`) and each landed 390 pose is quoted in the comments.
  {
    id: 'pulse',
    beat: COPY.pulse.beat,
    camera: { position: [-1.2, 3.4, -5.0], target: [-4.4, 4.0, -16.2], fov: 42 },
    // Lands at ≈ [11.80, 4.55, -0.60] — board ≈ 53 % of the 390 frame. The eye
    // is rotated ENE around the board rather than pushed back along the
    // desktop axis (whose pullback lands z=+4.4, south of the plaza clutter):
    // base, sweep and landed pose all stay north of z=0, so the eye→board
    // axis crosses open cobbles only.
    cameraMobile: { position: [4.78, 4.31, -7.36], target: [-4.4, 4.0, -16.2], fov: 52 },
    world: { key: 1.0, fog: 0.006, practicals: 1.0, particles: 0.25 },
    assetGroup: 'critical',
    // Station Card (wave 2, D15): kicker title, one CTA to the panel the
    // board opens, and the 390 digest fact (copy: world-themes.stations.plaza).
    card: { title: COPY.pulse.title, cta: { param: 'board', value: 'pulse' }, digest: 'standingsTop' },
  },
  {
    id: 'roster',
    beat: COPY.roster.beat,
    camera: { position: [-5.2, 2.45, 0.4], target: [-13.5, 1.45, 0], fov: 40 },
    // Lands at ≈ [6.78, 4.85, 0.78] — pavilion ≈ 64 % of the 390 frame
    // (bar cap ≤ 75 %; C-025 measured 96 % at the pre-C-031 pose).
    cameraMobile: { position: [-2.82, 3.17, 0.41], target: [-13.5, 1.3, 0], fov: 50 },
    world: { key: 0.92, fog: 0.008, practicals: 0.75, particles: 0.15 },
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
    // Lands at ≈ [-6.82, 4.86, 0.39] — statue row ≈ 63 % of the 390 frame,
    // one metre higher than the C-026 pose so cobbles read below the row.
    cameraMobile: { position: [2.8, 3.27, 0.21], target: [13.5, 1.5, 0], fov: 52 },
    world: { key: 0.88, fog: 0.008, practicals: 0.55, particles: 0.2 },
    assetGroup: 'gyms',
    // At 390 the digest slot becomes the roll-call rail (a chip per trainer).
    card: { title: COPY.teams.title, cta: { param: 'board', value: 'pulse' }, digest: 'teamChips' },
  },
  // Spec §5.4 (A): counterpart of #pulse — same board wall, opposite wing.
  // The due-west mirror eye sits inside the Poké Center pavilion footprint
  // (x -10.9..-16.4, z -2.9..2.9), so the eye swings to the pavilion's north
  // side instead: lands at ≈ [-14.20, 4.55, -4.11] — board ≈ 42 % of the 390
  // frame, whole pullback sweep north of z=0 like #pulse.
  {
    id: 'schedule',
    beat: COPY.schedule.beat,
    camera: { position: [1.2, 3.4, -5.0], target: [4.4, 4.0, -16.2], fov: 42 },
    cameraMobile: { position: [-6.03, 4.31, -9.42], target: [4.4, 4.0, -16.2], fov: 52 },
    world: { key: 0.96, fog: 0.006, practicals: 1.0, particles: 0.22 },
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
    camera: { position: [0, 2.5, -4.6], target: [0, 2.4, 16.4], fov: 36 },
    // Lands at ≈ [0, 5.8, -14.8], still south of the north boards — gate ≈ 86 %
    // of the 390 frame (was edge-to-edge at 97 %), so nothing clips at the
    // frame edges and the plaques keep their margins.
    cameraMobile: { position: [0, 4.68, -5.11], target: [0, 2.2, 16.4], fov: 46 },
    world: { key: 0.72, fog: 0.012, practicals: 0.85, particles: 0.12 },
    assetGroup: 'hall',
    card: { title: COPY.rules.title, cta: { param: 'rules', value: 'left' }, digest: 'rulesHeadline' },
  },
] as const;

export const PLAZA_STATION_IDS: readonly string[] = PLAZA_STATIONS.map((station) => station.id);

/**
 * Direction the key light comes from — west-south-west, ≈ 21° up: golden-hour
 * light rakes across the plaza toward the boards, the north and east façades
 * take the warm side, and the statue row throws long shadows east. Unit-free;
 * `keyPosition` and `skyBodyPosition` are both scaled from it so the visible
 * disc and the shadows always agree (spec §8.2).
 */
const KEY_LIGHT_DIRECTION = [-26, 12, 18] as const;

/** Directional key placement (metres). Far enough that the shadow frustum stays orthographic-flat. */
const KEY_LIGHT_POSITION = [-26 * 1.4, 12 * 1.4, 18 * 1.4] as const;

/**
 * Visible sun/moon practical, on the key axis above the south-west roofline.
 * In frame for the south-facing #rules camera (contre-jour over the gate),
 * behind the camera for the north-facing board stations.
 */
const SKY_BODY_POSITION = [-26 * 0.78, 12 * 0.78 + 1.2, 18 * 0.78] as const;

/**
 * The plaza theme definition. `SeasonWorld.routeThemeId === 'plaza'`
 * (the evoliga world) resolves to this via `resolveRouteTheme`.
 */
export const plazaTheme: RouteThemeDefinition<PlazaPaletteExt> = {
  id: 'plaza',
  stations: PLAZA_STATIONS,
  // Capture stills `scrollIntoView({block:'start'})` while the conductor has
  // already entered the next interval (PB-013) — these two board stations pin
  // at their integer endpoint while start-aligned.
  holdIds: ['pulse', 'schedule'],
  paletteExtension: plazaPaletteExtension,
  lights: {
    keyDirection: KEY_LIGHT_DIRECTION,
    keyPosition: KEY_LIGHT_POSITION,
    skyBodyPosition: SKY_BODY_POSITION,
  },
  // C-089: the hero-prop GLB families (Meshy props, 14–20 k tris each) never
  // join a static batch — named roots only; stone courses and rails still do.
  propFamilyPrefixes: ['hero-prop-', 'street-lamp-prop', 'gate-crest-prop', 'plinth-prop'],
  // LOOK-PLAN §2 L.8 / §5.1: the painted plaza sets (ground, ashlar, slate)
  // replace the cobble / limestone / slate scans; PlazaHall switches on them.
  textureRoles: [...PLAZA_PAINTED_ROLES],
  // LOOK r3 (D23 bytes): the UltraHDR gain-map pair (22 KB day / 165 KB
  // night, was 1206 / 1683 KB radiance). Its decoder draws through
  // `gl.render`, which the load warm's draw hold skips, so WorldEnvironment
  // re-runs the decode and the IBL prefilter inside the warm's raw-render
  // scope before the reveal (`refreshGainmapEnvironment`).
  hdriFormat: PLAZA_HDRI_FORMAT,
  // Yaws put each HDRI's sun/moon over the north jumbotron where the authored
  // sky body sits, so wet-cobble and zinc specular agree with the visible disc.
  // (Same values as the engine's DEFAULT_HDRI_YAW fallback; stated here so the
  // theme owns its art direction independently of the engine default.)
  hdriYaw: {
    gold: Math.PI * 0.62,
    night: Math.PI * 0.55,
  },
  // LOOK r3: no `environmentIntensity` — the scene keeps the engine's
  // shipped IBL (0.72 × exposure / 0.55), so every unpainted material (data
  // faces, plaques, the ledger) renders as before. The art-directed IBL of
  // painted materials is `paint.{day,night}.ibl.environment`.
  // D19 painterly light model, plus the skin the plaza opts into (ROLLOUT
  // §2.2 a): every flag on, the pilot's sky, skyline, canopy, rig tuning and
  // vignette — each today's literal, moved and not changed.
  paint: {
    ...PLAZA_PAINT,
    features: PLAZA_PAINT_FEATURES,
    sky: PLAZA_SKY_PRESET,
    skyline: PLAZA_SKYLINE_SPEC,
    canopy: PLAZA_CANOPY_LOOK,
    rig: DEFAULT_RIG_TUNING,
    vignette: PLAZA_VIGNETTE_DARKNESS,
  },
  focusVocabulary: {
    kinds: ['board', 'ace', 'desk-pc', 'plaque', 'figure'],
    panelParams: ['team', 'mon', 'board', 'rules'],
  },
};

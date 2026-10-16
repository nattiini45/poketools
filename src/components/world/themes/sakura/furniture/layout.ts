/**
 * Sakura Park — physical layout anchors (pure data, no client imports).
 *
 * World units are meters; the plaza convention holds: +X east, +Z south, +Y
 * up, center at the origin. The park is a ring of furniture around a lawn
 * with an elliptical lake in its north half; the five station cameras stand
 * on the south lawn (see `../theme.ts` for the authored endpoints and their
 * no-closer-camera quotations).
 */

import type { TeamsSitePlan } from '@/lib/route-world/teams-formation';

/** The lake: an ellipse in the park's north half. */
export const LAKE = {
  x: 0,
  z: -8.5,
  /** Semi-axis along X (east-west), metres. */
  rx: 10,
  /** Semi-axis along Z (north-south), metres. */
  rz: 4.8,
  /** Water surface height above the lawn. */
  y: 0.06,
} as const;

/** The lake island the bridge reaches — a small shrine islet. */
export const ISLAND = { x: 2.2, z: -9.2, r: 2.1 } as const;

/** The pulse hero: the jumbotron rock on the north-west shore. */
export const ROCK = { x: -6.5, z: -14.8, faceYaw: 0.63 } as const;

/**
 * The schedule hero: festival banner row on the north-east shore. C-102 r2:
 * spacing 1.7 → 2.3 — the cloths widened to 2.0 m (FestivalBanners) so the
 * floored banner text holds whole words; 2.3 m pole spacing keeps a 0.3 m
 * gap between neighbours and the row (poles 5.2 ± 4.6, cloths to x ≈ 10.8)
 * inside the schedule frame (≈ 14.6 m wide at the banner plane).
 */
export const BANNERS = { x: 5.2, z: -14.6, count: 5, spacing: 2.3 } as const;

/** Desktop cloth width (metres) — the C-102 r2 2.0 m nobori at its 1:3 canvas. */
export const BANNER_CLOTH_W = 2.0;

/**
 * Fidelity W1 r4 — the MOBILE row (mountain's `signSeatsFor` law, sakura's
 * flat row). At the landed 390 pose (frozen `cameraMobile` + the rig's
 * 9.75 m pullback) the 2.0 m cloths at 2.3 m pitch spanned ndcX ±1.135 —
 * FIXTURES lost its first letters and TABLE its last (≈ 26 px off each
 * edge). Derived from that frustum (grid search, cloth corners projected
 * exactly as FestivalBanners mounts them): 1.68 m cloths at 1.87 m pitch
 * span ±0.928 — ≥ 14 px of margin each side on a 390 px frame — with
 * 6–7 px of air at every seam. The cloth keeps its 1:3 canvas (5.04 m
 * tall) and the paint path is handed the real face width, so its station
 * floor re-derives the px (text never renders under the floor; rows that
 * no longer fit are counted on a `+N MORE` line). No camera moves.
 */
export const BANNER_CLOTH_W_MOBILE = 1.68;

/** Mobile pole pitch (metres) — see `BANNER_CLOTH_W_MOBILE`. */
export const BANNER_PITCH_MOBILE = 1.87;

/** Cloth width and pole pitch for the pose the rig lands on. */
export function bannerRowFor(mobile: boolean): { clothW: number; pitch: number } {
  return mobile
    ? { clothW: BANNER_CLOTH_W_MOBILE, pitch: BANNER_PITCH_MOBILE }
    : { clothW: BANNER_CLOTH_W, pitch: BANNERS.spacing };
}

/** The roster hero: the lantern shrine wall on the west edge. */
export const SHRINE = { x: -13.8, z: 0, length: 9.4, height: 2.3, lanterns: 5 } as const;

/**
 * The teams hero: the east statuary terrace — since fidelity wave 2 (seat
 * 2G, D16) a ZIPPER FORMATION in standings order over a Roll-Call Ledger
 * (`teams-formation.ts`): odd ranks on the lawn, even ranks on a rear riser
 * at a half-pitch offset, so the screen order is 1 … N; one leaning walnut
 * ledger rail at the forecourt front edge names every trainer under their
 * statue (the per-pedestal plaques are gone). The riser height, the pitch
 * and every seat are computed from the live roster (`site`), never authored
 * per slot.
 *
 * Anchors are angle-checked against the #teams pose (theme.ts: eye
 * [5.2, 2.55, 0.2] → target [13.5, 1.7, 0], fov 42). The ledger face stands
 * ≈ 4.7 m from the eye (x ≈ 9.9); nothing may stand between it and any eye
 * that reads it (the keep-out wedge, data-surfaces.ts) — the flankers and
 * bookends below were re-sited out of it (see each note).
 */
export const ACES_LINE = {
  x: 13.5,
  spacing: 2.4,
  /**
   * Avenue flankers. Wave 2 (2G): the r3 seats (8.4, 1.8) / (10.0, −2.2)
   * stood between the eye and the ledger face — inside its wedge from the
   * desktop and landed-390 eyes. They step behind the ledger's face plane
   * and out to the formation's flanks.
   */
  flankers: [
    { x: 11.4, z: 5.2 },
    { x: 11.4, z: -5.2 },
  ],
  /**
   * The formation plan (teams-formation.ts `TeamsSitePlan`): front pedestal
   * line at x 13.0 on the lawn; AceStatuary pedestal cap PEDESTAL_CAP_H
   * 0.99 m, FOOT_HALF 0.52 (restated); the rear riser row 1.5 m behind.
   */
  site: {
    anchor: { x: 13.0, z: 0 },
    groundY: 0,
    pedestal: { capH: 0.99, half: 0.52 },
    rowGap: 1.5,
    maxPitch: 2.4,
    ledger: { distance: 4.7, gapNdc: 0.035, thickness: 0.16, margin: 0.05, endCap: 0.3 },
  } satisfies TeamsSitePlan,
  /** Coursed blocks along the rear riser (its extent/height come from the formation). */
  riserCourses: 7,
  /** Back lantern rank behind the terrace — the park's east rhythm. */
  backLanterns: { x: 16.3, count: 8, spacing: 2.4, scale: 0.95 },
  /**
   * Foreground bookend lanterns (the plaza's framing lamps, sakura stone).
   * Wave 2 (2G): behind the ledger's face plane and outside its span — the
   * names no longer live on the pedestals, so the C-102 plaque-corridor
   * reasoning (z 4.1) is retired; the bookends now frame the formation.
   */
  // Wave-2 r2: 0.6 m back toward the eye and 0.4 m out — the right bookend
  // stood in front of rank 10 at 768 / 390 (teams-formation.test.ts keep-out).
  bookends: { x: 10.6, z: 5.0, scale: 1.85 },
  /** Paved forecourt (stepping stones) under and around the row. */
  forecourt: { x0: 12.6, x1: 16.0, halfZ: 5.4 },
  /** Supporting props (angle-checked inside the 1440 frame). */
  // Wave-2 r2 (TEAMS judge: the sign sat over rank 8's plinth): out on the
  // right flank, outside every ace column and focus shot at 1440 / 768 / 390.
  ema: { x: 11.9, z: 6.0 },
  /**
   * Wave-2 r2 (TEAMS judge: "three flag poles cut through" rank 1, and the
   * rank-1 focus shot looked through two of them): the cluster steps out to
   * the left flank, outside the 1440 / 768 / 390 frames and every `?team=`
   * focus shot (teams-formation.test.ts keep-out).
   */
  pennants: [
    { x: 12.5, z: -5.15, h: 2.6 },
    { x: 12.72, z: -5.5, h: 3.0 },
    { x: 12.3, z: -5.45, h: 2.3 },
  ],
  /**
   * Rope-railing posts, the rope hung from the post caps (Props.tsx).
   * Wave-2 r2 (TEAMS judge: the rope ran across rank 7's pedestal): the run
   * steps out to the right flank past the sign, outside every ace column
   * and focus shot at 1440 / 768 / 390 (teams-formation.test.ts keep-out).
   */
  railing: { x: 12.9, posts: [5.1, 5.9, 6.7] },
} as const;

/**
 * The pulse surround (C-093 r3): the rock keeps its landmark; its shore gets
 * dressed — a wood fence line between the lake's north edge and the boulder,
 * a flanking lantern pair, blossom planting beds, two foot boulders and a
 * direction signpost — so the board sits in a dressed shore scene. All
 * anchors angle-checked against the #pulse pose (eye [2.4, 3.4, -2.6] →
 * target [-5.0, 2.7, -12.4], fov 42): at the shore plane (s ≈ 13-16) the
 * frame spans ≈ ±8-10 m, so the fence (x -10.6..-2.6 at z = -13) and every
 * prop land well inside it. The fence sits on dry ground: the lake's north
 * edge at those x reaches only to z ≈ -12.15.
 */
export const PULSE_SURROUND = {
  /** Fence ends inside the dry band: at z=-13 the lake's water test
   * ((x/10)² + ((z+8.5)/4.8)² ≥ 1) fails east of x ≈ -3.5, so the east post
   * sits at -3.9. */
  fence: { x0: -10.6, x1: -3.9, z: -13.0, posts: 5, railY: [0.5, 0.92] },
  lanterns: [
    { x: -9.7, z: -13.4, scale: 1.35, practical: true },
    { x: -3.1, z: -13.6, scale: 1.15, practical: false },
  ],
  /** Blossom beds on the shore band between the lake edge and the fence. */
  beds: [
    { x: -9.3, z: -12.6 },
    { x: -8.4, z: -12.45 },
    { x: -3.9, z: -13.05 },
  ],
  boulders: [
    { x: -8.2, z: -13.8, r: 0.5 },
    { x: -4.2, z: -14.2, r: 0.3 },
  ],
  signpost: { x: -2.3, z: -13.4 },
  /** Viewing-gap paving in the dry sand between the two west beds. */
  gapStones: { x0: -7.6, x1: -5.4, z0: -12.75, z1: -12.25 },
} as const;

/**
 * The roster wall's dressing (C-093 r3): a stone base course, a timber
 * header beam on two framing end posts, a flanking ground-lantern pair,
 * planted shrub edges and stepping-stone aprons north and south of the path
 * mouth — built structure, not a pressed panel. Angle-checked against the
 * #roster pose (eye [-5.2, 2.45, 0.4] → target [-13.5, 1.45, 0], fov 40): at
 * the wall plane the frame spans ≈ ±4.6-5.0 m, so the end posts at z = ±4.95
 * sit just inside the edges (framing) and the aprons' outer corners (±4.6)
 * stay inside. Aprons keep |z| ≥ 1.3 clear of the crossing path strip.
 */
export const SHRINE_DRESSING = {
  /**
   * C-102 r3: h 0.42 → 0.22 — the proud base course's top edge was itself an
   * occluder: the r2 470 px tile re-flow put the bottom band row's baseline at
   * canvas y 442 (world y 0.365 on the frieze plane x −13.44), and the sight
   * line from the #roster eye (y 2.45) to it passes the course's front face
   * (x −13.31) at y 0.40 < 0.42 — the course clipped the row's descender band
   * (the r2 visual review's "wall ledge half-clips the bottom band row"). At h 0.22 the
   * same ray's occlusion boundary lands at canvas y ≈ 475–485 (desktop and
   * landed-390 poses), below the bottom tile card's edge (canvas y 468).
   */
  baseCourse: { x: -13.62, w: 0.62, h: 0.22, length: 9.9 },
  headerBeam: { x: -13.48, y: 2.56, w: 0.3, h: 0.16, length: 10.1 },
  endPosts: { z: 4.95, x: -13.5, side: 0.55, height: 2.85 },
  /**
   * C-102 r3: z ±3.9 → ±5.8 — the sight-corridor law recomputed
   * for the WIDER r2 frieze face (world z ±4.7 at x −13.44). At z ±3.9 each
   * lantern's corridor band (t = 0.916 desktop: face_z ≈ 0.4 +
   * (z_sl − 0.4)/t over the body z_sl ∈ 3.9 ± 0.425) covered face_z ≈
   * [3.76, 4.68] — exactly the frieze's canvas-left column leading text ("05"
   * of MANKEY, "GE" of GEODUDE-ALOLA), and mirrored for the canvas-right
   * column's band-line ends. No in-frame position at this depth can clear:
   * the wall's text extends to the frame edge (face_z ±4.40 of ±4.7), so an
   * occluder's corridor always lands on text — the only clear z is BEYOND the
   * wall ends. ±5.8 (clear of the ±4.95 end posts' 0.66 caps at 5.28) puts
   * the corridor at face_z ≈ [5.84, 6.76] desktop / [5.73, 6.65] landed-390 —
   * over a metre clear of the face; the pair stays at the wall's flanks as
   * world dressing outside both station frusta.
   */
  flankLanterns: [
    { x: -12.75, z: -5.8, scale: 1.25, practical: true },
    { x: -12.75, z: 5.8, scale: 1.25, practical: false },
  ],
  /**
   * Planted shrub edges along the wall foot. C-102 r3: x −12.7 → −12.35 and
   * scale-capped (s ≤ 0.85) — the shrub blobs' tops (0.74·s) poked above the
   * bottom-band-row sight lines at the wall foot (0.553 m at x −12.7; 0.639 m
   * at x −12.35, both poses), and the two outer shrubs' corridor face bands
   * ([2.64, 3.65] / [−3.73, −2.72] at x −12.7) covered tile 09's band tail and
   * tile 12's band leading "1" once the lantern/ledge clips were gone. At
   * −12.35 with s ≤ 0.85 the tops (0.59–0.63 m) sit under the band glyph rays
   * (0.64–0.68 m at the blob depths); rows 1–2 sight lines (≥ 1.05 m) are far
   * out of reach.
   */
  /*
   * Fidelity wave 2 r2 (W1 keep-out): the ray-height law above held for the
   * station eyes only. The roster:wall FOCUS pose (and the pulse→roster dolly)
   * stands closer and lower, and the live occlusion verdict caught the blobs
   * on the bottom row (0.09 at 1440). Every in-span seat is inside the padded
   * face wedge (data-surface-keepout.test boxes them as `roster-shrub:*`), so
   * the planting moves off the wall foot to the flanks, outboard of the
   * ±5.8 lantern pair, where no station, focus or dolly eye reads the wall.
   */
  shrubs: [
    { x: -12.0, z: -7.15, s: 0.8 },
    { x: -12.35, z: -6.55, s: 0.85 },
    { x: -12.35, z: 6.55, s: 0.85 },
    { x: -12.0, z: 7.15, s: 0.8 },
  ],
  aprons: [
    { x0: -13.35, x1: -12.35, z0: 1.3, z1: 4.6 },
    { x0: -13.35, x1: -12.35, z0: -4.6, z1: -1.3 },
  ],
} as const;

/** The rules hero: the great torii at the south entrance. */
export const TORII = {
  x: 0,
  z: 15.5,
  /** Centre-to-centre pillar spacing. */
  span: 7.2,
  /** Overall height to the kasagi top. */
  height: 6.4,
  /**
   * The sandō lantern sites beside the 2.4 m south path (half-width 1.2, so
   * 2.2 clears it), mirrored to -x: the mid-ground pair the 21 m rules pose
   * otherwise reads past as empty lawn (C-093 r2). The C-102 rework seats
   * the GLB `sakura-stone-lantern-tall` pair on these exact sites (see
   * SAKURA_PROPS) — the procedural pair is retired with them.
   */
  approachLantern: { x: 2.2, z: 9.5 },
} as const;

/**
 * C-102 rework placements — the tree-ring, figure-habitation and GLB-prop
 * anchors. Every band below honours the placement laws of record:
 *
 *  - Ground-path clearances: south path |x| < 1.2, crossing
 *    path |z| < 1.1 → standing anchors keep ≥ 1.3 m off both strips.
 *  - Lake water test: (x/10)² + ((z+8.5)/4.8)² ≥ 1 — every
 *    north-shore anchor sits on dry ground (checked per anchor below).
 *  - Hero sight lines: worst-case canopy reach of the shared
 *    tree system is `0.46·h + 2.33` m (branch reach 0.46 h + card jitter
 *    0.45·cardScaleM + rotated-card half-diagonal 0.71·1.3·cardScaleM);
 *    band heights are capped per band so every hero face plane keeps
 *    ≥ 1.3 m, and the bands moved OUT (north z ≤ −21.4, west/east |x| ≥ 20.4)
 *    relative to the old instanced ring so the taller real trees clear the
 *    banner row (z −14.6) and the shrine/ace walls (x ∓13.5). The anchors
 *    behind the board/banner CONTENT spans and the landed-390 camera cones
 *    were additionally placed by projecting every grown crown through the
 *    five authored desktop poses AND the landed 390 poses (the
 *    projection law) so no card paints over a content face — the scan of
 *    record is persisted as gauntlet/evidence/_cC102r1-tree-scan.log.
 */

/** One real-tree placement: anchor, crown height, deterministic seed, skin. */
export interface TreePlacement {
  x: number;
  z: number;
  heightM: number;
  seed: number;
  skin: 'cherry' | 'park';
}

/** Worst-case horizontal canopy reach (metres) of a shared-system tree. */
export function treeCanopyReachM(heightM: number, cardScaleM: number): number {
  return 0.46 * heightM + 0.45 * cardScaleM + 0.71 * 1.3 * cardScaleM;
}

const CHERRY_TREE_ROWS: readonly (readonly [number, number, number])[] = [
  // North band — the backdrop behind the rock and the banner row. Anchors at
  // z ≤ −21.5 with h ≤ 7.2 keep the canopy ≥ 1.3 m north of the banner plane
  // (−21.5 + 0.46·7.2 + 2.33 = −15.96 vs −14.6); the four anchors behind the
  // rock/banner CONTENT spans sit deeper (z ≤ −22.7) — at the LANDED 390
  // poses (angle-check the LANDED pose, not the endpoint)
  // their crowns otherwise drape onto the board/banner faces (the r1
  // pre-matrix scan found 118 card samples inside the schedule crop from
  // (4.4, −22.2) alone).
  [-13.0, -24.6, 7.0], [-10.4, -22.7, 6.2], [-8.1, -22.2, 7.2], [-3.4, -21.6, 5.8],
  [-0.6, -22.4, 6.6], [2.0, -21.4, 7.1], [-5.6, -23.2, 6.0], [14.8, -24.0, 6.9],
  [17.6, -25.2, 5.7], [12.4, -21.6, 6.4],
  // West band — behind the shrine wall (wall face x ≈ −13.5). x ≤ −20.4 with
  // h ≤ 6.4 keeps the canopy ≥ 1.4 m west of the face (−20.4 + 5.27 = −15.13).
  [-20.6, -9.0, 6.2], [-21.2, -6.0, 5.4], [-20.4, -3.0, 6.4], [-21.3, 0.2, 5.8],
  [-20.5, 3.2, 6.3], [-21.1, 6.0, 5.5], [-20.4, 9.2, 6.1],
  // East band — behind the ace terrace, mirrored clearances; the two
  // southernmost sit at the NE corner (z ≤ −13.4): the landed 390 pulse
  // camera hangs at (16.7, 5.8, −7.3) and a crown at (21.2, −6) filled its
  // frame edge (52 crop samples) — same landed-pose law as the north band.
  [21.6, -13.4, 6.0], [23.2, -16.2, 5.6], [20.4, -3.0, 6.4], [21.3, 0.4, 5.9],
  [20.6, 3.4, 6.2], [21.0, 6.2, 5.4], [20.4, 9.0, 6.3],
];
const PARK_TREE_ROWS: readonly (readonly [number, number, number])[] = [
  // South band — flanking the sandō approach (clear of x = ±1.3 and of the
  // GLB approach lanterns at ±2.2, 9.5); h ≤ 6.9 keeps the canopy ≥ 1.3 m
  // off the path strip.
  [-12.0, 14.6, 6.6], [-9.0, 15.2, 7.0], [-6.8, 14.0, 5.8],
  [6.8, 14.1, 6.2], [9.0, 15.3, 6.9], [12.0, 14.2, 6.4],
  // Shore accents. The north-west accent stands at (−17.0, −10.4): ≥ 4 m
  // west of the rock screen's west end (x ≈ −8.42) with its canopy never
  // crossing the screen plane, and OUT of the landed 390 pulse cone (the
  // first draft at (−14.4, −12.1) hung 73 card samples inside the board
  // crop). The south-east accent at (13.6, −13.2) keeps the NE shore dressed
  // clear of the banner row (5.2 m from its east pole) and out of the same
  // landed cone.
  [-17.0, -10.4, 4.6], [13.6, -13.2, 5.0], [-11.5, -5.5, 4.4], [11.8, -4.8, 4.8],
];

/** The park's real-tree ring: 24 cherry + 10 park varieties, seeded. */
export const TREE_PLACEMENTS: readonly TreePlacement[] = [
  ...CHERRY_TREE_ROWS.map(([x, z, h], i) => ({ x, z, heightM: h, seed: 2100 + i, skin: 'cherry' as const })),
  ...PARK_TREE_ROWS.map(([x, z, h], i) => ({ x, z, heightM: h, seed: 2300 + i, skin: 'park' as const })),
];

/**
 * The #pulse grandstand (criterion 1): the participants' aces in two
 * staggered ranks on the dry north shore BETWEEN the jumbotron rock and the
 * banner row — in the pulse frame (which spans ≈ x −14..1 at that depth),
 * behind the C-093 r3 shore fence line (z −13.0) so the fence reads as the
 * stand rail. Clearances: every slot ≥ 1.3 m off the signpost (−2.3, −13.4),
 * the west banner pole (1.8, −14.6), the boulder's ground footprint (east
 * edge ≈ −2.1, −15.2) and the lake ellipse. Yaw: each figure turns to the
 * authored pulse eye (theme.ts pulse camera position [2.4, 3.4, −2.6]).
 */
export const GRANDSTAND = {
  eye: { x: 2.4, z: -2.6 },
  slots: [
    { x: -3.4, z: -14.35 }, { x: -2.45, z: -14.35 }, { x: -1.5, z: -14.35 }, { x: -0.55, z: -14.35 },
    { x: -3.85, z: -16.2 }, { x: -2.9, z: -16.2 }, { x: -1.95, z: -16.2 }, { x: -1.0, z: -16.2 },
  ],
} as const;

/**
 * Pool-driven ambient wilds (criterion 1): thematically fitted water/bug
 * lines, one `station` window each (the residency latch mounts them when
 * the visitor first enters and never unmounts). All species resolve in the
 * manifest; the named ones carry real `idle` clips (the motion-proof law:
 * many manifest entries are rest-pose only). The Vaporeon/Slowpoke pair
 * west shore gap — Vaporeon deliberately idle-clipped and IN the pulse
 * frame for the two-frame motion proof.
 */
export interface WildSpot {
  species: string;
  x: number;
  z: number;
  yaw: number;
  /** First station index whose entry mounts this wild (residency latch). */
  station: number;
}

export const WILD_SPOTS: readonly WildSpot[] = [
  // Pulse window — every anchor projected through BOTH the authored desktop
  // pose and the LANDED 390 pose (the projection law): the board
  // face covers desktop px ≈ 390–1090 (py 295–600) and the landed-pose
  // legibility crop covers its mid-band, so the wilds read BELOW the board's
  // sill at both poses. Lake test ≥ 1 dry everywhere.
  { species: 'Vaporeon', x: -2.0, z: -13.4, yaw: 0.9, station: 0 }, // idle clip — the motion-proof figure
  { species: 'Lombre', x: -2.6, z: -17.3, yaw: 2.6, station: 0 }, // idle clip
  // Roster window — flanking the shrine sight line AT wall depth: near-ground
  // figures (< 9.8 m) fall below the roster frustum, so these stand beside
  // the wall's z-ends (px 261 / ≈1150, both IN at the authored pose), ≥ 1.3 m
  // off the crossing path and clear of the dressing shrubs/lanterns.
  { species: 'Psyduck', x: -11.9, z: 2.6, yaw: Math.PI * 0.85, station: 1 },
  { species: 'Poliwag', x: -12.2, z: -2.6, yaw: Math.PI * 1.15, station: 1 },
  // Teams window — approach flankers at terrace depth (px ≈1145-1160, IN).
  // C-102 r2: the widened 1.4 m plaques yaw to the eye, and their text sight
  // bands leave no near-x gap wide enough for a tiny-stance pedestal between
  // them — Marill moves from (11.9, 2.6) to the row's south approach end,
  // whose sight line projects past the row (the engine pedestal no longer
  // crosses any plaque); Squirtle stays at its empirically clear flanker.
  // Fidelity wave 2 (seat 2G, D16): the Roll-Call Ledger's top edge sits
  // just under the front pedestals' feet on screen, so a ground figure in
  // the forecourt strip between the ledger and the front row reads BEHIND
  // it — Squirtle's old flanker (12.0, −2.4) went 67 % / 100 % hidden
  // (desktop / landed 390). Re-sited by the analytic scan to the formation's
  // south-east end, at front-row depth (0 % hidden at both poses, clear of
  // every data wedge), turned to the #teams eye.
  { species: 'Marill', x: 11.9, z: -4.9, yaw: -0.92, station: 2 }, // idle + walk clips; tiny → pedestal
  { species: 'Squirtle', x: 13.1, z: 4.1, yaw: -2.03, station: 2 },
  // Schedule window — the north-east shore beside/behind the banner row's
  // east end (≥ 1.3 m from the east pole (9.8, −14.6);
  // lake test dry; the landed-390 schedule crop stays clear). Gyarados is
  // the colossal demo
  // (6.5 m → the mounter grounds it): the lake leviathan looming behind the
  // banner row, head and coils clearing the cloth tops.
  { species: 'Wingull', x: 8.8, z: -15.9, yaw: 3.5, station: 3 },
  { species: 'Azumarill', x: 9.7, z: -16.4, yaw: 3.2, station: 3 },
  { species: 'Slowpoke', x: 8.0, z: -17.3, yaw: 2.9, station: 3 },
  { species: 'Gyarados', x: 12.3, z: -16.9, yaw: 3.3, station: 3 }, // colossal → grounded
  // Rules window — the sandō approach and the south tree band's bug line
  // (all ≥ 1.3 m off the south path; clear of the GLB lantern sites ±2.2).
  { species: 'Wartortle', x: -2.5, z: 6.4, yaw: 0.3, station: 4 },
  { species: 'Grubbin', x: 2.6, z: 6.3, yaw: -0.4, station: 4 }, // tiny → pedestal
  { species: 'Ariados', x: -3.8, z: 12.4, yaw: 0.2, station: 4 }, // idle clip
  { species: 'Venonat', x: 3.8, z: 12.4, yaw: -0.2, station: 4 },
];

/**
 * The C-107 GLB prop seats (criterion 3), mounted through the shared prop
 * pipeline and named `sakura-prop-*` — the prefix theme.ts declares in
 * `propFamilyPrefixes` so the static batcher never merges the named roots
 * (the old "No GLB prop families in sakura" comment flips with
 * this table).
 *
 *  - `sakura-torii-hero` (recorded bounds 5.72 × 4.39 m): the second gate of
 *    the sandō, 2.3 m SOUTH of the great procedural torii (kasagi half-span
 *    4.78) so the pair reads as nested gates; pillars at ±~2.4 clear the
 *    2.4 m path, and at 23.6 m from the rules eye the GLB gate stands fully
 *    BEHIND the rules plaque plane (z 15.8) — it never occludes content.
 *  - `sakura-stone-lantern-tall` ×2 on the TORII.approachLantern sites
 *    (±2.2, 9.5) — the mid-ground practicals the rules pose reads past.
 *  - `sakura-stone-lantern-low` ×4 pacing the path: (±2.4, 6.3) and
 *    (±2.4, 12.6), centres ≥ 1.3 m off the strip.
 */
export const SAKURA_PROPS = {
  toriiHero: { prop: 'sakura-torii-hero', x: 0, z: 17.8, yaw: 0 },
  lanternTall: [
    { x: TORII.approachLantern.x, z: TORII.approachLantern.z },
    { x: -TORII.approachLantern.x, z: TORII.approachLantern.z },
  ],
  lanternLow: [
    { x: 2.4, z: 6.3 },
    { x: -2.4, z: 6.3 },
    { x: 2.4, z: 12.6 },
    { x: -2.4, z: 12.6 },
  ],
} as const;

/** The bridge: from the east shore onto the island. */
export const BRIDGE = {
  from: { x: 6.9, z: -7.3 },
  to: { x: ISLAND.x + 1.55, z: ISLAND.z - 0.35 },
  width: 1.6,
  rise: 0.55,
} as const;

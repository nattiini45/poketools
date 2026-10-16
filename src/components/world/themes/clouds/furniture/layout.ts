/**
 * Skyisle — physical layout anchors (pure data, no client imports).
 *
 * World units are metres; the route convention holds: +X east, +Z south, +Y
 * up, center at the origin. The world is a sky-island chain adrift above a
 * shader-driven cloud sea (y −7): five station isles — the summit isle with
 * the moored flagship (pulse, north-west), the register isle with its
 * broadside roster airship (west), the aces isle with its float row (east),
 * the fixtures isle with its moored board airship (north-east) and the halo
 * gate isle at the south entrance — plus the light-bridge arcs that chain
 * them together and the small scatter islets far out over the sea.
 *
 * Every content face centre coincides EXACTLY with its station camera's
 * target (`theme.ts`), and every control point for the bridges is swung
 * clear of the five sight corridors (checked against each pose's frame
 * span before the captures; see BRIDGES).
 */

import type { KeepOutBox } from '@/lib/route-world/data-surfaces';
import type { TeamsSitePlan } from '@/lib/route-world/teams-formation';

/** One floating isle: centre (x, z), rim radius, top surface height. */
export interface Isle {
  x: number;
  z: number;
  /** Rim radius (metres) of the top disc. */
  r: number;
  /** Height of the top surface (the meadow disc). */
  top: number;
  /** Depth of the inverted soil cone below the rim. */
  depth: number;
}

/**
 * The five station isles. The roster and teams isles keep the siblings'
 * pinned authoring geometry (the content plane sits on the same
 * eye→target axis, 8.37 m / 8.35 m off the authored eyes — the sanctioned
 * identical-geometry pattern), so their isle centres sit on that axis.
 */
export const ISLES: Record<'pulse' | 'roster' | 'teams' | 'schedule' | 'rules', Isle> = {
  pulse: { x: -8.5, z: -14.5, r: 5.6, top: 2.2, depth: 5.2 },
  roster: { x: -14.6, z: 0, r: 4.4, top: 0.8, depth: 4.6 },
  teams: { x: 13.5, z: 0, r: 4.4, top: 0.95, depth: 4.6 },
  schedule: { x: 6.0, z: -14.0, r: 5.0, top: 1.6, depth: 5.0 },
  rules: { x: 0, z: 15.6, r: 5.6, top: 1.2, depth: 5.4 },
};

/** The cloud sea's surface height (every isle hangs well above it). */
export const SEA_Y = -7;

/**
 * Light-bridge arcs. `from`/`to` name station isles; `ctrl` is the bezier
 * control point (x, z) the arc swings through — swung AWAY from the sight
 * corridors:
 *  - pulse→roster swings west (clear of the pulse NW corridor).
 *  - roster→teams (the Grand Crossing) runs NORTH of both content walls
 *    (z ≤ −1.9 at its attach points, below the walls' sight rays) and north
 *    of the rules corridor's eye (z −5.8 is where that camera STANDS — the
 *    bridge lies north of it, out of its frustum).
 *  - teams→schedule swings east (clear of the schedule NE corridor).
 *  - rules→`satellite` is a short mooring span east of the rules approach.
 * Deck height arcs from attach-point isle top down to a gentle crown.
 */
export const BRIDGES: readonly {
  from: keyof typeof ISLES | 'satellite';
  to: keyof typeof ISLES | 'satellite';
  /** Bezier control point (x, z) the arc swings through. */
  ctrl: readonly [number, number];
  /** Crown lift (metres) above the lerp of the endpoint heights, mid-arc. */
  crown: number;
}[] = [
  { from: 'pulse', to: 'roster', ctrl: [-16.5, -7.5], crown: 1.1 },
  { from: 'roster', to: 'teams', ctrl: [-0.5, -8.0], crown: 1.3 },
  { from: 'teams', to: 'schedule', ctrl: [12.5, -7.0], crown: 1.1 },
  { from: 'rules', to: 'satellite', ctrl: [2.3, 16.6], crown: 0.5 },
];

/** The satellite islet east of the halo gate (the short mooring span's far end). */
export const SATELLITE: Isle = { x: 4.6, z: 17.2, r: 1.6, top: 0.9, depth: 2.4 };

/**
 * Scatter islets far out over the sea — depth dressing for the wide poses,
 * sited in the far corners outside every station frustum's content span.
 */
export const SCATTER_ISLES: readonly Isle[] = [
  { x: -17.5, z: -8.5, r: 1.9, top: 0.5, depth: 2.6 },
  { x: 18.0, z: -8.0, r: 1.6, top: 0.8, depth: 2.4 },
  { x: -12.0, z: 18.5, r: 1.7, top: 0.6, depth: 2.5 },
  { x: 12.5, z: 19.0, r: 1.4, top: 0.4, depth: 2.2 },
];

/**
 * Hull centre from a face centre: the face plane pushed back along its own
 * normal by the hull radius, so the sail sits exactly ON the flank (and the
 * face centre keeps coinciding with the authored camera target).
 */
function hullCentre(
  face: { x: number; y: number; z: number },
  faceYaw: number,
  hullRadius: number,
  hullLift: number,
): { x: number; y: number; z: number } {
  return {
    x: face.x - Math.sin(faceYaw) * hullRadius,
    y: face.y + hullLift,
    z: face.z - Math.cos(faceYaw) * hullRadius,
  };
}

/** Shared airship anchor set — face geometry plus its derived hull centre. */
export interface Airship {
  face: { x: number; y: number; z: number };
  faceW: number;
  faceH: number;
  faceYaw: number;
  hull: { x: number; y: number; z: number };
  hullLength: number;
  hullRadius: number;
  hullYaw: number;
  /** Offset of the hull along its long axis (local +X), metres. The face
   * stays exactly on the authored camera target; the shift slides the
   * envelope so bow/stern/fins read BESIDE the sail instead of hiding
   * directly behind it. */
  hullShift: number;
  /** The C-107 GLB hull body (register ship only): world centre, uniform
   * scale and broadside yaw. Present ⇒ the procedural envelope stays
   * unmounted and the prop reads instead (C-104 criterion 3). */
  hullProp?: { x: number; y: number; z: number; scale: number; yaw: number };
}

/** Flagship anchor values (face + envelope), before the hull derivation.
 * hullYaw = faceYaw: at equal yaw the ellipsoid's LONG axis (local +X) sits
 * perpendicular to the face normal — broadside to the eye. (A π/2 offset
 * aimed the long axis AT the camera and the hull read as a ball covering
 * the board — first-capture fix.) */
const FLAGSHIP_ANCHORS = {
  face: { x: -6.5, y: 4.5, z: -13.0 },
  faceW: 7.0,
  faceH: 7.0 * (9 / 16),
  faceYaw: 0.7045,
  hullLength: 7.6,
  hullRadius: 1.25,
  hullLift: 0.85,
  hullYaw: 0.7045,
  /** Bow swings right of the sail — fins and gondola clear the board edge. */
  hullShift: 2.4,
} as const;

/** Register airship anchor values, before the hull derivation. */
const REGISTER_ANCHORS = {
  face: { x: -13.5, y: 1.45, z: 0 },
  faceW: 5.6,
  faceH: 5.6 * (5 / 12),
  faceYaw: Math.atan2(8.3, 0.4),
  hullLength: 6.6,
  hullRadius: 1.05,
  hullLift: 0.9,
  hullYaw: Math.atan2(8.3, 0.4),
  /** C-104 r1: 1.2 → 3.2 — the GLB hull slid 3.2 m north along its long
   * axis, so its bow/fins/propeller read BESIDE the sail's north edge
   * instead of hiding wholly behind it (hullShift law). */
  hullShift: 3.2,
  /** The C-107 Blender-built zeppelin (clouds-airship-hull) replaces the
   * procedural envelope as the broadside ship body (C-104 criterion 3).
   * The recorded bounds are 8.49 × 3.72 × 2.71 m with the long axis on X —
   * the hullYaw law mounts it at hullYaw so the long axis reads broadside.
   * Scale 0.72 keeps the hull's aft-spring clear of the sail plane
   * (0.72 · 1.355 cross-half-depth = 0.98 ≤ 1.5 pushback − margin) and its
   * keel above the isle's meadow (centre 2.35 − 0.72 · 1.86 = 1.01 ≥ 0.8). */
  hullPropScale: 0.72,
  hullPropPushback: 1.5,
} as const;

/** Fixtures airship anchor values, before the hull derivation. */
const FIXTURES_ANCHORS = {
  face: { x: 6.0, y: 2.8, z: -14.0 },
  faceW: 6.6,
  faceH: 6.6 * (9 / 16),
  faceYaw: Math.atan2(1.2 - 6.0, -3.2 - -14.0),
  hullLength: 7.2,
  hullRadius: 1.18,
  hullLift: 0.85,
  hullYaw: Math.atan2(1.2 - 6.0, -3.2 - -14.0),
  /** Bow swings LEFT of the sail — the mooring spire stands left of the
   * board's span, so the tether lands beside the face, never across it
   * (the first capture had the spire dead-centre in the corridor, its mast
   * crossing the board's headline). */
  hullShift: -1.8,
} as const;

function airship(
  anchors: typeof FLAGSHIP_ANCHORS | typeof REGISTER_ANCHORS | typeof FIXTURES_ANCHORS,
): Airship {
  const { face, faceW, faceH, faceYaw, hullLength, hullRadius, hullLift, hullYaw, hullShift } = anchors;
  const ship: Airship = { face, faceW, faceH, faceYaw, hullLength, hullRadius, hullYaw, hullShift, hull: hullCentre(face, faceYaw, hullRadius, hullLift) };
  // The register ship's Blender-built hull body: centred on the face plane
  // pushed back along its own normal by hullPropPushback, then slid
  // hullShift along the long axis so the bow reads beside the sail
  // (hullShift law — the sail stays exactly on the authored
  // camera target).
  if ('hullPropScale' in anchors) {
    const { hullPropScale, hullPropPushback } = anchors;
    ship.hullProp = {
      x: face.x - Math.sin(faceYaw) * hullPropPushback + Math.cos(hullYaw) * hullShift,
      y: face.y + hullLift,
      z: face.z - Math.cos(faceYaw) * hullPropPushback - Math.sin(hullYaw) * hullShift,
      scale: hullPropScale,
      yaw: hullYaw,
    };
  }
  return ship;
}

/**
 * The pulse hero: the FLAGSHIP — the league's standings airship moored
 * above the summit isle. The face centre is the authored #pulse target.
 */
export const FLAGSHIP: Airship = airship(FLAGSHIP_ANCHORS);

/**
 * The roster hero: the REGISTER — a moored airship whose east-flank sail
 * carries the roster frieze. Face centre = the authored #roster target.
 */
export const REGISTER_AIRSHIP: Airship = airship(REGISTER_ANCHORS);

/**
 * The schedule hero: the FIXTURES board airship moored above the NE isle.
 * Face centre = the authored #schedule target.
 */
export const FIXTURES_AIRSHIP: Airship = airship(FIXTURES_ANCHORS);

/**
 * The teams hero: the ACES FLOAT ROW — one moored float per trainer on the
 * aces isle, each carrying a LIVE rider (the trainer's ace, or a fitted
 * sky-pool backfill — SkyFigures). Since fidelity wave 2 (seat 2G, D16) the
 * floats stand in a ZIPPER FORMATION in standings order
 * (`teams-formation.ts`): odd ranks on the isle, even ranks on a rear stone
 * riser at a half-pitch offset, so the screen order is 1 … N; the painted
 * float plaques are gone (they hid the front riders — KNOWN_OCCLUDED
 * `clouds:rider:*`) and one brass Roll-Call Ledger rail at the isle's west
 * kerb names every trainer under their float.
 *
 * With no plaque to clear, the C-104 r2 perch law retires: every rider rides
 * the gondola roof (`riderLift`). The rider stature caps by rank stay (front
 * tiny ≤ 0.5 m, rear ≤ 1.8 m — the crowd-stature law): the riser
 * law is solved for them (`nominal` — the front's tallest tiny over the rear's
 * smallest rider), so every rear rider clears the front heads.
 */
export const FLOAT_ROW = {
  centre: { x: 13.5, y: 1.7, z: 0 },
  /**
   * The formation plan: front float line at x 12.95 on the isle top
   * (ISLES.teams.top 0.95 + the 0.05 deck seat); the "pedestal" is the
   * float — gondola roof `riderLift` over the seat, 0.72 m gondola (half
   * 0.36); the ledger at 5.2 m from the eye (x ≈ 10.4) stays on the isle.
   */
  site: {
    anchor: { x: 12.95, z: 0 },
    groundY: 1.0,
    pedestal: { capH: 0.52, half: 0.36 },
    rowGap: 1.35,
    maxPitch: 2.4,
    ledger: { distance: 5.2, gapNdc: 0.035, thickness: 0.14, margin: 0.05, endCap: 0.3 },
  } satisfies TeamsSitePlan,
  /** Most floats the isle seats (the ledger's two-line bound). */
  maxFloats: 12,
  /** Rider stand height above the float seat: the gondola roof (0.5 m) + deck. */
  riderLift: 0.52,
  /** Rider stature caps by rank (front, rear) — see the note above. */
  riderMaxByRank: [0.5, 1.8],
  /** The riser law's nominal riders: the tallest front tiny, the smallest rear rider. */
  nominal: { front: { heightM: 0.5, footprintM: 0.72 }, rear: { heightM: 0.4, footprintM: 0.72 } },
} as const;

/**
 * The rules hero: the HALO GATE — a standing stone ring on the south isle
 * with the rules plaque hung at its centre. Face centre = the authored
 * #rules target (0, 4.6, 15.6) — hung HIGH inside the ring so the ring's
 * lower arc (inner edge ≈ y 2.6 at x 0, ≈ y 3.4 at the plaque's corners)
 * never crosses the face (the first capture had the arc covering the rules
 * columns); the ring reads whole through the 21.5 m pose (ring diameter
 * 7.2 ≈ 32 % of the frame width).
 */
export const HALO_GATE = {
  face: { x: 0, y: 4.6, z: 15.6 },
  /** Plaque size (5:2), metres — ≈ 25 % of the 1440 frame (legible tier). */
  faceW: 5.6,
  faceH: 5.6 * (2 / 5),
  /** The plaque faces north (toward the authored eye): yaw π — a plane's
   * +z normal swung to −z, straight down the rules corridor. */
  faceYaw: Math.PI,
  /** Ring centre (the torus stands in the vertical plane facing north). */
  ring: { x: 0, y: 5.7, z: 15.6 },
  ringRadius: 3.6,
  ringTube: 0.52,
  /** Pier base under the ring's foot. */
  pier: { x: 0, z: 15.6, w: 2.6, h: 0.9, d: 1.4 },
  /** The C-107 halo prop (clouds-halo-gate — a horizontal golden halo with
   * hanging light strands, recorded bounds 4.49 × 3.10 × 4.49 m) mounted as
   * the gate's namesake crown: seated inside the stone ring's upper half,
   * 1.7 m clear above the plaque's top edge (5.72) so its strands (bottom
   * ≈ 7.78 at scale 1.2) never reach the face; the disc tops at ≈ 11.14,
   * inside the desktop pose's visible band. Yaw 0 — the halo reads all
   * around. Clearance verified by the pre-capture projection scan. */
  halo: { x: 0, y: 7.6, z: 15.6, s: 1.2 },
} as const;

/**
 * The mooring spire on each station isle: a stone foot, a timber mast, a
 * rigging ring and the tether lines down to the moored airship's gondola.
 * Heights are per-isle so every tether reads taut.
 */
export const MOORINGS: Record<string, { x: number; z: number; h: number }> = {
  pulse: { x: -9.6, z: -13.2, h: 3.4 },
  roster: { x: -15.4, z: 1.6, h: 2.6 },
  // Left of the fixtures board's span (board x 2.7..9.3 at z −14) — the
  // first siting (4.7, −12.6) stood dead-centre in the #rules…#schedule
  // sight corridor and its mast crossed the board's headline.
  schedule: { x: 0.6, z: -13.4, h: 3.0 },
  rules: { x: -2.6, z: 14.6, h: 2.4 },
};

/**
 * Per-isle dressing anchors — dock platforms, railing runs, lantern posts,
 * pennant lines, crates and shard crystals, angle-checked against each
 * station pose (all props ≤ 2.9 m tall; every isle's dressing stays below
 * its hero's sight ray, layering the isle without occluding the content
 * face). C-104: the round-crown blob trees LEFT this kit — real trees live
 * in TREE_PLACEMENTS (the shared tree system) below.
 */
export const ISLE_DRESSING: Record<
  string,
  {
    dock: { x: number; z: number; w: number; d: number };
    railings: readonly { x: number; z0: number; z1: number }[];
    lanterns: readonly { x: number; z: number; practical?: boolean }[];
    crates: readonly { x: number; z: number }[];
    pennants: readonly { x: number; z: number; h: number }[];
    shards: readonly { x: number; y: number; z: number; s: number }[];
    scrubs: readonly { x: number; z: number; s: number }[];
  }
> = {
  pulse: {
    dock: { x: -5.6, z: -11.4, w: 3.4, d: 2.6 },
    railings: [{ x: -4.1, z0: -12.6, z1: -10.2 }],
    lanterns: [
      // C-104 r1 corridor moves: both lanterns stood inside the flagship's
      // screen span (az −34°/−48° vs the face's −54.6°..−26.5° span from the
      // pulse eye) and their poles crossed the standings rows; the west-rim
      // sites clear the face's azimuth span and frame the wild lawn.
      { x: -11.8, z: -11.2, practical: true },
      { x: -10.9, z: -9.9 },
    ],
    crates: [
      { x: -7.4, z: -11.6 },
      { x: -7.0, z: -12.2 },
    ],
    pennants: [
      { x: -11.5, z: -10.6, h: 2.5 },
      { x: -11.2, z: -9.6, h: 2.1 },
    ],
    shards: [
      { x: -12.2, y: 4.6, z: -13.6, s: 1.2 },
      { x: -4.8, y: 5.4, z: -15.8, s: 0.9 },
      { x: -8.9, y: 3.4, z: -10.6, s: 0.7 },
    ],
    scrubs: [
      { x: -6.8, z: -9.8, s: 0.9 },
      { x: -10.6, z: -12.2, s: 0.8 },
    ],
  },
  roster: {
    dock: { x: -12.6, z: 0, w: 2.6, d: 4.4 },
    railings: [{ x: -11.4, z0: -2.0, z1: 2.0 }],
    lanterns: [
      { x: -12.9, z: -2.6, practical: true },
      { x: -12.9, z: 2.6 },
    ],
    crates: [{ x: -12.2, z: 0.9 }],
    pennants: [{ x: -11.8, z: 2.9, h: 2.2 }],
    shards: [
      { x: -16.6, y: 3.2, z: 0.4, s: 0.9 },
      { x: -12.4, y: 2.6, z: -3.3, s: 0.6 },
    ],
    scrubs: [
      { x: -12.4, z: -1.7, s: 0.8 },
      { x: -12.4, z: 1.7, s: 0.7 },
    ],
  },
  teams: {
    dock: { x: 12.0, z: 0, w: 2.6, d: 4.4 },
    // Wave-2 r3 (TEAMS judge, D16): the C-104 r2 twin dock lamps
    // (11.3, −0.45 / 0.4), the pennant pole (11.5, 0.1) and the railing stub
    // (x 10.9) were sited in the one band free of the RETIRED float plaques'
    // corridors — dead centre in front of the zipper formation, between the
    // ledger and the front floats (fid-w2c-r2-clouds-rollcall-teams-1440:
    // two lantern posts and a flag pole over the rank-3 rider). With every
    // name on the ledger rail, that band is the formation itself: the stub
    // retires, the lamps and the pennant move to the isle's rear rim BEHIND
    // the riser (never in front of an ace column or the ledger at 1440 /
    // 768 / 390 or in any `?team=` shot — teams-formation.test.ts judges
    // every seat here via `TEAMS_DRESSING_BOXES`), and the crate and scrubs
    // move off the formation's front line to the rim outside the outer
    // columns. The AcesFloats bookends (`TEAMS_BOOKENDS`) frame the row.
    railings: [],
    lanterns: [
      { x: 16.1, z: -3.2, practical: true },
      { x: 16.1, z: 3.2 },
    ],
    crates: [{ x: 15.8, z: 3.6 }],
    pennants: [{ x: 16.6, z: -2.6, h: 2.2 }],
    shards: [
      { x: 16.1, y: 3.4, z: 0.2, s: 1.0 },
      { x: 15.4, y: 3.6, z: 4.6, s: 0.65 },
    ],
    scrubs: [
      { x: 15.2, z: 3.9, s: 0.8 },
      { x: 15.2, z: -3.9, s: 0.7 },
    ],
  },
  schedule: {
    dock: { x: 4.9, z: -11.6, w: 3.0, d: 2.4 },
    // C-104 r2: the r1 west railing run (x 3.5) stood IN the board's sight
    // corridor — its post grazed the footer's "NEXT KICKOFF" (the r1
    // visual review's "pulse mast" note; corridor crossing x ≈ 3.99 vs the footer
    // text starting at x 2.99). The rim site's crossings (x 1.73-1.84)
    // clear the text by >1.1 m and keep the dock guarded on its west.
    railings: [{ x: 1.65, z0: -12.4, z1: -10.8 }],
    lanterns: [
      // C-104 r1 corridor moves: the old sites (6.6,−10.9)/(3.9,−12.8)
      // stood inside the fixtures board's screen span and their poles
      // crossed the MATCH/KICKOFF rows; the rim sites clear the face.
      // C-104 r2: (1.9,−11.4) → (2.2,−11.3) cleared the footer but put the
      // lantern BODY (cross arm + glazed head + cap cone, all offset
      // +0.36·s along local +x — Props.tsx LanternPost) across the leading
      // glyphs of rows 4/5 at desktop-1440 in both modes; the r2 scan's
      // CENTERLINE subject could not see it.
      // C-104 r3: → (1.7,−16.3), BEHIND the face plane (n·(p−c) −0.36 at the
      // mast base, deeper at the +x head — under the 0.06 in-front eps at
      // every body sample, so crossing is impossible at ANY pose; the
      // corridor-completion law — the r3 body-width sweep found
      // NO in-front seat on this isle carrying >65 px landed band margin),
      // yet WEST of the face's left-edge bearing (2.2° vs 8.4°), so the lamp
      // stays visible beside the board at both poses. On-isle 1.2 m inside
      // the rim; ≥1.2 m from the moored ship's stern, the NW groves and the
      // shard. Validated by _cC104r3-scan.mjs (body-width subject, 0 hits vs
      // every face at every pose) + spot stills.
      { x: 1.7, z: -16.3, practical: true },
      { x: 10.1, z: -11.2 },
    ],
    crates: [
      { x: 7.4, z: -12.4 },
      { x: 7.9, z: -11.8 },
    ],
    pennants: [
      { x: 8.6, z: -11.1, h: 2.4 },
      { x: 8.8, z: -11.5, h: 2.0 },
    ],
    shards: [
      { x: 10.2, y: 4.0, z: -14.6, s: 1.1 },
      { x: 3.1, y: 3.2, z: -15.9, s: 0.8 },
    ],
    scrubs: [
      { x: 5.9, z: -10.1, s: 0.85 },
      { x: 9.0, z: -13.2, s: 0.75 },
    ],
  },
  rules: {
    dock: { x: 0, z: 12.3, w: 4.2, d: 2.8 },
    railings: [{ x: 0, z0: 11.1, z1: 13.5 }],
    lanterns: [
      { x: -2.1, z: 12.9, practical: true },
      { x: 2.1, z: 12.9 },
    ],
    crates: [
      { x: -3.4, z: 14.2 },
      { x: -3.0, z: 13.6 },
    ],
    pennants: [
      { x: -3.9, z: 15.9, h: 2.6 },
      { x: -4.1, z: 16.3, h: 2.2 },
      { x: 3.6, z: 16.1, h: 2.3 },
    ],
    shards: [
      { x: -5.4, y: 4.4, z: 15.4, s: 1.15 },
      { x: 5.1, y: 3.6, z: 14.9, s: 0.85 },
      { x: 0.0, y: 2.9, z: 18.9, s: 0.7 },
    ],
    scrubs: [
      { x: -2.9, z: 16.9, s: 0.9 },
      { x: 2.7, z: 17.1, s: 0.8 },
    ],
  },
};

/** CloudsArchipelago mounts the dressing lanterns at this scale (Props.tsx LanternPost `s`). */
export const DRESSING_LANTERN_SCALE = 1.1;

/**
 * The teams row's two bookend lantern posts (AcesFloats), scale 1.5, flanking
 * the rear riser on the isle rim. Wave-2 r3: the C-104 kerb seats
 * (11.0, ±3.4) stood in front of the outer ace columns at 1440 / 768 and in
 * the rank-1 `?team=` shot; these seats pass the teams keep-out
 * (teams-formation.test.ts judges them via `TEAMS_DRESSING_BOXES`).
 */
export const TEAMS_BOOKENDS = {
  scale: 1.5,
  posts: [
    { x: 14.6, z: 4.1, practical: true },
    { x: 14.6, z: -4.1, practical: false },
  ],
} as const;

/** A LanternPost (Props.tsx) at scale `s`: mast 1.7·s tall, the head and cap offset +0.36·s along +x. */
function lanternBox(id: string, x: number, y: number, z: number, s: number): KeepOutBox {
  return { id, center: [x + 0.16 * s, y + 0.9 * s, z], half: [0.36 * s, 0.9 * s, 0.22 * s] };
}

/**
 * The teams isle's dressing as keep-out boxes (dims restated from Props.tsx:
 * LanternPost, Pennant pole + flag, Crate 0.56 m, Scrub ≈ 0.52·s tall, Shard
 * octahedron 0.34·s, DockRailing 0.9 m) plus the bookends — what the teams
 * prop keep-out judges for the clouds formation (wave-2 r3: the dressing was
 * never judged, so two lamps and a pennant stood in front of the aces).
 */
export const TEAMS_DRESSING_BOXES: readonly KeepOutBox[] = (() => {
  const d = ISLE_DRESSING.teams;
  const top = ISLES.teams.top;
  return [
    ...d.lanterns.map((l) => lanternBox(`teams-lantern:${l.x},${l.z}`, l.x, top, l.z, DRESSING_LANTERN_SCALE)),
    ...TEAMS_BOOKENDS.posts.map((p) => lanternBox(`teams-bookend:${p.x},${p.z}`, p.x, top, p.z, TEAMS_BOOKENDS.scale)),
    ...d.pennants.map((p): KeepOutBox => ({
      id: `teams-pennant:${p.x},${p.z}`,
      center: [p.x + 0.2, top + (p.h + 0.1) / 2, p.z],
      half: [0.26, (p.h + 0.1) / 2, 0.1],
    })),
    ...d.crates.map((c): KeepOutBox => ({ id: `teams-crate:${c.x},${c.z}`, center: [c.x, top + 0.28, c.z], half: [0.4, 0.28, 0.4] })),
    ...d.scrubs.map((c): KeepOutBox => ({
      id: `teams-scrub:${c.x},${c.z}`,
      center: [c.x + 0.07 * c.s, top + 0.3 * c.s, c.z],
      half: [0.42 * c.s, 0.3 * c.s, 0.38 * c.s],
    })),
    ...d.shards.map((c): KeepOutBox => ({ id: `teams-shard:${c.x},${c.z}`, center: [c.x, c.y, c.z], half: [0.36 * c.s, 0.36 * c.s, 0.36 * c.s] })),
    ...d.railings.map((r): KeepOutBox => ({
      id: `teams-railing:${r.x},${r.z0}`,
      center: [r.x, top + 0.45, (r.z0 + r.z1) / 2],
      half: [0.07, 0.45, (r.z1 - r.z0) / 2 + 0.07],
    })),
  ];
})();

/**
 * The isles' REAL trees (C-104 criterion 2) — the shared tree system over
 * the rework-authored skins (`tree-skin.ts`): sky-garden on the tended
 * summit and gate isles, grove on the wild leeward isles. The old
 * cylinder-trunk/icosahedron-blob SkyTree kit this row used to feed is gone.
 *
 * Sight discipline (crown-projection law): every anchor sits on
 * its isle's leeward rim BEHIND its hero's content plane — the crown
 * projection scan (pre-capture, raw _cC104r1-raw-tree-scan.log) grows each
 * crown (growTree + per-card corner samples + sway margin) and projects
 * through ALL FIVE desktop AND landed-390 poses; only crowns IN FRONT of a
 * face plane can clip its text, so the behind-plane backdrops are safe by
 * construction and the scan proves 0 in-front rect hits at every pose.
 */
export interface TreePlacement {
  x: number;
  z: number;
  /** Isle top the trunk seats on (metres). */
  y: number;
  heightM: number;
  seed: number;
  skin: 'sky-garden' | 'grove';
}

const SKY_GARDEN_ROWS: readonly (readonly [number, number, number, number])[] = [
  // Pulse isle (top 2.2) — the summit garden, south rim behind the sail.
  [-11.4, -16.8, 2.2, 5.6], [-9.8, -17.8, 2.2, 5.0], [-12.6, -15.4, 2.2, 4.6], [-5.2, -17.6, 2.2, 3.8],
  // Rules isle (top 1.2) — the gate garden, south rim behind the plaque plane.
  [-4.9, 17.4, 1.2, 5.2], [-3.6, 18.3, 1.2, 4.6], [4.1, 18.6, 1.2, 5.0],
];

const GROVE_ROWS: readonly (readonly [number, number, number, number])[] = [
  // Roster isle (top 0.8) — west rim behind the sail plane.
  [-16.9, 2.9, 0.8, 4.8], [-17.4, -1.6, 0.8, 4.2],
  // Teams isle (top 0.95) — east rim behind the float row. C-104 r2: the
  // third teams grove tree moved off-isle — its SE rim seat (15.2,−4.2)
  // leans its crown over plaque-6/4's ink bands at the landed-390 pose
  // (extended-scan hits at every nearby seat); the row keeps two groves on
  // the north-east rim, clear of every plaque corridor.
  [16.9, -1.0, 0.95, 4.2], [16.9, 2.6, 0.95, 4.4],
  // Schedule isle (top 1.6) — north rim behind the fixtures board; the
  // relocated teams tree joins as a fourth (behind the board plane =
  // backdrop, count preserved at 8 groves).
  [9.4, -16.4, 1.6, 5.2], [8.1, -17.2, 1.6, 4.6], [2.6, -17.4, 1.6, 5.0],
  [4.6, -17.0, 1.6, 4.2],
];

/** 7 sky-garden + 8 grove placements, seeded. */
export const TREE_PLACEMENTS: readonly TreePlacement[] = [
  ...SKY_GARDEN_ROWS.map(([x, z, y, h], i) => ({ x, z, y, heightM: h, seed: 3100 + i, skin: 'sky-garden' as const })),
  ...GROVE_ROWS.map(([x, z, y, h], i) => ({ x, z, y, heightM: h, seed: 3300 + i, skin: 'grove' as const })),
];

/**
 * Pool-driven sky wilds (C-104 criterion 1) — the isles' fitted habitation,
 * flight and electric lines only, every species idle-clipped in the manifest
 * (the motion-proof law: the pulse window's wilds carry real `idle` clips IN
 * the pulse frame). One `station` window each; the residency latch mounts
 * them when the visitor first enters and never unmounts. Anchors sit on
 * their isle's near rim below their station's content face (the projection
 * scan checks both poses); the colossal Lugia stands GROUNDED LATERALLY on
 * the rules isle's east rim — its sight ray to the plaque plane crosses
 * right of the ring (x ≈ 4.8 > 4.12 at z 15.6, both poses), the
 * colossals-grounded-laterally law, and it is the sky route's
 * leviathan presence.
 */
export interface SkyWild {
  species: string;
  x: number;
  z: number;
  /** Isle top the figure seats on. */
  y: number;
  yaw: number;
  /** First station index whose entry mounts this wild (residency latch). */
  station: number;
}

export const SKY_WILDS: readonly SkyWild[] = [
  // Pulse window — the summit isle's WEST rim: the first siting (east lawn,
  // ≈ −4.6,−11.2) put the tall figures' heads INSIDE the flagship face rect
  // at BOTH poses (the pre-capture scan caught it — the board's lower rows
  // reach to y 2.53 on screen); west of the board's west edge the figures
  // read beside the sail, in-frame and clear at both poses.
  { species: 'Zapdos-Galar', x: -11.6, z: -12.2, y: 2.2, yaw: 0.6, station: 0 }, // idle — electric/flying
  { species: 'Pikachu', x: -12.6, z: -13.5, y: 2.2, yaw: 0.9, station: 0 }, // idle — tiny → pedestal
  { species: 'Magnemite', x: -10.9, z: -11.3, y: 2.2, yaw: 0.3, station: 0 }, // idle — tiny → pedestal
  // Roster window — flanking the register isle's dock, off the sail corridor.
  { species: 'Jolteon', x: -12.0, z: -3.2, y: 0.8, yaw: Math.PI * 0.85, station: 1 }, // idle
  { species: 'Braviary-Hisui', x: -12.5, z: 3.8, y: 0.8, yaw: Math.PI * 1.15, station: 1 }, // idle — tiny → pedestal
  // Teams window — the aces isle's behind-row strip (between the float row
  // and the grove): the dock-side first siting (≈ 12.1, ±4.0) put
  // Misdreavus IN FRONT of the row's south plaque (scan-hit); behind the
  // row plane both figures are backdrop to every plaque and read between
  // the floats.
  { species: 'Cosmog', x: 14.0, z: -3.4, y: 0.95, yaw: Math.PI * 0.9, station: 2 }, // idle — tiny → pedestal
  { species: 'Misdreavus', x: 14.0, z: 3.4, y: 0.95, yaw: Math.PI * 1.1, station: 2 }, // idle — tiny → pedestal
  // Schedule window — the fixtures isle's SOUTH LAWN, dead below the
  // board's sill (the board's bottom edge y 0.95 screens them; the first
  // east-lawn siting put the wing-span samples inside the fixtures rect).
  { species: 'Pawmi', x: 5.4, z: -9.7, y: 1.6, yaw: 2.4, station: 3 }, // idle — tiny → pedestal
  { species: 'Pawmot', x: 6.6, z: -9.8, y: 1.6, yaw: 2.1, station: 3 }, // idle
  // Rules window — the gate isle's approach flanks, lateral of the corridor.
  { species: 'Haunter', x: -4.8, z: 13.9, y: 1.2, yaw: Math.PI * 0.5, station: 4 }, // idle
  { species: 'Eelektross', x: 4.8, z: 13.9, y: 1.2, yaw: Math.PI * 1.5, station: 4 }, // idle
  // The grounded leviathan (colossal stance — engine grounds it), east rim.
  { species: 'Lugia', x: 5.2, z: 17.5, y: 1.2, yaw: Math.PI * 1.35, station: 4 }, // idle — 7 m colossal
];

/**
 * The floats' rider backfills (C-104 criterion 1): floats whose trainer's
 * ace misses their rank's stature cap (front rank rides TINY species only —
 * see FLOAT_ROW.riderMaxByRank) take the next fitted pool rider instead, so
 * every float rides with a LIVE figure (no abstract egg substitute
 * returns). All idle-clipped; the front pool is all flight/electric tinies,
 * the rear pool standard-stature flight/electric lines.
 *
 * C-104 r2: Pawmi is OUT of the front pool — its export carries a
 * skin-weight stray that renders as a forward streak (live-vertex-measured
 * 2.4-8 m past the float centre across idle phases, raw-c104r2-verts.log —
 * the r1 stills' "Fer? Vale" occluder). A measured-offender exclusion, the
 * same shape as the stature caps.
 */
export const RIDER_BACKFILL_FRONT: readonly string[] = [
  'Pikachu',
  'Cosmog',
  'Magnemite',
];

export const RIDER_BACKFILL_REAR: readonly string[] = [
  'Jolteon',
  'Zapdos-Galar',
  'Haunter',
  'Pawmot',
  'Misdreavus',
  'Braviary-Hisui',
];

/** Tether lines: from a mooring spire's masthead to an airship's gondola —
 * the gondola point includes the hull's long-axis shift (the same slide the
 * envelope gets, so the line lands on the ship, not behind it). Ships with a
 * GLB hull body tether to the PROP's underbelly: the recorded bounds'
 * half-height rides the scale, so the line lands on the Blender gondola
 * (centre y − scale · 1.86 − 0.1 embed) instead of the retired envelope's. */
function gondolaPoint(ship: Airship): readonly [number, number, number] {
  if (ship.hullProp) {
    const { x, y, z, scale } = ship.hullProp;
    return [x, y - scale * 1.86 - 0.1, z];
  }
  const lx = Math.cos(ship.hullYaw) * ship.hullShift;
  const lz = -Math.sin(ship.hullYaw) * ship.hullShift;
  return [
    ship.hull.x + lx,
    ship.hull.y - ship.hullRadius - 0.85,
    ship.hull.z + lz,
  ];
}

/** The hull's bow tip (aft along the long axis from the shifted centre). */
function bowPoint(ship: Airship): readonly [number, number, number] {
  const lx = Math.cos(ship.hullYaw) * (ship.hullShift - ship.hullLength / 2 + 0.3);
  const lz = -Math.sin(ship.hullYaw) * (ship.hullShift - ship.hullLength / 2 + 0.3);
  return [ship.hull.x + lx, ship.hull.y - 0.2, ship.hull.z + lz];
}

export const TETHERS: readonly { from: keyof typeof MOORINGS; to: readonly [number, number, number] }[] = [
  { from: 'pulse', to: gondolaPoint(FLAGSHIP) },
  { from: 'roster', to: gondolaPoint(REGISTER_AIRSHIP) },
  // The fixtures ship tethers at its BOW: with the hull slid left and the
  // spire left of the sail, a gondola line crossed the tilted face plane at
  // u ≈ −2.7 (measured against the capture) — the bow anchor passes wholly
  // left of the face (u ≈ −5.0 at the plane crossing).
  { from: 'schedule', to: bowPoint(FIXTURES_AIRSHIP) },
];

/**
 * Instanced sky-meadow tufts across the five station isles — seeded (never
 * Math.random) positions inside each isle's rim, seated on the top disc.
 */
export const TUFT_COUNT_PER_ISLE = 26;

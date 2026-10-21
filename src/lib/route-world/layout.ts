/**
 * League Challenge plaza — physical layout.
 *
 * Camera endpoints in `chapters.ts` look *at* these anchors. The plaza is one
 * hall with furniture on the walls and the camera standing in the middle.
 *
 * World units are meters. Center is the origin; +X east, +Z south, +Y up.
 * Pure data — no client-only imports.
 */

export interface LandmarkAnchor {
  x: number;
  y: number;
  z: number;
}

/** Plaza floor half-extent. Buildings sit just outside this. */
export const PLAZA = {
  half: 18,
  floorY: 0,
  buildingHeight: 14,
} as const;

/**
 * Furniture the five orbit sectors frame.
 *
 * West desk, north dual jumbotron, east statues, south gate — geography.
 * Scroll order is still pulse → roster → teams → schedule → rules, so the
 * camera visits north-left, west, east, north-right, south rather than
 * walking the circle in compass order.
 *
 * (The deprecated `LANDMARKS` alias that used to sit here was removed: its
 * legacy keys mapped onto UNRELATED furniture — `gate`→desk, `grass`→
 * pulseBoard — so any resurfaced legacy import would have compiled and
 * silently aimed the camera at the wrong anchor. Nothing in the repo
 * imported it; a resurfaced import now fails the type check instead, which
 * is the point — PR #63 review.)
 */
export const FURNITURE: Record<
  'desk' | 'pulseBoard' | 'scheduleBoard' | 'statues' | 'gate' | 'tower',
  LandmarkAnchor
> = {
  desk: { x: -13.5, y: 0, z: 0 },
  pulseBoard: { x: -4.4, y: 4.1, z: -16.2 },
  scheduleBoard: { x: 4.4, y: 4.1, z: -16.2 },
  statues: { x: 13.5, y: 0, z: 0 },
  gate: { x: 0, y: 0, z: 16.4 },
  // Far enough north that the lattice reads as a distant landmark above the
  // boards (the #pulse endpoint sees its 20–32 m band through the void), not
  // as pipes behind the cabinets.
  tower: { x: 0, y: 0, z: -64 },
};

export const DESK = {
  width: 6.4,
  depth: 2.2,
  height: 1.12,
  monitorW: 1.6,
  monitorH: 1.05,
} as const;

export const JUMBOTRON = {
  width: 7.6,
  height: 4.4,
  bezel: 0.18,
} as const;

export const STATUE_ROW = {
  count: 8,
  spacing: 2.35,
  plinthW: 1.5,
  plinthH: 0.62,
  /** Fitted hero / billboard height so the row stays under the #teams y≈6 crop. */
  figureH: 1.58,
} as const;

export const GATE = {
  width: 7.2,
  height: 6.4,
  depth: 1.8,
  doorW: 5.35,
  doorH: 4.85,
  plaqueW: 2.48,
  plaqueH: 3.62,
  /** Local −Z is toward the #rules camera (north). */
  plaqueZ: -1.92,
} as const;

/**
 * Card C-043 introduced the four Meshy hero props (world manifest `props[]`)
 * as standalone plaza furniture; card C-054 — the deep station replacement
 * C-043 explicitly deferred — MOVED three of them into the stations' authored
 * fixtures, consuming their standalone seats:
 *
 *  - `haussmann-lamp-post` (20,319 tris) now renders at PlazaHall's six
 *    committed `LAMP_POSTS` street-lamp seats (C-041 baseline), fitted to
 *    4.4 m — the height C-043 proved for this prop.
 *  - `statue-plinth` (14,427 tris) now renders at every StatueRow slot, its
 *    cap at exactly `PLINTH_H` so stand heights and the C-051 re-seat hold.
 *  - `gate-crest-ornament` (20,534 tris) now renders at the gate piers' crest
 *    medallion seats (`ChallengeGate` CREST_Y), replacing the canvas relief.
 *
 * The LED wayfinding kiosk has no authored-fixture counterpart, so it REMAINS
 * the sole standalone seat here. `HeroProps.tsx` consumes this read-only; the
 * manifest is the sole source of the GLBs and their recorded `bounds`.
 *
 * Placement legality (PB-136, checked by geometry against
 * `ambient.ts` DOLLY_CORRIDORS / HERO_CLEARS / HERO_SEGMENTS and the furniture
 * volumes): every ground footprint sits outside all dolly corridors
 * (≥ 1.0 m + half-extent), all hero clear cylinders, and off every ambient
 * walker path and loiter spot.
 *
 * Frame visibility (frozen endpoints, projected): the kiosk reads in the
 * #schedule board frame (px≈604..891 × 722..900, top 71 % above the frame
 * bottom edge) clear of both board dollies.
 */
export interface HeroPropSeat {
  /** Manifest prop name, e.g. `led-board-cabinet`. */
  prop: string;
  /** World position; `y` is the ground plane (0) or the mount base height. */
  at: LandmarkAnchor;
  /** Yaw about +Y in radians. */
  yaw: number;
  /**
   * Recorded-bounds axis the real-world size scales from. Meshy normalizes
   * its GLBs to ~1.9 units on the longest axis, so scale is always derived
   * from `bounds`, never from 1 m = 1 unit (PB-166).
   */
  axis: 'x' | 'y';
  /** Real-world size along `axis`, in metres. */
  sizeM: number;
}

export const HERO_PROPS: readonly HeroPropSeat[] = [
  // LED wayfinding kiosk beside the east board (screen south, toward the
  // #schedule camera): 2.18 m wide, clear of both board dolly corridors, the
  // gantry pylons and every walker rail.
  { prop: 'led-board-cabinet', at: { x: 4.0, y: 0, z: -14.0 }, yaw: Math.PI, axis: 'x', sizeM: 2.18 },
] as const;

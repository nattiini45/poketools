/**
 * Ambient figures — roster Pokémon that live on the plaza with no data role
 * beyond presence (CONTEXT.md). Pure geometry and selection; the component in
 * `plaza/AmbientFigures.tsx` drives the clocks.
 *
 * Paths are authored in world metres and MUST stay clear of the hero objects
 * (board wall, desk, statue row, gate) and of the five focus dolly lines —
 * the corridor each station camera travels when it dollies onto its subject
 * (ADR-0003: station endpoint → focus pose). `__tests__/ambient.test.ts`
 * samples every path and loiter spot against HERO_CLEARS / HERO_SEGMENTS /
 * DOLLY_CORRIDORS, so a path that strays fails the build rather than a frame.
 *
 * WALKER ALLOCATION IS A POPULATION GUARANTEE (C-036 r2): the component
 * assigns walkers through `pathIndexForWalker`, which fills the six
 * population pockets in plan order — at the desk rung's eight, all six
 * pockets are crewed at every instant, and because a pocket is CLOSED and
 * lies entirely inside its station's visible wedge, simultaneous presence
 * is an invariant of the geometry, not a phase the still happens to catch.
 *
 * Framing grammar (C-036 r3): r2's cabinet-front rails passed the projection
 * audit yet rendered as ~40-60 px low-contrast sprites, and r3's first fix
 * (one shared near rail per station) rendered the trio as ONE merged blob
 * cluster at most phases — a live phase scan measured pill-discernible 3 at
 * every instant but strict column-gap blobs of only 1-2, because three
 * ~100-200 px bodies free to pass each other on a shared loop share columns
 * most of the time. "Discernible" to a component scan means COLUMN-DISJOINT,
 * so each station's population now lives on THREE closed pocket loops
 * (east/mid/west) whose screen column bands never overlap:
 *
 *   pulse    W[76,233]   M[249,487]  E[504,857]  (px at the frozen 1440 pose)
 *   schedule E[593,927]  M[972,1172] W[1211,1360]
 *
 * Bands are sized from the measured walking sprites (widest clean
 * single-walker diff blob in the r3 evidence: ~149 px for a 2.0 m walker at
 * ~10.8 m depth => walking width ≈ 0.69 × heightM metres; rest-pose
 * manifest bounds are T-pose extremes the walk clip never shows) plus
 * travel and margin, verified in the round evidence with ≥ 16 px gaps.
 * Pocket depth classes: the east pocket (nearest, widest render) needs a
 * ≥ 1.2 m walker to clear the pill band (worst 47 px at class height); mid
 * and west hold any ≥ 0.9 m walker (worst 55-62 px). Allocation is
 * height-descending so the tallest walker of each side takes the east
 * pocket, the next two the mid/west — a day whose tallest walker stands
 * under 1.2 m is the disclosed degenerate case. The crossing still bows
 * north around the board dollies' focus ends; the south loop stays north
 * of the gate dolly's focus end.
 *
 * C-047 EXTENSION - STATION POCKET GROUPS: roster/teams/rules each own two
 * (rules three) closed pockets in their station's visible wedge, at the
 * deep end of the legal strips that flank the focus dolly corridors. The
 * desk rung's head-count (8) cannot crew thirteen pockets at once, so
 * allocation is STATION-AWARE (pathIndexForWalker + the conductor's active
 * station): walkers 0-5 hold the six board pockets at EVERY station (the
 * boards' column-disjoint trios stay invariants wherever the visitor
 * stands - that floor is visible only from #pulse/#schedule, so this costs
 * nothing at the other stations and keeps the C-036 counts alive on every
 * scroll-back), while walkers 6+ staff the ACTIVE station's own pockets
 * (roster/teams/rules); at the boards stations they keep the crossing and
 * the south loop - the C-036 r3 allocation exactly. The roster/teams strips
 * pinch between the dolly corridor and the pill band, so their pockets sit
 * at the strips' deepest legal end (a 0.6 m walker keeps >=44 px above the
 * pill; a cast shorter than 0.6 m is the disclosed degenerate class, as
 * <1.2 m was for r3's east pockets). The crossing's outer legs were nudged
 * ~0.15 m south to clear the (+/-6,-6) planters' +0.3 m body margin
 * (28 -> 0 graze samples).
 *
 * C-047 r2 EXTENSION - RULES OVER-STAFFING: r1 proved that of N in-graph,
 * mesh-visible walkers at a station exactly one never PAINTS (the render
 * drop fenced in r1; root cause lives in the C-045/C-048 paint path), so
 * rules needs THREE walkers in its wedge for two to survive the drop. At
 * the desk rung's head-count of 8 the crew beyond the boards six is only
 * two, and no third share exists to borrow from (while a station-pocket
 * station is active the crossing/south round-robin carries ZERO walkers -
 * walkers 6/7 ARE that crew). The only arithmetically available third
 * walker is the boards six's TAIL (walker 5, the smallest of the six, on
 * the schedule-west floor), and it is borrowed ONLY while rules is the
 * active station: every pulse/schedule count of record is measured with
 * THAT station active, where the allocation is the C-036/C-047 r1 default
 * (all six board walkers pinned) exactly, so the borrow is invisible to
 * the no-reg law. The tail hop lands at the station-transition midpoint
 * with the other crew hops - the same disclosed frame-periphery jump class
 * as r1.
 */

export type Vec2 = readonly [number, number];

export interface AmbientPath {
  id: string;
  /** Polyline in world x/z; `closed` paths loop, open ones ping-pong. */
  points: readonly Vec2[];
  closed: boolean;
}

export const AMBIENT_PATHS: readonly AmbientPath[] = [
  {
    id: 'pulse-east-pocket',
    // #pulse's east population pocket (r3.2): the NEAREST of the three
    // pulse pockets, so the cast's tallest walker (height-descending plan
    // order puts walker 0 here) renders at its biggest — a 2.2 m species
    // keeps ~176 px above the nav-pill band. Closed and tiny (a 0.6 m-step
    // diamond), so its walker pauses at the corners and reads as shifting
    // weight while watching the jumbotron, never leaving the pocket's
    // column band ≈ [504,857] — disjoint from the mid pocket's ≈ [249,487]
    // at every phase, which is what makes the trio countable to a
    // component scan instead of one merged cluster.
    points: [
      [-4.05, -13.5],
      [-4.55, -13.85],
      [-4.05, -14.2],
      [-3.55, -13.85],
    ],
    closed: true,
  },
  {
    id: 'schedule-east-pocket',
    // Mirror of the pulse east pocket against #schedule; identical band
    // geometry by construction (x-mirrored station poses).
    points: [
      [4.05, -13.5],
      [4.55, -13.85],
      [4.05, -14.2],
      [3.55, -13.85],
    ],
    closed: true,
  },
  {
    id: 'pulse-mid-pocket',
    // #pulse's mid pocket: column band ≈ [249,487] at reading depth
    // (≈ 10.6-11.1 m) — safe for any ≥ 0.9 m walker (worst 58 px above
    // the pill), sized for the plan's third-tallest (walker 2).
    points: [
      [-7.42, -14.45],
      [-7.72, -14.8],
      [-7.42, -15.15],
      [-7.12, -14.8],
    ],
    closed: true,
  },
  {
    id: 'schedule-mid-pocket',
    // Mirror of the pulse mid pocket against #schedule.
    points: [
      [7.42, -14.45],
      [7.72, -14.8],
      [7.42, -15.15],
      [7.12, -14.8],
    ],
    closed: true,
  },
  {
    id: 'pulse-west-pocket',
    // #pulse's west pocket: the far corner of the old r3 rail's territory —
    // column band ≈ [76,233], sized for the plan's smallest rail walker
    // (walker 4; a 1.0 m species keeps ~63 px above the pill).
    points: [
      [-9.1, -13.7],
      [-9.35, -14.0],
      [-9.1, -14.3],
      [-8.85, -14.0],
    ],
    closed: true,
  },
  {
    id: 'schedule-west-pocket',
    // Mirror of the pulse west pocket against #schedule.
    points: [
      [9.1, -13.7],
      [9.35, -14.0],
      [9.1, -14.3],
      [8.85, -14.0],
    ],
    closed: true,
  },
  {
    id: 'roster-north-pocket',
    // #roster's north pocket (C-047): the legal strip between the roster
    // dolly corridor (z <= -0.8) and the frame's north edge, at its deepest
    // legal end - west until the desk clear circle stops it. The pill band
    // eats the near floor, so the pocket hugs the strip's far end where a
    // 0.6 m walker keeps ~48 px above the pill. Screen columns ~[1071,1444]
    // at the frozen pose - the east half of the frame, disjoint from the
    // south pocket's ~[67,419] (652 px gap).
    points: [
      [-9.93, -2.1],
      [-9.57, -2.1],
      [-9.57, -1.8],
      [-9.93, -1.8],
    ],
    closed: true,
  },
  {
    id: 'roster-south-pocket',
    // #roster's south pocket (C-047): the strip south of the roster dolly
    // corridor, in front of the Poke Center pavilion's east face. Same pill
    // law - deepest legal end (the desk circle bounds it west), ~44 px for
    // a 0.6 m walker. Columns ~[67,419], the west half of the frame.
    points: [
      [-10.08, 1.93],
      [-9.72, 1.93],
      [-9.72, 2.17],
      [-10.08, 2.17],
    ],
    closed: true,
  },
  {
    id: 'teams-north-pocket',
    // #teams's north pocket (C-047): between the teams dolly corridor and
    // the statue row's clear segment, west of the (11.2,-2.6) lamp. The
    // teams camera sits higher (2.55 m, fov 42) so even a 0.5 m walker
    // keeps ~73 px - no degenerate class here. Columns ~[145,505].
    points: [
      [10.45, -2.03],
      [10.85, -2.03],
      [10.85, -1.67],
      [10.45, -1.67],
    ],
    closed: true,
  },
  {
    id: 'teams-south-pocket',
    // #teams's south pocket (C-047): mirror strip south of the corridor -
    // deepest legal end toward the statue row. Columns ~[816,1181], a 311 px
    // gap from the north pocket (the strips sit on opposite sides of the
    // view axis, so the pair reads far-left / far-right of the frame).
    points: [
      [10.4, 1.2],
      [10.9, 1.2],
      [10.9, 1.6],
      [10.4, 1.6],
    ],
    closed: true,
  },
  {
    id: 'rules-west-pocket',
    // #rules's west pocket (C-047): south of the south loop's own band
    // (never crewed simultaneously - the loop rides only when a boards
    // station is active and then these pockets are empty), inside the gate
    // clear, between the (+/-3,8.2) plinth pair and the (+/-6,8) planters'
    // screen columns. Columns ~[917,1228].
    points: [
      [-4.45, 11.7],
      [-3.95, 11.7],
      [-3.95, 12.1],
      [-4.45, 12.1],
    ],
    closed: true,
  },
  {
    id: 'rules-east-pocket',
    // Mirror of the west pocket; columns ~[212,523].
    points: [
      [3.95, 11.7],
      [4.45, 11.7],
      [4.45, 12.1],
      [3.95, 12.1],
    ],
    closed: true,
  },
  {
    id: 'rules-center-pocket',
    // #rules's center pocket (C-047): staffed by the boards six's TAIL
    // walker while rules is the active station (C-047 r2 over-staffing -
    // the third rules walker that keeps >=2 painting through the r1 render
    // drop), and first claim of any future rung's third crew walker beyond
    // the boards six. Columns ~[573,867], disjoint from both flanks (50 px
    // gaps) and inside the gate-arch columns (presence before the hero,
    // never on it - the south loop already crosses these columns today).
    points: [
      [-0.2, 11.52],
      [0.2, 11.52],
      [0.2, 11.88],
      [-0.2, 11.88],
    ],
    closed: true,
  },
  {
    id: 'crossing',
    // Desk side to statue side. South of the camera row the rules dolly and
    // the two board dollies leave no legal gap, so the crossing bows north
    // AROUND the board dollies' focus ends and runs the mid-plaza at the
    // boards' feet — same reading distance as the population paths.
    // C-047: the outer legs were nudged ~0.15 m south so the whole
    // ping-pong clears the (+/-6,-6) planters' +0.3 m body margin by
    // >=0.049 m (28 graze samples before, 0 after).
    points: [
      [-9.0, -6.55],
      [-5.1, -7.65],
      [-4.6, -9.4],
      [-3.3, -11.4],
      [0, -12.4],
      [3.3, -11.4],
      [4.6, -9.4],
      [5.1, -7.65],
      [9.0, -6.55],
    ],
    closed: false,
  },
  {
    id: 'south-loop',
    // Whole loop south of the rules dolly's focus end (0, 8.2) + clearance;
    // the gate plaque framing never reaches it.
    points: [
      [-9.5, 9.6],
      [9.5, 9.6],
      [9.5, 11.4],
      [-9.5, 11.4],
    ],
    closed: true,
  },
];

/**
 * Walker `i` → path index (cast order, C-036 r3.2). The six population
 * pockets lead the array and are filled one walker each in plan order —
 * walker 0/1 (the two tallest, plans are height-descending) take the EAST
 * pockets (nearest, biggest render, needs the height), walkers 2/3 the mid
 * pockets, walkers 4/5 the west pockets. At the desk rung's head-count of
 * eight, all six pockets are crewed at every instant, and because each
 * pocket is closed, inside its station's wedge, and column-disjoint from
 * its siblings, ≥ 3 simultaneous COUNTABLE figures at both frozen #pulse
 * and #schedule is an invariant of the geometry. Walkers beyond the first
 * six round-robin the crossing and the south loop (mid-plaza life that
 * never owes a station its presence) - which is EXACTLY what still happens
 * while a boards station is active (C-047: the boards group is crewed at
 * every station, so the pulse/schedule counts cannot regress by
 * re-allocation). While roster/teams/rules is active, those walkers instead
 * staff the active station's own pockets (STATION_POCKETS) - the frozen
 * rung-0 head-count of 8 cannot crew two pocket groups at once, so a
 * station's figures ride its own pockets only while it is active, and the
 * crew walkers hop pocket groups at station boundaries (a mid-transition
 * position jump at the frame periphery - the accepted cost of five staffed
 * stations).
 *
 * C-047 r2: while a station whose own pockets OUTNUMBER the crew beyond the
 * boards six is active (rules today - the only three-pocket station), the
 * boards six's TAIL walker(s) join the crew so the station's every pocket
 * is staffed (three in-graph at rules -> two paint through the r1 render
 * drop). The borrow lives only in that branch and only while that station
 * is active; at the boards stations the allocation is the C-036 r3 exact
 * (all six board pockets crewed), which is where the pulse/schedule counts
 * of record are measured. `walkerCount` defaults to "unknown/unbounded" so
 * callers that do not pass it keep the r1 mapping.
 */
export const STATION_POCKETS: Readonly<Record<string, readonly string[]>> = {
  roster: ['roster-north-pocket', 'roster-south-pocket'],
  teams: ['teams-north-pocket', 'teams-south-pocket'],
  rules: ['rules-west-pocket', 'rules-east-pocket', 'rules-center-pocket'],
};

export function pathIndexForWalker(
  i: number,
  pathCount: number,
  activeStation: string | null = null,
  walkerCount: number = Number.POSITIVE_INFINITY,
): number {
  const population = Math.min(6, pathCount);
  if (population <= 0) return 0;
  const ownPockets = activeStation === null ? [] : (STATION_POCKETS[activeStation] ?? []);
  const pocketIndex = (j: number): number => {
    if (j >= ownPockets.length) return -1;
    const idx = AMBIENT_PATHS.findIndex((p) => p.id === ownPockets[j]);
    return idx >= 0 && idx < pathCount ? idx : -1;
  };
  // C-047 r2 RULES OVER-STAFFING: the crew beyond the boards six is
  // min(walkers beyond six, station pockets); when the ACTIVE station's
  // pockets outnumber it (rules at the desk rung's 8: 3 pockets, crew of 2),
  // the boards six's TAIL walker(s) are borrowed to staff the remaining
  // pocket(s) - only in this branch, never at the boards stations where the
  // no-reg counts are measured (borrow = 0 there: no station pockets).
  const crew = Math.max(0, Math.min(walkerCount - population, ownPockets.length));
  const borrow = Math.max(0, Math.min(ownPockets.length - crew, population));
  const pinned = population - borrow;
  if (i < pinned) return i;
  if (i < population) {
    // Borrowed boards tail: takes the pockets beyond the standing crew's
    // reach, tail-last (desk rung: walker 5 -> rules-center-pocket).
    const idx = pocketIndex(crew + (population - 1 - i));
    if (idx >= 0) return idx;
    return i;
  }
  const k = i - population;
  if (k < crew) {
    const idx = pocketIndex(k);
    if (idx >= 0) return idx;
  }
  const crossing = AMBIENT_PATHS.findIndex((p) => p.id === 'crossing');
  if (crossing >= 0 && crossing < pathCount) {
    const south = AMBIENT_PATHS.findIndex((p) => p.id === 'south-loop');
    const span = south > crossing && south < pathCount ? south - crossing + 1 : 1;
    return crossing + (k % span);
  }
  return population + (k % Math.max(pathCount - population, 1));
}

/**
 * Clear cylinders around the hero objects (world x/z, metres). Radii are the
 * hero footprint plus a figure body — a walker centre inside one of these
 * means the figure clips the hero.
 */
export interface ClearCylinder {
  at: Vec2;
  radius: number;
}

export const HERO_CLEARS: readonly ClearCylinder[] = [
  // West desk (6.4 × 2.2 circumscribed ≈ 3.4, + body).
  { at: [-13.5, 0], radius: 3.9 },
  // North board cabinets (7.6 wide, elevated — the gantry pylons reach the
  // ground) and the pylons at ±9.2.
  { at: [-4.4, -16.2], radius: 1.6 },
  { at: [4.4, -16.2], radius: 1.6 },
  { at: [-9.2, -17.9], radius: 0.9 },
  { at: [9.2, -17.9], radius: 0.9 },
  // Challenge gate (7.2 wide → half 3.6, + body).
  { at: [0, 16.4], radius: 4.3 },
];

/** Statue row: a capsule along z at x = 13.5 (8 plinths × 2.35 m spacing). */
export interface ClearSegment {
  a: Vec2;
  b: Vec2;
  radius: number;
}

export const HERO_SEGMENTS: readonly ClearSegment[] = [
  { a: [13.5, -8.2], b: [13.5, 8.2], radius: 1.9 },
];

/**
 * Focus dolly corridors: station camera endpoint → its focus pose (the board
 * framing stops ≈ 8 m out; desk-PC and ace poses ≈ 2–3 m off the hero; the
 * gate plaque pose ≈ 7 m north of the plaque). Half-width covers the camera
 * path plus a figure body.
 */
export interface DollyCorridor {
  station: string;
  a: Vec2;
  b: Vec2;
  halfWidth: number;
}

export const DOLLY_CORRIDORS: readonly DollyCorridor[] = [
  { station: 'pulse', a: [-1.2, -5.0], b: [-3.6, -8.3], halfWidth: 1.0 },
  { station: 'roster', a: [-5.2, 0.4], b: [-11.5, 0.2], halfWidth: 1.0 },
  { station: 'teams', a: [5.2, 0.2], b: [11.2, 0.0], halfWidth: 1.0 },
  { station: 'schedule', a: [1.2, -5.0], b: [3.6, -8.3], halfWidth: 1.0 },
  { station: 'rules', a: [0.0, -4.6], b: [0.5, 8.2], halfWidth: 1.0 },
];

/** Distance from a point to a 2-D segment. */
export function distanceToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const lenSq = abx * abx + abz * abz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * abx + (pz - a[1]) * abz) / lenSq));
  return Math.hypot(px - (a[0] + abx * t), pz - (a[1] + abz * t));
}

/** True when a world x/z position is clear of every hero and dolly corridor. */
export function clearOfHeroesAndDollies(x: number, z: number): boolean {
  for (const hero of HERO_CLEARS) {
    if (Math.hypot(x - hero.at[0], z - hero.at[1]) < hero.radius) return false;
  }
  for (const seg of HERO_SEGMENTS) {
    if (distanceToSegment(x, z, seg.a, seg.b) < seg.radius) return false;
  }
  for (const dolly of DOLLY_CORRIDORS) {
    if (distanceToSegment(x, z, dolly.a, dolly.b) < dolly.halfWidth) return false;
  }
  return true;
}

/** Where idle-only and static figures loiter: beside the planters, off every sightline. */
export const LOITER_SPOTS: readonly { at: Vec2; facing: Vec2 }[] = [
  { at: [-7.6, 6.4], facing: [0.5, -1] },
  { at: [7.6, 6.4], facing: [-0.5, -1] },
  { at: [-7.6, -4.4], facing: [0.5, 1] },
  { at: [7.6, -4.4], facing: [-0.5, 1] },
  { at: [-4.6, 9.4], facing: [1, -0.3] },
  { at: [4.6, 9.4], facing: [-1, -0.3] },
];

/** Figures taller than this are too big to wander the promenade. */
export const AMBIENT_MAX_HEIGHT_M = 2.2;
/** Per-file budget so ambient traffic never outweighs the aces. */
export const AMBIENT_MAX_KB = 1300;

/** Deterministic 32-bit PRNG (mulberry32); `next()` in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Same cast all day for one season: `seasonId` + UTC date. */
export function dailySeed(seasonId: string, now: Date = new Date()): number {
  const day = now.toISOString().slice(0, 10);
  return hashString(`${seasonId}|${day}`);
}

/** Fisher–Yates on a copy with the seeded PRNG. */
export function seededShuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface AmbientCandidate<T> {
  key: string;
  entry: T;
  heightM: number;
  /** D42: the cast size the budget reads (`castKbOf`: `castKb ?? kb`), never the wire size. */
  kb: number;
  canWalk: boolean;
}

export interface AmbientCast<T> {
  walkers: AmbientCandidate<T>[];
  loiterers: AmbientCandidate<T>[];
}

/**
 * Pick `count` figures for the day. Walkers (figures with a `walk` clip) are
 * preferred — a plaza reads alive through motion — but at most one per path
 * beyond the first lap so the loops never turn into a parade; the rest loiter.
 */
export function castAmbient<T>(
  candidates: readonly AmbientCandidate<T>[],
  count: number,
  seed: number,
): AmbientCast<T> {
  if (count <= 0 || candidates.length === 0) return { walkers: [], loiterers: [] };
  const random = seededRandom(seed);
  const eligible = candidates.filter(
    (c) => c.heightM <= AMBIENT_MAX_HEIGHT_M && c.kb <= AMBIENT_MAX_KB,
  );
  // One figure per species: the same Pikachu twice reads as a bug, not a crowd.
  const unique = new Map<string, AmbientCandidate<T>>();
  for (const c of seededShuffle(eligible, random)) if (!unique.has(c.key)) unique.set(c.key, c);
  const pool = [...unique.values()];
  // SIZE-FOR-VISIBILITY (C-036 r3): the frozen #pulse / #schedule eyes sit
  // ~10 m off their rails, so a walker's rendered size IS its species height —
  // and the bar counts rendered blobs. Walkers are therefore drawn from the
  // TALL band first (tallest bucket of the day, seeded inside), keeping the
  // daily-seeded diversity within a band; the short band fills the count only
  // when the tall band runs dry. Which species walk is a cast choice; real
  // size per species stays the law.
  const band = (h: number) => (h >= 1.2 ? 0 : h >= 0.9 ? 1 : 2);
  // Stable band-only sort: `pool` carries the seeded shuffle order, so the
  // daily seed still picks WHICH tall-band species walk (cast diversity); the
  // banding only decides WHICH BAND fills first. A full height/key sort would
  // make the cast seed-invariant (ambient.test.ts diversity regression).
  const ranked = pool.filter((c) => c.canWalk).sort((a, b) => band(a.heightM) - band(b.heightM));
  const walkerPref = ranked;
  const rest = pool.filter((c) => !c.canWalk);
  const picked = [...walkerPref, ...rest].slice(0, count);
  const maxWalkers = Math.min(picked.length, AMBIENT_PATHS.length * 2);
  const walkers: AmbientCandidate<T>[] = [];
  const loiterers: AmbientCandidate<T>[] = [];
  for (const c of picked) {
    if (c.canWalk && walkers.length < maxWalkers) walkers.push(c);
    else loiterers.push(c);
  }
  return { walkers, loiterers };
}

/** Cumulative segment lengths so a path can be sampled by distance. */
export interface PathTrack {
  path: AmbientPath;
  /** Cumulative length at each vertex; closed paths add the return segment. */
  cumulative: number[];
  length: number;
}

export function trackFor(path: AmbientPath): PathTrack {
  const cumulative = [0];
  const n = path.points.length;
  const segments = path.closed ? n : n - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = path.points[i];
    const b = path.points[(i + 1) % n];
    cumulative.push(cumulative[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { path, cumulative, length: cumulative[cumulative.length - 1] };
}

export interface PathSample {
  x: number;
  z: number;
  /** Unit heading in world x/z. */
  dx: number;
  dz: number;
  /** Distance to the next vertex along travel — walkers pause when it hits 0. */
  toVertex: number;
}

/**
 * Point at distance `s` along the track. Closed tracks wrap; open ones
 * ping-pong (heading flips on the way back) so a crossing never teleports.
 */
export function sampleTrack(track: PathTrack, s: number): PathSample {
  const { path, cumulative, length } = track;
  if (length <= 0) {
    const [x, z] = path.points[0];
    return { x, z, dx: 0, dz: 1, toVertex: Infinity };
  }
  let d: number;
  let reverse = false;
  if (path.closed) {
    d = ((s % length) + length) % length;
  } else {
    const period = length * 2;
    const t = ((s % period) + period) % period;
    reverse = t > length;
    d = reverse ? period - t : t;
  }
  const n = path.points.length;
  let i = 0;
  while (i < cumulative.length - 2 && cumulative[i + 1] <= d) i += 1;
  const a = path.points[i];
  const b = path.points[(i + 1) % n];
  const segLen = Math.max(cumulative[i + 1] - cumulative[i], 1e-6);
  const u = (d - cumulative[i]) / segLen;
  const x = a[0] + (b[0] - a[0]) * u;
  const z = a[1] + (b[1] - a[1]) * u;
  let dx = (b[0] - a[0]) / segLen;
  let dz = (b[1] - a[1]) / segLen;
  if (reverse) {
    dx = -dx;
    dz = -dz;
  }
  const toVertex = reverse ? d - cumulative[i] : cumulative[i + 1] - d;
  return { x, z, dx, dz, toVertex };
}

/** Yaw (about +Y) that turns a model whose forward is local +Z toward `(dx, dz)`. */
export function headingYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Walking speed in m/s scaled by body height: small Pokémon scurry, big ones amble. */
export function walkSpeed(heightM: number): number {
  return 0.55 + Math.min(heightM, 2) * 0.35;
}

/**
 * The core actor probe's data (POKEMON-CORE-PLAN §4 SEAT D step 6, L10): the
 * routeDebug-only evidence rig that puts the shared water and sky actors in
 * sakura's lake so the CAPTURE stage can measure them (K6–K10). Production
 * worlds get the actors only in their own staging rounds (4S / 4M / 4C).
 *
 * Pure data (no client imports), species-free (D18): the slots name
 * habitats, roles, size envelopes and clip needs only; the cast comes from
 * one `castSlots` batch (`resolveCoreProbeCast`, latched before reveal), and
 * the routeDebug `?coreCastFile=` pin — a manifest FILE PATH per role, never
 * a species — overrides a role's slots.
 *
 * Every number here is proven by `lib/route-world/__tests__/
 * core-actor-probe.keepout.test.ts` against `themeKeepOut(sakura)`: the
 * drift discs and the wader's walk clear every wedge, the surfacer's held
 * box and the lane clear every wedge and keep ≥ 0.06 NDC from every padded
 * face, the lane's ends are off frame at every station, focus and dolly
 * pose, and the pinned headroom values are re-derived (C17: pinned
 * constants plus a test, zero runtime CPU).
 *
 * Geometry note (measured by the test's own scan while authoring): the
 * pulse and schedule wedges cover the lake from the water up across its
 * middle and east (the boards stand beyond the lake from both eyes), so the
 * probe lives in the clear south-west lobe. The surfacer there sits in the
 * pulse board's DATA band at landed 390, so, like the lane (whose sky is the
 * portrait caption band), it is suppressed at portrait widths
 * (`portrait: false`) instead of being clipped (plan risk 6).
 */

import { castSlots, type CastExclusions, type CastPick, type CastSlot } from '@/lib/route-world/casting';
import type { FigureEntry, WorldManifest } from '@/lib/route-world/model-manifest';
import type { SkyLaneSpec } from '@/lib/route-world/sky-lanes';
import type { WaterShape } from '@/lib/route-world/water';
import type { DriftDisc, SurfacerSpot } from '@/lib/route-world/water-resident';
import { ISLAND, LAKE } from '@/components/world/themes/sakura/furniture/layout';
import type { ActorProgramShare } from './actor-programs';

/** The probe's world and water body (`Lake.tsx` `SAKURA_LAKE_ID`, restated: that module is client-only). */
export const CORE_PROBE_WORLD = 'sakura' as const;
export const CORE_PROBE_BODY_ID = 'sakura-lake';

/** The lake's footprint as `Lake.tsx` builds it (island + its 0.45 m sand collar). */
export const CORE_PROBE_LAKE: WaterShape & { surfaceY: number } = {
  center: [LAKE.x, LAKE.z],
  radii: [LAKE.rx, LAKE.rz],
  islands: [{ x: ISLAND.x, z: ISLAND.z, r: ISLAND.r + 0.45 }],
  surfaceY: LAKE.y,
};

/** The station whose window the probe belongs to (pulse: the lake reads from it). */
export const CORE_PROBE_STATION = 0;

/** Slot ids (`<world>:<group>:<n>`, species-free: seeds, snapshot keys). */
export const CORE_PROBE_SLOT_IDS = {
  floaters: ['sakura:core-probe-float:0', 'sakura:core-probe-float:1'],
  wader: 'sakura:core-probe-wader:0',
  surfacer: 'sakura:core-probe-surfacer:0',
  flyer: 'sakura:core-probe-flyer:0',
} as const;

/**
 * The probe's cast slots (the frozen `CastSlot` contract; SEAT B snapshots
 * them, INTEGRATE casts them with `castSlots`). Size envelopes are what the
 * keep-out test proves the data against.
 */
export const CORE_PROBE_SLOTS: readonly CastSlot[] = [
  ...CORE_PROBE_SLOT_IDS.floaters.map(
    (id): CastSlot => ({
      id,
      world: CORE_PROBE_WORLD,
      habitat: 'aquatic',
      role: 'floater',
      station: CORE_PROBE_STATION,
      height: { max: 1.2 },
      maxWidthM: 1.0,
      needs: { prefer: ['idle', 'idle2'], allowClipless: true },
      family: 'core-probe-float',
    }),
  ),
  {
    id: CORE_PROBE_SLOT_IDS.wader,
    world: CORE_PROBE_WORLD,
    habitat: 'aquatic',
    role: 'wader',
    station: CORE_PROBE_STATION,
    height: { max: 1.6 },
    maxWidthM: 1.0,
    needs: { require: ['walk'], prefer: ['idle', 'idle2'] },
  },
  {
    id: CORE_PROBE_SLOT_IDS.surfacer,
    world: CORE_PROBE_WORLD,
    habitat: 'aquatic',
    role: 'surfacer',
    station: CORE_PROBE_STATION,
    height: { min: 1.8, max: 2.2 },
    maxWidthM: 1.0,
    needs: { require: ['idle', 'idle2'] },
    // R31 (plan §7's disclosed static relax): the envelope stays (the keep-out proof stands);
    // an empty strict pick retries with the clips relaxed. The hold then plays idle, or holds
    // a static pose with no clips, and skips idle2 when the figure lacks it (`surfacerHoldClip`).
    fallback: 'relax-clips',
  },
  {
    id: CORE_PROBE_SLOT_IDS.flyer,
    world: CORE_PROBE_WORLD,
    habitat: 'air',
    role: 'lane-flyer',
    station: CORE_PROBE_STATION,
    height: { min: 1.4, max: 2.4 },
    maxWidthM: 2.6,
    needs: { require: ['idle'], prefer: ['idle2'] },
  },
];

/** A probe slot by id (the envelope the tests and the component read). */
export function coreProbeSlot(id: string): CastSlot {
  const slot = CORE_PROBE_SLOTS.find((candidate) => candidate.id === id);
  if (!slot) throw new Error(`core-actor-probe: no slot ${id}`);
  return slot;
}

export interface CoreProbeFloater {
  slotId: string;
  disc: DriftDisc;
  /** Authored start yaw (rad). */
  yaw: number;
  /**
   * The keep-out headroom's `below` (world y), minimum over the disc, for a
   * body of the slot's width — pinned (the breach clamp's input), re-derived
   * in the keep-out test (scan: floor = surfaceY, ceiling = surfaceY +
   * height.max + 1.5; 2.76 = the ceiling itself: the column is clear).
   */
  headroomBelowY: number;
  /** Drift speed (m/s). */
  driftMps: number;
}

export const CORE_PROBE_FLOATERS: readonly CoreProbeFloater[] = [
  { slotId: CORE_PROBE_SLOT_IDS.floaters[0], disc: { x: -5.6, z: -6.0, r: 0.3 }, yaw: 0.6, headroomBelowY: 2.76, driftMps: 0.12 },
  { slotId: CORE_PROBE_SLOT_IDS.floaters[1], disc: { x: -7.05, z: -7.05, r: 0.3 }, yaw: 1.1, headroomBelowY: 2.76, driftMps: 0.1 },
];

export interface CoreProbeWader {
  slotId: string;
  /** The shore spot it rests at (dry sand / lawn), facing the water. */
  anchor: { x: number; z: number; yaw: number };
  /** The water-edge point it walks to (just inside the rim). */
  edge: readonly [number, number];
  /** Authored walk speed (m/s; `matchGait` pulls it into the clip's honest range). */
  speedMps: number;
}

export const CORE_PROBE_WADER: CoreProbeWader = {
  slotId: CORE_PROBE_SLOT_IDS.wader,
  anchor: { x: -10.6, z: -6.4, yaw: 1.9 },
  edge: [-9.35, -6.85],
  speedMps: 0.45,
};

export interface CoreProbeSurfacer {
  slotId: string;
  /**
   * `headroomTopY` = `headroomAt(...).below − 0.3` at the spot (floor =
   * surfaceY, ceiling = surfaceY + height.max + 1, r = beam/2), pinned and
   * re-derived in the keep-out test (2.96: the column is clear to the ceiling).
   */
  spot: SurfacerSpot;
  /** False: never surfaces at portrait widths (the 390 data band rule). */
  portrait: boolean;
}

export const CORE_PROBE_SURFACER: CoreProbeSurfacer = {
  slotId: CORE_PROBE_SLOT_IDS.surfacer,
  spot: { x: -8.25, z: -7.9, yaw: 0.75, surfaceY: LAKE.y, headroomTopY: 2.96 },
  portrait: false,
};

/**
 * The probe lane: in from high over the west woods, a shallow dip behind
 * the rock's face plane to 11 m (seen at the pulse eye in the sky left of
 * and above the board), out high over the north-east. Both ends sit 40 m up
 * and far, off frame from every pose. Found by a scan of lawful dips (the
 * banner cloths are tall: a lower or more easterly dip meets their padded
 * rects at the pulse and schedule eyes).
 */
export const CORE_PROBE_LANE: SkyLaneSpec & { slotId: string } = {
  slotId: CORE_PROBE_SLOT_IDS.flyer,
  id: 'core-probe',
  station: CORE_PROBE_STATION,
  points: [
    [-68, 40, -44],
    [-34, 15, -28],
    [-18, 11, -24],
    [-2, 15, -28],
    [32, 40, -44],
  ],
  speedMps: 6.5,
  bodyRadiusM: 1.6,
  perch: null,
  entryExitMarginNdc: 0.05,
  portrait: false,
};

/**
 * R49 K9 (D26 "+0 programs"): the probe actors' program-sharing policy in
 * sakura (`actor-programs.ts`). Transparent double-sided parts draw front
 * faces in one pass (the actors' default). Unlit figure materials take the
 * VERTEX-COLOUR unlit program: sakura's world figures compile that variant
 * (its unlit export carries `COLOR_0`) and none compiles the plain one, so
 * an unlit cast export without vertex colours (a flyer) gets a white RGBA
 * colour — pixel-identical — instead of a world-new program. World data,
 * measured with `capture-route --program-keys` (R49 dev probe), not a
 * species rule (D18).
 */
export const CORE_PROBE_PROGRAM_SHARE: ActorProgramShare = { transparentSingleSided: true, unlitVertexColors: true };

/** The flyer's root name (C15 prop family). */
export function coreProbeFlyerRoot(laneId: string): string {
  return `${CORE_PROBE_WORLD}-prop-flyer-${laneId}`;
}

/** A resident's root name (C15 prop family); `slotId` → its tail. */
export function coreProbeResidentRoot(slotId: string): string {
  return `${CORE_PROBE_WORLD}-prop-resident-${slotId.slice(slotId.indexOf(':') + 1).replace(/:/g, '-')}`;
}

/* ------------------------------------------------------------------------ */
/* URL params (routeDebug only)                                             */
/* ------------------------------------------------------------------------ */

export type CoreProbeRole = 'floater' | 'wader' | 'surfacer' | 'flyer';

export const CORE_PROBE_ROLES: readonly CoreProbeRole[] = ['floater', 'wader', 'surfacer', 'flyer'];

/** `?routeDebug=1&coreActors=1`: the probe mounts (the `RouteWorldCanvas.tsx` gate). */
export function coreActorsRequested(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return params.get('routeDebug') === '1' && params.get('coreActors') === '1';
  } catch {
    return false;
  }
}

/** A manifest file path (never a species): `models/<form>/<n>.glb`-like, no scheme, no `..`. */
const FILE_PATH = /^[A-Za-z0-9_\-./]+\.glb$/;

/**
 * `?coreCastFile=` (routeDebug only; overrides `castSlots` for the named roles):
 * either one file for every role, or `role:file` pairs, comma separated —
 * `coreCastFile=floater:models/regular/1.glb,flyer:models/regular/2.glb`.
 * Tokens that are not a `.glb` path (or name an unknown role) are ignored.
 */
export function parseCoreCastFile(search: string): Record<CoreProbeRole, string | null> {
  const out: Record<CoreProbeRole, string | null> = { floater: null, wader: null, surfacer: null, flyer: null };
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get('coreCastFile');
  } catch {
    raw = null;
  }
  if (!raw) return out;
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    const colon = trimmed.indexOf(':');
    const role = colon > 0 ? trimmed.slice(0, colon) : null;
    const file = colon > 0 ? trimmed.slice(colon + 1) : trimmed;
    if (file.includes('..') || !FILE_PATH.test(file)) continue;
    if (role === null) {
      for (const r of CORE_PROBE_ROLES) if (out[r] === null) out[r] = file;
    } else if ((CORE_PROBE_ROLES as readonly string[]).includes(role)) {
      out[role as CoreProbeRole] = file;
    }
  }
  return out;
}

/**
 * `?castSeed=` (routeDebug only, L4): an unsigned 32-bit override of the
 * world cast seed. Anything else (absent, not a non-negative integer) → null.
 */
export function parseCoreCastSeed(search: string): number | null {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get('castSeed');
  } catch {
    raw = null;
  }
  if (raw === null || !/^\d{1,10}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n <= 0xffffffff ? n >>> 0 : null;
}

/* ------------------------------------------------------------------------ */
/* The cast (INTEGRATE: castSlots, once before reveal, latched)             */
/* ------------------------------------------------------------------------ */

/** The probe role that owns a slot id. */
export function coreProbeSlotRole(slotId: string): CoreProbeRole {
  if ((CORE_PROBE_SLOT_IDS.floaters as readonly string[]).includes(slotId)) return 'floater';
  if (slotId === CORE_PROBE_SLOT_IDS.wader) return 'wader';
  if (slotId === CORE_PROBE_SLOT_IDS.surfacer) return 'surfacer';
  if (slotId === CORE_PROBE_SLOT_IDS.flyer) return 'flyer';
  throw new Error(`core-actor-probe: no role for slot ${slotId}`);
}

/** Why a slot is empty: a `castSlots` reason, or a `?coreCastFile=` pin naming no manifest file. */
export type CoreProbeEmptyReason = NonNullable<CastPick['reason']> | 'pin-not-in-manifest';

/** One slot's cast, as the debug readout discloses it. */
export interface CoreProbeSlotCast {
  slotId: string;
  role: CoreProbeRole;
  /** The cast figure, or null: the slot stays EMPTY (never a literal fallback, D18). */
  entry: FigureEntry | null;
  /** 'cast': `castSlots`; 'pin': the routeDebug `?coreCastFile=` override. */
  source: 'cast' | 'pin';
  /** Null when cast; otherwise why the slot is empty. */
  reason: CoreProbeEmptyReason | null;
  /** `castSlots` rank (0 = first choice); 0 for a pin. */
  rank: number;
  relaxed: boolean;
}

export interface CoreProbeCast {
  seed: number;
  /** One row per `CORE_PROBE_SLOTS` slot, in declaration order. */
  slots: readonly CoreProbeSlotCast[];
  /** GLB-bearing entries to kick at load, deduped by file, slot order. */
  loadEntries: readonly FigureEntry[];
}

/**
 * The probe's cast (POKEMON-CORE-PLAN INTEGRATE; D step 6, L3–L5): one
 * world-level `castSlots` batch over `CORE_PROBE_SLOTS` (scarcest first,
 * unique dexId, live aces excluded by the caller's `exclude`). The caller
 * computes it ONCE before reveal and latches it for the session (D23).
 *
 * A `?coreCastFile=` pin (routeDebug) overrides its role's slots — both
 * floaters for `floater` — as a manifest FILE PATH; a pinned file absent from
 * the manifest leaves those slots empty ('pin-not-in-manifest'), it never
 * falls through to the cast. An empty, excluded or no-type-data pick leaves
 * its slot empty with the reason disclosed; nothing falls back to a literal.
 */
export function resolveCoreProbeCast(input: {
  manifest: WorldManifest;
  seed: number;
  exclude: CastExclusions;
  pin: Record<CoreProbeRole, string | null>;
}): CoreProbeCast {
  const { manifest, seed, exclude, pin } = input;
  const unpinned = CORE_PROBE_SLOTS.filter((slot) => pin[coreProbeSlotRole(slot.id)] === null);
  const picks = new Map<string, CastPick>();
  if (unpinned.length > 0) {
    for (const pick of castSlots(unpinned, manifest, seed, { exclude }).picks) picks.set(pick.slotId, pick);
  }
  const slots = CORE_PROBE_SLOTS.map((slot): CoreProbeSlotCast => {
    const role = coreProbeSlotRole(slot.id);
    const file = pin[role];
    if (file !== null) {
      const entry = manifest.figures.find((figure) => figure.file === file) ?? null;
      return { slotId: slot.id, role, entry, source: 'pin', reason: entry ? null : 'pin-not-in-manifest', rank: 0, relaxed: false };
    }
    const pick = picks.get(slot.id);
    const entry = pick?.entry ?? null;
    return {
      slotId: slot.id,
      role,
      entry,
      source: 'cast',
      reason: entry ? null : (pick?.reason ?? 'no-candidate'),
      rank: pick?.rank ?? 0,
      relaxed: pick?.relaxed ?? false,
    };
  });
  const loadEntries: FigureEntry[] = [];
  for (const row of slots) {
    if (row.entry && !loadEntries.some((e) => e.file === row.entry?.file)) loadEntries.push(row.entry);
  }
  return { seed, slots, loadEntries };
}

/** A slot's cast row (throws on an unknown slot id: static data). */
export function coreProbeCastFor(cast: CoreProbeCast, slotId: string): CoreProbeSlotCast {
  const row = cast.slots.find((candidate) => candidate.slotId === slotId);
  if (!row) throw new Error(`core-actor-probe: no cast row for ${slotId}`);
  return row;
}

/** Each role's slot (the floaters share one envelope). */
export function coreProbeRoleSlot(role: CoreProbeRole): CastSlot {
  if (role === 'floater') return coreProbeSlot(CORE_PROBE_SLOT_IDS.floaters[0]);
  if (role === 'wader') return coreProbeSlot(CORE_PROBE_SLOT_IDS.wader);
  if (role === 'surfacer') return coreProbeSlot(CORE_PROBE_SLOT_IDS.surfacer);
  return coreProbeSlot(CORE_PROBE_SLOT_IDS.flyer);
}

/**
 * The `?coreCastFile=` pin can cast a figure outside its slot's envelope
 * (height band or `maxWidthM`), which the keep-out proof does NOT cover (it
 * proves the envelope). The probe logs these (dev only) so a capture run on
 * such a pin is read as out-of-envelope, never as a keep-out result (R31:
 * K6's surfacing sub-bar on a pinned candidate records this warning).
 * `heights` / `widths` are each role's cast `figureHeightM` / `scaledWidthM`
 * (null: not cast; `widths` omitted: heights only).
 */
export function coreProbeEnvelopeWarnings(
  heights: Record<CoreProbeRole, number | null>,
  widths?: Record<CoreProbeRole, number | null>,
): string[] {
  const out: string[] = [];
  for (const role of CORE_PROBE_ROLES) {
    const slot = coreProbeRoleSlot(role);
    const h = heights[role];
    if (h !== null) {
      const band = slot.height;
      if (!(h <= band.max) || (band.min !== undefined && h < band.min)) {
        out.push(`${role}: height ${h.toFixed(2)} m is outside the slot band [${band.min ?? 0}, ${band.max}] m (keep-out unproven)`);
      }
    }
    const w = widths?.[role] ?? null;
    if (w !== null && !(w <= slot.maxWidthM)) {
      out.push(`${role}: width ${w.toFixed(2)} m is over the slot's ${slot.maxWidthM} m (keep-out unproven)`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Debug readout (`__routeWorldCoreActors`, routeDebug only)                */
/* ------------------------------------------------------------------------ */

/** One visibility-wish flip of an actor (K8's per-actor companion to the warm-stats appearance log). */
export interface CoreActorFlip {
  /** Director awake seconds at the flip. */
  awakeS: number;
  visible: boolean;
  /**
   * The flip was in the frustum. Water residents (R49): logged by the push
   * latch's hook at the flip the render sees, with the director's real
   * root-box test (the surfacer's R32 answer under the water). The flyer:
   * its sphere against the frame's frustum ("everywhere" while the camera
   * moves).
   */
  inFrustum: boolean;
  /**
   * Surfacer only: the flip happened with the figure's top at or under the
   * water surface, i.e. fully under the opaque water (occluded even when
   * `inFrustum`). The generic latch appearance log (warm-stats) cannot see
   * this; K8 reads it here to tell an unseen resident flip from a pop.
   */
  underWater?: boolean;
}

/**
 * One actor's live readout: a mutable row the actor writes in its step (no
 * allocation but on a flip) and the probe's bridge copies on demand.
 */
export interface CoreActorDebugRow {
  id: string;
  kind: 'floater' | 'wader' | 'surfacer' | 'flyer';
  mode: string;
  wants: boolean;
  x: number;
  y: number;
  z: number;
  /** Beat requests made (surfacer / flyer). */
  requests: number;
  /** Surfacings that broke the surface. */
  surfacings: number;
  /** Lane passes flown to the end. */
  passes: number;
  /** Floater play events. */
  plays: number;
  /** Wakes the body's limiter accepted. */
  wakes: number;
  /** Wader waterline crossings (also on the ledger, R12). */
  waterline: number;
  /** Bounded flip log, oldest first. */
  flips: CoreActorFlip[];
  /**
   * R49 K9 (D26): the figure materials the actor re-keyed onto the world's
   * shared programs (`actor-programs.ts`), by source material name; absent
   * when nothing needed it.
   */
  programs?: { singleSided: string[]; vertexColored: string[]; coloredMeshes: number };
  /** R49 K9: the figure's skinned meshes and the distinct skeletons they update per frame after sharing. */
  skeletons?: { skinnedMeshes: number; skeletons: number };
}

export const CORE_ACTOR_FLIP_LOG = 64;

export function createCoreActorDebugRow(id: string, kind: CoreActorDebugRow['kind']): CoreActorDebugRow {
  return { id, kind, mode: 'init', wants: true, x: 0, y: 0, z: 0, requests: 0, surfacings: 0, passes: 0, plays: 0, wakes: 0, waterline: 0, flips: [] };
}

export function noteCoreActorFlip(row: CoreActorDebugRow, visible: boolean, inFrustum: boolean, awakeS: number, underWater?: boolean): void {
  row.flips.push(underWater === undefined ? { awakeS, visible, inFrustum } : { awakeS, visible, inFrustum, underWater });
  if (row.flips.length > CORE_ACTOR_FLIP_LOG) row.flips.splice(0, row.flips.length - CORE_ACTOR_FLIP_LOG);
}

/* ------------------------------------------------------------------------ */
/* R49 K9 (reveal): the probe's loads queue behind the world's               */
/* ------------------------------------------------------------------------ */

/** R49 K9: the longest the probe waits for a world figure load to queue behind (then it mounts anyway). */
export const CORE_PROBE_QUEUE_FALLBACK_MS = 1500;

/** The figure loader and the clock `waitBehindWorldLoads` reads (injected: the hook passes the real ones). */
export interface BehindWorldLoadsDeps {
  /** Figure preloads in flight (`pendingFigureLoads`). */
  pending: () => number;
  /** Called on every figure load start / settle (`subscribeFigureLoads`); returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/**
 * R49 K9: calls `onQueued` ONCE, as soon as a world figure preload is in
 * flight (at once when one already is) or after `CORE_PROBE_QUEUE_FALLBACK_MS`,
 * whichever comes first. The probe holds residency, and mounts no actor and
 * kicks no preload, until then. Returns the cancel (unsubscribe and clear the
 * fallback); it also runs itself when `onQueued` fires.
 */
export function waitBehindWorldLoads(deps: BehindWorldLoadsDeps, onQueued: () => void): () => void {
  let done = false;
  let off: (() => void) | null = null;
  let timer: unknown = null;
  const cancel = () => {
    if (off !== null) off();
    off = null;
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const fire = () => {
    if (done) return;
    done = true;
    cancel();
    onQueued();
  };
  if (deps.pending() > 0) {
    fire();
    return cancel;
  }
  off = deps.subscribe(() => {
    if (deps.pending() > 0) fire();
  });
  timer = deps.setTimer(fire, CORE_PROBE_QUEUE_FALLBACK_MS);
  return () => {
    done = true;
    cancel();
  };
}

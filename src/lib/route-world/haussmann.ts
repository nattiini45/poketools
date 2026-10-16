/**
 * Haussmann plaza grammar — plan first, triangles later.
 *
 * Pipeline: settings → mass wings (exposed spans) → façade placements →
 * material-slot writer in HaussmannBlock. Modules own construction depth.
 */

import { AMBIENT_PATHS, LOITER_SPOTS, clearOfHeroesAndDollies, distanceToSegment } from './ambient';
import type { CalmBackdrop } from './data-surfaces';
import { FURNITURE, GATE, PLAZA } from './layout';

export const HAUSSMANN = {
  bayWidth: 2.55,
  floorHeight: 3.2,
  podiumHeight: 3.55,
  cornice: 0.34,
  balconyDepth: 0.22,
  windowW: 0.88,
  windowH: 1.62,
  sill: 0.92,
  /** Depth of recessed window volume behind the façade plane. */
  recessDepth: 0.72,
  jambWidth: 0.22,
  /**
   * Camera-facing reveal width (metres). Walking cameras are face-on, so
   * edge-on jambs collapse to 2px AA — this splay is the visible return.
   */
  revealSplay: 0.12,
  /** Shallower pane recess so the splay is not a knife-edge. Do not deepen. */
  windowRecess: 0.26,
  /** Proud architrave / lintel / sill on the wall plane. */
  architrave: 0.08,
  /**
   * Legacy spec field (kept on `MansardSpec`). The emitted roof's pitch is
   * `mansardHeight / inset` (fix r7: a hipped mansard — `mansardSurfaceY`).
   */
  mansardSlope: 0.72,
  mansardHeight: 2.45,
  mansardInset: 1.05,
  pilaster: 0.1,
  string: 0.12,
  chimneyW: 0.62,
  chimneyD: 0.48,
  chimneyH: 1.65,
  /**
   * Fix r7: the stack runs this far below the deck, so a stack that straddles
   * the hip break rises out of the slope instead of hanging over it
   * (`mansardSurfaceY`; the hidden root is inside the closed roof).
   */
  chimneyRoot: 1.1,
  /** Fix r7: how far a dormer's front stands proud of the slope at its footing. */
  dormerProud: 0.05,
} as const;

export type KitModuleId =
  | 'window'
  | 'balcony'
  | 'cornice'
  | 'mansard'
  | 'chimney'
  | 'led'
  | 'string'
  | 'pilaster';

export interface KitPlacement {
  module: KitModuleId;
  /** Along the façade, origin at the block centre. */
  x: number;
  y: number;
  lit: boolean;
  /** Recess depth for window volumes (metres). */
  recess?: number;
  /**
   * Local Z. Ridge chimneys sit on the mansard cap (z = 0), not the
   * façade plane — frontZ stacks hide behind the zinc slope.
   */
  z?: number;
}

export interface StonePlate {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface WindowVolume {
  x: number;
  y: number;
  w: number;
  h: number;
  recess: number;
  lit: boolean;
  /** Front façade default; void faces the north through-opening. */
  face?: 'front' | 'void';
  /** +1 = +X inner face, −1 = −X inner face. */
  voidSign?: 1 | -1;
}

export interface MansardSpec {
  baseY: number;
  width: number;
  depth: number;
  slope: number;
  rise: number;
  inset: number;
}

export interface MassWing {
  id: string;
  startBay: number;
  endBay: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface LedSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  recess: number;
}

export interface BlockPlan {
  id: string;
  origin: readonly [number, number, number];
  rotationY: number;
  widthBays: number;
  depth: number;
  /** Floors above the taller ground storey. */
  upperFloors: number;
  hasMansard: boolean;
  /** Bay ranges skipped so jumbotrons / the Center cut the wall. */
  reserved: readonly { startBay: number; endBay: number }[];
  /**
   * Window-light keep-out (LOOK-PLAN §2 S.3): a lit pane is only lit when
   * this says its WORLD sphere (centre, radius) is clear of every data face
   * — the keep-out wedges in front of a face and the calm boxes behind it.
   * Absent: every hashed window may light (tests, other callers).
   */
  windowClear?: WindowClear;
}

/** World-sphere clearance test for a lit window (see `BlockPlan.windowClear`). */
export type WindowClear = (center: readonly [number, number, number], radius: number) => boolean;

/** Share of UPPER-storey windows that carry a warm night light (LOOK-PLAN §2 S.3: ~22 %). */
// LOOK r5 (night: "the warm façade window rhythm is gone at pulse"): ~36 %.
export const UPPER_WINDOW_LIGHT_SHARE = 0.36;

/** Deterministic integer hash → [0, 1) (no Math.random: stills must be reproducible). */
function windowHash(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function planSeed(plan: BlockPlan): number {
  let s = 0;
  for (let i = 0; i < plan.id.length; i += 1) s = Math.imul(s ^ plan.id.charCodeAt(i), 0x01000193) >>> 0;
  return s;
}

/**
 * The hashed light rhythm, before the keep-out: upper storeys light an
 * irregular ~36 % (static — never animated, no twinkle); the ground storey
 * keeps its shopfront rhythm (most shops lit).
 */
export function windowLitByRhythm(plan: BlockPlan, bay: number, floor: number): boolean {
  if (floor === 0) return (bay * 3 + floor * 5) % 7 > 1;
  return windowHash(planSeed(plan), bay, floor) < UPPER_WINDOW_LIGHT_SHARE;
}

/** Block-local point → world (three's rotation about +Y: x' = x c + z s, z' = −x s + z c). */
export function blockToWorld(plan: BlockPlan, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(plan.rotationY);
  const s = Math.sin(plan.rotationY);
  return [plan.origin[0] + x * c + z * s, plan.origin[1] + y, plan.origin[2] - x * s + z * c];
}

/** Window light after the keep-out: the rhythm, and a clear world sphere when the plan carries a test. */
function windowLit(plan: BlockPlan, bay: number, floor: number, local: readonly [number, number, number], w: number, h: number): boolean {
  if (!windowLitByRhythm(plan, bay, floor)) return false;
  if (!plan.windowClear) return true;
  return plan.windowClear(blockToWorld(plan, local[0], local[1], local[2]), Math.hypot(w, h) / 2);
}

export function blockWidth(plan: BlockPlan): number {
  return plan.widthBays * HAUSSMANN.bayWidth;
}

export function blockHeight(plan: BlockPlan): number {
  return HAUSSMANN.podiumHeight + plan.upperFloors * HAUSSMANN.floorHeight;
}

export function mansardSpec(plan: BlockPlan): MansardSpec | null {
  if (!plan.hasMansard) return null;
  const height = blockHeight(plan);
  return {
    baseY: height + HAUSSMANN.cornice,
    width: blockWidth(plan) + 0.35,
    depth: plan.depth + 0.28,
    slope: HAUSSMANN.mansardSlope,
    rise: HAUSSMANN.mansardHeight,
    inset: HAUSSMANN.mansardInset,
  };
}

/** Per-wing mansard so a through-void is not roofed over. */
export function mansardSpecForWing(plan: BlockPlan, wing: MassWing): MansardSpec | null {
  if (!plan.hasMansard) return null;
  return {
    baseY: blockHeight(plan) + HAUSSMANN.cornice,
    width: wing.w + 0.28,
    depth: wing.d + 0.22,
    slope: HAUSSMANN.mansardSlope,
    rise: HAUSSMANN.mansardHeight,
    inset: Math.min(HAUSSMANN.mansardInset, wing.w * 0.22),
  };
}

/**
 * Fix r7 (D31 #1/#2): the roof envelope — a HIPPED mansard. Four slopes rise
 * from the eave rectangle (`width × depth` at `baseY`) inward by `inset` to
 * the deck (`baseY + rise`), so the roof closes at every block end. Returns
 * the envelope's height at wing-local `(x, z)` (x from the wing centre), or
 * null outside the eave footprint.
 *
 * Until r7 the writer tilted its slope plates the wrong way (the long slopes
 * flared outward and the end slopes hung 1.6 m past the block ends, into
 * the rules sky gap), which also left the ridge chimneys standing in the
 * open V between the flared slopes.
 */
export function mansardSurfaceY(roof: MansardSpec, x: number, z: number): number | null {
  const edge = Math.min(roof.width / 2 - Math.abs(x), roof.depth / 2 - Math.abs(z));
  if (edge < 0) return null;
  return roof.baseY + roof.rise * Math.min(1, edge / roof.inset);
}

/** The deck (upper, flat roof) top of a mansard. */
export function mansardDeckY(roof: MansardSpec): number {
  return roof.baseY + roof.rise;
}

/**
 * Fix r7: the lucarne's seat on the front slope — its footing (y) 0.38 up the
 * roof less 0.5 m (the pre-r7 kit dormer's footing), and its
 * front plane (wing-local z) `dormerProud` in front of the slope at that
 * height. The lucarne (HaussmannBlock `LUCARNE`) runs back INTO the slope
 * from there.
 */
export function dormerSeat(roof: MansardSpec): { footY: number; frontZ: number } {
  const footY = roof.baseY + roof.rise * 0.38 - 0.5;
  const climb = footY - roof.baseY;
  return { footY, frontZ: roof.depth / 2 - (climb * roof.inset) / roof.rise + HAUSSMANN.dormerProud };
}

function bayReserved(plan: BlockPlan, bay: number): boolean {
  return plan.reserved.some((span) => bay >= span.startBay && bay < span.endBay);
}

/** North reserved span is a through-opening (PB-041). Other reserved bays skip windows only. */
export function isThroughVoid(plan: BlockPlan): boolean {
  return plan.id === 'north';
}

export function massWings(plan: BlockPlan): MassWing[] {
  const height = blockHeight(plan);
  const width = blockWidth(plan);
  const halfW = width / 2;

  if (!isThroughVoid(plan) || plan.reserved.length === 0) {
    return [
      {
        id: `${plan.id}-wing`,
        startBay: 0,
        endBay: plan.widthBays,
        x: 0,
        y: height / 2,
        z: 0,
        w: width,
        h: height,
        d: plan.depth,
      },
    ];
  }

  const wings: MassWing[] = [];
  let bay = 0;
  while (bay < plan.widthBays) {
    if (bayReserved(plan, bay)) {
      while (bay < plan.widthBays && bayReserved(plan, bay)) bay += 1;
      continue;
    }
    const start = bay;
    while (bay < plan.widthBays && !bayReserved(plan, bay)) bay += 1;
    const span = bay - start;
    const w = span * HAUSSMANN.bayWidth;
    const x = (start + span / 2) * HAUSSMANN.bayWidth - halfW;
    wings.push({
      id: `${plan.id}-wing-${start}`,
      startBay: start,
      endBay: bay,
      x,
      y: height / 2,
      z: 0,
      w,
      h: height,
      d: plan.depth,
    });
  }
  return wings;
}

export function floorBaseY(floor: number): number {
  if (floor === 0) return 0;
  return HAUSSMANN.podiumHeight + (floor - 1) * HAUSSMANN.floorHeight;
}

/** Window centre Y for a floor index. */
function windowCenterY(floor: number): number {
  return floor === 0
    ? HAUSSMANN.sill + 0.62
    : HAUSSMANN.podiumHeight + (floor - 1) * HAUSSMANN.floorHeight + HAUSSMANN.sill;
}

function windowSize(floor: number): { w: number; h: number } {
  if (floor === 0) return { w: HAUSSMANN.windowW + 0.08, h: HAUSSMANN.windowH + 0.28 };
  if (floor >= 3) return { w: HAUSSMANN.windowW - 0.06, h: HAUSSMANN.windowH - 0.18 };
  return { w: HAUSSMANN.windowW, h: HAUSSMANN.windowH };
}

export function ledSpecs(plan: BlockPlan): LedSpec[] {
  const width = blockWidth(plan);
  const halfW = width / 2;
  if (plan.id === 'east') {
    // Bays 6–9 sit in the teams-1440 left crop (screen-left = +Z = high bay).
    const startBay = 6;
    const endBay = 9;
    const w = (endBay - startBay) * HAUSSMANN.bayWidth - 0.2;
    const x = (startBay + (endBay - startBay) / 2) * HAUSSMANN.bayWidth - halfW;
    const y0 = windowCenterY(0);
    const y1 = windowCenterY(1);
    return [
      {
        x,
        y: (y0 + y1) / 2,
        w,
        h: y1 - y0 + HAUSSMANN.windowH + 0.2,
        recess: HAUSSMANN.recessDepth + 0.06,
      },
    ];
  }
  if (plan.id === 'south-west') {
    const startBay = 2;
    const endBay = 4;
    const w = (endBay - startBay) * HAUSSMANN.bayWidth - 0.16;
    const x = (startBay + (endBay - startBay) / 2) * HAUSSMANN.bayWidth - halfW;
    const y0 = windowCenterY(0);
    const y1 = windowCenterY(1);
    return [
      {
        x,
        y: (y0 + y1) / 2,
        w,
        h: y1 - y0 + HAUSSMANN.windowH + 0.28,
        recess: HAUSSMANN.recessDepth + 0.06,
      },
    ];
  }
  return [];
}

function bayHasLed(plan: BlockPlan, bay: number, floor: number): boolean {
  if (plan.id === 'east') return floor <= 1 && bay >= 6 && bay < 9;
  if (plan.id === 'south-west') return floor <= 1 && bay >= 2 && bay < 4;
  return false;
}

export function planBlock(plan: BlockPlan): KitPlacement[] {
  const placements: KitPlacement[] = [];
  const width = blockWidth(plan);
  const storeys = plan.upperFloors + 1;

  for (let floor = 0; floor < storeys; floor += 1) {
    const y = windowCenterY(floor);

    for (let bay = 0; bay < plan.widthBays; bay += 1) {
      if (bayReserved(plan, bay)) continue;
      if (bayHasLed(plan, bay, floor)) continue;
      const x = (bay + 0.5) * HAUSSMANN.bayWidth - width / 2;
      const { w: winW, h: winH } = windowSize(floor);
      const lit = windowLit(plan, bay, floor, [x, y, plan.depth / 2], winW, winH);
      placements.push({
        module: 'window',
        x,
        y,
        lit,
        recess: HAUSSMANN.recessDepth,
      });
      if (floor >= 1 && floor <= 2) {
        placements.push({ module: 'balcony', x, y: y - windowSize(floor).h / 2 - 0.04, lit: false });
      }
    }
  }

  placements.push({ module: 'cornice', x: 0, y: blockHeight(plan), lit: false });
  if (plan.hasMansard) {
    placements.push({
      module: 'mansard',
      x: 0,
      y: blockHeight(plan) + HAUSSMANN.mansardHeight * 0.55,
      lit: false,
    });
  }

  for (const wing of massWings(plan)) {
    const ridgeY =
      blockHeight(plan) + HAUSSMANN.cornice + HAUSSMANN.mansardHeight + HAUSSMANN.chimneyH / 2;
    /**
     * Local X near each hip (0.42 of span). Rules looks south: only the
     * gate-side hip of south-west / south-east sits in the 768/390 frustum
     * (±0.28 sat on the 768 edge and outside 390).
     */
    const xs = [wing.x - wing.w * 0.42, wing.x + wing.w * 0.42];
    if (wing.w > HAUSSMANN.bayWidth * 3) {
      xs.push(wing.x);
    }
    for (const x of xs) {
      placements.push({
        module: 'chimney',
        x,
        y: ridgeY,
        z: 0,
        lit: false,
      });
    }
  }

  return placements;
}

/**
 * Inspectable façade plates + window volumes. The writer no longer hangs these
 * as a punched front; tests still read the compiled openings.
 */
export function compileFacade(
  plan: BlockPlan,
): { plates: StonePlate[]; windows: WindowVolume[] } {
  const width = blockWidth(plan);
  const height = blockHeight(plan);
  const storeys = plan.upperFloors + 1;
  const halfW = width / 2;
  const frontZ = plan.depth / 2;
  const plateDepth = 0.16;
  const plates: StonePlate[] = [];
  const windows: WindowVolume[] = [];

  const addPlate = (x: number, y: number, w: number, h: number, d = plateDepth) => {
    if (w < 0.05 || h < 0.05) return;
    plates.push({ x, y, z: frontZ - d / 2, w, h, d });
  };

  addPlate(0, HAUSSMANN.sill / 2, width, HAUSSMANN.sill, plateDepth + 0.06);

  for (let floor = 0; floor < storeys; floor += 1) {
    const floorBottom = floorBaseY(floor);
    const floorTop = floor === 0 ? HAUSSMANN.podiumHeight : floorBottom + HAUSSMANN.floorHeight;
    const winY = windowCenterY(floor);
    const { w: winW, h: winH } = windowSize(floor);
    const winHalfH = winH / 2;
    const lintelY = winY + winHalfH;
    const sillY = winY - winHalfH;

    const lintelTop = floor === storeys - 1 ? height - 0.08 : floorTop - 0.06;
    addPlate(0, (lintelY + lintelTop) / 2, width, lintelTop - lintelY);

    const sillBottom = floor === 0 ? HAUSSMANN.sill : floorBottom + 0.08;
    addPlate(0, (sillBottom + sillY) / 2, width, sillY - sillBottom);

    let bay = 0;
    while (bay < plan.widthBays) {
      if (bayReserved(plan, bay)) {
        const start = bay;
        while (bay < plan.widthBays && bayReserved(plan, bay)) bay += 1;
        if (!isThroughVoid(plan)) {
          const spanW = (bay - start) * HAUSSMANN.bayWidth;
          const spanX = (start + (bay - start) / 2) * HAUSSMANN.bayWidth - halfW;
          if (start > 0) {
            addPlate(
              spanX - spanW / 2 - HAUSSMANN.jambWidth / 2,
              (sillY + lintelY) / 2,
              HAUSSMANN.jambWidth,
              lintelY - sillY,
              HAUSSMANN.recessDepth,
            );
          }
          if (bay < plan.widthBays) {
            addPlate(
              spanX + spanW / 2 + HAUSSMANN.jambWidth / 2,
              (sillY + lintelY) / 2,
              HAUSSMANN.jambWidth,
              lintelY - sillY,
              HAUSSMANN.recessDepth,
            );
          }
        }
        continue;
      }

      if (bayHasLed(plan, bay, floor)) {
        bay += 1;
        continue;
      }

      const x = (bay + 0.5) * HAUSSMANN.bayWidth - halfW;
      const lit = windowLit(plan, bay, floor, [x, winY, frontZ], winW, winH);
      windows.push({
        x,
        y: winY,
        w: winW,
        h: winH,
        recess: HAUSSMANN.recessDepth,
        lit,
        face: 'front',
      });

      const leftEdge = x - winW / 2;
      const prevEdge =
        bay === 0 || bayReserved(plan, bay - 1)
          ? -halfW
          : x - HAUSSMANN.bayWidth + winW / 2;
      const pierW = leftEdge - prevEdge;
      if (pierW > 0.06) {
        addPlate(
          (prevEdge + leftEdge) / 2,
          (sillY + lintelY) / 2,
          pierW,
          lintelY - sillY,
          HAUSSMANN.recessDepth * 0.85,
        );
      }

      bay += 1;
    }

    const lastBay = plan.widthBays - 1;
    if (!bayReserved(plan, lastBay) && !bayHasLed(plan, lastBay, floor)) {
      const x = (lastBay + 0.5) * HAUSSMANN.bayWidth - halfW;
      const { w: lastW } = windowSize(floor);
      const rightEdge = x + lastW / 2;
      const pierW = halfW - rightEdge;
      if (pierW > 0.06) {
        addPlate(
          (rightEdge + halfW) / 2,
          (sillY + lintelY) / 2,
          pierW,
          lintelY - sillY,
          HAUSSMANN.recessDepth * 0.85,
        );
      }
    }
  }

  if (isThroughVoid(plan)) {
    for (const wing of massWings(plan)) {
      const sign: 1 | -1 = wing.x < 0 ? 1 : -1;
      const storeys = plan.upperFloors + 1;
      for (let floor = 0; floor < storeys; floor += 1) {
        const { w: winW, h: winH } = windowSize(floor);
        const voidX = wing.x + sign * (wing.w / 2);
        const voidLit =
          floor % 2 === 0 &&
          (!plan.windowClear ||
            plan.windowClear(blockToWorld(plan, voidX, windowCenterY(floor), 0), Math.hypot(winW, winH) / 2));
        windows.push({
          x: voidX,
          y: windowCenterY(floor),
          w: winW,
          h: winH,
          recess: HAUSSMANN.recessDepth,
          lit: voidLit,
          face: 'void',
          voidSign: sign,
        });
      }
    }
  }

  return { plates, windows };
}

/**
 * Blender façade kit (scripts/world-assets/blender/facade-kit.py, ADR-0001).
 * Each module is authored with its origin on the storey floor line, centred on
 * the bay, front face on the façade plane; `kitBayPlacements` says where the
 * copies go in block-local space. Sizes are the same HAUSSMANN numbers the
 * procedural writer uses, so a kit bay drops into the writer's wall opening.
 */
export type KitBayId =
  | 'bay-ground'
  | 'bay-shopfront'
  | 'bay-balcony'
  | 'bay-plain'
  | 'dormer';

export const KIT_BAY_IDS: readonly KitBayId[] = [
  'bay-ground',
  'bay-shopfront',
  'bay-balcony',
  'bay-plain',
  'dormer',
];

export interface KitBayPlacement {
  bay: KitBayId;
  x: number;
  y: number;
  z: number;
  /** Interior pane glows (lamp) or reads dark (glass). */
  lit: boolean;
}

/** Kit module for a storey: shopfront or arched podium bay, balconied, plain above. */
export function kitBayForFloor(floor: number): KitBayId {
  if (floor === 0) return 'bay-ground';
  return floor <= 2 ? 'bay-balcony' : 'bay-plain';
}

/** Storey index a compiled window volume sits on (its centre Y is the witness). */
export function floorOfVolume(volume: WindowVolume): number {
  return volume.y < HAUSSMANN.podiumHeight
    ? 0
    : Math.round((volume.y - HAUSSMANN.sill - HAUSSMANN.podiumHeight) / HAUSSMANN.floorHeight) + 1;
}

/** Bay index a block-local X falls in (window centres sit at bay middles). */
export function bayOfX(plan: BlockPlan, x: number): number {
  return Math.round(x / HAUSSMANN.bayWidth + plan.widthBays / 2 - 0.5);
}

/**
 * Which ground-floor bays are shopfronts: the west flank reads as one Poké
 * Center / retail frontage facing the desk, every other block alternates
 * shopfront and arched podium bays like a mixed-use street. Both the kit
 * placements and the procedural writer must ask this, so a block never mixes
 * its two answers for one bay.
 */
export function isShopfrontBay(plan: BlockPlan, bay: number): boolean {
  if (plan.id === 'west') return true;
  return bay % 2 === 0;
}

export function kitBayPlacements(plan: BlockPlan): KitBayPlacement[] {
  const frontZ = plan.depth / 2;
  const out: KitBayPlacement[] = [];
  for (const volume of compileFacade(plan).windows) {
    if (volume.face === 'void') continue;
    // Recover the storey from the window centre the writer computed.
    const floor = floorOfVolume(volume);
    const bay =
      floor === 0 && isShopfrontBay(plan, bayOfX(plan, volume.x)) ? 'bay-shopfront' : kitBayForFloor(floor);
    out.push({ bay, x: volume.x, y: floorBaseY(floor), z: frontZ, lit: volume.lit });
  }
  // Fix r7 (D31 #2): no kit dormer is placed. The module was a solid stone
  // block with its window buried inside and its hood pitched as a V — the
  // "floating brick block" above the rules gate. HaussmannBlock's writer
  // builds the lucarne on the `dormerSeat` instead (the module still loads
  // with the kit; placed zero times it draws nothing).
  return out;
}

/** Four plaza walls. North reserves the dual-jumbotron span as a through-void. */
export function plazaBlockPlans(half: number): BlockPlan[] {
  return [
    {
      id: 'north',
      origin: [0, 0, -half - 2.2],
      rotationY: 0,
      widthBays: 16,
      depth: 4.4,
      upperFloors: 1,
      hasMansard: true,
      reserved: [{ startBay: 4, endBay: 12 }],
    },
    {
      id: 'west',
      origin: [-(half + 2.4), 0, 0],
      rotationY: Math.PI / 2,
      widthBays: 12,
      depth: 4.8,
      upperFloors: 1,
      hasMansard: true,
      reserved: [{ startBay: 4, endBay: 8 }],
    },
    {
      id: 'east',
      origin: [half + 2.4, 0, 0],
      rotationY: -Math.PI / 2,
      widthBays: 12,
      depth: 4.8,
      upperFloors: 1,
      hasMansard: true,
      reserved: [],
    },
    {
      id: 'south-west',
      origin: [-10.5, 0, half + 2],
      rotationY: Math.PI,
      widthBays: 5,
      depth: 4,
      upperFloors: 1,
      hasMansard: true,
      reserved: [],
    },
    {
      id: 'south-east',
      origin: [10.5, 0, half + 2],
      rotationY: Math.PI,
      widthBays: 5,
      depth: 4,
      upperFloors: 1,
      hasMansard: true,
      reserved: [],
    },
  ];
}

// ── Calm backdrops (LOOK-PLAN §2 S.3) ────────────────────────────────────────

/**
 * The world planes a data face is seen against on this block: each mass
 * wing's front (the façade plane, cornice included) and, on a through-void
 * block, the wing ends facing the void. Rotations are quarter turns, so every
 * plane is axis-aligned. `calmBoxesFor` (data-surfaces.ts) casts the padded
 * face rects onto these.
 */
export function blockBackdrops(plan: BlockPlan): CalmBackdrop[] {
  const out: CalmBackdrop[] = [];
  const top = blockHeight(plan) + HAUSSMANN.cornice;
  const frontZ = plan.depth / 2;
  const plane = (id: string, a: readonly [number, number], b: readonly [number, number]): CalmBackdrop => {
    const wa = blockToWorld(plan, a[0], 0, a[1]);
    const wb = blockToWorld(plan, b[0], 0, b[1]);
    const alongX = Math.abs(wa[0] - wb[0]) > Math.abs(wa[2] - wb[2]);
    return alongX
      ? { id, axis: 'z', at: (wa[2] + wb[2]) / 2, span: [Math.min(wa[0], wb[0]), Math.max(wa[0], wb[0])], y: [0, top] }
      : { id, axis: 'x', at: (wa[0] + wb[0]) / 2, span: [Math.min(wa[2], wb[2]), Math.max(wa[2], wb[2])], y: [0, top] };
  };
  for (const wing of massWings(plan)) {
    const x0 = wing.x - wing.w / 2;
    const x1 = wing.x + wing.w / 2;
    out.push(plane(`${wing.id}:front`, [x0, frontZ], [x1, frontZ]));
    if (isThroughVoid(plan)) {
      // The wing end that faces the void (the one away from the block edge).
      const inner = wing.x < 0 ? x1 : x0;
      out.push(plane(`${wing.id}:void`, [inner, -frontZ], [inner, frontZ]));
    }
  }
  return out;
}

/** Every plaza façade backdrop (`plazaBlockPlans(half)`). */
export function plazaFacadeBackdrops(half: number): CalmBackdrop[] {
  return plazaBlockPlans(half).flatMap(blockBackdrops);
}

// ── Kerb band (LOOK-PLAN §2 S.5) ─────────────────────────────────────────────

/** Kerb stone: a RoundedBox 1.2 × 0.14 × 0.3 m, laid along a ring |x|, |z| = offset. */
export const KERB = {
  offset: 17.2,
  length: 1.2,
  height: 0.14,
  depth: 0.3,
  /** Joint between stones (m). */
  joint: 0.03,
  radius: 0.02,
} as const;

export interface KerbSeat {
  /** Centre on the ground (x, z); the stone's base sits at y 0. */
  x: number;
  z: number;
  /** Yaw: 0 = long side along x (north / south runs), π/2 = along z. */
  yaw: number;
}

/** A ground rectangle the kerb must not enter (centre, half-extents; metres). */
export interface KerbExclusion {
  id: string;
  center: readonly [number, number];
  half: readonly [number, number];
}

/**
 * Kerb stones along the four façade runs at `KERB.offset`, restricted to the
 * spans actually fronted by a façade (street gaps and the north through-void
 * stay open) and outside every exclusion (the gate, the board gantry and the
 * Center pavilion). Callers add their own figure / corridor tests; the pure
 * table only knows the architecture.
 */
export function plazaKerbSeats(half: number, exclusions: readonly KerbExclusion[] = []): KerbSeat[] {
  const seats: KerbSeat[] = [];
  const step = KERB.length + KERB.joint;
  const blocked = (x: number, z: number, yaw: number) => {
    const hx = yaw === 0 ? KERB.length / 2 : KERB.depth / 2;
    const hz = yaw === 0 ? KERB.depth / 2 : KERB.length / 2;
    return exclusions.some(
      (e) => Math.abs(x - e.center[0]) < e.half[0] + hx && Math.abs(z - e.center[1]) < e.half[1] + hz,
    );
  };
  for (const backdrop of plazaFacadeBackdrops(half)) {
    if (backdrop.id.endsWith(':void')) continue;
    // Only façade fronts that face the plaza interior at the ring's side.
    if (Math.abs(Math.abs(backdrop.at) - half) > 0.05) continue;
    const sign = Math.sign(backdrop.at);
    const at = sign * KERB.offset;
    const lo = Math.max(backdrop.span[0], -KERB.offset + KERB.depth);
    const hi = Math.min(backdrop.span[1], KERB.offset - KERB.depth);
    const count = Math.floor((hi - lo + KERB.joint) / step);
    if (count <= 0) continue;
    const start = lo + (hi - lo - (count * step - KERB.joint)) / 2 + KERB.length / 2;
    for (let i = 0; i < count; i += 1) {
      const u = start + i * step;
      const seat: KerbSeat =
        backdrop.axis === 'z' ? { x: u, z: at, yaw: 0 } : { x: at, z: u, yaw: Math.PI / 2 };
      if (!blocked(seat.x, seat.z, seat.yaw)) seats.push(seat);
    }
  }
  return seats;
}

/**
 * The plaza's kerb exclusions (layout.ts anchors): the gate footprint and
 * its threshold, the board-gantry pylons (x −9.2 / 0 / 9.2 at the pulse
 * board's z − 1.7, BoardGantry in PlazaHall.tsx) and the Poké Center
 * pavilion with the west wall's reserved span (bays 4–8, ±5.1 m).
 */
export const PLAZA_KERB_EXCLUSIONS: readonly KerbExclusion[] = [
  { id: 'gate', center: [FURNITURE.gate.x, FURNITURE.gate.z], half: [GATE.width / 2 + 0.6, GATE.depth / 2 + 1.2] },
  ...([-9.2, 0, 9.2] as const).map((x) => ({
    id: `gantry:${x}`,
    center: [x, FURNITURE.pulseBoard.z - 1.7] as const,
    half: [0.9, 0.9] as const,
  })),
  { id: 'center', center: [-KERB.offset, FURNITURE.desk.z], half: [1.0, 5.4] },
];

/** Walker body radius (m) the kerb keeps from every ambient path and loiter spot. */
export const KERB_WALKER_CLEARANCE_M = 0.6;

/**
 * The plaza kerb: `plazaKerbSeats` minus any stone a walker path, a loiter
 * spot, a hero capsule or a dolly corridor would touch (ambient.ts) — the
 * band is set dressing, it never edits a figure's route.
 */
export function plazaKerb(): KerbSeat[] {
  const reach = Math.hypot(KERB.length, KERB.depth) / 2;
  return plazaKerbSeats(PLAZA.half, PLAZA_KERB_EXCLUSIONS).filter((seat) => {
    if (!clearOfHeroesAndDollies(seat.x, seat.z)) return false;
    for (const path of AMBIENT_PATHS) {
      const pts = path.points;
      const n = path.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i += 1) {
        if (distanceToSegment(seat.x, seat.z, pts[i], pts[(i + 1) % pts.length]) < KERB_WALKER_CLEARANCE_M + reach) {
          return false;
        }
      }
    }
    return LOITER_SPOTS.every((spot) => Math.hypot(seat.x - spot.at[0], seat.z - spot.at[1]) >= KERB_WALKER_CLEARANCE_M + reach);
  });
}

// ── Painterly windows (LOOK r4) ─────────────────────────────────────────────

/** How a glazing component renders: a pane (sky glass + frame), a sign band, or dropped. */
export type PaneKind = 'pane' | 'band' | 'drop';

/** One connected glazing component: its vertex indices and local bounds. */
export interface PaneComponent {
  kind: PaneKind;
  /** Triangle vertex indices (into the source vertex list) of this component. */
  triangles: number[];
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * LOOK r4 (lead: "stray floating black dashes and bars on the ashlar"): the
 * Blender kit paints its rustication channels and pier joints as thin strips
 * in the GLAZING slots (`bay-ground` pane: six 0.02 m strips 1.7 m wide in
 * front of the stone; `bay-shopfront` glass: four 0.02 m pier strips). Where
 * they poke past the module's stone into the writer's piers they read as
 * black dashes, so they are dropped. A strip is thinner than this in height
 * and depth.
 */
export const PANE_STRIP_MAX_M = 0.05;
/** A component wider than this multiple of its height is a sign band, not a window. */
export const PANE_BAND_ASPECT = 2.5;

/** Classify one component by its bounds. */
export function paneKindOf(min: readonly number[], max: readonly number[]): PaneKind {
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const across = Math.max(sx, sz);
  if (sy < PANE_STRIP_MAX_M && Math.min(sx, sz) < PANE_STRIP_MAX_M && across > 0.2) return 'drop';
  if (across > PANE_BAND_ASPECT * Math.max(sy, 1e-6)) return 'band';
  return 'pane';
}

/**
 * Split a triangle list into connected components (shared vertices OR
 * coincident positions join — box faces carry their own vertices) and
 * classify each. Pure: `position(i)` reads vertex i, `index` is the
 * triangle list (or null for a non-indexed list of `count` vertices).
 */
export function paneComponents(
  count: number,
  position: (i: number) => readonly [number, number, number],
  index: ArrayLike<number> | null,
): PaneComponent[] {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) {
      const next = parent[a];
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const tri = index ?? Array.from({ length: count }, (_, i) => i);
  for (let i = 0; i + 2 < tri.length; i += 3) {
    union(tri[i], tri[i + 1]);
    union(tri[i], tri[i + 2]);
  }
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    const p = position(i);
    const key = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    const at = seen.get(key);
    if (at === undefined) seen.set(key, i);
    else union(at, i);
  }
  const byRoot = new Map<number, PaneComponent>();
  for (let i = 0; i + 2 < tri.length; i += 3) {
    const root = find(tri[i]);
    let comp = byRoot.get(root);
    if (!comp) {
      comp = { kind: 'pane', triangles: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      byRoot.set(root, comp);
    }
    for (let k = 0; k < 3; k += 1) {
      const v = tri[i + k];
      comp.triangles.push(v);
      const p = position(v);
      for (let a = 0; a < 3; a += 1) {
        comp.min[a] = Math.min(comp.min[a], p[a]);
        comp.max[a] = Math.max(comp.max[a], p[a]);
      }
    }
  }
  const out = [...byRoot.values()];
  for (const comp of out) comp.kind = paneKindOf(comp.min, comp.max);
  return out;
}

/**
 * The pane-space coordinate of a point in its component: (0..1, 0..1) across
 * the component's wider horizontal axis and up its height; a sign band takes
 * (−1, −1) so the window shader paints it as a band.
 */
export function paneUvOf(comp: PaneComponent, p: readonly [number, number, number]): [number, number] {
  if (comp.kind === 'band') return [-1, -1];
  const sx = comp.max[0] - comp.min[0];
  const sz = comp.max[2] - comp.min[2];
  const sy = Math.max(comp.max[1] - comp.min[1], 1e-6);
  const u = sx >= sz ? (p[0] - comp.min[0]) / Math.max(sx, 1e-6) : (p[2] - comp.min[2]) / Math.max(sz, 1e-6);
  return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, (p[1] - comp.min[1]) / sy))];
}

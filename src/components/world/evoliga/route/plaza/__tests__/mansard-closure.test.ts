import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import {
  dormerSeat,
  HAUSSMANN,
  kitBayPlacements,
  mansardDeckY,
  mansardSpecForWing,
  mansardSurfaceY,
  massWings,
  planBlock,
  plazaBlockPlans,
  type BlockPlan,
  type MansardSpec,
  type MassWing,
} from '@/lib/route-world/haussmann';
import { PLAZA } from '@/lib/route-world/layout';
import { compileBlockSlots, LUCARNE, MANSARD_DECK_LIP } from '../HaussmannBlock';

/**
 * Fix r7 (D31 #1 / #2) — the rules-gate roof defects:
 *  1. grey slabs hanging in the sky gap above the rules gate: the writer's
 *     end-slope plates sat up to 1.6 m OUTBOARD of the block ends, tilted
 *     against the long slopes (which themselves flared outward);
 *  2. a brick block floating above the gate roof: the ridge chimney, standing
 *     in the open V between the flared slopes with its deck hidden.
 * The law now: every roof is a closed HIPPED mansard (`mansardSurfaceY`) and
 * nothing above the cornice floats.
 */

const PLANS = plazaBlockPlans(PLAZA.half);
const MM = 1e-3;
const CM = 1e-2;

type P3 = [number, number, number];

function vertices(geo: THREE.BufferGeometry | undefined): P3[] {
  if (!geo) return [];
  const pos = geo.getAttribute('position');
  const out: P3[] = [];
  for (let i = 0; i < pos.count; i += 1) out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  return out;
}

function roofs(plan: BlockPlan): { wing: MassWing; roof: MansardSpec }[] {
  return massWings(plan).flatMap((wing) => {
    const roof = mansardSpecForWing(plan, wing);
    return roof ? [{ wing, roof }] : [];
  });
}

/** The wing whose eave footprint holds a block-local (x, z), with its roof. */
function roofOver(plan: BlockPlan, x: number, z: number) {
  return roofs(plan).find(({ wing, roof }) => mansardSurfaceY(roof, x - wing.x, z) !== null) ?? null;
}

/** Inside a lucarne's own volume (its cheeks and hood are not roof skin). */
function inLucarne(plan: BlockPlan, [x, y, z]: P3): boolean {
  return roofs(plan).some(({ wing, roof }) => {
    const seat = dormerSeat(roof);
    return (
      Math.abs(x - wing.x) <= LUCARNE.width / 2 + LUCARNE.hoodSide + 0.05 &&
      y >= seat.footY - MM &&
      y <= seat.footY + LUCARNE.frontH + LUCARNE.hoodRise + 0.05 &&
      z >= seat.frontZ - LUCARNE.depth - 0.05 &&
      z <= seat.frontZ + LUCARNE.hoodFront + 0.05
    );
  });
}

describe('mansard envelope (pure)', () => {
  const [north] = PLANS;
  const { wing, roof } = roofs(north)[0];

  it('rises from the eave to the deck and is flat on the deck', () => {
    expect(mansardSurfaceY(roof, 0, roof.depth / 2)).toBeCloseTo(roof.baseY, 9);
    expect(mansardSurfaceY(roof, roof.width / 2, 0)).toBeCloseTo(roof.baseY, 9);
    expect(mansardSurfaceY(roof, 0, 0)).toBeCloseTo(mansardDeckY(roof), 9);
    expect(mansardSurfaceY(roof, 0, roof.depth / 2 - roof.inset / 2)).toBeCloseTo(roof.baseY + roof.rise / 2, 9);
    expect(wing.w).toBeGreaterThan(0);
  });

  it('is null outside the eave footprint (nothing hangs past a block end)', () => {
    expect(mansardSurfaceY(roof, roof.width / 2 + 0.01, 0)).toBeNull();
    expect(mansardSurfaceY(roof, 0, roof.depth / 2 + 0.01)).toBeNull();
  });
});

describe.each(PLANS.map((plan) => [plan.id, plan] as const))('roof of the %s block (shipped kit path)', (_id, plan) => {
  const slots = compileBlockSlots(plan, true);
  const zinc = vertices(slots.zinc);
  const stone = vertices(slots.stone);
  const wingRoofs = roofs(plan);

  it('keeps every zinc vertex inside a wing eave footprint and above the cornice', () => {
    expect(zinc.length).toBeGreaterThan(0);
    const outboard = zinc.filter(([x, y, z]) => {
      const over = wingRoofs.find(
        ({ wing, roof }) => Math.abs(x - wing.x) <= roof.width / 2 + MM && Math.abs(z) <= roof.depth / 2 + MM,
      );
      return !over || y < over.roof.baseY - MM;
    });
    expect(outboard).toEqual([]);
  });

  it('lays every slope vertex ON the hipped envelope (the roof closes at the block ends)', () => {
    const off: string[] = [];
    for (const [x, y, z] of zinc) {
      const over = roofOver(plan, x, z);
      if (!over || inLucarne(plan, [x, y, z])) continue;
      // Deck slab and chimney caps sit at or above the deck; the slopes below it.
      if (y >= mansardDeckY(over.roof) - MM) continue;
      const surface = mansardSurfaceY(over.roof, x - over.wing.x, z) as number;
      if (Math.abs(y - surface) > CM) off.push(`(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) vs ${surface.toFixed(2)}`);
    }
    expect(off).toEqual([]);
  });

  it('closes each wing: four slopes meet the eave on all four sides', () => {
    for (const { wing, roof } of wingRoofs) {
      const eave = zinc.filter(([x, y, z]) => Math.abs(y - roof.baseY) < MM && Math.abs(x - wing.x) <= roof.width / 2 + MM && Math.abs(z) <= roof.depth / 2 + MM);
      const at = (fx: (p: P3) => boolean) => eave.some(fx);
      expect(at(([x]) => Math.abs(x - (wing.x - roof.width / 2)) < MM)).toBe(true);
      expect(at(([x]) => Math.abs(x - (wing.x + roof.width / 2)) < MM)).toBe(true);
      expect(at(([, , z]) => Math.abs(z - roof.depth / 2) < MM)).toBe(true);
      expect(at(([, , z]) => Math.abs(z + roof.depth / 2) < MM)).toBe(true);
    }
  });

  it('points every slope normal outward and up (no plate flares over the plaza)', () => {
    const geo = slots.zinc as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const bad: number[] = [];
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      const over = roofOver(plan, pos.getX(i), pos.getZ(i));
      if (!over || y >= mansardDeckY(over.roof) - MM || inLucarne(plan, [pos.getX(i), y, pos.getZ(i)])) continue;
      const outward = (pos.getX(i) - over.wing.x) * nor.getX(i) + pos.getZ(i) * nor.getZ(i);
      if (nor.getY(i) <= 0 || outward <= 0) bad.push(i);
    }
    expect(bad).toEqual([]);
  });

  it('floats nothing above the deck: every chimney stack enters the roof at all four footprint corners', () => {
    const { chimneyW, chimneyD } = HAUSSMANN;
    const chimneys = planBlock(plan).filter((p) => p.module === 'chimney');
    expect(chimneys.length).toBeGreaterThan(0);
    const floating: string[] = [];
    for (const c of chimneys) {
      const cz = c.z ?? 0;
      const inStack = stone.filter(([x, , z]) => Math.abs(x - c.x) <= chimneyW / 2 + MM && Math.abs(z - cz) <= chimneyD / 2 + MM);
      // The emitted stack reaches the deck-top pose (its top) …
      expect(Math.max(...inStack.map((p) => p[1]))).toBeCloseTo(c.y + HAUSSMANN.chimneyH / 2, 6);
      const foot = Math.min(...inStack.map((p) => p[1]));
      // … and its foot is inside the roof under every footprint corner.
      for (const x of [c.x - chimneyW / 2, c.x + chimneyW / 2]) {
        for (const z of [cz - chimneyD / 2, cz + chimneyD / 2]) {
          const over = roofOver(plan, x, z);
          const surface = over ? mansardSurfaceY(over.roof, x - over.wing.x, z) : null;
          if (surface === null || foot > surface - 0.05) floating.push(`stack@${x.toFixed(2)},${z.toFixed(2)} foot ${foot.toFixed(2)} roof ${surface?.toFixed(2)}`);
        }
      }
    }
    expect(floating).toEqual([]);
  });

  it('places no kit dormer (the solid-block module): the writer builds the lucarne', () => {
    expect(kitBayPlacements(plan).filter((p) => p.bay === 'dormer')).toEqual([]);
  });

  it('seats every lucarne on its slope, its back end inside the roof', () => {
    for (const { wing, roof } of wingRoofs) {
      const seat = dormerSeat(roof);
      // Front plane stands `dormerProud` in front of the slope at the footing.
      const slopeZ = roof.depth / 2 - ((seat.footY - roof.baseY) * roof.inset) / roof.rise;
      expect(seat.frontZ - slopeZ).toBeCloseTo(HAUSSMANN.dormerProud, 9);
      // The footing sits on the slope (within the proud step).
      const footSurface = mansardSurfaceY(roof, 0, seat.frontZ) as number;
      expect(seat.footY - footSurface).toBeGreaterThanOrEqual(0);
      expect(seat.footY - footSurface).toBeLessThan(0.15);
      // Everything the lucarne writes lies in the wing's footprint, and its
      // back end (cheeks, hood) is below the envelope — nothing pokes out behind.
      const zBack = seat.frontZ - LUCARNE.depth;
      const top = seat.footY + LUCARNE.frontH + LUCARNE.hoodRise + 0.05;
      expect(top).toBeLessThan(mansardSurfaceY(roof, 0, zBack) as number);
      const near = [...zinc, ...stone].filter(
        ([x, y, z]) => Math.abs(x - wing.x) <= LUCARNE.width / 2 + LUCARNE.hoodSide + 0.05 && y > seat.footY - MM && y < top && z <= seat.frontZ + LUCARNE.hoodFront + 0.05 && z >= zBack - 0.05,
      );
      expect(near.length).toBeGreaterThan(0);
      expect(Math.min(...near.map((p) => p[2]))).toBeGreaterThanOrEqual(zBack - MM - 0.05);
    }
  });
});

describe('procedural (kit-less) path', () => {
  it('keeps its roofs and lucarnes inside the eave footprint too', () => {
    for (const plan of PLANS) {
      const zinc = vertices(compileBlockSlots(plan, false).zinc);
      const outboard = zinc.filter(([x, , z]) => !roofs(plan).some(({ wing, roof }) => Math.abs(x - wing.x) <= roof.width / 2 + MM && Math.abs(z) <= roof.depth / 2 + MM));
      expect(outboard).toEqual([]);
    }
  });

  it('keeps the deck lip small (a moulding, not a second eave)', () => {
    expect(MANSARD_DECK_LIP).toBeLessThan(HAUSSMANN.mansardInset / 4);
  });
});

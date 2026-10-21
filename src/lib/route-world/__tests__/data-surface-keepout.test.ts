import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  facesEye,
  rootPlacement,
  stationPose,
  themeKeepOut,
  type DataSurfaceTheme,
  type KeepOutBox,
  type KeepOutLane,
  type WorldId,
} from '../data-surfaces';
import { auditThemes, MANIFEST_PRESENT, type AuditSlot } from './figure-visibility.scenes';
import { PLAZA_DATA_SURFACES, PLAZA_PROP_BOXES, PLAZA_WALKER_LANES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_DATA_SURFACES, SAKURA_PROP_BOXES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_DATA_SURFACES, MOUNTAIN_PROP_BOXES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_DATA_SURFACES, CLOUDS_PROP_BOXES } from '@/components/world/themes/clouds/furniture/data-faces';
import { KEEPOUT_KNOWN as PLAZA_KNOWN } from './keepout-known/plaza';
import { KEEPOUT_KNOWN as SAKURA_KNOWN } from './keepout-known/sakura';
import { KEEPOUT_KNOWN as MOUNTAIN_KNOWN } from './keepout-known/mountain';
import { KEEPOUT_KNOWN as CLOUDS_KNOWN } from './keepout-known/clouds';

/**
 * W1 data-surface keep-out (fidelity wave 2, seat 2A; WAVE-PLAN §5.1).
 *
 * At every pose that can read a face — the station's desktop / 768 / landed
 * 390 eyes, the face's focus poses and the sampled dolly corridor
 * (`data-surfaces.ts` `themeWedges`) — nothing may stand inside the face's
 * padded wedge: no figure box (every audited wild / pool / roster slot, the
 * plaza loiterers), no walker-lane sample, no prop box (`<THEME>_PROP_BOXES`;
 * tree crowns join in wave 5). Beside the wedges, a station-bound figure's
 * root may not sit in the 56 px HUD band or the 3 % edge inset at its
 * station poses, and a figure with an authored yaw must face within ±100°
 * of its station eyes.
 *
 * `keepout-known/<world>.ts` is today's measured violator set, each with a
 * reason. The test fails both ways (the KNOWN_OCCLUDED law): a NEW violator
 * is not allowlisted, and an entry whose violation is gone must be deleted.
 * Keys: `<world>:wedge:<item>@<face>`, `<world>:root:<slot>@<pose>`,
 * `<world>:facing:<slot>@<pose>`.
 *
 * Honest limits: the model's own (data-surfaces.ts header) — restated faces
 * and props, boxed figures at a nominal ace size for roster-driven slots,
 * sampled dolly corridor. Station-less loiterers are held to the wedges only
 * (they have no station pose to be placed in); moving water residents and
 * flyers are wave 3–4 lanes and join this test with them.
 */

interface WorldAudit {
  id: WorldId;
  theme: DataSurfaceTheme;
  props: readonly KeepOutBox[];
  lanes: readonly KeepOutLane[];
  known: Readonly<Record<string, string>>;
}

const SLOTS = new Map(auditThemes().map((t) => [t.id, t.slots] as const));

const WORLDS: readonly WorldAudit[] = [
  { id: 'plaza', theme: PLAZA_DATA_SURFACES, props: PLAZA_PROP_BOXES, lanes: PLAZA_WALKER_LANES, known: PLAZA_KNOWN },
  { id: 'sakura', theme: SAKURA_DATA_SURFACES, props: SAKURA_PROP_BOXES, lanes: [], known: SAKURA_KNOWN },
  { id: 'mountain', theme: MOUNTAIN_DATA_SURFACES, props: MOUNTAIN_PROP_BOXES, lanes: [], known: MOUNTAIN_KNOWN },
  { id: 'clouds', theme: CLOUDS_DATA_SURFACES, props: CLOUDS_PROP_BOXES, lanes: [], known: CLOUDS_KNOWN },
];

function figureBox(slot: AuditSlot): KeepOutBox {
  const f = slot.figure;
  return { id: slot.id, center: [f.x, f.baseY + f.heightM / 2, f.z], half: [f.widthM / 2, f.heightM / 2, f.widthM / 2] };
}

/** Every current violation of one world: key → the poses that caught it. */
function auditWorld(world: WorldAudit, extraSlots: readonly AuditSlot[] = []): Map<string, string> {
  const keepOut = themeKeepOut(world.theme);
  const out = new Map<string, string>();
  const note = (key: string, detail: string) => out.set(key, out.has(key) ? `${out.get(key)}, ${detail}` : detail);
  const slots = [...(SLOTS.get(world.id) ?? []), ...extraSlots];

  const wedgeItems: { id: string; box: KeepOutBox }[] = [
    ...slots.map((slot) => ({ id: `figure:${slot.id}`, box: figureBox(slot) })),
    ...world.props.map((box) => ({ id: `prop:${box.id}`, box })),
  ];
  for (const item of wedgeItems) {
    for (const wedge of keepOut.boxHits(item.box)) note(`${world.id}:wedge:${item.id}@${wedge.faceId}`, wedge.poseId);
  }
  for (const lane of world.lanes) {
    for (const wedge of keepOut.laneHits(lane)) note(`${world.id}:wedge:lane:${lane.id}@${wedge.faceId}`, wedge.poseId);
  }

  for (const slot of slots) {
    if (slot.station === null) continue;
    for (const key of ['desktop', 'tablet', 'mobile'] as const) {
      const pose = stationPose(world.theme, slot.station, key);
      const root: [number, number, number] = [slot.figure.x, slot.figure.baseY, slot.figure.z];
      const placement = rootPlacement(root, pose.camera, pose.viewport);
      if (placement === 'hud-band' || placement === 'edge-inset') note(`${world.id}:root:${slot.id}@${pose.id}`, placement);
      if (slot.yaw !== undefined && key !== 'tablet' && !facesEye(root, slot.yaw, pose.camera.position)) {
        note(`${world.id}:facing:${slot.id}@${pose.id}`, 'faces away from the eye');
      }
    }
  }
  return out;
}

/**
 * Re-seeding aid: `KEEPOUT_DUMP=<file.json> npx vitest run <this file>`
 * writes every current violation (key → catching poses) so a seat that
 * moved things can see exactly which entries went stale or appeared.
 */
const DUMP = process.env.KEEPOUT_DUMP;
if (DUMP) writeFileSync(DUMP, JSON.stringify(Object.fromEntries(WORLDS.map((w) => [w.id, Object.fromEntries(auditWorld(w))])), null, 1));

describe.skipIf(!MANIFEST_PRESENT)('W1 data-surface keep-out (all four worlds)', () => {
  for (const world of WORLDS) {
    describe(world.id, () => {
      const current = auditWorld(world);

      it('declares a face for every station', () => {
        const stations = new Set(world.theme.faces.map((f) => f.station));
        expect(world.theme.stations.map((s) => s.id).filter((id) => !stations.has(id))).toEqual([]);
      });

      it('finds no NEW violator (move it out of the wedge; never allowlist a new one)', () => {
        const fresh = [...current.entries()].filter(([key]) => !(key in world.known)).map(([key, poses]) => `${key} [${poses}]`);
        expect(fresh).toEqual([]);
      });

      it('has no stale keepout-known entry (a fixed violator must leave the list)', () => {
        expect(Object.keys(world.known).filter((key) => !current.has(key))).toEqual([]);
      });

      it('keeps every known reason written down', () => {
        Object.entries(world.known).forEach(([key, reason]) => expect(reason.length, key).toBeGreaterThan(5));
      });
    });
  }

  it('catches the old inner-cheek gate lanterns in the REGELWERK board wedge (wave-2 r2 negative control)', () => {
    // The pre-r2 seat: hung 1.6 m in from each pier centre (x ±2.2), glass at
    // y 3.37, 0.55 m in front of the pier face — the lamps the 768 capture
    // showed clipping the board's kicker and rows.
    const gateZ = PLAZA_DATA_SURFACES.faces.find((f) => f.id === 'rules:field')?.center[2];
    expect(gateZ).toBeDefined();
    if (gateZ === undefined) return;
    const pierFaceZ = gateZ - 0.3 - 0.9;
    const keepOut = themeKeepOut(PLAZA_DATA_SURFACES);
    for (const side of [-1, 1] as const) {
      const old: KeepOutBox = { id: `old-lantern:${side}`, center: [side * 2.2, 3.47, pierFaceZ - 0.55], half: [0.3, 0.55, 0.3] };
      expect(keepOut.boxHits(old).map((w) => w.faceId)).toContain('rules:field');
    }
    const lanterns = PLAZA_PROP_BOXES.filter((box) => box.id.startsWith('gate-lantern:'));
    expect(lanterns).toHaveLength(2);
    for (const box of lanterns) expect(keepOut.boxHits(box)).toEqual([]);
  });

  it('catches a fixture anchor placed inside a wedge (negative control)', () => {
    const plaza = WORLDS[0];
    const board = PLAZA_DATA_SURFACES.faces.find((f) => f.id === 'pulse:board');
    expect(board).toBeDefined();
    if (!board) return;
    const eye = PLAZA_DATA_SURFACES.stations[0].camera.position;
    // Halfway along the desktop eye → board-centre ray, standing on the cobbles.
    const x = (eye[0] + board.center[0]) / 2;
    const z = (eye[2] + board.center[2]) / 2;
    const fixture: AuditSlot = {
      id: 'fixture:intruder',
      station: 0,
      figure: { id: 'fixture:intruder', x, z, baseY: board.center[1] - 1, heightM: 1.2, widthM: 0.8 },
      ignore: [],
    };
    const current = auditWorld(plaza, [fixture]);
    const fresh = [...current.keys()].filter((key) => !(key in plaza.known));
    expect(fresh).toContain('plaza:wedge:figure:fixture:intruder@pulse:board');
  });
});

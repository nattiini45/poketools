/**
 * LOOK-PLAN §2 SEAT S — the night puddle emitter table (`plaza-emitters.ts`).
 */

import { describe, expect, it } from 'vitest';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { screenPoint, stationPose, themeKeepOut } from '../data-surfaces';
import { FURNITURE, PLAZA } from '../layout';
import { createDryBand } from '../plaza-ground';
import {
  activeEmitters,
  emitterColor,
  PLAZA_EMITTER_SLOTS,
  PLAZA_EMITTERS,
  PLAZA_EMITTERS_RUNG0,
  PLAZA_WET_LANES,
  solveWetLanes,
  STATION_EMITTER_PREFIX,
  WET_LANE,
} from '../plaza-emitters';
import { QUALITY_LADDER } from '../quality';
import { PLAZA_LAMP_SEATS, PLAZA_TEAMS_LAMPS } from '../teams-formation';

describe('plaza emitter table', () => {
  it('fits the shader slots with unique ids', () => {
    expect(PLAZA_EMITTERS.length).toBeLessThanOrEqual(PLAZA_EMITTER_SLOTS);
    expect(new Set(PLAZA_EMITTERS.map((e) => e.id)).size).toBe(PLAZA_EMITTERS.length);
  });

  it('holds the plan’s sources: every lamp seat, both gate lamps, the spine, the fascia, both boards', () => {
    const kinds = PLAZA_EMITTERS.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ spine: 1, board: 2, lamp: PLAZA_LAMP_SEATS.length, 'gate-lamp': 2, fascia: 1 });
    for (const seat of PLAZA_LAMP_SEATS) {
      expect(PLAZA_EMITTERS.some((e) => e.kind === 'lamp' && e.at[0] === seat[0] && e.at[1] === seat[1])).toBe(true);
    }
    const tower = PLAZA_EMITTERS.find((e) => e.kind === 'spine');
    expect(tower?.at).toEqual([FURNITURE.tower.x, FURNITURE.tower.z]);
  });

  const STATIONS = [null, 'pulse', 'roster', 'teams', 'schedule', 'rules'] as const;

  it('never draws the teams lamps at any rung or station (no emitter reflections at teams, §1.3)', () => {
    const max = Math.max(...QUALITY_LADDER.map((s) => s.puddleEmitters));
    for (const station of STATIONS) {
      const drawn = activeEmitters(max, station);
      for (const seat of PLAZA_TEAMS_LAMPS) {
        expect(drawn.some((e) => e.at[0] === seat[0] && e.at[1] === seat[1]), String(station)).toBe(false);
      }
    }
  });

  it('follows the ladder: 8 / 6 / 4 / 2 / 0 by rung, a per-station prefix of one fixed order', () => {
    expect(QUALITY_LADDER.map((s) => activeEmitters(s.puddleEmitters).length)).toEqual([8, 6, 4, 2, 0]);
    expect(PLAZA_EMITTERS_RUNG0).toBe(QUALITY_LADDER[0].puddleEmitters);
    for (const station of STATIONS) {
      const order = activeEmitters(PLAZA_EMITTER_SLOTS, station);
      for (const step of QUALITY_LADDER) {
        // Each rung draws a prefix of the station's one fixed order (a rung step is a uniform write).
        expect(activeEmitters(step.puddleEmitters, station)).toEqual(order.slice(0, step.puddleEmitters));
      }
    }
    // No station: the global table order, as before.
    for (const step of QUALITY_LADDER) {
      expect(activeEmitters(step.puddleEmitters)).toEqual(PLAZA_EMITTERS.slice(0, step.puddleEmitters));
    }
    expect(activeEmitters(-3)).toEqual([]);
    expect(activeEmitters(Number.NaN)).toEqual([]);
    expect(activeEmitters(99).length).toBe(Math.min(PLAZA_EMITTER_SLOTS, PLAZA_EMITTERS.length));
  });

  it('LOOK r6 (L6.2): a settled station reflects its own practicals first — the gate lanterns at rules', () => {
    expect(activeEmitters(2, 'rules').map((e) => e.id)).toEqual(['gate-lamp:left', 'gate-lamp:right']);
    for (const [station, prefix] of Object.entries(STATION_EMITTER_PREFIX)) {
      const drawn = activeEmitters(prefix.length, station).map((e) => e.id);
      expect(drawn, station).toEqual([...prefix]);
    }
    // Every station order is a permutation of the one table (nothing added, nothing lost).
    for (const station of STATIONS) {
      const ids = activeEmitters(PLAZA_EMITTER_SLOTS, station).map((e) => e.id).sort();
      expect(ids).toEqual(PLAZA_EMITTERS.slice(0, PLAZA_EMITTER_SLOTS).map((e) => e.id).sort());
    }
  });

  it('keeps every source geometrically sane and every colour resolvable', () => {
    const palette = { boardPulse: '#11aacc', boardSchedule: '#ffaa22', centerRed: '#dd2233' };
    for (const e of PLAZA_EMITTERS) {
      expect(e.y[1]).toBeGreaterThanOrEqual(e.y[0]);
      expect(e.y[0]).toBeGreaterThan(0);
      expect(e.halfWidth).toBeGreaterThan(0);
      expect(e.intensity).toBeGreaterThan(0);
      expect(emitterColor(e, palette)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(emitterColor(PLAZA_EMITTERS.find((e) => e.id === 'board:pulse')!, palette)).toBe(palette.boardPulse);
  });

  it('puts no point source inside a keep-out wedge (a lamp head never sits over a face)', () => {
    const keepOut = themeKeepOut(PLAZA_DATA_SURFACES);
    for (const e of PLAZA_EMITTERS) {
      if (e.kind !== 'lamp' && e.kind !== 'gate-lamp') continue;
      expect(keepOut.pointClear([e.at[0], (e.y[0] + e.y[1]) / 2, e.at[1]]), e.id).toBe(true);
    }
  });
});

describe('LOOK r6 (L6.2): wet lanes — solved, never hand-placed', () => {
  const keepOut = themeKeepOut(PLAZA_DATA_SURFACES);
  const dry = createDryBand(PLAZA_DATA_SURFACES);
  const rules = stationPose(PLAZA_DATA_SURFACES, PLAZA_DATA_SURFACES.stations.findIndex((s) => s.id === 'rules'), 'desktop');
  const inFrame = (x: number, z: number) => {
    const p = screenPoint([x, 0, z], rules.camera, rules.viewport);
    return !!p && p.x >= 0 && p.x <= rules.viewport.width && p.y >= 0 && p.y <= rules.viewport.height;
  };

  it('the shipped table equals the solver at the rules desktop eye', () => {
    const solved = solveWetLanes({
      eye: [rules.camera.position[0], rules.camera.position[2]],
      isDry: dry.isDry,
      sphereClear: keepOut.sphereClear,
      inFrame,
      bounds: PLAZA.half - 1,
    });
    expect(PLAZA_WET_LANES).toEqual(solved);
    expect(PLAZA_WET_LANES.length).toBeGreaterThanOrEqual(2);
  });

  it('no lane point is dry, inside a wedge, or off the rules frame', () => {
    for (const lane of PLAZA_WET_LANES) {
      for (let i = 0; i <= 20; i += 1) {
        const x = lane.from[0] + ((lane.to[0] - lane.from[0]) * i) / 20;
        const z = lane.from[1] + ((lane.to[1] - lane.from[1]) * i) / 20;
        expect(dry.isDry(x, z), `${lane.id} @${i}`).toBe(false);
        expect(keepOut.sphereClear([x, 0, z], WET_LANE.halfWidth), `${lane.id} @${i}`).toBe(true);
        expect(inFrame(x, z)).toBe(true);
      }
    }
  });
});

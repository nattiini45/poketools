import { describe, expect, it, vi } from 'vitest';
import {
  createWorldStateSampler,
  endpointFor,
  lerpWorldState,
  type RouteStation,
} from '../chapters';
import { FURNITURE } from '../layout';
import * as mountainLayout from '@/components/world/themes/mountain/furniture/layout';
import { ATTACK_VFX_LEVELS, FIGURE_LIFE_LEVELS, QUALITY_LADDER } from '../quality';
import { MAX_PULLBACK } from '../camera-path';
import {
  advanceSmooth,
  DIRECTION_REST_S,
  SMOOTH_SNAP_EPS,
  type RouteProgress,
} from '@/components/world/route/useScrollConductor';
import { getDefaultWorld, getSeasonWorld, resolveWorld } from '@/lib/worlds/registry';
import { resolveRouteTheme } from '@/components/world/themes';
import type { RouteThemeId } from '@/types/season';
import { FALLBACK_PALETTE } from '../palette';
import { PLAZA_STATIONS, PLAZA_STATION_IDS, plazaTheme } from '@/components/world/themes/plaza/theme';
import {
  SAKURA_STATIONS,
  SAKURA_STATION_IDS,
  sakuraTheme,
} from '@/components/world/themes/sakura/theme';
import {
  MOUNTAIN_STATIONS,
  MOUNTAIN_STATION_IDS,
  mountainTheme,
} from '@/components/world/themes/mountain/theme';
import {
  CLOUDS_STATIONS,
  CLOUDS_STATION_IDS,
  cloudsTheme,
} from '@/components/world/themes/clouds/theme';

/** Squared distance between a camera endpoint's eye and its look target. */
function eyeToTarget(position: readonly number[], target: readonly number[]): number {
  return (
    (position[0] - target[0]) ** 2 +
    (position[1] - target[1]) ** 2 +
    (position[2] - target[2]) ** 2
  );
}

/** MAX_PULLBACK from the rig path (`camera-path.ts`): the tall-screen dolly, in metres. */
const MOBILE_MAX_PULLBACK = MAX_PULLBACK;

/** The pose classes the no-closer-camera law covers. */
const POSE_CLASSES = ['desktop', 'mobile-base', 'landed'] as const;

type PoseClass = (typeof POSE_CLASSES)[number];

/**
 * Eye→hero distance of one pose class: the authored desktop endpoint, the
 * authored mobile endpoint, or the rig's landed mobile pose — endpoint +
 * 9.75 × unit(target→cam), computed through the explicit dolly so the formula
 * stays verbatim with `CameraRig`.
 */
function poseDistance(station: RouteStation, poseClass: PoseClass): number {
  if (poseClass === 'desktop') {
    return Math.sqrt(eyeToTarget(station.camera.position, station.camera.target));
  }
  const { position, target } = station.cameraMobile;
  const base = Math.sqrt(eyeToTarget(position, target));
  if (poseClass === 'mobile-base') return base;
  const landed = [
    position[0] + (MOBILE_MAX_PULLBACK * (position[0] - target[0])) / base,
    position[1] + (MOBILE_MAX_PULLBACK * (position[1] - target[1])) / base,
    position[2] + (MOBILE_MAX_PULLBACK * (position[2] - target[2])) / base,
  ];
  return Math.sqrt(eyeToTarget(landed, target));
}

/**
 * Three-class no-closer-camera guard (C-095 r2): on EVERY pose class —
 * desktop endpoint, mobile endpoint, and the landed mobile pose the rig
 * actually renders on tall screens — a theme must stand at least as far from
 * each station's hero as the plaza's same station. The desktop-only shape
 * missed exactly the schedule mobile/landed slip the r1 gate caught. Applied
 * to every theme ledger; the plaza call pins the baseline against itself.
 */
function expectNoCloserThanPlaza(stations: readonly RouteStation[]): void {
  stations.forEach((station, i) => {
    const plaza = PLAZA_STATIONS[i];
    for (const poseClass of POSE_CLASSES) {
      expect(poseDistance(station, poseClass)).toBeGreaterThanOrEqual(
        poseDistance(plaza, poseClass) - 1e-6,
      );
    }
  });
}

const FURNITURE_BY_STATION = [
  FURNITURE.pulseBoard,
  FURNITURE.desk,
  FURNITURE.statues,
  FURNITURE.scheduleBoard,
  FURNITURE.gate,
] as const;

const { worldStateAt } = createWorldStateSampler(PLAZA_STATIONS);

describe('route theme registry', () => {
  it('resolves the evoliga world’s routeThemeId to the plaza theme', () => {
    const world = getSeasonWorld('evolution_point_buy');
    expect(world.routeThemeId).toBe('plaza');
    expect(resolveRouteTheme(world.routeThemeId)).toBe(plazaTheme);
  });

  it('resolves the sakura world’s routeThemeId to the sakura theme (C-093)', () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'sakura' });
    expect(world.id).toBe('sakura');
    expect(world.routeThemeId).toBe('sakura');
    expect(resolveRouteTheme(world.routeThemeId)).toBe(sakuraTheme);
  });

  it('resolves the mountain world’s routeThemeId to the mountain theme (C-094)', () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'mountain' });
    expect(world.id).toBe('mountain');
    expect(world.routeThemeId).toBe('mountain');
    expect(resolveRouteTheme(world.routeThemeId)).toBe(mountainTheme);
  });

  it('resolves the clouds world’s routeThemeId to the clouds theme (C-095)', () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'clouds' });
    expect(world.id).toBe('clouds');
    expect(world.routeThemeId).toBe('clouds');
    expect(resolveRouteTheme(world.routeThemeId)).toBe(cloudsTheme);
  });

  it('resolves unknown or absent ids to null (DOM-only worlds)', () => {
    expect(resolveRouteTheme(undefined)).toBeNull();
    expect(resolveRouteTheme(null)).toBeNull();
    // 'northsea' names a future theme whose package has not landed.
    expect(resolveRouteTheme('northsea')).toBeNull();
    // C-096 auto-map: 'singles' now resolves to the sakura world, whose
    // theme package IS registered — the DOM-only default is fallback-only.
    expect(getSeasonWorld('singles').routeThemeId).toBe('sakura');
  });
});

describe('resolveWorld (season route_theme resolution)', () => {
  it('resolves an explicit registered theme to the world providing it', () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'plaza' });
    expect(world.routeThemeId).toBe('plaza');
    expect(resolveRouteTheme(world.routeThemeId)).toBe(plazaTheme);
  });

  it('falls back to the DOM-only default world with exactly one warn for an unregistered pick', () => {
    // The registry must never crash or blank the route on an unregistered
    // pick. ('sakura' WAS this case until its C-093 package landed;
    // 'mountain' until C-094; 'clouds' until C-095 — all three now resolve
    // above.) With C-095 every id in the `RouteThemeId` union is
    // registered, so the unregistered pick can only be expressed through
    // the wider value space the DB row actually carries — hence the cast,
    // which is exactly the runtime contract this branch guards.
    // C-096: pinned by IDENTITY, not via getDefaultWorld() — the export
    // standalone tournaments use now returns the sakura outcome, while this
    // branch must keep returning the DOM-only default world.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const world = resolveWorld({
        format_type: 'singles',
        route_theme: 'northsea' as RouteThemeId,
      });
      expect(world.id).toBe('default');
      expect(world.tokenNamespace).toBe('default');
      expect(world.routeThemeId).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("'auto' follows the format map: EPB → the plaza-driven evoliga world", () => {
    const world = resolveWorld({ format_type: 'evolution_point_buy', route_theme: 'auto' });
    expect(world.id).toBe('evoliga');
    expect(world.routeThemeId).toBe('plaza');
    expect(world.tokenNamespace).toBe('evoliga');
  });

  it("'auto' maps singles leagues to the sakura park world (C-096)", () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'auto' });
    expect(world.id).toBe('sakura');
    expect(world.tokenNamespace).toBe('sakura');
    expect(world.routeThemeId).toBe('sakura');
  });

  it("'auto' maps doubles leagues to the sakura park world (C-096)", () => {
    const world = resolveWorld({ format_type: 'doubles', route_theme: 'auto' });
    expect(world.id).toBe('sakura');
    expect(world.tokenNamespace).toBe('sakura');
    expect(world.routeThemeId).toBe('sakura');
  });

  it("'auto' maps draft leagues to the sakura park world (C-096)", () => {
    const world = resolveWorld({ format_type: 'draft', route_theme: 'auto' });
    expect(world.id).toBe('sakura');
    expect(world.tokenNamespace).toBe('sakura');
    expect(world.routeThemeId).toBe('sakura');
  });

  it('a registered pin beats the auto-map (admin pin > format map)', () => {
    const world = resolveWorld({ format_type: 'evolution_point_buy', route_theme: 'mountain' });
    expect(world.id).toBe('mountain');
    expect(world.tokenNamespace).toBe('mountain');
    expect(world.routeThemeId).toBe('mountain');
  });

  it('standalone tournaments resolve to the sakura outcome via getDefaultWorld (C-096)', () => {
    // The tournaments page's no-season arm wraps in WorldShell only, whose
    // theming keys off tokenNamespace (and whose routeThemeId feeds the 3D
    // provider) — assert both, plus the id that dispatches route worlds.
    const world = getDefaultWorld();
    expect(world.id).toBe('sakura');
    expect(world.tokenNamespace).toBe('sakura');
    expect(world.routeThemeId).toBe('sakura');
  });

  it('a null/absent pick resolves through the format map (pre-migration rows)', () => {
    expect(
      resolveWorld({ format_type: 'evolution_point_buy', route_theme: null }).routeThemeId,
    ).toBe('plaza');
    // C-096: null/absent picks follow the flipped auto-map → sakura.
    expect(resolveWorld({ format_type: 'doubles', route_theme: null }).id).toBe('sakura');
    expect(resolveWorld({ format_type: 'draft' }).tokenNamespace).toBe('sakura');
  });
});

describe('route station ledger', () => {
  it('matches the evoliga world section manifest exactly, in order', () => {
    const world = getSeasonWorld('evolution_point_buy');
    expect(PLAZA_STATION_IDS).toEqual(world.sections.map((section) => section.id));
    expect(plazaTheme.stations.map((station) => station.id)).toEqual(
      world.sections.map((section) => section.id),
    );
  });

  it('aims each orbit camera at its furniture anchor', () => {
    PLAZA_STATIONS.forEach((station, i) => {
      const anchor = FURNITURE_BY_STATION[i];
      expect(station.camera.target[0]).toBeCloseTo(anchor.x, 5);
      expect(station.camera.target[2]).toBeCloseTo(anchor.z, 5);
    });
  });

  it('keeps pulse and schedule on the same north wall, split left/right', () => {
    const pulse = PLAZA_STATIONS[0].camera.target;
    const schedule = PLAZA_STATIONS[3].camera.target;
    expect(pulse[2]).toBe(schedule[2]);
    expect(pulse[0]).toBeLessThan(schedule[0]);
  });

  it('pulls the camera back and widens the lens on mobile', () => {
    for (const station of PLAZA_STATIONS) {
      const desktop = endpointFor(station, false);
      const mobile = endpointFor(station, true);
      expect(mobile.fov).toBeGreaterThan(desktop.fov);
      expect(mobile.fov).toBeLessThanOrEqual(60);
      expect(eyeToTarget(mobile.position, mobile.target)).toBeGreaterThan(
        eyeToTarget(desktop.position, desktop.target),
      );
    }
  });

  it('is its own no-closer baseline on every pose class (three-class guard, C-095 r2)', () => {
    expectNoCloserThanPlaza(PLAZA_STATIONS);
  });

  it('dims the key at the challenge gate relative to the opening pulse', () => {
    expect(PLAZA_STATIONS[4].world.key).toBeLessThan(PLAZA_STATIONS[0].world.key);
  });

  it('declares the plaza hold stations, prop families and focus vocabulary', () => {
    expect(plazaTheme.holdIds).toEqual(['pulse', 'schedule']);
    expect(plazaTheme.propFamilyPrefixes).toEqual([
      'hero-prop-',
      'street-lamp-prop',
      'gate-crest-prop',
      'plinth-prop',
    ]);
    // LOOK r2 (LOOK-PLAN §2 L.8): the painted plaza sets replace the scans.
    expect(plazaTheme.textureRoles).toEqual(['plaza-ground', 'plaza-ashlar', 'plaza-slate']);
    expect(plazaTheme.focusVocabulary.panelParams).toEqual(['team', 'mon', 'board', 'rules']);
    expect('locale' in plazaTheme).toBe(false);
  });

  // W6: hold stations are no longer a pin that overrides progress — each one
  // owns a plateau in the scroll map (scroll-map.ts). The plateau is keyed by
  // station id, so every theme's hold ids must name real stations.
  it('every theme hold id names a station (plateau scroll map, W6)', () => {
    for (const id of ['plaza', 'sakura', 'mountain', 'clouds'] as const) {
      const theme = resolveRouteTheme(id);
      expect(theme).not.toBeNull();
      const ids = theme?.stations.map((station) => station.id) ?? [];
      for (const hold of theme?.holdIds ?? []) expect(ids).toContain(hold);
    }
  });
});

describe('createWorldStateSampler', () => {
  it('clamps to the endpoints outside the route', () => {
    expect(worldStateAt(-3)).toEqual(PLAZA_STATIONS[0].world);
    expect(worldStateAt(99)).toEqual(PLAZA_STATIONS[PLAZA_STATIONS.length - 1].world);
  });

  it('returns the authored state exactly at a station', () => {
    PLAZA_STATIONS.forEach((station, i) => {
      expect(worldStateAt(i)).toEqual(station.world);
    });
  });

  it('interpolates between two stations', () => {
    const mid = worldStateAt(0.5);
    const expected = lerpWorldState(PLAZA_STATIONS[0].world, PLAZA_STATIONS[1].world, 0.5);
    expect(mid).toEqual(expected);
    expect(mid.key).toBeLessThan(PLAZA_STATIONS[0].world.key);
    expect(mid.key).toBeGreaterThan(PLAZA_STATIONS[1].world.key);
  });

  it('is monotonic in position — never jumps backwards along the route', () => {
    const sampler = createWorldStateSampler(PLAZA_STATIONS);
    let previous = sampler.worldStateAt(0);
    for (let position = 0.05; position <= PLAZA_STATIONS.length - 1; position += 0.05) {
      const next = sampler.worldStateAt(position);
      for (const channel of ['key', 'fog', 'practicals', 'particles'] as const) {
        const delta = next[channel] - previous[channel];
        // Each channel is piecewise-linear between fixed endpoints, so within
        // one sample step it can only keep moving in its segment's direction.
        expect(Math.abs(delta)).toBeLessThanOrEqual(
          Math.max(...PLAZA_STATIONS.map((s) => s.world[channel])) * 0.05 + Number.EPSILON,
        );
      }
      previous = next;
    }
  });

  it('lerps to the exact boundary values at integer positions', () => {
    const sampler = createWorldStateSampler(PLAZA_STATIONS);
    for (let i = 0; i < PLAZA_STATIONS.length; i += 1) {
      expect(sampler.worldStateAt(i)).toEqual(PLAZA_STATIONS[i].world);
      if (i > 0) {
        const before = sampler.worldStateAt(i - Number.EPSILON);
        const at = sampler.worldStateAt(i);
        expect(before.key).toBeCloseTo(at.key, 6);
      }
    }
  });

  it('samples neutral channels for a world with no stations', () => {
    const empty = createWorldStateSampler([]);
    expect(empty.worldStateAt(0)).toEqual({ key: 0, fog: 0, practicals: 0, particles: 0 });
    expect(empty.worldStateAt(5)).toEqual({ key: 0, fog: 0, practicals: 0, particles: 0 });
  });

  it('samples a two-station theme independently of the plaza ledger', () => {
    const two = createWorldStateSampler([PLAZA_STATIONS[0], PLAZA_STATIONS[4]]);
    expect(two.worldStateAt(0)).toEqual(PLAZA_STATIONS[0].world);
    expect(two.worldStateAt(1)).toEqual(PLAZA_STATIONS[4].world);
    expect(two.worldStateAt(0.5)).toEqual(
      lerpWorldState(PLAZA_STATIONS[0].world, PLAZA_STATIONS[4].world, 0.5),
    );
  });
});

describe('plaza palette extension', () => {
  it('returns the pre-theme furniture literals for the sunlit fallback tokens', () => {
    // Parity guard: these values were hardcoded in `withIlluminants` before
    // the theme split; the plaza extension must reproduce them byte-for-byte.
    const ext = plazaTheme.paletteExtension(FALLBACK_PALETTE, false);
    expect(ext).toEqual({
      sky: '#6eb4e0',
      skyHorizon: '#efe2c8',
      sunColor: '#fff1c4',
      moonColor: '#fff4ee',
      centerRed: '#e23b3b',
      deskKiosk: '#161418',
      deskWarm: '#ffc27a',
      deskBrick: '#8a4538',
      deskApron: '#6a7584',
      deskRosterLive: '#2ee6a4',
      deskRosterAccent: '#f0a040',
      boardPulse: '#38bdf8',
      boardSchedule: '#f59e0b',
      pictorialLedField: '#123a5e',
      pictorialLedEmber: '#e8862e',
      pictorialLedTicker: '#d8443e',
    });
  });

  it('switches every day/night role on the ground-luminance branch', () => {
    const dark = { ...FALLBACK_PALETTE, ground: '#0a0a12' };
    const ext = plazaTheme.paletteExtension(dark, true);
    expect(ext.sky).toBe('#070433');
    expect(ext.skyHorizon).toBe('#1c3a58');
    expect(ext.centerRed).toBe('#ff2a3a');
    expect(ext.deskRosterLive).toBe('#4ADE80');
    expect(ext.boardPulse).toBe('#5eead4');
    // Sun/moon discs are theme constants, not day/night branches.
    expect(ext.sunColor).toBe('#fff1c4');
    expect(ext.moonColor).toBe('#fff4ee');
  });
});

describe('sakura palette extension (C-093)', () => {
  it('returns the sunlit park literals for the fallback tokens', () => {
    const ext = sakuraTheme.paletteExtension(FALLBACK_PALETTE, false);
    expect(ext.sky).toBe('#8ec8e8');
    expect(ext.skyHorizon).toBe('#f6dfda');
    expect(ext.toriiRed).toBe('#c0392b');
    expect(ext.boardField).toBe('#134b52');
    expect(ext.lakeDeep).toBe('#2c6f79');
    // Sun/moon discs are theme constants, not day/night branches.
    expect(ext.sunColor).toBe('#fff3d2');
    expect(ext.moonColor).toBe('#fdf6ff');
  });

  it('switches every day/night role on the ground-luminance branch', () => {
    const dark = { ...FALLBACK_PALETTE, ground: '#0a0a12' };
    const ext = sakuraTheme.paletteExtension(dark, true);
    expect(ext.sky).toBe('#150e2e');
    expect(ext.skyHorizon).toBe('#33233f');
    expect(ext.toriiRed).toBe('#e04b38');
    expect(ext.lakeDeep).toBe('#12333f');
  });
});

describe('quality ladder', () => {
  it('never climbs on any channel as it steps down', () => {
    for (let i = 1; i < QUALITY_LADDER.length; i += 1) {
      const previous = QUALITY_LADDER[i - 1];
      const step = QUALITY_LADDER[i];
      expect(step.dpr).toBeLessThanOrEqual(previous.dpr);
      expect(step.shadowMapSize).toBeLessThanOrEqual(previous.shadowMapSize);
      expect(step.shadowedLights).toBeLessThanOrEqual(previous.shadowedLights);
      expect(step.grassDensity).toBeLessThanOrEqual(previous.grassDensity);
      expect(step.particleDensity).toBeLessThanOrEqual(previous.particleDensity);
      expect(step.heroFigures).toBeLessThanOrEqual(previous.heroFigures);
      expect(step.ambientFigures).toBeLessThanOrEqual(previous.ambientFigures);
      if (step.post) expect(previous.post).toBe(true);
      if (step.ao) expect(previous.ao).toBe(true);
    }
  });

  it('gives up resolution before it gives up the scene', () => {
    expect(QUALITY_LADDER[1].dpr).toBeLessThan(QUALITY_LADDER[0].dpr);
    expect(QUALITY_LADDER[1].grassDensity).toBe(QUALITY_LADDER[0].grassDensity);
    expect(QUALITY_LADDER[1].shadowedLights).toBe(QUALITY_LADDER[0].shadowedLights);
  });

  it('drops ambient occlusion first and post-processing from rung 2 (spec §9)', () => {
    expect(QUALITY_LADDER[0].ao).toBe(true);
    expect(QUALITY_LADDER[1].ao).toBe(false);
    expect(QUALITY_LADDER[1].post).toBe(true);
    QUALITY_LADDER.slice(2).forEach((step) => expect(step.post).toBe(false));
  });

  it('keeps every ace as a GLB until the last rung', () => {
    QUALITY_LADDER.slice(0, -1).forEach((step) => expect(step.heroFigures).toBeGreaterThan(0));
    expect(QUALITY_LADDER[QUALITY_LADDER.length - 1].heroFigures).toBe(0);
  });

  // Living-pass rung fields (spec 2026-09-24 §7, decision D11).
  it('never climbs on any living-pass channel as it steps down', () => {
    for (let i = 1; i < QUALITY_LADDER.length; i += 1) {
      const previous = QUALITY_LADDER[i - 1];
      const step = QUALITY_LADDER[i];
      expect(step.waterDetail).toBeLessThanOrEqual(previous.waterDetail);
      expect(step.waterRipples).toBeLessThanOrEqual(previous.waterRipples);
      expect(step.lightShafts).toBeLessThanOrEqual(previous.lightShafts);
      expect(step.flowerFall).toBeLessThanOrEqual(previous.flowerFall);
      expect(ATTACK_VFX_LEVELS.indexOf(step.attackVfx)).toBeGreaterThanOrEqual(
        ATTACK_VFX_LEVELS.indexOf(previous.attackVfx),
      );
      expect(FIGURE_LIFE_LEVELS.indexOf(step.figureLife)).toBeGreaterThanOrEqual(
        FIGURE_LIFE_LEVELS.indexOf(previous.figureLife),
      );
    }
  });

  it('degrades in the spec §7 order: shafts and petals, then water, then figure life', () => {
    const firstDrop = (value: (step: (typeof QUALITY_LADDER)[number]) => number) =>
      QUALITY_LADDER.findIndex((step) => value(step) < value(QUALITY_LADDER[0]));
    const shafts = firstDrop((step) => step.lightShafts);
    const petals = firstDrop((step) => step.flowerFall);
    const water = firstDrop((step) => step.waterDetail);
    const life = firstDrop((step) => -FIGURE_LIFE_LEVELS.indexOf(step.figureLife));
    expect(shafts).toBeGreaterThan(0);
    expect(shafts).toBeLessThanOrEqual(water);
    expect(petals).toBeLessThanOrEqual(water);
    expect(water).toBeLessThanOrEqual(life);
    // Shafts are (nearly) gone before shadows are touched (§7 step 1 before
    // 4). R6 E9 (R6-BRIEF L4a, lead-approved): the rung that first drops a
    // shadowed light keeps ONE shaft — the rules hero seat, so the post-off
    // rung keeps its contre-jour moment — and every rung below it has none.
    const shadowDrop = firstDrop((step) => step.shadowedLights);
    expect(QUALITY_LADDER[shadowDrop].lightShafts).toBeLessThanOrEqual(1);
    QUALITY_LADDER.slice(shadowDrop + 1).forEach((step) => expect(step.lightShafts).toBe(0));
  });

  it('keeps a moving water surface on every rung and switches the optional layers off at the bottom', () => {
    QUALITY_LADDER.forEach((step) => expect(step.waterDetail).toBeGreaterThanOrEqual(0));
    const bottom = QUALITY_LADDER[QUALITY_LADDER.length - 1];
    expect(bottom.waterRipples).toBe(0);
    expect(bottom.lightShafts).toBe(0);
    expect(bottom.flowerFall).toBe(0);
    expect(bottom.attackVfx).toBe('off');
    expect(bottom.figureLife).toBe('static');
  });

  it('adds no living-pass layer above its authored top-rung value (D11 budget)', () => {
    const top = QUALITY_LADDER[0];
    expect(top.lightShafts).toBeLessThanOrEqual(3);
    expect(top.waterRipples).toBeLessThanOrEqual(16);
    expect(top.flowerFall).toBeLessThanOrEqual(1);
  });
});

describe('plaza-framed boards (spec §5.1 / §5.4 amended)', () => {
  const BOARD_WIDTH = 7.6;

  /** Board share of the frame width at the desktop endpoint (aspect 1.6). */
  function boardShare(position: readonly number[], target: readonly number[], fov: number) {
    const distance = Math.sqrt(eyeToTarget(position, target));
    const frameWidth = 2 * distance * Math.tan((fov * Math.PI) / 360) * 1.6;
    return BOARD_WIDTH / frameWidth;
  }

  it('frames each jumbotron at 45–65 % of the desktop frame width', () => {
    for (const station of [PLAZA_STATIONS[0], PLAZA_STATIONS[3]]) {
      const share = boardShare(station.camera.position, station.camera.target, station.camera.fov);
      expect(share).toBeGreaterThan(0.45);
      expect(share).toBeLessThan(0.65);
    }
  });

  it('never stands closer than 9 m to a board — legibility is Focus, not the station', () => {
    for (const station of [PLAZA_STATIONS[0], PLAZA_STATIONS[3]]) {
      expect(Math.sqrt(eyeToTarget(station.camera.position, station.camera.target))).toBeGreaterThan(9);
    }
  });
});

describe('sakura station ledger (C-093)', () => {
  it('matches the sakura world section manifest exactly, in order', () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'sakura' });
    expect(SAKURA_STATION_IDS).toEqual(world.sections.map((section) => section.id));
    expect(sakuraTheme.stations.map((station) => station.id)).toEqual(
      world.sections.map((section) => section.id),
    );
    // The English manifest keeps the harness's ids with English labels.
    expect(world.sections.map((section) => section.navLabel)).toEqual([
      'Pulse',
      'Point-Buy list',
      'Teams',
      'Schedule',
      'Rules',
    ]);
    expect(world.tokenNamespace).toBe('sakura');
  });

  it('authors English beats and carries no theme locale', () => {
    expect('locale' in sakuraTheme).toBe(false);
    for (const station of SAKURA_STATIONS) {
      expect(station.beat).toMatch(/[^]/);
    }
  });

  it('never stands closer to its hero than the plaza’s same station on any pose class (three-class guard, C-095 r2)', () => {
    expectNoCloserThanPlaza(SAKURA_STATIONS);
  });

  it('pulls the camera back and widens the lens on mobile', () => {
    for (const station of SAKURA_STATIONS) {
      const desktop = endpointFor(station, false);
      const mobile = endpointFor(station, true);
      expect(mobile.fov).toBeGreaterThan(desktop.fov);
      expect(mobile.fov).toBeLessThanOrEqual(60);
      expect(eyeToTarget(mobile.position, mobile.target)).toBeGreaterThan(
        eyeToTarget(desktop.position, desktop.target),
      );
    }
  });

  it('declares the sakura holds, vocabulary and procedural-first roles', () => {
    expect(sakuraTheme.holdIds).toEqual(['pulse', 'schedule']);
    // C-102: the park mounts the C-107 GLB props on sakura-prop- named roots
    // (furniture/PropMounts.tsx) — the family the static batcher must spare.
    expect(sakuraTheme.propFamilyPrefixes).toEqual(['sakura-prop-']);
    // Procedural-first: no bucket texture set consumed (RESIDUALS accepted).
    expect(sakuraTheme.textureRoles).toEqual([]);
    expect(sakuraTheme.focusVocabulary).toEqual({
      kinds: ['ace', 'board', 'roster', 'rules'],
      panelParams: ['team', 'mon', 'board', 'rules'],
    });
  });

  it('dims the key at the torii relative to the opening pulse', () => {
    expect(SAKURA_STATIONS[4].world.key).toBeLessThan(SAKURA_STATIONS[0].world.key);
  });
});

describe('sakura content-wall framing (spec §8 amended — board-face budget)', () => {
  /** Face share of the 1440×900 desktop frame (aspect 1.6). */
  function faceShare(position: readonly number[], target: readonly number[], fov: number, faceWidth: number) {
    const distance = Math.sqrt(eyeToTarget(position, target));
    const frameWidth = 2 * distance * Math.tan((fov * Math.PI) / 360) * 1.6;
    return faceWidth / frameWidth;
  }

  it('frames the jumbotron rock screen at 35–60 % of the 1440 frame width', () => {
    const station = SAKURA_STATIONS[0];
    const share = faceShare(station.camera.position, station.camera.target, station.camera.fov, 7.0);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.6);
  });

  it('frames the banner wall at 35–60 % of the 1440 frame width', () => {
    const station = SAKURA_STATIONS[3];
    const share = faceShare(station.camera.position, station.camera.target, station.camera.fov, 7.2);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.6);
  });

  it('keeps both board faces under 75 % of the landed 390 frame', () => {
    for (const [index, faceWidth] of [
      [0, 7.0],
      [3, 7.2],
    ] as const) {
      const station = SAKURA_STATIONS[index];
      const landed = eyeToTarget(station.cameraMobile.position, station.cameraMobile.target);
      const distance = Math.sqrt(landed) + MAX_PULLBACK; // along the view axis
      const frameWidth = 2 * distance * Math.tan((station.cameraMobile.fov * Math.PI) / 360) * (390 / 844);
      expect(faceWidth / frameWidth).toBeLessThan(0.75);
    }
  });
});

describe('mountain station ledger (C-094)', () => {
  it('matches the mountain world section manifest exactly, in order', () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'mountain' });
    expect(MOUNTAIN_STATION_IDS).toEqual(world.sections.map((section) => section.id));
    expect(mountainTheme.stations.map((station) => station.id)).toEqual(
      world.sections.map((section) => section.id),
    );
    // The English manifest keeps the harness's ids with English labels.
    expect(world.sections.map((section) => section.navLabel)).toEqual([
      'Pulse',
      'Point-Buy list',
      'Teams',
      'Schedule',
      'Rules',
    ]);
    expect(world.tokenNamespace).toBe('mountain');
  });

  it('authors English beats and carries no theme locale', () => {
    expect('locale' in mountainTheme).toBe(false);
    for (const station of MOUNTAIN_STATIONS) {
      expect(station.beat).toMatch(/[^]/);
    }
  });

  it('never stands closer to its hero than the plaza’s same station on any pose class (three-class guard, C-095 r2)', () => {
    expectNoCloserThanPlaza(MOUNTAIN_STATIONS);
  });

  it('pulls the camera back and widens the lens on mobile', () => {
    for (const station of MOUNTAIN_STATIONS) {
      const desktop = endpointFor(station, false);
      const mobile = endpointFor(station, true);
      expect(mobile.fov).toBeGreaterThan(desktop.fov);
      expect(mobile.fov).toBeLessThanOrEqual(60);
      expect(eyeToTarget(mobile.position, mobile.target)).toBeGreaterThan(
        eyeToTarget(desktop.position, desktop.target),
      );
    }
  });

  it('declares the mountain holds, vocabulary and procedural-first roles', () => {
    expect(mountainTheme.holdIds).toEqual(['pulse', 'schedule']);
    // C-103: the rework mounts the C-107 GLB props on `mountain-prop-` roots
    // — the family the static batcher must spare (the C-102 r1 flip
    // pattern).
    expect(mountainTheme.propFamilyPrefixes).toEqual(['mountain-prop-']);
    // Procedural-first: no bucket texture set consumed (zero binary bytes).
    expect(mountainTheme.textureRoles).toEqual([]);
    expect(mountainTheme.focusVocabulary).toEqual({
      kinds: ['ace', 'board', 'roster', 'rules'],
      panelParams: ['team', 'mon', 'board', 'rules'],
    });
  });

  it('dims the key at the pass gate relative to the opening pulse', () => {
    expect(MOUNTAIN_STATIONS[4].world.key).toBeLessThan(MOUNTAIN_STATIONS[0].world.key);
  });
});

describe('mountain content-wall framing (spec §8 amended — board-face budget)', () => {
  /** Face share of the 1440×900 desktop frame (aspect 1.6). */
  function faceShare(position: readonly number[], target: readonly number[], fov: number, faceWidth: number) {
    const distance = Math.sqrt(eyeToTarget(position, target));
    const frameWidth = 2 * distance * Math.tan((fov * Math.PI) / 360) * 1.6;
    return faceWidth / frameWidth;
  }

  it('frames the summit board at 30–60 % of the 1440 frame width', () => {
    const station = MOUNTAIN_STATIONS[0];
    const share = faceShare(station.camera.position, station.camera.target, station.camera.fov, 7.0);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.6);
  });

  it('frames the trail-sign row at 30–60 % of the 1440 frame width', () => {
    const station = MOUNTAIN_STATIONS[3];
    // 7.15 is the NOMINAL stand-in kept from the pre-widening row: the C-103
    // row widened to an 11.2 m nominal extent (SIGNS in mountain layout.ts),
    // but the row is yawed, so the still-measured share (~half the frame) is
    // the judged number and the 11.2 m nominal would overstate a yawed row's
    // frame share (the formula law) — this test pins the share bound.
    const share = faceShare(station.camera.position, station.camera.target, station.camera.fov, 7.15);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.6);
  });

  it('keeps both board faces under 75 % of the landed 390 frame', () => {
    for (const [index, faceWidth] of [
      [0, 7.0],
      [3, 7.15], // nominal stand-in for the yawed sign row — see the framing test above
    ] as const) {
      const station = MOUNTAIN_STATIONS[index];
      const landed = eyeToTarget(station.cameraMobile.position, station.cameraMobile.target);
      const distance = Math.sqrt(landed) + MAX_PULLBACK; // along the view axis
      const frameWidth = 2 * distance * Math.tan((station.cameraMobile.fov * Math.PI) / 360) * (390 / 844);
      expect(faceWidth / frameWidth).toBeLessThan(0.75);
    }
  });
});

describe('mountain palette extension (C-094)', () => {
  it('returns the sunlit valley literals for the fallback tokens', () => {
    const ext = mountainTheme.paletteExtension(FALLBACK_PALETTE, false);
    expect(ext.sky).toBe('#79b7e4');
    expect(ext.skyHorizon).toBe('#e2e9e4');
    expect(ext.rockColor).toBe('#8a8478');
    expect(ext.snowColor).toBe('#f2f6fa');
    expect(ext.meadowColor).toBe('#749b5c');
    expect(ext.boardField).toBe('#22303a');
    expect(ext.tarnDeep).toBe('#3a707c');
    // Sun/moon discs are theme constants, not day/night branches.
    expect(ext.sunColor).toBe('#fff2cc');
    expect(ext.moonColor).toBe('#f6f4ff');
  });

  it('switches every day/night role on the ground-luminance branch', () => {
    const dark = { ...FALLBACK_PALETTE, ground: '#0a0a12' };
    const ext = mountainTheme.paletteExtension(dark, true);
    expect(ext.sky).toBe('#0a0f26');
    expect(ext.skyHorizon).toBe('#243250');
    expect(ext.rockColor).toBe('#4e4a52');
    expect(ext.snowColor).toBe('#c3d2e8');
    expect(ext.meadowColor).toBe('#39543f');
    expect(ext.tarnDeep).toBe('#15323e');
  });
});

describe('clouds station ledger (C-095)', () => {
  it('matches the clouds world section manifest exactly, in order', () => {
    const world = resolveWorld({ format_type: 'singles', route_theme: 'clouds' });
    expect(CLOUDS_STATION_IDS).toEqual(world.sections.map((section) => section.id));
    expect(cloudsTheme.stations.map((station) => station.id)).toEqual(
      world.sections.map((section) => section.id),
    );
    // The English manifest keeps the harness's ids with English labels.
    expect(world.sections.map((section) => section.navLabel)).toEqual([
      'Pulse',
      'Point-Buy list',
      'Teams',
      'Schedule',
      'Rules',
    ]);
    expect(world.tokenNamespace).toBe('clouds');
  });

  it('authors English beats and carries no theme locale', () => {
    expect('locale' in cloudsTheme).toBe(false);
    for (const station of CLOUDS_STATIONS) {
      expect(station.beat).toMatch(/[^]/);
    }
  });

  it('never stands closer to its hero than the plaza’s same station on any pose class (three-class guard, C-095 r2)', () => {
    expectNoCloserThanPlaza(CLOUDS_STATIONS);
  });

  it('pulls the camera back and widens the lens on mobile', () => {
    for (const station of CLOUDS_STATIONS) {
      const desktop = endpointFor(station, false);
      const mobile = endpointFor(station, true);
      expect(mobile.fov).toBeGreaterThan(desktop.fov);
      expect(mobile.fov).toBeLessThanOrEqual(60);
      expect(eyeToTarget(mobile.position, mobile.target)).toBeGreaterThan(
        eyeToTarget(desktop.position, desktop.target),
      );
    }
  });

  it('declares the clouds holds, vocabulary and procedural-first roles', () => {
    expect(cloudsTheme.holdIds).toEqual(['pulse', 'schedule']);
    // C-104 r1: the C-107 GLB props landed (register hull body + halo
    // crown, PropMounts) — the family declaration flipped with them
    // (the pin-sweep law).
    expect(cloudsTheme.propFamilyPrefixes).toEqual(['clouds-prop-']);
    // Procedural-first: no bucket texture set consumed (zero binary bytes).
    expect(cloudsTheme.textureRoles).toEqual([]);
    expect(cloudsTheme.focusVocabulary).toEqual({
      kinds: ['ace', 'board', 'roster', 'rules'],
      panelParams: ['team', 'mon', 'board', 'rules'],
    });
  });

  it('dims the key at the halo gate relative to the opening pulse', () => {
    expect(CLOUDS_STATIONS[4].world.key).toBeLessThan(CLOUDS_STATIONS[0].world.key);
  });
});

describe('clouds content-wall framing (spec §8 amended — board-face budget)', () => {
  /** Face share of the 1440×900 desktop frame (aspect 1.6). */
  function faceShare(position: readonly number[], target: readonly number[], fov: number, faceWidth: number) {
    const distance = Math.sqrt(eyeToTarget(position, target));
    const frameWidth = 2 * distance * Math.tan((fov * Math.PI) / 360) * 1.6;
    return faceWidth / frameWidth;
  }

  it('frames the flagship billboard at 30–60 % of the 1440 frame width', () => {
    const station = CLOUDS_STATIONS[0];
    const share = faceShare(station.camera.position, station.camera.target, station.camera.fov, 7.0);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.6);
  });

  it('frames the fixtures board at 30–60 % of the 1440 frame width', () => {
    const station = CLOUDS_STATIONS[3];
    const share = faceShare(station.camera.position, station.camera.target, station.camera.fov, 6.6);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.6);
  });

  it('keeps both board faces under 75 % of the landed 390 frame', () => {
    for (const [index, faceWidth] of [
      [0, 7.0],
      [3, 6.6],
    ] as const) {
      const station = CLOUDS_STATIONS[index];
      const landed = eyeToTarget(station.cameraMobile.position, station.cameraMobile.target);
      const distance = Math.sqrt(landed) + MAX_PULLBACK; // along the view axis
      const frameWidth = 2 * distance * Math.tan((station.cameraMobile.fov * Math.PI) / 360) * (390 / 844);
      expect(faceWidth / frameWidth).toBeLessThan(0.75);
    }
  });
});

describe('clouds palette extension (C-095)', () => {
  it('returns the sunlit sky literals for the fallback tokens', () => {
    const ext = cloudsTheme.paletteExtension(FALLBACK_PALETTE, false);
    expect(ext.sky).toBe('#4f97d2');
    expect(ext.skyHorizon).toBe('#e3ebe8');
    expect(ext.cloudTop).toBe('#fdfdfb');
    expect(ext.cloudBase).toBe('#b7c8d8');
    expect(ext.meadowColor).toBe('#7cb465');
    expect(ext.bridgeGlow).toBe('#8fd8e8');
    expect(ext.boardField).toBe('#1d3040');
    // Sun/moon discs are theme constants, not day/night branches.
    expect(ext.sunColor).toBe('#fff3d0');
    expect(ext.moonColor).toBe('#f4f2ff');
  });

  it('switches every day/night role on the ground-luminance branch', () => {
    const dark = { ...FALLBACK_PALETTE, ground: '#0a0a12' };
    const ext = cloudsTheme.paletteExtension(dark, true);
    expect(ext.sky).toBe('#0b1230');
    expect(ext.skyHorizon).toBe('#2a3654');
    expect(ext.cloudTop).toBe('#aebdd8');
    expect(ext.cloudBase).toBe('#2c3a58');
    expect(ext.meadowColor).toBe('#3d5a49');
    expect(ext.bridgeGlow).toBe('#aeeaff');
    expect(ext.boardField).toBe('#152636');
  });
});

describe('mountain switchback terrain (C-094 — no floating segments)', () => {
  it('seats the summit board plinth and viewing deck exactly on the knoll field', () => {
    const { SUMMIT, knollHeight, KNOLL } = mountainLayout;
    expect(SUMMIT.seatY).toBeCloseTo(knollHeight(SUMMIT.board.x, SUMMIT.board.z), 4);
    expect(SUMMIT.deck.seatY).toBeCloseTo(knollHeight(SUMMIT.deck.x, SUMMIT.deck.z), 4);
    expect(knollHeight(KNOLL.x, KNOLL.z)).toBeCloseTo(KNOLL.h, 6);
  });

  it('runs every trail and switchback leg inside the valley bounds', () => {
    const { TRAIL_SEGMENTS, SWITCHBACKS, knollHeight } = mountainLayout;
    for (const leg of [...TRAIL_SEGMENTS, ...SWITCHBACKS]) {
      for (const [x, z] of [leg.from, leg.to]) {
        expect(Math.abs(x)).toBeLessThan(20);
        expect(Math.abs(z)).toBeLessThan(23);
      }
    }
    // The switchback legs climb overall (base → deck seat).
    const legs = SWITCHBACKS;
    const first = knollHeight(legs[0].from[0], legs[0].from[1]);
    const last = knollHeight(legs[legs.length - 1].to[0], legs[legs.length - 1].to[1]);
    expect(last).toBeGreaterThan(first);
  });
});

describe('conductor idle settle snap (W6 round 2 — smooth reaches exact on a pin station)', () => {
  function progressAt(exact: number, smooth: number): RouteProgress {
    return {
      exact,
      smooth,
      index: Math.floor(exact),
      localT: exact - Math.floor(exact),
      direction: 0,
      velocity: 0,
      pin: null,
      nearest: Math.round(exact),
      jump: { token: 0, from: 0, to: 0 },
      lastSampleKind: 'remeasure',
      mapVersion: 1,
      sampleScrollY: 0,
      settleToken: 0,
    };
  }

  it('lands exactly on an integer station within 1 s of idle, even at a slow frame rate', () => {
    // The plaza #rules failure: smooth=3.9789 vs exact=4 after a re-seek.
    const progress = progressAt(4, 3.0);
    let elapsed = 0;
    // 10 fps headless: the delta clamp slows the follower's wall-time tail.
    while (progress.smooth !== progress.exact && elapsed < 5) {
      advanceSmooth(progress, 0.1);
      elapsed += 0.1;
    }
    expect(progress.smooth).toBe(4);
    // From the 0.02 snap band (not from a whole station away) it is ≤ 1 s.
    const near = progressAt(4, 3.9789);
    let t = 0;
    while (near.smooth !== near.exact && t < 5) {
      advanceSmooth(near, 1 / 60);
      t += 1 / 60;
    }
    expect(near.smooth).toBe(4);
    expect(t).toBeLessThanOrEqual(1);
  });

  it('never snaps mid-crossing, where the crossing ease is steep', () => {
    const progress = progressAt(1.22, 1.205);
    for (let i = 0; i < 120; i += 1) advanceSmooth(progress, 1 / 60);
    // Converges asymptotically, but never by a discrete jump.
    const before = progress.smooth;
    advanceSmooth(progress, 1 / 60);
    expect(Math.abs(progress.smooth - before)).toBeLessThan(SMOOTH_SNAP_EPS);
    expect(progress.smooth).not.toBe(1.22);
  });

  it('does not snap while exact is still moving', () => {
    const progress = progressAt(2, 1.99);
    advanceSmooth(progress, 1 / 60);
    expect(progress.smooth).not.toBe(2);
  });

  it('snaps a sub-pixel station landing (390: exact 1.000474 / 2.000527) onto the integer once idle', () => {
    for (const [landing, station] of [
      [1.000474, 1],
      [2.000527, 2],
      [2.9991, 3],
    ] as const) {
      const progress = progressAt(landing, landing);
      advanceSmooth(progress, 1 / 60);
      // Not before the input has been idle for SMOOTH_SNAP_STILL_S.
      expect(progress.exact).toBe(landing);
      let t = 0;
      while (progress.smooth !== station && t < 1) {
        advanceSmooth(progress, 1 / 60);
        t += 1 / 60;
      }
      expect(progress.exact).toBe(station);
      expect(progress.smooth).toBe(station);
      expect(progress.index).toBe(station);
      expect(progress.localT).toBe(0);
    }
  });

  it('drops a latched travel direction to 0 once the visitor has rested (the idle lead waits on it)', () => {
    const progress = progressAt(4, 4);
    progress.direction = 1 as RouteProgress['direction'];
    progress.velocity = 3;
    let t = 0;
    while (progress.direction !== 0 && t < 2) {
      advanceSmooth(progress, 1 / 60);
      t += 1 / 60;
    }
    expect(progress.direction).toBe(0);
    expect(progress.velocity).toBe(0);
    expect(t).toBeGreaterThanOrEqual(DIRECTION_REST_S - 1e-9);
    expect(t).toBeLessThan(DIRECTION_REST_S + 0.1);
  });

  it('never snaps exact outside the 0.002 station band', () => {
    const progress = progressAt(1.004, 1.004);
    for (let i = 0; i < 120; i += 1) advanceSmooth(progress, 1 / 60);
    expect(progress.exact).toBe(1.004);
  });
});

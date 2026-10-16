import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createWindowMaterial,
  withPaneUv,
  WINDOW_LOOK,
  WINDOW_PROGRAM_KEY,
  WINDOW_UNIFORMS,
  writeWindowLook,
} from '@/components/world/evoliga/route/plaza/HaussmannBlock';
import { paneComponents, paneKindOf, paneUvOf } from '@/lib/route-world/haussmann';
import {
  CONTRE_JOUR,
  contreJourFactor,
  POST_OFF_SHADE_SHIFT,
} from '@/components/world/evoliga/route/env/Lighting';
import {
  GROUND_TINT_MIX,
  groundMapGlsl,
  MEDALLION_SCALE,
  PAINT_GROUND_KEY,
} from '@/components/world/evoliga/route/plaza/paint-ground';
import { ASHLAR_CALM, ASHLAR_MAP_GLSL, ASHLAR_PROGRAM_KEY } from '@/components/world/themes/plaza/paint-ashlar';
import { SKY_DAY_LUMA_CAP, SKY_RAYS } from '@/components/world/route/env/paint-fx';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import {
  ANCHORS,
  buildPaintedLightsChunk,
  PAINT_PARS_GLSL,
  paintedChunks,
  paintTintMockRequested,
  POINT_TINT_LINE,
  resetPaintedChunksForTest,
} from '../painted-light';
import { installPointLightLoop, POINT_LOOP_MARKER } from '../../light-loop';
import { applyPaintSet, createPaintUniforms } from '../paint-uniforms';
import { isPaintExempt } from '../paint-sweep';

/**
 * LOOK round 4 (ART DIRECTOR): painterly windows (and the kit's stray strips
 * gone), the ground story, calmer ashlar, the rules contre-jour, warm night
 * practicals, and the self-lit display exemption.
 */

type V3 = [number, number, number];

/** 24-vertex box (three's BoxGeometry layout) as a position list + index. */
function box(min: V3, max: V3): { positions: V3[]; index: number[] } {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const pos = g.getAttribute('position');
  const positions: V3[] = [];
  for (let i = 0; i < pos.count; i += 1) positions.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  return { positions, index: Array.from(g.getIndex()!.array) };
}

function merged(...boxes: { positions: V3[]; index: number[] }[]): { positions: V3[]; index: number[] } {
  const positions: V3[] = [];
  const index: number[] = [];
  for (const b of boxes) {
    const base = positions.length;
    positions.push(...b.positions);
    index.push(...b.index.map((i) => i + base));
  }
  return { positions, index };
}

describe('painterly windows: the glazing cut', () => {
  it('drops the kit rustication strips, keeps panes, and flags sign bands', () => {
    // bay-ground pane: a 1.7 × 0.02 × 0.01 strip in front of the stone.
    expect(paneKindOf([-0.84, -0.47, 0.1], [0.84, -0.46, 0.11])).toBe('drop');
    // A real pane (bay-plain glass) and a door.
    expect(paneKindOf([-0.26, -0.61, -0.17], [0.26, 0.58, -0.16])).toBe('pane');
    // The shopfront fascia (0.62 × 0.2) is a sign band.
    expect(paneKindOf([-0.31, 0.71, 0.15], [0.31, 0.91, 0.18])).toBe('band');
  });

  it('splits disjoint boxes into components and joins a box whose faces carry their own vertices', () => {
    const geo = merged(box([-0.26, -0.61, -0.17], [0.26, 0.58, -0.16]), box([-0.84, -0.47, 0.1], [0.84, -0.46, 0.11]));
    const comps = paneComponents(geo.positions.length, (i) => geo.positions[i], geo.index);
    expect(comps).toHaveLength(2);
    expect(comps.map((c) => c.kind).sort()).toEqual(['drop', 'pane']);
  });

  it('maps a pane to 0..1 across its wider horizontal axis and up its height; a band to −1', () => {
    const geo = box([0, 1, -0.2], [0.02, 2, 0.4]); // a void-window pane in the z–y plane
    const [comp] = paneComponents(geo.positions.length, (i) => geo.positions[i], geo.index);
    const lo = paneUvOf(comp, [0.01, 1, -0.2]);
    const hi = paneUvOf(comp, [0.01, 2, 0.4]);
    expect(lo[0]).toBeCloseTo(0, 5);
    expect(lo[1]).toBeCloseTo(0, 5);
    expect(hi[0]).toBeCloseTo(1, 5);
    expect(hi[1]).toBeCloseTo(1, 5);
    const band = box([-1, 3, 0], [1, 3.3, 0.05]);
    const [bandComp] = paneComponents(band.positions.length, (i) => band.positions[i], band.index);
    expect(bandComp.kind).toBe('band');
    expect(paneUvOf(bandComp, [0, 3.1, 0])).toEqual([-1, -1]);
  });

  it('re-cuts a geometry with a paneUv attribute and without its strips', () => {
    const src = merged(box([-0.26, -0.61, -0.17], [0.26, 0.58, -0.16]), box([-0.84, -0.47, 0.1], [0.84, -0.46, 0.11]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(src.positions.flat(), 3));
    g.setIndex(src.index);
    g.computeVertexNormals();
    const cut = withPaneUv(g)!;
    expect(cut.getAttribute('paneUv')).toBeDefined();
    expect(cut.getIndex()!.count).toBe(36); // one box left
    const strips = withPaneUv(
      (() => {
        const s = box([-0.84, -0.47, 0.1], [0.84, -0.46, 0.11]);
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(s.positions.flat(), 3));
        sg.setIndex(s.index);
        return sg;
      })(),
    );
    expect(strips).toBeNull();
  });
});

describe('painterly windows: the material', () => {
  it('one unlit program for glass and lit panes, never painted', () => {
    const glass = createWindowMaterial(false);
    const lit = createWindowMaterial(true);
    expect(glass.customProgramCacheKey()).toBe(WINDOW_PROGRAM_KEY);
    expect(lit.customProgramCacheKey()).toBe(WINDOW_PROGRAM_KEY);
    expect((glass as THREE.Material & { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial).toBeFalsy();
    expect(glass.userData.paintExempt).toBe(true);
  });

  it('patches the basic program: pane varyings in, the window colour before the opaque output', () => {
    const material = createWindowMaterial(true);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('attribute vec2 paneUv;');
    expect(shader.vertexShader).toContain('vPaneUv = paneUv;');
    expect(shader.fragmentShader).toContain('outgoingLight = winColor();\n#include <opaque_fragment>');
    expect(shader.uniforms.uWinLit.value).toBe(1);
    expect(shader.uniforms.uWinSkyLo).toBe(WINDOW_UNIFORMS.uWinSkyLo);
  });

  it('day glass is darker than the sky it reflects; night lit panes glow warm (static)', () => {
    writeWindowLook(false);
    expect(WINDOW_UNIFORMS.uWinGain.value).toBeLessThan(1);
    expect(WINDOW_UNIFORMS.uWinNight.value).toBe(0);
    writeWindowLook(true);
    const warm = WINDOW_UNIFORMS.uWinWarm.value;
    expect(warm.r).toBeGreaterThan(warm.b * 2);
    expect(warm.r).toBeGreaterThan(1);
    expect(WINDOW_UNIFORMS.uWinNight.value).toBe(1);
    expect(new THREE.Color(WINDOW_LOOK.night.skyLo).b).toBeGreaterThan(new THREE.Color(WINDOW_LOOK.night.skyLo).r);
  });
});

describe('ground story', () => {
  it('bumps the program key and warms the sett base (lilac only in the shadow term)', () => {
    expect(PAINT_GROUND_KEY).toBe('paint-ground-v5');
    expect(GROUND_TINT_MIX).toBeGreaterThanOrEqual(0.5);
    expect(MEDALLION_SCALE).toBeGreaterThan(1);
  });

  it('never reads the clamped story mask outside its plane (procedural patch and hue fields)', () => {
    const glsl = groundMapGlsl();
    expect(glsl).not.toMatch(/texture2D\(\s*uPgMask,\s*pgMaskUv\s*\*/);
    expect(glsl).toContain('pgNoise( pgW.xz /');
    expect(glsl).toContain('pgInlay');
  });
});

describe('calm ashlar', () => {
  it('blends the painted grain toward its mean and draws clear joints', () => {
    expect(ASHLAR_PROGRAM_KEY).toBe('paint-ashlar-v3');
    expect(ASHLAR_CALM.grain).toBeGreaterThan(0.4);
    expect(ASHLAR_MAP_GLSL).toContain(`texture2D( map, vMapUv, ${ASHLAR_CALM.bias.toFixed(1)} )`);
    expect(ASHLAR_MAP_GLSL).toContain('ashPillow');
  });
});

describe('rules contre-jour', () => {
  const keyDirection = plazaTheme.lights.keyDirection;
  function viewOf(stationId: string): { x: number; z: number } {
    const s = plazaTheme.stations.find((st) => st.id === stationId)!;
    return { x: s.camera.target[0] - s.camera.position[0], z: s.camera.target[2] - s.camera.position[2] };
  }

  it('the rules eye looks into the sun; pulse, teams and schedule do not', () => {
    expect(contreJourFactor(viewOf('rules'), keyDirection)).toBeGreaterThan(0.5);
    for (const id of ['pulse', 'teams', 'schedule']) expect(contreJourFactor(viewOf(id), keyDirection)).toBe(0);
  });

  it('warm bounce and sunward air grow, the cool fill steps down only a little', () => {
    expect(CONTRE_JOUR.bounce).toBeGreaterThan(0);
    expect(CONTRE_JOUR.lift).toBeGreaterThan(0);
    expect(CONTRE_JOUR.shade).toBeLessThanOrEqual(0.15);
  });

  it('the sky soft-knees below the face P99 and carries the warm ray fan', () => {
    expect(SKY_DAY_LUMA_CAP.knee).toBeLessThan(SKY_DAY_LUMA_CAP.peak);
    expect(SKY_DAY_LUMA_CAP.peak).toBeLessThan(0.8);
    expect(SKY_RAYS.count).toBeGreaterThan(0);
  });

  it('rung 2 shifts the shade toward a warm sand (ACES would turn violet magenta)', () => {
    const c = new THREE.Color(POST_OFF_SHADE_SHIFT.color);
    expect(c.r).toBeGreaterThan(c.b);
  });
});

describe('painted light: bounce and warm practicals', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetPaintedChunksForTest();
  });

  const TINTED_LOOKUP = `${ANCHORS.pointInfo}\n\t\t${POINT_TINT_LINE}`;

  /** The chunk three compiles: the light-loop split installed (as the route canvas does at module scope). */
  function installedChunk(): string {
    installPointLightLoop();
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    expect(chunk).toContain(POINT_LOOP_MARKER);
    return chunk;
  }

  /** Whether the tint follows the lookup inside the LIVE plain (unshadowed) loop. */
  function tintsPlainLoop(chunk: string): boolean {
    const plainAt = chunk.indexOf(POINT_LOOP_MARKER);
    return plainAt >= 0 && chunk.indexOf(TINTED_LOOKUP, plainAt) > plainAt;
  }

  it('declares both terms; the installed chunk compiles no dead tint by default (D42 N6, D48)', () => {
    expect(PAINT_PARS_GLSL).toContain('uniform vec3 uBounce;');
    expect(PAINT_PARS_GLSL).toContain('vec3 paintPointTint(');
    const installed = installedChunk();
    expect(buildPaintedLightsChunk(installed)).not.toContain(POINT_TINT_LINE);
    expect(paintedChunks().lights).not.toContain(POINT_TINT_LINE);
    // Why it was dead: the old first-match insert lands in the shadowed
    // (unrolled) branch only, never in the plain loop that renders.
    const firstMatch = installed.replace(ANCHORS.pointInfo, TINTED_LOOKUP);
    expect(tintsPlainLoop(firstMatch)).toBe(false);
  });

  it('the dev mock tints every point-light loop of the installed chunk, the live plain loop included', () => {
    const installed = installedChunk();
    const tinted = buildPaintedLightsChunk(installed, { pointTint: true });
    expect(tintsPlainLoop(tinted)).toBe(true);
    expect(tinted.split(POINT_TINT_LINE).length - 1).toBe(installed.split(ANCHORS.pointInfo).length - 1);
  });

  it('?routePaintTint=1 under routeDebug turns the mock on in dev; production and SSR ignore it', () => {
    installedChunk();
    expect(paintTintMockRequested()).toBe(false); // SSR: no window
    vi.stubGlobal('window', { location: { search: '?routeDebug=1&routePaintTint=1' } });
    expect(paintTintMockRequested()).toBe(true);
    expect(tintsPlainLoop(paintedChunks().lights)).toBe(true);
    resetPaintedChunksForTest();
    vi.stubEnv('NODE_ENV', 'production');
    expect(paintTintMockRequested()).toBe(false);
    expect(paintedChunks().lights).not.toContain(POINT_TINT_LINE);
    resetPaintedChunksForTest();
    vi.unstubAllEnvs();
    vi.stubGlobal('window', { location: { search: '?routePaintTint=1' } });
    expect(paintTintMockRequested()).toBe(false);
  });

  it('writes the day bounce and the night warm tint; identity when a set has neither', () => {
    const u = createPaintUniforms();
    applyPaintSet(PLAZA_PAINT.day, plazaTheme.lights.keyDirection, u);
    expect(u.uBounce.value.r).toBeGreaterThan(u.uBounce.value.b);
    expect(u.uPointWarm.value.getHex()).toBe(0xffffff);
    applyPaintSet(PLAZA_PAINT.night, plazaTheme.lights.keyDirection, u);
    expect(u.uBounce.value.getHex()).toBe(0x000000);
    expect(u.uPointWarm.value.r).toBeGreaterThan(u.uPointWarm.value.b);
  });

  it('LOOK r5: cast shade is cool (B > R, G ≥ R), form shade is near-neutral, and shade keeps its chroma', () => {
    const cast = new THREE.Color(PLAZA_PAINT.day.shadow.tint);
    expect(cast.b).toBeGreaterThan(cast.r * 1.2);
    expect(cast.g).toBeGreaterThanOrEqual(cast.r);
    const form = new THREE.Color(PLAZA_PAINT.day.shadow.form?.tint ?? '#000000');
    // Near-neutral, a little cool: never the r4 lilac overlay, never brown.
    expect(form.b).toBeGreaterThan(form.r);
    expect(form.b).toBeLessThan(form.r * 1.5);
    expect(form.g).toBeGreaterThanOrEqual(form.r);
    expect(PLAZA_PAINT.day.shadeSat ?? 0).toBeGreaterThan(0);
  });
});

describe('self-lit displays are never painted', () => {
  it('a lit material whose emissive map is its colour map (the crest LED) is exempt', () => {
    const tex = new THREE.Texture();
    const led = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex });
    expect(isPaintExempt(led)).toBe(true);
    const figure = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: new THREE.Texture() });
    expect(isPaintExempt(figure)).toBe(false);
  });
});

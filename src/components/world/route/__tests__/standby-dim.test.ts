import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { stepStationLatch } from '@/lib/route-world/direction-latch';
import { partialFaceTable, type DataSurfaceTheme } from '@/lib/route-world/data-surfaces';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_DATA_SURFACES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_DATA_SURFACES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_DATA_SURFACES } from '@/components/world/themes/clouds/furniture/data-faces';
import { BANNER_EMISSION, JUMBOTRON_EMISSION } from '@/components/world/themes/sakura/content/paint';
import { SIGN_EMISSION, SUMMIT_EMISSION } from '@/components/world/themes/mountain/content/paint';
import {
  BLOOM_THRESHOLD_DAY,
  BLOOM_THRESHOLD_NIGHT,
  DATA_EMISSIVE_CEILING,
  DATA_EMISSIVE_CEILING_DAY,
  STANDBY_EASE_MS,
  STANDBY_PROGRAM_KEY,
  clampBoardLight,
  createStandbyLevel,
  createStandbyUniforms,
  emissiveUnderInk,
  linearLuminance,
  patchStandbyShader,
  standbyCurve,
  standbyMaterialProps,
  standbyShaderParameters,
  standbyTarget,
  stepStandby,
  viewportKeyFor,
  type StandbyInput,
} from '../useStandbyDim';

const base: StandbyInput = {
  subjectId: 'board:schedule',
  faceStations: ['schedule'],
  faceIds: ['schedule:board'],
  activeStationId: 'pulse',
  partialIds: [],
  focusId: null,
  focusPhase: 'idle',
};

describe('standbyTarget — which data faces stand by', () => {
  it('lights the active station and stands a neighbour by', () => {
    expect(standbyTarget({ ...base, activeStationId: 'schedule' })).toEqual({ target: 0, reason: 'active' });
    expect(standbyTarget(base)).toEqual({ target: 1, reason: 'neighbour' });
  });

  it('names the partial-face table case (a neighbour cut by the frame)', () => {
    expect(standbyTarget({ ...base, partialIds: ['schedule:board'] })).toEqual({ target: 1, reason: 'neighbour-partial' });
  });

  it('never dims the active station, even when its face is cut by the frame', () => {
    const decision = standbyTarget({ ...base, activeStationId: 'schedule', partialIds: ['schedule:board'] });
    expect(decision).toEqual({ target: 0, reason: 'active-partial' });
  });

  it('is lit before the conductor has measured', () => {
    expect(standbyTarget({ ...base, activeStationId: null }).target).toBe(0);
  });

  it('focus overrides standby both ways; releasing hands back to the station rule', () => {
    expect(standbyTarget({ ...base, focusId: 'board:schedule', focusPhase: 'focusing' })).toEqual({ target: 0, reason: 'focused' });
    expect(standbyTarget({ ...base, activeStationId: 'schedule', focusId: 'board:pulse', focusPhase: 'focused' })).toEqual({
      target: 1,
      reason: 'focus-quiet',
    });
    expect(standbyTarget({ ...base, focusId: 'board:schedule', focusPhase: 'releasing' }).reason).toBe('neighbour');
  });
});

describe('stepStandby — the 400 ms ease', () => {
  it('walks linearly to the target over STANDBY_EASE_MS and stops there', () => {
    let s = createStandbyLevel(0);
    s = stepStandby(s, 1, STANDBY_EASE_MS / 2);
    expect(s.level).toBeCloseTo(0.5);
    expect(s.transitions).toBe(1);
    s = stepStandby(s, 1, STANDBY_EASE_MS);
    expect(s.level).toBe(1);
    const same = stepStandby(s, 1, 16);
    expect(same).toBe(s);
  });

  it('turns around mid-ease from where it is (no jump)', () => {
    let s = stepStandby(createStandbyLevel(0), 1, 100);
    s = stepStandby(s, 0, 50);
    expect(s.level).toBeCloseTo(0.125);
    expect(s.transitions).toBe(2);
  });

  it('eases with a soft curve at both ends', () => {
    expect(standbyCurve(0)).toBe(0);
    expect(standbyCurve(1)).toBe(1);
    expect(standbyCurve(0.5)).toBeCloseTo(0.5);
    expect(standbyCurve(0.1)).toBeLessThan(0.1);
  });

  it('a jitter around x.5 costs at most one transition per crossing (hysteretic nearest)', () => {
    const stations = SAKURA_DATA_SURFACES.stations;
    const input = { ...base, faceStations: ['roster'], faceIds: ['roster:wall'], subjectId: 'roster:wall' };
    // Pulse (0) → roster (1): ±0.1 jitter around 0.5, then the crossing lands.
    const path = [0, 0.3, 0.45, 0.55, 0.42, 0.6, 0.48, 0.58, 0.4, 0.62, 0.7, 0.9, 1];
    let nearest = 0;
    let level = createStandbyLevel(1);
    for (const p of path) {
      nearest = stepStationLatch(nearest, p, stations.length);
      const { target } = standbyTarget({ ...input, activeStationId: stations[nearest].id });
      level = stepStandby(level, target, 16);
    }
    expect(level.transitions).toBeLessThanOrEqual(1);
    // And back (1 → 0) with the same jitter: one more at most.
    for (const p of [...path].reverse()) {
      nearest = stepStationLatch(nearest, p, stations.length);
      const { target } = standbyTarget({ ...input, activeStationId: stations[nearest].id });
      level = stepStandby(level, target, 16);
    }
    expect(level.transitions).toBeLessThanOrEqual(2);
  });
});

describe('viewportKeyFor', () => {
  it('maps the capture viewports of record', () => {
    expect(viewportKeyFor(1440, 900)).toBe('desktop');
    expect(viewportKeyFor(768, 1024)).toBe('tablet');
    expect(viewportKeyFor(390, 844)).toBe('mobile');
    expect(viewportKeyFor(767, 400)).toBe('mobile');
  });
});

describe('the standby shader patch (created with the material, never lazily)', () => {
  it('lands on the standard material chunks and binds the SAME uniform objects', () => {
    const uniforms = createStandbyUniforms();
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const props = standbyMaterialProps(uniforms);
    props.onBeforeCompile(shader);
    expect(shader.uniforms.uStandby).toBe(uniforms.uStandby);
    expect(shader.uniforms.uStandbyFog).toBe(uniforms.uStandbyFog);
    expect(shader.uniforms.uDataCeiling).toBe(uniforms.uDataCeiling);
    expect(shader.fragmentShader).toContain('uniform float uStandby;');
    expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, uStandbyFog, 0.35 * uStandby)');
    expect(shader.fragmentShader).toContain('standbyCeiling(totalEmissiveRadiance * (1.0 - 0.70 * uStandby))');
    // The patch must come after the chunks it edits.
    const src = shader.fragmentShader;
    expect(src.indexOf('standbyCeiling(totalEmissiveRadiance')).toBeGreaterThan(src.indexOf('#include <emissivemap_fragment>'));
    expect(props.customProgramCacheKey()).toBe(STANDBY_PROGRAM_KEY);
  });

  it('fails loudly if a three upgrade moves the anchors', () => {
    const shader = { fragmentShader: 'void main() {}', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    expect(() => patchStandbyShader(shader, createStandbyUniforms())).toThrow(/anchors missing/);
  });

  it('a hand-written data ShaderMaterial binds the hook uniforms by reference (constructor path)', () => {
    // Wave 2 r2 (W1/W6): two boards of different kinds, each with its own
    // standby set, through the constructor path the plaza board uses.
    const pulse = createStandbyUniforms();
    const schedule = createStandbyUniforms();
    const a = new THREE.ShaderMaterial(standbyShaderParameters({ ...pulse }, 'void main(){}', 'void main(){}'));
    const b = new THREE.ShaderMaterial(standbyShaderParameters({ ...schedule }, 'void main(){}', 'void main(){}'));
    expect(a.uniforms.uStandby).toBe(pulse.uStandby);
    expect(b.uniforms.uStandby).toBe(schedule.uStandby);
    expect(a.uniforms.uStandby).not.toBe(b.uniforms.uStandby);
    // The hook writes its own objects per frame; the programs must see it.
    pulse.uStandby.value = 1;
    schedule.uStandby.value = 0;
    expect(a.uniforms.uStandby.value).toBe(1);
    expect(b.uniforms.uStandby.value).toBe(0);
    schedule.uStandby.value = 0.5;
    expect(b.uniforms.uStandby.value).toBe(0.5);
    expect(a.uniforms.uStandby.value).toBe(1);
  });

  it('the plaza board never hands its standby uniforms to the R3F `uniforms` prop (it copies them)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../evoliga/route/plaza/board/Board.tsx'),
      'utf8',
    );
    expect(src).toMatch(/<shaderMaterial[\s\S]*?args=\{\[panelParams\]\}/);
    expect(src).not.toMatch(/<shaderMaterial[^>]*\buniforms=\{/);
  });

  it('starts lit, with the ceiling armed', () => {
    const uniforms = createStandbyUniforms();
    expect(uniforms.uStandby.value).toBe(0);
    expect(uniforms.uDataCeiling.value).toBe(DATA_EMISSIVE_CEILING);
  });
});

describe('the data luminance budget', () => {
  it('keeps the data ceiling under the night bloom threshold', () => {
    expect(DATA_EMISSIVE_CEILING).toBeLessThan(BLOOM_THRESHOLD_NIGHT);
  });

  it('keeps the day ceiling under the day bloom threshold, above the night one (the active-face floor)', () => {
    expect(DATA_EMISSIVE_CEILING_DAY).toBeLessThan(BLOOM_THRESHOLD_DAY);
    expect(DATA_EMISSIVE_CEILING_DAY).toBeGreaterThan(DATA_EMISSIVE_CEILING);
  });

  it('every self-lit data face the world authors emits at or under the ceiling', () => {
    for (const emission of [...JUMBOTRON_EMISSION, ...BANNER_EMISSION, ...SUMMIT_EMISSION, ...SIGN_EMISSION]) {
      expect(emission).toBeLessThanOrEqual(DATA_EMISSIVE_CEILING);
    }
  });

  it('emissiveUnderInk lands a glow line exactly at its share of the ink', () => {
    const intensity = emissiveUnderInk('#aeeaff', '#eef6ff', 0.92, 0.6);
    expect(intensity * linearLuminance('#aeeaff')).toBeCloseTo(0.6 * 0.92 * linearLuminance('#eef6ff'), 6);
    expect(emissiveUnderInk('#000000', '#ffffff', 1, 0.6)).toBe(0);
  });

  it('clampBoardLight bounds the lambert radiance on the nearest lit surface', () => {
    const I = clampBoardLight(14, 1.24, 1.0, 0.8);
    expect((1.0 * I) / (Math.PI * 1.24 * 1.24)).toBeCloseTo(0.8, 6);
    expect(clampBoardLight(6, 1.73, 0.14, 0.8)).toBe(6);
  });
});

describe('standby over every world: the partial-face table is honoured', () => {
  const worlds: DataSurfaceTheme[] = [PLAZA_DATA_SURFACES, SAKURA_DATA_SURFACES, MOUNTAIN_DATA_SURFACES, CLOUDS_DATA_SURFACES];
  for (const world of worlds) {
    it(`${world.id}: at every station and viewport, active faces are lit and every partial neighbour stands by`, () => {
      const table = partialFaceTable(world);
      for (const station of world.stations) {
        for (const key of ['desktop', 'tablet', 'mobile'] as const) {
          const partialIds = table[station.id]?.[key] ?? [];
          for (const face of world.faces) {
            const decision = standbyTarget({
              subjectId: face.id,
              faceStations: [face.station],
              faceIds: [face.id],
              activeStationId: station.id,
              partialIds,
              focusId: null,
              focusPhase: 'idle',
            });
            if (face.station === station.id) expect(decision.target).toBe(0);
            else expect(decision.target).toBe(1);
            if (partialIds.includes(face.id) && face.station !== station.id) {
              expect(decision.reason).toBe('neighbour-partial');
            }
          }
        }
      }
    });
  }
});

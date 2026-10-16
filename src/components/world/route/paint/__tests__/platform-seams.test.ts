import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PLAZA_SKY_PRESET,
  PLAZA_SKYLINE_SPEC,
  SKY_UNIFORMS,
  buildSkyFragment,
  createPaintFxMaterial,
  createSkyMaterial,
  createSkyUniforms,
  programSignature,
  skylineBandsFor,
  writeSkyUniforms,
  type PaintedSkyPreset,
  type SkylineSpec,
} from '@/components/world/route/env/paint-fx';
import {
  CANOPY_EDGE_PRESETS,
  CANOPY_PROGRAM_KEY,
  CANOPY_SSS_GLSL,
  adoptCrownGeometry,
  buildCanopyGeometry,
  canopyProgramKey,
  canopySssGlsl,
  createCanopyMaterial,
  createCrownPlaceholderGeometry,
  hasCanopyAttributes,
  LEAF_GOLD,
} from '@/components/world/route/trees/tree-cards';
import { queuePaintedCrown } from '@/components/world/route/trees/Tree';
import { paintQueueIdle, pendingPaints, resetPaintQueueForTests } from '@/components/world/route/paint-queue';
import { LAMP_HALO_PROGRAM_KEY as SHARED_HALO_KEY, HALO_FRAGMENT as SHARED_HALO_FRAGMENT } from '@/components/world/route/env/LampHalos';
import { HALO_FRAGMENT, LAMP_HALO_PROGRAM_KEY } from '@/components/world/evoliga/route/plaza/LampHalos';
import { calmRectsFor, calmRectsForGroups, selectCalmFaces, selectCalmGroups } from '../calm-rects';
import { findPaintScopeLeaks, markPaintScene, paintSweep } from '../paint-sweep';
import { resetPaintScopeForTest, acquirePaintScope } from '../painted-light';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { MOUNTAIN_DATA_SURFACES } from '@/components/world/themes/mountain/furniture/data-faces';
import { VIEWPORTS, type DataSurfaceTheme } from '@/lib/route-world/data-surfaces';
import { planPaintedCanopy, crownSphere, type TreeSkin } from '@/lib/route-world/tree';
import type { WorldManifest } from '@/lib/route-world/model-manifest';
import {
  maskUrlFor,
  plazaMaskUrl,
  plazaSkylineUrl,
  skylineLayerHeight,
  skylineUrlFor,
  worldEnvFile,
} from '@/lib/route-world/world-env';
import { PLAZA_LINDEN_SKIN } from '@/components/world/evoliga/route/plaza/tree-skin';
import { isValidElement, type ReactNode } from 'react';
import PaintedSkyDome from '@/components/world/route/env/PaintedSkyDome';
import PaintedSkyline from '@/components/world/route/env/PaintedSkyline';
import SharedLampHalos from '@/components/world/route/env/LampHalos';
import SharedSunShafts from '@/components/world/route/env/SunShafts';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { paintFeature, type PaintFeatures, type RouteThemePaint } from '@/lib/route-world/theme-types';

const STARFIELD: PaintedSkyPreset = {
  ...PLAZA_SKY_PRESET,
  id: 'starfield-test',
  night: {
    variant: 'starfield',
    zenith: '#1c1638',
    horizon: '#4a3a6a',
    band: { color: '#2f7f86', elevation: 0.08, width: 0.1, strength: 0.4 },
    stars: { density: 0.06, size: 0.12, cellDeg: 1.2, brightness: 0.8 },
    milkyWay: { strength: 0.05, tilt: 0.6 },
    grain: 0.004,
    moon: { disc: 0.012, corona: { radius: 0.08, strength: 0.25 } },
  },
};

describe('sky preset (ROLLOUT §2.2 d): literal round-trip', () => {
  it('the plaza preset rebuilds the plaza source; a changed shape literal changes only its literal', () => {
    const plaza = buildSkyFragment(PLAZA_SKY_PRESET);
    expect(buildSkyFragment({ ...PLAZA_SKY_PRESET })).toBe(plaza);
    const tuned = buildSkyFragment({ ...PLAZA_SKY_PRESET, shape: { ...PLAZA_SKY_PRESET.shape, lumaCap: { knee: 0.45, peak: 0.7 } } });
    expect(tuned).not.toBe(plaza);
    expect(tuned).toContain('float over = max(capL - 0.450, 0.0);');
    expect(plaza).toContain('float over = max(capL - 0.500, 0.0);');
    // Only that one statement moved.
    const diff = plaza.split('\n').filter((line, i) => line !== tuned.split('\n')[i]);
    expect(diff).toHaveLength(2);
  });

  it('a starfield night is its own program (the plaza night branch is not in it) and declares the band uniform', () => {
    const f = buildSkyFragment(STARFIELD);
    expect(f).not.toBe(buildSkyFragment(PLAZA_SKY_PRESET));
    expect(f).toContain('uniform vec3 uNightBand;');
    expect(f).toContain('the shared starfield preset');
    expect(f).not.toContain('Point stars: one jittered disc per azimuth/elevation cell');
    expect(buildSkyFragment(PLAZA_SKY_PRESET)).not.toContain('uNightBand');
    const bandless = buildSkyFragment({ ...STARFIELD, night: { ...STARFIELD.night, band: undefined } as PaintedSkyPreset['night'] });
    expect(bandless).not.toContain('uNightBand');
    expect(programSignature(createSkyMaterial(createSkyUniforms(), STARFIELD))).not.toBe(programSignature(createSkyMaterial()));
  });

  it('writeSkyUniforms writes every preset field; the plaza writes the values it was created with', () => {
    const fresh = createSkyUniforms();
    const state = {
      night: false,
      sky: '#6eb4e0',
      skyHorizon: '#efe2c8',
      sunColor: '#fff1c4',
      moonColor: '#fff4ee',
      skyBodyPosition: [1, 2, 3] as const,
      cloudTaps: 2,
    };
    const u = createSkyUniforms();
    writeSkyUniforms(state, u, PLAZA_SKY_PRESET);
    for (const name of ['uDayHorizon', 'uDayMid', 'uDayZenith', 'uPeach', 'uLilac', 'uCloudBelly', 'uCloudMid', 'uCloudLit', 'uSilver', 'uSkyGold']) {
      expect((u[name].value as THREE.Color).toArray(), name).toEqual((fresh[name].value as THREE.Color).toArray());
    }
    // A starfield night takes its zenith / horizon / band from the preset.
    writeSkyUniforms({ ...state, night: true }, u, STARFIELD);
    expect(u.uZenith.value.getHexString()).toBe('1c1638');
    expect(u.uHorizon.value.getHexString()).toBe('4a3a6a');
    expect(u.uNightBand.value.getHexString()).toBe('2f7f86');
    // …and by day the palette's, with the preset's grade.
    writeSkyUniforms(state, u, STARFIELD);
    expect(u.uZenith.value.getHexString()).toBe('6eb4e0');
    // The shared set was never touched by these writes.
    expect(SKY_UNIFORMS.uNightBand.value.toArray()).toEqual([0, 0, 0]);
  });
});

describe('skyline spec (ROLLOUT §2.2 e)', () => {
  const OTHER: SkylineSpec = {
    ...PLAZA_SKYLINE_SPEC,
    file: 'env/mountain/skyline.webp',
    radii: [46, 74, 120],
    topElevationDeg: [10, 12, 14],
    windows: false,
  };

  it('one paint-fx source for any spec (spec values are uniforms or geometry)', () => {
    expect(programSignature(createPaintFxMaterial('skyline', { spec: OTHER }))).toBe(programSignature(createPaintFxMaterial('skyline')));
    const bands = skylineBandsFor(OTHER);
    expect(bands.map((band) => band.radius)).toEqual([46, 74, 120]);
    expect(bands[2].height).toBeCloseTo(120 * Math.tan((14 * Math.PI) / 180), 9);
    expect(skylineLayerHeight(70)).toBe(skylineLayerHeight(70, 16));
  });

  it('world env files resolve under env/<world>/ and the plaza wrappers keep their paths', () => {
    const manifest = (files: string[]): WorldManifest => ({
      version: 3,
      generatedAt: '2026-09-28T00:00:00.000Z',
      figures: [],
      props: [],
      environment: files.map((file) => ({ file, kb: 1 })),
      missingForms: [],
      pool: null,
    });
    const m = manifest(['env/plaza/mask.webp', 'env/plaza/skyline.webp', 'env/mountain/skyline.webp', 'env/sakura/mask.webp']);
    expect(worldEnvFile('sakura', 'mask.webp')).toBe('env/sakura/mask.webp');
    expect(maskUrlFor(m, 'sakura')?.endsWith('/env/sakura/mask.webp')).toBe(true);
    expect(maskUrlFor(m, 'clouds')).toBeNull();
    expect(skylineUrlFor(m, OTHER)?.endsWith('/env/mountain/skyline.webp')).toBe(true);
    expect(plazaMaskUrl(m)).toBe(maskUrlFor(m, 'plaza'));
    expect(plazaSkylineUrl(m)).toBe(skylineUrlFor(m, PLAZA_SKYLINE_SPEC));
  });
});

describe('calm unions (ROLLOUT §2.2 j)', () => {
  it('without unions the groups are exactly selectCalmFaces, one face per slot', () => {
    for (const position of [0, 0.5, 1, 2, 3.4, 4]) {
      expect(selectCalmGroups(PLAZA_DATA_SURFACES, position)).toEqual(selectCalmFaces(PLAZA_DATA_SURFACES, position).map((face) => [face]));
    }
  });

  it('a union takes ONE slot and publishes the bounding rect of its members', () => {
    const scheduleIndex = MOUNTAIN_DATA_SURFACES.stations.findIndex((station) => station.id === 'schedule');
    const signs = MOUNTAIN_DATA_SURFACES.faces.filter((face) => face.id.startsWith('schedule:sign:'));
    expect(signs.length).toBe(5);
    // Without the union, five cloths compete for four slots.
    const without = selectCalmFaces(MOUNTAIN_DATA_SURFACES, scheduleIndex);
    expect(without.filter((face) => face.id.startsWith('schedule:sign:')).length).toBe(4);

    const united: DataSurfaceTheme = {
      ...MOUNTAIN_DATA_SURFACES,
      calmUnions: [{ id: 'schedule-signs', members: signs.map((face) => face.id) }],
    };
    const groups = selectCalmGroups(united, scheduleIndex);
    const signGroup = groups.find((group) => group.some((face) => face.id.startsWith('schedule:sign:')));
    expect(signGroup?.map((face) => face.id)).toEqual(signs.map((face) => face.id));
    expect(groups.length).toBeLessThanOrEqual(4);

    const camera = MOUNTAIN_DATA_SURFACES.stations[scheduleIndex].camera;
    const viewport = VIEWPORTS.desktop;
    const [rect] = calmRectsForGroups([signGroup ?? []], camera, viewport);
    const members = calmRectsFor(signs, camera, viewport);
    expect(members.length).toBeGreaterThan(1);
    expect(rect[0]).toBe(Math.min(...members.map((r) => r[0])));
    expect(rect[1]).toBe(Math.min(...members.map((r) => r[1])));
    expect(rect[2]).toBe(Math.max(...members.map((r) => r[2])));
    expect(rect[3]).toBe(Math.max(...members.map((r) => r[3])));
    // The keep-out law is untouched: the theme still lists every face on its own.
    expect(united.faces).toBe(MOUNTAIN_DATA_SURFACES.faces);
  });
});

describe('canopy (ROLLOUT §2.2 h): the key per edge preset', () => {
  it('linden-gold keeps the plaza key and chunk; other edges key apart', () => {
    expect(canopyProgramKey()).toBe(CANOPY_PROGRAM_KEY);
    expect(canopyProgramKey('linden-gold')).toBe('tree-canopy-painted-v4');
    expect(canopyProgramKey('blossom-peach')).toBe('tree-canopy-painted-v4|edge:blossom-peach');
    expect(canopyProgramKey('aspen-gold')).toBe('tree-canopy-painted-v4|edge:aspen-gold');
    expect(CANOPY_EDGE_PRESETS['linden-gold']).toBe(LEAF_GOLD);
    expect(canopySssGlsl('linden-gold')).toBe(CANOPY_SSS_GLSL);
    const peach = canopySssGlsl('blossom-peach');
    expect(peach).not.toBe(CANOPY_SSS_GLSL);
    expect(peach).toContain('vec3( 1.200, 1.000, 0.920 )');
    expect(peach).toContain('vec3( 1.000, 0.700, 0.640 )');
    const tex = new THREE.Texture();
    expect(createCanopyMaterial(tex, { value: 0 }).customProgramCacheKey()).toBe(CANOPY_PROGRAM_KEY);
    expect(createCanopyMaterial(tex, { value: 0 }, 'blossom-peach').customProgramCacheKey()).toBe('tree-canopy-painted-v4|edge:blossom-peach');
    for (const preset of Object.values(CANOPY_EDGE_PRESETS)) expect(preset.gold[0]).toBeGreaterThan(preset.gold[1]);
  });
});

describe('painted crown builders (ROLLOUT §2.2 h): always through the sliced paint queue', () => {
  afterEach(() => resetPaintQueueForTests());

  it('the placeholder carries the canopy attribute set, and a queued crown is adopted in place', async () => {
    resetPaintQueueForTests();
    const placeholder = createCrownPlaceholderGeometry();
    expect(hasCanopyAttributes(placeholder)).toBe(true);
    expect(placeholder.groups).toHaveLength(1);
    const plan = planPaintedCanopy({ skin: PLAZA_LINDEN_SKIN, heightM: 3.4, seed: 7 });
    const crown = crownSphere(plan.structure, PLAZA_LINDEN_SKIN.cardScaleM);
    let built = 0;
    const skin: TreeSkin = {
      ...PLAZA_LINDEN_SKIN,
      paintedCrown: (input) => {
        built += 1;
        return {
          geometry: buildCanopyGeometry(input.plan.cards, input.skin.cardScaleM, input.crown),
          drawCount: (rung) => (rung === 0 ? input.plan.cards.length * 6 : 6),
        };
      },
    };
    let drawCount: ((rung: number) => number) | null = null;
    queuePaintedCrown(skin.paintedCrown!, placeholder, { plan, skin, crown }, (fn) => {
      drawCount = fn;
    });
    // Never synchronous: the build waits for its own task, and the load warm sees it pending.
    expect(built).toBe(0);
    expect(pendingPaints()).toBe(1);
    expect(paintQueueIdle()).toBe(false);
    await new Promise<void>((resolve) => {
      const poll = () => (paintQueueIdle() ? resolve() : setTimeout(poll, 1));
      poll();
    });
    expect(built).toBe(1);
    expect(drawCount).not.toBeNull();
    expect(placeholder.getIndex()?.count).toBe(plan.cards.length * 6);
    expect(placeholder.getAttribute('position').count).toBe(plan.cards.length * 4);
    expect(hasCanopyAttributes(placeholder)).toBe(true);
  });

  it('a crown with a foreign attribute set is refused (it would link a second program)', () => {
    const wrong = new THREE.BoxGeometry();
    expect(() => adoptCrownGeometry(createCrownPlaceholderGeometry(), wrong)).toThrow(/canopy attribute set/);
  });

  it('the shared PaintedTree routes every crown builder through queuePaint', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/world/route/trees/Tree.tsx'), 'utf8');
    expect(source).toMatch(/return queuePaint\(\(\) => \{\s*const built = builder\(input\);/);
    // The builder is never called in render or a memo.
    expect(source.match(/crownBuilder\(|paintedCrown\(/g) ?? []).toEqual([]);
  });
});

describe('lamp halos (ROLLOUT §2.2 f): key identity', () => {
  it('the plaza wrapper and the shared layer are one program', () => {
    expect(LAMP_HALO_PROGRAM_KEY).toBe('plaza-lamp-halo-v1');
    expect(SHARED_HALO_KEY).toBe(LAMP_HALO_PROGRAM_KEY);
    expect(HALO_FRAGMENT).toBe(SHARED_HALO_FRAGMENT);
  });
});

describe('scope (ROLLOUT §2.2 c)', () => {
  afterEach(() => resetPaintScopeForTest());

  it('a painted scene reports no leaks; an unpainted scene reports every marked material', () => {
    const release = acquirePaintScope('sakura');
    const painted = new THREE.Scene();
    markPaintScene(painted, 'sakura');
    const cached = new THREE.MeshStandardMaterial();
    cached.userData.paintScope = 'plaza'; // painted earlier in the plaza, shown here
    painted.add(new THREE.Mesh(new THREE.BoxGeometry(), cached));
    paintSweep(painted);
    expect(findPaintScopeLeaks(painted)).toEqual([]);
    const unpainted = new THREE.Scene();
    unpainted.add(new THREE.Mesh(new THREE.BoxGeometry(), cached));
    expect(findPaintScopeLeaks(unpainted)).toEqual([cached]);
    release();
  });

  it('the sweep has no default scope (the plaza passes its theme id)', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/world/route/paint/paint-sweep.ts'), 'utf8');
    expect(source).not.toMatch(/PAINT_SCOPE/);
    expect(source).toMatch(/export function PaintSweep\(\{ scope \}: \{ scope: string \}\)/);
    const rig = readFileSync(path.join(process.cwd(), 'src/components/world/route/paint/PaintRig.tsx'), 'utf8');
    expect(rig).toMatch(/<PaintSweep scope=\{theme\.id\} \/>/);
  });
});

describe('new PLATFORM files (ROLLOUT §4.3): no useMemo keyed on night or the rung', () => {
  const FILES = [
    'src/components/world/route/paint/PaintRig.tsx',
    'src/components/world/route/paint/paint-rig.ts',
    'src/components/world/route/paint/calm-boxes.ts',
    'src/components/world/route/env/PaintedSkyDome.tsx',
    'src/components/world/route/env/PaintedSkyline.tsx',
    'src/components/world/route/env/LampHalos.tsx',
    'src/components/world/route/env/SunShafts.tsx',
  ];

  function memoDeps(source: string): string[] {
    const out: string[] = [];
    let at = source.indexOf('useMemo(');
    while (at >= 0) {
      let depth = 0;
      let end = at;
      for (let i = at + 'useMemo'.length; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const call = source.slice(at, end + 1);
      out.push(call.slice(call.lastIndexOf('['), call.lastIndexOf(']') + 1));
      at = source.indexOf('useMemo(', end);
    }
    return out;
  }

  it.each(FILES)('%s', (file) => {
    for (const deps of memoDeps(readFileSync(path.join(process.cwd(), file), 'utf8'))) {
      expect(deps, `${file}: ${deps}`).not.toMatch(/\b(night|exposure|quality|rung|puddleEmitters|wet)\b/);
    }
  });
});

describe('the four env flags are real (ROLLOUT §2.2 a; B1 verifier fix 1)', () => {
  type EnvFlag = 'paintedSky' | 'skyline' | 'lampHalos' | 'sunShafts';
  const FLAGS: EnvFlag[] = ['paintedSky', 'skyline', 'lampHalos', 'sunShafts'];
  const palette = { sky: '#6eb4e0', skyHorizon: '#efe2c8', sunColor: '#fff1c4', moonColor: '#fff4ee' };

  /** Each generic layer's gate, called directly (the gates are hook-free). */
  const LAYERS: Record<EnvFlag, (paint: RouteThemePaint | null | undefined) => ReactNode> = {
    paintedSky: (paint) =>
      PaintedSkyDome({ paint, palette, night: false, post: true, cloudTaps: 3, skyBodyPosition: [0, 10, 0] }),
    skyline: (paint) => PaintedSkyline({ paint, night: false }),
    lampHalos: (paint) => SharedLampHalos({ paint, halos: [], night: false }),
    sunShafts: (paint) => SharedSunShafts({ paint, seats: [], night: false }),
  };

  const withFeatures = (features: Partial<PaintFeatures> | undefined): RouteThemePaint => ({ ...plazaTheme.paint!, features });

  it.each(FLAGS)('%s: no paint block, no features or the flag unset renders null', (flag) => {
    const layer = LAYERS[flag];
    expect(layer(undefined)).toBeNull();
    expect(layer(null)).toBeNull();
    expect(layer(withFeatures(undefined))).toBeNull();
    expect(layer(withFeatures({}))).toBeNull();
    expect(layer(withFeatures({ ...plazaTheme.paint!.features, [flag]: false }))).toBeNull();
    // Every OTHER flag on is not enough.
    const others = Object.fromEntries(FLAGS.filter((f) => f !== flag).map((f) => [f, true]));
    expect(layer(withFeatures(others))).toBeNull();
  });

  it.each(FLAGS)('%s: the flag alone mounts the layer (its body, a separate component)', (flag) => {
    const out = LAYERS[flag](withFeatures({ [flag]: true }));
    expect(isValidElement(out)).toBe(true);
    expect(typeof (out as { type: unknown }).type).toBe('function');
  });

  it('plazaTheme sets all four and renders all four', () => {
    for (const flag of FLAGS) {
      expect(paintFeature(plazaTheme.paint, flag), flag).toBe(true);
      expect(isValidElement(LAYERS[flag](plazaTheme.paint)), flag).toBe(true);
    }
  });

  it('the sky and the skyline also need their data (paint.sky / paint.skyline)', () => {
    const on = withFeatures({ paintedSky: true, skyline: true });
    expect(LAYERS.paintedSky({ ...on, sky: undefined })).toBeNull();
    expect(LAYERS.skyline({ ...on, skyline: undefined })).toBeNull();
    // The plaza's data is the preset and spec of record.
    const sky = LAYERS.paintedSky(plazaTheme.paint) as { props: { preset: unknown } };
    expect(sky.props.preset).toBe(PLAZA_SKY_PRESET);
    const ring = LAYERS.skyline(plazaTheme.paint) as { props: { spec: unknown; name: string } };
    expect(ring.props.spec).toBe(PLAZA_SKYLINE_SPEC);
    expect(ring.props.name).toBe('painted-skyline');
  });

  it('every plaza wrapper hands the generic layer the plaza paint block', () => {
    const wrappers = [
      'src/components/world/evoliga/route/env/Atmosphere.tsx',
      'src/components/world/evoliga/route/env/Skyline.tsx',
      'src/components/world/evoliga/route/env/SunShafts.tsx',
      'src/components/world/evoliga/route/plaza/LampHalos.tsx',
    ];
    for (const file of wrappers) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source, file).toMatch(/paint=\{plazaTheme\.paint\}/);
    }
  });
});

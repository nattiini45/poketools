import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CALM_CLOUD_CONTRAST,
  PAINTED_SKY_DAY,
  PLAZA_SKY_PRESET,
  PLAZA_SKYLINE_SPEC,
  SKY_CONTRE_JOUR_CLOUD,
  SKY_COVER_BIAS,
  SKY_DAY_HAZE,
  SKY_DAY_LUMA_CAP,
  SKY_GRADE,
  SKY_MID_ELEVATION,
  SKY_RAYS,
  SKY_SHADOW_RAY,
  buildSkyFragment,
  createPaintFxMaterial,
  createSkyMaterial,
  createSkylineGeometry,
  programSignature,
  skylineBandsFor,
} from '@/components/world/route/env/paint-fx';
import { CALM_GLSL } from '../paint-uniforms';
import {
  PAINT_CEIL_GLSL,
  PAINT_IBL_GLSL,
  PAINT_PARS_GLSL,
  PAINT_PROGRAM_KEY,
  paintedChunks,
  patchPaintedShader,
} from '../painted-light';
import {
  CANOPY_PROGRAM_KEY,
  CANOPY_SSS_GLSL,
  LEAF_GOLD,
  LEAF_LAMP_COLOR,
  LEAF_SSS_LEVELS,
  patchCanopyShader,
} from '@/components/world/route/trees/tree-cards';
import { SHAFT_FRAGMENT, SHAFT_VERTEX } from '@/components/world/evoliga/route/env/SunShafts';
import { HALO_FRAGMENT, HALO_VERTEX, LAMP_HALO_PROGRAM_KEY, plazaLampHalos } from '@/components/world/evoliga/route/plaza/LampHalos';
import { BLOB_FRAGMENT, BLOB_VERTEX } from '@/components/world/route/figures/ContactBlobs';
import {
  ASHLAR_CALM_FEATHER_M,
  ASHLAR_MAP_GLSL,
  ASHLAR_NORMAL_GLSL,
  ASHLAR_PARS_GLSL,
  ASHLAR_PROGRAM_KEY,
  ASHLAR_ROUGHNESS_GLSL,
} from '@/components/world/themes/plaza/paint-ashlar';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import {
  CONTRE_JOUR,
  POST_OFF_KEY_NEUTRAL,
  POST_OFF_SATURATION,
  POST_OFF_SHADE_SHIFT,
  SCENE_FILL_INTENSITY,
  SCENE_FILL_KEY_GAIN,
  SCENE_KEY_INTENSITY,
} from '@/components/world/evoliga/route/env/Lighting';
import { NIGHT_CANOPY_TINT, PLAZA_LEAF_LOOK } from '@/components/world/evoliga/route/plaza/Trees';
import { PLAZA_SKYLINE_ATLAS } from '@/lib/route-world/world-env';
import { SKYLINE_BANDS } from '@/lib/route-world/skyline';
import { LAMP_HALO } from '@/lib/route-world/plaza-emitters';
import { vignetteDarknessFor } from '@/components/world/route/post/PostStack';
import { expectSumClose, ulpSafe } from './ulp-safe';

/**
 * ROLLOUT §2.4 step 1 / §2.6 "static identity": the plaza's program sources
 * and keys were snapshotted BEFORE the PLATFORM refactor
 * (`__snapshots__/plaza-programs.r6.json`, written by a one-off generator
 * from the pre-refactor modules). After the refactor every source must be
 * byte-identical and every plaza paint value deep-equal to the constants of
 * record: the plaza links exactly the programs it linked in round 6.
 *
 * Never regenerate this file to make a test pass. A deliberate plaza look
 * change is an AD seat's job, with a new snapshot named for its round.
 */
const SNAPSHOT = JSON.parse(
  readFileSync(path.join(__dirname, '__snapshots__', 'plaza-programs.r6.json'), 'utf8'),
) as Record<string, unknown> & {
  sky: string;
  skyline: string;
  shaftFx: string;
  skylineUniforms: { atlasTexel: number[]; inkDay: number[][]; mixDay: number[]; rim: number[] };
  skylineGeometry: { vertices: number; weightedSum: number; bands: unknown };
  sunShafts: { vertex: string; fragment: string };
  canopy: { key: string; sss: string; vertex: string; fragment: string };
  painted: { key: string; lights: string; fog: string; pars: string; ibl: string; ceil: string; fragment: string };
  halo: { key: string; vertex: string; fragment: string };
  contactBlobs: { vertex: string; fragment: string };
  skyBody: { vertex: string; fragment: string };
  ashlar: { key: string; pars: string; map: string; roughness: string; normal: string; feather: number };
  calmGlsl: string;
  values: Record<string, unknown>;
};

/** JSON round-trip (the snapshot's own encoding): readonly tuples and `as const` objects compare as plain data. */
function plain<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function literal(file: string, name: string): string {
  const src = readFileSync(path.join(process.cwd(), file), 'utf8');
  const m = new RegExp(`const ${name} = (?:/\\* glsl \\*/ )?\``).exec(src);
  if (!m) throw new Error(`no literal ${name} in ${file}`);
  const start = m.index + m[0].length;
  // A template literal cooks CRLF to LF (the runtime source), whatever the checkout's line endings.
  return src.slice(start, src.indexOf('`;', start)).split('\r\n').join('\n');
}

describe('PLATFORM static identity: plaza program sources vs the r6 snapshot', () => {
  it('the painted sky (default preset and the plaza preset) is byte-identical', () => {
    expect(programSignature(createSkyMaterial())).toBe(SNAPSHOT.sky);
    expect(programSignature(createSkyMaterial(undefined, plazaTheme.paint!.sky))).toBe(SNAPSHOT.sky);
    expect(JSON.parse(SNAPSHOT.sky).f).toBe(buildSkyFragment(PLAZA_SKY_PRESET));
  });

  it('the paint-fx skyline and shaft programs are byte-identical (default and plaza spec)', () => {
    expect(programSignature(createPaintFxMaterial('skyline'))).toBe(SNAPSHOT.skyline);
    expect(programSignature(createPaintFxMaterial('skyline', { spec: plazaTheme.paint!.skyline }))).toBe(SNAPSHOT.skyline);
    expect(programSignature(createPaintFxMaterial('shaft'))).toBe(SNAPSHOT.shaftFx);
  });

  it('the skyline uniforms and ring geometry are unchanged', () => {
    const material = createPaintFxMaterial('skyline', { spec: PLAZA_SKYLINE_SPEC });
    expect((material.uniforms.uAtlasTexel.value as THREE.Vector2).toArray()).toEqual(ulpSafe(SNAPSHOT.skylineUniforms.atlasTexel));
    expect((material.uniforms.uInk.value as THREE.Color[]).map((c) => c.toArray())).toEqual(ulpSafe(SNAPSHOT.skylineUniforms.inkDay));
    expect((material.uniforms.uLayerMix.value as THREE.Vector3).toArray()).toEqual(ulpSafe(SNAPSHOT.skylineUniforms.mixDay));
    expect((material.uniforms.uRimWarm.value as THREE.Color).toArray()).toEqual(ulpSafe(SNAPSHOT.skylineUniforms.rim));
    for (const geometry of [createSkylineGeometry(), createSkylineGeometry(PLAZA_SKYLINE_SPEC)]) {
      const pos = geometry.getAttribute('position').array as Float32Array;
      let sum = 0;
      for (let i = 0; i < pos.length; i += 1) sum += pos[i] * ((i % 7) + 1);
      expect(pos.length / 3).toBe(SNAPSHOT.skylineGeometry.vertices);
      expectSumClose(sum, SNAPSHOT.skylineGeometry.weightedSum);
    }
    expect(plain(SKYLINE_BANDS)).toEqual(SNAPSHOT.skylineGeometry.bands);
    // The spec's own bands are the shipped bands (the generic path builds the same ring).
    expect(plain(skylineBandsFor(PLAZA_SKYLINE_SPEC))).toEqual(SNAPSHOT.skylineGeometry.bands);
  });

  it('the rules shafts, lamp halos, contact blobs and the SkyBody halo are byte-identical', () => {
    expect(SHAFT_VERTEX).toBe(SNAPSHOT.sunShafts.vertex);
    expect(SHAFT_FRAGMENT).toBe(SNAPSHOT.sunShafts.fragment);
    expect(LAMP_HALO_PROGRAM_KEY).toBe(SNAPSHOT.halo.key);
    expect(HALO_VERTEX).toBe(SNAPSHOT.halo.vertex);
    expect(HALO_FRAGMENT).toBe(SNAPSHOT.halo.fragment);
    expect(BLOB_VERTEX).toBe(SNAPSHOT.contactBlobs.vertex);
    expect(BLOB_FRAGMENT).toBe(SNAPSHOT.contactBlobs.fragment);
    const lighting = 'src/components/world/evoliga/route/env/Lighting.tsx';
    expect(literal(lighting, 'HALO_VERTEX')).toBe(SNAPSHOT.skyBody.vertex);
    expect(literal(lighting, 'HALO_FRAGMENT')).toBe(SNAPSHOT.skyBody.fragment);
  });

  it('the painted canopy chunk, key and patched sources are byte-identical', () => {
    expect(CANOPY_PROGRAM_KEY).toBe(SNAPSHOT.canopy.key);
    expect(CANOPY_SSS_GLSL).toBe(SNAPSHOT.canopy.sss);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchCanopyShader(shader, { value: 0 });
    expect(shader.vertexShader).toBe(SNAPSHOT.canopy.vertex);
    expect(shader.fragmentShader).toBe(SNAPSHOT.canopy.fragment);
    const linden = { ...shader, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    patchCanopyShader(linden, { value: 0 }, 'linden-gold');
    expect(linden.fragmentShader).toBe(SNAPSHOT.canopy.fragment);
  });

  it('the painted light chunks, fog and patched fragment are byte-identical', () => {
    expect(PAINT_PROGRAM_KEY).toBe(SNAPSHOT.painted.key);
    expect(paintedChunks().lights).toBe(SNAPSHOT.painted.lights);
    expect(paintedChunks().fog).toBe(SNAPSHOT.painted.fog);
    expect(PAINT_PARS_GLSL).toBe(SNAPSHOT.painted.pars);
    expect(PAINT_IBL_GLSL).toBe(SNAPSHOT.painted.ibl);
    expect(PAINT_CEIL_GLSL).toBe(SNAPSHOT.painted.ceil);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    patchPaintedShader(shader, { value: new THREE.Vector4() });
    expect(shader.fragmentShader).toBe(SNAPSHOT.painted.fragment);
    expect(CALM_GLSL).toBe(SNAPSHOT.calmGlsl);
  });

  it('the ashlar program (after the calm-box move) is byte-identical', () => {
    expect(ASHLAR_PROGRAM_KEY).toBe(SNAPSHOT.ashlar.key);
    expect(ASHLAR_PARS_GLSL).toBe(SNAPSHOT.ashlar.pars);
    expect(ASHLAR_MAP_GLSL).toBe(SNAPSHOT.ashlar.map);
    expect(ASHLAR_ROUGHNESS_GLSL).toBe(SNAPSHOT.ashlar.roughness);
    expect(ASHLAR_NORMAL_GLSL).toBe(SNAPSHOT.ashlar.normal);
    expect(ASHLAR_CALM_FEATHER_M).toBe(SNAPSHOT.ashlar.feather);
  });
});

describe('PLATFORM static identity: plazaTheme.paint deep-equals the pre-refactor constants', () => {
  const v = SNAPSHOT.values;

  it('the light sets and shadow rig are the r6 values', () => {
    expect(plain(PLAZA_PAINT)).toEqual(v.plazaPaint);
    const paint = plazaTheme.paint!;
    expect(plain({ day: paint.day, night: paint.night, shadow: paint.shadow })).toEqual(v.plazaPaint);
  });

  it('the plaza opts into every skin flag', () => {
    expect(plazaTheme.paint!.features).toEqual({
      sweep: true,
      calmRects: true,
      contactBlobs: true,
      stationShadow: true,
      paintedSky: true,
      skyline: true,
      lampHalos: true,
      sunShafts: true,
      paintedCanopy: true,
    });
  });

  it('the sky preset is today’s literals, and the aliases still read them', () => {
    const sky = plazaTheme.paint!.sky!;
    expect(plain(sky.day)).toEqual(v.paintedSkyDay);
    expect(plain(PAINTED_SKY_DAY)).toEqual(v.paintedSkyDay);
    expect(plain(sky.shape.coverBias)).toEqual(v.skyCoverBias);
    expect(sky.shape.haze).toBe(v.skyDayHaze);
    expect(sky.shape.midElevation).toBe(v.skyMidElevation);
    expect(sky.shape.calmCloudContrast).toBe(v.calmCloudContrast);
    expect(plain(sky.shape.lumaCap)).toEqual(v.skyDayLumaCap);
    expect(plain(sky.shape.rays)).toEqual(v.skyRays);
    expect(plain(sky.shape.shadowRay)).toEqual(v.skyShadowRay);
    expect(plain(sky.shape.contreJourCloud)).toEqual(v.skyContreJourCloud);
    expect(plain(sky.grade)).toEqual(v.skyGrade);
    expect(sky.night).toEqual({ variant: 'plaza' });
    expect(sky.shape.coverLo).toBe(0.44);
    expect(sky.shape.coverHi).toBe(0.6);
    expect(sky.shape.cirrus.opacity).toBe(0.18);
    // The exports of record are aliases of the preset's values.
    expect(plain([SKY_COVER_BIAS, SKY_DAY_HAZE, SKY_MID_ELEVATION, CALM_CLOUD_CONTRAST, SKY_DAY_LUMA_CAP, SKY_RAYS, SKY_SHADOW_RAY, SKY_CONTRE_JOUR_CLOUD, SKY_GRADE])).toEqual(
      [v.skyCoverBias, v.skyDayHaze, v.skyMidElevation, v.calmCloudContrast, v.skyDayLumaCap, v.skyRays, v.skyShadowRay, v.skyContreJourCloud, v.skyGrade],
    );
  });

  it('the skyline spec is today’s atlas, radii, mixes, inks, rim and seams', () => {
    const spec = plazaTheme.paint!.skyline!;
    expect(spec).toBe(PLAZA_SKYLINE_SPEC);
    expect(plain(PLAZA_SKYLINE_ATLAS)).toEqual(v.skylineAtlas);
    expect(spec.file).toBe('env/plaza/skyline.webp');
    expect(spec.atlas).toEqual({ width: 2048, height: 512 });
    expect(spec.radii).toEqual([70, 100, 140]);
    expect(spec.topElevationDeg).toEqual([16, 16, 16]);
    expect(spec.windows).toBe(true);
  });

  it('the canopy look, rig tuning and vignette are today’s constants', () => {
    const paint = plazaTheme.paint!;
    expect(plain(LEAF_SSS_LEVELS)).toEqual(v.leafSssLevels);
    expect(LEAF_LAMP_COLOR).toBe(v.leafLampColor);
    expect(plain(LEAF_GOLD)).toEqual(v.leafGold);
    expect(plain(PLAZA_LEAF_LOOK)).toEqual(v.plazaLeafLook);
    expect(NIGHT_CANOPY_TINT).toBe(v.nightCanopyTint);
    expect(paint.canopy!.sss).toEqual(v.leafSssLevels);
    expect({ day: { sil: paint.canopy!.sil.day, lamp: paint.canopy!.lamp.day }, night: { sil: paint.canopy!.sil.night, lamp: paint.canopy!.lamp.night } }).toEqual(
      v.plazaLeafLook,
    );
    expect(paint.canopy!.silStations).toBeUndefined();
    expect(plain(paint.rig)).toEqual({
      contreJour: v.contreJour,
      postOff: { keyNeutral: v.postOffKeyNeutral, shadeShift: v.postOffShadeShift, saturation: v.postOffSaturation },
    });
    expect(plain([POST_OFF_KEY_NEUTRAL, POST_OFF_SHADE_SHIFT, POST_OFF_SATURATION, CONTRE_JOUR])).toEqual([
      v.postOffKeyNeutral,
      v.postOffShadeShift,
      v.postOffSaturation,
      v.contreJour,
    ]);
    expect([SCENE_KEY_INTENSITY, SCENE_FILL_INTENSITY, SCENE_FILL_KEY_GAIN]).toEqual(v.sceneKey);
    expect(paint.vignette).toBe(v.vignette);
    expect(vignetteDarknessFor(plazaTheme)).toBe(v.vignette);
  });

  it('the lamp halo law and the plaza’s culled halos are unchanged', () => {
    expect(plain(LAMP_HALO)).toEqual(v.lampHalo);
    expect(plain(plazaLampHalos())).toEqual(v.plazaLampHalos);
  });
});

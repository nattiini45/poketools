import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  acquirePaintScope,
  ANCHORS,
  applyPaintedLight,
  buildPaintedFogChunk,
  buildPaintedLightsChunk,
  extractDirectionalShadowStatement,
  isPainted,
  PAINT_IBL_GLSL,
  PAINT_PARS_GLSL,
  PAINT_PROGRAM_KEY,
  PAINT_SAT_GLSL,
  paintedLightAmount,
  paintScopeLeaks,
  resetPaintScopeForTest,
} from '../painted-light';
import { applyPaintSet, PAINT_UNIFORMS, resetPaintRolesForTest } from '../paint-uniforms';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** A minimal stand-in for the parameters three hands `onBeforeCompile`. */
function fakeShader(): Shader {
  return {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    uniforms: {},
  } as unknown as Shader;
}

function compile(material: THREE.Material): Shader {
  const shader = fakeShader();
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

let release: () => void = () => {};

beforeEach(() => {
  resetPaintScopeForTest();
  resetPaintRolesForTest();
  release = acquirePaintScope('plaza');
});

afterEach(() => {
  release();
  resetPaintScopeForTest();
});

describe('painted lights chunk', () => {
  const stock = THREE.ShaderChunk.lights_fragment_begin;
  const patched = buildPaintedLightsChunk(stock);

  it('leaves every byte outside the directional block stock (D42 N6: no dead warm-practical line)', () => {
    const start = stock.indexOf(ANCHORS.dirBlockStart);
    const end = stock.indexOf(ANCHORS.dirBlockEnd);
    expect(patched.startsWith(stock.slice(0, start))).toBe(true);
    expect(patched).not.toContain('paintPointTint( pointLight.color )');
    expect(patched.endsWith(stock.slice(end))).toBe(true);
  });

  it('the N6 dev mock tints after every point-light lookup and changes nothing else', () => {
    const start = stock.indexOf(ANCHORS.dirBlockStart);
    const end = stock.indexOf(ANCHORS.dirBlockEnd);
    const tinted = buildPaintedLightsChunk(stock, { pointTint: true });
    const warmLine = `${ANCHORS.pointInfo}
		directLight.color *= paintPointTint( pointLight.color );`;
    expect(tinted.startsWith(stock.slice(0, start).replaceAll(ANCHORS.pointInfo, warmLine))).toBe(true);
    expect(tinted.split('paintPointTint( pointLight.color )').length - 1).toBe(stock.split(ANCHORS.pointInfo).length - 1);
    expect(tinted.endsWith(stock.slice(end))).toBe(true);
  });

  it('captures the stock getShadow expression byte-for-byte into paintShadow', () => {
    const statement = extractDirectionalShadowStatement(stock.slice(stock.indexOf(ANCHORS.dirBlockStart)));
    const expression = statement.slice('directLight.color *='.length);
    expect(patched).toContain(`paintShadow =${expression}`);
    expect(patched).not.toContain(statement);
  });

  it('declares paintShadow once outside the unrolled loop and resets it per light', () => {
    expect(patched.split('float paintShadow;')).toHaveLength(2);
    const decl = patched.indexOf('float paintShadow;');
    const loop = patched.indexOf('#pragma unroll_loop_start', patched.indexOf(ANCHORS.dirBlockStart));
    expect(decl).toBeLessThan(loop);
    expect(patched).toContain(`${ANCHORS.dirInfo}\n\t\tpaintShadow = 1.0;`);
  });

  it('calls RE_Direct_Paint in the directional block and keeps the stock call for point and spot lights', () => {
    const dir = patched.slice(patched.indexOf(ANCHORS.dirBlockStart), patched.indexOf(ANCHORS.dirBlockEnd));
    expect(dir).toContain('RE_Direct_Paint( directLight, paintShadow,');
    expect(dir).not.toContain(ANCHORS.reDirectCall);
    const stockCalls = stock.split(ANCHORS.reDirectCall).length - 1;
    expect(patched.split(ANCHORS.reDirectCall).length - 1).toBe(stockCalls - 1);
  });

  it('the fog chunk keeps the stock fog lines and appends the air inside USE_FOG', () => {
    const fog = buildPaintedFogChunk();
    const stockFog = THREE.ShaderChunk.fog_fragment.trimEnd();
    expect(fog.startsWith(stockFog.slice(0, -ANCHORS.fogEnd.length))).toBe(true);
    expect(fog.indexOf('paintAir')).toBeGreaterThan(fog.indexOf('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );'));
    // LOOK r2: the air closes inside USE_FOG; the painted chroma follows it,
    // outside the fog branch, as the chunk's last statement.
    const closing = fog.lastIndexOf('#endif');
    expect(fog.indexOf('paintAir')).toBeLessThan(closing);
    expect(fog.trimEnd().endsWith(PAINT_SAT_GLSL.trim())).toBe(true);
    expect(fog.indexOf('uPaintSat')).toBeGreaterThan(closing);
  });

  it('tints the image-based irradiance with the shared IBL hue before three resolves it', () => {
    expect(PAINT_IBL_GLSL).toContain('iblIrradiance *= uIblTint;');
    expect(PAINT_PARS_GLSL).toContain('uniform vec3 uIblTint;');
    expect(PAINT_PARS_GLSL).toContain('uniform float uPaintSat;');
    expect(THREE.ShaderLib.physical.fragmentShader).toContain(ANCHORS.lightsEndInclude);
  });
});

describe('RE_Direct_Paint', () => {
  it('k = 0 reduces to the stock directional term (shadowed light into the stock RE_Direct, stock diffuse added)', () => {
    // Stock: `directLight.color *= shadow; RE_Direct( directLight, … )`.
    // Paint: `physLight = directLight; physLight.color *= sh; RE_Direct( physLight, … )` and at k ≤ 0
    // only phys.directDiffuse / phys.directSpecular are accumulated — string identity of the term.
    // LOOK r3: the painted key is the scene key × uKeyScale (the scene keeps the shipped light).
    expect(PAINT_PARS_GLSL).toContain('IncidentLight keyLight = directLight;\n\tkeyLight.color *= uKeyScale;');
    expect(PAINT_PARS_GLSL).toContain('IncidentLight physLight = keyLight;\n\tphysLight.color *= sh;');
    expect(PAINT_PARS_GLSL).toContain(
      'RE_Direct( physLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, phys );',
    );
    expect(PAINT_PARS_GLSL).toContain('reflectedLight.directSpecular += phys.directSpecular;');
    expect(PAINT_PARS_GLSL).toMatch(
      /if \( k <= 0\.0 \) \{\s*reflectedLight\.directDiffuse \+= phys\.directDiffuse;\s*return;\s*\}/,
    );
  });

  it('keeps specular physical at every k (GGX × saturate(N·L) × shadow)', () => {
    expect(PAINT_PARS_GLSL.match(/directSpecular \+=/g)).toHaveLength(1);
  });

  it('clamps the rim at 0.9 linear', () => {
    expect(PAINT_PARS_GLSL).toContain('vec3( 0.9 )');
  });

  it('light amount: identity at full lambert, shadow multiplies, band is monotonic', () => {
    const band = PLAZA_PAINT.day.band;
    expect(paintedLightAmount(1, 1, band, 0.55)).toBeCloseTo(1, 6);
    expect(paintedLightAmount(1, 0.25, band, 0.55)).toBeCloseTo(0.25, 6);
    let previous = -1;
    for (let ndl = -1; ndl <= 1; ndl += 0.05) {
      const amount = paintedLightAmount(ndl, 1, band, 0.55);
      expect(amount).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = amount;
    }
    // Wrap: a surface just past the terminator still gets some light.
    expect(paintedLightAmount(-0.1, 1, band, 0)).toBeGreaterThan(0);
  });
});

describe('applyPaintedLight', () => {
  it('patches the fragment and binds the shared uniforms by reference', () => {
    const material = new THREE.MeshStandardMaterial();
    applyPaintedLight(material, 'plaza');
    const shader = compile(material);
    expect(shader.fragmentShader).toContain('RE_Direct_Paint( directLight, paintShadow,');
    expect(shader.fragmentShader).toContain('void RE_Direct_Paint(');
    expect(shader.fragmentShader).not.toContain(ANCHORS.lightsBeginInclude);
    expect(shader.fragmentShader).not.toContain(ANCHORS.fogInclude);
    expect(shader.fragmentShader.indexOf('uniform vec3 uPaintRole;')).toBeLessThan(
      shader.fragmentShader.indexOf('RE_Direct_Paint( directLight'),
    );
    expect(shader.uniforms.uShadowFill).toBe(PAINT_UNIFORMS.uShadowFill);
    expect(shader.uniforms.uAir).toBe(PAINT_UNIFORMS.uAir);
    expect(shader.uniforms.uPaintRole).toBeDefined();
    expect(material.userData.paintScope).toBe('plaza');
  });

  it('a role change never changes the program key (env, figure and frame share one program)', () => {
    applyPaintSet(PLAZA_PAINT.day, plazaTheme.lights.keyDirection);
    const keys = ['env', 'figure', 'frame', undefined].map((role) => {
      const material = new THREE.MeshStandardMaterial();
      if (role) material.userData.paintRole = role;
      applyPaintedLight(material, 'plaza');
      return { key: material.customProgramCacheKey(), role: compile(material).uniforms.uPaintRole.value.clone() };
    });
    expect(new Set(keys.map((k) => k.key)).size).toBe(1);
    expect(keys[0].key.endsWith(`|${PAINT_PROGRAM_KEY}`)).toBe(true);
    expect(keys[1].role.y).toBeCloseTo(PLAZA_PAINT.day.roles.figure.rimScale, 6);
    expect(keys[2].role.y).toBe(0);
    expect(keys[3].role.toArray()).toEqual(keys[0].role.toArray());
  });

  it('is idempotent: a second call adds no second suffix and keeps the same hook', () => {
    const material = new THREE.MeshStandardMaterial();
    applyPaintedLight(material, 'plaza');
    const hook = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    applyPaintedLight(material, 'plaza');
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(key.split(PAINT_PROGRAM_KEY)).toHaveLength(2);
  });

  it('keys a default-key material by its ORIGINAL hook source plus the paint suffix', () => {
    const material = new THREE.MeshStandardMaterial();
    const original = material.customProgramCacheKey();
    applyPaintedLight(material, 'plaza');
    expect(material.customProgramCacheKey()).toBe(`${original}|${PAINT_PROGRAM_KEY}`);
  });

  it('chains an existing hook and key (tree wind / standby style)', () => {
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `// wind\n${shader.vertexShader}`;
      shader.uniforms.uTime = { value: 0 };
    };
    material.customProgramCacheKey = () => 'route-standby-v1';
    applyPaintedLight(material, 'plaza');
    const shader = compile(material);
    expect(shader.vertexShader.startsWith('// wind')).toBe(true);
    expect(shader.uniforms.uTime).toBeDefined();
    expect(shader.fragmentShader).toContain('RE_Direct_Paint(');
    expect(material.customProgramCacheKey()).toBe(`route-standby-v1|${PAINT_PROGRAM_KEY}`);
  });

  it('re-chains when another hook replaced the painted one, without doubling the suffix', () => {
    const material = new THREE.MeshStandardMaterial();
    applyPaintedLight(material, 'plaza');
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `// late\n${shader.vertexShader}`;
    };
    expect(isPainted(material)).toBe(false);
    applyPaintedLight(material, 'plaza');
    expect(isPainted(material)).toBe(true);
    const shader = compile(material);
    expect(shader.vertexShader.startsWith('// late')).toBe(true);
    expect(material.customProgramCacheKey().split(PAINT_PROGRAM_KEY)).toHaveLength(2);
  });

  it('outside a paint scope a painted material compiles its ORIGINAL program (no cross-world leak)', () => {
    const material = new THREE.MeshStandardMaterial();
    const original = material.customProgramCacheKey();
    applyPaintedLight(material, 'plaza');
    release();
    expect(material.customProgramCacheKey()).toBe(original);
    const before = paintScopeLeaks();
    const shader = compile(material);
    expect(shader.fragmentShader).toBe(THREE.ShaderLib.physical.fragmentShader);
    expect(paintScopeLeaks()).toBe(before + 1);
  });
});

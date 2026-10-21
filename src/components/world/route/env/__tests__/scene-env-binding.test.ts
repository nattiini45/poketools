import v8 from 'node:v8';
import vm from 'node:vm';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
// @ts-expect-error -- three ships no declaration for this internal module (typed below).
import { WebGLMaterials as WebGLMaterialsUntyped } from 'three/src/renderers/webgl/WebGLMaterials.js';
import { ShaderLib } from 'three/src/renderers/shaders/ShaderLib.js';
import { UniformsUtils } from 'three/src/renderers/shaders/UniformsUtils.js';
import { bindSceneEnvironment, isEnvBindable, isEnvBound } from '../scene-env-binding';

/**
 * D42 N9 (owner D47): the data screens' `envMapIntensity={0}` and the figure
 * METAL_CLAMP reach the shader under three r185, with +0 programs and no
 * stale envMap across environment swaps. Driven through three's OWN program
 * selection (`WebGLPrograms.getParameters` / `getProgramCacheKey`) and
 * uniform refresh (`WebGLMaterials.refreshMaterialUniforms`) with a fake GL
 * side; the renderer's per-draw override (`WebGLRenderer.js` setProgram:
 * `material.envMap === null && scene.environment !== null` →
 * `envMapIntensity = scene.environmentIntensity`) is reproduced verbatim.
 */

/** An equirect HDRI stand-in (what drei's <Environment> sets). */
function hdri(name: string): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = name;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** three's WebGLEnvironments stand-in: one PMREM (cube-UV) target per source, sized per source. */
function fakeEnvironments(heights: Map<THREE.Texture, number>) {
  const pmrem = new Map<THREE.Texture, THREE.Texture>();
  const gets: (THREE.Texture | null)[] = [];
  return {
    gets,
    get(texture: THREE.Texture | null) {
      gets.push(texture);
      if (!texture) return null;
      let target = pmrem.get(texture);
      if (!target) {
        target = new THREE.Texture();
        target.mapping = THREE.CubeUVReflectionMapping;
        (target as unknown as { image: { height: number } }).image = { height: heights.get(texture) ?? 256 };
        pmrem.set(texture, target);
      }
      return target;
    },
  };
}

const lights = new Proxy(
  {},
  { get: (_t, key) => (typeof key === 'string' && key.startsWith('num') ? 0 : []) },
);

/** three's uniform refresher (r185 `WebGLMaterials(renderer, properties)`). */
const WebGLMaterials = WebGLMaterialsUntyped as new (
  renderer: unknown,
  properties: unknown,
) => { refreshMaterialUniforms(uniforms: unknown, material: THREE.Material, pixelRatio: number, height: number, transmissionRenderTarget: unknown): void };

function programsFor(environments: ReturnType<typeof fakeEnvironments>) {
  const renderer = {
    getRenderTarget: () => null,
    state: { buffers: { depth: { getReversed: () => false } } },
    toneMapping: THREE.NoToneMapping,
    outputColorSpace: THREE.SRGBColorSpace,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    localClippingEnabled: false,
  };
  const capabilities = { logarithmicDepthBuffer: false, precision: 'highp', getMaxPrecision: (p: string) => p };
  const extensions = { has: () => false };
  const clipping = { numPlanes: 0, numIntersection: 0 };
  return new WebGLPrograms(renderer as never, environments as never, extensions as never, capabilities as never, {} as never, clipping as never);
}

/** The program cache key three would select for `material` drawn in `scene`. */
function programKey(programs: ReturnType<typeof programsFor>, material: THREE.Material, scene: THREE.Scene, mesh: THREE.Mesh): string {
  const parameters = (programs.getParameters as (...args: unknown[]) => ReturnType<typeof programs.getParameters>)(material, lights, [], scene, mesh, []);
  return programs.getProgramCacheKey(parameters);
}

/** The envMapIntensity uniform three uploads for `material` after one draw (refresh + the setProgram override). */
function drawnIntensity(material: THREE.MeshStandardMaterial, scene: THREE.Scene, environments: ReturnType<typeof fakeEnvironments>): number | null {
  const uniforms = UniformsUtils.clone(ShaderLib.physical.uniforms) as Record<string, THREE.IUniform>;
  // getProgram: materialProperties.envMap / envMapRotation, exactly as WebGLRenderer computes them.
  const envMap = environments.get(material.envMap || scene.environment);
  const props = {
    envMap,
    envMapRotation: scene.environment !== null && material.envMap === null ? scene.environmentRotation : material.envMapRotation,
  };
  const materials = new WebGLMaterials({} as never, { get: () => props } as never);
  materials.refreshMaterialUniforms(uniforms as never, material, 1, 1, null as never);
  // WebGLRenderer.js setProgram (r185 :2694-2698), verbatim.
  if (material.isMeshStandardMaterial && material.envMap === null && scene.environment !== null) {
    uniforms.envMapIntensity.value = scene.environmentIntensity;
  }
  if (!envMap) return null;
  return uniforms.envMapIntensity.value as number;
}

/** New-space bytes a loop adds per iteration, with no GC inside the window (figure-director.test.ts's instrument). */
async function bytesPer(run: (n: number) => void, n: number): Promise<number> {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const used = () => v8.getHeapSpaceStatistics().find((entry) => entry.space_name === 'new_space')!.space_used_size;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const gcs: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) gcs.push(entry.startTime);
    });
    observer.observe({ entryTypes: ['gc'] });
    gc();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const t0 = performance.now();
    const before = used();
    run(n);
    const after = used();
    const t1 = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    observer.disconnect();
    if (!gcs.some((at) => at >= t0 && at <= t1)) return (after - before) / n;
  }
  throw new Error('a GC landed inside every measurement window');
}

function dataScreen(): THREE.MeshStandardMaterial {
  // The nine sites' recipe: black base, dead specular, self-lit face.
  return new THREE.MeshStandardMaterial({ color: '#000000', roughness: 1, metalness: 0, envMapIntensity: 0, emissive: '#ffffff' });
}

function sceneWith(environment: THREE.Texture | null, intensity: number, yaw = 0): THREE.Scene {
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = intensity;
  scene.environmentRotation.set(0, yaw, 0);
  return scene;
}

describe('the r185 defect (control: why N9 exists)', () => {
  it('an UNBOUND data screen draws at the scene intensity, whatever its own envMapIntensity', () => {
    const day = hdri('day');
    const environments = fakeEnvironments(new Map());
    const scene = sceneWith(day, 0.85);
    expect(drawnIntensity(dataScreen(), scene, environments)).toBe(0.85);
  });
});

describe('bindSceneEnvironment (D42 N9)', () => {
  it('a bound data screen draws with envMapIntensity 0; the program key is the unbound twin\'s (+0 programs)', () => {
    const day = hdri('day');
    const environments = fakeEnvironments(new Map());
    const programs = programsFor(environments);
    const scene = sceneWith(day, 0.85, 1.2);
    const bound = dataScreen();
    const twin = dataScreen();
    const geometry = new THREE.PlaneGeometry();
    const release = bindSceneEnvironment(bound, scene);
    expect(isEnvBound(bound)).toBe(true);
    expect(bound.envMap).toBe(day);
    expect(drawnIntensity(bound, scene, environments)).toBe(0);
    expect(programKey(programs, bound, scene, new THREE.Mesh(geometry, bound))).toBe(programKey(programs, twin, scene, new THREE.Mesh(geometry, twin)));
    // The rotation three uses is the scene's own Euler (live), as for an unbound material.
    expect(bound.envMapRotation).toBe(scene.environmentRotation);
    release();
  });

  it('follows every environment swap at once, the null gap included: never a stale envMap, never a new program', () => {
    const day = hdri('day');
    const night = hdri('night');
    const odd = hdri('odd-size');
    const environments = fakeEnvironments(new Map([[odd, 512]]));
    const programs = programsFor(environments);
    const scene = sceneWith(day, 0.85);
    const bound = dataScreen();
    const twin = dataScreen();
    const geometry = new THREE.PlaneGeometry();
    const boundMesh = new THREE.Mesh(geometry, bound);
    const twinMesh = new THREE.Mesh(geometry, twin);
    const release = bindSceneEnvironment(bound, scene);
    const steps: [THREE.Texture | null, number][] = [
      [day, 0.85],
      [null, 0.85], // drei clears the environment while the next HDRI loads
      [night, 0.6],
      [odd, 0.6], // a differently sized prefilter: a different key, the SAME as the twin's
      [day, 0.72],
    ];
    const keys: string[] = [];
    for (const [environment, intensity] of steps) {
      scene.environment = environment;
      scene.environmentIntensity = intensity;
      expect(bound.envMap).toBe(environment);
      const key = programKey(programs, bound, scene, boundMesh);
      keys.push(key);
      expect(key).toBe(programKey(programs, twin, scene, twinMesh));
      expect(drawnIntensity(bound, scene, environments)).toBe(environment === null ? null : 0);
    }
    // The key does see the environment (the comparison is not vacuous): env-less and 512 differ from 256.
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
    expect(keys[4]).toBe(keys[0]);
    // three resolved exactly the scene's textures: the bound material never asked for a retired HDRI.
    const asked = new Set(environments.gets.filter((t) => t !== null));
    expect([...asked].sort((a, b) => a.name.localeCompare(b.name))).toEqual([day, night, odd].sort((a, b) => a.name.localeCompare(b.name)));
    release();
  });

  it('the figure METAL_CLAMP: a clamped metal draws at its clamped intensity whatever the world IBL level', () => {
    const day = hdri('day');
    const environments = fakeEnvironments(new Map());
    const scene = sceneWith(day, 0.85);
    const metal = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.28 });
    metal.envMapIntensity = 0.55; // clampFigureMetal's write
    const release = bindSceneEnvironment(metal, scene);
    expect(drawnIntensity(metal, scene, environments)).toBe(0.55);
    scene.environmentIntensity = 0.6;
    expect(drawnIntensity(metal, scene, environments)).toBe(0.55);
    // A later write (R3F's prop, the clamp) is the material's own plain value.
    metal.envMapIntensity = 0.3;
    expect(drawnIntensity(metal, scene, environments)).toBe(0.3);
    release();
    expect(metal.envMapIntensity).toBe(0.3);
  });

  it('follows a replaced rotation object too (an assignment, not only the in-place drei update)', () => {
    const scene = sceneWith(hdri('day'), 0.85, 0.4);
    const bound = dataScreen();
    const release = bindSceneEnvironment(bound, scene);
    scene.environmentRotation.set(0, 1.1, 0); // drei / R3F applyProps: in place
    expect(bound.envMapRotation.y).toBe(1.1);
    const replaced = new THREE.Euler(0, 2.2, 0);
    scene.environmentRotation = replaced;
    expect(bound.envMapRotation).toBe(replaced);
    release();
    expect(bound.envMapRotation).not.toBe(replaced);
    expect(bound.envMapRotation.y).toBe(0);
  });

  it("is invisible to the warm's Object.values texture scan (no raw HDRI upload) and to Object.keys", () => {
    const day = hdri('day');
    const scene = sceneWith(day, 0.85);
    const bound = dataScreen();
    const release = bindSceneEnvironment(bound, scene);
    expect(bound.envMap).toBe(day);
    expect(Object.values(bound)).not.toContain(day);
    expect(Object.keys(bound)).not.toContain('envMap');
    release();
    expect(Object.keys(bound)).toContain('envMap');
  });

  it("keeps the bound material a fast-mode object (three's hot paths keep their inline caches)", () => {
    v8.setFlagsFromString('--allow-natives-syntax');
    // V8 natives syntax (%HasFastProperties) is only reachable through a runtime-compiled function; test-only.
    // eslint-disable-next-line no-new-func
    const fast = new Function('o', 'return %HasFastProperties(o)') as (o: object) => boolean;
    const scene = sceneWith(hdri('day'), 0.85);
    const bound = dataScreen();
    expect(fast(bound)).toBe(true);
    const release = bindSceneEnvironment(bound, scene);
    scene.environment = hdri('night');
    expect(fast(bound)).toBe(true);
    release();
    expect(fast(bound)).toBe(true);
  });

  it('refcounts shared materials; the last release restores the own envMap and rotation', () => {
    const day = hdri('day');
    const night = hdri('night');
    const scene = sceneWith(day, 0.85, 0.5);
    const metal = new THREE.MeshStandardMaterial({ metalness: 1 });
    metal.envMapIntensity = 0.55;
    const ownRotation = metal.envMapRotation;
    const a = bindSceneEnvironment(metal, scene);
    const b = bindSceneEnvironment(metal, scene);
    a();
    a(); // a second call of one release is a no-op
    expect(isEnvBound(metal)).toBe(true);
    expect(metal.envMap).toBe(day);
    b();
    expect(isEnvBound(metal)).toBe(false);
    expect(metal.envMap).toBeNull();
    expect(metal.envMapIntensity).toBe(0.55);
    expect(metal.envMapRotation).toBe(ownRotation);
    expect(metal.envMapRotation.y).toBe(0);
    expect(metal.clone).toBe(THREE.MeshStandardMaterial.prototype.clone);
    // Released: a swap no longer reaches it.
    scene.environment = night;
    expect(metal.envMap).toBeNull();
    // And it binds again (a StrictMode remount), to the current environment.
    const c = bindSceneEnvironment(metal, scene);
    expect(metal.envMap).toBe(night);
    c();
  });

  it('a clone of a bound material is bound (never a snapshot of the environment), released when disposed', () => {
    const day = hdri('day');
    const night = hdri('night');
    const scene = sceneWith(day, 0.4);
    const metal = new THREE.MeshStandardMaterial({ metalness: 1, transparent: true, side: THREE.DoubleSide });
    metal.envMapIntensity = 0.55;
    const release = bindSceneEnvironment(metal, scene);
    const copy = metal.clone();
    expect(copy).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(isEnvBound(copy)).toBe(true);
    expect(copy.envMapRotation).toBe(scene.environmentRotation);
    scene.environment = night;
    expect(copy.envMap).toBe(night);
    expect(copy.envMapIntensity).toBe(0.55);
    expect(copy.transparent).toBe(true);
    copy.dispose();
    expect(isEnvBound(copy)).toBe(false);
    expect(copy.envMap).toBeNull();
    scene.environment = day;
    expect(copy.envMap).toBeNull();
    expect(metal.envMap).toBe(day);
    release();
  });

  it('leaves alone what it must not bind: an authored envMap, a non-standard material', () => {
    const scene = sceneWith(hdri('day'), 0.85);
    const authored = new THREE.MeshStandardMaterial();
    const own = new THREE.CubeTexture();
    authored.envMap = own;
    expect(isEnvBindable(authored)).toBe(false);
    bindSceneEnvironment(authored, scene)();
    expect(authored.envMap).toBe(own);
    const basic = new THREE.MeshBasicMaterial();
    expect(isEnvBindable(basic)).toBe(false);
    bindSceneEnvironment(basic, scene);
    expect(isEnvBound(basic)).toBe(false);
  });

  it('a steady-state frame allocates nothing: the reads three makes per refresh cost what an unbound twin costs', async () => {
    const bound = { scene: sceneWith(hdri('day'), 0.85), screen: dataScreen(), metal: new THREE.MeshStandardMaterial({ metalness: 1 }) };
    const plain = { scene: sceneWith(hdri('day'), 0.85), screen: dataScreen(), metal: new THREE.MeshStandardMaterial({ metalness: 1 }) };
    bound.metal.envMapIntensity = 0.55;
    plain.metal.envMapIntensity = 0.55;
    plain.screen.envMap = plain.scene.environment;
    plain.metal.envMap = plain.scene.environment;
    const releases = [bindSceneEnvironment(bound.screen, bound.scene), bindSceneEnvironment(bound.metal, bound.scene)];
    const sink = new Float64Array(1);
    // Two textually identical loops (each stays monomorphic on its own objects).
    const readBound = (n: number) => {
      const { scene, screen, metal } = bound;
      for (let i = 0; i < n; i += 1) {
        sink[0] += screen.envMapIntensity + metal.envMapIntensity + (screen.envMap === scene.environment ? 1 : 0) + metal.envMapRotation.y + scene.environmentRotation.y;
      }
    };
    const readPlain = (n: number) => {
      const { scene, screen, metal } = plain;
      for (let i = 0; i < n; i += 1) {
        sink[0] += screen.envMapIntensity + metal.envMapIntensity + (screen.envMap === scene.environment ? 1 : 0) + metal.envMapRotation.y + scene.environmentRotation.y;
      }
    };
    let best = Infinity;
    for (let round = 0; round < 6 && best > 4; round += 1) {
      readBound(200_000); // let the optimizer own the loops
      readPlain(200_000);
      best = Math.min(best, (await bytesPer(readBound, 100_000)) - (await bytesPer(readPlain, 100_000)));
    }
    // A boxed double or an object per read would add >= 12 B per iteration.
    expect(best).toBeLessThan(4);
    for (const release of releases) release();
  });
});

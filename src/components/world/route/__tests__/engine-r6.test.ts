import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  beginSceneGeneration,
  currentSceneGeneration,
  getScenePhase,
  resetSceneReadiness,
} from '../world-readiness';
import { planGenerationBegin, sceneGenerationKey } from '../WorldStateProvider';
import {
  emptyVertexPromotion,
  needsFloatVertexFormat,
  promoteSceneVertexFormats,
  promoteVertexFormats,
  toFloat32Attribute,
} from '../figures/vertex-formats';
import { BEAM_PRERASTER, beamPrerasterStep, beamPrerasterSteps, type BeamPart } from '@/lib/route-world/ball-loader-state';
import { compileWeight, createLoadWarmIO } from '../useStationWarmup';

vi.mock('@react-three/drei', () => {
  const useGLTF = Object.assign(
    vi.fn(() => ({ scene: {} })),
    { preload: vi.fn() },
  );
  return { useGLTF };
});

/**
 * ENGINE r6 contracts (plaza round 6, R6-BRIEF §3):
 * - E1: a dark load begins exactly ONE generation, keyed `:night`, from the
 *   DOM (it began `:day` from the palette state's fallback, then `:night` —
 *   every dark reveal was generation 2).
 * - E4: the GLB load path promotes D3D11-hostile vertex formats to Float32
 *   before anything compiles (no draw-time vertex executables).
 * - The R6 trace's attribution of the 317 ms post-ball stall: the beam
 *   layers' pre-raster, now staggered one small step at a time.
 * - E7: the warm's compile queue runs longest first.
 * - E10: whatever mounts at load — visible or not — is compiled by the warm,
 *   and content that mounts after the compile opened sends it back to compile.
 */

const SRC = join(process.cwd(), 'src');
const ROUTE = join(SRC, 'components', 'world', 'route');
const read = (file: string) => readFileSync(file, 'utf8');

describe('E1: the dark generation begins once, keyed from the DOM', () => {
  beforeEach(() => resetSceneReadiness());
  afterEach(() => resetSceneReadiness());

  it('plans a begin from the DOM side, a no-op for the key it already began, a reset off the route tier', () => {
    expect(planGenerationBegin({ tier: 'route', themeId: 'plaza', domNightKey: 'night', begunKey: null, phase: 'idle' })).toEqual({
      action: 'begin',
      key: 'plaza:night',
    });
    expect(
      planGenerationBegin({ tier: 'route', themeId: 'plaza', domNightKey: 'night', begunKey: 'plaza:night', phase: 'loading' }),
    ).toEqual({ action: 'none' });
    expect(
      planGenerationBegin({ tier: 'route', themeId: 'plaza', domNightKey: 'night', begunKey: 'plaza:night', phase: 'presented' }),
    ).toEqual({ action: 'none' });
    // StrictMode's unmount reset (idle) and a Lite round trip begin afresh.
    expect(
      planGenerationBegin({ tier: 'route', themeId: 'plaza', domNightKey: 'night', begunKey: 'plaza:night', phase: 'idle' }),
    ).toEqual({ action: 'begin', key: 'plaza:night' });
    expect(planGenerationBegin({ tier: 'lite', themeId: 'plaza', domNightKey: 'night', begunKey: null, phase: 'loading' })).toEqual({
      action: 'reset',
    });
    expect(planGenerationBegin({ tier: 'route', themeId: null, domNightKey: 'day', begunKey: null, phase: 'loading' })).toEqual({
      action: 'reset',
    });
  });

  it('a dark mount calls beginSceneGeneration exactly once, with :night (the provider’s effect order, real store)', () => {
    const calls: string[] = [];
    const begin = (key: string) => {
      calls.push(key);
      return beginSceneGeneration(key);
    };
    const start = currentSceneGeneration();
    // The provider as mounted with data-theme='dark': the palette STATE is the
    // day fallback until the layout read commits; the DOM already says night.
    let begunKey: string | null = null;
    const domNightKey = 'night' as const;
    // 1. Layout phase: the palette read. Nothing is loading yet (idle), so
    //    the observer begins nothing; it only sets the palette state.
    const observerKey = sceneGenerationKey('plaza', domNightKey);
    if (getScenePhase() !== 'idle' && observerKey !== begunKey) {
      begunKey = observerKey;
      begin(observerKey);
    }
    // 2. Passive phase: the (tier, theme, palette) effect, palette state still 'day'.
    let plan = planGenerationBegin({ tier: 'route', themeId: 'plaza', domNightKey, begunKey, phase: getScenePhase() });
    if (plan.action === 'begin') {
      begunKey = plan.key;
      begin(plan.key);
    }
    // 3. The palette state caught up ('day' -> 'night'): the effect re-runs.
    plan = planGenerationBegin({ tier: 'route', themeId: 'plaza', domNightKey, begunKey, phase: getScenePhase() });
    if (plan.action === 'begin') begin(plan.key);
    expect(calls).toEqual(['plaza:night']);
    expect(currentSceneGeneration()).toBe(start + 1);
    expect(getScenePhase()).toBe('loading');
  });

  it('the provider derives the begin key from the DOM and reads the palette in the layout phase', () => {
    const provider = read(join(ROUTE, 'WorldStateProvider.tsx'));
    const beginEffect = provider.match(/const begunKeyRef = useRef<string \| null>\(null\);[\s\S]*?\}, \[tier, themeId, nightKey, resolvedTheme\]\);/)?.[0] ?? '';
    expect(beginEffect).toMatch(/readWorldPalette\(rootRef\.current\)/);
    expect(beginEffect).toMatch(/planGenerationBegin\(/);
    expect(beginEffect).not.toMatch(/sceneGenerationKey\(themeId, nightKey\)/);
    // The palette observer is a layout effect and compares with the key actually begun.
    expect(provider).toMatch(/useLayoutEffect\(\(\) => \{\s*const read = \(\) => \{/);
    expect(provider).toMatch(/swapKey !== begunKeyRef\.current/);
  });
});

/** A binary glTF (JSON + BIN chunks): the loader reads the buffer without a fetch. */
function glb(json: object, bin: ArrayBuffer): ArrayBuffer {
  const pad = (n: number) => (n + 3) & ~3;
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad(text.length);
  const binLength = pad(bin.byteLength);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(text, 20);
  const binAt = 20 + jsonLength;
  view.setUint32(binAt, binLength, true);
  view.setUint32(binAt + 4, 0x004e4942, true); // 'BIN' + NUL
  bytes.set(new Uint8Array(bin), binAt + 8);
  return out;
}

describe('E4: D3D11-native vertex formats at GLB load', () => {
  it('flags 3-component 8/16-bit and non-normalized integer inputs only', () => {
    const normal = new THREE.BufferAttribute(new Int16Array(9), 3, true);
    const joints = new THREE.BufferAttribute(new Uint16Array(8), 4, false);
    const joints8 = new THREE.BufferAttribute(new Uint8Array(8), 4, false);
    const uv = new THREE.BufferAttribute(new Uint16Array(4), 2, true);
    const color = new THREE.BufferAttribute(new Uint8Array(8), 4, true);
    const position = new THREE.BufferAttribute(new Float32Array(9), 3);
    const intInput = new THREE.BufferAttribute(new Uint16Array(8), 4, false);
    intInput.gpuType = THREE.IntType;
    expect(needsFloatVertexFormat(normal)).toBe(true);
    expect(needsFloatVertexFormat(joints)).toBe(true);
    expect(needsFloatVertexFormat(joints8)).toBe(true);
    expect(needsFloatVertexFormat(uv)).toBe(false);
    expect(needsFloatVertexFormat(color)).toBe(false);
    expect(needsFloatVertexFormat(position)).toBe(false);
    expect(needsFloatVertexFormat(intInput)).toBe(false);
    expect(needsFloatVertexFormat(new THREE.Float16BufferAttribute(new Uint16Array(9), 3))).toBe(false);
  });

  it('decodes exactly what the GPU decoded (GL normalization, integers copied), interleaved storage included', () => {
    const normal = toFloat32Attribute(new THREE.BufferAttribute(new Int16Array([32767, -32768, 0, 16384, -1, 1]), 3, true));
    expect(normal.array).toBeInstanceOf(Float32Array);
    expect(normal.normalized).toBe(false);
    expect(Array.from(normal.array)).toEqual([1, -1, 0, 16384 / 32767, -1 / 32767, 1 / 32767].map(Math.fround));
    const joints = toFloat32Attribute(new THREE.BufferAttribute(new Uint16Array([0, 3, 255, 65535]), 4, false));
    expect(Array.from(joints.array)).toEqual([0, 3, 255, 65535]);
    const unsigned = toFloat32Attribute(new THREE.BufferAttribute(new Uint8Array([0, 255, 51]), 3, true));
    expect(Array.from(unsigned.array)).toEqual([0, 1, 0.2].map(Math.fround));
    // Interleaved: two vertices, stride 4 shorts (xyz + pad), normal at offset 0.
    const buffer = new THREE.InterleavedBuffer(new Int16Array([32767, 0, 0, 99, 0, -32767, 0, 99]), 4);
    const interleaved = new THREE.InterleavedBufferAttribute(buffer, 3, 0, true);
    expect(needsFloatVertexFormat(interleaved)).toBe(true);
    const out = toFloat32Attribute(interleaved);
    expect(out.count).toBe(2);
    expect(Array.from(out.array)).toEqual([1, 0, 0, 0, -1, 0]);
    for (let i = 0; i < out.count; i += 1) {
      for (let c = 0; c < 3; c += 1) expect(out.getComponent(i, c)).toBeCloseTo(interleaved.getComponent(i, c), 6);
    }
  });

  it('promotes a scene once per shared geometry and reports the byte delta', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Int16Array(9), 3, true));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(12), 4, false));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(6), 2, true));
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry), new THREE.Mesh(geometry));
    const totals = promoteSceneVertexFormats(root);
    expect(totals).toEqual({ geometries: 1, attributes: 2, bytesBefore: 18 + 12, bytesAfter: 36 + 48 });
    expect(geometry.getAttribute('normal').array).toBeInstanceOf(Float32Array);
    expect(geometry.getAttribute('skinIndex').array).toBeInstanceOf(Float32Array);
    expect(geometry.getAttribute('uv').array).toBeInstanceOf(Uint16Array);
    // Idempotent: a second pass finds nothing.
    expect(promoteVertexFormats(geometry, emptyVertexPromotion())).toEqual(emptyVertexPromotion());
  });

  it('the figure loader promotes every parsed GLB before it resolves (a quantized glTF through GLTFLoader)', async () => {
    const { GLTFLoader } = await import('three-stdlib');
    const { extendFigureLoader, vertexPromotionTotals } = await import('../figures/figure-loader');
    // 3 vertices: POSITION float x3 (36 B), NORMAL short x3 normalized in an
    // 8-byte stride (24 B, interleaved), JOINTS_0 ubyte x4 (12 B).
    const bytes = new ArrayBuffer(36 + 24 + 12);
    new Float32Array(bytes, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    new Int16Array(bytes, 36, 12).set([0, 0, 32767, 7, 0, 0, -32767, 7, 0, 0, 32767, 7]);
    new Uint8Array(bytes, 60, 12).set([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    const gltf = {
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_mesh_quantization'],
      extensionsRequired: ['KHR_mesh_quantization'],
      buffers: [{ byteLength: bytes.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 36, byteLength: 24, byteStride: 8, target: 34962 },
        { buffer: 0, byteOffset: 60, byteLength: 12, target: 34962 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5122, normalized: true, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: 5121, count: 3, type: 'VEC4' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };
    const loader = new GLTFLoader();
    extendFigureLoader(loader as never);
    const before = vertexPromotionTotals().attributes;
    const result = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
      loader.parse(glb(gltf, bytes), '', resolve as never, reject),
    );
    let mesh: THREE.Mesh | null = null;
    result.scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) mesh = node as THREE.Mesh;
    });
    expect(mesh).not.toBeNull();
    const geometry = (mesh as unknown as THREE.Mesh).geometry;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    expect((normal as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute).not.toBe(true);
    expect(normal.array).toBeInstanceOf(Float32Array);
    expect(Array.from(normal.array)).toEqual([0, 0, 1, 0, 0, -1, 0, 0, 1]);
    const skinIndex = geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
    expect(skinIndex.array).toBeInstanceOf(Float32Array);
    expect(Array.from(skinIndex.array)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    expect(geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
    expect(vertexPromotionTotals().attributes - before).toBe(2);
  }, 30_000); // cold dynamic imports (three-stdlib, figure-loader) under full-suite load

  it('the figure merge rebuilds bone indices as Float32 (never an integer input)', () => {
    const figure = read(join(ROUTE, 'figures', 'Figure.tsx'));
    const merge = figure.match(/function mergeableGeometry[\s\S]*?\n\}/)?.[0] ?? '';
    expect(merge).toMatch(/const store = new Float32Array\(attribute\.count \* itemSize\);/);
    expect(merge).not.toMatch(/Uint16Array\(attribute/);
  });
});

describe('the post-ball stall: the beam pre-raster is staggered', () => {
  const RAYS = 12;
  const SPARKS = 10;

  it('every part has a step, the sweep first and alone, the rays two per step, the sparks last', () => {
    const steps = beamPrerasterSteps(RAYS);
    const members = new Map<number, string[]>();
    const add = (part: BeamPart, index: number) => {
      const step = beamPrerasterStep(part, index, RAYS);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(steps);
      members.set(step, [...(members.get(step) ?? []), `${part}${index}`]);
    };
    for (const part of ['core', 'ring', 'glow', 'hud', 'sweep'] as const) add(part, 0);
    for (let i = 0; i < RAYS; i += 1) add('ray', i);
    for (let i = 0; i < SPARKS; i += 1) add('spark', i);
    // No empty step (each is one frame's raster), rays never more than two per step.
    for (let step = 0; step < steps; step += 1) expect(members.get(step)?.length ?? 0).toBeGreaterThan(0);
    for (const list of members.values()) expect(list.filter((name) => name.startsWith('ray')).length).toBeLessThanOrEqual(2);
    expect(members.get(0)).toEqual(['sweep0']);
    expect(members.get(steps - 1)?.every((name) => name.startsWith('spark'))).toBe(true);
    expect(beamPrerasterStep('core', 0, RAYS)).toBeLessThan(beamPrerasterStep('glow', 0, RAYS));
    // The two heavy small parts (blurred shadows at 4x / 6x) never share a step.
    expect(beamPrerasterStep('core', 0, RAYS)).not.toBe(beamPrerasterStep('ring', 0, RAYS));
    // Starts after the ball's own entrance (280 ms) and spaces the steps.
    expect(BEAM_PRERASTER.startDelayMs).toBeGreaterThanOrEqual(280);
    expect(BEAM_PRERASTER.stepMs).toBeGreaterThanOrEqual(50);
    // The whole beam is warm well inside the fastest load (reveal ≥ ~7 s).
    expect(BEAM_PRERASTER.startDelayMs + steps * BEAM_PRERASTER.stepMs).toBeLessThan(3000);
  });

  it('only a MARKED part is lifted to the pre-raster opacity (and parks), the reveal owns every part', () => {
    const css = read(join(ROUTE, 'BallLoader.module.css'));
    const lifts = [...css.matchAll(/([^{}]*)\{\s*opacity: 0\.002;\s*\}/g)]
      .map((m) => m[1].trim())
      // Keyframe offsets (the HUD primer's one-step hold) are not selectors.
      .filter((selector) => !/^(from|to|[\d.]+%)$/.test(selector));
    expect(lifts.length).toBeGreaterThan(0);
    for (const selector of lifts) expect(selector).toMatch(/\[data-warm\]$/);
    expect(css).toMatch(/\.sweep\[data-warm\] \{\s*animation:\s*sweepPark/);
    // The reveal's animations never depend on the mark.
    expect(css).toMatch(/\.root\[data-revealing\] \.sweep \{\s*animation: beamSweep/);
  });

  it('the loader tags every beam part with its step and marks one step per tick while docked', () => {
    const tsx = read(join(ROUTE, 'BallLoader.tsx'));
    const beam = tsx.match(/<div className=\{styles\.beam\}>[\s\S]*?\n {10}<\/div>/)?.[0] ?? '';
    for (const part of ['glow', 'sweep', 'ray', 'ring', 'core', 'spark']) {
      expect(beam).toMatch(new RegExp(`className=\\{styles\\.${part}\\}[\\s\\S]{0,40}data-beam-step=\\{beamPrerasterStep\\('${part}'`));
    }
    expect(tsx).toMatch(/const prerasterOn = visible && ball\.phase === 'loading' && !revealing && !reduced;/);
    expect(tsx).toMatch(/part\.dataset\.warm = ''/);
    expect(tsx).toMatch(/BEAM_PRERASTER\.stepMs/);
  });
});

describe('E7 / E10: the warm compiles everything mounted at load, heaviest first', () => {
  function fakeGl() {
    const compiled: THREE.Material[] = [];
    const gl = {
      getContext: () => null,
      properties: { get: () => ({}) },
      compile: vi.fn((root: THREE.Object3D) => {
        root.traverse((node) => {
          const material = (node as THREE.Mesh).material as THREE.Material | undefined;
          if (material) compiled.push(material);
        });
        return new Set();
      }),
      initTexture: vi.fn(),
      info: { programs: [] },
      shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false, type: THREE.PCFShadowMap },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      domElement: { width: 1440, height: 900 },
      clear: vi.fn(),
      toneMapping: THREE.NoToneMapping,
      outputColorSpace: THREE.SRGBColorSpace,
    } as unknown as THREE.WebGLRenderer;
    return { gl, compiled };
  }

  it('weighs physical > standard > basic, a patched program and skinning above plain ones', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry());
    const basic = new THREE.MeshBasicMaterial();
    const standard = new THREE.MeshStandardMaterial();
    const physical = new THREE.MeshPhysicalMaterial();
    const patched = new THREE.MeshStandardMaterial();
    patched.onBeforeCompile = () => {};
    const mapped = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
    expect(compileWeight(mesh, physical)).toBeGreaterThan(compileWeight(mesh, standard));
    expect(compileWeight(mesh, standard)).toBeGreaterThan(compileWeight(mesh, basic));
    expect(compileWeight(mesh, patched)).toBeGreaterThan(compileWeight(mesh, standard));
    expect(compileWeight(mesh, mapped)).toBeGreaterThan(compileWeight(mesh, standard));
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), standard);
    expect(compileWeight(skinned, standard)).toBeGreaterThan(compileWeight(mesh, standard));
    const shader = new THREE.ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'x'.repeat(40000) });
    expect(compileWeight(mesh, shader)).toBeGreaterThan(compileWeight(mesh, basic));
  });

  it('issues the queue longest first, compiles hidden (always-mounted, gain-0) content, and re-collects late mounts', () => {
    const { gl, compiled } = fakeGl();
    const scene = new THREE.Scene();
    const box = new THREE.BoxGeometry();
    const basic = new THREE.MeshBasicMaterial({ name: 'basic' });
    const standard = new THREE.MeshStandardMaterial({ name: 'standard' });
    const physical = new THREE.MeshPhysicalMaterial({ name: 'physical' });
    // A night-only effect: mounted at load, drawn with its gain at 0 by day
    // and even hidden — it must still link in the ceremony (D23 / R6 E10).
    const halo = new THREE.ShaderMaterial({ name: 'halo', vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
    const hidden = new THREE.Mesh(box, halo);
    hidden.visible = false;
    scene.add(new THREE.Mesh(box, basic), new THREE.Mesh(box, standard), hidden, new THREE.Mesh(box, physical));
    const io = createLoadWarmIO({
      gl,
      scene,
      camera: new THREE.PerspectiveCamera(),
      contentComplete: () => true,
      poses: () => [],
      rawRender: () => {},
      requestFrame: () => {},
      frameDrawn: () => true,
      passes: () => [],
      signal: () => {},
    });
    io.prepare();
    expect(io.collect()).toBe(4);
    // The program state must hold still before the compile opens.
    for (let i = 0; i < 3; i += 1) {
      io.prepare();
      io.collect();
    }
    let guard = 0;
    while (io.compileSlice() > 0 && guard < 20) guard += 1;
    // The heaviest first; the hidden, gain-0 halo compiled like everything else.
    expect(compiled[0].name).toBe('physical');
    expect(compiled.map((material) => material.name).sort()).toEqual(['basic', 'halo', 'physical', 'standard']);
    // Content mounted after the compile opened is fresh work, compiled next.
    const late = new THREE.MeshStandardMaterial({ name: 'late' });
    scene.add(new THREE.Mesh(box, late));
    expect(io.collect()).toBe(1);
    while (io.compileSlice() > 0 && guard < 40) guard += 1;
    expect(compiled.map((material) => material.name)).toContain('late');
    io.dispose();
  });
});

describe('textures: a GPU byte budget per warm step (R6, the textures-stage gap)', () => {
  it('estimates upload bytes: image texels ×4 plus a third for mips, data and compressed as stored', async () => {
    const { textureUploadBytes, WARM_TEXTURE_BYTES_PER_STEP } = await import('../useStationWarmup');
    const image = new THREE.Texture({ width: 1024, height: 1024 } as unknown as HTMLImageElement);
    expect(textureUploadBytes(image)).toBe(Math.round((1024 * 1024 * 4 * 4) / 3));
    image.generateMipmaps = false;
    expect(textureUploadBytes(image)).toBe(1024 * 1024 * 4);
    const data = new THREE.DataTexture(new Float32Array(64 * 64 * 4), 64, 64, THREE.RGBAFormat, THREE.FloatType);
    expect(textureUploadBytes(data)).toBe(64 * 64 * 4 * 4);
    const compressed = new THREE.CompressedTexture(
      [{ data: new Uint8Array(1000), width: 64, height: 64 }, { data: new Uint8Array(250), width: 32, height: 32 }] as never,
      64,
      64,
    );
    expect(textureUploadBytes(compressed)).toBe(1250);
    expect(textureUploadBytes(new THREE.Texture())).toBe(0);
    // A 1024² with mips is over budget alone (one per step); 256² ones batch.
    expect(textureUploadBytes(new THREE.Texture({ width: 1024, height: 1024 } as never))).toBeGreaterThan(WARM_TEXTURE_BYTES_PER_STEP);
    expect(textureUploadBytes(new THREE.Texture({ width: 256, height: 256 } as never)) * 4).toBeLessThan(WARM_TEXTURE_BYTES_PER_STEP);
  });

  it('the texture and data-face slices stop at the byte budget after the first upload', () => {
    const warm = read(join(ROUTE, 'useStationWarmup.ts'));
    const slice = warm.match(/const textureSlice = \(\): number => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    // ENGINE-FIX A2: the cap is 1 MiB while links are in flight (WARM_TEXTURE_BYTES_WHILE_LINKING).
    expect(slice).toMatch(/const byteCap = [^;]*linksPending\(\) \? WARM_TEXTURE_BYTES_WHILE_LINKING : WARM_TEXTURE_BYTES_PER_STEP;/);
    expect(slice).toMatch(/if \(done > 0 && stepBytes \+ bytes > byteCap\) break;/);
    const faces = warm.match(/const facesSlice = \(\): number => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(faces).toMatch(/stepBytes \+ bytes > WARM_TEXTURE_BYTES_PER_STEP/);
  });
});

describe('E7: longest first, but never two heavy translations in one step', () => {
  it('each compile step takes the heaviest remaining variant and fills its program budget from the light end', () => {
    const issued: string[][] = [];
    let batch: string[] = [];
    const programs: { isReady: () => boolean }[] = [];
    const gl = {
      getContext: () => null,
      properties: { get: () => ({}) },
      compile: vi.fn((root: THREE.Object3D) => {
        root.traverse((node) => {
          const material = (node as THREE.Mesh).material as THREE.Material | undefined;
          if (!material) return;
          batch.push(material.name);
          programs.push({ isReady: () => true });
        });
        return new Set();
      }),
      initTexture: vi.fn(),
      info: { programs },
      shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false, type: THREE.PCFShadowMap },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      domElement: { width: 1440, height: 900 },
      clear: vi.fn(),
      toneMapping: THREE.NoToneMapping,
      outputColorSpace: THREE.SRGBColorSpace,
    } as unknown as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const box = new THREE.BoxGeometry();
    for (let i = 0; i < 3; i += 1) scene.add(new THREE.Mesh(box, new THREE.MeshPhysicalMaterial({ name: `physical${i}` })));
    for (let i = 0; i < 12; i += 1) scene.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ name: `basic${i}` })));
    const io = createLoadWarmIO({
      gl,
      scene,
      camera: new THREE.PerspectiveCamera(),
      contentComplete: () => true,
      poses: () => [],
      rawRender: () => {},
      requestFrame: () => {},
      frameDrawn: () => true,
      passes: () => [],
      signal: () => {},
    });
    for (let i = 0; i < 4; i += 1) {
      io.prepare();
      io.collect();
    }
    let guard = 0;
    let remaining = 1;
    while (remaining > 0 && guard < 20) {
      batch = [];
      remaining = io.compileSlice();
      if (batch.length > 0) issued.push(batch);
      guard += 1;
    }
    // Every variant compiled once; each step opens with the heaviest left.
    expect(issued.flat().length).toBe(15);
    expect(new Set(issued.flat()).size).toBe(15);
    expect(issued.slice(0, 3).map((slice) => slice[0])).toEqual(['physical0', 'physical1', 'physical2']);
    // Never two heavy programs in one step, and the steps stay full (link parallelism).
    for (const slice of issued) expect(slice.filter((name) => name.startsWith('physical')).length).toBeLessThanOrEqual(1);
    expect(issued[0].length).toBeGreaterThan(1);
    io.dispose();
  });
});

describe('textures upload inside the compile stage while the links run (R6)', () => {
  it('the machine offers an upload step on compile frames that do not advance, never after the stage moved on', async () => {
    const { createLoadWarm, stepLoadWarm } = await import('../useStationWarmup');
    const calls: string[] = [];
    let remaining = 2;
    const io = {
      prepare: () => {},
      collect: () => 0,
      compileSlice: () => remaining,
      linksPending: () => remaining > 0,
      contentComplete: () => true,
      shadowSlice: () => 0,
      verifySlice: () => 0,
      textureSlice: () => 0,
      bufferSlice: () => 0,
      passSlice: () => 0,
      poseSlice: () => 0,
      requestFrame: () => {},
      frameDrawn: () => true,
      programCount: () => 0,
      uploadWhileLinking: () => calls.push('upload'),
    };
    let state = stepLoadWarm(createLoadWarm(), io);
    expect(state.stage).toBe('compile');
    expect(calls).toEqual(['upload']);
    remaining = 0;
    state = stepLoadWarm(state, io);
    expect(state.stage).toBe('shadows');
    expect(calls).toEqual(['upload']);
  });

  it('the three.js IO uploads only once the compile gate opened on complete content, on frames that issued nothing', () => {
    const warm = read(join(ROUTE, 'useStationWarmup.ts'));
    const hook = warm.match(/uploadWhileLinking: \(\) => \{[\s\S]*?\n {4}\},/)?.[0] ?? '';
    // ROLLOUT-PLAN E6: before the gate opens the frame only bands the giant
    // faces (`earlyBandSlice`); the texture list is still never built early.
    expect(hook).toMatch(/if \(issuedThisFrame\) return;/);
    expect(hook).toMatch(/if \(compileOpenedAt === null \|\| !deps\.contentComplete\(\)\) \{\s*earlyBandSlice\(\);\s*return;\s*\}/);
    expect(hook).toMatch(/textureSlice\(\)/);
  });
});

describe('E8: the route HUD is pre-rastered from the handoff', () => {
  it('lays the HUD out at the pre-raster opacity between the handoff and world-route-live, with no pointer events', () => {
    const css = read(join(ROUTE, 'BallLoader.module.css'));
    const hud = css.match(/:global\(html\[data-route-handoff\]:not\(\.world-route-live\)\):has\(\.root\) :global\(\.world-nav-hud\) \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(hud).toMatch(/visibility: visible;/);
    expect(hud).toMatch(/opacity: 0\.002;/);
    const bar = css.match(/:global\(html\[data-route-handoff\]:not\(\.world-route-live\)\):has\(\.root\) :global\(\.world-nav-hud-bar\) \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(bar).toMatch(/pointer-events: none;/);
  });
});

describe('E8 part 2: the route-HUD primer links the glass programs while docked', () => {
  it('carries the HUD bar paint effects, is warmed as one stagger step and drops back to 0', () => {
    const css = read(join(ROUTE, 'BallLoader.module.css'));
    const primer = css.match(/\.hudPrimer \{([\s\S]*?)\r?\n\}/)?.[1] ?? '';
    expect(primer).toMatch(/backdrop-filter: blur\(18px\) saturate\(1\.25\);/);
    expect(primer).toMatch(/opacity: 0;/);
    expect(primer).toMatch(/pointer-events: none;/);
    // The same effects as the real HUD bar (globals.css .world-nav-hud-bar).
    const globals = read(join(SRC, 'app', 'globals.css'));
    const bar = globals.match(/\.world-nav-hud-bar \{([\s\S]*?)\r?\n\}/)?.[1] ?? '';
    expect(bar).toMatch(/backdrop-filter: blur\(18px\) saturate\(1\.25\);/);
    expect(css).toMatch(/\.hudPrimer\[data-warm\] \{\s*animation: hudPrime 400ms steps\(1, end\) forwards;/);
    const tsx = read(join(ROUTE, 'BallLoader.tsx'));
    expect(tsx).toMatch(/className=\{styles\.hudPrimer\} data-beam-step=\{beamPrerasterStep\('hud', 0, RAY_COUNT\)\}/);
    expect(beamPrerasterStep('hud', 0, 12)).toBeLessThan(beamPrerasterStep('ray', 0, 12));
  });
});

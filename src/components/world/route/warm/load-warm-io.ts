import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  HalfFloatType,
  type Light,
  type Material,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  type Texture,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three';
import {
  BAND_MAX_BYTES,
  bandedCandidates,
  bandedUploadWanted,
  nextBandedStepBytes,
  stepBandedUpload,
} from '../content/banded-upload';
import { uncappedFrameMs } from '../frame-cap';
import { assertLatchVisible } from '../residency-store';
import {
  GUARD_TEXTURE_BUDGET_MS,
  isRenderable,
  isStaleProgram,
  materialsOf,
  type ProgramLike,
  propertiesOf,
  type Renderable,
  textureOnGpu,
  uploadFailed,
} from './compile-guard';
import {
  compileProxy,
  compileVariantKey,
  compileWeight,
  materialTextures,
  type VariantKeyMemo,
  type WarmPose,
} from './compile-variants';
import {
  createLinkCap,
  nextFreshBudget,
  runWarmPrepare,
  stepLinkCap,
  textureUploadBytes,
  VEILED_WARM,
  veiledLinkBudget,
  WARM_BUFFER_BYTES_PER_FRAME,
  WARM_BUFFER_DRAW_NEW_MATERIALS,
  WARM_BUFFER_DRAWS_PER_STEP,
  WARM_BUFFER_LAYER,
  WARM_BUFFER_NEW_MATERIALS,
  WARM_COMPILE_BUDGET_MS,
  WARM_FENCE_MAX_MS,
  WARM_FRAME_SLOW_MS,
  WARM_GPU_HEAVY_MS,
  WARM_GPU_REST_FACTOR,
  WARM_LINK_MAX_MS,
  WARM_POSE_SCALE,
  WARM_PRIME_BUDGET_MS,
  WARM_SHADOW_CASTERS_PER_FRAME,
  WARM_SIGNATURE_STABLE_FRAMES,
  WARM_TEXTURE_BYTES_PER_STEP,
  WARM_TEXTURE_BYTES_WHILE_LINKING,
  warmLinkBudget,
  type WarmPostPass,
} from './load-warm';
import {
  environmentReady,
  environmentShape,
  envProgramState,
  faceShown,
  isCubeMapping,
  isPmremSource,
  type LoadWarmDeps,
  type LoadWarmIOHandle,
  materialNeedsLights,
  type PmremInternals,
  pointCountRose,
  type WarmOutput,
} from './load-warm-io-helpers';
import { compileShadowVariants, type ShadowCaster } from './shadow-variants';
import { deferredUploads, uploadNow } from './upload-deferral';

/**
 * `createLoadWarmIO`, the load warm's three.js IO.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

/**
 * The three.js implementation of `LoadWarmIO` (see the section note). Every
 * method is a bounded per-frame slice.
 */
export function createLoadWarmIO(deps: LoadWarmDeps): LoadWarmIOHandle {
  const { gl, scene, camera } = deps;
  const scratch = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  // ENGINE r3: the `screen` output's stand-in. three derives a program's tone
  // mapping and output colour space from the bound target; an XR-flagged
  // target reads both exactly as the default framebuffer does (the
  // renderer's operator, the texture's colour space), so a compile or draw
  // into it builds the screen variant without touching the visible canvas.
  const screenScratch = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
  (screenScratch as WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
  const outputs = (): readonly WarmOutput[] => {
    const list = deps.outputs?.() ?? [];
    return list.length > 0 ? list : [{ kind: 'hdr', toneMapping: gl.toneMapping }];
  };
  const seenKeys = new Set<string>();
  /** R6 E7: `compileWeight` per (object, material), memoised for the sort. */
  const weights = new WeakMap<Object3D, Map<Material, number>>();
  const weightOf = (object: Object3D, material: Material): number => {
    let perObject = weights.get(object);
    if (perObject === undefined) {
      perObject = new Map();
      weights.set(object, perObject);
    }
    let weight = perObject.get(material);
    if (weight === undefined) {
      weight = compileWeight(object, material);
      perObject.set(material, weight);
    }
    return weight;
  };
  const byCompileWeight = (a: { object: Object3D; material: Material }, b: { object: Object3D; material: Material }): number =>
    weightOf(b.object, b.material) - weightOf(a.object, a.material);
  /** Compile work for the start rung's output (first) and for the other outputs (after it). */
  const queue: { object: Object3D; material: Material; output: WarmOutput }[] = [];
  const laterQueue: { object: Object3D; material: Material; output: WarmOutput }[] = [];
  const proxyScene = new Scene();
  /** Programs seen still linking, with the time first seen (bounded wait). */
  const linking = new Map<ProgramLike, number>();
  let compiledVariants = 0;

  let casters: Object3D[] | null = null;
  let castersDone = 0;
  let textures: Texture[] | null = null;
  let uploads = 0;

  const fullscreen = new BufferGeometry();
  fullscreen.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fullscreen.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let passQueue: { entry: WarmPostPass; compiled: boolean; pending?: Material[] }[] | null = null;
  let passesDone = 0;
  let passSteps = 0;

  let verifyPasses = 0;
  let verifyCreated = 0;
  /** Interval between the last two warm frames (the link budget's input). */
  let frameIntervalMs = 16;
  let lastPrepareAt: number | null = null;
  /** ENGINE r4: one frame's interval (the last two ticks); idempotent within a frame. */
  const tickFrame = (now: number): void => {
    if (lastPrepareAt !== null && now - lastPrepareAt <= 1) return;
    // D38: a frame the cap skipped on purpose is not a busy GPU (frame-cap.ts).
    frameIntervalMs = lastPrepareAt === null ? 16 : uncappedFrameMs(now - lastPrepareAt);
    lastPrepareAt = now;
  };
  let linkCap = createLinkCap();

  /** Pose renders: every station pose for every output (the start rung's first). */
  let poseQueue: { pose: WarmPose; output: number }[] | null = null;
  const poseTargets = new Map<number, WebGLRenderTarget>();
  const poseCamera = new PerspectiveCamera();
  let posesDone = 0;

  /** ENGINE r4: end the GPU task here (a WebGL flush; the GPU scheduler may run the compositor next). */
  const flushGpu = (): void => {
    try {
      (gl.getContext?.() as WebGLRenderingContext | undefined)?.flush();
    } catch {
      // A lost context: nothing to flush.
    }
  };

  const programs = (): ProgramLike[] => (gl.info as unknown as { programs?: ProgramLike[] | null }).programs ?? [];

  /** Debug trace: the warm stage in which each program first appeared (cache key → stage). */
  const origins = new Map<string, { stage: string; name: string }>();
  const noteOrigins = (stage: string): void => {
    for (const program of programs() as (ProgramLike & { cacheKey?: string; name?: string })[]) {
      const key = program.cacheKey;
      if (key !== undefined && !origins.has(key)) origins.set(key, { stage, name: program.name ?? '?' });
    }
  };

  /** Run `fn` with the scratch target bound (the composer's variant), restoring the binding. */
  const intoScratch = (fn: () => void): void => {
    const previous = gl.getRenderTarget();
    const face = gl.getActiveCubeFace();
    const mip = gl.getActiveMipmapLevel();
    gl.setRenderTarget(scratch);
    try {
      fn();
    } finally {
      gl.setRenderTarget(previous, face, mip);
    }
  };

  /**
   * Run `fn` with `output`'s program state bound (ENGINE r3): the `hdr`
   * scratch, or the screen stand-in with the output's operator set on the
   * renderer for the call (restored). `target` overrides the stand-in (the
   * pose / buffer renders' sized targets), flagged the same way.
   */
  const intoOutput = (output: WarmOutput, fn: () => void, target?: WebGLRenderTarget): void => {
    const previous = gl.getRenderTarget();
    const face = gl.getActiveCubeFace();
    const mip = gl.getActiveMipmapLevel();
    const toneMapping = gl.toneMapping;
    if (output.kind === 'screen') {
      screenScratch.texture.colorSpace = gl.outputColorSpace;
      gl.toneMapping = output.toneMapping;
    }
    gl.setRenderTarget(target ?? (output.kind === 'screen' ? screenScratch : scratch));
    try {
      fn();
    } finally {
      gl.toneMapping = toneMapping;
      gl.setRenderTarget(previous, face, mip);
    }
  };

  /** A sized render target for `output`'s draws (pose / buffer renders). */
  const drawTargetFor = (output: WarmOutput, width: number, height: number): WebGLRenderTarget => {
    if (output.kind === 'hdr') return new WebGLRenderTarget(width, height, { type: HalfFloatType });
    const target = new WebGLRenderTarget(width, height, { type: UnsignedByteType });
    (target as WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
    target.texture.colorSpace = gl.outputColorSpace;
    return target;
  };

  // Program state of the scene (ENGINE r2). Every lit program's key carries
  // the scene's light counts (per type, with shadow casters), the
  // environment map (PMREM size) and the fog type. A program compiled before
  // a light or the environment arrived is the wrong variant: its first real
  // draw links the right one synchronously. So the warm keys its whole
  // compile on this signature: a change clears every compiled variant and the
  // machine compiles again (the program cache makes the unchanged ones free),
  // and the compile only starts once it has held still for
  // WARM_SIGNATURE_STABLE_FRAMES frames.
  let signature: string | null = null;
  let signatureStable = 0;
  const signatureLog: { t: number; signature: string }[] = [];
  const sceneSignature = (): string => {
    const n = { dir: 0, dirS: 0, point: 0, pointS: 0, spot: 0, spotS: 0, spotMap: 0, hemi: 0, rect: 0, probe: 0 };
    scene.traverseVisible((object) => {
      const light = object as Light & {
        isDirectionalLight?: boolean;
        isPointLight?: boolean;
        isSpotLight?: boolean;
        isHemisphereLight?: boolean;
        isRectAreaLight?: boolean;
        isLightProbe?: boolean;
        map?: unknown;
      };
      if (light.isLight !== true || !object.layers.test(camera.layers)) return;
      const casts = light.castShadow === true;
      if (light.isDirectionalLight) {
        n.dir += 1;
        if (casts) n.dirS += 1;
      } else if (light.isPointLight) {
        n.point += 1;
        if (casts) n.pointS += 1;
      } else if (light.isSpotLight) {
        n.spot += 1;
        if (casts) n.spotS += 1;
        if (light.map) n.spotMap += 1;
      } else if (light.isHemisphereLight) n.hemi += 1;
      else if (light.isRectAreaLight) n.rect += 1;
      else if (light.isLightProbe) n.probe += 1;
    });
    const env = scene.environment as Texture | null;
    const fog = scene.fog as { isFogExp2?: boolean } | null;
    return [
      `${n.dir}/${n.dirS}`,
      `${n.point}/${n.pointS}`,
      `${n.spot}/${n.spotS}/${n.spotMap}`,
      n.hemi,
      n.rect,
      n.probe,
      env ? `${env.uuid}:${environmentReady(env) ? 1 : 0}:${environmentShape(env)}` : '-',
      fog ? (fog.isFogExp2 ? 'exp2' : 'lin') : '-',
      gl.shadowMap.enabled ? gl.shadowMap.type : 'off',
    ].join('|');
  };

  // PMREM pre-link (ENGINE r2). The renderer builds the environment's PMREM
  // the first time a compile or draw meets it, and PMREMGenerator RENDERS at
  // once with its equirect / GGX / blur shaders: first-use links,
  // synchronous. A private generator of the same size compiles the identical
  // materials (same sources and defines, drawn on the same lod mesh, into a
  // render target like the real one) without drawing; once they are linked,
  // the real generation reuses them from the program cache. The generator is
  // kept: disposing it would release the programs before the real
  // generation used them.
  let pmrem: { texture: Texture; materials: Material[]; generator: PMREMGenerator } | null = null;
  const pmremReady = (): boolean => {
    const env = scene.environment as Texture | null;
    if (!env || !isPmremSource(env)) return true;
    if (!environmentReady(env)) return false;
    if (pmrem === null || pmrem.texture !== env) {
      const generator = new PMREMGenerator(gl);
      const internals = generator as unknown as PmremInternals;
      const materials: Material[] = [];
      try {
        const cube = isCubeMapping(env);
        const image = env.image as { width?: number; length?: number; [index: number]: { width?: number; image?: { width?: number } } };
        internals._setSize(cube ? (image.length === 0 ? 16 : (image[0]?.width ?? image[0]?.image?.width ?? 16)) : (image.width ?? 64) / 4);
        internals._allocateTargets().dispose();
        if (cube) generator.compileCubemapShader();
        else generator.compileEquirectangularShader();
        const entry = cube ? internals._cubemapMaterial : internals._equirectMaterial;
        for (const material of [entry, internals._ggxMaterial, internals._blurMaterial]) if (material) materials.push(material);
        const mesh = internals._lodMeshes?.[0];
        if (mesh) {
          const original = mesh.material;
          intoScratch(() => {
            for (const material of materials) {
              mesh.material = material;
              gl.compile(mesh, ortho);
            }
          });
          mesh.material = original;
        }
      } catch {
        // A three internals change: the real generation links on first use (as before r2).
      }
      pmrem = { texture: env, materials, generator };
      noteOrigins('pmrem');
    }
    const properties = propertiesOf(gl);
    for (const material of pmrem.materials) {
      const program = properties.get(material).currentProgram;
      if (program && typeof program.isReady === 'function' && !program.isReady()) return false;
    }
    return true;
  };

  // Stale-variant eviction (ENGINE r2). three keeps every variant a material
  // was ever compiled for (its per-material program map) until the material
  // is disposed, so the programs compiled before a light / environment / fog
  // change stay alive — linked GPU work nobody draws, and +26 on the plaza's
  // program count (r2 probe: 112 vs 86). Disposing a material only releases
  // its GPU state (programs whose last user it was are deleted); three
  // re-initialises it on its next compile, which the machine runs at once.
  const compiledMaterials = new Set<Material>();
  let evicted = 0;
  const evictStaleVariants = (before: string, after: string): void => {
    const a = before.split('|');
    const b = after.split('|');
    // ENGINE-FIX (D32): behind the theme veil nothing is evicted — the
    // variants of the palette the visitor left stay linked for the way back.
    // One exception: a RISE of the point-light count. The host pads the
    // scene to that count from now on (RouteWorldCanvas `syncPointLightPad`),
    // so the lower count's variants can never be drawn again — evicted as at
    // load (live materials re-initialise on the compile that follows).
    const veiledSwap = deps.veiled?.() === true;
    if (veiledSwap && !pointCountRose(a[1], b[1])) {
      compiledMaterials.clear();
      return;
    }
    const lightsChanged = [0, 1, 2, 3, 4, 5, 8].some((index) => a[index] !== b[index]);
    // ENGINE-FIX: only the environment's KEY-relevant state (present, pixels
    // in, mapping and size — `envProgramState`) makes a variant stale. A new
    // map of the same shape (the other palette's HDRI) keeps every key, and
    // evicting on its uuid alone re-linked ~40 identical programs per swap.
    const envChanged = envProgramState(a[6]) !== envProgramState(b[6]);
    const fogChanged = a[7] !== b[7];
    for (const material of compiledMaterials) {
      const m = material as Material & { isMeshStandardMaterial?: boolean; fog?: boolean };
      const stale =
        (lightsChanged && materialNeedsLights(material)) || (envChanged && m.isMeshStandardMaterial === true) || (fogChanged && m.fog === true);
      if (!stale) continue;
      try {
        // The prototype's dispose: behind the veil the swap capture defers
        // own-property disposals, and this eviction must really happen.
        if (veiledSwap) (Object.getPrototypeOf(material) as Material).dispose.call(material);
        else material.dispose();
        evicted += 1;
      } catch {
        // Never let an eviction stop the load.
      }
    }
    compiledMaterials.clear();
  };

  /** Whether the compile may run this frame (see `compileReady` and the two notes above). */
  let compileOpenedAt: number | null = null;
  let lastGateOpen = false;
  const compileGate = (): boolean => {
    // The PMREM pre-link starts as soon as the environment is in (it does
    // not depend on the populations), so it has linked by the time they are.
    const pmremLinked = pmremReady();
    const open = pmremLinked && (deps.compileReady?.() ?? true) && signatureStable >= WARM_SIGNATURE_STABLE_FRAMES;
    lastGateOpen = open;
    if (open && compileOpenedAt === null) compileOpenedAt = performance.now();
    return open;
  };

  const linksPending = (): boolean => {
    const now = performance.now();
    let pending = false;
    for (const program of programs()) {
      if (typeof program.isReady !== 'function' || isStaleProgram(program)) continue;
      if (program.isReady()) {
        linking.delete(program);
        continue;
      }
      const since = linking.get(program);
      if (since === undefined) {
        linking.set(program, now);
        pending = true;
      } else if (now - since <= WARM_LINK_MAX_MS) {
        pending = true;
      }
    }
    return pending;
  };

  const readyCount = (): number => {
    let ready = 0;
    for (const program of programs()) if (typeof program.isReady !== 'function' || program.isReady()) ready += 1;
    return ready;
  };

  /** Programs still linking (a non-blocking COMPLETION_STATUS poll each). */
  const linksInFlight = (): number => {
    let inFlight = 0;
    for (const program of programs()) {
      if (typeof program.isReady === 'function' && !isStaleProgram(program) && !program.isReady()) inFlight += 1;
    }
    return inFlight;
  };

  /** New programs this step may issue: the adaptive cap, or the veiled budget (ENGINE-FIX, D32). */
  const linkBudget = (): number =>
    deps.veiled?.() === true ? veiledLinkBudget(linksInFlight()) : warmLinkBudget(frameIntervalMs, linksInFlight(), linkCap.cap);

  const signalPrograms = () => {
    deps.signal('programs', programs().length);
    deps.signal('programsReady', readyCount());
  };

  // ENGINE r3 (per-frame main-thread cost): `collect` runs every warm frame
  // over the whole scene, and building every renderable's variant key string
  // each time cost 0.1-0.18 s per frame burst on dev. The key is memoised
  // per (object, material) and recomputed only when an input it reads
  // changes identity (geometry, instance colour, morph texture) or the
  // geometry's attribute / morph sets change size. The verify stage's
  // whole-scene compile stays the backstop for anything a key misses.
  const keyMemo = new WeakMap<Object3D, VariantKeyMemo[]>();
  const cachedVariantKey = (object: Object3D, material: Material): string => {
    const r = object as Renderable & { geometry?: Mesh['geometry']; instanceColor?: unknown; morphTexture?: unknown };
    const geometry = r.geometry;
    const attributeCount = geometry ? Object.keys(geometry.attributes).length : 0;
    const morphCount = geometry ? Object.keys(geometry.morphAttributes).length : 0;
    const list = keyMemo.get(object);
    if (list !== undefined) {
      for (const entry of list) {
        if (
          entry.material === material &&
          entry.geometry === geometry &&
          entry.instanceColor === (r.instanceColor ?? null) &&
          entry.morphTexture === (r.morphTexture ?? null) &&
          entry.attributeCount === attributeCount &&
          entry.morphCount === morphCount
        ) {
          return entry.key;
        }
      }
    }
    const key = compileVariantKey(object, material);
    const entry: VariantKeyMemo = {
      material,
      geometry,
      instanceColor: r.instanceColor ?? null,
      morphTexture: r.morphTexture ?? null,
      attributeCount,
      morphCount,
      key,
    };
    const next = (list ?? []).filter((item) => item.material !== material);
    next.push(entry);
    keyMemo.set(object, next);
    return key;
  };

  const collect = (): number => {
    let fresh = 0;
    const next = sceneSignature();
    if (next !== signature) {
      if (signature !== null) {
        // The program state moved: every variant compiled so far may be the
        // wrong one. Forget them all; unchanged ones come back from three's
        // program cache for free.
        seenKeys.clear();
        queue.length = 0;
        laterQueue.length = 0;
        evictStaleVariants(signature, next);
      }
      signature = next;
      signatureStable = 0;
      if (signatureLog.length < 32) signatureLog.push({ t: Math.round(performance.now()), signature: next });
    } else {
      signatureStable += 1;
    }
    const targets = outputs();
    scene.traverse((object) => {
      if (!isRenderable(object)) return;
      for (const material of materialsOf(object)) {
        const key = cachedVariantKey(object, material);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        // The start rung's output first; the lower rungs' outputs after the
        // whole first pass (the reveal needs every one, the frame the first).
        targets.forEach((output, index) => (index === 0 ? queue : laterQueue).push({ object, material, output }));
        fresh += 1;
      }
    });
    if (fresh > 0) {
      // R6 E7: longest first (LPT) — the heavy programs start linking while
      // the light ones fill the workers behind them (see `compileWeight`).
      // Stable, so equal weights keep the traversal order.
      queue.sort(byCompileWeight);
      laterQueue.sort(byCompileWeight);
      // New content invalidates the later stages' lists.
      casters = null;
      textures = null;
      bufferQueue = null;
      passQueue = null;
      poseQueue = null;
    }
    return fresh;
  };

  /** R6: whether this frame's compile / later slice issued a program (`uploadWhileLinking`). */
  let issuedThisFrame = false;
  /** Compile items of `list` under this frame's link budget and `budgetMs`; returns what remains. */
  const drain = (list: typeof queue, budgetMs: number): number => {
    if (list.length === 0) return 0;
    // Never more than a few links in flight: the ANGLE GPU process stalls
    // (and freezes the compositor) on large batches.
    const allowed = linkBudget();
    if (allowed <= 0) return list.length;
    const started = performance.now();
    const before = programs().length;
    let first = true;
    issuedThisFrame = true;
    while (list.length > 0) {
      if (!first && (performance.now() - started >= budgetMs || programs().length - before >= allowed)) {
        break;
      }
      // R6 E7: the queue is longest first. A step takes the HEAVIEST
      // remaining variant first and fills the rest of its program budget from
      // the LIGHT end: the heavy links still start earliest (the LPT tail
      // saving), but no step stacks several heavy translations on the GPU
      // main thread (sakura r6 i2, plain head-first: a 207 ms compositor gap
      // at compile-open). The number of programs per step is unchanged — the
      // warm's GPU fence after a step waits out that step's links, so fewer
      // per step serializes linking (r6 probe: a per-step cost cap stretched
      // the clouds compile from 1.4 s to 6.9 s).
      const next = first ? list.shift() : list.pop();
      first = false;
      if (!next) break;
      if (next.object.parent === null) continue; // unmounted since it was queued
      try {
        const proxy = compileProxy(next.object, next.material);
        intoOutput(next.output, () => {
          if (proxy === null) {
            // BatchedMesh (or an unknown kind): compile the object itself.
            gl.compile(next.object, camera, scene);
          } else {
            proxyScene.add(proxy);
            try {
              gl.compile(proxyScene, camera, scene);
            } finally {
              proxyScene.remove(proxy);
            }
          }
        });
        compiledVariants += 1;
        compiledMaterials.add(next.material);
        // ENGINE r4: each compile request its own GPU task (shader
        // translation runs on the GPU main thread before the parallel link).
        flushGpu();
        deps.signal('variants', compiledVariants);
        noteOrigins(list === queue ? 'compile' : 'compile-later');
      } catch {
        // A half-built material / lost context: the pose renders or the first frame compile it.
      }
    }
    return list.length;
  };

  /**
   * ENGINE-FIX (D32): behind the opaque theme veil the queued variants of
   * `items` compile in ONE compile call into `output` — every proxy in the
   * proxy scene at once, one light setup against the real scene — instead
   * of a compile (a scene light traversal) and a GPU flush per variant. The
   * slicing exists to keep a VISIBLE ceremony smooth; under the veil it only
   * lengthens the wait (a swap's ~100 cached variants took 3-4 frames of
   * 40-50 ms). The variants are exactly the queued ones (a whole-scene
   * compile would also link what the warm never draws); new programs link
   * in parallel and the stage waits for them as before.
   */
  const compileVeiled = (items: readonly (typeof queue)[number][], output: WarmOutput | undefined, stage: string): void => {
    if (output === undefined || items.length === 0) return;
    issuedThisFrame = true;
    const own: Object3D[] = [];
    try {
      intoOutput(output, () => {
        for (const item of items) {
          if (item.object.parent === null) continue; // unmounted since it was queued
          const proxy = compileProxy(item.object, item.material);
          if (proxy === null) own.push(item.object);
          else proxyScene.add(proxy);
        }
        try {
          gl.compile(proxyScene, camera, scene);
        } finally {
          proxyScene.clear();
        }
        // BatchedMesh (or an unknown kind): compiled as itself (see `drain`).
        for (const object of own) gl.compile(object, camera, scene);
      });
    } catch {
      // A half-built material / lost context: the verify pass or the first frame compiles it.
    }
    for (const item of items) compiledMaterials.add(item.material);
    compiledVariants += items.length;
    flushGpu();
    deps.signal('variants', compiledVariants);
    noteOrigins(stage);
  };

  const compileSlice = (): number => {
    if (!compileGate()) {
      signalPrograms();
      // Not started yet: report work outstanding so the machine waits here.
      return Math.max(1, queue.length);
    }
    if (deps.veiled?.() === true && queue.length > 0) {
      compileVeiled(queue.splice(0), outputs()[0], 'compile');
      signalPrograms();
      return 0;
    }
    const remaining = drain(queue, WARM_COMPILE_BUDGET_MS);
    signalPrograms();
    return remaining;
  };

  /** Whether the lower rungs' outputs passed their verification compile (reset by new work). */
  let laterVerified = false;
  const laterSlice = (): number => {
    const targets = outputs();
    if (targets.length < 2) return 0;
    if (laterQueue.length > 0 && deps.veiled?.() === true) {
      // ENGINE-FIX (D32): one whole-scene compile per lower output (see `compileVeiled`).
      laterVerified = false;
      const items = laterQueue.splice(0);
      for (const output of targets.slice(1)) compileVeiled(items.filter((item) => item.output === output), output, 'compile-later');
      signalPrograms();
      return 1;
    }
    if (laterQueue.length > 0) {
      laterVerified = false;
      const remaining = drain(laterQueue, WARM_COMPILE_BUDGET_MS);
      signalPrograms();
      return remaining + 1;
    }
    if (laterVerified) return 0;
    // Verification (as `verify` does for the start rung's output): a
    // whole-scene compile per lower output once its links have landed;
    // anything it creates is linked on the following frames.
    if (linksPending()) return 1;
    const before = programs().length;
    for (const output of targets.slice(1)) {
      try {
        intoOutput(output, () => gl.compile(scene, camera));
      } catch {
        // A half-built material / lost context: the pose renders show it.
      }
    }
    const created = programs().length - before;
    verifyCreated += created;
    signalPrograms();
    noteOrigins('verify-later');
    if (created === 0) laterVerified = true;
    return created === 0 ? 0 : 1;
  };

  const shadowSlice = (): number => {
    if (casters === null) {
      const list: Object3D[] = [];
      scene.traverse((object) => {
        if ((object as Mesh).isMesh === true && object.castShadow) list.push(object);
      });
      casters = list;
    }
    // Chunks until the frame's budget is spent (cached variants cost ~nothing;
    // a chunk that mints new programs ends the slice through the program cap).
    const allowed = linkBudget();
    if (allowed <= 0) {
      signalPrograms();
      return Math.max(1, casters.length);
    }
    const started = performance.now();
    const before = programs().length;
    do {
      const chunk = casters.splice(0, WARM_SHADOW_CASTERS_PER_FRAME);
      if (chunk.length === 0) break;
      compileShadowVariants(gl, chunk, scene, camera);
      // Progress for the stall detector even when every variant was cached.
      castersDone += chunk.length;
    } while (casters.length > 0 && performance.now() - started < WARM_COMPILE_BUDGET_MS && programs().length - before < allowed);
    deps.signal('casters', castersDone);
    signalPrograms();
    noteOrigins('shadows');
    return casters.length;
  };

  const verifySlice = (): number => {
    const before = programs().length;
    try {
      // The start rung's output; the lower rungs' outputs verify in `laterSlice`.
      intoOutput(outputs()[0], () => gl.compile(scene, camera));
    } catch {
      // A half-built material / lost context: the pose renders show it.
    }
    const all: Object3D[] = [];
    scene.traverse((object) => {
      if ((object as Mesh).isMesh === true && object.castShadow) all.push(object);
    });
    compileShadowVariants(gl, all, scene, camera);
    verifyPasses += 1;
    const created = programs().length - before;
    verifyCreated += created;
    deps.signal('verifies', verifyPasses);
    signalPrograms();
    noteOrigins(`verify:${verifyPasses}`);
    return created;
  };

  // Buffers (ENGINE r2): the scene's renderables drawn in byte-budgeted
  // chunks. A chunk is isolated by a camera layer nobody else uses: the
  // chunk's objects and EVERY light gain the layer for the draw (so the light
  // state, and with it every program key, is the real one), frustum culling
  // is off for the chunk, and everything is restored in the same call.
  let bufferQueue: { object: Object3D; output: number }[] | null = null;
  // Per output: the geometries whose bytes were counted, and the materials
  // already drawn once (their programs' first draw into that output).
  const bufferGeometries = new Map<number, WeakSet<object>>();
  let buffersDone = 0;
  const bufferTargets = new Map<number, WebGLRenderTarget>();

  const bufferCamera = new PerspectiveCamera();
  const geometryBytes = (object: Object3D, output: number): number => {
    const geometry = (object as Mesh).geometry as (Mesh['geometry'] & { index?: { array?: ArrayLike<number> & { byteLength?: number } } | null }) | undefined;
    let seen = bufferGeometries.get(output);
    if (seen === undefined) {
      seen = new WeakSet<object>();
      bufferGeometries.set(output, seen);
    }
    if (!geometry || seen.has(geometry)) return 0;
    seen.add(geometry);
    let bytes = 0;
    for (const attribute of Object.values(geometry.attributes)) {
      const array = (attribute as { array?: { byteLength?: number } }).array;
      bytes += array?.byteLength ?? 0;
    }
    bytes += geometry.index?.array?.byteLength ?? 0;
    const instanced = object as Object3D & { instanceMatrix?: { array?: { byteLength?: number } } };
    bytes += instanced.instanceMatrix?.array?.byteLength ?? 0;
    return bytes;
  };
  // ENGINE r4: "first draw" is judged per D3D EXECUTABLE, not per material.
  // ANGLE builds a program's executables on its first draw with a given
  // vertex layout (and, for a caster, its depth program's), so a material
  // whose programs and layout were already drawn into an output is cheap to
  // draw again — r3 counted every material as new, which throttled the
  // stage to one or three objects per frame for nothing.
  const layoutKeys = new WeakMap<object, string>();
  const layoutKey = (object: Object3D): string => {
    const r = object as Renderable & ShadowCaster & { geometry?: Mesh['geometry']; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
    const geometry = r.geometry;
    const kind = r.isSkinnedMesh ? 's' : r.isInstancedMesh ? `i${r.instanceColor ? 'c' : ''}` : r.isBatchedMesh ? 'b' : r.isPoints ? 'p' : r.isLine ? 'l' : r.isSprite ? 'x' : 'm';
    if (!geometry) return kind;
    let key = layoutKeys.get(geometry);
    if (key === undefined) {
      const parts: string[] = [];
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const a = attribute as { array?: { constructor?: { name?: string } }; itemSize?: number; normalized?: boolean; isInterleavedBufferAttribute?: boolean };
        parts.push(`${name}:${a.array?.constructor?.name ?? '?'}:${a.itemSize ?? 0}:${a.normalized ? 1 : 0}${a.isInterleavedBufferAttribute ? 'x' : ''}`);
      }
      parts.sort();
      const index = geometry.index as { array?: { constructor?: { name?: string } } } | null;
      key = `${parts.join(',')}|${index?.array?.constructor?.name ?? '-'}|${Object.keys(geometry.morphAttributes).length}`;
      layoutKeys.set(geometry, key);
    }
    return `${kind}|${key}`;
  };
  const programSetKey = (material: Material): string => {
    const programs = (propertiesOf(gl).get(material) as { programs?: Map<string, { id?: number }> }).programs;
    if (!programs || programs.size === 0) return `m:${material.uuid}`;
    const ids: number[] = [];
    for (const program of programs.values()) ids.push(program.id ?? -1);
    return ids.sort((a, b) => a - b).join(',');
  };
  const drawKeys = (object: Object3D, output: number): string[] => {
    const layout = layoutKey(object);
    const keys: string[] = [];
    for (const material of materialsOf(object)) {
      keys.push(`${programSetKey(material)}|${layout}`);
      if (output === 0 && object.castShadow) keys.push(`d|${material.side}|${material.alphaTest > 0 ? 1 : 0}|${layout}`);
    }
    return keys;
  };
  const drawnKeys = new Map<number, Set<string>>();
  /** Executables of `object` not yet drawn into `output` (marks them drawn). */
  const newMaterials = (object: Object3D, output: number): number => {
    let seen = drawnKeys.get(output);
    if (seen === undefined) {
      seen = new Set<string>();
      drawnKeys.set(output, seen);
    }
    let fresh = 0;
    for (const key of drawKeys(object, output)) {
      if (seen.has(key)) continue;
      seen.add(key);
      fresh += 1;
    }
    return fresh;
  };
  /** Executables of `object` not yet drawn into `output` (read only). */
  const pendingFresh = (object: Object3D, output: number): number => {
    const seen = drawnKeys.get(output);
    let fresh = 0;
    for (const key of drawKeys(object, output)) if (seen === undefined || !seen.has(key)) fresh += 1;
    return fresh;
  };
  const bufferSlice = (): number => {
    if (bufferQueue === null) {
      // POKEMON-CORE C5 / A1 step 5: every latch actor is visible before the
      // first buffer slice (a hidden one is a warm stage error, R4).
      assertLatchVisible();
      const list: Object3D[] = [];
      scene.traverseVisible((object) => {
        if (isRenderable(object)) list.push(object);
      });
      // ENGINE r3: every output a real frame can draw into, the start rung's
      // first. A program's first draw into an output builds its D3D
      // executables for that vertex layout and render-target layout
      // synchronously in the ANGLE GPU process (a Chrome trace: nine
      // `D3DCompile` calls, 0.24 s, on the GPU main thread at the first
      // lower-rung pose — a 0.3 s compositor freeze). Here each is paid in
      // its own small chunk.
      bufferQueue = outputs().flatMap((_, output) => list.map((object) => ({ object, output })));
    }
    if (bufferQueue.length === 0) return 0;
    // ENGINE r4 (CAR r3 cadence): a slice is up to WARM_BUFFER_NEW_MATERIALS
    // DRAWS, each carrying at most WARM_BUFFER_DRAW_NEW_MATERIALS first-drawn
    // material(s) and flushed on its own, so the GPU process runs each as its
    // own task (a D3D executable build is 10-35 ms) and the compositor is
    // scheduled between them — r3 packed three into one 42-55 ms GPU task.
    const started = performance.now();
    let draws = 0;
    let freshDraws = 0;
    let stepBytes = 0;
    while (bufferQueue.length > 0 && draws < WARM_BUFFER_DRAWS_PER_STEP) {
      if (draws > 0 && (performance.now() - started >= WARM_COMPILE_BUDGET_MS || stepBytes >= WARM_BUFFER_BYTES_PER_FRAME)) break;
      // At most WARM_BUFFER_NEW_MATERIALS draws with a first-drawn material
      // per step (each builds D3D executables); draws of materials already
      // drawn there are cheap and fill the rest of the step.
      const head = bufferQueue[0];
      const stepFresh = deps.veiled?.() === true ? VEILED_WARM.freshDrawsPerStep : freshBudget;
      if (freshDraws >= stepFresh && pendingFresh(head.object, head.output) > 0) break;
      const drawn = bufferDraw(WARM_BUFFER_BYTES_PER_FRAME - stepBytes);
      stepBytes += drawn.bytes;
      if (drawn.count > 0) draws += 1;
      if (drawn.fresh > 0) freshDraws += 1;
    }
    deps.signal('buffers', buffersDone);
    signalPrograms();
    noteOrigins('buffers');
    return bufferQueue.length;
  };

  /** One buffer draw (see `bufferSlice`); returns the renderables it drew and its first-drawn materials. */
  const bufferDraw = (byteBudget: number): { count: number; fresh: number; bytes: number } => {
    if (bufferQueue === null || bufferQueue.length === 0) return { count: 0, fresh: 0, bytes: 0 };
    const output = bufferQueue[0].output;
    const chunk: Object3D[] = [];
    let bytes = 0;
    let fresh = 0;
    const veiled = deps.veiled?.() === true;
    const perDraw = veiled ? VEILED_WARM.freshPerDraw : WARM_BUFFER_DRAW_NEW_MATERIALS;
    while (
      bufferQueue.length > 0 &&
      bufferQueue[0].output === output &&
      (chunk.length === 0 || (bytes < byteBudget && fresh + pendingFresh(bufferQueue[0].object, output) <= perDraw))
    ) {
      const item = bufferQueue.shift();
      if (!item || item.object.parent === null) continue;
      const itemBytes = geometryBytes(item.object, output);
      const itemFresh = newMaterials(item.object, output);
      // ENGINE-FIX (D32): behind the theme veil an object with nothing new
      // for this output — its geometry uploaded and every executable it
      // draws with built (a palette swap re-uses the first load's) — is not
      // drawn again: a swap's buffers stage re-drew the whole world in one
      // 0.24-0.28 s draw for nothing.
      if (veiled && itemBytes === 0 && itemFresh === 0) {
        buffersDone += 1;
        continue;
      }
      bytes += itemBytes;
      fresh += itemFresh;
      chunk.push(item.object);
    }
    if (chunk.length === 0) return { count: 0, fresh: 0, bytes };
    const lights: Object3D[] = [];
    scene.traverse((object) => {
      if ((object as Light).isLight === true) lights.push(object);
    });
    const saved: { object: Object3D; mask: number; culled: boolean }[] = [];
    for (const object of [...chunk, ...lights]) saved.push({ object, mask: object.layers.mask, culled: object.frustumCulled });
    const source = camera as Camera & { near?: number; far?: number };
    bufferCamera.position.copy((camera as PerspectiveCamera).position);
    bufferCamera.quaternion.copy((camera as PerspectiveCamera).quaternion);
    if (typeof source.near === 'number') bufferCamera.near = source.near;
    if (typeof source.far === 'number') bufferCamera.far = source.far;
    bufferCamera.updateProjectionMatrix();
    bufferCamera.updateMatrixWorld(true);
    bufferCamera.layers.set(WARM_BUFFER_LAYER);
    const target = outputs()[output] ?? outputs()[0];
    let drawTarget = bufferTargets.get(output);
    if (drawTarget === undefined) {
      drawTarget = drawTargetFor(target, 16, 16);
      bufferTargets.set(output, drawTarget);
    }
    // ENGINE r3: the shadow pass draws the chunk too (its casters only: the
    // shadow pass tests the same camera layer). The first shadow draw of
    // every caster used to land in pose 1 as one whole-scene batch, and on
    // ANGLE / D3D11 a program's first draw with a new vertex layout builds
    // its D3D executable synchronously in the GPU process: a 0.3-0.39 s
    // compositor freeze at the start of the poses stage (r3 probes). The
    // map's contents are scratch here — pose 1 and every real frame redraw
    // the whole map.
    const shadowAuto = gl.shadowMap.autoUpdate;
    const shadowNeeds = gl.shadowMap.needsUpdate;
    gl.shadowMap.autoUpdate = false;
    // The shadow pass is the same for every output: the start rung's only.
    // ENGINE r4: and only when the draw carries a caster (each shadow draw
    // clears the whole map).
    gl.shadowMap.needsUpdate = gl.shadowMap.enabled && output === 0 && chunk.some((object) => object.castShadow);
    try {
      for (const object of chunk) {
        object.layers.enable(WARM_BUFFER_LAYER);
        object.frustumCulled = false;
      }
      for (const light of lights) light.layers.enable(WARM_BUFFER_LAYER);
      intoOutput(
        target,
        () => {
          gl.clear(true, true, false);
          deps.rawRender(scene, bufferCamera);
        },
        drawTarget,
      );
    } catch {
      // A lost context: the deadline resolves it.
    } finally {
      for (const entry of saved) {
        entry.object.layers.mask = entry.mask;
        entry.object.frustumCulled = entry.culled;
      }
      gl.shadowMap.autoUpdate = shadowAuto;
      gl.shadowMap.needsUpdate = shadowNeeds;
    }
    buffersDone += chunk.length;
    // ENGINE r4: its own GPU task (see `bufferSlice`).
    flushGpu();
    return { count: chunk.length, fresh, bytes };
  };

  /** Programs whose first-use work ran (`primeSlice`). */
  const primed = new WeakSet<object>();
  const primeSlice = (): number => {
    const started = performance.now();
    let remaining = 0;
    let done = 0;
    for (const program of programs() as (ProgramLike & { getUniforms?: () => unknown; getAttributes?: () => unknown })[]) {
      if (primed.has(program) || isStaleProgram(program)) continue;
      if (typeof program.isReady === 'function' && !program.isReady()) continue; // still linking: a later slice
      if (done > 0 && performance.now() - started >= WARM_PRIME_BUDGET_MS) {
        remaining += 1;
        continue;
      }
      primed.add(program);
      done += 1;
      try {
        program.getUniforms?.();
        program.getAttributes?.();
      } catch {
        // A lost context: the deadline resolves it.
      }
    }
    if (done > 0) {
      primedCount += done;
      deps.signal('primed', primedCount);
    }
    return remaining;
  };
  let primedCount = 0;

  /** ROLLOUT-PLAN E3: one banded step of a giant face (allocation through the un-deferred `initTexture`). */
  let bandSteps = 0;
  const uploadBandStep = (texture: Texture) => {
    bandSteps += 1;
    return stepBandedUpload(gl, texture, BAND_MAX_BYTES, (target) => uploadNow(gl, target));
  };

  /**
   * ROLLOUT-PLAN E3/E6: one banded step of a registered giant face on a frame
   * the warm spends WAITING for complete content (no compile open yet, so the
   * GPU main thread is idle between the ceremony's own frames). The faces
   * paint early (the paint queue), so their bands land here instead of
   * lengthening the textures stage. At most one step (≤ 2 MiB) per frame.
   */
  let earlyBandSteps = 0;
  const earlyBandSlice = (): void => {
    for (const texture of bandedCandidates()) {
      if (texture.image == null || texture.version === 0 || textureOnGpu(gl, texture)) continue;
      try {
        uploadBandStep(texture);
      } catch {
        uploadFailed.add(texture);
      }
      earlyBandSteps += 1;
      flushGpu();
      return;
    }
  };

  const textureSlice = (): number => {
    if (textures === null) {
      const all = new Set<Texture>();
      scene.traverse((object) => {
        const material = (object as Object3D & { material?: Material | Material[] }).material;
        if (!material) return;
        for (const entry of Array.isArray(material) ? material : [material]) materialTextures(entry, all);
      });
      const background = scene.background as unknown as Texture | null;
      if (background !== null && background.isTexture === true && background !== scene.environment) all.add(background);
      for (const texture of deferredUploads(gl)) all.add(texture);
      textures = [...all];
    }
    // ENGINE r4: an outside upload deferred AFTER the list was built (a
    // board's pages arriving mid-warm) joins it — the settle stage requires
    // this list empty, so nothing deferred can outlive the warm.
    for (const texture of deferredUploads(gl)) if (!textures.includes(texture)) textures.push(texture);
    const started = performance.now();
    let done = 0;
    let stepBytes = 0;
    const byteCap = deps.veiled?.() !== true && linksPending() ? WARM_TEXTURE_BYTES_WHILE_LINKING : WARM_TEXTURE_BYTES_PER_STEP;
    while (textures.length > 0) {
      const texture = textures[0];
      if (textureOnGpu(gl, texture)) {
        textures.shift();
        continue;
      }
      if (done > 0 && performance.now() - started >= GUARD_TEXTURE_BUDGET_MS) break;
      // ROLLOUT-PLAN E3: a giant painted face goes up in bands, at most
      // BAND_MAX_BYTES per step, and stays at the head of the list until its
      // last band has landed (the fence spaces the steps, one per frame).
      const banded = bandedUploadWanted(texture);
      // R6: the GPU side too — at least one texture, then no more than
      // WARM_TEXTURE_BYTES_PER_STEP behind it (the fence spaces the steps).
      const bytes = banded ? nextBandedStepBytes(texture) : textureUploadBytes(texture);
      if (done > 0 && stepBytes + bytes > byteCap) break;
      stepBytes += bytes;
      done += 1;
      if (banded) {
        let complete = true;
        try {
          complete = uploadBandStep(texture).done;
        } catch {
          uploadFailed.add(texture);
        }
        flushGpu();
        if (!complete) break;
        textures.shift();
        uploads += 1;
        continue;
      }
      textures.shift();
      try {
        uploadNow(gl, texture);
        uploads += 1;
        // ENGINE r4: each upload (and its mip build) its own GPU task.
        flushGpu();
      } catch {
        uploadFailed.add(texture);
      }
    }
    deps.signal('uploads', uploads);
    noteOrigins('textures');
    return textures.length;
  };

  let screenCompiled = false;
  let screenMaterialCount = -1;
  /** R6: texture steps run inside the compile stage (`uploadWhileLinking`; trace). */
  let earlyUploads = 0;
  const passSlice = (): number => {
    if (passQueue === null) {
      passQueue = deps.passes().map((entry) => ({ entry, compiled: false }));
      screenCompiled = false;
    }
    const head = passQueue[0];
    if (!head) {
      if (screenCompiled) return 0;
      // Last step: the screen variants of the terminal pass (see `screenMaterials`).
      screenCompiled = true;
      const materials = deps.screenMaterials?.() ?? [];
      screenMaterialCount = materials.length;
      if (materials.length === 0) return 0;
      const previous = gl.getRenderTarget();
      const face = gl.getActiveCubeFace();
      const mip = gl.getActiveMipmapLevel();
      try {
        gl.setRenderTarget(null);
        for (const material of materials) proxyScene.add(new Mesh(fullscreen, material));
        gl.compile(proxyScene, ortho, proxyScene);
      } catch {
        // The first real frame links it instead.
      } finally {
        proxyScene.clear();
        gl.setRenderTarget(previous, face, mip);
      }
      signalPrograms();
      noteOrigins('pass-screen');
      // One more frame so the machine waits for these links too.
      return 1;
    }
    if (!head.compiled) {
      // Step 1: link the pass's materials without a draw, a few per frame
      // under the same link cap as the scene compile.
      if (head.pending === undefined) {
        head.pending = [...head.entry.materials()];
        passSteps += 1;
        deps.signal('passSteps', passSteps);
      }
      const allowed = warmLinkBudget(frameIntervalMs, linksInFlight(), linkCap.cap);
      if (allowed <= 0) return passQueue.length;
      const before = programs().length;
      while (head.pending.length > 0 && programs().length - before < allowed) {
        const material = head.pending.shift();
        if (!material) break;
        try {
          intoScratch(() => {
            proxyScene.add(new Mesh(fullscreen, material));
            gl.compile(proxyScene, ortho, proxyScene);
          });
        } catch {
          // The render below (or the first frame) links it instead.
        } finally {
          proxyScene.clear();
        }
      }
      if (head.pending.length === 0) head.compiled = true;
      signalPrograms();
      noteOrigins(`pass-compile:${head.entry.key}`);
      return passQueue.length;
    }
    // Step 2, on a later frame once the links landed: render it once.
    if (linksPending()) return passQueue.length;
    passQueue.shift();
    try {
      head.entry.warm?.();
    } catch {
      // The first real frame draws (and links) it instead.
    }
    passesDone += 1;
    deps.signal('passes', passesDone);
    signalPrograms();
    noteOrigins(`pass-render:${head.entry.key}`);
    // The screen step (below, on the next call) is still owed.
    return passQueue.length + (screenCompiled ? 0 : 1);
  };

  const poseSlice = (): number => {
    if (poseQueue === null) {
      // ENGINE r3: the lower rungs' outputs too (a governor step's first
      // frames drew every program's first use there: a 0.4 s task at 1->2).
      const poses = deps.poses();
      poseQueue = outputs().flatMap((_, output) => poses.map((pose) => ({ pose, output })));
      posesDone = 0;
    }
    if (poseQueue.length === 0) return 0;
    // ENGINE-FIX (D32): behind the theme veil only the FIRST pose (the
    // start rung's output, station 0) is rendered. A swap's programs,
    // shadow variants, uploads, first-draw buffers (every output) and passes
    // are warmed by the stages before this; that first pose exercises the
    // shadow pass (its casters' maps: skipped, the first real frame after
    // the arm paid 0.14 s there), and the other poses only re-drew the world
    // the first load already drew from every station (0.1-0.3 s of the
    // opaque hold). The quiet probe's sweep / jump legs after a swap judge it.
    if (deps.veiled?.() === true && posesDone > 0) {
      poseQueue.length = 0;
      return 0;
    }
    // Paced (ENGINE r2): a pose is a whole-scene draw; on a frame that shows
    // the GPU still busy, wait a frame instead of queueing another behind it.
    // Not behind the theme veil (ENGINE-FIX, D32): nothing there to keep smooth.
    if (posesDone > 0 && frameIntervalMs >= WARM_FRAME_SLOW_MS && deps.veiled?.() !== true) return poseQueue.length;
    const next = poseQueue.shift();
    if (!next) return 0;
    const pose = next.pose;
    const canvasWidth = Math.max(1, gl.domElement.width);
    const canvasHeight = Math.max(1, gl.domElement.height);
    const width = Math.max(1, Math.round(canvasWidth * WARM_POSE_SCALE));
    const height = Math.max(1, Math.round(canvasHeight * WARM_POSE_SCALE));
    const output = outputs()[next.output] ?? outputs()[0];
    let drawTarget = poseTargets.get(next.output);
    if (drawTarget === undefined) {
      drawTarget = drawTargetFor(output, width, height);
      poseTargets.set(next.output, drawTarget);
    } else if (drawTarget.width !== width || drawTarget.height !== height) drawTarget.setSize(width, height);
    const source = camera as Camera & { near?: number; far?: number };
    poseCamera.position.set(pose.position.x, pose.position.y, pose.position.z);
    poseCamera.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    poseCamera.fov = pose.fov;
    poseCamera.aspect = canvasWidth / canvasHeight;
    if (typeof source.near === 'number') poseCamera.near = source.near;
    if (typeof source.far === 'number') poseCamera.far = source.far;
    poseCamera.layers.mask = camera.layers.mask;
    poseCamera.updateProjectionMatrix();
    poseCamera.updateMatrixWorld(true);
    // The shadow pass (its depth programs, casters' buffers, the map
    // itself) is exercised by the first pose; the later ones reuse the map,
    // so each pose is one main-pass draw of GPU work, not two.
    const shadowAuto = gl.shadowMap.autoUpdate;
    if (posesDone > 0) gl.shadowMap.autoUpdate = false;
    try {
      intoOutput(
        output,
        () => {
          // The composer parks `autoClear` off: clear so every pose depth-tests
          // against its own frame (a stale depth would cull what it must draw).
          gl.clear(true, true, false);
          deps.rawRender(scene, poseCamera);
        },
        drawTarget,
      );
    } catch {
      // A lost context: the deadline resolves it.
    } finally {
      gl.shadowMap.autoUpdate = shadowAuto;
    }
    posesDone += 1;
    deps.signal('poses', posesDone);
    signalPrograms();
    noteOrigins(`pose:${posesDone}`);
    return poseQueue.length;
  };

  // ENGINE r4: GPU backpressure (see `LoadWarmIO.gpuIdle`). WebGL2 fences
  // only; a WebGL1 context paces by the frame interval alone, as before.
  const context = (gl.getContext?.() ?? null) as WebGL2RenderingContext | null;
  const fences = context !== null && typeof context.fenceSync === 'function' && typeof context.getSyncParameter === 'function';
  let fence: WebGLSync | null = null;
  let fencedAt = 0;
  let fenceWaits = 0;
  /** ENGINE r4: no new GPU work before this time (the duty-cycle rest after a heavy step). */
  let restUntil = 0;
  let restFrames = 0;
  /** ENGINE r4: first-drawn materials the next `buffers` step may carry (adaptive, see `gpuIdle`). */
  let freshBudget = WARM_BUFFER_NEW_MATERIALS;
  let fencePolls = 0;
  const gpuIdle = (): boolean => {
    const now = performance.now();
    pollTimers();
    // ENGINE r4: the frame interval is the rAF interval, measured on EVERY
    // frame (a frame skipped for the fence is still a frame): measured
    // between warm steps it read every fenced step as a slow frame, and the
    // pose pacing then waited forever.
    tickFrame(now);
    // ENGINE-FIX (D32): behind the opaque veil the fence is not waited on.
    if (deps.veiled?.() === true) {
      if (fence !== null && context !== null) {
        try {
          context.deleteSync(fence);
        } catch {
          // A lost context: nothing to release.
        }
      }
      fence = null;
      fencePolls = 0;
      return true;
    }
    if (fence === null || context === null) {
      if (now < restUntil) {
        restFrames += 1;
        return false;
      }
      return true;
    }
    let signaled = false;
    try {
      signaled = context.getSyncParameter(fence, context.SYNC_STATUS) === context.SIGNALED;
    } catch {
      signaled = true;
    }
    if (!signaled && now - fencedAt < WARM_FENCE_MAX_MS) {
      fenceWaits += 1;
      fencePolls += 1;
      return false;
    }
    // Adaptive first-draw budget (additive increase, halving decrease): a
    // step whose GPU work finished by the next frame was light, one that
    // needed more frames was heavy (D42 N8: `nextFreshBudget`, cap 2).
    freshBudget = nextFreshBudget(freshBudget, fencePolls, now - fencedAt);
    fencePolls = 0;
    try {
      context.deleteSync(fence);
    } catch {
      // A lost context: nothing to release.
    }
    fence = null;
    // The step kept the GPU busy for about `busy` ms (to the poll's frame
    // granularity). A heavy one is followed by a rest of the same length, so
    // the warm never holds more than about half of the GPU main thread — the
    // thread the compositor draws the ceremony on (ANGLE / D3D11 builds a
    // program's first-draw executables there, 15-35 ms each).
    const busy = now - fencedAt;
    if (WARM_GPU_REST_FACTOR > 0 && busy >= WARM_GPU_HEAVY_MS) {
      restUntil = now + Math.min(WARM_FENCE_MAX_MS, busy * WARM_GPU_REST_FACTOR);
      restFrames += 1;
      return false;
    }
    return true;
  };
  // ENGINE r5: per-step GPU time (see `LoadWarmIO.gpuTimerBegin`).
  const timerExt = (() => {
    if (deps.gpuTiming !== true) return null;
    try {
      return context !== null ? (context.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
    } catch {
      return null;
    }
  })();
  let activeTimer: { query: WebGLQuery; sink: { gpuMs?: number } } | null = null;
  let lastTimer: { query: WebGLQuery; sink: { gpuMs?: number } } | null = null;
  const pendingTimers: { query: WebGLQuery; sink: { gpuMs?: number } }[] = [];
  let gpuMsTotal = 0;
  let gpuMsMax = 0;
  let gpuSteps = 0;
  /** The last resolved step's GPU time (ms), null before any (or without the extension). */
  let lastGpuMs: number | null = null;
  const gpuTimerBegin = (): void => {
    if (timerExt === null || context === null || activeTimer !== null) return;
    try {
      const query = context.createQuery();
      if (query === null) return;
      context.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
      activeTimer = { query, sink: {} };
    } catch {
      activeTimer = null;
    }
  };
  const gpuTimerEnd = (): void => {
    if (timerExt === null || context === null || activeTimer === null) return;
    try {
      context.endQuery(timerExt.TIME_ELAPSED_EXT);
      pendingTimers.push(activeTimer);
      lastTimer = activeTimer;
    } catch {
      // A lost context: the query is gone with it.
    }
    activeTimer = null;
  };
  const pollTimers = (): void => {
    if (timerExt === null || context === null || pendingTimers.length === 0) return;
    let disjoint = false;
    try {
      disjoint = Boolean(context.getParameter(timerExt.GPU_DISJOINT_EXT));
    } catch {
      disjoint = true;
    }
    while (pendingTimers.length > 0) {
      const head = pendingTimers[0];
      let available = false;
      try {
        available = Boolean(context.getQueryParameter(head.query, context.QUERY_RESULT_AVAILABLE));
      } catch {
        available = true;
      }
      if (!available) break;
      pendingTimers.shift();
      try {
        if (!disjoint) {
          const ms = Number(context.getQueryParameter(head.query, context.QUERY_RESULT)) / 1e6;
          head.sink.gpuMs = Math.round(ms * 10) / 10;
          lastGpuMs = ms;
          gpuMsTotal += ms;
          gpuMsMax = Math.max(gpuMsMax, ms);
          gpuSteps += 1;
        }
        context.deleteQuery(head.query);
      } catch {
        // A lost context: nothing to read.
      }
    }
  };

  const fenceGpu = (): void => {
    if (!fences || context === null || fence !== null) return;
    try {
      fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
      fencedAt = performance.now();
      context.flush();
    } catch {
      fence = null;
    }
  };

  // ENGINE r4: data faces (see `LoadWarmIO.facesSlice`).
  let faceUploads = 0;
  let facesReadyCount = -1;
  const facesSlice = (): number => {
    const list = deps.faces?.() ?? [];
    let notReady = 0;
    const started = performance.now();
    let uploadedNow = 0;
    let stepBytes = 0;
    for (const face of list) {
      if (!face.painted || !faceShown(face.object)) {
        notReady += 1;
        continue;
      }
      let missing = false;
      for (const texture of face.textures) {
        if (textureOnGpu(gl, texture)) continue;
        const banded = bandedUploadWanted(texture);
        const bytes = banded ? nextBandedStepBytes(texture) : textureUploadBytes(texture);
        if (uploadedNow > 0 && (performance.now() - started >= GUARD_TEXTURE_BUDGET_MS || stepBytes + bytes > WARM_TEXTURE_BYTES_PER_STEP)) {
          missing = true;
          continue;
        }
        stepBytes += bytes;
        try {
          // ROLLOUT-PLAN E3: a giant face lands one banded step at a time.
          if (banded) uploadBandStep(texture);
          else uploadNow(gl, texture);
          uploadedNow += 1;
          faceUploads += 1;
        } catch {
          // A lost context: the deadline resolves it.
        }
        if (!textureOnGpu(gl, texture)) missing = true;
      }
      if (missing) notReady += 1;
    }
    if (uploadedNow > 0) deps.signal('uploads', uploads + faceUploads);
    const ready = list.length - notReady;
    if (ready !== facesReadyCount) {
      facesReadyCount = ready;
      deps.signal('faces', ready);
    }
    return notReady;
  };

  // ENGINE r4: the post chain's targets (see `LoadWarmIO.targetSlice`).
  const clearedTargets = new WeakSet<object>();
  let targetsCleared = 0;
  const targetSlice = (): number => {
    const list = (deps.renderTargets?.() ?? []).filter((target) => !clearedTargets.has(target) && target.width > 1 && target.height > 1);
    const next = list[0];
    if (next === undefined) return 0;
    clearedTargets.add(next);
    const previous = gl.getRenderTarget();
    const face = gl.getActiveCubeFace();
    const mip = gl.getActiveMipmapLevel();
    try {
      gl.setRenderTarget(next);
      gl.clear(true, next.depthBuffer, next.stencilBuffer);
    } catch {
      // A lost context: the deadline resolves it.
    } finally {
      gl.setRenderTarget(previous, face, mip);
    }
    flushGpu();
    targetsCleared += 1;
    deps.signal('passes', passesDone + targetsCleared);
    return list.length - 1;
  };

  return {
    gpuIdle,
    fenceGpu,
    gpuTimerBegin,
    gpuTimerEnd,
    bindGpuSink: (sink: { gpuMs?: number }) => {
      if (lastTimer === null) return;
      // Carry a result that already landed; otherwise the poll fills it in.
      if (lastTimer.sink.gpuMs !== undefined) sink.gpuMs = lastTimer.sink.gpuMs;
      lastTimer.sink = sink;
      lastTimer = null;
    },
    facesSlice,
    targetSlice,
    prepare: () => {
      issuedThisFrame = false;
      const now = performance.now();
      // A caller without `gpuIdle` (tests, a WebGL1 context) measures here.
      if (lastPrepareAt === null || now - lastPrepareAt > 1) tickFrame(now);
      linkCap = stepLinkCap(linkCap, frameIntervalMs);
      runWarmPrepare(scene, camera, gl);
    },
    collect,
    compileSlice,
    laterSlice,
    linksPending,
    uploadWhileLinking: () => {
      // Only once the compile gate opened on complete content (a texture
      // listed before its image arrived must never be skipped by the warm),
      // and never on a frame that already put translations on the GPU.
      if (issuedThisFrame) return;
      // ROLLOUT-PLAN E6: still waiting for the content — band the giant faces.
      if (compileOpenedAt === null || !deps.contentComplete()) {
        earlyBandSlice();
        return;
      }
      earlyUploads += textureSlice() >= 0 ? 1 : 0;
    },
    contentComplete: deps.contentComplete,
    shadowSlice,
    verifySlice,
    textureSlice,
    primeSlice,
    bufferSlice,
    passSlice,
    poseSlice,
    requestFrame: deps.requestFrame,
    frameDrawn: deps.frameDrawn,
    programCount: () => {
      noteOrigins('frame');
      return programs().length;
    },
    programOrigins: () => [...origins].map(([key, origin]) => ({ ...origin, key })),
    compileOpenedAt: () => compileOpenedAt,
    compileGateOpen: () => lastGateOpen,
    frameStats: () => ({ frameMs: Math.round(frameIntervalMs * 10) / 10, cap: linkCap.cap }),
    dispose: () => {
      if (fence !== null && context !== null) {
        try {
          context.deleteSync(fence);
        } catch {
          // A lost context: nothing to release.
        }
        fence = null;
      }
      scratch.dispose();
      screenScratch.dispose();
      for (const target of poseTargets.values()) target.dispose();
      for (const target of bufferTargets.values()) target.dispose();
      fullscreen.dispose();
      proxyScene.clear();
    },
    report: () => ({
      variants: seenKeys.size,
      compiledVariants,
      uploads,
      poses: posesDone,
      passes: passesDone,
      verifyPasses,
      verifyCreated,
      buffers: buffersDone,
      evicted,
      screenMaterials: screenMaterialCount,
      signature,
      signatureLog: signatureLog.slice(),
      pmrem: pmrem === null ? null : pmrem.materials.length,
      fenceWaits,
      restFrames,
      freshBudget,
      targetsCleared,
      faceUploads,
      bandSteps,
      earlyBandSteps,
      facesReady: facesReadyCount,
      earlyUploadSteps: earlyUploads,
      gpu: timerExt === null ? null : { steps: gpuSteps, totalMs: Math.round(gpuMsTotal), maxMs: Math.round(gpuMsMax * 10) / 10, lastMs: lastGpuMs === null ? null : Math.round(lastGpuMs * 10) / 10 },
    }),
  };
}

import {
  type Camera,
  CubeReflectionMapping,
  CubeRefractionMapping,
  EquirectangularReflectionMapping,
  EquirectangularRefractionMapping,
  type Material,
  type Mesh,
  type Object3D,
  type Scene,
  type Texture,
  type ToneMapping,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { textureOnGpu } from './compile-guard';
import type { WarmPose } from './compile-variants';
import type { LoadWarmIO, WarmPostPass } from './load-warm';

/**
 * Types and helpers of the load warm's three.js IO: environment readiness,
 * warm outputs, render targets and data faces.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

/** three's `materialNeedsLights` (WebGLRenderer): the lit materials whose key carries the light counts. */
export function materialNeedsLights(material: Material): boolean {
  const m = material as Material & {
    isMeshLambertMaterial?: boolean;
    isMeshToonMaterial?: boolean;
    isMeshPhongMaterial?: boolean;
    isMeshStandardMaterial?: boolean;
    isShadowMaterial?: boolean;
    isShaderMaterial?: boolean;
    lights?: boolean;
  };
  return (
    m.isMeshLambertMaterial === true ||
    m.isMeshToonMaterial === true ||
    m.isMeshPhongMaterial === true ||
    m.isMeshStandardMaterial === true ||
    m.isShadowMaterial === true ||
    (m.isShaderMaterial === true && m.lights === true)
  );
}

/** The PMREMGenerator internals the pre-link drives (three r185; guarded by a try). */
export interface PmremInternals {
  _setSize(cubeSize: number): void;
  _allocateTargets(): WebGLRenderTarget;
  _lodMeshes?: Mesh[];
  _equirectMaterial?: Material | null;
  _cubemapMaterial?: Material | null;
  _ggxMaterial?: Material | null;
  _blurMaterial?: Material | null;
}

export function isCubeMapping(texture: Texture): boolean {
  return texture.mapping === CubeReflectionMapping || texture.mapping === CubeRefractionMapping;
}

/** A texture the renderer turns into a PMREM when it is a scene environment. */
export function isPmremSource(texture: Texture): boolean {
  return (
    isCubeMapping(texture) ||
    texture.mapping === EquirectangularReflectionMapping ||
    texture.mapping === EquirectangularRefractionMapping
  );
}

/**
 * ENGINE-FIX: the environment's shape as three's program key sees it — its
 * mapping and source size (the PMREM cube-UV height follows the size), never
 * its identity. Two maps of one shape give every program the same key.
 */
export function environmentShape(texture: Texture): string {
  const image = texture.image as { width?: number; height?: number; length?: number } | null | undefined;
  const size = image == null ? '0' : isCubeMapping(texture) ? `c${image.length ?? 0}` : `${image.width ?? 0}x${image.height ?? 0}`;
  return `${texture.mapping}/${size}`;
}

/** Whether a signature's point-light field (`count/shadowed`) rose from `before` to `after`. Exported for tests. */
export function pointCountRose(before: string | undefined, after: string | undefined): boolean {
  const count = (field: string | undefined) => Number.parseInt((field ?? '0').split('/')[0] ?? '0', 10) || 0;
  return count(after) > count(before);
}

/** The key-relevant part of a scene signature's environment field (`uuid:ready:shape`, or '-'). Exported for tests. */
export function envProgramState(field: string | undefined): string {
  if (field === undefined || field === '-') return '-';
  const parts = field.split(':');
  return parts.slice(1).join(':');
}

/** The environment's pixels are there (three builds no PMREM before; the program keys differ). */
export function environmentReady(texture: Texture): boolean {
  if ((texture as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true) return true;
  const image = texture.image as { height?: number; length?: number } | null | undefined;
  if (image == null) return false;
  if (isCubeMapping(texture)) return typeof image.length === 'number' && image.length === 6;
  return typeof image.height === 'number' && image.height > 0;
}

/**
 * ENGINE r3: an output a real frame of this session can draw the scene into.
 * three keys every scene program on its output (tone mapping + colour space
 * of the bound target): `hdr` is the composer's linear, un-tone-mapped HDR
 * buffer (rungs with post); `screen` is the default framebuffer with the
 * renderer's own operator (the post-off rungs: ACES, sRGB). r3 rung-2 cold
 * load: the warm compiled only the `hdr` variant, so the first real frame at
 * a post-off rung linked every scene program synchronously (a 9.4 s task)
 * and the stall detector sent the load to Lite.
 */
export interface WarmOutput {
  kind: 'hdr' | 'screen';
  /** The renderer operator a `screen` output draws with (ignored for `hdr`). */
  toneMapping: ToneMapping;
}

/** The distinct outputs of `paths` (start rung first), deduplicated by program key. */
export function warmOutputsFor(paths: readonly { composer: boolean; toneMapping: ToneMapping }[]): WarmOutput[] {
  const out: WarmOutput[] = [];
  for (const path of paths) {
    const next: WarmOutput = path.composer ? { kind: 'hdr', toneMapping: path.toneMapping } : { kind: 'screen', toneMapping: path.toneMapping };
    if (out.some((entry) => entry.kind === next.kind && (entry.kind === 'hdr' || entry.toneMapping === next.toneMapping))) continue;
    out.push(next);
  }
  return out;
}

export interface LoadWarmDeps {
  gl: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  /** Assets idle AND residency complete for the warm's generation. */
  contentComplete: () => boolean;
  /**
   * The compile may start (the loading manager went idle once: the
   * environment map and the GLBs that bring lights are in). Compiling before
   * it minted programs for a light count and an environment the scene no
   * longer has by its first frame (plaza r1: 18 -> 20 point lights, envMap
   * none -> PMREM): every lit program linked twice, the second time
   * synchronously inside a pose render (8 s frames).
   */
  compileReady?: () => boolean;
  /** The frozen station poses (the landed endpoints), in route order. */
  poses: () => readonly WarmPose[];
  /** Draw without the canvas's hold wrapper (pose renders are offscreen, never counted as frames). */
  rawRender: (scene: Scene, camera: Camera) => void;
  requestFrame: () => void;
  frameDrawn: () => boolean;
  /** The post passes to warm (already filtered by `postPassesToWarm`). */
  passes: () => readonly WarmPostPass[];
  /**
   * The materials that draw to the SCREEN (the composer's terminal pass):
   * compiled for the default framebuffer too, since the output colour space
   * is part of the key (r2: the trailing CopyPass linked on the first frame).
   */
  screenMaterials?: () => readonly Material[];
  /** Progress signals for the stall detector (name, monotone value). */
  signal: (name: string, value: number) => void;
  /**
   * ENGINE r3: every output a real frame of this session can draw into, the
   * START rung's first (see `WarmOutput`). The compile and verify stages
   * compile every variant for each; the buffer and pose renders draw into
   * the first. Default: the composer's `hdr` buffer only.
   */
  outputs?: () => readonly WarmOutput[];
  /**
   * ENGINE r4: the mounted data faces (residency-store `dataFaceEntries`,
   * read through): painted, their content mesh, and every texture they will
   * sample. Default: none.
   */
  faces?: () => readonly WarmDataFace[];
  /** ENGINE r5: time each step on the GPU (timer queries; trace runs only). */
  gpuTiming?: boolean;
  /** ENGINE r4: the post chain's render targets (see `LoadWarmIO.targetSlice`). Default: none. */
  renderTargets?: () => readonly WebGLRenderTarget[];
  /**
   * ENGINE-FIX (D32): the warm runs behind the OPAQUE theme veil (a day/night
   * swap of a live world). Nothing it does can be seen — the veil is a static
   * sheet — so the per-frame budgets that keep a VISIBLE ceremony smooth are
   * lifted (`VEILED_WARM`), and no compiled variant is evicted on a light
   * change: the palette the visitor left keeps its programs, so swapping back
   * links nothing. Default: never veiled.
   */
  veiled?: () => boolean;
}

/**
 * Render targets reachable from a post chain object (the composer, its
 * passes and their effects): a shallow, bounded walk like `passMaterials`.
 */
export function renderTargetsOf(root: object, depth = 8): WebGLRenderTarget[] {
  const found = new Set<WebGLRenderTarget>();
  const visited = new WeakSet<object>();
  const walk = (value: unknown, level: number) => {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const node = value as {
      isWebGLRenderTarget?: boolean;
      isRenderTarget?: boolean;
      isTexture?: boolean;
      isMaterial?: boolean;
      isObject3D?: boolean;
      isCamera?: boolean;
      isBufferGeometry?: boolean;
      isWebGLRenderer?: boolean;
      domElement?: unknown;
    };
    if (node.isWebGLRenderTarget === true || node.isRenderTarget === true) {
      found.add(value as WebGLRenderTarget);
      return;
    }
    if (node.isTexture || node.isMaterial || node.isObject3D || node.isCamera || node.isBufferGeometry || node.isWebGLRenderer || node.domElement !== undefined) return;
    if (level <= 0) return;
    const entries: unknown[] = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const entry of entries) walk(entry, level - 1);
  };
  walk(root, depth);
  return [...found];
}

/** One data face as the warm checks it (see `LoadWarmDeps.faces`). */
export interface WarmDataFace {
  id: string;
  painted: boolean;
  object: Object3D | null;
  textures: readonly Texture[];
}

/** The face is shown: mounted under a scene and visible up its whole parent chain. */
export function faceShown(object: Object3D | null): boolean {
  if (object === null) return false;
  let node: Object3D | null = object;
  let root: Object3D | null = null;
  while (node !== null) {
    if (!node.visible) return false;
    root = node;
    node = node.parent;
  }
  return (root as (Object3D & { isScene?: boolean }) | null)?.isScene === true;
}

/**
 * ENGINE r5 (trace only): why a data face is or is not ready for the warm —
 * the first hidden node up its chain (or `no-scene` when it is detached) and
 * how many of its textures are on the GPU. `__routeWorldRenderPath().dataFaces`.
 */
export function describeDataFace(
  gl: WebGLRenderer,
  face: Pick<WarmDataFace, 'object' | 'textures'>,
): { shown: boolean; hiddenAt: string | null; onGpu: number } {
  let hiddenAt: string | null = null;
  let node: Object3D | null = face.object;
  let root: Object3D | null = null;
  while (node !== null) {
    if (!node.visible && hiddenAt === null) hiddenAt = node.name || node.type;
    root = node;
    node = node.parent;
  }
  if (face.object === null) hiddenAt = 'no-object';
  else if (hiddenAt === null && (root as (Object3D & { isScene?: boolean }) | null)?.isScene !== true) hiddenAt = 'no-scene';
  let onGpu = 0;
  for (const texture of face.textures) if (textureOnGpu(gl, texture)) onGpu += 1;
  return { shown: faceShown(face.object), hiddenAt, onGpu };
}

export interface LoadWarmIOHandle extends LoadWarmIO {
  /** ENGINE r4: always implemented by the three.js IO (see `LoadWarmIO.facesSlice`). */
  facesSlice(): number;
  /** ENGINE r5: attach the last step's GPU time (when it resolves) to `sink.gpuMs` (trace). */
  bindGpuSink(sink: { gpuMs?: number }): void;
  /** Release the scratch targets and the proxy geometry. */
  dispose(): void;
  /** Trace readout. */
  report(): {
    variants: number;
    compiledVariants: number;
    uploads: number;
    poses: number;
    passes: number;
    verifyPasses: number;
    verifyCreated: number;
    buffers: number;
    evicted: number;
    screenMaterials: number;
    signature: string | null;
    signatureLog: { t: number; signature: string }[];
    pmrem: number | null;
    /** ENGINE r4: frames the warm skipped waiting on its GPU fence. */
    fenceWaits: number;
    /** ENGINE r4: frames the warm rested after a heavy GPU step. */
    restFrames: number;
    /** ENGINE r4: the adaptive first-draw budget now. */
    freshBudget: number;
    /** ENGINE r4: post-chain targets bound and cleared before the first real frame. */
    targetsCleared: number;
    /** ENGINE r4: data-face textures the warm uploaded itself. */
    faceUploads: number;
    /** ROLLOUT-PLAN E3: banded upload steps of giant painted faces (≤ 2 MiB each). */
    bandSteps: number;
    /** ROLLOUT-PLAN E6: of those, steps run while the warm waited for complete content. */
    earlyBandSteps: number;
    /** ENGINE r4: data faces ready at the last check (−1 before). */
    facesReady: number;
    /** R6: texture-upload steps run inside the compile stage (`uploadWhileLinking`). */
    earlyUploadSteps: number;
    gpu: { steps: number; totalMs: number; maxMs: number; lastMs: number | null } | null;
  };
  /** Debug trace: every program's cache key with the warm stage it first appeared in. */
  programOrigins(): { stage: string; name: string; key: string }[];
  /** When the compile gate first opened (content complete, program state still), null before. */
  compileOpenedAt(): number | null;
  /** Whether the compile gate was open at its last check (ENGINE-FIX: the veiled multi-step host). */
  compileGateOpen(): boolean;
  /** The last frame interval the warm saw and its adaptive link cap (trace). */
  frameStats(): { frameMs: number; cap: number };
}

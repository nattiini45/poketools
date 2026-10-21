import {
  BackSide,
  type Camera,
  DoubleSide,
  FrontSide,
  InstancedMesh,
  type Light,
  type Material,
  Mesh,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  type Object3D,
  Scene,
  type Side,
  SkinnedMesh,
  type Texture,
  VSMShadowMap,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { noteWarmStat, warmStatsOn } from '../perf/warm-stats';
import type { ProgramLike, PropertiesLike } from './compile-guard';

/**
 * The shadow-variant warm (`compileShadowVariants`).
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

// ── Shadow-variant warm (review r5, W6 (a)) ──────────────────────────────
//
// `compile()` builds each material's MAIN-pass program only. The shadow pass
// draws casters with its own depth / distance materials, whose programs vary
// per caster (skinning, morph targets, instancing, alpha-test map, side), and
// three builds them on first DRAW — a synchronous link inside the frame: the
// r4 traces measured 25–52 ms per variant after the reveal, and a first try at
// this round (one forced draw of the whole scene, hidden content shown, into a
// 1×1 target) blocked the plaza's hidden canvas for 9.7 s on 11 new variants.
//
// So the variants are built the way `compile()` builds main-pass programs —
// without drawing: for every shadow caster a proxy (same geometry, same
// skinned / instanced kind) carries the exact depth material the shadow map
// would derive for it (`WebGLShadowMap.getDepthMaterial`: side, alpha map /
// test, map, displacement, clipping), and ONE `compile(proxies, camera,
// scene)` against the real scene's lights prepares them. Under
// KHR_parallel_shader_compile that is non-blocking; the program cache is
// keyed on the parameters, so the shadow pass's own material later picks up
// the already-linked program. Proxies are deduplicated by variant, and their
// materials are kept (never disposed — a dispose would release the shared
// program before the shadow pass ever used it).
//
// Three callers: the first-frame warm (every caster in the scene, hidden
// pre-mounts included — `programsWarm` then waits for them to link, bounded by
// the reveal cap), the warm-pass scan (casters of freshly seen materials,
// before a pre-mounted group is shown) and the compile guard (a held
// newcomer is released only once its shadow programs are linked too).
// Without the parallel-compile extension nothing is pre-built (the compile
// itself would block); only meshes are covered (shadow-casting lines and
// points keep first-use compiles).

/** Debug readout of the first-frame shadow warm (`window.__warmGuard`). */
export interface WarmRenderReport {
  ms: number;
  programsBefore: number;
  programsAfter: number;
  casters: number;
  variants: number;
}

export let lastWarmRender: WarmRenderReport | null = null;

/** The renderer surface the shadow warm touches (a WebGLRenderer fits). */
export type ShadowWarmRenderer = Pick<
  WebGLRenderer,
  'compile' | 'getRenderTarget' | 'setRenderTarget' | 'getActiveCubeFace' | 'getActiveMipmapLevel' | 'shadowMap' | 'info' | 'properties'
>;

/** Per renderer: the 1×1 target a screen-time compile borrows (never drawn into). */
const warmTargets = new WeakMap<object, WebGLRenderTarget>();

function programCount(gl: Pick<WebGLRenderer, 'info'>): number {
  return ((gl.info as unknown as { programs?: unknown[] | null }).programs ?? []).length;
}

const SHADOW_SIDE: Record<number, Side> = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };

type ShadowBase = 'depth' | 'distance';
type DepthLike = MeshDepthMaterial | MeshDistanceMaterial;

/** Per renderer: variant key → the kept proxy material. */
const shadowVariants = new WeakMap<object, Map<string, Material>>();

/** Which shadow materials the scene's casting lights need (effectively visible lights). */
function shadowBases(scene: Object3D): ShadowBase[] {
  let depth = false;
  let distance = false;
  scene.traverseVisible((object) => {
    const light = object as Light & { isPointLight?: boolean };
    if (light.isLight !== true || !light.castShadow) return;
    if (light.isPointLight === true) distance = true;
    else depth = true;
  });
  const bases: ShadowBase[] = [];
  if (depth) bases.push('depth');
  if (distance) bases.push('distance');
  return bases;
}

export type ShadowCaster = Mesh & {
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  instanceColor?: InstancedMesh['instanceColor'];
  morphTexture?: InstancedMesh['morphTexture'];
  customDepthMaterial?: Material;
  customDistanceMaterial?: Material;
};

type SourceMaterial = Material & {
  alphaMap?: Texture | null;
  map?: Texture | null;
  displacementMap?: Texture | null;
  displacementScale?: number;
  displacementBias?: number;
  wireframe?: boolean;
  wireframeLinewidth?: number;
  linewidth?: number;
};

function textureKey(texture: Texture | null | undefined): string {
  if (!texture) return '-';
  return `${texture.channel}${(texture as Texture & { isVideoTexture?: boolean }).isVideoTexture ? 'v' : ''}`;
}

/** The variant key: everything the shadow program's cache key can see. */
function shadowVariantKey(caster: ShadowCaster, material: SourceMaterial, base: ShadowBase, vsm: boolean, custom: Material | undefined): string {
  const geometry = caster.geometry;
  const morph = geometry.morphAttributes;
  const kind = caster.isSkinnedMesh
    ? 'skin'
    : caster.isInstancedMesh
      ? `inst${caster.instanceColor ? 'c' : ''}${caster.morphTexture ? 'm' : ''}`
      : 'mesh';
  const side = material.shadowSide !== null ? material.shadowSide : vsm ? material.side : SHADOW_SIDE[material.side];
  const alphaTest = material.alphaToCoverage === true ? 0.5 : material.alphaTest;
  // three r185 folds the presence of position (hasPositionAttribute) and
  // normal (vertexNormals) into every program key, depth programs included.
  const attributes = ['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3']
    .filter((name) => geometry.getAttribute(name) !== undefined)
    .join('');
  return [
    base,
    kind,
    custom ? `custom:${custom.uuid}` : '',
    side,
    alphaTest > 0 ? 'at' : '',
    textureKey(material.alphaMap),
    textureKey(material.map),
    material.displacementMap && material.displacementScale !== 0 ? 'disp' : '',
    Object.entries(morph as Record<string, readonly unknown[] | undefined>)
      .map(([name, list]) => `${name}${list?.length ?? 0}`)
      .join(','),
    geometry.morphTargetsRelative ? 'rel' : '',
    attributes,
    material.clipShadows && Array.isArray(material.clippingPlanes) ? material.clippingPlanes.length : 0,
  ].join('|');
}

/** The depth material the shadow map would derive for `material` (getDepthMaterial). */
function deriveShadowMaterial(material: SourceMaterial, base: ShadowBase, vsm: boolean): DepthLike {
  const result: DepthLike = base === 'distance' ? new MeshDistanceMaterial() : new MeshDepthMaterial();
  result.visible = material.visible;
  // `wireframe` is draw state (not part of the program key); set where it exists.
  (result as DepthLike & { wireframe?: boolean }).wireframe = material.wireframe === true;
  result.side = material.shadowSide !== null ? material.shadowSide : vsm ? material.side : SHADOW_SIDE[material.side];
  result.alphaMap = material.alphaMap ?? null;
  result.alphaTest = material.alphaToCoverage === true ? 0.5 : material.alphaTest;
  result.map = material.map ?? null;
  result.clipShadows = material.clipShadows;
  result.clippingPlanes = material.clippingPlanes;
  result.clipIntersection = material.clipIntersection;
  result.displacementMap = material.displacementMap ?? null;
  result.displacementScale = material.displacementScale ?? 1;
  result.displacementBias = material.displacementBias ?? 0;
  return result;
}

/** A proxy of `caster`'s kind carrying `material` (same geometry; never drawn). */
function shadowProxy(caster: ShadowCaster, material: Material): Mesh {
  if (caster.isSkinnedMesh) {
    const proxy = new SkinnedMesh(caster.geometry, material);
    return proxy;
  }
  if (caster.isInstancedMesh) {
    const proxy = new InstancedMesh(caster.geometry, material, 1);
    proxy.instanceColor = caster.instanceColor ?? null;
    proxy.morphTexture = caster.morphTexture ?? null;
    return proxy;
  }
  return new Mesh(caster.geometry, material);
}

/**
 * Prepare (never draw) the shadow-pass programs of `casters` against
 * `scene`'s lights. Returns, per caster, the kept proxy materials whose
 * `currentProgram` is the variant the shadow pass will use. Empty when the
 * renderer has no parallel compile, shadows are off, or nothing casts.
 */
export function compileShadowVariants(
  gl: ShadowWarmRenderer,
  casters: Iterable<Object3D>,
  scene: Object3D,
  camera: Camera,
): Map<Object3D, Material[]> {
  const out = new Map<Object3D, Material[]>();
  if (gl.shadowMap?.enabled !== true) return out;
  const bases = shadowBases(scene);
  if (bases.length === 0) return out;
  const statsStarted = warmStatsOn() ? performance.now() : 0;
  const vsm = gl.shadowMap.type === VSMShadowMap;
  let variants = shadowVariants.get(gl);
  if (!variants) {
    variants = new Map();
    shadowVariants.set(gl, variants);
  }
  const proxies = new Scene();
  for (const object of casters) {
    const caster = object as ShadowCaster;
    if (caster.isMesh !== true || caster.isBatchedMesh === true || !caster.castShadow || !caster.material) continue;
    const materials = (Array.isArray(caster.material) ? caster.material : [caster.material]) as SourceMaterial[];
    const kept: Material[] = [];
    for (const material of materials) {
      if (!material.visible) continue;
      for (const base of bases) {
        const custom = base === 'distance' ? caster.customDistanceMaterial : caster.customDepthMaterial;
        const key = shadowVariantKey(caster, material, base, vsm, custom);
        let proxyMaterial = variants.get(key);
        if (!proxyMaterial) {
          proxyMaterial = custom ?? deriveShadowMaterial(material, base, vsm);
          variants.set(key, proxyMaterial);
          proxies.add(shadowProxy(caster, proxyMaterial));
        }
        kept.push(proxyMaterial);
      }
    }
    if (kept.length > 0) out.set(caster, kept);
  }
  if (statsStarted > 0) noteWarmStat('shadowCasters', out.size);
  if (proxies.children.length === 0) {
    if (statsStarted > 0) noteWarmStat('shadowVariantCalls', 1, performance.now() - statsStarted);
    return out;
  }
  // Match the shadow pass's program key exactly (verified against live cache
  // keys): it draws into the shadow maps — a render target, so linear output
  // and no tone mapping, with the renderer's own output colour space left as
  // is — and with a null scene, so no fog. On the screen target a 1×1 target
  // is bound for the compile and the previous binding restored (the shadow
  // pass itself re-binds targets the same way inside a render); the scene's
  // fog is lifted for the compile's duration only.
  const previous = gl.getRenderTarget();
  const cubeFace = gl.getActiveCubeFace();
  const mipLevel = gl.getActiveMipmapLevel();
  const host = scene as Scene;
  const fog = host.fog;
  let target: WebGLRenderTarget | null = null;
  if (previous === null) {
    target = warmTargets.get(gl) ?? new WebGLRenderTarget(1, 1);
    warmTargets.set(gl, target);
  }
  try {
    if (target) gl.setRenderTarget(target);
    host.fog = null;
    gl.compile(proxies, camera, host);
  } catch {
    // Half-built material / lost context: the shadow pass compiles on first use.
  } finally {
    host.fog = fog;
    if (target) gl.setRenderTarget(previous, cubeFace, mipLevel);
  }
  if (statsStarted > 0) noteWarmStat('shadowVariantCalls', 1, performance.now() - statsStarted);
  return out;
}

/** Shadow programs of `materials` (kept proxies), as compiled. */
export function shadowPrograms(gl: Pick<WebGLRenderer, 'properties'>, materials: readonly Material[]): ProgramLike[] {
  const properties = gl.properties as unknown as PropertiesLike;
  const programs: ProgramLike[] = [];
  for (const material of materials) {
    const program = properties.get(material).currentProgram;
    if (program) programs.push(program);
  }
  return programs;
}

/**
 * The first-frame shadow warm: every caster in the scene — hidden pre-mounted
 * content included — gets its shadow variants prepared (non-blocking).
 */
export function warmShadowVariants(gl: ShadowWarmRenderer, scene: Object3D, camera: Camera): WarmRenderReport {
  const started = performance.now();
  const programsBefore = programCount(gl);
  const casters: Object3D[] = [];
  scene.traverse((object) => {
    if ((object as Mesh).isMesh === true && object.castShadow) casters.push(object);
  });
  const prepared = compileShadowVariants(gl, casters, scene, camera);
  const variants = new Set<Material>();
  for (const list of prepared.values()) for (const material of list) variants.add(material);
  lastWarmRender = {
    ms: Math.round(performance.now() - started),
    programsBefore,
    programsAfter: programCount(gl),
    casters: prepared.size,
    variants: variants.size,
  };
  return lastWarmRender;
}

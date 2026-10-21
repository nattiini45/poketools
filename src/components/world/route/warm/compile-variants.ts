import {
  InstancedMesh,
  Line,
  type Material,
  Mesh,
  type Object3D,
  Points,
  ShaderMaterial,
  SkinnedMesh,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';
import { type Renderable, texturesOf } from './compile-guard';
import type { ShadowCaster } from './shadow-variants';

/**
 * Compile variant keys, compile weights and post-pass materials.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

/** A position / orientation / lens to render one station pose from. */
export interface WarmPose {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  fov: number;
}

/**
 * The variant key a compile proxy stands for: the material plus everything
 * of the OBJECT that three folds into the program key (kind, instancing
 * colour / morph, skinning, geometry morph targets and the extra UV sets).
 * Two renderables with the same key compile to the same program.
 */
export function compileVariantKey(object: Object3D, material: Material): string {
  const r = object as Renderable & ShadowCaster & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean; geometry?: Mesh['geometry'] };
  const kind = r.isSkinnedMesh
    ? 'skin'
    : r.isInstancedMesh
      ? `inst${r.instanceColor ? 'c' : ''}${r.morphTexture ? 'm' : ''}`
      : r.isBatchedMesh
        ? `batch:${object.uuid}`
        : r.isPoints
          ? 'points'
          : r.isLine
            ? 'line'
            : r.isSprite
              ? 'sprite'
              : 'mesh';
  const geometry = r.geometry;
  let geo = '';
  if (geometry && !r.isSprite) {
    const morph = geometry.morphAttributes as Record<string, readonly unknown[] | undefined>;
    geo = [
      Object.entries(morph)
        .map(([name, list]) => `${name}${list?.length ?? 0}`)
        .join(','),
      geometry.morphTargetsRelative ? 'rel' : '',
      ['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'tangent', 'color']
        .filter((name) => geometry.getAttribute(name) !== undefined)
        .map((name) => (name === 'color' ? `color${geometry.getAttribute(name).itemSize}` : name))
        .join(''),
    ].join('|');
  }
  return `${material.uuid}|${kind}|${geo}`;
}

/**
 * R6 E7: a relative estimate of what compiling (translating + linking) one
 * variant costs, for longest-processing-time-first ordering of the warm's
 * compile queue. The links run in parallel on the GPU process's workers
 * (up to WARM_MAX_LINKS_IN_FLIGHT); issued in traversal order, a heavy
 * lit / patched program met late links ALONE at the end of the stage while
 * every other worker idles (the R6 plaza trace: single D3DCompile tasks up to
 * 0.7 s). Issuing the heaviest first lets the light ones fill in behind them.
 * Only the ORDER changes — every variant is still compiled. Pure; unit-free.
 *
 * The estimate follows what grows an ANGLE program: the material family's
 * shader (physical > standard > phong/lambert/toon > basic), a custom
 * `onBeforeCompile` patch (the plaza's painted-light, ashlar, ground and
 * canopy programs), every sampled map (a define and a code path each),
 * skinning / morphs, and for a ShaderMaterial its own source length.
 */
export function compileWeight(object: Object3D, material: Material): number {
  const m = material as Material & {
    isMeshPhysicalMaterial?: boolean;
    isMeshStandardMaterial?: boolean;
    isMeshPhongMaterial?: boolean;
    isMeshLambertMaterial?: boolean;
    isMeshToonMaterial?: boolean;
    isMeshBasicMaterial?: boolean;
    isShaderMaterial?: boolean;
    vertexShader?: string;
    fragmentShader?: string;
    [slot: string]: unknown;
  };
  let weight: number;
  if (m.isShaderMaterial === true) weight = 4 + ((m.vertexShader?.length ?? 0) + (m.fragmentShader?.length ?? 0)) / 1000;
  else if (m.isMeshPhysicalMaterial === true) weight = 60;
  else if (m.isMeshStandardMaterial === true) weight = 45;
  else if (m.isMeshPhongMaterial === true || m.isMeshLambertMaterial === true || m.isMeshToonMaterial === true) weight = 30;
  else if (m.isMeshBasicMaterial === true) weight = 10;
  else weight = 8;
  // A patched program (own `onBeforeCompile`: painted light, ashlar, ground, canopy).
  if (Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')) weight += 20;
  for (const slot of COMPILE_WEIGHT_MAPS) {
    const value = m[slot] as { isTexture?: boolean } | null | undefined;
    if (value !== null && value !== undefined && value.isTexture === true) weight += 3;
  }
  const r = object as Renderable & ShadowCaster & { geometry?: Mesh['geometry']; morphTargetInfluences?: number[] };
  if (r.isSkinnedMesh === true) weight += 10;
  if (r.geometry && Object.keys(r.geometry.morphAttributes).length > 0) weight += 8;
  return weight;
}

/** The texture slots `compileWeight` counts (each is a define and a code path). */
const COMPILE_WEIGHT_MAPS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'lightMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'envMap',
  'clearcoatMap',
  'sheenColorMap',
  'transmissionMap',
] as const;

/** One memoised `compileVariantKey` result and the inputs it was built from (see `collect`). */
export interface VariantKeyMemo {
  material: Material;
  geometry: unknown;
  instanceColor: unknown;
  morphTexture: unknown;
  attributeCount: number;
  morphCount: number;
  key: string;
}

/** A compile proxy of `object`'s kind carrying `material` (same geometry; never drawn). */
export function compileProxy(object: Object3D, material: Material): Object3D | null {
  const r = object as Renderable & ShadowCaster & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
  if (r.isSkinnedMesh) return new SkinnedMesh(r.geometry, material);
  if (r.isInstancedMesh) {
    const proxy = new InstancedMesh(r.geometry, material, 1);
    proxy.instanceColor = r.instanceColor ?? null;
    proxy.morphTexture = r.morphTexture ?? null;
    return proxy;
  }
  if (r.isBatchedMesh) return null; // compiled as itself (see compileSlice)
  if (r.isPoints) return new Points(r.geometry, material);
  if (r.isLine) return new Line(r.geometry, material);
  if (r.isSprite) return material instanceof SpriteMaterial ? new Sprite(material) : null;
  if (r.isMesh) return new Mesh(r.geometry, material);
  return null;
}

/** Every texture a material samples, own slots and ShaderMaterial uniforms alike. */
export function materialTextures(material: Material, out: Set<Texture>): void {
  const list: Texture[] = [];
  texturesOf(material, list);
  for (const texture of list) out.add(texture);
  if (material instanceof ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      const value: unknown = uniform?.value;
      const values: unknown[] = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        if (entry !== null && typeof entry === 'object' && (entry as Texture).isTexture === true) out.add(entry as Texture);
      }
    }
  }
}

/**
 * Materials reachable from a post pass object (its fullscreen material and
 * the internal passes / materials of its effects): a shallow, bounded walk.
 * Best effort: a material it misses is linked by the warm's render of the
 * pass, or by the warm's first real frame. `exclude` MUST name the world's
 * own scene (N8AO keeps a reference to it): its materials are the scene
 * compile's business, and compiling them here against no lights would mint
 * junk programs.
 */
export function passMaterials(root: object, exclude: readonly object[] = [], depth = 5): Material[] {
  const found = new Set<Material>();
  const visited = new WeakSet<object>(exclude);
  const walk = (value: unknown, level: number) => {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const node = value as {
      isMaterial?: boolean;
      isTexture?: boolean;
      isWebGLRenderTarget?: boolean;
      isObject3D?: boolean;
      isCamera?: boolean;
      isBufferGeometry?: boolean;
      domElement?: unknown;
    };
    if (node.isMaterial === true) {
      found.add(value as Material);
      return;
    }
    if (node.isTexture || node.isWebGLRenderTarget || node.isCamera || node.isBufferGeometry || node.domElement !== undefined) return;
    if (node.isObject3D === true) {
      // A pass's fullscreen mesh / scene: its materials only.
      (value as Object3D).traverse((child) => {
        const material = (child as Object3D & { material?: unknown }).material;
        if (material) walk(material, level);
      });
      return;
    }
    if (level <= 0) return;
    const entries: unknown[] = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const entry of entries) walk(entry, level - 1);
  };
  walk(root, depth);
  return [...found];
}

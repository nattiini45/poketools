import * as THREE from 'three';

/**
 * D42 N9 (owner D47; the M4 clamp): bind a material's `envMap` and
 * `envMapRotation` to the scene environment, so the material's OWN
 * `envMapIntensity` reaches the shader.
 *
 * Why. three r163+ (here r185, `WebGLRenderer.js` setProgram) draws a
 * MeshStandardMaterial whose `envMap` is null under `scene.environment` with
 * `envMapIntensity = scene.environmentIntensity`, overwriting the material's
 * own value on every draw (`WebGLMaterials.js` reads `material.envMapIntensity`
 * only when the material has an `envMap`). So the nine data screens'
 * `envMapIntensity={0}` ("dead specular": no HDRI sheen over the black field)
 * never reached the shader — the sky's reflection lifted every face — and
 * `METAL_CLAMP`'s `envMapIntensityMax` (Figure.tsx) was inert on every figure.
 *
 * What. A bound material's `envMap` IS the scene's current environment (the
 * texture three uses for it unbound, so `environments.get(material.envMap ||
 * environment)` resolves to the same PMREM: identical program parameters and
 * key, D26 +0) and its `envMapRotation` IS the scene's `environmentRotation`
 * object (what three uses unbound, live by reference). Its `envMapIntensity`
 * stays a plain property: 0 on a data screen, ≤ 0.55 on a clamped metal.
 *
 * Never stale. The scene's `environment` / `environmentRotation` become
 * accessors whose setter re-points every bound material synchronously. An
 * environment swap — drei's `<Environment>` assigns the new texture and, in
 * the gap while the next HDRI loads, restores the previous value (null) — is
 * on every bound material before anything can compile or draw: no envMap
 * variant is compiled for an env-less scene, no retired HDRI is ever
 * sampled or re-prefiltered. Steady state: no per-frame work, no allocation.
 *
 * Why this shape. Accessors on the MATERIAL were the first design; V8 turns
 * an object whose data property is redefined as an accessor into a
 * dictionary-mode object, and a getter returning a computed double boxes a
 * HeapNumber per read (measured: 19 B per refresh). The materials stay
 * fast-mode objects here: their `envMap` is a plain data property, made
 * non-enumerable while bound (an attribute change V8 keeps in fast mode) so
 * the warm's `Object.values` texture scan (`useStationWarmup.ts`
 * `texturesOf`) never uploads the raw equirect as a 2D texture — three alone
 * prefilters it, as before. Only the scene (one object; pointer reads, no
 * per-frame stores of doubles) carries accessors, installed once per scene
 * and kept for its life.
 *
 * A clone of a bound material (`material.clone()`, e.g. an actor's
 * single-sided copy, `actor-programs.ts`) is bound to the same scene, never a
 * frozen snapshot of the environment of its clone moment; its binding is
 * released when it is disposed.
 *
 * Refcounted per material (figure materials are the GLTF cache's, shared by
 * every clone of a species); the last release restores the material's own
 * `envMap` (null, enumerable) and `envMapRotation`.
 *
 * Only a MeshStandardMaterial (Physical included) with no authored `envMap`
 * is bound; anything else is left alone (the release is a no-op).
 */

/** The scene a binding follows (a `THREE.Scene` in the app and in tests). */
export type EnvironmentScene = THREE.Scene;

interface SceneHub {
  environment: THREE.Texture | null;
  rotation: THREE.Euler;
  readonly materials: Set<THREE.MeshStandardMaterial>;
}

interface Binding {
  readonly scene: EnvironmentScene;
  readonly hub: SceneHub;
  count: number;
  /** The material's own Euler, restored at the last release. */
  readonly rotation: THREE.Euler;
  /** The material's own `clone` before binding (an own property, rarely). */
  readonly ownClone: (() => THREE.Material) | undefined;
}

const hubs = new WeakMap<object, SceneHub>();
const bindings = new WeakMap<THREE.Material, Binding>();

const NOOP = (): void => {};

/** The scene's hub: its `environment` / `environmentRotation` setters re-point every bound material. */
function hubFor(scene: EnvironmentScene): SceneHub {
  const existing = hubs.get(scene);
  if (existing) return existing;
  const hub: SceneHub = { environment: scene.environment, rotation: scene.environmentRotation, materials: new Set() };
  Object.defineProperty(scene, 'environment', {
    configurable: true,
    enumerable: true,
    get: () => hub.environment,
    set: (value: THREE.Texture | null) => {
      hub.environment = value;
      for (const material of hub.materials) material.envMap = value;
    },
  });
  Object.defineProperty(scene, 'environmentRotation', {
    configurable: true,
    enumerable: true,
    get: () => hub.rotation,
    set: (value: THREE.Euler) => {
      hub.rotation = value;
      for (const material of hub.materials) material.envMapRotation = value;
    },
  });
  hubs.set(scene, hub);
  return hub;
}

/** A material the binding applies to: standard / physical, no authored envMap. */
export function isEnvBindable(material: THREE.Material | null | undefined): material is THREE.MeshStandardMaterial {
  const standard = material as THREE.MeshStandardMaterial | null | undefined;
  return standard?.isMeshStandardMaterial === true && (bindings.has(standard) || standard.envMap === null);
}

/** Whether `material` is currently bound (tests, the debug readout). */
export function isEnvBound(material: THREE.Material): boolean {
  return bindings.has(material);
}

/**
 * Bind `material` to `scene` (the route scene). Returns the release (call
 * once; extra calls are no-ops). A material already bound to another scene
 * keeps its first one (one route scene per canvas; a dev warning).
 */
export function bindSceneEnvironment(material: THREE.Material, scene: EnvironmentScene): () => void {
  if (!isEnvBindable(material)) return NOOP;
  let binding = bindings.get(material);
  if (binding === undefined) {
    const hub = hubFor(scene);
    const ownClone = Object.prototype.hasOwnProperty.call(material, 'clone') ? (material.clone as () => THREE.Material) : undefined;
    const created: Binding = { scene, hub, count: 0, rotation: material.envMapRotation, ownClone };
    binding = created;
    // Hidden from `Object.values` while it holds the scene's HDRI (fast mode kept).
    Object.defineProperty(material, 'envMap', { enumerable: false });
    material.envMap = hub.environment;
    material.envMapRotation = hub.rotation;
    // A clone is bound too (same scene), released with the clone.
    const protoClone = Object.getPrototypeOf(material).clone as (this: THREE.Material) => THREE.Material;
    material.clone = function cloneBound(this: THREE.MeshStandardMaterial) {
      const copy = (created.ownClone ?? protoClone).call(this) as THREE.MeshStandardMaterial;
      // `copy` took the scene's texture and Euler: give it the authored ones, then bind it.
      copy.envMap = null;
      copy.envMapRotation.copy(created.rotation); // its own Euler (Material.copy copied into it)
      const release = bindSceneEnvironment(copy, scene);
      const onDispose = () => {
        copy.removeEventListener('dispose', onDispose);
        release();
      };
      copy.addEventListener('dispose', onDispose);
      return copy;
    } as typeof material.clone;
    hub.materials.add(material);
    bindings.set(material, binding);
  } else if (binding.scene !== scene && process.env.NODE_ENV !== 'production') {
    console.warn('[scene-env-binding] a material is bound to two scenes; it keeps the first');
  }
  binding.count += 1;
  const held = binding;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.count -= 1;
    if (held.count > 0 || bindings.get(material) !== held) return;
    bindings.delete(material);
    held.hub.materials.delete(material as THREE.MeshStandardMaterial);
    const standard = material as THREE.MeshStandardMaterial;
    standard.envMap = null;
    Object.defineProperty(standard, 'envMap', { enumerable: true });
    standard.envMapRotation = held.rotation;
    // Re-pointed, never deleted: deleting the own `clone` would drop the material into V8's dictionary mode.
    standard.clone = (held.ownClone ?? Object.getPrototypeOf(standard).clone) as typeof standard.clone;
  };
}

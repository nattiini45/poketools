import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import Atmosphere from '@/components/world/evoliga/route/env/Atmosphere';
import SunShafts from '@/components/world/evoliga/route/env/SunShafts';
import LampHalos from '@/components/world/evoliga/route/plaza/LampHalos';
import { ulpSafe } from './ulp-safe';

/**
 * ROLLOUT §2.6 "static identity", material half (B1 verifier fix 2): the
 * plaza's four generic layers — the painted sky dome, the skyline ring, the
 * rules shafts and the lamp halos — must build the SAME material state as
 * before the PLATFORM refactor: blending, depth, side, tone mapping, fog,
 * render order, program key, mesh flags and the skyline's day / night
 * uniforms. `plaza-programs-r6.test.ts` pins the sources; this pins the
 * state three keys and sorts the draw on.
 *
 * `__snapshots__/plaza-materials.r6.json` was written by THIS harness run
 * against the pre-refactor tree (`git archive a9d5fab7^`, i.e. 0cea2384),
 * through the plaza entry points that exist in both trees (`Atmosphere`,
 * `SunShafts`, plaza `LampHalos`). Never regenerate it from the current
 * code to make a test pass; a deliberate plaza look change is an AD seat's
 * job, with a new snapshot named for its round.
 *
 * The harness renders by calling: React's hooks are replaced by their
 * one-shot equivalents (a memo runs its factory, a layout effect runs its
 * body, passive effects and frames do nothing), and function components
 * are expanded until only host elements (`mesh`, `instancedMesh`,
 * `primitive`, …) remain.
 */

const env = vi.hoisted(() => ({ night: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(value: T) => ({ current: value }),
    useEffect: () => {},
    useLayoutEffect: (effect: () => void) => {
      effect();
    },
  };
  return { ...actual, ...hooks, default: { ...actual, ...hooks } };
});

vi.mock('@react-three/fiber', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useFrame: () => {},
}));

vi.mock('@react-three/drei', async (importOriginal) => {
  const three = await import('three');
  return { ...(await importOriginal<Record<string, unknown>>()), useTexture: () => new three.Texture() };
});

vi.mock('@/components/world/route/WorldStateProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorldState: () => ({
    conductor: { progress: { current: { smooth: 0 } } },
    sampleWorldState: () => ({ key: 1, fog: 0 }),
    theme: null,
    palette: {
      exposure: env.night ? 0.5 : 1,
      sky: '#6eb4e0',
      skyHorizon: '#efe2c8',
      sunColor: '#fff1c4',
      moonColor: '#fff4ee',
    },
  }),
}));

vi.mock('@/components/world/route/QualityGovernor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuality: () => ({ post: true, cloudTaps: 3, lightShafts: 3 }),
}));

vi.mock('@/lib/route-world/model-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/route-world/model-manifest')>();
  const manifest = { ...actual.EMPTY_MANIFEST, environment: [{ file: 'env/plaza/skyline.webp', kb: 1 }] };
  return { ...actual, useWorldManifest: () => manifest };
});

type Props = Record<string, unknown>;
type El = ReactElement<Props>;

/** Expand function components (by calling them) down to host elements, in tree order. */
function hostElements(node: ReactNode, out: El[] = []): El[] {
  if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) {
    for (const child of node) hostElements(child as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  if (typeof el.type === 'string') {
    out.push(el);
    return hostElements(el.props.children as ReactNode, out);
  }
  if (typeof el.type === 'function' && el.type !== ResidentSuspense) {
    return hostElements((el.type as (props: Props) => ReactNode)(el.props), out);
  }
  // Fragments, Suspense and ResidentSuspense: their children.
  return hostElements(el.props.children as ReactNode, out);
}

function uniformValue(value: unknown): unknown {
  if (value instanceof THREE.Texture) return 'texture';
  if (value instanceof THREE.Color) return ['color', ...value.toArray()];
  if (value instanceof THREE.Vector2 || value instanceof THREE.Vector3 || value instanceof THREE.Vector4) return value.toArray();
  if (Array.isArray(value)) return value.map(uniformValue);
  return value ?? null;
}

/**
 * Uniforms the refactor ADDED to the shared sky set for other worlds' night
 * presets (`uNightBand`: the starfield dusk band). The plaza's sky and
 * skyline programs never declare them, and three uploads only a program's
 * active uniforms, so they cannot reach a plaza pixel. They are dropped from
 * the comparison only after the program is shown not to declare them.
 */
const INERT_ADDED_UNIFORMS = ['uNightBand'];

/** Every uniform but the shared calm slots (a view-dependent singleton, not material state). */
function uniformState(material: THREE.ShaderMaterial): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = [material.vertexShader, material.fragmentShader].join('\n');
  for (const name of Object.keys(material.uniforms).sort()) {
    if (name.startsWith('uCalm')) continue;
    if (INERT_ADDED_UNIFORMS.includes(name)) {
      if (source.includes(name)) throw new Error(`${name} is declared by a plaza program: it is no longer inert`);
      continue;
    }
    out[name] = uniformValue(material.uniforms[name].value);
  }
  return out;
}

function materialState(material: THREE.Material) {
  const shader = material as THREE.ShaderMaterial;
  return {
    type: material.type,
    transparent: material.transparent,
    blending: material.blending,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    depthFunc: material.depthFunc,
    side: material.side,
    toneMapped: material.toneMapped,
    fog: shader.fog ?? null,
    alphaTest: material.alphaTest,
    colorWrite: material.colorWrite,
    premultipliedAlpha: material.premultipliedAlpha,
    defines: shader.defines ?? null,
    key: material.customProgramCacheKey(),
    paintExempt: material.userData.paintExempt ?? null,
  };
}

/** The drawable of a host element: its material and the mesh-level state three sorts and culls on. */
function drawable(el: El) {
  if (el.type === 'primitive') {
    const object = el.props.object as THREE.InstancedMesh;
    return {
      host: 'primitive',
      material: object.material as THREE.ShaderMaterial,
      mesh: {
        instanced: object.isInstancedMesh === true,
        renderOrder: object.renderOrder,
        frustumCulled: object.frustumCulled,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        name: object.name,
        count: object.count,
      },
    };
  }
  const args = el.props.args as unknown[] | undefined;
  const material = el.props.material ?? args?.[1];
  // Not a drawable (e.g. `fogExp2`, whose args are a colour and a density).
  if (!(material instanceof THREE.ShaderMaterial)) return null;
  return {
    host: el.type as string,
    material,
    mesh: {
      instanced: el.type === 'instancedMesh',
      renderOrder: el.props.renderOrder ?? null,
      frustumCulled: el.props.frustumCulled ?? null,
      name: el.props.name ?? null,
      fx: el.props['userData-fx'] ?? null,
      capacity: el.type === 'instancedMesh' ? (args?.[2] ?? null) : null,
      count: el.props.count ?? null,
    },
  };
}

function layerState(root: ReactNode) {
  return hostElements(root)
    .map((el) => {
      const d = drawable(el);
      if (!d) return null;
      return { host: d.host, mesh: d.mesh, material: materialState(d.material), uniforms: uniformState(d.material) };
    })
    .filter((layer) => layer !== null);
}

/** The four generic layers of the plaza, by day and by night (the only hook input that changes their state). */
function plazaMaterialState() {
  const out: Record<string, unknown> = {};
  for (const night of [false, true]) {
    env.night = night;
    const palette = night ? 'night' : 'day';
    out[`atmosphere.${palette}`] = layerState(Atmosphere());
    out[`shafts.${palette}`] = layerState(SunShafts());
    out[`halos.${palette}`] = layerState(LampHalos({ night }));
  }
  env.night = false;
  // JSON round-trip: the snapshot's own encoding (−0, undefined and NaN compare as stored).
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}

const SNAPSHOT = JSON.parse(readFileSync(path.join(__dirname, '__snapshots__', 'plaza-materials.r6.json'), 'utf8')) as {
  source: string;
  layers: Record<string, unknown>;
};

describe('PLATFORM static identity: plaza generic-layer material state vs the pre-refactor tree', () => {
  const current = plazaMaterialState();

  it('the snapshot covers the sky, skyline, shafts and halos by day and night', () => {
    expect(SNAPSHOT.source).toMatch(/^git archive a9d5fab7\^/);
    expect(Object.keys(SNAPSHOT.layers).sort()).toEqual(Object.keys(current).sort());
    const atmosphere = SNAPSHOT.layers['atmosphere.day'] as { host: string; mesh: { renderOrder: number } }[];
    // The sky dome (mesh, −10) and the skyline ring (primitive, −5).
    expect(atmosphere.map((layer) => [layer.host, layer.mesh.renderOrder])).toEqual([
      ['mesh', -10],
      ['primitive', -5],
    ]);
  });

  it.each(['day', 'night'])('the painted sky dome and the skyline ring (%s)', (palette) => {
    expect(current[`atmosphere.${palette}`]).toEqual(ulpSafe(SNAPSHOT.layers[`atmosphere.${palette}`]));
  });

  it.each(['day', 'night'])('the rules shafts (%s)', (palette) => {
    expect(current[`shafts.${palette}`]).toEqual(ulpSafe(SNAPSHOT.layers[`shafts.${palette}`]));
  });

  it.each(['day', 'night'])('the lamp halos (%s)', (palette) => {
    expect(current[`halos.${palette}`]).toEqual(ulpSafe(SNAPSHOT.layers[`halos.${palette}`]));
  });
});

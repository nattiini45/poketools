'use client';

import { Suspense, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import RouteWorldCanvas from '@/components/world/route/RouteWorldCanvas';
import CameraRig from '@/components/world/route/CameraRig';
import WorldEnvironment from '@/components/world/route/env/WorldEnvironment';
import PostStack from '@/components/world/route/post/PostStack';
import { useThemeTextureSet } from '@/components/world/route/env/ThemeTextureSet';
import ThemeFigures, { type FigureSlot } from '@/components/world/route/figures/ThemeFigures';
import { useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import Tree, { useTreeSkinMaterials } from '@/components/world/route/trees/Tree';
import { treeSkinById, type TreeSkin } from '@/lib/route-world/tree';
import { propUrl, useWorldManifest, type PropEntry } from '@/lib/route-world/model-manifest';
import type { ThemeFigurePlan } from '@/lib/route-world/figure-contract';
import ProbeBoard, { type ProbeBoardCopy } from './ProbeBoard';

/**
 * The C-100 probe scene — the one render surface that exercises the new
 * engine contracts against a LIVE canvas (vitest is node-env: no DOM/WebGL):
 *
 *  - criterion 1: `ThemeFigures` mounts rigged figures from BOTH plan
 *    sources (roster-driven aces + an arbitrary species pool, including a
 *    resolvable colossal — Mamoswine — a resolvable tiny — Pichu — and an
 *    unresolvable species that renders the billboard fallback).
 *  - criterion 2: `useThemeTextureSet('cobble')` consumes the theme's
 *    `textureRoles` declaration — the probe ground rides the resolved
 *    bucket set (the exact URLs the plaza union path yields), with a flat
 *    procedural fallback when the role is absent.
 *  - criterion 3: three `Tree` skins (sakura/mountain/clouds) — trunk +
 *    branch geometry, layered alpha-card canopy, wind.
 *  - criterion 4 (r2): two `ProbeBoard` LED panels painted through the
 *    shared `paintBoardPage` enforcement — sub-floor allocation clamped to
 *    the ≥2× floor, fonts floored at the pulse station's pose minimum
 *    (proof global `__probeBoardPaint`).
 *
 * A small instanced bollard ring keeps the render path's kit facade open
 * ([C-095 r1]: a world with no InstancedMesh never opens the present gate).
 */

/** Roster-driven source: per-"player" aces (the StatueRow declaration shape). */
const PROBE_ROSTER_PLAN: ThemeFigurePlan = {
  roster: [
    { id: 'probe-player-1', label: 'Mara Wells', species: 'Charizard', baseSpecies: 'Charmander' },
    { id: 'probe-player-2', label: 'Jonas Reed', species: 'Gengar', baseSpecies: 'Gastly' },
    { id: 'probe-player-3', label: 'Selin Ay', species: 'Serperior', baseSpecies: 'Snivy' },
    { id: 'probe-player-4', label: 'Toby Warren', species: 'Zoroark', baseSpecies: 'Zorua' },
  ],
};

/** Pool-driven source: an arbitrary species list, thresholds included. */
const PROBE_POOL_PLAN: ThemeFigurePlan = {
  pool: ['Mamoswine', 'Pichu', 'Pikachu', 'Garganacl', 'Arceus'],
};

const FIGURE_SLOTS: readonly FigureSlot[] = [
  { position: [9.5, 0, -0.8], yaw: Math.PI * 0.9 },
  { position: [10.9, 0, 0.3], yaw: Math.PI * 0.95 },
  { position: [12.3, 0, -0.6], yaw: Math.PI * 1.05 },
  { position: [13.7, 0, 0.5], yaw: Math.PI },
  { position: [9.8, 0, 1.8], yaw: Math.PI },
  { position: [11.4, 0, 2.1], yaw: Math.PI },
  { position: [12.9, 0, 1.9], yaw: Math.PI },
  { position: [14.3, 0, 2.0], yaw: Math.PI },
  { position: [12.1, 0, -1.9], yaw: Math.PI },
];

/** The three demo skins, each proving the shared tree system. */
const TREE_PLACEMENTS: readonly { skin: TreeSkin; position: readonly [number, number, number]; yaw: number; heightM: number; seed: number }[] = [
  { skin: treeSkinById('sakura'), position: [-13.2, 0, 1.2], yaw: 0.4, heightM: 5.2, seed: 101 },
  { skin: treeSkinById('sakura'), position: [-9.4, 0, -2.6], yaw: 2.1, heightM: 4.1, seed: 102 },
  { skin: treeSkinById('mountain'), position: [-11.8, 0, 4.6], yaw: 1.2, heightM: 5.8, seed: 201 },
  { skin: treeSkinById('mountain'), position: [-15.4, 0, -1.8], yaw: 3.4, heightM: 4.6, seed: 202 },
  { skin: treeSkinById('clouds'), position: [-8.2, 0, 3.8], yaw: 5.1, heightM: 4.4, seed: 301 },
  { skin: treeSkinById('clouds'), position: [-14.8, 0, -4.4], yaw: 0.9, heightM: 5.0, seed: 302 },
];

/** Stable reference: `useThemeTextureSet` memo-keys on it (see its doc). */
const PROBE_GROUND_REPEAT = [7, 7] as const;

/** Probe ground: the theme-declared cobble set, or the flat fallback. */
function ProbeGround() {
  const set = useThemeTextureSet('cobble', PROBE_GROUND_REPEAT);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[64, 64]} />
      {set ? (
        <meshStandardMaterial
          map={set.map}
          normalMap={set.normalMap ?? undefined}
          roughness={set.arm ? 0.85 : 0.9}
          metalness={0.04}
        />
      ) : (
        <meshStandardMaterial color="#5d6b52" roughness={0.95} metalness={0} />
      )}
    </mesh>
  );
}

/** One tree skin's painted material set, mounted over its placements. */
function ProbeTreeGroup({ skinId }: { skinId: string }) {
  const skin = useMemo(() => treeSkinById(skinId), [skinId]);
  const materials = useTreeSkinMaterials(skin);
  return (
    <>
      {TREE_PLACEMENTS.filter((placement) => placement.skin.id === skinId).map((placement, i) => (
        <Tree
          key={i}
          spec={{ skin: placement.skin, heightM: placement.heightM, seed: placement.seed }}
          position={placement.position}
          yaw={placement.yaw}
          materials={materials}
        />
      ))}
    </>
  );
}

const BOLLARD_COUNT = 12;
const BOLLARD_RING_R = 5.2;

/** Board copy pair — module constants so the paint effects run once per mount. */
const PROBE_BOARD_COPY: readonly ProbeBoardCopy[] = [
  {
    title: 'PULS',
    kicker: 'C-100 · SHARED PAINT PATH',
    line: 'Allocation clamped 1024x592 → floor',
    ticker: 'BOARD FLOOR ≥2× · FLOORS FROM POSE',
  },
  {
    title: 'FLOOR',
    kicker: 'C-100 · LEGIBILITY',
    line: 'Sub-floor request rejected by name',
    ticker: 'CLAMPED AT ALLOCATION · fontPx CLAMP',
  },
];

/** Instanced bollard ring — keeps the kit facade open ([C-095 r1]). */
function BollardRing() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < BOLLARD_COUNT; i += 1) {
      const a = (i / BOLLARD_COUNT) * Math.PI * 2;
      matrix.makeTranslation(Math.cos(a) * BOLLARD_RING_R, 0.35, Math.sin(a) * BOLLARD_RING_R);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, BOLLARD_COUNT]} name="probe-bollards" castShadow>
      <boxGeometry args={[0.24, 0.7, 0.24]} />
      <meshStandardMaterial color="#8a8577" roughness={0.8} metalness={0.1} />
    </instancedMesh>
  );
}

// --- Prop probe (additive): Blender-first prop gallery -----------------------
//
// Every new manifest prop mounted through
// the shared prop pipeline (useFigureGLTF over propUrl), named
// `probe-prop-<slug>` so the theme's declared `probe-` family prefix covers
// StaticBatcher merging. With `?propFocus=<slug>` in the URL the gallery is
// replaced by ONE prop at the pulse focal point (the per-asset still frame);
// the param is read via useSyncExternalStore with a null server snapshot
// ([C-092 r1]: no set-state-in-effect, no SSR mismatch). The five canonical
// probe stations in probe-theme.ts are untouched.

/** The C-107 Blender-authored props, by manifest slug. */
const PROBE_PROP_SLUGS: readonly string[] = [
  'sakura-torii-hero',
  'sakura-stone-lantern-tall',
  'sakura-stone-lantern-low',
  'mountain-ridge-arch',
  'mountain-cairn-small',
  'mountain-cairn-medium',
  'mountain-cairn-tall',
  'clouds-airship-hull',
  'clouds-halo-gate',
];

/**
 * Gallery crescent along the #teams sight line (cam [8.6, 2.6, -6.4] → target
 * [12, 1.1, 0.8]), beyond the figure row so the whole row reads in one still:
 * big heroes spaced wide, small pieces between. Scale 1: GLBs are metres.
 */
const PROBE_PROP_SPOTS: readonly (readonly [number, number, number])[] = [
  [13.2, 0, 3.3], // torii (5.7 m span)
  [14.2, 0, 4.4], // lantern tall
  [14.9, 0, 5.3], // cairn small
  [15.6, 0, 6.2], // lantern low
  [16.3, 0, 7.1], // cairn medium
  [17.0, 0, 8.0], // cairn tall
  [18.0, 0, 9.4], // halo gate (5.2 m)
  [19.5, 2.2, 11.3], // airship hull (8.5 m), at cruise height
  [22.0, 0, 14.4], // ridge arch (12.6 m)
];

const emptySubscribe = () => () => {};

function usePropFocusSlug(): string | null {
  return useSyncExternalStore(
    emptySubscribe,
    () => new URLSearchParams(window.location.search).get('propFocus'),
    () => null,
  );
}

/**
 * Per-slug focus spots on the pulse sight line: distance ≈ 2.2× the prop's
 * authored height so each asset fills ~55% of the 45° frame (small props
 * close to the camera, heroes far), with slight x offsets clear of the
 * bollard ring's (0, ·, ±5.2) posts.
 */
const PROBE_FOCUS_SPOTS: Record<string, readonly [number, number, number]> = {
  'sakura-torii-hero': [0, 0, 1.5],
  'sakura-stone-lantern-tall': [-0.3, 0, -0.7],
  'sakura-stone-lantern-low': [-0.3, 0, -2.6],
  'mountain-ridge-arch': [0, -0.8, 8.0],
  'mountain-cairn-small': [-1.2, 0, -3.2],
  'mountain-cairn-medium': [-0.9, 0, -3.0],
  'mountain-cairn-tall': [-0.6, 0, -2.8],
  'clouds-airship-hull': [0, 0.8, 2.0],
  'clouds-halo-gate': [0, 0, 1.2],
};

/** One prop GLB through the pipeline, seated + centred from RECORDED bounds (PB-166). */
function ProbePropModel({ entry }: { entry: PropEntry }) {
  const gltf = useFigureGLTF(propUrl(entry));
  const fitted = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    const { bounds } = entry;
    const cx = (bounds.min[0] + bounds.max[0]) / 2;
    const cz = (bounds.min[2] + bounds.max[2]) / 2;
    root.position.set(-cx, -bounds.min[1], -cz);
    return root;
  }, [gltf.scene, entry]);
  return <primitive object={fitted} />;
}

function ProbePropGallery({ focusSlug }: { focusSlug: string | null }) {
  const manifest = useWorldManifest();
  const entries = useMemo(
    () =>
      PROBE_PROP_SLUGS
        .map((slug) => manifest.props.find((prop) => prop.name === slug) ?? null)
        .filter((entry): entry is PropEntry => entry !== null),
    [manifest],
  );
  if (focusSlug !== null) {
    const focused = entries.find((entry) => entry.name === focusSlug);
    if (!focused) return null;
    const spot = PROBE_FOCUS_SPOTS[focused.name] ?? ([0, 0, 1.5] as const);
    return (
      <group position={[...spot]} name={`probe-prop-${focused.name}`}>
        <ProbePropModel entry={focused} />
      </group>
    );
  }
  return (
    <>
      {entries.map((entry, i) => (
        <group key={entry.name} position={PROBE_PROP_SPOTS[i % PROBE_PROP_SPOTS.length]} name={`probe-prop-${entry.name}`}>
          <ProbePropModel entry={entry} />
        </group>
      ))}
    </>
  );
}

export default function ProbeWorldScene() {
  const focusSlug = usePropFocusSlug();
  return (
    <RouteWorldCanvas>
      <CameraRig />
      <hemisphereLight args={['#dfe8f2', '#42503c', 0.85]} />
      <directionalLight position={[16.8, 21, 9.8]} intensity={2.4} castShadow />
      <Suspense fallback={null}>
        <WorldEnvironment />
      </Suspense>
      <Suspense fallback={null}>
        <ProbeGround />
      </Suspense>
      <ProbeTreeGroup skinId="sakura" />
      <ProbeTreeGroup skinId="mountain" />
      <ProbeTreeGroup skinId="clouds" />
      <Suspense fallback={null}>
        <ThemeFigures plan={PROBE_ROSTER_PLAN} slots={FIGURE_SLOTS.slice(0, 4)} />
      </Suspense>
      <Suspense fallback={null}>
        <ThemeFigures plan={PROBE_POOL_PLAN} slots={FIGURE_SLOTS.slice(4)} />
      </Suspense>
      <ProbeBoard position={[-2.6, 1.35, 0]} yaw={Math.PI} copy={PROBE_BOARD_COPY[0]} />
      <ProbeBoard position={[2.6, 1.35, 0]} yaw={Math.PI} copy={PROBE_BOARD_COPY[1]} />
      <BollardRing />
      <Suspense fallback={null}>
        <ProbePropGallery focusSlug={focusSlug} />
      </Suspense>
      <PostStack />
    </RouteWorldCanvas>
  );
}

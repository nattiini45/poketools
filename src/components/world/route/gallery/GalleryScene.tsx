'use client';

import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import RouteWorldCanvas from '@/components/world/route/RouteWorldCanvas';
import WorldEnvironment from '@/components/world/route/env/WorldEnvironment';
import PostStack, { POST_OFF_TONE_MAPPING } from '@/components/world/route/post/PostStack';
import Figure from '@/components/world/route/figures/Figure';
import { preloadFigure } from '@/components/world/route/figures/figure-loader';
import { findFigure } from '@/components/world/route/figures/figure-registry';
import { DormancyScope, ResidentSuspense, isResidencyComplete } from '@/components/world/route/residency-store';
import { getRenderedFrames, getRevealArmedAt } from '@/components/world/route/scene-progress';
import { compileHeldCount } from '@/components/world/route/useStationWarmup';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { routeAssetArm } from '@/lib/route-world/asset-base-override';
import { figureUrl, useWorldManifest } from '@/lib/route-world/model-manifest';
import {
  createGalleryApi,
  GALLERY_DEFAULT_POSE,
  type GalleryFigureFacts,
  type GalleryLook,
  type GalleryPose,
  type RouteGalleryApi,
} from './gallery-bridge';
import { boundsSphere, galleryCameraPose, orbitDirection, type GalleryBounds, type GalleryCameraPose } from './gallery-camera';
import { galleryFigureEntry } from './gallery-file';

/**
 * D42 gallery scene (dev-only, `?world=gallery&galleryFile=<path>`): ONE GLB
 * through the real `Figure` path (the same loader, promotion, consolidation,
 * fit and director registration every world figure gets), on the theme-token
 * backdrop, framed by its bounds. `window.__routeGallery` (gallery-bridge.ts)
 * poses it; captures use the canvas's own `__routeWorldPresent`.
 *
 * Looks: `world` mounts the engine's post stack (N8AO, bloom, SMAA, vignette,
 * AgX: what a visitor's rung-0 frame applies); `raw` unmounts it and renders
 * with the renderer's post-off operator (ACES), the post-off rungs' path.
 */

/** The figure's registry row id (and its group name). */
export const GALLERY_FIGURE_ID = 'route-gallery-figure';

const KEY_INTENSITY = 2.4;
const FILL_INTENSITY = 0.85;
/** The key sits this far (degrees) to the camera's right and above it, so every view is front-lit the same way. */
const KEY_AZIMUTH_OFFSET_DEG = 35;
const KEY_ELEVATION_OFFSET_DEG = 30;

// ── The look, shared by the stage (requests) and the post host (mounts) ────

interface LookStore {
  requested: GalleryLook;
  mounted: GalleryLook | null;
  listeners: Set<() => void>;
}

const lookStore: LookStore = { requested: GALLERY_DEFAULT_POSE.look, mounted: null, listeners: new Set() };

function requestLook(look: GalleryLook): void {
  if (lookStore.requested === look) return;
  lookStore.requested = look;
  for (const listener of lookStore.listeners) listener();
}

function subscribeLook(listener: () => void): () => void {
  lookStore.listeners.add(listener);
  return () => {
    lookStore.listeners.delete(listener);
  };
}

const readLook = (): GalleryLook => lookStore.requested;

/** The raw look's operator: the renderer's post-off ACES (the post-off rungs' path). */
function applyRawOperator(gl: THREE.WebGLRenderer): void {
  gl.toneMapping = POST_OFF_TONE_MAPPING;
}

/** Writes a framed view into the default camera (frozen until the next `set`). */
function writeGalleryCamera(camera: THREE.Camera, view: GalleryCameraPose): void {
  camera.position.set(view.position[0], view.position[1], view.position[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(view.target[0], view.target[1], view.target[2]);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = view.fov;
    camera.near = view.near;
    camera.far = view.far;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
}

/** Mounts the requested look; records it once committed (the bridge's `settled`). */
function GalleryLookHost() {
  const look = useSyncExternalStore(subscribeLook, readLook, readLook);
  const gl = useThree((state) => state.gl);
  useLayoutEffect(() => {
    // Raw: the post-off operator (PostStack's own layout effect sets the
    // composer path's operator when `world` mounts it again).
    if (look === 'raw') applyRawOperator(gl);
    lookStore.mounted = look;
    return () => {
      lookStore.mounted = null;
    };
  }, [gl, look]);
  return look === 'world' ? <PostStack /> : null;
}

// ── Failure capture ─────────────────────────────────────────────────────────

class GalleryErrorBoundary extends Component<{ onError: (message: string) => void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ── The present gate's kit anchor ───────────────────────────────────────────

/**
 * The present gate opens only for a world with an instanced kit module;
 * the gallery has none, so one hidden, empty InstancedMesh
 * stands in. Hidden and count 0: it never draws.
 */
function GalleryPresentAnchor() {
  const mesh = useMemo(() => {
    const anchor = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 1);
    anchor.count = 0;
    anchor.visible = false;
    anchor.name = 'route-gallery-present-anchor';
    return anchor;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );
  return <primitive object={mesh} />;
}

// ── The stage ───────────────────────────────────────────────────────────────

interface FigureMount {
  root: THREE.Object3D | null;
  size: readonly [number, number, number] | null;
  facts: GalleryFigureFacts | null;
}

function countFacts(root: THREE.Object3D, size: readonly [number, number, number]): GalleryFigureFacts {
  let triangles = 0;
  let meshes = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes += 1;
    const index = mesh.geometry.getIndex();
    const position = mesh.geometry.getAttribute('position');
    triangles += Math.floor((index ? index.count : (position?.count ?? 0)) / 3);
  });
  const fitted: GalleryBounds = { min: [-size[0] / 2, 0, -size[2] / 2], max: [size[0] / 2, size[1], size[2] / 2] };
  // `Figure` fits the clone as `position + scale · raw` (a parentless uniform
  // scale, then the grounding offset): the raw model-unit box is the inverse.
  const s = root.scale.x > 0 ? root.scale.x : 1;
  const p = root.position;
  const raw = (v: readonly [number, number, number]): [number, number, number] => [(v[0] - p.x) / s, (v[1] - p.y) / s, (v[2] - p.z) / s];
  return { triangles, meshes, bounds: { min: raw(fitted.min), max: raw(fitted.max) }, fittedBounds: fitted, clips: [] };
}

function presentGateOpen(): boolean {
  const bridge = (window as Window & { __routeWorldRenderPath?: () => { presentGate?: { held?: boolean } } }).__routeWorldRenderPath;
  if (typeof bridge !== 'function') return false;
  try {
    return bridge().presentGate?.held === false;
  } catch {
    return false;
  }
}

type GalleryHost = Window & { __routeGallery?: RouteGalleryApi };

function GalleryStage({ file }: { file: string }) {
  const manifest = useWorldManifest();
  const entry = useMemo(() => galleryFigureEntry(manifest, file), [manifest, file]);
  const url = figureUrl(entry);
  const { palette } = useWorldState();
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const mount = useRef<FigureMount>({ root: null, size: null, facts: null });
  const failure = useRef<string | null>(null);
  const [measured, setMeasured] = useState(false);
  const posedOnce = useRef(false);

  // Counted like every world preload: a failure reaches `failedFigureLoads`.
  useEffect(() => {
    preloadFigure(url);
  }, [url]);

  const onRoot = useCallback((root: THREE.Object3D | null) => {
    mount.current.root = root;
    mount.current.facts = null;
  }, []);
  const onMeasure = useCallback((size: readonly [number, number, number]) => {
    mount.current.size = size;
    mount.current.facts = null;
    setMeasured(true);
  }, []);
  const onError = useCallback((message: string) => {
    failure.current = message;
  }, []);

  const readFacts = useCallback((): GalleryFigureFacts | null => {
    const current = mount.current;
    if (current.root === null || current.size === null) return null;
    if (current.facts === null) current.facts = countFacts(current.root, current.size);
    const row = findFigure(GALLERY_FIGURE_ID);
    current.facts.clips = row?.clips ? [...row.clips] : [];
    return current.facts;
  }, []);

  const apply = useCallback(
    (pose: GalleryPose) => {
      const facts = readFacts();
      if (facts === null) return;
      // The camera (frozen between calls).
      const height = Math.max(1, gl.domElement.clientHeight || gl.domElement.height);
      const view = galleryCameraPose(facts.fittedBounds, pose, height);
      writeGalleryCamera(camera, view);
      // The key light keeps one place relative to the view.
      const light = keyLight.current;
      if (light) {
        const { center, radius } = boundsSphere(facts.fittedBounds);
        const dir = orbitDirection(pose.azimuthDeg + KEY_AZIMUTH_OFFSET_DEG, pose.elevationDeg + KEY_ELEVATION_OFFSET_DEG);
        light.position.set(center[0] + dir[0] * radius * 6, center[1] + dir[1] * radius * 6, center[2] + dir[2] * radius * 6);
        light.target.position.set(center[0], center[1], center[2]);
        light.updateMatrixWorld(true);
        light.target.updateMatrixWorld(true);
      }
      // The clip time: the resting action, at the asked fraction of its loop.
      const row = findFigure(GALLERY_FIGURE_ID);
      const action = row?.getAction?.() ?? null;
      if (row?.mixer && action) {
        const duration = action.getClip().duration;
        action.time = duration > 0 ? Math.min(pose.clipT01, 1) * duration : 0;
        row.mixer.update(0);
      }
      requestLook(pose.look);
    },
    [camera, gl, readFacts],
  );

  // The bridge (debug page only: the whole gallery is dev-only).
  useEffect(() => {
    const host = window as GalleryHost;
    const api = createGalleryApi({
      file,
      arm: routeAssetArm,
      figure: readFacts,
      failed: () => failure.current,
      worldReady: () => isResidencyComplete() && getRevealArmedAt() !== null && presentGateOpen(),
      apply,
      settled: (pose) => lookStore.mounted === pose.look && compileHeldCount() === 0,
      renderedFrames: getRenderedFrames,
      schedule: (cb) => {
        requestAnimationFrame(() => cb());
      },
      now: () => performance.now(),
    });
    host.__routeGallery = api;
    return () => {
      if (host.__routeGallery === api) delete host.__routeGallery;
    };
  }, [file, apply, readFacts]);

  // The first frame is already framed: the default pose once the figure measures.
  useEffect(() => {
    if (!measured || posedOnce.current) return;
    posedOnce.current = true;
    apply(GALLERY_DEFAULT_POSE);
  }, [measured, apply]);

  return (
    <>
      <hemisphereLight args={[palette.skyLight, palette.bounce, FILL_INTENSITY]} />
      <directionalLight ref={keyLight} color={palette.keyLight} intensity={KEY_INTENSITY} position={[4.5, 7.5, 5]} />
      <GalleryErrorBoundary onError={onError}>
        <ResidentSuspense id="gallery:figure">
          <DormancyScope dormant>
            <Figure
              entry={entry}
              name={GALLERY_FIGURE_ID}
              role="wild"
              castShadow={false}
              breathe={false}
              onRoot={onRoot}
              onMeasure={onMeasure}
            />
          </DormancyScope>
        </ResidentSuspense>
      </GalleryErrorBoundary>
    </>
  );
}

/** A missing or invalid `galleryFile`: the bridge reports it as a failure (no figure ever mounts). */
function GalleryMissingFile() {
  useEffect(() => {
    const host = window as GalleryHost;
    const reason = 'galleryFile missing or invalid (a .glb path under the asset base, e.g. models/regular/907.glb)';
    const api: RouteGalleryApi = {
      ready: () => true,
      info: () => ({
        file: '',
        triangles: 0,
        meshes: 0,
        bounds: { min: [0, 0, 0], max: [0, 0, 0] },
        clips: [],
        failed: reason,
        fittedBounds: null,
        arm: routeAssetArm(),
      }),
      set: () => Promise.reject(new Error(`gallery: ${reason}`)),
    };
    host.__routeGallery = api;
    return () => {
      if (host.__routeGallery === api) delete host.__routeGallery;
    };
  }, []);
  return null;
}

export default function GalleryScene({ file }: { file: string | null }) {
  return (
    <RouteWorldCanvas>
      <ResidentSuspense id="gallery:environment">
        <WorldEnvironment />
      </ResidentSuspense>
      {file === null ? (
        <GalleryMissingFile />
      ) : (
        <ResidentSuspense id="gallery:stage">
          <GalleryStage file={file} />
        </ResidentSuspense>
      )}
      <GalleryPresentAnchor />
      <GalleryLookHost />
    </RouteWorldCanvas>
  );
}

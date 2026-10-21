'use client';

import { useEffect } from 'react';
import { Environment } from '@react-three/drei';
import { useLoader, useThree } from '@react-three/fiber';
import { HDRJPGLoader } from '@monogrid/gainmap-js';
import * as THREE from 'three';
import { useWorldState } from '../WorldStateProvider';
import { registerWarmPostPass } from '../useStationWarmup';
import { useWorldManifest } from '@/lib/route-world/model-manifest';
import { DEFAULT_HDRI_YAW, hdriFileFor, hdriRoleFor, hdriUrlFor, type HdriRole } from '@/lib/route-world/world-env';

/** The engine's historical IBL pair — every theme without `environmentIntensity` keeps it. */
const DEFAULT_ENVIRONMENT_INTENSITY: Record<HdriRole, number> = { gold: 0.72, night: 0.55 };

/**
 * IBL intensity for a role: the `gold` value scales with exposure, `night`
 * is flat. A theme's `environmentIntensity` (plaza LOOK-PLAN §1.2: 0.85 /
 * 0.60) overrides the pair; sakura, mountain and clouds declare none, so
 * their value is byte-identical to before the field existed.
 */
export function environmentIntensityFor(
  role: HdriRole,
  exposure: number,
  override?: Record<HdriRole, number>,
): number {
  const table = override ?? DEFAULT_ENVIRONMENT_INTENSITY;
  return role === 'night' ? table.night : table.gold * exposure;
}

/** Equirect sources three prefilters (PMREM) lazily on first use. */
export function needsPmremRefresh(texture: THREE.Texture | null | undefined): texture is THREE.Texture {
  if (!texture || texture.isRenderTargetTexture) return false;
  return (
    texture.mapping === THREE.EquirectangularReflectionMapping ||
    texture.mapping === THREE.EquirectangularRefractionMapping
  );
}

const refreshed = new WeakSet<THREE.Texture>();

/**
 * LOOK r2 (blast radius): re-run three's PMREM prefilter for the scene's
 * environment.
 *
 * three builds the prefiltered IBL lazily, on the first compile or draw that
 * needs it, with `renderer.render` calls into its own targets. The D23 load
 * warm compiles the scene while the canvas's draw hold is up, and the hold
 * wrapper skips EVERY `gl.render` — so the prefilter drew nothing and three
 * cached a BLACK environment for the session: every world lost its
 * image-based light (clouds and mountain turned dark and harsh against their
 * before stills, the plaza's shade crushed and its metals went black).
 *
 * This runs inside the warm's raw-render scope (registered as a post-pass
 * warm, which the warm executes with the hold bypassed, before the reveal):
 * disposing the source drops three's cached (black) prefilter, and one
 * compile of a throwaway probe material rebuilds it — the real prefilter,
 * pre-reveal. The scene's programs keep their keys (same cube-UV size), so
 * nothing re-links; only the PMREM passes link, once, in the ceremony.
 */
export function refreshEnvironmentPmrem(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): boolean {
  const environment = scene.environment;
  if (!needsPmremRefresh(environment) || refreshed.has(environment)) return false;
  const image = environment.image as { width?: number; height?: number } | undefined;
  if (!image || !(image.height && image.height > 0)) return false;
  refreshed.add(environment);
  environment.dispose();
  compileProbe(gl, environment, camera);
  return true;
}

/** The part of gain-map-js's `QuadRenderer` (an `HDRJPGLoader` result) the refresh drives. */
export interface GainmapDecode {
  render: () => void;
  renderTarget: { texture: THREE.Texture };
}

/**
 * LOOK r3 (the gain-map HDRI, D23 bytes): re-run the gain-map decode and its
 * PMREM prefilter inside the warm's raw-render scope.
 *
 * `HDRJPGLoader` decodes the UltraHDR JPEG by drawing a full-screen quad into
 * its own render target with `renderer.render` — the same call the canvas's
 * draw hold skips while the load warm runs, so the decoded HDRI (and the IBL
 * three prefilters from it) came out BLACK. The decoder keeps its material
 * and source textures, so one more `render()` in the raw scope fills the
 * target for real; `needsPMREMUpdate` then makes three rebuild the cached
 * prefilter (render-target textures are re-prefiltered on a version bump),
 * which one probe compile triggers — all before the reveal. The scene's
 * programs keep their keys (same target size), so nothing re-links.
 */
export function refreshGainmapEnvironment(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  decode: GainmapDecode,
): boolean {
  const environment = scene.environment;
  if (!environment || environment !== decode.renderTarget.texture || refreshed.has(environment)) return false;
  refreshed.add(environment);
  decode.render();
  environment.needsPMREMUpdate = true;
  compileProbe(gl, environment, camera);
  return true;
}

/** One throwaway compile against `environment`: three (re)builds its PMREM on the way. */
function compileProbe(gl: THREE.WebGLRenderer, environment: THREE.Texture, camera: THREE.Camera): void {
  const probe = new THREE.Scene();
  probe.environment = environment;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial();
  probe.add(new THREE.Mesh(geometry, material));
  try {
    gl.compile(probe, camera);
  } finally {
    material.dispose();
    geometry.dispose();
  }
}

/**
 * Registers the gain-map re-decode with the load warm. `useLoader` hits the
 * same cache entry drei's `<Environment>` filled (keyed on loader + URL), so
 * this is the decoder that produced the scene's environment — no second
 * fetch or decode.
 */
function GainmapRefresh({ url }: { url: string }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const decode = useLoader(HDRJPGLoader, url, (loader) => {
    (loader as unknown as { setRenderer: (renderer: THREE.WebGLRenderer) => void }).setRenderer(gl);
  }) as unknown as GainmapDecode;
  useEffect(
    () =>
      registerWarmPostPass({
        key: 'lean',
        materials: () => [],
        warm: () => {
          refreshGainmapEnvironment(gl, scene, camera, decode);
        },
      }),
    [gl, scene, camera, decode],
  );
  return null;
}

/** Registers the prefilter refresh with the load warm (every start rung warms `lean`). */
function PmremRefresh() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(
    () =>
      registerWarmPostPass({
        key: 'lean',
        materials: () => [],
        warm: () => {
          refreshEnvironmentPmrem(gl, scene, camera);
        },
      }),
    [gl, scene, camera],
  );
  return null;
}

/**
 * Image-based lighting per palette: a golden-hour sky for the sunlit theme, a
 * moonlit one for dark. The HDRI is never the background — the authored sky
 * dome (theme atmosphere) keeps the tokens' colours; this only feeds PBR
 * response. Intensity is exposure-scaled so a moonlit world stays legible.
 *
 * The per-role yaw comes from the route theme (plaza: `plazaTheme.hdriYaw`,
 * which puts each HDRI's sun/moon over the north jumbotron where the authored
 * sky body sits, so specular on wet cobbles and zinc agrees with the disc the
 * visitor can see); the engine default mirrors the plaza values so a world
 * without a resolved theme behaves exactly as before themes existed.
 */
export default function WorldEnvironment() {
  const { palette, theme } = useWorldState();
  const manifest = useWorldManifest();
  const role = hdriRoleFor(palette.exposure);
  const intensity = environmentIntensityFor(role, palette.exposure, theme?.environmentIntensity);
  const yaw = theme?.hdriYaw ?? DEFAULT_HDRI_YAW;
  // Sakura, mountain and clouds declare no `hdriFormat`: the radiance URL is
  // string-identical to the historical `hdriUrl(role)`.
  const format = theme?.hdriFormat ?? 'radiance';
  const file = hdriFileFor(manifest, role, format);
  const url = hdriUrlFor(manifest, role, format);
  const gainmap = file.endsWith('.jpg');

  return (
    <>
      <PmremRefresh />
      <Environment
        files={url}
        background={false}
        environmentIntensity={intensity}
        environmentRotation={[0, yaw[role], 0]}
      />
      {gainmap ? <GainmapRefresh url={url} /> : null}
    </>
  );
}

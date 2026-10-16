'use client';

import { useEffect, useMemo } from 'react';
import { useKTX2, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { BASIS_TRANSCODER_PATH, useWorldManifest } from '@/lib/route-world/model-manifest';
import { hasTextureSet, textureSetUrls, type TextureRole } from '@/lib/route-world/world-env';

export interface WorldTextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Poly Haven ARM pack: R = ambient occlusion, G = roughness, B = metalness. */
  arm: THREE.Texture | null;
}

/**
 * Configure a loaded map for a tiled surface. Loaders cache by URL, so the
 * shared instance is cloned before its sampler state is changed — two
 * surfaces tiling the same set at different repeats must not fight.
 *
 * Anisotropy is capped at 4 (C-032): the cobble/limestone/slate floors read
 * grazing-angle depth at 4× with no visible loss versus 8× on the reference
 * GPU, at half the sample cost of the deepest mip legs.
 */
function tiled(texture: THREE.Texture, repeat: readonly [number, number], srgb: boolean): THREE.Texture {
  const copy = texture.clone();
  copy.wrapS = THREE.RepeatWrapping;
  copy.wrapT = THREE.RepeatWrapping;
  copy.repeat.set(repeat[0], repeat[1]);
  copy.anisotropy = 4;
  copy.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  copy.needsUpdate = true;
  return copy;
}

/** Whether the manifest ships this set at all; components branch to procedural maps when not. */
export function useHasWorldTextureSet(role: TextureRole): boolean {
  return hasTextureSet(useWorldManifest(), role);
}

/**
 * Load a CC0 PBR set from the world-assets bucket (KTX2 through the
 * self-hosted Basis transcoder, or the WebP fallback the pipeline wrote).
 * Suspends; call only when `useHasWorldTextureSet` is true.
 */
export function useWorldTextureSet(role: TextureRole, repeat: readonly [number, number]): WorldTextureSet {
  const manifest = useWorldManifest();
  const urls = textureSetUrls(manifest, role);
  if (!urls.diff || !urls.nor) {
    throw new Error(`[route-world] texture set "${role}" missing from manifest`);
  }
  const list = urls.arm ? [urls.diff, urls.nor, urls.arm] : [urls.diff, urls.nor];
  // Both hooks are called unconditionally per role — a set is either fully
  // KTX2 or fully WebP, so the unused branch resolves against an empty list.
  const ktx = useKTX2(urls.ktx2 ? list : [], BASIS_TRANSCODER_PATH);
  const webp = useTexture(urls.ktx2 ? [] : list);
  const loaded = urls.ktx2 ? ktx : webp;

  const set = useMemo<WorldTextureSet>(
    () => ({
      map: tiled(loaded[0], repeat, true),
      normalMap: tiled(loaded[1], repeat, false),
      arm: loaded[2] ? tiled(loaded[2], repeat, false) : null,
    }),
    [loaded, repeat],
  );

  useEffect(
    () => () => {
      set.map.dispose();
      set.normalMap.dispose();
      set.arm?.dispose();
    },
    [set],
  );

  return set;
}

'use client';

import { useEffect, useMemo } from 'react';
import { useKTX2, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { BASIS_TRANSCODER_PATH, useWorldManifest } from '@/lib/route-world/model-manifest';
import { envTextureSetUrls, hasEnvTextureSet, type TextureSetUrls } from '@/lib/route-world/world-env';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import type { WorldTextureSet } from './world-textures';

/**
 * The theme-declarative texture-role consumer (C-100 criterion 2) — the
 * engine component that makes `RouteThemeDefinition.textureRoles` a real
 * hook. A role loads only when the ACTIVE theme DECLARES it and the
 * manifest ships a complete set; resolution goes through
 * `envTextureSetUrls` (the generic body `textureSetUrls` delegates to), so
 * a declared role resolves to exactly the URLs the asset pipeline wrote —
 * plaza's cobble/limestone/slate come out byte-identical to the closed
 * union path, and a theme that declares nothing (`textureRoles: []`, the
 * sakura/mountain/clouds case) resolves to ZERO texture loads by
 * construction.
 *
 * Hook discipline matches `world-textures.ts`: both loader hooks are called
 * unconditionally with the URL list (empty for the unused branch), and the
 * loaded set's sampler state is configured on a clone so two surfaces never
 * fight over repeats.
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

/** Whether the active theme declares `role` and the manifest ships it. */
export function useThemeTextureRoleActive(role: string): boolean {
  const { theme } = useWorldState();
  const manifest = useWorldManifest();
  const declared = theme?.textureRoles.includes(role) ?? false;
  return declared && hasEnvTextureSet(manifest, role);
}

/**
 * Load a theme-declared role's PBR set. Suspends — gate the call site with
 * `useThemeTextureRoleActive` (or mount inside a branch that checks it).
 * Returns `null` when the theme does not declare the role or the manifest
 * lacks a complete set: the caller falls back to its procedural default.
 *
 * `repeat` is a memo key, so it must be a STABLE reference — a module
 * constant, never an inline literal. A fresh array per render re-tiles and
 * disposes the whole set on every render.
 */
export function useThemeTextureSet(role: string, repeat: readonly [number, number]): WorldTextureSet | null {
  const manifest = useWorldManifest();
  const { theme } = useWorldState();
  const declared = theme?.textureRoles.includes(role) ?? false;
  const urls: TextureSetUrls | null = useMemo(
    () => (declared && hasEnvTextureSet(manifest, role) ? envTextureSetUrls(manifest, role) : null),
    [declared, manifest, role],
  );

  const list = urls && urls.diff && urls.nor ? (urls.arm ? [urls.diff, urls.nor, urls.arm] : [urls.diff, urls.nor]) : [];
  // Both hooks stay unconditional per role — a set is either fully KTX2 or
  // fully WebP, so the unused branch resolves against an empty list.
  const ktx = useKTX2(urls?.ktx2 ? list : [], BASIS_TRANSCODER_PATH);
  const webp = useTexture(urls?.ktx2 ? [] : list);

  const set = useMemo<WorldTextureSet | null>(() => {
    if (!urls || !urls.diff || !urls.nor) return null;
    const loaded = urls.ktx2 ? ktx : webp;
    return {
      map: tiled(loaded[0], repeat, true),
      normalMap: tiled(loaded[1], repeat, false),
      arm: loaded[2] ? tiled(loaded[2], repeat, false) : null,
    };
  }, [urls, ktx, webp, repeat]);

  // Every `tiled()` clone is its own GPU texture: dispose the previous set
  // when the memo recomputes (theme/URL/repeat change) and on unmount — the
  // same discipline the sibling `useWorldTextureSet` keeps in
  // world-textures.ts (PR #63 review).
  useEffect(
    () => () => {
      set?.map.dispose();
      set?.normalMap.dispose();
      set?.arm?.dispose();
    },
    [set],
  );

  return set;
}

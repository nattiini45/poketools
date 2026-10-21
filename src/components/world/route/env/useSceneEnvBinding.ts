'use client';

import { useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { bindSceneEnvironment } from './scene-env-binding';

/**
 * D42 N9: a ref callback that binds a `<meshStandardMaterial>`'s envMap,
 * envMapRotation and envMapIntensity to the canvas scene's environment
 * (`scene-env-binding.ts`), so its authored `envMapIntensity` (0 on a data
 * screen) reaches the shader under three r185. The binding is attached in
 * the commit that mounts the material (before any frame: before the warm
 * compiles it) and released when React detaches the ref (React 19 ref
 * cleanup). Stable per scene, so a re-render never rebinds.
 */
export function useSceneEnvBinding(): (material: THREE.MeshStandardMaterial | null) => (() => void) | undefined {
  const scene = useThree((state) => state.scene);
  return useCallback(
    (material: THREE.MeshStandardMaterial | null) => {
      if (material === null) return undefined;
      return bindSceneEnvironment(material, scene);
    },
    [scene],
  );
}

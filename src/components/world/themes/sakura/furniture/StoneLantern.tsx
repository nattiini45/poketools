'use client';

import type { ReactNode } from 'react';
import { useSakuraPalette } from '../use-sakura-palette';

/**
 * A kasuga-style stone lantern, procedural from primitives: base course,
 * shaft, middle platform, light box, hip roof and finial. The light box
 * carries a warm paper-glow emission (the park's practical; brighter under
 * the moon), and children mount at the cap's standing height — the aces are
 * enshrined there on the teams line.
 */

export interface StoneLanternProps {
  /** Overall scale (1 = shrine-wall lantern ≈ 1.15 m to the finial). */
  scale?: number;
  night: boolean;
  /** Standing height of the cap top, in the lantern's local metres. */
  capHeight?: number;
  /**
   * Mount a real point light. The park keeps the count of practicals small
   * (the light-box emission reads on every lantern); a handful of chosen
   * lanterns pool light on the ground.
   */
  practical?: boolean;
  children?: ReactNode;
}

/** Finial top height of the default lantern, local metres. */
export const LANTERN_H = 1.15;

export default function StoneLantern({
  scale = 1,
  night,
  capHeight,
  practical = false,
  children,
}: StoneLanternProps) {
  const palette = useSakuraPalette();
  const s = scale;
  const stone = palette.lanternStone;
  const cap = capHeight ?? LANTERN_H * s;
  return (
    <group>
      {/* Base course. */}
      <mesh position={[0, 0.07 * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3 * s, 0.34 * s, 0.14 * s, 6]} />
        <meshStandardMaterial color={stone} roughness={0.9} metalness={0.02} />
      </mesh>
      {/* Shaft. */}
      <mesh position={[0, (0.14 + 0.24) * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.075 * s, 0.095 * s, 0.48 * s, 6]} />
        <meshStandardMaterial color={stone} roughness={0.92} metalness={0.02} />
      </mesh>
      {/* Middle platform. */}
      <mesh position={[0, 0.65 * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24 * s, 0.2 * s, 0.09 * s, 6]} />
        <meshStandardMaterial color={stone} roughness={0.88} metalness={0.02} />
      </mesh>
      {/* Light box with the paper glow. */}
      <mesh position={[0, 0.83 * s, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.3 * s, 0.27 * s, 0.3 * s]} />
        <meshStandardMaterial
          color={stone}
          emissive={palette.lanternGlow}
          emissiveIntensity={night ? 1.6 : 0.35}
          roughness={0.6}
          metalness={0}
        />
      </mesh>
      {/* Hip roof. */}
      <mesh position={[0, 1.0 * s, 0]} rotation={[0, Math.PI / 6, 0]} castShadow receiveShadow>
        <coneGeometry args={[0.34 * s, 0.2 * s, 4]} />
        <meshStandardMaterial color={stone} roughness={0.9} metalness={0.02} />
      </mesh>
      {/* Finial. */}
      <mesh position={[0, 1.13 * s, 0]} castShadow>
        <sphereGeometry args={[0.05 * s, 10, 8]} />
        <meshStandardMaterial color={stone} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* A chosen few lanterns pool light on the ground; the rest read by
          their box emission alone. */}
      {practical ? (
        <pointLight
          position={[0, 0.83 * s, 0]}
          color={palette.lanternGlow}
          intensity={night ? 7 * s : 0.9 * s}
          distance={9 * s}
          decay={2}
          castShadow={false}
        />
      ) : null}
      {/* Children stand on the cap (the enshrined aces). */}
      <group position={[0, cap, 0]}>{children}</group>
    </group>
  );
}

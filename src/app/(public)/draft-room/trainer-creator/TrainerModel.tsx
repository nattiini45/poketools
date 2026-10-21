'use client';

import type { TrainerConfig } from '@/lib/draft-room/trainer-config';

interface TrainerModelProps {
  config: TrainerConfig;
  scale?: number;
}

/** Hair geometry variants by style index */
function Hair({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 0: // Short
      return (
        <mesh position={[0, 1.62, 0]} scale={[1.05, 0.6, 1.05]}>
          <sphereGeometry args={[0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      );
    case 1: // Spiky
      return (
        <group position={[0, 1.7, 0]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.cos(i * 1.25) * 0.12, i * 0.04, Math.sin(i * 1.25) * 0.12]} rotation={[0.2 * (i % 2 ? 1 : -1), 0, 0.3 * (i % 3 ? 1 : -1)]}>
              <coneGeometry args={[0.06, 0.25, 6]} />
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>
          ))}
        </group>
      );
    case 2: // Long
      return (
        <group>
          <mesh position={[0, 1.6, 0]} scale={[1.1, 0.7, 1.1]}>
            <sphereGeometry args={[0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={color} roughness={0.8} />
          </mesh>
          <mesh position={[0, 1.3, -0.15]}>
            <capsuleGeometry args={[0.12, 0.5, 4, 8]} />
            <meshStandardMaterial color={color} roughness={0.8} />
          </mesh>
        </group>
      );
    case 3: // Ponytail
      return (
        <group>
          <mesh position={[0, 1.62, 0]} scale={[1.05, 0.55, 1.05]}>
            <sphereGeometry args={[0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={color} roughness={0.8} />
          </mesh>
          <mesh position={[0, 1.45, -0.25]} rotation={[0.4, 0, 0]}>
            <capsuleGeometry args={[0.06, 0.4, 4, 8]} />
            <meshStandardMaterial color={color} roughness={0.8} />
          </mesh>
        </group>
      );
    case 4: // Buzz
      return (
        <mesh position={[0, 1.58, 0]} scale={[1.02, 0.85, 1.02]}>
          <sphereGeometry args={[0.27, 16, 12]} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      );
    case 5: // Mohawk
      return (
        <group position={[0, 1.72, 0]}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[0, i * 0.03, -0.08 + i * 0.05]}>
              <boxGeometry args={[0.04, 0.18, 0.08]} />
              <meshStandardMaterial color={color} roughness={0.7} />
            </mesh>
          ))}
        </group>
      );
    default:
      return null;
  }
}

/** Hat geometry variants */
function Hat({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 1: // Cap
      return (
        <group position={[0, 1.72, 0]}>
          <mesh scale={[1.1, 0.4, 1.1]}>
            <sphereGeometry args={[0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0, 0.28]} rotation={[0.1, 0, 0]}>
            <boxGeometry args={[0.25, 0.03, 0.2]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        </group>
      );
    case 2: // Beanie
      return (
        <mesh position={[0, 1.7, 0]} scale={[1.08, 0.7, 1.08]}>
          <sphereGeometry args={[0.29, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      );
    case 3: // Visor
      return (
        <group position={[0, 1.68, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.27, 0.03, 8, 24]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.28]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[0.3, 0.02, 0.18]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        </group>
      );
    case 4: // Top Hat
      return (
        <group position={[0, 1.75, 0]}>
          <mesh>
            <cylinderGeometry args={[0.18, 0.2, 0.35, 16]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
          </mesh>
          <mesh position={[0, -0.17, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.03, 16]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/**
 * Stylized 3D trainer built from primitive geometries.
 * Modular: body, head, arms, legs, hair, hat — all colored by config.
 */
export default function TrainerModel({ config, scale = 1 }: TrainerModelProps) {
  const { skinTone, hairStyle, hairColor, outfitColor, pantsColor, hatStyle, hatColor } = config;

  return (
    <group scale={scale}>
      {/* Head */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color={skinTone} roughness={0.7} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.08, 1.53, 0.22]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      <mesh position={[0.08, 1.53, 0.22]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      {/* Hair */}
      <Hair style={hairStyle} color={hairColor} />

      {/* Hat */}
      {hatStyle > 0 && <Hat style={hatStyle} color={hatColor} />}

      {/* Body / Torso */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.4, 8, 16]} />
        <meshStandardMaterial color={outfitColor} roughness={0.6} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.32, 1.05, 0]} rotation={[0, 0, 0.15]} castShadow>
        <capsuleGeometry args={[0.07, 0.35, 4, 8]} />
        <meshStandardMaterial color={outfitColor} roughness={0.6} />
      </mesh>
      <mesh position={[0.32, 1.05, 0]} rotation={[0, 0, -0.15]} castShadow>
        <capsuleGeometry args={[0.07, 0.35, 4, 8]} />
        <meshStandardMaterial color={outfitColor} roughness={0.6} />
      </mesh>

      {/* Hands */}
      <mesh position={[-0.36, 0.78, 0]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color={skinTone} roughness={0.7} />
      </mesh>
      <mesh position={[0.36, 0.78, 0]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color={skinTone} roughness={0.7} />
      </mesh>

      {/* Legs */}
      <mesh position={[-0.1, 0.45, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.35, 4, 8]} />
        <meshStandardMaterial color={pantsColor} roughness={0.7} />
      </mesh>
      <mesh position={[0.1, 0.45, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.35, 4, 8]} />
        <meshStandardMaterial color={pantsColor} roughness={0.7} />
      </mesh>

      {/* Shoes */}
      <mesh position={[-0.1, 0.18, 0.04]}>
        <boxGeometry args={[0.12, 0.08, 0.2]} />
        <meshStandardMaterial color="#2d2d3d" roughness={0.5} />
      </mesh>
      <mesh position={[0.1, 0.18, 0.04]}>
        <boxGeometry args={[0.12, 0.08, 0.2]} />
        <meshStandardMaterial color="#2d2d3d" roughness={0.5} />
      </mesh>
    </group>
  );
}

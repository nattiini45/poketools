'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import TrainerModel from './TrainerModel';
import type { TrainerConfig } from '@/lib/draft-room/trainer-config';

interface Props {
  config: TrainerConfig;
}

export default function TrainerPreview({ config }: Props) {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 3.5], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} castShadow />
      <pointLight position={[-3, 2, -2]} intensity={0.4} color="#8b5cf6" />

      <group position={[0, -0.9, 0]}>
        <TrainerModel config={config} scale={1.3} />
      </group>

      <ContactShadows
        position={[0, -0.9, 0]}
        opacity={0.5}
        scale={4}
        blur={2}
        far={2}
      />
      {/* Extra fill light instead of HDR environment (no external fetch) */}
      <pointLight position={[2, 3, -3]} intensity={0.3} color="#e0e7ff" />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate
        autoRotateSpeed={2}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 2}
        target={[0, 0.3, 0]}
      />
    </Canvas>
  );
}

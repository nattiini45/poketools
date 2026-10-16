'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSakuraPalette } from '../use-sakura-palette';
import StoneLantern from './StoneLantern';
import { BRIDGE, ISLAND } from './layout';

/**
 * A vermilion-rail arched bridge segment reaching from the east shore onto
 * the lake's shrine island — procedural planking under two curved tube
 * rails. The island carries one stone lantern (with a real light pool) and
 * an accent tree, so the pulse and schedule cameras both read a destination
 * across the water.
 */

export default function BridgeSegment({ night }: { night: boolean }) {
  const palette = useSakuraPalette();

  const deck = useMemo(() => {
    const from = BRIDGE.from;
    const to = BRIDGE.to;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const planks = Math.max(6, Math.round(length / 0.42));
    return { from, length, yaw, planks, dx: dx / length, dz: dz / length };
  }, []);

  /** One rail as a curved tube: posts at the ends, a swept handrail. */
  const rails = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const x = deck.from.x + deck.dx * deck.length * t;
      const z = deck.from.z + deck.dz * deck.length * t;
      const y = 1.02 + Math.sin(t * Math.PI) * BRIDGE.rise;
      points.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    return { left: new THREE.TubeGeometry(curve, 20, 0.05, 6, false), posts: points };
  }, [deck]);

  useEffect(
    () => () => {
      rails.left.dispose();
    },
    [rails],
  );

  const railMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: palette.toriiRed,
        roughness: 0.5,
        metalness: 0.15,
      }),
    [palette],
  );
  useEffect(() => railMaterial.dispose(), [railMaterial]);

  return (
    <group>
      {/* Deck planks, each a box stepping along the arc. */}
      {Array.from({ length: deck.planks }, (_, i) => {
        const t = (i + 0.5) / deck.planks;
        const x = deck.from.x + deck.dx * deck.length * t;
        const z = deck.from.z + deck.dz * deck.length * t;
        const y = 0.18 + Math.sin(t * Math.PI) * BRIDGE.rise;
        return (
          <mesh key={i} position={[x, y, z]} rotation={[0, -deck.yaw, 0]} castShadow receiveShadow>
            <boxGeometry args={[BRIDGE.width, 0.09, 0.46]} />
            <meshStandardMaterial color={palette.bridgeWood} roughness={0.85} metalness={0.02} />
          </mesh>
        );
      })}
      {/* Two vermilion handrails, swept along the arc. */}
      {([-1, 1] as const).map((side) => (
        <group key={side}>
          <mesh geometry={rails.left} material={railMaterial} castShadow position={[-deck.dz * 0.78 * side, 0, deck.dx * 0.78 * side]} />
          {/* Posts at the ends and midspan. */}
          {[0, 0.5, 1].map((t) => {
            const x = deck.from.x + deck.dx * deck.length * t;
            const z = deck.from.z + deck.dz * deck.length * t;
            const y = (0.18 + Math.sin(t * Math.PI) * BRIDGE.rise + 1.02 + Math.sin(t * Math.PI) * BRIDGE.rise) / 2;
            return (
              <mesh
                key={t}
                position={[x - deck.dz * 0.78 * side, y, z + deck.dx * 0.78 * side]}
                material={railMaterial}
                castShadow
              >
                <cylinderGeometry args={[0.04, 0.05, 1.02 + Math.sin(t * Math.PI) * BRIDGE.rise - 0.14, 6]} />
              </mesh>
            );
          })}
        </group>
      ))}
      {/* The shrine island: a grassy disc in the lake. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ISLAND.x, 0.1, ISLAND.z]} receiveShadow>
        <circleGeometry args={[ISLAND.r, 24]} />
        <meshStandardMaterial color={palette.lawnColor} roughness={0.95} metalness={0} />
      </mesh>
      {/* Sand collar where the island meets the water. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ISLAND.x, 0.075, ISLAND.z]}>
        <ringGeometry args={[ISLAND.r, ISLAND.r + 0.45, 24]} />
        <meshStandardMaterial color={palette.pathColor} roughness={0.95} metalness={0} />
      </mesh>
      {/* The island's shrine lantern — a real light pool over the water. */}
      <group position={[ISLAND.x - 0.4, 0.1, ISLAND.z + 0.3]}>
        <StoneLantern scale={1.15} night={night} practical />
      </group>
      {/* No accent tree on the island: the island sits inside the schedule
          camera's eye→banner corridor, so any tall accent there stands in
          front of the banner row (C-093 r1 capture fix). The lantern and the
          vermilion rails carry the across-water destination instead. */}
    </group>
  );
}

'use client';

import { useSakuraPalette } from '../use-sakura-palette';
import StoneLantern from './StoneLantern';
import { BlossomBed, SignPost, SteppingStones, WoodFence } from './Props';
import { PULSE_SURROUND, ROCK } from './layout';

/**
 * The #pulse surround (C-093 r3 density pass): the jumbotron rock keeps the
 * landmark; its shore gets dressed so the board sits in a scene, not on open
 * lawn — a cedar fence line between the lake's north edge and the boulder, a
 * flanking lantern pair (one practical), blossom planting beds along the
 * fence, two foot boulders, a direction signpost, and stepping stones at the
 * fence's viewing gap. Every anchor is angle-checked against the authored
 * pose (see layout.ts) and sits on the dry ground band between the lake's
 * north edge (z ≈ −12.15 at these x) and the tree line.
 */

/** Small weathered foot stones (flat-shaded, the boulder's own idiom). */
function FootBoulder({ x, z, r }: { x: number; z: number; r: number }) {
  const palette = useSakuraPalette();
  return (
    <mesh position={[x, r * 0.62, z]} scale={[1, 0.72, 0.9]} castShadow receiveShadow>
      <icosahedronGeometry args={[r, 1]} />
      <meshStandardMaterial color={palette.lanternStone} roughness={0.95} metalness={0.02} flatShading />
    </mesh>
  );
}

export default function PulseSurround() {
  const palette = useSakuraPalette();
  const { fence, lanterns, beds, boulders, signpost, gapStones } = PULSE_SURROUND;

  return (
    <group>
      <WoodFence x0={fence.x0} x1={fence.x1} z={fence.z} posts={fence.posts} railY={fence.railY} />
      {lanterns.map((l) => (
        <group key={l.z} position={[l.x, 0, l.z]}>
          <StoneLantern scale={l.scale} night={palette.exposure < 0.75} practical={l.practical} />
        </group>
      ))}
      {beds.map((b) => (
        <BlossomBed key={b.x} x={b.x} z={b.z} seed={Math.round(-b.x * 10)} />
      ))}
      {boulders.map((b) => (
        <FootBoulder key={b.x} x={b.x} z={b.z} r={b.r} />
      ))}
      <SignPost x={signpost.x} z={signpost.z} yaw={ROCK.faceYaw - Math.PI / 2} />
      <SteppingStones
        x0={gapStones.x0}
        x1={gapStones.x1}
        z0={gapStones.z0}
        z1={gapStones.z1}
        count={6}
        seed={610}
        radius={0.36}
      />
    </group>
  );
}

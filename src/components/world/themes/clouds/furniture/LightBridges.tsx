'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCloudsPalette } from '../use-clouds-palette';
import { seeded } from './Props';
import { BRIDGES } from './layout';
import { applyBridgeNearFade, BRIDGE_NODES } from './light-bridge-fade';
import { emissiveUnderInk } from '@/components/world/route/useStandbyDim';
import { GLOW_UNDER_INK, PLAQUE_EMISSION, PLAQUE_INK } from './SkyGate';

/**
 * The light-bridges: the isles' condensed-light paths, chained pier to pier
 * along bezier arcs. The beam is a flattened tube whose material is the
 * theme's glow line — budgeted under the boards since fidelity wave 2 (see
 * THE LUMINANCE BUDGET below; it was the theme's strongest emission, night
 * 7.0); emitter rings stud each span. Arcs swing through the control points sited in
 * `layout.ts`, clear of every station's DATA face — but not of every lens:
 * the landed 390 pullback puts the roster → teams span 8–10 m from the
 * camera, where it bloomed into near-lens bars (fidelity W1 r4). Both
 * materials carry the near-camera fade (`light-bridge-fade.ts`): alpha
 * ramps in from 10 m to 18 m of view distance.
 */

/**
 * THE LUMINANCE BUDGET (fidelity wave 2, seat 2F; audit issue 16 — "the
 * white ribbon and rings are the brightest pixels in the frame", CD). The
 * beam's authored night 7.0 emitted ≈ 5.2 linear luminance and the rings'
 * 4.0 ≈ 3.4: three to five times the boards' paper white, and blooming. A
 * non-data glow line now emits at most 0.6 × the dimmest clouds board's ink
 * (the rules plaque — SkyGate `PLAQUE_*`), by day and by night; the
 * authored value still applies wherever it is already under that bound.
 * The paths still read as light — pale cyan over the night sea — but as a
 * quiet one, and they no longer outshine the data.
 *
 * Albedo toned: the beam and ring bases were mid-dark teal at roughness
 * 0.3–0.4, and by day the key struck a specular ribbon along every span.
 * Both are one step darker and rougher, so the sunlit span sits under the
 * boards too.
 */
const AUTHORED_EMISSIVE = { beam: { night: 7.0, day: 1.15 }, ring: { night: 4.0, day: 0.7 } } as const;
const BEAM_ALBEDO = '#2b434d';
const RING_ALBEDO = '#20333b';

/** The budgeted emissive intensity of a bridge part (see above). */
export function bridgeEmissive(part: 'beam' | 'ring', glow: string, night: boolean): number {
  const authored = night ? AUTHORED_EMISSIVE[part].night : AUTHORED_EMISSIVE[part].day;
  const ink = night ? PLAQUE_EMISSION.night : PLAQUE_EMISSION.day;
  return Math.min(authored, emissiveUnderInk(glow, PLAQUE_INK, ink, GLOW_UNDER_INK));
}

/**
 * Flatten a TubeGeometry's cross-sections toward each ring's curve centre —
 * an elliptical deck profile baked into the vertices (scaling the MESH would
 * squash the whole arc toward the world origin instead).
 */
function flattenTube(
  geometry: THREE.TubeGeometry,
  curve: THREE.QuadraticBezierCurve3,
  tubularSegments: number,
  radialSegments: number,
  factor: number,
): void {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const center = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i += 1) {
    center.copy(curve.getPoint(i / tubularSegments));
    for (let j = 0; j <= radialSegments; j += 1) {
      const idx = i * (radialSegments + 1) + j;
      const y = position.getY(idx);
      position.setY(idx, center.y + (y - center.y) * factor);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function Bridge({
  from,
  to,
  ctrl,
  crown,
  index,
}: {
  from: string;
  to: string;
  ctrl: readonly [number, number];
  crown: number;
  index: number;
}) {
  const palette = useCloudsPalette();
  const night = palette.exposure < 0.75;

  const beam = useMemo(() => {
    const a = BRIDGE_NODES[from];
    const b = BRIDGE_NODES[to];
    const toCtrlA = new THREE.Vector2(ctrl[0] - a.x, ctrl[1] - a.z).normalize();
    const toCtrlB = new THREE.Vector2(ctrl[0] - b.x, ctrl[1] - b.z).normalize();
    const start = new THREE.Vector3(
      a.x + toCtrlA.x * (a.r - 0.5),
      a.top - 0.3,
      a.z + toCtrlA.y * (a.r - 0.5),
    );
    const end = new THREE.Vector3(
      b.x + toCtrlB.x * (b.r - 0.5),
      b.top - 0.3,
      b.z + toCtrlB.y * (b.r - 0.5),
    );
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += crown;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const geometry = new THREE.TubeGeometry(curve, 36, 0.34, 7, false);
    flattenTube(geometry, curve, 36, 7, 0.55);
    return { geometry, curve };
  }, [from, to, ctrl, crown]);

  const rings = useMemo(() => {
    const count = 3;
    return Array.from({ length: count }, (_, i) => {
      const t = 0.22 + (0.56 * i) / (count - 1);
      const p = beam.curve.getPoint(t);
      return { p, s: 0.8 + seeded(index * 13 + i) * 0.3 };
    });
  }, [beam, index]);

  const beamMat = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color: BEAM_ALBEDO,
      emissive: new THREE.Color(palette.bridgeGlow),
      emissiveIntensity: bridgeEmissive('beam', palette.bridgeGlow, night),
      roughness: 0.55,
      metalness: 0.05,
    });
    applyBridgeNearFade(material);
    return material;
  }, [palette.bridgeGlow, night]);
  const ringMat = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color: RING_ALBEDO,
      emissive: new THREE.Color(palette.bridgeRing),
      emissiveIntensity: bridgeEmissive('ring', palette.bridgeRing, night),
      roughness: 0.6,
      metalness: 0.1,
    });
    applyBridgeNearFade(material);
    return material;
  }, [palette.bridgeRing, night]);

  useEffect(
    () => () => {
      beam.geometry.dispose();
      beamMat.dispose();
      ringMat.dispose();
    },
    [beam, beamMat, ringMat],
  );

  return (
    <group>
      {/* Flattened beam — an elliptical deck cross-section (baked). */}
      <mesh geometry={beam.geometry} material={beamMat} />
      {/* Emitter pier rings along the span. */}
      {rings.map((r, i) => (
        <mesh key={i} position={r.p} rotation={[0, seeded(index * 7 + i) * Math.PI, 0]} material={ringMat}>
          <torusGeometry args={[0.72 * r.s, 0.09 * r.s, 6, 18]} />
        </mesh>
      ))}
      {/* Landing pads where the arc meets each isle's rim. */}
      {[beam.curve.getPoint(0), beam.curve.getPoint(1)].map((p, i) => (
        <mesh key={i} position={[p.x, p.y - 0.18, p.z]} material={ringMat}>
          <cylinderGeometry args={[0.62, 0.74, 0.22, 8]} />
        </mesh>
      ))}
    </group>
  );
}

export default function LightBridges() {
  return (
    <group>
      {BRIDGES.map((bridge, i) => (
        <Bridge
          key={`${bridge.from}-${bridge.to}`}
          from={bridge.from}
          to={bridge.to}
          ctrl={bridge.ctrl}
          crown={bridge.crown}
          index={i}
        />
      ))}
    </group>
  );
}

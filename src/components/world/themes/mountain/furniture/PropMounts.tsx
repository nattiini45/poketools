'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { propUrl, useWorldManifest, type PropEntry } from '@/lib/route-world/model-manifest';
import { preloadFigure, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import { MOUNTAIN_PROPS } from './layout';
import { useMountainStationWindowState } from './useMountainStationWindow';

/**
 * The C-107 GLB props at their pass seats (C-103 criterion 3): the ridge
 * arch as the outer pass gate (2.5 m south of the procedural gate — the
 * pair reads as nested gates, the measured sakura torii-hero pattern) and
 * the cairn trio as the mouth's statement waymarkers — mounted through the
 * shared prop pipeline (`useFigureGLTF(propUrl(entry))`), seated from the
 * RECORDED bounds (grounded at min.y, centred on x/z so the yaw spins in
 * place — the HeroProps/ProbePropModel pattern). Every seat root
 * is named `mountain-prop-*`, the family prefix theme.ts declares in
 * `propFamilyPrefixes`, so the static batcher never merges the named prop
 * roots and frustum culling stays per seat. A prop missing from
 * the manifest simply does not render (a re-bake gap never blanks the
 * pass); clones of one prop share the cached GLTF scene.
 */

/** Seated, centred clone of one prop GLTF from its RECORDED bounds (PB-166). */
function MountainPropModel({ entry }: { entry: PropEntry }) {
  const gltf = useFigureGLTF(propUrl(entry));
  const fitted = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    const { bounds } = entry;
    const cx = (bounds.min[0] + bounds.max[0]) / 2;
    const cz = (bounds.min[2] + bounds.max[2]) / 2;
    root.position.set(-cx, -bounds.min[1], -cz);
    return root;
  }, [gltf.scene, entry]);
  return <primitive object={fitted} />;
}

interface PropSeat {
  prop: string;
  x: number;
  z: number;
  yaw: number;
}

/** All prop seats in declaration order — one manifest lookup, one seat each. */
const PROP_SEATS: readonly PropSeat[] = [
  { prop: MOUNTAIN_PROPS.ridgeArch.prop, x: MOUNTAIN_PROPS.ridgeArch.x, z: MOUNTAIN_PROPS.ridgeArch.z, yaw: MOUNTAIN_PROPS.ridgeArch.yaw },
  ...MOUNTAIN_PROPS.cairnTrio.map((s) => ({ prop: s.prop, x: s.x, z: s.z, yaw: s.yaw })),
];

function MountainPropSeats() {
  const manifest = useWorldManifest();
  // D23: resident from load (GLBs, programs and uploads in the ceremony);
  // hidden after reveal until the rules entry latch — see the wrapper below.
  const { shown } = useMountainStationWindowState(4, 4);

  const seats = useMemo(
    () =>
      PROP_SEATS.map((seat) => ({
        seat,
        entry: manifest.props.find((candidate) => candidate.name === seat.prop) ?? null,
      })),
    [manifest],
  );

  // Kick every prop GLB at once, at load, before any boundary commits (PB-100) —
  // mount-order fetches stream the pass gate in one asset at a time.
  useEffect(() => {
    for (const { entry } of seats) {
      if (entry) preloadFigure(propUrl(entry));
    }
  }, [seats]);

  // Hidden after reveal (colour + shadow passes skip the subtree) until
  // `shown` flips at the same moment the old entry-latched mount did; the seat roots keep
  // their `mountain-prop-*` names, so the static batcher never merges them.
  return (
    <group visible={shown}>
      {seats.map(({ seat, entry }) =>
        entry ? (
          <ResidentSuspense key={`${seat.prop}@${seat.x},${seat.z}`} id={`mountain:prop:${seat.prop}@${seat.x},${seat.z}`}>
            <group position={[seat.x, 0, seat.z]} rotation={[0, seat.yaw, 0]} name={`mountain-prop-${seat.prop}`}>
              <MountainPropModel entry={entry} />
            </group>
          </ResidentSuspense>
        ) : null,
      )}
    </group>
  );
}

/**
 * Outer boundary covers only the manifest fetch; every GLB suspends under
 * its own seat boundary with a null fallback, so no still catches a
 * placeholder (the plaza HeroProps law).
 */
export default function PropMounts() {
  return (
    <ResidentSuspense id="mountain:props">
      <MountainPropSeats />
    </ResidentSuspense>
  );
}

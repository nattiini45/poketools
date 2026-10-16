'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { propUrl, useWorldManifest, type PropEntry } from '@/lib/route-world/model-manifest';
import { preloadFigure, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import { SAKURA_PROPS } from './layout';
import { useSakuraStationWindowState } from './useSakuraStationWindow';

/**
 * The C-107 GLB props at their sakura seats (C-102 criterion 3): the torii
 * hero as the sandō's second gate and the stone-lantern practicals pacing
 * the south path — mounted through the shared prop pipeline
 * (`useFigureGLTF(propUrl(entry))`), seated from the RECORDED bounds
 * (grounded at min.y, centred on x/z so the yaw spins in place — the
 * HeroProps/ProbePropModel pattern). Every seat root is named
 * `sakura-prop-*`, the family prefix theme.ts declares in
 * `propFamilyPrefixes`, so the static batcher never merges the named prop
 * roots and frustum culling stays per seat. A prop missing from
 * the manifest simply does not render (a re-bake gap never blanks the
 * park); clones of one prop share the cached GLTF scene.
 */

/** Seated, centred clone of one prop GLTF from its RECORDED bounds (PB-166). */
function SakuraPropModel({ entry }: { entry: PropEntry }) {
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
  { prop: SAKURA_PROPS.toriiHero.prop, x: SAKURA_PROPS.toriiHero.x, z: SAKURA_PROPS.toriiHero.z, yaw: SAKURA_PROPS.toriiHero.yaw },
  ...SAKURA_PROPS.lanternTall.map((s) => ({ prop: 'sakura-stone-lantern-tall', x: s.x, z: s.z, yaw: 0 })),
  ...SAKURA_PROPS.lanternLow.map((s) => ({ prop: 'sakura-stone-lantern-low', x: s.x, z: s.z, yaw: 0 })),
];

function SakuraPropSeats() {
  const manifest = useWorldManifest();
  // D23: resident from load (GLBs, programs and uploads in the ceremony);
  // hidden after reveal until the rules entry latch — see the wrapper below.
  const { shown } = useSakuraStationWindowState(4, 4);

  const seats = useMemo(
    () =>
      PROP_SEATS.map((seat) => ({
        seat,
        entry: manifest.props.find((candidate) => candidate.name === seat.prop) ?? null,
      })),
    [manifest],
  );

  // Kick every prop GLB at once, at load, before any boundary commits (PB-100) —
  // mount-order fetches stream the sandō in one asset at a time.
  useEffect(() => {
    for (const { entry } of seats) {
      if (entry) preloadFigure(propUrl(entry));
    }
  }, [seats]);

  // Hidden after reveal (colour + shadow passes skip the subtree) until
  // `shown` flips at the same moment the old entry-latched mount did; the seat roots keep
  // their `sakura-prop-*` names, so the static batcher never merges them.
  return (
    <group visible={shown}>
      {seats.map(({ seat, entry }) =>
        entry ? (
          <ResidentSuspense key={`${seat.prop}@${seat.x},${seat.z}`} id={`sakura:prop:${seat.prop}@${seat.x},${seat.z}`}>
            <group position={[seat.x, 0, seat.z]} rotation={[0, seat.yaw, 0]} name={`sakura-prop-${seat.prop}`}>
              <SakuraPropModel entry={entry} />
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
    <ResidentSuspense id="sakura:props">
      <SakuraPropSeats />
    </ResidentSuspense>
  );
}

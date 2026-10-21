'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { propUrl, useWorldManifest, type PropEntry } from '@/lib/route-world/model-manifest';
import { preloadFigure, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import { HALO_GATE, REGISTER_AIRSHIP } from './layout';
import { useCloudsStationWindow, useCloudsStationWindowState } from './useCloudsStationWindow';

/**
 * The C-107 GLB props at their clouds seats (C-104 criterion 3):
 *
 *  - clouds-airship-hull — the register's broadside BODY: the Blender-built
 *    zeppelin replaces the procedural envelope (Airships skips the envelope
 *    for this ship), mounted at the layout's hullProp anchor — the face
 *    plane pushed back along its own normal — with yaw = hullYaw so the
 *    hull's long axis (X in the recorded bounds) reads broadside, the
 *    hullYaw law. Seated from the RECORDED bounds by CENTRE (an
 *    airship mounts on its hull centre, not its keel).
 *  - clouds-halo-gate — the rules gate's namesake crown: the horizontal
 *    golden halo with its hanging light strands, seated inside the stone
 *    ring's upper half well above the plaque's top edge (HALO_GATE.halo;
 *    scan-checked against the plaque rect at both poses).
 *
 * Every seat root is named `clouds-prop-*`, the family prefix theme.ts
 * declares in `propFamilyPrefixes`, so the static batcher never merges the
 * named prop roots. A prop missing from the manifest simply does
 * not render (a re-bake gap never blanks the isles); clones share the cached
 * GLTF scene (mount pattern).
 */

/** Centre-seated clone of one prop GLTF from its RECORDED bounds (PB-166). */
function CenteredPropModel({ entry }: { entry: PropEntry }) {
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
    const cy = (bounds.min[1] + bounds.max[1]) / 2;
    const cz = (bounds.min[2] + bounds.max[2]) / 2;
    root.position.set(-cx, -cy, -cz);
    return root;
  }, [gltf.scene, entry]);
  return <primitive object={fitted} />;
}

/** Ground-seated clone (min.y on the mount point) — the halo's seat. */
function GroundedPropModel({ entry }: { entry: PropEntry }) {
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

function RegisterHullProp() {
  const manifest = useWorldManifest();
  useCloudsStationWindow(0, 4); // D23: resident from load (parity readout only)
  const entry = useMemo(
    () => manifest.props.find((candidate) => candidate.name === 'clouds-airship-hull') ?? null,
    [manifest],
  );
  const anchor = REGISTER_AIRSHIP.hullProp;

  useEffect(() => {
    if (entry) preloadFigure(propUrl(entry));
  }, [entry]);

  if (!entry || !anchor) return null;
  return (
    <ResidentSuspense id="clouds:prop:airship-hull">
      <group
        name="clouds-prop-clouds-airship-hull"
        position={[anchor.x, anchor.y, anchor.z]}
        rotation={[0, anchor.yaw, 0]}
        scale={anchor.scale}
      >
        <CenteredPropModel entry={entry} />
      </group>
    </ResidentSuspense>
  );
}

function HaloCrownProp() {
  const manifest = useWorldManifest();
  // D23: resident from load (GLB, programs and uploads in the ceremony);
  // after reveal `visible={false}` (colour + shadow passes skip it) until the
  // entry latch flips `shown` at the moment the old mount did. The
  // `clouds-prop-` root name keeps the static batcher off it either way.
  const { shown } = useCloudsStationWindowState(4, 4);
  const entry = useMemo(
    () => manifest.props.find((candidate) => candidate.name === 'clouds-halo-gate') ?? null,
    [manifest],
  );

  useEffect(() => {
    if (entry) preloadFigure(propUrl(entry));
  }, [entry]);

  if (!entry) return null;
  return (
    <ResidentSuspense id="clouds:prop:halo-gate">
      <group
        name="clouds-prop-clouds-halo-gate"
        visible={shown}
        position={[HALO_GATE.halo.x, HALO_GATE.halo.y, HALO_GATE.halo.z]}
        scale={HALO_GATE.halo.s}
      >
        <GroundedPropModel entry={entry} />
      </group>
    </ResidentSuspense>
  );
}

/**
 * Outer boundary covers only the manifest fetch; each prop suspends under
 * its own seat boundary with a null fallback, so no still catches a
 * placeholder (the plaza HeroProps law).
 */
export default function PropMounts() {
  return (
    <ResidentSuspense id="clouds:props">
      <RegisterHullProp />
      <HaloCrownProp />
    </ResidentSuspense>
  );
}

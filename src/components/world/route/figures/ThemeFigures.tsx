'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Figure from '@/components/world/route/figures/Figure';
import { preloadFigure } from '@/components/world/route/figures/figure-loader';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { ResidentSuspense, usePopulationCeiling } from '@/components/world/route/residency-store';
import { useFigureIndex } from '@/lib/route-world/model-manifest';
import {
  planThemeFigures,
  themeFigureLoadSet,
  type ThemeFigurePlan,
} from '@/lib/route-world/figure-contract';

/**
 * The theme figure mounter (C-100 criterion 1) — the engine component that
 * turns a theme's declarative `ThemeFigurePlan` into mounted rigged figures
 * through the SHARED pipeline: the KTX2-armed GLTF loader (`figure-loader`),
 * the fitted/animated `Figure`, the manifest species fallback chain and
 * bounds. Nothing here knows about plinths, rosters-as-data rows or plaza
 * layout — a theme hands in a plan and slot placements; colossal/tiny
 * handling comes from the manifest (`figure-contract.ts` stances).
 *
 * The KTX2 preload queue is respected the plaza way (PB-100): every resolved
 * GLB is kicked through `preloadFigure` in ONE effect before any Suspense
 * boundary commits, so the row never streams in one figure at a time.
 */

/** Where one planned figure stands. */
export interface FigureSlot {
  /** Stand point (feet), world metres. */
  position: readonly [number, number, number];
  /** Yaw the figure faces (radians). */
  yaw?: number;
  /**
   * POKEMON-CORE A1: the participant this slot's ace belongs to (the roll
   * call's `subjectId`). Roster slots default to their declaration id, which
   * IS the participant id in the grandstands; the clouds riders pass it.
   */
  subjectId?: string;
}

/** Pedestal insert under `tiny` figures (metres) — the eye-line riser. */
const TINY_PEDESTAL_M = 0.35;

/** Suspense stand-in and no-model fallback: a soft standing card. */
function FigurePlaceholder({ heightM }: { heightM: number }) {
  const h = Math.max(0.4, Math.min(heightM || 1, 2.4));
  return (
    <mesh position={[0, h / 2, 0]}>
      <cylinderGeometry args={[h * 0.16, h * 0.22, h, 10]} />
      <meshStandardMaterial color="#8d94a0" roughness={0.7} metalness={0.05} />
    </mesh>
  );
}

export default function ThemeFigures({
  plan,
  slots,
}: {
  plan: ThemeFigurePlan;
  /** One slot per planned figure (roster entries first, then pool). */
  slots: readonly FigureSlot[];
}) {
  const index = useFigureIndex();
  const { themeFigures } = useQuality();
  const planned = useMemo(() => planThemeFigures(index, plan), [index, plan]);
  const rosterCount = plan.roster?.length ?? 0;
  // The rung's ceiling applies to the shared mounter too, not only to the
  // plaza's own populations — an unbounded roster plan is what makes a weak
  // device unusable. Rung 0 keeps the whole authored plan (see
  // `QualityStep.themeFigures`).
  const requested = themeFigures === null ? planned.length : Math.min(planned.length, themeFigures);
  // D23 / plan item 7: from reveal the governor may only REMOVE figures, and
  // only while every figure the step removes (the plan's tail — slices keep
  // the survivors in their own slots) is outside the camera frustum.
  const slotGroups = useRef<(THREE.Group | null)[]>([]);
  const [tailOffCamera, setTailOffCamera] = useState(false);
  const ceiling = usePopulationCeiling(requested, tailOffCamera);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const viewProjection = useMemo(() => new THREE.Matrix4(), []);
  const sphere = useMemo(() => new THREE.Sphere(), []);
  const box = useMemo(() => new THREE.Box3(), []);
  useFrame(({ camera }) => {
    if (requested >= ceiling) {
      if (tailOffCamera) setTailOffCamera(false);
      return;
    }
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    let offCamera = true;
    for (let i = requested; i < ceiling && offCamera; i += 1) {
      const node = slotGroups.current[i];
      if (!node) continue;
      box.setFromObject(node);
      if (box.isEmpty()) continue;
      box.getBoundingSphere(sphere);
      if (frustum.intersectsSphere(sphere)) offCamera = false;
    }
    if (offCamera !== tailOffCamera) setTailOffCamera(offCamera);
  });
  const figures = useMemo(() => planned.slice(0, ceiling), [planned, ceiling]);
  const loadSet = useMemo(() => themeFigureLoadSet(figures), [figures]);

  // PB-100: kick every GLB at once — before mount, before any boundary. D23:
  // every theme group mounts at load, so this runs inside the ceremony.
  useEffect(() => {
    for (const url of loadSet) preloadFigure(url);
  }, [loadSet]);

  return (
    <group name="probe-figures">
      {figures.map((figure, i) => {
        const slot = slots[i];
        if (!slot) return null;
        const standY = figure.stance === 'tiny' ? slot.position[1] + TINY_PEDESTAL_M : slot.position[1];
        return (
          <group
            key={figure.key}
            ref={(node) => {
              slotGroups.current[i] = node;
            }}
            position={[slot.position[0], standY, slot.position[2]]}
            rotation={[0, slot.yaw ?? 0, 0]}
          >
            {figure.stance === 'tiny' ? (
              <mesh position={[0, TINY_PEDESTAL_M / 2, 0]} castShadow>
                <cylinderGeometry args={[0.24, 0.3, TINY_PEDESTAL_M, 12]} />
                <meshStandardMaterial color="#7c7468" roughness={0.8} metalness={0.08} />
              </mesh>
            ) : null}
            {figure.entry ? (
              <ResidentSuspense id={`theme-figure:${figure.key}`} fallback={<FigurePlaceholder heightM={figure.heightM} />}>
                <Figure
                  entry={figure.entry}
                  clip="idle"
                  name={`figure-${figure.key}`}
                  role={i < rosterCount ? 'ace' : 'wild'}
                  subjectId={i < rosterCount ? (slot.subjectId ?? figure.key) : null}
                />
              </ResidentSuspense>
            ) : (
              <FigurePlaceholder heightM={figure.heightM || 1} />
            )}
          </group>
        );
      })}
    </group>
  );
}

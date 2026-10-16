'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  FocusSubject as FocusSubjectData,
  SubjectBounds,
  SubjectKind,
  SubjectPanel,
  Vec3Tuple,
} from '@/lib/route-world/focus';
import { focusStore } from './focus-store';

interface FocusSubjectProps {
  id: string;
  kind: SubjectKind;
  label: string;
  /** Horizontal unit direction the subject faces (world space). */
  facing: Vec3Tuple;
  panel?: SubjectPanel;
  /**
   * World-space bounds. Omit to measure the children once they mount; pass a
   * `measureKey` that changes when the content loads so the proxy re-fits.
   */
  bounds?: SubjectBounds;
  measureKey?: string | number;
  children?: ReactNode;
}

const PADDING = 0.06;
const IDENTITY = new THREE.Quaternion();

/**
 * Declares one focusable Subject: registers it with the focus store and
 * renders an invisible raycast proxy over its bounds. The proxy is the only
 * thing the pointer ever tests — Pokémon skins, façades and LED panes carry
 * no handlers, so a frame with twelve subjects costs twelve box tests.
 *
 * Bounds are world AABBs, so the proxy's `matrixWorld` is written directly
 * and auto-update is off — it stays correct wherever in the graph the
 * subject is declared.
 */
export default function FocusSubject({
  id,
  kind,
  label,
  facing,
  panel,
  bounds,
  measureKey,
  children,
}: FocusSubjectProps) {
  const group = useRef<THREE.Group>(null);
  const proxy = useRef<THREE.Mesh>(null);
  const [measured, setMeasured] = useState<SubjectBounds | null>(null);
  const getThree = useThree((three) => three.get);

  // Wave 2 (2C): lend the live camera + canvas to the page-side hover
  // brackets and holo beam. A getter, not a snapshot — the rig may swap or
  // move the default camera, and the overlays read it only while drawing.
  useEffect(
    () =>
      focusStore.bindView(() => {
        const three = getThree();
        return { camera: three.camera, canvas: three.gl.domElement };
      }),
    [getThree],
  );

  useLayoutEffect(() => {
    if (bounds || !group.current) return;
    group.current.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(group.current);
    if (box.isEmpty()) return;
    setMeasured({
      min: [box.min.x - PADDING, box.min.y - PADDING, box.min.z - PADDING],
      max: [box.max.x + PADDING, box.max.y + PADDING, box.max.z + PADDING],
    });
  }, [bounds, measureKey]);

  const resolved = bounds ?? measured;

  // Callers pass `facing` / `panel` / `bounds` as literals; key the subject on
  // their values so a parent re-render (route data refresh) does not re-register
  // — re-registering drops a live focus through the unregister path.
  const [fx, fy, fz] = facing;
  const facingStable = useMemo<Vec3Tuple>(() => [fx, fy, fz], [fx, fy, fz]);
  const panelParam = panel?.param ?? null;
  const panelValue = panel?.value ?? null;
  const panelStable = useMemo<SubjectPanel | undefined>(
    () => (panelParam && panelValue ? { param: panelParam, value: panelValue } : undefined),
    [panelParam, panelValue],
  );
  const boundsKey = resolved ? [...resolved.min, ...resolved.max].join(',') : '';
  const boundsStable = useMemo<SubjectBounds | null>(
    () => resolved,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the numeric bounds
    [boundsKey],
  );

  const subject = useMemo<FocusSubjectData | null>(
    () =>
      boundsStable
        ? { id, kind, label, facing: facingStable, bounds: boundsStable, panel: panelStable }
        : null,
    [id, kind, label, facingStable, boundsStable, panelStable],
  );

  useEffect(() => {
    if (!subject) return;
    return focusStore.register(subject);
  }, [subject]);

  useLayoutEffect(() => {
    const mesh = proxy.current;
    if (!mesh || !boundsStable) return;
    const size = new THREE.Vector3(
      Math.max(0.05, boundsStable.max[0] - boundsStable.min[0]),
      Math.max(0.05, boundsStable.max[1] - boundsStable.min[1]),
      Math.max(0.05, boundsStable.max[2] - boundsStable.min[2]),
    );
    const center = new THREE.Vector3(
      (boundsStable.min[0] + boundsStable.max[0]) / 2,
      (boundsStable.min[1] + boundsStable.max[1]) / 2,
      (boundsStable.min[2] + boundsStable.max[2]) / 2,
    );
    mesh.matrixWorld.compose(center, IDENTITY, size);
    mesh.matrix.copy(mesh.matrixWorld);
  }, [boundsStable]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!subject) return;
    const current = focusStore.get();
    if (current.subject?.id === subject.id && current.phase !== 'releasing') return;
    focusStore.focus(subject);
  };

  // Wave 2 (2C): hover feeds the desktop brackets + "click to look closer"
  // pill (FocusHoverOverlay). Touch pointers are skipped: a tap fires `over`
  // right before `click`, and a pill flashing under a finger that is already
  // committing to the focus explains nothing — touch gets the settle breathe.
  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    document.body.style.cursor = 'pointer';
    if (event.nativeEvent.pointerType !== 'touch') focusStore.hover(id);
  };

  const handleOut = () => {
    document.body.style.cursor = '';
    focusStore.unhover(id);
  };

  return (
    <>
      <group ref={group}>{children}</group>
      {resolved && (
        <mesh
          ref={proxy}
          matrixAutoUpdate={false}
          matrixWorldAutoUpdate={false}
          visible={false}
          userData={{ focusSubject: id }}
          onClick={handleClick}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial />
        </mesh>
      )}
    </>
  );
}

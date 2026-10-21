'use client';

import { Children, type ReactNode, startTransition, useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { currentSceneGeneration } from '../world-readiness';
import { noteLoadSignal } from '../scene-progress';

/**
 * The world's staged top-level mount and the `worldStaged` flag the load
 * warm's content gate reads.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * ENGINE r3 (CAR r2: the ball froze 0.8-1.1 s right after the renderer
 * milestone): the world's scene tree mounts in STAGES, never in the canvas's
 * first commit. R3F renders its children at the default lane, which React
 * never time-slices, so the whole tree's render (every component, every
 * geometry built in a memo) ran as one 0.8 s task on dev, and its passive
 * effects as a second 0.3-0.4 s task. Here the renderer's first commit
 * carries only the engine's own components; the world's top-level children
 * then mount one per transition (`startTransition` renders are time-sliced
 * in R3F's concurrent root, so the render phase yields every few ms), and
 * each child commits and flushes its effects on its own.
 *
 * The load warm treats the content as incomplete until the last child has
 * committed (`worldStaged`), so no compile, warm settle or reveal can happen
 * over a partly mounted tree. Every stage is a stall-detector signal.
 */
const stagedWorlds = new WeakMap<THREE.WebGLRenderer, boolean>();

/** Every top-level world child has committed for this renderer. */
export function worldStaged(gl: THREE.WebGLRenderer): boolean {
  return stagedWorlds.get(gl) === true;
}

export function StagedWorld({ children }: { children: ReactNode }) {
  const gl = useThree((state) => state.gl);
  // ENGINE r4 (quiet probe: 51-88 ms governor-step tasks; a 100+ ms task at
  // the arm): `Children.toArray` clones every child to key it, so each
  // re-render of the canvas (the handoff flags at the arm, every governor
  // step) handed React NEW elements for the whole world and it re-rendered
  // every component in it. Memoised on the `children` prop — the world's
  // Scene elements, stable across those re-renders — React bails out and only
  // the context consumers (the handoff, the quality rung) re-render.
  const items = useMemo(() => Children.toArray(children), [children]);
  const total = items.length;
  const [count, setCount] = useState(0);
  useEffect(() => {
    noteLoadSignal(currentSceneGeneration(), 'staged', count + 1);
    if (count >= total) {
      stagedWorlds.set(gl, true);
      return;
    }
    stagedWorlds.set(gl, false);
    startTransition(() => setCount((current) => Math.max(current, count + 1)));
  }, [count, total, gl]);
  useEffect(
    () => () => {
      stagedWorlds.delete(gl);
    },
    [gl],
  );
  return <>{items.slice(0, count)}</>;
}

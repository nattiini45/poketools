'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { focusStore, installFocusBridge } from './focus-store';

/** Radians of orbit per CSS pixel of drag. */
const ORBIT_PER_PX = 0.0045;
/** Dolly multiplier per wheel notch (100 px of deltaY) with ctrl / trackpad pinch. */
const DOLLY_PER_NOTCH = 0.12;
/** A pointer that travels less than this before release is a tap, not a drag. */
const TAP_SLOP_PX = 6;

/**
 * Input policy for Focus (ADR-0003).
 *
 * Idle: the canvas passes wheel and touch through so the page scrolls and the
 * conductor drives the stations. Focused: a drag orbits (bounded), ctrl+wheel
 * or a two-finger pinch dollies (bounded), a plain wheel, a page scroll, Esc
 * or a tap on nothing releases. The subjects' own click handlers live in
 * `FocusSubject`; tap-away arrives via the canvas `onPointerMissed`.
 */
export default function FocusController() {
  const gl = useThree((state) => state.gl);

  useEffect(() => installFocusBridge(), []);

  useEffect(() => {
    const canvas = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    let dragging = false;
    let travelled = 0;
    let lastX = 0;
    let lastY = 0;

    const isLive = () => {
      const { phase } = focusStore.get();
      return phase === 'focused' || phase === 'focusing';
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isLive()) focusStore.release();
    };

    const onWheel = (event: WheelEvent) => {
      if (!isLive()) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const notches = event.deltaY / 100;
        focusStore.orbitBy({ dolly: 1 + notches * DOLLY_PER_NOTCH });
        return;
      }
      // A plain wheel is a scroll intent — let the page move and step out.
      focusStore.release();
    };

    // Only a scroll that moved the page is a step-out intent; layout-driven
    // scroll events (focus(), scrollIntoView on a fixed panel) must not release.
    let scrollY = window.scrollY;
    const onScroll = () => {
      const moved = Math.abs(window.scrollY - scrollY) > 1;
      scrollY = window.scrollY;
      if (moved && isLive()) focusStore.release();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isLive()) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // Capture EVERY pointer, not just the first: an uncaptured second
      // finger lifted over HUD chrome (nav pill, docked panels above the
      // canvas) sends its pointerup to that element instead of the canvas,
      // leaving a phantom map entry that pins every later solo drag in pinch
      // mode (PR #63 review).
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer Events spec: throws NotFoundError for an inactive
        // pointerId. At pointerdown the pointer is active in practice; if a
        // browser disagrees, the map entry still clears on the next
        // pointerup/pointercancel instead of stranding the gesture.
      }
      if (pointers.size === 1) {
        dragging = true;
        travelled = 0;
        lastX = event.clientX;
        lastY = event.clientY;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const next = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0 && next > 0) {
          focusStore.orbitBy({ dolly: pinchDistance / next });
        }
        pinchDistance = next;
        return;
      }

      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled < TAP_SLOP_PX) return;
      focusStore.orbitBy({ yaw: -dx * ORBIT_PER_PX, pitch: dy * ORBIT_PER_PX });
    };

    const endPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) dragging = false;
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      document.body.style.cursor = '';
    };
  }, [gl]);

  // Touch drags must orbit while focused and scroll the page while idle.
  useEffect(() => {
    const canvas = gl.domElement;
    const apply = () => {
      const { phase } = focusStore.get();
      const live = phase === 'focused' || phase === 'focusing';
      if (live) canvas.style.setProperty('touch-action', 'none');
      else canvas.style.removeProperty('touch-action');
    };
    apply();
    const unsubscribe = focusStore.subscribe(apply);
    return () => {
      unsubscribe();
      canvas.style.removeProperty('touch-action');
    };
  }, [gl]);

  return null;
}

'use client';

import { useSyncExternalStore } from 'react';
import type { Camera } from 'three';
import {
  clampOrbit,
  IDLE_ORBIT,
  type FocusOrbit,
  type FocusSubject,
  type SubjectPanel,
} from '@/lib/route-world/focus';

/**
 * Focus state shared by the DOM and the canvas.
 *
 * `<Canvas>` runs its own reconciler root, so React context does not cross
 * into the scene. A module-level store does, and `useSyncExternalStore`
 * gives both trees the same snapshot: the rig reads it per frame without a
 * render, the URL sync and the docked panel subscribe from the page side.
 *
 * Phases: idle → focusing (camera on its way) → focused (settled; orbit and
 * dolly live) → releasing (camera returning) → idle.
 */
export type FocusPhase = 'idle' | 'focusing' | 'focused' | 'releasing';

export interface FocusState {
  subject: FocusSubject | null;
  phase: FocusPhase;
  orbit: FocusOrbit;
}

const IDLE: FocusState = { subject: null, phase: 'idle', orbit: IDLE_ORBIT };

let state: FocusState = IDLE;
const listeners = new Set<() => void>();
const registry = new Map<string, FocusSubject>();
let registryVersion = 0;
const registryListeners = new Set<() => void>();

/**
 * Wave 2 (2C): the subject under a desktop pointer. A channel of its own, not
 * a `FocusState` field — hover flips on every pointer crossing, and folding it
 * into the focus snapshot would re-run every focus consumer (URL sync, the
 * docked panel) for a change none of them care about.
 */
let hoveredId: string | null = null;
const hoverListeners = new Set<() => void>();

/**
 * The live camera + canvas, handed out by the scene (FocusSubject binds it —
 * every subject sits inside the `<Canvas>`) so page-side overlays can project
 * subject bounds without a scene-side per-frame publisher. A set, because
 * every mounted subject binds an equivalent getter; any one of them answers.
 */
export interface FocusView {
  camera: Camera;
  canvas: HTMLCanvasElement;
}
const viewSources = new Set<() => FocusView>();

/**
 * Wave 2 r3 (W1): a scroll only steps out of a focus when the visitor asked
 * for it. The conductor re-anchors the page programmatically at route
 * handoff (`onLayoutMutation` → `scrollTo`), and that scroll event used to
 * release a deep-linked focus (`?board=roster`, `?team=`, `?rules=`), which
 * stripped the param before the panel opened. A scroll releases only when a
 * wheel, touch, key or pointer intent landed within this window.
 */
export const SCROLL_RELEASE_INTENT_MS = 500;

/** performance.now() of the last visitor input intent; -Infinity before any. */
let lastInputIntentAt = Number.NEGATIVE_INFINITY;

/** Pure gate: true when an input intent is fresh enough for a scroll to release. */
export function scrollIntentFresh(lastIntentAt: number, now: number): boolean {
  return now >= lastIntentAt && now - lastIntentAt <= SCROLL_RELEASE_INTENT_MS;
}

const INTENT_EVENTS = ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown'] as const;

/**
 * Records visitor input intents on `target` (capture, passive) so
 * `releaseForScroll` can tell a visitor scroll from a programmatic one.
 * Returns the uninstall.
 */
export function installScrollIntentTracker(target: Window): () => void {
  const note = () => {
    focusStore.noteInputIntent();
  };
  for (const type of INTENT_EVENTS) target.addEventListener(type, note, { capture: true, passive: true });
  return () => {
    for (const type of INTENT_EVENTS) target.removeEventListener(type, note, { capture: true });
  };
}

function emitHover(next: string | null): void {
  if (next === hoveredId) return;
  hoveredId = next;
  hoverListeners.forEach((listener) => listener());
}

function emit(next: FocusState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function emitRegistry(): void {
  registryVersion += 1;
  registryListeners.forEach((listener) => listener());
}

export const focusStore = {
  get(): FocusState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Subjects announce themselves so deep links and the harness can focus by id. */
  register(subject: FocusSubject): () => void {
    registry.set(subject.id, subject);
    // A re-registration with fresh bounds (a figure finished loading) must
    // reach a live focus too, or the camera keeps framing the placeholder.
    if (state.subject?.id === subject.id) emit({ ...state, subject });
    emitRegistry();
    return () => {
      registry.delete(subject.id);
      emitRegistry();
      // Same microtask rule as the focus below: a re-registration keeps the
      // hover, a real unmount (the pointer never sent `out`) drops it.
      if (hoveredId === subject.id) {
        queueMicrotask(() => {
          if (hoveredId === subject.id && !registry.has(subject.id)) emitHover(null);
        });
      }
      // React runs an effect's cleanup and its re-run in the same commit, so
      // a live subject that only re-registered is back in the registry by the
      // time this microtask runs; only a real unmount drops the focus.
      if (state.subject?.id === subject.id) {
        queueMicrotask(() => {
          if (state.subject?.id === subject.id && !registry.has(subject.id)) emit(IDLE);
        });
      }
    };
  },

  subscribeRegistry(listener: () => void): () => void {
    registryListeners.add(listener);
    return () => {
      registryListeners.delete(listener);
    };
  },

  registryVersion(): number {
    return registryVersion;
  },

  subjects(): FocusSubject[] {
    return [...registry.values()];
  },

  find(id: string): FocusSubject | null {
    return registry.get(id) ?? null;
  },

  findByPanel(param: string, value: string): FocusSubject | null {
    for (const subject of registry.values()) {
      if (subject.panel?.param === param && subject.panel.value === value) return subject;
    }
    return null;
  },

  focus(subject: FocusSubject): void {
    if (state.subject?.id === subject.id && state.phase !== 'releasing') return;
    emit({ subject, phase: 'focusing', orbit: IDLE_ORBIT });
  },

  focusById(id: string): boolean {
    const subject = registry.get(id);
    if (!subject) return false;
    focusStore.focus(subject);
    return true;
  },

  /** Called by the rig once the blend has landed. */
  settle(): void {
    if (state.phase === 'focusing') emit({ ...state, phase: 'focused' });
  },

  release(): void {
    if (state.subject === null || state.phase === 'releasing') return;
    emit({ ...state, phase: 'releasing' });
  },

  /** A visitor input (wheel, touch, key, pointer) just happened. */
  noteInputIntent(now: number = performance.now()): void {
    lastInputIntentAt = now;
  },

  /**
   * Release for a page scroll — only when a visitor intent is fresh (see
   * SCROLL_RELEASE_INTENT_MS). A programmatic re-anchor with no intent keeps
   * the focus (and its URL param). Returns true when it released.
   */
  releaseForScroll(now: number = performance.now()): boolean {
    if (!scrollIntentFresh(lastInputIntentAt, now)) return false;
    if (state.subject === null || state.phase === 'releasing') return false;
    focusStore.release();
    return true;
  },

  /** Called by the rig once the return blend has landed. */
  clear(): void {
    if (state.phase === 'releasing') emit(IDLE);
  },

  orbitBy(delta: Partial<FocusOrbit>): void {
    if (state.phase !== 'focused' && state.phase !== 'focusing') return;
    const orbit = clampOrbit({
      yaw: state.orbit.yaw + (delta.yaw ?? 0),
      pitch: state.orbit.pitch + (delta.pitch ?? 0),
      dolly: state.orbit.dolly * (delta.dolly ?? 1),
    });
    emit({ ...state, orbit });
  },

  /** The subject under a desktop (mouse / pen) pointer, or null. */
  hovered(): string | null {
    return hoveredId;
  },

  hover(id: string): void {
    emitHover(id);
  },

  /** Clears the hover only if `id` still holds it — out/over can interleave. */
  unhover(id: string): void {
    if (hoveredId === id) emitHover(null);
  },

  subscribeHover(listener: () => void): () => void {
    hoverListeners.add(listener);
    return () => {
      hoverListeners.delete(listener);
    };
  },

  /** Scene side: expose the live camera + canvas to page-side overlays. */
  bindView(source: () => FocusView): () => void {
    viewSources.add(source);
    return () => {
      viewSources.delete(source);
    };
  },

  /** The live camera + canvas, or null while no subject is mounted. */
  view(): FocusView | null {
    for (const source of viewSources) return source();
    return null;
  },
};

export function useFocusState(): FocusState {
  return useSyncExternalStore(focusStore.subscribe, focusStore.get, () => IDLE);
}

/** The hovered subject id (desktop pointer), null otherwise and on the server. */
export function useHoveredId(): string | null {
  return useSyncExternalStore(focusStore.subscribeHover, focusStore.hovered, () => null);
}

/** Bumps whenever a subject mounts or unmounts — deep links wait on it. */
export function useFocusRegistryVersion(): number {
  return useSyncExternalStore(focusStore.subscribeRegistry, focusStore.registryVersion, () => 0);
}

/** Read-only window bridge for the capture harness (`--focus <subject id>`). */
export type FocusHost = Window & {
  __routeWorldFocus?: {
    focus: (id: string) => boolean;
    release: () => void;
    subjects: () => string[];
    state: () => {
      id: string | null;
      phase: FocusPhase;
      orbit: FocusOrbit;
      panel: SubjectPanel | null;
      /** Wave 2 (2C): the desktop-hovered subject id, null when none. */
      hoveredId: string | null;
    };
  };
};

export function installFocusBridge(): () => void {
  const host = window as FocusHost;
  host.__routeWorldFocus = {
    focus: (id) => focusStore.focusById(id),
    release: () => focusStore.release(),
    subjects: () => focusStore.subjects().map((subject) => subject.id),
    state: () => ({
      id: state.subject?.id ?? null,
      phase: state.phase,
      orbit: state.orbit,
      panel: state.subject?.panel ?? null,
      hoveredId,
    }),
  };
  return () => {
    if (host.__routeWorldFocus) delete host.__routeWorldFocus;
  };
}

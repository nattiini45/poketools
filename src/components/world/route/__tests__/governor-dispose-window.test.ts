import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

/**
 * Kilo PR #65 (QualityGovernor): the step's `Material.prototype.dispose`
 * capture is bounded. A step above the floor used to leave the page-wide
 * patch on until the canvas unmounted, so every later disposal on the page
 * (theme-swap releases, other canvases) was swallowed for the rest of the
 * visit. Now each step captures for `STEP_DISPOSE_HOLD_FRAMES` drawn frames;
 * what it captured — the superseded materials whose programs a later rung
 * may still need (ENGINE r3) — stays undisposed until the floor or unmount.
 *
 * The harness renders the governor by calling it, with React's hooks
 * replaced by a tiny persistent runtime (state and refs keep their slot
 * across calls; an effect runs inline when its deps change; `startTransition`
 * applies at once) and R3F's `useFrame` / `useThree` stubbed, so a "commit"
 * is one call and a drawn frame is one `tick()`.
 */

interface Slot {
  value: unknown;
  frame?: () => void;
  deps?: unknown[];
  cleanup?: unknown;
}

const rt = vi.hoisted(() => ({ slots: [] as Slot[], cursor: 0 }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const slot = (init: () => unknown): Slot => {
    const index = rt.cursor;
    rt.cursor += 1;
    rt.slots[index] ??= { value: init() };
    return rt.slots[index];
  };
  const effect = (body: () => unknown, deps: unknown[]) => {
    const s = slot(() => null);
    if (s.deps !== undefined && deps.every((value, i) => Object.is(value, s.deps![i]))) return;
    if (typeof s.cleanup === 'function') (s.cleanup as () => void)();
    s.deps = deps;
    s.cleanup = body();
  };
  const hooks = {
    useRef: (value: unknown) => slot(() => ({ current: value })).value,
    useState: (init: unknown) => {
      const s = slot(() => (typeof init === 'function' ? (init as () => unknown)() : init));
      return [s.value, (next: unknown) => (s.value = next)];
    },
    useLayoutEffect: effect,
    useEffect: effect,
    startTransition: (run: () => void) => run(),
  };
  return { ...actual, ...hooks, default: { ...actual, ...hooks } };
});

vi.mock('@react-three/fiber', async (importOriginal) => {
  const three = await import('three');
  const state = {
    gl: { shadowMap: { autoUpdate: true, needsUpdate: false } },
    scene: new three.Scene(),
    camera: new three.PerspectiveCamera(),
    setDpr: () => {},
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useThree: (select: (s: typeof state) => unknown) => select(state),
    useFrame: (callback: (s: unknown, delta: number) => void) => {
      const index = rt.cursor;
      rt.cursor += 1;
      rt.slots[index] ??= { value: null };
      rt.slots[index].frame = () => callback(state, 1 / 60);
    },
  };
});

const governor = await import('../QualityGovernor');
const { QUALITY_LADDER } = await import('@/lib/route-world/quality');
const QualityGovernor = governor.default;
const FLOOR = QUALITY_LADDER.length - 1;

function render(index: number): void {
  rt.cursor = 0;
  QualityGovernor({ index, onStepDown: () => {}, onExhausted: () => {}, children: null });
}

/** The requested commit, then the transition's commit (the rung the world sees). */
function step(index: number): void {
  render(index);
  render(index);
}

function tick(frames = 1): void {
  for (let i = 0; i < frames; i += 1) for (const s of rt.slots) s?.frame?.();
}

function unmount(): void {
  for (const s of rt.slots) if (typeof s?.cleanup === 'function') (s.cleanup as () => void)();
  rt.slots = [];
}

function tracked(name: string, log: string[]): THREE.Material {
  const material = new THREE.MeshBasicMaterial();
  material.addEventListener('dispose', () => log.push(name));
  return material;
}

afterEach(() => {
  unmount();
  governor.releaseMaterialDisposals();
  governor.releaseDataTextureDisposals();
});

describe('governor step: the material-dispose capture is bounded (Kilo PR #65)', () => {
  it('a step above the floor stops capturing after the hold frames, but keeps what it captured', () => {
    const log: string[] = [];
    render(0);
    step(1);
    const superseded = tracked('superseded', log);
    superseded.dispose();
    tick(governor.STEP_DISPOSE_HOLD_FRAMES - 1);
    const inWindow = tracked('in-window', log);
    inWindow.dispose();
    expect(log).toEqual([]);
    tick();
    // The window closed: a later disposal anywhere on the page runs at once…
    const later = tracked('later', log);
    later.dispose();
    expect(log).toEqual(['later']);
    // …and keeps running at once, however long the visit stays above the floor.
    tick(600);
    const muchLater = tracked('much-later', log);
    muchLater.dispose();
    expect(log).toEqual(['later', 'much-later']);
    // The superseded materials still hold their programs for the next rung.
    expect(log).not.toContain('superseded');
  });

  it('the next step captures again; the floor disposes everything held, in call order', () => {
    const log: string[] = [];
    render(0);
    step(1);
    tracked('rung-1', log).dispose();
    tick(governor.STEP_DISPOSE_HOLD_FRAMES);
    step(2);
    tracked('rung-2', log).dispose();
    tick(governor.STEP_DISPOSE_HOLD_FRAMES);
    expect(log).toEqual([]);
    step(FLOOR);
    tracked('floor', log).dispose();
    tick(governor.STEP_DISPOSE_HOLD_FRAMES - 1);
    expect(log).toEqual([]);
    tick();
    expect(log).toEqual(['rung-1', 'rung-2', 'floor']);
    tracked('after', log).dispose();
    expect(log).toEqual(['rung-1', 'rung-2', 'floor', 'after']);
  });

  it('unmounting above the floor disposes what the steps held', () => {
    const log: string[] = [];
    render(0);
    step(1);
    tracked('held', log).dispose();
    tick(governor.STEP_DISPOSE_HOLD_FRAMES);
    expect(log).toEqual([]);
    unmount();
    expect(log).toEqual(['held']);
  });

  it('no step, no capture (the normal path is untouched)', () => {
    const log: string[] = [];
    render(0);
    render(0);
    tick(10);
    tracked('free', log).dispose();
    expect(log).toEqual(['free']);
  });
});

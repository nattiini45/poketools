/**
 * The FigureDirector seat owns its director: unmount disposes it (its
 * roll-call listener must not outlive it on the bus), and a StrictMode
 * remount (cleanup, then the same instance's effects again) gets a fresh,
 * undisposed director rather than stepping the disposed one.
 *
 * The component runs as a plain function: React's hooks are replaced by a
 * recorder, so its effects and their cleanups are driven by hand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  frame: null as null | ((state: unknown, delta: number) => void),
  created: [] as Array<{ id: number; dispose: ReturnType<typeof vi.fn>; pinPhase: ReturnType<typeof vi.fn> }>,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      hooks.effects.push(effect);
    },
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    hooks.frame = callback;
  },
}));

vi.mock('@/components/world/route/QualityGovernor', () => ({ useQuality: () => ({ figureLife: 'full' }) }));
vi.mock('@/components/world/route/WorldStateProvider', () => ({
  useWorldState: () => ({ conductor: { progress: { current: null } }, theme: null }),
}));

vi.mock('@/lib/route-world/figure-director', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/route-world/figure-director')>();
  return {
    ...actual,
    createFigureDirector: () => {
      const director = { id: hooks.created.length + 1, dispose: vi.fn(), pinPhase: vi.fn() };
      hooks.created.push(director);
      return director;
    },
  };
});

import FigureDirector, { getActiveFigureDirector, pinFigureDirector } from '../FigureDirector';

/** Runs every recorded effect (a mount) and returns their cleanups. */
function mount(): Array<() => void> {
  const cleanups: Array<() => void> = [];
  for (const effect of hooks.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  return cleanups;
}

function unmount(cleanups: Array<() => void>): void {
  for (const cleanup of cleanups) cleanup();
}

describe('FigureDirector seat lifecycle', () => {
  beforeEach(() => {
    hooks.effects = [];
    hooks.frame = null;
    hooks.created = [];
    // jsdom-free: the reduced-motion effect bails without matchMedia.
    vi.stubGlobal('window', { location: { search: '' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disposes its director on unmount and clears the active director', () => {
    FigureDirector();
    expect(hooks.created).toHaveLength(1);
    const director = hooks.created[0];

    const cleanups = mount();
    expect(getActiveFigureDirector()).toBe(director);
    expect(director.dispose).not.toHaveBeenCalled();

    unmount(cleanups);
    expect(director.dispose).toHaveBeenCalledTimes(1);
    expect(getActiveFigureDirector()).toBeNull();
    expect(pinFigureDirector(1)).toBe(false);
  });

  it('a StrictMode remount builds a fresh director instead of stepping the disposed one', () => {
    FigureDirector();
    const first = hooks.created[0];

    unmount(mount());
    expect(first.dispose).toHaveBeenCalledTimes(1);

    const cleanups = mount();
    expect(hooks.created).toHaveLength(2);
    const second = hooks.created[1];
    expect(getActiveFigureDirector()).toBe(second);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(pinFigureDirector(0.5)).toBe(true);
    expect(second.pinPhase).toHaveBeenCalledWith(0.5);
    expect(first.pinPhase).not.toHaveBeenCalled();

    unmount(cleanups);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(getActiveFigureDirector()).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

/**
 * ENGINE r2: a `preloadFigure` of an already-settled URL is a no-op. In r1 it
 * re-entered the pending set and settled again synchronously — two residency
 * changes per call — so a consumer whose preload effect re-ran on every
 * re-render (sakura's figure groups) re-armed the residency quiet window
 * forever and the load went to Lite at the deadline.
 */

vi.mock('@react-three/drei', () => {
  const useGLTF = Object.assign(
    vi.fn(() => ({ scene: {} })),
    { preload: vi.fn() },
  );
  return { useGLTF };
});

vi.mock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    setTranscoderPath() {
      return this;
    }
    setWorkerLimit() {
      return this;
    }
    detectSupport() {
      return this;
    }
  },
}));

describe('figure-loader settled preloads (ENGINE r2)', () => {
  it('notifies once for a new URL and never again for a settled one', async () => {
    const loader = await import('../figures/figure-loader');
    loader.armFigureLoader({} as never);
    const changes = vi.fn();
    const off = loader.subscribeFigureLoads(changes);
    loader.preloadFigure('/models/world/figures/a.glb');
    // Cached (the mocked cache read returns data): added and settled at once.
    expect(changes).toHaveBeenCalledTimes(2);
    expect(loader.pendingFigureLoads()).toBe(0);
    changes.mockClear();
    for (let i = 0; i < 10; i += 1) loader.preloadFigure('/models/world/figures/a.glb');
    expect(changes).not.toHaveBeenCalled();
    off();
  });
});

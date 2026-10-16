/**
 * PR #65 test-pass follow-ups on the figure director:
 *  - `dispose()` detaches the director's roll-call listener from its bus, so
 *    a bus that outlives the director (one handed in via `options.bus`) does
 *    not accumulate listeners across director lifetimes.
 *  - A throwing `onFigureSetChanged` listener is logged in production too,
 *    once per subscription (no per-step spam), and never breaks the step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAmbientBeatBus, type AmbientBeatBus } from '../ambient-beats';
import {
  createFigureDirector,
  FACE_NDC_FAR,
  onFigureSetChanged,
  type DirectorFrameInput,
  type FigureDirectorSource,
  type FigureRegistration,
} from '../figure-director';

/** A real bus whose live listener count is observable. */
function countingBus(): { bus: AmbientBeatBus; live: () => number } {
  const bus = createAmbientBeatBus({ seed: 1 });
  let live = 0;
  const subscribe = bus.subscribe.bind(bus);
  bus.subscribe = (listener) => {
    live += 1;
    const off = subscribe(listener);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      live -= 1;
      off();
    };
  };
  return { bus, live: () => live };
}

/** A clip-less figure: enough for the director to see the figure set change. */
function clipless(id: string): FigureRegistration {
  return {
    id,
    model: 'm.glb',
    object: { current: { visible: true, scale: { x: 1, y: 1, z: 1 }, matrixWorld: { elements: new Array(16).fill(0) } } },
    role: 'wild',
    subjectId: null,
    lowMotion: true,
    clips: [],
    durations: {},
    directorOwnsClip: true,
    baseClip: null,
    baseTimeScale: 1,
    breathe: false,
  } as unknown as FigureRegistration;
}

function source(): FigureDirectorSource & { add(reg: FigureRegistration): void } {
  const figures: FigureRegistration[] = [];
  let version = 0;
  return {
    figures: () => figures,
    actors: () => [],
    version: () => version,
    add(reg) {
      figures.push(reg);
      version += 1;
    },
  };
}

function frame(): DirectorFrameInput {
  return {
    delta: 1 / 30,
    generation: 1,
    hidden: false,
    loader: false,
    focusOpen: false,
    focusSubjectId: null,
    live: true,
    residencyComplete: true,
    settled: true,
    station: 0,
    life: 'full',
    reducedMotion: false,
    frustum: { intersectsSphere: () => true },
    cameraPosition: { x: 0, y: 0, z: 0 },
    activeBoard: null,
    faceDistanceNdc: () => FACE_NDC_FAR,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('figure-director: dispose', () => {
  it('detaches its bus listener, so a long-lived bus does not accumulate directors', () => {
    const { bus, live } = countingBus();
    for (let k = 0; k < 5; k += 1) {
      const director = createFigureDirector(source(), { seed: 1, bus });
      expect(live()).toBe(1);
      director.dispose();
      expect(live()).toBe(0);
    }
  });

  it('is idempotent', () => {
    const { bus, live } = countingBus();
    const director = createFigureDirector(source(), { seed: 1, bus });
    director.dispose();
    director.dispose();
    expect(live()).toBe(0);
  });
});

describe('figure-director: a throwing onFigureSetChanged listener', () => {
  it('is logged in production, once per subscription, and never breaks the step', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const src = source();
    const director = createFigureDirector(src, { seed: 2 });
    let others = 0;
    const thrower = onFigureSetChanged(() => {
      throw new Error('listener');
    });
    const other = onFigureSetChanged(() => (others += 1));
    try {
      for (let k = 0; k < 3; k += 1) {
        src.add(clipless(`figure-${k}`));
        expect(() => director.step(frame())).not.toThrow();
      }
      expect(others).toBe(3);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain('onFigureSetChanged listener threw');
    } finally {
      thrower();
      other();
      director.dispose();
    }
  });
});

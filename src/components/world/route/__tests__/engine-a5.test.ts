import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidate as r3fInvalidate } from '@react-three/fiber';
import {
  createDrivenClock,
  createFrameCapState,
  DEFAULT_FRAME_CAP_MODE,
  driveClock,
  drivenClockSeconds,
  frameCapDuringCeremony,
  frameCapMode,
  noteFrameCapDriver,
  parseFrameCapMode,
  pinPhaseAdvance,
  requestedFrameCapMode,
  resetFrameCapForTests,
  restartDrivenClock,
  stepFrameCap,
  type DrivenClock,
} from '../frame-cap';
import { FACE_PAINT_FONT_PROBE, facePaintFontLog, queuePaint, resetPaintQueueForTests } from '../paint-queue';

/**
 * ENGINE-A5 (D40): `even40` is the post-reveal frame-cap DEFAULT, so the route
 * canvas runs r3f's `frameloop="never"` and every render comes from
 * FrameCapDriver's rAF; the capture phase pin drives the continuous driven
 * clock; the canvas face painters never wait on a web font.
 */

const ROUTE = join(__dirname, '..');
const SRC = join(__dirname, '..', '..', '..', '..');
const read = (file: string) => readFileSync(join(ROUTE, file), 'utf8');

function withSearch(search: string, fn: () => void): void {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { search } };
  try {
    resetFrameCapForTests();
    fn();
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
    resetFrameCapForTests();
  }
}

afterEach(() => {
  resetFrameCapForTests();
  resetPaintQueueForTests();
  vi.unstubAllGlobals();
});

describe('D40 default mode (ENGINE-A5)', () => {
  it('parses no value, and anything that is not a mode, as even40; off and hard40 are explicit opt-ins', () => {
    expect(DEFAULT_FRAME_CAP_MODE).toBe('even40');
    expect(parseFrameCapMode(null)).toBe('even40');
    expect(parseFrameCapMode(undefined)).toBe('even40');
    expect(parseFrameCapMode('')).toBe('even40');
    expect(parseFrameCapMode('ON')).toBe('even40');
    expect(parseFrameCapMode('off')).toBe('off');
    expect(parseFrameCapMode('hard40')).toBe('hard40');
    expect(parseFrameCapMode('even40')).toBe('even40');
  });

  it('a page with no ?routeFrameCap runs even40; ?routeFrameCap=off and hard40 switch it', () => {
    withSearch('', () => {
      expect(requestedFrameCapMode()).toBe('even40');
      expect(frameCapMode()).toBe('even40');
    });
    withSearch('?routeDebug=1&tier=route', () => expect(requestedFrameCapMode()).toBe('even40'));
    withSearch('?routeFrameCap=off', () => {
      expect(requestedFrameCapMode()).toBe('off');
      expect(frameCapMode()).toBe('off');
    });
    withSearch('?routeFrameCap=hard40', () => expect(requestedFrameCapMode()).toBe('hard40'));
    // Server render (no window): the default too.
    resetFrameCapForTests();
    expect(requestedFrameCapMode()).toBe('even40');
  });

  it('the ceremony stays uncapped: the ceremony cap is a routeDebug-only experiment, and the canvas window opens only after the ball and outside the veil', () => {
    withSearch('?routeFrameCapCeremony=1', () => expect(frameCapDuringCeremony()).toBe(false));
    withSearch('?routeDebug=1&routeFrameCapCeremony=1', () => expect(frameCapDuringCeremony()).toBe(true));
    const canvas = read('RouteWorldCanvas.tsx');
    expect(canvas).toMatch(/if \(getThemeVeilPhase\(\) !== 'idle'\) return false;\s*return !hasBallLoader\(\) \|\| getBallPhase\(\) === 'done';/);
    // Outside the window every rAF renders (the ceremony and the veil are uncapped).
    const state = createFrameCapState();
    for (let i = 0; i < 120; i += 1) expect(stepFrameCap(state, i * (1000 / 60), 'even40', false)).toBe(true);
  });

  it('the canvas mounts the driver by default and drops to demand only while parked', () => {
    const canvas = read('RouteWorldCanvas.tsx');
    expect(canvas).toMatch(/const \[frameCapDriven\] = useState\(\(\) => requestedFrameCapMode\(\) !== 'off'\);/);
    expect(canvas).toMatch(/frameloop=\{parked \? 'demand' : frameCapDriven \? 'never' : 'always'\}/);
    expect(canvas).toMatch(/\{frameCapDriven \? <FrameCapDriver enabled=\{!parked\} \/> : null\}/);
    expect(canvas).toMatch(/noteFrameCapDriver\(true, state, clock\);/);
  });
});

describe('capture phase pin on the driven clock (ENGINE-A5, D40)', () => {
  /**
   * r3f 9 under `frameloop="never"` (events-*.esm.js `update`): the frame's
   * delta is `timestamp - clock.elapsedTime`, then `elapsedTime = timestamp`;
   * every subscriber runs with that clock. Movers read `elapsedTime`, mixers
   * integrate `delta`.
   */
  function neverLoop() {
    const clock = { elapsedTime: 0 };
    const frames: { delta: number; elapsed: number }[] = [];
    return {
      clock,
      frames,
      advance(timestamp: number) {
        const delta = timestamp - clock.elapsedTime;
        clock.elapsedTime = timestamp;
        frames.push({ delta, elapsed: clock.elapsedTime });
      },
    };
  }
  function driven(r3f: ReturnType<typeof neverLoop>, clock: DrivenClock, rafMs: number): void {
    const { seconds, seat } = driveClock(clock, rafMs, r3f.clock.elapsedTime);
    if (seat !== null) r3f.clock.elapsedTime = seat;
    r3f.advance(seconds);
  }
  /** The pin as PhasePinBridge runs it (stamp, one advance, re-stamp or re-seat). */
  function pin(r3f: ReturnType<typeof neverLoop>, pinnedElapsed: number, drivenSeconds: number | null, nowMs: number) {
    const plan = pinPhaseAdvance({ frameloop: 'never', clockSeconds: r3f.clock.elapsedTime, drivenSeconds, pinnedElapsed, nowMs });
    r3f.clock.elapsedTime = pinnedElapsed;
    r3f.advance(plan.advanceTo);
    if (plan.restoreSeconds === null) r3f.clock.elapsedTime = pinnedElapsed;
    else r3f.clock.elapsedTime = plan.restoreSeconds;
    return plan;
  }
  const VSYNC = 1000 / 60;

  it('the pin runs its subscribers at the pinned phase with delta 0, and the next driven frame continues the clock by one displayed interval', () => {
    const r3f = neverLoop();
    const clock = createDrivenClock();
    restartDrivenClock(clock);
    // 40 s into the session, even40 on 60 Hz: a render every 2nd vsync.
    for (let i = 0; i < 20; i += 1) driven(r3f, clock, 40_000 + i * 2 * VSYNC);
    const before = r3f.clock.elapsedTime;
    const mark = r3f.frames.length;
    pin(r3f, 0, clock.seconds, 40_000 + 20 * 2 * VSYNC - 5);
    // The pin's own frame: the movers saw the canonical phase, no time passed for a mixer.
    expect(r3f.frames[mark]).toEqual({ delta: 0, elapsed: 0 });
    // The r3f clock is back on the driven clock.
    expect(r3f.clock.elapsedTime).toBe(before);
    for (let i = 20; i < 25; i += 1) driven(r3f, clock, 40_000 + i * 2 * VSYNC);
    const after = r3f.frames.slice(mark + 1).map((f) => f.delta);
    for (const d of after) expect(d).toBeCloseTo((2 * VSYNC) / 1000, 6);
    expect(Math.min(...r3f.frames.map((f) => f.delta))).toBeGreaterThanOrEqual(0);
    // A pinned phase AHEAD of the driven clock rewinds nothing either.
    const mark2 = r3f.frames.length;
    pin(r3f, 9_999, clock.seconds, 41_000);
    driven(r3f, clock, 40_000 + 25 * 2 * VSYNC);
    expect(r3f.frames[mark2].delta).toBe(0);
    expect(r3f.frames[mark2 + 1].delta).toBeCloseTo((2 * VSYNC) / 1000, 6);
  });

  it('the pre-A5 advance(performance.now()) under never jumped every mixer by thousands of seconds (the defect the helper removes)', () => {
    const r3f = neverLoop();
    const clock = createDrivenClock();
    restartDrivenClock(clock);
    for (let i = 0; i < 5; i += 1) driven(r3f, clock, 40_000 + i * VSYNC);
    r3f.clock.elapsedTime = 0;
    r3f.advance(40_100); // the old call: a ms timestamp into a seconds clock
    expect(r3f.frames[r3f.frames.length - 1].delta).toBeGreaterThan(1000);
  });

  it('outside never the pre-D40 path is unchanged (r3f ignores the timestamp and the clock stays at the pin)', () => {
    expect(pinPhaseAdvance({ frameloop: 'always', clockSeconds: 12, drivenSeconds: null, pinnedElapsed: 0, nowMs: 5000 })).toEqual({ advanceTo: 5000, restoreSeconds: null });
    expect(pinPhaseAdvance({ frameloop: 'demand', clockSeconds: 12, drivenSeconds: 3, pinnedElapsed: 0, nowMs: 5000 })).toEqual({ advanceTo: 5000, restoreSeconds: null });
    // never, with the r3f clock behind the driven one: re-seat on the later.
    expect(pinPhaseAdvance({ frameloop: 'never', clockSeconds: 2, drivenSeconds: 3, pinnedElapsed: 0, nowMs: 5000 })).toEqual({ advanceTo: 0, restoreSeconds: 3 });
    expect(pinPhaseAdvance({ frameloop: 'never', clockSeconds: Number.NaN, drivenSeconds: null, pinnedElapsed: 0.5, nowMs: 1 })).toEqual({ advanceTo: 0.5, restoreSeconds: 0 });
  });

  it('the driver publishes its clock and PhasePinBridge advances through the helper', () => {
    const clock = createDrivenClock();
    expect(drivenClockSeconds()).toBeNull();
    noteFrameCapDriver(true, createFrameCapState(), clock);
    restartDrivenClock(clock);
    driveClock(clock, 10_000, 4);
    driveClock(clock, 10_000 + VSYNC * 2, 4);
    expect(drivenClockSeconds()).toBeCloseTo(4 + (2 * VSYNC) / 1000, 6);
    noteFrameCapDriver(false, null);
    expect(drivenClockSeconds()).toBeCloseTo(4 + (2 * VSYNC) / 1000, 6);
    const canvas = read('RouteWorldCanvas.tsx');
    expect(canvas).not.toMatch(/root\.advance\(performance\.now\(\), false\)/);
    expect(canvas).toMatch(/const plan = pinPhaseAdvance\(\{\s*frameloop: root\.frameloop,/);
    expect(canvas).toMatch(/root\.advance\(plan\.advanceTo, false\);/);
    expect(canvas).toMatch(/clock\.elapsedTime = plan\.restoreSeconds;/);
  });
});

/**
 * ENGINE-A5 audit: every path that could have assumed an `always` or
 * `demand` frameloop, and why it holds under `never` (every render comes from
 * FrameCapDriver's rAF: each rAF through the ceremony and the veil, every Nth
 * after the reveal; `demand` returns only while the tab is parked).
 */
const INVALIDATE_SITES: Record<string, string> = {
  // file (relative to src/) -> verdict
  'components/world/route/ConductorDriver.tsx':
    'a compile-held renderable is released by a later frame: the driver supplies it (every rAF in the ceremony, <= 1 capped interval after); the invalidate is only for the parked `demand` loop, where it works',
  'components/world/route/RouteWorldCanvas.tsx':
    'SceneReadinessReporter\'s explicit first frame: a no-op under `never`, where the driver draws every ceremony rAF from mount; still needed for a parked (`demand`) first load',
  'components/world/route/post/PostStack.tsx':
    'D42 N3 RouteN8AO mirrors the library `<N8AO>` wrapper (enable, config and quality writes, each followed by invalidate): no-ops under `never`, where the driver draws the next rAF with the new AO config; under a parked `demand` loop they only schedule the frame that applies it, as the library wrapper did',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe('no render depends on invalidate under frameloop="never" (ENGINE-A5 contract)', () => {
  it('r3f 9 drops invalidate() under never and schedules a frame under demand (the behaviour the audit rests on)', () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    const state = (frameloop: string) => ({ frameloop, gl: { xr: { isPresenting: false } }, internal: { active: true, frames: 0 } });
    const never = state('never');
    r3fInvalidate(never as never);
    expect(never.internal.frames).toBe(0);
    expect(raf).not.toHaveBeenCalled();
    const demand = state('demand');
    r3fInvalidate(demand as never);
    expect(demand.internal.frames).toBe(1);
  });

  it('every invalidate / setFrameloop / advance call site in the world code is audited', () => {
    const files = walk(join(SRC, 'components', 'world')).concat(walk(join(SRC, 'lib', 'route-world')));
    const sites = new Set<string>();
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/)/.test(line))
        .join('\n');
      if (/\binvalidate\s*\(|\.setFrameloop\(/.test(code)) sites.add(relative(SRC, file).replace(/\\/g, '/'));
    }
    expect([...sites].sort()).toEqual(Object.keys(INVALIDATE_SITES).sort());
    // The only r3f advances are the driver's and the pin's (both on the driven clock).
    const canvas = read('RouteWorldCanvas.tsx');
    expect(canvas.match(/root\.advance\(/g)).toHaveLength(2);
    expect(canvas).toMatch(/root\.advance\(seconds, true\);/);
  });
});

describe('the rules plaques bimodality is the lens dead band, not fonts (ENGINE-A5)', () => {
  it('the rig applies the station fov exactly: no 0.01 degree dead band can park the lens off its authored value', () => {
    const rig = read('CameraRig.tsx');
    expect(rig).toMatch(/if \(camera\.fov !== s\.out\.fov\) \{\s*camera\.fov = s\.out\.fov;\s*camera\.updateProjectionMatrix\(\);/);
    expect(rig).not.toMatch(/Math\.abs\(camera\.fov - s\.out\.fov\) > 0\.01/);
    expect(rig).not.toMatch(/routeFovBand|LEGACY_FOV_BAND/);
  });
});

describe('canvas faces never wait on a web font (ENGINE-A5 fonts item)', () => {
  const PAINTERS = [
    'components/world/evoliga/route/plaza/board/board-painters.ts',
    'components/world/evoliga/route/plaza/desk-painters.ts',
    'components/world/evoliga/route/plaza/gate-painters.ts',
    'components/world/evoliga/route/plaza/LedScreen.tsx',
    'components/world/evoliga/route/plaza/Plinth.tsx',
    'components/world/route/teams/ledger-painter.ts',
    'components/world/themes/clouds/content/paint.ts',
    'components/world/themes/mountain/content/paint.ts',
    'components/world/themes/plaza/stone-maps.ts',
    'components/world/themes/sakura/content/paint.ts',
    'lib/route-world/board-text.ts',
  ];
  const SYSTEM_STACK = "system-ui, 'Segoe UI', sans-serif";

  it('every face painter font stack is the system stack (a web font would need document.fonts.load before the paint, D23)', () => {
    for (const file of PAINTERS) {
      const code = readFileSync(join(SRC, file), 'utf8');
      const stacks = [...code.matchAll(/const [A-Z_]*(?:FONT|FACE)[A-Z_]* = ("[^"]*"|'[^']*');/g)].map((m) => m[1].slice(1, -1));
      for (const stack of stacks) expect({ file, stack }).toEqual({ file, stack: SYSTEM_STACK });
      expect({ file, web: /var\(--font|Nunito|DM Sans|@font-face|new FontFace/.test(code) }).toEqual({ file, web: false });
    }
    expect(FACE_PAINT_FONT_PROBE.endsWith(SYSTEM_STACK)).toBe(true);
  });

  it('the routeDebug readout records document.fonts at each face paint, and nothing outside debug', async () => {
    const run = async () => {
      let done = 0;
      queuePaint(() => {
        done += 1;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return done;
    };
    expect(await run()).toBe(1);
    expect(facePaintFontLog()).toEqual([]);
    resetPaintQueueForTests();
    vi.stubGlobal('window', { location: { search: '?routeDebug=1' } });
    const faces = [{ status: 'loaded' }, { status: 'loading' }];
    vi.stubGlobal('document', { fonts: { status: 'loading', forEach: (fn: (f: { status: string }) => void) => faces.forEach(fn), check: () => true } });
    expect(await run()).toBe(1);
    const log = facePaintFontLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ n: 1, status: 'loading', faceFontReady: true, webFonts: { loaded: 1, loading: 1, unloaded: 0, error: 0 } });
  });
});
